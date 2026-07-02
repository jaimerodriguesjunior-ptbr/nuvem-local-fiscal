import {
  findRtcClassification,
  type RtcClassificationCatalogEntry
} from "./rtc-classification-catalog.js";
import { expectedRtcClassificationForItem } from "./rtc-operation-classification.js";

type JsonObject = Record<string, unknown>;

export type RtcValidationIssue = {
  code: string;
  message: string;
  path: string;
};

export type RtcValidationResult = {
  ok: boolean;
  issues: RtcValidationIssue[];
};

export type RtcValidationOptions = {
  expectedModel?: 55 | 65;
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

function text(value: unknown) {
  return String(value ?? "").trim();
}

function hasText(value: unknown) {
  return text(value).length > 0;
}

function hasCodeLength(value: unknown, length: number) {
  return new RegExp(`^\\d{${length}}$`).test(text(value));
}

function hasNumberLike(value: unknown) {
  const normalized = String(value ?? "").replace(",", ".").trim();
  return normalized !== "" && Number.isFinite(Number(normalized));
}

function hasAnyText(...values: unknown[]) {
  return values.some((value) => hasText(value));
}

function isModel(value: unknown, model: 55 | 65) {
  return String(value ?? "") === String(model);
}

function catalogAllowsModel(
  entry: RtcClassificationCatalogEntry,
  model: number
) {
  return entry.models.some((allowedModel) => allowedModel === model);
}

function pushIssue(
  issues: RtcValidationIssue[],
  code: string,
  path: string,
  message: string
) {
  issues.push({ code, path, message });
}

function rootInfNFe(payload: JsonObject) {
  return asObject(payload.infNFe) ?? payload;
}

export function validateRtcPayload(
  payload: JsonObject,
  options: RtcValidationOptions = {}
): RtcValidationResult {
  const issues: RtcValidationIssue[] = [];
  const infNFe = rootInfNFe(payload);
  const ide = asObject(infNFe.ide);
  const total = asObject(infNFe.total);
  const details = asArray(infNFe.det);

  const itemsWithRtc = details
    .map((detail, index) => ({
      index,
      detail: asObject(detail),
      tax: asObject(asObject(detail)?.imposto),
      rtc: asObject(asObject(asObject(detail)?.imposto)?.IBSCBS)
    }))
    .filter((item) => item.rtc);

  const itemsWithSelectiveTax = details
    .map((detail, index) => ({
      index,
      tax: asObject(asObject(detail)?.imposto),
      selectiveTax: asObject(asObject(asObject(detail)?.imposto)?.IS)
    }))
    .filter((item) => item.selectiveTax);

  if (itemsWithRtc.length === 0 && itemsWithSelectiveTax.length === 0) {
    return { ok: true, issues };
  }

  const model = Number(ide?.mod);
  const isNfce = model === 65;
  if (options.expectedModel && !isModel(ide?.mod, options.expectedModel)) {
    pushIssue(
      issues,
      "rtc_model_mismatch",
      "infNFe.ide.mod",
      `Tributacao IBS/CBS neste endpoint exige modelo ${options.expectedModel}.`
    );
  }
  if (![55, 65].includes(model)) {
    pushIssue(
      issues,
      "unsupported_rtc_model",
      "infNFe.ide.mod",
      "Tributacao IBS/CBS so esta validada para NF-e modelo 55 e NFC-e modelo 65."
    );
  }
  if (itemsWithRtc.length > 0) {
    if (isNfce && hasText(ide?.cMunFGIBS)) {
      pushIssue(
        issues,
        "unexpected_rtc_municipality",
        "infNFe.ide.cMunFGIBS",
        "Nao informe cMunFGIBS em NFC-e com tributacao IBS/CBS."
      );
    } else if (isNfce && String(ide?.idDest ?? "1") !== "1") {
      pushIssue(
        issues,
        "rtc_nfce_not_internal",
        "infNFe.ide.idDest",
        "NFC-e com IBS/CBS so esta validada para operacao interna; para UF diferente use NF-e."
      );
    } else if (!isNfce && (!ide || !hasText(ide.cMunFGIBS))) {
      pushIssue(
        issues,
        "missing_rtc_municipality",
        "infNFe.ide.cMunFGIBS",
        "Informe cMunFGIBS quando enviar tributacao IBS/CBS em NF-e."
      );
    }

    const ibsCbsTotal = asObject(total?.IBSCBSTot);
    if (!ibsCbsTotal) {
      pushIssue(
        issues,
        "missing_rtc_totals",
        "infNFe.total.IBSCBSTot",
        "Informe IBSCBSTot quando enviar tributacao IBS/CBS nos itens."
      );
    } else if (!hasNumberLike(ibsCbsTotal.vBCIBSCBS)) {
      pushIssue(
        issues,
        "missing_rtc_total_base",
        "infNFe.total.IBSCBSTot.vBCIBSCBS",
        "Informe vBCIBSCBS numerico no total IBS/CBS."
      );
    }
  }

  for (const item of itemsWithRtc) {
    const path = `infNFe.det[${item.index}].imposto.IBSCBS`;
    const rtc = item.rtc as JsonObject;
    if (!hasCodeLength(rtc.CST, 3)) {
      pushIssue(
        issues,
        "invalid_rtc_cst",
        `${path}.CST`,
        "Informe CST IBS/CBS com 3 digitos."
      );
    }
    if (!hasCodeLength(rtc.cClassTrib, 6)) {
      pushIssue(
        issues,
        "invalid_rtc_classification",
        `${path}.cClassTrib`,
        "Informe cClassTrib IBS/CBS com 6 digitos."
      );
    }

    const classification =
      hasCodeLength(rtc.CST, 3) && hasCodeLength(rtc.cClassTrib, 6)
        ? findRtcClassification("ibscbs", text(rtc.CST), text(rtc.cClassTrib))
        : undefined;
    if (!classification && hasCodeLength(rtc.CST, 3) && hasCodeLength(rtc.cClassTrib, 6)) {
      pushIssue(
        issues,
        "unknown_rtc_classification",
        `${path}.cClassTrib`,
        "Par CST/cClassTrib IBS/CBS nao consta no catalogo RTC local versionado."
      );
    } else if (classification && !catalogAllowsModel(classification, model)) {
      pushIssue(
        issues,
        "rtc_classification_model_not_allowed",
        `${path}.cClassTrib`,
        "Par CST/cClassTrib IBS/CBS nao esta liberado para este modelo de documento."
      );
    }
    const operationExpectation =
      classification && item.detail
        ? expectedRtcClassificationForItem(infNFe, item.detail)
        : null;
    if (
      operationExpectation &&
      (text(rtc.CST) !== operationExpectation.cst ||
        text(rtc.cClassTrib) !== operationExpectation.classCode)
    ) {
      pushIssue(
        issues,
        "rtc_operation_classification_mismatch",
        `${path}.cClassTrib`,
        `Operacao ${operationExpectation.profile} exige CST ${operationExpectation.cst} e cClassTrib ${operationExpectation.classCode}.`
      );
    }

    const gIBSCBS = asObject(rtc.gIBSCBS);
    const gIBSCBSMono = asObject(rtc.gIBSCBSMono);
    if (!gIBSCBS && !gIBSCBSMono) {
      pushIssue(
        issues,
        "missing_rtc_values",
        path,
        "Informe gIBSCBS ou gIBSCBSMono no grupo IBS/CBS do item."
      );
    }
    if (gIBSCBS && classification && classification.valueGroup !== "regular") {
      pushIssue(
        issues,
        "rtc_value_group_mismatch",
        `${path}.gIBSCBS`,
        "Grupo gIBSCBS nao e compativel com o par CST/cClassTrib informado."
      );
    }
    if (gIBSCBSMono && classification && classification.valueGroup !== "monophasic") {
      pushIssue(
        issues,
        "rtc_value_group_mismatch",
        `${path}.gIBSCBSMono`,
        "Grupo gIBSCBSMono nao e compativel com o par CST/cClassTrib informado."
      );
    }
    if (gIBSCBS && !hasNumberLike(gIBSCBS.vBC)) {
      pushIssue(
        issues,
        "missing_rtc_item_base",
        `${path}.gIBSCBS.vBC`,
        "Informe vBC numerico no grupo IBS/CBS do item."
      );
    }
    if (gIBSCBS) {
      const gIBSUF = asObject(gIBSCBS.gIBSUF);
      const gIBSMun = asObject(gIBSCBS.gIBSMun);
      const gCBS = asObject(gIBSCBS.gCBS);
      if (
        !gIBSUF ||
        !hasNumberLike(gIBSUF.pIBSUF) ||
        !hasNumberLike(gIBSUF.vIBSUF)
      ) {
        pushIssue(
          issues,
          "missing_rtc_ibs_uf",
          `${path}.gIBSCBS.gIBSUF`,
          "Informe pIBSUF e vIBSUF numericos no grupo IBS/CBS do item."
        );
      }
      if (
        !gIBSMun ||
        !hasNumberLike(gIBSMun.pIBSMun) ||
        !hasNumberLike(gIBSMun.vIBSMun)
      ) {
        pushIssue(
          issues,
          "missing_rtc_ibs_municipality",
          `${path}.gIBSCBS.gIBSMun`,
          "Informe pIBSMun e vIBSMun numericos no grupo IBS/CBS do item."
        );
      }
      if (!hasNumberLike(gIBSCBS.vIBS)) {
        pushIssue(
          issues,
          "missing_rtc_ibs_value",
          `${path}.gIBSCBS.vIBS`,
          "Informe vIBS numerico no grupo IBS/CBS do item."
        );
      }
      if (!gCBS || !hasNumberLike(gCBS.pCBS) || !hasNumberLike(gCBS.vCBS)) {
        pushIssue(
          issues,
          "missing_rtc_cbs",
          `${path}.gIBSCBS.gCBS`,
          "Informe pCBS e vCBS numericos no grupo IBS/CBS do item."
        );
      }
    }
  }

  const selectiveTaxTotal = asObject(total?.ISTot);
  if (itemsWithSelectiveTax.length > 0) {
    if (!selectiveTaxTotal) {
      pushIssue(
        issues,
        "missing_selective_tax_totals",
        "infNFe.total.ISTot",
        "Informe ISTot quando enviar Imposto Seletivo nos itens."
      );
    } else if (!hasNumberLike(selectiveTaxTotal.vIS)) {
      pushIssue(
        issues,
        "missing_selective_tax_total_value",
        "infNFe.total.ISTot.vIS",
        "Informe vIS numerico no total do Imposto Seletivo."
      );
    }
  }

  for (const item of itemsWithSelectiveTax) {
    const path = `infNFe.det[${item.index}].imposto.IS`;
    const selectiveTax = item.selectiveTax as JsonObject;
    if (!hasCodeLength(selectiveTax.CSTIS, 3)) {
      pushIssue(
        issues,
        "invalid_selective_tax_cst",
        `${path}.CSTIS`,
        "Informe CSTIS do Imposto Seletivo com 3 digitos."
      );
    }
    if (!hasCodeLength(selectiveTax.cClassTribIS, 6)) {
      pushIssue(
        issues,
        "invalid_selective_tax_classification",
        `${path}.cClassTribIS`,
        "Informe cClassTribIS do Imposto Seletivo com 6 digitos."
      );
    }
    const classification =
      hasCodeLength(selectiveTax.CSTIS, 3) &&
      hasCodeLength(selectiveTax.cClassTribIS, 6)
        ? findRtcClassification(
            "is",
            text(selectiveTax.CSTIS),
            text(selectiveTax.cClassTribIS)
          )
        : undefined;
    if (
      !classification &&
      hasCodeLength(selectiveTax.CSTIS, 3) &&
      hasCodeLength(selectiveTax.cClassTribIS, 6)
    ) {
      pushIssue(
        issues,
        "unknown_selective_tax_classification",
        `${path}.cClassTribIS`,
        "Par CSTIS/cClassTribIS nao consta no catalogo RTC local versionado."
      );
    } else if (classification && !catalogAllowsModel(classification, model)) {
      pushIssue(
        issues,
        "selective_tax_classification_model_not_allowed",
        `${path}.cClassTribIS`,
        "Par CSTIS/cClassTribIS nao esta liberado para este modelo de documento."
      );
    }

    const hasCalculation = hasAnyText(
      selectiveTax.vBCIS,
      selectiveTax.pIS,
      selectiveTax.pISEspec,
      selectiveTax.uTrib,
      selectiveTax.qTrib,
      selectiveTax.vIS
    );
    if (hasCalculation) {
      if (!hasNumberLike(selectiveTax.vBCIS)) {
        pushIssue(
          issues,
          "missing_selective_tax_base",
          `${path}.vBCIS`,
          "Informe vBCIS numerico quando enviar calculo do Imposto Seletivo."
        );
      }
      if (!hasNumberLike(selectiveTax.pIS)) {
        pushIssue(
          issues,
          "missing_selective_tax_rate",
          `${path}.pIS`,
          "Informe pIS numerico quando enviar calculo do Imposto Seletivo."
        );
      }
      if (!hasNumberLike(selectiveTax.vIS)) {
        pushIssue(
          issues,
          "missing_selective_tax_value",
          `${path}.vIS`,
          "Informe vIS numerico quando enviar calculo do Imposto Seletivo."
        );
      }
      if (hasAnyText(selectiveTax.uTrib, selectiveTax.qTrib)) {
        if (!hasText(selectiveTax.uTrib)) {
          pushIssue(
            issues,
            "missing_selective_tax_unit",
            `${path}.uTrib`,
            "Informe uTrib quando enviar qTrib do Imposto Seletivo."
          );
        }
        if (!hasNumberLike(selectiveTax.qTrib)) {
          pushIssue(
            issues,
            "missing_selective_tax_quantity",
            `${path}.qTrib`,
            "Informe qTrib numerico quando enviar uTrib do Imposto Seletivo."
          );
        }
      }
    } else if (selectiveTaxTotal) {
      pushIssue(
        issues,
        "missing_selective_tax_values",
        path,
        "Informe valores do Imposto Seletivo no item quando enviar ISTot."
      );
    }
  }

  return { ok: issues.length === 0, issues };
}

export function assertValidRtcPayload(
  payload: JsonObject,
  options: RtcValidationOptions = {}
) {
  const result = validateRtcPayload(payload, options);
  if (!result.ok) {
    const error = new Error(
      `Payload RTC invalido: ${result.issues.map((issue) => issue.message).join(" ")}`
    );
    Object.assign(error, { issues: result.issues });
    throw error;
  }
}
