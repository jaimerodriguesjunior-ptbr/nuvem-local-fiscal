import assert from "node:assert/strict";
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
    new RegExp(`${result.accessKey}\\|2\\|2\\|1\\|838B838AE69BEE8FA455ABD43A7B6FAD32BF1089`)
  );
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
        pag: { detPag: [{ tPag: "01", vPag: 270 }] },
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
});
