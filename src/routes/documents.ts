import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DOMParser, type Element } from "@xmldom/xmldom";
import * as QRCode from "qrcode";

import { config } from "../config.js";
import {
  decryptSecretPayload,
  encryptSecretPayload,
  encryptCertificateBundle,
  parsePfx
} from "../lib/certificates.js";
import {
  processHomologationDocument,
  processHomologationNfce
} from "../lib/document-processing.js";
import {
  cancelConfiguredNfse,
  configuredNfseProvider,
  consultConfiguredNfse,
  processConfiguredNfse,
  transmitConfiguredNfseTest
} from "../lib/nfse-provider.js";
import { cancelDocumentAtSefaz } from "../lib/sefaz-cancellation.js";
import { inutilizeNumberRangeAtSefaz } from "../lib/sefaz-inutilization.js";
import type { DocumentRecord, DocumentType, Environment, Issuer } from "../types.js";

type EstadualDocumentType = Extract<DocumentType, "NFe" | "NFCe">;

type AuthenticatedRequest = FastifyRequest & {
  tokenRecord: {
    token: string;
    clientId: string;
  };
};

function requestBaseUrl(request: FastifyRequest) {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const protocol =
    typeof forwardedProto === "string"
      ? forwardedProto.split(",")[0].trim()
      : request.protocol;
  return `${protocol}://${request.headers.host}`;
}

function artifactToken(documentId: string, artifact: "xml" | "pdf") {
  return createHmac("sha256", config.jwtSecret)
    .update(`${documentId}:${artifact}`)
    .digest("base64url");
}

function artifactUrl(
  baseUrl: string,
  basePath: string,
  documentId: string,
  artifact: "xml" | "pdf"
) {
  const token = artifactToken(documentId, artifact);
  return `${baseUrl}${basePath}/${documentId}/${artifact}?token=${token}`;
}

