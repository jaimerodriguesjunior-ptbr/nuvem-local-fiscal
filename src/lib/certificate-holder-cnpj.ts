import forge from "node-forge";

// ICP-Brasil usa o OID 2.16.76.1.3.3 no subject ou otherName do SAN.
// O CN só é aceito no formato explícito nome:CNPJ, nunca por números soltos.
export function certificateHolderCnpj(certificatePem: string): string | null {
  const certificate = forge.pki.certificateFromPem(certificatePem);
  const digits = (value: unknown) => {
    const text = String(value ?? "").trim();
    return /^\d{14}$/.test(text) ? text : null;
  };
  const holders: Array<string | null> = certificate.subject.attributes
    .filter(a => a.type === "2.16.76.1.3.3").map(a => digits(a.value));
  const san = certificate.extensions.find(e => e.id === "2.5.29.17");
  if (typeof san?.value === "string") {
    const root = forge.asn1.fromDer(san.value);
    const find = (node: forge.asn1.Asn1): void => {
      if (!Array.isArray(node.value)) return;
      const oid = node.value.find(child => child.type === forge.asn1.Type.OID && typeof child.value === "string");
      if (oid && typeof oid.value === "string" && forge.asn1.derToOid(oid.value) === "2.16.76.1.3.3") {
        const strings = (child: forge.asn1.Asn1): string[] => typeof child.value === "string"
          ? [child.value] : child.value.flatMap(strings);
        const values = node.value.filter(child => child !== oid).flatMap(strings);
        holders.push(values.length === 1 ? digits(values[0]) : null);
        return;
      }
      for (const child of node.value) {
        find(child);
      }
    };
    find(root);
  }
  const cn = certificate.subject.getField("CN")?.value;
  const cnCnpj = typeof cn === "string" ? cn.match(/:\s*(\d{14})\s*$/)?.[1] : undefined;
  if (cnCnpj) holders.push(cnCnpj);
  if (holders.includes(null)) return null;
  const unique = [...new Set(holders)];
  return unique.length === 1 ? unique[0] : null;
}
