# Prompt para novo contexto: NFS-e Guaira/PR homologacao

Estamos no repo `g:\projetos\nuvem-local-fiscal`.

Antes de comecar, leia integralmente o arquivo `NUVEMLOCALFISCAL.md`. Ele e o
documento principal do projeto e foi atualizado em 13/06/2026 com o estado real
da NF-e, NFC-e e NFS-e Toledo.

## Regras inviolaveis de compatibilidade

1. A Nuvem Local Fiscal deve manter compatibilidade pratica com a Nuvem Fiscal.
2. Os sistemas clientes devem continuar enviando, sempre que possivel, os
   payloads e chamando as rotas que ja utilizam com a Nuvem Fiscal.
3. A adaptacao entre o contrato da Nuvem Fiscal e o contrato municipal IPM deve
   acontecer dentro da Nuvem Local Fiscal.
4. Nao alterar codigo, payload, rota ou regra nos outros programas sem
   autorizacao expressa do usuario.
5. Se for encontrado um erro real em um programa cliente, apresentar primeiro:
   - arquivo e trecho afetado
   - diagnostico
   - impacto
   - menor correcao possivel
6. Mesmo quando a correcao no cliente parecer simples, nao editar o repo cliente
   antes da autorizacao expressa.
7. Consultar repos clientes e permitido para entender payloads, rotas e respostas
   esperadas. Editar nao e permitido sem autorizacao.

### Regra operacional da Autoeletrica para o tomador

Na operacao real da Autoeletrica, muitas vezes nao e viavel obter CPF e endereco
completo do cliente. A Nuvem Local Fiscal nao deve introduzir uma trava nova que
impeca a NFS-e apenas porque o endereco do tomador foi preenchido com o fallback
que o sistema cliente ja utiliza.

Fallback atual enviado pela Autoeletrica quando o endereco nao esta cadastrado:

- logradouro: `Nao Informado`
- numero: `SN`
- bairro: `Centro`
- CEP: CEP da empresa ou `85980000`
- municipio: Guaira/PR, codigo IBGE `4108809`
- telefone: telefone da empresa, quando o cliente nao possui telefone

Requisitos:

1. Aceitar esse payload no dry-run.
2. Preservar a compatibilidade e enviar esse fallback ao IPM no teste municipal.
3. Nao exigir endereco real como validacao adicional da Nuvem Local.
4. Tratar como bloqueio somente uma rejeicao efetiva da prefeitura/IPM.
5. Se o IPM permitir tomador nao identificado ou endereco nao informado por meio
   de campos proprios, avaliar esse contrato sem exigir mudanca imediata no
   programa cliente.
6. CPF/CNPJ e endereco real continuam preferiveis quando estiverem disponiveis,
   mas nao podem se tornar uma trava operacional criada pela Nuvem Local.

Estado observado em 13/06/2026:

- o endereco ja recebe o fallback acima antes do envio;
- o conector Guaira/IPM tambem aplica fallback local para logradouro, numero,
  bairro, municipio e CEP quando esses campos chegam vazios;
- a Autoeletrica ainda valida e exige CPF/CNPJ valido do tomador antes de chamar
  `POST /nfse/dps`;
- remover ou flexibilizar essa exigencia depende de confirmar primeiro como o
  IPM representa consumidor nao identificado e, se exigir alteracao no cliente,
  requer autorizacao expressa antes da edicao.

Essas regras valem especialmente para:

- `g:\projetos\autoeletrica`
- `g:\projetos\apoio-contabil`
- `g:\projetos\gestao-otica-pro`
- qualquer outro sistema que ja utilize a Nuvem Fiscal

## Estado atual validado

1. NFC-e em homologacao funciona ponta a ponta.
2. NF-e em homologacao funciona ponta a ponta.
3. NFS-e Toledo/PR com Equiplano funciona ponta a ponta em homologacao:
   - emissao
   - consulta
   - XML autorizado
   - PDF local
   - cancelamento municipal
4. A Nuvem Local Fiscal esta publicada em:
   - `https://fiscal.mentebinaria.com`
   - DigitalOcean com Ubuntu 24.04
   - Node.js via `systemd`
   - Nginx e HTTPS Let's Encrypt
   - Supabase como persistencia
   - admin protegido