function isSignedArtifactRequest(request: FastifyRequest) {
  const url = new URL(request.url, "http://local");
  const match = url.pathname.match(/^\/(?:nfe|nfce|nfse)\/([^/]+)\/(xml|pdf)$/);
  if (!match) return false;

  const provided = url.searchParams.get("token");
  if (!provided) return false;
  const expected = artifactToken(match[1], match[2] as "xml" | "pdf");
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

function mapDocumentResponse(document: DocumentRecord, baseUrl: string) {
  const basePath =
    document.tipoDocumento === "NFe"
      ? "/nfe"
      : document.tipoDocumento === "NFCe"
        ? "/nfce"
        : "/nfse";
  const artifactsAvailable =
    document.status === "autorizado" || document.status === "cancelado";
  return {
    id: document.providerLikeId,
    status: document.status,
    numero: document.numero,
    serie: document.serie,
    chave: document.chave,
    protocolo: document.protocolo,
    motivo: document.motivo,
    motivo_status: document.motivoStatus,
    autorizacao: document.motivoStatus
      ? {
          codigo_status: document.motivoStatus,
          motivo_status: document.motivo,
          numero_protocolo: document.protocolo
        }
      : null,
    cancelamento: document.cancellationStatusCode
      ? {
          codigo_status: document.cancellationStatusCode,
          motivo_status: document.cancellationReason,
          numero_protocolo: document.cancellationProtocol,
          justificativa: document.cancellationJustification,
          cancelado_em: document.cancelledAt,
          xml_evento_disponivel: Boolean(document.cancellationProcessedXml),
          xml_evento_url: document.cancellationProcessedXml
            ? `${baseUrl}${basePath}/${document.id}/cancelamento/xml`
            : null
        }
      : null,
    xml_autorizado_disponivel: artifactsAvailable && Boolean(document.xml),
    pdf_disponivel: artifactsAvailable,
    xml_url: artifactsAvailable
      ? artifactUrl(baseUrl, basePath, document.id, "xml")
      : null,
    pdf_url: artifactsAvailable
      ? artifactUrl(baseUrl, basePath, document.id, "pdf")
      : null,
    xml_gerado: Boolean(document.xmlGenerated),
    xml_assinado: Boolean(document.xmlSigned),
    assinatura_valida: Boolean(document.signatureValid),
    xsd_valido: Boolean(document.xsdValid),
    erros_xsd: document.xsdErrors ?? [],
    mensagens: document.mensagens
  };
}

async function ensureBearer(request: FastifyRequest, reply: FastifyReply) {
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;

  if (!token) {
    return reply.code(401).send({
      error: "missing_token",
      message: "Envie Authorization: Bearer <token>."
    });
  }

  const tokenRecord = request.server.store.findToken(token);
  if (!tokenRecord) {
    return reply.code(401).send({
      error: "invalid_token",
      message: "Token invalido ou expirado."
    });
  }

  (request as AuthenticatedRequest).tokenRecord = {
    token: tokenRecord.token,
    clientId: tokenRecord.clientId
  };
}

function normalizePayload(tipoDocumento: DocumentType, body: Record<string, unknown>) {
  const fiscalBody =
    typeof body.infNFe === "object" && body.infNFe !== null
      ? (body.infNFe as Record<string, unknown>)
      : body;
  const emitente =
    typeof fiscalBody.emitente === "object" && fiscalBody.emitente !== null
      ? (fiscalBody.emitente as Record<string, unknown>)
      : undefined;
  const emit =
    typeof fiscalBody.emit === "object" && fiscalBody.emit !== null
      ? (fiscalBody.emit as Record<string, unknown>)
      : undefined;
  const dest =
    typeof fiscalBody.dest === "object" && fiscalBody.dest !== null
      ? (fiscalBody.dest as Record<string, unknown>)
      : undefined;
  const total =
    typeof fiscalBody.total === "object" && fiscalBody.total !== null
      ? (fiscalBody.total as Record<string, unknown>)
      : undefined;
  const pag =
    typeof fiscalBody.pag === "object" && fiscalBody.pag !== null
      ? (fiscalBody.pag as Record<string, unknown>)
      : undefined;
  const ide =
    typeof fiscalBody.ide === "object" && fiscalBody.ide !== null
      ? (fiscalBody.ide as Record<string, unknown>)
      : undefined;
  const emitenteCnpj =
    emitente?.cnpj ??
    emitente?.CNPJ ??
    emit?.CNPJ ??
    emit?.cnpj ??
    fiscalBody.emitenteCnpj ??
    fiscalBody.cnpj;

  const ambiente =
    body.ambiente ??
    body.environment ??
    (ide?.tpAmb === 1 ? "producao" : ide?.tpAmb === 2 ? "homologacao" : "homologacao");

  return {
    tipo: tipoDocumento,
    ambiente,
    emitenteCnpj: emitenteCnpj ?? null,
    destinatario: fiscalBody.destinatario ?? dest ?? null,
    itens: Array.isArray(fiscalBody.itens)
      ? fiscalBody.itens
      : Array.isArray(fiscalBody.det)
        ? fiscalBody.det
        : [],
    totais: fiscalBody.totais ?? total ?? null,
    pagamento: fiscalBody.pagamento ?? pag ?? null,
    observacoes: fiscalBody.observacoes ?? null,
    metadados: fiscalBody.metadados ?? null,
    emitente: emit ?? emitente ?? null,
    ide: ide ?? null
  };
}

function parseEnvironment(value: unknown): Environment {
  return value === "producao" ? "producao" : "homologacao";
}

export async function registerDocumentRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (request, reply) => {
    if (
      request.url.startsWith("/nfe") ||
      request.url.startsWith("/nfce") ||
      request.url.startsWith("/nfse") ||
      request.url === "/empresas" ||
      request.url.startsWith("/empresas/")
    ) {
      if (isSignedArtifactRequest(request)) {
        return;
      }
      return ensureBearer(request, reply);
    }
  });

  app.post("/nfe", async (request, reply) => {
    return handleCreateDocument(app, request, reply, "NFe");
  });

  app.post("/nfce", async (request, reply) => {
    return handleCreateDocument(app, request, reply, "NFCe");
  });

  app.post("/nfse/dps", async (request, reply) => {
    return handleCreateNfseDps(app, request, reply);
  });

  app.post("/nfce/inutilizacoes", async (request, reply) => {
    return handleCreateInutilization(app, request, reply, "NFCe");
  });

  app.get("/nfce/inutilizacoes/:id", async (request, reply) => {
    return handleGetInutilization(app, request, reply, "NFCe");
  });

  app.get("/nfce/inutilizacoes/:id/xml", async (request, reply) => {
    return handleInutilizationXmlDownload(app, request, reply, "NFCe", "signed");
  });

  app.get("/nfce/inutilizacoes/:id/resposta/xml", async (request, reply) => {
    return handleInutilizationXmlDownload(app, request, reply, "NFCe", "response");
  });

  app.post("/nfe/inutilizacoes", async (request, reply) => {
    return handleCreateInutilization(app, request, reply, "NFe");
  });

  app.get("/nfe/inutilizacoes/:id", async (request, reply) => {
    return handleGetInutilization(app, request, reply, "NFe");
  });

  app.get("/nfe/inutilizacoes/:id/xml", async (request, reply) => {
    return handleInutilizationXmlDownload(app, request, reply, "NFe", "signed");
  });

  app.get("/nfe/inutilizacoes/:id/resposta/xml", async (request, reply) => {
    return handleInutilizationXmlDownload(app, request, reply, "NFe", "response");
  });

  app.get("/nfe/:id", async (request, reply) => {
    return handleGetDocument(app, request, reply, "NFe");
  });

  app.get("/nfce/:id", async (request, reply) => {
    return handleGetDocument(app, request, reply, "NFCe");
  });

  app.get("/nfse/:id", async (request, reply) => {
    return handleGetDocument(app, request, reply, "NFSe");
  });

  app.post("/nfe/:id/cancelar", async (request, reply) => {
    return handleCancelDocument(app, request, reply, "NFe");
  });

  app.post("/nfce/:id/cancelar", async (request, reply) => {
    return handleCancelDocument(app, request, reply, "NFCe");
  });

  app.post("/nfse/:id/cancelar", async (request, reply) => {
    const params = request.params as { id: string };
    if (app.store.findDocument(params.id, "NFSe")) {
      return handleCancelNfse(app, request, reply);
    }

    // Compatibilidade com clientes antigos que usavam /nfse para cancelar NF-e.
    return handleCancelDocument(app, request, reply, "NFe");
  });

  app.post("/nfse/:id/cancelamento", async (request, reply) => {
    return handleCancelNfse(app, request, reply);
  });

  app.post("/nfse/:id/transmitir-teste", async (request, reply) => {
    return handleTransmitNfseTest(app, request, reply);
  });

  app.get("/nfe/:id/xml", async (request, reply) => {
    return handleXmlDownload(app, request, reply, "NFe");
  });

  app.get("/nfce/:id/xml", async (request, reply) => {
    return handleXmlDownload(app, request, reply, "NFCe");
  });

  app.get("/nfse/:id/xml", async (request, reply) => {
    return handleXmlDownload(app, request, reply, "NFSe");
  });

  app.get("/nfe/:id/cancelamento/xml", async (request, reply) => {
    return handleCancellationXmlDownload(app, request, reply, "NFe");
  });

  app.get("/nfce/:id/cancelamento/xml", async (request, reply) => {
    return handleCancellationXmlDownload(app, request, reply, "NFCe");
  });

  app.get("/nfse/:id/cancelamento/xml", async (request, reply) => {
    return handleCancellationXmlDownload(app, request, reply, "NFSe");
  });

  app.get("/nfe/:id/pdf", async (request, reply) => {
    return handlePdfDownload(app, request, reply, "NFe");
  });

  app.get("/nfce/:id/pdf", async (request, reply) => {
    return handlePdfDownload(app, request, reply, "NFCe");
  });

  app.get("/nfse/:id/pdf", async (request, reply) => {
    return handlePdfDownload(app, request, reply, "NFSe");
  });

  app.post("/empresas", async (request, reply) => {
    return handleUpsertCompany(app, request, reply);
  });

  app.put("/empresas/:cnpj", async (request, reply) => {
    return handleUpsertCompany(app, request, reply);
  });

  app.get("/empresas/:cnpj", async (request, reply) => {
    const params = request.params as { cnpj: string };
    const cnpj = params.cnpj.replace(/\D/g, "");
    const environment = parseEnvironment((request.query as Record<string, unknown>)?.ambiente);
    const issuer =
      app.store.findIssuerByCnpj(cnpj, environment) ??
      app.store.findIssuerByCnpj(cnpj);

    if (!issuer) {
      return reply.code(404).send({ message: "Empresa nao encontrada." });
    }

    return mapCompanyResponse(issuer);
  });

  app.get("/empresas/:cnpj/nfce", async (request, reply) => {
    const params = request.params as { cnpj: string };
    const cnpj = params.cnpj.replace(/\D/g, "");
    const environment = parseEnvironment((request.query as Record<string, unknown>)?.ambiente);
    const serviceConfig = app.store.findServiceConfig(cnpj, environment, "NFCE");
    if (!serviceConfig) {
      return reply.code(404).send({ message: "Configuracao NFC-e nao encontrada." });
    }

    return {
      ambiente: environment,
      sefaz: {
        id_csc: serviceConfig.settings.cscId ? Number(serviceConfig.settings.cscId) : null,
        csc_configurado: Boolean(serviceConfig.secretsEncrypted)
      }
    };
  });

  app.put("/empresas/:cnpj/nfce", async (request, reply) => {
    const params = request.params as { cnpj: string };
    const cnpj = params.cnpj.replace(/\D/g, "");
    const body = (request.body as Record<string, unknown> | undefined) ?? {};
    const environment = parseEnvironment(body.ambiente);
    const sefaz =
      typeof body.sefaz === "object" && body.sefaz !== null
        ? (body.sefaz as Record<string, unknown>)
        : body;
    const cscId = String(sefaz.id_csc ?? sefaz.cscId ?? sefaz.idToken ?? "").trim();
    const csc = String(sefaz.csc ?? sefaz.csc_token ?? "").trim();

    if (!cnpj || !/^[1-9]\d{0,5}$/.test(String(Number(cscId)))) {
      return reply.code(400).send({
        message: "Informe CNPJ e id_csc numerico de 1 a 6 digitos."
      });
    }
    if (!csc) {
      return reply.code(400).send({
        message: "Informe o CSC da NFC-e."
      });
    }

    app.store.ensureIssuer(cnpj, environment, {
      razaoSocial: `Emitente ${cnpj}`,
      nomeFantasia: `Emitente ${cnpj}`
    });
    const serviceConfig = app.store.upsertServiceConfig(cnpj, environment, "NFCE", {
      active: true,
      settings: { cscId },
      secretsEncrypted: encryptSecretPayload({ csc }, config.certificateEncryptionKey)
    });
    await app.store.waitForPersistence();

    return {
      message: "Configuracao NFC-e salva.",
      ambiente: environment,
      sefaz: {
        id_csc: Number(cscId),
        csc_configurado: Boolean(serviceConfig?.secretsEncrypted)
      }
    };
  });

  app.get("/empresas/:cnpj/nfse", async (request, reply) => {
    const params = request.params as { cnpj: string };
    const cnpj = params.cnpj.replace(/\D/g, "");
    const environment = parseEnvironment((request.query as Record<string, unknown>)?.ambiente);
    const serviceConfig = app.store.findServiceConfig(cnpj, environment, "NFSE");
    if (!serviceConfig) {
      return reply.code(404).send({ message: "Configuracao NFS-e nao encontrada." });
    }

    return {
      ambiente: environment,
      prefeitura: {
        login: serviceConfig.settings.nfseLogin ?? null,
        senha_configurada: Boolean(serviceConfig.secretsEncrypted)
      },
      provedor: serviceConfig.settings.nfseProvider ?? null,
      municipio: {
        codigo_ibge: serviceConfig.settings.nfseMunicipalityCode ?? null,
        nome: serviceConfig.settings.nfseMunicipalityName ?? null
      },
      rps: {
        serie: serviceConfig.settings.nfseRpsSerie ?? null,
        emissor: serviceConfig.settings.nfseRpsEmissor ?? null,
        numero: serviceConfig.settings.nfseNextRpsNumber ?? null,
        lote: serviceConfig.settings.nfseNextLotNumber ?? null
      },
      equiplano: {
        endpoint: serviceConfig.settings.nfseEndpoint ?? null,
        soap_action: serviceConfig.settings.nfseSoapAction ?? null,
        request_format: serviceConfig.settings.nfseRequestFormat ?? null,
        inscricao_municipal: serviceConfig.settings.nfseInscricaoMunicipal ?? null,
        id_entidade: serviceConfig.settings.nfseIdEntidade ?? null,
        transmissao_automatica: serviceConfig.settings.autoTransmit === true
      },
      ipm: {
        endpoint: serviceConfig.settings.nfseEndpoint ?? null,
        codigo_tom: serviceConfig.settings.nfseTomCode ?? null,
        cadastro_economico: serviceConfig.settings.nfseEconomicRegistration ?? null,
        codigo_atividade: serviceConfig.settings.nfseDefaultActivityCode ?? null,
        situacao_tributaria: serviceConfig.settings.nfseDefaultTaxSituation ?? null,
        exige_assinatura: serviceConfig.settings.nfseRequiresSignature === true,
        modo_teste: serviceConfig.settings.nfseTestMode !== false,
        transmissao_automatica: serviceConfig.settings.autoTransmit === true
      }
    };
  });

  const saveNfseConfig = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { cnpj: string };
    const cnpj = params.cnpj.replace(/\D/g, "");
    const body = (request.body as Record<string, unknown> | undefined) ?? {};
    const environment = parseEnvironment(body.ambiente);
    const prefeitura =
      typeof body.prefeitura === "object" && body.prefeitura !== null
        ? (body.prefeitura as Record<string, unknown>)
        : body;
    const rps =
      typeof body.rps === "object" && body.rps !== null
        ? (body.rps as Record<string, unknown>)
        : {};
    const equiplano =
      typeof body.equiplano === "object" && body.equiplano !== null
        ? (body.equiplano as Record<string, unknown>)
        : {};
    const ipm =
      typeof body.ipm === "object" && body.ipm !== null
        ? (body.ipm as Record<string, unknown>)
        : {};
    const municipio =
      typeof body.municipio === "object" && body.municipio !== null
        ? (body.municipio as Record<string, unknown>)
        : {};
    const servico =
      typeof body.servico === "object" && body.servico !== null
        ? (body.servico as Record<string, unknown>)
        : {};
    const login = String(prefeitura.login ?? prefeitura.usuario ?? "").trim();
    const password = String(prefeitura.senha ?? prefeitura.password ?? "").trim();
    const provider = String(
      body.provedor ?? body.provider ?? equiplano.provedor ?? ""
    ).trim();
    const normalizedProvider =
      provider.toLowerCase().includes("toledo") || provider.toLowerCase().includes("equiplano")
        ? "toledo-equiplano"
        : provider.toLowerCase().includes("guaira") ||
            provider.toLowerCase().includes("ipm") ||
            provider.toLowerCase().includes("atende")
          ? "guaira-ipm"
          : provider;

    if (cnpj.length !== 14) {
      return reply.code(400).send({ message: "Informe CNPJ valido." });
    }
    if (!login || (!password && !normalizedProvider)) {
      return reply.code(400).send({
        message: "Informe login e senha da prefeitura para a NFS-e."
      });
    }

    app.store.ensureIssuer(cnpj, environment, {
      razaoSocial: `Emitente ${cnpj}`,
      nomeFantasia: `Emitente ${cnpj}`
    });
    const serviceConfig = app.store.upsertServiceConfig(cnpj, environment, "NFSE", {
      active: true,
      settings: {
        nfseLogin: login,
        nfseProvider: normalizedProvider || undefined,
        nfseMunicipalityCode: String(
          municipio.codigo_ibge ??
            municipio.codigo_municipio ??
            body.codigo_municipio ??
            ""
        ).replace(/\D/g, "") || undefined,
        nfseMunicipalityName: String(
          municipio.nome ?? municipio.cidade ?? body.cidade ?? ""
        ).trim() || undefined,
        nfseEndpoint: String(
          ipm.endpoint ?? equiplano.endpoint ?? body.endpoint ?? ""
        ).trim() || undefined,
        nfseSoapAction: String(
          equiplano.soap_action ?? equiplano.soapAction ?? body.soap_action ?? ""
        ).trim() || undefined,
        nfseRequestFormat:
          String(equiplano.request_format ?? equiplano.requestFormat ?? body.request_format ?? "")
            .trim()
            .toLowerCase() === "xml"
            ? "xml"
            : undefined,
        nfseInscricaoMunicipal: String(
          equiplano.inscricao_municipal ??
            body.inscricao_municipal ??
            prefeitura.inscricao_municipal ??
            ""
        ).trim() || undefined,
        nfseIdEntidade: String(
          equiplano.id_entidade ?? equiplano.idEntidade ?? body.id_entidade ?? ""
        ).trim() || undefined,
        nfseRpsSerie: String(rps.serie ?? body.serie_rps ?? "").trim() || undefined,
        nfseRpsEmissor: String(rps.emissor ?? rps.emissor_rps ?? body.emissor_rps ?? "").trim() || undefined,
        nfseNextRpsNumber:
          Number(rps.numero ?? rps.proximo_numero ?? body.proximo_rps) > 0
            ? Number(rps.numero ?? rps.proximo_numero ?? body.proximo_rps)
            : undefined,
        nfseNextLotNumber:
          Number(rps.lote ?? rps.proximo_lote ?? body.proximo_lote) > 0
            ? Number(rps.lote ?? rps.proximo_lote ?? body.proximo_lote)
            : undefined,
        nfseDefaultServiceCode: String(
          servico.codigo ?? servico.codigo_servico ?? body.codigo_servico ?? ""
        ).trim() || undefined,
        nfseDefaultServiceItem: String(
          servico.item ?? servico.item_servico ?? body.item_servico ?? ""
        ).trim() || undefined,
        nfseDefaultServiceSubItem: String(
          servico.subitem ?? servico.subitem_servico ?? body.subitem_servico ?? ""
        ).trim() || undefined,
        nfseDefaultAliquotaIss:
          Number(servico.aliquota_iss ?? body.aliquota_iss) > 0
            ? Number(servico.aliquota_iss ?? body.aliquota_iss)
            : undefined,
        nfseTomCode: String(
          ipm.codigo_tom ?? ipm.tom_code ?? body.codigo_tom ?? ""
        ).replace(/\D/g, "") || undefined,
        nfseEconomicRegistration: String(
          ipm.cadastro_economico ??
            ipm.economic_registration ??
            body.cadastro_economico ??
            ""
        ).trim() || undefined,
        nfseDefaultActivityCode: String(
          ipm.codigo_atividade ??
            servico.codigo_atividade ??
            body.codigo_atividade ??
            ""
        ).replace(/\D/g, "") || undefined,
        nfseDefaultTaxSituation: String(
          ipm.situacao_tributaria ??
            servico.situacao_tributaria ??
            body.situacao_tributaria ??
            ""
        ).trim() || undefined,
        nfseRequiresSignature:
          ipm.exige_assinatura === true || body.exige_assinatura === true,
        nfseTestMode:
          ipm.modo_teste === false || body.modo_teste === false ? false : true,
        autoTransmit: body.transmissao_automatica === true || body.autoTransmit === true
      },
      secretsEncrypted: password
        ? encryptSecretPayload({ senha: password }, config.certificateEncryptionKey)
        : undefined,
      preserveSecrets: !password
    });
    await app.store.waitForPersistence();

    return {
      message: "Configuracao NFS-e salva.",
      ambiente: environment,
      prefeitura: {
        login,
        senha_configurada: Boolean(serviceConfig?.secretsEncrypted)
      }
    };
  };

  app.put("/empresas/:cnpj/nfse", saveNfseConfig);
  app.post("/empresas/:cnpj/nfse", saveNfseConfig);

  app.put("/empresas/:cnpj/certificado", async (request, reply) => {
    const params = request.params as { cnpj: string };
    const normalizedCnpj = params.cnpj.replace(/\D/g, "");
    const body = request.body as Record<string, unknown> | undefined;
    const fileName = String(body?.fileName ?? "certificado-mock.pfx");
    const pfxBase64 = String(body?.pfxBase64 ?? "");
    const password = String(body?.password ?? "");

    if (!pfxBase64) {
      return reply.code(400).send({
        message: "Envie o certificado em pfxBase64."
      });
    }

    let parsed;
    try {
      parsed = parsePfx(Buffer.from(pfxBase64, "base64"), password);
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : String(error)
      });
    }
    if (parsed.holderCnpj && parsed.holderCnpj !== normalizedCnpj) {
      return reply.code(400).send({
        message: `O certificado pertence ao CNPJ ${parsed.holderCnpj}, nao ao emitente ${normalizedCnpj}.`
      });
    }
    const now = Date.now();
    if (new Date(parsed.validFrom).getTime() > now) {
      return reply.code(400).send({ message: "O certificado ainda nao esta valido." });
    }
    if (new Date(parsed.validUntil).getTime() <= now) {
      return reply.code(400).send({ message: "O certificado esta vencido." });
    }

    const certificate = app.store.createOrReplaceCertificate(normalizedCnpj, {
      fileName,
      encryptedBundle: encryptCertificateBundle(
        { pfxBase64, password },
        config.certificateEncryptionKey
      ),
      validFrom: parsed.validFrom,
      validUntil: parsed.validUntil,
      serialNumber: parsed.serialNumber,
      subject: parsed.subject,
      holderCnpj: parsed.holderCnpj
    });

    if (!certificate) {
      return reply.code(404).send({
        message: "Emitente nao encontrado para o CNPJ informado."
      });
    }
    await app.store.waitForPersistence();

    return {
      cnpj: normalizedCnpj,
      certificado: {
        ...certificate,
        encryptedBundle: undefined
      },
      message: "Certificado A1 validado e armazenado com sucesso."
    };
  });
}

async function handleUpsertCompany(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const params = request.params as { cnpj?: string };
  const body = (request.body as Record<string, unknown> | undefined) ?? {};
  const cnpj = String(params?.cnpj ?? body.cpf_cnpj ?? body.cnpj ?? "").replace(/\D/g, "");
  const endereco =
    typeof body.endereco === "object" && body.endereco !== null
      ? (body.endereco as Record<string, unknown>)
      : {};
  const environment = parseEnvironment(body.ambiente);

  if (cnpj.length !== 14) {
    return reply.code(400).send({ message: "Informe cpf_cnpj/CNPJ valido." });
  }

  const issuer = app.store.upsertIssuerEnvironment(cnpj, environment, {
    razaoSocial: String(body.nome_razao_social ?? body.razao_social ?? `Emitente ${cnpj}`),
    nomeFantasia: String(
      body.nome_fantasia ?? body.nome_razao_social ?? body.razao_social ?? `Emitente ${cnpj}`
    ),
    uf: String(endereco.uf ?? body.uf ?? "").toUpperCase(),
    ie: String(body.inscricao_estadual ?? body.ie ?? ""),
    crt: String(body.regime_tributario ?? body.crt ?? ""),
    ativo: body.ativo === false ? false : true,
    metadata: {
      email: body.email,
      inscricao_municipal: body.inscricao_municipal,
      endereco
    }
  });
  await app.store.waitForPersistence();

  return reply.code(request.method === "POST" ? 201 : 200).send(mapCompanyResponse(issuer));
}

