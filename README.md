# nuvem-local-fiscal

API fiscal propria para substituir a dependencia da Nuvem Fiscal nos sistemas
atuais, preservando o contrato externo sempre que isso for seguro.

## Estado atual

Em `17/06/2026`, o estado real deste repo e:

- `NFC-e` em homologacao funcionando ponta a ponta
- `NF-e` em homologacao funcionando ponta a ponta
- `NFS-e` Toledo/Equiplano funcionando ponta a ponta em homologacao
- `NFS-e` Guaira/IPM com emissao homologada, XML/PDF locais e cancelamento
  municipal implementado, ainda com pendencias especificas de consulta
  municipal/cancelamento em notas de teste
- persistencia principal em `Supabase`
- certificados A1 e configuracoes por empresa/ambiente persistidos
- VPS homologada com HTTPS, `systemd`, Nginx e admin protegido
- producao fiscal ainda bloqueada neste servico

O documento principal do projeto e [`NUVEMLOCALFISCAL.md`](NUVEMLOCALFISCAL.md).
Ele deve ser tratado como a fonte mais completa do estado operacional.

## Objetivo pratico

Os sistemas clientes devem continuar chamando rotas e payloads proximos dos que
ja usam hoje. A mudanca desejada no cliente continua sendo, em regra:

- URL
- `CLIENT_ID`
- `CLIENT_SECRET`

As adaptacoes de compatibilidade devem acontecer dentro da Nuvem Local Fiscal,
nao nos programas clientes, salvo autorizacao explicita.

## Endpoints ja exercitados

- `POST /oauth/token`
- `POST /nfe`
- `GET /nfe/:id`
- `GET /nfe/:id/xml`
- `GET /nfe/:id/pdf`
- `GET /nfe/:id/cancelamento/xml`
- `POST /nfce`
- `GET /nfce/:id`
- `POST /nfce/:id/cancelar`
- `GET /nfce/:id/xml`
- `GET /nfce/:id/pdf`
- `GET /nfce/:id/cancelamento/xml`
- `POST /nfse/dps`
- `GET /nfse/:id`
- `GET /nfse/:id/xml`
- `GET /nfse/:id/pdf`
- `POST /nfse/:id/cancelamento`
- `POST /nfse/:id/cancelar`
- `GET /nfse/:id/cancelamento/xml`
- `POST /empresas`
- `PUT /empresas/:cnpj`
- `GET /empresas/:cnpj`
- `PUT /empresas/:cnpj/certificado`
- `PUT /empresas/:cnpj/nfce`
- `GET /empresas/:cnpj/nfce`
- `PUT /empresas/:cnpj/nfse`
- `POST /empresas/:cnpj/nfse`
- `GET /empresas/:cnpj/nfse`
- `POST /nfce/inutilizacoes`
- `GET /nfce/inutilizacoes/:id`
- `GET /nfce/inutilizacoes/:id/xml`
- `GET /nfce/inutilizacoes/:id/resposta/xml`
- `POST /nfe/inutilizacoes`
- `GET /nfe/inutilizacoes/:id`
- `GET /nfe/inutilizacoes/:id/xml`
- `GET /nfe/inutilizacoes/:id/resposta/xml`

## Como rodar

1. Instale dependencias:

```powershell
npm install
```

2. Suba em modo desenvolvimento:

```powershell
npm run dev
```

3. Abra:

- API: `http://localhost:3001`
- Admin: `http://localhost:3001/admin`
- Healthcheck: `http://localhost:3001/health`
- Readiness: `http://localhost:3001/ready`

## Validacoes locais

Comandos uteis:

```powershell
npm run typecheck
npm test
npm run build
```

No estado atual, esses tres comandos devem passar antes de qualquer deploy ou
teste fiscal mais sensivel.

## Deploy

O roteiro de VPS com `systemd`, Nginx, HTTPS e backup esta em
[`docs/DEPLOY_VPS.md`](docs/DEPLOY_VPS.md).

## Observacoes operacionais

- este repo e homologado; producao continua bloqueada por seguranca
- os sistemas clientes ainda podem permanecer na Nuvem Fiscal em producao
- a atualizacao para regras novas de julho de 2026 ainda nao foi tratada neste
  repo como trabalho fechado; isso fica para a proxima etapa
- o pacote XSD local da NF-e/NFC-e e `PL_010c`, publicado em `26/03/2026`, mas
  isso nao deve ser lido sozinho como garantia de aderencia completa a todas as
  reformas fiscais novas

## Schemas

Os schemas locais foram obtidos do Portal Nacional da NF-e, pacote `PL_010c`,
com origem registrada em
[`schemas/nfe/official-010c/README.md`](schemas/nfe/official-010c/README.md).