5. Producao fiscal continua bloqueada por seguranca.
6. Certificados A1, CSC e configuracoes fiscais persistem no Supabase.
7. A migracao abaixo ja foi aplicada manualmente no Supabase:
   - `supabase/migrations/20260613_001_nfse_provider_artifacts.sql`
8. O codigo implantado na VPS esta no commit:
   - `07ebc06 fix: recognize issued IPM NFSe responses`
9. O marco Toledo esta registrado no commit local:
   - `e768c22 docs: record Toledo NFSe homologation milestone`

## Marco Toledo que nao deve regredir

- empresa: Amplotec Contabilidade
- NFS-e municipal validada: `7`
- RPS: `12`
- lote: `14`
- emissao feita pelo Apoio Contabil apontado para a Nuvem Local Fiscal
- XML e PDF recuperados
- cancelamento confirmado pela Equiplano com:
  - `<sucesso>true</sucesso>`
  - `2026-06-13T15:05:46-03:00`

O conector de Guaira deve ser separado do conector Toledo. Nao reutilizar
layouts, regras SOAP ou campos Equiplano como se fossem regras genericas de
NFS-e.

## Marco Guaira/IPM validado em 13/06/2026

A primeira emissao controlada em homologacao foi confirmada pela IPM:

- documento Nuvem Local: `doc_19c69b1c`
- NFS-e municipal: `184`
- serie: `1`
- situacao IPM: codigo `1`, descricao `Emitida`
- protocolo/codigo de autenticidade:
  `7571130626163527010351810692026067397875`
- data e hora municipais: `13/06/2026 16:35:27`
- mensagem: `NFS-e valida para emissao.`
- XML recuperado pela API: HTTP `200`
- PDF local recuperado pela API: HTTP `200`
- status final persistido e confirmado pela API publica: `autorizado`

O teste permaneceu com `nfse_teste=1`, em homologacao, e a transmissao
automatica continuou desativada.

Diagnostico de rede:

- a VPS DigitalOcean resolve o host IPM, mas a conexao direta com
  `177.11.20.179:443` expira;
- a mesma conexao funciona pela internet local do usuario;
- a primeira emissao foi feita por um tunel SSH temporario, mantendo
  descriptografia e persistencia no VPS e usando apenas a saida de rede local;
- endpoint, DNS e tunel temporarios foram removidos depois do teste;
- o endpoint persistido voltou para
  `https://guaira.atende.net/atende.php?pg=rest&service=WNERestServiceNFSe&cidade=padrao`.

A resposta real IPM declarou `ISO-8859-1` e informou sucesso por
`situacao_codigo_nfse=1`, mesmo sem prefixar a mensagem textual com `[1]`.
Isso foi coberto no parser e em teste automatizado no commit `07ebc06`.

Limite da validacao: esta primeira nota usou CPF e endereco preenchidos. A regra
de endereco de fallback continua obrigatoria, mas ainda precisa de um teste
municipal proprio antes de ser considerada validada ponta a ponta.

Consulta municipal implementada e testada em 13/06/2026:

- `GET /nfse/:id?consultar_prefeitura=1` solicita atualizacao explicita;
- primeiro tenta o codigo de autenticidade de 40 caracteres;
- diante de "nao encontrada", tenta numero `184`, serie `1` e cadastro
  economico/inscricao municipal `324743`;
- a IPM respondeu que nenhuma NFS-e foi encontrada nas duas modalidades;
- o registro local autorizado foi preservado, sem rebaixar status;
- a evidencia indica que `nfse_teste=1` valida a emissao, mas nao persiste o
  documento na base consultavel;
- consulta ponta a ponta permanece pendente de confirmacao da IPM/Prefeitura ou
  de um teste futuro que gere documento consultavel;
- uma falha na atualizacao explicita passa a retornar HTTP `422`, sem mascarar o
  erro municipal como se fosse uma consulta confirmada.
- o polling normal de `GET /nfse/:id` nao deve consultar a prefeitura enquanto o
  documento ainda estiver em `NFSE_IPM_DRY_RUN`; consulta municipal explicita
  continua disponivel com `?consultar_prefeitura=1`.