function mapCompanyResponse(issuer: import("../types.js").Issuer) {
  const endereco =
    typeof issuer.metadata?.endereco === "object" && issuer.metadata.endereco !== null
      ? (issuer.metadata.endereco as Record<string, unknown>)
      : {};
  return {
    id: issuer.id,
    cpf_cnpj: issuer.cnpj,
    cnpj: issuer.cnpj,
    nome_razao_social: issuer.razaoSocial,
    nome_fantasia: issuer.nomeFantasia,
    inscricao_estadual: issuer.ie,
    regime_tributario: issuer.crt,
    email: issuer.metadata?.email ?? null,
    ambiente: issuer.ambiente,
    endereco: {
      logradouro: endereco.logradouro ?? "",
      numero: endereco.numero ?? "",
      complemento: endereco.complemento ?? null,
      bairro: endereco.bairro ?? "",
      codigo_municipio: endereco.codigo_municipio ?? "",
      cidade: endereco.cidade ?? "",
      uf: endereco.uf ?? issuer.uf,
      cep: endereco.cep ?? "",
      pais: endereco.pais ?? "BRASIL"
    }
  };
}

function mapInutilizationResponse(record: import("../types.js").InutilizationRecord) {
  return {
    id: record.providerLikeId,
    status: record.status,
    codigo_status: record.motivoStatus,
    motivo_status: record.motivo,
    ambiente: record.ambiente,
    tipo: record.tipoDocumento,
    cnpj: record.issuerCnpj,
    ano: record.ano,
    serie: record.serie,
    numero_inicial: record.numeroInicial,
    numero_final: record.numeroFinal,
    justificativa: record.justificativa,
    protocolo: record.protocolo,
    numero_protocolo: record.protocolo,
    motivo: record.motivo,
    autorizacao: {
      id: record.providerLikeId,
      status: record.status,
      codigo_status: record.motivoStatus,
      motivo_status: record.motivo,
      numero_protocolo: record.protocolo
    },
    xml_pedido_disponivel: Boolean(record.xmlAssinado),
    xml_resposta_disponivel: Boolean(record.xmlResposta),
    xml_url: record.xmlAssinado
      ? `/${record.tipoDocumento === "NFe" ? "nfe" : "nfce"}/inutilizacoes/${record.id}/xml`
      : null,
    xml_resposta_url: record.xmlResposta
      ? `/${record.tipoDocumento === "NFe" ? "nfe" : "nfce"}/inutilizacoes/${record.id}/resposta/xml`
      : null,
    criado_em: record.createdAt,
    atualizado_em: record.updatedAt
  };
}

function positiveInt(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function twoDigitYear(value: unknown) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 99) {
    return parsed;
  }
  if (Number.isInteger(parsed) && parsed >= 2000 && parsed <= 2099) {
    return parsed - 2000;
  }
  return null;
}

