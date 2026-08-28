import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseXml } from "libxmljs2";
import forge from "node-forge";

import { config } from "../config.js";
import type { DocumentRecord, Issuer, ServiceConfig } from "../types.js";
import { InMemoryStore } from "../store.js";
import { encryptCertificateBundle } from "./certificates.js";
import {
  buildNationalDpsXml,
  buildNationalCancellationEventXml,
  isNationalNfseConfig,
  mapNationalProcessingError,
  NFSE_NATIONAL_NAMESPACE,
  normalizeNationalNfseDraft,
  reconcileNationalDpsWithAuthorizedXml,
  resolveNationalSefinEndpoint,
  resolveNationalNfseConfig,
  transmitPreparedNationalDps,
  validateNationalNfseDraft
} from "./nfse-national.js";
import {
  cancelConfiguredNfse,
  configuredNfseProvider,
  processConfiguredNfse
} from "./nfse-provider.js";
import { parseNationalSefinEventResponse } from "./nfse-national-sefin.js";
import { validateNationalCancellationEventXml } from "./nfse-national-xsd-validator.js";

function createTestPfx(password: string) {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = "02";
  certificate.validity.notBefore = new Date(Date.now() - 60_000);
  certificate.validity.notAfter = new Date(Date.now() + 86_400_000);
  certificate.setSubject([{ name: "commonName", value: "NFS-e Nacional Teste" }]);
  certificate.setIssuer(certificate.subject.attributes);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [certificate], password, {
    algorithm: "3des"
  });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");
}

const issuer: Issuer = {
  id: "issuer_nht",
  cnpj: "35181069000143",
  razaoSocial: "Norberto Hitoshi Tajiri Ltda",
  nomeFantasia: "NHT Centro Automotivo",
  ambiente: "homologacao",
  uf: "PR",
  ie: "",
  crt: "1",
  serieNfe: 1,
  serieNfce: 2,
  ativo: true,
  metadata: {}
};

const serviceConfig: ServiceConfig = {
  id: "svc_nfse_nacional",
  issuerId: issuer.id,
  cnpj: issuer.cnpj,
  ambiente: "homologacao",
  serviceType: "NFSE",
  active: true,
  settings: {
    nfseProvider: "nfse-nacional",
    nfseMunicipalityCode: "4108809",
    nfseInscricaoMunicipal: "324743",
    nfseNationalMunicipalRegistration: "324743",
    nfseRpsSerie: "1",
    nfseNationalLayoutVersion: "1.01",
    nfseNationalTaxCode: "140101",
    nfseNationalNbsCode: "123456789",
    nfseNationalSimpleOption: "3",
    nfseNationalSimpleTaxRegime: "1",
    nfseNationalSpecialTaxRegime: "0",
    nfseNationalIssTaxation: "1",
    nfseNationalIssRetention: "1"
  },
  secretsEncrypted: null,
  createdAt: "2026-08-06T12:00:00.000Z",
  updatedAt: "2026-08-06T12:00:00.000Z"
};

function document(payloadOriginal: unknown): Pick<
  DocumentRecord,
  "ambiente" | "issuerCnpj" | "numero" | "serie" | "payloadOriginal"
> {
  return {
    ambiente: "homologacao",
    issuerCnpj: issuer.cnpj,
    numero: 27,
    serie: 1,
    payloadOriginal
  };
}

test("classifica indisponibilidade HTTP da SEFIN com orientação amigável", () => {
  assert.deepEqual(
    mapNationalProcessingError("SEFIN Nacional retornou HTTP 503."),
    {
      reasonCode: "NFSE_NACIONAL_TRANSPORT_ERROR",
      userMessage:
        "A SEFIN Nacional está temporariamente indisponível (HTTP 503). " +
        "Aguarde alguns minutos e consulte o status antes de tentar novamente."
    }
  );
});

test("recognizes an explicitly configured national NFS-e provider", () => {
  assert.equal(isNationalNfseConfig(issuer, serviceConfig), true);
  assert.match(resolveNationalSefinEndpoint("homologacao"), /producaorestrita/);
  assert.doesNotMatch(resolveNationalSefinEndpoint("producao"), /producaorestrita/);
  assert.equal(
    resolveNationalSefinEndpoint("homologacao", "https://example.invalid/sefin"),
    resolveNationalSefinEndpoint("homologacao")
  );
});

