import type { FastifyInstance } from "fastify";

import { createAdminHtml } from "../admin-page.js";
import { config } from "../config.js";
import {
  encryptSecretPayload,
  decryptSecretPayload,
  openEncryptedCertificate
} from "../lib/certificates.js";
import {
  processHomologationDocument,
  processHomologationNfce
} from "../lib/document-processing.js";
import { generateAndSignNfeXml } from "../lib/nfe-xml.js";
import {
  authorizeNfeAtSefaz,
  buildAuthorizationBatch,
  querySefazDocumentStatus,
  validateAuthorizationBatchXml
} from "../lib/sefaz-authorization.js";
import { querySefazStatus } from "../lib/sefaz-status.js";
import { validateNfeXml } from "../lib/xsd-validator.js";

const legacyAdminHtml = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Nuvem Local Fiscal Admin</title>
  <style>
    :root {
      --bg: #f5f1e8;
      --panel: #fffdf8;
      --ink: #1f2937;
      --muted: #6b7280;
      --line: #d8cfc2;
      --accent: #135d66;
      --accent-2: #f2a65a;
      --danger: #a63d40;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      background:
        radial-gradient(circle at top left, rgba(242,166,90,.18), transparent 35%),
        linear-gradient(180deg, #f8f4ec 0%, var(--bg) 100%);
      color: var(--ink);
    }
    .wrap {
      max-width: 1180px;
      margin: 0 auto;
      padding: 24px;
    }
    .hero {
      display: grid;
      gap: 12px;
      padding: 24px;
      border: 1px solid var(--line);
      border-radius: 20px;
      background: rgba(255,253,248,.9);
      backdrop-filter: blur(6px);
    }
    .eyebrow {
      color: var(--accent);
      font-size: 12px;
      letter-spacing: .22em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      font-size: clamp(32px, 4vw, 52px);
      line-height: .95;
    }
    .sub {
      margin: 0;
      max-width: 760px;
      color: var(--muted);
    }
    .steps {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 8px;
      margin-top: 8px;
    }
    .step {
      padding: 10px;
      border-radius: 12px;
      background: #f4ecdf;
      color: #59462f;
      font-size: 13px;
    }
    .step b {
      display: block;
      color: var(--accent);
      margin-bottom: 3px;
    }
    .grid {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      margin-top: 20px;
    }
    .card, .panel {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 18px;
      padding: 18px;
    }
    .metric {
      font-size: 30px;
      font-weight: bold;
      color: var(--accent);
    }
    .layout {
      display: grid;
      gap: 16px;
      grid-template-columns: 1.1fr .9fr;
      margin-top: 18px;
    }
    .panel h2 {
      margin-top: 0;
      font-size: 20px;
    }
    .section-title {
      margin: 18px 0 10px;
      padding-top: 16px;
      border-top: 1px solid var(--line);
    }
    .list {
      display: grid;
      gap: 12px;
    }
    .item {
      padding: 14px;
      border-radius: 14px;
      background: #faf6ef;
      border: 1px solid #eadfce;
    }
    .item strong {
      display: block;
      margin-bottom: 4px;
    }
    .item-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .item-top strong {
      margin-bottom: 0;
    }
    .toggle {
      width: auto;
      min-width: 116px;
      padding: 8px 12px;
      border-radius: 999px;
      background: #efe6d8;
      color: #614a2e;
      font-size: 13px;
      font-weight: bold;
      flex-shrink: 0;
    }
    .doc-body[hidden] {
      display: none;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 4px 10px;
      font-size: 12px;
      background: #efe6d8;
      color: #614a2e;
    }
    .status-autorizado { background: #dcefe1; color: #245d37; }
    .status-processamento { background: #efe8d3; color: #7b5d15; }
    .status-rejeitado { background: #f3d6d6; color: var(--danger); }
    .status-cancelado { background: #ead8d8; color: var(--danger); }
    .actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: 12px;
    }
    .actions button { padding: 8px; }
    .actions .reject { background: var(--danger); }
    .actions .process { background: #8a6d2f; }
    .actions .sign { background: #274c77; }
    .muted { color: var(--muted); }
    form {
      display: grid;
      gap: 10px;
    }
    input, select, button, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px 12px;
      font: inherit;
      background: white;
    }
    button {
      cursor: pointer;
      border: none;
      background: var(--accent);
      color: white;
      font-weight: bold;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: .5;
    }
    .hint {
      margin: -3px 0 4px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.35;
    }
    details {
      border-top: 1px solid var(--line);
      margin-top: 18px;
      padding-top: 14px;
    }
    summary {
      cursor: pointer;
      color: var(--accent);
      font-weight: bold;
    }
    .empty {
      padding: 18px;
      border: 1px dashed var(--line);
      border-radius: 14px;
      color: var(--muted);
      text-align: center;
    }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 12px;
      background: #fbf7f0;
      padding: 14px;
      border-radius: 12px;
      border: 1px solid #e9dcc8;
      max-height: 420px;
      overflow: auto;
    }
    @media (max-width: 920px) {
      .layout { grid-template-columns: 1fr; }
      .steps { grid-template-columns: 1fr 1fr; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <div class="eyebrow">v0 local de compatibilidade</div>
      <h1>Nuvem Local Fiscal</h1>
      <p class="sub">Use este painel para preparar e decidir o resultado das notas que chegam do Gestão Ótica. Assinar o XML e autorizar a nota são etapas diferentes.</p>
      <div class="steps">
        <div class="step"><b>1. Certificado</b>Cadastre o A1 no emitente.</div>
        <div class="step"><b>2. Emissão</b>Emita pelo Gestão Ótica.</div>
        <div class="step"><b>3. Assinatura</b>Gere e valide o XML.</div>
        <div class="step"><b>4. Resultado</b>Autorize ou rejeite o mock.</div>
      </div>
    </section>

    <section class="grid" id="summary"></section>

    <section class="layout">
      <div class="panel">
        <h2>Emitentes cadastrados</h2>
        <div class="list" id="issuers"></div>
        <h2 class="section-title">Documentos recebidos</h2>
        <div class="list" id="documents"></div>
      </div>

      <div class="panel">
        <h2>Passo 1: certificado A1</h2>
        <p class="hint">Escolha o emitente, selecione o PFX e informe a senha. O CNPJ não precisa ser digitado.</p>
        <form id="certificateForm">
          <label>Emitente
            <select name="cnpj" id="certificateCnpj" required></select>
          </label>
          <label>Arquivo PFX
            <input type="file" name="certificateFile" accept=".pfx,.p12" required />
          </label>
          <label>Senha do certificado
            <input type="password" name="password" required />
          </label>
          <button type="submit">Validar e cadastrar certificado</button>
        </form>

        <details>
          <summary>Ferramenta opcional: emitir documento manual</summary>
          <p class="hint">Normalmente você não usa isto. A nota deve chegar automaticamente do Gestão Ótica.</p>
          <form id="documentForm">
            <label>Tipo
              <select name="tipoDocumento">
                <option value="nfe">NF-e</option>
                <option value="nfce">NFC-e</option>
              </select>
            </label>
            <label>Emitente
              <select name="emitenteCnpj" id="documentCnpj" required></select>
            </label>
            <label>Ambiente
              <select name="ambiente">
                <option value="homologacao">homologacao</option>
                <option value="producao">producao</option>
              </select>
            </label>
            <button type="submit">Criar documento manual</button>
          </form>
        </details>

        <h2 class="section-title">Resultado da última ação</h2>
        <pre id="responseBox">Aguardando acao...</pre>
      </div>
    </section>
  </div>

  <script>
    const adminToken = ${JSON.stringify(Buffer.from(`${config.adminUsername}:${config.adminPassword}`).toString("base64"))};
    const apiClientId = ${JSON.stringify(config.defaultClientId)};
    const apiClientSecret = ${JSON.stringify(config.defaultClientSecret)};

    async function fetchSnapshot() {
      const res = await fetch("/admin/api/snapshot", {
        headers: { Authorization: "Basic " + adminToken }
      });
      return res.json();
    }

    function card(label, value) {
      return '<article class="card"><div class="muted">' + label + '</div><div class="metric">' + value + '</div></article>';
    }

    function issuerItem(issuer, certificates) {
      const cert = certificates.find((item) => item.cnpj === issuer.cnpj);
      return '<article class="item">' +
        '<strong>' + issuer.nomeFantasia + '</strong>' +
        '<div class="muted">' + issuer.razaoSocial + '</div>' +
        '<div class="row">' +
          '<span class="badge">CNPJ ' + issuer.cnpj + '</span>' +
          '<span class="badge">' + issuer.ambiente + '</span>' +
          '<span class="badge">serie NF-e ' + issuer.serieNfe + '</span>' +
          '<span class="badge">serie NFC-e ' + issuer.serieNfce + '</span>' +
          '<span class="badge">' + (cert ? 'certificado: ' + cert.fileName : 'sem certificado') + '</span>' +
          (cert?.validUntil ? '<span class="badge">valido ate ' + new Date(cert.validUntil).toLocaleDateString('pt-BR') + '</span>' : '') +
        '</div>' +
        '<div class="actions">' +
          '<button type="button" ' + (cert ? '' : 'disabled') +
            ' onclick="checkSefazStatus(\\'' + issuer.id + '\\')">Consultar SEFAZ (' + issuer.ambiente + ')</button>' +
        '</div>' +
      '</article>';
    }

    function documentItem(doc, certificates) {
      const statusClass = 'status-' + doc.status;
      const hasCertificate = certificates.some((item) => item.cnpj === doc.issuerCnpj);
      const canDecide = Boolean(doc.signatureValid);
      return '<article class="item">' +
        '<div class="item-top">' +
          '<strong>' + doc.tipoDocumento + ' #' + doc.numero + '</strong>' +
          '<button type="button" class="toggle" data-doc-toggle="' + doc.id + '" onclick="toggleDocumentDetails(\\'' + doc.id + '\\')">Ver detalhes</button>' +
        '</div>' +
        '<div class="row">' +
          '<span class="badge ' + statusClass + '">' + doc.status + '</span>' +
          '<span class="badge">CNPJ ' + doc.issuerCnpj + '</span>' +
          '<span class="badge">' + doc.ambiente + '</span>' +
          '<span class="badge">id ' + doc.id + '</span>' +
        '</div>' +
        '<div class="doc-body" id="doc-body-' + doc.id + '" hidden>' +
        (doc.motivo ? '<div class="muted" style="margin-top:8px">' + escapeHtml(String(doc.motivoStatus || '')) + ' ' + escapeHtml(doc.motivo) + '</div>' : '') +
        (!hasCertificate
          ? '<div class="hint" style="margin-top:10px">Primeiro cadastre o certificado A1 deste emitente no painel ao lado.</div>'
          : !doc.signatureValid
            ? '<div class="hint" style="margin-top:10px">Certificado pronto. Agora gere e valide a assinatura do XML.</div>'
            : '<div class="hint" style="margin-top:10px">Assinatura válida. Escolha o resultado que o Gestão Ótica deve receber.</div>') +
        '<div class="actions">' +
          '<button type="button" class="sign" ' + (hasCertificate ? '' : 'disabled') + ' onclick="signDocument(\\'' + doc.id + '\\')">3. Gerar e assinar XML</button>' +
          '<button type="button" ' + (canDecide ? '' : 'disabled') + ' onclick="changeDocumentStatus(\\'' + doc.id + '\\', \\'autorizar\\')">4. Simular autorizaÃ§Ã£o</button>' +
          '<button type="button" class="reject" onclick="rejectDocument(\\'' + doc.id + '\\')">4. Rejeitar</button>' +
          '<button type="button" class="process" onclick="changeDocumentStatus(\\'' + doc.id + '\\', \\'processar\\')">Voltar a processando</button>' +
          '<button type="button" class="sign" ' + (doc.signatureValid && doc.xsdValid && doc.ambiente === 'homologacao' ? '' : 'disabled') +
            ' onclick="prepareSefazAuthorization(\\'' + doc.id + '\\')">5. Preparar envio SEFAZ</button>' +
          '<button type="button" class="reject" ' + (doc.signatureValid && doc.xsdValid && doc.ambiente === 'homologacao' ? '' : 'disabled') +
            ' onclick="transmitToSefaz(\\'' + doc.id + '\\')">6. Transmitir homologaÃ§Ã£o</button>' +
          (doc.xmlSigned ? '<button type="button" class="sign" onclick="downloadSignedXml(\\'' + doc.id + '\\')">Baixar XML assinado</button>' : '') +
        '</div>' +
        '<div class="row">' +
          '<span class="badge">' + (doc.xmlGenerated ? 'XML gerado' : 'XML nao gerado') + '</span>' +
          '<span class="badge">' + (doc.signatureValid ? 'assinatura valida' : 'sem assinatura valida') + '</span>' +
          '<span class="badge ' + (doc.xsdValid ? 'status-autorizado' : doc.xmlSigned ? 'status-rejeitado' : '') + '">' +
            (doc.xsdValid ? 'XSD oficial valido' : doc.xmlSigned ? 'XSD oficial invalido' : 'XSD nao validado') +
          '</span>' +
        '</div>' +
        (doc.xsdErrors?.length
          ? '<details><summary>Ver erros do XSD (' + doc.xsdErrors.length + ')</summary><pre>' +
              escapeHtml(doc.xsdErrors.join('\\n')) +
            '</pre></details>'
          : '') +
        '<div class="muted" style="margin-top:8px">payload normalizado</div>' +
        '<pre>' + escapeHtml(JSON.stringify(doc.payloadNormalizado, null, 2)) + '</pre>' +
        '</div>' +
      '</article>';
    }

    function escapeHtml(value) {
      return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
    }

    function loadExpandedDocuments() {
      try {
        return JSON.parse(localStorage.getItem('nlf-expanded-documents') || '[]');
      } catch {
        return [];
      }
    }

    function saveExpandedDocuments(ids) {
      localStorage.setItem('nlf-expanded-documents', JSON.stringify(ids));
    }

    function applyDocumentExpansionState() {
      const expanded = new Set(loadExpandedDocuments());
      document.querySelectorAll('[data-doc-toggle]').forEach((button) => {
        const id = button.getAttribute('data-doc-toggle');
        if (!id) return;
        const body = document.getElementById('doc-body-' + id);
        if (!body) return;
        const isOpen = expanded.has(id);
        body.hidden = !isOpen;
        button.textContent = isOpen ? 'Recolher nota' : 'Ver detalhes';
      });
    }

    function toggleDocumentDetails(id) {
      const expanded = new Set(loadExpandedDocuments());
      if (expanded.has(id)) {
        expanded.delete(id);
      } else {
        expanded.add(id);
      }
      saveExpandedDocuments(Array.from(expanded));
      applyDocumentExpansionState();
    }

    async function render() {
      const data = await fetchSnapshot();
      const certificateSelect = document.getElementById('certificateCnpj');
      const documentSelect = document.getElementById('documentCnpj');
      const selectedCertificate = certificateSelect.value;
      const selectedDocument = documentSelect.value;
      const options = data.issuers.map((issuer) =>
        '<option value="' + issuer.cnpj + '">' +
        escapeHtml(issuer.nomeFantasia) + ' - ' + issuer.cnpj + ' (' + issuer.ambiente + ')' +
        '</option>'
      ).join('');
      certificateSelect.innerHTML = options;
      documentSelect.innerHTML = options;
      if (selectedCertificate) certificateSelect.value = selectedCertificate;
      if (selectedDocument) documentSelect.value = selectedDocument;

      document.getElementById('summary').innerHTML = [
        card('Clients', data.summary.clients),
        card('Emitentes', data.summary.issuers),
        card('Certificados', data.summary.certificates),
        card('Documentos', data.summary.documents)
      ].join('');

      document.getElementById('issuers').innerHTML = data.issuers.map(
        (issuer) => issuerItem(issuer, data.certificates)
      ).join('');

      document.getElementById('documents').innerHTML = data.documents.length
        ? data.documents.map((doc) => documentItem(doc, data.certificates)).join('')
        : '<div class="empty">Nenhum documento recebido. Emita uma NFC-e em homologação pelo Gestão Ótica.</div>';
      applyDocumentExpansionState();
    }

    async function getAccessToken() {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: apiClientId,
        client_secret: apiClientSecret,
        scope: 'empresa nfe nfce'
      });
      const res = await fetch('/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body
      });
      return res.json();
    }

    async function changeDocumentStatus(id, action, extra = {}) {
      const res = await fetch('/admin/api/documents/' + id + '/status', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: 'Basic ' + adminToken
        },
        body: JSON.stringify({ action, ...extra })
      });
      const json = await res.json();
      document.getElementById('responseBox').textContent = JSON.stringify(json, null, 2);
      await render();
    }

    async function rejectDocument(id) {
      const code = prompt('Codigo da rejeicao:', '999');
      if (code === null) return;
      const reason = prompt('Motivo da rejeicao:', 'Rejeicao simulada pelo painel local.');
      if (reason === null) return;
      await changeDocumentStatus(id, 'rejeitar', { code, reason });
    }

    async function signDocument(id) {
      const res = await fetch('/admin/api/documents/' + id + '/sign', {
        method: 'POST',
        headers: { Authorization: 'Basic ' + adminToken }
      });
      const json = await res.json();
      document.getElementById('responseBox').textContent = JSON.stringify(json, null, 2);
      await render();
    }

    async function checkSefazStatus(id) {
      document.getElementById('responseBox').textContent = 'Consultando o servico de status da SEFAZ...';
      const res = await fetch('/admin/api/issuers/' + id + '/sefaz-status', {
        method: 'POST',
        headers: { Authorization: 'Basic ' + adminToken }
      });
      const json = await res.json();
      document.getElementById('responseBox').textContent = JSON.stringify(json, null, 2);
    }

    async function prepareSefazAuthorization(id) {
      document.getElementById('responseBox').textContent = 'Validando o lote sem transmitir...';
      const res = await fetch('/admin/api/documents/' + id + '/sefaz-preview', {
        method: 'POST',
        headers: { Authorization: 'Basic ' + adminToken }
      });
      const json = await res.json();
      document.getElementById('responseBox').textContent = JSON.stringify(json, null, 2);
    }

    async function transmitToSefaz(id) {
      const confirmation = prompt(
        'Esta acao enviara a NFC-e para a SEFAZ-PR em HOMOLOGACAO. Digite TRANSMITIR HOMOLOGACAO para continuar:'
      );
      if (confirmation !== 'TRANSMITIR HOMOLOGACAO') {
        document.getElementById('responseBox').textContent = 'Transmissao cancelada.';
        return;
      }
      document.getElementById('responseBox').textContent = 'Transmitindo para a SEFAZ-PR em homologacao...';
      const res = await fetch('/admin/api/documents/' + id + '/sefaz-authorize', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: 'Basic ' + adminToken
        },
        body: JSON.stringify({ confirmation })
      });
      const json = await res.json();
      document.getElementById('responseBox').textContent = JSON.stringify(json, null, 2);
      await render();
    }

    async function downloadSignedXml(id) {
      const res = await fetch('/admin/api/documents/' + id + '/xml-signed', {
        headers: { Authorization: 'Basic ' + adminToken }
      });
      if (!res.ok) {
        document.getElementById('responseBox').textContent = await res.text();
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = id + '-assinado.xml';
      link.click();
      URL.revokeObjectURL(url);
    }

    document.getElementById('certificateForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const file = form.get('certificateFile');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const tokenData = await getAccessToken();
      const cnpj = String(form.get('cnpj')).replace(/\\D/g, '');
      const res = await fetch('/empresas/' + cnpj + '/certificado', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer ' + tokenData.access_token
        },
        body: JSON.stringify({
          fileName: file.name,
          pfxBase64: btoa(binary),
          password: form.get('password')
        })
      });
      const json = await res.json();
      document.getElementById('responseBox').textContent = JSON.stringify(json, null, 2);
      await render();
    });

    document.getElementById('documentForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const tipoDocumento = String(form.get('tipoDocumento'));
      const tokenData = await getAccessToken();
      const res = await fetch('/' + tipoDocumento, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer ' + tokenData.access_token
        },
        body: JSON.stringify({
          ambiente: form.get('ambiente'),
          emitente: { cnpj: form.get('emitenteCnpj') },
          itens: [],
          totais: {}
        })
      });
      const json = await res.json();
      document.getElementById('responseBox').textContent = JSON.stringify(json, null, 2);
      await render();
    });

    render();
  </script>
