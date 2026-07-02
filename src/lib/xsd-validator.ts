import { readFileSync } from "node:fs";

import { parseXml } from "libxmljs2";

import { nfeSchemaPath } from "./nfe-schema-package.js";

const schemaPath = nfeSchemaPath("nfe_v4.00.xsd");

export type XsdValidationResult = {
  valid: boolean;
  errors: string[];
  schema: "PL_010c";
};

export function validateNfeXml(xml: string): XsdValidationResult {
  try {
    const schema = parseXml(readFileSync(schemaPath, "utf8"), {
      baseUrl: schemaPath
    });
    const document = parseXml(xml, {
      nonet: true
    });
    const valid = document.validate(schema);
    return {
      valid,
      errors: document.validationErrors.map((error) => {
        const line = error.line ? `linha ${error.line}: ` : "";
        return `${line}${error.message.trim()}`;
      }),
      schema: "PL_010c"
    };
  } catch (error) {
    return {
      valid: false,
      errors: [
        error instanceof Error
          ? `Falha ao executar validacao XSD: ${error.message}`
          : `Falha ao executar validacao XSD: ${String(error)}`
      ],
      schema: "PL_010c"
    };
  }
}