test("normalizes the existing client payload and generates a national DPS", () => {
  const config = resolveNationalNfseConfig(issuer, serviceConfig);
  const draft = normalizeNationalNfseDraft(
    document({
      infDPS: {
        dhEmi: "2026-08-06T10:15:30-03:00",
        dCompet: "2026-08-06",
        toma: {
          CPF: "08701600958",
          xNome: "Cliente de Teste",
          end: {
            endNac: { cMun: "4108809", CEP: "85980113" },
            xLgr: "Rua Teste",
            nro: "123",
            xBairro: "Centro"
          }
        },
        serv: {
          locPrest: { cLocPrestacao: "4108809" },
          cServ: {
            cTribNac: "140101",
            xDescServ: "Manutencao e reparacao de veiculos"
          }
        },
        valores: {
          vServPrest: { vServ: 200 },
          trib: { tribMun: { tribISSQN: "1", tpRetISSQN: "1" } }
        }
      }
    }),
    config
  );
  const xml = buildNationalDpsXml(config, draft);

  assert.equal(draft.id.length, 45);
  assert.match(draft.id, /^DPS41088092/);
  assert.match(xml, new RegExp(`<DPS xmlns="${NFSE_NATIONAL_NAMESPACE}" versao="1.01">`));
  assert.match(xml, /<tpAmb>2<\/tpAmb>/);
  assert.match(xml, /<CNPJ>35181069000143<\/CNPJ>/);
  assert.match(xml, /<cTribNac>140101<\/cTribNac>/);
  assert.match(xml, /<cNBS>123456789<\/cNBS>/);
  assert.match(xml, /<vServ>200\.00<\/vServ>/);
  assert.doesNotThrow(() => parseXml(xml, { nonet: true }));
});

test("omite aliquota de ISS para MEI", () => {
  const config = {
    ...resolveNationalNfseConfig(issuer, serviceConfig),
    simpleOption: "2" as const,
    simpleTaxRegime: "" as const
  };
  const draft = normalizeNationalNfseDraft(
    document({
      infDPS: {
        toma: { CPF: "08701600958", xNome: "Cliente MEI" },
        serv: {
          locPrest: { cLocPrestacao: "4108809" },
          cServ: { cTribNac: "140101", xDescServ: "Servico MEI" }
        },
        valores: {
          vServPrest: { vServ: 100 },
          trib: { tribMun: { tribISSQN: "1", tpRetISSQN: "1", pAliq: 5 } }
        }
      }
    }),
    config
  );
  const xml = buildNationalDpsXml(config, draft);

  assert.match(xml, /<opSimpNac>2<\/opSimpNac>/);
  assert.doesNotMatch(xml, /<regApTribSN>/);
  assert.doesNotMatch(xml, /<pAliq>/);
});

test("reconcilia a NFS-e recuperada com a DPS enviada antes de autorizar", () => {
  const config = resolveNationalNfseConfig(issuer, serviceConfig);
  const draft = normalizeNationalNfseDraft(
    document({
      infDPS: {
        dhEmi: "2026-08-11T18:32:46-03:00",
        dCompet: "2026-08-11",
        toma: { CPF: "01041025947", xNome: "Diego Rocco" },
        serv: {
          locPrest: { cLocPrestacao: "4108809" },
          cServ: { cTribNac: "140101", xDescServ: "Servico de teste" }
        },
        valores: { vServPrest: { vServ: 10 } }
      }
    }),
    config
  );
  const dpsXml = buildNationalDpsXml(config, draft);
  const authorizedXml = `<NFSe><infNFSe><nNFSe>27</nNFSe>${dpsXml.replace(/^<\?xml[^>]*>\s*/, "")}</infNFSe></NFSe>`;

  assert.deepEqual(reconcileNationalDpsWithAuthorizedXml(dpsXml, authorizedXml), {
    matches: true,
    discrepancies: []
  });

  const divergentAuthorizedXml = authorizedXml
    .replace("2026-08-11T18:32:46-03:00", "2026-02-03T22:28:46-03:00")
    .replace("2026-08-11", "2026-02-03")
    .replace("<vServ>10.00</vServ>", "<vServ>3.00</vServ>");
  const divergent = reconcileNationalDpsWithAuthorizedXml(dpsXml, divergentAuthorizedXml);
  assert.equal(divergent.matches, false);
  assert.deepEqual(divergent.discrepancies, [
    "data/hora de emissao da DPS",
    "data de competencia",
    "valor do servico"
  ]);
});

