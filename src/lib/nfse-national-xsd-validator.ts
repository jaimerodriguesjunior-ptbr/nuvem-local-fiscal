import { readFileSync } from "node:fs";

import { parseXml } from "libxmljs2";

import {
  nfseNationalDpsSchemaPath,
  nfseNationalEventSchemaPath
} from "./nfse-national-schema-package.js";

export type NationalNfseXsdValidationResult = {
  valid: boolean;
  errors: string[];
  schema: "DPS_v1.01" | "pedRegEvento_v1.01";
};

function validateNationalXml(
  xml: string,
  schemaPath: string,
  schema: NationalNfseXsdValidationResult["schema"]
): NationalNfseXsdValidationResult {
  try {
    const xsd = parseXml(readFileSync(schemaPath, "utf8"), { baseUrl: schemaPath });
    const document = parseXml(xml, { nonet: true });
    const valid = document.validate(xsd);
    return {
      valid,
      errors: document.validationErrors.map((error) => {
        const line = error.line ? `linha ${error.line}: ` : "";
        return `${line}${error.message.trim()}`;
      }),
      schema
    };
  } catch (error) {
    return {
      valid: false,
      errors: [
        error instanceof Error
          ? `Falha ao executar validacao XSD Nacional: ${error.message}`
          : `Falha ao executar validacao XSD Nacional: ${String(error)}`
      ],
      schema
    };
  }
}

export function validateNationalDpsXml(xml: string): NationalNfseXsdValidationResult {
  return validateNationalXml(xml, nfseNationalDpsSchemaPath(), "DPS_v1.01");
}

export function validateNationalCancellationEventXml(xml: string): NationalNfseXsdValidationResult {
  return validateNationalXml(xml, nfseNationalEventSchemaPath(), "pedRegEvento_v1.01");
}
