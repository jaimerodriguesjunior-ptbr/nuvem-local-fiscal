export type RtcDocumentModel = 55 | 65;

export type RtcClassificationKind = "ibscbs" | "is";

export type RtcIbsCbsValueGroup = "regular" | "monophasic";

export type RtcSelectiveTaxValueGroup = "calculation_optional";

export type RtcClassificationCatalogEntry = {
  kind: RtcClassificationKind;
  cst: string;
  classCode: string;
  models: RtcDocumentModel[];
  valueGroup: RtcIbsCbsValueGroup | RtcSelectiveTaxValueGroup;
  operationScope: string;
  source: string;
  evidenceStatus: "structural_smoke" | "official_catalog";
};

const baseSource =
  "schemas/nfe/official-010c/PL_010c_NT2022_002v1.30/DFeTiposBasicos_v1.00.xsd";

export const rtcClassificationCatalog: RtcClassificationCatalogEntry[] = [
  {
    kind: "ibscbs",
    cst: "000",
    classCode: "000001",
    models: [55, 65],
    valueGroup: "regular",
    operationScope: "homologation_structural_smoke",
    source: `${baseSource}; usado apenas como combinacao estrutural dos testes locais`,
    evidenceStatus: "structural_smoke"
  },
  {
    kind: "is",
    cst: "000",
    classCode: "000001",
    models: [55, 65],
    valueGroup: "calculation_optional",
    operationScope: "homologation_structural_smoke",
    source: `${baseSource}; usado apenas como combinacao estrutural dos testes locais`,
    evidenceStatus: "structural_smoke"
  }
];

export function findRtcClassification(
  kind: RtcClassificationKind,
  cst: string,
  classCode: string
) {
  return rtcClassificationCatalog.find(
    (entry) =>
      entry.kind === kind &&
      entry.cst === cst.trim() &&
      entry.classCode === classCode.trim()
  );
}

export function rtcClassificationCatalogSummary() {
  return {
    total: rtcClassificationCatalog.length,
    officialCatalogEntries: rtcClassificationCatalog.filter(
      (entry) => entry.evidenceStatus === "official_catalog"
    ).length,
    structuralSmokeEntries: rtcClassificationCatalog.filter(
      (entry) => entry.evidenceStatus === "structural_smoke"
    ).length
  };
}
