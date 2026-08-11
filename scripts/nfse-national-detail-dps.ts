import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { decryptCertificateBundle, parsePfx } from "../src/lib/certificates.js";
import { consultNationalDps, consultNationalNfse } from "../src/lib/nfse-national-sefin.js";
import { NFSE_NATIONAL_PRODUCTION_ENDPOINT, NFSE_NATIONAL_RESTRICTED_ENDPOINT } from "../src/lib/nfse-national.js";

function loadEnvFile(path: string) {
  try { for (const line of readFileSync(path, "utf8").split(/\r?\n/)) { const m = line.match(/^([^#=]+)=(.*)$/); if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim(); } } catch {}
}
loadEnvFile("/etc/nuvem-local-fiscal.env"); loadEnvFile(".env.local"); loadEnvFile(".env");

function option(name: string) { const p = `--${name}=`; return process.argv.find((v) => v.startsWith(p))?.slice(p.length); }
function required(name: string) { const v = option(name); if (!v) throw new Error(`Informe --${name}=valor.`); return v; }
function tag(xml: string | null, name: string) { return xml?.match(new RegExp(`<(?:(?:[A-Za-z0-9_]+):)?${name}>([^<]*)</(?:(?:[A-Za-z0-9_]+):)?${name}>`, "i"))?.[1]?.trim() ?? null; }
function makeDpsId(cnpj: string, municipio: string, serie: string, numero: string) { return `DPS${municipio}2${cnpj}${serie.padStart(5, "0")}${numero.padStart(15, "0")}`; }

async function main() {
  const cnpj = required("cnpj").replace(/\D/g, "");
  const municipio = required("municipio").replace(/\D/g, "");
  const serie = required("serie").replace(/\D/g, "");
  const numero = required("numero").replace(/\D/g, "");
  const ambiente = option("ambiente") ?? "producao";
  const supabase = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "", process.env.SUPABASE_SERVICE_ROLE_KEY || "", { auth: { persistSession: false } });
  const { data, error } = await supabase.from("fiscal_certificates").select("encrypted_bundle").eq("cnpj", cnpj).eq("active", true).limit(1).maybeSingle();
  if (error) throw error;
  if (!data?.encrypted_bundle) throw new Error("Certificado ativo não encontrado.");
  const bundle = decryptCertificateBundle(data.encrypted_bundle, process.env.CERTIFICATE_ENCRYPTION_KEY || "");
  const cert = parsePfx(Buffer.from(bundle.pfxBase64, "base64"), bundle.password);
  const endpoint = ambiente === "producao" ? NFSE_NATIONAL_PRODUCTION_ENDPOINT : NFSE_NATIONAL_RESTRICTED_ENDPOINT;
  const dpsId = makeDpsId(cnpj, municipio, serie, numero);
  const dps = await consultNationalDps({ endpoint, dpsId, privateKeyPem: cert.privateKeyPem, certificatePem: cert.certificatePem, certificateChainPem: cert.certificateChainPem });
  const nfse = dps.accessKey ? await consultNationalNfse({ endpoint, accessKey: dps.accessKey, privateKeyPem: cert.privateKeyPem, certificatePem: cert.certificatePem, certificateChainPem: cert.certificateChainPem }) : null;
  console.log(JSON.stringify({ mode: "read-only", dpsId, dps: { statusCode: dps.statusCode, accessKey: dps.accessKey, errors: dps.errors, xml: dps.nfseXml }, nfse: nfse ? { statusCode: nfse.statusCode, accessKey: nfse.accessKey, errors: nfse.errors, xml: nfse.nfseXml } : null, extracted: nfse?.nfseXml ? { nfseNumber: tag(nfse.nfseXml, "nNFSe"), accessKey: tag(nfse.nfseXml, "chNFSe"), issuedAt: tag(nfse.nfseXml, "dhEmi"), competence: tag(nfse.nfseXml, "dCompet"), customerName: tag(nfse.nfseXml, "xNome"), serviceValue: tag(nfse.nfseXml, "vServ"), status: tag(nfse.nfseXml, "cStat") } : null }, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
