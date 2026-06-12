# Roadmap sugerido

## Fase 0

- validar contrato com 1 sistema cliente real
- mapear campos realmente usados
- ajustar respostas mock

## Fase 1

- PostgreSQL
- hash de `client_secret`
- persistencia de documentos e eventos
- login admin de verdade

## Fase 2

- [x] upload real e criptografia de certificado
- [x] XML fiscal inicial
- [x] assinatura e verificacao local
- [x] validacao pelos XSD oficiais da NF-e 4.00 (`PL_010c`)
- [ ] normalizacao fiscal completa por CST/CSOSN e grupos opcionais

## Fase 3

- [x] homologacao NFC-e ponta a ponta
- [x] polling/status real
- [x] XML autorizado e DANFE
- [x] inutilizacao real em homologacao
- [x] cancelamento real em homologacao

## Fase 4

- homologacao NF-e
- filas, retries e conciliacao de eventos
