import { readFileSync } from "node:fs";

import { parseXml } from "libxmljs2";

import { nfseNationalDpsSchemaPath } from "./nfse-national-schema-package.js";

export type NationalNfseXsdValidationResult = {
  valid: boolean;
  errors: string[];
  schema: "DPS_v1.01";
};

export function validateNationalDpsXml(xml: string): NationalNfseXsdValidationResult {
  const schemaPath = nfseNationalDpsSchemaPath();
  try {
    const schema = parseXml(readFileSync(schemaPath, "utf8"), { baseUrl: schemaPath });
    const document = parseXml(xml, { nonet: true });
    const valid = document.validate(schema);
    return {
      valid,
      errors: document.validationErrors.map((error) => {
        const line = error.line ? `linha ${error.line}: ` : "";
        return `${line}${error.message.trim()}`;
      }),
      schema: "DPS_v1.01"
    };
  } catch (error) {
    return {
      valid: false,
      errors: [
        error instanceof Error
          ? `Falha ao executar validacao XSD Nacional: ${error.message}`
          : `Falha ao executar validacao XSD Nacional: ${String(error)}`
      ],
      schema: "DPS_v1.01"
    };
  }
}
