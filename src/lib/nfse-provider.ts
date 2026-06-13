import type { InMemoryStore } from "../store.js";
import type { DocumentRecord } from "../types.js";
import {
  consultGuairaIpmNfse,
  isGuairaIpmConfig,
  processGuairaIpmNfse,
  transmitGuairaIpmTest
} from "./nfse-guaira-ipm.js";
import {
  cancelToledoNfse,
  consultToledoNfse,
  isToledoNfseConfig,
  processToledoNfse
} from "./nfse-toledo-equiplano.js";

export type NfseProviderResult = {
  document: DocumentRecord;
  transmitted: boolean;
  error: string | null;
};

function providerContext(store: InMemoryStore, document: DocumentRecord) {
  return {
    issuer: store.findIssuerByCnpj(document.issuerCnpj, document.ambiente),
    serviceConfig: store.findServiceConfigRecord(
      document.issuerCnpj,
      document.ambiente,
      "NFSE"
    )
  };
}

export function configuredNfseProvider(
  store: InMemoryStore,
  document: DocumentRecord
) {
  const { issuer, serviceConfig } = providerContext(store, document);
  if (isGuairaIpmConfig(issuer, serviceConfig)) return "guaira-ipm";
  if (isToledoNfseConfig(issuer, serviceConfig)) return "toledo-equiplano";
  return null;
}

export async function processConfiguredNfse(
  store: InMemoryStore,
  documentId: string
): Promise<NfseProviderResult> {
  const document = store.findDocument(documentId, "NFSe");
  if (!document) {
    throw new Error("Documento NFS-e nao encontrado para processamento.");
  }
  const provider = configuredNfseProvider(store, document);
  if (provider === "guaira-ipm") return processGuairaIpmNfse(store, documentId);
  if (provider === "toledo-equiplano") return processToledoNfse(store, documentId);

  const message = "Provedor NFS-e nao configurado para este emitente.";
  const failed = store.failDocument(document.id, "CONFIGURACAO_NFSE", message);
  await store.waitForPersistence();
  return { document: failed ?? document, transmitted: false, error: message };
}

export async function consultConfiguredNfse(
  store: InMemoryStore,
  documentId: string
): Promise<NfseProviderResult> {
  const document = store.findDocument(documentId, "NFSe");
  if (!document) {
    throw new Error("Documento NFS-e nao encontrado para consulta.");
  }
  const provider = configuredNfseProvider(store, document);
  if (provider === "guaira-ipm") return consultGuairaIpmNfse(store, documentId);
  if (provider === "toledo-equiplano") return consultToledoNfse(store, documentId);
  return { document, transmitted: false, error: null };
}

export async function transmitConfiguredNfseTest(
  store: InMemoryStore,
  documentId: string
): Promise<NfseProviderResult> {
  const document = store.findDocument(documentId, "NFSe");
  if (!document) {
    throw new Error("Documento NFS-e nao encontrado para transmissao.");
  }
  const provider = configuredNfseProvider(store, document);
  if (provider === "guaira-ipm") {
    return transmitGuairaIpmTest(store, documentId);
  }
  throw new Error("Transmissao manual de teste disponivel somente para Guaira/IPM.");
}

export async function cancelConfiguredNfse(
  store: InMemoryStore,
  documentId: string,
  reason: string
): Promise<NfseProviderResult> {
  const document = store.findDocument(documentId, "NFSe");
  if (!document) {
    throw new Error("Documento NFS-e nao encontrado para cancelamento.");
  }
  const provider = configuredNfseProvider(store, document);
  if (provider === "toledo-equiplano") {
    return cancelToledoNfse(store, documentId, reason);
  }
  if (provider === "guaira-ipm") {
    throw new Error(
      "Cancelamento Guaira/IPM sera habilitado somente depois da emissao homologada."
    );
  }
  throw new Error("Provedor NFS-e nao configurado para este emitente.");
}
