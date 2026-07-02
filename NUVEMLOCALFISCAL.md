# NUVEMLOCALFISCAL

## Summary
Este documento define o projeto `nuvemlocalfiscal`: uma API propria que imita a Nuvem Fiscal o suficiente para que meus sistemas atuais precisem trocar apenas `URL` e `CLIENT_ID/CLIENT_SECRET` no `.env.local` e depois no Vercel.

Objetivo do v1:
- aceitar autenticacao parecida com a da Nuvem Fiscal
- receber os mesmos requests principais que meus sistemas ja enviam hoje
- centralizar certificados por empresa
- traduzir os payloads para SEFAZ
- devolver respostas compativeis o bastante para evitar reescrever os sistemas clientes

Regra obrigatoria de compatibilidade:
- nao alterar os programas clientes para adaptar integracoes a Nuvem Local Fiscal
- a Nuvem Local Fiscal deve absorver diferencas compativeis de rotas, payloads e respostas sempre que isso puder ser feito sem risco fiscal
- se for identificado um erro real em um programa cliente, ele deve ser informado ao responsavel, com o diagnostico e o impacto, mas nao corrigido no repo cliente sem autorizacao explicita
- qualquer excecao que exija mudanca em cliente deve ser discutida antes da edicao

Fora do v1:
- cobertura completa de NFS-e por prefeitura
- imitar 100% da Nuvem Fiscal
- dashboard bonito antes da base estar estavel

---

## 0. Marco atual validado em 2026-06-13

Estado operacional atual:
- a NFC-e da Otica Prisma em homologacao ja emite ponta a ponta usando a Nuvem Local Fiscal
- a NF-e da Otica Prisma em homologacao ja emite ponta a ponta usando a Nuvem Local Fiscal
- a Otica troca URL e credenciais para apontar para `http://127.0.0.1:3001`
- o payload de emissao da Otica nao precisa carregar CSC; o CSC fica salvo na Nuvem Local por empresa, ambiente e servico
- o certificado A1 fica salvo no Supabase e tambem no estado local de desenvolvimento
- a emissao automatica de NFC-e em homologacao gera XML, assina, valida XSD, transmite para a SEFAZ-PR e salva protocolo/retorno
- a emissao de NF-e em homologacao gera XML modelo 55, assina com A1, calcula hashCSRT quando configurado, valida XSD, transmite para a SEFAZ-PR e salva protocolo/retorno
- XML autorizado e PDF/DANFE ficam disponiveis pelos endpoints compativeis
- o DANFE NFC-e ja e gerado localmente com layout de cupom termico, QR Code real e altura dinamica de bobina
- o DANFE NF-e ja e gerado em layout A4 fiscal proprio, com canhoto, codigo de barras Code 128, identificacao, impostos, transporte, itens e dados adicionais, separado do DANFE termico da NFC-e
- a UI admin possui cadastro unico por empresa, abas Dados/Certificado/Servicos e separacao por ambiente homologacao/producao
- a inutilizacao de numeracao para NFC-e/NF-e em homologacao ja possui endpoint, assinatura XML, transmissao SEFAZ e formulario simples na UI
- o cancelamento de NFC-e/NF-e em homologacao ja usa evento real `110111`, com protocolo proprio e persistencia separada do protocolo de autorizacao
- o projeto ja esta versionado em Git e publicado no GitHub em `main`
- a VPS de homologacao ja esta provisionada na DigitalOcean, com dominio, HTTPS, Nginx, `systemd`, Supabase e admin protegido
- dominio homologacao atual: `https://fiscal.mentebinaria.com`
- `/ready` em producao controlada retorna `persistence=supabase` e `fiscalProductionBlocked=true`
- a Otica Prisma e a Autoeletrica/NHT Centro Automotivo ja emitiram documentos reais em homologacao pela VPS

Marco NF-e homologacao validado:
- documento local: `doc_93323d3e`
- chave: `41260601997929000108550020000090051152123354`
- protocolo: `141260000345721`
- status SEFAZ: `100 - Autorizado o uso da NF-e`
- lote: `104 - Lote processado`
- recebimento: `2026-06-12T10:38:14-03:00`
- CSRT/hashCSRT: configurados por `.env.local` via `NFE_RT_*` e `NFE_CSRT_*`
- cancelamento: `135 - Evento registrado e vinculado a NF-e`
- protocolo de cancelamento: `141260000345750`
- registro do cancelamento: `2026-06-12T10:45:39-03:00`

Marco NF-e homologacao com payload real da Otica Prisma:
- documento local: `doc_de18e670`
- nota exibida na loja: `#4`, serie `2`
- chave SEFAZ: `41260601997929000108550010000000271727886936`
- protocolo: `141260000345844`
- status SEFAZ: `100 - Autorizado o uso da NF-e`
- lote: `104 - Lote processado`
- recebimento: `2026-06-12T11:03:57-03:00`
- observacao tecnica: o payload da Otica trazia `CSRT` dentro de `infRespTec`; a Nuvem Local passou a usar o token apenas para calcular `hashCSRT` e nao serializa `CSRT` no XML, preservando validade XSD e evitando expor o token.
- compatibilidade de consulta: foi identificado que a tela fiscal da Otica consulta o UUID de NF-e pela rota legada `/nfce/:id`. O erro do cliente foi informado e nao deve ser corrigido no programa sem autorizacao. A Nuvem Local aceita essa consulta GET e devolve as URLs canonicas `/nfe/:id/xml` e `/nfe/:id/pdf`.
- compatibilidade de cancelamento: o fluxo generico da Otica chama `/nfse/:id/cancelar` para documentos que nao sao NFC-e. A Nuvem Local aceita esse alias apenas quando o UUID pertence a uma NF-e real e transmite o evento como modelo `55`.
- compatibilidade de pagamento: quando um cliente envia `tPag=90` (sem pagamento) junto com `vPag` positivo, a Nuvem Local normaliza apenas `vPag` para zero, compatibilizando a regra `904` com o schema atualmente implantado pela SEFAZ-PR.
- cenario com multiplos produtos validado na nota local `#7`: dois itens, `vProd=410.00`, pagamento em dinheiro `tPag=01`, protocolo `141260000346817` e status SEFAZ `100`.
- cenario com desconto, frete, transportadora e dinheiro validado na nota local `#8`: `vProd=30.00`, `vFrete=10.00`, `vDesc=3.00`, `vNF=37.00`, transportadora com CNPJ, `modFrete=0`, pagamento `tPag=01` no valor de `37.00`, protocolo `141260000346830` e status SEFAZ `100`.
- inutilizacao NF-e real validada pela pagina da Otica: modelo `55`, serie `1`, numero `9100`, status `102 - Inutilizacao de numero homologado`, protocolo `141260000346968` e recebimento `2026-06-12T15:39:52-03:00`.

