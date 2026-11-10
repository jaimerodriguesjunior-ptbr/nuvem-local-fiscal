// Read-only reconciliation. Existing GET requests and one SELECT-only RPC only.
// Required: --central-env=... --erp-env=... --tenant=... --month=YYYY-MM
import fs from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createRequire } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { publicManagedDocument } = require('../../dist/lib/recovery/runtime.js');
const { createAdminHtml } = require('../../dist/admin-page.js');
const arg = name => process.argv.find(v => v.startsWith('--' + name + '='))?.split('=').slice(1).join('=');
const tenant = arg('tenant'), month = arg('month');
if (!tenant || !/^\d{4}-\d{2}$/.test(month || '') || !arg('central-env') || !arg('erp-env')) throw Error('Provide the four documented arguments.');
const central = parseEnv(await fs.readFile(arg('central-env'), 'utf8'));
const erp = parseEnv(await fs.readFile(arg('erp-env'), 'utf8'));
async function request(env, table, params = {}, body) {
  const url = new URL('/rest/v1/' + table, env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { method: body ? 'POST' : 'GET',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json', Prefer: 'count=exact' }, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw Error('Read failed: ' + table + ' HTTP ' + response.status);
  return { rows: await response.json(), range: response.headers.get('content-range') };
}
async function all(env, table, params) {
  const rows = []; let after = null;
  for (;;) {
    const result = await request(env, table, { ...params, order: 'id.asc', limit: '500', ...(after ? { id: 'gt.' + after } : {}) });
    if (!result.rows.length) return rows;
    rows.push(...result.rows); after = result.rows.at(-1).id;
  }
}
const stores = await all(erp, 'stores', { select: 'id,name,cnpj', tenant_id: 'eq.' + tenant });
const invoices = await all(erp, 'fiscal_invoices', { select: 'id,store_id,direction,environment,tipo_documento,status,numero,serie,nuvemfiscal_uuid,recovery_request_id,created_at', tenant_id: 'eq.' + tenant });
const cnpjs = stores.map(s => String(s.cnpj || '').replace(/\D/g, '')).filter(Boolean);
const legacy = await all(central, 'fiscal_documents', { select: 'id,issuer_cnpj,environment,document_type,status,number,serie,created_at,updated_at', issuer_cnpj: 'in.(' + cnpjs.join(',') + ')' });
const outputs = invoices.filter(i => i.direction === 'output' && i.environment === 'production');
const providerIds = new Set(outputs.map(i => i.nuvemfiscal_uuid).filter(Boolean));
const matchingLegacy = legacy.filter(d => providerIds.has(d.id));
const managed = [], statusDifferences = [];
for (const invoice of outputs.filter(i => i.nuvemfiscal_uuid?.startsWith('rv1_'))) {
  const { rows: record } = await request(central, 'rpc/fiscal_recovery_request_get_v1', {}, { p_request: invoice.recovery_request_id });
  assert.ok(record, 'Managed request must exist');
  assert.equal(record.document.id, invoice.nuvemfiscal_uuid);
  assert.equal(record.scope.organizationId, tenant); assert.equal(record.scope.storeId, invoice.store_id);
  assert.equal(record.document.numero, invoice.numero); assert.equal(record.document.serie, Number(invoice.serie));
  const status = { authorized: 'autorizado', rejected: 'rejeitado', cancelled: 'cancelado' }[invoice.status];
  if (status && record.document.status !== status) statusDifferences.push({ invoiceId: invoice.id, storeId: invoice.store_id,
    number: invoice.numero, type: invoice.tipo_documento, erpStatus: invoice.status, centralStatus: record.document.status,
    centralPhase: record.phase, centralCode: record.code });
  const doc = publicManagedDocument(record);
  managed.push({ id: doc.id, numero: doc.numero, serie: doc.serie, issuerCnpj: doc.issuerCnpj, ambiente: doc.ambiente,
    tipoDocumento: doc.tipoDocumento, status: doc.status, createdAt: doc.createdAt, updatedAt: doc.updatedAt, recovery: doc.recovery });
}
const combined = [...matchingLegacy.map(d => ({ id: d.id, numero: d.number, serie: d.serie, issuerCnpj: d.issuer_cnpj,
  ambiente: d.environment, tipoDocumento: d.document_type, status: d.status, createdAt: d.created_at, updatedAt: d.updated_at })), ...managed];
assert.equal(new Set(combined.map(d => d.id)).size, combined.length);
const context = createContext({ URL, URLSearchParams, Intl, window: { location: { search: '' } }, fetch: () => new Promise(() => {}) });
runInContext(createAdminHtml({ adminToken: 'synthetic' }).match(/<script>([\s\S]*?)<\/script>/)[1], context);
runInContext('state.snapshot = ' + JSON.stringify({ documents: combined }) + ';', context);
const monthStart = month + '-01';
const next = new Date(monthStart + 'T00:00:00Z'); next.setUTCMonth(next.getUTCMonth() + 1);
const end = new Date(next.getTime() - 86_400_000).toISOString().slice(0, 10);
const byStore = [];
for (const store of stores.filter(s => s.cnpj)) {
  const filters = { company: store.cnpj.replace(/\D/g, ''), environment: 'producao', from: monthStart, to: end };
  runInContext('state.listFilters = ' + JSON.stringify(filters) + ';', context);
  const docs = runInContext('filterDocuments(state.snapshot.documents)', context);
  const erpNotes = outputs.filter(i => i.store_id === store.id && i.created_at >= monthStart && i.created_at < next.toISOString());
  assert.equal(docs.length, erpNotes.filter(i => providerIds.has(i.nuvemfiscal_uuid)).length);
  byStore.push({ storeId: store.id, name: store.name, productionNotesInMonth: docs.length,
    numbers: Array.from(docs, d => ({ type: d.tipoDocumento, number: d.numero, status: d.status })) });
}
const global = {};
for (const table of ['fiscal_documents', 'fiscal_document_events']) {
  const result = await request(central, table, { select: 'id', limit: '1' });
  global[table] = Number(result.range.split('/')[1]);
}
let fullHistoryRead = null;
if (arg('verify-full-history') === 'true') {
  const { createClient } = require('@supabase/supabase-js');
  const { readFiscalHistory } = require('../../dist/lib/fiscal-history-reader.js');
  const client = createClient(central.SUPABASE_URL || central.NEXT_PUBLIC_SUPABASE_URL, central.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const started = Date.now();
  const [documents, events] = await Promise.all([readFiscalHistory(client, 'fiscal_documents'), readFiscalHistory(client, 'fiscal_document_events')]);
  fullHistoryRead = { documents: documents.data.length, events: events.data.length, durationMs: Date.now() - started,
    distinctDocuments: new Set(documents.data.map(d => d.id)).size, distinctEvents: new Set(events.data.map(e => e.id)).size };
  assert.equal(fullHistoryRead.documents, global.fiscal_documents); assert.equal(fullHistoryRead.events, global.fiscal_document_events);
  assert.equal(fullHistoryRead.distinctDocuments, fullHistoryRead.documents); assert.equal(fullHistoryRead.distinctEvents, fullHistoryRead.events);
}
const report = { checkedAt: new Date().toISOString(), remoteReadsOnly: true, appliedSql: false, deployed: false,
  method: 'ERP inventory + existing individual managed GET RPC + actual client filter function; new list RPC tested only in local PostgreSQL',
  period: { from: monthStart, to: end }, legacyGlobalCounts: global,
  productionOutputRecordsInErp: outputs.length, productionOutputRecordsWithProvider: combined.length,
  matchedLegacyDocuments: matchingLegacy.length, matchedManagedDocuments: managed.length,
  distinctCombinedIds: new Set(combined.map(d => d.id)).size, statusDifferences, fullHistoryRead, byStore };
await fs.mkdir('docs/validation', { recursive: true });
await fs.writeFile('docs/validation/admin-managed-documents-reconciliation-20261109.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ checkedAt: report.checkedAt, global, managed: managed.length, legacy: matchingLegacy.length,
  byStore: byStore.map(({ numbers, ...row }) => row), statusDifferences, fullHistoryRead, result: 'all identity/count checks passed; status differences reported separately' }, null, 2));
