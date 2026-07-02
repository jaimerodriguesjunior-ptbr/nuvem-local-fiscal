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

function isModel(value: unknown, model: 55 | 65) {
  return String(value ?? "") === String(model);
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
      tax: asObject(asObject(detail)?.imposto),
      rtc: asObject(asObject(asObject(detail)?.imposto)?.IBSCBS)
    }))
    .filter((item) => item.rtc);

  if (itemsWithRtc.length === 0) {
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
    if (gIBSCBS && !hasNumberLike(gIBSCBS.vBC)) {
      pushIssue(
        issues,
        "missing_rtc_item_base",
        `${path}.gIBSCBS.vBC`,
        "Informe vBC numerico no grupo IBS/CBS do item."
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