Marco VPS e multiplos clientes:
- VPS DigitalOcean em Ubuntu 24.04, app em `/opt/nuvem-local-fiscal`, servico `nuvem-local-fiscal.service`, Nginx na frente e TLS via Let's Encrypt
- Nginx protege `/admin` com Basic Auth; `/admin/api/` fica sem Basic Auth do Nginx porque a propria aplicacao valida `ADMIN_USERNAME`/`ADMIN_PASSWORD`
- arquivo ICP-Brasil obrigatorio na VPS: `/opt/nuvem-local-fiscal/certificates/icp-brasil-root-v10.pem`
- certificados A1 e configuracoes de servico persistem no Supabase com UUID real; foram corrigidos bugs onde certificados/configuracoes podiam aparecer na memoria e sumir ao recarregar
- o deploy atual da VPS esta no commit `8c7f41a fix: retry Guaira IPM NFSe without customer address`
- a Otica Prisma autorizou NF-e homologacao via VPS e gerou DANFE A4
- a Autoeletrica/NHT Centro Automotivo autorizou NFC-e homologacao via VPS, usando certificado A1 e CSC persistidos no Supabase
- NFC-e Autoeletrica validada:
  - emitente: `35181069000143` / NORBERTO HITOSHI TAJIRI LTDA
  - modelo: `65`
  - serie: `2`
  - numero: `7`
  - chave: `41260635181069000143650020000000071162019552`
  - protocolo: `141260001358339`
  - status SEFAZ: `100 - Autorizado o uso da NF-e`
  - recebimento: `2026-06-13T10:03:20-03:00`
- em `2026-07-02`, a Autoeletrica teve uma NFC-e rejeitada em homologacao com
  `462 - Codigo Identificador do CSC no QR-Code nao cadastrado na SEFAZ`; o
  diagnostico confirmou XML assinado, XSD valido e QR/hash coerentes com o CSC
  salvo, indicando problema cadastral do CSC na SEFAZ, nao erro de montagem do
  XML
- depois de criar novo CSC no portal e recadastrar na Nuvem Local, a NFC-e
  homologacao `numero 10`, serie `2`, foi autorizada para a Autoeletrica com
  protocolo `141260001382291` em `2026-07-02T12:01:40-03:00`

Compatibilidade aplicada na Autoeletrica:
- `src/lib/nuvemfiscal.ts` passou a respeitar `NUVEMFISCAL_HOM_AUTH_URL`, mantendo auth oficial como fallback
- cadastro fiscal sincroniza homologacao por padrao; producao so sincroniza se `NUVEMFISCAL_SYNC_PRODUCTION=true`
- upload de certificado pela tela de configuracoes envia para homologacao
- a rota de upload adapta o payload para a Nuvem Local quando a URL e local/VPS (`fileName`, `pfxBase64`, `password`)
- essas mudancas foram feitas para preservar a premissa de trocar ambiente por `.env` e evitar cadastro manual repetitivo quando a integracao cliente estiver madura

Endpoints compativeis ja exercitados:
- `POST /oauth/token`
- `POST /nfe`
- `GET /nfe/:id`
- `GET /nfe/:id/xml`
- `GET /nfe/:id/pdf`
- `GET /nfe/:id/cancelamento/xml`
- `POST /nfce`
- `GET /nfce/:id`
- `POST /nfce/:id/cancelar`
- `GET /nfce/:id/xml`
- `GET /nfce/:id/pdf`
- `GET /nfce/:id/cancelamento/xml`
- `POST /nfse/dps`
- `POST /nfse/:id/transmitir-teste`
- `GET /nfse/:id`
- `GET /nfse/:id/xml`
- `GET /nfse/:id/pdf`
- `POST /nfse/:id/cancelamento`
- `POST /nfse/:id/cancelar`
- `GET /nfse/:id/cancelamento/xml`
- `POST /empresas`
- `PUT /empresas/:cnpj`
- `GET /empresas/:cnpj`
- `PUT /empresas/:cnpj/certificado`
- `PUT /empresas/:cnpj/nfce`
- `GET /empresas/:cnpj/nfce`
- `PUT /empresas/:cnpj/nfse`
- `POST /empresas/:cnpj/nfse`
- `GET /empresas/:cnpj/nfse`
- `POST /nfce/inutilizacoes`
- `GET /nfce/inutilizacoes/:id`
- `GET /nfce/inutilizacoes/:id/xml`
- `GET /nfce/inutilizacoes/:id/resposta/xml`
- `POST /nfe/inutilizacoes`
- `GET /nfe/inutilizacoes/:id`
- `GET /nfe/inutilizacoes/:id/xml`
- `GET /nfe/inutilizacoes/:id/resposta/xml`

Configuracoes persistidas:
- empresa/ambiente: UF, IE, CRT, serie NF-e e serie NFC-e
- configuracao NF-e por ambiente: servico ativo/inativo e transmissao automatica; producao continua bloqueada
- certificado A1 ativo por CNPJ
- configuracao NFC-e por ambiente: CSC ID e CSC criptografado
- configuracao NFS-e por ambiente: login e senha da prefeitura criptografada, provedor/municipio, dados Equiplano e sequencia de RPS/lote
- atualizacao parcial de configuracao NFS-e preserva login e senha ja salvos no servidor; isso evita rejeicao indevida de sync quando o cliente altera apenas campos nao sensiveis
- em `2026-07-02`, foi criada a primeira versao do motor de regras NFS-e em
  `src/lib/nfse-rules.ts`, com perfis versionados para `guaira-ipm` e
  `toledo-equiplano`
- o motor centraliza identificacao de provedor por alias/municipio, defaults
  municipais, requisitos de configuracao, compatibilidade provedor x IBGE e
  politica de transmissao por ambiente
- a atualizacao parcial reaproveita credenciais e campos antigos somente quando
  o provedor ainda e o mesmo, ou quando uma configuracao NFS-e generica esta
  sendo promovida pela primeira vez para um provedor municipal; trocar entre
  Guaira/IPM e Toledo/Equiplano exige dados novos e nao reaproveita segredo do
  provedor anterior
- producao NFS-e segue bloqueada pelo perfil do motor de regras; liberar
  producao deve ser uma mudanca explicita de perfil, com teste e evidencia
  regulatoria da data vigente
