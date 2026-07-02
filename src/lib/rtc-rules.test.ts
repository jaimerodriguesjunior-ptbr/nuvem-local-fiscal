import assert from "node:assert/strict";
import test from "node:test";

import { validateRtcPayload } from "./rtc-rules.js";

function rtcPayload() {
  return {
    infNFe: {
      ide: {
        mod: 55,
        cMunFGIBS: 4108809
      },
      det: [
        {
          imposto: {
            IBSCBS: {
              CST: "000",
              cClassTrib: "000001",
              gIBSCBS: {
                vBC: 0
              }
            }
          }
        }
      ],
      total: {
        IBSCBSTot: {
          vBCIBSCBS: 0
        }
      }
    }
  };
}

test("aceita payload sem grupo IBS/CBS porque RTC ainda e opcional na borda", () => {
  const result = validateRtcPayload({
    infNFe: {
      ide: {},
      det: [{ imposto: {} }],
      total: {}
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("aceita grupo IBS/CBS minimo com municipio, classificacao e totais", () => {
  const result = validateRtcPayload(rtcPayload());

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("aceita NFC-e com grupo IBS/CBS sem municipio do fato gerador IBS", () => {
  const payload = rtcPayload();
  payload.infNFe.ide.mod = 65;
  delete (payload.infNFe.ide as Record<string, unknown>).cMunFGIBS;

  const result = validateRtcPayload(payload);

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("bloqueia grupo IBS/CBS quando o modelo nao bate com o endpoint esperado", () => {
  const payload = rtcPayload();
  payload.infNFe.ide.mod = 65;
  delete (payload.infNFe.ide as Record<string, unknown>).cMunFGIBS;

  const result = validateRtcPayload(payload, { expectedModel: 55 });

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === "rtc_model_mismatch"), true);
});

test("bloqueia grupo IBS/CBS em modelo ainda nao validado", () => {
  const payload = rtcPayload();
  payload.infNFe.ide.mod = 57;

  const result = validateRtcPayload(payload);

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === "unsupported_rtc_model"), true);
});

test("bloqueia IBS/CBS em NFC-e quando idDest declara operacao nao interna", () => {
  const payload = rtcPayload();
  payload.infNFe.ide.mod = 65;
  (payload.infNFe.ide as Record<string, unknown>).idDest = 2;
  delete (payload.infNFe.ide as Record<string, unknown>).cMunFGIBS;

  const result = validateRtcPayload(payload, { expectedModel: 65 });

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === "rtc_nfce_not_internal"), true);
});

test("bloqueia cMunFGIBS indevido em NFC-e com grupo IBS/CBS", () => {
  const payload = rtcPayload();
  payload.infNFe.ide.mod = 65;

  const result = validateRtcPayload(payload);

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === "unexpected_rtc_municipality"), true);
});

test("bloqueia grupo IBS/CBS incompleto antes de gerar XML fiscal", () => {
  const payload = rtcPayload();
  delete (payload.infNFe.ide as Record<string, unknown>).cMunFGIBS;
  (payload.infNFe.det[0].imposto as Record<string, unknown>).IBSCBS = {
    CST: "00",
    cClassTrib: "ABC001"
  };
  delete (payload.infNFe.total as Record<string, unknown>).IBSCBSTot;

  const result = validateRtcPayload(payload);

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === "missing_rtc_municipality"), true);
  assert.equal(result.issues.some((issue) => issue.code === "missing_rtc_totals"), true);
  assert.equal(result.issues.some((issue) => issue.code === "invalid_rtc_cst"), true);
  assert.equal(result.issues.some((issue) => issue.code === "invalid_rtc_classification"), true);
  assert.equal(result.issues.some((issue) => issue.code === "missing_rtc_values"), true);
});
