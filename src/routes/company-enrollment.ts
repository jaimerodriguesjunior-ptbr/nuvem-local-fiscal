import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { config } from "../config.js";
import { EnrollmentError, prepareEnrollment, readEnrollmentTrust, requestIdPattern } from "../lib/company-enrollment.js";
import type { AccessTokenRecord } from "../types.js";

export async function registerCompanyEnrollmentRoute(app: FastifyInstance) {
  function tokenFor(request: FastifyRequest) {
    const token = (request as FastifyRequest & { tokenRecord: AccessTokenRecord }).tokenRecord;
    if (!token?.scopes.includes("empresa") || !token.scopes.includes("empresa-cadastro")) {
      throw new EnrollmentError(403, "enrollment_not_allowed", "A integração não está habilitada para cadastrar empresas com certificado.");
    }
    return token;
  }
  function failure(error: unknown, reply: FastifyReply) {
    if (error instanceof EnrollmentError) return reply.code(error.status).send({ error: error.code, message: error.message });
    // Never log payload, PFX, password, SQL arguments or persistence exception text.
    return reply.code(503).send({ error: "enrollment_unconfirmed", message: "Cadastro ainda não confirmado. Consulte a mesma solicitação antes de tentar novamente." });
  }
  app.get("/empresas/cadastro-certificado/:requestId", async (request, reply) => {
    try {
      const token = tokenFor(request), { requestId } = request.params as { requestId: string };
      if (!requestIdPattern.test(requestId)) throw new EnrollmentError(400, "invalid_request_id", "Solicitação inválida.");
      const result = await app.store.lookupCompanyEnrollment(token.clientId, token.clientVersion ?? "", requestId.toLowerCase());
      return result ? reply.send(result) : reply.code(404).send({ error: "enrollment_not_found", message: "Solicitação de cadastro não encontrada." });
    } catch (error) { return failure(error, reply); }
  });
  app.post("/empresas/cadastro-certificado", { bodyLimit: 3 * 1024 * 1024 }, async (request, reply) => {
    try {
      const token = tokenFor(request);
      const input = prepareEnrollment(request.body, token.clientId, token.clientVersion ?? "", token.environments,
        config.certificateEncryptionKey, readEnrollmentTrust(config.enrollmentTrustFile));
      const result = await app.store.enrollCompany(input);
      return reply.code(201).send(result);
    } catch (error) { return failure(error, reply); }
  });
}