- a NFS-e Toledo/Equiplano foi validada ponta a ponta em homologacao em 2026-06-13:
  - `POST /nfse/dps` aceita payload estilo Nuvem Fiscal
  - `GET /nfse/:id` consulta o documento e o RPS no Equiplano
  - `GET /nfse/:id/xml` disponibiliza o XML municipal autorizado
  - `GET /nfse/:id/pdf` gera o PDF local da NFS-e com dados municipais, prestador, tomador, servico e impostos
  - `POST /nfse/:id/cancelamento` e o alias `/nfse/:id/cancelar` transmitem cancelamento municipal
  - `GET /nfse/:id/cancelamento/xml` disponibiliza o XML de cancelamento
  - producao NFS-e permanece bloqueada
  - o conector gera `enviarLoteRpsEnvio`, assina com o A1 salvo, suporta SOAP 1.1 e persiste request/response municipal
  - a transmissao municipal exige configuracao Toledo completa mais `autoTransmit=true`
  - a UI admin NFS-e foi liberada apos aprovacao explicita, com configuracao Toledo/Equiplano por ambiente, credenciais, RPS/lote, servico padrao e transmissao segura
  - a Amplotec Contabilidade emitiu NFS-e usando o Apoio Contabil apontado para a Nuvem Local Fiscal
  - a NFS-e municipal numero `7`, RPS `12`, lote `14`, foi autorizada e teve XML/PDF recuperados
  - o cancelamento municipal da NFS-e `7` foi confirmado pela Equiplano com `sucesso=true` em `2026-06-13T15:05:46-03:00`
  - a confirmacao de cancelamento agora exige explicitamente `<sucesso>true</sucesso>` no retorno municipal
  - em `2026-07-01`, as emissoes Toledo em homologacao mostraram um fluxo
    sequencial de ajuste operacional: primeiro faltou configuracao/`idEntidade`,
    depois houve rejeicao por data futura de RPS e por lote reutilizado, e as
    emissoes seguintes foram autorizadas depois dos ajustes de cadastro e
    sequencia
  - em `2026-07-02`, o backend passou a bloquear salvamento Toledo/Equiplano sem
    `idEntidade`, limitar data futura de RPS ao dia atual de Sao Paulo e elevar
    automaticamente proximo lote/RPS para acima da maior sequencia Toledo ja
    usada no historico local
  - a emissao de `2026-07-02T10:53:20-03:00` ficou autorizada com PDF final
    consistente para `Leandro, Car Prime`, confirmando que o ciclo de ajuste
    operacional Toledo foi fechado em homologacao
- a primeira NFS-e Guaira/IPM foi emitida em homologacao em 2026-06-13:
  - documento Nuvem Local `doc_19c69b1c`
  - NFS-e municipal `184`, serie `1`
  - situacao IPM `1 - Emitida`
  - protocolo/codigo de autenticidade `7571130626163527010351810692026067397875`
  - XML e PDF local recuperados com HTTP `200`
  - o teste permaneceu com `nfse_teste=1` e transmissao automatica desativada
  - a VPS DigitalOcean nao alcanca diretamente o IPM; a emissao controlada usou
    tunel SSH temporario para sair pela internet local do usuario
  - endpoint, override DNS e tunel temporarios foram removidos depois do teste
  - a resposta IPM `ISO-8859-1` e o sucesso sem prefixo numerico na mensagem
    foram cobertos pelo parser e por teste automatizado
  - o endereco de fallback da Autoeletrica ainda precisa de teste municipal
    proprio; esta primeira emissao usou CPF e endereco preenchidos
  - o conector Guaira/IPM aplica fallback local para endereco do tomador quando
    logradouro, numero, bairro, municipio ou CEP chegam vazios; CPF/CNPJ do
    tomador ainda permanece obrigatorio ate confirmar regra municipal para
    consumidor nao identificado
  - a NFS-e local `#2` (`doc_955229b6`) validou emissao IPM em homologacao com
    endereco informado no XML: `RUA TESTE`, `123`, `CENTRO`, TOM `7571`, CEP
    `85980113`; a IPM retornou NFS-e municipal `184`, situacao `1 - Emitida`,
    protocolo `7571130626174259080351810692026067397875`, XML HTTP `200` e PDF
    local HTTP `200`
  - a NFS-e local `#3` (`doc_3e7f0efd`) validou o endereco operacional enviado
    pela Autoeletrica no fluxo sem endereco real; pela rota persistente da AWS,
    a IPM retornou NFS-e municipal `184`, situacao `1 - Emitida`, protocolo
    `7571130626223056030351810692026067397875`, XML publico HTTP `200` e PDF
    publico HTTP `200`
  - o polling normal de `GET /nfse/:id` ignora consulta municipal enquanto o
    documento estiver em `NFSE_IPM_DRY_RUN`, evitando eventos de erro por codigo
    de autenticidade inexistente antes da transmissao
  - em `2026-07-02`, a Autoeletrica validou o caso municipal real do tomador
    `Leandro, Car Prime`, que ja possui cadastro economico em Guaira
  - o primeiro envio desse cenario retorna rejeicao municipal `229 - O Tomador
    do servico possui cadastro economico no municipio. Nao e possivel inserir um
    novo endereco.`
  - a correcao foi aplicada na Nuvem Local Fiscal, nao no cliente: o conector
    Guaira/IPM detecta esse `229`, registra o evento
    `nfse_guaira_ipm_address_retry` e retransmite automaticamente omitindo o
    endereco do tomador e marcando `<endereco_informado>N</endereco_informado>`
  - a NFS-e local `#13` (`doc_d87842b2`) comprovou esse fluxo em homologacao:
    payload original com endereco, retry automatico sem endereco,
    `retriedWithoutAddress=true`, NFS-e municipal `203`, situacao `1 - Emitida`,
    protocolo `7571020726102154880351810692026077397185`, XML HTTP `200` e PDF
    local HTTP `200`
  - uma emissao anterior do mesmo dia para outro tomador (`doc_2b0d5123`)
    tambem autorizou em Guaira/IPM, mas sem acionar retry; isso confirmou que o
    comportamento depende do cadastro municipal do tomador, nao apenas do layout
    enviado
- dados do responsavel tecnico e CSRT por ambiente via `.env.local`
- documentos com payload original, payload normalizado, XML gerado, XML assinado, XML autorizado, resposta SEFAZ e dados de protocolo
- inutilizacoes com faixa, justificativa, XML assinado, resposta SEFAZ, protocolo e status
- cancelamentos com justificativa, evento assinado, resposta SEFAZ, protocolo e data de registro
- a aba NF-e do admin e propositalmente enxuta; Documentos e Logs e debug possuem filtros e downloads de XML autorizado, DANFE, cancelamento e inutilizacao

