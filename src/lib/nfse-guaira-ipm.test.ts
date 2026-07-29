import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGuairaIpmBasicAuthorization,
  buildGuairaIpmCancellationXml,
  buildGuairaIpmConsultationXml,
  buildGuairaIpmEmissionXml,
  buildGuairaIpmMultipartRequest,
  buildGuairaIpmNumberConsultationXml,
  extractGuairaIpmSessionCookie,
  isGuairaIpmCancellationConfirmed,
  normalizeGuairaIpmResponseXml,
  normalizeGuairaIpmDraft,
  parseGuairaIpmResponse,
  resolveGuairaIpmConnectionTarget,
  type GuairaIpmConfig
} from "./nfse-guaira-ipm.js";

const config: GuairaIpmConfig = {
  cnpj: "35181069000143",
  endpoint: "",
  tomCode: "7571",
  economicRegistration: "",
  rpsSeries: "1",
  defaultServiceCode: "140101",
  defaultActivityCode: "4520007",
  defaultTaxSituation: "0",
  defaultAliquotaIss: 2.01,
  requiresSignature: false,
  testMode: true,
  autoTransmit: false
};

test("normalizes Nuvem Fiscal DPS and builds IPM test XML", () => {
  const document = {
    providerLikeId: "nfse_test_123",
    payloadOriginal: {
      infDPS: {
        dhEmi: "2026-06-13T10:20:30-03:00",
        prest: { CNPJ: "35181069000143" },
        toma: {
          CPF: "58212043134",
          xNome: "JAIME RODRIGUES JUNIOR",
          fone: "44999999999",
          end: {
            xLgr: "AV MATE LARANJEIRA",
            nro: "424",
            xBairro: "CENTRO",
            endNac: { cMun: "4108809", CEP: "85980000" }
          }
        },
        serv: {
          cServ: {
            cTribNac: "140101",
            cTribMun: "140101",
            CNAE: "4520007",
            cSitTrib: "0",
            xDescServ: "Manutencao eletrica automotiva"
          },
          locPrest: { cLocPrestacao: "4108809" }
        },
        valores: {
          vServPrest: { vServ: 100 },
          trib: {
            tribMun: {
              tpRetISSQN: 1,
              pAliq: 2.01,
              cLocIncid: "4108809"
            }
          }
        }
      }
    }
  };

  const draft = normalizeGuairaIpmDraft(document, config);
  const xml = buildGuairaIpmEmissionXml(config, draft);

  assert.equal(draft.serviceCode, "140101");
  assert.match(xml, /<nfse_teste>1<\/nfse_teste>/);
  assert.match(xml, /<data_fato_gerador>13\/06\/2026<\/data_fato_gerador>/);
  assert.match(xml, /<cidade>7571<\/cidade>/);
  assert.match(xml, /<codigo_local_prestacao_servico>7571<\/codigo_local_prestacao_servico>/);
  assert.match(xml, /<codigo_item_lista_servico>140101<\/codigo_item_lista_servico>/);
  assert.match(xml, /<codigo_atividade>4520007<\/codigo_atividade>/);
  assert.match(xml, /<aliquota_item_lista_servico>2,01<\/aliquota_item_lista_servico>/);
  assert.match(xml, /<valor_tributavel>100,00<\/valor_tributavel>/);
  assert.doesNotMatch(xml, /<email><\/email>/);
});