test("nao reaproveita a inscricao municipal do conector municipal na DPS Nacional", () => {
  const config = resolveNationalNfseConfig(issuer, {
    ...serviceConfig,
    settings: {
      ...serviceConfig.settings,
      nfseInscricaoMunicipal: "970339",
      nfseNationalMunicipalRegistration: ""
    }
  });
  const draft = normalizeNationalNfseDraft(
    document({
      infDPS: {
        serv: {
          locPrest: { cLocPrestacao: "4127700" },
          cServ: { cTribNac: "140101", xDescServ: "Servico" }
        },
        valores: { vServPrest: { vServ: 100 } }
      }
    }),
    { ...config, municipalityCode: "4127700", nbsCode: "120013110" }
  );

  assert.equal(draft.municipalRegistration, "");
  assert.doesNotMatch(
    buildNationalDpsXml(
      { ...config, municipalityCode: "4127700", nbsCode: "120013110" },
      draft
    ),
    /<IM>/
  );
});

test("omite aliquota para ME/EPP do Simples sem retencao do ISSQN", () => {
  const config = resolveNationalNfseConfig(issuer, serviceConfig);
  const draft = normalizeNationalNfseDraft(
    document({
      infDPS: {
        toma: { CPF: "08701600958", xNome: "Cliente de Teste" },
        serv: {
          locPrest: { cLocPrestacao: "4108809" },
          cServ: { cTribNac: "140101", xDescServ: "Servico de teste" }
        },
        valores: {
          vServPrest: { vServ: 200 },
          trib: { tribMun: { tribISSQN: "1", tpRetISSQN: "1", pAliq: 2.01 } }
        }
      }
    }),
    config
  );

  assert.equal(draft.issRate, 0);
  assert.doesNotMatch(buildNationalDpsXml(config, draft), /<pAliq>/);
});

test("accepts the shared payloads from Autoeletrica and Apoio-Contabil", () => {
  const config = resolveNationalNfseConfig(issuer, serviceConfig);
  const clientPayloads = [
    {
      source: "Autoeletrica",
      payload: {
        infDPS: {
          dhEmi: "2026-08-07T10:15:30-03:00",
          dCompet: "2026-08-07",
          prest: { CNPJ: issuer.cnpj },
          toma: {
            CPF: "08701600958",
            xNome: "Cliente Autoeletrica",
            email: "cliente@example.com",
            fone: "44999998888",
            end: {
              xLgr: "Rua Teste",
              nro: "123",
              xBairro: "Centro",
              endNac: { cMun: "4127700", CEP: "85900000" }
            }
          },
          serv: {
            locPrest: { cLocPrestacao: "4127700" },
            cServ: {
              cTribNac: "14.01",
              cTribMun: "14.01.01.000",
              CNAE: "4520007",
              cSitTrib: "0",
              xDescServ: "Servico de manutencao (R$ 200.00)"
            }
          },
          valores: {
            vServPrest: { vServ: 200 },
            trib: { tribMun: { tribISSQN: 1, tpRetISSQN: 1, pAliq: 2.01 } }
          }
        }
      }
    },
    {
      source: "Apoio-Contabil",
      payload: {
        infDPS: {
          dhEmi: "2026-08-07T10:15:30-03:00",
          dCompet: "2026-08-07",
          prest: { CNPJ: issuer.cnpj },
          toma: {
            CNPJ: "12345678000195",
            xNome: "Cliente Apoio Contabil",
            fone: "44999998888",
            end: {
              xLgr: "Rua Cliente",
              nro: "55",
              xBairro: "Centro",
              endNac: { cMun: "4127700", CEP: "85900000" }
            }
          },
          serv: {
            locPrest: { cLocPrestacao: "4127700" },
            cServ: {
              cTribNac: "14.01",
              cTribMun: "14.01.01.000",
              CNAE: "4520007",
              cSitTrib: "0",
              xDescServ: "Servico contabil (R$ 150.00)"
            }
          },
          valores: {
            vServPrest: { vServ: 150 },
            trib: { tribMun: { tribISSQN: 1, tpRetISSQN: 1, pAliq: 2 } }
          }
        }
      }
    }
  ];

  for (const { source, payload } of clientPayloads) {
    const draft = normalizeNationalNfseDraft(document(payload), config);
    assert.equal(draft.nationalTaxCode, "140101", source);
    assert.equal(draft.municipalTaxCode, "", source);
    assert.equal(draft.nbsCode, "123456789", source);
    assert.doesNotThrow(() => validateNationalNfseDraft(draft), source);
  }
});

test("keeps NBS optional and rejects an invalid NBS when informed", () => {
  const config = {
    ...resolveNationalNfseConfig(issuer, serviceConfig),
    nbsCode: ""
  };
  const draft = normalizeNationalNfseDraft(
    document({
      infDPS: {
        serv: {
          locPrest: { cLocPrestacao: "4108809" },
          cServ: { cTribNac: "140101", xDescServ: "Servico" }
        },
        valores: { vServPrest: { vServ: 100 } }
      }
    }),
    config
  );

  const xml = buildNationalDpsXml(config, draft);
  assert.doesNotMatch(xml, /<cNBS>/);

  assert.throws(
    () => validateNationalNfseDraft({ ...draft, nbsCode: "123" }),
    /NBS com 9 digitos/
  );
});

