import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import { createAdminHtml } from '../../admin-page.js';

function harness() {
  const page = createAdminHtml({ adminToken: 'synthetic' });
  const script = page.match(/<script>([\s\S]*?)<\/script>/)?.[1]; assert.ok(script);
  const responseBox = { textContent: '', scrollIntoView() {} };
  const appBox = { innerHTML: '' };
  const context = createContext({ URL, URLSearchParams, Intl, console,
    window: { location: { search: '' }, scrollTo() {} },
    document: { getElementById: (id: string) => id === 'responseBox' ? responseBox : id === 'app' ? appBox : null,
      querySelectorAll: () => [] },
    fetch: () => new Promise(() => {}) });
  runInContext(script, context);
  runInContext(`state.snapshot = {
    issuers: [{cnpj:'31734498000140',nomeFantasia:'Ótica Globo 5',ambiente:'producao',metadata:{}},
      {cnpj:'08214081000134',nomeFantasia:'Ótica Globo 1',ambiente:'producao',metadata:{}}],
    documents: [], documentEvents: [], certificates: [], serviceConfigs: [], inutilizations: [],
    apiClients: [], summary: {documents:0}, managedDocuments:{available:true,count:1}
  };`, context);
  const doc = { id: 'rv1_cf8f0bd0-6919-4419-aed1-0f2830d2e96f', tipoDocumento: 'NFCe', numero: 1919, serie: 1,
    issuerCnpj: '31734498000140', ambiente: 'producao', status: 'autorizado', createdAt: '2026-11-09T17:33:26Z',
    updatedAt: '2026-11-09T22:05:13Z', motivo: 'Autorizado o uso da NF-e', protocolo: '141261857651190',
    recovery: { phase: 'authorized', version: 4 }, payloadOriginal: {}, payloadNormalizado: {} };
  const documents = [doc,
    { ...doc, id: 'doc_old', numero: 3384, issuerCnpj: '08214081000134', createdAt: '2026-10-23T16:25:13Z', recovery: undefined },
    { ...doc, id: 'doc_hom', numero: 1, ambiente: 'homologacao', recovery: undefined },
    { ...doc, id: 'rv1_other', numero: 2503, tipoDocumento: 'NFe', issuerCnpj: '08214081000134', status: 'rejeitado' }];
  runInContext(`state.snapshot.documents = ${JSON.stringify(documents)};
    state.snapshot.documentEvents = state.snapshot.documents.map(function(d) {return {
      id:d.id+':current',documentId:d.id,eventType:'managed_current',level:'info',message:'Situação atual: '+d.status,
      payload:{},createdAt:d.updatedAt};});`, context);
  return { context, doc, appBox, responseBox, run: (s: string) => runInContext(s, context) };
}
test('documents and logs apply the same company/environment/type/status/date filters to both sources', () => {
  const h = harness();
  const cases = [
    [{ company: '31734498000140', environment: 'producao' }, [1919]],
    [{ company: '08214081000134', environment: 'producao' }, [3384, 2503]],
    [{ environment: 'homologacao' }, [1]],
    [{ environment: 'producao', type: 'NFe' }, [2503]],
    [{ environment: 'producao', status: 'rejeitado' }, [2503]],
    [{ environment: 'producao', from: '2026-11-01', to: '2026-11-30' }, [1919, 2503]],
    [{ environment: 'producao', to: '2026-10-31' }, [3384]]
  ] as const;
  for (const [filters, numbers] of cases) {
    h.run(`state.listFilters = ${JSON.stringify(filters)};`);
    assert.deepEqual(Array.from(h.run('filterDocuments(state.snapshot.documents).map(function(d){return d.numero;})')), [...numbers]);
    const docs = h.run('renderDocuments()'), logs = h.run('renderLogs()');
    for (const n of numbers) { assert.ok(docs.includes('#' + n)); assert.ok(logs.includes('#' + n)); }
    assert.ok(!docs.includes('Nenhum documento encontrado')); assert.ok(!logs.includes('Nenhum evento fiscal registrado'));
  }
});
test('managed row shows company, details and history with no legacy transmission controls on Documents or Home', () => {
  const h = harness();
  h.run(`state.listFilters = {company:'31734498000140',environment:'producao'};`);
  const html = h.run('renderDocuments()');
  for (const expected of ['Ótica Globo 5', '#1919', 'Gerenciada', '141261857651190', 'Situação atual', 'Inspecionar nota', 'Abrir nota']) assert.ok(html.includes(expected), expected);
  for (const action of ['transmitToSefaz(', 'signDocument(', 'processDocumentAutomatically(', 'rejectDocument(']) {
    assert.ok(!html.includes(action)); assert.ok(!h.run('compactRecentDocumentRowFixed(state.snapshot.documents[0])').includes(action));
  }
  assert.equal(h.run('documentCanTransmit(state.snapshot.documents[0])'), false);
  h.run(`inspectLog('${h.doc.id}')`);
  const details = JSON.parse(h.responseBox.textContent);
  assert.equal(details.acompanhamento.phase, 'authorized'); assert.equal(details.eventos.length, 1);
  assert.ok(h.run('renderLogs()').includes('histórico completo das etapas intermediárias'));
});
test('unavailable reads produce a visible incomplete-list warning and dynamic managed text is escaped', () => {
  const h = harness(); h.run('state.snapshot.managedDocuments.available = false; state.page = "documents"; render();');
  assert.ok(h.appBox.innerHTML.includes('lista e as contagens estão incompletas'));
  assert.ok(h.appBox.innerHTML.includes('role="alert"'));
  h.run('state.snapshot.documents[0].motivo = "<img src=x onerror=alert(1)>";');
  const row = h.run('managedDocumentRow(state.snapshot.documents[0])');
  assert.ok(!row.includes('<img')); assert.ok(row.includes('&lt;img'));
});

