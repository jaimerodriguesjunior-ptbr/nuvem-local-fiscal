const documentId = process.argv.find((arg) => arg.startsWith("--id="))?.slice(5);
const confirmation = process.argv
  .find((arg) => arg.startsWith("--confirm="))
  ?.slice("--confirm=".length);
const justification =
  process.argv.find((arg) => arg.startsWith("--justificativa="))?.slice(16) ??
  "Erro de preenchimento nos dados da NF-e em homologacao";

if (!documentId || confirmation !== "CANCELAR HOMOLOGACAO") {
  console.error(
    "Uso: npx tsx scripts\\nfe-homologation-cancel.ts --id=doc_xxxxxxxx --confirm=CANCELAR HOMOLOGACAO --justificativa=\"Erro de preenchimento nos dados da NF-e em homologacao\""
  );
  process.exit(1);
}

async function main() {
  const { buildApp } = await import("../src/app.js");
  const { config } = await import("../src/config.js");
  const tokenAuthorization = await createBearerToken(buildApp, config);

  const app = buildApp();
  await app.ready();

  try {
    const document = app.store.findDocument(documentId);
    if (!document) {
      throw new Error(`Documento ${documentId} nao encontrado.`);
    }
    if (document.tipoDocumento !== "NFe") {
      throw new Error(`Documento ${documentId} nao e NF-e.`);
    }
    if (document.ambiente !== "homologacao") {
      throw new Error("Este script cancela somente NF-e em homologacao.");
    }
    if (document.status !== "autorizado") {
      throw new Error(`Documento precisa estar autorizado. Status atual: ${document.status}.`);
    }

    const response = await app.inject({
      method: "POST",
      url: `/nfe/${documentId}/cancelar`,
      headers: {
        authorization: tokenAuthorization,
        "content-type": "application/json"
      },
      payload: { justificativa: justification }
    });

    const body = response.json();
    console.log(
      JSON.stringify(
        {
          http_status: response.statusCode,
          ...body
        },
        null,
        2
      )
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

async function createBearerToken(
  buildApp: typeof import("../src/app.js").buildApp,
  config: typeof import("../src/config.js").config
) {
  const app = buildApp();
  await app.ready();
  try {
    const tokenResponse = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.defaultClientId,
        client_secret: config.defaultClientSecret,
        scope: "empresa nfe nfce"
      }).toString()
    });
    if (tokenResponse.statusCode !== 200) {
      throw new Error(`Falha no OAuth local: ${tokenResponse.body}`);
    }
    return `Bearer ${tokenResponse.json().access_token}`;
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
