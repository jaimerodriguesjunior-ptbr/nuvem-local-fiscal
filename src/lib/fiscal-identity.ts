export type FiscalIdentifierKind = "empty" | "numeric_cnpj" | "alpha_cnpj" | "invalid";

export type FiscalIdentifier = {
  kind: FiscalIdentifierKind;
  value: string;
  digits: string;
};

export function normalizeFiscalIdentifier(value: unknown): FiscalIdentifier {
  const raw = String(value ?? "").trim().toUpperCase();
  const valueOnly = raw.replace(/[.\-/\s]/g, "");
  const digits = valueOnly.replace(/\D/g, "");

  if (!valueOnly) {
    return { kind: "empty", value: "", digits: "" };
  }
  if (/^\d{14}$/.test(valueOnly)) {
    return { kind: "numeric_cnpj", value: valueOnly, digits };
  }
  if (/^[A-Z0-9]{14}$/.test(valueOnly) && /[A-Z]/.test(valueOnly)) {
    return { kind: "alpha_cnpj", value: valueOnly, digits };
  }
  return { kind: "invalid", value: valueOnly, digits };
}

export function normalizeNumericCnpj(value: unknown) {
  const identifier = normalizeFiscalIdentifier(value);
  return identifier.kind === "numeric_cnpj" ? identifier.value : "";
}

export function assertNumericCnpj(value: unknown, label = "CNPJ") {
  const identifier = normalizeFiscalIdentifier(value);
  if (identifier.kind === "numeric_cnpj") {
    return identifier.value;
  }
  if (identifier.kind === "alpha_cnpj") {
    throw new Error(
      `${label} alfanumerico ainda nao e suportado neste fluxo fiscal.`
    );
  }
  throw new Error(`${label} deve conter 14 digitos.`);
}
