import { querySefazDocumentStatus } from "../sefaz-authorization.js";
import type { RecoveryDocument } from "./model.js";

/** The transport adapter has no store, writer, generator or authorize import. */
export function createSefazRecoveryQuery(resolveCertificate: (document: RecoveryDocument) => Promise<{
  uf: string; encryptedBundle: string; encryptionSecret: string;
}>) {
  return async (document: RecoveryDocument): Promise<string> => {
    const certificate = await resolveCertificate(document);
    const result = await querySefazDocumentStatus({
      uf: certificate.uf,
      ambiente: document.environment,
      documentType: document.model,
      accessKey: document.accessKey,
      // Never use the legacy parser's assembled processedXml as evidence.
      encryptedCertificateBundle: certificate.encryptedBundle,
      encryptionSecret: certificate.encryptionSecret
    });
    return result.responseXml;
  };
}
