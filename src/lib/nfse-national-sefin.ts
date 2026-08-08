import { gzipSync, gunzipSync } from "node:zlib";
import { request as httpsRequest } from "node:https";
import type { RequestOptions } from "node:https";

export type NationalSefinError = {
  code: string;
  description: string;
  detail: string | null;
};

export type NationalSefinTransmissionResult = {
  accepted: boolean;
  statusCode: number;
  accessKey: string | null;
  nfseXml: string | null;
  rawBody: string;
  errors: NationalSefinError[];
};

export type NationalSefinEventResult = {
  accepted: boolean;
  statusCode: number;
  eventStatusCode: string | null;
  eventReason: string | null;
  protocol: string | null;
  processedXml: string | null;
  rawBody: string;
  errors: NationalSefinError[];
};

export type NationalSefinTransport = (
  options: RequestOptions,
  body: string
) => Promise<{ statusCode: number; body: string }>;

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function gzipBase64(xml: string) {
  return gzipSync(Buffer.from(xml, "utf8")).toString("base64");
}

export function gunzipBase64(value: string) {
  return gunzipSync(Buffer.from(value, "base64")).toString("utf8");
}

export function nationalSefinEndpoint(baseUrl: string, path: string) {
  return new URL(path.replace(/^\/+/, ""), `${trimTrailingSlash(baseUrl)}/`);
}

export function parseNationalSefinResponse(
  statusCode: number,
  rawBody: string
): NationalSefinTransmissionResult {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    // A SEFIN pode devolver corpo vazio em falhas de infraestrutura.
  }
  const rawErrors = Array.isArray(payload.erros)
    ? payload.erros
    : payload.erro && typeof payload.erro === "object"
      ? [payload.erro]
      : [];
  const errors = rawErrors
    .map((item) => {
        const value = (item ?? {}) as Record<string, unknown>;
        return {
          code: String(value.Codigo ?? value.codigo ?? "SEFIN"),
          description: String(value.Descricao ?? value.descricao ?? "Erro retornado pela SEFIN."),
          detail: value.Complemento ?? value.complemento
            ? String(value.Complemento ?? value.complemento)
            : null
        };
      });
  const compressedXml = String(
    payload.nfseXmlGZipB64 ?? payload.NFSeXmlGZipB64 ?? payload.xmlNfseGZipB64 ?? ""
  ).trim();
  let nfseXml: string | null = rawBody.trim().startsWith("<")
    ? rawBody.trim()
    : String(payload.nfseXml ?? payload.xmlNfse ?? "").trim() || null;
  if (compressedXml) {
    try {
      nfseXml = gunzipBase64(compressedXml);
    } catch {
      errors.push({
        code: "SEFIN_XML_GZIP",
        description: "A resposta da SEFIN contem XML compactado invalido.",
        detail: null
      });
    }
  }
  const accessKey = String(
    payload.chaveAcesso ?? payload.chNFSe ?? payload.ChaveAcesso ?? ""
  ).trim() || nfseXml?.match(/<chNFSe>([^<]+)<\/chNFSe>/)?.[1]?.trim() || null;
  return {
    accepted: statusCode >= 200 && statusCode < 300 && errors.length === 0,
    statusCode,
    accessKey,
    nfseXml,
    rawBody,
    errors
  };
}