async function handleCreateInutilization(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  tipoDocumento: EstadualDocumentType
) {
  const body = (request.body as Record<string, unknown> | undefined) ?? {};
  const issuerCnpj = String(
    body.cnpj ??
      body.emitenteCnpj ??
      body.cpf_cnpj ??
      body.emitente_cnpj ??
      ""
  ).replace(/\D/g, "");
  const ambiente = parseEnvironment(body.ambiente ?? body.environment);
  const ano = twoDigitYear(body.ano ?? body.year ?? new Date().getFullYear());
  const serie = positiveInt(body.serie);
  const numeroInicial = positiveInt(
    body.numero_inicial ?? body.numeroInicial ?? body.nNFIni ?? body.numero
  );
  const numeroFinal = positiveInt(
    body.numero_final ?? body.numeroFinal ?? body.nNFFin ?? body.numero
  );
  const justificativa = String(body.justificativa ?? body.xJust ?? "").trim();

  if (
    issuerCnpj.length !== 14 ||
    ano === null ||
    !serie ||
    !numeroInicial ||
    !numeroFinal ||
    numeroFinal < numeroInicial ||
    justificativa.length < 15
  ) {
    return reply.code(400).send({
      message:
        "Informe CNPJ, ano, serie, numero_inicial, numero_final e justificativa com pelo menos 15 caracteres."
    });
  }
  if (ambiente !== "homologacao") {
    return reply.code(403).send({
      message: "Inutilizacao em producao permanece bloqueada nesta etapa."
    });
  }

  const issuer = app.store.findIssuerByCnpj(issuerCnpj, ambiente);
  if (!issuer) {
    return reply.code(404).send({
      message: "Emitente nao encontrado para este CNPJ e ambiente."
    });
  }
  const certificate = app.store.findActiveCertificate(issuerCnpj);
  if (!certificate?.encryptedBundle) {
    return reply.code(409).send({
      message: "Cadastre um certificado A1 ativo para o emitente antes da inutilizacao."
    });
  }

  const record = app.store.createInutilization({
    tipoDocumento,
    issuerCnpj,
    ambiente,
    ano,
    serie,
    numeroInicial,
    numeroFinal,
    justificativa
  });
  await app.store.waitForPersistence();

  try {
    const result = await inutilizeNumberRangeAtSefaz({
      uf: issuer.uf,
      ambiente,
      documentType: tipoDocumento,
      cnpj: issuerCnpj,
      ano,
      serie,
      numeroInicial,
      numeroFinal,
      justificativa,
      encryptedCertificateBundle: certificate.encryptedBundle,
      encryptionSecret: config.certificateEncryptionKey
    });
    const updated = app.store.saveInutilizationResult(record.id, {
      requestXml: result.requestXml,
      signedXml: result.signedXml,
      responseXml: result.responseXml,
      statusCode: result.statusCode,
      reason: result.reason,
      protocol: result.protocol
    });
    await app.store.waitForPersistence();

    return reply.code(result.statusCode === "102" ? 200 : 422).send({
      message: result.reason,
      transmite_documento: true,
      id: updated?.providerLikeId ?? record.providerLikeId,
      status: updated?.status ?? record.status,
      codigo_status: result.statusCode,
      motivo_status: result.reason,
      ambiente,
      tipo: tipoDocumento,
      cnpj: issuerCnpj,
      status_sefaz: result.statusCode,
      motivo_sefaz: result.reason,
      protocolo: result.protocol || null,
      numero_protocolo: result.protocol || null,
      autorizacao: {
        id: updated?.providerLikeId ?? record.providerLikeId,
        status: updated?.status ?? record.status,
        codigo_status: result.statusCode,
        motivo_status: result.reason,
        numero_protocolo: result.protocol || null
      },
      recebido_em: result.receivedAt,
      versao_aplicacao: result.applicationVersion
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = app.store.failInutilization(record.id, "INUTILIZACAO_ERRO", message);
    await app.store.waitForPersistence();
    return reply.code(502).send({
      message,
      transmite_documento: true,
      id: failed?.providerLikeId ?? record.providerLikeId,
      status: failed?.status ?? "erro"
    });
  }
}

async function handleGetInutilization(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  tipoDocumento: EstadualDocumentType
) {
  const params = request.params as { id: string };
  const record = app.store.findInutilization(params.id, tipoDocumento);
  if (!record) {
    return reply.code(404).send({ message: "Inutilizacao nao encontrada." });
  }

  return mapInutilizationResponse(record);
}

async function handleInutilizationXmlDownload(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  tipoDocumento: EstadualDocumentType,
  artifact: "signed" | "response"
) {
  const params = request.params as { id: string };
  const record = app.store.findInutilization(params.id, tipoDocumento);
  if (!record) {
    return reply.code(404).send({ message: "Inutilizacao nao encontrada." });
  }

  const xml = artifact === "signed" ? record.xmlAssinado : record.xmlResposta;
  if (!xml) {
    return reply.code(409).send({
      message:
        artifact === "signed"
          ? "O XML assinado da inutilizacao ainda nao esta disponivel."
          : "A resposta XML da SEFAZ ainda nao esta disponivel."
    });
  }

  const suffix = artifact === "signed" ? "pedido-assinado" : "resposta-sefaz";
  reply.header("content-type", "application/xml; charset=utf-8");
  reply.header(
    "content-disposition",
    `attachment; filename="${tipoDocumento}-${record.serie}-${record.numeroInicial}-${suffix}.xml"`
  );
  return xml;
}

async function handleCreateDocument(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  tipoDocumento: EstadualDocumentType
) {
  const body = (request.body as Record<string, unknown> | undefined) ?? {};
  const payloadNormalizado = normalizePayload(tipoDocumento, body);
  const localFiscalConfig =
    typeof body.nuvemLocalFiscal === "object" && body.nuvemLocalFiscal !== null
      ? (body.nuvemLocalFiscal as Record<string, unknown>)
      : null;
  const payloadOriginal = structuredClone(body);
  delete payloadOriginal.nuvemLocalFiscal;
  const issuerCnpj = String(payloadNormalizado.emitenteCnpj ?? "");
  const ambiente = parseEnvironment(payloadNormalizado.ambiente);
  const forcedStatus = body.mockStatus === "autorizado" ? "autorizado" : "processamento";

  if (!issuerCnpj) {
    return reply.code(400).send({
      error: {
        message: "Informe emitente.cnpj, emit.CNPJ ou emitenteCnpj."
      },
      message: "Informe emitente.cnpj, emit.CNPJ ou emitenteCnpj."
    });
  }

  const emitente = payloadNormalizado.emitente as Record<string, unknown> | null;
  const ide = payloadNormalizado.ide as Record<string, unknown> | null;
  const issuer = app.store.ensureIssuer(issuerCnpj, ambiente, {
    razaoSocial: String(emitente?.xNome ?? `Emitente ${issuerCnpj}`),
    nomeFantasia: String(emitente?.xFant ?? emitente?.xNome ?? `Emitente ${issuerCnpj}`),
    uf: String(
      typeof emitente?.enderEmit === "object" && emitente.enderEmit !== null
        ? (emitente.enderEmit as Record<string, unknown>).UF ?? ""
        : ""
    ),
    ie: String(emitente?.IE ?? ""),
    crt: String(emitente?.CRT ?? ""),
    serieNfe: Number(ide?.serie ?? 1),
    serieNfce: Number(ide?.serie ?? 1)
  });

  if (emitente) {
    if ((emitente.CRT === undefined || emitente.CRT === null || emitente.CRT === "") && issuer.crt) {
      emitente.CRT = issuer.crt;
      const originalEmitente = resolveEmitentePayload(payloadOriginal);
      if (originalEmitente) {
        originalEmitente.CRT = issuer.crt;
      }
    }
    if ((emitente.IE === undefined || emitente.IE === null || emitente.IE === "") && issuer.ie) {
      emitente.IE = issuer.ie;
      const originalEmitente = resolveEmitentePayload(payloadOriginal);
      if (originalEmitente) {
        originalEmitente.IE = issuer.ie;
      }
    }
  }

  const nfeServiceConfig =
    tipoDocumento === "NFe"
      ? app.store.findServiceConfigRecord(issuerCnpj, ambiente, "NFE")
      : null;
  if (nfeServiceConfig && !nfeServiceConfig.active) {
    return reply.code(409).send({
      error: {
        code: "service_disabled",
        message: "O servico NF-e esta inativo para esta empresa e ambiente."
      },
      message: "O servico NF-e esta inativo para esta empresa e ambiente."
    });
  }
  const autoTransmit =
    tipoDocumento !== "NFe" ||
    nfeServiceConfig?.settings.autoTransmit !== false;
  const serviceConfig =
    tipoDocumento === "NFCe"
      ? app.store.findServiceConfig(issuerCnpj, ambiente, "NFCE")
      : null;
  const cscId =
    String(localFiscalConfig?.cscId ?? serviceConfig?.settings.cscId ?? "").trim();
  let csc = String(localFiscalConfig?.csc ?? "").trim();
  if (!csc && serviceConfig?.secretsEncrypted) {
    try {
      const secretPayload = decryptSecretPayload<{ csc?: string }>(
        serviceConfig.secretsEncrypted,
        config.certificateEncryptionKey
      );
      csc = String(secretPayload.csc ?? "").trim();
    } catch {
      return reply.code(409).send({
        message:
          "O CSC salvo nao pode ser aberto com a chave de criptografia atual. Cadastre-o novamente."
      });
    }
  }
  if (tipoDocumento === "NFCe" && (!cscId || !csc)) {
    return reply.code(409).send({
      message:
        "Configure o CSC ID e o CSC da NFC-e para este ambiente antes da emissao."
    });
  }
  if (
    ambiente === "homologacao" &&
    config.autoTransmitHomologation &&
    autoTransmit &&
    !app.store.findActiveCertificate(issuerCnpj)
  ) {
    return reply.code(409).send({
      message:
        "Cadastre um certificado A1 ativo para o emitente antes da emissao em homologacao."
    });
  }
  const nfceConfigEncrypted =
    tipoDocumento === "NFCe" && cscId && csc
      ? encryptSecretPayload({ cscId, csc }, config.certificateEncryptionKey)
      : null;

  const document = app.store.createDocument({
    tipoDocumento,
    issuerCnpj,
    ambiente,
    payloadOriginal,
    payloadNormalizado,
    nfceConfigEncrypted,
    forcedStatus
  });
  await app.store.waitForPersistence();

  if (
    ambiente === "homologacao" &&
    config.autoTransmitHomologation &&
    autoTransmit
  ) {
    const processed =
      tipoDocumento === "NFCe"
        ? await processHomologationNfce(app.store, document.id)
        : await processHomologationDocument(app.store, document.id);
    if (processed.error) {
      request.log.error(
        {
          documentId: document.id,
          tipoDocumento,
          cnpj: issuerCnpj,
          error: processed.error
        },
        `Falha no processamento automatico da ${tipoDocumento}`
      );
    }
    return reply
      .code(202)
      .send(mapDocumentResponse(processed.document, requestBaseUrl(request)));
  }

  return reply.code(202).send(mapDocumentResponse(document, requestBaseUrl(request)));
}

function resolveEmitentePayload(payloadOriginal: Record<string, unknown>) {
  if (typeof payloadOriginal.infNFe === "object" && payloadOriginal.infNFe !== null) {
    const infNFe = payloadOriginal.infNFe as Record<string, unknown>;
    if (typeof infNFe.emit === "object" && infNFe.emit !== null) {
      return infNFe.emit as Record<string, unknown>;
    }
    if (typeof infNFe.emitente === "object" && infNFe.emitente !== null) {
      return infNFe.emitente as Record<string, unknown>;
    }
  }
  if (typeof payloadOriginal.emit === "object" && payloadOriginal.emit !== null) {
    return payloadOriginal.emit as Record<string, unknown>;
  }
  if (typeof payloadOriginal.emitente === "object" && payloadOriginal.emitente !== null) {
    return payloadOriginal.emitente as Record<string, unknown>;
  }
  return null;
}

function normalizeNfseDpsPayload(body: Record<string, unknown>) {
  const infDPS = typeof body.infDPS === "object" && body.infDPS !== null
    ? (body.infDPS as Record<string, unknown>)
    : body;
  const prestador =
    typeof infDPS.prest === "object" && infDPS.prest !== null
      ? (infDPS.prest as Record<string, unknown>)
      : typeof infDPS.prestador === "object" && infDPS.prestador !== null
        ? (infDPS.prestador as Record<string, unknown>)
        : {};
  const tomador =
    typeof infDPS.toma === "object" && infDPS.toma !== null
      ? (infDPS.toma as Record<string, unknown>)
      : typeof infDPS.tomador === "object" && infDPS.tomador !== null
        ? (infDPS.tomador as Record<string, unknown>)
        : {};
  const servico =
    typeof infDPS.serv === "object" && infDPS.serv !== null
      ? (infDPS.serv as Record<string, unknown>)
      : typeof infDPS.servico === "object" && infDPS.servico !== null
        ? (infDPS.servico as Record<string, unknown>)
        : {};
  const valores =
    typeof infDPS.valores === "object" && infDPS.valores !== null
      ? (infDPS.valores as Record<string, unknown>)
      : {};
  const ambiente =
    body.ambiente ??
    body.environment ??
    (String(infDPS.tpAmb ?? "") === "1" ? "producao" : "homologacao");
  const emitenteCnpj =
    prestador.CNPJ ??
    prestador.cnpj ??
    prestador.cpf_cnpj ??
    body.emitenteCnpj ??
    body.cnpj;

  return {
    tipo: "NFSe" as const,
    ambiente,
    emitenteCnpj: emitenteCnpj ?? null,
    prestador,
    tomador,
    servico,
    valores,
    metadados: body.metadados ?? null,
    infDPS
  };
}

async function handleCreateNfseDps(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const body = (request.body as Record<string, unknown> | undefined) ?? {};
  const payloadNormalizado = normalizeNfseDpsPayload(body);
  const issuerCnpj = String(payloadNormalizado.emitenteCnpj ?? "").replace(/\D/g, "");
  const ambiente = parseEnvironment(payloadNormalizado.ambiente);

  if (!issuerCnpj) {
    return reply.code(400).send({
      error: {
        message: "Informe infDPS.prest.CNPJ ou emitenteCnpj para a NFS-e."
      },
      message: "Informe infDPS.prest.CNPJ ou emitenteCnpj para a NFS-e."
    });
  }
  if (ambiente === "producao") {
    return reply.code(403).send({
      message: "Emissao NFS-e em producao permanece bloqueada nesta etapa.",
      error: {
        code: "production_blocked",
        message: "Emissao NFS-e em producao permanece bloqueada nesta etapa."
      }
    });
  }

  app.store.ensureIssuer(issuerCnpj, ambiente, {
    razaoSocial: `Emitente ${issuerCnpj}`,
    nomeFantasia: `Emitente ${issuerCnpj}`,
    uf: "PR"
  });
  const document = app.store.createDocument({
    tipoDocumento: "NFSe",
    issuerCnpj,
    ambiente,
    payloadOriginal: structuredClone(body),
    payloadNormalizado
  });
  await app.store.waitForPersistence();

  const processed = await processConfiguredNfse(app.store, document.id);
  const provider = configuredNfseProvider(app.store, processed.document);
  const statusCode = processed.error
    ? 422
    : processed.document.status === "autorizado"
      ? 200
      : 202;
  return reply.code(statusCode).send({
    ...mapDocumentResponse(processed.document, requestBaseUrl(request)),
    message:
      processed.error ??
      processed.document.motivo ??
      "NFS-e recebida para processamento.",
    transmissao_municipal: processed.transmitted,
    provedor: provider
  });
}

async function handleGetDocument(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  tipoDocumento: DocumentType
) {
  const params = request.params as { id: string };
  let storedDocument =
    app.store.findDocument(params.id, tipoDocumento) ??
    app.store.findDocument(params.id);
  if (!storedDocument) {
    return reply.code(404).send({
      message: "Documento nao encontrado."
    });
  }
  const query = (request.query as Record<string, unknown> | undefined) ?? {};
  const refreshMunicipal =
    query.consultar_prefeitura === "1" || query.consultar_prefeitura === "true";
  const shouldAutoConsult =
    storedDocument.tipoDocumento === "NFSe" &&
    storedDocument.status === "processamento" &&
    storedDocument.motivoStatus !== "NFSE_IPM_DRY_RUN";
  if (
    storedDocument.tipoDocumento === "NFSe" &&
    (shouldAutoConsult || refreshMunicipal)
  ) {
    const consultation = await consultConfiguredNfse(app.store, storedDocument.id);
    storedDocument = consultation.document;
    if (refreshMunicipal && consultation.error) {
      return reply.code(422).send({
        ...mapDocumentResponse(storedDocument, requestBaseUrl(request)),
        consulta_municipal: false,
        message: consultation.error
      });
    }
  }

  return mapDocumentResponse(storedDocument, requestBaseUrl(request));
}

async function handleCancelDocument(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  tipoDocumento: EstadualDocumentType
) {
  const params = request.params as { id: string };
  const document = app.store.findDocument(params.id, tipoDocumento);
  if (!document) {
    return reply.code(404).send({
      message: "Documento nao encontrado para cancelamento."
    });
  }
  if (document.status === "cancelado") {
    return mapDocumentResponse(document, requestBaseUrl(request));
  }
  if (document.status !== "autorizado") {
    return reply.code(409).send({
      message: "Somente um documento autorizado pode ser cancelado.",
      error: {
        code: "document_not_authorized",
        message: "Somente um documento autorizado pode ser cancelado."
      }
    });
  }
  if (document.ambiente !== "homologacao") {
    return reply.code(403).send({
      message: "Cancelamento em producao permanece bloqueado nesta etapa.",
      error: {
        code: "production_blocked",
        message: "Cancelamento em producao permanece bloqueado nesta etapa."
      }
    });
  }

  const body = (request.body as Record<string, unknown> | undefined) ?? {};
  const justification = String(
    body.justificativa ?? body.justification ?? body.motivo ?? ""
  ).trim();
  if (justification.length < 15 || justification.length > 255) {
    return reply.code(400).send({
      message: "A justificativa deve ter entre 15 e 255 caracteres.",
      error: {
        code: "invalid_justification",
        message: "A justificativa deve ter entre 15 e 255 caracteres."
      }
    });
  }
  if (!document.chave || document.chave.replace(/\D/g, "").length !== 44) {
    return reply.code(409).send({
      message: "A nota autorizada nao possui uma chave de acesso valida.",
      error: {
        code: "missing_access_key",
        message: "A nota autorizada nao possui uma chave de acesso valida."
      }
    });
  }
  if (!document.protocolo) {
    return reply.code(409).send({
      message: "A nota autorizada nao possui protocolo de autorizacao.",
      error: {
        code: "missing_authorization_protocol",
        message: "A nota autorizada nao possui protocolo de autorizacao."
      }
    });
  }

  const issuer = app.store.findIssuerByCnpj(document.issuerCnpj, document.ambiente);
  if (!issuer) {
    return reply.code(404).send({
      message: "Emitente nao encontrado para este documento."
    });
  }
  const certificate = app.store.findActiveCertificate(document.issuerCnpj);
  if (!certificate?.encryptedBundle) {
    return reply.code(409).send({
      message: "Cadastre um certificado A1 ativo antes do cancelamento.",
      error: {
        code: "missing_certificate",
        message: "Cadastre um certificado A1 ativo antes do cancelamento."
      }
    });
  }

  try {
    const result = await cancelDocumentAtSefaz({
      uf: issuer.uf,
      ambiente: document.ambiente,
      documentType: tipoDocumento,
      cnpj: document.issuerCnpj,
      accessKey: document.chave,
      authorizationProtocol: document.protocolo,
      justification,
      encryptedCertificateBundle: certificate.encryptedBundle,
      encryptionSecret: config.certificateEncryptionKey
    });
    const updated = app.store.saveCancellationResult(document.id, {
      justification,
      requestXml: result.requestXml,
      signedXml: result.signedEventXml,
      responseXml: result.responseXml,
      processedXml: result.processedEventXml,
      statusCode: result.statusCode,
      reason: result.reason,
      protocol: result.protocol,
      cancelledAt: result.receivedAt
    });
    await app.store.waitForPersistence();

    const success = ["135", "136", "155"].includes(result.statusCode);
    return reply.code(success ? 200 : 422).send({
      ...mapDocumentResponse(updated ?? document, requestBaseUrl(request)),
      message: result.reason,
      codigo_status: result.statusCode,
      motivo_status: result.reason,
      protocolo_cancelamento: result.protocol || null,
      numero_protocolo: result.protocol || null,
      cancelamento: {
        status: success ? "homologado" : "rejeitado",
        codigo_status: result.statusCode,
        motivo_status: result.reason,
        numero_protocolo: result.protocol || null,
        justificativa: justification,
        registrado_em: result.receivedAt || null
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    request.log.error(
      {
        documentId: document.id,
        cnpj: document.issuerCnpj,
        error: message
      },
      "Falha ao cancelar documento na SEFAZ"
    );
    return reply.code(502).send({
      message,
      error: {
        code: "sefaz_cancellation_failed",
        message
      }
    });
  }
}

async function handleCancelNfse(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const params = request.params as { id: string };
  const document = app.store.findDocument(params.id, "NFSe");
  if (!document) {
    return reply.code(404).send({ message: "NFS-e nao encontrada." });
  }
  if (document.status === "cancelado") {
    return mapDocumentResponse(document, requestBaseUrl(request));
  }
  if (document.status !== "autorizado") {
    return reply.code(409).send({
      message: "Somente uma NFS-e autorizada pode ser cancelada."
    });
  }
  if (document.ambiente !== "homologacao") {
    return reply.code(403).send({
      message: "Cancelamento NFS-e em producao permanece bloqueado."
    });
  }

  const body = (request.body as Record<string, unknown> | undefined) ?? {};
  const reason = String(
    body.motivo ?? body.justificativa ?? body.justification ?? ""
  ).trim();
  if (reason.length < 15 || reason.length > 255) {
    return reply.code(400).send({
      message: "O motivo do cancelamento deve ter entre 15 e 255 caracteres."
    });
  }

  let result;
  try {
    result = await cancelConfiguredNfse(app.store, document.id, reason);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reply.code(422).send({
      ...mapDocumentResponse(document, requestBaseUrl(request)),
      message,
      codigo_status: "NFSE_PROVIDER_CANCEL",
      motivo_status: message
    });
  }
  const response = {
    ...mapDocumentResponse(result.document, requestBaseUrl(request)),
    message: result.error ?? result.document.cancellationReason,
    codigo_status: result.document.cancellationStatusCode,
    motivo_status: result.document.cancellationReason
  };
  return reply
    .code(result.document.status === "cancelado" ? 200 : result.error ? 422 : 200)
    .send(response);
}

async function handleTransmitNfseTest(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply
) {
  const params = request.params as { id: string };
  const body = (request.body as Record<string, unknown> | undefined) ?? {};
  const confirmation = String(body.confirmacao ?? body.confirmation ?? "").trim();
  if (confirmation !== "TRANSMITIR TESTE IPM") {
    return reply.code(400).send({
      message:
        "Confirmacao invalida. Informe exatamente TRANSMITIR TESTE IPM.",
      transmite_documento: false
    });
  }

  const document = app.store.findDocument(params.id, "NFSe");
  if (!document) {
    return reply.code(404).send({ message: "NFS-e nao encontrada." });
  }
  if (document.status !== "processamento" || document.motivoStatus !== "NFSE_IPM_DRY_RUN") {
    return reply.code(409).send({
      message: "Somente um dry-run IPM pendente pode ser transmitido por esta rota.",
      transmite_documento: false
    });
  }

  try {
    const result = await transmitConfiguredNfseTest(app.store, document.id);
    return reply.code(result.error ? 422 : 200).send({
      ...mapDocumentResponse(result.document, requestBaseUrl(request)),
      message: result.error ?? result.document.motivo,
      transmissao_municipal: result.transmitted,
      provedor: "guaira-ipm"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    request.log.error({ err: error, documentId: document.id }, message);
    return reply.code(422).send({
      ...mapDocumentResponse(document, requestBaseUrl(request)),
      message,
      transmissao_municipal: false,
      provedor: "guaira-ipm"
    });
  }
}

async function handleXmlDownload(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  tipoDocumento: DocumentType
) {
  const params = request.params as { id: string };
  const document = app.store.findDocument(params.id, tipoDocumento);
  if (!document) {
    return reply.code(404).send({ message: "Documento nao encontrado." });
  }
  if (tipoDocumento === "NFSe" && (document.xml || document.xmlSigned || document.xmlGenerated)) {
    reply.header("content-type", "application/xml; charset=utf-8");
    const authorized =
      document.status === "autorizado" || document.status === "cancelado";
    return authorized
      ? document.xml || document.xmlSigned || document.xmlGenerated
      : document.xmlSigned || document.xmlGenerated || document.xml;
  }
  if (document.status !== "autorizado" && document.status !== "cancelado") {
    return reply.code(409).send({ message: "XML ainda nao disponivel para este status." });
  }

  reply.header("content-type", "application/xml; charset=utf-8");
  return document.xml;
}

async function handleCancellationXmlDownload(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  tipoDocumento: DocumentType
) {
  const params = request.params as { id: string };
  const document = app.store.findDocument(params.id, tipoDocumento);
  if (!document) {
    return reply.code(404).send({ message: "Documento nao encontrado." });
  }
  if (!document.cancellationProcessedXml) {
    return reply.code(409).send({
      message: "XML de cancelamento ainda nao disponivel para este documento."
    });
  }

  reply.header("content-type", "application/xml; charset=utf-8");
  return document.cancellationProcessedXml;
}

async function handlePdfDownload(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  tipoDocumento: DocumentType
) {
  const params = request.params as { id: string };
  const document = app.store.findDocument(params.id, tipoDocumento);
  if (!document) {
    return reply.code(404).send({ message: "Documento nao encontrado." });
  }
  if (document.status !== "autorizado" && document.status !== "cancelado") {
    return reply.code(409).send({ message: "PDF ainda nao disponivel para este status." });
  }

  const issuer = app.store.findIssuerByCnpj(document.issuerCnpj, document.ambiente);
  const pdf = createLocalPdf(document, issuer);
  reply.header("content-type", "application/pdf");
  reply.header("content-disposition", `inline; filename="${document.tipoDocumento}-${document.numero}.pdf"`);
  return reply.send(pdf);
}

function createLocalPdf(document: DocumentRecord, issuer: Issuer | null = null) {
  const page =
    document.tipoDocumento === "NFSe"
      ? nfseContentStream(document, issuer)
      : document.tipoDocumento === "NFe"
        ? nfeDanfeContentStream(parseDanfeData(document))
        : nfceDanfeContentStream(parseDanfeData(document));
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(page.content, "ascii")} >>\nstream\n${page.content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, "ascii"));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "ascii");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "ascii");
}

function recordValue(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function nfseContentStream(document: DocumentRecord, issuer: Issuer | null) {
  const payload = recordValue(document.payloadOriginal);
  const infDps = recordValue(payload.infDPS);
  const toma = recordValue(infDps.toma);
  const tomaEnd = recordValue(toma.end);
  const tomaEndNac = recordValue(tomaEnd.endNac);
  const serv = recordValue(infDps.serv);
  const cServ = recordValue(serv.cServ);
  const valores = recordValue(infDps.valores);
  const vServPrest = recordValue(valores.vServPrest);
  const trib = recordValue(valores.trib);
  const tribMun = recordValue(trib.tribMun);
  const issuerMetadata = recordValue(issuer?.metadata);
  const issuerAddress = recordValue(issuerMetadata.endereco);
  const authorizedXml = document.xml ?? "";
  const authentication =
    authorizedXml.match(/<cdAutenticacao>([^<]+)<\/cdAutenticacao>/i)?.[1] ?? "";
  const providerNumber =
    authorizedXml.match(/<nrNfse>([^<]+)<\/nrNfse>/i)?.[1] ??
    document.chave ??
    String(document.numero);
  const [lotNumber = "", rpsNumber = ""] = String(
    document.providerReference ?? ""
  ).split(":");
  const recipientDocument = String(toma.CNPJ ?? toma.CPF ?? "");
  const serviceValue = Number(vServPrest.vServ ?? 0);
  const aliquota = Number(tribMun.pAliq ?? 0);
  const issValue = Number(((serviceValue * aliquota) / 100).toFixed(2));
  const issueDate =
    authorizedXml.match(/<dtEmissaoNfs>([^<]+)<\/dtEmissaoNfs>/i)?.[1] ??
    String(infDps.dhEmi ?? document.createdAt);
  const consultationUrl = authentication
    ? `https://www.esnfs.com.br/esenfs.view.logic?aut=${authentication}`
    : "https://www.esnfs.com.br";
  const commands: string[] = ["0.45 w"];
  const left = 28;
  const right = 567;
  const width = right - left;
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    commands.push(`${x1} ${y1} m ${x2} ${y2} l S`);
  const rect = (x: number, y: number, w: number, h: number) =>
    commands.push(`${x} ${y} ${w} ${h} re S`);
  const roundedRect = (x: number, y: number, w: number, h: number, radius = 4) => {
    const k = 0.5522847498;
    const c = radius * k;
    commands.push(
      `${x + radius} ${y} m`,
      `${x + w - radius} ${y} l`,
      `${x + w - radius + c} ${y} ${x + w} ${y + radius - c} ${x + w} ${y + radius} c`,
      `${x + w} ${y + h - radius} l`,
      `${x + w} ${y + h - radius + c} ${x + w - radius + c} ${y + h} ${x + w - radius} ${y + h} c`,
      `${x + radius} ${y + h} l`,
      `${x + radius - c} ${y + h} ${x} ${y + h - radius + c} ${x} ${y + h - radius} c`,
      `${x} ${y + radius} l`,
      `${x} ${y + radius - c} ${x + radius - c} ${y} ${x + radius} ${y} c S`
    );
  };
  const text = (
    x: number,
    y: number,
    size: number,
    value: string,
    font = "F1"
  ) => commands.push(`BT /${font} ${size} Tf ${x} ${y} Td (${escapePdf(value)}) Tj ET`);
  const center = (
    x: number,
    w: number,
    y: number,
    size: number,
    value: string,
    font = "F1"
  ) => {
    const estimated = pdfText(value).length * size * 0.48;
    text(x + Math.max(2, (w - estimated) / 2), y, size, value, font);
  };
  const labelValue = (
    x: number,
    valueX: number,
    y: number,
    label: string,
    value: string,
    labelSize = 6.5,
    valueSize = 7.5
  ) => {
    text(x, y, labelSize, label);
    text(valueX, y, valueSize, value, "F2");
  };
  const money = (value: number) =>
    value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dateTime = issueDate
    ? new Date(issueDate).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : "";
  const issuerAddressLine = [
    issuerAddress.logradouro,
    issuerAddress.numero,
    issuerAddress.complemento,
    issuerAddress.bairro,
    issuerAddress.cep
  ].filter(Boolean).join(" - ");
  const recipientAddressLine = [
    tomaEnd.xLgr,
    tomaEnd.nro,
    tomaEnd.xCpl,
    tomaEnd.xBairro,
    tomaEndNac.CEP
  ].filter(Boolean).join(" - ");

  roundedRect(left, 35, width, 780, 5);
  line(left, 735, right, 735);
  line(left, 650, right, 650);
  line(left, 565, right, 565);
  line(left, 530, right, 530);
  roundedRect(left, 115, width, 75, 4);
  line(left, 175, right, 175);
  line(left, 160, right, 160);
  line(left, 132, right, 132);
  roundedRect(left, 35, width, 80, 4);
  line(left, 90, right, 90);
  line(465, 735, 465, 815);
  line(465, 788.33, right, 788.33);
  line(465, 761.67, right, 761.67);

  center(left, 437, 792, 12, "MUNICIPIO DE TOLEDO", "F2");
  center(left, 437, 777, 8, "Secretaria Municipal da Fazenda", "F2");
  center(left, 437, 759, 10, "NOTA FISCAL DE SERVICOS ELETRONICA - NFS-e", "F2");
  center(left, 437, 744, 7, "www.esnfs.com.br");
  text(470, 806, 5.5, "Numero da Nota:");
  center(465, 102, 793, 11, providerNumber, "F2");
  text(470, 779, 5.5, "Data e Hora da Emissao:");
  center(465, 102, 766, 6.5, dateTime, "F2");
  text(470, 752, 5.5, "Operador Emissor:");
  center(465, 102, 739, 6.5, "MB Solucoes Digitais", "F2");
  if (document.ambiente === "homologacao") {
    center(left, width, 724, 9, "HOMOLOGACAO - SEM VALOR FISCAL", "F2");
  }

  center(left, width, 712, 9, "PRESTADOR DE SERVICOS", "F2");
  labelValue(40, 82, 694, "CPF/CNPJ:", formatCnpj(document.issuerCnpj));
  labelValue(280, 304, 694, "I.M.:", String(issuerMetadata.inscricao_municipal ?? ""));
  labelValue(40, 98, 681, "Nome/Razao:", issuer?.razaoSocial ?? "");
  labelValue(40, 82, 668, "Endereco:", issuerAddressLine);
  labelValue(40, 86, 655, "Municipio:", String(issuerAddress.cidade ?? "Toledo"));
  labelValue(220, 237, 655, "UF:", String(issuerAddress.uf ?? "PR"));
  labelValue(280, 310, 655, "E-mail:", String(issuerMetadata.email ?? ""));

  center(left, width, 632, 9, "TOMADOR DE SERVICOS", "F2");
  labelValue(40, 82, 614, "CPF/CNPJ:", recipientDocument);
  labelValue(40, 98, 601, "Nome/Razao:", String(toma.xNome ?? ""));
  labelValue(40, 82, 588, "Endereco:", recipientAddressLine);
  labelValue(40, 86, 575, "Municipio:", "Toledo");
  labelValue(220, 237, 575, "UF:", "PR");
  labelValue(280, 321, 575, "Telefone:", String(toma.fone ?? ""));

  const columns = [left, 70, 320, 382, 430, 474, 520, right];
  for (const x of columns.slice(1, -1)) line(x, 530, x, 565);
  const headers = ["Cod.", "Descricao", "Vl.Servico", "Desconto", "Deducao", "Base Calc.", "Aliq."];
  headers.forEach((header, index) => center(columns[index], columns[index + 1] - columns[index], 553, 5.5, header, "F2"));
  text(32, 538, 6, String(cServ.cTribMun ?? cServ.cTribNac ?? ""));
  text(73, 538, 6, String(cServ.xDescServ ?? ""));
  text(325, 538, 6, money(serviceValue));
  text(391, 538, 6, "0,00");
  text(441, 538, 6, "0,00");
  text(480, 538, 6, money(serviceValue));
  text(529, 538, 6, aliquota.toFixed(2));
  text(73, 518, 5.5, `Discriminacao: ${String(cServ.xDescServ ?? "")}`);

  text(110, 180, 7, "Total Servicos (R$)", "F2");
  text(220, 180, 8, money(serviceValue), "F2");
  text(110, 165, 7, "Total ISS (R$)", "F2");
  text(220, 165, 8, money(issValue), "F2");

  const taxLabelWidth = 80;
  const taxCellWidth = (width - taxLabelWidth) / 6;
  const taxLeft = left + taxLabelWidth;
  line(taxLeft, 132, taxLeft, 160);
  for (let index = 1; index < 6; index += 1) {
    const x = taxLeft + taxCellWidth * index;
    line(x, 132, x, 160);
  }
  center(left, taxLabelWidth, 145, 6, "Impostos (R$)", "F2");
  ["COFINS Ret.", "CSLL Ret.", "INSS Ret.", "IRRF Ret.", "PIS Ret.", "ISS Ret."]
    .forEach((label, index) => {
      const x = taxLeft + taxCellWidth * index;
      text(x + 3, 149, 5.5, label, "F2");
      text(x + 3, 137, 6, "0,00");
    });

  text(110, 120, 7, "Total Liquido (R$)", "F2");
  text(220, 120, 8, money(serviceValue), "F2");
  center(left, width, 105, 8, "OUTRAS INFORMACOES", "F2");
  text(35, 76, 6, "Esta NFS-e foi emitida com respaldo na legislacao municipal de Toledo.");
  text(
    35,
    66,
    6,
    `NFS-e municipal: ${providerNumber}  RPS: ${rpsNumber || "-"}  Lote: ${lotNumber || "-"}  CNAE: ${String(cServ.CNAE ?? "")}`
  );
  text(35, 50, 6, `Autenticidade: ${authentication}`);
  text(35, 40, 5.5, `Consulte em: ${consultationUrl}`);

  if (authentication) {
    drawQrCode(commands, consultationUrl, 510, 42, 42);
  }
  return { width: 595, height: 842, content: commands.join("\n") };
}

type DanfeItem = {
  codigo: string;
  descricao: string;
  ncm: string;
  cst: string;
  cfop: string;
  quantidade: string;
  unidade: string;
  valorUnitario: string;
  valorTotal: string;
  baseIcms: string;
  valorIcms: string;
  valorIpi: string;
  aliquotaIcms: string;
  aliquotaIpi: string;
};

type DanfeData = {
  numero: string;
  serie: string;
  ambiente: string;
  status: string;
  emitenteNome: string;
  emitenteFantasia: string;
  emitenteCnpj: string;
  emitenteIe: string;
  emitenteEndereco: string;
  emitenteMunicipio: string;
  emitenteUf: string;
  emitenteCep: string;
  emitenteFone: string;
  chave: string;
  protocolo: string;
  naturezaOperacao: string;
  tipoOperacao: string;
  emitidaEm: string;
  recebidoEm: string;
  qrCodeUrl: string;
  consultaUrl: string;
  destinatarioNome: string;
  destinatarioDocumento: string;
  destinatarioEndereco: string;
  destinatarioBairro: string;
  destinatarioCep: string;
  destinatarioMunicipio: string;
  destinatarioUf: string;
  destinatarioFone: string;
  destinatarioIe: string;
  baseIcms: string;
  valorIcms: string;
  baseIcmsSt: string;
  valorIcmsSt: string;
  valorFrete: string;
  valorSeguro: string;
  valorDesconto: string;
  valorIpi: string;
  valorPis: string;
  valorCofins: string;
  outrasDespesas: string;
  valorTotal: string;
  valorProdutos: string;
  formaPagamento: string;
  valorPago: string;
  transportadorNome: string;
  transportadorDocumento: string;
  transportadorIe: string;
  transportadorEndereco: string;
  transportadorMunicipio: string;
  transportadorUf: string;
  modalidadeFrete: string;
  placaVeiculo: string;
  veiculoUf: string;
  quantidadeVolumes: string;
  especieVolumes: string;
  marcaVolumes: string;
  numeracaoVolumes: string;
  pesoBruto: string;
  pesoLiquido: string;
  informacoesComplementares: string;
  itens: DanfeItem[];
};

function parseDanfeData(document: DocumentRecord): DanfeData {
  const sourceXml = document.xml || document.xmlSigned || document.xmlGenerated || "";
  const xml = new DOMParser().parseFromString(sourceXml, "application/xml");
  const infNFe = firstElement(xml.documentElement, "infNFe");
  const ide = firstElement(infNFe, "ide");
  const emit = firstElement(infNFe, "emit");
  const enderEmit = firstElement(emit, "enderEmit");
  const total = firstElement(infNFe, "total");
  const icmsTot = firstElement(total, "ICMSTot");
  const pag = firstElement(infNFe, "pag");
  const detPag = firstElement(pag, "detPag");
  const dest = firstElement(infNFe, "dest");
  const enderDest = firstElement(dest, "enderDest");
  const transp = firstElement(infNFe, "transp");
  const transporta = firstElement(transp, "transporta");
  const veicTransp = firstElement(transp, "veicTransp");
  const vol = firstElement(transp, "vol");
  const infAdic = firstElement(infNFe, "infAdic");
  const infProt = firstElement(xml.documentElement, "infProt");

  const items = allElements(infNFe, "det").map((det): DanfeItem => {
    const prod = firstElement(det, "prod");
    const imposto = firstElement(det, "imposto");
    const icms = firstElement(imposto, "ICMS");
    const icmsDetail = firstChildElement(icms);
    const ipi = firstElement(imposto, "IPI");
    const ipiDetail =
      firstElement(ipi, "IPITrib") || firstElement(ipi, "IPINT");
    return {
      codigo: childText(prod, "cProd"),
      descricao: childText(prod, "xProd"),
      ncm: childText(prod, "NCM"),
      cst:
        childText(icmsDetail, "CST") ||
        childText(icmsDetail, "CSOSN"),
      cfop: childText(prod, "CFOP"),
      quantidade: childText(prod, "qCom"),
      unidade: childText(prod, "uCom"),
      valorUnitario: childText(prod, "vUnCom"),
      valorTotal: childText(prod, "vProd"),
      baseIcms: childText(icmsDetail, "vBC"),
      valorIcms: childText(icmsDetail, "vICMS"),
      valorIpi: childText(ipiDetail, "vIPI"),
      aliquotaIcms: childText(icmsDetail, "pICMS"),
      aliquotaIpi: childText(ipiDetail, "pIPI")
    };
  });

  const address = [
    childText(enderEmit, "xLgr"),
    childText(enderEmit, "nro"),
    childText(enderEmit, "xBairro"),
    childText(enderEmit, "xMun"),
    childText(enderEmit, "UF"),
    childText(enderEmit, "CEP")
  ]
    .filter(Boolean)
    .join(", ");
  const destAddress = [
    childText(enderDest, "xLgr"),
    childText(enderDest, "nro"),
    childText(enderDest, "xCpl")
  ]
    .filter(Boolean)
    .join(", ");

  return {
    numero: childText(ide, "nNF") || String(document.numero),
    serie: childText(ide, "serie") || String(document.serie),
    ambiente: childText(ide, "tpAmb") === "1" ? "PRODUCAO" : "HOMOLOGACAO",
    status: document.status.toUpperCase(),
    emitenteNome: childText(emit, "xNome"),
    emitenteFantasia: childText(emit, "xFant"),
    emitenteCnpj: childText(emit, "CNPJ") || document.issuerCnpj,
    emitenteIe: childText(emit, "IE"),
    emitenteEndereco: address,
    emitenteMunicipio: childText(enderEmit, "xMun"),
    emitenteUf: childText(enderEmit, "UF"),
    emitenteCep: childText(enderEmit, "CEP"),
    emitenteFone: childText(enderEmit, "fone"),
    chave: childText(infProt, "chNFe") || document.chave || "",
    protocolo: childText(infProt, "nProt") || document.protocolo || "",
    naturezaOperacao: childText(ide, "natOp"),
    tipoOperacao: childText(ide, "tpNF"),
    emitidaEm: childText(ide, "dhEmi"),
    recebidoEm: childText(infProt, "dhRecbto"),
    qrCodeUrl: firstText(xml.documentElement, "qrCode"),
    consultaUrl: firstText(xml.documentElement, "urlChave"),
    destinatarioNome: childText(dest, "xNome"),
    destinatarioDocumento:
      childText(dest, "CNPJ") ||
      childText(dest, "CPF") ||
      childText(dest, "idEstrangeiro"),
    destinatarioEndereco: destAddress,
    destinatarioBairro: childText(enderDest, "xBairro"),
    destinatarioCep: childText(enderDest, "CEP"),
    destinatarioMunicipio: childText(enderDest, "xMun"),
    destinatarioUf: childText(enderDest, "UF"),
    destinatarioFone: childText(enderDest, "fone"),
    destinatarioIe: childText(dest, "IE"),
    baseIcms: childText(icmsTot, "vBC"),
    valorIcms: childText(icmsTot, "vICMS"),
    baseIcmsSt: childText(icmsTot, "vBCST"),
    valorIcmsSt: childText(icmsTot, "vST"),
    valorFrete: childText(icmsTot, "vFrete"),
    valorSeguro: childText(icmsTot, "vSeg"),
    valorDesconto: childText(icmsTot, "vDesc"),
    valorIpi: childText(icmsTot, "vIPI"),
    valorPis: childText(icmsTot, "vPIS"),
    valorCofins: childText(icmsTot, "vCOFINS"),
    outrasDespesas: childText(icmsTot, "vOutro"),
    valorTotal: childText(icmsTot, "vNF"),
    valorProdutos: childText(icmsTot, "vProd"),
    formaPagamento: paymentLabel(childText(detPag, "tPag")),
    valorPago: childText(detPag, "vPag"),
    transportadorNome: childText(transporta, "xNome"),
    transportadorDocumento:
      childText(transporta, "CNPJ") || childText(transporta, "CPF"),
    transportadorIe: childText(transporta, "IE"),
    transportadorEndereco: childText(transporta, "xEnder"),
    transportadorMunicipio: childText(transporta, "xMun"),
    transportadorUf: childText(transporta, "UF"),
    modalidadeFrete: freightLabel(childText(transp, "modFrete")),
    placaVeiculo: childText(veicTransp, "placa"),
    veiculoUf: childText(veicTransp, "UF"),
    quantidadeVolumes: childText(vol, "qVol"),
    especieVolumes: childText(vol, "esp"),
    marcaVolumes: childText(vol, "marca"),
    numeracaoVolumes: childText(vol, "nVol"),
    pesoBruto: childText(vol, "pesoB"),
    pesoLiquido: childText(vol, "pesoL"),
    informacoesComplementares: childText(infAdic, "infCpl"),
    itens: items
  };
}

function firstElement(parent: Element | null, localName: string) {
  if (!parent) return null;
  const nodes = parent.getElementsByTagNameNS("*", localName);
  return nodes.item(0) as Element | null;
}

function allElements(parent: Element | null, localName: string) {
  if (!parent) return [];
  const nodes = parent.getElementsByTagNameNS("*", localName);
  return Array.from({ length: nodes.length }, (_, index) => nodes.item(index) as Element);
}

function firstChildElement(parent: Element | null) {
  if (!parent) return null;
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const child = parent.childNodes.item(index);
    if (child?.nodeType === 1) {
      return child as Element;
    }
  }
  return null;
}

function childText(parent: Element | null, localName: string) {
  if (!parent) return "";
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const child = parent.childNodes.item(index);
    if (child?.nodeType === 1 && child.localName === localName) {
      return child.textContent?.trim() ?? "";
    }
  }
  return "";
}

function firstText(parent: Element | null, localName: string) {
  return firstElement(parent, localName)?.textContent?.trim() ?? "";
}

function paymentLabel(code: string) {
  const labels: Record<string, string> = {
    "01": "Dinheiro",
    "02": "Cheque",
    "03": "Cartao de credito",
    "04": "Cartao de debito",
    "17": "PIX",
    "90": "Sem pagamento"
  };
  return labels[code] ?? (code ? `Pagamento ${code}` : "");
}

function freightLabel(code: string) {
  const labels: Record<string, string> = {
    "0": "0 - Emitente",
    "1": "1 - Destinatario",
    "2": "2 - Terceiros",
    "3": "3 - Emitente proprio",
    "4": "4 - Destinatario proprio",
    "9": "9 - Sem frete"
  };
  return labels[code] ?? code;
}

function formatMoney(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value || "0,00";
  return parsed.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatCnpj(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 14) return value;
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

function formatFiscalDocument(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  return formatCnpj(value);
}

function formatQuantity(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value || "0,00";
  return parsed.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatShortDateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo"
  });
}

function formatAuthorizationDate(value: string) {
  return formatShortDateTime(value) || "-";
}

function formatAccessKey(value: string) {
  return value.replace(/\D/g, "").replace(/(\d{4})(?=\d)/g, "$1 ").trim();
}

function nfeDanfeContentStream(data: DanfeData) {
  const width = 595;
  const height = 842;
  const margin = 8;
  const right = width - margin;
  const commands: string[] = [];
  const contentWidth = right - margin;
  const text = (x: number, yPos: number, size: number, value: string, font = "F1") => {
    commands.push(`BT /${font} ${size} Tf ${x} ${yPos} Td (${escapePdf(value)}) Tj ET`);
  };
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    commands.push(`${x1} ${y1} m ${x2} ${y2} l S`);
  };
  const rect = (x: number, yPos: number, rectWidth: number, rectHeight: number) => {
    commands.push(`${x} ${yPos} ${rectWidth} ${rectHeight} re S`);
  };
  const roundedRect = (
    x: number,
    yPos: number,
    rectWidth: number,
    rectHeight: number,
    radius = 3
  ) => {
    const r = Math.min(radius, rectWidth / 2, rectHeight / 2);
    const curve = r * 0.5522847498;
    const left = x;
    const bottom = yPos;
    const rightEdge = x + rectWidth;
    const top = yPos + rectHeight;
    commands.push(
      [
        `${formatPdfNumber(left + r)} ${formatPdfNumber(bottom)} m`,
        `${formatPdfNumber(rightEdge - r)} ${formatPdfNumber(bottom)} l`,
        `${formatPdfNumber(rightEdge - r + curve)} ${formatPdfNumber(bottom)} ${formatPdfNumber(rightEdge)} ${formatPdfNumber(bottom + r - curve)} ${formatPdfNumber(rightEdge)} ${formatPdfNumber(bottom + r)} c`,
        `${formatPdfNumber(rightEdge)} ${formatPdfNumber(top - r)} l`,
        `${formatPdfNumber(rightEdge)} ${formatPdfNumber(top - r + curve)} ${formatPdfNumber(rightEdge - r + curve)} ${formatPdfNumber(top)} ${formatPdfNumber(rightEdge - r)} ${formatPdfNumber(top)} c`,
        `${formatPdfNumber(left + r)} ${formatPdfNumber(top)} l`,
        `${formatPdfNumber(left + r - curve)} ${formatPdfNumber(top)} ${formatPdfNumber(left)} ${formatPdfNumber(top - r + curve)} ${formatPdfNumber(left)} ${formatPdfNumber(top - r)} c`,
        `${formatPdfNumber(left)} ${formatPdfNumber(bottom + r)} l`,
        `${formatPdfNumber(left)} ${formatPdfNumber(bottom + r - curve)} ${formatPdfNumber(left + r - curve)} ${formatPdfNumber(bottom)} ${formatPdfNumber(left + r)} ${formatPdfNumber(bottom)} c`,
        "h S"
      ].join(" ")
    );
  };
  const textWidth = (value: string, size: number, font = "F1") =>
    estimatePdfTextWidth(value, size, font === "F2");
  const rightText = (xRight: number, yPos: number, size: number, value: string, font = "F1") => {
    text(Math.max(margin, xRight - textWidth(value, size, font)), yPos, size, value, font);
  };
  const centered = (x: number, boxWidth: number, yPos: number, size: number, value: string, font = "F1") => {
    text(Math.max(x, x + (boxWidth - textWidth(value, size, font)) / 2), yPos, size, value, font);
  };
  const field = (
    label: string,
    value: string,
    x: number,
    yPos: number,
    boxWidth: number,
    boxHeight: number,
    valueSize = 7,
    align: "left" | "right" | "center" = "left",
    drawBorder = true
  ) => {
    if (drawBorder) {
      rect(x, yPos, boxWidth, boxHeight);
    }
    text(x + 2, yPos + boxHeight - 6, 4.5, label, "F2");
    const values = wrapPdfTextByWidth(value || "-", boxWidth - 5, valueSize).slice(
      0,
      Math.max(1, Math.floor((boxHeight - 9) / (valueSize + 1)))
    );
    values.forEach((lineText, index) => {
      const baseline = yPos + boxHeight - 15 - index * (valueSize + 1);
      if (align === "right") {
        rightText(x + boxWidth - 3, baseline, valueSize, lineText, "F2");
      } else if (align === "center") {
        centered(x, boxWidth, baseline, valueSize, lineText, "F2");
      } else {
        text(x + 2, baseline, valueSize, lineText, "F2");
      }
    });
  };
  const section = (label: string, yPos: number) => {
    text(margin + 1, yPos, 5, label, "F2");
  };

  // Canhoto de recebimento.
  const receiptY = 790;
  roundedRect(margin, receiptY, contentWidth, 44);
  line(margin + 468, receiptY, margin + 468, receiptY + 44);
  line(margin, receiptY + 15, margin + 468, receiptY + 15);
  text(
    margin + 3,
    receiptY + 33,
    5.5,
    `RECEBEMOS DE ${data.emitenteNome || data.emitenteFantasia} OS PRODUTOS E/OU SERVICOS CONSTANTES DA NOTA FISCAL ELETRONICA INDICADA ABAIXO.`
  );
  text(
    margin + 3,
    receiptY + 24,
    5.5,
    `EMISSAO: ${formatShortDateTime(data.emitidaEm) || "-"}  DESTINATARIO: ${data.destinatarioNome || "-"}  VALOR TOTAL: R$ ${formatMoney(data.valorTotal)}`
  );
  text(margin + 3, receiptY + 4, 4.5, "DATA DE RECEBIMENTO");
  text(margin + 150, receiptY + 4, 4.5, "IDENTIFICACAO E ASSINATURA DO RECEBEDOR");
  centered(margin + 468, contentWidth - 468, receiptY + 31, 11, "NF-e", "F2");
  centered(
    margin + 468,
    contentWidth - 468,
    receiptY + 17,
    7,
    `N. ${data.numero.padStart(9, "0")}`,
    "F2"
  );
  centered(
    margin + 468,
    contentWidth - 468,
    receiptY + 7,
    7,
    `Serie ${data.serie.padStart(3, "0")}`,
    "F2"
  );
  commands.push("[2 2] 0 d");
  line(margin, receiptY - 5, right, receiptY - 5);
  commands.push("[] 0 d");

  // Cabecalho principal.
  const headerY = 678;
  const headerHeight = 102;
  const issuerWidth = 238;
  const danfeWidth = 112;
  const accessX = margin + issuerWidth + danfeWidth;
  const accessWidth = contentWidth - issuerWidth - danfeWidth;
  roundedRect(margin, headerY, contentWidth, headerHeight);
  line(margin + issuerWidth, headerY, margin + issuerWidth, headerY + headerHeight);
  line(accessX, headerY, accessX, headerY + headerHeight);
  centered(
    margin,
    issuerWidth,
    headerY + 82,
    10,
    data.emitenteNome || data.emitenteFantasia,
    "F2"
  );
  wrapPdfTextByWidth(data.emitenteEndereco, issuerWidth - 12, 6.5)
    .slice(0, 3)
    .forEach((value, index) => {
      centered(margin + 4, issuerWidth - 8, headerY + 68 - index * 8, 6.5, value);
    });
  centered(
    margin + 4,
    issuerWidth - 8,
    headerY + 38,
    6.5,
    `Municipio: ${data.emitenteMunicipio || "-"} - ${data.emitenteUf || "-"}  CEP: ${data.emitenteCep || "-"}`
  );
  centered(
    margin + 4,
    issuerWidth - 8,
    headerY + 27,
    6.5,
    `CNPJ: ${formatCnpj(data.emitenteCnpj)}  IE: ${data.emitenteIe || "-"}`
  );
  if (data.emitenteFone) {
    centered(margin + 4, issuerWidth - 8, headerY + 16, 6.5, `Fone: ${data.emitenteFone}`);
  }

  centered(margin + issuerWidth, danfeWidth, headerY + 82, 13, "DANFE", "F2");
  centered(margin + issuerWidth, danfeWidth, headerY + 69, 6, "Documento Auxiliar da");
  centered(margin + issuerWidth, danfeWidth, headerY + 60, 6, "Nota Fiscal Eletronica");
  text(margin + issuerWidth + 7, headerY + 43, 7, "0 - ENTRADA");
  text(margin + issuerWidth + 7, headerY + 33, 7, "1 - SAIDA");
  rect(margin + issuerWidth + 87, headerY + 31, 17, 17);
  centered(
    margin + issuerWidth + 87,
    17,
    headerY + 35,
    10,
    data.tipoOperacao === "0" ? "0" : "1",
    "F2"
  );
  centered(
    margin + issuerWidth,
    danfeWidth,
    headerY + 18,
    8,
    `N. ${data.numero.padStart(9, "0")}`,
    "F2"
  );
  centered(
    margin + issuerWidth,
    danfeWidth,
    headerY + 7,
    7,
    `Serie ${data.serie.padStart(3, "0")}  Folha 1/1`,
    "F2"
  );

  drawCode128C(commands, data.chave, accessX + 7, headerY + 60, accessWidth - 14, 35);
  centered(accessX, accessWidth, headerY + 51, 4.5, "CHAVE DE ACESSO", "F2");
  centered(accessX, accessWidth, headerY + 40, 7, formatAccessKey(data.chave), "F2");
  centered(accessX, accessWidth, headerY + 27, 5.5, "Consulta de autenticidade no portal nacional da NF-e");
  centered(accessX, accessWidth, headerY + 18, 5.5, "www.nfe.fazenda.gov.br/portal ou no site da Sefaz autorizadora");
  centered(
    accessX,
    accessWidth,
    headerY + 7,
    5.5,
    `PROTOCOLO: ${data.protocolo || "-"}  ${formatAuthorizationDate(data.recebidoEm)}`,
    "F2"
  );

  field("NATUREZA DA OPERACAO", data.naturezaOperacao, margin, 646, 310, 28, 7);
  field("INSCRICAO ESTADUAL", data.emitenteIe, margin + 310, 646, 130, 28, 7);
  field("CNPJ", formatCnpj(data.emitenteCnpj), margin + 440, 646, contentWidth - 440, 28, 7);

  if (data.ambiente === "HOMOLOGACAO") {
    centered(margin, contentWidth, 638, 7, "HOMOLOGACAO - SEM VALOR FISCAL", "F2");
  }
  if (data.status === "CANCELADO") {
    centered(margin, contentWidth, 628, 8, "NF-e CANCELADA", "F2");
  }

  section("DESTINATARIO / REMETENTE", 622);
  field("NOME / RAZAO SOCIAL", data.destinatarioNome, margin, 590, 300, 28);
  field("CNPJ / CPF", formatFiscalDocument(data.destinatarioDocumento), margin + 300, 590, 150, 28);
  field("DATA DA EMISSAO", formatShortDateTime(data.emitidaEm), margin + 450, 590, contentWidth - 450, 28, 6);
  field("ENDERECO", data.destinatarioEndereco, margin, 562, 260, 28, 6);
  field("BAIRRO / DISTRITO", data.destinatarioBairro, margin + 260, 562, 110, 28, 6);
  field("CEP", data.destinatarioCep, margin + 370, 562, 80, 28, 6);
  field("DATA DA SAIDA / ENTRADA", "", margin + 450, 562, contentWidth - 450, 28, 6);
  field("MUNICIPIO", data.destinatarioMunicipio, margin, 534, 220, 28, 6);
  field("FONE / FAX", data.destinatarioFone, margin + 220, 534, 100, 28, 6);
  field("UF", data.destinatarioUf, margin + 320, 534, 50, 28, 7, "center");
  field("INSCRICAO ESTADUAL", data.destinatarioIe, margin + 370, 534, 80, 28, 6);
  field("HORA DA SAIDA", "", margin + 450, 534, contentWidth - 450, 28, 6);

  section("CALCULO DO IMPOSTO", 526);
  const taxWidth = contentWidth / 5;
  const taxRow1 = [
    ["BASE DE CALCULO DO ICMS", data.baseIcms],
    ["VALOR DO ICMS", data.valorIcms],
    ["BASE DE CALCULO DO ICMS ST", data.baseIcmsSt],
    ["VALOR DO ICMS ST", data.valorIcmsSt],
    ["VALOR TOTAL DOS PRODUTOS", data.valorProdutos]
  ];
  taxRow1.forEach(([label, value], index) => {
    field(label, formatMoney(value), margin + index * taxWidth, 494, taxWidth, 28, 7, "right");
  });
  const taxRow2 = [
    ["VALOR DO FRETE", data.valorFrete],
    ["VALOR DO SEGURO", data.valorSeguro],
    ["DESCONTO", data.valorDesconto],
    ["OUTRAS DESPESAS / IPI", String(Number(data.outrasDespesas || 0) + Number(data.valorIpi || 0))],
    ["VALOR TOTAL DA NOTA", data.valorTotal]
  ];
  taxRow2.forEach(([label, value], index) => {
    field(label, formatMoney(value), margin + index * taxWidth, 466, taxWidth, 28, 7, "right");
  });

  section("TRANSPORTADOR / VOLUMES TRANSPORTADOS", 458);
  field("NOME / RAZAO SOCIAL", data.transportadorNome, margin, 426, 245, 28, 6);
  field("FRETE POR CONTA", data.modalidadeFrete, margin + 245, 426, 120, 28, 6);
  field("CODIGO ANTT / PLACA", data.placaVeiculo, margin + 365, 426, 85, 28, 6);
  field("UF", data.veiculoUf, margin + 450, 426, 35, 28, 6, "center");
  field("CNPJ / CPF", formatFiscalDocument(data.transportadorDocumento), margin + 485, 426, contentWidth - 485, 28, 6);
  field("ENDERECO", data.transportadorEndereco, margin, 398, 245, 28, 6);
  field("MUNICIPIO", data.transportadorMunicipio, margin + 245, 398, 120, 28, 6);
  field("UF", data.transportadorUf, margin + 365, 398, 40, 28, 6, "center");
  field("INSCRICAO ESTADUAL", data.transportadorIe, margin + 405, 398, contentWidth - 405, 28, 6);
  const volumeWidth = contentWidth / 6;
  [
    ["QUANTIDADE", data.quantidadeVolumes],
    ["ESPECIE", data.especieVolumes],
    ["MARCA", data.marcaVolumes],
    ["NUMERACAO", data.numeracaoVolumes],
    ["PESO BRUTO", data.pesoBruto],
    ["PESO LIQUIDO", data.pesoLiquido]
  ].forEach(([label, value], index) => {
    field(label, value, margin + index * volumeWidth, 370, volumeWidth, 28, 6);
  });

  section("DADOS DOS PRODUTOS / SERVICOS", 362);
  const tableTop = 356;
  const tableBottom = 104;
  const columns = [
    ["CODIGO", 38],
    ["DESCRICAO DO PRODUTO / SERVICO", 165],
    ["NCM/SH", 35],
    ["CST", 22],
    ["CFOP", 27],
    ["UN", 18],
    ["QUANT.", 32],
    ["VALOR UNIT.", 40],
    ["VALOR TOTAL", 40],
    ["B.CALC. ICMS", 38],
    ["VALOR ICMS", 35],
    ["VALOR IPI", 30],
    ["ALIQ. ICMS", 32],
    ["ALIQ. IPI", 27]
  ] as const;
  roundedRect(margin, tableBottom, contentWidth, tableTop - tableBottom);
  let columnX = margin;
  for (const [label, columnWidth] of columns) {
    if (columnX > margin) line(columnX, tableBottom, columnX, tableTop);
    wrapPdfTextByWidth(label, columnWidth - 2, 4.2).slice(0, 2).forEach((value, index) => {
      centered(columnX, columnWidth, tableTop - 7 - index * 5, 4.2, value, "F2");
    });
    columnX += columnWidth;
  }
  line(margin, tableTop - 14, right, tableTop - 14);
  const itemValues = (item: DanfeItem) => [
    item.codigo,
    item.descricao,
    item.ncm,
    item.cst,
    item.cfop,
    item.unidade,
    formatQuantity(item.quantidade),
    formatMoney(item.valorUnitario),
    formatMoney(item.valorTotal),
    formatMoney(item.baseIcms),
    formatMoney(item.valorIcms),
    formatMoney(item.valorIpi),
    formatQuantity(item.aliquotaIcms),
    formatQuantity(item.aliquotaIpi)
  ];
  let itemY = tableTop - 24;
  for (const item of data.itens.slice(0, 18)) {
    columnX = margin;
    itemValues(item).forEach((value, index) => {
      const columnWidth = columns[index][1];
      const fontSize = index === 1 ? 4.2 : 4.5;
      const horizontalPadding = index === 1 ? 9 : 3;
      const shown =
        wrapPdfTextByWidth(value, columnWidth - horizontalPadding, fontSize)[0] ?? "";
      if (index >= 6) {
        rightText(columnX + columnWidth - 2, itemY, fontSize, shown);
      } else {
        text(columnX + 2, itemY, fontSize, shown);
      }
      columnX += columnWidth;
    });
    itemY -= 13;
  }
  if (data.itens.length > 18) {
    text(margin + 2, itemY, 5, `Demais ${data.itens.length - 18} item(ns) disponiveis no XML autorizado.`);
  }

  section("DADOS ADICIONAIS", 96);
  roundedRect(margin, 24, contentWidth, 68);
  line(margin + 390, 24, margin + 390, 92);
  field(
    "INFORMACOES COMPLEMENTARES",
    data.informacoesComplementares ||
      `Documento emitido por Nuvem Local Fiscal. Protocolo: ${data.protocolo || "-"}.`,
    margin,
    24,
    390,
    68,
    5.5,
    "left",
    false
  );
  field(
    "RESERVADO AO FISCO",
    "",
    margin + 390,
    24,
    contentWidth - 390,
    68,
    5.5,
    "left",
    false
  );

  return {
    content: commands.join("\n"),
    width,
    height
  };
}

