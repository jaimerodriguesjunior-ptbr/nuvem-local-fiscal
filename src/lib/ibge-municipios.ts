import { IBGE_MUNICIPIO_NOMES } from "./ibge-municipios-data.js";

const UF_BY_IBGE_PREFIX: Record<string, string> = {
  "11": "RO",
  "12": "AC",
  "13": "AM",
  "14": "RR",
  "15": "PA",
  "16": "AP",
  "17": "TO",
  "21": "MA",
  "22": "PI",
  "23": "CE",
  "24": "RN",
  "25": "PB",
  "26": "PE",
  "27": "AL",
  "28": "SE",
  "29": "BA",
  "31": "MG",
  "32": "ES",
  "33": "RJ",
  "35": "SP",
  "41": "PR",
  "42": "SC",
  "43": "RS",
  "50": "MS",
  "51": "MT",
  "52": "GO",
  "53": "DF"
};

export function normalizeIbgeMunicipalityCode(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 7 ? digits : "";
}

export function resolveIbgeMunicipality(value: unknown) {
  const codigo = normalizeIbgeMunicipalityCode(value);
  if (!codigo) return null;
  const nome = IBGE_MUNICIPIO_NOMES[codigo];
  const uf = UF_BY_IBGE_PREFIX[codigo.slice(0, 2)];
  if (!nome || !uf) return null;
  return { codigo, nome, uf };
}

export function formatMunicipioUfLabel(options: {
  nome?: unknown;
  uf?: unknown;
  codigoIbge?: unknown;
}) {
  const nome = String(options.nome ?? "").trim();
  const uf = String(options.uf ?? "").trim().toUpperCase();
  const resolved = resolveIbgeMunicipality(options.codigoIbge);
  const finalNome = nome || resolved?.nome || "";
  const finalUf = uf || resolved?.uf || "";
  if (!finalNome && !finalUf) return "";
  return `${finalNome || "-"} / ${finalUf || "-"}`;
}