Checkpoint regulatorio em `2026-07-01`:
- foi feita uma revisao de aderencia legal considerando a data corrente `2026-07-01`
- conclusao operacional: a base esta consistente para homologacao controlada de `NF-e` e `NFC-e` no PR, mas ainda nao pode ser tratada como emissor plenamente aderente para uso fiscal real em producao
- a producao continua bloqueada no codigo e deve permanecer assim ate segunda ordem
- `NFS-e` continua sendo frente municipal/provedor-especifica; nao deve ser vendida internamente como cobertura legal ampla do Brasil
- o schema local ja carrega campos ligados a reforma tributaria e evolucoes recentes do leiaute, incluindo `IBSCBS`, `IBSCBSTot`, `cMunFGIBS`, `idCSRT` e `hashCSRT`
- porem, ter o schema atualizado nao basta: e obrigatorio provar que a homologacao esta aderente ao comportamento exigido na data vigente, inclusive regras novas de `NF-e`/`NFC-e`, antes de qualquer liberacao de producao
- ha mudancas normativas de `2025` e `2026` que precisam entrar no checklist ativo da homologacao, especialmente o que impacta contingencia, `DANFE Simplificado - Tipo 2`, referenciamento entre `NF-e` e `NFC-e`, e reflexos operacionais da reforma tributaria
- decisao de projeto a partir deste ponto: so partir para producao depois que a homologacao estiver explicitamente revisada e considerada de acordo com a reforma tributaria da data vigente da decisao
- essa regra vale mesmo se a transmissao tecnica em homologacao estiver funcionando ponta a ponta

Checklist regulatorio de homologacao para producao controlada:
- objetivo: transformar "emitiu em homologacao" em evidencia tecnica minima para
  operar varios sistemas e varias empresas sem depender da Nuvem Fiscal real
- regra de fechamento: nenhum item abaixo libera producao sozinho; producao so
  pode ser discutida quando os itens aplicaveis tiverem evidencia, teste ou
  decisao explicita de escopo
- fontes oficiais obrigatorias antes de marcar item como fechado:
  - Portal Nacional da NF-e: notas tecnicas, MOC, schemas e comunicados vigentes
  - CONFAZ: Ajustes SINIEF vigentes para NF-e/NFC-e e documentos auxiliares
  - Receita Federal / reforma tributaria: regras de transicao de IBS, CBS e IS
  - SEFAZ-PR: endpoints, disponibilidade, regras operacionais e homologacao
  - Planalto: EC 132/2023, LC 214/2025 e normas complementares aplicaveis
- evidencia aceita:
  - XML homologado e armazenado
  - retorno SEFAZ com `cStat` e protocolo
  - XSD validado contra pacote vigente
  - PDF/DANFE conferido visualmente quando o item afetar impressao
  - teste automatizado quando a regra puder ser reproduzida localmente
  - decisao registrada no MD quando o item ficar fora do escopo inicial

Itens minimos do checklist:
- `RT-BASE`: confirmar, na data da decisao, qual Nota Tecnica NF-e/NFC-e da
  reforma tributaria esta vigente em homologacao e qual pacote de schemas deve
  ser usado
- `RT-XML`: validar se os grupos `IBSCBS`, totais de `IBSCBS`, `cMunFGIBS`,
  `idCSRT`, `hashCSRT` e demais campos de transicao estao aceitos no XML quando
  aplicaveis, sem inventar valores quando o cliente nao informou tributacao
  suficiente
- `RT-COEXISTENCIA`: confirmar que ICMS, IPI, PIS, COFINS e campos atuais
  continuam sendo emitidos corretamente durante a transicao, sem substituir
  indevidamente tributos atuais por IBS/CBS
- `RT-CLASSIFICACAO`: mapear quais dados cada sistema cliente precisa fornecer
  para IBS/CBS/IS, especialmente CST, classificacao tributaria e municipio do
  fato gerador quando aplicavel
- `RT-VALIDACAO`: criar validacoes defensivas no motor de regras para bloquear
  payload incompleto quando a regra vigente exigir campos novos obrigatorios
- `NFE-XSD`: revisar se `schemas/PL_010c` ainda e suficiente para a data da
  retomada; se nao for, atualizar pacote de schemas e testes
- `NFE-CSRT`: manter `idCSRT`/`hashCSRT` calculados pelo servidor, nunca expor
  CSRT no XML nem exigir que o cliente envie segredo fiscal
- `NFCE-QR`: validar QR Code, CSC, `idToken`, URL de consulta e URL do QR Code
  conforme ambiente de homologacao/producao do PR
- `DANFE-A4`: conferir se o DANFE NF-e A4 continua suficiente para emissao
  normal e cancelada
- `DANFE-NFCE`: conferir se o DANFE NFC-e termico continua suficiente para
  emissao normal e cancelada, incluindo QR Code e chave
- `DANFE-TIPO2`: verificar aplicabilidade de `DANFE Simplificado - Tipo 2`; se
  aplicavel ao escopo, implementar layout/teste antes de producao; se nao
  aplicavel, registrar decisao e fonte
- `CONTINGENCIA`: decidir explicitamente se a primeira producao vai operar sem
  contingencia offline; se sim, bloquear qualquer tentativa de emissao em
  contingencia e comunicar erro claro ao cliente
- `RETRY-FILA`: fechar retries agendados e processamento distribuido para evitar
  duplicidade, perda de protocolo ou reenvio indevido em queda da SEFAZ/Nuvem
  Local
- `CONSULTA-RECUPERACAO`: validar consulta por chave/recibo e recuperacao de
  protocolo para documento que ficou pendente depois de falha de rede
- `REFERENCIAMENTO`: testar NF-e/NFC-e com documentos referenciados quando o
  cliente usar devolucao, complemento, ajuste ou vinculacao entre documentos
- `CANCELAMENTO`: manter regressao de cancelamento NF-e/NFC-e por evento
  `110111`, garantindo protocolo de evento separado do protocolo de autorizacao
- `INUTILIZACAO`: manter regressao de inutilizacao NF-e/NFC-e por modelo, serie
  e faixa, com persistencia e XML de resposta
- `PDF-ARTEFATOS`: garantir que XML autorizado, XML de cancelamento, PDF e URLs
  compativeis permanecem disponiveis para todos os sistemas clientes
- `AUDITORIA`: garantir trilha em `fiscal_document_events` para request,
  normalizacao, assinatura, validacao, transmissao, consulta, erro e retry
- `MENSAGENS`: traduzir rejeicoes criticas para mensagens operacionais claras,
  preservando o retorno tecnico original para auditoria
- `PROD-GATE`: manter `fiscalProductionBlocked=true` ate o checklist aplicavel
  estar fechado e documentado

Primeiro recorte recomendado:
1. validar `NFE-XSD`, `RT-BASE` e `RT-XML` em XML NF-e e NFC-e de homologacao
2. revisar `NFCE-QR`, `NFE-CSRT` e PDFs/DANFE ja gerados
3. transformar `RT-VALIDACAO`, `CONTINGENCIA` e `RETRY-FILA` em regras/testes
4. so depois discutir liberacao controlada de producao por empresa e por sistema