const code128Patterns = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213",
  "122312", "132212", "221213", "221312", "231212", "112232", "122132",
  "122231", "113222", "123122", "123221", "223211", "221132", "221231",
  "213212", "223112", "312131", "311222", "321122", "321221", "312212",
  "322112", "322211", "212123", "212321", "232121", "111323", "131123",
  "131321", "112313", "132113", "132311", "211313", "231113", "231311",
  "112133", "112331", "132131", "113123", "113321", "133121", "313121",
  "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111",
  "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114",
  "413111", "241112", "134111", "111242", "121142", "121241", "114212",
  "124112", "124211", "411212", "421112", "421211", "212141", "214121",
  "412121", "111143", "111341", "131141", "114113", "114311", "411113",
  "411311", "113141", "114131", "311141", "411131", "211412", "211214",
  "211232", "2331112"
] as const;

function drawCode128C(
  commands: string[],
  value: string,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const digits = value.replace(/\D/g, "");
  if (!digits || digits.length % 2 !== 0) {
    rectCommand(commands, x, y, width, height);
    return;
  }

  const values = [105];
  for (let index = 0; index < digits.length; index += 2) {
    values.push(Number(digits.slice(index, index + 2)));
  }
  let checksum = values[0];
  for (let index = 1; index < values.length; index += 1) {
    checksum += values[index] * index;
  }
  values.push(checksum % 103, 106);

  const patterns = values.map((code) => code128Patterns[code]);
  const totalModules = patterns.reduce(
    (total, pattern) =>
      total + Array.from(pattern).reduce((sum, module) => sum + Number(module), 0),
    0
  );
  const moduleWidth = width / totalModules;
  let cursor = x;
  commands.push("0 g");
  for (const pattern of patterns) {
    Array.from(pattern).forEach((module, index) => {
      const segmentWidth = Number(module) * moduleWidth;
      if (index % 2 === 0) {
        commands.push(
          `${formatPdfNumber(cursor)} ${formatPdfNumber(y)} ${formatPdfNumber(segmentWidth)} ${formatPdfNumber(height)} re f`
        );
      }
      cursor += segmentWidth;
    });
  }
  commands.push("0 G");
}

