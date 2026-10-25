/** Disposable in-memory PostgreSQL only; never loads .env or opens a socket.
 * npm install --prefix .test-tools --ignore-scripts --no-audit --no-fund --package-lock=false @electric-sql/pglite@0.5.11
 * node --test scripts/recovery-pilot/test-database.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '../../.test-tools/node_modules/@electric-sql/pglite/dist/index.js';
import { createCatalogFixture, insertTestDocument } from './database-fixture.mjs';

test('migration, admission, fencing, crash lease recovery and atomic authorization in disposable PostgreSQL', async () => {
  const db = new PGlite();
  try {
    await createCatalogFixture(db);
    await db.exec(await readFile(new URL('../../migrations/20261024_recovery_v1_PREPARE_ONLY.sql', import.meta.url), 'utf8'));
    const q = async (sql, params = []) => (await db.query(sql, params)).rows;
    assert.equal((await q('select count(*)::int as n from fiscal_recovery.scopes'))[0].n, 0);
    const scope = (await q(`insert into fiscal_recovery.scopes(client_id,organization_id,store_id,cnpj,environment,model,series)
      values('test-client','11111111-1111-1111-1111-111111111111',1,'12345678000195','producao','NFCe',2) returning id`))[0].id;
    await insertTestDocument(db,'doc',123,'1'.repeat(44));
    await insertTestDocument(db,'legacy',999,'9'.repeat(44));
    const hash = createHash('sha256').update('<frozen/>').digest('hex');
    const admit = () => q('select public.fiscal_recovery_admit_v1($1,$2,$3) as id', [scope, 'doc', hash]);
    await assert.rejects(admit, /no rows/);
    await q('update fiscal_recovery.scopes set enabled=true where id=$1', [scope]);
    await assert.rejects(() => q('select public.fiscal_recovery_admit_v1($1,$2,$3)', [scope,'doc','a'.repeat(64)]), /HASH_MISMATCH/);
    const job = (await admit())[0].id;
    assert.equal((await admit())[0].id, job);
    await assert.rejects(() => db.exec("update public.fiscal_documents set status='erro' where id='doc'"), /RECOVERY_DOCUMENT_OWNED/);
    await assert.rejects(() => db.exec(`insert into public.fiscal_documents
      select (jsonb_populate_record(null::public.fiscal_documents,to_jsonb(d)||'{"status":"erro"}'::jsonb)).*
      from public.fiscal_documents d where id='doc'
      on conflict(id) do update set status=excluded.status`), /RECOVERY_DOCUMENT_OWNED/);
    await db.exec("update public.fiscal_documents set status='erro' where id='legacy'");
    const claim = async () => (await q('select public.fiscal_recovery_claim_v1($1,$2) as result', ['worker', [scope]]))[0].result;
    const first = (await claim()).lease;
    assert.ok(first);
    const second = await claim();
    assert.equal(second.lease, null);
    assert.ok(second.nextWakeAt > Date.now());
    const complete = (lease, decision, next = null) => q('select public.fiscal_recovery_complete_v1($1,$2,$3,$4,$5) as accepted',
      [lease.id,lease.token,lease.version,decision,next]);
    const auth = { state:'authorized',origin:'sefaz',code:'100',protocol:'141260000000001',processedXml:'<nfeProc/>',evidenceXml:'<retConsSitNFe/>' };
    assert.equal((await complete({...first,version:null},auth))[0].accepted,false);
    assert.equal((await complete({...first,token:null},auth))[0].accepted,false);
    assert.equal((await q('select version from fiscal_recovery.jobs where id=$1',[job]))[0].version,first.version);
    // Simulate death after consultation but before committing; another process
    // reclaims the expired lease, and a late result cannot win.
    await q("update fiscal_recovery.jobs set lease_until=now()-interval '1 second' where id=$1", [job]);
    const newer = (await claim()).lease;
    assert.notEqual(first.token, newer.token);
    assert.equal((await complete(first, auth))[0].accepted, false);
    const pending = {state:'pending',origin:'transport',code:'RECOVERY_COMMUNICATION_FAILURE'};
    assert.equal((await complete(newer, pending, new Date(Date.now()+30_000).toISOString()))[0].accepted, true);
    await q("update fiscal_recovery.jobs set next_at=now()-interval '1 second' where id=$1",[job]);
    const third = (await claim()).lease;
    assert.ok(third);
    await complete(third, pending, new Date(Date.now()+30_000).toISOString());
    await q("update fiscal_recovery.jobs set next_at=now()-interval '1 second' where id=$1",[job]);
    const exhausted = await claim();
    assert.equal(exhausted.lease, null);
    assert.ok(exhausted.nextWakeAt>Date.now()+59*60_000);
    // Advance the budget's persisted timestamps without waiting an actual hour.
    await q("update fiscal_recovery.jobs set query_times='{}',next_at=now()-interval '1 second' where id=$1",[job]);
    const finalLease = (await claim()).lease;
    await db.exec('begin');
    assert.equal((await complete(finalLease, auth))[0].accepted, true);
    await db.exec('savepoint after_completion');
    await assert.rejects(() => db.exec("update public.fiscal_documents set status='erro' where id='doc'"), /RECOVERY_DOCUMENT_OWNED/);
    await db.exec('rollback to savepoint after_completion');
    assert.notEqual((await q("select current_setting('fiscal_recovery.writer',true) as writer"))[0].writer,'recovery-v1');
    await db.exec('commit');
    assert.equal((await complete(finalLease, auth))[0].accepted, false);
    assert.equal((await q("select status from public.fiscal_documents where id='doc'"))[0].status, 'autorizado');
    const empty = await claim();
    assert.equal(empty.lease, null);
    assert.equal(empty.nextWakeAt, null);
    await assert.rejects(() => db.exec("update public.fiscal_documents set status='processamento' where id='doc'"), /RECOVERY_DOCUMENT_OWNED/);
    await assert.rejects(() => db.exec("delete from public.fiscal_documents where id='doc'"), /RECOVERY_DOCUMENT_OWNED/);
    const events = await q("select event from fiscal_recovery.events order by id");
    assert.deepEqual(events.map(row => row.event), ['admitted','pending','authorized']);
    // Consumption denial pauses the issuer's production scopes, not just one key.
    await insertTestDocument(db,'doc2',124,'2'.repeat(44));
    await q('select public.fiscal_recovery_admit_v1($1,$2,$3)',[scope,'doc2',hash]);
    const limited = (await claim()).lease;
    await complete(limited,{state:'pending',origin:'sefaz',code:'656'},new Date(Date.now()+30_000).toISOString());
    const paused = await claim();
    assert.equal(paused.lease,null);
    assert.ok(paused.nextWakeAt>Date.now()+59*60_000);
    const otherScope = (await q('select public.fiscal_recovery_claim_v1($1,$2) as result',
      ['other-worker',['22222222-2222-2222-2222-222222222222']]))[0].result;
    assert.equal(otherScope.lease,null);
    assert.equal(otherScope.nextWakeAt,null);
    await db.exec('set role anon');
    await assert.rejects(() => q('select public.fiscal_recovery_claim_v1($1,$2)', ['intruder',[scope]]), /permission denied/);
    await assert.rejects(() => q('select * from fiscal_recovery.jobs'), /permission denied/);
    assert.deepEqual(await q('select id from public.fiscal_documents'), []);
    await db.exec('reset role');
  } finally { await db.close(); }
});