Diagnostico inicial do recorte `NFE-XSD` / `RT-BASE` / `RT-XML` em
`2026-07-02`:
- fonte oficial consultada: Portal da Nota Fiscal Eletronica - SVRS, pagina
  `Documentos`, em `2026-07-02`
- `NFE-XSD`: status `parcial`; o projeto usa pacote oficial local
  `PL_010c_NT2022_002v1.30`, valida NF-e/NFC-e com `nfe_v4.00.xsd` e ja possui
  campos recentes no schema, mas ainda precisa reconciliar esse pacote com os
  pacotes/notas mais novos listados no portal antes de producao
- `RT-BASE`: status `aberto`; o portal lista a `Nota Tecnica 2025.002 v1.50 -
  RTC` em `02/06/2026`, a `Nota Tecnica 2026.004 - Schema CNPJ Alfa v1.01` em
  `08/06/2026`, a `Nota Tecnica 2026.002` sobre operacoes presenciais e nao
  presenciais com `DANFE Simplificado Tipo 2` em `22/05/2026`, a `Nota Tecnica
  2026.003` com especificacoes tecnicas do `DANFE Simplificado Tipo 2` em
  `22/05/2026` e a `NT 2025.001 v1.01 - NFCe_qrCode_3` em `26/06/2025`
- `RT-XML`: status `parcial`; o gerador consegue preservar grupos/campos novos
  quando recebidos no payload e o schema local possui estruturas ligadas a
  `IBSCBS`, `IBSCBSTot`, `cMunFGIBS`, `idCSRT` e `hashCSRT`, e agora possui um
  teste automatizado com amostra minima de RTC passando por geracao de XML,
  assinatura, lote e validacao XSD
- em `2026-07-02`, foi criado teste automatizado de `RT-XML` minimo para
  NF-e modelo `55` e NFC-e modelo `65`, cobrindo `cMunFGIBS`, `IBSCBS` no item
  e `IBSCBSTot` no total; o teste valida XML assinado e lote contra o XSD local
- esse teste revelou e corrigiu uma falha real de serializacao: `cMunFGIBS`
  existia no schema, mas nao estava na ordem do bloco `ide`, entao poderia ser
  serializado no fim do grupo e rejeitado pelo XSD quando algum cliente enviasse
  esse campo
- `RT-VALIDACAO`: status `parcial`; em `2026-07-02`, foi criada a primeira
  camada defensiva especifica de NFC-e em `src/lib/nfce-rules.ts`, aplicada no
  `POST /nfce`, na assinatura admin e no processamento automatico antes da
  geracao/transmissao do XML
- essa camada bloqueia NFC-e com modelo diferente de `65`, ambiente incoerente,
  `tpEmis=9`, tipo de emissao online nao suportado, `tpImp` diferente de `4`,
  CNPJ do emitente divergente, falta de IE/CRT, falta de item, campos basicos
  de produto, grupos minimos `ICMS`/`PIS`/`COFINS`, total `vNF` e pagamento
- a validacao defensiva ainda nao fecha regras tributarias profundas da reforma
  tributaria; `CST`, `cClassTrib`, municipio do fato gerador, IBS/CBS/IS e
  demais exigencias novas continuam dependendo de `RT-CLASSIFICACAO` e da
  conciliacao com a nota tecnica vigente
- `NFCE-QR`: status `parcial`; o portal lista `NFCe_qrCode_3` e o schema local
  `PL_010c_NT2022_002v1.30` ja contem os padroes `QRCODE V3 ONLINE` e
  `QRCODE V3 OFFLINE`; em `2026-07-02`, o gerador NFC-e online passou a montar
  QR Code v3 no formato `chNFe|3|tpAmb`, validado por XSD e por teste de fluxo
  HTTP
- para NFC-e online, essa mudanca remove o `idToken`/hash do QR Code e reduz a
  dependencia operacional de CSC ativo na SEFAZ para o QR; a configuracao de
  CSC ainda existe no admin por compatibilidade e historico, mas o QR Code
  online novo nao serializa mais o segredo nem o identificador
- `NFCE-QR-OFFLINE`: status `bloqueado por seguranca`; o schema mostra que
  `tpEmis=9` exige o leiaute `QRCODE V3 OFFLINE`, diferente do online e
  dependente de informacoes da nota assinada; enquanto esse fluxo nao estiver
  implementado e testado, a Nuvem Local bloqueia a tentativa com erro claro em
  vez de gerar XML fiscalmente ambíguo
- o bloqueio de `tpEmis=9` agora ocorre antes da criacao/transmissao da NFC-e e
  tambem no processamento de documento ja salvo, evitando contingencia offline
  acidental por cliente, admin ou retry
- `DANFE-TIPO2`: status `aberto`; nao faz parte do layout atual e precisa de
  decisao explicita de escopo antes de producao
- `CONTINGENCIA`: status `fechado para o escopo inicial`; a primeira producao
  controlada nao deve operar NFC-e em contingencia offline e o codigo bloqueia
  `tpEmis=9` com mensagem operacional clara ate existir implementacao/teste do
  QR Code v3 offline
- `CNPJ-ALFA`: status `parcial/blindado`; em `2026-07-02`, foi consultado o
  portal oficial SVRS, que lista a `Nota Tecnica 2026.004 - Schema CNPJ Alfa
  v1.01`, publicada em `08/06/2026`, com homologacao em `15/06/2026`, alem da
  `Nota Tecnica DFe Conjunta - CNPJ Alfanumerico v1.00`, publicada em
  `07/05/2025`
- a primeira etapa implementada nao declara suporte completo a CNPJ
  alfanumerico; ela impede o pior risco operacional: apagar letras com
  `replace(/\D/g, "")` e gerar chave de acesso, cadastro ou comparacao fiscal
  incorreta
- `src/lib/fiscal-identity.ts` centraliza a classificacao de identificadores
  fiscais em CNPJ numerico, CNPJ alfanumerico, vazio ou invalido
- NF-e/NFC-e bloqueiam CNPJ alfanumerico com erro claro enquanto schema, chave
  de acesso, inutilizacao, cancelamento, persistencia e demais fluxos nao forem
  reconciliados com a NT aplicavel

Tarefas geradas pelo diagnostico inicial:
1. comparar o pacote local `PL_010c_NT2022_002v1.30` com o pacote oficial mais
   adequado para a data de retomada e decidir se o schema deve ser atualizado
2. transformar lacunas restantes de `RT-VALIDACAO`, `DANFE-TIPO2`,
   `REFERENCIAMENTO`, `RETRY-FILA` e `CNPJ-ALFA` em regras/testes