Segundo teste Guaira/IPM em 13/06/2026:

- documento Nuvem Local: `doc_955229b6`
- numero local: `2`
- status final: `autorizado`
- NFS-e municipal: `184`
- serie: `1`
- situacao IPM: codigo `1`, descricao `Emitida`
- protocolo/codigo de autenticidade:
  `7571130626174259080351810692026067397875`
- mensagem IPM: `NFS-e valida para emissao.`
- tomador enviado no XML: CPF `08701600958`, nome `JOAO LUCAS PEREIRA`
- endereco enviado no XML: `RUA TESTE`, numero `123`, bairro `CENTRO`, cidade
  TOM `7571`, CEP `85980113`
- servico: `140101`, atividade `4520007`, aliquota `2,01`, situacao tributaria
  `0`, valor tributavel `200,00`
- XML autorizado recuperado pela API: HTTP `200`
- PDF local recuperado pela API: HTTP `200`
- essa nota validou o payload com endereco informado tambem perante a IPM, mas
  ainda nao validou o caso sem endereco/fallback perante a IPM;
- o teste usou `nfse_teste=1`, transmissao manual e tunel reverso temporario;
- depois do teste, `NFSE_IPM_CONNECT_HOST`/`NFSE_IPM_CONNECT_PORT` foram
  removidos da VPS, a API foi reiniciada saudavel e o tunel foi encerrado.

Terceiro teste Guaira/IPM em 13/06/2026:

- documento Nuvem Local: `doc_3e7f0efd`
- numero local: `3`
- status final: `autorizado`
- NFS-e municipal: `184`
- serie: `1`
- situacao IPM: codigo `1`, descricao `Emitida`
- protocolo/codigo de autenticidade:
  `7571130626223056030351810692026067397875`
- mensagem IPM: `NFS-e valida para emissao.`
- tomador enviado no XML: CPF `91807220168`, nome `CLEBERTON SELAN SANCHES`
- endereco enviado no XML: `RUA TESTE`, numero `123`, bairro `CENTRO`, cidade
  TOM `7571`, CEP `85980113`
- esse caso confirmou que o fluxo "sem endereco real" da Autoeletrica nao envia
  campos vazios: ele envia o endereco operacional/padrao que o usuario ja usa
  ha meses em Guaira;
- a primeira tentativa autorizada de transmissao manual usou um tunel
  reverso temporario e override `NFSE_IPM_CONNECT_HOST=127.0.0.1` /
  `NFSE_IPM_CONNECT_PORT=9443`;
- a chamada retornou HTTP `422` pela Nuvem Local, sem autorizacao municipal,
  com a mensagem `Falha de conexao com IPM: Tempo esgotado ao conectar ao IPM.`;
- o documento permaneceu em `NFSE_IPM_DRY_RUN` depois dessa falha, sem efeito
  municipal;
- uma EC2 AWS em Sao Paulo (`54.233.2.22`) foi criada e validou acesso direto a
  `guaira.atende.net:443`, com DNS, TCP, TLS e HTTP `200`;
- a EC2 passou a manter um tunel reverso persistente por `autossh`/`systemd`,
  expondo apenas `127.0.0.1:9443` na DigitalOcean;
- a segunda transmissao manual da mesma nota, pela rota AWS persistente,
  retornou HTTP `200` e foi autorizada pela IPM;
- XML autorizado recuperado pelo dominio publico: HTTP `200`, `677` bytes;
- PDF local recuperado pelo dominio publico: HTTP `200`, `5625` bytes, PDF 1.4
  com uma pagina;
- a Nuvem Local foi reiniciada depois da autorizacao e voltou saudavel com
  persistencia Supabase e producao bloqueada.

Transmissao automatica habilitada em 13/06/2026:

- o commit `40c05a1` foi publicado na DigitalOcean;
- o fluxo Guaira/IPM agora gera e persiste o XML de auditoria e, quando
  `autoTransmit=true`, chama automaticamente o mesmo transmissor de teste
  validado nas notas controladas;
- a resposta autorizada de `POST /nfse/dps` ja retorna status `autorizado`,
  numero, protocolo e URLs assinadas de XML/PDF para a Autoeletrica;
