# Compatibilidade v0

## Mantido neste v0

- token via `POST /oauth/token`
- emissao por `POST /nfe` e `POST /nfce`
- consulta por `GET /:tipo/:id`
- cancelamento por `POST /:tipo/:id/cancelar`
- download mock de XML e PDF
- upload mock de certificado por CNPJ

## Ainda nao mantido

- assinatura digital real
- resposta bit a bit igual a Nuvem Fiscal
- webhooks
- consulta a SEFAZ
- NFS-e

## Regra atual

Se algum cliente depender de um campo extra, a compatibilidade deve ser ajustada na borda sem contaminar o modelo interno.
