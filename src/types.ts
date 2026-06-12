export type Environment = "homologacao" | "producao";

export type DocumentType = "NFe" | "NFCe";
export type ServiceType = "NFE" | "NFCE" | "NFSE";

export type DocumentStatus =
  | "processamento"
  | "autorizado"
  | "rejeitado"
  | "cancelado"
  | "erro";

export type ApiClient = {
  id: string;
  name: string;
  clientId: string;
  clientSecret: string;
  allowedScopes: string[];
  allowedEnvironments: Environment[];
};

export type Issuer = {
  id: string;
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string;
  ambiente: Environment;
  uf: string;
  ie: string;
  crt: string;
  serieNfe: number;
  serieNfce: number;
  ativo: boolean;
  metadata?: Record<string, unknown>;
};

export type Certificate = {
  id: string;
  issuerId: string;
  cnpj: string;
  fileName: string;
  uploadedAt: string;
  validFrom: string | null;
  validUntil: string | null;
  serialNumber: string | null;
  subject: string | null;
  holderCnpj: string | null;
  encryptedBundle: string;
  active: boolean;
};

export type ServiceConfig = {
  id: string;
  issuerId: string;
  cnpj: string;
  ambiente: Environment;
  serviceType: ServiceType;
  active: boolean;
  settings: {
    cscId?: string;
  };
  secretsEncrypted?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ServiceConfigSnapshot = Omit<ServiceConfig, "secretsEncrypted"> & {
  hasSecrets: boolean;
};

export type MessageItem = {
  codigo: string;
  descricao: string;
};

export type DocumentRecord = {
  id: string;
  providerLikeId: string;
  tipoDocumento: DocumentType;
  issuerCnpj: string;
  ambiente: Environment;
  status: DocumentStatus;
  numero: number;
  serie: number;
  chave: string | null;
  protocolo: string | null;
  motivo: string | null;
  motivoStatus: string | null;
  mensagens: MessageItem[];
  payloadOriginal: unknown;
  payloadNormalizado: unknown;
  xml: string;
  xmlGenerated?: string | null;
  xmlSigned?: string | null;
  signatureValid?: boolean;
  xsdValid?: boolean;
  xsdErrors?: string[];
  certificateId?: string | null;
  nfceConfigEncrypted?: string | null;
  sefazBatchId?: string | null;
  sefazReceipt?: string | null;
  sefazResponseXml?: string | null;
  cancellationJustification?: string | null;
  cancellationStatusCode?: string | null;
  cancellationReason?: string | null;
  cancellationProtocol?: string | null;
  cancellationRequestXml?: string | null;
  cancellationSignedXml?: string | null;
  cancellationResponseXml?: string | null;
  cancellationProcessedXml?: string | null;
  cancelledAt?: string | null;
  pdfUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type InutilizationStatus =
  | "processamento"
  | "homologado"
  | "rejeitado"
  | "erro";

export type InutilizationRecord = {
  id: string;
  providerLikeId: string;
  tipoDocumento: DocumentType;
  issuerCnpj: string;
  ambiente: Environment;
  status: InutilizationStatus;
  ano: number;
  serie: number;
  numeroInicial: number;
  numeroFinal: number;
  justificativa: string;
  protocolo: string | null;
  motivo: string | null;
  motivoStatus: string | null;
  xmlPedido: string | null;
  xmlAssinado: string | null;
  xmlResposta: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AccessTokenRecord = {
  token: string;
  clientId: string;
  scopes: string[];
  environments: Environment[];
  expiresAt: number;
};
