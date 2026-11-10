// Disposable loopback PostgreSQL, synthetic records only. Does not load .env.
// node scripts/recovery-pilot/test-admin-documents-database.mjs --postgres-bin=... [--pg-module=...]
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import path from 'node:path';
import { createCatalogFixture, insertTestDocument } from './database-fixture.mjs';
const require = createRequire(import.meta.url);
const arg = name => process.argv.find(value => value.startsWith('--' + name + '='))?.split('=').slice(1).join('=');
const bin = arg('postgres-bin');
if (!bin || !path.isAbsolute(bin)) throw Error('Provide an absolute --postgres-bin for local PostgreSQL binaries.');
const pg = require(arg('pg-module') || 'pg');
const { SupabaseAdminManagedReader, mergeAdminDocuments } = require('../../dist/lib/recovery/admin-documents.js');
const work = path.resolve('tmp', 'admin-documents-postgres-' + randomUUID());
await mkdir(work, { recursive: true });
const run = (exe, args) => new Promise((resolve, reject) => {
  const child = spawn(path.join(bin, exe + (process.platform === 'win32' ? '.exe' : '')), args,
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', v => output += v); child.stderr.on('data', v => output += v);
  child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error(output)));
});
const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
const data = path.join(work, 'pg'), pass = path.join(work, 'password');
const password = randomBytes(24).toString('hex'); await writeFile(pass, password);
const db = new pg.Client({ host: '127.0.0.1', port, database: 'postgres', user: 'postgres', password });
let started = false; const checks = [];
const check = (name, body) => { body(); checks.push(name); };
const scope = '00000000-0000-4000-8000-000000000001';
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const sql = name => readFile(new URL('../../migrations/' + name, import.meta.url), 'utf8');
try {
  await run('initdb', ['--pgdata=' + data, '--auth=password', '--username=postgres', '--pwfile=' + pass,
    '--lc-messages=C', '--encoding=UTF8', '--no-sync']); await rm(pass);
  await run('pg_ctl', ['-D', data, '-l', path.join(work, 'server.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-t', '15', '-w', 'start']); started = true;
  await db.connect();
  const fixture = { exec: text => db.query(text), query: (...args) => db.query(...args) };
  await createCatalogFixture(fixture);
  for (const name of ['20261024_recovery_v1_PREPARE_ONLY.sql', '20261024_recovery_controller_PREPARE_ONLY.sql',
    '20261024_recovery_sync_PREPARE_ONLY.sql', '20261024_recovery_manual_PREPARE_ONLY.sql',
    '20261024_recovery_cancellation_PREPARE_ONLY.sql', '20261024_recovery_legacy_adoption_PREPARE_ONLY.sql',
    '20261025_recovery_legacy_queue_PREPARE_ONLY.sql']) await db.query(await sql(name));
  // Disabled scope still has fiscal history and must be included in the administrative read.
  await db.query(`insert into fiscal_recovery.scopes(id,client_id,organization_id,store_id,cnpj,environment,model,series,enabled,pause_until)
    values($1,'synthetic-client',$2,4,'12345678000195','producao','NFCe',2,false,now()+interval '1 day')`, [scope, id(2)]);
  for (let n = 1; n <= 103; n++) {
    const document = { id: 'rv1_' + id(n), providerLikeId: 'rv1_' + id(n), issuerCnpj: '12345678000195', ambiente: 'producao',
      tipoDocumento: 'NFCe', serie: 2, numero: n, status: 'autorizado', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:01Z',
      nfceConfigEncrypted: 'private-csc', payloadOriginal: {}, payloadNormalizado: {}, motivo: 'Synthetic authorization' };
    await db.query(`insert into fiscal_recovery.requests(request_id,scope_id,origin_id,request_hash,number,document,phase,version,owner_token,created_at,updated_at)
      values($1,$2,$3,$4,$5,$6,'authorized',4,$7,'2026-01-01','2026-01-02')`,
      [id(n), scope, 'invoice:' + n, 'a'.repeat(64), n, document, randomUUID()]);
  }
  await insertTestDocument(fixture, 'doc_original', 1, '1'.repeat(44), 'autorizado');
  await db.query(`insert into fiscal_recovery.legacy_links(legacy_id,request_id,source_sha256,source_snapshot,consultation_xml)
    values('doc_original',$1,$2,'{}','<synthetic/>')`, [id(1), 'a'.repeat(64)]);
  const fingerprint = async () => (await db.query(`select md5(jsonb_build_object(
    'requests',(select jsonb_agg(to_jsonb(r) order by request_id) from fiscal_recovery.requests r),
    'scopes',(select jsonb_agg(to_jsonb(s) order by id) from fiscal_recovery.scopes s),
    'outbox',(select jsonb_agg(to_jsonb(o) order by request_id,version) from fiscal_recovery.request_outbox o),
    'links',(select jsonb_agg(to_jsonb(l) order by legacy_id) from fiscal_recovery.legacy_links l),
    'documents',(select jsonb_agg(to_jsonb(d) order by id) from public.fiscal_documents d))::text) as hash`)).rows[0].hash;
  const before = await fingerprint();
  const functions = async () => (await db.query(`select p.oid::text,p.prosrc,p.proacl::text,p.proconfig::text from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','fiscal_recovery')
    and p.proname <> 'fiscal_recovery_admin_documents_v1' order by p.oid`)).rows;
  const functionsBefore = await functions();
  await db.query(await sql('manual/20261109_admin_managed_documents_READ_ONLY.sql'));
  check('installation preserves fiscal rows and all existing function bodies/ACLs', () => {});
  assert.equal(await fingerprint(), before); assert.deepEqual(await functions(), functionsBefore);
  const signature = 'public.fiscal_recovery_admin_documents_v1(uuid,integer,timestamp with time zone)';
  const acl = (await db.query(`select has_function_privilege('anon',$1,'execute') as anon,
    has_function_privilege('authenticated',$1,'execute') as authenticated,has_function_privilege('service_role',$1,'execute') as service`, [signature])).rows[0];
  check('only service_role can execute the new read function', () => assert.deepEqual(acl, { anon: false, authenticated: false, service: true }));
  for (const role of ['anon', 'authenticated']) {
    await db.query('set role ' + role);
    await assert.rejects(db.query('select public.fiscal_recovery_admin_documents_v1()'), /permission denied/);
    await db.query('reset role');
  }
  checks.push('anonymous/authenticated execution actually denied');
  for (const limit of [null, 0, 101]) await assert.rejects(db.query('select public.fiscal_recovery_admin_documents_v1(null,$1,now())', [limit]), /ADMIN_MANAGED_PAGE_INVALID/);
  checks.push('invalid page bounds rejected');
  await db.query('begin read only'); await db.query('set local role service_role');
  let rpcCount = 0, cutoff;
  const reader = new SupabaseAdminManagedReader({ rpc(name, args) {
    assert.equal(name, 'fiscal_recovery_admin_documents_v1');
    return { async abortSignal() {
      rpcCount++; cutoff ??= args.p_as_of; assert.equal(args.p_as_of, cutoff);
      const result = await db.query('select public.fiscal_recovery_admin_documents_v1($1,$2,$3) as result', [args.p_after,args.p_limit,args.p_as_of]);
      const text = JSON.stringify(result.rows[0].result);
      assert.ok(!text.includes('private-csc')); assert.ok(!text.includes('ownerToken')); assert.ok(!text.includes('requestHash'));
      return { data: result.rows[0].result, error: null };
    } };
  } });
  const items = await reader.read();
  check('native SQL + compiled reader returns all 103 records across pages while scope is disabled/paused', () => {
    assert.equal(items.length, 103); assert.equal(rpcCount, 2); assert.equal(new Set(items.map(v => v.document.id)).size, 103);
  });
  const merged = mergeAdminDocuments({ documents: [{ id: 'doc_original' }], documentEvents: [], summary: { documents: 1, documentEvents: 0 } }, items);
  check('native legacy association is displayed once under the managed identity', () => {
    assert.equal(merged.documents.length, 103); assert.ok(!merged.documents.some(d => d.id === 'doc_original'));
  });
  const empty = (await db.query(`select public.fiscal_recovery_admin_documents_v1(null,100,'2025-01-01') as result`)).rows[0].result;
  check('admission cutoff excludes later records without a false continuation', () => assert.deepEqual(empty, { items: [], nextAfter: null }));
  await db.query('commit');
  assert.equal(await fingerprint(), before); checks.push('all reads succeeded in a READ ONLY transaction; fiscal rows/outbox unchanged');
  const report = { checkedAt: new Date().toISOString(), localOnly: true, nativePostgres: true, syntheticRecords: 103, passed: checks.length, checks };
  await mkdir('docs/validation', { recursive: true });
  await writeFile('docs/validation/admin-managed-documents-sql-20261109.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await db.query('rollback').catch(() => {}); await db.end().catch(() => {});
  if (started) await run('pg_ctl', ['-D', data, '-m', 'fast', '-t', '15', '-w', 'stop']);
}
