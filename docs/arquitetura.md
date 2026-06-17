# Arquitetura atual

## Objetivo

`nuvem-local-fiscal` nao e mais um prototipo apenas de mock local. Hoje ele ja
atua como uma camada de compatibilidade fiscal homologada para:

- `NF-e`
- `NFC-e`
- `NFS-e` por provedor municipal

O objetivo continua sendo absorver as diferencas entre os sistemas clientes e os
provedores fiscais reais dentro deste repo.

## Estrutura principal

- `src/server.ts`: bootstrap HTTP
- `src/app.ts`: composicao da aplicacao Fastify
- `src/routes/`: rotas publicas e rotas administrativas
- `src/store.ts`: camada de estado local com espelho para persistencia
- `src/lib/supabase-persistence.ts`: persistencia principal no `Supabase`
- `src/lib/document-processing.ts`: assinatura, validacao e transmissao NF-e/NFC-e
- `src/lib/nfe-xml.ts`: geracao e assinatura XML da NF-e/NFC-e
- `src/lib/sefaz-*.ts`: autorizacao, consulta, inutilizacao e cancelamento SEFAZ
- `src/lib/nfse-provider.ts`: despacho por provedor municipal
- `src/lib/nfse-toledo-equiplano.ts`: conector NFS-e Toledo/Equiplano
- `src/lib/nfse-guaira-ipm.ts`: conector NFS-e Guaira/IPM
- `src/admin-page.ts`: UI administrativa embutida

## Fluxo estadual atual

Para `NF-e` e `NFC-e`, o fluxo real atual e:

1. receber payload compativel na borda
2. localizar emitente, ambiente e certificado
3. gerar XML fiscal
4. assinar com certificado `A1`
5. validar no XSD local
6. consultar chave na SEFAZ antes de retransmitir
7. transmitir em homologacao
8. persistir XML, retorno, protocolo e eventos
9. disponibilizar XML/PDF por rotas compativeis

## Fluxo municipal atual

Para `NFS-e`, a arquitetura ja separa provedores por conector.

Hoje existem dois caminhos concretos:

- `toledo-equiplano`
- `guaira-ipm`

O contrato externo continua unico para os clientes, mas a traducao para XML,
autenticacao, consulta e cancelamento fica isolada por provedor.

Essa separacao e importante para permitir novos caminhos futuros, inclusive um
canal nacional de NFS-e, sem quebrar as rotas publicas atuais.

## Persistencia

Persistencia principal atual:

- `Supabase` para emitentes, certificados, configuracoes, documentos e eventos

Persistencia auxiliar local:

- estado local para desenvolvimento e contingencia controlada

## Limites assumidos hoje

- producao continua bloqueada neste servico
- homologacao e o foco operacional atual
- filas, retries distribuidos e endurecimento operacional ainda nao estao
  fechados como etapa final
- reforma fiscal de julho de 2026 ainda nao foi tratada aqui como frente
  concluida