3. manter producao bloqueada ate esses pontos terem evidencia tecnica ou decisao
   formal de fora de escopo

Limites atuais:
- transmissao automatica pode processar NFC-e/NF-e em homologacao quando habilitada; producao permanece bloqueada
- producao permanece bloqueada por seguranca
- homologacao ainda precisa de uma trilha formal de aderencia continua a reforma tributaria e aos ajustes SINIEF vigentes na data da retomada; emitir em homologacao com sucesso nao e criterio suficiente, por si so, para liberar producao
- NFS-e Toledo/Equiplano possui configuracao no admin e fluxo homologado de emissao, consulta, XML, PDF e cancelamento
- NFS-e Toledo/Equiplano agora possui guardas locais para `idEntidade`, data de
  RPS futura e reutilizacao local de lote/RPS
- NFS-e Guaira/IPM possui emissao controlada homologada, XML e PDF local; a
  estrategia de rede usa uma EC2 AWS Sao Paulo como gateway IPM persistente por
  tunel reverso `autossh`, enquanto consulta municipal e cancelamento ainda
  precisam ser fechados
- o caso municipal `229` de tomador com cadastro economico ja esta absorvido no
  backend compartilhado, sem exigir tratamento especial nos sistemas clientes
- a consulta Guaira/IPM foi implementada por codigo de autenticidade, com
  fallback por numero, serie e cadastro economico; a NFS-e `184` em
  `nfse_teste=1` nao aparece na base consultavel da IPM em nenhuma das duas
  modalidades, portanto esse retorno de teste nao valida consulta ponta a ponta
- a rota de rede IPM agora suporta `NFSE_IPM_CONNECT_HOST` e
  `NFSE_IPM_CONNECT_PORT`, preservando o endpoint, SNI e `Host` originais; isso
  permite usar um tunel reverso ou gateway fixo sem editar o cadastro municipal
  nem `/etc/hosts`
- a EC2 AWS mantem `ipm-gateway.service` habilitado e cria somente o listener
  local `127.0.0.1:9443` na DigitalOcean; a Nuvem Local usa esse listener por
  `NFSE_IPM_CONNECT_HOST=127.0.0.1` e `NFSE_IPM_CONNECT_PORT=9443`
- o motor de regras NFS-e ja impede cadastro com provedor incompativel com o
  IBGE informado, aplica defaults municipais seguros e mantem producao bloqueada
  por perfil
- a lista de empresas possui a acao `Nova empresa`, que cria o primeiro ambiente fiscal e abre o cadastro para certificado e servicos
- NF-e homologacao ja emite, possui DANFE A4 inicial e cancelamento real validado
- cancelamento real esta habilitado apenas em homologacao para documentos autorizados
- o deploy em VPS ja foi feito e validado em homologacao; `127.0.0.1:3001` continua valido para desenvolvimento local
- filas/retries ainda precisam ser fechados
- o processamento de autorizacao ja possui trava local por documento, consulta previa da chave e historico persistente em `fiscal_document_events`; retries agendados e processamento distribuido ainda precisam ser fechados antes do deploy
- a checagem de saude fiscal e diagnostica; ela nao substitui emissao de teste homologada
- para persistir inutilizacoes no Supabase, aplicar a migracao `supabase/migrations/20260611_002_fiscal_inutilizations.sql`
- para persistir cancelamentos no Supabase, aplicar a migracao `supabase/migrations/20260611_003_fiscal_cancellations.sql`
- a migracao `supabase/migrations/20260613_001_nfse_provider_artifacts.sql` foi aplicada manualmente no Supabase em 2026-06-13

Proximo foco:
1. reconciliar `NFE-XSD`/`RT-BASE` com os pacotes e notas tecnicas oficiais
   vigentes na data da retomada, antes de qualquer liberacao de producao
2. revisar e testar na homologacao os pontos de `NF-e`/`NFC-e` mais sensiveis a
   mudancas normativas recentes, incluindo contingencia, `DANFE Simplificado -
   Tipo 2`, referenciamento entre documentos e campos novos do leiaute
3. transformar cada item do checklist em regra/teste quando couber, mantendo o
   motor de regras como ponto central de decisao
4. manter compatibilidade com payloads dos sistemas clientes; nao alterar
   cliente sem necessidade
5. manter producao bloqueada na Nuvem Local Fiscal ate o checklist ter evidencia
   tecnica e regulatoria suficiente
6. fechar retries agendados e estrategia de processamento distribuido antes de
   qualquer uso fiscal amplo
7. validar se existem outros cenarios municipais de tomador em Guaira/IPM alem
   do `229` ja coberto
8. definir se a rota IPM permanente sera tunel reverso monitorado, gateway fixo
   ou outro servidor com saida aceita pela IPM
9. confirmar com IPM/Prefeitura se existe consulta persistente para documentos
   emitidos com `nfse_teste=1`
10. implementar cancelamento Guaira somente depois da consulta validada

---

## 1. Objetivo do projeto

Quero criar um servico chamado `nuvemlocalfiscal` para substituir a dependencia da Nuvem Fiscal nos meus sistemas.

A ideia e simples:
- meus sistemas continuam montando o payload do jeito que ja montam hoje
- em vez de chamar a Nuvem Fiscal, eles chamam minha API
- minha API autentica o cliente por `client_id` e `client_secret`
- minha API identifica qual empresa emitente esta sendo usada
- minha API assina com o certificado correto
- minha API converte o payload recebido para o formato real da SEFAZ
- minha API transmite, consulta status, baixa XML/PDF e devolve a resposta para o sistema chamador

Meta pratica:
- nos projetos existentes, eu quero trocar principalmente estas variaveis:
  - `NUVEMFISCAL_HOM_CLIENT_ID`
  - `NUVEMFISCAL_HOM_CLIENT_SECRET`
  - `NUVEMFISCAL_HOM_URL`
  - `NUVEMFISCAL_PROD_CLIENT_ID`
  - `NUVEMFISCAL_PROD_CLIENT_SECRET`
  - `NUVEMFISCAL_PROD_URL`

---

## 2. Estrategia de compatibilidade

O `nuvemlocalfiscal` deve funcionar como um "emulador pratico" da Nuvem Fiscal.

Isso significa:

- manter autenticacao estilo OAuth `client_credentials`
- manter endpoints com nomes proximos dos atuais sempre que isso reduzir retrabalho
- aceitar os payloads que meus sistemas ja enviam hoje
- devolver campos essenciais que meus sistemas ja esperam, como:
  - `id`
  - `status`
  - `numero`
  - `serie`
  - `motivo`
  - `motivo_status`
  - `mensagens`
  - `xml` ou URL para XML
  - `pdf` ou URL para PDF