test("builds IPM production XML without nfse_teste", () => {
  const document = {
    providerLikeId: "nfse_prod_123",
    payloadOriginal: {
      infDPS: {
        dhEmi: "2026-07-03T14:30:00-03:00",
        prest: { CNPJ: "35181069000143" },
        toma: {
          CPF: "58212043134",
          xNome: "CLIENTE PRODUCAO",
          end: {
            xLgr: "AV MATE LARANJEIRA",
            nro: "100",
            xBairro: "CENTRO",
            endNac: { cMun: "4108809", CEP: "85980000" }
          }
        },
        serv: {
          cServ: {
            cTribMun: "140101",
            CNAE: "4520007",
            cSitTrib: "0",
            xDescServ: "Servico prestado"
          },
          locPrest: { cLocPrestacao: "4108809" }
        },
        valores: {
          vServPrest: { vServ: 15 },
          trib: { tribMun: { pAliq: 2.01, cLocIncid: "4108809" } }
        }
      }
    }
  };
  const productionConfig = { ...config, testMode: false };

  const draft = normalizeGuairaIpmDraft(document, productionConfig);
  const xml = buildGuairaIpmEmissionXml(productionConfig, draft);

  assert.doesNotMatch(xml, /<nfse_teste>1<\/nfse_teste>/);
  assert.match(xml, /<valor_total>15,00<\/valor_total>/);
  assert.match(xml, /<codigo_item_lista_servico>140101<\/codigo_item_lista_servico>/);
});

test("keeps Autoeletrica fallback address from becoming a local blocker", () => {
  const document = {
    providerLikeId: "nfse_fallback_address",
    payloadOriginal: {
      infDPS: {
        dhEmi: "2026-06-13T10:20:30-03:00",
        toma: {
          CPF: "58212043134",
          xNome: "CLIENTE BALCAO",
          end: {}
        },
        serv: {
          cServ: {
            cTribMun: "140101",
            CNAE: "4520007",
            cSitTrib: "0",
            xDescServ: "Manutencao eletrica automotiva"
          },
          locPrest: { cLocPrestacao: "4108809" }
        },
        valores: {
          vServPrest: { vServ: 80 },
          trib: { tribMun: { pAliq: 2.01, cLocIncid: "4108809" } }
        }
      }
    }
  };

  const draft = normalizeGuairaIpmDraft(document, config);
  const xml = buildGuairaIpmEmissionXml(config, draft);

  assert.equal(draft.customerStreet, "Nao Informado");
  assert.equal(draft.customerNumber, "SN");
  assert.equal(draft.customerDistrict, "Centro");
  assert.equal(draft.customerCityCode, "7571");
  assert.equal(draft.customerPostalCode, "85980000");
  assert.match(xml, /<logradouro>Nao Informado<\/logradouro>/);
  assert.match(xml, /<numero_residencia>SN<\/numero_residencia>/);
  assert.match(xml, /<bairro>Centro<\/bairro>/);
  assert.match(xml, /<cidade>7571<\/cidade>/);
  assert.match(xml, /<cep>85980000<\/cep>/);
});

test("omits customer address when the DPS does not provide toma.end", () => {
  const document = {
    providerLikeId: "nfse_registered_customer",
    payloadOriginal: {
      infDPS: {
        dhEmi: "2026-07-02T09:50:27-03:00",
        toma: {
          CNPJ: "26772366000172",
          xNome: "LEANDRO CAR PRIME"
        },
        serv: {
          cServ: {
            cTribMun: "140101",
            CNAE: "4520007",
            cSitTrib: "0",
            xDescServ: "Servico prestado"
          },
          locPrest: { cLocPrestacao: "4108809" }
        },
        valores: {
          vServPrest: { vServ: 70 },
          trib: { tribMun: { pAliq: 2.01, cLocIncid: "4108809" } }
        }
      }
    }
  };

  const draft = normalizeGuairaIpmDraft(document, config);
  const xml = buildGuairaIpmEmissionXml(config, draft);

  assert.equal(draft.customerAddressInformed, false);
  assert.match(xml, /<endereco_informado>N<\/endereco_informado>/);
  assert.doesNotMatch(xml, /<logradouro>/);
  assert.doesNotMatch(xml, /<numero_residencia>/);
  assert.doesNotMatch(xml, /<bairro>/);
  assert.doesNotMatch(xml, /<cep>/);
});

