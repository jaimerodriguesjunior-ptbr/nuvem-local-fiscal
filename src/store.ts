import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type { StoreSnapshotState, SupabasePersistence } from "./lib/supabase-persistence.js";
import type {
  AccessTokenRecord,
  ApiClient,
  Certificate,
  DocumentRecord,
  DocumentStatus,
  DocumentType,
  Environment,
  InutilizationRecord,
  Issuer,
  ServiceConfig,
  ServiceType
} from "./types.js";

type CreateDocumentInput = {
  tipoDocumento: DocumentType;
  issuerCnpj: string;
  ambiente: Environment;
  payloadOriginal: unknown;
  payloadNormalizado: unknown;
  nfceConfigEncrypted?: string | null;
  forcedStatus?: DocumentStatus;
};

const nowIso = () => new Date().toISOString();

function escapeXml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const seedClients = (defaultClientId: string, defaultClientSecret: string): ApiClient[] => [
  {
    id: "client_default",
    name: "Cliente local v0",
    clientId: defaultClientId,
    clientSecret: defaultClientSecret,
    allowedScopes: ["empresa", "nfe", "nfce", "nfse"],
    allowedEnvironments: ["homologacao", "producao"]
  }
];

const seedIssuers = (): Issuer[] => [
  {
    id: "issuer_demo_hom",
    cnpj: "12345678000195",
    razaoSocial: "Empresa Demo Homologacao LTDA",
    nomeFantasia: "Demo Hom",
    ambiente: "homologacao",
    uf: "PR",
    ie: "1234567890",
    crt: "1",
      serieNfe: 1,
      serieNfce: 1,
      ativo: true,
      metadata: {}
  },
  {
    id: "issuer_demo_prod",
    cnpj: "98765432000110",
    razaoSocial: "Empresa Demo Producao LTDA",
    nomeFantasia: "Demo Prod",
    ambiente: "producao",
    uf: "PR",
    ie: "9988776655",
    crt: "3",
      serieNfe: 1,
      serieNfce: 10,
      ativo: true,
      metadata: {}
  }
];

export class InMemoryStore {
  apiClients: ApiClient[];
  issuers: Issuer[];
  certificates: Certificate[];
  serviceConfigs: ServiceConfig[];
  documents: DocumentRecord[];
  inutilizations: InutilizationRecord[];
  accessTokens: AccessTokenRecord[];
  private readonly tokenSecret: string;
  private readonly stateFile: string;
  private readonly persistence: SupabasePersistence | null;
  private persistQueue = Promise.resolve();
  private persistenceError: Error | null = null;

  constructor(
    defaultClientId: string,
    defaultClientSecret: string,
    tokenSecret: string,
    stateFile: string,
    persistence: SupabasePersistence | null = null
  ) {
    this.apiClients = seedClients(defaultClientId, defaultClientSecret);
    this.issuers = persistence ? [] : seedIssuers();
    this.certificates = [];
    this.serviceConfigs = [];
    this.documents = [];
    this.inutilizations = [];
    this.accessTokens = [];
    this.tokenSecret = tokenSecret;
    this.stateFile = stateFile;
    this.persistence = persistence;
    if (!persistence) {
      this.loadState();
    }
  }

  async loadExternalState() {
    if (!this.persistence) {
      return;
    }

    const state = await this.persistence.loadState();
    if (
      state.issuers.length ||
      state.certificates.length ||
      state.serviceConfigs.length ||
      state.documents.length
    ) {
      this.issuers = state.issuers;
      this.certificates = state.certificates;
      this.serviceConfigs = state.serviceConfigs;
      this.documents = state.documents;
      this.inutilizations = state.inutilizations;
      this.writeLocalState();
      return;
    }

    await this.persistence.saveState(this.currentState());
  }

  createAccessToken(clientId: string, scopes: string[], environments: Environment[]) {
    const expiresAt = Date.now() + 60 * 60 * 1000;
    const payload = Buffer.from(
      JSON.stringify({ clientId, scopes, environments, expiresAt }),
      "utf8"
    ).toString("base64url");
    const signature = this.signTokenPayload(payload);
    const token = `nlf_${payload}.${signature}`;
    const record: AccessTokenRecord = { token, clientId, scopes, environments, expiresAt };
    this.accessTokens.push(record);
    return record;
  }

