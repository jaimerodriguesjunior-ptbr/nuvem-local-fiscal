import { config } from "../config.js";
import type { InMemoryStore } from "../store.js";
import type { DocumentRecord } from "../types.js";
import {
  decryptSecretPayload,
  openEncryptedCertificate
} from "./certificates.js";
import { generateAndSignNfeXml } from "./nfe-xml.js";
import { authorizeNfeAtSefaz } from "./sefaz-authorization.js";
import { validateNfeXml } from "./xsd-validator.js";

export type AutomaticProcessingResult = {
  document: DocumentRecord;
  transmitted: boolean;
  error: string | null;
};

export async function processHomologationNfce(
  store: InMemoryStore,
  documentId: string
): Promise<AutomaticProcessingResult> {
  const document = store.findDocument(documentId);
  if (!document) {
    throw new Error("Documento nao encontrado para processamento.");
  }
  if (document.tipoDocumento !== "NFCe" || document.ambiente !== "homologacao") {
    return { document, transmitted: false, error: null };
  }

  const issuer = store.findIssuerByCnpj(document.issuerCnpj, document.ambiente);
  const certificate = store.findActiveCertificate(document.issuerCnpj);
  if (!issuer || !certificate?.encryptedBundle) {
    const message = "Emitente ou certificado A1 nao encontrado.";
    const failed = store.failDocument(document.id, "CONFIGURACAO", message);
    await store.waitForPersistence();
    return { document: failed ?? document, transmitted: false, error: message };
  }

  try {
    let signedXml = document.xmlSigned;
    if (!signedXml || !document.signatureValid || !document.xsdValid) {
      const opened = openEncryptedCertificate(
        certificate.encryptedBundle,
        config.certificateEncryptionKey
      );
      const nfceConfig = document.nfceConfigEncrypted
        ? decryptSecretPayload<{ cscId: string; csc: string }>(
            document.nfceConfigEncrypted,
            config.certificateEncryptionKey
          )
        : null;
      if (!nfceConfig) {
        throw new Error("Configure o CSC e o ID Token da NFC-e.");
      }

      const signed = generateAndSignNfeXml(
        document.payloadOriginal as Record<string, unknown>,
        opened.privateKeyPem,
        opened.certificatePem,
        {
          ...nfceConfig,
          qrCodeBaseUrl: "http://www.fazenda.pr.gov.br/nfce/qrcode",
          consultationUrl: "http://www.fazenda.pr.gov.br/nfce/consulta"
        }
      );
      const xsd = validateNfeXml(signed.signedXml);
      const updated = store.saveSignedXml(document.id, {
        ...signed,
        xsdValid: xsd.valid,
        xsdErrors: xsd.errors,
        certificateId: certificate.id
      });
      await store.waitForPersistence();

      if (!signed.signatureValid) {
        throw new Error("A assinatura digital do XML nao foi validada.");
      }
      if (!xsd.valid) {
        throw new Error(`XML reprovado no XSD: ${xsd.errors.join(" | ")}`);
      }
      signedXml = updated?.xmlSigned ?? signed.signedXml;
    }

    const authorization = await authorizeNfeAtSefaz({
      uf: issuer.uf,
      ambiente: document.ambiente,
      documentType: document.tipoDocumento,
      signedXml,
      encryptedCertificateBundle: certificate.encryptedBundle,
      encryptionSecret: config.certificateEncryptionKey
    });
    const updated = store.saveSefazAuthorization(document.id, {
      batchId: authorization.idLote,
      receipt: authorization.receipt,
      batchCStat: authorization.batchCStat,
      batchReason: authorization.batchReason,
      protocolCStat: authorization.protocolCStat,
      protocolReason: authorization.protocolReason,
      protocol: authorization.protocol,
      accessKey: authorization.accessKey,
      responseXml: authorization.responseXml,
      processedXml: authorization.processedXml
    });
    await store.waitForPersistence();

    return {
      document: updated ?? document,
      transmitted: true,
      error: null
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = store.failDocument(document.id, "PROCESSAMENTO_AUTOMATICO", message);
    await store.waitForPersistence();
    return { document: failed ?? document, transmitted: false, error: message };
  }
}
