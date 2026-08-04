import type { ReturnCfopRiskLevel, ReturnCfopRule } from "../types.js";

type JsonObject = Record<string, unknown>;

export type ReturnCfopItemDecision = {
  itemIndex: number;
  sourceCfop: string | null;
  outputCfop: string | null;
  profile: string;
  riskLevel: ReturnCfopRiskLevel;
  fallbackApplied: boolean;
  reason: string;
};

export type ReturnCfopResolution = {
  isReturn: boolean;
  shouldBlock: boolean;
  clientMessage: string | null;
  needsReview: boolean;
  items: ReturnCfopItemDecision[];
};

function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function cfop(value: unknown) {
  const digits = text(value).replace(/\D/g, "");
  return /^\d{4}$/.test(digits) ? digits : "";
}

function bool(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1" || value === "S";
}

function purchasePurpose(value: unknown) {
  const normalized = text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\s/-]+/g, "_");
  const aliases: Record<string, string> = {
    revenda: "resale",
    comercializacao: "resale",
    resale: "resale",
    uso_consumo: "use_consumption",
    uso_e_consumo: "use_consumption",
    use_consumption: "use_consumption",
    ativo: "fixed_asset",
    ativo_imobilizado: "fixed_asset",
    fixed_asset: "fixed_asset"
  };
  return aliases[normalized] ?? normalized;
}

function root(payload: JsonObject) {
  return asObject(payload.infNFe) ?? payload;
}

function returnMetadata(payload: JsonObject) {
  const document = root(payload);
  const metadata = asObject(document.metadados) ?? asObject(payload.metadados) ?? asObject(document.metadata) ?? asObject(payload.metadata);
  return asObject(metadata?.devolucao) ?? asObject(metadata?.return) ?? {};
}

function itemMetadata(metadata: JsonObject, detail: JsonObject, index: number) {
  const product = asObject(detail.prod) ?? {};
  const itemNumber = Number(detail.nItem ?? index + 1);
  const productCode = text(product.cProd ?? product.codigo);
  return asArray(metadata.itens ?? metadata.items)
    .map(asObject)
    .find((item) => {
      if (!item) return false;
      const candidateNumber = Number(item.nItem ?? item.item ?? item.indice);
      const candidateCode = text(item.cProd ?? item.codigo ?? item.productCode);
      return (Number.isFinite(candidateNumber) && candidateNumber === itemNumber) ||
        (productCode && candidateCode && candidateCode === productCode);
    }) ?? {};
}

function destinationScope(
  document: JsonObject,
  issuerUf: string,
  metadata: JsonObject,
  currentCfop: string,
  sourceCfop: string | null
) {
  const destination = asObject(document.dest) ?? asObject(document.destinatario) ?? {};
  const address = asObject(destination.enderDest) ?? asObject(destination.endereco) ?? {};
  const destinationUf = text(address.UF ?? address.uf ?? destination.UF ?? destination.uf ?? metadata.fornecedorUf).toUpperCase();
  if (destinationUf === "EX" || currentCfop.startsWith("7") || sourceCfop?.startsWith("7")) return "exterior" as const;
  if (issuerUf && destinationUf) return issuerUf.toUpperCase() === destinationUf ? "same_state" as const : "interstate" as const;
  if (currentCfop.startsWith("6") || sourceCfop?.startsWith("6")) return "interstate" as const;
  return "same_state" as const;
}

function matchesRule(rule: ReturnCfopRule, sourceCfop: string, metadata: JsonObject) {
  if (!rule.active || (rule.sourceCfop && rule.sourceCfop !== sourceCfop)) return false;
  const conditions = rule.conditions ?? {};
  const requiredPurpose = purchasePurpose(conditions.purchasePurpose);
  const actualPurpose = purchasePurpose(metadata.finalidadeCompra ?? metadata.purchasePurpose ?? metadata.finalidade);
  if (requiredPurpose && actualPurpose && requiredPurpose !== actualPurpose) return false;
  if (conditions.fuel === true && !bool(metadata.combustivel ?? metadata.fuel)) {
    // Os CFOPs de combustivel da biblioteca inicial ja constituem evidencia suficiente.
    if (!["5655", "5656", "6655", "6656"].includes(sourceCfop)) return false;
  }
  return true;
}

