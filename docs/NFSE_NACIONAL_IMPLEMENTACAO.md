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

Typecheck e testes automatizados passam: 147 testes, 0 falhas.

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

O fluxo completo também foi autorizado pela SEFIN Nacional em produção
restrita:

- DPS série 1, número 288;
- NFS-e Nacional autorizada, com XML e DANFSe disponíveis;
- a configuração Nacional usou `cTribNac` `140101` e NBS folha
  `1.2001.31.10` (`120013110`).

O primeiro teste havia retornado `E0025`, pois a data de competência precisava
ser posterior à autorização de uso da NHT no CNC. Após a confirmação da
Prefeitura de Guaíra, o erro deixou de ocorrer. O teste seguinte revelou que
`1.2001.31.00` era código-pai; com o código folha a autorização foi concluída.

A produção da NHT permanece Guaíra/IPM, preservada como contingência. A
homologação Nacional é independente e continua sem transmissão automática.

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

As sincronizações foram ajustadas para preservar uma configuração Nacional já
existente na Nuvem Local. Autoeletrica não a substitui por credenciais IPM e
Apoio-Contábil não exige login/senha municipal para Toledo/Equiplano.

## Decisões de cadastro e interface

### Três níveis de configuração

O próximo desenho do `/admin` separará as responsabilidades abaixo. A tela de
**Cidades** e o catálogo de serviços ainda precisam ser implementados; a
configuração atual por empresa continua válida durante essa evolução.

1. **Cidades**: perfil fiscal geral do município, identificado pelo código
   IBGE. Armazena adesão à NFS-e Nacional, provedor municipal de contingência,
   endpoint/regra municipal, regra conhecida para IM e observações de CNC.
   A data de autorização no CNC não é da cidade: pertence a cada empresa.
2. **Empresas**: certificado, IM, Simples, séries e numerações, provedor por
   ambiente, situação de autorização no CNC e política de transmissão. É onde
   se escolhe o padrão `auto`, `nacional` ou `municipal`.
3. **Serviços**: relação entre o serviço usado no programa cliente e o
   `cTribNac`, o NBS e, quando aplicável, o código municipal. NBS classifica o
   serviço da nota, não a empresa nem a cidade.

### NBS e experiência de emissão

Uma oficina pode ter um NBS padrão de reparação, mas também pode prestar
guincho, lavagem ou outro serviço com classificação distinta. Da mesma forma,
transportadoras podem emitir serviços enquadrados em códigos diferentes.

A emissão regular não deve pedir que o lojista escolha NBS a cada nota. O
fluxo aprovado é:

`serviço/item do cliente → mapeamento aprovado na Nuvem Local → cTribNac + NBS na DPS`

O `/admin` permitirá cadastrar e revisar esse mapeamento por empresa/serviço.
Os programas clientes podem futuramente expor campos opcionais de NBS e código
Nacional para ajudar no cadastro, mas não serão a fonte de verdade e não
sobrescreverão uma configuração Nacional aprovada. Quando não houver
mapeamento seguro, a emissão deverá gerar pendência clara em vez de inferir um
NBS silenciosamente.

### Inclusão de nova empresa ou cidade

Guaíra e Toledo já têm o adaptador Nacional validado. Uma nova empresa nesses
municípios ainda requer configuração por empresa e uma emissão autorizada em
homologação: certificado, serviço/NBS, Simples, IM e autorização no CNC.

Para uma cidade ainda não validada, primeiro é necessário confirmar adesão à
plataforma Nacional, autorização da empresa no CNC, regras de IM/códigos e
contingência municipal. Se usar o mesmo fluxo SEFIN sem exceções, será apenas
cadastro; particularidades municipais exigirão validação antes da primeira
emissão.

## Próximo bloco

Concluídos em 07/08/2026:

- testes de contrato, sem transmissão externa, para os formatos reais da
  Autoeletrica e do Apoio-Contábil;
- normalização tolerante dos códigos municipais legados: `cTribNac` inválido
  usa o valor Nacional configurado e `cTribMun` fora do formato Nacional é
  omitido.
- configuração Nacional de homologação preparada para Evavan (`160101`) e
  Pick (`160201`), ambas com NBS `104011210` e sem IM na DPS;
- sincronização dos dois clientes preserva a configuração Nacional existente.

Próximos passos:

1. Validar Evavan e Pick em homologação Nacional, com os payloads reais de
   cada cliente.
2. Implementar no `/admin` os cadastros de Cidades e de mapeamento de serviços
   (`cTribNac`/NBS), mantendo a configuração por empresa.
3. Implementar o roteamento explícito `auto`, `nacional` ou `municipal`.
4. Preservar o conector municipal como contingência, com configuração,
   certificado, credenciais, sequência e endpoint previamente validados.
5. Documentar um procedimento de contingência: nunca reutilizar uma DPS/RPS
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
