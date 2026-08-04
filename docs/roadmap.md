# Roadmap atual

## Estado consolidado ate 04/08/2026

- [x] autenticacao compativel via `POST /oauth/token`
- [x] persistencia principal em `Supabase`
- [x] upload real e criptografia de certificado `A1`
- [x] geracao de XML `NF-e` e `NFC-e`
- [x] assinatura digital e verificacao local
- [x] validacao pelos XSD oficiais `PL_010c`
- [x] homologacao `NFC-e` ponta a ponta
- [x] homologacao `NF-e` ponta a ponta
- [x] inutilizacao real `NFC-e`
- [x] inutilizacao real `NF-e`
- [x] cancelamento real `NFC-e`
- [x] cancelamento real `NF-e`
- [x] `NFS-e` Toledo/Equiplano com emissao, consulta, XML, PDF e cancelamento
- [x] `NFS-e` Guaira/IPM com emissao homologada, XML/PDF local, consulta e
  cancelamento municipal implementados
- [x] VPS homologada com HTTPS, Nginx, `systemd` e admin protegido
- [x] producao controlada habilitavel por `FISCAL_PRODUCTION_ENABLED`, com
  verificacao por `/ready`

## Pendencias ainda abertas

- [ ] fechar retries agendados e processamento distribuido
- [ ] endurecer conciliacao operacional de eventos e falhas intermitentes
- [ ] concluir consulta/cancelamento Guaira em cenarios municipais de teste que
  a IPM efetivamente reconheca como consultaveis/cancelaveis
- [ ] revisar documentacao operacional sempre que novos marcos forem fechados

## Frentes em evolucao

Itens que ainda exigem trabalho, mas nao bloqueiam o MVP atualmente aberto:

- [ ] adequacao completa as reformas fiscais exigidas a partir de `01/07/2026`
- [ ] adaptador para a NFS-e Nacional, com parametros municipais, homologacao e
  ativacao gradual por empresa
- [ ] migracao controlada dos sistemas clientes publicados para a Nuvem Local

## Direcao para o proximo ciclo

Quando voltar a mexer no projeto, a ordem recomendada e:

1. fechar retries agendados, processamento distribuido e conciliacao de falhas
2. obter evidencia municipal de consulta e cancelamento para Guaira/IPM
3. revisar as regras RTC em vigor antes de abrir novos fluxos fiscais
4. iniciar a transicao para a NFS-e Nacional de forma isolada e reversivel
