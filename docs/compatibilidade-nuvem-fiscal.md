# Compatibilidade atual com a Nuvem Fiscal

## Regra central

A Nuvem Local Fiscal deve preservar compatibilidade pratica com a Nuvem Fiscal
sempre que isso nao criar risco fiscal.

Em regra:

- os clientes continuam montando payloads proximos dos atuais
- os clientes continuam chamando rotas proximas das atuais
- a traducao para SEFAZ ou provedor municipal acontece dentro deste repo

## O que ja esta mantido na pratica

- token via `POST /oauth/token`
- emissao por `POST /nfe`, `POST /nfce` e `POST /nfse/dps`
- consulta por `GET /nfe/:id`, `GET /nfce/:id` e `GET /nfse/:id`
- cancelamento por `POST /nfe/:id/cancelar`, `POST /nfce/:id/cancelar`,
  `POST /nfse/:id/cancelamento` e alias `POST /nfse/:id/cancelar`
- download de XML e PDF por rotas compativeis
- upload de certificado por CNPJ
- respostas publicas com campos operacionais como:
  - `id`
  - `status`
  - `numero`
  - `serie`
  - `chave`
  - `protocolo`
  - `motivo`
  - `motivo_status`
  - `mensagens`
  - `xml_url`
  - `pdf_url`

## Compatibilidades adicionais ja aplicadas

- alias legado de consulta `NF-e` em rota antiga de `NFC-e`, quando o UUID
  pertence a uma `NF-e`
- alias legado de cancelamento em `/nfse/:id/cancelar` para `NF-e` quando o
  cliente chama a rota antiga
- normalizacao de `tPag=90` com `vPag` positivo para evitar rejeicao operacional
- armazenamento local do `CSC` por empresa/ambiente, sem exigir que todo cliente
  reenvie isso no payload

## O que ainda nao deve ser prometido como fechado

- paridade bit a bit com todas as respostas da Nuvem Fiscal
- cobertura generica de `NFS-e` para qualquer prefeitura
- aderencia completa ja concluida as regras novas de julho de 2026
- operacao de producao liberada neste servico

## Regra de projeto

Se um cliente depender de algum campo extra ou variacao pequena de contrato, a
compatibilidade deve ser ajustada na borda, sem espalhar gambiarra pelo motor
interno e sem editar o repo cliente sem autorizacao explicita.
