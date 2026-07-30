import { validateDocumentReferences } from "./document-reference-rules.js";
import { validateRtcPayload } from "./rtc-rules.js";

type JsonObject = Record<string, unknown>;

export type NfeValidationIssue = {
  code: string;
  message: string;
  path: string;
};

export type NfeValidationResult = {
  ok: boolean;
  issues: NfeValidationIssue[];
};

function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function rootInfNFe(payload: JsonObject) {
  return asObject(payload.infNFe) ?? payload;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

const nfeMvpSaleCfops = new Set([
  "5101",
  "5102",
  "6101",
  "6102",
  "5915",
  "5949",
  "6915",
  "6949"
]);
const nfeMvpReturnCfops = new Set([
  "5202",
  "6202",
  // Devolucao de compra de combustivel/lubrificante para comercializacao.
  "5661",
  "6661"
]);

function nfeMvpFinalityAllowed(value: unknown) {
  const finality = text(value || "1");
  return finality === "1" || finality === "4";
}

function nfeMvpCfopAllowed(finality: string, cfop: string) {
  if (finality === "1") return nfeMvpSaleCfops.has(cfop);
  if (finality === "4") return nfeMvpReturnCfops.has(cfop);
  return false;
}

function pushIssue(
  issues: NfeValidationIssue[],
  code: string,
  path: string,
  message: string
) {
  issues.push({ code, path, message });
}

export function validateNfeEmissionPayload(payload: JsonObject): NfeValidationResult {
  const issues: NfeValidationIssue[] = [];
  const rtcValidation = validateRtcPayload(payload, { expectedModel: 55 });
  issues.push(...rtcValidation.issues);
  const referenceValidation = validateDocumentReferences(payload);
  issues.push(...referenceValidation.issues);

  const infNFe = rootInfNFe(payload);
  const ide = asObject(infNFe.ide);
  if (!ide) {
    return { ok: issues.length === 0, issues };
  }

  const model = text(ide.mod);
  if (model && model !== "55") {
    pushIssue(
      issues,
      "invalid_model",
      "infNFe.ide.mod",
      "NF-e deve usar modelo 55 no endpoint /nfe."
    );
  }

  const printType = text(ide.tpImp);
  if (printType && printType !== "1") {
    pushIssue(
      issues,
      "unsupported_nfe_danfe_print_type",
      "infNFe.ide.tpImp",
      "DANFE NF-e local esta validado apenas para tpImp=1 (A4 retrato); outros formatos exigem decisao e layout proprios."
    );
  }

  if (!nfeMvpFinalityAllowed(ide.finNFe)) {
    pushIssue(
      issues,
      "unsupported_mvp_nfe_finality",
      "infNFe.ide.finNFe",
      "MVP fiscal aceita NF-e de venda normal ou devolucao; outras finalidades exigem suporte tecnico e homologacao propria."
    );
  }

  const finality = text(ide.finNFe || "1");
  const details = asArray(infNFe.det);
  details.forEach((detail, index) => {
    const item = asObject(detail);
    const product = asObject(item?.prod);
    const cfop = text(product?.CFOP);
    if (!cfop || !nfeMvpFinalityAllowed(finality) || nfeMvpCfopAllowed(finality, cfop)) {
      return;
    }

    pushIssue(
      issues,
      "unsupported_mvp_nfe_cfop",
      `infNFe.det[${index}].prod.CFOP`,
      `MVP fiscal aceita NF-e somente para venda/devolucao ja homologadas; CFOP ${cfop} exige suporte tecnico e homologacao propria.`
    );
  });

  return { ok: issues.length === 0, issues };
}

export function assertValidNfeEmissionPayload(payload: JsonObject) {
  const result = validateNfeEmissionPayload(payload);
  if (!result.ok) {
    const error = new Error(
      `Payload NF-e invalido: ${result.issues.map((issue) => issue.message).join(" ")}`
    );
    Object.assign(error, { issues: result.issues });
    throw error;
  }
}
