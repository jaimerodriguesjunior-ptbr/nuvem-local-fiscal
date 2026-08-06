import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { parseXml } from "libxmljs2";

import type { DocumentRecord, Issuer, ServiceConfig } from "../types.js";
import { InMemoryStore } from "../store.js";
import {
  buildNationalDpsXml,
  isNationalNfseConfig,
  NFSE_NATIONAL_NAMESPACE,
  normalizeNationalNfseDraft,
  resolveNationalSefinEndpoint,
  resolveNationalNfseConfig,
  validateNationalNfseDraft
} from "./nfse-national.js";
import {
  configuredNfseProvider,
  processConfiguredNfse
} from "./nfse-provider.js";

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

test("recognizes an explicitly configured national NFS-e provider", () => {
  assert.equal(isNationalNfseConfig(issuer, serviceConfig), true);
  assert.match(resolveNationalSefinEndpoint("homologacao"), /producaorestrita/);
  assert.doesNotMatch(resolveNationalSefinEndpoint("producao"), /producaorestrita/);
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
  assert.equal(store.getDocumentEvents(created.id)[0]?.eventType, "nfse_nacional_dps_generated");
});
