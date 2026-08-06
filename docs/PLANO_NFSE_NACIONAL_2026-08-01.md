# Plano de transicao para a NFS-e Nacional

## Objetivo

Preparar a Nuvem Local Fiscal para a migracao de Toledo/PR e Guaira/PR para a
NFS-e Nacional, iniciando o trabalho em **01/08/2026**, sem alterar o fluxo que
esta funcionando nas emissoes de julho.

Este documento registra a decisao arquitetural e o plano inicial. Ele nao
autoriza alteracao de codigo, configuracao, banco, numeracao ou deploy antes da
revisao do plano.

Implementacao iniciada em 06/08/2026 na branch
`feat/nfse-sistema-nacional`. O estado tecnico da primeira fatia esta em
`docs/NFSE_NACIONAL_IMPLEMENTACAO.md`.

## Decisao arquitetural

A NFS-e Nacional tera um unico adaptador tecnico na Nuvem Local. Nao sera criado
um fluxo completo duplicado para Toledo e outro para Guaira.

O adaptador nacional recebera a configuracao fiscal do municipio e da empresa
antes de montar a DPS. Portanto, o leiaute e a comunicacao serao comuns, mas os
valores e regras poderao variar por municipio.

### Camadas previstas

```text
Sistema cliente
    -> contrato interno normalizado de NFS-e
    -> adaptador NFS-e Nacional
    -> parametros do municipio + cadastro fiscal da empresa
    -> SEFIN Nacional
```

### Parametros que continuam sendo municipais

- codigo do municipio e ambiente;
- inscricao municipal e cadastro do prestador;
- codigo de tributacao municipal;
- codigo de servico nacional e NBS, quando aplicavel;
- aliquota e incidencia do ISSQN;
- retencoes, regime tributario e demais regras fiscais;
- regras e prazos de cancelamento/substituicao;
- identificacao e descricao dos servicos aceitos pelo municipio.

Esses dados devem ser tratados como configuracao versionada por municipio,
empresa e ambiente, e nao como `if` espalhado no gerador de payload.

## Compatibilidade com emissores municipais

Os conectores atuais de Toledo/Equiplano e Guaira/IPM devem permanecer
isolados e preservados durante a transicao. A ativacao do adaptador nacional
deve ocorrer por municipio/empresa, preferencialmente por uma chave de
roteamento ou feature flag.

Enquanto a mudanca oficial nao entrar em vigor, o fluxo municipal continua
disponivel. Depois da virada, o roteamento passa para a NFS-e Nacional. Uma
cidade que ainda utilize emissor municipal proprio continuara usando seu
conector especifico ate a respectiva migracao.

## Plano de trabalho a partir de 01/08/2026

1. Conferir os comunicados oficiais, credenciais, certificados e autorizacoes
   de Toledo e Guaira.
2. Estudar a documentacao vigente da API, DPS, consulta, cancelamento e
   distribuicao da NFS-e Nacional.
3. Mapear os payloads atuais para um contrato interno comum, sem obrigar os
   sistemas clientes a conhecerem detalhes de cada prefeitura.
4. Implementar a consulta e armazenamento dos parametros municipais.
5. Implementar o adaptador nacional de forma separada dos conectores atuais.
6. Testar emissao, consulta, XML, PDF, cancelamento, rejeicao, polling e
   reconciliacao de status.
7. Homologar primeiro uma empresa em Toledo e uma em Guaira.
8. Ativar gradualmente por empresa, mantendo os conectores antigos como
   fallback operacional durante a janela permitida.

## Itens que nao devem ser alterados nesta etapa

- fluxos de NF-e e NFC-e;
- fluxos atuais de NFS-e municipal;
- numeracao e series existentes;
- regras de CFOP;
- certificados, credenciais ou variaveis de producao sem validacao;
- deploy de producao antes dos testes e de uma aprovacao explicita.

## Referencias oficiais

- Documentacao tecnica: https://www.gov.br/nfse/pt-br/nfs-e-via/documentacao-tecnica
- Documentacao atual: https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/documentacao-atual
- FAQ da NFS-e Nacional: https://www.gov.br/nfse/pt-br/biblioteca/copy_of_perguntas-frequentes/copy_of_faq-nfs-e
- Toledo - transicao para a NFS-e Nacional: https://www.toledo.pr.gov.br/secretarias/secretaria_fazenda_captacao_recursos/transicao-para-nfs-e-nacional
- Guaira - emissao exclusiva pelo emissor nacional a partir de 01/09/2026: https://guaira.pr.gov.br/noticias/noticia/6935

## Registro operacional

Em 30/07/2026, a orientacao e **nao alterar o fluxo de emissao de julho**.
O trabalho de implementacao e homologacao comeca em 01/08/2026, com mudancas
isoladas e reversiveis ate que cada cidade esteja validada.
