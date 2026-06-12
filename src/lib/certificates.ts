import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";

import forge from "node-forge";

type CertificateBundle = {
  pfxBase64: string;
  password: string;
};

export type ParsedCertificate = {
  privateKeyPem: string;
  certificatePem: string;
  subject: string;
  serialNumber: string;
  validFrom: string;
  validUntil: string;
  holderCnpj: string | null;
};

function encryptionKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

export function encryptSecretPayload(value: unknown, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(secret), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return [iv, tag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptSecretPayload<T>(value: string, secret: string): T {
  const [ivValue, tagValue, encryptedValue] = value.split(".");
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("Bundle de certificado invalido.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(secret),
    Buffer.from(ivValue, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final()
  ]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}

export function encryptCertificateBundle(bundle: CertificateBundle, secret: string) {
  return encryptSecretPayload(bundle, secret);
}

export function decryptCertificateBundle(value: string, secret: string): CertificateBundle {
  return decryptSecretPayload<CertificateBundle>(value, secret);
}

export function parsePfx(pfx: Buffer, password: string): ParsedCertificate {
  try {
    const asn1 = forge.asn1.fromDer(pfx.toString("binary"));
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
    const keyBags = [
      ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
        forge.pki.oids.pkcs8ShroudedKeyBag
      ] ?? []),
      ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? [])
    ];
    const certBags =
      p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
    const privateKey = keyBags.find((bag) => bag.key)?.key;
    const certificate = certBags.find((bag) => bag.cert)?.cert;

    if (!privateKey || !certificate) {
      throw new Error("O PFX nao contem chave privada e certificado utilizaveis.");
    }

    const subject = certificate.subject.attributes
      .map((attribute) => `${attribute.shortName || attribute.name || attribute.type}=${attribute.value}`)
      .join(", ");
    const cnpjAttribute = certificate.subject.attributes.find(
      (attribute) => attribute.type === "2.16.76.1.3.3"
    );
    // Nao tente inferir CNPJ a partir de qualquer numero no subject:
    // certificados ICP-Brasil podem conter outros identificadores de 14 digitos.
    const holderCnpj = cnpjAttribute
      ? String(cnpjAttribute.value).replace(/\D/g, "").match(/\d{14}/)?.[0] ?? null
      : null;

    return {
      privateKeyPem: forge.pki.privateKeyToPem(privateKey),
      certificatePem: forge.pki.certificateToPem(certificate),
      subject,
      serialNumber: certificate.serialNumber,
      validFrom: certificate.validity.notBefore.toISOString(),
      validUntil: certificate.validity.notAfter.toISOString(),
      holderCnpj
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Nao foi possivel abrir o certificado PFX: ${message}`);
  }
}

export function openEncryptedCertificate(encryptedBundle: string, secret: string) {
  const bundle = decryptCertificateBundle(encryptedBundle, secret);
  return parsePfx(Buffer.from(bundle.pfxBase64, "base64"), bundle.password);
}