test("valida formatos nacionais antes de assinar a DPS", () => {
  const draft = normalizeNationalNfseDraft(
    document({
      infDPS: {
        prest: { regTrib: { opSimpNac: "1" } },
        toma: { fone: "123", email: "email invalido" },
        serv: {
          locPrest: { cLocPrestacao: "4108809" },
          cServ: { cTribNac: "140101", xDescServ: "Servico" }
        },
        valores: { vServPrest: { vServ: 100 }, trib: { tribMun: { pAliq: 10 } } }
      }
    }),
    resolveNationalNfseConfig(issuer, serviceConfig)
  );

  assert.throws(
    () => validateNationalNfseDraft(draft),
    /aliquota ISS entre 0,00 e 9,99.*telefone do tomador.*email do tomador/
  );
});

test("routes a national document and persists a generated DPS without transmitting", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "nlf-nfse-national-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new InMemoryStore(
    "client",
    "secret",
    "token-secret",
    join(directory, "state.json")
  );
  store.upsertIssuerEnvironment(issuer.cnpj, "homologacao", {
    razaoSocial: issuer.razaoSocial,
    nomeFantasia: issuer.nomeFantasia,
    uf: issuer.uf,
    crt: issuer.crt,
    metadata: issuer.metadata
  });
  store.upsertServiceConfig(issuer.cnpj, "homologacao", "NFSE", {
    active: true,
    settings: serviceConfig.settings
  });
  const password = "senha-nfse-nacional";
  const certificate = store.createOrReplaceCertificate(issuer.cnpj, {
    fileName: "nfse-nacional-teste.pfx",
    encryptedBundle: encryptCertificateBundle(
      { pfxBase64: createTestPfx(password).toString("base64"), password },
      config.certificateEncryptionKey
    ),
    validFrom: new Date(Date.now() - 60_000).toISOString(),
    validUntil: new Date(Date.now() + 86_400_000).toISOString(),
    serialNumber: "02",
    subject: "CN=NFS-e Nacional Teste",
    holderCnpj: issuer.cnpj
  });
  assert.ok(certificate);
  const created = store.createDocument({
    tipoDocumento: "NFSe",
    issuerCnpj: issuer.cnpj,
    ambiente: "homologacao",
    payloadOriginal: {
      infDPS: {
        dhEmi: "2026-08-06T10:15:30-03:00",
        serv: {
          locPrest: { cLocPrestacao: "4108809" },
          cServ: { cTribNac: "140101", xDescServ: "Servico" }
        },
        valores: { vServPrest: { vServ: 100 } }
      }
    },
    payloadNormalizado: {}
  });

  assert.equal(configuredNfseProvider(store, created), "nfse-nacional");
  const result = await processConfiguredNfse(store, created.id);

  assert.equal(result.transmitted, false);
  assert.equal(result.error, null);
  assert.equal(result.document.status, "processamento");
  assert.equal(result.document.providerName, "nfse-nacional");
  assert.equal(result.document.motivoStatus, "NFSE_NACIONAL_DPS_GENERATED");
  assert.match(result.document.xmlGenerated ?? "", /<DPS /);
  assert.match(result.document.xmlSigned ?? "", /<Signature xmlns="http:\/\/www.w3.org\/2000\/09\/xmldsig#">/);
  assert.equal(result.document.signatureValid, true);
  assert.equal(result.document.xsdValid, true);
  assert.equal(store.getDocumentEvents(created.id)[0]?.eventType, "nfse_nacional_dps_generated");
});

test("reserva numeros DPS nacionais sequenciais no store", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "nlf-nfse-national-number-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new InMemoryStore("client", "secret", "token-secret", join(directory, "state.json"));
  store.upsertIssuerEnvironment(issuer.cnpj, "homologacao", {
    razaoSocial: issuer.razaoSocial,
    nomeFantasia: issuer.nomeFantasia,
    uf: issuer.uf,
    crt: issuer.crt
  });
  store.upsertServiceConfig(issuer.cnpj, "homologacao", "NFSE", {
    active: true,
    settings: { ...serviceConfig.settings, nfseNextRpsNumber: 41 }
  });

  assert.deepEqual(store.reserveNextNationalDpsNumber(issuer.cnpj, "homologacao"), {
    number: "41",
    series: "1"
  });
  assert.deepEqual(store.reserveNextNationalDpsNumber(issuer.cnpj, "homologacao"), {
    number: "42",
    series: "1"
  });
});

