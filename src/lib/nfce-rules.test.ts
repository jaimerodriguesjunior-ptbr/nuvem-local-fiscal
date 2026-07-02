import assert from "node:assert/strict";
import test from "node:test";

import { validateNfceEmissionPayload } from "./nfce-rules.js";

function validNfcePayload(overrides: Record<string, unknown> = {}) {
  const payload = {
    infNFe: {
      versao: "4.00",
      ide: {
        cUF: 41,
        natOp: "VENDA",
        mod: 65,
        serie: 2,
        nNF: 11,
        dhEmi: "2026-07-02T12:16:25-03:00",
        tpNF: 1,
        idDest: 1,
        cMunFG: 4108809,
        tpImp: 4,
        tpEmis: 1,
        tpAmb: 2,
        finNFe: 1,
        indFinal: 1,
        indPres: 1,
        procEmi: 0,
        verProc: "NuvemLocalFiscal"
      },
      emit: {
        CNPJ: "35181069000143",
        xNome: "NORBERTO HITOSHI TAJIRI LTDA",
        IE: "9118818536",
        CRT: 1
      },
      det: [
        {
          nItem: 1,
          prod: {
            cProd: "1",
            cEAN: "SEM GTIN",
            xProd: "Produto teste",
            NCM: "00000000",
            CFOP: "5102",
            uCom: "UN",
            qCom: 1,
            vUnCom: 30,
            vProd: 30,
            cEANTrib: "SEM GTIN",
            uTrib: "UN",
            qTrib: 1,
            vUnTrib: 30,
            indTot: 1
          },
          imposto: {
            ICMS: { ICMSSN102: { orig: 0, CSOSN: "102" } },
            PIS: { PISOutr: { CST: "99", vBC: 0, pPIS: 0, vPIS: 0 } },
            COFINS: { COFINSOutr: { CST: "99", vBC: 0, pCOFINS: 0, vCOFINS: 0 } }
          }
        }
      ],
      total: {
        ICMSTot: {
          vNF: 30
        }
      },
      pag: {
        detPag: [{ tPag: "01", vPag: 30 }]
      }
    }
  };
  return {
    ...payload,
    ...overrides
  };
}

test("aceita NFC-e online com payload fiscal minimo", () => {
  const result = validateNfceEmissionPayload(validNfcePayload(), {
    expectedEnvironment: "homologacao",
    expectedIssuerCnpj: "35181069000143"
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("bloqueia NFC-e em contingencia offline ate existir QR Code v3 offline", () => {
  const payload = validNfcePayload();
  (payload.infNFe.ide as Record<string, unknown>).tpEmis = 9;

  const result = validateNfceEmissionPayload(payload, {
    expectedEnvironment: "homologacao",
    expectedIssuerCnpj: "35181069000143"
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === "offline_contingency_not_supported"), true);
});

test("bloqueia CNPJ alfanumerico em NFC-e enquanto o fluxo nao suporta NT 2026.004", () => {
  const payload = validNfcePayload();
  (payload.infNFe.emit as Record<string, unknown>).CNPJ = "12ABC34501DE67";

  const result = validateNfceEmissionPayload(payload, {
    expectedEnvironment: "homologacao",
    expectedIssuerCnpj: "12ABC34501DE67"
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === "cnpj_alpha_not_supported"), true);
});

test("rejeita NFC-e sem total, pagamento e impostos minimos", () => {
  const payload = validNfcePayload();
  delete (payload.infNFe as Record<string, unknown>).total;
  delete (payload.infNFe as Record<string, unknown>).pag;
  delete ((payload.infNFe.det[0] as Record<string, unknown>).imposto as Record<string, unknown>).PIS;

  const result = validateNfceEmissionPayload(payload, {
    expectedEnvironment: "homologacao",
    expectedIssuerCnpj: "35181069000143"
  });

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === "missing_totals"), true);
  assert.equal(result.issues.some((issue) => issue.code === "missing_payment"), true);
  assert.equal(result.issues.some((issue) => issue.code === "missing_item_taxes"), true);
});
