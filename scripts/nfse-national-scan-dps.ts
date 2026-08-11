import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { decryptCertificateBundle, parsePfx } from "../src/lib/certificates.js";
import {
  consultNationalDps,
  type NationalSefinTransmissionResult
} from "../src/lib/nfse-national-sefin.js";
import { NFSE_NATIONAL_PRODUCTION_ENDPOINT, NFSE_NATIONAL_RESTRICTED_ENDPOINT } from "../src/lib/nfse-national.js";

function loadEnvFile(path: string) {
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim();
    }
  } catch {
    // The local environment may already be loaded.
  }
}

loadEnvFile("/etc/nuvem-local-fiscal.env");
loadEnvFile(".env.local");
loadEnvFile(".env");

type ScanOptions = {
  cnpj: string;
  municipalityCode: string;
  series: string;
  environment: "homologacao" | "producao";
  from: number;
  to: number;
  delayMs: number;
  attempts: number;
};

function option(name: string, fallback?: string) {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

function requiredOption(name: string) {
  const value = option(name);
  if (!value) throw new Error(`Informe --${name}=valor.`);
  return value;
}

function numberOption(name: string, fallback: number) {
  const value = Number(option(name, String(fallback)));
  if (!Number.isSafeInteger(value)) throw new Error(`Opcao --${name} invalida.`);
  return value;
}

function makeDpsId(options: ScanOptions, number: number) {
  return [
    "DPS",
    options.municipalityCode,
    "2",
    options.cnpj,
    options.series.padStart(5, "0"),
    String(number).padStart(15, "0")
  ].join("");
}

function classify(result: NationalSefinTransmissionResult) {
  const errorText = result.errors.map((item) => `${item.code} ${item.description}`).join(" | ");
  const containsNfseXml = Boolean(
    result.nfseXml &&
    /<(?:(?:[A-Za-z0-9_]+:)?infNFSe)\b/i.test(result.nfseXml) &&
    (/<(?:(?:[A-Za-z0-9_]+:)?chNFSe)>/i.test(result.nfseXml) ||
      /<(?:(?:[A-Za-z0-9_]+:)?cStat)>\s*100\s*</i.test(result.nfseXml))
  );
  if (result.accessKey || containsNfseXml) return "USADA" as const;
  if (/E2404|não foi gerada|nao foi gerada|nao encontrada|não encontrada/i.test(errorText)) {
    return "LIVRE" as const;
  }
  return "INDETERMINADA" as const;
}

function xmlValue(xml: string | null, tag: string) {
  return xml?.match(new RegExp(`<${tag}>([^<]+)</${tag}>`))?.[1]?.trim() ?? null;
}

async function loadCertificate(cnpj: string) {
  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    { auth: { persistSession: false } }
  );
  const { data, error } = await supabase
    .from("fiscal_certificates")
    .select("encrypted_bundle")
    .eq("cnpj", cnpj)
    .eq("active", true)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data?.encrypted_bundle) throw new Error(`Certificado ativo nao encontrado para ${cnpj}.`);
  const bundle = decryptCertificateBundle(
    data.encrypted_bundle,
    process.env.CERTIFICATE_ENCRYPTION_KEY || ""
  );
  return parsePfx(Buffer.from(bundle.pfxBase64, "base64"), bundle.password);
}

async function main() {
  const options: ScanOptions = {
    cnpj: requiredOption("cnpj").replace(/\D/g, ""),
    municipalityCode: requiredOption("municipio").replace(/\D/g, ""),
    series: requiredOption("serie").replace(/\D/g, ""),
    environment: option("ambiente", "producao") as ScanOptions["environment"],
    from: numberOption("de", 1),
    to: numberOption("ate", 30),
    delayMs: numberOption("intervalo-ms", 300),
    attempts: numberOption("tentativas", 3)
  };
  if (!["homologacao", "producao"].includes(options.environment)) {
    throw new Error("--ambiente deve ser homologacao ou producao.");
  }
  if (!/^\d{14}$/.test(options.cnpj)) throw new Error("CNPJ invalido.");
  if (!/^\d{7}$/.test(options.municipalityCode)) throw new Error("Codigo IBGE invalido.");
  if (!options.series || options.series.length > 5) throw new Error("Serie invalida.");
  if (options.from < 1 || options.to < options.from || options.to - options.from + 1 > 100) {
    throw new Error("A faixa deve ter entre 1 e 100 numeros, iniciando em 1 ou mais.");
  }
  if (options.delayMs < 100) throw new Error("Use intervalo minimo de 100 ms entre consultas.");
  if (options.attempts < 1 || options.attempts > 10) throw new Error("Use entre 1 e 10 tentativas por numero.");

  const certificate = await loadCertificate(options.cnpj);
  const endpoint = options.environment === "producao"
    ? NFSE_NATIONAL_PRODUCTION_ENDPOINT
    : NFSE_NATIONAL_RESTRICTED_ENDPOINT;
  const results: Array<Record<string, unknown>> = [];

  console.log(JSON.stringify({ mode: "read-only", endpoint, ...options }, null, 2));
  for (let number = options.from; number <= options.to; number += 1) {
    const dpsId = makeDpsId(options, number);
    try {
      let response: NationalSefinTransmissionResult | null = null;
      let classification: ReturnType<typeof classify> = "INDETERMINADA";
      for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
        response = await consultNationalDps({
          endpoint,
          dpsId,
          privateKeyPem: certificate.privateKeyPem,
          certificatePem: certificate.certificatePem,
          certificateChainPem: certificate.certificateChainPem
        });
        classification = classify(response);
        if (classification !== "INDETERMINADA" || attempt === options.attempts) break;
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }
      if (!response) throw new Error("SEFIN nao retornou resposta.");
      const result = {
        number,
        dpsId,
        result: classification,
        attempts: options.attempts,
        httpStatus: response.statusCode,
        accessKey: response.accessKey,
        code: response.errors[0]?.code ?? null,
        message: response.errors[0]?.description ?? null,
        nfseNumber: xmlValue(response.nfseXml, "nNFSe"),
        value: xmlValue(response.nfseXml, "vServ"),
        issuedAt: xmlValue(response.nfseXml, "dhEmi"),
        customerName: xmlValue(response.nfseXml, "xNome")
      };
      results.push(result);
      console.log(JSON.stringify(result));
    } catch (error) {
      const result = {
        number,
        dpsId,
        result: "INDETERMINADA",
        error: error instanceof Error ? error.message : String(error)
      };
      results.push(result);
      console.log(JSON.stringify(result));
    }
    if (number < options.to) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
  }

  console.log(JSON.stringify({
    summary: {
      usada: results.filter((item) => item.result === "USADA").length,
      livre: results.filter((item) => item.result === "LIVRE").length,
      indeterminada: results.filter((item) => item.result === "INDETERMINADA").length
    },
    firstFree: results.find((item) => item.result === "LIVRE")?.number ?? null
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
