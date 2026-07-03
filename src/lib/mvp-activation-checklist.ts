export type MvpFiscalDocument = "nfce" | "nfe" | "nfse";

export type MvpActivationChecklistItem = {
  id: string;
  area: "empresa" | "certificado" | "servico" | "sequencia" | "smoke" | "fallback";
  requiredFor: MvpFiscalDocument[] | ["all"];
  label: string;
};

const commonItems: MvpActivationChecklistItem[] = [
  {
    id: "company-fiscal-registration",
    area: "empresa",
    requiredFor: ["all"],
    label: "Conferir CNPJ, CRT Simples Nacional, IE quando aplicavel e endereco fiscal da empresa."
  },
  {
    id: "homologation-before-production",
    area: "smoke",
    requiredFor: ["all"],
    label: "Executar primeiro em homologacao o mesmo fluxo que sera liberado para a empresa."
  },
  {
    id: "support-fallback",
    area: "fallback",
    requiredFor: ["all"],
    label:
      "Manter mensagem de suporte para qualquer emissao fora do MVP: venda, devolucao ou NFS-e municipal validada."
  }
];

const documentItems: Record<MvpFiscalDocument, MvpActivationChecklistItem[]> = {
  nfce: [
    {
      id: "nfce-csc",
      area: "servico",
      requiredFor: ["nfce"],
      label: "Conferir CSC, idCSC, serie, ambiente e transmissao online para NFC-e mesma UF."
    },
    {
      id: "nfce-same-uf-smoke",
      area: "smoke",
      requiredFor: ["nfce"],
      label: "Emitir uma NFC-e de venda mesma UF em homologacao e confirmar cStat=100."
    }
  ],
  nfe: [
    {
      id: "nfe-certificate",
      area: "certificado",
      requiredFor: ["nfe"],
      label: "Conferir certificado A1, responsavel tecnico, serie e ambiente da NF-e."
    },
    {
      id: "nfe-sale-return-smoke",
      area: "smoke",
      requiredFor: ["nfe"],
      label:
        "Emitir smoke de NF-e venda e devolucao em homologacao, usando apenas CFOPs do MVP ja homologados."
    }
  ],
  nfse: [
    {
      id: "nfse-provider-profile",
      area: "servico",
      requiredFor: ["nfse"],
      label:
        "Conferir provedor municipal suportado, credenciais da prefeitura, inscricao/cadastro municipal e defaults do servico."
    },
    {
      id: "nfse-municipal-smoke",
      area: "smoke",
      requiredFor: ["nfse"],
      label: "Emitir NFS-e em homologacao na praca validada e confirmar XML/PDF/retorno municipal."
    }
  ]
};

export function buildMvpActivationChecklist(
  documents: MvpFiscalDocument[]
): MvpActivationChecklistItem[] {
  const uniqueDocuments = Array.from(new Set(documents));
  return [
    ...commonItems,
    ...uniqueDocuments.flatMap((document) => documentItems[document])
  ];
}