function firstXmlTag(xml: string, names: string[]) {
  for (const name of names) {
    const match = xml.match(new RegExp(`<(?:(?:[A-Za-z0-9_]+):)?${name}[^>]*>([^<]*)<\\/(?:(?:[A-Za-z0-9_]+):)?${name}>`));
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

export function parseNationalSefinEventResponse(
  statusCode: number,
  rawBody: string
): NationalSefinEventResult {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    // A resposta XML tambÃ©m Ã© aceita para preservar o retorno bruto.
  }
  const rawErrors = Array.isArray(payload.erros)
    ? payload.erros
    : payload.erro && typeof payload.erro === "object"
      ? [payload.erro]
      : [];
  const errors = rawErrors.map((item) => {
    const value = (item ?? {}) as Record<string, unknown>;
    return {
      code: String(value.Codigo ?? value.codigo ?? "SEFIN_EVENTO"),
      description: String(value.Descricao ?? value.descricao ?? "Erro retornado pela SEFIN no evento."),
      detail: value.Complemento ?? value.complemento
        ? String(value.Complemento ?? value.complemento)
        : null
    };
  });
  const compressedXml = String(
    payload.eventoXmlGZipB64 ?? payload.pedRegEventoXmlGZipB64 ??
    payload.xmlEventoGZipB64 ?? payload.retEventoXmlGZipB64 ?? ""
  ).trim();
  let processedXml = rawBody.trim().startsWith("<") ? rawBody.trim() : null;
  if (compressedXml) {
    try {
      processedXml = gunzipBase64(compressedXml);
    } catch {
      errors.push({
        code: "SEFIN_EVENTO_XML_GZIP",
        description: "A resposta do evento contem XML compactado invalido.",
        detail: null
      });
    }
  }
  const eventStatusCode = String(
    payload.codigoStatus ?? payload.cStat ?? payload.statusCode ?? ""
  ).trim() || firstXmlTag(processedXml ?? "", ["cStat"]);
  const eventReason = String(
    payload.motivoStatus ?? payload.xMotivo ?? payload.motivo ?? ""
  ).trim() || firstXmlTag(processedXml ?? "", ["xMotivo", "motivoStatus"]);
  const protocol = String(
    payload.numeroProtocolo ?? payload.protocolo ?? payload.nProt ?? ""
  ).trim() || firstXmlTag(processedXml ?? "", ["nProt", "numeroProtocolo"]);
  const acceptedStatus = !eventStatusCode || ["135", "136", "155"].includes(eventStatusCode);
  return {
    accepted: statusCode >= 200 && statusCode < 300 && errors.length === 0 && acceptedStatus,
    statusCode,
    eventStatusCode,
    eventReason,
    protocol,
    processedXml,
    rawBody,
    errors
  };
}

export const requestNationalSefin: NationalSefinTransport = (options, body) =>
  new Promise((resolve, reject) => {
    const request = httpsRequest(options, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      response.on("end", () =>
        resolve({
          statusCode: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8")
        })
      );
    });
    request.setTimeout(30_000, () => request.destroy(new Error("Timeout ao chamar a SEFIN Nacional.")));
    request.on("error", reject);
    request.write(body);
    request.end();
  });

export async function transmitNationalDps(input: {
  endpoint: string;
  signedDpsXml: string;
  privateKeyPem: string;
  certificatePem: string;
  certificateChainPem?: string;
  transport?: NationalSefinTransport;
}): Promise<NationalSefinTransmissionResult> {
  const target = nationalSefinEndpoint(input.endpoint, "nfse");
  const body = JSON.stringify({ dpsXmlGZipB64: gzipBase64(input.signedDpsXml) });
  const response = await (input.transport ?? requestNationalSefin)(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body)
      },
      key: input.privateKeyPem,
      cert: `${input.certificatePem}${input.certificateChainPem ?? ""}`,
      rejectUnauthorized: true
    },
    body
  );
  return parseNationalSefinResponse(response.statusCode, response.body);
}

export async function consultNationalDps(input: {
  endpoint: string;
  dpsId: string;
  privateKeyPem: string;
  certificatePem: string;
  certificateChainPem?: string;
  transport?: NationalSefinTransport;
}): Promise<NationalSefinTransmissionResult> {
  const target = nationalSefinEndpoint(input.endpoint, `dps/${encodeURIComponent(input.dpsId)}`);
  const response = await (input.transport ?? requestNationalSefin)(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: "GET",
      headers: { accept: "application/json" },
      key: input.privateKeyPem,
      cert: `${input.certificatePem}${input.certificateChainPem ?? ""}`,
      rejectUnauthorized: true
    },
    ""
  );
  return parseNationalSefinResponse(response.statusCode, response.body);
}

export async function consultNationalNfse(input: {
  endpoint: string;
  accessKey: string;
  privateKeyPem: string;
  certificatePem: string;
  certificateChainPem?: string;
  transport?: NationalSefinTransport;
}): Promise<NationalSefinTransmissionResult> {
  const target = nationalSefinEndpoint(input.endpoint, `nfse/${encodeURIComponent(input.accessKey)}`);
  const response = await (input.transport ?? requestNationalSefin)(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: "GET",
      headers: { accept: "application/json, application/xml" },
      key: input.privateKeyPem,
      cert: `${input.certificatePem}${input.certificateChainPem ?? ""}`,
      rejectUnauthorized: true
    },
    ""
  );
  return parseNationalSefinResponse(response.statusCode, response.body);
}

export async function transmitNationalCancellation(input: {
  endpoint: string;
  accessKey: string;
  signedEventXml: string;
  privateKeyPem: string;
  certificatePem: string;
  certificateChainPem?: string;
  transport?: NationalSefinTransport;
}): Promise<NationalSefinEventResult> {
  const target = nationalSefinEndpoint(
    input.endpoint,
    `nfse/${encodeURIComponent(input.accessKey)}/eventos`
  );
  const body = JSON.stringify({ pedRegEventoXmlGZipB64: gzipBase64(input.signedEventXml) });
  const response = await (input.transport ?? requestNationalSefin)(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      path: `${target.pathname}${target.search}`,
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body)
      },
      key: input.privateKeyPem,
      cert: `${input.certificatePem}${input.certificateChainPem ?? ""}`,
      rejectUnauthorized: true
    },
    body
  );
  return parseNationalSefinEventResponse(response.statusCode, response.body);
}
