import type { DocumentRecord, DocumentEventRecord } from "../types.js";

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

// So permite corrigir unidades em falhas comprovadamente anteriores a qualquer chamada SEFAZ.
export function prepareNfeXsdRetryPayload(document: DocumentRecord, events: DocumentEventRecord[], body: Record<string, unknown>) {
  if (document.tipoDocumento !== "NFe" || document.status !== "erro" || document.xsdValid !== false ||
      !document.motivo?.startsWith("XML reprovado no XSD:") || document.protocolo || document.sefazBatchId ||
      document.sefazReceipt || document.sefazResponseXml || events.some(event => event.eventType.startsWith("sefaz_") || event.eventType === "authorization_recovered")) {
    throw new Error("Documento exige conciliacao antes de novo envio.");
  }
  if (Number(body.numero) !== document.numero || Number(body.serie) !== document.serie || body.confirmacao !== "RETOMAR MESMA NFE") throw new Error("Confirme o numero e a serie existentes.");
  const payload = structuredClone(object(document.payloadOriginal));
  const inf = object(payload.infNFe), ide = object(inf.ide), emit = object(inf.emit);
  if (Number(ide.nNF) !== document.numero || Number(ide.serie) !== document.serie || Number(ide.mod) !== 55 || Number(ide.finNFe) !== 1 || Number(ide.tpNF) !== 1 ||
      Number(ide.tpAmb) !== (document.ambiente === "producao" ? 1 : 2) || String(emit.CNPJ) !== document.issuerCnpj) throw new Error("Payload difere da identidade do documento.");
  const details = inf.det;
  if (!Array.isArray(details) || !details.length || !Array.isArray(body.unidades) || body.unidades.length !== details.length) throw new Error("Revise as unidades de todos os itens.");
  details.forEach((detail, index) => {
    const unit = String((body.unidades as unknown[])[index]).trim().toUpperCase();
    if (!/^[A-Z0-9]{1,6}$/.test(unit)) throw new Error("Unidade invalida.");
    const prod = object(object(detail).prod);
    if (prod.uCom !== prod.uTrib || Number(prod.qCom) !== Number(prod.qTrib) || Number(prod.vUnCom) !== Number(prod.vUnTrib)) throw new Error("Item com conversao tributaria exige revisao fiscal especifica.");
    prod.uCom = unit;
    prod.uTrib = unit;
  });
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  ide.dhEmi = `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}-03:00`;
  return payload;
}