- o cadastro do Norberto em homologacao foi confirmado depois de reiniciar a
  API com:
  - provedor `guaira-ipm`;
  - `nfse_teste=1`;
  - transmissao automatica ativa;
  - senha municipal preservada;
  - TOM `7571`;
  - atividade `4520007`;
  - situacao tributaria `0`;
- a API, o listener privado `127.0.0.1:9443` e o servico AWS
  `ipm-gateway.service` permaneceram ativos;
- producao continua bloqueada pela API.

Estrategia de conectividade IPM:

- a conexao direta da VPS DigitalOcean com a IPM continua considerada instavel
  ou bloqueada;
- o conector Guaira/IPM suporta `NFSE_IPM_CONNECT_HOST` e
  `NFSE_IPM_CONNECT_PORT` para direcionar apenas a conexao TCP por uma rota
  alternativa;
- o endpoint cadastrado deve continuar como
  `https://guaira.atende.net/atende.php?pg=rest&service=WNERestServiceNFSe&cidade=padrao`;
- o TLS continua usando `servername` e cabecalho `Host` de `guaira.atende.net`;
- `scripts/start-ipm-reverse-tunnel.ps1` abre um tunel reverso padrao para
  testes, sem alterar banco, endpoint ou `/etc/hosts`;
- a estrategia permanente escolhida nesta etapa usa a EC2 AWS Sao Paulo como
  gateway de saida para a IPM;
- a EC2 inicia `ipm-gateway.service`, baseado em `autossh`, e cria na
  DigitalOcean o listener local `127.0.0.1:9443`;
- o servico esta `enabled` e `active`, com `Restart=always`,
  `ServerAliveInterval=30` e `ServerAliveCountMax=3`;
- a DigitalOcean usa:
  - `NFSE_IPM_CONNECT_HOST=127.0.0.1`
  - `NFSE_IPM_CONNECT_PORT=9443`
- o usuario tecnico `ipmgateway` da DigitalOcean nao possui shell interativo e
  tem encaminhamento SSH restrito a modo remoto e `127.0.0.1:9443`;
- nenhuma porta adicional foi aberta publicamente na EC2;
- a EC2 tambem validou conectividade basica com:
  - Equiplano homologacao em `www.esnfs.com.br:9443`;
  - SEFAZ-PR NF-e homologacao em `homologacao.nfe.sefa.pr.gov.br:443`;
  - SEFAZ-PR NFC-e homologacao em `homologacao.nfce.sefa.pr.gov.br:443`.

## Objetivo deste novo contexto

Implementar NFS-e Guaira/PR em homologacao usando o provedor IPM/Atende.Net,
preservando o contrato externo compativel com a Nuvem Fiscal e sem alterar os
programas clientes.

O caminho desejado e:

1. identificar e validar o contrato municipal de Guaira
2. mapear o payload Nuvem Fiscal ja enviado pela Autoeletrica
3. criar normalizacao interna propria para NFS-e IPM
4. implementar emissao homologada
5. implementar consulta e recuperacao de XML/PDF
6. implementar cancelamento depois que a emissao estiver validada
7. corrigir rejeicoes municipais uma a uma

## Fontes locais obrigatorias

### Manual tecnico IPM

A pasta abaixo contem sete PDFs oficiais ou operacionais da IPM:

`g:\projetos\autoeletrica\.ipm`

O documento principal para esta implementacao e:

`g:\projetos\autoeletrica\.ipm\Report (1).pdf`

Ele corresponde a:

- Nota Tecnica IPM `35/2021`
- versao `2.8`
- data da versao `14/10/2024`
- assunto: Web Service para emissao de NFS-e

O manual ja documenta:

- emissao
- consulta
- cancelamento
- solicitacao de cancelamento fora do prazo
- layout XML
- XMLs de retorno
- teste de integracao
- erros e validacoes
- assinatura digital, quando exigida pelo municipio
- envio sincrono por HTTP POST
- autenticacao HTTP Basic
- sessao por cookie `PHPSESSID`

Contrato generico identificado no manual:

- URL:
  `https://ws-cidade.atende.net:7443/?pg=rest&service=WNERestServiceNFSe`