test("can force an IPM emission XML without customer address", () => {
  const document = {
    providerLikeId: "nfse_retry_without_address",
    payloadOriginal: {
      infDPS: {
        dhEmi: "2026-07-02T09:50:27-03:00",
        toma: {
          CNPJ: "26772366000172",
          xNome: "LEANDRO CAR PRIME",
          end: {
            xLgr: "AV MARTIN LUTHER KING",
            nro: "457",
            xBairro: "JD GUAIRA",
            endNac: { cMun: "4108809", CEP: "85980113" }
          }
        },
        serv: {
          cServ: {
            cTribMun: "140101",
            CNAE: "4520007",
            cSitTrib: "0",
            xDescServ: "Servico prestado"
          },
          locPrest: { cLocPrestacao: "4108809" }
        },
        valores: {
          vServPrest: { vServ: 70 },
          trib: { tribMun: { pAliq: 2.01, cLocIncid: "4108809" } }
        }
      }
    }
  };

  const draft = normalizeGuairaIpmDraft(document, config);
  const xml = buildGuairaIpmEmissionXml(config, draft, {
    includeCustomerAddress: false
  });

  assert.equal(draft.customerAddressInformed, true);
  assert.match(xml, /<endereco_informado>N<\/endereco_informado>/);
  assert.doesNotMatch(xml, /<logradouro>AV MARTIN LUTHER KING<\/logradouro>/);
});

test("parses a successful reduced IPM response", () => {
  const result = parseGuairaIpmResponse(`<?xml version="1.0"?>
    <retorno>
      <mensagem><codigo>[1] Sucesso.</codigo></mensagem>
      <nfse>
        <numero_nfse>158</numero_nfse>
        <serie_nfse>1</serie_nfse>
        <situacao_codigo_nfse>1</situacao_codigo_nfse>
        <situacao_descricao_nfse>Emitida</situacao_descricao_nfse>
        <link_nfse>https://guaira.atende.net/nfse/158.pdf</link_nfse>
        <cod_verificador_autenticidade>ABC123</cod_verificador_autenticidade>
      </nfse>
    </retorno>`);

  assert.equal(result.success, true);
  assert.equal(result.number, "158");
  assert.equal(result.verificationCode, "ABC123");
  assert.equal(result.messages[0]?.codigo, "1");
});

test("builds an IPM consultation by 40-character authenticity code", () => {
  const xml = buildGuairaIpmConsultationXml(
    "7571130626163527010351810692026067397875"
  );

  assert.match(xml, /<nfse>/);
  assert.match(xml, /<pesquisa>/);
  assert.match(
    xml,
    /<codigo_autenticidade>7571130626163527010351810692026067397875<\/codigo_autenticidade>/
  );
  assert.throws(
    () => buildGuairaIpmConsultationXml("184"),
    /Codigo de autenticidade IPM invalido/
  );
});

test("builds an IPM consultation by number, series and economic registration", () => {
  const xml = buildGuairaIpmNumberConsultationXml("184", "1", "324743");

  assert.match(xml, /<numero>184<\/numero>/);
  assert.match(xml, /<serie_nfse>1<\/serie_nfse>/);
  assert.match(xml, /<cadastro>324743<\/cadastro>/);
  assert.throws(
    () => buildGuairaIpmNumberConsultationXml("184", "12", "324743"),
    /cadastro economico IPM invalidos/
  );
});

test("builds Guaira IPM cancellation XML", () => {
  const xml = buildGuairaIpmCancellationXml({
    cnpj: "35181069000143",
    tomCode: "7571",
    number: "184",
    series: "1",
    reason: "Cancelamento de teste de homologacao."
  });

  assert.match(xml, /<numero>184<\/numero>/);
  assert.match(xml, /<serie_nfse>1<\/serie_nfse>/);
  assert.match(xml, /<situacao>C<\/situacao>/);
  assert.match(xml, /<observacao>Cancelamento de teste de homologacao\.<\/observacao>/);
  assert.match(xml, /<cpfcnpj>35181069000143<\/cpfcnpj>/);
  assert.match(xml, /<cidade>7571<\/cidade>/);
});

