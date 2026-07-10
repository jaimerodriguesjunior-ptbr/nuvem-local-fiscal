import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import forge from "node-forge";

import {
  encryptCertificateBundle,
  openEncryptedCertificate,
  parsePfx
} from "./certificates.js";
import {
  calculateAccessKeyDigit,
  generateAndSignNfeXml
} from "./nfe-xml.js";
import {
  buildAuthorizationBatch,
  validateAuthorizationBatchXml
} from "./sefaz-authorization.js";
import { validateNfeXml } from "./xsd-validator.js";

function createTestPfx(
  password: string,
  commonName = "Certificado Teste Local"
) {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = "01";
  certificate.validity.notBefore = new Date(Date.now() - 60_000);
  certificate.validity.notAfter = new Date(Date.now() + 86_400_000);
  certificate.setSubject([{ name: "commonName", value: commonName }]);
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

test("calcula digito verificador da chave de acesso", () => {
  const base = "4126061234567800019565001000000123112345678";
  assert.equal(base.length, 43);
  assert.equal(calculateAccessKeyDigit(base), 3);
});

test("abre PFX, protege o bundle e assina infNFe", () => {
  const password = "senha-teste";
  const pfx = createTestPfx(password);
  const parsed = parsePfx(pfx, password);
  assert.match(parsed.subject, /Certificado Teste Local/);

  const encrypted = encryptCertificateBundle(
    {
      pfxBase64: pfx.toString("base64"),
      password
    },
    "segredo-local"
  );
  assert.doesNotMatch(encrypted, /senha-teste/);
  const opened = openEncryptedCertificate(encrypted, "segredo-local");

  const result = generateAndSignNfeXml(
    {
      ambiente: "homologacao",
      infNFe: {
        versao: "4.00",
        ide: {
          cUF: 41,
          natOp: "VENDA",
          mod: 65,
          serie: 1,
          nNF: 123,
          dhEmi: "2026-06-11T10:00:00-03:00",
          tpNF: 1,
          idDest: 1,
          cMunFG: 4106902,
          tpImp: 4,
          tpEmis: 1,
          cNF: 12345678,
          tpAmb: 2,
          finNFe: 1,
          indFinal: 1,
          indPres: 1,
          procEmi: 0,
          verProc: "NuvemLocalFiscal"
        },
        emit: {
          CNPJ: "12345678000195",
          xNome: "Empresa Teste",
          IE: "1234567890",
          CRT: 1
        },
        dest: {
          CPF: "12345678901",
          xNome: "Cliente Real"
        },
        det: [
          {
            nItem: 1,
            prod: {
              cProd: "1",
              xProd: "Produto Real"
            }
          }
        ],
        total: {
          ICMSTot: {
            vNF: 0
          }
        },
        transp: {
          modFrete: 9
        },
        pag: {
          detPag: []
        }
      }
    },
    opened.privateKeyPem,
    opened.certificatePem,
    {
      cscId: "000001",
      csc: "CSC-DE-HOMOLOGACAO-TESTE",
      qrCodeBaseUrl: "http://www.fazenda.pr.gov.br/nfce/qrcode",
      consultationUrl: "http://www.fazenda.pr.gov.br/nfce/consulta"
    }
  );

  assert.equal(result.accessKey.length, 44);
  assert.match(result.unsignedXml, new RegExp(`Id="NFe${result.accessKey}"`));
  assert.match(result.signedXml, /<Signature xmlns="http:\/\/www.w3.org\/2000\/09\/xmldsig#">/);
  assert.match(result.signedXml, /<X509Certificate>/);
  assert.match(result.signedXml, /<infNFeSupl>/);
  assert.match(
    result.signedXml,
    /http:\/\/www\.fazenda\.pr\.gov\.br\/nfce\/qrcode\?p=/
  );
  assert.match(
    result.signedXml,
    new RegExp(`${result.accessKey}\\|3\\|2`)
  );
  assert.doesNotMatch(result.signedXml, /\|3\|2\|1\|[A-F0-9]{40}/);
  assert.match(
    result.signedXml,
    /<urlChave>http:\/\/www\.fazenda\.pr\.gov\.br\/nfce\/consulta<\/urlChave>/
  );
  assert.match(
    result.unsignedXml,
    /<xNome>NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL<\/xNome>/
  );
  assert.match(
    result.unsignedXml,
    /<xProd>NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL<\/xProd>/
  );
  assert.doesNotMatch(result.unsignedXml, /Cliente Real|Produto Real/);
  assert.equal(result.signatureValid, true);
});

test("nao confunde outro identificador de 14 digitos com CNPJ", () => {
  const pfx = createTestPfx(
    "senha",
    "FORSTER E FORSTER LTDA:20085105000106"
  );
  const parsed = parsePfx(pfx, "senha");
  assert.equal(parsed.holderCnpj, null);
});

test("bloqueia CNPJ alfanumerico antes de gerar chave de acesso", () => {
  const password = "senha-cnpj-alfa";
  const opened = openEncryptedCertificate(
    encryptCertificateBundle(
      {
        pfxBase64: createTestPfx(password).toString("base64"),
        password
      },
      "segredo-cnpj-alfa"
    ),
    "segredo-cnpj-alfa"
  );

  assert.throws(
    () =>
      generateAndSignNfeXml(
        {
          infNFe: {
            ide: {
              cUF: 41,
              natOp: "VENDA",
              mod: 65,
              serie: 1,
              nNF: 1,
              dhEmi: "2026-07-02T10:00:00-03:00",
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
              CNPJ: "12ABC34501DE67",
              xNome: "Empresa Alfa",
              IE: "1234567890",
              CRT: 1
            }
          }
        },
        opened.privateKeyPem,
        opened.certificatePem,
        {
          cscId: "1",
          csc: "CSC-DE-HOMOLOGACAO-TESTE",
          qrCodeBaseUrl: "http://www.fazenda.pr.gov.br/nfce/qrcode",
          consultationUrl: "http://www.fazenda.pr.gov.br/nfce/consulta"
        }
      ),
    /CNPJ do emitente alfanumerico ainda nao e suportado/
  );
});

test("ordena os blocos de infNFe mesmo quando o JSON chega fora de ordem", () => {
  const password = "senha-ordem";
  const opened = openEncryptedCertificate(
    encryptCertificateBundle(
      {
        pfxBase64: createTestPfx(password).toString("base64"),
        password
      },
      "segredo-ordem"
    ),
    "segredo-ordem"
  );

  const result = generateAndSignNfeXml(
    {
      infNFe: {
        det: [{ nItem: 1, prod: { cProd: "1", xProd: "Produto" } }],
        ide: {
          cUF: 41,
          natOp: "VENDA",
          mod: 65,
          serie: 2,
          nNF: 1,
          dhEmi: "2026-06-11T15:00:00-03:00",
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
        pag: { detPag: [] },
        emit: {
          CNPJ: "01997929000108",
          xNome: "FORSTER E FORSTER LTDA",
          IE: "1234567890",
          CRT: 1
        },
        total: { ICMSTot: { vNF: 0 } },
        transp: { modFrete: 9 },
        versao: "4.00",
        infRespTec: { CNPJ: "01997929000108", xContato: "Teste" }
      }
    },
    opened.privateKeyPem,
    opened.certificatePem,
    {
      cscId: "000001",
      csc: "CSC-DE-HOMOLOGACAO-TESTE",
      qrCodeBaseUrl: "http://www.fazenda.pr.gov.br/nfce/qrcode",
      consultationUrl: "http://www.fazenda.pr.gov.br/nfce/consulta"
    }
  );

  const idePosition = result.unsignedXml.indexOf("<ide>");
  const emitPosition = result.unsignedXml.indexOf("<emit>");
  const detPosition = result.unsignedXml.indexOf('<det nItem="1">');
  const totalPosition = result.unsignedXml.indexOf("<total>");
  const transpPosition = result.unsignedXml.indexOf("<transp>");
  const pagPosition = result.unsignedXml.indexOf("<pag>");
  const techPosition = result.unsignedXml.indexOf("<infRespTec>");

  assert.ok(idePosition < emitPosition);
  assert.ok(emitPosition < detPosition);
  assert.ok(detPosition < totalPosition);
  assert.ok(totalPosition < transpPosition);
  assert.ok(transpPosition < pagPosition);
  assert.ok(pagPosition < techPosition);
  assert.equal(result.signatureValid, true);
});

test("ordena os campos internos apos round-trip por jsonb e valida no XSD", () => {
  const password = "senha-xsd";
  const opened = openEncryptedCertificate(
    encryptCertificateBundle(
      {
        pfxBase64: createTestPfx(password).toString("base64"),
        password
      },
      "segredo-xsd"
    ),
    "segredo-xsd"
  );

  const result = generateAndSignNfeXml(
    {
      infNFe: {
        versao: "4.00",
        ide: {
          cUF: 41,
          natOp: "VENDA DE MERCADORIA",
          mod: 65,
          serie: 2,
          nNF: 85,
          dhEmi: "2026-06-11T15:04:38-03:00",
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
          verProc: "GestaoOticaPro 1.0"
        },
        emit: {
          IE: "9013681047",
          CRT: 1,
          CNPJ: "01997929000108",
          xFant: "Otica Prisma Guaira",
          xNome: "FORSTER E FORSTER LTDA",
          enderEmit: {
            UF: "PR",
            CEP: "85980046",
            nro: "424",
            cMun: 4108809,
            xLgr: "Av. Mate Laranjeira",
            xMun: "Guaira",
            cPais: "1058",
            xPais: "BRASIL",
            xBairro: "Centro"
          }
        },
        det: [
          {
            nItem: 1,
            prod: {
              NCM: "00000000",
              CFOP: "5102",
              cEAN: "SEM GTIN",
              qCom: 1,
              uCom: "UN",
              cProd: "9383",
              qTrib: 1,
              uTrib: "UN",
              vProd: 270,
              xProd: "Produto",
              indTot: 1,
              vUnCom: 270,
              vUnTrib: 270,
              cEANTrib: "SEM GTIN"
            },
            imposto: {
              PIS: {
                PISOutr: { CST: "99", vBC: 0, pPIS: 0, vPIS: 0 }
              },
              ICMS: {
                ICMSSN102: { orig: 0, CSOSN: "102" }
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
            vII: 0,
            vNF: 270,
            vST: 0,
            vFCP: 0,
            vIPI: 0,
            vPIS: 0,
            vSeg: 0,
            vBCST: 0,
            vDesc: 0,
            vICMS: 0,
            vProd: 270,
            vFCPST: 0,
            vFrete: 0,
            vOutro: 0,
            vCOFINS: 0,
            vFCPSTRet: 0,
            vIPIDevol: 0,
            vICMSDeson: 0
          }
        },
        transp: { modFrete: 9 },
        pag: { vTroco: Number.NaN, detPag: [{ tPag: "01", vPag: 270 }] },
        infRespTec: {
          CNPJ: "65667543000102",
          fone: "44999261487",
          email: "fiscal@example.com",
          xContato: "Responsavel Tecnico"
        }
      }
    },
    opened.privateKeyPem,
    opened.certificatePem,
    {
      cscId: "1",
      csc: "CSC-DE-HOMOLOGACAO-TESTE",
      qrCodeBaseUrl: "http://www.fazenda.pr.gov.br/nfce/qrcode",
      consultationUrl: "http://www.fazenda.pr.gov.br/nfce/consulta"
    }
  );

  const validation = validateNfeXml(result.signedXml);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.valid, true);
  assert.match(
    result.unsignedXml,
    /<pag><detPag><tPag>01<\/tPag><vPag>270<\/vPag><\/detPag><vTroco>0<\/vTroco><\/pag>/
  );
  assert.doesNotMatch(result.unsignedXml, /NaN/);
});

test("gera NF-e modelo 55 sem CSC e valida XML e lote antes da SEFAZ", () => {
  const password = "senha-nfe";
  const opened = openEncryptedCertificate(
    encryptCertificateBundle(
      {
        pfxBase64: createTestPfx(password).toString("base64"),
        password
      },
      "segredo-nfe"
    ),
    "segredo-nfe"
  );

  const result = generateAndSignNfeXml(
    {
      infNFe: {
        versao: "4.00",
        ide: {
          cUF: 41,
          natOp: "VENDA DE MERCADORIA",
          mod: 55,
          serie: 1,
          nNF: 9003,
          dhEmi: "2026-06-12T10:00:00-03:00",
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
          CNPJ: "01997929000108",
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
          xNome: "Cliente Teste",
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
              xProd: "Produto NF-e",
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
        pag: { detPag: [{ tPag: "90", vPag: 270 }] },
        infRespTec: {
          CNPJ: "65667543000102",
          xContato: "Responsavel Tecnico",
          email: "fiscal@example.com",
          fone: "44999261487",
          CSRT: "NAO-DEVE-SAIR-NO-XML"
        }
      }
    },
    opened.privateKeyPem,
    opened.certificatePem,
    undefined,
    {
      idCSRT: "7",
      csrt: "CSRT-DE-HOMOLOGACAO-TESTE"
    }
  );
  const expectedHash = createHash("sha1")
    .update(`CSRT-DE-HOMOLOGACAO-TESTE${result.accessKey}`, "utf8")
    .digest("base64");

  assert.equal(result.signatureValid, true);
  assert.match(result.unsignedXml, /<mod>55<\/mod>/);
  assert.doesNotMatch(result.signedXml, /<infNFeSupl>|<qrCode>|urlChave/);
  assert.match(
    result.unsignedXml,
    /<pag><detPag><tPag>90<\/tPag><vPag>0<\/vPag><\/detPag><\/pag>/
  );
  assert.doesNotMatch(result.unsignedXml, /<CSRT>|NAO-DEVE-SAIR-NO-XML/);
  assert.match(result.unsignedXml, /<idCSRT>07<\/idCSRT>/);
  assert.ok(result.unsignedXml.includes(`<hashCSRT>${expectedHash}</hashCSRT>`));
  assert.match(
    result.unsignedXml,
    /<xNome>NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL<\/xNome>/
  );
  assert.match(
    result.unsignedXml,
    /<xProd>NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL<\/xProd>/
  );

  const xmlValidation = validateNfeXml(result.signedXml);
  assert.deepEqual(xmlValidation.errors, []);
  assert.equal(xmlValidation.valid, true);

  const batch = buildAuthorizationBatch(result.signedXml, "000000000009003");
  const batchValidation = validateAuthorizationBatchXml(batch.batchXml);
  assert.deepEqual(batchValidation.errors, []);
  assert.equal(batchValidation.valid, true);
});

function buildRtcInfNFe(model: 55 | 65, number: number) {
  return {
    versao: "4.00",
    ide: {
      cUF: 41,
      natOp: "VENDA DE MERCADORIA",
      mod: model,
      serie: model === 55 ? 1 : 2,
      nNF: number,
      dhEmi: "2026-07-02T11:00:00-03:00",
      tpNF: 1,
      idDest: 1,
      cMunFG: 4108809,
      cMunFGIBS: 4108809,
      tpImp: model === 55 ? 1 : 4,
      tpEmis: 1,
      tpAmb: 2,
      finNFe: 1,
      indFinal: 1,
      indPres: 1,
      procEmi: 0,
      verProc: "NuvemLocalFiscal"
    },
    emit: {
      CNPJ: "01997929000108",
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
      xNome: "Cliente Teste",
      indIEDest: 9
    },
    det: [
      {
        nItem: 1,
        prod: {
          cProd: "RTC-1",
          cEAN: "SEM GTIN",
          xProd: "Produto RTC",
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
            ICMSSN102: { orig: 0, CSOSN: "102" }
          },
          PIS: {
            PISOutr: { CST: "99", vBC: 0, pPIS: 0, vPIS: 0 }
          },
          COFINS: {
            COFINSOutr: { CST: "99", vBC: 0, pCOFINS: 0, vCOFINS: 0 }
          },
          IBSCBS: {
            CST: "000",
            cClassTrib: "000001",
            gIBSCBS: {
              vBC: "0",
              gIBSUF: {
                pIBSUF: "0.10",
                vIBSUF: "0"
              },
              gIBSMun: {
                pIBSMun: "0.10",
                vIBSMun: "0"
              },
              vIBS: "0",
              gCBS: {
                pCBS: "0.90",
                vCBS: "0"
              }
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
      },
      IBSCBSTot: {
        vBCIBSCBS: "0"
      }
    },
    transp: { modFrete: 9 },
    pag: { detPag: [{ tPag: "01", vPag: 10 }] },
    infRespTec: {
      CNPJ: "65667543000102",
      xContato: "Responsavel Tecnico",
      email: "fiscal@example.com",
      fone: "44999261487"
    }
  };
}

test("preserva campos minimos RTC em NF-e e NFC-e e valida XML/lote no XSD local", () => {
  const password = "senha-rtc";
  const opened = openEncryptedCertificate(
    encryptCertificateBundle(
      {
        pfxBase64: createTestPfx(password).toString("base64"),
        password
      },
      "segredo-rtc"
    ),
    "segredo-rtc"
  );

  const cases = [
    {
      model: 55 as const,
      payload: buildRtcInfNFe(55, 9101),
      qrCodeConfig: undefined
    },
    {
      model: 65 as const,
      payload: buildRtcInfNFe(65, 9102),
      qrCodeConfig: {
        cscId: "1",
        csc: "CSC-DE-HOMOLOGACAO-TESTE",
        qrCodeBaseUrl: "http://www.fazenda.pr.gov.br/nfce/qrcode",
        consultationUrl: "http://www.fazenda.pr.gov.br/nfce/consulta"
      }
    }
  ];

  for (const scenario of cases) {
    const result = generateAndSignNfeXml(
      { infNFe: scenario.payload },
      opened.privateKeyPem,
      opened.certificatePem,
      scenario.qrCodeConfig
    );

    assert.equal(result.signatureValid, true);
    assert.match(result.unsignedXml, new RegExp(`<mod>${scenario.model}</mod>`));
    assert.match(result.unsignedXml, /<cMunFGIBS>4108809<\/cMunFGIBS>/);
    assert.match(result.unsignedXml, /<IBSCBS><CST>000<\/CST><cClassTrib>000001<\/cClassTrib>/);
    assert.match(result.unsignedXml, /<gIBSCBS><vBC>0\.00<\/vBC><gIBSUF><pIBSUF>0.10<\/pIBSUF><vIBSUF>0\.00<\/vIBSUF><\/gIBSUF>/);
    assert.match(
      result.unsignedXml,
      /<IBSCBSTot><vBCIBSCBS>0\.00<\/vBCIBSCBS><gIBS><gIBSUF><vDif>0\.00<\/vDif><vDevTrib>0\.00<\/vDevTrib><vIBSUF>0\.00<\/vIBSUF><\/gIBSUF><gIBSMun><vDif>0\.00<\/vDif><vDevTrib>0\.00<\/vDevTrib><vIBSMun>0\.00<\/vIBSMun><\/gIBSMun><vIBS>0\.00<\/vIBS><vCredPres>0\.00<\/vCredPres><vCredPresCondSus>0\.00<\/vCredPresCondSus><\/gIBS><gCBS><vDif>0\.00<\/vDif><vDevTrib>0\.00<\/vDevTrib><vCBS>0\.00<\/vCBS><vCredPres>0\.00<\/vCredPres><vCredPresCondSus>0\.00<\/vCredPresCondSus><\/gCBS><\/IBSCBSTot>/
    );

    const xmlValidation = validateNfeXml(result.signedXml);
    assert.deepEqual(xmlValidation.errors, []);
    assert.equal(xmlValidation.valid, true);

    const batch = buildAuthorizationBatch(
      result.signedXml,
      `00000000000${scenario.model}`
    );
    const batchValidation = validateAuthorizationBatchXml(batch.batchXml);
    assert.deepEqual(batchValidation.errors, []);
    assert.equal(batchValidation.valid, true);
  }
});

test("normaliza totais RTC pela soma dos itens antes de assinar NFC-e", () => {
  const password = "senha-rtc-total";
  const opened = openEncryptedCertificate(
    encryptCertificateBundle(
      {
        pfxBase64: createTestPfx(password).toString("base64"),
        password
      },
      "segredo-rtc-total"
    ),
    "segredo-rtc-total"
  );
  const payload = structuredClone(buildRtcInfNFe(65, 9201)) as Record<string, unknown> & {
    det: Array<Record<string, unknown>>;
    total: Record<string, unknown>;
  };

  const firstDetail = payload.det[0] as Record<string, unknown>;
  const firstProduct = firstDetail.prod as Record<string, unknown>;
  const firstTax = firstDetail.imposto as Record<string, unknown>;
  const firstRtc = firstTax.IBSCBS as Record<string, unknown>;
  const firstRegularRtc = firstRtc.gIBSCBS as Record<string, unknown>;
  const firstIbsUf = firstRegularRtc.gIBSUF as Record<string, unknown>;
  const firstIbsMun = firstRegularRtc.gIBSMun as Record<string, unknown>;
  const firstCbs = firstRegularRtc.gCBS as Record<string, unknown>;

  firstProduct.vProd = 5;
  firstProduct.vUnCom = 5;
  firstProduct.vUnTrib = 5;
  firstRegularRtc.vBC = 5;
  firstIbsUf.vIBSUF = 0.01;
  firstIbsMun.vIBSMun = 0;
  firstRegularRtc.vIBS = 0.01;
  firstCbs.vCBS = 0.04;

  payload.det = [
    firstDetail,
    structuredClone({
      ...firstDetail,
      nItem: 2,
      prod: {
        ...firstProduct,
        cProd: "RTC-2"
      }
    })
  ];
  payload.total.ICMSTot = {
    ...(payload.total.ICMSTot as Record<string, unknown>),
    vProd: 10,
    vNF: 10
  };
  payload.total.IBSCBSTot = {
    vBCIBSCBS: 10,
    gIBS: {
      gIBSUF: { vIBSUF: 0.01 },
      gIBSMun: { vIBSMun: 0 },
      vIBS: 0.01
    },
    gCBS: { vCBS: 0.09 }
  };

  const result = generateAndSignNfeXml(
    { infNFe: payload },
    opened.privateKeyPem,
    opened.certificatePem,
    {
      cscId: "1",
      csc: "CSC-DE-HOMOLOGACAO-TESTE",
      qrCodeBaseUrl: "http://www.fazenda.pr.gov.br/nfce/qrcode",
      consultationUrl: "http://www.fazenda.pr.gov.br/nfce/consulta"
    }
  );

  assert.equal(result.signatureValid, true);
  assert.match(
    result.unsignedXml,
    /<IBSCBSTot>[\s\S]*<vBCIBSCBS>10\.00<\/vBCIBSCBS>[\s\S]*<vIBSUF>0\.02<\/vIBSUF>[\s\S]*<vIBS>0\.02<\/vIBS>[\s\S]*<vCBS>0\.08<\/vCBS>[\s\S]*<\/IBSCBSTot>/
  );
});

test("preserva duas casas em valores RTC que terminam com zero decimal", () => {
  const password = "senha-rtc-zero-final";
  const opened = openEncryptedCertificate(
    encryptCertificateBundle(
      {
        pfxBase64: createTestPfx(password).toString("base64"),
        password
      },
      "segredo-rtc-zero-final"
    ),
    "segredo-rtc-zero-final"
  );
  const payload = structuredClone(buildRtcInfNFe(65, 9202)) as Record<string, unknown> & {
    det: Array<Record<string, unknown>>;
    total: Record<string, unknown>;
  };

  for (const [index, detail] of payload.det.entries()) {
    const product = detail.prod as Record<string, unknown>;
    const tax = detail.imposto as Record<string, unknown>;
    const rtc = tax.IBSCBS as Record<string, unknown>;
    const regularRtc = rtc.gIBSCBS as Record<string, unknown>;
    const ibsUf = regularRtc.gIBSUF as Record<string, unknown>;
    const ibsMun = regularRtc.gIBSMun as Record<string, unknown>;
    const cbs = regularRtc.gCBS as Record<string, unknown>;

    detail.nItem = index + 1;
    product.vProd = 350;
    product.vUnCom = 350;
    product.vUnTrib = 350;
    regularRtc.vBC = 350;
    ibsUf.vIBSUF = 0.35;
    ibsMun.vIBSMun = 0;
    regularRtc.vIBS = 0.35;
    cbs.vCBS = 3.15;
  }

  payload.det = [
    payload.det[0],
    structuredClone({
      ...payload.det[0],
      nItem: 2,
      prod: {
        ...(payload.det[0].prod as Record<string, unknown>),
        cProd: "RTC-2"
      }
    })
  ];
  payload.total.ICMSTot = {
    ...(payload.total.ICMSTot as Record<string, unknown>),
    vProd: 700,
    vNF: 700
  };
  payload.total.IBSCBSTot = {
    vBCIBSCBS: 700,
    gIBS: {
      gIBSUF: { vIBSUF: 0.7 },
      gIBSMun: { vIBSMun: 0 },
      vIBS: 0.7
    },
    gCBS: { vCBS: 6.3 }
  };

  const result = generateAndSignNfeXml(
    { infNFe: payload },
    opened.privateKeyPem,
    opened.certificatePem,
    {
      cscId: "1",
      csc: "CSC-DE-HOMOLOGACAO-TESTE",
      qrCodeBaseUrl: "http://www.fazenda.pr.gov.br/nfce/qrcode",
      consultationUrl: "http://www.fazenda.pr.gov.br/nfce/consulta"
    }
  );

  assert.match(result.unsignedXml, /<vBC>350\.00<\/vBC>/);
  assert.match(result.unsignedXml, /<vIBSMun>0\.00<\/vIBSMun>/);
  assert.match(result.unsignedXml, /<vBCIBSCBS>700\.00<\/vBCIBSCBS>/);
  assert.match(result.unsignedXml, /<vIBSUF>0\.70<\/vIBSUF>/);
  assert.match(result.unsignedXml, /<vIBS>0\.70<\/vIBS>/);
  assert.match(result.unsignedXml, /<vCBS>6\.30<\/vCBS>/);

  const xmlValidation = validateNfeXml(result.signedXml);
  assert.deepEqual(xmlValidation.errors, []);
  assert.equal(xmlValidation.valid, true);
});
