# Arquitetura v0

## Objetivo

Validar contrato externo e fluxo operacional antes de construir:

- persistencia real
- fila
- assinatura de XML
- transmissao SEFAZ

## Estrutura

- `src/server.ts`: bootstrap HTTP
- `src/app.ts`: composicao da aplicacao Fastify
- `src/routes/`: endpoints da API e admin
- `src/store.ts`: armazenamento em memoria
- `public admin`: embutido pela rota `/admin`

## Escolha do v0

O foco inicial nao e fidelidade fiscal real. O foco e:

- aceitar chamadas parecidas com as atuais
- devolver respostas compativeis
- expor rastreabilidade visivel
- permitir plugar um sistema cliente real cedo

## Assinatura local

O fluxo tecnico atual e:

1. validar e abrir o PFX
2. conferir validade e CNPJ quando presente no certificado
3. criptografar PFX e senha para persistencia local
4. montar `NFe/infNFe` a partir do payload original
5. calcular chave de acesso e `cDV`
6. assinar `infNFe` com XMLDSig
7. verificar a assinatura com o certificado publico
8. salvar XML gerado e XML assinado separadamente

A autorizacao mock e independente da assinatura. A integracao SEFAZ ainda nao
existe.
