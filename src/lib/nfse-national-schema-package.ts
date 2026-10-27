import { resolve } from "node:path";
import type { Environment } from "../types.js";

export const NFSE_NATIONAL_SCHEMA_PACKAGE = {
  id: "nacional-prodrest-v1.01-20261020",
  layoutVersion: "1.01",
  sourceUrl:
    "https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita/esquemas_prod_restrita_20261020.zip",
  files: [
    "DPS_v1.01.xsd",
    "tiposComplexos_v1.01.xsd",
    "tiposSimples_v1.01.xsd",
    "xmldsig-core-schema.xsd"
  ]
} as const;

export const NFSE_NATIONAL_PRODUCTION_SCHEMA_PACKAGE = {
  ...NFSE_NATIONAL_SCHEMA_PACKAGE,
  // Conserva o pacote previamente validado em produção; a mudança é de homologação.
  id: "nacional-prodrest-v1.01-20260727",
  sourceUrl: "https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita/documentacao-tecnica-rtc-producao-restrita"
} as const;

export const NFSE_NATIONAL_EVENT_SCHEMA_PACKAGE = {
  id: "nacional-eventos-v1.01-20260209",
  layoutVersion: "1.01",
  sourceUrl:
    "https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/documentacao-atual",
  files: [
    "pedRegEvento_v1.01.xsd",
    "tiposEventos_v1.01.xsd",
    "tiposComplexos_v1.01.xsd",
    "tiposSimples_v1.01.xsd",
    "xmldsig-core-schema.xsd"
  ]
} as const;

export function nfseNationalSchemaPackageDirectory(environment: Environment = "homologacao") {
  const schema = environment === "homologacao"
    ? NFSE_NATIONAL_SCHEMA_PACKAGE
    : NFSE_NATIONAL_PRODUCTION_SCHEMA_PACKAGE;
  return resolve(process.cwd(), "schemas", "nfse", schema.id);
}

export function nfseNationalDpsSchemaPath(environment: Environment = "homologacao") {
  return resolve(nfseNationalSchemaPackageDirectory(environment), "DPS_v1.01.xsd");
}

export function nfseNationalEventSchemaPath() {
  return resolve(
    process.cwd(),
    "schemas",
    "nfse",
    NFSE_NATIONAL_EVENT_SCHEMA_PACKAGE.id,
    "pedRegEvento_v1.01.xsd"
  );
}
