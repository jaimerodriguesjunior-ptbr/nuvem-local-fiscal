export type HomologationArea = "NFe" | "NFCe" | "NFSe" | "Platform";

export type HomologationGateStatus =
  | "satisfied"
  | "scoped_block"
  | "blocks_production";

export type HomologationMatrixItem = {
  id: string;
  area: HomologationArea;
  instance: string;
  flow: string;
  status: HomologationGateStatus;
  evidence: string[];
  nextAction: string;
};

export const homologationMatrix: HomologationMatrixItem[] = [
  {
    id: "nfe-pr-otica-controlled-emission",
    area: "NFe",
    instance: "Otica Prisma / SEFAZ-PR",
    flow: "NF-e homologacao com XML assinado, XSD, autorizacao, DANFE A4 e cancelamento",
    status: "satisfied",
    evidence: [
      "NF-e homologacao autorizada com cStat 100",
      "cancelamento NF-e homologacao validado com evento 110111",
      "regressao HTTP cobre emissao, assinatura, PDF/XML e cancelamento"
    ],
    nextAction: "Manter regressao e repetir smoke por instancia antes de qualquer release."
  },
  {
    id: "nfce-pr-same-uf-controlled-emission",
    area: "NFCe",
    instance: "Otica Prisma + Autoeletrica / SEFAZ-PR",
    flow: "NFC-e homologacao para operacao interna, QR Code online e autorizacao",
    status: "satisfied",
    evidence: [
      "NFC-e Otica Prisma homologacao ponta a ponta",
      "NFC-e Autoeletrica homologacao autorizada em operacao mesma UF",
      "contrato HTTP cobre criacao, assinatura, PDF/XML e consulta"
    ],
    nextAction: "Repetir smoke por cliente sempre que regra fiscal compartilhada mudar."
  },
  {
    id: "nfce-pr-interstate-guard",
    area: "NFCe",
    instance: "Todos os clientes SEFAZ-PR",
    flow: "Bloqueio de NFC-e interestadual antes de criar documento",
    status: "satisfied",
    evidence: [
      "POST /nfce rejeita UF diferente e idDest nao interno",
      "assinatura admin e processamento automatico reutilizam a mesma regra",
      "teste garante que documento nao e criado quando a regra bloqueia"
    ],
    nextAction: "Manter regra no emissor compartilhado, nao nos clientes."
  },
  {
    id: "nfce-offline-contingency-scope",
    area: "NFCe",
    instance: "Todos os clientes SEFAZ-PR",
    flow: "Contingencia offline NFC-e",
    status: "scoped_block",
    evidence: [
      "tpEmis=9 bloqueado no validador NFC-e",
      "QR Code v3 offline reconhecido como fluxo diferente do online",
      "decisao documentada de nao operar contingencia offline no escopo inicial"
    ],
    nextAction: "Implementar e homologar QR Code v3 offline somente se o escopo mudar."
  },
  {
    id: "nfe-danfe-print-type-scope",
    area: "NFe",
    instance: "Todos os clientes SEFAZ-PR",
    flow: "Tipos de impressao NF-e fora de DANFE A4 retrato",
    status: "scoped_block",
    evidence: [
      "NF-e local aceita somente tpImp=1",
      "POST /nfe, assinatura admin e processamento automatico rejeitam tpImp diferente de 1",
      "teste HTTP garante bloqueio antes de criar documento"
    ],
    nextAction: "Implementar layout proprio antes de aceitar paisagem, simplificado ou sem DANFE."
  },
  {
    id: "rt-classification-contract",
    area: "Platform",
    instance: "Todos os clientes",
    flow: "Classificacao tributaria RTC completa para IBS/CBS/IS",
    status: "blocks_production",
    evidence: [
      "validacao atual bloqueia grupos IBSCBS incompletos e IS incompleto",
      "catalogo RTC local exige que pares CST/cClassTrib e CSTIS/cClassTribIS estejam versionados antes de aceitar payload",
      "catalogo IBS/CBS carrega as classificacoes oficiais exportadas da SVRS/CFF em 2026-07-02",
      "IBSCBS regular exige CST, cClassTrib, IBS UF, IBS municipio, CBS, bases e totais",
      "IBSCBS monofasico e tratado como grupo proprio para CST 620",
      "IS exige CSTIS, cClassTribIS, valores de calculo e ISTot quando informado",
      "a classificacao legal por tipo de operacao e a tabela oficial de IS ainda dependem da fonte vigente e dos dados do cliente"
    ],
    nextAction: "Conciliar tipos de operacao dos clientes com CST/cClassTrib vigente e carregar fonte oficial de IS."
  },
  {
    id: "referenciamento-nfe-nfce",
    area: "Platform",
    instance: "Todos os clientes",
    flow: "NF-e/NFC-e com documentos referenciados",
    status: "blocks_production",
    evidence: [
      "checklist regulatorio exige devolucao, complemento, ajuste e vinculacao entre documentos",
      "validacao compartilhada exige NFref para finalidades 2, 3, 4, 5 e 6",
      "contrato automatizado valida chave referenciada, ECF e formatos basicos de NF antiga/produtor",
      "POST /nfe bloqueia finalidade referenciada sem NFref antes de criar documento"
    ],
    nextAction: "Homologar cenario real de devolucao/complemento/ajuste com cliente antes de producao."
  },
  {
    id: "retry-queue-distributed-processing",
    area: "Platform",
    instance: "VPS + Supabase",
    flow: "Retries agendados e processamento distribuido",
    status: "blocks_production",
    evidence: [
      "processamento atual possui trava local por documento",
      "eventos fiscais registram historico persistente",
      "falhas externas incertas agora recebem plano de retry com backoff e limite",
      "rejeicoes fiscais e falhas deterministicas nao entram em retry automatico",
      "fila agendada e concorrencia distribuida entre instancias seguem abertas"
    ],
    nextAction: "Fechar worker agendado com lock distribuido e smoke multi-instancia antes de producao."
  },
  {
    id: "nfse-toledo-equiplano",
    area: "NFSe",
    instance: "Toledo / Equiplano",
    flow: "NFS-e homologacao com emissao, consulta, XML, PDF e cancelamento",
    status: "satisfied",
    evidence: [
      "fluxo Toledo/Equiplano homologado ponta a ponta",
      "guardas locais para idEntidade, data futura e lote/RPS",
      "testes cobrem regras do conector Equiplano"
    ],
    nextAction: "Manter smoke municipal antes de release que toque NFS-e."
  },
  {
    id: "nfse-guaira-ipm-consulta-cancelamento",
    area: "NFSe",
    instance: "Guaira / IPM",
    flow: "NFS-e Guaira com consulta persistente e cancelamento em cenario municipal reconhecido",
    status: "blocks_production",
    evidence: [
      "emissao Guaira/IPM homologada com XML/PDF local",
      "consulta por autenticidade e fallback por numero foram implementados",
      "documentos nfse_teste=1 ainda nao validam consulta ponta a ponta na base IPM"
    ],
    nextAction: "Confirmar com IPM/Prefeitura um documento consultavel/cancelavel e repetir smoke."
  }
];

export function productionBlockingItems(items = homologationMatrix) {
  return items.filter((item) => item.status === "blocks_production");
}

export function scopedBlockedItems(items = homologationMatrix) {
  return items.filter((item) => item.status === "scoped_block");
}

export function homologationGateSummary(items = homologationMatrix) {
  const blockers = productionBlockingItems(items);
  return {
    productionReady: blockers.length === 0,
    total: items.length,
    satisfied: items.filter((item) => item.status === "satisfied").length,
    scopedBlocked: scopedBlockedItems(items).length,
    blocking: blockers.length,
    blockingIds: blockers.map((item) => item.id)
  };
}
