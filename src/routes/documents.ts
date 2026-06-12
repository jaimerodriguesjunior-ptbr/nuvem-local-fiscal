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
import { cancelDocumentAtSefaz } from "../lib/sefaz-cancellation.js";
import { inutilizeNumberRangeAtSefaz } from "../lib/sefaz-inutilization.js";
import type { DocumentRecord, DocumentType, Environment } from "../types.js";

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

function mapDocumentResponse(document: DocumentRecord, baseUrl: string) {
  const basePath = document.tipoDocumento === "NFe" ? "/nfe" : "/nfce";
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
          cancelado_em: document.cancelledAt
        }
      : null,
    xml_autorizado_disponivel: artifactsAvailable && Boolean(document.xml),
    pdf_disponivel: artifactsAvailable,
    xml_url: artifactsAvailable ? `${baseUrl}${basePath}/${document.id}/xml` : null,
    pdf_url: artifactsAvailable ? `${baseUrl}${basePath}/${document.id}/pdf` : null,
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
      request.url === "/empresas" ||
      request.url.startsWith("/empresas/")
    ) {
      return ensureBearer(request, reply);
    }
  });

  app.post("/nfe", async (request, reply) => {
    return handleCreateDocument(app, request, reply, "NFe");
  });

  app.post("/nfce", async (request, reply) => {
    return handleCreateDocument(app, request, reply, "NFCe");
  });

  app.post("/nfce/inutilizacoes", async (request, reply) => {
    return handleCreateInutilization(app, request, reply, "NFCe");
  });

  app.get("/nfce/inutilizacoes/:id", async (request, reply) => {
    return handleGetInutilization(app, request, reply, "NFCe");
  });

  app.post("/nfe/inutilizacoes", async (request, reply) => {
    return handleCreateInutilization(app, request, reply, "NFe");
  });

  app.get("/nfe/inutilizacoes/:id", async (request, reply) => {
    return handleGetInutilization(app, request, reply, "NFe");
  });

  app.get("/nfe/:id", async (request, reply) => {
    return handleGetDocument(app, request, reply, "NFe");
  });

  app.get("/nfce/:id", async (request, reply) => {
    return handleGetDocument(app, request, reply, "NFCe");
  });

  app.post("/nfe/:id/cancelar", async (request, reply) => {
    return handleCancelDocument(app, request, reply, "NFe");
  });

  app.post("/nfce/:id/cancelar", async (request, reply) => {
    return handleCancelDocument(app, request, reply, "NFCe");
  });

  app.get("/nfe/:id/xml", async (request, reply) => {
    return handleXmlDownload(app, request, reply, "NFe");
  });

  app.get("/nfce/:id/xml", async (request, reply) => {
    return handleXmlDownload(app, request, reply, "NFCe");
  });

  app.get("/nfe/:id/pdf", async (request, reply) => {
    return handlePdfDownload(app, request, reply, "NFe");
  });

  app.get("/nfce/:id/pdf", async (request, reply) => {
    return handlePdfDownload(app, request, reply, "NFCe");
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
  tipoDocumento: DocumentType
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
  tipoDocumento: DocumentType
) {
  const params = request.params as { id: string };
  const record = app.store.findInutilization(params.id, tipoDocumento);
  if (!record) {
    return reply.code(404).send({ message: "Inutilizacao nao encontrada." });
  }

  return mapInutilizationResponse(record);
}

async function handleCreateDocument(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  tipoDocumento: DocumentType
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

  if (ambiente === "homologacao" && config.autoTransmitHomologation) {
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

async function handleGetDocument(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  tipoDocumento: DocumentType
) {
  const params = request.params as { id: string };
  const storedDocument = app.store.findDocument(params.id, tipoDocumento);
  if (!storedDocument) {
    return reply.code(404).send({
      message: "Documento nao encontrado."
    });
  }

  return mapDocumentResponse(storedDocument, requestBaseUrl(request));
}

async function handleCancelDocument(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  tipoDocumento: DocumentType
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
  if (document.status !== "autorizado" && document.status !== "cancelado") {
    return reply.code(409).send({ message: "XML ainda nao disponivel para este status." });
  }

  reply.header("content-type", "application/xml; charset=utf-8");
  return document.xml;
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

  const pdf = createLocalPdf(document);
  reply.header("content-type", "application/pdf");
  reply.header("content-disposition", `inline; filename="${document.tipoDocumento}-${document.numero}.pdf"`);
  return reply.send(pdf);
}

function createLocalPdf(document: DocumentRecord) {
  const danfe = parseDanfeData(document);
  const page = danfeContentStream(danfe);
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

type DanfeItem = {
  codigo: string;
  descricao: string;
  quantidade: string;
  unidade: string;
  valorUnitario: string;
  valorTotal: string;
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
  emitenteFone: string;
  chave: string;
  protocolo: string;
  emitidaEm: string;
  recebidoEm: string;
  qrCodeUrl: string;
  consultaUrl: string;
  destinatarioNome: string;
  valorTotal: string;
  formaPagamento: string;
  valorPago: string;
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
  const infProt = firstElement(xml.documentElement, "infProt");

  const items = allElements(infNFe, "det").map((det): DanfeItem => {
    const prod = firstElement(det, "prod");
    return {
      codigo: childText(prod, "cProd"),
      descricao: childText(prod, "xProd"),
      quantidade: childText(prod, "qCom"),
      unidade: childText(prod, "uCom"),
      valorUnitario: childText(prod, "vUnCom"),
      valorTotal: childText(prod, "vProd")
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
    emitenteFone: childText(enderEmit, "fone"),
    chave: childText(infProt, "chNFe") || document.chave || "",
    protocolo: childText(infProt, "nProt") || document.protocolo || "",
    emitidaEm: childText(ide, "dhEmi"),
    recebidoEm: childText(infProt, "dhRecbto"),
    qrCodeUrl: firstText(xml.documentElement, "qrCode"),
    consultaUrl: firstText(xml.documentElement, "urlChave"),
    destinatarioNome: childText(dest, "xNome"),
    valorTotal: childText(icmsTot, "vNF"),
    formaPagamento: paymentLabel(childText(detPag, "tPag")),
    valorPago: childText(detPag, "vPag"),
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

function danfeContentStream(data: DanfeData) {
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