Regra importante:
- compatibilidade externa alta
- implementacao interna livre

Ou seja:
- por fora, parece Nuvem Fiscal
- por dentro, e um motor proprio com banco, fila, assinatura e conectores

---

## 3. Escopo do v1

O v1 deve cobrir primeiro:

1. `NF-e`
2. `NFC-e`

Operacoes do v1:
- emissao
- consulta de status
- cancelamento
- download XML
- download PDF/DANFE
- inutilizacao de numeracao
- armazenamento do payload original, XML assinado, retorno da SEFAZ e logs de erro

Nao entra no v1:
- `NFS-e` generica para qualquer prefeitura
- manifestacao do destinatario
- distribuicao DF-e completa
- multi-provedor municipal
- contingencia offline completa

---

## 4. Arquitetura recomendada

Stack recomendada:
- `Node.js + TypeScript`
- API HTTP com `Fastify` ou `NestJS`
- `PostgreSQL`
- fila com `BullMQ + Redis`
- XML com biblioteca dedicada
- assinatura digital com certificado `A1/PFX`
- storage local ou S3-like para XML/PDF

Modulos principais:
1. `auth`
2. `clients`
3. `issuers`
4. `certificates`
5. `documents`
6. `sefaz-nfe`
7. `sefaz-nfce`
8. `artifacts`
9. `webhooks`
10. `jobs`

Fluxo interno:
1. sistema cliente autentica
2. sistema chama endpoint fiscal
3. API valida credenciais
4. API encontra qual empresa emitente esta sendo usada
5. API registra request original
6. API normaliza payload para modelo interno
7. API monta XML fiscal real
8. API assina XML com o certificado da empresa
9. API transmite para SEFAZ
10. API salva resposta, protocolo, XML e eventos
11. API responde ao sistema cliente em formato compativel

---

## 5. Contrato de autenticacao

O projeto deve expor um endpoint compativel com o fluxo atual de token:

`POST /oauth/token`

Request esperado:
- `grant_type=client_credentials`
- `client_id`
- `client_secret`
- `scope`

Resposta esperada:

```json
{
  "access_token": "token-aqui",
  "token_type": "bearer",
  "expires_in": 3600,
  "scope": "empresa nfce nfe nfse"
}
```

Regras:
- cada sistema cliente tera seu proprio `client_id/client_secret`
- o token deve carregar quais empresas ele pode operar
- pode existir permissao por ambiente:
  - `homologation`
  - `production`

Importante:
- por compatibilidade, aceitar scopes amplos mesmo que internamente eu use permissoes mais especificas

---

## 6. Endpoints compativeis do v1

Base URL homologacao:
- `https://meu-dominio-hom`

Base URL producao:
- `https://meu-dominio-prod`

Endpoints principais do v1:

### Emissao NFC-e
`POST /nfce`

### Consulta NFC-e
`GET /nfce/:id`

### Cancelamento NFC-e
`POST /nfce/:id/cancelar`

Payload:
```json
{
  "justificativa": "Erro de preenchimento nos dados da venda"
}
```

Em homologacao, o servico gera e assina o evento `110111`, envia ao
`NFeRecepcaoEvento4` e preserva separadamente os protocolos de autorizacao e
cancelamento.

### Inutilizacao NFC-e
`POST /nfce/inutilizacoes`

### Emissao NF-e
`POST /nfe`

### Consulta NF-e
`GET /nfe/:id`

### Cancelamento NF-e
`POST /nfe/:id/cancelar`

### Download XML
`GET /nfe/:id/xml`
`GET /nfce/:id/xml`

### Download PDF
`GET /nfe/:id/pdf`
`GET /nfce/:id/pdf`

Compatibilidade adicional desejavel:
- `PUT /empresas/:cnpj/certificado`
- isso facilita reaproveitar telas e fluxos atuais de upload de certificado

---

## 7. Modelo interno minimo

Mesmo que a API externa imite a Nuvem Fiscal, internamente usar um modelo proprio.

Tabelas principais:

### `api_clients`
- id
- nome
- client_id
- client_secret_hash
- ativo
- ambientes_permitidos
- created_at

### `issuers`
- id
- cnpj
- razao_social
- nome_fantasia
- ambiente
- uf
- ie
- crt
- serie_nfe
- serie_nfce
- ativo

### `issuer_certificates`
- id
- issuer_id
- nome_arquivo
- pfx_encrypted
- senha_encrypted
- validade_inicio
- validade_fim
- thumbprint
- ativo

### `documents`
- id interno
- provider_like_id
- issuer_id
- tipo_documento
- ambiente
- status_interno
- status_externo
- numero
- serie
- chave_acesso
- protocolo
- payload_original_json
- payload_normalizado_json
- xml_assinado
- xml_autorizado
- pdf_path
- erro_detalhado
- created_at
- updated_at

### `document_events`
- id
- document_id
- tipo_evento
- origem
- payload_json
- created_at

### `webhook_deliveries`
- id
- document_id
- target_url
- status
- request_body
- response_body
- attempts
- next_retry_at

---

## 8. Normalizacao dos payloads

Regra central do projeto:
- nunca deixar os sistemas clientes conhecerem o XML real da SEFAZ

O `nuvemlocalfiscal` recebe JSON "estilo Nuvem Fiscal" e converte para um modelo canonico interno, por exemplo:

```ts
type FiscalDocumentInput = {
  tipo: "NFe" | "NFCe";
  ambiente: "homologacao" | "producao";
  emitenteCnpj: string;
  destinatario?: object;
  itens: object[];
  totais: object;
  pagamento?: object[];
  transporte?: object;
  observacoes?: object;
  metadados?: object;
}
```

Depois disso:
- um adaptador transforma esse modelo no XML final de `NF-e`
- outro adaptador transforma no XML final de `NFC-e`

Beneficio:
- se meus sistemas variarem um pouco entre si, eu trato a diferenca na borda
- o motor fiscal continua unico

---

## 9. Certificados

O certificado da empresa deve ser responsabilidade do `nuvemlocalfiscal`.

Regras:
- armazenar PFX criptografado
- nunca logar senha
- validar vencimento
- associar 1 certificado ativo por emitente/ambiente
- permitir rotacao de certificado sem apagar historico

Fluxo desejado:
1. cliente faz upload do certificado
2. API valida senha e integridade do PFX
3. API extrai metadados basicos
4. API salva criptografado
5. emissao usa sempre o certificado ativo do emitente correto

---

## 10. Resposta compativel

A resposta nao precisa ser identica bit a bit com a Nuvem Fiscal, mas precisa ser compativel com o que meus sistemas realmente usam.

Resposta minima de emissao:

```json
{
  "id": "doc_123",
  "status": "processamento",
  "numero": 1234,
  "serie": 1,
  "motivo": null,
  "motivo_status": null,
  "mensagens": []
}
```

