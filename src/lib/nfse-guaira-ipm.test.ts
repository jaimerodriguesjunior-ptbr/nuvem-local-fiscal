import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGuairaIpmBasicAuthorization,
  buildGuairaIpmEmissionXml,
  buildGuairaIpmMultipartRequest,
  extractGuairaIpmSessionCookie,
  normalizeGuairaIpmDraft,
  parseGuairaIpmResponse,
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