test("persiste tentativa de cancelamento e nao confirma status nao aceito", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "nlf-nfse-national-cancellation-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new InMemoryStore("client", "secret", "token-secret", join(directory, "state.json"));
  const created = store.createDocument({
    tipoDocumento: "NFSe",
    issuerCnpj: issuer.cnpj,
    ambiente: "homologacao",
    payloadOriginal: {},
    payloadNormalizado: {}
  });
  created.status = "autorizado";
  const prepared = store.prepareNationalCancellationAttempt({
    id: created.id,
    justification: "Servico nao prestado pelo emitente.",
    requestXml: "<pedRegEvento />",
    signedXml: "<pedRegEvento><Signature /></pedRegEvento>"
  });
  assert.equal(prepared.prepared, true);
  assert.equal(prepared.document?.cancellationState, "pendente_transmissao");
  assert.ok(prepared.document?.cancellationAttemptId);

  const duplicate = store.prepareNationalCancellationAttempt({
    id: created.id,
    justification: "Servico nao prestado pelo emitente.",
    requestXml: "<pedRegEvento />",
    signedXml: "<pedRegEvento><Signature /></pedRegEvento>"
  });
  assert.equal(duplicate.prepared, false);

  const saved = store.saveCancellationResult(created.id, {
    justification: "Servico nao prestado pelo emitente.",
    requestXml: "<pedRegEvento />",
    signedXml: "<pedRegEvento><Signature /></pedRegEvento>",
    responseXml: "{}",
    processedXml: "{}",
    statusCode: "136",
    reason: "Status nao confirmado.",
    protocol: "",
    success: false,
    status: "autorizado",
    state: "pendente_confirmacao"
  });
  assert.equal(saved?.status, "autorizado");
  assert.equal(saved?.cancellationState, "pendente_confirmacao");
});

test("transmissao manual nacional recusa qualquer ambiente que nao seja homologacao", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "nlf-nfse-national-manual-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new InMemoryStore("client", "secret", "token-secret", join(directory, "state.json"));
  store.upsertIssuerEnvironment(issuer.cnpj, "producao", {
    razaoSocial: issuer.razaoSocial,
    nomeFantasia: issuer.nomeFantasia,
    uf: issuer.uf,
    crt: issuer.crt
  });
  store.upsertServiceConfig(issuer.cnpj, "producao", "NFSE", {
    active: true,
    settings: serviceConfig.settings
  });
  const created = store.createDocument({
    tipoDocumento: "NFSe",
    issuerCnpj: issuer.cnpj,
    ambiente: "producao",
    payloadOriginal: {},
    payloadNormalizado: {}
  });
  created.status = "processamento";
  created.providerName = "nfse-nacional";
  created.providerReference = "DPS4108809000000000000000000001000000000000001";
  created.xmlSigned = "<DPS />";

  await assert.rejects(
    () => transmitPreparedNationalDps(store, created.id),
    /somente em homologacao/i
  );
});

test("monta evento Nacional 101101 e interpreta retorno aceito", () => {
  const accessKey = "41088091235181069000143000000000000226020000000002";
  const xml = buildNationalCancellationEventXml({
    environmentType: "2",
    eventAt: "2026-08-08T09:00:00-03:00",
    applicationVersion: "NuvemLocalFiscal_1",
    issuerCnpj: issuer.cnpj,
    accessKey,
    reasonCode: "2",
    reason: "Servico nao prestado pelo emitente."
  });
  assert.match(xml, /<e101101>/);
  assert.match(xml, /<cMotivo>2<\/cMotivo>/);
  assert.match(xml, new RegExp(`<chNFSe>${accessKey}<\\/chNFSe>`));
  assert.match(xml, /Id="PRE41088091235181069000143000000000000226020000000002101101"/);
  assert.equal(validateNationalCancellationEventXml(xml).valid, true);

  const parsed = parseNationalSefinEventResponse(
    200,
    JSON.stringify({ codigoStatus: "135", motivoStatus: "Evento registrado e vinculado" })
  );
  assert.equal(parsed.accepted, true);
  assert.equal(parsed.eventStatusCode, "135");
});

test("nao confirma cancelamento Nacional com HTTP 2xx sem cStat", () => {
  const parsed = parseNationalSefinEventResponse(200, JSON.stringify({}));
  assert.equal(parsed.accepted, false);
  assert.equal(parsed.errors[0]?.code, "SEFIN_EVENTO_STATUS_AUSENTE");
});
