import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type {
  Certificate,
  DocumentEventRecord,
  DocumentRecord,
  DistributionDocumentRecord,
  DistributionManifestationRecord,
  DistributionRecord,
  InutilizationRecord,
  Issuer,
  MessageItem,
  ReturnCfopRule,
  ServiceConfig
} from "../types.js";

export type StoreSnapshotState = {
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
};

export type PersistenceChanges = Partial<StoreSnapshotState>;

type FiscalCompanyRow = {
  id: string;
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  active: boolean;
  metadata: Record<string, unknown> | null;
};

type FiscalEnvironmentRow = {
  id: string;
  company_id: string;
  environment: "homologacao" | "producao";
  uf: string;
  ie: string;
  crt: string;
  serie_nfe: number;
  serie_nfce: number;
  active: boolean;
};

type FiscalCertificateRow = {
  id: string;
  cnpj: string;
  file_name: string;
  uploaded_at: string;
  valid_from: string | null;
  valid_until: string | null;
  serial_number: string | null;
  subject: string | null;
  holder_cnpj: string | null;
  encrypted_bundle: string;
  active: boolean;
};

type FiscalDocumentRow = {
  id: string;
  provider_like_id: string;
  document_type: "NFe" | "NFCe" | "NFSe";
  environment: "homologacao" | "producao";
  status: "processamento" | "autorizado" | "rejeitado" | "cancelado" | "erro";
  issuer_cnpj: string;
  number: number;
  serie: number;
  access_key: string | null;
  protocol: string | null;
  reason: string | null;
  reason_code: string | null;
  messages: unknown;
  payload_original: unknown;
  payload_normalized: unknown;
  authorized_xml: string;
  generated_xml: string | null;
  signed_xml: string | null;
  signature_valid: boolean;
  xsd_valid: boolean;
  xsd_errors: unknown;
  certificate_id: string | null;
  nfce_config_encrypted: string | null;
  provider_name: string | null;
  provider_request_body: string | null;
  provider_response_body: string | null;
  provider_reference: string | null;
  sefaz_batch_id: string | null;
  sefaz_receipt: string | null;
  sefaz_response_xml: string | null;
  cancellation_justification: string | null;
  cancellation_status_code: string | null;
  cancellation_reason: string | null;
  cancellation_protocol: string | null;
  cancellation_request_xml: string | null;
  cancellation_signed_xml: string | null;
  cancellation_response_xml: string | null;
  cancellation_processed_xml: string | null;
  cancelled_at: string | null;
  pdf_url: string | null;
  created_at: string;
  updated_at: string;
};

type FiscalServiceConfigRow = {
  id: string;
  company_environment_id: string;
  service_type: "NFE" | "NFCE" | "NFSE";
  active: boolean;
  settings: Record<string, unknown> | null;
  secrets_encrypted: string | null;
  created_at: string;
  updated_at: string;
};

type FiscalDocumentEventRow = {
  id: string;
  document_id: string;
  event_type: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  payload: Record<string, unknown> | null;
  created_at: string;
};

type FiscalInutilizationRow = {
  id: string;
  provider_like_id: string;
  document_type: "NFe" | "NFCe";
  environment: "homologacao" | "producao";
  status: "processamento" | "homologado" | "rejeitado" | "erro";
  issuer_cnpj: string;
  year: number;
  serie: number;
  number_initial: number;
  number_final: number;
  justification: string;
  protocol: string | null;
  reason: string | null;
  reason_code: string | null;
  request_xml: string | null;
  signed_xml: string | null;
  response_xml: string | null;
  created_at: string;
  updated_at: string;
};

