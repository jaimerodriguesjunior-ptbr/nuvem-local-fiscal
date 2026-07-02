type JsonObject = Record<string, unknown>;

export type DocumentReferenceValidationIssue = {
  code: string;
  message: string;
  path: string;
};

export type DocumentReferenceValidationResult = {
  ok: boolean;
  issues: DocumentReferenceValidationIssue[];
};

const REFERENCED_FINALITIES = new Set(["2", "3", "4", "5", "6"]);
const REFERENCE_KEYS = ["refNFe", "refNFeSig", "refNF", "refNFP", "refCTe", "refECF"];

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

function hasDigits(value: unknown, min: number, max = min) {
  const valueText = text(value);
  return new RegExp(`^\\d{${min},${max}}$`).test(valueText);
}

function hasAccessKey(value: unknown) {
  return /^\d{44}$/.test(text(value));
}

function rootInfNFe(payload: JsonObject) {
  return asObject(payload.infNFe) ?? payload;
}

function pushIssue(
  issues: DocumentReferenceValidationIssue[],
  code: string,
  path: string,
  message: string
) {
  issues.push({ code, path, message });
}

function validateLegacyReference(
  issues: DocumentReferenceValidationIssue[],
  value: unknown,
  path: string
) {
  const ref = asObject(value);
  if (!ref) {
    pushIssue(issues, "invalid_legacy_reference", path, "Informe refNF como objeto.");
    return;
  }
  if (!hasDigits(ref.cUF, 2)) {
    pushIssue(issues, "invalid_legacy_reference", `${path}.cUF`, "Informe cUF com 2 digitos.");
  }
  if (!hasDigits(ref.AAMM, 4)) {
    pushIssue(issues, "invalid_legacy_reference", `${path}.AAMM`, "Informe AAMM com 4 digitos.");
  }
  if (!hasDigits(ref.CNPJ, 14)) {
    pushIssue(issues, "invalid_legacy_reference", `${path}.CNPJ`, "Informe CNPJ com 14 digitos.");
  }
  if (!["01", "02"].includes(text(ref.mod))) {
    pushIssue(issues, "invalid_legacy_reference", `${path}.mod`, "Informe mod 01 ou 02.");
  }
  if (!hasDigits(ref.serie, 1, 3)) {
    pushIssue(issues, "invalid_legacy_reference", `${path}.serie`, "Informe serie numerica.");
  }
  if (!hasDigits(ref.nNF, 1, 9)) {
    pushIssue(issues, "invalid_legacy_reference", `${path}.nNF`, "Informe nNF numerico.");
  }
}

function validateProducerReference(
  issues: DocumentReferenceValidationIssue[],
  value: unknown,
  path: string
) {
  const ref = asObject(value);
  if (!ref) {
    pushIssue(issues, "invalid_producer_reference", path, "Informe refNFP como objeto.");
    return;
  }
  if (!hasDigits(ref.cUF, 2)) {
    pushIssue(issues, "invalid_producer_reference", `${path}.cUF`, "Informe cUF com 2 digitos.");
  }
  if (!hasDigits(ref.AAMM, 4)) {
    pushIssue(issues, "invalid_producer_reference", `${path}.AAMM`, "Informe AAMM com 4 digitos.");
  }
  if (!hasDigits(ref.CNPJ, 14) && !hasDigits(ref.CPF, 11)) {
    pushIssue(
      issues,
      "invalid_producer_reference",
      path,
      "Informe CNPJ com 14 digitos ou CPF com 11 digitos em refNFP."
    );
  }
  if (!hasText(ref.IE)) {
    pushIssue(issues, "invalid_producer_reference", `${path}.IE`, "Informe IE em refNFP.");
  }
  if (!["01", "04"].includes(text(ref.mod))) {
    pushIssue(issues, "invalid_producer_reference", `${path}.mod`, "Informe mod 01 ou 04.");
  }
  if (!hasDigits(ref.serie, 1, 3)) {
    pushIssue(issues, "invalid_producer_reference", `${path}.serie`, "Informe serie numerica.");
  }
  if (!hasDigits(ref.nNF, 1, 9)) {
    pushIssue(issues, "invalid_producer_reference", `${path}.nNF`, "Informe nNF numerico.");
  }
}

function validateEcfReference(
  issues: DocumentReferenceValidationIssue[],
  value: unknown,
  path: string
) {
  const ref = asObject(value);
  if (!ref) {
    pushIssue(issues, "invalid_ecf_reference", path, "Informe refECF como objeto.");
    return;
  }
  if (!["2B", "2C", "2D"].includes(text(ref.mod))) {
    pushIssue(issues, "invalid_ecf_reference", `${path}.mod`, "Informe mod 2B, 2C ou 2D.");
  }
  if (!hasDigits(ref.nECF, 1, 3)) {
    pushIssue(issues, "invalid_ecf_reference", `${path}.nECF`, "Informe nECF numerico.");
  }
  if (!hasDigits(ref.nCOO, 1, 6)) {
    pushIssue(issues, "invalid_ecf_reference", `${path}.nCOO`, "Informe nCOO numerico.");
  }
}

export function validateDocumentReferences(payload: JsonObject): DocumentReferenceValidationResult {
  const issues: DocumentReferenceValidationIssue[] = [];
  const infNFe = rootInfNFe(payload);
  const ide = asObject(infNFe.ide);
  if (!ide) {
    return { ok: true, issues };
  }

  const finality = text(ide.finNFe);
  const references = asArray(ide.NFref);
  if (REFERENCED_FINALITIES.has(finality) && references.length === 0) {
    pushIssue(
      issues,
      "missing_document_reference",
      "infNFe.ide.NFref",
      "Informe NFref para NF-e/NFC-e complementar, ajuste, devolucao, credito ou debito."
    );
  }

  references.forEach((reference, index) => {
    const path = `infNFe.ide.NFref[${index}]`;
    const ref = asObject(reference);
    if (!ref) {
      pushIssue(issues, "invalid_document_reference", path, "Informe NFref como objeto.");
      return;
    }

    const presentKeys = REFERENCE_KEYS.filter((key) => hasText(ref[key]) || asObject(ref[key]));
    if (presentKeys.length === 0) {
      pushIssue(
        issues,
        "missing_document_reference_target",
        path,
        "Informe uma referencia fiscal em NFref."
      );
      return;
    }
    if (presentKeys.length > 1) {
      pushIssue(
        issues,
        "ambiguous_document_reference",
        path,
        "Informe apenas um tipo de referencia por NFref."
      );
      return;
    }

    const key = presentKeys[0];
    if (["refNFe", "refNFeSig", "refCTe"].includes(key)) {
      if (!hasAccessKey(ref[key])) {
        pushIssue(
          issues,
          "invalid_document_reference_key",
          `${path}.${key}`,
          `${key} deve conter chave de acesso com 44 digitos.`
        );
      }
    } else if (key === "refNF") {
      validateLegacyReference(issues, ref.refNF, `${path}.refNF`);
    } else if (key === "refNFP") {
      validateProducerReference(issues, ref.refNFP, `${path}.refNFP`);
    } else if (key === "refECF") {
      validateEcfReference(issues, ref.refECF, `${path}.refECF`);
    }
  });

  return { ok: issues.length === 0, issues };
}
