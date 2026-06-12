import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import test from "node:test";

import forge from "node-forge";

function createTestPfx(password: string) {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = "02";
  certificate.validity.notBefore = new Date(Date.now() - 60_000);
  certificate.validity.notAfter = new Date(Date.now() + 86_400_000);
  certificate.setSubject([{ name: "commonName", value: "A1 Integracao Local" }]);
  certificate.setIssuer(certificate.subject.attributes);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(
    keys.privateKey,
    [certificate],
    password,
    { algorithm: "3des" }
  );
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");
}

test("fluxo HTTP gera, assina e autoriza NFC-e sem transmitir", async () => {
  const stateFile = `./storage/test-state-${process.pid}.json`;
  process.env.STATE_FILE = stateFile;
  process.env.JWT_SECRET = "jwt-test";
  process.env.CERTIFICATE_ENCRYPTION_KEY = "certificate-test";
  process.env.SUPABASE_URL = "";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "";
  process.env.AUTO_TRANSMIT_HOMOLOGATION = "false";
  const { buildApp } = await import("./app.js");
  const app = buildApp();
  await app.ready();

  try {
    const tokenResponse = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload:
        "grant_type=client_credentials&client_id=local-client&client_secret=local-secret&scope=nfce"
    });
    assert.equal(tokenResponse.statusCode, 200);
    const token = tokenResponse.json().access_token as string;
    const bearer = { authorization: `Bearer ${token}` };
    const basic = `Basic ${Buffer.from("admin:admin").toString("base64")}`;
    const cnpj = "12345678000195";

    const blockedProductionInutilization = await app.inject({
      method: "POST",
      url: "/nfce/inutilizacoes",
      headers: {
        ...bearer,
        "content-type": "application/json"
      },
      payload: {
        cnpj,
        ambiente: "producao",
        ano: 2026,
        serie: 1,
        numero_inicial: 90,
        numero_final: 90,
        justificativa: "Falha operacional na sequencia de numeracao"
      }
    });
    assert.equal(blockedProductionInutilization.statusCode, 403);

    const savedInutilization = app.store.createInutilization({
      tipoDocumento: "NFCe",
      issuerCnpj: cnpj,
      ambiente: "homologacao",
      ano: 26,
      serie: 1,
      numeroInicial: 9000,
      numeroFinal: 9000,
      justificativa: "Falha operacional na sequencia de numeracao"
    });
    app.store.saveInutilizationResult(savedInutilization.id, {
      requestXml: "<inutNFe />",
      signedXml: "<inutNFe><Signature /></inutNFe>",
      responseXml: "<retInutNFe />",
      statusCode: "102",
      reason: "Inutilizacao de numero homologado",
      protocol: "141260001356197"
    });
    const getInutilization = await app.inject({
      method: "GET",
      url: `/nfce/inutilizacoes/${savedInutilization.id}`,
      headers: bearer
    });
    assert.equal(getInutilization.statusCode, 200, getInutilization.body);
    assert.equal(getInutilization.json().numero_protocolo, "141260001356197");
    assert.equal(
      getInutilization.json().autorizacao.numero_protocolo,
      "141260001356197"
    );

    const saveCompany = await app.inject({
      method: "POST",
      url: "/empresas",
      headers: {
        ...bearer,
        "content-type": "application/json"
      },
      payload: {
        cpf_cnpj: cnpj,
        nome_razao_social: "Empresa Integracao",
        nome_fantasia: "Empresa Integracao",
        inscricao_estadual: "1234567890",
        regime_tributario: 1,
        endereco: {
          logradouro: "Rua de Teste",
          numero: "100",
          bairro: "Centro",
          codigo_municipio: "4106902",
          cidade: "Curitiba",
          uf: "PR",
          cep: "80000000",
          pais: "BRASIL"
        }
      }
    });
    assert.equal(saveCompany.statusCode, 201, saveCompany.body);
    assert.equal(saveCompany.json().cpf_cnpj, cnpj);
    assert.equal(saveCompany.json().endereco.codigo_municipio, "4106902");

    const saveOfficialNfceConfig = await app.inject({
      method: "PUT",
      url: `/empresas/${cnpj}/nfce`,
      headers: {
        ...bearer,
        "content-type": "application/json"
      },
      payload: {
        ambiente: "homologacao",
        sefaz: {
          id_csc: 1,
          csc: "CSC-FICTICIO-DO-TESTE"
        }
      }
    });
    assert.equal(saveOfficialNfceConfig.statusCode, 200, saveOfficialNfceConfig.body);
    assert.doesNotMatch(saveOfficialNfceConfig.body, /CSC-FICTICIO-DO-TESTE|secretsEncrypted/);

    const remoteCompany = await app.inject({
      method: "GET",
      url: `/empresas/${cnpj}`,
      headers: bearer
    });
    assert.equal(remoteCompany.statusCode, 200, remoteCompany.body);
    assert.equal(remoteCompany.json().endereco.uf, "PR");

    const saveEnvironment = await app.inject({
      method: "POST",
      url: `/admin/api/companies/${cnpj}/environments/homologacao`,
      headers: {
        authorization: basic,
        "content-type": "application/json"
      },
      payload: {
        razaoSocial: "Empresa Integracao",
        nomeFantasia: "Empresa Integracao",
        uf: "PR",
        ie: "1234567890",
        crt: "1",
        serieNfe: 1,
        serieNfce: 1,
        ativo: true
      }
    });
    assert.equal(saveEnvironment.statusCode, 200, saveEnvironment.body);

    const saveServiceConfig = await app.inject({
      method: "POST",
      url: `/admin/api/companies/${cnpj}/services/nfce/homologacao`,
      headers: {
        authorization: basic,
        "content-type": "application/json"
      },
      payload: {
        cscId: "000001",
        csc: "CSC-FICTICIO-DO-TESTE"
      }
    });
    assert.equal(saveServiceConfig.statusCode, 200, saveServiceConfig.body);
    assert.doesNotMatch(saveServiceConfig.body, /CSC-FICTICIO-DO-TESTE|secretsEncrypted/);

    const invalidServiceConfig = await app.inject({
      method: "POST",
      url: `/admin/api/companies/${cnpj}/services/nfce/invalido`,
      headers: {
        authorization: basic,
        "content-type": "application/json"
      },
      payload: {
        cscId: "abc",
        csc: "nao-deve-ser-salvo"
      }
    });
    assert.equal(invalidServiceConfig.statusCode, 400);

    const emission = await app.inject({
      method: "POST",
      url: "/nfce",
      headers: bearer,
      payload: {
        ambiente: "homologacao",
        infNFe: {
          versao: "4.00",
          ide: {
            cUF: 41,
            natOp: "VENDA",
            mod: 65,
            serie: 1,
            nNF: 321,
            dhEmi: "2026-06-11T10:00:00-03:00",
            tpNF: 1,
            idDest: 1,
            cMunFG: 4106902,
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
            CNPJ: cnpj,
            xNome: "Empresa Integracao",
            enderEmit: {
              xLgr: "Rua de Teste",
              nro: "100",
              xBairro: "Centro",
              cMun: 4106902,
              xMun: "Curitiba",
              UF: "PR",
              CEP: "80000000",
              cPais: "1058",
              xPais: "BRASIL"
            },
            IE: "1234567890",
          },
          det: [
            {
              nItem: 1,
              prod: {
                cProd: "1",
                cEAN: "SEM GTIN",
                xProd: "Produto de teste",
                NCM: "00000000",
                CFOP: "5102",
                uCom: "UN",
                qCom: 1,
                vUnCom: 10,
                vProd: 10,
                cEANTrib: "SEM GTIN",
                uTrib: "UN",
                qTrib: 1,
                vUnTrib: 10,
                indTot: 1
              },
              imposto: {
                ICMS: {
                  ICMSSN102: {
                    orig: 0,
                    CSOSN: "102"
                  }
                },
                PIS: {
                  PISOutr: {
                    CST: "99",
                    vBC: 0,
                    pPIS: 0,
                    vPIS: 0
                  }
                },
                COFINS: {
                  COFINSOutr: {
                    CST: "99",
                    vBC: 0,
                    pCOFINS: 0,
                    vCOFINS: 0
                  }
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
              vProd: 10,
              vFrete: 0,
              vSeg: 0,
              vDesc: 0,
              vII: 0,
              vIPI: 0,
              vIPIDevol: 0,
              vPIS: 0,
              vCOFINS: 0,
              vOutro: 0,
              vNF: 10
            }
          },
          transp: { modFrete: 9 },
          pag: {
            detPag: [
              {
                tPag: "01",
                vPag: 10
              }
            ]
          }
        }
      }
    });
    assert.equal(emission.statusCode, 202);
    const documentId = emission.json().id as string;

    const nfeEmission = await app.inject({
      method: "POST",
      url: "/nfe",
      headers: bearer,
      payload: {
        ambiente: "homologacao",
        infNFe: {
          versao: "4.00",
          ide: {
            cUF: 41,
            natOp: "VENDA",
            mod: 55,
            serie: 1,
            nNF: 322,
            dhEmi: "2026-06-11T10:00:00-03:00",
            tpNF: 1,
            idDest: 1,
            cMunFG: 4106902,
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
            CNPJ: cnpj,
            xNome: "Empresa Integracao",
            enderEmit: {
              xLgr: "Rua de Teste",
              nro: "100",
              xBairro: "Centro",
              cMun: 4106902,
              xMun: "Curitiba",
              UF: "PR",
              CEP: "80000000",
              cPais: "1058",
              xPais: "BRASIL"
            },
            IE: "1234567890"
          },
          dest: {
            CPF: "12345678909",
            xNome: "Consumidor Teste",
            enderDest: {
              xLgr: "Rua Cliente",
              nro: "55",
              xBairro: "Centro",
              cMun: 4106902,
              xMun: "Curitiba",
              UF: "PR",
              CEP: "80000000",
              cPais: "1058",
              xPais: "BRASIL"
            },
            indIEDest: 9
          },
          det: [
            {
              nItem: 1,
              prod: {
                cProd: "1",
                cEAN: "SEM GTIN",
                xProd: "Produto NF-e",
                NCM: "00000000",
                CFOP: "5102",
                uCom: "UN",
                qCom: 1,
                vUnCom: 10,
                vProd: 10,
                cEANTrib: "SEM GTIN",
                uTrib: "UN",
                qTrib: 1,
                vUnTrib: 10,
                indTot: 1
              },
              imposto: {
                ICMS: {
                  ICMSSN102: {
                    orig: 0,
                    CSOSN: "102"
                  }
                },
                PIS: {
                  PISOutr: {
                    CST: "99",
                    vBC: 0,
                    pPIS: 0,
                    vPIS: 0
                  }
                },
                COFINS: {
                  COFINSOutr: {
                    CST: "99",
                    vBC: 0,
                    pCOFINS: 0,
                    vCOFINS: 0
                  }
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
              vProd: 10,
              vFrete: 0,
              vSeg: 0,
              vDesc: 0,
              vII: 0,
              vIPI: 0,
              vIPIDevol: 0,
              vPIS: 0,
              vCOFINS: 0,
              vOutro: 0,
              vNF: 10
            }
          },
          transp: { modFrete: 9 },
          pag: {
            detPag: [
              {
                tPag: "01",
                vPag: 10
              }
            ]
          }
        }
      }
    });
    assert.equal(nfeEmission.statusCode, 202, nfeEmission.body);
    assert.equal(nfeEmission.json().status, "processamento");
    const nfeDocumentId = nfeEmission.json().id as string;

    const recoveredNfe = app.store.createDocument({
      tipoDocumento: "NFe",
      issuerCnpj: cnpj,
      ambiente: "homologacao",
      payloadOriginal: nfeEmission.json().payloadOriginal ?? {},
      payloadNormalizado: {},
      forcedStatus: "processamento"
    });
    app.store.failDocument(
      recoveredNfe.id,
      "PROCESSAMENTO_AUTOMATICO",
      "XML reprovado no XSD"
    );
    app.store.saveSefazAuthorization(recoveredNfe.id, {
      batchId: "123",
      receipt: "",
      batchCStat: "104",
      batchReason: "Lote processado",
      protocolCStat: "100",
      protocolReason: "Autorizado o uso da NF-e",
      protocol: "141260000345844",
      accessKey: "41260601997929000108550010000000271727886936",
      responseXml: "<retEnviNFe />",
      processedXml: "<nfeProc />"
    });
    const recoveredNfeStatus = await app.inject({
      method: "GET",
      url: `/nfe/${recoveredNfe.id}`,
      headers: bearer
    });
    assert.equal(recoveredNfeStatus.statusCode, 200, recoveredNfeStatus.body);
    assert.equal(recoveredNfeStatus.json().status, "autorizado");
    assert.deepEqual(recoveredNfeStatus.json().mensagens, []);

    const password = "senha-integracao";
    const certificateUpload = await app.inject({
      method: "PUT",
      url: `/empresas/${cnpj}/certificado`,
      headers: bearer,
      payload: {
        fileName: "teste.pfx",
        pfxBase64: createTestPfx(password).toString("base64"),
        password
      }
    });
    assert.equal(certificateUpload.statusCode, 200, certificateUpload.body);

    const adminPage = await app.inject({
      method: "GET",
      url: "/admin"
    });
    assert.equal(adminPage.statusCode, 200);
    assert.match(adminPage.body, /Operação fiscal, sem ruído\./);
    assert.match(adminPage.body, /Logs e debug/);

    const signed = await app.inject({
      method: "POST",
      url: `/admin/api/documents/${documentId}/sign`,
      headers: { authorization: basic }
    });
    assert.equal(signed.statusCode, 200, signed.body);
    assert.equal(signed.json().assinatura_valida, true);
    assert.equal(signed.json().xsd_valido, true, signed.body);
    assert.equal(signed.json().schema, "PL_010c");

    const signedNfe = await app.inject({
      method: "POST",
      url: `/admin/api/documents/${nfeDocumentId}/sign`,
      headers: { authorization: basic }
    });
    assert.equal(signedNfe.statusCode, 200, signedNfe.body);
    assert.equal(signedNfe.json().assinatura_valida, true);
    assert.equal(signedNfe.json().xsd_valido, true, signedNfe.body);

    const authorizeNfe = await app.inject({
      method: "POST",
      url: `/admin/api/documents/${nfeDocumentId}/status`,
      headers: {
        authorization: basic,
        "content-type": "application/json"
      },
      payload: { action: "autorizar" }
    });
    assert.equal(authorizeNfe.statusCode, 200, authorizeNfe.body);

    const nfePdf = await app.inject({
      method: "GET",
      url: `/nfe/${nfeDocumentId}/pdf`,
      headers: bearer
    });
    assert.equal(nfePdf.statusCode, 200, nfePdf.body);
    assert.match(nfePdf.body, /^%PDF-1\.4/);
    assert.match(nfePdf.body, /DANFE/);
    assert.match(nfePdf.body, /Nota Fiscal Eletronica/);
    assert.doesNotMatch(nfePdf.body, /DANFE NFC-e|QR Code|NFCe n\./);

    app.store.saveCancellationResult(nfeDocumentId, {
      justification: "Erro de preenchimento nos dados da NF-e em homologacao",
      requestXml: "<evento />",
      signedXml: "<evento><Signature /></evento>",
      responseXml: "<retEnvEvento />",
      processedXml: "<procEventoNFe />",
      statusCode: "135",
      reason: "Evento registrado e vinculado a NF-e",
      protocol: "141260000345750",
      cancelledAt: "2026-06-12T10:45:39-03:00"
    });
    const cancelledNfe = await app.inject({
      method: "GET",
      url: `/nfe/${nfeDocumentId}`,
      headers: bearer
    });
    assert.equal(cancelledNfe.statusCode, 200, cancelledNfe.body);
    assert.equal(cancelledNfe.json().status, "cancelado");
    assert.equal(cancelledNfe.json().autorizacao.codigo_status, "100");
    assert.equal(cancelledNfe.json().cancelamento.codigo_status, "135");
    assert.equal(
      cancelledNfe.json().cancelamento.numero_protocolo,
      "141260000345750"
    );
    assert.equal(cancelledNfe.json().cancelamento.xml_evento_disponivel, true);
    assert.match(
      cancelledNfe.json().cancelamento.xml_evento_url,
      new RegExp(`/nfe/${nfeDocumentId}/cancelamento/xml$`)
    );
    const cancellationXml = await app.inject({
      method: "GET",
      url: `/nfe/${nfeDocumentId}/cancelamento/xml`,
      headers: bearer
    });
    assert.equal(cancellationXml.statusCode, 200, cancellationXml.body);
    assert.match(cancellationXml.body, /<procEventoNFe/);

    const snapshot = await app.inject({
      method: "GET",
      url: "/admin/api/snapshot",
      headers: { authorization: basic }
    });
    assert.equal(snapshot.statusCode, 200);
    assert.doesNotMatch(
      snapshot.body,
      /encryptedBundle|nfceConfigEncrypted|senha-integracao|CSC-FICTICIO-DO-TESTE/
    );

    const authorization = await app.inject({
      method: "POST",
      url: `/admin/api/documents/${documentId}/status`,
      headers: {
        authorization: basic,
        "content-type": "application/json"
      },
      payload: { action: "autorizar" }
    });
    assert.equal(authorization.statusCode, 200);
    assert.doesNotMatch(authorization.body, /nfceConfigEncrypted|CSC-FICTICIO-DO-TESTE/);

    const fiscalHealth = await app.inject({
      method: "GET",
      url: `/admin/api/fiscal-health?cnpj=${cnpj}&environment=homologacao`,
      headers: { authorization: basic }
    });
    assert.equal(fiscalHealth.statusCode, 200, fiscalHealth.body);
    assert.equal(fiscalHealth.json().cnpj, cnpj);
    assert.equal(fiscalHealth.json().ambiente, "homologacao");
    assert.equal(fiscalHealth.json().checked_sefaz, false);
    assert.equal(
      fiscalHealth.json().checks.some(
        (check: { name: string; ok: boolean }) => check.name === "nfce_csc" && check.ok
      ),
      true
    );
    assert.doesNotMatch(fiscalHealth.body, /CSC-FICTICIO-DO-TESTE|encryptedBundle/);

    const consultation = await app.inject({
      method: "GET",
      url: `/nfce/${documentId}`,
      headers: bearer
    });
    assert.equal(consultation.json().status, "autorizado");
    assert.equal(consultation.json().assinatura_valida, true);

    const invalidCancellation = await app.inject({
      method: "POST",
      url: `/nfce/${documentId}/cancelar`,
      headers: {
        ...bearer,
        "content-type": "application/json"
      },
      payload: {
        justificativa: "motivo curto"
      }
    });
    assert.equal(invalidCancellation.statusCode, 400, invalidCancellation.body);
    assert.equal(invalidCancellation.json().error.code, "invalid_justification");

    const xml = await app.inject({
      method: "GET",
      url: `/nfce/${documentId}/xml`,
      headers: bearer
    });
    assert.equal(xml.statusCode, 200);
    assert.match(xml.body, /<Signature xmlns="http:\/\/www.w3.org\/2000\/09\/xmldsig#">/);
    assert.match(xml.body, /<infNFeSupl>/);
    assert.match(xml.body, /<qrCode>/);
    assert.match(xml.body, /<protNFe/);
  } finally {
    await app.close();
    await rm(stateFile, { force: true });
  }
});