function fallbackCfop(scope: "same_state" | "interstate") {
  return scope === "same_state" ? "5202" : "6202";
}

function highRisk(metadata: JsonObject) {
  return ["use_consumption", "fixed_asset"].includes(
    purchasePurpose(metadata.finalidadeCompra ?? metadata.purchasePurpose ?? metadata.finalidade)
  );
}

export function resolveReturnCfop(
  payload: JsonObject,
  issuerUf: string,
  rules: ReturnCfopRule[]
): ReturnCfopResolution {
  const document = root(payload);
  const ide = asObject(document.ide) ?? {};
  if (text(ide.finNFe || "1") !== "4") {
    return { isReturn: false, shouldBlock: false, clientMessage: null, needsReview: false, items: [] };
  }

  const metadata = returnMetadata(payload);
  const details = asArray(document.det ?? document.itens).map(asObject).filter((detail): detail is JsonObject => Boolean(detail));
  const items: ReturnCfopItemDecision[] = details.map((detail, itemIndex): ReturnCfopItemDecision => {
    const product = asObject(detail.prod) ?? detail;
    const currentCfop = cfop(product.CFOP ?? product.cfop);
    const source = { ...metadata, ...itemMetadata(metadata, detail, itemIndex) };
    const sourceCfop = cfop(source.cfopOrigem ?? source.sourceCfop ?? source.CFOP ?? source.cfop) || null;
    const scope = destinationScope(document, issuerUf, metadata, currentCfop, sourceCfop);

    if (scope === "exterior") {
      return {
        itemIndex,
        sourceCfop,
        outputCfop: null,
        profile: "exterior_review_required",
        riskLevel: "high" as const,
        fallbackApplied: false,
        reason: "A devolucao para o exterior exige validacao fiscal especifica."
      };
    }

    if (highRisk(source)) {
      return {
        itemIndex,
        sourceCfop,
        outputCfop: null,
        profile: "review_required",
        riskLevel: "high" as const,
        fallbackApplied: false,
        reason: "A finalidade de compra informada exige confirmacao fiscal especifica."
      };
    }

    const rule = rules.find((candidate) => matchesRule(candidate, sourceCfop ?? "", source));
    if (rule) {
      const outputCfop = scope === "same_state" ? rule.sameStateCfop : rule.interstateCfop;
      if (outputCfop) {
        return {
          itemIndex,
          sourceCfop,
          outputCfop,
          profile: rule.profile,
          riskLevel: rule.riskLevel as ReturnCfopRiskLevel,
          fallbackApplied: false,
          reason: `Regra ${rule.profile} aplicada pela biblioteca de devolucoes.`
        };
      }
    }

    return {
      itemIndex,
      sourceCfop,
      outputCfop: fallbackCfop(scope),
      profile: bool(source.combustivel ?? source.fuel) || ["5655", "5656", "6655", "6656"].includes(sourceCfop ?? "")
        ? "fuel_lubricant_unresolved"
        : bool(source.st ?? source.substituicaoTributaria) || text(source.cest)
          ? "st_unresolved"
          : "standard_fallback",
      riskLevel: "medium",
      fallbackApplied: true,
      reason: "A combinacao fiscal ainda nao possui regra homologada; aplicado CFOP de devolucao padrao para manter a operacao fluida."
    };
  });

  const shouldBlock = items.some((item) => item.riskLevel === "high");
  return {
    isReturn: true,
    shouldBlock,
    clientMessage: shouldBlock
      ? "Esta devolucao requer uma validacao fiscal especifica antes da transmissao. O suporte recebeu os dados da operacao para analise."
      : null,
    needsReview: items.some((item) => item.fallbackApplied || item.riskLevel === "high"),
    items
  };
}

export function applyReturnCfopResolution(payload: JsonObject, resolution: ReturnCfopResolution) {
  const next = structuredClone(payload);
  if (!resolution.isReturn || resolution.shouldBlock) return next;
  const document = root(next);
  const details = asArray(document.det ?? document.itens).map(asObject).filter((detail): detail is JsonObject => Boolean(detail));
  for (const decision of resolution.items) {
    const detail = details[decision.itemIndex];
    const product = detail ? asObject(detail.prod) ?? detail : null;
    if (product && decision.outputCfop) product.CFOP = decision.outputCfop;
  }
  return next;
}
