import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { danfeTextWidth, wrapDanfeText } from './danfe-text.js';

test('quebra codigos completos com a largura real das duas fontes', () => {
  for (const font of ['F1', 'F2']) {
    for (const code of ['0VO5540L 3114 55', 'MW'.repeat(30), 'SKU-1234567890-ABCDEFGHIJKLMNOPQRSTUVWXYZ-9876543210']) {
      const lines = wrapDanfeText(code, 50, 5.5, font);
      assert.equal(lines.join('').replace(/\s/g, ''), code.replace(/\s/g, ''));
      for (const line of lines) assert.ok(danfeTextWidth(line, 5.5, font) <= 50);
    }
  }
});

test('DANFE pagina todos os itens e observacoes sem mudar o XML', async () => {
  process.env.STATE_FILE = `./storage/test-danfe-${process.pid}.json`;
  process.env.JWT_SECRET = 'jwt-test';
  process.env.CERTIFICATE_ENCRYPTION_KEY = 'certificate-test';
  process.env.SUPABASE_URL = '';
  process.env.NEXT_PUBLIC_SUPABASE_URL = '';
  process.env.SUPABASE_SERVICE_ROLE_KEY = '';
  process.env.AUTO_TRANSMIT_HOMOLOGATION = 'false';
  process.env.RECOVERY_V1_ENABLED = 'false';
  const { buildApp } = await import('../app.js');
  const app = buildApp();
  await app.ready();
  try {
    const auth = await app.inject({ method: 'POST', url: '/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'grant_type=client_credentials&client_id=local-client&client_secret=local-secret&scope=empresa%20nfe' });
    assert.equal(auth.statusCode, 200);
    const bearer = { authorization: `Bearer ${auth.json().access_token}` };
    const codes = Array.from({ length: 35 }, (_, index) => `PRODUTO-${String(index).padStart(3, '0')}-${'MW'.repeat(20)}-FIM`);
    const notes = `${'OBSERVACAO COMPLETA COM AR E REFERENCIA DE ORIGEM. '.repeat(90)}ULTIMA OBSERVACAO PRESERVADA`;
    const document = app.store.createDocument({ tipoDocumento: 'NFe', issuerCnpj: '12345678000195', ambiente: 'homologacao', payloadOriginal: {}, payloadNormalizado: {}, forcedStatus: 'autorizado' });
    document.xml = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe><ide><nNF>123</nNF><serie>1</serie><tpAmb>2</tpAmb><natOp>VENDA</natOp><tpNF>1</tpNF></ide><emit><CNPJ>12345678000195</CNPJ><xNome>EMPRESA DE TESTE COM RAZAO SOCIAL LONGA PARA CONFERIR O CABECALHO</xNome></emit>${codes.map((code, index) => `<det nItem="${index + 1}"><prod><cProd>${code}</cProd><xProd>DESCRICAO COMPLETA DO PRODUTO COM VARIACAO DE MODELO COR E TAMANHO PARA IMPRESSAO EM MAIS DE UMA LINHA</xProd><NCM>90031100</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1</qCom><vUnCom>1</vUnCom><vProd>1</vProd></prod></det>`).join('')}<total><ICMSTot><vProd>35</vProd><vNF>35</vNF></ICMSTot></total><infAdic><infCpl>${notes}</infCpl></infAdic></infNFe></NFe></nfeProc>`;
    const original = document.xml;
    const response = await app.inject({ method: 'GET', url: `/nfe/${document.id}/pdf`, headers: bearer });
    assert.equal(response.statusCode, 200, response.body);
    const pdf = response.rawPayload.toString('latin1');
    const count = Number(pdf.match(/\/Type \/Pages \/Kids \[[^\]]+\] \/Count (\d+)/)?.[1]);
    assert.ok(count > 1);
    assert.equal((pdf.match(/\/Type \/Page \/Parent/g) || []).length, count);
    const runs = [...pdf.matchAll(/BT \/(F[12]) ([\d.]+) Tf ([\d.-]+) ([\d.-]+) Td \((.*?)\) Tj ET/g)];
    const text = runs.map(run => run[5]).join('').replace(/\s/g, '');
    for (const code of codes) assert.ok(text.includes(code), code);
    const printedNotes = runs.filter(run => Number(run[3]) === 11 && Number(run[4]) < 80 && Number(run[2]) === 5.5)
      .map(run => run[5]).join('').replace(/\s/g, '');
    assert.equal(printedNotes, notes.replace(/\s/g, ''));
    for (const run of runs) {
      const [, font, sizeText, xText, yText, content] = run;
      const size = Number(sizeText), x = Number(xText), y = Number(yText);
      if (x === 10 && y > 104 && y < 342 && size === 5.5) assert.ok(x + danfeTextWidth(content, size, font) <= 61);
      if (x === 11 && y >= 24 && y < 80 && size === 5.5) assert.ok(x + danfeTextWidth(content, size, font) <= 395);
    }
    assert.equal(document.xml, original);
    assert.equal(document.status, 'autorizado');
    for (let index = 1; index <= count; index++) assert.match(pdf, new RegExp(`Folha ${index}/${count}`));
    if (process.env.DANFE_TEST_OUTPUT) {
      await mkdir(process.env.DANFE_TEST_OUTPUT, { recursive: true });
      await writeFile(join(process.env.DANFE_TEST_OUTPUT, 'danfe-itens-longos.pdf'), response.rawPayload);
    }
  } finally {
    await app.close();
    await rm(process.env.STATE_FILE!, { force: true });
  }
});
