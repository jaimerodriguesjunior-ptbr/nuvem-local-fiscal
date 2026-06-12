# nuvem-local-fiscal

V0 local para validar a ideia do `nuvemlocalfiscal` antes da integracao real com SEFAZ.

## O que existe neste v0

- `POST /oauth/token` com `client_credentials`
- `POST /nfe` e `POST /nfce`
- `GET /nfe/:id` e `GET /nfce/:id`
- `POST /nfe/:id/cancelar` e `POST /nfce/:id/cancelar`
- `GET /nfe/:id/xml`, `GET /nfce/:id/xml`
- `GET /nfe/:id/pdf`, `GET /nfce/:id/pdf`
- `PUT /empresas/:cnpj/certificado`
- `GET /admin` com tela local para inspecao de clients, emitentes, certificados e documentos
- geracao de XML NF-e/NFC-e 4.00 a partir de `infNFe`
- assinatura XMLDSig com certificado A1/PFX
- verificacao local da assinatura antes de salvar o XML
- validacao contra os XSD oficiais NF-e/NFC-e `PL_010c`

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

## Credenciais padrao

- API client:
  - `client_id`: `local-client`
  - `client_secret`: `local-secret`
- Admin:
  - `usuario`: `admin`
  - `senha`: `admin`

## Observacao

Este v0 persiste emitentes, certificados e documentos em `storage/mock-state.json`.
Tokens sao assinados e continuam validos durante seu prazo mesmo apos reiniciar o processo.

O PFX e a senha ficam dentro de um bundle AES-256-GCM protegido por
`CERTIFICATE_ENCRYPTION_KEY`. O arquivo de estado e certificados locais estao
ignorados pelo Git, mas ainda devem ser tratados como dados sensiveis.

## Teste de XML assinado

1. Emita uma NFC-e para o documento aparecer no painel.
2. No emitente correspondente, envie o arquivo `.pfx` e a senha.
3. No documento, clique em `Gerar e assinar XML`.
4. Confirme `assinatura valida` e `XSD oficial valido`.
5. Use `Baixar XML assinado` para inspecionar o artefato antes da autorizacao mock.

Assinar o XML nao significa autorizar a nota. A autorizacao continua sendo uma
acao mock separada no painel, e nenhuma chamada a SEFAZ e feita nesta versao.

Os schemas foram obtidos do Portal Nacional da NF-e, pacote `PL_010c`,
publicado em 26/03/2026. A origem esta registrada em
`schemas/nfe/official-010c/README.md`.
