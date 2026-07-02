import { readFile, writeFile } from "node:fs/promises";

const sourcePath = "classificacoes-tributarias-02-07-2026_17-44-56.json";
const targetPath = "src/lib/rtc-classifications-2026-07-02.ts";

const data = JSON.parse(await readFile(sourcePath, "utf8"));

const lines = [
  "export type OfficialRtcIbsCbsClassification = {",
  "  code: string;",
  "  models: Array<55 | 65>;",
  "};",
  "",
  "export const officialRtcIbsCbsClassifications20260702 = ["
];

for (const entry of data) {
  const models = [];
  for (const dfeType of entry.tiposDfeClassificacao ?? []) {
    if ((dfeType.tipo === 55 || dfeType.tipo === 65) && !models.includes(dfeType.tipo)) {
      models.push(dfeType.tipo);
    }
  }
  lines.push(`  { code: "${entry.codigo}", models: [${models.join(", ")}] },`);
}

lines.push("] satisfies OfficialRtcIbsCbsClassification[];");
lines.push("");

await writeFile(targetPath, lines.join("\n"), "utf8");
