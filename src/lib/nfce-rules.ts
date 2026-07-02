import type { Environment } from "../types.js";

type JsonObject = Record<string, unknown>;

export type NfceValidationIssue = {
  code: string;
  message: string;
  path: string;
};

export type NfceValidationResult = {
  ok: boolean;
  issues: NfceValidationIssue[];
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

function onlyDigits(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function hasText(value: unknown) {
  return text(value).length > 0;
}

function hasNumberLike(value: unknown) {
  const normalized = String(value ?? "").replace(",", ".").trim();
  return normalized !== "" && Number.isFinite(Number(normalized));
}

function pushIssue(
  issues: NfceValidationIssue[],
  code: string,
  path: string,
  message: string
) {
  issues.push({ code, path, message });
}

function rootInfNFe(payload: JsonObject) {
  return asObject(payload.infNFe) ?? payload;
}

export function validateNfceEmissionPayload(
  payload: JsonObject,
  options: {
    expectedEnvironment?: Environment;
    expectedIssuerCnpj?: string;
  } = {}
): NfceValidationResult {
  const issues: NfceValidationIssue[] = [];
  const infNFe = rootInfNFe(payload);
  const ide = asObject(infNFe.ide);
  const emit = asObject(infNFe.emit) ?? asObject(infNFe.emitente);
  const total = asObject(infNFe.total);
  const icmsTotal = asObject(total?.ICMSTot);
  const payment = asObject(infNFe.pag);
  const paymentDetails = asArray(payment?.detPag);
  const details = asArray(infNFe.det);

  if (!ide) {
    pushIssue(issues, "missing_ide", "infNFe.ide", "Informe o grupo ide da NFC-e.");
  } else {
    if (String(ide.mod ?? "") !== "65") {
      pushIssue(issues, "invalid_model", "infNFe.ide.mod", "NFC-e deve usar modelo 65.");
    }

    const tpAmb = String(ide.tpAmb ?? "");
    const expectedTpAmb = options.expectedEnvironment === "producao" ? "1" : "2";
    if (tpAmb !== expectedTpAmb) {
      pushIssue(
        issues,
        "environment_mismatch",
        "infNFe.ide.tpAmb",
        `tpAmb deve ser ${expectedTpAmb} para o ambiente informado.`
      );
    }

    const tpEmis = String(ide.tpEmis ?? "1");
    if (tpEmis === "9") {
      pushIssue(
        issues,
        "offline_contingency_not_supported",
        "infNFe.ide.tpEmis",
        "NFC-e em contingencia offline (tpEmis=9) ainda nao esta habilitada."
      );
    } else if (!["1", "3", "4"].includes(tpEmis)) {
      pushIssue(
        issues,
        "unsupported_emission_type",
        "infNFe.ide.tpEmis",
        `Tipo de emissao ${tpEmis || "(vazio)"} nao suportado para NFC-e online.`
      );
    }

    if (String(ide.tpImp ?? "") !== "4") {
      pushIssue(
        issues,
        "invalid_print_type",
        "infNFe.ide.tpImp",
        "NFC-e deve usar tpImp=4 no layout de DANFE NFC-e."
      );
    }
  }

  if (!emit) {
    pushIssue(issues, "missing_emit", "infNFe.emit", "Informe o grupo emit da NFC-e.");
  } else {
    const emitCnpj = onlyDigits(emit.CNPJ ?? emit.cnpj);
    if (emitCnpj.length !== 14) {
      pushIssue(issues, "missing_emit_cnpj", "infNFe.emit.CNPJ", "Informe CNPJ do emitente.");
    }
    const expectedIssuerCnpj = onlyDigits(options.expectedIssuerCnpj);
    if (expectedIssuerCnpj && emitCnpj && emitCnpj !== expectedIssuerCnpj) {
      pushIssue(
        issues,
        "issuer_cnpj_mismatch",
        "infNFe.emit.CNPJ",
        "CNPJ do emitente no XML difere do CNPJ usado na emissao."
      );
    }
    if (!hasText(emit.IE)) {
      pushIssue(issues, "missing_state_registration", "infNFe.emit.IE", "Informe IE do emitente.");
    }
    if (!hasText(emit.CRT)) {
      pushIssue(issues, "missing_tax_regime", "infNFe.emit.CRT", "Informe CRT do emitente.");
    }
  }

  if (details.length === 0) {
    pushIssue(issues, "missing_items", "infNFe.det", "Informe ao menos um item na NFC-e.");
  }
  details.forEach((detail, index) => {
    const item = asObject(detail);
    const product = asObject(item?.prod);
    const taxes = asObject(item?.imposto);
    const path = `infNFe.det[${index}]`;
    if (!product) {
      pushIssue(issues, "missing_product", `${path}.prod`, "Informe o produto do item.");
      return;
    }

    for (const key of ["cProd", "xProd", "NCM", "CFOP", "uCom", "cEANTrib", "uTrib"]) {
      if (!hasText(product[key])) {
        pushIssue(
          issues,
          "missing_product_field",
          `${path}.prod.${key}`,
          `Informe ${key} do item.`
        );
      }
    }
    for (const key of ["qCom", "vUnCom", "vProd", "qTrib", "vUnTrib"]) {
      if (!hasNumberLike(product[key])) {
        pushIssue(
          issues,
          "missing_product_value",
          `${path}.prod.${key}`,
          `Informe ${key} numerico do item.`
        );
      }
    }
    if (!["0", "1"].includes(String(product.indTot ?? ""))) {
      pushIssue(
        issues,
        "missing_total_indicator",
        `${path}.prod.indTot`,
        "Informe indTot do item como 0 ou 1."
      );
    }
    if (!taxes || !asObject(taxes.ICMS) || !asObject(taxes.PIS) || !asObject(taxes.COFINS)) {
      pushIssue(
        issues,
        "missing_item_taxes",
        `${path}.imposto`,
        "Informe grupos ICMS, PIS e COFINS do item."
      );
    }
  });

  if (!icmsTotal) {
    pushIssue(issues, "missing_totals", "infNFe.total.ICMSTot", "Informe totais ICMSTot.");
  } else if (!hasNumberLike(icmsTotal.vNF)) {
    pushIssue(issues, "missing_invoice_total", "infNFe.total.ICMSTot.vNF", "Informe vNF numerico.");
  }

  if (paymentDetails.length === 0) {
    pushIssue(issues, "missing_payment", "infNFe.pag.detPag", "Informe ao menos uma forma de pagamento.");
  }
  paymentDetails.forEach((detail, index) => {
    const item = asObject(detail);
    const path = `infNFe.pag.detPag[${index}]`;
    if (!item || !hasText(item.tPag)) {
      pushIssue(issues, "missing_payment_type", `${path}.tPag`, "Informe tPag.");
    }
    if (!item || !hasNumberLike(item.vPag)) {
      pushIssue(issues, "missing_payment_value", `${path}.vPag`, "Informe vPag numerico.");
    }
  });

  return { ok: issues.length === 0, issues };
}

export function assertValidNfceEmissionPayload(
  payload: JsonObject,
  options: {
    expectedEnvironment?: Environment;
    expectedIssuerCnpj?: string;
  } = {}
) {
  const result = validateNfceEmissionPayload(payload, options);
  if (!result.ok) {
    const error = new Error(
      `Payload NFC-e invalido: ${result.issues.map((issue) => issue.message).join(" ")}`
    );
    Object.assign(error, { issues: result.issues });
    throw error;
  }
}
