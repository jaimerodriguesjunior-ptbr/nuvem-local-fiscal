# NFS-e Nacional — estado e plano operacional

Este é o documento atual da frente NFS-e Nacional. Registros históricos e
planos anteriores foram consolidados aqui para evitar decisões baseadas em
documentação defasada.

## Estado em 07/08/2026

O adaptador `nfse-nacional` está integrado à Nuvem Local Fiscal e mantém o
contrato HTTP existente de `POST /nfse/dps`. A Nuvem Local:

- roteia por empresa, município e ambiente;
- gera e assina DPS no leiaute 1.01;
- valida o XML localmente contra os schemas de produção restrita;
- transmite manualmente para a SEFIN Nacional em homologação;
- persiste status, eventos, XML e DANFSe;
- mantém a transmissão Nacional automática desativada;
- impede que uma configuração Nacional de homologação altere a produção
  municipal;
- mantém numeração Nacional própria por empresa/ambiente.

Typecheck e testes automatizados passam: 146 testes, 0 falhas.

## Evidências de homologação

### Toledo — Kabroski Automotiva

O fluxo completo foi autorizado pela SEFIN Nacional em produção restrita:

- DPS série 1, número 7;
- geração e assinatura local;
- transmissão para a SEFIN;
- autorização Nacional;
- XML e DANFSe disponíveis na Nuvem Local.

Durante o teste foram confirmadas as regras de Toledo:

- a IM não deve ser informada na DPS quando não há informação complementar no
  CNC do município;
- `1.2001.31.00` é categoria-pai; para veículos rodoviários motorizados foi
  usado o código folha `1.2001.31.10` (`120013110`);
- para ME/EPP, o grupo `totTrib` deve informar `pTotTribSN`, sem
  `indTotTrib`.

A produção da Kabroski permanece Toledo/Equiplano, com sequência municipal
  preservada. A homologação Nacional está separada e sem transmissão
  automática.

### Guaíra — NHT

A DPS Nacional chegou à SEFIN em produção restrita, mas foi rejeitada por:

`E0025: A data de competência informada na DPS deve ser igual ou posterior à
data de autorização de uso do emissor registrada no CNC.`

Isso não indica falha do adaptador. O portal municipal informa que Guaíra
passará à emissão exclusiva Nacional em 01/09/2026, mas não exibe a data da
NHT registrada no CNC. A NHT foi restaurada na produção municipal Guaíra/IPM;
nenhuma nova tentativa Nacional deve ser feita até esclarecer a data efetiva.

## Auditoria dos clientes

Autoeletrica e Apoio-Contábil já enviam o contrato-base `POST /nfse/dps` com
`infDPS`, tomador, serviço, município e valores. Ambos ainda carregam detalhes
do contrato municipal:

- `cTribNac` pode chegar formatado como `14.01`, em vez de seis dígitos;
- `cTribMun` pode chegar no formato municipal longo;
- NBS não é enviado pelo cliente;
- regime tributário e regras de IM vêm da configuração da empresa;
- o Apoio-Contábil condiciona a sincronização NFS-e à existência de login e
  senha, o que não serve para Equiplano e Nacional;
- a Autoeletrica ainda monta configuração municipal IPM durante a sincronização.

O contrato desejado é um payload comum, com blocos opcionais `municipal` e
`nacional`. O cliente não deve precisar conhecer o XML Nacional; a Nuvem Local
deve escolher o bloco pela configuração de roteamento da empresa.

## Plano para 07/08/2026

1. Criar testes de contrato com payloads reais da Autoeletrica e do
   Apoio-Contábil, sem transmissão externa.
2. Tornar a normalização Nacional tolerante aos códigos municipais legados:
   usar o código Nacional configurado quando o valor recebido não tiver o
   formato Nacional válido.
3. Definir configuração Nacional por empresa para `cTribNac`, NBS, Simples,
   tributação e regra de IM.
4. Corrigir a sincronização dos dois clientes para não exigir login/senha
   municipal quando o provedor for Nacional ou Equiplano.
5. Validar uma empresa de cada cliente em Toledo, em homologação Nacional.
6. Implementar o roteamento explícito `auto`, `nacional` ou `municipal`.
7. Preservar o conector municipal como contingência, com configuração,
   certificado, credenciais, sequência e endpoint previamente validados.
8. Documentar um procedimento de contingência: nunca reutilizar uma DPS/RPS
   depois de uma transmissão externa incerta; uma troca de provedor gera novo
   documento e deixa evento de auditoria.

## Critério para considerar Toledo pronto

As três empresas do Apoio-Contábil e as empresas Toledo da Autoeletrica devem
ter configuração Nacional individual, teste autorizado em produção restrita e
consulta local de XML/DANFSe. Só então a emissão Nacional deve ser liberada
como padrão. O municipal permanece desativado como padrão, mas pronto para
ativação manual controlada.

## Referências oficiais

- [Documentação técnica da produção restrita](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita/documentacao-tecnica-rtc-producao-restrita)
- [Transição de Toledo para a NFS-e Nacional](https://www.toledo.pr.gov.br/secretarias/secretaria_fazenda_captacao_recursos/transicao-para-nfs-e-nacional)
- [Aviso de Guaíra sobre emissão Nacional](https://guaira.pr.gov.br/noticias/noticia/6935)
