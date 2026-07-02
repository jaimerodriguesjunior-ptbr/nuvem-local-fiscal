import { officialRtcIbsCbsClassifications20260702 } from "./rtc-classifications-2026-07-02.js";

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

const officialIbsCbsSource =
  "SVRS/CFF Classificacao Tributaria exportada em 2026-07-02; arquivo classificacoes-tributarias-02-07-2026_17-44-56.json";

function ibsCbsValueGroup(cst: string): RtcIbsCbsValueGroup {
  return cst === "620" ? "monophasic" : "regular";
}

const officialIbsCbsCatalog = officialRtcIbsCbsClassifications20260702.map(
  (entry): RtcClassificationCatalogEntry => {
    const cst = entry.code.slice(0, 3);
    return {
      kind: "ibscbs",
      cst,
      classCode: entry.code,
      models: entry.models,
      valueGroup: ibsCbsValueGroup(cst),
      operationScope: "official_ibscbs_classification_catalog",
      source: officialIbsCbsSource,
      evidenceStatus: "official_catalog"
    };
  }
);

const structuralSmokeCatalog: RtcClassificationCatalogEntry[] = [
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

export const rtcClassificationCatalog: RtcClassificationCatalogEntry[] = [
  ...officialIbsCbsCatalog,
  ...structuralSmokeCatalog.filter(
    (entry) =>
      entry.kind !== "ibscbs" ||
      !officialIbsCbsCatalog.some(
        (officialEntry) =>
          officialEntry.cst === entry.cst &&
          officialEntry.classCode === entry.classCode
      )
  )
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
