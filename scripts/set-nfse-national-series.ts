import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(path: string) {
  try { for (const line of readFileSync(path, "utf8").split(/\r?\n/)) { const m = line.match(/^([^#=]+)=(.*)$/); if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim(); } } catch {}
}
loadEnvFile("/etc/nuvem-local-fiscal.env"); loadEnvFile(".env.local"); loadEnvFile(".env");

function option(name: string) { const p = `--${name}=`; return process.argv.find((v) => v.startsWith(p))?.slice(p.length); }
function required(name: string) { const v = option(name); if (!v) throw new Error(`Informe --${name}=valor.`); return v; }

async function main() {
  const cnpj = required("cnpj").replace(/\D/g, "");
  const ambiente = option("ambiente") ?? "producao";
  const serie = required("serie").replace(/\D/g, "");
  const nextNumber = option("numero")?.replace(/\D/g, "");
  if (!/^\d{14}$/.test(cnpj) || !/^\d{1,5}$/.test(serie)) throw new Error("CNPJ ou serie invalida.");
  if (option("confirmar") !== "NHT-SERIE-2") throw new Error("Use --confirmar=NHT-SERIE-2 para autorizar a alteracao.");
  const supabase = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "", process.env.SUPABASE_SERVICE_ROLE_KEY || "", { auth: { persistSession: false } });
  const { data, error } = await supabase.from("fiscal_service_configs").select("id,settings,fiscal_company_environments!inner(environment,fiscal_companies!inner(cnpj))").eq("service_type", "NFSE").eq("fiscal_company_environments.environment", ambiente).eq("fiscal_company_environments.fiscal_companies.cnpj", cnpj).limit(2);
  if (error) throw error;
  if (!data || data.length !== 1) throw new Error(`Configuracao NFSE unica nao encontrada; encontrados: ${data?.length ?? 0}.`);
  const current = data[0];
  const settings = { ...(current.settings as Record<string, unknown>), nfseNationalDpsSerie: serie } as Record<string, unknown>;
  if (nextNumber) {
    if (!/^\d+$/.test(nextNumber) || Number(nextNumber) < 1) throw new Error("Numero inicial invalido.");
    settings.nfseNationalNextDpsNumber = Number(nextNumber);
  }
  const { data: updated, error: updateError } = await supabase.from("fiscal_service_configs").update({ settings }).eq("id", current.id).select("id,settings,updated_at").single();
  if (updateError) throw updateError;
  console.log(JSON.stringify({ changed: true, cnpj, ambiente, previousSeries: (current.settings as Record<string, unknown>).nfseNationalDpsSerie ?? null, newSeries: updated.settings.nfseNationalDpsSerie, previousNextNumber: (current.settings as Record<string, unknown>).nfseNationalNextDpsNumber ?? null, nextNumber: updated.settings.nfseNationalNextDpsNumber ?? null, updatedAt: updated.updated_at }, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
