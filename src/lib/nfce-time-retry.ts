import type { DocumentRecord } from "../types.js";

export function prepareHomologationNfceTimeRetry(document: DocumentRecord, now = new Date()) {
  if (document.ambiente !== "homologacao" || document.tipoDocumento !== "NFCe" ||
      !["erro", "rejeitado"].includes(document.status) || document.motivoStatus !== "704" ||
      document.protocolo || document.sefazReceipt || !/^\d{44}$/.test(document.chave ?? "")) {
    throw new Error("Renovacao de horario exige NFC-e de homologacao rejeitada com codigo 704 e sem protocolo/recibo pendente.");
  }
  const payload = structuredClone(document.payloadOriginal) as Record<string, any>;
  const inf = payload?.infNFe, ide = inf?.ide;
  if (!ide || Number(ide.mod) !== 65 || Number(ide.tpAmb) !== 2 ||
      Number(ide.nNF) !== document.numero || Number(ide.serie) !== document.serie ||
      String(inf.emit?.CNPJ) !== document.issuerCnpj || !Number.isFinite(Date.parse(ide.dhEmi))) {
    throw new Error("Identidade do payload diverge do documento existente.");
  }
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  const issueTime = `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}-03:00`;
  if (document.chave!.slice(2, 6) !== values.year.slice(-2) + values.month ||
      String(ide.dhEmi).slice(0, 7) !== issueTime.slice(0, 7)) {
    throw new Error("Mudanca de mes exige conciliacao; a chave existente deve ser preservada.");
  }
  const previousIssueTime = String(ide.dhEmi);
  ide.dhEmi = issueTime;
  return { payload, previousIssueTime, issueTime };
}