Resposta minima de consulta:

```json
{
  "id": "doc_123",
  "status": "autorizado",
  "numero": 1234,
  "serie": 1,
  "chave": "4119...",
  "protocolo": "1412...",
  "motivo": "Autorizado o uso da NF-e",
  "motivo_status": "100",
  "xml_autorizado_disponivel": true,
  "pdf_disponivel": true,
  "mensagens": []
}
```

Em erro:

```json
{
  "id": "doc_123",
  "status": "erro",
  "motivo": "Falha na transmissao",
  "motivo_status": null,
  "mensagens": [
    {
      "codigo": "INTERNAL_ERROR",
      "descricao": "Detalhes do erro aqui"
    }
  ]
}
```

---

## 11. Observabilidade e diagnostico

Esse projeto precisa nascer com diagnostico forte.

Salvar sempre:
- request recebido do sistema cliente
- payload normalizado
- XML gerado
- XML assinado
- resposta bruta da SEFAZ
- status HTTP
- cStat
- xMotivo
- stack trace interno
- tempos por etapa

Criar endpoint administrativo futuro:
- consultar documento por `id`, `numero`, `chave_acesso`, `cnpj`

Regra:
- sem diagnostico escondido
- erro fiscal tem que ser rastreavel

---

## 12. Seguranca

Minimos obrigatorios:
- segredo em hash para `client_secret`
- PFX e senha criptografados
- JWT de curta duracao para access token
- rate limit por cliente
- trilha de auditoria
- segregacao por empresa emitente
- logs sem segredos
- permissao separada para homologacao e producao

---

## 13. Plano de implantacao

### Fase 1
Criar a estrutura base:
- API
- auth
- banco
- cadastro de clients
- cadastro de emitentes
- upload de certificado
- emissao inicial e compatibilidade basica

Status em 2026-06-11:
- concluida

### Fase 2
Implementar NFC-e homologacao:
- normalizacao
- XML
- assinatura
- envio
- consulta
- XML/PDF
- cancelamento

Status em 2026-06-11:
- concluida
- inclui inutilizacao real
- inclui cancelamento real
- inclui DANFE termico local com QR Code

### Fase 3
Integrar um sistema cliente real:
- trocar apenas URL e credenciais
- validar se o payload atual entra sem retrabalho grande

Status em 2026-06-11:
- concluida com a Otica Prisma em homologacao
- ainda falta repetir com outros sistemas clientes

### Fase 4
Implementar NF-e homologacao:
- emissao
- consulta
- XML/PDF
- cancelamento
- inutilizacao

Status em 2026-06-12:
- emissao NF-e homologacao autorizada na SEFAZ-PR
- XML assinado, XSD e lote `TEnviNFe` validados
- CSRT/hashCSRT calculados localmente a partir de `.env.local`
- DANFE NF-e A4 inicial implementado em endpoint compativel
- cancelamento NF-e homologacao validado via evento real `110111`
- XML de evento de cancelamento disponivel por endpoint dedicado

### Fase 5
Subir producao:
- certificados reais
- observabilidade
- retries
- backup
- alertas

### Fase 6
Avaliar NFS-e:
- somente depois da base estadual estar estavel
- por conector separado de prefeitura/provedor

---

## 14. Criterios de sucesso

Vou considerar o projeto pronto para uso inicial quando:

- um sistema atual conseguir emitir trocando basicamente `URL` e `CLIENT_ID/CLIENT_SECRET`
- o upload do certificado funcionar pela minha API
- a emissao homologacao de `NFC-e` funcionar ponta a ponta
- a emissao homologacao de `NF-e` funcionar ponta a ponta
- XML autorizado ficar salvo e disponivel para download
- erros de SEFAZ aparecerem de forma clara
- o mesmo emitente nao vazar certificado/serie para outro
- eu conseguir desligar a dependencia da Nuvem Fiscal em pelo menos um sistema real

---

## 15. Decisoes assumidas neste documento

- stack recomendada: `Node.js + TypeScript`
- banco: `PostgreSQL`
- fila: `Redis + BullMQ`
- primeiro release: `NF-e + NFC-e`
- estrategia de compatibilidade: request o mais compativel possivel com o atual
- modelo de deploy: servidor central meu
- `NFS-e` fica para fase posterior
- foco inicial: compatibilidade operacional, nao perfeicao de emulacao

---

## 16. Estado de versionamento e deploy

Versionamento atual:
- repositorio Git inicializado localmente
- branch principal: `main`
- remoto GitHub configurado
- commits-base ja publicados

Deploy esperado:
- servidor central proprio, preferencialmente VPS
- endpoint HTTPS publico, por exemplo `https://fiscal.seu-dominio.com.br`
- processos separados para Nuvem Local Fiscal e outras integracoes, como WhatsApp
- Supabase continua como banco central
- templates de `systemd`, Nginx, ambiente de servidor e backup estao em `deploy/`
- o processo possui `/health`, `/ready`, encerramento gracioso e validacao rigida para `APP_ENV=production`

Observacao:
- hoje a Otica esta validada chamando a Nuvem Local Fiscal localmente
- o proximo salto operacional real e colocar esse mesmo fluxo num servidor sempre ligado

---

## 17. Primeiros arquivos recomendados na pasta do projeto

Quando eu criar `nuvemlocalfiscal`, comecar por estes arquivos:

- `README.md`
- `NUVEMLOCALFISCAL.md`
- `docs/arquitetura.md`
- `docs/compatibilidade-nuvem-fiscal.md`
- `docs/modelo-de-dados.md`
- `docs/roadmap.md`
- `.env.example`

---

## 18. Exemplo de `.env.example`

```env
PORT=3001

DATABASE_URL=
REDIS_URL=

JWT_SECRET=

API_CLIENT_DEFAULT_ID=
API_CLIENT_DEFAULT_SECRET=

STORAGE_DIR=./storage

SEFAZ_HOMOLOG_URL=
SEFAZ_PRODUCAO_URL=

APP_ENV=development
```

---

## 19. Decisao final de produto

O `nuvemlocalfiscal` nao sera apenas um proxy HTTP.

Ele sera:
- uma camada de compatibilidade com meus sistemas atuais
- um motor fiscal centralizado
- um cofre de certificados
- um orquestrador de emissao e consulta
- uma trilha de auditoria fiscal
- a base para no futuro plugar `NFS-e` por prefeitura sem reescrever todos os sistemas clientes

Nota operacional Guaira/IPM:
- cancelamento autonomo em homologacao esta implementado pelo numero municipal
  da NFS-e
- nao usar numero interno/RPS como fallback automatico, porque pode colidir com
  outra NFS-e municipal
