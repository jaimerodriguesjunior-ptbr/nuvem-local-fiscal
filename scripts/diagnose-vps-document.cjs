const fs = require("node:fs");
const http = require("node:http");

const documentId = process.argv[2];
if (!documentId) {
  console.error("Uso: node diagnose-vps-document.cjs <document-id>");
  process.exit(1);
}

function readEnv(path) {
  const env = {};
  const content = fs.readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      env[match[1].trim()] = match[2].trim();
    }
  }
  return env;
}

function requestJson(path, token) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        host: "127.0.0.1",
        port: 3001,
        path,
        headers: { Authorization: `Basic ${token}` }
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          try {
            resolve({
              statusCode: response.statusCode,
              body: JSON.parse(body)
            });
          } catch (error) {
            reject(
              new Error(
                `Resposta invalida HTTP ${response.statusCode}: ${body.slice(0, 500)}`
              )
            );
          }
        });
      }
    );
    request.on("error", reject);
  });
}

async function main() {
  const env = readEnv("/etc/nuvem-local-fiscal.env");
  const token = Buffer.from(
    `${env.ADMIN_USERNAME}:${env.ADMIN_PASSWORD}`,
    "utf8"
  ).toString("base64");

  const eventsResponse = await requestJson(
    `/admin/api/documents/${encodeURIComponent(documentId)}/events`,
    token
  );

  const snapshotResponse = await requestJson("/admin/api/snapshot", token);
  const documents = Array.isArray(snapshotResponse.body.documents)
    ? snapshotResponse.body.documents
    : [];
  const document = documents.find(
    (item) => item.id === documentId || item.providerLikeId === documentId
  );

  const events = Array.isArray(eventsResponse.body.events)
    ? eventsResponse.body.events
    : [];
  const relevantEvents = events.map((event) => ({
    type: event.eventType,
    level: event.level,
    message: event.message,
    payload: event.payload
  }));

  console.log(
    JSON.stringify(
      {
        document: document
          ? {
              id: document.id,
              providerLikeId: document.providerLikeId,
              type: document.tipoDocumento,
              number: document.numero,
              series: document.serie,
              status: document.status,
              reason: document.motivo,
              reasonStatus: document.motivoStatus,
              accessKey: document.chave,
              protocol: document.protocolo,
              xsdValid: document.xsdValid,
              signatureValid: document.signatureValid
            }
          : null,
        events: relevantEvents
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
