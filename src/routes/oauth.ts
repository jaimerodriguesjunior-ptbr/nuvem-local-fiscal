import type { FastifyInstance } from "fastify";

export async function registerOAuthRoutes(app: FastifyInstance) {
  app.post("/oauth/token", async (request, reply) => {
    const body = request.body as Record<string, string> | undefined;
    const grantType = body?.grant_type;
    const clientId = body?.client_id;
    const clientSecret = body?.client_secret;
    const requestedScope = body?.scope?.trim();

    if (grantType !== "client_credentials") {
      return reply.code(400).send({
        error: "unsupported_grant_type",
        error_description: "Somente client_credentials esta habilitado neste v0."
      });
    }

    if (!clientId || !clientSecret) {
      return reply.code(400).send({
        error: "invalid_client",
        error_description: "client_id e client_secret sao obrigatorios."
      });
    }

    const client = app.store.findClient(clientId, clientSecret);
    if (!client) {
      return reply.code(401).send({
        error: "invalid_client",
        error_description: "Credenciais invalidas."
      });
    }

    const scope = requestedScope || client.allowedScopes.join(" ");
    const token = app.store.createAccessToken(
      client.clientId,
      scope.split(/\s+/).filter(Boolean),
      client.allowedEnvironments
    );

    return {
      access_token: token.token,
      token_type: "bearer",
      expires_in: 3600,
      scope
    };
  });
}