</body>
</html>`;

const adminHtml = createAdminHtml({
  adminToken: Buffer.from(
    `${config.adminUsername}:${config.adminPassword}`
  ).toString("base64"),
  apiClientId: config.defaultClientId,
  apiClientSecret: config.defaultClientSecret
});

void legacyAdminHtml;

function unauthorized() {
  return {
    message: "Credenciais de admin invalidas."
  };
}

function isValidBasic(authorization: string | undefined) {
  if (!authorization?.startsWith("Basic ")) {
    return false;
  }

  const raw = Buffer.from(authorization.slice(6), "base64").toString("utf-8");
  return raw === `${config.adminUsername}:${config.adminPassword}`;
}

function parseAdminEnvironment(value: string) {
  return value === "homologacao" || value === "producao" ? value : null;
}

function positiveSeries(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 999 ? parsed : null;
}

function fiscalCheck(name: string, ok: boolean, message: string, details?: Record<string, unknown>) {
  return {
    name,
    status: ok ? "ok" : "attention",
    ok,
    message,
    details: details ?? {}
  };
}

export async function registerAdminRoutes(app: FastifyInstance) {
  app.get("/admin", async (_request, reply) => {
    reply.header("content-type", "text/html; charset=utf-8");
    return adminHtml;
  });

  app.get("/admin/api/snapshot", async (request, reply) => {
    if (!isValidBasic(request.headers.authorization)) {
      return reply.code(401).send(unauthorized());
    }

    return app.store.getSnapshot();
  });

  app.get("/admin/api/fiscal-health", async (request, reply) => {
    if (!isValidBasic(request.headers.authorization)) {
      return reply.code(401).send(unauthorized());
    }

    const query = (request.query as Record<string, unknown> | undefined) ?? {};
    const cnpj = String(query.cnpj ?? "").replace(/\D/g, "");
    const environment = parseAdminEnvironment(String(query.environment ?? "homologacao"));
    const checkSefaz = String(query.checkSefaz ?? "false") === "true";

    if (cnpj.length !== 14 || !environment) {
      return reply.code(400).send({
        message: "Informe CNPJ e ambiente validos para a checagem fiscal."
      });
    }

    const issuer = app.store.findIssuerByCnpj(cnpj, environment);
    const certificate = app.store.findActiveCertificate(cnpj);
    const serviceConfig = app.store.findServiceConfig(cnpj, environment, "NFCE");
    const documents = app.store.documents
      .filter(
        (document) =>
          document.issuerCnpj === cnpj &&
          document.ambiente === environment &&
          document.tipoDocumento === "NFCe"
      )
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      );
    const lastDocument = documents[0] ? app.store.getDocumentSnapshot(documents[0]) : null;
    const now = Date.now();
    const certValidUntil = certificate?.validUntil
      ? new Date(certificate.validUntil).getTime()
      : 0;

    const checks = [
      fiscalCheck(
        "empresa",
        Boolean(
          issuer?.ativo &&
            issuer.uf &&
            issuer.crt &&
            issuer.serieNfce > 0
        ),
        issuer
          ? "Empresa e ambiente fiscal cadastrados."
          : "Ambiente fiscal da empresa nao encontrado.",
        issuer
          ? {
              uf: issuer.uf,
              crt: issuer.crt,
              serie_nfce: issuer.serieNfce,
              ativo: issuer.ativo
            }
          : {}
      ),
      fiscalCheck(
        "certificado_a1",
        Boolean(certificate?.active && certValidUntil > now),
        certificate
          ? certValidUntil > now
            ? "Certificado A1 ativo e dentro da validade."
            : "Certificado A1 encontrado, mas vencido."
          : "Certificado A1 ativo nao encontrado.",
        certificate
          ? {
              arquivo: certificate.fileName,
              valido_ate: certificate.validUntil,
              titular_cnpj: certificate.holderCnpj
            }
          : {}
      ),
      fiscalCheck(
        "nfce_csc",
        Boolean(
          serviceConfig?.active &&
            serviceConfig.settings.cscId &&
            serviceConfig.secretsEncrypted
        ),
        serviceConfig?.secretsEncrypted
          ? "CSC e CSC ID cadastrados para NFC-e neste ambiente."
          : "CSC ou CSC ID ainda nao configurado para NFC-e.",
        serviceConfig
          ? {
              csc_id: serviceConfig.settings.cscId,
              ativo: serviceConfig.active,
              csc_configurado: Boolean(serviceConfig.secretsEncrypted)
            }
          : {}
      ),
      fiscalCheck(
        "ultima_nfce",
        Boolean(
          lastDocument &&
            lastDocument.status === "autorizado" &&
            lastDocument.signatureValid &&
            lastDocument.xsdValid &&
            lastDocument.chave &&
            lastDocument.protocolo
        ),
        lastDocument
          ? lastDocument.status === "autorizado"
            ? "Ultima NFC-e autorizada com chave, protocolo, assinatura e XSD validos."
            : `Ultima NFC-e esta com status ${lastDocument.status}.`
          : "Ainda nao ha NFC-e registrada para este ambiente.",
        lastDocument
          ? {
              id: lastDocument.id,
              numero: lastDocument.numero,
              status: lastDocument.status,
              chave: lastDocument.chave,
              protocolo: lastDocument.protocolo,
              motivo: lastDocument.motivo
            }
          : {}
      )
    ];

    let sefazCheck = fiscalCheck(
      "sefaz",
      false,
      "SEFAZ ainda nao consultada nesta checagem.",
      { consultada: false }
    );

    if (checkSefaz) {
      if (!issuer || !certificate?.encryptedBundle) {
        sefazCheck = fiscalCheck(
          "sefaz",
          false,
          "Para consultar a SEFAZ, cadastre o ambiente fiscal e o certificado A1.",
          { consultada: false }
        );
      } else {
        try {
          const status = await querySefazStatus({
            uf: issuer.uf,
            ambiente: issuer.ambiente,
            encryptedCertificateBundle: certificate.encryptedBundle,
            encryptionSecret: config.certificateEncryptionKey
          });
          sefazCheck = fiscalCheck(
            "sefaz",
            status.cStat === "107",
            status.cStat === "107"
              ? "SEFAZ respondeu servico em operacao."
              : "SEFAZ respondeu, mas nao confirmou operacao normal.",
            {
              consultada: true,
              cStat: status.cStat,
              xMotivo: status.xMotivo,
              recebido_em: status.dhRecbto
            }
          );
        } catch (error) {
          sefazCheck = fiscalCheck(
            "sefaz",
            false,
            error instanceof Error ? error.message : String(error),
            { consultada: true }
          );
        }
      }
    }

    const allChecks = [...checks, sefazCheck];
    const ok = allChecks.every((check) => check.ok);

    return {
      message: ok
        ? "Saude fiscal OK para NFC-e."
        : "Checagem fiscal encontrou pontos de atencao.",
      ok,
      cnpj,
      ambiente: environment,
      service: "NFCE",
      checked_sefaz: checkSefaz,
      checks: allChecks
    };
  });

  app.post("/admin/api/companies/:cnpj/environments/:environment", async (request, reply) => {
    if (!isValidBasic(request.headers.authorization)) {
      return reply.code(401).send(unauthorized());
    }

    const params = request.params as { cnpj: string; environment: string };
    const body = (request.body as Record<string, unknown> | undefined) ?? {};
    const cnpj = params.cnpj.replace(/\D/g, "");
    const environment = parseAdminEnvironment(params.environment);
    const uf = String(body.uf ?? "").trim().toUpperCase();
    const crt = String(body.crt ?? "").trim();
    const serieNfe = positiveSeries(body.serieNfe);
    const serieNfce = positiveSeries(body.serieNfce);
    if (
      cnpj.length !== 14 ||
      !environment ||
      !/^[A-Z]{2}$/.test(uf) ||
      !["1", "2", "3", "4"].includes(crt) ||
      !serieNfe ||
      !serieNfce
    ) {
      return reply.code(400).send({
        message:
          "Informe CNPJ valido, ambiente, UF, CRT (1 a 4) e series entre 1 e 999."
      });
    }

    const issuer = app.store.upsertIssuerEnvironment(cnpj, environment, {
      razaoSocial: String(body.razaoSocial ?? ""),
      nomeFantasia: String(body.nomeFantasia ?? ""),
      uf,
      ie: String(body.ie ?? ""),
      crt,
      serieNfe,
      serieNfce,
      ativo: body.ativo === false ? false : true
    });
    await app.store.waitForPersistence();

    return {
      message: "Configuracao fiscal do ambiente salva.",
      issuer
    };
  });

  app.post("/admin/api/companies/:cnpj/services/nfce/:environment", async (request, reply) => {
    if (!isValidBasic(request.headers.authorization)) {
      return reply.code(401).send(unauthorized());
    }

    const params = request.params as { cnpj: string; environment: string };
    const body = (request.body as Record<string, unknown> | undefined) ?? {};
    const cnpj = params.cnpj.replace(/\D/g, "");
    const environment = parseAdminEnvironment(params.environment);
    const cscId = String(body.cscId ?? "").trim();
    const csc = String(body.csc ?? "").trim();
    if (cnpj.length !== 14 || !environment || !/^[1-9]\d{0,5}$/.test(String(Number(cscId)))) {
      return reply.code(400).send({
        message: "Informe CNPJ, ambiente e CSC ID numerico de 1 a 6 digitos."
      });
    }

    const existing = app.store.findServiceConfig(cnpj, environment, "NFCE");
    if (!csc && !existing?.secretsEncrypted) {
      return reply.code(400).send({
        message: "Informe o CSC na primeira configuracao deste ambiente."
      });
    }

    const serviceConfig = app.store.upsertServiceConfig(cnpj, environment, "NFCE", {
      active: body.ativo === false ? false : true,
      settings: {
        cscId
      },
      preserveSecrets: !csc,
      secretsEncrypted: csc
        ? encryptSecretPayload({ csc }, config.certificateEncryptionKey)
        : null
    });

    if (!serviceConfig) {
      return reply.code(404).send({
        message: "Empresa ou ambiente nao encontrado para salvar a configuracao NFC-e."
      });
    }
    await app.store.waitForPersistence();

    return {
      message: csc
        ? "Configuracao NFC-e salva com CSC atualizado."
        : "Configuracao NFC-e salva mantendo o CSC atual.",
      serviceConfig: {
        ...serviceConfig,
        secretsEncrypted: undefined,
        hasSecrets: Boolean(serviceConfig.secretsEncrypted)
      }
    };
  });

  app.post("/admin/api/documents/:id/status", async (request, reply) => {
    if (!isValidBasic(request.headers.authorization)) {
      return reply.code(401).send(unauthorized());
    }

    const params = request.params as { id: string };
    const body = (request.body as Record<string, unknown> | undefined) ?? {};
    const action = String(body.action ?? "");
    let document;

    if (action === "autorizar") {
      document = app.store.authorizeDocument(params.id);
    } else if (action === "rejeitar") {
      document = app.store.rejectDocument(
        params.id,
        String(body.code ?? "999"),
        String(body.reason ?? "Rejeicao simulada pelo painel local.")
      );
    } else if (action === "processar") {
      document = app.store.processDocument(params.id);
    } else {
      return reply.code(400).send({
        message: "Acao invalida. Use autorizar, rejeitar ou processar."
      });
    }

    if (!document) {
      return reply.code(404).send({ message: "Documento nao encontrado." });
    }
    await app.store.waitForPersistence();

    return {
      message: "Status mock atualizado.",
      document: app.store.getDocumentSnapshot(document)
    };
  });

  app.post("/admin/api/issuers/:id/sefaz-status", async (request, reply) => {
    if (!isValidBasic(request.headers.authorization)) {
      return reply.code(401).send(unauthorized());
    }

    const params = request.params as { id: string };
    const issuer = app.store.issuers.find((item) => item.id === params.id);
    if (!issuer) {
      return reply.code(404).send({ message: "Emitente nao encontrado." });
    }

    const certificate = app.store.findActiveCertificate(issuer.cnpj);
    if (!certificate?.encryptedBundle) {
      return reply.code(409).send({
        message: "Cadastre o certificado A1 deste emitente antes de consultar a SEFAZ."
      });
    }

    try {
      const status = await querySefazStatus({
        uf: issuer.uf,
        ambiente: issuer.ambiente,
        encryptedCertificateBundle: certificate.encryptedBundle,
        encryptionSecret: config.certificateEncryptionKey
      });

      return {
        message:
          status.cStat === "107"
            ? "SEFAZ disponivel para receber requisicoes."
            : "A SEFAZ respondeu, mas o servico nao informou operacao normal.",
        consulta: "status_servico",
        transmite_documento: false,
        ...status
      };
    } catch (error) {
      request.log.error(
        {
          issuerId: issuer.id,
          cnpj: issuer.cnpj,
          uf: issuer.uf,
          ambiente: issuer.ambiente,
          error: error instanceof Error ? error.message : String(error)
        },
        "Falha na consulta de status da SEFAZ"
      );
      return reply.code(502).send({
        message: error instanceof Error ? error.message : String(error),
        consulta: "status_servico",
        transmite_documento: false
      });
    }
  });

  app.post("/admin/api/documents/:id/sign", async (request, reply) => {
    if (!isValidBasic(request.headers.authorization)) {
      return reply.code(401).send(unauthorized());
    }

    const params = request.params as { id: string };
    const document = app.store.findDocument(params.id);
    if (!document) {
      return reply.code(404).send({ message: "Documento nao encontrado." });
    }

    const certificate = app.store.findActiveCertificate(document.issuerCnpj);
    if (!certificate?.encryptedBundle) {
      return reply.code(409).send({
        message: "Cadastre um certificado A1 para o CNPJ emitente antes de assinar."
      });
    }

    try {
      const opened = openEncryptedCertificate(
        certificate.encryptedBundle,
        config.certificateEncryptionKey
      );
      const nfceConfig = document.nfceConfigEncrypted
        ? decryptSecretPayload<{ cscId: string; csc: string }>(
            document.nfceConfigEncrypted,
            config.certificateEncryptionKey
          )
        : null;
      const result = generateAndSignNfeXml(
        document.payloadOriginal as Record<string, unknown>,
        opened.privateKeyPem,
        opened.certificatePem,
        document.tipoDocumento === "NFCe" && nfceConfig
          ? {
              ...nfceConfig,
              qrCodeBaseUrl: "http://www.fazenda.pr.gov.br/nfce/qrcode",
              consultationUrl: "http://www.fazenda.pr.gov.br/nfce/consulta"
            }
          : undefined,
        config.nfeResponsibleTechnicalCnpj ||
          config.nfeResponsibleTechnicalContact ||
          config.nfeResponsibleTechnicalEmail ||
          config.nfeResponsibleTechnicalPhone ||
          (document.ambiente === "producao"
            ? config.nfeResponsibleTechnicalCsrtIdProduction ||
              config.nfeResponsibleTechnicalCsrtProduction
            : config.nfeResponsibleTechnicalCsrtIdHomologation ||
              config.nfeResponsibleTechnicalCsrtHomologation)
          ? {
              cnpj: config.nfeResponsibleTechnicalCnpj,
              contact: config.nfeResponsibleTechnicalContact,
              email: config.nfeResponsibleTechnicalEmail,
              phone: config.nfeResponsibleTechnicalPhone,
              idCSRT:
                document.ambiente === "producao"
                  ? config.nfeResponsibleTechnicalCsrtIdProduction
                  : config.nfeResponsibleTechnicalCsrtIdHomologation,
              csrt:
                document.ambiente === "producao"
                  ? config.nfeResponsibleTechnicalCsrtProduction
                  : config.nfeResponsibleTechnicalCsrtHomologation
            }
          : undefined
      );
      const xsd = validateNfeXml(result.signedXml);
      const updated = app.store.saveSignedXml(document.id, {
        ...result,
        xsdValid: xsd.valid,
        xsdErrors: xsd.errors,
        certificateId: certificate.id
      });
      await app.store.waitForPersistence();
      return {
        message: xsd.valid
          ? `XML ${document.tipoDocumento} assinado e validado no XSD oficial.`
          : `XML ${document.tipoDocumento} assinado, mas reprovado no XSD oficial.`,
        id: updated?.id,
        chave: result.accessKey,
        assinatura_valida: result.signatureValid,
        xsd_valido: xsd.valid,
        schema: xsd.schema,
        erros_xsd: xsd.errors
      };
    } catch (error) {
      return reply.code(400).send({
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.post("/admin/api/documents/:id/process-automatic", async (request, reply) => {
    if (!isValidBasic(request.headers.authorization)) {
      return reply.code(401).send(unauthorized());
    }

    const body = (request.body as Record<string, unknown> | undefined) ?? {};
    if (body.confirmation !== "PROCESSAR HOMOLOGACAO") {
      return reply.code(400).send({
        message: "Confirmacao invalida. O documento nao foi transmitido."
      });
    }

    const params = request.params as { id: string };
    const document = app.store.findDocument(params.id);
    if (!document) {
      return reply.code(404).send({ message: "Documento nao encontrado." });
    }
    if (document.ambiente !== "homologacao") {
      return reply.code(403).send({
        message: "O processamento automatico esta limitado a homologacao."
      });
    }
    if (document.status === "autorizado" || document.status === "cancelado") {
      return reply.code(409).send({
        message: `O documento ja esta com status ${document.status}.`
      });
    }

    const result =
      document.tipoDocumento === "NFCe"
        ? await processHomologationNfce(app.store, document.id)
        : await processHomologationDocument(app.store, document.id);
    return reply.code(result.error ? 422 : 200).send({
      message:
        result.error ??
        result.document.motivo ??
        "Processamento automatico concluido.",
      transmitido: result.transmitted,
      document: app.store.getDocumentSnapshot(result.document)
    });
  });

  app.post("/admin/api/documents/:id/sefaz-preview", async (request, reply) => {
    if (!isValidBasic(request.headers.authorization)) {
      return reply.code(401).send(unauthorized());
    }

    const params = request.params as { id: string };
    const document = app.store.findDocument(params.id);
    if (
      !document?.xmlSigned ||
      !document.signatureValid ||
      !document.xsdValid ||
      !document.chave
    ) {
      return reply.code(409).send({
        message:
          "O documento precisa ter XML assinado, chave, assinatura valida e XSD valido."
      });
    }
    if (document.ambiente !== "homologacao") {
      return reply.code(403).send({
        message: "A preparacao desta etapa esta limitada a homologacao."
      });
    }

    const batch = buildAuthorizationBatch(document.xmlSigned);
    const validation = validateAuthorizationBatchXml(batch.batchXml);
    return reply.code(validation.valid ? 200 : 422).send({
      message: validation.valid
        ? "Lote pronto para transmissao em homologacao. Nada foi enviado."
        : "Lote reprovado antes da transmissao.",
      transmite_documento: false,
      ambiente: document.ambiente,
      tipo: document.tipoDocumento,
      cnpj: document.issuerCnpj,
      chave: document.chave,
      id_lote: batch.idLote,
      tamanho_bytes: Buffer.byteLength(batch.batchXml),
      xsd_valido: validation.valid,
      schema: validation.schema,
      erros_xsd: validation.errors
    });
  });

  app.post("/admin/api/documents/:id/sefaz-authorize", async (request, reply) => {
    if (!isValidBasic(request.headers.authorization)) {
      return reply.code(401).send(unauthorized());
    }

    const body = (request.body as Record<string, unknown> | undefined) ?? {};
    if (body.confirmation !== "TRANSMITIR HOMOLOGACAO") {
      return reply.code(400).send({
        message: "Confirmacao invalida. A transmissao nao foi realizada."
      });
    }

    const params = request.params as { id: string };
    const document = app.store.findDocument(params.id);
    if (
      !document?.xmlSigned ||
      !document.signatureValid ||
      !document.xsdValid ||
      !document.chave
    ) {
      return reply.code(409).send({
        message:
          "O documento precisa ter XML assinado, chave, assinatura valida e XSD valido."
      });
    }
    if (document.ambiente !== "homologacao") {
      return reply.code(403).send({
        message: "Transmissao em producao permanece bloqueada."
      });
    }

    const issuer = app.store.findIssuerByCnpj(document.issuerCnpj, document.ambiente);
    const certificate = app.store.findActiveCertificate(document.issuerCnpj);
    if (!issuer || !certificate?.encryptedBundle) {
      return reply.code(409).send({
        message: "Emitente ou certificado A1 nao encontrado."
      });
    }

    const accessKey = document.chave;
    try {
      const currentStatus = await querySefazDocumentStatus({
        uf: issuer.uf,
        ambiente: document.ambiente,
        documentType: document.tipoDocumento,
        accessKey,
        encryptedCertificateBundle: certificate.encryptedBundle,
        encryptionSecret: config.certificateEncryptionKey
      });
      if (
        currentStatus.cStat !== "217" ||
        ["100", "150"].includes(currentStatus.protocolCStat)
      ) {
        return reply.code(409).send({
          message:
            currentStatus.protocolReason ||
            currentStatus.xMotivo ||
            "A chave ja possui situacao registrada na SEFAZ.",
          transmite_documento: false,
          consulta_previa: true,
          status_consulta: currentStatus.cStat,
          motivo_consulta: currentStatus.xMotivo,
          status_protocolo: currentStatus.protocolCStat || null,
          protocolo: currentStatus.protocol || null
        });
      }

      const result = await authorizeNfeAtSefaz({
        uf: issuer.uf,
        ambiente: document.ambiente,
        documentType: document.tipoDocumento,
        signedXml: document.xmlSigned,
        encryptedCertificateBundle: certificate.encryptedBundle,
        encryptionSecret: config.certificateEncryptionKey
      });
      const updated = app.store.saveSefazAuthorization(document.id, {
        batchId: result.idLote,
        receipt: result.receipt,
        batchCStat: result.batchCStat,
        batchReason: result.batchReason,
        protocolCStat: result.protocolCStat,
        protocolReason: result.protocolReason,
        protocol: result.protocol,
        accessKey: result.accessKey,
        responseXml: result.responseXml,
        processedXml: result.processedXml
      });
      await app.store.waitForPersistence();

      return {
        message: result.protocolCStat
          ? result.protocolReason
          : result.batchReason,
        transmite_documento: true,
        ambiente: result.ambiente,
        id: updated?.id,
        id_lote: result.idLote,
        recibo: result.receipt || null,
        status_lote: result.batchCStat,
        motivo_lote: result.batchReason,
        status_protocolo: result.protocolCStat || null,
        motivo_protocolo: result.protocolReason || null,
        chave: result.accessKey || accessKey,
        protocolo: result.protocol || null,
        recebido_em: result.receivedAt,
        versao_aplicacao: result.applicationVersion
      };
    } catch (error) {
      request.log.error(
        {
          documentId: document.id,
          cnpj: document.issuerCnpj,
          ambiente: document.ambiente,
          error: error instanceof Error ? error.message : String(error)
        },
        "Falha na autorizacao SEFAZ"
      );
      return reply.code(502).send({
        message: error instanceof Error ? error.message : String(error),
        transmissao_tentada: true,
        autorizacao_confirmada: false
      });
    }
  });

  app.get("/admin/api/documents/:id/xml-signed", async (request, reply) => {
    if (!isValidBasic(request.headers.authorization)) {
      return reply.code(401).send(unauthorized());
    }

    const params = request.params as { id: string };
    const document = app.store.findDocument(params.id);
    if (!document?.xmlSigned) {
      return reply.code(404).send({ message: "XML assinado nao encontrado." });
    }

    reply.header("content-type", "application/xml; charset=utf-8");
    reply.header(
      "content-disposition",
      `attachment; filename="${document.tipoDocumento}-${document.numero}-assinado.xml"`
    );
    return document.xmlSigned;
  });
}
