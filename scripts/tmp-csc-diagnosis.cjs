const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { createClient } = require("@supabase/supabase-js");
const { decryptSecretPayload } = require("/opt/nuvem-local-fiscal/dist/lib/certificates.js");

const fingerprint = (value) =>
  createHash("sha256").update(String(value).trim(), "utf8").digest("hex").slice(0, 16);

function loadEnvFile(path) {
  try {
    const content = readFileSync(path, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match && !process.env[match[1].trim()]) {
        process.env[match[1].trim()] = match[2].trim();
      }
    }
  } catch {
    // Local development can rely on the current process environment.
  }
}

async function main() {
  loadEnvFile("/etc/nuvem-local-fiscal.env");
  const cnpj = String(process.argv[2] || "01997929000108").replace(/\D/g, "");
  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );
  const company = (
    await supabase.from("fiscal_companies").select("id").eq("cnpj", cnpj).single()
  ).data;
  const environment = (
    await supabase
      .from("fiscal_company_environments")
      .select("id")
      .eq("company_id", company.id)
      .eq("environment", "homologacao")
      .single()
  ).data;
  const config = (
    await supabase
      .from("fiscal_service_configs")
      .select("settings,secrets_encrypted")
      .eq("company_environment_id", environment.id)
      .eq("service_type", "NFCE")
      .single()
  ).data;
  const current = decryptSecretPayload(
    config.secrets_encrypted,
    process.env.CERTIFICATE_ENCRYPTION_KEY
  );
  const documents =
    (
      await supabase
        .from("fiscal_documents")
        .select("id,number,status,nfce_config_encrypted,created_at,signed_xml")
        .eq("issuer_cnpj", cnpj)
        .eq("environment", "homologacao")
        .eq("document_type", "NFCe")
        .order("created_at", { ascending: false })
        .limit(10)
    ).data || [];

  console.log(
    JSON.stringify(
      {
        current: {
          cscId: config.settings.cscId,
          cscFingerprint: fingerprint(current.csc)
        },
        documents: documents.map((document) => {
          try {
            const saved = decryptSecretPayload(
              document.nfce_config_encrypted,
              process.env.CERTIFICATE_ENCRYPTION_KEY
            );
            const qrCode =
              document.signed_xml?.match(/<qrCode><!\[CDATA\[([^\]]+)/)?.[1] || "";
            const qrPayload = qrCode.split("?p=")[1] || "";
            const parts = qrPayload.split("|");
            const transmittedHash = parts.pop() || "";
            const payloadWithoutHash = parts.join("|");
            const expectedHash = createHash("sha1")
              .update(`${payloadWithoutHash}${saved.csc.trim()}`, "utf8")
              .digest("hex")
              .toUpperCase();
            return {
              id: document.id,
              number: document.number,
              status: document.status,
              createdAt: document.created_at,
              cscId: saved.cscId,
              cscFingerprint: fingerprint(saved.csc),
              matchesCurrent: fingerprint(saved.csc) === fingerprint(current.csc),
              qrTokenId: parts[3] || null,
              qrHashMatchesSavedCsc: transmittedHash === expectedHash
            };
          } catch {
            return {
              id: document.id,
              number: document.number,
              status: document.status,
              createdAt: document.created_at,
              decryptionError: true
            };
          }
        })
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
