import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(path: string) {
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match && !process.env[match[1].trim()]) {
        process.env[match[1].trim()] = match[2].trim();
      }
    }
  } catch {}
}

function option(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

loadEnvFile("/etc/nuvem-local-fiscal.env");
loadEnvFile(".env.local");
loadEnvFile(".env");

async function main() {
  if (option("confirmar") !== "RESTAURAR-MUNICIPAL") {
    throw new Error("Use --confirmar=RESTAURAR-MUNICIPAL para autorizar a alteracao.");
  }
  const cnpjs = (option("cnpjs") ?? "")
    .split(",")
    .map((value) => value.replace(/\D/g, ""))
    .filter(Boolean);
  const ambiente = option("ambiente") ?? "producao";
  if (!cnpjs.length || cnpjs.some((cnpj) => !/^\d{14}$/.test(cnpj))) {
    throw new Error("Informe --cnpjs com CNPJs validos separados por virgula.");
  }

  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    { auth: { persistSession: false } }
  );
  const { data, error } = await supabase
    .from("fiscal_service_configs")
    .select("id,settings,fiscal_company_environments!inner(environment,fiscal_companies!inner(cnpj))")
    .eq("service_type", "NFSE")
    .eq("fiscal_company_environments.environment", ambiente)
    .in("fiscal_company_environments.fiscal_companies.cnpj", cnpjs);
  if (error) throw error;
  if ((data ?? []).length !== cnpjs.length) {
    throw new Error(`Configuracoes encontradas: ${data?.length ?? 0}; esperadas: ${cnpjs.length}.`);
  }

  const changed = [] as Array<{ cnpj: string; from: unknown; to: unknown }>;
  for (const current of data ?? []) {
    const cnpj = String((current as any).fiscal_company_environments?.fiscal_companies?.cnpj ?? "");
    const settings = { ...((current.settings ?? {}) as Record<string, unknown>) };
    const fallback = settings.nfseMunicipalFallback as
      | { provider?: unknown; settings?: Record<string, unknown> }
      | undefined;
    const provider = String(fallback?.provider ?? "");
    if (!provider || !fallback?.settings || provider === "nfse-nacional") {
      throw new Error(`${cnpj}: fallback municipal valido nao encontrado.`);
    }
    if (settings.nfseProvider !== "nfse-nacional") {
      throw new Error(`${cnpj}: provedor atual nao e nacional; nenhuma alteracao foi feita.`);
    }
    const restored = { ...settings, ...fallback.settings, nfseProvider: provider };
    const { error: updateError } = await supabase
      .from("fiscal_service_configs")
      .update({ settings: restored })
      .eq("id", current.id);
    if (updateError) throw updateError;
    changed.push({ cnpj, from: settings.nfseProvider, to: provider });
  }

  const statePath = process.env.STATE_FILE || "/opt/nuvem-local-fiscal/storage/fallback-state.json";
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8")) as { serviceConfigs?: Array<Record<string, unknown>> };
    for (const item of state.serviceConfigs ?? []) {
      if (!cnpjs.includes(String(item.cnpj)) || item.ambiente !== ambiente || item.serviceType !== "NFSE") continue;
      const settings = { ...((item.settings ?? {}) as Record<string, unknown>) };
      const fallback = settings.nfseMunicipalFallback as
        | { provider?: unknown; settings?: Record<string, unknown> }
        | undefined;
      if (fallback?.provider && fallback.settings) {
        item.settings = { ...settings, ...fallback.settings, nfseProvider: fallback.provider };
        item.updatedAt = new Date().toISOString();
      }
    }
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch (stateError) {
    if ((stateError as NodeJS.ErrnoException).code !== "ENOENT") throw stateError;
  }
  console.log(JSON.stringify({ changed, ambiente }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
