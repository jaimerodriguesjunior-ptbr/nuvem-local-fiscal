import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type {
  Certificate,
  DocumentEventRecord,
  DocumentRecord,
  InutilizationRecord,
  Issuer,
  MessageItem,
  ServiceConfig
} from "../types.js";

export type StoreSnapshotState = {
  issuers: Issuer[];
  certificates: Certificate[];
  serviceConfigs: ServiceConfig[];
  documents: DocumentRecord[];
  documentEvents: DocumentEventRecord[];
  inutilizations: InutilizationRecord[];
};

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

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
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
      documentEventsResult
    ] = await Promise.all([
      this.client.from("fiscal_companies").select("*").order("created_at"),
      this.client.from("fiscal_company_environments").select("*").order("created_at"),
      this.client.from("fiscal_certificates").select("*").order("uploaded_at"),
      this.client.from("fiscal_service_configs").select("*").order("created_at"),
      this.client.from("fiscal_documents").select("*").order("created_at", { ascending: false }),
      this.client
        .from("fiscal_document_events")
        .select("*")
        .order("created_at", { ascending: false })
    ]);

    const error =
      companiesResult.error ??
      environmentsResult.error ??
      certificatesResult.error ??
      serviceConfigsResult.error ??
      documentsResult.error ??
      documentEventsResult.error;
    if (error) {
      throw new Error(`Falha ao carregar estado fiscal do Supabase: ${error.message}`);
    }
    const inutilizationsResult = await this.client
      .from("fiscal_inutilizations")
      .select("*")
      .order("created_at", { ascending: false });

    const companies = (companiesResult.data ?? []) as FiscalCompanyRow[];
    const companiesById = new Map(companies.map((company) => [company.id, company]));
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

    return {
      issuers,
      certificates,
      serviceConfigs,
      documents,
      documentEvents,
      inutilizations
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

    const { error } = await this.client
      .from("fiscal_documents")
      .upsert(rows, { onConflict: "id" });
    if (error) {
      throw new Error(`Falha ao salvar documentos fiscais: ${error.message}`);
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
}
