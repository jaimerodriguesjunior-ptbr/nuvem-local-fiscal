// Identification printed on the auxiliary document comes from the fiscal XML.
export function nfceRecipientLines(name: string, document: string): string[] {
  const lines: string[] = [];
  if (name.trim()) lines.push(name.trim());
  const digits = document.replace(/\D/g, "");
  if (digits.length === 11) {
    lines.push(`CPF: ${digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")}`);
  } else if (digits.length === 14) {
    lines.push(`CNPJ: ${digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}`);
  }
  return lines.length ? lines : ["CONSUMIDOR NAO IDENTIFICADO"];
}
