import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { parsePfx, encryptCertificateBundle } from "../lib/certificates.js";
import { certificateHolderCnpj } from "../lib/certificate-holder-cnpj.js";
import type { AccessTokenRecord, Environment } from "../types.js";

const enrolling = new Set<string>();

export async function registerCompanyEnrollmentRoute(app: FastifyInstance) {
  // O preHandler de registerDocumentRoutes exige Bearer e o escopo empresa.
  // Esta rota estática não usa o bypass das rotas /empresas/:cnpj.
  app.post("/empresas/cadastro-certificado", { bodyLimit: 3 * 1024 * 1024 }, async (request, reply) => {
    const token = (request as FastifyRequest & { tokenRecord: AccessTokenRecord }).tokenRecord;
    if (!token?.scopes.includes("empresa-cadastro")) {
      return reply.code(403).send({ error: "enrollment_not_allowed", message: "A integração não está habilitada para cadastrar novas empresas com certificado." });
    }
    const client = app.store.apiClients.find(c => c.active && c.clientId === token.clientId);
    if (!client?.allowedScopes.includes("empresa-cadastro")) return reply.code(403).send({ message: "Integração sem permissão de cadastro." });
    const body = request.body as Record<string, unknown>;
    const data = (body?.empresa ?? {}) as Record<string, unknown>;
    const cnpj = String(data.cnpj ?? "").replace(/\D/g, "");
    const municipality = String(data.codigo_municipio_ibge ?? "").replace(/\D/g, "");
    const environments = Array.isArray(body?.ambientes) ? [...new Set(body.ambientes.map(String))] : [];
    if (!/^\d{14}$/.test(cnpj) || !/^\d{7}$/.test(municipality) || !String(data.razao_social ?? "").trim()) {
      return reply.code(400).send({ message: "Informe CNPJ, razão social e município IBGE válidos." });
    }
    if (!environments.length || environments.some(e => !["homologacao", "producao"].includes(e) || !token.environments.includes(e as Environment))) {
      return reply.code(403).send({ message: "Ambiente de cadastro não permitido para esta integração." });
    }
    const allowed = client.allowedCnpjs.includes(cnpj) || client.allowedCnpjs.includes("*");
    if (!allowed && app.store.issuers.some(i => i.cnpj === cnpj)) {
      return reply.code(409).send({ message: "Este CNPJ já está cadastrado na Nuvem Local. Solicite ao administrador a vinculação à integração deste programa." });
    }
    if (enrolling.has(cnpj)) return reply.code(409).send({ message: "Cadastro deste CNPJ em andamento. Tente novamente após sua conclusão." });
    const pfxBase64 = typeof body.pfxBase64 === "string" ? body.pfxBase64 : "";
    if (!pfxBase64 || typeof body.password !== "string" || Buffer.byteLength(pfxBase64, "base64") > 2 * 1024 * 1024) {
      return reply.code(400).send({ message: "Envie o certificado A1 (.pfx/.p12) de até 2 MB e a senha." });
    }
    let parsed;
    try {
      parsed = parsePfx(Buffer.from(pfxBase64, "base64"), body.password);
      const holder = certificateHolderCnpj(parsed.certificatePem);
      if (holder !== cnpj) return reply.code(400).send({ message: "O certificado não identifica o CNPJ informado." });
      if (new Date(parsed.validFrom).getTime() > Date.now() || new Date(parsed.validUntil).getTime() <= Date.now()) {
        return reply.code(400).send({ message: "O certificado está vencido ou ainda não é válido." });
      }
    } catch {
      return reply.code(400).send({ message: "Não foi possível validar o certificado. Confira o arquivo e a senha." });
    }
    enrolling.add(cnpj);
    try {
      const registeredAt = new Date().toISOString();
      for (const environment of environments as Environment[]) {
        const existing = app.store.findIssuerByCnpj(cnpj, environment);
        app.store.upsertIssuerEnvironment(cnpj, environment, {
          razaoSocial: String(data.razao_social), nomeFantasia: String(data.nome_fantasia || data.razao_social),
          uf: String(data.uf || "").toUpperCase(), ie: String(data.inscricao_estadual || ""), crt: String(data.regime_tributario || ""),
          metadata: {
            email: String(data.email_contato || ""), inscricao_municipal: String(data.inscricao_municipal || ""),
            endereco: { logradouro: data.logradouro, numero: data.numero, complemento: data.complemento, bairro: data.bairro,
              codigo_municipio: municipality, cidade: data.cidade, uf: data.uf, cep: data.cep },
            registeredByIntegration: existing?.metadata?.registeredByIntegration ?? client.clientId,
            externalCompanyId: existing?.metadata?.externalCompanyId ?? String(body.externalCompanyId || ""),
            lastCertificateUploadIntegration: client.clientId, lastCertificateUploadAt: registeredAt,
          },
        });
      }
      app.store.createOrReplaceCertificate(cnpj, {
        fileName: String(body.fileName || "certificado.pfx"),
        encryptedBundle: encryptCertificateBundle({ pfxBase64, password: body.password }, config.certificateEncryptionKey),
        validFrom: parsed.validFrom, validUntil: parsed.validUntil, serialNumber: parsed.serialNumber,
        subject: parsed.subject, holderCnpj: cnpj,
      });
      if (!allowed) app.store.upsertApiClient({ ...client, allowedCnpjs: [...client.allowedCnpjs, cnpj] });
      await app.store.waitForPersistence();
      return reply.code(201).send({ success: true, cnpj, ambientes: environments,
        certificado: { valid_until: parsed.validUntil }, message: "Empresa e certificado cadastrados na Nuvem Local Fiscal." });
    } catch {
      return reply.code(503).send({ message: "Não foi possível confirmar a persistência do cadastro na Nuvem Local. Consulte o administrador antes de repetir." });
    } finally {
      enrolling.delete(cnpj);
    }
  });
}
