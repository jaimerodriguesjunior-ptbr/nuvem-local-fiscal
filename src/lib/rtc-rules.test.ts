import assert from "node:assert/strict";
import test from "node:test";

import {
  findRtcClassification,
  rtcClassificationCatalogSummary
} from "./rtc-classification-catalog.js";
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
          prod: {
            CFOP: "5102"
          },
          imposto: {
            IBSCBS: {
              CST: "000",
              cClassTrib: "000001",
              gIBSCBS: {
                vBC: 0,
                gIBSUF: {
                  pIBSUF: 0,
                  vIBSUF: 0
                },
                gIBSMun: {
                  pIBSMun: 0,
                  vIBSMun: 0
                },
                vIBS: 0,
                gCBS: {
                  pCBS: 0,
                  vCBS: 0
                }
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

test("concilia venda comum com classificacao tributada integralmente", () => {
  const payload = rtcPayload();

  const result = validateRtcPayload(payload);

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("catalogo RTC carrega classificacoes oficiais IBS/CBS exportadas da SVRS/CFF", () => {
  const summary = rtcClassificationCatalogSummary();

  assert.equal(summary.officialCatalogEntries, 161);
  assert.equal(summary.structuralSmokeEntries, 1);
  assert.equal(summary.total, 162);

  const classification = findRtcClassification("ibscbs", "620", "620001");
  assert.equal(classification?.evidenceStatus, "official_catalog");
  assert.deepEqual(classification?.models, [55]);
  assert.equal(classification?.valueGroup, "monophasic");
  assert.equal(findRtcClassification("ibscbs", "220", "220001"), undefined);
});

test("bloqueia par CST/cClassTrib IBS/CBS fora do catalogo local", () => {
  const payload = rtcPayload();
  payload.infNFe.det[0].imposto.IBSCBS.cClassTrib = "000999";

  const result = validateRtcPayload(payload);

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === "unknown_rtc_classification"), true);
});

test("bloqueia classificacao oficial que nao esta liberada para NF-e/NFC-e", () => {
  const payload = rtcPayload();
  payload.infNFe.det[0].imposto.IBSCBS.CST = "550";
  payload.infNFe.det[0].imposto.IBSCBS.cClassTrib = "550002";

  const result = validateRtcPayload(payload);

  assert.equal(result.ok, false);
  assert.equal(
    result.issues.some((issue) => issue.code === "rtc_classification_model_not_allowed"),
    true
  );
});

test("bloqueia venda comum com classificacao oficial divergente do perfil operacional", () => {
  const payload = rtcPayload();
  payload.infNFe.det[0].imposto.IBSCBS.CST = "200";
  payload.infNFe.det[0].imposto.IBSCBS.cClassTrib = "200002";

  const result = validateRtcPayload(payload);

  assert.equal(result.ok, false);
  assert.equal(
    result.issues.some((issue) => issue.code === "rtc_operation_classification_mismatch"),
    true
  );
});

test("aceita IBSCBS em NF-e de devolucao com perfil operacional RTC", () => {
  const payload = rtcPayload();
  (payload.infNFe.ide as Record<string, unknown>).finNFe = 4;
  (payload.infNFe.ide as Record<string, unknown>).NFref = [
    { refNFe: "41260612345678000195550010000001231000001234" }
  ];
  payload.infNFe.det[0].prod.CFOP = "5202";

  const result = validateRtcPayload(payload);

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("bloqueia IBSCBS em finalidade referenciada sem perfil operacional RTC", () => {
  for (const finality of [2, 3]) {
    const payload = rtcPayload();
    (payload.infNFe.ide as Record<string, unknown>).finNFe = finality;
    (payload.infNFe.ide as Record<string, unknown>).NFref = [
      { refNFe: "41260612345678000195550010000001231000001234" }
    ];
    payload.infNFe.det[0].prod.CFOP = "5102";

    const result = validateRtcPayload(payload);

    assert.equal(result.ok, false);
    assert.equal(
      result.issues.some((issue) => issue.code === "rtc_referenced_finality_not_mapped"),
      true
    );
  }
});

test("nao aplica perfil RTC de operacao referenciada quando o payload nao traz IBSCBS", () => {
  for (const finality of [2, 3, 4]) {
    const result = validateRtcPayload({
      infNFe: {
        ide: {
          mod: 55,
          finNFe: finality,
          NFref: [{ refNFe: "41260612345678000195550010000001231000001234" }]
        },
        det: [
          {
            prod: {
              CFOP: finality === 4 ? "5202" : "5102"
            },
            imposto: {}
          }
        ],
        total: {}
      }
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.issues, []);
  }
});

test("bloqueia grupo monofasico quando o catalogo exige IBS/CBS regular", () => {
  const payload = rtcPayload();
  delete (payload.infNFe.det[0].imposto.IBSCBS as Record<string, unknown>).gIBSCBS;
  (payload.infNFe.det[0].imposto.IBSCBS as Record<string, unknown>).gIBSCBSMono = {
    qBCMono: 1,
    adRemIBS: 0,
    adRemCBS: 0,
    vIBSMono: 0,
    vCBSMono: 0
  };

  const result = validateRtcPayload(payload);

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === "rtc_value_group_mismatch"), true);
});

test("aceita grupo monofasico quando o CST/cClassTrib oficial exige monofasia", () => {
  const payload = rtcPayload();
  payload.infNFe.det[0].prod.CFOP = "5656";
  payload.infNFe.det[0].imposto.IBSCBS.CST = "620";
  payload.infNFe.det[0].imposto.IBSCBS.cClassTrib = "620001";
  delete (payload.infNFe.det[0].imposto.IBSCBS as Record<string, unknown>).gIBSCBS;
  (payload.infNFe.det[0].imposto.IBSCBS as Record<string, unknown>).gIBSCBSMono = {
    qBCMono: 1,
    adRemIBS: 0,
    adRemCBS: 0,
    vIBSMono: 0,
    vCBSMono: 0
  };

  const result = validateRtcPayload(payload);

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

test("bloqueia IBS/CBS regular sem aliquotas e valores de IBS UF, IBS municipio e CBS", () => {
  const payload = rtcPayload();
  (payload.infNFe.det[0].imposto.IBSCBS as Record<string, unknown>).gIBSCBS = {
    vBC: 0
  };

  const result = validateRtcPayload(payload);

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === "missing_rtc_ibs_uf"), true);
  assert.equal(
    result.issues.some((issue) => issue.code === "missing_rtc_ibs_municipality"),
    true
  );
  assert.equal(result.issues.some((issue) => issue.code === "missing_rtc_ibs_value"), true);
  assert.equal(result.issues.some((issue) => issue.code === "missing_rtc_cbs"), true);
});

test("aceita Imposto Seletivo com classificacao, valores e total", () => {
  const payload = {
    infNFe: {
      ide: {
        mod: 55
      },
      det: [
        {
          imposto: {
            IS: {
              CSTIS: "000",
              cClassTribIS: "000001",
              vBCIS: 0,
              pIS: 0,
              vIS: 0
            }
          }
        }
      ],
      total: {
        ISTot: {
          vIS: 0
        }
      }
    }
  };

  const result = validateRtcPayload(payload);

  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test("bloqueia par CSTIS/cClassTribIS fora do catalogo local", () => {
  const payload = {
    infNFe: {
      ide: {
        mod: 55
      },
      det: [
        {
          imposto: {
            IS: {
              CSTIS: "000",
              cClassTribIS: "000999",
              vBCIS: 0,
              pIS: 0,
              vIS: 0
            }
          }
        }
      ],
      total: {
        ISTot: {
          vIS: 0
        }
      }
    }
  };

  const result = validateRtcPayload(payload);

  assert.equal(result.ok, false);
  assert.equal(
    result.issues.some((issue) => issue.code === "unknown_selective_tax_classification"),
    true
  );
});

test("bloqueia Imposto Seletivo sem classificacao, valores e total", () => {
  const payload = {
    infNFe: {
      ide: {
        mod: 55
      },
      det: [
        {
          imposto: {
            IS: {
              CSTIS: "00",
              cClassTribIS: "ABC001",
              vBCIS: 0
            }
          }
        }
      ],
      total: {}
    }
  };

  const result = validateRtcPayload(payload);

  assert.equal(result.ok, false);
  assert.equal(result.issues.some((issue) => issue.code === "invalid_selective_tax_cst"), true);
  assert.equal(
    result.issues.some((issue) => issue.code === "invalid_selective_tax_classification"),
    true
  );
  assert.equal(result.issues.some((issue) => issue.code === "missing_selective_tax_totals"), true);
  assert.equal(result.issues.some((issue) => issue.code === "missing_selective_tax_rate"), true);
  assert.equal(result.issues.some((issue) => issue.code === "missing_selective_tax_value"), true);
});