  findToken(token: string) {
    const cached =
      this.accessTokens.find((item) => item.token === token && item.expiresAt > Date.now()) ?? null;
    if (cached) {
      return cached;
    }

    if (!token.startsWith("nlf_")) {
      return null;
    }

    const [payload, signature] = token.slice(4).split(".");
    if (!payload || !signature) {
      return null;
    }

    const expectedSignature = this.signTokenPayload(payload);
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      return null;
    }

    try {
      const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
        clientId: string;
        scopes: string[];
        environments: Environment[];
        expiresAt: number;
      };

      if (!parsed.clientId || !Array.isArray(parsed.scopes) || parsed.expiresAt <= Date.now()) {
        return null;
      }

      return {
        token,
        clientId: parsed.clientId,
        scopes: parsed.scopes,
        environments: parsed.environments,
        expiresAt: parsed.expiresAt
      };
    } catch {
      return null;
    }
  }

  private signTokenPayload(payload: string) {
    return createHmac("sha256", this.tokenSecret).update(payload).digest("base64url");
  }

  findClient(clientId: string, clientSecret: string) {
    return this.apiClients.find(
      (item) => item.clientId === clientId && item.clientSecret === clientSecret
    ) ?? null;
  }

  findIssuerByCnpj(cnpj: string, ambiente?: Environment) {
    return this.issuers.find((item) => item.cnpj === cnpj && (!ambiente || item.ambiente === ambiente)) ?? null;
  }

  ensureIssuer(cnpj: string, ambiente: Environment, data?: Partial<Issuer>) {
    const existing = this.findIssuerByCnpj(cnpj, ambiente);
    if (existing) {
      return existing;
    }

    const issuer: Issuer = {
      id: `issuer_${randomUUID().slice(0, 8)}`,
      cnpj,
      razaoSocial: data?.razaoSocial || `Emitente ${cnpj}`,
      nomeFantasia: data?.nomeFantasia || data?.razaoSocial || `Emitente ${cnpj}`,
      ambiente,
      uf: data?.uf || "",
      ie: data?.ie || "",
      crt: data?.crt || "",
      serieNfe: data?.serieNfe || 1,
      serieNfce: data?.serieNfce || 1,
      ativo: true,
      metadata: data?.metadata ?? {}
    };

    this.issuers.push(issuer);
    this.saveState();
    return issuer;
  }

  createOrReplaceCertificate(
    cnpj: string,
    input: {
      fileName: string;
      encryptedBundle: string;
      validFrom: string;
      validUntil: string;
      serialNumber: string;
      subject: string;
      holderCnpj: string | null;
    }
  ) {
    const issuer = this.findIssuerByCnpj(cnpj);
    if (!issuer) {
      return null;
    }

    this.certificates = this.certificates.filter((item) => item.cnpj !== cnpj);
    const certificate: Certificate = {
      id: `cert_${randomUUID().slice(0, 8)}`,
      issuerId: issuer.id,
      cnpj,
      fileName: input.fileName,
      uploadedAt: nowIso(),
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      serialNumber: input.serialNumber,
      subject: input.subject,
      holderCnpj: input.holderCnpj,
      encryptedBundle: input.encryptedBundle,
      active: true
    };
    this.certificates.push(certificate);
    this.saveState();
    return certificate;
  }

  findActiveCertificate(cnpj: string) {
    return this.certificates.find((item) => item.cnpj === cnpj && item.active) ?? null;
  }

  findServiceConfig(cnpj: string, ambiente: Environment, serviceType: ServiceType) {
    return (
      this.serviceConfigs.find(
        (item) =>
          item.cnpj === cnpj &&
          item.ambiente === ambiente &&
          item.serviceType === serviceType &&
          item.active
      ) ?? null
    );
  }

  upsertIssuerEnvironment(
    cnpj: string,
    ambiente: Environment,
    data: Partial<Pick<Issuer, "razaoSocial" | "nomeFantasia" | "uf" | "ie" | "crt" | "serieNfe" | "serieNfce" | "ativo" | "metadata">>
  ) {
    const existing = this.findIssuerByCnpj(cnpj, ambiente);
    if (existing) {
      if (data.razaoSocial !== undefined) existing.razaoSocial = data.razaoSocial;
      if (data.nomeFantasia !== undefined) existing.nomeFantasia = data.nomeFantasia;
      if (data.uf !== undefined) existing.uf = data.uf;
      if (data.ie !== undefined) existing.ie = data.ie;
      if (data.crt !== undefined) existing.crt = data.crt;
      if (data.serieNfe !== undefined) existing.serieNfe = data.serieNfe;
      if (data.serieNfce !== undefined) existing.serieNfce = data.serieNfce;
      if (data.ativo !== undefined) existing.ativo = data.ativo;
      if (data.metadata !== undefined) {
        existing.metadata = {
          ...(existing.metadata ?? {}),
          ...data.metadata
        };
      }
      this.saveState();
      return existing;
    }

    const issuer: Issuer = {
      id: `issuer_${randomUUID().slice(0, 8)}`,
      cnpj,
      razaoSocial: data.razaoSocial || `Emitente ${cnpj}`,
      nomeFantasia: data.nomeFantasia || data.razaoSocial || `Emitente ${cnpj}`,
      ambiente,
      uf: data.uf || "",
      ie: data.ie || "",
      crt: data.crt || "",
      serieNfe: data.serieNfe || 1,
      serieNfce: data.serieNfce || 1,
      ativo: data.ativo ?? true,
      metadata: data.metadata ?? {}
    };

    this.issuers.push(issuer);
    this.saveState();
    return issuer;
  }

  upsertServiceConfig(
    cnpj: string,
    ambiente: Environment,
    serviceType: ServiceType,
    input: {
      active?: boolean;
      settings?: ServiceConfig["settings"];
      secretsEncrypted?: string | null;
      preserveSecrets?: boolean;
    }
  ) {
    const issuer = this.findIssuerByCnpj(cnpj, ambiente);
    if (!issuer) {
      return null;
    }

    const existing = this.findServiceConfig(cnpj, ambiente, serviceType);
    if (existing) {
      existing.active = input.active ?? existing.active;
      existing.settings = {
        ...existing.settings,
        ...(input.settings ?? {})
      };
      if (!input.preserveSecrets) {
        existing.secretsEncrypted = input.secretsEncrypted ?? null;
      }
      existing.updatedAt = nowIso();
      this.saveState();
      return existing;
    }

    const serviceConfig: ServiceConfig = {
      id: `svc_${randomUUID().slice(0, 8)}`,
      issuerId: issuer.id,
      cnpj,
      ambiente,
      serviceType,
      active: input.active ?? true,
      settings: input.settings ?? {},
      secretsEncrypted: input.preserveSecrets ? null : input.secretsEncrypted ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    this.serviceConfigs.push(serviceConfig);
    this.saveState();
    return serviceConfig;
  }

  createDocument(input: CreateDocumentInput) {
    const issuer = this.findIssuerByCnpj(input.issuerCnpj, input.ambiente);
    const existingCount = this.documents.filter(
      (item) => item.issuerCnpj === input.issuerCnpj && item.tipoDocumento === input.tipoDocumento
    ).length;
    const numero = existingCount + 1;
    const serie = issuer
      ? input.tipoDocumento === "NFe"
        ? issuer.serieNfe
        : issuer.serieNfce
      : 1;
    const status = input.forcedStatus ?? "processamento";
    const authorized = status === "autorizado";
    const id = `doc_${randomUUID().slice(0, 8)}`;

    const document: DocumentRecord = {
      id,
      providerLikeId: id,
      tipoDocumento: input.tipoDocumento,
      issuerCnpj: input.issuerCnpj,
      ambiente: input.ambiente,
      status,
      numero,
      serie,
      chave: authorized ? `41${String(Date.now()).slice(-42).padStart(42, "0")}` : null,
      protocolo: authorized ? `14${String(Date.now()).slice(-13)}` : null,
      motivo: authorized ? "Autorizado o uso do documento fiscal" : null,
      motivoStatus: authorized ? "100" : null,
      mensagens: [],
      payloadOriginal: input.payloadOriginal,
      payloadNormalizado: input.payloadNormalizado,
      nfceConfigEncrypted: input.nfceConfigEncrypted ?? null,
      xml: `<mock tipo="${input.tipoDocumento}" id="${id}" numero="${numero}" serie="${serie}" />`,
      pdfUrl: `/${input.tipoDocumento === "NFe" ? "nfe" : "nfce"}/${id}/pdf`,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    this.documents.unshift(document);
    this.saveState();
    return document;
  }

  findDocument(id: string, tipoDocumento?: DocumentType) {
    return this.documents.find(
      (item) => item.id === id && (!tipoDocumento || item.tipoDocumento === tipoDocumento)
    ) ?? null;
  }

  authorizeDocument(id: string, tipoDocumento?: DocumentType) {
    const document = this.findDocument(id, tipoDocumento);
    if (!document) {
      return document;
    }

    const accessKey =
      document.chave ??
      `${document.issuerCnpj.slice(0, 2).padStart(2, "0")}${String(Date.now())
        .replace(/\D/g, "")
        .slice(-42)
        .padStart(42, "0")}`.slice(0, 44);
    const protocol = `14${String(Date.now()).slice(-13)}`;
    const model = document.tipoDocumento === "NFCe" ? "65" : "55";

    document.status = "autorizado";
    document.chave = accessKey;
    document.protocolo = protocol;
    document.motivo = "Autorizado o uso do documento fiscal";
    document.motivoStatus = "100";
    const nfeXml =
      document.xmlSigned?.replace(/^<\?xml[^>]*\?>/, "") ??
      [
        `<NFe xmlns="http://www.portalfiscal.inf.br/nfe">`,
        `<infNFe Id="NFe${escapeXml(accessKey)}" versao="4.00">`,
        `<ide><mod>${model}</mod><serie>${document.serie}</serie><nNF>${document.numero}</nNF><tpAmb>${document.ambiente === "producao" ? "1" : "2"}</tpAmb></ide>`,
        `<emit><CNPJ>${escapeXml(document.issuerCnpj)}</CNPJ></emit>`,
        "</infNFe></NFe>"
      ].join("");
    document.xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">',
      nfeXml,
      `<protNFe versao="4.00"><infProt><tpAmb>${document.ambiente === "producao" ? "1" : "2"}</tpAmb><chNFe>${escapeXml(accessKey)}</chNFe><nProt>${escapeXml(protocol)}</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`,
      "</nfeProc>"
    ].join("");
    document.updatedAt = nowIso();
    this.saveState();
    return document;
  }

  saveSignedXml(
    id: string,
    input: {
      accessKey: string;
      unsignedXml: string;
      signedXml: string;
      signatureValid: boolean;
      xsdValid: boolean;
      xsdErrors: string[];
      certificateId: string;
    }
  ) {
    const document = this.findDocument(id);
    if (!document) {
      return null;
    }

    document.chave = input.accessKey;
    document.xmlGenerated = input.unsignedXml;
    document.xmlSigned = input.signedXml;
    document.signatureValid = input.signatureValid;
    document.xsdValid = input.xsdValid;
    document.xsdErrors = input.xsdErrors;
    document.certificateId = input.certificateId;
    document.updatedAt = nowIso();
    this.saveState();
    return document;
  }

  saveSefazAuthorization(
    id: string,
    input: {
      batchId: string;
      receipt: string;
      batchCStat: string;
      batchReason: string;
      protocolCStat: string;
      protocolReason: string;
      protocol: string;
      accessKey: string;
      responseXml: string;
      processedXml: string;
    }
  ) {
    const document = this.findDocument(id);
    if (!document) {
      return null;
    }

    document.sefazBatchId = input.batchId;
    document.sefazReceipt = input.receipt || null;
    document.sefazResponseXml = input.responseXml;
    document.motivoStatus = input.protocolCStat || input.batchCStat;
    document.motivo = input.protocolReason || input.batchReason;
    document.protocolo = input.protocol || null;
    document.chave = input.accessKey || document.chave;

    if (["100", "150"].includes(input.protocolCStat)) {
      document.status = "autorizado";
      document.xml = input.processedXml;
      document.mensagens = [];
    } else if (input.protocolCStat) {
      document.status = "rejeitado";
      document.mensagens = [
        {
          codigo: input.protocolCStat,
          descricao: input.protocolReason
        }
      ];
    } else if (input.receipt || input.batchCStat === "103") {
      document.status = "processamento";
    } else {
      document.status = "erro";
    }

    document.updatedAt = nowIso();
    this.saveState();
    return document;
  }

  failDocument(id: string, code: string, reason: string) {
    const document = this.findDocument(id);
    if (!document) {
      return null;
    }

    document.status = "erro";
    document.motivoStatus = code;
    document.motivo = reason;
    document.mensagens = [
      {
        codigo: code,
        descricao: reason
      }
    ];
    document.updatedAt = nowIso();
    this.saveState();
    return document;
  }

  rejectDocument(
    id: string,
    code = "999",
    reason = "Rejeicao simulada pelo painel local."
  ) {
    const document = this.findDocument(id);
    if (!document) {
      return null;
    }

    document.status = "rejeitado";
    document.chave = null;
    document.protocolo = null;
    document.motivo = reason;
    document.motivoStatus = code;
    document.mensagens = [
      {
        codigo: code,
        descricao: reason
      }
    ];
    document.xml = "";
    document.updatedAt = nowIso();
    this.saveState();
    return document;
  }

  processDocument(id: string) {
    const document = this.findDocument(id);
    if (!document) {
      return null;
    }

    document.status = "processamento";
    document.chave = null;
    document.protocolo = null;
    document.motivo = null;
    document.motivoStatus = null;
    document.mensagens = [];
    document.xml = "";
    document.updatedAt = nowIso();
    this.saveState();
    return document;
  }

  recoverDocument(id: string, tipoDocumento: DocumentType) {
    const existing = this.findDocument(id, tipoDocumento);
    if (existing) {
      return existing;
    }

    const document: DocumentRecord = {
      id,
      providerLikeId: id,
      tipoDocumento,
      issuerCnpj: "00000000000000",
      ambiente: "homologacao",
      status: "processamento",
      numero: 0,
      serie: 1,
      chave: null,
      protocolo: null,
      motivo: null,
      motivoStatus: null,
      mensagens: [
        {
          codigo: "MOCK_RECOVERED",
          descricao: "Documento recuperado apos reinicio do servidor local."
        }
      ],
      payloadOriginal: null,
      payloadNormalizado: {
        tipo: tipoDocumento,
        recuperadoAposReinicio: true
      },
      xml: "",
      xmlGenerated: null,
      xmlSigned: null,
      signatureValid: false,
      xsdValid: false,
      xsdErrors: [],
      certificateId: null,
      pdfUrl: `/${tipoDocumento === "NFe" ? "nfe" : "nfce"}/${id}/pdf`,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    this.documents.unshift(document);
    this.saveState();
    return document;
  }

  saveCancellationResult(
    id: string,
    input: {
      justification: string;
      requestXml: string;
      signedXml: string;
      responseXml: string;
      processedXml: string;
      statusCode: string;
      reason: string;
      protocol: string;
      cancelledAt: string;
    }
  ) {
    const document = this.findDocument(id);
    if (!document) {
      return null;
    }

    document.cancellationJustification = input.justification;
    document.cancellationStatusCode = input.statusCode;
    document.cancellationReason = input.reason;
    document.cancellationRequestXml = input.requestXml;
    document.cancellationSignedXml = input.signedXml;
    document.cancellationResponseXml = input.responseXml;
    document.cancellationProcessedXml = input.processedXml;
    document.cancellationProtocol = input.protocol || null;
    document.cancelledAt = input.cancelledAt || nowIso();
    if (["135", "136", "155"].includes(input.statusCode)) {
      document.status = "cancelado";
    }
    document.mensagens = [
      {
        codigo: input.statusCode,
        descricao: input.reason
      }
    ];
    document.updatedAt = nowIso();
    this.saveState();
    return document;
  }

  createInutilization(input: {
    tipoDocumento: DocumentType;
    issuerCnpj: string;
    ambiente: Environment;
    ano: number;
    serie: number;
    numeroInicial: number;
    numeroFinal: number;
    justificativa: string;
  }) {
    const id = `inut_${randomUUID().slice(0, 8)}`;
    const record: InutilizationRecord = {
      id,
      providerLikeId: id,
      tipoDocumento: input.tipoDocumento,
      issuerCnpj: input.issuerCnpj,
      ambiente: input.ambiente,
      status: "processamento",
      ano: input.ano,
      serie: input.serie,
      numeroInicial: input.numeroInicial,
      numeroFinal: input.numeroFinal,
      justificativa: input.justificativa,
      protocolo: null,
      motivo: null,
      motivoStatus: null,
      xmlPedido: null,
      xmlAssinado: null,
      xmlResposta: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    this.inutilizations.unshift(record);
    this.saveState();
    return record;
  }

  findInutilization(id: string, tipoDocumento?: DocumentType) {
    return (
      this.inutilizations.find(
        (item) => item.id === id && (!tipoDocumento || item.tipoDocumento === tipoDocumento)
      ) ?? null
    );
  }

  saveInutilizationResult(
    id: string,
    input: {
      requestXml: string;
      signedXml: string;
      responseXml: string;
      statusCode: string;
      reason: string;
      protocol: string;
    }
  ) {
    const record = this.findInutilization(id);
    if (!record) {
      return null;
    }
    record.xmlPedido = input.requestXml;
    record.xmlAssinado = input.signedXml;
    record.xmlResposta = input.responseXml;
    record.motivoStatus = input.statusCode;
    record.motivo = input.reason;
    record.protocolo = input.protocol || null;
    record.status = input.statusCode === "102" ? "homologado" : "rejeitado";
    record.updatedAt = nowIso();
    this.saveState();
    return record;
  }

  failInutilization(id: string, code: string, reason: string) {
    const record = this.findInutilization(id);
    if (!record) {
      return null;
    }
    record.status = "erro";
    record.motivoStatus = code;
    record.motivo = reason;
    record.updatedAt = nowIso();
    this.saveState();
    return record;
  }

  getSnapshot() {
    return {
      apiClients: this.apiClients,
      issuers: this.issuers,
      certificates: this.certificates.map(({ encryptedBundle: _encryptedBundle, ...certificate }) => certificate),
      serviceConfigs: this.serviceConfigs.map((serviceConfig) => ({
        id: serviceConfig.id,
        issuerId: serviceConfig.issuerId,
        cnpj: serviceConfig.cnpj,
        ambiente: serviceConfig.ambiente,
        serviceType: serviceConfig.serviceType,
        active: serviceConfig.active,
        settings: serviceConfig.settings,
        createdAt: serviceConfig.createdAt,
        updatedAt: serviceConfig.updatedAt,
        hasSecrets: Boolean(serviceConfig.secretsEncrypted)
      })),
      documents: this.documents.map(
        ({ nfceConfigEncrypted: _nfceConfigEncrypted, ...document }) => document
      ),
      inutilizations: this.inutilizations,
      summary: {
        clients: this.apiClients.length,
        issuers: this.issuers.length,
        certificates: this.certificates.length,
        serviceConfigs: this.serviceConfigs.length,
        documents: this.documents.length,
        inutilizations: this.inutilizations.length
      }
    };
  }

  getDocumentSnapshot(document: DocumentRecord) {
    const { nfceConfigEncrypted: _nfceConfigEncrypted, ...snapshot } = document;
    return snapshot;
  }

  async waitForPersistence() {
    await this.persistQueue;
    if (this.persistenceError) {
      throw this.persistenceError;
    }
  }

  private loadState() {
    if (!existsSync(this.stateFile)) {
      return;
    }

    try {
      const state = JSON.parse(readFileSync(this.stateFile, "utf8")) as {
        issuers?: Issuer[];
        certificates?: Certificate[];
        serviceConfigs?: ServiceConfig[];
        documents?: DocumentRecord[];
        inutilizations?: InutilizationRecord[];
      };
      this.issuers = state.issuers ?? this.issuers;
      this.certificates = state.certificates ?? [];
      this.serviceConfigs = state.serviceConfigs ?? [];
      this.documents = state.documents ?? [];
      this.inutilizations = state.inutilizations ?? [];
    } catch {
      // A falha de leitura nao deve impedir o servidor de desenvolvimento de subir.
    }
  }

  private saveState() {
    this.writeLocalState();
    this.persistExternalState();
  }

  private writeLocalState() {
    mkdirSync(dirname(this.stateFile), { recursive: true });
    writeFileSync(
      this.stateFile,
      JSON.stringify(
        {
          issuers: this.issuers,
          certificates: this.certificates,
          serviceConfigs: this.serviceConfigs,
          documents: this.documents,
          inutilizations: this.inutilizations
        },
        null,
        2
      ),
      "utf8"
    );
  }

  private currentState(): StoreSnapshotState {
    return {
      issuers: this.issuers,
      certificates: this.certificates,
      serviceConfigs: this.serviceConfigs,
      documents: this.documents,
      inutilizations: this.inutilizations
    };
  }

  private persistExternalState() {
    if (!this.persistence) {
      return;
    }

    const snapshot = structuredClone(this.currentState()) as StoreSnapshotState;
    this.persistenceError = null;
    this.persistQueue = this.persistQueue
      .then(() => this.persistence?.saveState(snapshot))
      .catch((error) => {
        this.persistenceError =
          error instanceof Error ? error : new Error(String(error));
        console.error(
          "Falha ao persistir estado fiscal no Supabase:",
          this.persistenceError.message
        );
      });
  }
}
