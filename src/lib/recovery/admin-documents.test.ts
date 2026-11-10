import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { registerAdminRoutes } from '../../routes/admin.js';
import { config } from '../../config.js';
import { InMemoryStore } from '../../store.js';
import { SupabaseAdminManagedReader, managedAdminEvents, mergeAdminDocuments, type AdminManagedItem } from './admin-documents.js';
import type { ManagedDocument } from './controller-types.js';
import { publicManagedDocument } from './runtime.js';

function record(n: number): ManagedDocument {
  const requestId = '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
  return {
    requestId, originId: 'invoice:' + n, requestHash: 'a'.repeat(64), version: 4, phase: 'authorized',
    errorOrigin: 'sefaz', code: '100', sendStartedAt: '2026-11-09T22:05:00Z', ownerToken: 'private-token',
    scope: { id: '00000000-0000-4000-8000-111111111111', clientId: 'client', organizationId: '00000000-0000-4000-8000-222222222222',
      storeId: 4, cnpj: '31734498000140', environment: 'producao', model: 'NFCe', series: 1 },
    document: { id: 'rv1_' + requestId, providerLikeId: 'rv1_' + requestId, tipoDocumento: 'NFCe', issuerCnpj: '31734498000140',
      ambiente: 'producao', status: 'autorizado', numero: n, serie: 1, chave: null, protocolo: '141261857651190',
      motivo: 'Autorizado', motivoStatus: '100', mensagens: [], payloadOriginal: {}, payloadNormalizado: {}, xml: '<authorized/>',
      nfceConfigEncrypted: 'private-csc', pdfUrl: '', createdAt: '2026-11-09T17:33:26Z', updatedAt: '2026-11-09T22:05:13Z' }
  };
}
function item(n: number, legacyId: string | null = null): AdminManagedItem {
  const r = record(n);
  return { document: publicManagedDocument(r), legacyId, receivedAt: '2026-11-09T22:04:00Z',
    updatedAt: '2026-11-09T22:05:13Z', sendStartedAt: r.sendStartedAt };
}
function wire(n: number) {
  const r = record(n);
  return { record: r, legacyId: null, receivedAt: '2026-11-09T22:04:00Z', updatedAt: '2026-11-09T22:05:13Z' };
}
function client(read: (name: string, args: any) => unknown) {
  return { rpc(name: string, args: any) { return { async abortSignal() { return read(name, args); } }; } } as any;
}
test('admin reader follows every page with a fixed cutoff and uses only the read RPC', async () => {
  let calls = 0, cutoff: string;
  const reader = new SupabaseAdminManagedReader(client((name, args) => {
    assert.equal(name, 'fiscal_recovery_admin_documents_v1');
    assert.equal(args.p_limit, 100);
    if (calls++ === 0) {
      assert.equal(args.p_after, null); cutoff = args.p_as_of;
      return { data: { items: Array.from({ length: 100 }, (_, i) => wire(i + 1)), nextAfter: record(100).requestId }, error: null };
    }
    assert.equal(args.p_after, record(100).requestId); assert.equal(args.p_as_of, cutoff);
    return { data: { items: [wire(101)], nextAfter: null }, error: null };
  }));
  const result = await reader.read();
  assert.equal(result.length, 101); assert.equal(calls, 2);
  assert.equal(result[0].document.recovery.storeId, 4);
});
test('partial page failure and invalid/repeated cursors never yield an apparently complete list', async () => {
  for (const mode of ['error', 'cursor', 'identity', 'date']) {
    const reader = new SupabaseAdminManagedReader(client(() => {
      if (mode === 'error') return { error: { message: 'unavailable' }, data: null };
      const value = wire(1);
      if (mode === 'identity') value.record.document.issuerCnpj = 'foreign';
      if (mode === 'date') value.receivedAt = 'invalid';
      return { error: null, data: { items: [value], nextAfter: mode === 'cursor' ? record(1).requestId : null } };
    }));
    await assert.rejects(reader.read(), /ADMIN_MANAGED|RECOVERY_AGGREGATE/);
  }
  let calls = 0;
  const interrupted = new SupabaseAdminManagedReader(client(() => ++calls === 1
    ? { error: null, data: { items: Array.from({ length: 100 }, (_, i) => wire(i + 1)), nextAfter: record(100).requestId } }
    : { error: { message: 'second page failed' }, data: null }));
  await assert.rejects(interrupted.read(), /ADMIN_MANAGED_READ_UNAVAILABLE/);
});
test('merge preserves distinct notes, replaces only an explicit legacy association and remaps its history', () => {
  const managed = item(1919, 'doc_legacy');
  const source = { documents: [{ ...record(1919).document, id: 'doc_legacy' }, { ...record(1919).document, id: 'unrelated_same_number' }],
    documentEvents: [{ id: 'old-event', documentId: 'doc_legacy', eventType: 'received', level: 'info' as const,
      message: 'Original event', payload: {}, createdAt: '2026-10-01T00:00:00Z' }], summary: { documents: 2, documentEvents: 1 } };
  const result = mergeAdminDocuments(source, [managed]);
  assert.equal(result.documents.length, 2);
  assert.ok(result.documents.find(d => d.id === 'unrelated_same_number'));
  assert.ok(!result.documents.find(d => d.id === 'doc_legacy'));
  assert.equal(result.documentEvents.find(e => e.id === 'old-event')?.documentId, managed.document.id);
  assert.equal((result.documentEvents.find(e => e.id === 'old-event')?.payload as Record<string, unknown>).originalDocumentId, 'doc_legacy');
  assert.equal(result.summary.documentEvents, result.documentEvents.length);
  assert.equal(source.documentEvents[0].documentId, 'doc_legacy');
  assert.equal(result.documents.find(d => d.id === managed.document.id)?.nfceConfigEncrypted, undefined);
  assert.equal(result.documents[0].id, managed.document.id);
});
test('managed logs expose persisted milestones and date current state without inventing authorization time or old phases', () => {
  const value = item(1919); const events = managedAdminEvents(value);
  assert.deepEqual(events.map(e => e.eventType), ['managed_received', 'managed_send_started', 'managed_current']);
  assert.equal(events[2].createdAt, value.updatedAt);
  assert.equal(events[2].payload.phase, 'authorized');
  assert.ok(events.every(e => e.payload.source === 'managed_persisted_milestone'));
  value.sendStartedAt = null;
  assert.ok(!managedAdminEvents(value).some(e => e.eventType === 'managed_send_started'));
  value.document.issueTimeHistory = [{ previousIssueTime: '2026-11-09T16:00:00Z', issueTime: '2026-11-09T22:05:00Z',
    at: '2026-11-09T22:04:59Z', proof: 'never_sent', previousPayloadHash: 'a'.repeat(64) }];
  const correction = managedAdminEvents(value).find(e => e.eventType === 'managed_issue_time_0');
  assert.equal(correction?.createdAt, '2026-11-09T22:04:59Z'); assert.equal(correction?.payload.proof, 'never_sent');
});

