import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import type {
  PersistenceChanges,
  StoreSnapshotState,
  SupabasePersistence
} from "./lib/supabase-persistence.js";
import type {
  AccessTokenRecord,
  ApiClient,
  Certificate,
  DocumentEventLevel,
  DocumentEventRecord,
  DocumentRecord,
  DocumentStatus,
  DocumentType,
  DistributionDocumentRecord,
  DistributionManifestationRecord,
  DistributionRecord,
  Environment,
  InutilizationRecord,
  Issuer,
  SefazDocumentType,
  ServiceConfig,
  ServiceType,
  ReturnCfopRule
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

function definedSettings(settings: ServiceConfig["settings"] | undefined) {
  return Object.fromEntries(
    Object.entries(settings ?? {}).filter(([, value]) => value !== undefined)
  ) as ServiceConfig["settings"];
}

function documentRoutePrefix(tipoDocumento: DocumentType) {
  if (tipoDocumento === "NFe") return "nfe";
  if (tipoDocumento === "NFCe") return "nfce";
  return "nfse";
}

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
    allowedScopes: ["empresa", "nfe", "nfce", "nfse", "distribuicao-nfe"],
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
  documentEvents: DocumentEventRecord[];
  inutilizations: InutilizationRecord[];
  distributions: DistributionRecord[];
  distributionDocuments: DistributionDocumentRecord[];
  distributionManifestations: DistributionManifestationRecord[];
  returnCfopRules: ReturnCfopRule[];
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
    this.documentEvents = [];
    this.inutilizations = [];
    this.distributions = [];
    this.distributionDocuments = [];
    this.distributionManifestations = [];
    this.returnCfopRules = [];
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
      state.documents.length ||
      state.returnCfopRules.length
    ) {
      this.issuers = state.issuers;
      this.certificates = state.certificates;
      this.serviceConfigs = state.serviceConfigs;
      this.documents = state.documents;
      this.documentEvents = state.documentEvents;
      this.inutilizations = state.inutilizations;
      this.distributions = state.distributions;
      this.distributionDocuments = state.distributionDocuments;
      this.distributionManifestations = state.distributionManifestations;
      this.returnCfopRules = state.returnCfopRules;
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
    this.saveState({ issuers: [issuer] });
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
      id: randomUUID(),
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
    this.saveState({ certificates: [certificate] });
    return certificate;
  }

  findActiveCertificate(cnpj: string) {
    return this.certificates.find((item) => item.cnpj === cnpj && item.active) ?? null;
  }

  findServiceConfig(cnpj: string, ambiente: Environment, serviceType: ServiceType) {
    const serviceConfig = this.findServiceConfigRecord(cnpj, ambiente, serviceType);
    return serviceConfig?.active ? serviceConfig : null;
  }

  findServiceConfigRecord(cnpj: string, ambiente: Environment, serviceType: ServiceType) {
    return (
      this.serviceConfigs.find(
        (item) =>
          item.cnpj === cnpj &&
          item.ambiente === ambiente &&
          item.serviceType === serviceType
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
      this.saveState({ issuers: [existing] });
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
    this.saveState({ issuers: [issuer] });
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

    const existing = this.findServiceConfigRecord(cnpj, ambiente, serviceType);
    if (existing) {
      existing.active = input.active ?? existing.active;
      existing.settings = {
        ...existing.settings,
        ...definedSettings(input.settings)
      };
      if (!input.preserveSecrets) {
        existing.secretsEncrypted = input.secretsEncrypted ?? null;
      }
      existing.updatedAt = nowIso();
      this.saveState({ serviceConfigs: [existing] });
      return existing;
    }

    const serviceConfig: ServiceConfig = {
      id: randomUUID(),
      issuerId: issuer.id,
      cnpj,
      ambiente,
      serviceType,
      active: input.active ?? true,
      settings: definedSettings(input.settings),
      secretsEncrypted: input.preserveSecrets ? null : input.secretsEncrypted ?? null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    this.serviceConfigs.push(serviceConfig);
    this.saveState({ serviceConfigs: [serviceConfig] });
    return serviceConfig;
  }

  createDocument(input: CreateDocumentInput) {
    const issuer = this.findIssuerByCnpj(input.issuerCnpj, input.ambiente);
    const existingCount = this.documents.filter(
      (item) => item.issuerCnpj === input.issuerCnpj && item.tipoDocumento === input.tipoDocumento
    ).length;
    const payload = input.payloadOriginal as Record<string, unknown>;
    const infNFe =
      typeof payload.infNFe === "object" && payload.infNFe !== null
        ? (payload.infNFe as Record<string, unknown>)
        : payload;
    const ide =
      typeof infNFe.ide === "object" && infNFe.ide !== null
        ? (infNFe.ide as Record<string, unknown>)
        : {};
    const payloadNumero = Number(ide.nNF);
    const payloadSerie = Number(ide.serie);
    const fallbackSerie = issuer
      ? input.tipoDocumento === "NFe"
        ? issuer.serieNfe
        : input.tipoDocumento === "NFCe"
          ? issuer.serieNfce
          : 1
      : 1;
    const numero =
      Number.isInteger(payloadNumero) && payloadNumero > 0
        ? payloadNumero
        : existingCount + 1;
    const serie =
      Number.isInteger(payloadSerie) && payloadSerie > 0
        ? payloadSerie
        : fallbackSerie;
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
      pdfUrl: `/${documentRoutePrefix(input.tipoDocumento)}/${id}/pdf`,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    this.documents.unshift(document);
    this.saveState({ documents: [document] });
    return document;
  }

  findDocument(id: string, tipoDocumento?: DocumentType) {
    return this.documents.find(
      (item) => item.id === id && (!tipoDocumento || item.tipoDocumento === tipoDocumento)
    ) ?? null;
  }

  createDistribution(input: Omit<DistributionRecord, "id" | "status" | "ultNsu" | "maxNsu" | "codigoStatus" | "motivoStatus" | "requestXml" | "responseXml" | "createdAt" | "updatedAt">) {
    const record: DistributionRecord = {
      ...input,
      id: `dist_${randomUUID().slice(0, 12)}`,
      status: "processando",
      ultNsu: null,
      maxNsu: null,
      codigoStatus: null,
      motivoStatus: null,
      requestXml: null,
      responseXml: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    this.distributions.unshift(record);
    this.saveState({ distributions: [record] });
    return record;
  }

  findDistribution(id: string) {
    return this.distributions.find((item) => item.id === id) ?? null;
  }

  listDistributions(cnpj: string, ambiente: Environment) {
    return this.distributions.filter((item) => item.cnpj === cnpj && item.ambiente === ambiente);
  }

  saveDistributionResult(id: string, input: Partial<Omit<DistributionRecord, "id" | "cnpj" | "ambiente" | "modo" | "nsu" | "chave" | "createdAt">>) {
    const record = this.findDistribution(id);
    if (!record) return null;
    Object.assign(record, input, { updatedAt: nowIso() });
    this.saveState({ distributions: [record] });
    return record;
  }

  addDistributionDocument(input: Omit<DistributionDocumentRecord, "id" | "createdAt">) {
    const existing = this.distributionDocuments.find((item) => item.cnpj === input.cnpj && item.ambiente === input.ambiente && item.nsu === input.nsu);
    if (existing) {
      Object.assign(existing, input);
      this.saveState({ distributionDocuments: [existing] });
      return existing;
    }
    const record: DistributionDocumentRecord = { ...input, id: `distdoc_${randomUUID().slice(0, 12)}`, createdAt: nowIso() };
    this.distributionDocuments.unshift(record);
    this.saveState({ distributionDocuments: [record] });
    return record;
  }

  findDistributionDocument(id: string) {
    return this.distributionDocuments.find((item) => item.id === id) ?? null;
  }

  listDistributionDocuments(cnpj: string, ambiente: Environment) {
    return this.distributionDocuments.filter((item) => item.cnpj === cnpj && item.ambiente === ambiente);
  }

  createDistributionManifestation(input: Omit<DistributionManifestationRecord, "id" | "status" | "codigoStatus" | "motivoStatus" | "protocolo" | "requestXml" | "responseXml" | "xml" | "createdAt" | "updatedAt">) {
    const record: DistributionManifestationRecord = { ...input, id: `manif_${randomUUID().slice(0, 12)}`, status: "processando", codigoStatus: null, motivoStatus: null, protocolo: null, requestXml: null, responseXml: null, xml: null, createdAt: nowIso(), updatedAt: nowIso() };
    this.distributionManifestations.unshift(record);
    this.saveState({ distributionManifestations: [record] });
    return record;
  }

  findDistributionManifestation(id: string) {
    return this.distributionManifestations.find((item) => item.id === id) ?? null;
  }

  saveDistributionManifestation(id: string, input: Partial<Omit<DistributionManifestationRecord, "id" | "cnpj" | "ambiente" | "chave" | "tipoEvento" | "justificativa" | "createdAt">>) {
    const record = this.findDistributionManifestation(id);
    if (!record) return null;
    Object.assign(record, input, { updatedAt: nowIso() });
    this.saveState({ distributionManifestations: [record] });
    return record;
  }

  addDocumentEvent(
    documentId: string,
    input: {
      eventType: string;
      level?: DocumentEventLevel;
      message: string;
      payload?: Record<string, unknown>;
    }
  ) {
    const event: DocumentEventRecord = {
      id: randomUUID(),
      documentId,
      eventType: input.eventType,
      level: input.level ?? "info",
      message: input.message,
      payload: input.payload ?? {},
      createdAt: nowIso()
    };
    this.documentEvents.unshift(event);
    this.saveState({ documentEvents: [event] });
    return event;
  }

  getDocumentEvents(documentId: string) {
    return this.documentEvents.filter((event) => event.documentId === documentId);
  }

  listReturnCfopRules(cnpj?: string) {
    return this.returnCfopRules.filter((rule) =>
      rule.active && (!cnpj || !rule.companyCnpj || rule.companyCnpj === cnpj)
    );
  }

  upsertReturnCfopRule(input: Omit<ReturnCfopRule, "id" | "createdAt" | "updatedAt"> & { id?: string }) {
    const now = nowIso();
    const existing = input.id ? this.returnCfopRules.find((rule) => rule.id === input.id) : undefined;
    const rule: ReturnCfopRule = {
      id: existing?.id ?? `returncfop_${randomUUID().slice(0, 12)}`,
      companyCnpj: input.companyCnpj ?? null,
      sourceCfop: input.sourceCfop ?? null,
      profile: input.profile,
      conditions: input.conditions ?? {},
      sameStateCfop: input.sameStateCfop ?? null,
      interstateCfop: input.interstateCfop ?? null,
      riskLevel: input.riskLevel,
      active: input.active,
      source: input.source,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    if (existing) Object.assign(existing, rule);
    else this.returnCfopRules.unshift(rule);
    this.saveState({ returnCfopRules: [rule] });
    return rule;
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

    if (document.tipoDocumento === "NFSe") {
      document.status = "autorizado";
      document.protocolo = protocol;
      document.motivo = "NFS-e autorizada manualmente no ambiente local";
      document.motivoStatus = "100";
      document.xml = document.xmlSigned ?? document.xmlGenerated ?? document.xml;
      document.updatedAt = nowIso();
      this.saveState({ documents: [document] });
      return document;
    }

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
    this.saveState({ documents: [document] });
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
    this.saveState({ documents: [document] });
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
    this.saveState({ documents: [document] });
    return document;
  }

  saveMunicipalProcessingResult(
    id: string,
    input: {
      providerName?: string | null;
      generatedXml?: string | null;
      signedXml?: string | null;
      requestBody?: string | null;
      responseBody?: string | null;
      providerReference?: string | null;
      status?: DocumentStatus;
      reason?: string | null;
      reasonCode?: string | null;
      protocol?: string | null;
      providerDocumentNumber?: string | null;
      processedXml?: string | null;
      signatureValid?: boolean;
      xsdValid?: boolean;
      xsdErrors?: string[];
    }
  ) {
    const document = this.findDocument(id, "NFSe");
    if (!document) {
      return null;
    }

    document.xmlGenerated = input.generatedXml ?? document.xmlGenerated ?? null;
    document.xmlSigned = input.signedXml ?? document.xmlSigned ?? null;
    document.providerName = input.providerName ?? document.providerName ?? null;
    document.providerRequestBody =
      input.requestBody ?? document.providerRequestBody ?? null;
    document.providerResponseBody =
      input.responseBody ?? document.providerResponseBody ?? null;
    document.providerReference =
      input.providerReference ?? document.providerReference ?? null;
    document.status = input.status ?? document.status;
    document.motivo = input.reason ?? document.motivo;
    document.motivoStatus = input.reasonCode ?? document.motivoStatus;
    document.protocolo = input.protocol ?? document.protocolo;
    document.chave = input.providerDocumentNumber ?? document.chave;
    document.signatureValid = input.signatureValid ?? document.signatureValid;
    document.xsdValid = input.xsdValid ?? document.xsdValid;
    document.xsdErrors = input.xsdErrors ?? document.xsdErrors;
    if (input.processedXml) {
      document.xml = input.processedXml;
    }
    document.updatedAt = nowIso();
    this.saveState({ documents: [document] });
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
    this.saveState({ documents: [document] });
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
    this.saveState({ documents: [document] });
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
    this.saveState({ documents: [document] });
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
      pdfUrl: `/${documentRoutePrefix(tipoDocumento)}/${id}/pdf`,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    this.documents.unshift(document);
    this.saveState({ documents: [document] });
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
      cancelledAt?: string | null;
      success?: boolean;
      status?: DocumentStatus;
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
    const successful =
      input.success === true || ["135", "136", "155"].includes(input.statusCode);
    if (successful) {
      document.cancelledAt = input.cancelledAt || nowIso();
      document.status = "cancelado";
    } else if (input.status) {
      document.status = input.status;
    }
    document.mensagens = [
      {
        codigo: input.statusCode,
        descricao: input.reason
      }
    ];
    document.updatedAt = nowIso();
    this.saveState({ documents: [document] });
    return document;
  }

  createInutilization(input: {
    tipoDocumento: SefazDocumentType;
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
    this.saveState({ inutilizations: [record] });
    return record;
  }

  findInutilization(id: string, tipoDocumento?: SefazDocumentType) {
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
    this.saveState({ inutilizations: [record] });
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
    this.saveState({ inutilizations: [record] });
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
      documentEvents: this.documentEvents,
      inutilizations: this.inutilizations,
      distributions: this.distributions,
      distributionDocuments: this.distributionDocuments,
      distributionManifestations: this.distributionManifestations,
      returnCfopRules: this.returnCfopRules,
      summary: {
        clients: this.apiClients.length,
        issuers: this.issuers.length,
        certificates: this.certificates.length,
        serviceConfigs: this.serviceConfigs.length,
        documents: this.documents.length,
        documentEvents: this.documentEvents.length,
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
        documentEvents?: DocumentEventRecord[];
        inutilizations?: InutilizationRecord[];
        distributions?: DistributionRecord[];
        distributionDocuments?: DistributionDocumentRecord[];
        distributionManifestations?: DistributionManifestationRecord[];
        returnCfopRules?: ReturnCfopRule[];
      };
      this.issuers = state.issuers ?? this.issuers;
      this.certificates = state.certificates ?? [];
      this.serviceConfigs = state.serviceConfigs ?? [];
      this.documents = state.documents ?? [];
      this.documentEvents = state.documentEvents ?? [];
      this.inutilizations = state.inutilizations ?? [];
      this.distributions = state.distributions ?? [];
      this.distributionDocuments = state.distributionDocuments ?? [];
      this.distributionManifestations = state.distributionManifestations ?? [];
      this.returnCfopRules = state.returnCfopRules ?? [];
    } catch {
      // A falha de leitura nao deve impedir o servidor de desenvolvimento de subir.
    }
  }

  private saveState(changes: PersistenceChanges) {
    this.writeLocalState();
    this.persistExternalChanges(changes);
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
          documentEvents: this.documentEvents,
          inutilizations: this.inutilizations,
          distributions: this.distributions,
          distributionDocuments: this.distributionDocuments,
          distributionManifestations: this.distributionManifestations,
          returnCfopRules: this.returnCfopRules
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
      documentEvents: this.documentEvents,
      inutilizations: this.inutilizations,
      distributions: this.distributions,
      distributionDocuments: this.distributionDocuments,
      distributionManifestations: this.distributionManifestations,
      returnCfopRules: this.returnCfopRules
    };
  }

  private persistExternalChanges(changes: PersistenceChanges) {
    if (!this.persistence) {
      return;
    }

    const snapshot = structuredClone(this.currentState()) as StoreSnapshotState;
    const changedSnapshot = structuredClone(changes) as PersistenceChanges;
    this.persistenceError = null;
    this.persistQueue = this.persistQueue
      .then(() => this.persistence?.saveChanges(snapshot, changedSnapshot))
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
