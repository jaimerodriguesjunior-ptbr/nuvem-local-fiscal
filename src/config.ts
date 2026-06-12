import { existsSync, readFileSync } from "node:fs";

function loadLocalEnvFile(filePath: string) {
  if (!existsSync(filePath)) {
    return;
  }

  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    process.env[key] ??= value;
  }
}

loadLocalEnvFile(".env.local");
loadLocalEnvFile(".env");

const nfeHomologationCsrtId =
  process.env.NFE_CSRT_ID_HOMOLOGATION ??
  process.env.NFE_RESP_TEC_ID_CSRT ??
  "";
const nfeHomologationCsrt =
  process.env.NFE_CSRT_TOKEN_HOMOLOGATION ??
  process.env.NFE_RESP_TEC_CSRT ??
  "";
const nfeProductionCsrtId =
  process.env.NFE_CSRT_ID_PRODUCTION ?? "";
const nfeProductionCsrt =
  process.env.NFE_CSRT_TOKEN_PRODUCTION ?? "";

export const config = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? "0.0.0.0",
  env: process.env.APP_ENV ?? "development",
  jwtSecret: process.env.JWT_SECRET ?? "change-me",
  certificateEncryptionKey:
    process.env.CERTIFICATE_ENCRYPTION_KEY ??
    process.env.JWT_SECRET ??
    "change-me",
  defaultClientId: process.env.API_CLIENT_DEFAULT_ID ?? "local-client",
  defaultClientSecret: process.env.API_CLIENT_DEFAULT_SECRET ?? "local-secret",
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD ?? "admin",
  stateFile: process.env.STATE_FILE ?? "./storage/mock-state.json",
  supabaseUrl: process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  nfeResponsibleTechnicalCnpj: process.env.NFE_RT_CNPJ ?? "",
  nfeResponsibleTechnicalContact: process.env.NFE_RT_CONTATO ?? "",
  nfeResponsibleTechnicalEmail: process.env.NFE_RT_EMAIL ?? "",
  nfeResponsibleTechnicalPhone: process.env.NFE_RT_FONE ?? "",
  nfeResponsibleTechnicalCsrtId: nfeHomologationCsrtId,
  nfeResponsibleTechnicalCsrt: nfeHomologationCsrt,
  nfeResponsibleTechnicalCsrtIdHomologation: nfeHomologationCsrtId,
  nfeResponsibleTechnicalCsrtHomologation: nfeHomologationCsrt,
  nfeResponsibleTechnicalCsrtIdProduction: nfeProductionCsrtId,
  nfeResponsibleTechnicalCsrtProduction: nfeProductionCsrt,
  autoTransmitHomologation:
    (process.env.AUTO_TRANSMIT_HOMOLOGATION ?? "true").toLowerCase() === "true"
};

export function validateServerConfig() {
  if (config.env !== "production") {
    return;
  }

  const missing: string[] = [];
  const insecure: string[] = [];
  if (!config.supabaseUrl) missing.push("SUPABASE_URL");
  if (!config.supabaseServiceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!process.env.JWT_SECRET) missing.push("JWT_SECRET");
  if (!process.env.CERTIFICATE_ENCRYPTION_KEY) {
    missing.push("CERTIFICATE_ENCRYPTION_KEY");
  }
  if (!process.env.API_CLIENT_DEFAULT_ID) missing.push("API_CLIENT_DEFAULT_ID");
  if (!process.env.API_CLIENT_DEFAULT_SECRET) {
    missing.push("API_CLIENT_DEFAULT_SECRET");
  }
  if (!process.env.ADMIN_USERNAME) missing.push("ADMIN_USERNAME");
  if (!process.env.ADMIN_PASSWORD) missing.push("ADMIN_PASSWORD");

  if (config.jwtSecret === "change-me") insecure.push("JWT_SECRET");
  if (config.certificateEncryptionKey === "change-me-too") {
    insecure.push("CERTIFICATE_ENCRYPTION_KEY");
  }
  if (config.defaultClientSecret === "local-secret") {
    insecure.push("API_CLIENT_DEFAULT_SECRET");
  }
  if (config.adminPassword === "admin") insecure.push("ADMIN_PASSWORD");

  if (missing.length || insecure.length) {
    const details = [
      missing.length ? `ausentes: ${missing.join(", ")}` : "",
      insecure.length ? `inseguras: ${insecure.join(", ")}` : ""
    ].filter(Boolean);
    throw new Error(
      `Configuracao recusada para APP_ENV=production (${details.join("; ")}).`
    );
  }
}