test('snapshot lists managed notes with recovery runtime off, authenticates first and reports unavailable reads', async () => {
  const app = Fastify({ logger: false }); let reads = 0, fail = false;
  const original = { documents: [], documentEvents: [], summary: { documents: 0, documentEvents: 0 } };
  app.decorate('store', { getSnapshot: () => original, getDocumentSnapshot: InMemoryStore.prototype.getDocumentSnapshot } as any);
  app.decorate('recovery', null);
  app.decorate('adminManagedReader', { async read() { reads++; if (fail) throw Error('private-server-detail'); return [item(1919)]; } });
  await registerAdminRoutes(app);
  try {
    assert.equal((await app.inject('/admin/api/snapshot')).statusCode, 401); assert.equal(reads, 0);
    const authorization = 'Basic ' + Buffer.from(config.adminUsername + ':' + config.adminPassword).toString('base64');
    const headers = { authorization };
    assert.equal((await app.inject({ url: '/admin/api/snapshot?managed=invalid', headers })).statusCode, 400); assert.equal(reads, 0);
    const response = await app.inject({ url: '/admin/api/snapshot', headers });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().documents[0].numero, 1919);
    assert.deepEqual(response.json().managedDocuments, { available: true, count: 1 });
    for (const secret of ['private-csc', 'private-token', 'private-server-detail', 'requestHash']) assert.ok(!response.body.includes(secret));
    assert.equal(original.documents.length, 0);
    fail = true;
    const failed = await app.inject({ url: '/admin/api/snapshot', headers });
    assert.deepEqual(failed.json().managedDocuments, { available: false, count: 0 });
    assert.ok(!failed.body.includes('private-server-detail'));
  } finally { await app.close(); }
});
