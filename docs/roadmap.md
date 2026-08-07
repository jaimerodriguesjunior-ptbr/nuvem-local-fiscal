# Roadmap atual

## Estado consolidado ate 07/08/2026

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
- [x] adaptador Nacional com DPS 1.01, assinatura, transmissão e autorização
  em produção restrita para Toledo/Kabroski
- [x] VPS homologada com HTTPS, Nginx, `systemd` e admin protegido
- [x] producao controlada habilitavel por `FISCAL_PRODUCTION_ENABLED`, com
  verificacao por `/ready`

## Pendencias ainda abertas

- [ ] fechar retries agendados e processamento distribuido
- [ ] endurecer conciliacao operacional de eventos e falhas intermitentes
- [ ] esclarecer a data de autorização da NHT no CNC de Guaíra
- [ ] concluir consulta/cancelamento Guaira em cenarios municipais de teste que
  a IPM efetivamente reconheca como consultaveis/cancelaveis

## Frentes em evolucao

Itens que ainda exigem trabalho, mas nao bloqueiam o MVP atualmente aberto:

- [ ] adequacao completa as reformas fiscais exigidas a partir de `01/07/2026`
- [ ] testes de contrato com Autoeletrica e Apoio-Contábil
- [ ] ativação Nacional por empresa em Toledo
- [ ] roteamento explícito Nacional/municipal e contingência auditada

## Direcao para o proximo ciclo

Quando voltar a mexer no projeto, a ordem recomendada e:

1. criar os testes de contrato dos dois clientes
2. validar as três empresas do Apoio-Contábil em Toledo
3. implementar e testar a contingência municipal
4. obter evidência municipal de consulta e cancelamento para Guaíra/IPM
5. fechar retries agendados, processamento distribuído e conciliação de falhas
