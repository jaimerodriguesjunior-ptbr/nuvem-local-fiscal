# Roadmap atual

## Estado consolidado ate 17/06/2026

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
- [x] `NFS-e` Guaira/IPM com emissao homologada, XML/PDF local e cancelamento
  municipal implementado
- [x] VPS homologada com HTTPS, Nginx, `systemd` e admin protegido

## Pendencias ainda abertas

- [ ] fechar retries agendados e processamento distribuido
- [ ] endurecer conciliacao operacional de eventos e falhas intermitentes
- [ ] concluir consulta/cancelamento Guaira em cenarios municipais de teste que
  a IPM efetivamente reconheca como consultaveis/cancelaveis
- [ ] revisar documentacao operacional sempre que novos marcos forem fechados

## Frente propositalmente adiada

Itens conscientemente adiados para a proxima etapa:

- [ ] adequacao completa as reformas fiscais exigidas a partir de `01/07/2026`
- [ ] liberacao de producao neste servico
- [ ] novo caminho alternativo para eventual canal nacional de `NFS-e`

## Direcao para o proximo ciclo

Quando voltar a mexer no projeto, a ordem recomendada e:

1. revisar impacto real das regras de julho de 2026 no contrato atual
2. decidir o menor recorte seguro para `NF-e` e `NFC-e`
3. so depois tocar codigo fiscal
4. manter producao dos sistemas clientes na Nuvem Fiscal ate a etapa nova estar
   segura
