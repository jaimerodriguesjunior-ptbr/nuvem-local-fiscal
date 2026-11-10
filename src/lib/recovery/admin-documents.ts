import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentEventRecord, DocumentRecord } from '../../types.js';
import { decodeManagedDocument } from './managed-repository.js';
import { publicManagedDocument, type ManagedPublicDocument } from './runtime.js';

export type AdminManagedItem = {
  document: ManagedPublicDocument;
  legacyId: string | null;
  receivedAt: string;
  updatedAt: string;
  sendStartedAt: string | null;
};
export interface AdminManagedReader {
  read(): Promise<AdminManagedItem[]>;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const validDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));

/** Read independently of the transmission runtime: paused/disabled scopes remain visible. */
export class SupabaseAdminManagedReader implements AdminManagedReader {
  constructor(private readonly client: Pick<SupabaseClient, 'rpc'>) {}

  async read(): Promise<AdminManagedItem[]> {
    const asOf = new Date().toISOString();
    const items: AdminManagedItem[] = [];
    let after: string | null = null;
    // Bounded pages, no silent truncation. New admissions appear on the next refresh.
    for (let page = 0; page < 100; page++) {
      const { data, error } = await this.client.rpc('fiscal_recovery_admin_documents_v1', {
        p_after: after, p_limit: 100, p_as_of: asOf
      }).abortSignal(AbortSignal.timeout(15_000));
      if (error) throw new Error('ADMIN_MANAGED_READ_UNAVAILABLE');
      if (!data || !Array.isArray(data.items) || data.items.length > 100 ||
          (data.nextAfter !== null && (typeof data.nextAfter !== 'string' || !uuid.test(data.nextAfter)))) {
        throw new Error('ADMIN_MANAGED_PAGE_INVALID');
      }
      for (const item of data.items) {
        const record = decodeManagedDocument(item?.record);
        if (!uuid.test(record.requestId) || (after !== null && record.requestId <= after) ||
            (items.length > 0 && record.requestId <= items[items.length - 1].document.recovery.requestId) ||
            !validDate(item.receivedAt) || !validDate(item.updatedAt) ||
            (record.sendStartedAt !== null && !validDate(record.sendStartedAt)) ||
            (item.legacyId !== null && (typeof item.legacyId !== 'string' || !item.legacyId || item.legacyId.startsWith('rv1_')))) {
          throw new Error('ADMIN_MANAGED_ITEM_INVALID');
        }
        items.push({ document: publicManagedDocument(record), legacyId: item.legacyId,
          receivedAt: item.receivedAt, updatedAt: item.updatedAt, sendStartedAt: record.sendStartedAt });
      }
      if (data.nextAfter === null) return items;
      if (data.items.length !== 100 || data.nextAfter !== items[items.length - 1]?.document.recovery.requestId) {
        throw new Error('ADMIN_MANAGED_CURSOR_INVALID');
      }
      after = data.nextAfter;
    }
    throw new Error('ADMIN_MANAGED_LIST_TOO_LARGE');
  }
}

/** These are persisted milestones/current state, never reconstructed intermediate transitions. */
export function managedAdminEvents(item: AdminManagedItem): DocumentEventRecord[] {
  const doc = item.document;
  const events: DocumentEventRecord[] = [];
  const add = (kind: string, at: string, message: string, payload: Record<string, unknown> = {}, level: DocumentEventRecord['level'] = 'info') => {
    events.push({ id: doc.id + ':' + kind, documentId: doc.id, eventType: 'managed_' + kind,
      level, message, createdAt: at, payload: { source: 'managed_persisted_milestone', ...payload } });
  };
  add('received', item.receivedAt, item.legacyId ? 'Documento incorporado ao acompanhamento gerenciado.' : 'Solicitação registrada no fluxo gerenciado.');
  if (item.sendStartedAt) add('send_started', item.sendStartedAt, 'Início do envio registrado; este marco não confirma autorização.');
  if (Array.isArray(doc.issueTimeHistory)) doc.issueTimeHistory.forEach((change, index) => {
    if (validDate(change.at)) add('issue_time_' + index, change.at, 'Horário de emissão atualizado com evidência registrada.',
      { previousIssueTime: change.previousIssueTime, issueTime: change.issueTime, proof: change.proof });
  });
  if (validDate(doc.cancellationRequestedAt)) add('cancellation_requested', doc.cancellationRequestedAt, 'Solicitação de cancelamento registrada.');
  if (validDate(doc.cancelledAt)) add('cancelled', doc.cancelledAt, 'Cancelamento confirmado.', { protocol: doc.cancellationProtocol });
  add('current', item.updatedAt, 'Situação atual registrada: ' + doc.status + (doc.motivo ? ' · ' + doc.motivo : ''),
    { phase: doc.recovery.phase, code: doc.recovery.code, version: doc.recovery.version, status: doc.status },
    ['erro', 'rejeitado'].includes(doc.status) ? 'error' : doc.status === 'processamento' ? 'warn' : 'info');
  return events;
}

export function mergeAdminDocuments<T extends { documents: DocumentRecord[]; documentEvents: DocumentEventRecord[];
  summary: { documents: number; documentEvents: number } }>(snapshot: T, items: AdminManagedItem[]): T {
  const aliases = new Map(items.filter(item => item.legacyId).map(item => [item.legacyId!, item.document.id]));
  const docs = new Map(snapshot.documents.filter(doc => !aliases.has(doc.id)).map(doc => [doc.id, doc]));
  for (const item of items) {
    const { nfceConfigEncrypted: _secret, ...document } = item.document;
    docs.set(document.id, document);
  }
  const events = new Map(snapshot.documentEvents.map(event => [event.id, aliases.has(event.documentId)
    ? { ...event, documentId: aliases.get(event.documentId)!, payload: { ...event.payload, originalDocumentId: event.documentId } }
    : event]));
  for (const item of items) for (const event of managedAdminEvents(item)) events.set(event.id, event);
  const documents = [...docs.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
  const documentEvents = [...events.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
  return { ...snapshot, documents, documentEvents, summary: { ...snapshot.summary, documents: documents.length, documentEvents: documentEvents.length } };
}