type FiscalReturnCfopRuleRow = {
  id: string;
  company_id: string | null;
  source_cfop: string | null;
  profile: string;
  conditions: Record<string, unknown> | null;
  same_state_cfop: string | null;
  interstate_cfop: string | null;
  risk_level: "low" | "medium" | "high";
  active: boolean;
  source: string;
  created_at: string;
  updated_at: string;
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

const DOCUMENT_PERSISTENCE_BATCH_SIZE = 25;
const TRANSIENT_FETCH_ATTEMPTS = 3;

export function chunkForPersistence<T>(items: T[], size = DOCUMENT_PERSISTENCE_BATCH_SIZE) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isTransientFetchError(error: { message?: string } | null) {
  return /fetch failed/i.test(String(error?.message ?? ""));
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class SupabasePersistence {
  private readonly client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }

  async loadState(): Promise<StoreSnapshotState> {
    const [
      companiesResult,
      environmentsResult,
      certificatesResult,
      serviceConfigsResult,
      documentsResult,
      documentEventsResult,
      returnCfopRulesResult
    ] = await Promise.all([
      this.client.from("fiscal_companies").select("*").order("created_at"),
      this.client.from("fiscal_company_environments").select("*").order("created_at"),
      this.client.from("fiscal_certificates").select("*").order("uploaded_at"),
      this.client.from("fiscal_service_configs").select("*").order("created_at"),
      this.client.from("fiscal_documents").select("*").order("created_at", { ascending: false }),
      this.client
        .from("fiscal_document_events")
        .select("*")
        .order("created_at", { ascending: false }),
      this.client
        .from("fiscal_return_cfop_rules")
        .select("*")
        .order("created_at")
    ]);

    const error =
      companiesResult.error ??
      environmentsResult.error ??
      certificatesResult.error ??
      serviceConfigsResult.error ??
      documentsResult.error ??
      documentEventsResult.error ??
      returnCfopRulesResult.error;
    if (error) {
      throw new Error(`Falha ao carregar estado fiscal do Supabase: ${error.message}`);
    }
    const inutilizationsResult = await this.client
      .from("fiscal_inutilizations")
      .select("*")
      .order("created_at", { ascending: false });
    const [distributionsResult, distributionDocumentsResult, distributionManifestationsResult] = await Promise.all([
      this.client.from("fiscal_nfe_distributions").select("*").order("created_at", { ascending: false }),
      this.client.from("fiscal_nfe_distribution_documents").select("*").order("created_at", { ascending: false }),
      this.client.from("fiscal_nfe_distribution_manifestations").select("*").order("created_at", { ascending: false })
    ]);
    const distributionError = distributionsResult.error ?? distributionDocumentsResult.error ?? distributionManifestationsResult.error;
    if (distributionError) throw new Error(`Falha ao carregar distribuicao NF-e do Supabase: ${distributionError.message}`);

    const companies = (companiesResult.data ?? []) as FiscalCompanyRow[];
    const companiesById = new Map(companies.map((company) => [company.id, company]));
    const companyCnpjById = new Map(companies.map((company) => [company.id, company.cnpj]));
    const environments = (environmentsResult.data ?? []) as FiscalEnvironmentRow[];
    const environmentById = new Map(environments.map((environment) => [environment.id, environment]));
    const issuers = environments.flatMap(
      (environment) => {
        const company = companiesById.get(environment.company_id);
        if (!company) {
          return [];
        }
        return [
          {
            id: environment.id,
            cnpj: company.cnpj,
            razaoSocial: company.razao_social,
            nomeFantasia: company.nome_fantasia,
            ambiente: environment.environment,
            uf: environment.uf,
            ie: environment.ie,
            crt: environment.crt,
            serieNfe: environment.serie_nfe,
            serieNfce: environment.serie_nfce,
            ativo: environment.active,
            metadata: (company.metadata ?? {}) as Record<string, unknown>
          } satisfies Issuer
        ];
      }
    );

    const issuerByCnpj = new Map(issuers.map((issuer) => [issuer.cnpj, issuer]));
    const returnCfopRules = ((returnCfopRulesResult.data ?? []) as FiscalReturnCfopRuleRow[]).map(
      (rule): ReturnCfopRule => ({
        id: rule.id,
        companyCnpj: rule.company_id ? companyCnpjById.get(rule.company_id) ?? null : null,
        sourceCfop: rule.source_cfop,
        profile: rule.profile,
        conditions: rule.conditions ?? {},
        sameStateCfop: rule.same_state_cfop,
        interstateCfop: rule.interstate_cfop,
        riskLevel: rule.risk_level,
        active: rule.active,
        source: rule.source,
        createdAt: rule.created_at,
        updatedAt: rule.updated_at
      })
    );
    const certificates = ((certificatesResult.data ?? []) as FiscalCertificateRow[]).map(
      (certificate) => ({
        id: certificate.id,
        issuerId: issuerByCnpj.get(certificate.cnpj)?.id ?? certificate.cnpj,
        cnpj: certificate.cnpj,
        fileName: certificate.file_name,
        uploadedAt: certificate.uploaded_at,
        validFrom: certificate.valid_from,
        validUntil: certificate.valid_until,
        serialNumber: certificate.serial_number,
        subject: certificate.subject,
        holderCnpj: certificate.holder_cnpj,
        encryptedBundle: certificate.encrypted_bundle,
        active: certificate.active
      })
    );

    const serviceConfigs = ((serviceConfigsResult.data ?? []) as FiscalServiceConfigRow[]).flatMap(
      (serviceConfig) => {
        const environment = environmentById.get(serviceConfig.company_environment_id);
        if (!environment) {
          return [];
        }
        const company = companiesById.get(environment.company_id);
        if (!company) {
          return [];
        }
        return [
          {
            id: serviceConfig.id,
            issuerId: environment.id,
            cnpj: company.cnpj,
            ambiente: environment.environment,
            serviceType: serviceConfig.service_type,
            active: serviceConfig.active,
            settings: (serviceConfig.settings ?? {}) as ServiceConfig["settings"],
            secretsEncrypted: serviceConfig.secrets_encrypted,
            createdAt: serviceConfig.created_at,
            updatedAt: serviceConfig.updated_at
          } satisfies ServiceConfig
        ];
      }
    );

    const documents = ((documentsResult.data ?? []) as FiscalDocumentRow[]).map(
      (document) => ({
        id: document.id,
        providerLikeId: document.provider_like_id,
        tipoDocumento: document.document_type,
        issuerCnpj: document.issuer_cnpj,
        ambiente: document.environment,
        status: document.status,
        numero: document.number,
        serie: document.serie,
        chave: document.access_key,
        protocolo: document.protocol,
        motivo: document.reason,
        motivoStatus: document.reason_code,
        mensagens: asArray<MessageItem>(document.messages),
        payloadOriginal: document.payload_original,
        payloadNormalizado: document.payload_normalized,
        xml: document.authorized_xml,
        xmlGenerated: document.generated_xml,
        xmlSigned: document.signed_xml,
        signatureValid: document.signature_valid,
        xsdValid: document.xsd_valid,
        xsdErrors: asArray<string>(document.xsd_errors),
        certificateId: document.certificate_id,
        nfceConfigEncrypted: document.nfce_config_encrypted,
        providerName: document.provider_name,
        providerRequestBody: document.provider_request_body,
        providerResponseBody: document.provider_response_body,
        providerReference: document.provider_reference,
        sefazBatchId: document.sefaz_batch_id,
        sefazReceipt: document.sefaz_receipt,
        sefazResponseXml: document.sefaz_response_xml,
        cancellationJustification: document.cancellation_justification,
        cancellationStatusCode: document.cancellation_status_code,
        cancellationReason: document.cancellation_reason,
        cancellationProtocol: document.cancellation_protocol,
        cancellationRequestXml: document.cancellation_request_xml,
        cancellationSignedXml: document.cancellation_signed_xml,
        cancellationResponseXml: document.cancellation_response_xml,
        cancellationProcessedXml: document.cancellation_processed_xml,
        cancelledAt: document.cancelled_at,
        pdfUrl: document.pdf_url ?? "",
        createdAt: document.created_at,
        updatedAt: document.updated_at
      })
    );
    const inutilizations = inutilizationsResult.error
      ? []
      : ((inutilizationsResult.data ?? []) as FiscalInutilizationRow[]).map(
          (item): InutilizationRecord => ({
            id: item.id,
            providerLikeId: item.provider_like_id,
            tipoDocumento: item.document_type,
            issuerCnpj: item.issuer_cnpj,
            ambiente: item.environment,
            status: item.status,
            ano: item.year,
            serie: item.serie,
            numeroInicial: item.number_initial,
            numeroFinal: item.number_final,
            justificativa: item.justification,
            protocolo: item.protocol,
            motivo: item.reason,
            motivoStatus: item.reason_code,
            xmlPedido: item.request_xml,
            xmlAssinado: item.signed_xml,
            xmlResposta: item.response_xml,
            createdAt: item.created_at,
            updatedAt: item.updated_at
          })
        );

    const documentEvents = (
      (documentEventsResult.data ?? []) as FiscalDocumentEventRow[]
    ).map(
      (event): DocumentEventRecord => ({
        id: event.id,
        documentId: event.document_id,
        eventType: event.event_type,
        level: event.level,
        message: event.message,
        payload: event.payload ?? {},
        createdAt: event.created_at
      })
    );
    const distributions = (distributionsResult.data ?? []).map((item: any): DistributionRecord => ({
      id: item.id, cnpj: item.cnpj, ambiente: item.environment, status: item.status, modo: item.mode,
      nsu: item.nsu, chave: item.access_key, ultNsu: item.ult_nsu, maxNsu: item.max_nsu,
      codigoStatus: item.status_code, motivoStatus: item.status_reason, requestXml: item.request_xml,
      responseXml: item.response_xml, createdAt: item.created_at, updatedAt: item.updated_at
    }));
    const distributionDocuments = (distributionDocumentsResult.data ?? []).map((item: any): DistributionDocumentRecord => ({
      id: item.id, distributionId: item.distribution_id, cnpj: item.cnpj, ambiente: item.environment,
      nsu: item.nsu, schema: item.schema, tipoDocumento: item.document_type, formaDistribuicao: item.distribution_form,
      chave: item.access_key, xml: item.xml, createdAt: item.created_at
    }));
    const distributionManifestations = (distributionManifestationsResult.data ?? []).map((item: any): DistributionManifestationRecord => ({
      id: item.id, cnpj: item.cnpj, ambiente: item.environment, chave: item.access_key, tipoEvento: item.event_type,
      justificativa: item.justification, status: item.status, codigoStatus: item.status_code, motivoStatus: item.status_reason,
      protocolo: item.protocol, requestXml: item.request_xml, responseXml: item.response_xml, xml: item.xml,
      createdAt: item.created_at, updatedAt: item.updated_at
    }));

    return {
      issuers,
      certificates,
      serviceConfigs,
      documents,
      documentEvents,
      inutilizations, distributions, distributionDocuments, distributionManifestations, returnCfopRules
    };
  }

  async saveState(state: StoreSnapshotState) {
    const companyIds = await this.upsertCompanies(state.issuers);
    const environmentIds = await this.upsertEnvironments(state.issuers, companyIds);
    await this.upsertCertificates(state.certificates, companyIds);
    await this.upsertServiceConfigs(state.serviceConfigs, companyIds, environmentIds);
    await this.upsertDocuments(state.documents, companyIds, environmentIds);
    await this.upsertDocumentEvents(state.documentEvents);
    await this.upsertInutilizations(state.inutilizations, companyIds, environmentIds);
    await this.upsertDistributions(state.distributions, state.distributionDocuments, state.distributionManifestations);
    await this.upsertReturnCfopRules(state.returnCfopRules, companyIds);
  }

  async saveChanges(state: StoreSnapshotState, changes: PersistenceChanges) {
    // Empresas e ambientes formam as chaves estrangeiras dos demais registros.
    // São conjuntos pequenos; mantê-los sincronizados evita consultas adicionais.
    const companyIds = await this.upsertCompanies(state.issuers);
    const environmentIds = await this.upsertEnvironments(state.issuers, companyIds);

    if (changes.certificates) {
      await this.upsertCertificates(changes.certificates, companyIds);
    }
    if (changes.serviceConfigs) {
      await this.upsertServiceConfigs(changes.serviceConfigs, companyIds, environmentIds);
    }
    if (changes.documents) {
      await this.upsertDocuments(changes.documents, companyIds, environmentIds);
    }
    if (changes.documentEvents) {
      await this.upsertDocumentEvents(changes.documentEvents);
    }
    if (changes.inutilizations) {
      await this.upsertInutilizations(changes.inutilizations, companyIds, environmentIds);
    }
    if (changes.distributions || changes.distributionDocuments || changes.distributionManifestations) {
      await this.upsertDistributions(changes.distributions ?? [], changes.distributionDocuments ?? [], changes.distributionManifestations ?? []);
    }
    if (changes.returnCfopRules) {
      await this.upsertReturnCfopRules(changes.returnCfopRules, companyIds);
    }
  }

  private async upsertDocumentEvents(events: DocumentEventRecord[]) {
    if (!events.length) {
      return;
    }
    const rows = events.map((event) => ({
      id: event.id,
      document_id: event.documentId,
      event_type: event.eventType,
      level: event.level,
      message: event.message,
      payload: event.payload,
      created_at: event.createdAt
    }));
    const { error } = await this.client
      .from("fiscal_document_events")
      .upsert(rows, { onConflict: "id" });
    if (error) {
      throw new Error(`Falha ao salvar eventos fiscais: ${error.message}`);
    }
  }

  private async upsertReturnCfopRules(rules: ReturnCfopRule[], companyIds: Map<string, string>) {
    if (!rules.length) return;
    const missingCompanyRule = rules.find(
      (rule) => rule.companyCnpj && !companyIds.has(rule.companyCnpj)
    );
    if (missingCompanyRule?.companyCnpj) {
      throw new Error(
        `Nao foi possivel salvar a regra de devolucao: empresa ${missingCompanyRule.companyCnpj} nao existe no cadastro fiscal.`
      );
    }
    const rows = rules.map((rule) => ({
      id: rule.id,
      company_id: rule.companyCnpj ? companyIds.get(rule.companyCnpj) ?? null : null,
      source_cfop: rule.sourceCfop,
      profile: rule.profile,
      conditions: rule.conditions ?? {},
      same_state_cfop: rule.sameStateCfop,
      interstate_cfop: rule.interstateCfop,
      risk_level: rule.riskLevel,
      active: rule.active,
      source: rule.source,
      created_at: rule.createdAt,
      updated_at: rule.updatedAt
    }));
    const { error } = await this.client
      .from("fiscal_return_cfop_rules")
      .upsert(rows, { onConflict: "id" });
    if (error) {
      throw new Error(`Falha ao salvar regras de devolucao CFOP: ${error.message}`);
    }
  }

  private async upsertCompanies(issuers: Issuer[]) {
    const companies = new Map<string, {
      cnpj: string;
      razao_social: string;
      nome_fantasia: string;
      active: boolean;
      metadata: Record<string, unknown>;
    }>();

    for (const issuer of issuers) {
      if (!companies.has(issuer.cnpj)) {
        companies.set(issuer.cnpj, {
          cnpj: issuer.cnpj,
          razao_social: issuer.razaoSocial,
          nome_fantasia: issuer.nomeFantasia,
          active: issuer.ativo,
          metadata: issuer.metadata ?? {}
        });
      }
    }

    if (!companies.size) {
      return new Map<string, string>();
    }

    const { data, error } = await this.client
      .from("fiscal_companies")
      .upsert(Array.from(companies.values()), { onConflict: "cnpj" })
      .select("id, cnpj");
    if (error) {
      throw new Error(`Falha ao salvar empresas fiscais: ${error.message}`);
    }

    return new Map((data ?? []).map((company) => [company.cnpj as string, company.id as string]));
  }

  private async upsertEnvironments(issuers: Issuer[], companyIds: Map<string, string>) {
    const rows = issuers.flatMap((issuer) => {
      const companyId = companyIds.get(issuer.cnpj);
      if (!companyId) {
        return [];
      }
      return [
        {
          company_id: companyId,
          environment: issuer.ambiente,
          uf: issuer.uf || "PR",
          ie: issuer.ie ?? "",
          crt: issuer.crt ?? "",
          serie_nfe: issuer.serieNfe,
          serie_nfce: issuer.serieNfce,
          active: issuer.ativo
        }
      ];
    });

    if (!rows.length) {
      return new Map<string, string>();
    }

    const { data, error } = await this.client
      .from("fiscal_company_environments")
      .upsert(rows, { onConflict: "company_id,environment" })
      .select("id, company_id, environment");
    if (error) {
      throw new Error(`Falha ao salvar ambientes fiscais: ${error.message}`);
    }

    const ids = new Map<string, string>();
    for (const row of data ?? []) {
      ids.set(`${row.company_id}:${row.environment}`, row.id as string);
    }
    return ids;
  }

  private async upsertCertificates(certificates: Certificate[], companyIds: Map<string, string>) {
    const cnpjs = [...new Set(certificates.map((certificate) => certificate.cnpj))];
    const existingIds = new Map<string, string>();
    if (cnpjs.length) {
      const { data, error } = await this.client
        .from("fiscal_certificates")
        .select("id, cnpj")
        .in("cnpj", cnpjs)
        .eq("active", true);
      if (error) {
        throw new Error(`Falha ao consultar certificados fiscais: ${error.message}`);
      }
      for (const certificate of data ?? []) {
        existingIds.set(certificate.cnpj as string, certificate.id as string);
      }
    }

    const rows = certificates.flatMap((certificate) => {
      const companyId = companyIds.get(certificate.cnpj);
      if (!companyId) {
        return [];
      }
      const persistedId = existingIds.get(certificate.cnpj) ?? certificate.id;
      return [
        {
          ...(persistedId ? { id: persistedId } : {}),
          company_id: companyId,
          cnpj: certificate.cnpj,
          file_name: certificate.fileName,
          uploaded_at: certificate.uploadedAt,
          valid_from: certificate.validFrom,
          valid_until: certificate.validUntil,
          serial_number: certificate.serialNumber,
          subject: certificate.subject,
          holder_cnpj: certificate.holderCnpj,
          encrypted_bundle: certificate.encryptedBundle,
          active: certificate.active
        }
      ];
    });

    if (!rows.length) {
      return;
    }

    const { error } = await this.client
      .from("fiscal_certificates")
      .upsert(rows, { onConflict: "id" });
    if (error) {
      throw new Error(`Falha ao salvar certificados fiscais: ${error.message}`);
    }
  }

  private async upsertDocuments(
    documents: DocumentRecord[],
    companyIds: Map<string, string>,
    environmentIds: Map<string, string>
  ) {
    const rows = documents.flatMap((document) => {
      const companyId = companyIds.get(document.issuerCnpj);
      const environmentId = companyId
        ? environmentIds.get(`${companyId}:${document.ambiente}`)
        : null;
      if (!companyId || !environmentId) {
        return [];
      }
      return [
        {
          id: document.id,
          provider_like_id: document.providerLikeId,
          company_id: companyId,
          company_environment_id: environmentId,
          certificate_id:
            document.certificateId && !document.certificateId.startsWith("cert_")
              ? document.certificateId
              : null,
          document_type: document.tipoDocumento,
          environment: document.ambiente,
          status: document.status,
          issuer_cnpj: document.issuerCnpj,
          number: document.numero,
          serie: document.serie,
          access_key: document.chave,
          protocol: document.protocolo,
          reason: document.motivo,
          reason_code: document.motivoStatus,
          messages: document.mensagens,
          payload_original: document.payloadOriginal ?? {},
          payload_normalized: document.payloadNormalizado ?? {},
          authorized_xml: document.xml,
          generated_xml: document.xmlGenerated ?? null,
          signed_xml: document.xmlSigned ?? null,
          signature_valid: Boolean(document.signatureValid),
          xsd_valid: Boolean(document.xsdValid),
          xsd_errors: document.xsdErrors ?? [],
          nfce_config_encrypted: document.nfceConfigEncrypted ?? null,
          provider_name: document.providerName ?? null,
          provider_request_body: document.providerRequestBody ?? null,
          provider_response_body: document.providerResponseBody ?? null,
          provider_reference: document.providerReference ?? null,
          sefaz_batch_id: document.sefazBatchId ?? null,
          sefaz_receipt: document.sefazReceipt ?? null,
          sefaz_response_xml: document.sefazResponseXml ?? null,
          cancellation_justification: document.cancellationJustification ?? null,
          cancellation_status_code: document.cancellationStatusCode ?? null,
          cancellation_reason: document.cancellationReason ?? null,
          cancellation_protocol: document.cancellationProtocol ?? null,
          cancellation_request_xml: document.cancellationRequestXml ?? null,
          cancellation_signed_xml: document.cancellationSignedXml ?? null,
          cancellation_response_xml: document.cancellationResponseXml ?? null,
          cancellation_processed_xml: document.cancellationProcessedXml ?? null,
          cancelled_at: document.cancelledAt ?? null,
          pdf_url: document.pdfUrl,
          created_at: document.createdAt,
          updated_at: document.updatedAt
        }
      ];
    });

    if (!rows.length) {
      return;
    }

    // Documentos carregam XMLs e respostas completas. Persistir todo o histórico
    // em uma única requisição faz o payload crescer indefinidamente e pode causar
    // encerramento da conexão pelo gateway do Supabase.
    for (const batch of chunkForPersistence(rows)) {
      let persisted = false;
      for (let attempt = 1; attempt <= TRANSIENT_FETCH_ATTEMPTS; attempt += 1) {
        const { error } = await this.client
          .from("fiscal_documents")
          .upsert(batch, { onConflict: "id" });
        if (!error) {
          persisted = true;
          break;
        }
        if (!isTransientFetchError(error) || attempt === TRANSIENT_FETCH_ATTEMPTS) {
          throw new Error(
            `Falha ao salvar documentos fiscais (lote com ${batch.length} registros, tentativa ${attempt}): ${error.message}`
          );
        }
        await wait(attempt * 250);
      }
      if (!persisted) {
        throw new Error("Falha ao salvar documentos fiscais apos repeticoes de rede.");
      }
    }
  }

  private async upsertServiceConfigs(
    serviceConfigs: ServiceConfig[],
    companyIds: Map<string, string>,
    environmentIds: Map<string, string>
  ) {
    const rows = serviceConfigs.flatMap((serviceConfig) => {
      const companyId = companyIds.get(serviceConfig.cnpj);
      const environmentId = companyId
        ? environmentIds.get(`${companyId}:${serviceConfig.ambiente}`)
        : null;
      if (!companyId || !environmentId) {
        return [];
      }
      return [
        {
          ...(serviceConfig.id.startsWith("svc_") ? {} : { id: serviceConfig.id }),
          company_environment_id: environmentId,
          service_type: serviceConfig.serviceType,
          active: serviceConfig.active,
          settings: serviceConfig.settings ?? {},
          secrets_encrypted: serviceConfig.secretsEncrypted ?? null,
          created_at: serviceConfig.createdAt,
          updated_at: serviceConfig.updatedAt
        }
      ];
    });

    if (!rows.length) {
      return;
    }

    const { error } = await this.client
      .from("fiscal_service_configs")
      .upsert(rows, { onConflict: "company_environment_id,service_type" });
    if (error) {
      throw new Error(`Falha ao salvar configuracoes de servico fiscal: ${error.message}`);
    }
  }

  private async upsertInutilizations(
    inutilizations: InutilizationRecord[],
    companyIds: Map<string, string>,
    environmentIds: Map<string, string>
  ) {
    const rows = inutilizations.flatMap((record) => {
      const companyId = companyIds.get(record.issuerCnpj);
      const environmentId = companyId
        ? environmentIds.get(`${companyId}:${record.ambiente}`)
        : null;
      if (!companyId || !environmentId) {
        return [];
      }
      return [
        {
          id: record.id,
          provider_like_id: record.providerLikeId,
          company_id: companyId,
          company_environment_id: environmentId,
          document_type: record.tipoDocumento,
          environment: record.ambiente,
          status: record.status,
          issuer_cnpj: record.issuerCnpj,
          year: record.ano,
          serie: record.serie,
          number_initial: record.numeroInicial,
          number_final: record.numeroFinal,
          justification: record.justificativa,
          protocol: record.protocolo,
          reason: record.motivo,
          reason_code: record.motivoStatus,
          request_xml: record.xmlPedido,
          signed_xml: record.xmlAssinado,
          response_xml: record.xmlResposta,
          created_at: record.createdAt,
          updated_at: record.updatedAt
        }
      ];
    });

    if (!rows.length) {
      return;
    }

    const { error } = await this.client
      .from("fiscal_inutilizations")
      .upsert(rows, { onConflict: "id" });
    if (error) {
      throw new Error(`Falha ao salvar inutilizacoes fiscais: ${error.message}`);
    }
  }

  private async upsertDistributions(distributions: DistributionRecord[], documents: DistributionDocumentRecord[], manifestations: DistributionManifestationRecord[]) {
    if (distributions.length) {
      const { error } = await this.client.from("fiscal_nfe_distributions").upsert(distributions.map((item) => ({ id: item.id, cnpj: item.cnpj, environment: item.ambiente, status: item.status, mode: item.modo, nsu: item.nsu, access_key: item.chave, ult_nsu: item.ultNsu, max_nsu: item.maxNsu, status_code: item.codigoStatus, status_reason: item.motivoStatus, request_xml: item.requestXml, response_xml: item.responseXml, created_at: item.createdAt, updated_at: item.updatedAt })), { onConflict: "id" });
      if (error) throw new Error(`Falha ao salvar distribuicoes NF-e: ${error.message}`);
    }
    if (documents.length) {
      const { error } = await this.client.from("fiscal_nfe_distribution_documents").upsert(documents.map((item) => ({ id: item.id, distribution_id: item.distributionId, cnpj: item.cnpj, environment: item.ambiente, nsu: item.nsu, schema: item.schema, document_type: item.tipoDocumento, distribution_form: item.formaDistribuicao, access_key: item.chave, xml: item.xml, created_at: item.createdAt })), { onConflict: "id" });
      if (error) throw new Error(`Falha ao salvar documentos distribuidos: ${error.message}`);
    }
    if (manifestations.length) {
      const { error } = await this.client.from("fiscal_nfe_distribution_manifestations").upsert(manifestations.map((item) => ({ id: item.id, cnpj: item.cnpj, environment: item.ambiente, access_key: item.chave, event_type: item.tipoEvento, justification: item.justificativa, status: item.status, status_code: item.codigoStatus, status_reason: item.motivoStatus, protocol: item.protocolo, request_xml: item.requestXml, response_xml: item.responseXml, xml: item.xml, created_at: item.createdAt, updated_at: item.updatedAt })), { onConflict: "id" });
      if (error) throw new Error(`Falha ao salvar manifestacoes NF-e: ${error.message}`);
    }
  }
}