- substituir `cidade` pelo nome do municipio sem pontuacao e espacos
- metodo `POST`
- corpo `multipart/form-data`
- cabecalho `Authorization: Basic <base64(username:password)>`
- `username`: CPF/CNPJ do emissor
- `password`: senha de acesso ao sistema municipal
- o XML inclui o codigo TOM da cidade
- o acesso ao Web Service precisa ser liberado no Portal do Cidadao pelo
  servico `Emissao de NFS-e por WebService`

Os demais PDFs devem ser classificados antes do uso. Nem todos tratam de
emissao por Web Service:

- `Report.pdf`: testes da Reforma Tributaria, versao de 17/12/2025
- `Report (2).pdf`: manual geral do Atende.Net
- `Report (3).pdf`: DES-IF
- `Report (4).pdf`: exportacao de NFS-e
- `Report (5).pdf`: importacao de documentos de servicos
- `Report (6).pdf`: importacao de documentos de servicos eventuais

### Fluxo existente da Autoeletrica

Inspecionar, sem editar:

`g:\projetos\autoeletrica`

Localizar:

- montagem do payload NFS-e para a Nuvem Fiscal
- rota de emissao
- polling/consulta
- download de XML
- abertura/download do PDF
- cancelamento
- selecao de credenciais e URLs por ambiente
- campos especificos de Guaira
- eventuais payloads, respostas e logs antigos

O fluxo da Autoeletrica e a referencia do contrato externo que a Nuvem Local
deve aceitar. Ele nao e autorizacao para modificar a Autoeletrica.

## Informacoes de Guaira ainda nao confirmadas

Nao presumir estes dados. Confirmar por fonte oficial, configuracao existente ou
teste controlado:

1. URL exata do Web Service de Guaira.
2. Se existe ambiente de homologacao separado.
3. Se o teste ocorre no endpoint normal usando alguma tag de teste.
4. Se o acesso Web Service da empresa esta liberado no Portal do Cidadao.
5. CPF/CNPJ usado como login.
6. Senha municipal correta.
7. Codigo TOM de Guaira exigido pelo IPM.
8. Cadastro economico/inscricao municipal do prestador.
9. Serie e proximo RPS.
10. Itens da lista de servico habilitados para o prestador.
11. Situacao tributaria aceita para cada servico.
12. Aliquota municipal.
13. Se Guaira exige assinatura digital no XML.
14. Se o certificado A1 e necessario para autenticacao, assinatura ou ambos.
15. Regras e prazo de cancelamento autonomo.
16. Como o PDF oficial e retornado.
17. Impacto obrigatorio das tags IBS/CBS em 2026.

Use pesquisa na internet apenas para confirmar informacoes atuais e especificas
de Guaira que nao estejam nos materiais locais. Priorize Prefeitura de Guaira,
Portal Atende.Net/IPM e documentacao oficial.

## Primeiro trabalho no novo contexto

1. Execute `git status --short`.
2. Leia `NUVEMLOCALFISCAL.md`.
3. Leia este documento integralmente.
4. Inspecione o conector Toledo apenas para entender as interfaces internas:
   - `src/lib/nfse-toledo-equiplano.ts`
   - `src/routes/documents.ts`
   - `src/lib/supabase-persistence.ts`
   - `src/types.ts`
   - testes relacionados
5. Nao copie regras Equiplano para IPM.
6. Extraia e organize as secoes relevantes do `Report (1).pdf`.
7. Inspecione o fluxo NFS-e da Autoeletrica sem editar o repo.
8. Compare:
   - payload que a Autoeletrica envia
   - payload compativel esperado pela Nuvem Local
   - XML exigido pela IPM
   - resposta que a Autoeletrica espera
9. Produza uma tabela objetiva:
   - campo externo Nuvem Fiscal
   - campo interno normalizado
   - tag IPM
   - obrigatoriedade
   - fonte da informacao
   - pendencia
10. Diga claramente o que pode ser implementado sem credenciais reais.
11. Implemente toda a base segura possivel antes de pedir intervencao.
12. Pare antes de qualquer transmissao municipal real e solicite confirmacao
    explicita da nota, prestador e motivo do teste.

## Arquitetura desejada

Criar um conector IPM separado, por exemplo:

`src/lib/nfse-guaira-ipm.ts`

