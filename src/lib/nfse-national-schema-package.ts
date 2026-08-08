import { resolve } from "node:path";

export const NFSE_NATIONAL_SCHEMA_PACKAGE = {
  id: "nacional-prodrest-v1.01-20260727",
  layoutVersion: "1.01",
  sourceUrl:
    "https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita/documentacao-tecnica-rtc-producao-restrita",
  files: [
    "DPS_v1.01.xsd",
    "tiposComplexos_v1.01.xsd",
    "tiposSimples_v1.01.xsd",
    "xmldsig-core-schema.xsd"
  ]
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

export function nfseNationalSchemaPackageDirectory() {
  return resolve(process.cwd(), "schemas", "nfse", NFSE_NATIONAL_SCHEMA_PACKAGE.id);
}

export function nfseNationalDpsSchemaPath() {
  return resolve(nfseNationalSchemaPackageDirectory(), "DPS_v1.01.xsd");
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
