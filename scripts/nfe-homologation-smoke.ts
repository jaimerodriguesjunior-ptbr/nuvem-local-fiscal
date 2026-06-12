process.env.AUTO_TRANSMIT_HOMOLOGATION = "false";

const issuerCnpj = "01997929000108";

function isoNowSaoPaulo() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  return `${formatter.format(now).replace(" ", "T")}-03:00`;
}

function nextHomologationNumber(app: ReturnType<typeof buildApp>) {
  const used = app.store.documents
    .filter(
      (document) =>
        document.tipoDocumento === "NFe" &&
        document.issuerCnpj === issuerCnpj &&
        document.ambiente === "homologacao"
    )
    .map((document) => {
      const payload = document.payloadOriginal as
        | { infNFe?: { ide?: { nNF?: unknown } } }
        | undefined;
      return Number(payload?.infNFe?.ide?.nNF ?? document.numero);
    })
    .filter((number) => Number.isInteger(number) && number > 0);
  return Math.max(9002, ...used) + 1;
}

function buildPayload(
  nNF: number,
  serie: number,
  responsibleTechnical: {
    cnpj: string;
    contact: string;
    email: string;
    phone: string;
  }
) {
  return {
    ambiente: "homologacao",
    infNFe: {
      versao: "4.00",
      ide: {
        cUF: 41,
        natOp: "VENDA DE MERCADORIA",
        mod: 55,
        serie,
        nNF,
        dhEmi: isoNowSaoPaulo(),
        tpNF: 1,
        idDest: 1,
        cMunFG: 4108809,
        tpImp: 1,
        tpEmis: 1,
        tpAmb: 2,
        finNFe: 1,
        indFinal: 1,
        indPres: 1,
        procEmi: 0,
        verProc: "NuvemLocalFiscal"
      },
      emit: {
        CNPJ: issuerCnpj,
        xNome: "FORSTER E FORSTER LTDA",
        xFant: "Otica Prisma Guaira",
        enderEmit: {
          xLgr: "Av. Mate Laranjeira",
          nro: "424",
          xBairro: "Centro",
          cMun: 4108809,
          xMun: "Guaira",
          UF: "PR",
          CEP: "85980046",
          cPais: "1058",
          xPais: "BRASIL"
        },
        IE: "9013681047",
        CRT: 1
      },
      dest: {
        CPF: "12345678909",
        xNome: "Cliente Teste Homologacao",
        enderDest: {
          xLgr: "Rua Teste",
          nro: "100",
          xBairro: "Centro",
          cMun: 4108809,
          xMun: "Guaira",
          UF: "PR",
          CEP: "85980000",
          cPais: "1058",
          xPais: "BRASIL"
        },
        indIEDest: 9
      },
      det: [
        {
          nItem: 1,
          prod: {
            cProd: "9383",
            cEAN: "SEM GTIN",
            xProd: "Produto NF-e Homologacao",
            NCM: "00000000",
            CFOP: "5102",
            uCom: "UN",
            qCom: 1,
            vUnCom: 270,
            vProd: 270,
            cEANTrib: "SEM GTIN",
            uTrib: "UN",
            qTrib: 1,
            vUnTrib: 270,
            indTot: 1
          },
          imposto: {
            ICMS: {
              ICMSSN102: { orig: 0, CSOSN: "102" }
            },
            PIS: {
              PISOutr: { CST: "99", vBC: 0, pPIS: 0, vPIS: 0 }
            },
            COFINS: {
              COFINSOutr: { CST: "99", vBC: 0, pCOFINS: 0, vCOFINS: 0 }
            }
          }
        }
      ],
      total: {
        ICMSTot: {
          vBC: 0,
          vICMS: 0,
          vICMSDeson: 0,
          vFCP: 0,
          vBCST: 0,
          vST: 0,
          vFCPST: 0,
          vFCPSTRet: 0,
          vProd: 270,
          vFrete: 0,
          vSeg: 0,
          vDesc: 0,
          vII: 0,
          vIPI: 0,
          vIPIDevol: 0,
          vPIS: 0,
          vCOFINS: 0,
          vOutro: 0,
          vNF: 270
        }
      },
      transp: { modFrete: 9 },
      pag: { detPag: [{ tPag: "01", vPag: 270 }] },
      infRespTec: {
        CNPJ: responsibleTechnical.cnpj,
        xContato: responsibleTechnical.contact,
        email: responsibleTechnical.email,
        fone: responsibleTechnical.phone
      }
    }
  };
}

async function main() {
  const { buildApp } = await import("../src/app.js");
  const { config } = await import("../src/config.js");
  const adminAuthorization = `Basic ${Buffer.from(
    `${config.adminUsername}:${config.adminPassword}`
  ).toString("base64")}`;

  const app = buildApp();
  await app.ready();

  try {
    const issuer = app.store.findIssuerByCnpj(issuerCnpj, "homologacao");
    const certificate = app.store.findActiveCertificate(issuerCnpj);
    if (!issuer) {
      throw new Error(`Emitente ${issuerCnpj} nao encontrado em homologacao.`);
    }
    if (!certificate?.encryptedBundle) {
      throw new Error(`Certificado A1 ativo nao encontrado para ${issuerCnpj}.`);
    }

    const tokenResponse = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.defaultClientId,
        client_secret: config.defaultClientSecret,
        scope: "empresa nfe nfce"
      }).toString()
    });
    if (tokenResponse.statusCode !== 200) {
      throw new Error(`Falha no OAuth local: ${tokenResponse.body}`);
    }

    const nNF = nextHomologationNumber(app);
    const emissionResponse = await app.inject({
      method: "POST",
      url: "/nfe",
      headers: {
        authorization: `Bearer ${tokenResponse.json().access_token}`,
        "content-type": "application/json"
      },
      payload: buildPayload(nNF, issuer.serieNfe, {
        cnpj: config.nfeResponsibleTechnicalCnpj || "65667543000102",
        contact: config.nfeResponsibleTechnicalContact || "Responsavel Tecnico",
        email: config.nfeResponsibleTechnicalEmail || "fiscal@example.com",
        phone: config.nfeResponsibleTechnicalPhone || "44999261487"
      })
    });
    if (emissionResponse.statusCode !== 202) {
      throw new Error(`Falha ao criar NF-e: ${emissionResponse.body}`);
    }

    const id = emissionResponse.json().id as string;
    const signResponse = await app.inject({
      method: "POST",
      url: `/admin/api/documents/${id}/sign`,
      headers: { authorization: adminAuthorization }
    });
    if (signResponse.statusCode !== 200) {
      throw new Error(`Falha ao assinar NF-e ${id}: ${signResponse.body}`);
    }

    const previewResponse = await app.inject({
      method: "POST",
      url: `/admin/api/documents/${id}/sefaz-preview`,
      headers: { authorization: adminAuthorization }
    });

    const sign = signResponse.json();
    const preview = previewResponse.json();
    console.log(
      JSON.stringify(
        {
          message: "NF-e homologacao preparada sem transmissao.",
          id,
          cnpj: issuerCnpj,
          serie: issuer.serieNfe,
          numero_xml: nNF,
          chave: sign.chave,
          assinatura_valida: sign.assinatura_valida,
          xml_xsd_valido: sign.xsd_valido,
          lote_xsd_valido: preview.xsd_valido,
          id_lote: preview.id_lote,
          tamanho_lote_bytes: preview.tamanho_bytes,
          erros_xsd: [...(sign.erros_xsd ?? []), ...(preview.erros_xsd ?? [])]
        },
        null,
        2
      )
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
