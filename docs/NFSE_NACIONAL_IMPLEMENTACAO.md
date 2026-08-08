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

## Fechamento operacional â€” NHT em produÃ§Ã£o (07/08/2026, BRT)

A NHT (CNPJ `35.181.069/0001-43`, GuaÃ­ra/PR) foi validada tambÃ©m em
**produÃ§Ã£o**, com autorizaÃ§Ã£o expressa da empresa para uma emissÃ£o real de
teste. A configuraÃ§Ã£o de produÃ§Ã£o agora estÃ¡ em `NFS-e Nacional / SEFIN`,
com sÃ©rie DPS `1`, prÃ³ximo nÃºmero `3`, `cTribNac` `140101` e NBS padrÃ£o
`120013100`.

Resultado definitivo:

- DPS `1/1` foi rejeitada corretamente por `E0202` (tomador igual ao
  prestador); nÃ£o gerou NFS-e;
- DPS `1/2` foi recebida pela SEFIN e gerou a NFS-e de produÃ§Ã£o;
- uma nova tentativa retornou `E0014`, pois a mesma DPS jÃ¡ havia originado
  uma NFS-e; a consulta Ã  SEFIN recuperou o documento autorizado;
- chave da NFS-e recuperada:
  `41088091235181069000143000000000000226020000000002`;
- XML autorizado e rota de PDF/DANFSe estÃ£o armazenados na Nuvem Local.

O `E0014` nÃ£o Ã© motivo para reenviar ou trocar a numeraÃ§Ã£o: Ã© sinal de que
deve ser feita consulta da DPS/NFS-e existente. A Nuvem Local agora oferece
**Consultar SEFIN** no histÃ³rico da nota. A Autoeletrica foi corrigida para,
ao receber `E0014` com o identificador da Nuvem Local, consultar a SEFIN e
atualizar a prÃ³pria nota como autorizada, sem criar uma segunda emissÃ£o. Se a
consulta estiver temporariamente indisponÃ­vel, ela guarda o identificador e
deixa a nota em processamento para uma consulta posterior.

### DecisÃ£o de operaÃ§Ã£o da NHT

NÃ£o esperar 01/09 para a primeira utilizaÃ§Ã£o do fluxo Nacional: a NHT deve
emitir as prÃ³ximas NFS-e comuns pela SEFIN Nacional, em produÃ§Ã£o, para que a
operaÃ§Ã£o seja exercitada antes do corte municipal.

AtÃ© 31/08/2026, a contingÃªncia Ã© **manual e controlada**: no Admin da Nuvem
Local, trocar o provedor da NHT de `NFS-e Nacional / SEFIN` para
`GuaÃ­ra / IPM Atende.Net` somente se houver impedimento real na emissÃ£o
Nacional. NÃ£o se deve alternar por tentativa, nem reenviar uma DPS cujo
resultado seja incerto. Em 01/09/2026, GuaÃ­ra informou que o emissor
municipal nÃ£o aceitarÃ¡ novas emissÃµes, permanecendo apenas para consulta;
portanto ele deixa de ser contingÃªncia a partir dessa data.

PendÃªncia conhecida para antes de tratar o fluxo como totalmente maduro:
cancelamento Nacional (evento `101101`) ainda nÃ£o foi implementado. Em caso
de necessidade de cancelamento, nÃ£o simular uma nova emissÃ£o: registrar a
ocorrÃªncia e usar o portal Nacional enquanto esse evento nÃ£o estiver no
conector.

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

A seção acima registra a situação anterior ao teste real. O estado atual da
produção é o descrito em **Fechamento operacional — NHT em produção**:
NFS-e Nacional ativa, com IPM disponível somente como contingência manual até
31/08/2026.

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
- primeira NFS-e Nacional real de produção da NHT autorizada e recuperada por
  consulta à SEFIN;
- botão **Consultar SEFIN** no Admin da Nuvem Local e recuperação automática
  de `E0014` na Autoeletrica.

Próximos passos:

1. Conferir XML e DANFSe da NFS-e de produção da NHT na tela da Autoeletrica e
   acompanhar as primeiras emissões normais antes de 01/09.
2. Validar Evavan e Pick em homologação Nacional, com os payloads reais de
   cada cliente, quando ainda não houver evidência registrada de autorização.
3. Implementar no `/admin` os cadastros de Cidades e de mapeamento de serviços
   (`cTribNac`/NBS), mantendo a configuração por empresa.
4. Implementar o roteamento explícito `auto`, `nacional` ou `municipal`.
5. Preservar o conector municipal como contingência, com configuração,
   certificado, credenciais, sequência e endpoint previamente validados.
6. Implementar cancelamento Nacional (evento `101101`) antes de depender do
   fluxo para todos os casos de produção.
7. Documentar um procedimento de contingência: nunca reutilizar uma DPS/RPS
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