test("parses Guaira IPM cancellation success response", () => {
  const result = parseGuairaIpmResponse(`<?xml version="1.0" encoding="ISO-8859-1"?>
    <retorno>
      <mensagem>
        <codigo>01</codigo>
        <descricao>Sucesso.</descricao>
      </mensagem>
    </retorno>`);

  assert.deepEqual(result.messages, [
    { codigo: "1", descricao: "Sucesso." }
  ]);
});

test("normalizes an IPM cancellation response with duplicate XML declaration", () => {
  const result = parseGuairaIpmResponse(
    "\uFEFF\n<?xml version=\"1.0\"?><retorno><?xml version=\"1.0\"?><mensagem><codigo>117</codigo><descricao>A NFSe ja encontra-se cancelada</descricao></mensagem></retorno>"
  );

  assert.doesNotMatch(normalizeGuairaIpmResponseXml("\uFEFF\n<?xml version=\"1.0\"?><retorno><?xml version=\"1.0\"?></retorno>"), /<retorno><\?xml/);
  assert.equal(isGuairaIpmCancellationConfirmed(result), true);
});

test("accepts Guaira IPM issued response without a numeric message prefix", () => {
  const result = parseGuairaIpmResponse(`<?xml version="1.0" encoding="ISO-8859-1"?>
    <retorno>
      <mensagem><codigo>NFS-e válida para emissão.</codigo></mensagem>
      <numero_nfse>184</numero_nfse>
      <serie_nfse>1</serie_nfse>
      <situacao_codigo_nfse>1</situacao_codigo_nfse>
      <situacao_descricao_nfse>Emitida</situacao_descricao_nfse>
      <cod_verificador_autenticidade>PROTOCOLO184</cod_verificador_autenticidade>
    </retorno>`);

  assert.equal(result.success, true);
  assert.equal(result.number, "184");
  assert.equal(result.statusCode, "1");
  assert.equal(result.messages[0]?.codigo, "IPM");
});

test("does not authorize an IPM error response", () => {
  const result = parseGuairaIpmResponse(
    "<retorno><mensagem><codigo>[129] Aliquota divergente.</codigo></mensagem></retorno>"
  );

  assert.equal(result.success, false);
  assert.equal(result.messages[0]?.codigo, "129");
});

test("builds IPM Basic Auth, multipart body and reusable session cookie", () => {
  const authorization = buildGuairaIpmBasicAuthorization(
    "35181069000143",
    "senha-teste"
  );
  const request = buildGuairaIpmMultipartRequest(
    "<nfse><nfse_teste>1</nfse_teste></nfse>",
    "boundary-test"
  );
  const cookie = extractGuairaIpmSessionCookie([
    "other=value; Path=/",
    "PHPSESSID=session123; Path=/; HttpOnly"
  ]);

  assert.equal(
    authorization,
    `Basic ${Buffer.from("35181069000143:senha-teste").toString("base64")}`
  );
  assert.equal(request.contentType, "multipart/form-data; boundary=boundary-test");
  assert.equal(request.contentLength, request.body.length);
  assert.match(request.body.toString("utf8"), /name="xml"; filename="nota_envio.xml"/);
  assert.match(request.body.toString("utf8"), /<nfse_teste>1<\/nfse_teste>/);
  assert.equal(cookie, "PHPSESSID=session123");
});

test("resolves optional IPM TCP connection override while preserving endpoint host", () => {
  const url = new URL(
    "https://guaira.atende.net/atende.php?pg=rest&service=WNERestServiceNFSe"
  );

  assert.equal(resolveGuairaIpmConnectionTarget(url), null);
  assert.deepEqual(
    resolveGuairaIpmConnectionTarget(url, "127.0.0.1", "9443"),
    { hostname: "127.0.0.1", port: 9443 }
  );
  assert.deepEqual(resolveGuairaIpmConnectionTarget(url, "10.0.0.5", ""), {
    hostname: "10.0.0.5",
    port: 443
  });
  assert.throws(
    () => resolveGuairaIpmConnectionTarget(url, "127.0.0.1", "99999"),
    /Porta alternativa IPM invalida/
  );
});
