# Rejeição E1235 em homologação — 27/10/2026

A SEFIN rejeitou a DPS de homologação da NHT antes de validar as regras
cadastrais: após `tpEmit`, o XML enviava `cLocEmi`, mas o esquema esperava
`cMotivoEmisTI` (opcional) ou `finNFSe` (obrigatório).

## Evidência oficial

O pacote de homologação publicado em 20/10/2026 mudou `TCInfDPS`:

- `finNFSe`, valor `0` para nota regular, passou a preceder `cLocEmi`;
- em `TCCServ`, NBS e código interno passaram a preceder a descrição.

Fontes:

- https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita
- https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita/esquemas_prod_restrita_20261020.zip
- https://www.gov.br/nfse/pt-br/noticias/cgnfs-e-informa-disponibilizadas-no-ambiente-de-testes-o-release-1-das-evolucoes-da-nota-tecnica-009

## Correção

O gerador emite a finalidade regular e a nova ordem dos campos em homologação.
A validação XSD usa o novo pacote oficial nesse ambiente. Os arquivos XSD
foram copiados do ZIP oficial, sem editar as regras.

Produção conserva o gerador e o pacote de validação já utilizados. A seleção
do XSD agora recebe explicitamente o ambiente do documento.

Os testes de regressão assinam XMLs de ambos os ambientes, validam cada um
com o pacote correto e comprovam que o esquema atualizado detecta a ausência
de `finNFSe` antes de transmitir.

Esta correção é no serviço Nuvem Local Fiscal, compartilhado pelos clientes.
É necessário publicar a versão corrigida da API para alterar o XML gerado
no servidor. A aplicação local da correção não equivale a uma publicação.