test('a legacy note without detailed events remains visible beside managed notes with events', () => {
  const h = harness();
  h.run(`state.listFilters = {environment:'producao'};
    state.snapshot.documentEvents = state.snapshot.documentEvents.filter(function(e) { return e.documentId !== 'doc_old'; });`);
  const html = h.run('renderLogs()');
  assert.ok(html.includes('#3384')); assert.ok(html.includes('#1919'));
  assert.ok(html.includes('Estado salvo · sem eventos detalhados'));
});

test('administrative closure is shown as info and has its own filter without masquerading as fiscal rejection',()=>{
  const h=harness();
  h.run(`const original=state.snapshot.documents[0];original.tipoDocumento='NFe';original.numero=2499;original.status='processamento';original.motivoStatus='539';
    original.recovery.administrativeClosure={kind:'superseded_number_conflict',closedAt:'2026-11-10T13:00:00Z',successorNumber:2500,successorId:'rv1_successor'};
    state.snapshot.documentEvents=[{id:'closed',documentId:original.id,eventType:'managed_administratively_closed',level:'info',
      message:'Acompanhamento encerrado administrativamente; substituída pela NF-e #2500.',payload:{},createdAt:'2026-11-10T13:00:00Z'}];
    state.listFilters={company:original.issuerCnpj,environment:'producao',status:'processamento'};`);
  assert.equal(h.run('filterDocuments(state.snapshot.documents).length'),0);
  h.run(`state.listFilters.status='encerrada_administrativamente';`);
  assert.equal(h.run('filterDocuments(state.snapshot.documents).length'),1);
  const docs=h.run('renderDocuments()');assert.ok(docs.includes('Encerrada administrativamente'));assert.ok(docs.includes('Substituída pela NF-e #2500'));
  const logs=h.run('renderLogs()');assert.ok(logs.includes('#2499'));assert.ok(logs.includes('#2500'));assert.ok(logs.includes('>info<'));
  h.run(`state.listFilters.status='rejeitado';`);assert.equal(h.run('filterDocuments(state.snapshot.documents).length'),0);
});
