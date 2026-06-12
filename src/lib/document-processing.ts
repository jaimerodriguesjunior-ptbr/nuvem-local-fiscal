import { config } from "../config.js";
import type { InMemoryStore } from "../store.js";
import type { DocumentRecord } from "../types.js";
import {
  decryptSecretPayload,
  openEncryptedCertificate
} from "./certificates.js";
import { generateAndSignNfeXml } from "./nfe-xml.js";
import {
  authorizeNfeAtSefaz,
  querySefazDocumentStatus
} from "./sefaz-authorization.js";
import { validateNfeXml } from "./xsd-validator.js";

export type AutomaticProcessingResult = {
  document: DocumentRecord;
  transmitted: boolean;
  error: string | null;
};

const documentsInProcessing = new Set<string>();

function resolveQrCodeConfig(document: DocumentRecord) {
  if (document.tipoDocumento !== "NFCe") {
    return undefined;
  }

  const nfceConfig = document.nfceConfigEncrypted
    ? decryptSecretPayload<{ cscId: string; csc: string }>(
        document.nfceConfigEncrypted,
        config.certificateEncryptionKey
      )
    : null;
  if (!nfceConfig) {
    throw new Error("Configure o CSC e o ID Token da NFC-e.");
  }

  return {
    ...nfceConfig,
    qrCodeBaseUrl: "http://www.fazenda.pr.gov.br/nfce/qrcode",
    consultationUrl: "http://www.fazenda.pr.gov.br/nfce/consulta"
  };
}

function resolveResponsibleTechnicalCsrtConfig(document: DocumentRecord) {
  const idCSRT =
    document.ambiente === "producao"
      ? config.nfeResponsibleTechnicalCsrtIdProduction
      : config.nfeResponsibleTechnicalCsrtIdHomologation;
  const csrt =
    document.ambiente === "producao"
      ? config.nfeResponsibleTechnicalCsrtProduction
      : config.nfeResponsibleTechnicalCsrtHomologation;

  if (
    !config.nfeResponsibleTechnicalCnpj &&
    !config.nfeResponsibleTechnicalContact &&
    !config.nfeResponsibleTechnicalEmail &&
    !config.nfeResponsibleTechnicalPhone &&
    !idCSRT &&
    !csrt
  ) {
    return undefined;
  }

  return {
    cnpj: config.nfeResponsibleTechnicalCnpj,
    contact: config.nfeResponsibleTechnicalContact,
    email: config.nfeResponsibleTechnicalEmail,
    phone: config.nfeResponsibleTechnicalPhone,
    idCSRT,
    csrt
  };
}

