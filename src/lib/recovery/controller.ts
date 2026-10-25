import { createHash, randomUUID, randomInt } from "node:crypto";
import type { DocumentRecord } from "../../types.js";
import type { ManagedDocument, ManagedPhase, ManagedRepository, ManagedScope } from "./controller-types.js";
import type { RecoveryDecision, RecoveryDocument } from "./model.js";
import { reconcileConsultation, reconcileInitialAuthorization, validateRecoveryDocument } from "./evidence.js";
import { withInitialTransmissionPermit } from "./transmission-fence.js";

export type PreparedXml = { accessKey: string; signedXml: string; unsignedXml: string;
  signatureValid: boolean; xsdValid: boolean; xsdErrors: string[]; certificateId: string };
export type ManagedTransports = {
  prepare(document: DocumentRecord): Promise<PreparedXml>;
  consult(document: DocumentRecord): Promise<string>;
  authorize(document: DocumentRecord): Promise<string>;
};

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).filter(([,v]) => v !== undefined).sort(([a],[b]) => a.localeCompare(b))
    .map(([key,v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(',')}}`;
}

export function managedRecoveryDocument(record: ManagedDocument): RecoveryDocument {
  const doc = record.document;
  return {...record.scope,documentId:doc.id,number:doc.numero,accessKey:doc.chave ?? '',signedXml:doc.xmlSigned ?? '',
    signedXmlSha256:createHash('sha256').update(doc.xmlSigned ?? '').digest('hex')};
}

export class RecoveryController {
  constructor(readonly repository: ManagedRepository, private readonly transport: ManagedTransports) {}

  async submit(scope: ManagedScope, requestId: string, originId: string, payload: Record<string,unknown>,
    normalized: unknown, nfceConfigEncrypted: string | null,resumeLocal=false): Promise<ManagedDocument> {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(requestId) ||
        !originId || originId.length>200) throw new Error('RECOVERY_REQUEST_INVALID');
    const original = structuredClone(payload);
    const info = (original.infNFe ?? original) as Record<string,unknown>;
    const ide = info.ide as Record<string,unknown>;
    if (!ide || Number(ide.serie)!==scope.series || !Number.isSafeInteger(Number(ide.nNF)) ||
        Number(ide.nNF)<1 || Number(ide.tpAmb)!==1 || Number(ide.mod)!==(scope.model==='NFe'?55:65)) {
      throw new Error('RECOVERY_PAYLOAD_IDENTITY_INVALID');
    }
    const hash = createHash('sha256').update(canonical(payload)).digest('hex');
    // Freeze cNF in the admitted snapshot before XML generation. A repeated POST
    // returns the saved snapshot; this transient candidate is never sent.
    if (ide.cNF === undefined || ide.cNF === null || ide.cNF === '') ide.cNF=String(randomInt(0,100_000_000)).padStart(8,'0');
    const id=`rv1_${requestId.toLowerCase()}`;
    const now=new Date().toISOString();
    const document: DocumentRecord={id,providerLikeId:id,tipoDocumento:scope.model,issuerCnpj:scope.cnpj,
      ambiente:'producao',status:'processamento',numero:Number(ide.nNF),serie:scope.series,chave:null,protocolo:null,
      motivo:null,motivoStatus:null,mensagens:[],payloadOriginal:original,payloadNormalizado:normalized,
      nfceConfigEncrypted,xml:'',pdfUrl:`/${scope.model==='NFe'?'nfe':'nfce'}/${id}/pdf`,createdAt:now,updatedAt:now};
    const token=randomUUID();
    const accepted=await this.repository.accept(scope,requestId,originId,hash,document,token,resumeLocal);
    if (!accepted.created) return accepted.record; // never resubmit a prior request
    let current=accepted.record;
    try {
      const xml=await this.transport.prepare(current.document);
      if (!xml.signatureValid || !xml.xsdValid) throw new Error('RECOVERY_LOCAL_XML_INVALID');
      const prepared={...current.document,xmlGenerated:xml.unsignedXml,xmlSigned:xml.signedXml,chave:xml.accessKey,
        signatureValid:true,xsdValid:true,xsdErrors:[],certificateId:xml.certificateId};
      validateRecoveryDocument(managedRecoveryDocument({...current,document:prepared}));
      const saved=await this.repository.transition(current,'prepared',prepared,'central','PREPARED',token);
      if (!saved) return this.latest(current);
      current=saved;
    } catch(error) {
      const paused=error instanceof Error&&error.message.includes('RECOVERY_SERVICE_PAUSED');
      const budget=error instanceof Error&&error.message.includes('RECOVERY_QUERY_BUDGET_WAIT');
      const code=paused?'RECOVERY_SERVICE_PAUSED':budget?'RECOVERY_QUERY_BUDGET_WAIT':'LOCAL_PREPARATION_FAILED';
      const failed=await this.repository.transition(current,'blocked_local',
        {...current.document,status:'erro',motivoStatus:code,
          motivo:paused||budget?'Primeiro envio bloqueado pelo intervalo ou pausa de seguranca; aguarde e retome explicitamente.':'Validacao ou preparacao local falhou antes da transmissao.'},
        'central',code,token);
      return failed ?? this.latest(current);
    }
    try {
      const preflight=reconcileConsultation(managedRecoveryDocument(current),await this.transport.consult(current.document));
      if (preflight.state!=='pending' || preflight.code!=='217') return this.apply(current,preflight,token);
      const intent=await this.repository.transition(current,'send_started',current.document,'central','SEND_STARTED',token);
      if (!intent) return this.latest(current);
      current=intent;
      const xml=await withInitialTransmissionPermit(current.document.chave!,current.document.xmlSigned!,
        () => this.transport.authorize(current.document));
      return this.apply(current,reconcileInitialAuthorization(managedRecoveryDocument(current),xml),token);
    } catch(error) {
      if(current.sendStartedAt===null&&error instanceof Error&&error.message.includes('RECOVERY_SERVICE_PAUSED')){
        return await this.repository.transition(current,'blocked_local',{...current.document,status:'erro',motivoStatus:'RECOVERY_SERVICE_PAUSED',
          motivo:'Primeiro envio bloqueado pela pausa de seguranca; retomada explicita necessaria.'},'central','RECOVERY_SERVICE_PAUSED',token)??this.latest(current);
      }
      return this.apply(current,{state:'pending',origin:'transport',code:'RECOVERY_COMMUNICATION_FAILURE'},token);
    }
  }

  private async latest(current: ManagedDocument): Promise<ManagedDocument> {
    const saved=await this.repository.get(current.requestId);
    if (!saved) throw new Error('RECOVERY_DURABLE_RECORD_MISSING');
    return saved;
  }

  private async apply(current: ManagedDocument, decision: RecoveryDecision | {state:'rejected';origin:'sefaz';code:string;evidenceXml:string},
    token:string):Promise<ManagedDocument> {
    let document={...current.document,updatedAt:new Date().toISOString()};
    const phase:ManagedPhase=decision.state;
    if (decision.state==='authorized') document={...document,status:'autorizado',protocolo:decision.protocol,
      xml:decision.processedXml,sefazResponseXml:decision.evidenceXml,motivoStatus:decision.code,motivo:'Autorizado pela SEFAZ.'};
    else if (decision.state==='rejected') document={...document,status:'rejeitado',sefazResponseXml:decision.evidenceXml,
      motivoStatus:decision.code,motivo:'Rejeicao fiscal confirmada pela SEFAZ.'};
    else document={...document,status:'processamento',motivoStatus:decision.code,
      motivo:decision.state==='manual_review'?'Resultado exige conferencia, sem permissao de reenvio.':'Resultado fiscal ainda nao confirmado.'};
    return await this.repository.transition(current,phase,document,
      decision.origin==='local'?'central':decision.origin,decision.code,token) ?? this.latest(current);
  }
}
