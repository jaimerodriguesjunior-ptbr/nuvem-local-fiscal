import { resolve } from "node:path";

export const NFE_SCHEMA_PACKAGE = {
  id: "PL_010c_NT2022_002v1.30",
  shortName: "PL_010c",
  sourceUrl: "https://dfe-portal.svrs.rs.gov.br/Nfe/Documentos",
  downloadedAt: "2026-07-02",
  svrsListedAt: "2026-03-20",
  files: {
    "DFeTiposBasicos_v1.00.xsd":
      "C1C1F700DE03DA50C82F3FBF23DB7E98929B5D1EE1BDEDB4D546E33EFA498EE6",
    "leiauteNFe_v4.00.xsd":
      "7D8AF488538FE78809088F9C494CB7521AE856982210FD13A25496CCF429C8C1",
    "nfe_v4.00.xsd":
      "66A117AAA78687FDB1355FC32A380EC859F3A98E850D7C4DE5A07935EB1A6030",
    "tiposBasico_v4.00.xsd":
      "63D393D69FB63568E39277D9794348FBE107E1C15D2DBCE32FB63B6E41472C6D",
    "xmldsig-core-schema_v1.01.xsd":
      "F56744A5F51C03F027DE13F39F869307091781A9EF1D91B1EBE14719CE28E1AC"
  }
} as const;

export function nfeSchemaPackageDirectory() {
  return resolve(
    process.cwd(),
    "schemas",
    "nfe",
    "official-010c",
    NFE_SCHEMA_PACKAGE.id
  );
}

export function nfeSchemaPath(fileName: keyof typeof NFE_SCHEMA_PACKAGE.files) {
  return resolve(nfeSchemaPackageDirectory(), fileName);
}