export async function processHomologationDocument(
  store: InMemoryStore,
  documentId: string
): Promise<AutomaticProcessingResult> {
  const document = store.findDocument(documentId);
  if (!document) {
    throw new Error("Documento nao encontrado para processamento.");
  }
  if (document.ambiente !== "homologacao") {
    return { document, transmitted: false, error: null };
  }
  if (["autorizado", "cancelado"].includes(document.status)) {
    return { document, transmitted: false, error: null };
  }
  if (documentsInProcessing.has(document.id)) {
    const message = "Ja existe um processamento em andamento para este documento.";
    store.addDocumentEvent(document.id, {
      eventType: "processing_concurrency_blocked",
      level: "warn",
      message
    });
    await store.waitForPersistence();
    return { document, transmitted: false, error: message };
  }
  documentsInProcessing.add(document.id);

  const issuer = store.findIssuerByCnpj(document.issuerCnpj, document.ambiente);
  const certificate = store.findActiveCertificate(document.issuerCnpj);
  if (!issuer || !certificate?.encryptedBundle) {
    const message = "Emitente ou certificado A1 nao encontrado.";
    const failed = store.failDocument(document.id, "CONFIGURACAO", message);
    await store.waitForPersistence();
    documentsInProcessing.delete(document.id);
    return { document: failed ?? document, transmitted: false, error: message };
  }

  try {
    const attemptNumber =
      store
        .getDocumentEvents(document.id)
        .filter((event) => event.eventType === "authorization_attempt_started")
        .length + 1;
    store.addDocumentEvent(document.id, {
      eventType: "authorization_attempt_started",
      message: `Tentativa de autorizacao ${attemptNumber} iniciada.`,
      payload: {
        attempt: attemptNumber,
        previousStatus: document.status,
        documentType: document.tipoDocumento,
        environment: document.ambiente
      }
    });
    await store.waitForPersistence();

    let signedXml = document.xmlSigned;
    if (
      document.status === "erro" ||
      document.status === "rejeitado" ||
      !signedXml ||
      !document.signatureValid ||
      !document.xsdValid
    ) {
      const opened = openEncryptedCertificate(
        certificate.encryptedBundle,
        config.certificateEncryptionKey
      );

      const signed = generateAndSignNfeXml(
        document.payloadOriginal as Record<string, unknown>,
        opened.privateKeyPem,
        opened.certificatePem,
        resolveQrCodeConfig(document),
        resolveResponsibleTechnicalCsrtConfig(document)
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
      store.addDocumentEvent(document.id, {
        eventType: "xml_regenerated",
        message: "XML regenerado, assinado e validado antes da tentativa.",
        payload: {
          attempt: attemptNumber,
          accessKey: signed.accessKey,
          certificateId: certificate.id
        }
      });
      await store.waitForPersistence();
    }

    const accessKey = store.findDocument(document.id)?.chave;
    if (!accessKey) {
      throw new Error("A chave de acesso nao foi gerada antes da consulta previa.");
    }
    store.addDocumentEvent(document.id, {
      eventType: "sefaz_preflight_started",
      message: "Consulta previa da chave iniciada antes da transmissao.",
      payload: { attempt: attemptNumber, accessKey }
    });
    await store.waitForPersistence();

    const currentStatus = await querySefazDocumentStatus({
      uf: issuer.uf,
      ambiente: document.ambiente,
      documentType: document.tipoDocumento,
      accessKey,
      signedXml,
      encryptedCertificateBundle: certificate.encryptedBundle,
      encryptionSecret: config.certificateEncryptionKey
    });
    store.addDocumentEvent(document.id, {
      eventType: "sefaz_preflight_completed",
      message: currentStatus.protocolReason || currentStatus.xMotivo,
      payload: {
        attempt: attemptNumber,
        cStat: currentStatus.cStat,
        protocolCStat: currentStatus.protocolCStat || null,
        protocol: currentStatus.protocol || null
      }
    });
    await store.waitForPersistence();

    if (["100", "150"].includes(currentStatus.protocolCStat)) {
      const recovered = store.saveSefazAuthorization(document.id, {
        batchId: "",
        receipt: "",
        batchCStat: currentStatus.cStat,
        batchReason: currentStatus.xMotivo,
        protocolCStat: currentStatus.protocolCStat,
        protocolReason: currentStatus.protocolReason,
        protocol: currentStatus.protocol,
        accessKey: currentStatus.accessKey,
        responseXml: currentStatus.responseXml,
        processedXml: currentStatus.processedXml
      });
      store.addDocumentEvent(document.id, {
        eventType: "authorization_recovered",
        message: "Autorizacao existente recuperada pela consulta da chave.",
        payload: {
          attempt: attemptNumber,
          accessKey: currentStatus.accessKey,
          protocol: currentStatus.protocol
        }
      });
      await store.waitForPersistence();
      return {
        document: recovered ?? document,
        transmitted: false,
        error: null
      };
    }
    if (currentStatus.cStat !== "217") {
      throw new Error(
        currentStatus.protocolReason ||
          currentStatus.xMotivo ||
          `A chave possui situacao SEFAZ ${currentStatus.cStat}.`
      );
    }

    store.addDocumentEvent(document.id, {
      eventType: "sefaz_authorization_started",
      message: "Chave inexistente na SEFAZ; transmissao iniciada.",
      payload: { attempt: attemptNumber, accessKey }
    });
    await store.waitForPersistence();
    const authorization = await authorizeNfeAtSefaz({
      uf: issuer.uf,
      ambiente: document.ambiente,
      documentType: document.tipoDocumento,
      signedXml,
      encryptedCertificateBundle: certificate.encryptedBundle,
      encryptionSecret: config.certificateEncryptionKey
    });
    store.addDocumentEvent(document.id, {
      eventType: "sefaz_authorization_completed",
      level: ["100", "150"].includes(authorization.protocolCStat)
        ? "info"
        : "warn",
      message: authorization.protocolReason || authorization.batchReason,
      payload: {
        attempt: attemptNumber,
        batchId: authorization.idLote,
        batchCStat: authorization.batchCStat,
        protocolCStat: authorization.protocolCStat || null,
        protocol: authorization.protocol || null
      }
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
    store.addDocumentEvent(document.id, {
      eventType: "authorization_attempt_failed",
      level: "error",
      message,
      payload: {
        uncertainExternalState:
          /tempo esgotado|ECONNRESET|socket|corpo vazio|HTTP 5\d\d/i.test(message)
      }
    });
    const failed = store.failDocument(document.id, "PROCESSAMENTO_AUTOMATICO", message);
    await store.waitForPersistence();
    return { document: failed ?? document, transmitted: false, error: message };
  } finally {
    documentsInProcessing.delete(document.id);
  }
}

export async function processHomologationNfce(
  store: InMemoryStore,
  documentId: string
): Promise<AutomaticProcessingResult> {
  const document = store.findDocument(documentId);
  if (!document) {
    throw new Error("Documento nao encontrado para processamento.");
  }
  if (document.tipoDocumento !== "NFCe") {
    return { document, transmitted: false, error: null };
  }
  return processHomologationDocument(store, documentId);
}
