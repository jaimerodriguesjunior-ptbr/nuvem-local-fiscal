// Standalone review artifact with synthetic data. No API/network access.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { createAdminHtml } = require('../../dist/admin-page.js');
const { managedAdminEvents } = require('../../dist/lib/recovery/admin-documents.js');
const id = 'rv1_11111111-1111-4111-8111-111111111111';
const doc = { id, providerLikeId: id, tipoDocumento: 'NFCe', issuerCnpj: '31734498000140', ambiente: 'producao',
  status: 'autorizado', numero: 1919, serie: 1, chave: '4'.repeat(44), protocolo: '141260000000001',
  motivo: 'Autorizado o uso da NF-e (exemplo para revisão)', motivoStatus: '100', mensagens: [],
  payloadOriginal: {}, payloadNormalizado: {}, xml: '<exemplo/>', pdfUrl: '', createdAt: '2026-11-09T17:33:26-03:00', updatedAt: '2026-11-09T19:05:13-03:00',
  recovery: { schema: 'recovery-v1', requestId: id.slice(4), originId: 'exemplo', version: 4, phase: 'authorized',
    organizationId: '11111111-1111-4111-8111-111111111111', storeId: 4, clientId: 'example', errorOrigin: 'sefaz', code: '100', sendState: 'possibly_sent', cancellationIntentId: null } };
const issuer = { id: 'example', cnpj: doc.issuerCnpj, razaoSocial: 'Empresa de exemplo', nomeFantasia: 'Ótica Globo 5 · exemplo',
  ambiente: 'producao', uf: 'PR', ie: '', crt: '1', serieNfe: 1, serieNfce: 1, ativo: true, metadata: {} };
const legacy = { ...doc, id: 'doc_example', providerLikeId: 'doc_example', numero: 70, tipoDocumento: 'NFe', recovery: undefined };
const snapshot = { documents: [doc, legacy], documentEvents: managedAdminEvents({ document: doc, legacyId: null,
  receivedAt: '2026-11-09T17:33:26-03:00', updatedAt: doc.updatedAt, sendStartedAt: '2026-11-09T19:05:12-03:00' }),
  issuers: [issuer], certificates: [], apiClients: [], serviceConfigs: [], inutilizations: [], returnCfopRules: [],
  distributions: [], distributionDocuments: [], distributionManifestations: [], runtime: { fiscalProductionBlocked: true },
  summary: { clients: 0, issuers: 1, certificates: 0, serviceConfigs: 0, documents: 2, documentEvents: 3, inutilizations: 0 },
  managedDocuments: { available: true, count: 1 } };
const encoded = JSON.stringify(snapshot).replaceAll('<', '\\u003c');
let html = createAdminHtml({ adminToken: 'preview-only' });
html = html.replace('<script>', `<script>
  const previewData = ${encoded};
  window.fetch = async function(url) {
    if (String(url).startsWith('/admin/api/snapshot')) return {ok:true,json:async function(){return previewData;}};
    throw new Error('Esta prévia usa dados de exemplo e permite apenas leitura.');
  };
`);
html = html.replace('<body>', '<body><div style="padding:12px;text-align:center;background:#d5e56c;color:#102a2e">Prévia local para revisão · dados de exemplo · sem conexão com produção</div>');
html = html.replace('fetchSnapshot().then(render).catch', `fetchSnapshot().then(function(){state.page='documents';state.listFilters.company='${doc.issuerCnpj}';state.listFilters.environment='producao';render();}).catch`);
await mkdir('docs/validation', { recursive: true });
await writeFile('docs/validation/admin-managed-documents-preview.html', html);
console.log('Created docs/validation/admin-managed-documents-preview.html (synthetic data only).');
