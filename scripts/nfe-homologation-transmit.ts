const documentId = process.argv.find((arg) => arg.startsWith("--id="))?.slice(5);
const confirmation = process.argv
  .find((arg) => arg.startsWith("--confirm="))
  ?.slice("--confirm=".length);

if (!documentId || confirmation !== "TRANSMITIR HOMOLOGACAO") {
  console.error(
    "Uso: npx tsx scripts\\nfe-homologation-transmit.ts --id=doc_xxxxxxxx --confirm=TRANSMITIR HOMOLOGACAO"
  );
  process.exit(1);
}

async function main() {
  const { buildApp } = await import("../src/app.js");
  const { config } = await import("../src/config.js");
  const adminAuthorization = `Basic ${Buffer.from(
    `${config.adminUsername}:${config.adminPassword}`
  ).toString("base64")}`;

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
      throw new Error("Este script transmite somente NF-e em homologacao.");
    }
    if (!document.xmlSigned || !document.signatureValid || !document.xsdValid) {
      throw new Error(
        "Documento precisa estar assinado, com assinatura valida e XSD valido."
      );
    }

    const response = await app.inject({
      method: "POST",
      url: `/admin/api/documents/${documentId}/sefaz-authorize`,
      headers: {
        authorization: adminAuthorization,
        "content-type": "application/json"
      },
      payload: { confirmation }
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
