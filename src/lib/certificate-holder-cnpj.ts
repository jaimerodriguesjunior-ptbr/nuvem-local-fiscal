import forge from "node-forge";

// ICP-Brasil usa o OID 2.16.76.1.3.3 no subject ou otherName do SAN.
// O CN só é aceito no formato explícito nome:CNPJ, nunca por números soltos.
export function certificateHolderCnpj(certificatePem: string): string | null {
  const certificate = forge.pki.certificateFromPem(certificatePem);
  const digits = (value: unknown) => {
    const text = String(value ?? "").replace(/\D/g, "");
    return /^\d{14}$/.test(text) ? text : null;
  };
  const attribute = certificate.subject.attributes.find(a => a.type === "2.16.76.1.3.3");
  if (attribute) return digits(attribute.value);
  const san = certificate.extensions.find(e => e.id === "2.5.29.17");
  if (typeof san?.value === "string") {
    const root = forge.asn1.fromDer(san.value);
    const find = (node: forge.asn1.Asn1): string | null => {
      if (!Array.isArray(node.value)) return null;
      const oid = node.value.find(child => child.type === forge.asn1.Type.OID && typeof child.value === "string");
      if (oid && typeof oid.value === "string" && forge.asn1.derToOid(oid.value) === "2.16.76.1.3.3") {
        const strings = (child: forge.asn1.Asn1): string[] => typeof child.value === "string"
          ? [child.value] : child.value.flatMap(strings);
        for (const child of node.value.filter(child => child !== oid)) {
          for (const value of strings(child)) {
            const cnpj = digits(value);
            if (cnpj) return cnpj;
          }
        }
      }
      for (const child of node.value) {
        const found = find(child);
        if (found) return found;
      }
      return null;
    };
    const found = find(root);
    if (found) return found;
  }
  const cn = certificate.subject.getField("CN")?.value;
  return typeof cn === "string" ? cn.match(/:\s*(\d{14})\s*$/)?.[1] ?? null : null;
}