function nfceDanfeContentStream(data: DanfeData) {
  const width = 280;
  const margin = 12;
  const right = width - margin;
  const usableWidth = right - margin;
  const itemRows = data.itens.slice(0, 60).map((item) => ({
    item,
    descriptionLines: wrapPdfTextByWidth(item.descricao, 79, 7).slice(0, 5)
  }));
  const itemBlockHeight = itemRows.reduce(
    (total, row) => total + 10 + row.descriptionLines.length * 8,
    0
  );
  const height = Math.max(420, 520 + itemBlockHeight);
  const commands: string[] = [];
  let y = height - 18;
  const text = (x: number, y: number, size: number, value: string, font = "F1") => {
    commands.push(`BT /${font} ${size} Tf ${x} ${y} Td (${escapePdf(value)}) Tj ET`);
  };
  const textWidth = (value: string, size: number, font = "F1") =>
    estimatePdfTextWidth(value, size, font === "F2");
  const centered = (yPos: number, size: number, value: string, font = "F1") => {
    const approxWidth = textWidth(value, size, font);
    text(Math.max(margin, (width - approxWidth) / 2), yPos, size, value, font);
  };
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    commands.push(`${x1} ${y1} m ${x2} ${y2} l S`);
  };
  const dashedLine = () => {
    commands.push("[2 2] 0 d");
    line(margin, y, right, y);
    commands.push("[] 0 d");
    y -= 9;
  };
  const hr = () => {
    line(margin, y, right, y);
    y -= 10;
  };
  const rightText = (
    xRight: number,
    yPos: number,
    size: number,
    value: string,
    font = "F1",
    minX = margin
  ) => {
    const approxWidth = textWidth(value, size, font);
    text(Math.max(minX, xRight - approxWidth), yPos, size, value, font);
  };

  centered(y, 11, data.emitenteNome || data.emitenteFantasia, "F2");
  y -= 10;
  wrapText(data.emitenteEndereco, 52).slice(0, 2).forEach((value) => {
    centered(y, 7, value);
    y -= 8;
  });
  centered(y, 7, `CNPJ: ${formatCnpj(data.emitenteCnpj)} IE: ${data.emitenteIe || "-"}`);
  y -= 8;
  if (data.emitenteFone) {
    centered(y, 7, `Fone: ${data.emitenteFone}`);
    y -= 8;
  }
  dashedLine();

  centered(y, 10, "DANFE NFC-e - Documento Auxiliar da", "F2");
  y -= 10;
  centered(y, 10, "Nota Fiscal de Consumidor Eletronica", "F2");
  y -= 10;
  if (data.ambiente === "HOMOLOGACAO") {
    centered(y, 8, "HOMOLOGACAO - SEM VALOR FISCAL");
    y -= 9;
  }
  if (data.status === "CANCELADO") {
    centered(y, 11, "NFC-e CANCELADA", "F2");
    y -= 11;
    centered(y, 7, "Documento mantido apenas para consulta", "F2");
    y -= 9;
  }
  dashedLine();

  text(margin, y, 7, "COD", "F2");
  text(46, y, 7, "DESCRICAO", "F2");
  rightText(158, y, 7, "QTDE", "F2", 135);
  text(162, y, 7, "UN", "F2");
  rightText(219, y, 7, "VL UNIT", "F2", 180);
  rightText(right - 1, y, 8, "VL TOTAL", "F2", 224);
  y -= 9;

  for (const { item, descriptionLines } of itemRows) {
    const rowTop = y;
    text(margin, y, 7, item.codigo.slice(0, 6));
    descriptionLines.forEach((value) => {
      text(46, y, 7, value);
      y -= 8;
    });
    rightText(158, rowTop, 7, formatQuantity(item.quantidade), "F1", 135);
    text(162, rowTop, 7, (item.unidade || "UN").slice(0, 3));
    rightText(219, rowTop, 7, formatMoney(item.valorUnitario), "F1", 180);
    rightText(right - 1, rowTop, 7, formatMoney(item.valorTotal));
    y -= 2;
  }
  if (data.itens.length > 60) {
    text(margin, y, 7, `Mais ${data.itens.length - 60} item(ns) no XML.`);
    y -= 12;
  }
  dashedLine();

  text(margin, y, 8, "Qtd. Total de Itens");
  rightText(right, y, 8, String(data.itens.length));
  y -= 12;
  text(margin, y, 12, "Valor a Pagar R$", "F2");
  rightText(right, y, 12, formatMoney(data.valorTotal), "F2");
  y -= 13;
  dashedLine();

  text(margin, y, 7, "FORMA PAGAMENTO");
  rightText(right - 3, y, 5.5, "VALOR PAGO R$", "F2", 205);
  y -= 9;
  text(margin, y, 8, data.formaPagamento || "-");
  rightText(right, y, 8, formatMoney(data.valorPago || data.valorTotal));
  y -= 10;
  text(margin, y, 8, "Troco R$");
  rightText(right, y, 8, "0,00");
  y -= 16;
  dashedLine();

  centered(y, 9, "Consulte pela Chave de Acesso em", "F2");
  y -= 11;
  centered(y, 8, data.consultaUrl || "www.fazenda.pr.gov.br/nfce/consulta");
  y -= 11;
  wrapText(formatAccessKey(data.chave), 42).forEach((value) => {
    centered(y, 8, value);
    y -= 9;
  });
  y -= 4;
  centered(y, 8, data.destinatarioNome || "CONSUMIDOR NAO IDENTIFICADO");
  y -= 13;
  centered(
    y,
    8,
    `NFCe n. ${data.numero.padStart(9, "0")} Serie ${data.serie.padStart(3, "0")}`,
    "F2"
  );
  y -= 10;
  centered(y, 8, `Emissao: ${formatShortDateTime(data.emitidaEm) || "-"}`);
  y -= 10;
  centered(y, 8, "Via Consumidor");
  y -= 10;
  centered(y, 7, `Protocolo de Autorizacao: ${data.protocolo || "-"}`);
  y -= 9;
  centered(y, 7, `Data de Autorizacao: ${formatAuthorizationDate(data.recebidoEm)}`);
  y -= 12;

  const qrSize = 145;
  const qrX = (width - qrSize) / 2;
  y -= qrSize;
  drawQrCode(commands, data.qrCodeUrl || data.chave, qrX, y, qrSize);
  y -= 12;
  centered(y, 6.5, "Consulta via QR Code");
  y -= 10;
  dashedLine();
  wrapText("Tributos Totais Incidentes (Lei Federal 12.741/2012): R$ ----", 58)
    .forEach((value) => {
      text(margin, y, 7, value);
      y -= 8;
    });
  y -= 12;
  centered(y, 6, "Mente Binaria - Solucoes Digitais");

  return {
    content: commands.join("\n"),
    width: Math.max(width, usableWidth),
    height
  };
}