Responsabilidades esperadas:

- detectar configuracao Guaira/IPM
- normalizar payload estilo Nuvem Fiscal
- gerar XML IPM
- validar os campos obrigatorios antes da transmissao
- montar `multipart/form-data`
- autenticar por HTTP Basic
- preservar/reutilizar `PHPSESSID` quando seguro
- transmitir apenas em homologacao ou modo de teste confirmado
- interpretar XML de sucesso e erro
- persistir request, response e referencia municipal
- consultar NFS-e
- recuperar XML e PDF
- cancelar NFS-e
- registrar eventos tecnicos sem expor senha

Nao colocar regras IPM dentro do conector Equiplano. Se houver logica realmente
comum, extrair apenas abstracoes municipais neutras.

## Contrato externo que deve ser preservado

Manter, sempre que compativel:

- `POST /nfse/dps`
- `GET /nfse/:id`
- `GET /nfse/:id/xml`
- `GET /nfse/:id/pdf`
- `POST /nfse/:id/cancelamento`
- `POST /nfse/:id/cancelar`
- `GET /nfse/:id/cancelamento/xml`

As respostas devem manter os campos que os clientes ja consomem, incluindo:

- `id`
- `status`
- `numero`
- `serie`
- `chave`
- `protocolo`
- `motivo`
- `motivo_status`
- `mensagens`
- `xml_url`
- `pdf_url`
- `xml_autorizado_disponivel`
- `pdf_disponivel`
- dados de cancelamento quando aplicavel

Se o IPM usar conceitos diferentes, traduzir internamente para esse contrato.

## Seguranca e operacao

1. Producao permanece bloqueada.
2. Nao transmitir sem confirmacao explicita.
3. Nao registrar senha municipal, token, PFX ou chave privada em logs.
4. Persistir senha municipal criptografada.
5. Nao commitar:
   - `.env.local`
   - PFX ou certificados
   - XMLs reais soltos
   - PDFs reais soltos
   - `storage`
   - `dist`
   - `node_modules`
6. Nao reutilizar campos `sefaz_*` para artefatos municipais.
7. Toda resposta ambigua deve permanecer em processamento ou erro; nunca marcar
   como autorizada/cancelada apenas por HTTP 200.
8. Exigir confirmacao explicita no XML municipal para autorizacao e
   cancelamento.
9. Antes de teste real grande:
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
   - `git diff --check`
   - commit isolado
10. Depois do deploy, validar `/ready` e confirmar que
    `fiscalProductionBlocked=true`.

## Ordem recomendada de implementacao

1. Inventario tecnico e mapeamento de campos.
2. Tipos e configuracao IPM por empresa/ambiente.
3. Gerador XML puro com testes unitarios.
4. Parser de retornos IPM com fixtures sanitizadas.
5. Cliente HTTP Basic + multipart sem transmissao automatica.
6. Dry-run local persistindo artefatos.
7. Integracao com `POST /nfse/dps`.
8. Consulta, XML e PDF.
9. Revisao de seguranca e compatibilidade.
10. Commit.
11. Deploy.
12. Primeira transmissao controlada em homologacao.
13. Correcao de rejeicoes uma a uma.
14. Cancelamento somente depois da emissao validada.

## Comandos uteis

- `git status --short`
- `git diff --stat`
- `git diff --check`
- `npm run dev`
- `npm run typecheck`
- `npm test`
- `npm run build`

## Quando chamar o usuario

Trabalhe com autonomia ate precisar de uma decisao ou dado externo real. Chame
o usuario antes de:

- editar qualquer programa cliente
- alterar o contrato externo consumido pelos clientes
- modificar a UI admin de forma relevante
- cadastrar ou substituir credenciais
- habilitar transmissao
- transmitir uma NFS-e
- cancelar uma NFS-e
- aplicar migracao no Supabase
- fazer deploy com efeito operacional nao reversivel

Ao chamar, informe exatamente:

- o que foi concluido
- o que foi validado
- qual dado ou autorizacao falta
- qual sera o efeito da proxima acao

Comece pelo inventario e pelo mapeamento. Preserve a compatibilidade com a Nuvem
Fiscal e nao altere nenhum repo cliente sem autorizacao expressa.
