type AdminPageConfig = {
  adminToken: string;
  apiClientId: string;
  apiClientSecret: string;
};

const page = String.raw`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Nuvem Local Fiscal</title>
  <style>
    :root {
      --canvas: #f2efe8;
      --paper: #fffdf8;
      --paper-2: #f8f5ee;
      --ink: #102a2e;
      --muted: #68787a;
      --line: #d8ddd8;
      --forest: #0b5d55;
      --forest-dark: #083f3a;
      --lime: #d5e56c;
      --amber: #efb24d;
      --red: #b94a48;
      --blue: #315f83;
      --shadow: 0 16px 45px rgba(21, 48, 49, .08);
    }
    * { box-sizing: border-box; }
    html { min-height: 100%; background: var(--canvas); }
    body {
      min-height: 100vh;
      margin: 0;
      color: var(--ink);
      font-family: "Trebuchet MS", "Gill Sans", sans-serif;
      background:
        linear-gradient(rgba(16, 42, 46, .025) 1px, transparent 1px),
        linear-gradient(90deg, rgba(16, 42, 46, .025) 1px, transparent 1px),
        radial-gradient(circle at 8% 10%, rgba(213, 229, 108, .22), transparent 26%),
        var(--canvas);
      background-size: 32px 32px, 32px 32px, auto, auto;
    }
    button, input, select { font: inherit; }
    button { cursor: pointer; }
    .topline {
      min-height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 6px 18px;
      color: #173230;
      background: var(--lime);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .16em;
      text-transform: uppercase;
    }
    .topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      display: grid;
      grid-template-columns: auto 1fr auto;
      align-items: center;
      gap: 28px;
      min-height: 76px;
      padding: 0 34px;
      border-bottom: 1px solid rgba(16, 42, 46, .12);
      background: rgba(255, 253, 248, .91);
      backdrop-filter: blur(14px);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      border: 0;
      color: var(--ink);
      background: transparent;
      text-align: left;
    }
    .brand-mark {
      display: grid;
      width: 38px;
      height: 38px;
      place-items: center;
      border-radius: 12px 12px 4px 12px;
      color: white;
      background: var(--forest);
      font-family: Georgia, serif;
      font-size: 18px;
      box-shadow: 6px 6px 0 var(--lime);
    }
    .brand-copy strong {
      display: block;
      font-family: Georgia, serif;
      font-size: 18px;
    }
    .brand-copy span {
      color: var(--muted);
      font-size: 10px;
      letter-spacing: .11em;
      text-transform: uppercase;
    }
    .nav {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
    }
    .nav button {
      width: auto;
      padding: 10px 14px;
      border: 0;
      border-radius: 10px;
      color: var(--muted);
      background: transparent;
      font-size: 13px;
      font-weight: 700;
    }
    .nav button:hover, .nav button.active {
      color: var(--forest-dark);
      background: #e5eee8;
    }
    .system-state {
      display: flex;
      align-items: center;
      gap: 9px;
      font-size: 12px;
      font-weight: 700;
    }
    .pulse {
      width: 9px;
      height: 9px;
      border-radius: 50%;
      background: #2e9b65;
      box-shadow: 0 0 0 5px rgba(46, 155, 101, .12);
    }
    main {
      width: min(1220px, calc(100% - 38px));
      margin: 0 auto;
      padding: 42px 0 80px;
    }
    .page-head {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 26px;
    }
    .eyebrow {
      margin-bottom: 8px;
      color: var(--forest);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .18em;
      text-transform: uppercase;
    }
    h1, h2, h3 { font-family: Georgia, "Times New Roman", serif; }
    h1 { margin: 0; font-size: clamp(34px, 5vw, 60px); line-height: .98; }
    h2 { margin: 0; font-size: 24px; }
    h3 { margin: 0; font-size: 18px; }
    p { line-height: 1.55; }
    .lead { max-width: 700px; margin: 12px 0 0; color: var(--muted); }
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 30px;
    }
    .metric {
      position: relative;
      min-height: 134px;
      overflow: hidden;
      padding: 22px;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: rgba(255, 253, 248, .88);
      box-shadow: var(--shadow);
    }
    .metric:after {
      position: absolute;
      right: -18px;
      bottom: -30px;
      width: 90px;
      height: 90px;
      border: 16px solid rgba(11, 93, 85, .05);
      border-radius: 50%;
      content: "";
    }
    .metric-label {
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .09em;
      text-transform: uppercase;
    }
    .metric-value {
      margin-top: 16px;
      font-family: Georgia, serif;
      font-size: 38px;
      line-height: 1;
    }
    .metric-note { margin-top: 8px; color: var(--muted); font-size: 12px; }
    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      margin: 30px 0 14px;
    }
    .section-head p { margin: 4px 0 0; color: var(--muted); font-size: 13px; }
    .company-list, .document-list, .log-list { display: grid; gap: 12px; }
    .company {
      display: grid;
      grid-template-columns: 1fr auto auto;
      align-items: center;
      gap: 28px;
      padding: 20px 22px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: var(--paper);
      box-shadow: 0 8px 24px rgba(21, 48, 49, .05);
      transition: transform .18s ease, box-shadow .18s ease;
    }
    .company:hover { transform: translateY(-2px); box-shadow: var(--shadow); }
    .company-name { font-family: Georgia, serif; font-size: 19px; font-weight: 700; }
    .company-legal { margin-top: 4px; color: var(--muted); font-size: 13px; }
    .company-meta { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 11px; }
    .environment-stack { display: flex; gap: 7px; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      width: fit-content;
      padding: 5px 9px;
      border-radius: 999px;
      color: #4d5c5e;
      background: #edf0ec;
      font-size: 11px;
      font-weight: 700;
    }
    .badge:before {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #9aa6a3;
      content: "";
    }
    .badge.ok { color: #236446; background: #e2f2e7; }
    .badge.ok:before { background: #2e9b65; }
    .badge.warn { color: #785818; background: #f7edce; }
    .badge.warn:before { background: var(--amber); }
    .badge.bad { color: #853a38; background: #f4dfdd; }
    .badge.bad:before { background: var(--red); }
    .badge.info { color: #315f83; background: #e1ebf2; }
    .badge.info:before { background: var(--blue); }
    .btn {
      width: auto;
      min-height: 40px;
      padding: 10px 15px;
      border: 0;
      border-radius: 11px;
      color: white;
      background: var(--forest);
      font-weight: 800;
    }
    .btn:hover { background: var(--forest-dark); }
    .btn.secondary { color: var(--forest-dark); background: #e5eee8; }
    .btn.ghost { color: var(--ink); background: transparent; border: 1px solid var(--line); }
    .btn.danger { background: var(--red); }
    .btn.blue { background: var(--blue); }
    .btn.amber { color: #3f321c; background: var(--amber); }
    .btn:disabled { cursor: not-allowed; opacity: .42; }
    .tabs {
      display: flex;
      gap: 7px;
      padding: 6px;
      border: 1px solid var(--line);
      border-radius: 14px;
      background: #e9e8e1;
    }
    .tabs button {
      width: auto;
      padding: 9px 15px;
      border: 0;
      border-radius: 9px;
      color: var(--muted);
      background: transparent;
      font-size: 12px;
      font-weight: 800;
    }
    .tabs button.active { color: var(--ink); background: var(--paper); box-shadow: 0 3px 12px rgba(21,48,49,.08); }
    .surface {
      padding: 24px;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: var(--paper);
      box-shadow: var(--shadow);
    }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .info-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 18px; }
    .info {
      min-height: 82px;
      padding: 14px;
      border-radius: 12px;
      background: var(--paper-2);
    }
    .info span { display: block; color: var(--muted); font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .info strong { display: block; margin-top: 8px; font-size: 14px; }
    .certificate-card {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 18px;
      align-items: center;
      margin-bottom: 20px;
      padding: 18px;
      border-radius: 14px;
      background: #e6f0e8;
    }
    .certificate-icon {
      display: grid;
      width: 54px;
      height: 64px;
      place-items: center;
      border-radius: 8px 8px 18px 8px;
      color: white;
      background: var(--forest);
      font-family: Georgia, serif;
      font-size: 20px;
    }
    form { display: grid; gap: 14px; }
    label { display: grid; gap: 7px; color: #334a4d; font-size: 12px; font-weight: 800; }
    input, select {
      width: 100%;
      min-height: 44px;
      padding: 10px 12px;
      border: 1px solid #cdd5d1;
      border-radius: 10px;
      color: var(--ink);
      background: white;
    }
    .service-picker { margin-bottom: 18px; }
    .service-box {
      position: relative;
      overflow: hidden;
      min-height: 300px;
      padding: 24px;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: var(--paper);
    }
    .service-box:after {
      position: absolute;
      right: -80px;
      top: -100px;
      width: 240px;
      height: 240px;
      border-radius: 50%;
      background: rgba(213, 229, 108, .17);
      content: "";
    }
    .env-toggle { position: relative; z-index: 1; display: flex; gap: 7px; margin: 18px 0; }
    .placeholder {
      display: grid;
      min-height: 240px;
      place-items: center;
      text-align: center;
    }
    .placeholder strong { display: block; font-family: Georgia, serif; font-size: 24px; }
    .placeholder p { max-width: 480px; color: var(--muted); }
    .document {
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 15px;
      background: var(--paper);
    }
    .document-summary {
      display: grid;
      grid-template-columns: 90px 1fr 160px auto;
      align-items: center;
      gap: 18px;
      padding: 17px 20px;
    }
    .document-number { font-family: Georgia, serif; font-size: 18px; font-weight: 700; }
    .document-sub { margin-top: 4px; color: var(--muted); font-size: 12px; }
    .document-quick-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
    .document-quick-actions .btn { min-height: 36px; padding: 8px 12px; font-size: 11px; }
    .document-body { padding: 0 20px 20px; border-top: 1px solid var(--line); }
    .document-body[hidden] { display: none; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 18px 0; }
    .actions .btn { font-size: 12px; }
    details { margin-top: 14px; }
    summary { cursor: pointer; color: var(--forest); font-weight: 800; }
    pre {
      max-height: 420px;
      overflow: auto;
      margin: 10px 0 0;
      padding: 16px;
      border: 1px solid #253c3f;
      border-radius: 12px;
      color: #dce8dc;
      background: #102a2e;
      white-space: pre-wrap;
      word-break: break-word;
      font: 12px/1.55 Consolas, monospace;
    }
    .console {
      margin-top: 22px;
      border: 1px solid #253c3f;
      border-radius: 16px;
      background: #102a2e;
      box-shadow: var(--shadow);
    }
    .console-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 13px 16px;
      color: #dce8dc;
      border-bottom: 1px solid rgba(255,255,255,.1);
      font-size: 12px;
      font-weight: 800;
    }
    .console pre { margin: 0; border: 0; border-radius: 0 0 16px 16px; }
    .log {
      display: grid;
      grid-template-columns: 150px 120px 1fr auto;
      gap: 16px;
      align-items: center;
      padding: 15px 18px;
      border: 1px solid var(--line);
      border-radius: 13px;
      background: var(--paper);
      font-size: 12px;
    }
    .empty {
      padding: 44px 20px;
      border: 1px dashed #bdc8c2;
      border-radius: 16px;
      color: var(--muted);
      text-align: center;
      background: rgba(255,253,248,.5);
    }
    .small { color: var(--muted); font-size: 12px; }
    .breadcrumb {
      width: auto;
      margin-bottom: 14px;
      padding: 0;
      border: 0;
      color: var(--forest);
      background: transparent;
      font-size: 12px;
      font-weight: 800;
    }
    @media (max-width: 900px) {
      .topbar { grid-template-columns: 1fr auto; padding: 12px 18px; }
      .nav { grid-column: 1 / -1; order: 3; overflow-x: auto; justify-content: flex-start; }
      main { width: min(100% - 24px, 1220px); padding-top: 26px; }
      .metrics { grid-template-columns: 1fr 1fr; }
      .company { grid-template-columns: 1fr; gap: 14px; }
      .two-col, .info-grid { grid-template-columns: 1fr; }
      .document-summary { grid-template-columns: 80px 1fr auto; }
      .document-summary > :nth-child(3) { display: none; }
      .document-quick-actions { grid-column: 1 / -1; justify-content: flex-start; }
      .log { grid-template-columns: 1fr auto; }
      .log > :nth-child(2), .log > :nth-child(3) { grid-column: 1 / -1; }
    }
    @media (max-width: 560px) {
      .system-state { display: none; }
      .metrics { grid-template-columns: 1fr; }
      .page-head { align-items: flex-start; flex-direction: column; }
      .tabs { width: 100%; overflow-x: auto; }
      .tabs button { white-space: nowrap; }
    }
  </style>
</head>
<body>
  <div class="topline">Motor fiscal local - ambiente controlado</div>
  <header class="topbar">
    <button class="brand" type="button" onclick="navigate('home')">
      <span class="brand-mark">NL</span>
      <span class="brand-copy"><strong>Nuvem Local</strong><span>Fiscal</span></span>
    </button>
    <nav class="nav" aria-label="Navegação principal">
      <button type="button" data-nav="home" onclick="navigate('home')">Home</button>
      <button type="button" data-nav="companies" onclick="navigate('companies')">Empresas</button>
      <button type="button" data-nav="documents" onclick="navigate('documents')">Documentos</button>
      <button type="button" data-nav="logs" onclick="navigate('logs')">Logs e debug</button>
    </nav>
    <div class="system-state"><span class="pulse"></span><span>Servidor local ativo</span></div>
  </header>
  <main id="app"><div class="empty">Carregando painel fiscal...</div></main>
  <script>
    const runtimeConfig = __CONFIG__;
    const state = {
      page: 'home',
      companyCnpj: null,
      companyTab: 'dados',
      service: 'nfce',
      environment: 'homologacao',
      snapshot: null,
      fiscalHealth: null,
      lastResponse: 'Nenhuma ação executada nesta sessão.'
    };

    function escapeHtml(value) {
      return String(value == null ? '' : value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }

    function formatCnpj(value) {
      const digits = String(value || '').replace(/\D/g, '');
      if (digits.length !== 14) return digits;
      return digits.slice(0, 2) + '.' + digits.slice(2, 5) + '.' + digits.slice(5, 8) + '/' +
        digits.slice(8, 12) + '-' + digits.slice(12);
    }

    function formatDate(value, withTime) {
      if (!value) return 'Não informado';
      const options = withTime
        ? { dateStyle: 'short', timeStyle: 'short' }
        : { dateStyle: 'short' };
      return new Intl.DateTimeFormat('pt-BR', options).format(new Date(value));
    }

    function groupedCompanies() {
      const companies = new Map();
      state.snapshot.issuers.forEach(function(issuer) {
        if (!companies.has(issuer.cnpj)) {
          companies.set(issuer.cnpj, {
            cnpj: issuer.cnpj,
            razaoSocial: issuer.razaoSocial,
            nomeFantasia: issuer.nomeFantasia,
            environments: {}
          });
        }
        companies.get(issuer.cnpj).environments[issuer.ambiente] = issuer;
      });
      return Array.from(companies.values());
    }

    function companyByCnpj(cnpj) {
      return groupedCompanies().find(function(company) { return company.cnpj === cnpj; });
    }

    function certificateFor(cnpj) {
      return state.snapshot.certificates.find(function(certificate) {
        return certificate.cnpj === cnpj && certificate.active;
      });
    }

    function serviceConfigFor(cnpj, ambiente, serviceType) {
      return state.snapshot.serviceConfigs.find(function(serviceConfig) {
        return serviceConfig.cnpj === cnpj &&
          serviceConfig.ambiente === ambiente &&
          serviceConfig.serviceType === serviceType &&
          serviceConfig.active;
      });
    }

    function currentFiscalHealthFor(company) {
      if (!state.fiscalHealth) return null;
      if (state.fiscalHealth.cnpj !== company.cnpj) return null;
      if (state.fiscalHealth.ambiente !== state.environment) return null;
      return state.fiscalHealth;
    }

    function documentsFor(cnpj) {
      return state.snapshot.documents.filter(function(doc) { return doc.issuerCnpj === cnpj; });
    }

    function eventsFor(documentId) {
      return (state.snapshot.documentEvents || []).filter(function(event) {
        return event.documentId === documentId;
      });
    }

    function eventTone(level) {
      if (level === 'error') return 'bad';
      if (level === 'warn') return 'warn';
      return 'ok';
    }

    function badge(text, tone) {
      return '<span class="badge ' + (tone || '') + '">' + escapeHtml(text) + '</span>';
    }

    function pageHead(eyebrow, title, lead, action) {
      return '<section class="page-head"><div><div class="eyebrow">' + escapeHtml(eyebrow) +
        '</div><h1>' + escapeHtml(title) + '</h1><p class="lead">' + escapeHtml(lead) +
        '</p></div>' + (action || '') + '</section>';
    }

    function metrics(companies) {
      const docs = state.snapshot.documents;
      const authorized = docs.filter(function(doc) { return doc.status === 'autorizado'; }).length;
      const attention = docs.filter(function(doc) {
        return doc.status === 'erro' || doc.status === 'rejeitado';
      }).length;
      const cards = [
        ['Empresas', companies.length, 'CNPJs únicos cadastrados'],
        ['Certificados', state.snapshot.certificates.length, 'A1 armazenados localmente'],
        ['Autorizados', authorized, 'Documentos com protocolo'],
        ['Atenção', attention, 'Rejeições ou erros recentes']
      ];
      return '<section class="metrics">' + cards.map(function(item) {
        return '<article class="metric"><div class="metric-label">' + item[0] +
          '</div><div class="metric-value">' + item[1] +
          '</div><div class="metric-note">' + item[2] + '</div></article>';
      }).join('') + '</section>';
    }

    function companyCard(company) {
      const cert = certificateFor(company.cnpj);
      const docs = documentsFor(company.cnpj);
      const hom = company.environments.homologacao;
      const prod = company.environments.producao;
      return '<article class="company">' +
        '<div><div class="company-name">' + escapeHtml(company.nomeFantasia) + '</div>' +
          '<div class="company-legal">' + escapeHtml(company.razaoSocial) + '</div>' +
          '<div class="company-meta">' +
            badge(formatCnpj(company.cnpj), '') +
            badge(cert ? 'Certificado ativo' : 'Sem certificado', cert ? 'ok' : 'warn') +
            badge(docs.length + ' documento(s)', 'info') +
          '</div></div>' +
        '<div class="environment-stack">' +
          badge('Homologação', hom ? 'ok' : '') +
          badge('Produção', prod ? 'ok' : '') +
        '</div>' +
        '<button type="button" class="btn secondary" onclick="openCompany(\'' +
          escapeHtml(company.cnpj) + '\')">Abrir empresa</button>' +
      '</article>';
    }

    function renderHome() {
      const companies = groupedCompanies();
      const recent = state.snapshot.documents.slice(0, 3);
      return pageHead(
        'Visão geral',
        'Operação fiscal, sem ruído.',
        'Empresas, certificados e documentos em uma visão única. Homologação e produção ficam organizadas dentro de cada CNPJ.'
      ) +
      metrics(companies) +
      '<section class="section-head"><div><h2>Empresas</h2><p>Cadastro único por CNPJ, com ambientes separados internamente.</p></div>' +
        '<button type="button" class="btn ghost" onclick="navigate(\'companies\')">Ver todas</button></section>' +
      '<div class="company-list">' + companies.slice(0, 4).map(companyCard).join('') + '</div>' +
      '<section class="section-head"><div><h2>Movimento recente</h2><p>Últimos documentos recebidos pelo motor local.</p></div></section>' +
      (recent.length ? '<div class="document-list">' + recent.map(documentRow).join('') + '</div>' :
        '<div class="empty">Ainda não há documentos recebidos.</div>');
    }

    function renderCompanies() {
      const companies = groupedCompanies();
      return pageHead(
        'Cadastros',
        'Empresas',
        'Cada empresa aparece uma única vez. As configurações fiscais de homologação e produção vivem dentro dela.'
      ) +
      '<div class="company-list">' + companies.map(companyCard).join('') + '</div>';
    }

    function renderCompany() {
      const company = companyByCnpj(state.companyCnpj);
      if (!company) {
        state.page = 'companies';
        return renderCompanies();
      }
      const tabs = [
        ['dados', 'Dados'],
        ['certificado', 'Certificado'],
        ['servicos', 'Serviços']
      ];
      return '<button type="button" class="breadcrumb" onclick="navigate(\'companies\')">← Voltar para empresas</button>' +
        pageHead('Empresa', company.nomeFantasia, company.razaoSocial + ' · ' + formatCnpj(company.cnpj)) +
        '<div class="section-head"><div class="tabs">' + tabs.map(function(tab) {
          return '<button type="button" class="' + (state.companyTab === tab[0] ? 'active' : '') +
            '" onclick="setCompanyTab(\'' + tab[0] + '\')">' + tab[1] + '</button>';
        }).join('') + '</div></div>' +
        (state.companyTab === 'dados' ? renderCompanyDataPanel(company) :
          state.companyTab === 'certificado' ? renderCertificate(company) :
          renderServicesPanel(company));
    }

    function renderCompanyData(company) {
      const hom = company.environments.homologacao;
      const prod = company.environments.producao;
      const base = hom || prod;
      return '<section class="surface"><h2>Dados cadastrais</h2>' +
        '<p class="small">Informações compartilhadas pela empresa e registros disponíveis por ambiente.</p>' +
        '<div class="info-grid">' +
          info('CNPJ', formatCnpj(company.cnpj)) +
          info('Razão social', company.razaoSocial) +
          info('Nome fantasia', company.nomeFantasia) +
          info('UF', base ? base.uf : 'Não informado') +
          info('Inscrição estadual', base ? base.ie || 'Não informada' : 'Não informada') +
          info('Regime tributário', base ? 'CRT ' + (base.crt || 'não informado') : 'Não informado') +
        '</div><div class="section-head"><div><h3>Ambientes</h3><p>Um cadastro, duas configurações fiscais independentes.</p></div></div>' +
        '<div class="two-col">' + environmentSummary(hom, 'Homologação') +
          environmentSummary(prod, 'Produção') + '</div></section>';
    }

    function info(label, value) {
      return '<div class="info"><span>' + escapeHtml(label) + '</span><strong>' +
        escapeHtml(value) + '</strong></div>';
    }

    function environmentSummary(issuer, label) {
      if (!issuer) {
        return '<div class="info"><span>' + label + '</span><strong>Ambiente ainda não cadastrado</strong></div>';
      }
      return '<div class="info"><span>' + label + '</span><strong>' +
        'NF-e série ' + issuer.serieNfe + ' · NFC-e série ' + issuer.serieNfce +
        '</strong></div>';
    }

    function renderCertificate(company) {
      const cert = certificateFor(company.cnpj);
      return '<section class="surface"><h2>Certificado digital A1</h2>' +
        '<p class="small">O certificado pertence ao CNPJ e pode ser usado pelos serviços habilitados nos dois ambientes.</p>' +
        (cert ? '<div class="certificate-card"><div class="certificate-icon">A1</div><div><h3>' +
          escapeHtml(cert.fileName) + '</h3><div class="company-meta">' +
          badge('Ativo', 'ok') +
          badge('Válido até ' + formatDate(cert.validUntil, false), cert.validUntil && new Date(cert.validUntil) > new Date() ? 'ok' : 'bad') +
          '</div><p class="small">Enviado em ' + formatDate(cert.uploadedAt, true) + '</p></div></div>' :
          '<div class="empty">Nenhum certificado A1 cadastrado para este CNPJ.</div>') +
        '<div class="section-head"><div><h3>' + (cert ? 'Substituir certificado' : 'Cadastrar certificado') +
          '</h3><p>Selecione o arquivo PFX ou P12 e informe a senha.</p></div></div>' +
        '<form id="certificateForm"><input type="hidden" name="cnpj" value="' + escapeHtml(company.cnpj) + '" />' +
          '<div class="two-col"><label>Arquivo do certificado<input type="file" name="certificateFile" accept=".pfx,.p12" required /></label>' +
          '<label>Senha do certificado<input type="password" name="password" required autocomplete="off" /></label></div>' +
          '<div><button type="submit" class="btn">' +
            (cert ? 'Validar e salvar novo A1' : 'Validar e salvar certificado A1') +
          '</button></div>' +
        '</form></section>' + responseConsole();
    }

    function renderServices(company) {
      const services = [['nfce', 'NFC-e'], ['nfe', 'NF-e'], ['nfse', 'NFS-e']];
      return '<div class="tabs service-picker">' + services.map(function(service) {
        return '<button type="button" class="' + (state.service === service[0] ? 'active' : '') +
          '" onclick="setService(\'' + service[0] + '\')">' + service[1] + '</button>';
      }).join('') + '</div>' +
      (state.service === 'nfce' ? renderNfceService(company) :
        state.service === 'nfe' ? renderNfeServicePanel(company) :
        renderServicePlaceholder(state.service));
    }

    function renderNfceService(company) {
      const issuer = company.environments[state.environment];
      const cert = certificateFor(company.cnpj);
      const docs = documentsFor(company.cnpj).filter(function(doc) {
        return doc.tipoDocumento === 'NFCe' && doc.ambiente === state.environment;
      });
      return '<section class="service-box"><div class="eyebrow">Serviço ativo</div><h2>Nota Fiscal de Consumidor Eletrônica</h2>' +
        '<p class="small">Configuração e diagnóstico separados por ambiente.</p>' +
        '<div class="env-toggle"><div class="tabs">' +
          '<button type="button" class="' + (state.environment === 'homologacao' ? 'active' : '') +
            '" onclick="setEnvironment(\'homologacao\')">Homologação</button>' +
          '<button type="button" class="' + (state.environment === 'producao' ? 'active' : '') +
            '" onclick="setEnvironment(\'producao\')">Produção</button></div></div>' +
        (issuer ? '<div class="info-grid">' +
          info('Situação', issuer.ativo ? 'Ativo' : 'Inativo') +
          info('Série NFC-e', String(issuer.serieNfce)) +
          info('Certificado', cert ? 'A1 ativo' : 'Não cadastrado') +
          info('UF autorizadora', issuer.uf) +
          info('Documentos', String(docs.length)) +
          info('Última emissão', docs.length ? formatDate(docs[0].createdAt, true) : 'Nenhuma') +
          '</div><div class="actions"><button type="button" class="btn" ' +
            (cert ? '' : 'disabled') + ' onclick="checkSefazStatus(\'' + escapeHtml(issuer.id) +
            '\')">Consultar disponibilidade SEFAZ</button>' +
          '<button type="button" class="btn secondary" onclick="openCompanyDocuments(\'' +
            escapeHtml(company.cnpj) + '\')">Ver documentos da empresa</button></div>' :
          '<div class="empty">Este ambiente ainda não possui um registro fiscal para a empresa.</div>') +
        '</section>' + responseConsole();
    }

    function renderCompanyDataPanel(company) {
      const hom = company.environments.homologacao;
      const prod = company.environments.producao;
      const base = hom || prod;
      return '<section class="surface"><h2>Dados cadastrais</h2>' +
        '<p class="small">Informacoes compartilhadas pela empresa e registros disponiveis por ambiente.</p>' +
        '<div class="actions"><button type="button" class="btn secondary" onclick="openNfceSettings()">Configurar NFC-e e CSC</button></div>' +
        '<div class="info-grid">' +
          info('CNPJ', formatCnpj(company.cnpj)) +
          info('Razao social', company.razaoSocial) +
          info('Nome fantasia', company.nomeFantasia) +
          info('UF', base ? base.uf : 'Nao informado') +
          info('Inscricao estadual', base ? base.ie || 'Nao informada' : 'Nao informada') +
          info('Regime tributario', base ? 'CRT ' + (base.crt || 'nao informado') : 'Nao informado') +
        '</div><div class="section-head"><div><h3>Ambientes</h3><p>Um cadastro, duas configuracoes fiscais independentes.</p></div></div>' +
        '<div class="two-col">' +
          environmentEditor(company, hom, 'Homologacao', 'homologacao') +
          environmentEditor(company, prod, 'Producao', 'producao') +
        '</div></section>' + responseConsole();
    }

    function environmentEditor(company, issuer, label, environment) {
      return '<section class="surface"><h3>' + label + '</h3><p class="small">Base fiscal usada pela Nuvem Local neste ambiente.</p>' +
        '<form class="environmentForm">' +
          '<input type="hidden" name="cnpj" value="' + escapeHtml(company.cnpj) + '" />' +
          '<input type="hidden" name="environment" value="' + environment + '" />' +
          '<div class="two-col">' +
            '<label>Razao social<input name="razaoSocial" value="' + escapeHtml(company.razaoSocial) + '" required /></label>' +
            '<label>Nome fantasia<input name="nomeFantasia" value="' + escapeHtml(company.nomeFantasia) + '" required /></label>' +
          '</div>' +
          '<div class="two-col">' +
            '<label>UF<input name="uf" maxlength="2" value="' + escapeHtml(issuer ? issuer.uf : '') + '" required /></label>' +
            '<label>Inscricao estadual<input name="ie" value="' + escapeHtml(issuer ? issuer.ie : '') + '" /></label>' +
          '</div>' +
          '<div class="two-col">' +
            '<label>CRT / regime tributario<input name="crt" value="' + escapeHtml(issuer ? issuer.crt : '') + '" placeholder="1 para Simples Nacional" required /></label>' +
            '<label>Serie NF-e<input type="number" min="1" name="serieNfe" value="' + escapeHtml(String(issuer ? issuer.serieNfe : 1)) + '" required /></label>' +
          '</div>' +
          '<div class="two-col">' +
            '<label>Serie NFC-e<input type="number" min="1" name="serieNfce" value="' + escapeHtml(String(issuer ? issuer.serieNfce : 1)) + '" required /></label>' +
            '<label>Situacao<select name="ativo"><option value="true"' + (issuer?.ativo !== false ? ' selected' : '') + '>Ativo</option><option value="false"' + (issuer?.ativo === false ? ' selected' : '') + '>Inativo</option></select></label>' +
          '</div>' +
          '<div><button type="submit" class="btn">Salvar ambiente</button></div>' +
        '</form></section>';
    }

    function renderServicesPanel(company) {
      const services = [['nfce', 'NFC-e'], ['nfe', 'NF-e'], ['nfse', 'NFS-e']];
      return '<div class="tabs service-picker">' + services.map(function(service) {
        return '<button type="button" class="' + (state.service === service[0] ? 'active' : '') +
          '" onclick="setService(\'' + service[0] + '\')">' + service[1] + '</button>';
      }).join('') + '</div>' +
      (state.service === 'nfce' ? renderNfceServicePanel(company) :
        state.service === 'nfe' ? renderNfeServicePanel(company) :
        renderServicePlaceholder(state.service));
    }

    function renderNfeServicePanel(company) {
      const issuer = company.environments[state.environment];
      const serviceConfig = serviceConfigFor(company.cnpj, state.environment, 'NFE');
      const storedConfig = state.snapshot.serviceConfigs.find(function(item) {
        return item.cnpj === company.cnpj &&
          item.ambiente === state.environment &&
          item.serviceType === 'NFE';
      });
      const docs = documentsFor(company.cnpj).filter(function(doc) {
        return doc.tipoDocumento === 'NFe' && doc.ambiente === state.environment;
      });
      const lastDocument = docs.length ? docs[0] : null;
      const active = storedConfig ? storedConfig.active : true;
      const autoTransmit = storedConfig && storedConfig.settings
        ? storedConfig.settings.autoTransmit !== false
        : true;
      const production = state.environment === 'producao';

      return '<section class="service-box"><div class="eyebrow">Configuracao do servico</div>' +
        '<h2>Nota Fiscal Eletronica</h2>' +
        '<p class="small">Parametros da NF-e separados por ambiente. Operacoes e detalhes tecnicos ficam em Documentos e Logs.</p>' +
        '<div class="env-toggle"><div class="tabs">' +
          '<button type="button" class="' + (state.environment === 'homologacao' ? 'active' : '') +
            '" onclick="setEnvironment(\'homologacao\')">Homologacao</button>' +
          '<button type="button" class="' + (production ? 'active' : '') +
            '" onclick="setEnvironment(\'producao\')">Producao</button></div></div>' +
        (issuer ? '<div class="info-grid">' +
          info('Ambiente', production ? 'Producao bloqueada' : 'Homologacao') +
          info('Ultima NF-e', lastDocument ? '#' + lastDocument.numero : 'Nenhuma') +
          info('Ultimo lote', lastDocument && lastDocument.sefazBatchId ? lastDocument.sefazBatchId : 'Nenhum') +
          '</div><form id="nfeServiceForm">' +
            '<input type="hidden" name="cnpj" value="' + escapeHtml(company.cnpj) + '" />' +
            '<input type="hidden" name="environment" value="' + escapeHtml(state.environment) + '" />' +
            '<div class="two-col">' +
              '<label>CRT<select name="crt">' +
                '<option value="1"' + (issuer.crt === '1' ? ' selected' : '') + '>1 - Simples Nacional</option>' +
                '<option value="2"' + (issuer.crt === '2' ? ' selected' : '') + '>2 - Simples Nacional, excesso</option>' +
                '<option value="3"' + (issuer.crt === '3' ? ' selected' : '') + '>3 - Regime Normal</option>' +
                '<option value="4"' + (issuer.crt === '4' ? ' selected' : '') + '>4 - MEI</option>' +
              '</select></label>' +
              '<label>Serie NF-e<input type="number" min="1" max="999" name="serieNfe" value="' +
                escapeHtml(String(issuer.serieNfe)) + '" required /></label>' +
            '</div><div class="two-col">' +
              '<label>Servico<select name="ativo"><option value="true"' + (active ? ' selected' : '') +
                '>Ativo</option><option value="false"' + (!active ? ' selected' : '') + '>Inativo</option></select></label>' +
              '<label>Transmissao<select name="autoTransmit"' + (production ? ' disabled' : '') + '>' +
                '<option value="true"' + (!production && autoTransmit ? ' selected' : '') + '>Automatica</option>' +
                '<option value="false"' + (production || !autoTransmit ? ' selected' : '') + '>Manual</option>' +
              '</select></label>' +
            '</div>' +
            (production ? '<div class="empty">A transmissao em producao permanece bloqueada por seguranca.</div>' : '') +
            '<div><button type="submit" class="btn">Salvar configuracao NF-e</button></div>' +
          '</form>' :
          '<div class="empty">Cadastre primeiro os dados fiscais deste ambiente.</div>') +
        '</section>' + responseConsole();
    }

    function renderNfceServicePanel(company) {
      const issuer = company.environments[state.environment];
      const cert = certificateFor(company.cnpj);
      const serviceConfig = serviceConfigFor(company.cnpj, state.environment, 'NFCE');
      const docs = documentsFor(company.cnpj).filter(function(doc) {
        return doc.tipoDocumento === 'NFCe' && doc.ambiente === state.environment;
      });
      return '<section class="service-box"><div class="eyebrow">Servico ativo</div><h2>Nota Fiscal de Consumidor Eletronica</h2>' +
        '<p class="small">Configuracao e diagnostico separados por ambiente.</p>' +
        '<div class="env-toggle"><div class="tabs">' +
          '<button type="button" class="' + (state.environment === 'homologacao' ? 'active' : '') +
            '" onclick="setEnvironment(\'homologacao\')">Homologacao</button>' +
          '<button type="button" class="' + (state.environment === 'producao' ? 'active' : '') +
            '" onclick="setEnvironment(\'producao\')">Producao</button></div></div>' +
        (issuer ? '<div class="info-grid">' +
          info('Situacao', issuer.ativo ? 'Ativo' : 'Inativo') +
          info('Serie NFC-e', String(issuer.serieNfce)) +
          info('Certificado', cert ? 'A1 ativo' : 'Nao cadastrado') +
          info('CSC ID', serviceConfig && serviceConfig.settings && serviceConfig.settings.cscId ? String(serviceConfig.settings.cscId) : 'Nao configurado') +
          info('CSC', serviceConfig && serviceConfig.hasSecrets ? 'Configurado' : 'Nao configurado') +
          info('UF autorizadora', issuer.uf) +
          info('Documentos', String(docs.length)) +
          info('Ultima emissao', docs.length ? formatDate(docs[0].createdAt, true) : 'Nenhuma') +
          '</div><div class="section-head"><div><h3>Configuracao NFC-e</h3><p>O CSC fica salvo por ambiente. Deixe em branco para manter o atual.</p></div></div>' +
          '<form id="nfceServiceForm">' +
            '<input type="hidden" name="cnpj" value="' + escapeHtml(company.cnpj) + '" />' +
            '<input type="hidden" name="environment" value="' + escapeHtml(state.environment) + '" />' +
            '<div class="two-col">' +
              '<label>CSC ID<input name="cscId" value="' + escapeHtml(serviceConfig && serviceConfig.settings ? String(serviceConfig.settings.cscId || '') : '') + '" required /></label>' +
              '<label>CSC<input type="password" name="csc" placeholder="' + (serviceConfig && serviceConfig.hasSecrets ? 'Ja configurado. Preencha apenas para trocar.' : 'Informe o CSC deste ambiente') + '" ' + (serviceConfig && serviceConfig.hasSecrets ? '' : 'required') + ' autocomplete="off" /></label>' +
            '</div>' +
            '<div><button type="submit" class="btn">Salvar configuracao NFC-e</button></div>' +
          '</form><div class="section-head"><div><h3>Inutilizacao de numeracao</h3><p>Use quando uma numeracao foi pulada e nao sera mais emitida.</p></div></div>' +
          '<form id="inutilizationForm">' +
            '<input type="hidden" name="cnpj" value="' + escapeHtml(company.cnpj) + '" />' +
            '<input type="hidden" name="environment" value="' + escapeHtml(state.environment) + '" />' +
            '<div class="two-col">' +
              '<label>Serie<input type="number" min="1" name="serie" value="' + escapeHtml(String(issuer.serieNfce)) + '" required /></label>' +
              '<label>Ano<input type="number" min="2000" max="2099" name="ano" value="' + new Date().getFullYear() + '" required /></label>' +
            '</div><div class="two-col">' +
              '<label>Numero inicial<input type="number" min="1" name="numeroInicial" required /></label>' +
              '<label>Numero final<input type="number" min="1" name="numeroFinal" required /></label>' +
            '</div>' +
            '<label>Justificativa<input name="justificativa" minlength="15" placeholder="Ex: Falha operacional na sequencia de numeracao" required /></label>' +
            '<div><button type="submit" class="btn danger" ' + (cert ? '' : 'disabled') + '>Inutilizar em homologacao</button></div>' +
          '</form><div class="actions"><button type="button" class="btn" ' +
            (cert ? '' : 'disabled') + ' onclick="checkSefazStatus(\'' + escapeHtml(issuer.id) +
            '\')">Consultar disponibilidade SEFAZ</button>' +
          '<button type="button" class="btn secondary" onclick="runFiscalHealthCheck(\'' +
            escapeHtml(company.cnpj) + '\', \'' + escapeHtml(state.environment) +
            '\')">Checar saude fiscal</button>' +
          '<button type="button" class="btn secondary" onclick="openCompanyDocuments(\'' +
            escapeHtml(company.cnpj) + '\')">Ver documentos da empresa</button></div>' +
          renderFiscalHealthPanel(company) :
          '<div class="empty">Este ambiente ainda nao possui um registro fiscal para a empresa.</div>') +
        '</section>' + responseConsole();
    }

    function renderFiscalHealthPanel(company) {
      const health = currentFiscalHealthFor(company);
      if (!health) {
        return '<div class="empty">Use "Checar saude fiscal" para validar empresa, A1, CSC, SEFAZ e ultima NFC-e.</div>';
      }
      return '<section class="surface"><div class="section-head"><div><h3>Saude fiscal NFC-e</h3><p>' +
        escapeHtml(health.message) + '</p></div>' +
        badge(health.ok ? 'OK' : 'Atencao', health.ok ? 'ok' : 'warn') +
        '</div><div class="info-grid">' + health.checks.map(function(check) {
          return '<div class="info"><span>' + escapeHtml(check.name) + '</span><strong>' +
            escapeHtml(check.ok ? 'OK' : 'Atencao') + '</strong><small>' +
            escapeHtml(check.message) + '</small></div>';
        }).join('') + '</div></section>';
    }

    function renderServicePlaceholder(service) {
      const name = service === 'nfe' ? 'NF-e' : 'NFS-e';
      return '<section class="service-box placeholder"><div><div class="eyebrow">Próxima etapa</div>' +
        '<strong>' + name + ' ainda não configurada</strong>' +
        '<p>A estrutura da área já está reservada. O serviço será ativado quando fecharmos o fluxo fiscal e as configurações necessárias.</p>' +
        badge('Placeholder', 'warn') + '</div></section>';
    }

    function documentRow(doc) {
      const cert = certificateFor(doc.issuerCnpj);
      const company = companyByCnpj(doc.issuerCnpj);
      const hasCertificate = Boolean(cert);
      const canTransmit = doc.signatureValid && doc.xsdValid && doc.ambiente === 'homologacao';
      const canAutoProcess = doc.ambiente === 'homologacao' &&
        doc.status !== 'autorizado' && doc.status !== 'cancelado';
      const tone = doc.status === 'autorizado' ? 'ok' :
        doc.status === 'processamento' ? 'warn' :
        doc.status === 'rejeitado' || doc.status === 'erro' ? 'bad' : '';
      return '<article class="document"><div class="document-summary">' +
        '<div><div class="document-number">#' + doc.numero + '</div><div class="document-sub">Série ' + doc.serie + '</div></div>' +
        '<div><strong>' + escapeHtml(doc.tipoDocumento) + ' · ' +
          escapeHtml(company ? company.nomeFantasia : formatCnpj(doc.issuerCnpj)) + '</strong>' +
          '<div class="company-meta">' + badge(doc.status, tone) + badge(doc.ambiente, 'info') + '</div></div>' +
        '<div><div class="small">' + formatDate(doc.createdAt, true) + '</div>' +
          '<div class="document-sub">' + escapeHtml(doc.id) + '</div></div>' +
        '<div class="document-quick-actions">' +
          (canAutoProcess && hasCertificate
            ? '<button type="button" class="btn" onclick="processDocumentAutomatically(\'' +
                doc.id + '\')">Processar agora</button>'
            : '') +
          '<button type="button" class="btn ghost" data-doc-toggle="' + escapeHtml(doc.id) +
            '" onclick="toggleDocument(\'' + escapeHtml(doc.id) + '\')">Abrir nota</button>' +
        '</div></div>' +
        '<div class="document-body" id="doc-' + escapeHtml(doc.id) + '" hidden>' +
          (doc.motivo ? '<p><strong>' + escapeHtml(doc.motivoStatus || '') + '</strong> ' +
            escapeHtml(doc.motivo) + '</p>' : '') +
          '<div class="company-meta">' +
            badge(doc.xmlGenerated ? 'XML gerado' : 'XML pendente', doc.xmlGenerated ? 'ok' : 'warn') +
            badge(doc.signatureValid ? 'Assinatura válida' : 'Sem assinatura', doc.signatureValid ? 'ok' : 'warn') +
            badge(doc.xsdValid ? 'XSD válido' : 'XSD pendente/inválido', doc.xsdValid ? 'ok' : 'warn') +
          '</div><div class="actions">' +
            '<button type="button" class="btn" ' + (canAutoProcess && hasCertificate ? '' : 'disabled') +
              ' onclick="processDocumentAutomatically(\'' + doc.id + '\')">Processar agora</button>' +
            '<button type="button" class="btn blue" ' + (hasCertificate ? '' : 'disabled') +
              ' onclick="signDocument(\'' + doc.id + '\')">Gerar e assinar XML</button>' +
            '<button type="button" class="btn secondary" ' + (canTransmit ? '' : 'disabled') +
              ' onclick="prepareSefazAuthorization(\'' + doc.id + '\')">Validar lote</button>' +
            '<button type="button" class="btn danger" ' + (canTransmit ? '' : 'disabled') +
              ' onclick="transmitToSefaz(\'' + doc.id + '\')">Transmitir homologação</button>' +
            '<button type="button" class="btn amber" onclick="rejectDocument(\'' + doc.id + '\')">Simular rejeição</button>' +
            (doc.xmlSigned ? '<button type="button" class="btn ghost" onclick="downloadSignedXml(\'' +
              doc.id + '\')">Baixar XML assinado</button>' : '') +
          '</div>' +
          (doc.xsdErrors && doc.xsdErrors.length ? '<details><summary>Erros de validação XSD</summary><pre>' +
            escapeHtml(doc.xsdErrors.join('\\n')) + '</pre></details>' : '') +
          (eventsFor(doc.id).length
            ? '<details><summary>Historico de processamento (' + eventsFor(doc.id).length +
              ')</summary><div class="log-list">' + eventsFor(doc.id).map(function(event) {
                return '<article class="log"><strong>' + formatDate(event.createdAt, true) +
                  '</strong><span>' + badge(event.level, eventTone(event.level)) +
                  '</span><span>' + escapeHtml(event.message) + '</span></article>';
              }).join('') + '</div></details>'
            : '') +
          '<details><summary>Payload normalizado</summary><pre>' +
            escapeHtml(JSON.stringify(doc.payloadNormalizado, null, 2)) + '</pre></details>' +
        '</div></article>';
    }

    function renderDocuments() {
      let docs = state.snapshot.documents;
      if (state.companyCnpj) {
        docs = docs.filter(function(doc) { return doc.issuerCnpj === state.companyCnpj; });
      }
      const subtitle = state.companyCnpj
        ? 'Exibindo documentos da empresa selecionada. Limpe o filtro para ver todos.'
        : 'Emissões recebidas, validações e respostas fiscais.';
      const clear = state.companyCnpj
        ? '<button type="button" class="btn ghost" onclick="clearCompanyFilter()">Limpar filtro</button>'
        : '';
      return pageHead('Operação', 'Documentos', subtitle, clear) +
        (docs.length ? '<div class="document-list">' + docs.map(documentRow).join('') + '</div>' :
          '<div class="empty">Nenhum documento encontrado para este filtro.</div>') +
        responseConsole();
    }

    function renderLogs() {
      const docs = state.snapshot.documents;
      const events = state.snapshot.documentEvents || [];
      const eventRows = events.map(function(event) {
        const doc = docs.find(function(item) { return item.id === event.documentId; });
        return '<article class="log"><strong>' + formatDate(event.createdAt, true) + '</strong>' +
          '<span>' + badge(event.level, eventTone(event.level)) + '</span><span>' +
          escapeHtml((doc ? doc.tipoDocumento + ' #' + doc.numero + ' - ' : '') + event.message) +
          '</span><button type="button" class="btn ghost" onclick="inspectLog(\'' +
          event.documentId + '\')">Inspecionar</button></article>';
      }).join('');
      return pageHead(
        'Diagnóstico',
        'Logs e debug',
        'Uma leitura técnica do que entrou, do que foi validado e da última resposta conhecida da SEFAZ.'
      ) +
      '<div class="log-list">' + (eventRows || (docs.length ? docs.map(function(doc) {
        const event = doc.sefazResponseXml ? 'Resposta SEFAZ' :
          doc.xmlSigned ? 'XML assinado' : 'Documento recebido';
        return '<article class="log"><strong>' + formatDate(doc.updatedAt, true) + '</strong>' +
          '<span>' + escapeHtml(event) + '</span><span>' +
          escapeHtml(doc.tipoDocumento + ' #' + doc.numero + ' · ' + doc.id) + '</span>' +
          '<button type="button" class="btn ghost" onclick="inspectLog(\'' + doc.id + '\')">Inspecionar</button></article>';
      }).join('') : '<div class="empty">Nenhum evento fiscal registrado.</div>')) + '</div>' +
      '<section class="section-head"><div><h2>Ferramenta manual</h2><p>Útil apenas para diagnóstico local; o fluxo normal começa no sistema emissor.</p></div></section>' +
      '<section class="surface"><form id="documentForm"><div class="two-col">' +
        '<label>Tipo<select name="tipoDocumento"><option value="nfce">NFC-e</option><option value="nfe">NF-e</option></select></label>' +
        '<label>Empresa<select name="emitenteCnpj" id="documentCnpj">' +
          groupedCompanies().map(function(company) {
            return '<option value="' + escapeHtml(company.cnpj) + '">' +
              escapeHtml(company.nomeFantasia + ' · ' + formatCnpj(company.cnpj)) + '</option>';
          }).join('') + '</select></label></div>' +
        '<label>Ambiente<select name="ambiente"><option value="homologacao">Homologação</option><option value="producao">Produção</option></select></label>' +
        '<div><button type="submit" class="btn">Criar documento manual</button></div>' +
      '</form></section>' + responseConsole();
    }

    function responseConsole() {
      return '<section class="console"><div class="console-head"><span>Resultado da última ação</span>' +
        '<button type="button" class="btn ghost" style="color:#dce8dc;border-color:#4c6264" onclick="clearConsole()">Limpar</button></div>' +
        '<pre id="responseBox">' + escapeHtml(state.lastResponse) + '</pre></section>';
    }

    function setResponse(value) {
      state.lastResponse = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      const box = document.getElementById('responseBox');
      if (box) box.textContent = state.lastResponse;
    }

    function clearConsole() {
      setResponse('Console limpo.');
    }

    function navigate(page) {
      state.page = page;
      if (page !== 'company' && page !== 'documents') state.companyCnpj = null;
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function openCompany(cnpj) {
      state.companyCnpj = cnpj;
      state.companyTab = 'dados';
      state.page = 'company';
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function openCompanyDocuments(cnpj) {
      state.companyCnpj = cnpj;
      state.page = 'documents';
      render();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function clearCompanyFilter() {
      state.companyCnpj = null;
      render();
    }

    function setCompanyTab(tab) {
      state.companyTab = tab;
      render();
    }

    function openNfceSettings() {
      state.companyTab = 'servicos';
      state.service = 'nfce';
      state.environment = 'homologacao';
      render();
    }

    function setService(service) {
      state.service = service;
      render();
    }

    function setEnvironment(environment) {
      state.environment = environment;
      render();
    }

    function toggleDocument(id) {
      const body = document.getElementById('doc-' + id);
      const button = document.querySelector('[data-doc-toggle="' + id + '"]');
      if (!body || !button) return;
      body.hidden = !body.hidden;
      button.textContent = body.hidden ? 'Abrir nota' : 'Recolher';
    }

    function inspectLog(id) {
      const doc = state.snapshot.documents.find(function(item) { return item.id === id; });
      if (!doc) return;
      setResponse({
        id: doc.id,
        status: doc.status,
        motivo_status: doc.motivoStatus,
        motivo: doc.motivo,
        assinatura_valida: Boolean(doc.signatureValid),
        xsd_valido: Boolean(doc.xsdValid),
        erros_xsd: doc.xsdErrors || [],
        lote: doc.sefazBatchId || null,
        recibo: doc.sefazReceipt || null,
        payload_original: doc.payloadOriginal,
        payload_normalizado: doc.payloadNormalizado,
        xml_gerado: doc.xmlGenerated || null,
        xml_assinado: doc.xmlSigned || null,
        xml_autorizado: doc.xml || null,
        resposta_sefaz_xml: doc.sefazResponseXml || null,
        cancelamento: doc.cancellationStatusCode ? {
          codigo_status: doc.cancellationStatusCode,
          motivo: doc.cancellationReason,
          protocolo: doc.cancellationProtocol,
          justificativa: doc.cancellationJustification,
          xml_processado: doc.cancellationProcessedXml || null
        } : null,
        eventos: eventsFor(doc.id),
      });
      document.getElementById('responseBox').scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function bindForms() {
      const certificateForm = document.getElementById('certificateForm');
      if (certificateForm) certificateForm.addEventListener('submit', uploadCertificate);
      const documentForm = document.getElementById('documentForm');
      if (documentForm) documentForm.addEventListener('submit', createManualDocument);
      document.querySelectorAll('.environmentForm').forEach(function(form) {
        form.addEventListener('submit', saveEnvironmentConfig);
      });
      const nfceServiceForm = document.getElementById('nfceServiceForm');
      if (nfceServiceForm) nfceServiceForm.addEventListener('submit', saveNfceServiceConfig);
      const nfeServiceForm = document.getElementById('nfeServiceForm');
      if (nfeServiceForm) nfeServiceForm.addEventListener('submit', saveNfeServiceConfig);
      const inutilizationForm = document.getElementById('inutilizationForm');
      if (inutilizationForm) inutilizationForm.addEventListener('submit', createInutilization);
    }

    function updateNav() {
      document.querySelectorAll('[data-nav]').forEach(function(button) {
        const target = button.getAttribute('data-nav');
        button.classList.toggle('active',
          target === state.page || (state.page === 'company' && target === 'companies'));
      });
    }

    function render() {
      if (!state.snapshot) return;
      let html = '';
      if (state.page === 'home') html = renderHome();
      if (state.page === 'companies') html = renderCompanies();
      if (state.page === 'company') html = renderCompany();
      if (state.page === 'documents') html = renderDocuments();
      if (state.page === 'logs') html = renderLogs();
      document.getElementById('app').innerHTML = html;
      updateNav();
      bindForms();
    }

    async function fetchSnapshot() {
      const response = await fetch('/admin/api/snapshot', {
        headers: { Authorization: 'Basic ' + runtimeConfig.adminToken }
      });
      if (!response.ok) throw new Error('Não foi possível carregar o painel administrativo.');
      state.snapshot = await response.json();
    }

    async function refreshSnapshot() {
      await fetchSnapshot();
      render();
    }

    async function getAccessToken() {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: runtimeConfig.apiClientId,
        client_secret: runtimeConfig.apiClientSecret,
        scope: 'empresa nfe nfce'
      });
      const response = await fetch('/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body
      });
      return response.json();
    }

    async function uploadCertificate(event) {
      event.preventDefault();
      setResponse('Validando e armazenando o certificado A1...');
      const form = new FormData(event.currentTarget);
      const file = form.get('certificateFile');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const token = await getAccessToken();
      const cnpj = String(form.get('cnpj')).replace(/\D/g, '');
      const response = await fetch('/empresas/' + cnpj + '/certificado', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer ' + token.access_token
        },
        body: JSON.stringify({
          fileName: file.name,
          pfxBase64: btoa(binary),
          password: form.get('password')
        })
      });
      const json = await response.json();
      setResponse(json);
      await refreshSnapshot();
    }

    async function createManualDocument(event) {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const token = await getAccessToken();
      const response = await fetch('/' + String(form.get('tipoDocumento')), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer ' + token.access_token
        },
        body: JSON.stringify({
          ambiente: form.get('ambiente'),
          emitente: { cnpj: form.get('emitenteCnpj') },
          itens: [],
          totais: {}
        })
      });
      setResponse(await response.json());
      await refreshSnapshot();
    }

    async function saveEnvironmentConfig(event) {
      event.preventDefault();
      setResponse('Salvando configuracao fiscal do ambiente...');
      const form = new FormData(event.currentTarget);
      const cnpj = String(form.get('cnpj')).replace(/\D/g, '');
      const environment = String(form.get('environment'));
      const response = await fetch('/admin/api/companies/' + cnpj + '/environments/' + environment, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: 'Basic ' + runtimeConfig.adminToken
        },
        body: JSON.stringify({
          razaoSocial: form.get('razaoSocial'),
          nomeFantasia: form.get('nomeFantasia'),
          uf: String(form.get('uf') || '').toUpperCase(),
          ie: form.get('ie'),
          crt: form.get('crt'),
          serieNfe: Number(form.get('serieNfe') || 1),
          serieNfce: Number(form.get('serieNfce') || 1),
          ativo: String(form.get('ativo')) === 'true'
        })
      });
      setResponse(await response.json());
      await refreshSnapshot();
    }

    async function saveNfceServiceConfig(event) {
      event.preventDefault();
      setResponse('Salvando configuracao NFC-e...');
      const form = new FormData(event.currentTarget);
      const cnpj = String(form.get('cnpj')).replace(/\D/g, '');
      const environment = String(form.get('environment'));
      const response = await fetch('/admin/api/companies/' + cnpj + '/services/nfce/' + environment, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: 'Basic ' + runtimeConfig.adminToken
        },
        body: JSON.stringify({
          cscId: form.get('cscId'),
          csc: form.get('csc')
        })
      });
      setResponse(await response.json());
      await refreshSnapshot();
    }

    async function saveNfeServiceConfig(event) {
      event.preventDefault();
      setResponse('Salvando configuracao NF-e...');
      const form = new FormData(event.currentTarget);
      const cnpj = String(form.get('cnpj')).replace(/\D/g, '');
      const environment = String(form.get('environment'));
      const response = await fetch('/admin/api/companies/' + cnpj + '/services/nfe/' + environment, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: 'Basic ' + runtimeConfig.adminToken
        },
        body: JSON.stringify({
          crt: form.get('crt'),
          serieNfe: Number(form.get('serieNfe') || 1),
          ativo: String(form.get('ativo')) === 'true',
          autoTransmit: environment === 'homologacao' &&
            String(form.get('autoTransmit')) === 'true'
        })
      });
      setResponse(await response.json());
      await refreshSnapshot();
    }

    async function createInutilization(event) {
      event.preventDefault();
      const confirmation = prompt(
        'Esta acao transmitira uma inutilizacao para a SEFAZ em HOMOLOGACAO. Digite INUTILIZAR HOMOLOGACAO para continuar:'
      );
      if (confirmation !== 'INUTILIZAR HOMOLOGACAO') {
        setResponse('Inutilizacao cancelada.');
        return;
      }
      setResponse('Transmitindo inutilizacao para a SEFAZ...');
      const form = new FormData(event.currentTarget);
      const token = await getAccessToken();
      const response = await fetch('/nfce/inutilizacoes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: 'Bearer ' + token.access_token
        },
        body: JSON.stringify({
          cnpj: form.get('cnpj'),
          ambiente: form.get('environment'),
          ano: Number(form.get('ano')),
          serie: Number(form.get('serie')),
          numero_inicial: Number(form.get('numeroInicial')),
          numero_final: Number(form.get('numeroFinal')),
          justificativa: form.get('justificativa')
        })
      });
      setResponse(await response.json());
      await refreshSnapshot();
    }

    async function signDocument(id) {
      setResponse('Gerando, assinando e validando o XML...');
      const response = await fetch('/admin/api/documents/' + id + '/sign', {
        method: 'POST',
        headers: { Authorization: 'Basic ' + runtimeConfig.adminToken }
      });
      setResponse(await response.json());
      await refreshSnapshot();
    }

    async function processDocumentAutomatically(id) {
      const confirmation = prompt(
        'Esta acao assina, valida e transmite a NFC-e para a SEFAZ-PR em HOMOLOGACAO. Digite PROCESSAR HOMOLOGACAO para continuar:'
      );
      if (confirmation !== 'PROCESSAR HOMOLOGACAO') {
        setResponse('Processamento cancelado.');
        return;
      }
      setResponse('Assinando, validando e transmitindo a NFC-e...');
      const response = await fetch('/admin/api/documents/' + id + '/process-automatic', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: 'Basic ' + runtimeConfig.adminToken
        },
        body: JSON.stringify({ confirmation: confirmation })
      });
      setResponse(await response.json());
      await refreshSnapshot();
    }

    async function checkSefazStatus(id) {
      setResponse('Consultando a disponibilidade da SEFAZ...');
      const response = await fetch('/admin/api/issuers/' + id + '/sefaz-status', {
        method: 'POST',
        headers: { Authorization: 'Basic ' + runtimeConfig.adminToken }
      });
      setResponse(await response.json());
    }

    async function runFiscalHealthCheck(cnpj, environment) {
      setResponse('Checando saude fiscal da NFC-e...');
      const params = new URLSearchParams({
        cnpj: cnpj,
        environment: environment,
        checkSefaz: 'true'
      });
      const response = await fetch('/admin/api/fiscal-health?' + params.toString(), {
        headers: { Authorization: 'Basic ' + runtimeConfig.adminToken }
      });
      const json = await response.json();
      state.fiscalHealth = json;
      setResponse(json);
      await refreshSnapshot();
    }

    async function prepareSefazAuthorization(id) {
      setResponse('Validando o lote sem transmitir...');
      const response = await fetch('/admin/api/documents/' + id + '/sefaz-preview', {
        method: 'POST',
        headers: { Authorization: 'Basic ' + runtimeConfig.adminToken }
      });
      setResponse(await response.json());
    }

    async function transmitToSefaz(id) {
      const confirmation = prompt(
        'Esta ação enviará a NFC-e para a SEFAZ-PR em HOMOLOGAÇÃO. Digite TRANSMITIR HOMOLOGACAO para continuar:'
      );
      if (confirmation !== 'TRANSMITIR HOMOLOGACAO') {
        setResponse('Transmissão cancelada.');
        return;
      }
      setResponse('Transmitindo para a SEFAZ-PR em homologação...');
      const response = await fetch('/admin/api/documents/' + id + '/sefaz-authorize', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: 'Basic ' + runtimeConfig.adminToken
        },
        body: JSON.stringify({ confirmation: confirmation })
      });
      setResponse(await response.json());
      await refreshSnapshot();
    }

    async function rejectDocument(id) {
      const code = prompt('Código da rejeição:', '999');
      if (code === null) return;
      const reason = prompt('Motivo da rejeição:', 'Rejeição simulada pelo painel local.');
      if (reason === null) return;
      const response = await fetch('/admin/api/documents/' + id + '/status', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: 'Basic ' + runtimeConfig.adminToken
        },
        body: JSON.stringify({ action: 'rejeitar', code: code, reason: reason })
      });
      setResponse(await response.json());
      await refreshSnapshot();
    }

    async function downloadSignedXml(id) {
      const response = await fetch('/admin/api/documents/' + id + '/xml-signed', {
        headers: { Authorization: 'Basic ' + runtimeConfig.adminToken }
      });
      if (!response.ok) {
        setResponse(await response.text());
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = id + '-assinado.xml';
      link.click();
      URL.revokeObjectURL(url);
    }

    fetchSnapshot().then(render).catch(function(error) {
      document.getElementById('app').innerHTML =
        '<div class="empty">' + escapeHtml(error.message) + '</div>';
    });
  </script>
</body>
</html>`;

function serializeForInlineScript(value: unknown) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export function createAdminHtml(config: AdminPageConfig) {
  return page.replace("__CONFIG__", serializeForInlineScript(config));
}
