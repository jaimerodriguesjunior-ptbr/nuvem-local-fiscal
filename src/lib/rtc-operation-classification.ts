type JsonObject = Record<string, unknown>;

export type RtcOperationClassificationExpectation = {
  cst: string;
  classCode: string;
  profile: "standard_taxable_goods_sale";
  reason: string;
};

const standardTaxableGoodsSaleCfops = new Set(["5101", "5102", "6101", "6102"]);

function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

export function expectedRtcClassificationForItem(
  infNFe: JsonObject,
  detail: JsonObject
): RtcOperationClassificationExpectation | null {
  const ide = asObject(infNFe.ide);
  const model = text(ide?.mod);
  const finality = text(ide?.finNFe || "1");
  const product = asObject(detail.prod);
  const cfop = text(product?.CFOP);

  if (!["55", "65"].includes(model)) return null;
  if (finality !== "1") return null;
  if (!standardTaxableGoodsSaleCfops.has(cfop)) return null;

  return {
    cst: "000",
    classCode: "000001",
    profile: "standard_taxable_goods_sale",
    reason:
      "Venda comum de mercadoria tributada integralmente, identificada por finNFe=1 e CFOP de venda."
  };
}