function drawQrCode(commands: string[], value: string, x: number, y: number, size: number) {
  rectCommand(commands, x, y, size, size);
  if (!value) {
    commands.push(`BT /F1 9 Tf ${x + 31} ${y + 58} Td (QR indisponivel) Tj ET`);
    return;
  }

  const qr = QRCode.create(value, { errorCorrectionLevel: "M" });
  const quietZone = 4;
  const modules = qr.modules.size;
  const cell = size / (modules + quietZone * 2);
  commands.push("0 g");
  for (let row = 0; row < modules; row += 1) {
    for (let col = 0; col < modules; col += 1) {
      if (!qr.modules.get(row, col)) {
        continue;
      }
      const px = x + (quietZone + col) * cell;
      const py = y + (quietZone + modules - row - 1) * cell;
      commands.push(`${formatPdfNumber(px)} ${formatPdfNumber(py)} ${formatPdfNumber(cell)} ${formatPdfNumber(cell)} re f`);
    }
  }
  commands.push("0 G");
}

function rectCommand(commands: string[], x: number, y: number, width: number, height: number) {
  commands.push(`${x} ${y} ${width} ${height} re S`);
}

function formatPdfNumber(value: number) {
  return Number(value.toFixed(3)).toString();
}

function estimatePdfTextWidth(value: string, size: number, bold: boolean) {
  const normalized = pdfText(value);
  let units = 0;
  for (const char of normalized) {
    if (char === " ") {
      units += 0.28;
    } else if ("ilI.,:;!|'".includes(char)) {
      units += 0.26;
    } else if ("mwMW@#%".includes(char)) {
      units += 0.82;
    } else if (/\d/.test(char)) {
      units += 0.56;
    } else if (/[A-Z]/.test(char)) {
      units += 0.64;
    } else {
      units += 0.5;
    }
  }
  return units * size * (bold ? 1.07 : 1);
}

function wrapText(value: string, maxLength: number) {
  const words = pdfText(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxLength && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function wrapPdfTextByWidth(
  value: string,
  maxWidth: number,
  size: number,
  font = "F1"
) {
  const words = pdfText(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (estimatePdfTextWidth(candidate, size, font === "F2") <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) {
      lines.push(current);
      current = "";
    }

    let remainder = word;
    while (remainder && estimatePdfTextWidth(remainder, size, font === "F2") > maxWidth) {
      let splitAt = remainder.length - 1;
      while (
        splitAt > 1 &&
        estimatePdfTextWidth(remainder.slice(0, splitAt), size, font === "F2") > maxWidth
      ) {
        splitAt -= 1;
      }
      lines.push(remainder.slice(0, splitAt));
      remainder = remainder.slice(splitAt);
    }
    current = remainder;
  }

  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function pdfText(value: string) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "");
}

function escapePdf(value: string) {
  return pdfText(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}
