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
    id: "mvp-operational-scope",
    area: "Platform",
    instance: "Todos os clientes Simples Nacional do portfolio atual",
    flow: "Escopo operacional do MVP fiscal deste mes",
    status: "satisfied",
    evidence: [
      "portfolio atual usa NFC-e, NFS-e e algumas NF-e de venda/devolucao",
      "NF-e MVP aceita finNFe=1 e finNFe=4; complemento, ajuste, credito e debito ficam fechados por padrao",
      "NFC-e MVP aceita apenas finNFe=1, mesma UF e emissao online",
      "NFS-e MVP permanece limitado aos provedores municipais cadastrados no motor de regras"
    ],
    nextAction: "Usar este escopo como checklist de piloto controlado por empresa."
  },
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
    id: "nfe-pr-autoeletrica-return-reference",
    area: "NFe",
    instance: "Autoeletrica/NHT / SEFAZ-PR",
    flow: "NF-e devolucao em homologacao com NFref e nota de entrada de apoio",
    status: "satisfied",
    evidence: [
      "NF-e venda homologacao com RTC autorizada como origem do fluxo",
      "tela de devolucao carregou itens a partir da NF-e de entrada temporaria",
      "NF-e devolucao nfe-4.xml autorizada em homologacao",
      "nota de entrada temporaria foi removida do banco apos o teste"
    ],
    nextAction: "Manter o cenario como smoke de devolucao quando o fluxo de entrada for ajustado."
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
      "venda comum de mercadoria com finNFe=1 e CFOP 5101/5102/6101/6102 exige par 000/000001 quando IBSCBS for informado",
      "devolucao NF-e com finNFe=4 e CFOP 5202/6202 possui perfil RTC operacional inicial para par 000/000001",
      "finalidades referenciadas 2/3/5/6 bloqueiam IBSCBS ate existir perfil RTC operacional explicito",
      "IS exige CSTIS, cClassTribIS, valores de calculo e ISTot quando informado",
      "a classificacao legal por tipo de operacao e a tabela oficial de IS ainda dependem da fonte vigente e dos dados do cliente"
    ],
    nextAction: "Carregar fonte oficial de IS e homologar perfil RTC real somente para fluxos fora do MVP quando houver demanda."
  },
  {
    id: "referenciamento-nfe-nfce",
    area: "Platform",
    instance: "Todos os clientes",
    flow: "NF-e/NFC-e com documentos referenciados",
    status: "satisfied",
    evidence: [
      "checklist regulatorio exige devolucao, complemento, ajuste e vinculacao entre documentos",
      "validacao compartilhada exige NFref para finalidades 2, 3, 4, 5 e 6",
      "contrato automatizado valida chave referenciada, ECF e formatos basicos de NF antiga/produtor",
      "POST /nfe bloqueia finalidade referenciada sem NFref antes de criar documento",
      "contrato automatizado aceita devolucao com NFref valido e IBSCBS no perfil RTC do MVP",
      "contrato automatizado mantem complemento e ajuste fora do MVP quando o payload traz IBSCBS",
      "NF-e devolucao da Autoeletrica foi homologada com NFref na nfe-4.xml e com RTC na nfe-8.xml",
      "NF-e venda por Outra operacao da Autoeletrica foi homologada com RTC na nfe-10.xml",
      "NF-e devolucao por Outra operacao da Autoeletrica foi homologada com NFref e RTC na nfe-12.xml",
      "NF-e complemento da Autoeletrica foi homologada com NFref na nfe-5.xml",
      "NF-e ajuste da Autoeletrica foi homologada com NFref na nfe-7.xml"
    ],
    nextAction: "Manter venda e devolucao como smoke do MVP; complemento e ajuste ficam como historico para abrir somente sob demanda."
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
      "nfse-5.xml retornou nrNfse=5, cdAutenticacao e dtEmissaoNfs em 2026-07-03",
      "guardas locais para idEntidade, data futura e lote/RPS",
      "testes cobrem regras do conector Equiplano"
    ],
    nextAction: "Manter smoke municipal antes de release que toque NFS-e."
  },
  {
    id: "nfse-guaira-ipm-consulta-cancelamento",
    area: "NFSe",
    instance: "Guaira / IPM",
    flow: "NFS-e Guaira/IPM no MVP com emissao, link municipal consultavel e cancelamento",
    status: "blocks_production",
    evidence: [
      "emissao Guaira/IPM homologada com XML/PDF local",
      "consulta por autenticidade e fallback por numero foram implementados",
      "nfse-15.xml retornou numero_nfse=203, situacao Emitida, link_nfse e cod_verificador_autenticidade em 2026-07-03",
      "XML de cancelamento Guaira/IPM e parser de sucesso possuem contrato automatizado",
      "cancelamento Guaira/IPM fica aberto no MVP, mas ainda precisa de uma evidencia real em homologacao"
    ],
    nextAction: "Cancelar em homologacao a NFS-e Guaira numero 203 ou outra NFS-e de teste autorizada e registrar o retorno municipal."
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
