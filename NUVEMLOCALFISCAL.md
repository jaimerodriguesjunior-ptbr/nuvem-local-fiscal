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

Direcao atual do produto:
- a base continua guardando a visao completa para evolucoes futuras
- a fase atual nao e mais construir tudo de uma vez
- o rumo agora e um MVP fiscal com `venda` e `devolucao` bem fechados
- tipos de emissao fora desse MVP ficam bloqueados ate necessidade real, teste e decisao explicita
- quando um cliente precisar de um tipo novo, o fluxo sera aberto pontualmente e validado antes de seguir

Escopo MVP operacional deste mes:
- clientes atuais: todos no Simples Nacional
- documentos usados: `NFC-e`, `NFS-e` e, em algumas lojas, `NF-e`
- `NFC-e`: aberta somente para venda normal, mesma UF e emissao online
- `NFS-e`: aberta somente para provedores municipais ja mapeados no motor de regras; Guaira/IPM e Toledo/Equiplano ficaram validados para emissao no MVP em 2026-07-03
- `NF-e`: aberta para venda normal e devolucao com documento referenciado, tanto pelos templates dedicados quanto pela tela `Outra operacao` quando os parametros fiscais forem de venda/devolucao
- CFOPs NF-e abertos no MVP atual: venda `5101`, `5102`, `6101`, `6102`; devolucao `5202`, `6202`. Outros CFOPs ficam bloqueados ate suporte tecnico homologar o fluxo especifico.
- `NF-e` complemento, ajuste, credito/debito e demais finalidades permanecem guardadas como conhecimento homologado, mas fechadas no MVP ate necessidade real
- a decisao comercial deste mes e funcionalidade essencial primeiro; versao por data/hora fica como evolucao posterior

Atualizacao operacional de `2026-07-03`:
- a Nuvem Local Fiscal passou a ter uma chave explicita de liberacao de
  producao: `FISCAL_PRODUCTION_ENABLED`
- por padrao, producao fiscal permanece fechada; quando
  `FISCAL_PRODUCTION_ENABLED=true`, `/ready` retorna
  `fiscalProductionBlocked=false` e a transmissao fiscal em producao fica
  habilitada para o piloto controlado
- a VPS `https://fiscal.mentebinaria.com` foi atualizada no commit
  `5999431 feat: gate production fiscal transmission` e esta ativa com
  `fiscalProductionBlocked=false`
- a Autoeletrica local foi preparada para apontar `production` para a Nuvem
  Local Fiscal, sem deploy do sistema cliente publicado
- a Autoeletrica recebeu o commit local `ec63317 feat: enable RTC groups in
  production MVP flows`; a regra `IBSCBS`/RTC usada em homologacao agora tambem
  vale em producao para os fluxos MVP de venda/devolucao, sem abrir novos
  fluxos fora do escopo
- auditoria de 2026-07-03: para `NF-e`/`NFC-e` do MVP, homologacao e producao
  seguem a mesma esteira de payload/regra; as diferencas esperadas sao
  `tpAmb`, `ambiente`, URL/credencial, numeracao por ambiente e CSRT por
  ambiente. Para `NFS-e`, ainda existem diferencas municipais/configuracoes por
  ambiente, especialmente Toledo/Equiplano.

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
- `/ready` em producao controlada retorna `persistence=supabase`; desde
  `2026-07-03`, com `FISCAL_PRODUCTION_ENABLED=true` na VPS, retorna
  `fiscalProductionBlocked=false`
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

Licoes praticas da Autoeletrica para outros programas:
- nesta fase, a Autoeletrica/NHT esta sendo usada como laboratorio real da
  Nuvem Local Fiscal; o objetivo principal nao e deixar a Autoeletrica como
  produto final perfeito agora, e sim descobrir e fechar lacunas do emissor
  compartilhado antes de levar a regra para outros programas
- NFC-e em homologacao com cliente da mesma UF foi validada ponta a ponta depois dos ajustes de homologacao
- NFC-e com cliente de outra UF nao deve seguir como NFC-e; a regra certa e bloquear cedo e orientar NF-e
- a validacao de UF precisa acontecer antes de consumir numeracao fiscal, tanto na tela quanto no backend
- a regra de bloqueio interestadual deve ficar no ponto compartilhado de emissao, nao espalhada em cada programa
- o comportamento real observado foi este: `NFC-e` mesma UF segue, `NFC-e` interestadual bloqueia, `NF-e` e o caminho certo para a operacao fora do estado
- os ajustes de RTC que apareceram durante a homologacao da Autoeletrica serviram como diagnostico de regra de montagem, nao como permissao para generalizar `IBSCBS` sem checagem de modelo e UF
- para NFC-e, o teste valido foi o fluxo com cliente dentro do estado; o teste de fora do estado so faz sentido como confirmacao de bloqueio
- quando o CSC da NFC-e foi bloqueado no cadastro da empresa, a autorizacao voltou a funcionar apos recadastrar um CSC novo na Nuvem Local Fiscal, o que confirma que parte dos erros pode vir do cadastro e nao do XML
- no app cliente, vale manter a regra de negocio simples: `NFCe` para venda interna e `NFe` para venda interestadual
- se outro programa reaproveitar o mesmo emissor base, ele deve herdar essas mesmas guardas para nao repetir o mesmo erro em producao

Detalhe historico do `IBSCBS` usado na Autoeletrica:
- em `2026-07-02`, o payload de homologacao da NFC-e recebeu um grupo RTC
  apenas no caminho homologacao do cliente
- o grupo entrou como `IBSCBS` no item e `IBSCBSTot` no total, junto com `CST`, `cClassTrib`, `gIBSCBS`, `gIBSUF`, `gIBSMun`, `gCBS`, `vBC`, `vIBS`, `vIBSUF`, `vIBSMun` e `vCBS`
- em `2026-07-02`, depois da NF-e de venda comum da Autoeletrica ser
  autorizada em homologacao sem RTC (`cStat=100`, CFOP `5102`, `finNFe=1`),
  o app cliente passou a montar `IBSCBS` tambem para NF-e modelo `55` somente
  em homologacao e somente para venda comum (`finNFe=1`, CFOP `5101`,
  `5102`, `6101` ou `6102`)
- em `2026-07-03`, essa restricao de ambiente foi removida na Autoeletrica
  local: homologacao e producao agora usam a mesma regra RTC para os fluxos MVP
  de `NF-e` venda, `NF-e` devolucao, `NF-e` assistida quando os parametros forem
  de venda/devolucao, e `NFC-e` venda mesma UF. A regra continua bloqueando
  generalizacao fora do MVP.
- a primeira tentativa de NF-e venda com `IBSCBS` na Autoeletrica foi barrada
  pela Nuvem Local antes da SEFAZ com `missing_rtc_municipality` em
  `infNFe.ide.cMunFGIBS`; a correcao no app cliente foi incluir `cMunFGIBS`
  apenas quando a propria regra de RTC de homologacao da NF-e de venda estiver
  ativa
- a tentativa seguinte (`nfe-3.xml`, numero `774460378`, serie `1`, CFOP
  `5102`, `finNFe=1`, `tpAmb=2`) foi autorizada com `cStat=100`, protocolo
  `141260000401979`, contendo `cMunFGIBS`, `IBSCBS` no item e `IBSCBSTot` no
  total; isso comprova NF-e de venda comum da Autoeletrica em homologacao com
  RTC ponta a ponta
- em seguida, a devolucao em homologacao foi validada com a `nfe-4.xml` a
  partir de uma NF-e de entrada temporaria usada apenas para destravar o fluxo;
  depois da emissao, essa linha de apoio foi removida do banco
- a primeira forma testada mostrou que o schema era sensivel ao formato decimal dos percentuais; `pIBSUF`, `pIBSMun` e `pCBS` precisaram ser enviados em formato aceito pelo XSD, e nao como numero solto com arredondamento implicito
- depois disso, a SEFAZ passou a rejeitar o municipio com `1036 - Aliquota do IBS do Municipio invalida. [nItem:1]`
- a tentativa seguinte removeu a alíquota municipal do caminho de teste, mantendo o grupo RTC presente e zerando o municipio
- em seguida a SEFAZ passou a rejeitar a UF com `1026 - Alíquota do IBS da UF invalida. [nItem:1]`
- a conclusao pratica foi que, para esse cenário de NFC-e homologacao, o grupo RTC nao deve ser tratado como receita para venda interestadual; ele precisava respeitar a regra de modelo e UF antes de tentar compor aliquotas
- no estado final validado, a NFC-e homologacao ficou com `IBSCBS` presente apenas como parte do teste de estrutura, mas a operacao interestadual foi bloqueada no app antes do envio
- o resultado real do teste foi o `707 - NFC-e para operacao interestadual ou com o exterior`, que confirmou que esse fluxo nao deve continuar como NFC-e
- esse conjunto de testes mostrou que `IBSCBS` nao pode ser copiado cegamente para outros programas; primeiro e preciso decidir se o documento e NFC-e ou NF-e, depois aplicar a regra de RTC correta para o modelo
- a regra compartilhada a ser herdada pelos demais programas e esta: NFC-e so para operacao interna; se a UF do cliente divergir, o fluxo deve parar antes de assinar, consumir numeracao ou retransmitir

Pontos que precisam ficar vivos para a proxima rodada:
- a correcao importante nao foi so `UF`; o ganho maior foi transformar uma rejeicao fiscal em bloqueio preventivo dentro do emissor
- a validacao interestadual deve existir no backend comum e, se houver UI propria, tambem na tela para dar erro antes de chamar a API
- bloquear cedo evita consumir numeracao NFC-e sem chance real de autorizacao
- o comportamento da Autoeletrica provou que o mesmo app pode passar por varias rodadas de ajuste sequencial; cada novo erro deve ser interpretado como nova regra confirmada, nao como falha aleatoria
- `IBSCBS` so deve existir em caminhos que realmente estejam prontos para reforma tributaria e compatibilidade do modelo; em NFC-e, o importante neste momento foi provar a fronteira de bloqueio, nao liberar generalizacao
- CSC continua sendo um ponto cadastral separado da regra do XML; quando a rejeicao aponta para QR/CSC, vale revisar cadastro da empresa na Nuvem Local antes de mexer no payload
- outros programas que consumirem o mesmo emissor devem herdar o mesmo contrato: mesma UF -> segue NFC-e; UF diferente -> bloqueia e sugere NF-e; sem isso, o erro volta em outro cliente
- essa memorizacao precisa sobreviver a troca de contexto porque ela afeta os proximos programas mais do que os ajustes pontuais de homologacao

Resumo curto para reuso:
- NFC-e interestadual bloqueada
- NF-e interestadual segue como caminho correto
- RTC/IBSCBS em NFC-e nao deve ser tratado como atalho para exportar regra de um programa para outro
- o ponto certo de blindagem e o emissor compartilhado, nao o formulario de cada cliente

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
- configuracao NF-e por ambiente: servico ativo/inativo e transmissao
  automatica; desde `2026-07-03`, producao controlada depende da chave global
  `FISCAL_PRODUCTION_ENABLED=true`
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
- historicamente, producao NFS-e ficava bloqueada pelo perfil do motor de
  regras; desde `2026-07-03`, a chave global
  `FISCAL_PRODUCTION_ENABLED=true` remove o bloqueio geral, mas cada municipio
  continua exigindo configuracao correta por ambiente, teste e evidencia
  regulatoria da data vigente
- a NFS-e Toledo/Equiplano foi validada ponta a ponta em homologacao em 2026-06-13:
  - `POST /nfse/dps` aceita payload estilo Nuvem Fiscal
  - `GET /nfse/:id` consulta o documento e o RPS no Equiplano
  - `GET /nfse/:id/xml` disponibiliza o XML municipal autorizado
  - `GET /nfse/:id/pdf` gera o PDF local da NFS-e com dados municipais, prestador, tomador, servico e impostos
  - `POST /nfse/:id/cancelamento` e o alias `/nfse/:id/cancelar` transmitem cancelamento municipal
  - `GET /nfse/:id/cancelamento/xml` disponibiliza o XML de cancelamento
  - historicamente, producao NFS-e permanecia bloqueada; para piloto controlado
    em `2026-07-03`, a liberacao geral passou a ser feita por
    `FISCAL_PRODUCTION_ENABLED=true`, sem dispensar configuracao municipal real
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

Checkpoint regulatorio historico em `2026-07-01`:
- foi feita uma revisao de aderencia legal considerando a data corrente `2026-07-01`
- conclusao operacional: a base esta consistente para homologacao controlada de `NF-e` e `NFC-e` no PR, mas ainda nao pode ser tratada como emissor plenamente aderente para uso fiscal real em producao
- naquela data, a producao continuava bloqueada no codigo e deveria permanecer
  assim ate segunda ordem; em `2026-07-03`, essa segunda ordem virou a chave
  operacional `FISCAL_PRODUCTION_ENABLED=true` para piloto controlado do MVP
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
- `PROD-GATE`: manter uma chave operacional visivel em `/ready`; antes da
  liberacao controlada ela deve retornar `fiscalProductionBlocked=true`, e no
  piloto de `2026-07-03` retorna `false` somente porque
  `FISCAL_PRODUCTION_ENABLED=true` esta ativo na VPS

Primeiro recorte recomendado:
1. validar `NFE-XSD`, `RT-BASE` e `RT-XML` em XML NF-e e NFC-e de homologacao
2. revisar `NFCE-QR`, `NFE-CSRT` e PDFs/DANFE ja gerados
3. transformar `RT-VALIDACAO`, `CONTINGENCIA` e `RETRY-FILA` em regras/testes
4. so depois discutir liberacao controlada de producao por empresa e por sistema

Diagnostico inicial do recorte `NFE-XSD` / `RT-BASE` / `RT-XML` em
`2026-07-02`:
- fonte oficial consultada: Portal da Nota Fiscal Eletronica - SVRS, pagina
  `Documentos`, em `2026-07-02`
- `NFE-XSD`: status `fechado para o pacote base em 2026-07-02`; o projeto usa
  pacote oficial local `PL_010c_NT2022_002v1.30`, valida NF-e/NFC-e com
  `nfe_v4.00.xsd` e ja possui campos recentes no schema
- em `2026-07-02`, foi baixado novamente do portal SVRS o ZIP oficial
  `PL_010c_NT2022_002v1.30.zip`; os hashes SHA-256 dos cinco XSDs locais
  bateram com o ZIP oficial, entao nao ha troca de pacote XSD a fazer neste
  momento
- `RT-BASE`: status `fechado para o recorte de identificacao de base`; o portal
  lista como schema mais recente o `Pacote de schemas - NT 2022.002 v1.30`
  em `20/03/2026`, e lista como notas tecnicas/regulatorias relevantes a
  `Nota Tecnica 2025.002 v1.50 - RTC` em `02/06/2026`, a `Nota Tecnica
  2026.004 - Schema CNPJ Alfa v1.01` em `08/06/2026`, a `Nota Tecnica
  2026.002` sobre operacoes presenciais e nao presenciais com
  `DANFE Simplificado Tipo 2` em `22/05/2026`, a `Nota Tecnica 2026.003` com
  especificacoes tecnicas do `DANFE Simplificado Tipo 2` em `22/05/2026` e a
  `NT 2025.001 v1.01 - NFCe_qrCode_3` em `26/06/2025`
- o fechamento de `RT-BASE` nao libera producao nem fecha as regras de negocio
  da RTC; ele apenas confirma qual pacote XSD e qual conjunto de notas tecnicas
  devem orientar os proximos testes e validacoes
- `src/lib/nfe-schema-package.ts` centraliza a identidade do pacote XSD base e
  `src/lib/nfe-schema-package.test.ts` garante por hash que os arquivos locais
  continuam identicos ao pacote oficial validado em `2026-07-02`
- `RT-XML`: status `parcial`; o gerador consegue preservar grupos/campos novos
  quando recebidos no payload e o schema local possui estruturas ligadas a
  `IBSCBS`, `IBSCBSTot`, `cMunFGIBS`, `idCSRT` e `hashCSRT`, e agora possui um
  teste automatizado com amostra minima de RTC passando por geracao de XML,
  assinatura, lote e validacao XSD
- em `2026-07-02`, foi criado teste automatizado de `RT-XML` minimo para
  NF-e modelo `55` e NFC-e modelo `65`, cobrindo preservacao de `IBSCBS` no item
  e `IBSCBSTot` no total; para NF-e o teste tambem cobre `cMunFGIBS`
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
- em `2026-07-02`, a regra da Autoeletrica deixou de ser apenas memoria do
  cliente e virou contrato no emissor compartilhado: NFC-e interestadual ou com
  `idDest` diferente de operacao interna bloqueia no `POST /nfce` antes de
  `createDocument`, evitando consumir numeracao, assinar XML ou transmitir para
  a SEFAZ
- a mesma guarda tambem roda na assinatura admin e no processamento automatico,
  usando a UF cadastrada do emitente quando disponivel; isso protege retries e
  acoes manuais contra o mesmo erro
- em `2026-07-02`, foi adicionada uma validacao defensiva compartilhada de RTC
  em `src/lib/rtc-rules.ts`: quando um payload NF-e/NFC-e envia grupo
  `IBSCBS`, a API exige consistencia minima antes de gerar XML fiscal
- essa validacao nao torna IBS/CBS obrigatorio para todos os documentos; ela
  apenas impede payload meio preenchido, exigindo `CST` com 3 digitos,
  `cClassTrib` com 6 digitos, `gIBSCBS` ou `gIBSCBSMono`, `vBC` quando houver
  `gIBSCBS`, e totais `IBSCBSTot.vBCIBSCBS`
- a homologacao real da Autoeletrica em `2026-07-02` mostrou que, para NFC-e
  modelo `65`, `cMunFGIBS` e rejeitado pela SEFAZ com `1000 - Municipio do fato
  gerador do IBS informado indevidamente`; a validacao local passou a aceitar
  NFC-e com `IBSCBS` sem `cMunFGIBS` e a bloquear `cMunFGIBS` indevido antes da
  transmissao
- para NF-e modelo `55`, a validacao RTC continua exigindo `cMunFGIBS` quando
  houver grupo `IBSCBS`
- em `2026-07-02`, a validacao RTC passou a conhecer o modelo esperado pelo
  endpoint: `/nfe` com `IBSCBS` exige modelo `55`, `/nfce` com `IBSCBS` exige
  modelo `65`, e NFC-e com `IBSCBS` mais `idDest` nao interno bloqueia antes de
  criar documento fiscal
- a regra RTC compartilhada foi aplicada no `POST /nfe`, reaproveitada no
  validador NFC-e, e tambem executa antes de assinatura admin e processamento
  automatico; isso evita que retries ou assinatura manual gerem XML RTC
  incompleto
- testes automatizados cobrem o contrato de bloqueio: NFC-e interestadual nao
  altera a contagem de documentos, `/nfe` rejeita payload RTC de modelo `65`, e
  `src/lib/rtc-rules.test.ts` cobre modelo errado, modelo ainda nao validado e
  NFC-e RTC nao interna
- em `2026-07-02`, o contrato estrutural de `RT-CLASSIFICACAO` avancou na
  validacao compartilhada: `IBSCBS` regular agora exige, alem de `CST`,
  `cClassTrib`, base e total, os blocos minimos `gIBSUF`, `gIBSMun`, `vIBS` e
  `gCBS`; `IS` passou a exigir `CSTIS`, `cClassTribIS`, valores de calculo e
  `ISTot` quando informado
- em `2026-07-02`, foi criado o catalogo RTC local versionado em
  `src/lib/rtc-classification-catalog.ts`; a validacao compartilhada agora
  bloqueia pares `CST/cClassTrib` e `CSTIS/cClassTribIS` que nao estejam
  explicitamente cadastrados nesse catalogo, antes da geracao de XML
- o catalogo atual carrega, para IBS/CBS, as classificacoes oficiais extraidas
  do JSON arquivado da SVRS/CFF; o `IS` ainda fica somente com a combinacao de
  smoke estrutural (`000/000001`) ate haver fonte oficial propria para Imposto
  Seletivo
- a fonte oficial da tabela foi arquivada localmente em
  `classificacoes-tributarias-02-07-2026_17-44-56.json`, extraida da pagina
  oficial "Classificacao Tributaria" da SVRS/CFF; o texto copiado da pagina
  indicava 164 registros, enquanto o JSON arquivado contem 161 entradas
- a diferenca `164 x 161` foi reconciliada em `2026-07-02`: os tres codigos
  que aparecem no PDF e nao no JSON vigente sao `220001`, `220002` e `220003`;
  no historico do IT 2025.002 v1.60 eles constam como exclusao do CST `220`
  com fim de vigencia, por isso nao foram carregados no catalogo ativo
- esse arquivo existe como evidencia de consulta para nao depender da memoria
  da conversa e agora alimenta `src/lib/rtc-classifications-2026-07-02.ts`,
  gerado por `scripts/generate-rtc-classification-catalog-data.mjs`
- a busca local por fonte oficial de `CSTIS/cClassTribIS` ainda nao encontrou
  tabela propria de Imposto Seletivo; o XSD confirma a estrutura do grupo `IS`,
  mas nao substitui a tabela classificatoria oficial
- em `2026-07-02`, foi criado o primeiro perfil operacional de conciliacao RTC
  em `src/lib/rtc-operation-classification.ts`: venda comum de mercadoria
  (`finNFe=1` e CFOP `5101`, `5102`, `6101` ou `6102`) exige `CST=000` e
  `cClassTrib=000001` quando o payload ja trouxer `IBSCBS`
- essa conciliacao nao injeta classificacao automaticamente e nao tenta decidir
  operacoes especiais; ela apenas bloqueia divergencia entre uma venda comum
  reconhecivel e um par RTC oficial que nao corresponda ao perfil operacional
- em seguida, as finalidades referenciadas `2`, `3`, `4`, `5` e `6`
  (complemento, ajuste, devolucao, credito ou debito) passaram a bloquear
  `IBSCBS` ate existir perfil RTC operacional explicito; isso impede que uma
  devolucao/complemento/ajuste reaproveite por acidente a regra de venda comum
- em `2026-07-03`, a devolucao de mercadoria entrou no MVP RTC como perfil
  operacional proprio para NF-e modelo `55`: `finNFe=4` com CFOP `5202` ou
  `6202` passa a aceitar `IBSCBS` com `CST=000` e `cClassTrib=000001`, mantendo
  complemento e ajuste bloqueados ate perfil proprio
- em `2026-07-03`, a Autoeletrica/NHT comprovou esse perfil em homologacao:
  `nfe-8.xml` autorizou devolucao por template com `NFref`, `CFOP=5202`,
  `IBSCBS`, `cMunFGIBS` e `cStat=100`; `nfe-10.xml` autorizou venda pela tela
  `Outra operacao` com `CFOP=5102`, `IBSCBS` e `cStat=100`; `nfe-12.xml`
  autorizou devolucao pela tela `Outra operacao` com `NFref`, `CFOP=5202`,
  `IBSCBS`, `cMunFGIBS` e `cStat=100`
- no programa cliente base Autoeletrica, a harmonizacao de RTC deve cobrir
  apenas os fluxos abertos no MVP: venda e devolucao. Isso inclui os templates
  dedicados e a tela `Outra operacao` somente quando os parametros fiscais
  representarem venda (`finNFe=1` + CFOP de venda) ou devolucao (`finNFe=4` +
  CFOP `5202`/`6202`); demais operacoes continuam fora do escopo ate decisao
  propria
- testes automatizados cobrem o bloqueio de par RTC desconhecido, par de
  Imposto Seletivo desconhecido, classificacao oficial nao liberada para
  NF-e/NFC-e, codigos `220` excluidos do catalogo ativo e grupo monofasico do
  CST `620`, alem da divergencia de classificacao em venda comum e do bloqueio
  de RTC em finalidade referenciada sem perfil proprio
- esse fechamento e deliberadamente estrutural: ele impede payload RTC meio
  montado e impede que o emissor invente aliquota/classificacao, mas ainda nao
  declara que a escolha legal de `CST`, `cClassTrib` e `cClassTribIS` por tipo
  de operacao esta conciliada com a tabela oficial vigente
- a validacao defensiva ainda nao fecha regras tributarias profundas da reforma
  tributaria; a conciliacao legal de `CST`, `cClassTrib`, `cClassTribIS`,
  municipio do fato gerador, IBS/CBS/IS e demais exigencias novas continua como
  parte de `RT-CLASSIFICACAO` antes de producao
- em `2026-07-02`, `REFERENCIAMENTO` ganhou regra compartilhada em
  `src/lib/document-reference-rules.ts`, aplicada nos validadores de NF-e e
  NFC-e: finalidades `2`, `3`, `4`, `5` e `6` exigem `NFref`, e referencias por
  chave (`refNFe`, `refNFeSig`, `refCTe`), NF antiga, produtor rural e ECF
  passam por validacao estrutural antes de criar documento fiscal
- o contrato HTTP cobre `/nfe` com finalidade referenciada sem `NFref` retornando
  `400` sem alterar a contagem de documentos; a Autoeletrica/NHT ja fechou
  devolucao do MVP com `NFref` e `IBSCBS`, enquanto complemento e ajuste ficam
  apenas como historico homologado sem `IBSCBS`
- a lacuna de RTC agora ficou mais estreita: devolucao tem perfil inicial no
  MVP, enquanto complemento, ajuste, credito e debito continuam exigindo perfil
  RTC operacional proprio antes de aceitar classificacao tributaria
- em `2026-07-02`, `RETRY-FILA` ganhou a primeira politica compartilhada em
  `src/lib/retry-rules.ts`: falhas externas incertas de autorizacao SEFAZ
  (`timeout`, `socket`, `ECONNRESET`, HTTP 5xx e similares) sao classificadas
  separadamente de rejeicoes fiscais e falhas deterministicas
- quando o processamento automatico falha, o evento persistido
  `authorization_attempt_failed` passa a gravar `attempt`,
  `uncertainExternalState`, `retryable`, `retryReasonCode` e `nextRetryAt`,
  aplicando backoff limitado; rejeicao fiscal, erro deterministico e documento
  terminal nao entram em retry automatico
- esse contrato fecha a decisao local de retry seguro, mas ainda nao implementa
  worker agendado nem lock distribuido entre instancias; esses pontos continuam
  bloqueando producao ate haver smoke multi-instancia
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
- `DANFE-TIPO2`: status `bloqueado para o escopo inicial`; a NF-e local esta
  validada apenas para `tpImp=1` (DANFE A4 retrato). O schema permite outros
  tipos de impressao, incluindo paisagem, simplificado, NFC-e e sem DANFE, mas
  enquanto esses layouts nao tiverem implementacao e teste proprios, `/nfe`,
  assinatura admin e processamento automatico rejeitam `tpImp` diferente de `1`
  antes de criar documento/consumir numeracao
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
1. concluido em `2026-07-02`: comparar o pacote local
   `PL_010c_NT2022_002v1.30` com o pacote oficial vigente no portal SVRS e
   travar a integridade dos XSDs por teste automatizado
2. transformar lacunas restantes de `RT-VALIDACAO`, `DANFE-TIPO2`,
   `REFERENCIAMENTO`, `RETRY-FILA` e `CNPJ-ALFA` em regras/testes
   - andamento em `2026-07-02`: primeira validacao RTC compartilhada para
     grupos `IBSCBS` incompletos em NF-e/NFC-e
   - andamento em `2026-07-02`: contrato compartilhado de modelo/fluxo para
     `IBSCBS` e bloqueio preventivo de NFC-e interestadual implementados e
     cobertos por teste
   - andamento em `2026-07-02`: catalogo RTC local versionado criado; pares
     `CST/cClassTrib` e `CSTIS/cClassTribIS` desconhecidos agora sao bloqueados
     antes do XML
   - andamento em `2026-07-02`: lacuna `DANFE-TIPO2` fechada como bloqueio de
     escopo; NF-e local aceita somente `tpImp=1` ate existir layout/teste para
     os demais tipos de impressao
   - andamento em `2026-07-02`: NF-e de devolucao da Autoeletrica/NHT validada
     em homologacao com `NFref` e itens carregados a partir de uma NF-e de
     entrada temporaria, removida do banco apos o teste
   - andamento em `2026-07-02`: complemento (`finNFe=2`) e ajuste
     (`finNFe=3`) ganharam contrato automatizado explicito: com `NFref` valido
     e sem `IBSCBS`, o payload NF-e passa pela regra compartilhada; com
     `IBSCBS`, continua bloqueado ate existir perfil RTC proprio
   - andamento em `2026-07-02`: a emissao real de ajuste da Autoeletrica/NHT
     foi validada em homologacao com a `nfe-7.xml` (`finNFe=3`, `tpNF=1`,
     `natOp=AJUSTE`, `CFOP=5949`, `NFref` da nota origem e `cStat=100`),
     fechando junto com o complemento o ciclo de finalidades referenciadas
3. manter producao bloqueada ate esses pontos terem evidencia tecnica ou decisao
   formal de fora de escopo

Matriz viva de homologacao:
- em `2026-07-02`, a decisao operacional passou a ser fechar homologacao como
  matriz unica antes de discutir producao, cobrindo documento, instancia,
  evidencia e proximo passo
- `src/lib/homologation-matrix.ts` virou o contrato programatico dessa matriz,
  separado em tres estados:
  - `satisfied`: fluxo homologado ou coberto por regressao no escopo atual
  - `scoped_block`: fluxo recusado de forma intencional e documentada para o
    escopo inicial
  - `blocks_production`: lacuna que impede producao ate ter evidencia, teste ou
    decisao formal
- itens satisfeitos no escopo atual: NF-e PR/Otica com autorizacao, DANFE A4,
  cancelamento e inutilizacao; NFC-e PR/Otica e Autoeletrica para operacao
  interna; guarda NFC-e interestadual; NF-e venda e devolucao Autoeletrica/NHT
  em homologacao com RTC/`IBSCBS`, incluindo template e tela `Outra operacao`;
  NFS-e Toledo/Equiplano; NFS-e Guaira/IPM para emissao
- itens homologados apenas como historico fora do MVP: NF-e complemento e
  ajuste em homologacao com `NFref` valido e sem `IBSCBS`; esses fluxos nao
  devem ficar abertos por padrao neste mes
- bloqueios intencionais de escopo: NFC-e offline `tpEmis=9` e NF-e com
  `tpImp` diferente de `1`
- itens que ainda exigem fechamento antes de uma operacao ampla: conciliacao
  legal fina da classificacao RTC fora do MVP, retries/processamento
  distribuido e cancelamento Guaira/IPM com evidencia real
- complemento/ajuste nao sao foco operacional agora: o contrato automatizado e
  as emissoes reais validaram conhecimento util para o futuro, mas esses fluxos
  permanecem fechados ate demanda real e novo perfil fiscal
- `src/lib/homologation-matrix.test.ts` garante que esses bloqueios continuam
  visiveis; se alguem marcar producao como pronta sem fechar a matriz, o teste
  deve denunciar a mudanca
- a Autoeletrica deve continuar aparecendo na matriz como fonte de evidencia
  operacional da Nuvem Local Fiscal; ajustes finos de produto em cada sistema
  cliente ficam para a etapa posterior, programa por programa

Limites atuais:
- transmissao automatica pode processar NFC-e/NF-e em homologacao quando
  habilitada; desde `2026-07-03`, producao controlada pode ser ligada por
  `FISCAL_PRODUCTION_ENABLED=true`
- producao ampla continua fora do escopo; a liberacao atual e apenas para
  piloto controlado do MVP, com acompanhamento e fallback
- homologacao continua sendo a trilha de prova, mas em `2026-07-03` foi feita
  a harmonizacao da Autoeletrica local para que os testes reais de producao do
  MVP usem a mesma regra RTC/`IBSCBS` validada em homologacao
- NFS-e Toledo/Equiplano possui configuracao no admin e fluxo homologado de emissao, consulta, XML, PDF e cancelamento
- em `2026-07-03`, a empresa Toledo da Autoeletrica retornou `nfse-5.xml` com
  `nrNfse=5`, `cdAutenticacao` e `dtEmissaoNfs`, reforcando que o caminho
  Toledo/Equiplano do MVP esta satisfeito em homologacao
- NFS-e Toledo/Equiplano agora possui guardas locais para `idEntidade`, data de
  RPS futura e reutilizacao local de lote/RPS
- NFS-e Guaira/IPM possui emissao controlada homologada, XML e PDF local; a
  estrategia de rede usa uma EC2 AWS Sao Paulo como gateway IPM persistente por
  tunel reverso `autossh`, enquanto consulta municipal e cancelamento ainda
  precisam ser fechados
- em `2026-07-03`, a empresa Guaira da Autoeletrica retornou `nfse-15.xml` com
  `numero_nfse=203`, situacao `Emitida`, `link_nfse` e
  `cod_verificador_autenticidade`; para o MVP, isso fecha emissao e
  consultabilidade por link/autenticidade em homologacao
- cancelamento Guaira/IPM fica aberto no MVP; o XML de cancelamento e o parser
  de sucesso ja possuem contrato automatizado, mas ainda falta cancelar uma
  NFS-e real de homologacao e registrar o retorno municipal
- a primeira tentativa de cancelamento da NFS-e Guaira `203` retornou codigo
  `206 - Nenhuma NFSe foi encontrada na base de dados utilizando os parametros
  para pesquisa informados`; a tentativa seguinte com `<cadastro>` no XML de
  cancelamento mostrou erro de schema IPM, entao esse campo ficou descartado
  para cancelamento e o fluxo segue aberto para novo teste com o formato certo
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
  IBGE informado e aplica defaults municipais seguros; em producao controlada,
  a chave global `FISCAL_PRODUCTION_ENABLED=true` remove o bloqueio geral, mas
  NFS-e continua exigindo configuracao municipal correta por ambiente
- a lista de empresas possui a acao `Nova empresa`, que cria o primeiro ambiente fiscal e abre o cadastro para certificado e servicos
- NF-e homologacao ja emite, possui DANFE A4 inicial e cancelamento real validado
- cancelamento real esta habilitado apenas em homologacao para documentos autorizados
- o deploy em VPS ja foi feito e validado em homologacao; `127.0.0.1:3001` continua valido para desenvolvimento local
- filas/retries ainda precisam ser fechados
- o processamento de autorizacao ja possui trava local por documento, consulta previa da chave, historico persistente em `fiscal_document_events` e politica local de retry seguro para falha externa incerta; retries agendados e processamento distribuido ainda precisam ser fechados antes do deploy
- a classificacao RTC ja possui catalogo local versionado, bloqueio para pares
  desconhecidos e catalogo oficial IBS/CBS derivado de
  `classificacoes-tributarias-02-07-2026_17-44-56.json`; a venda comum de
  mercadoria e a devolucao de mercadoria ja possuem conciliacao inicial com
  `000/000001`; complemento, ajuste, credito e debito bloqueiam `IBSCBS` ate
  perfil proprio, enquanto os demais tipos de operacao reais dos clientes e a
  fonte oficial de IS continuam pendentes
- a checagem de saude fiscal e diagnostica; ela nao substitui emissao de teste homologada
- para persistir inutilizacoes no Supabase, aplicar a migracao `supabase/migrations/20260611_002_fiscal_inutilizations.sql`
- para persistir cancelamentos no Supabase, aplicar a migracao `supabase/migrations/20260611_003_fiscal_cancellations.sql`
- a migracao `supabase/migrations/20260613_001_nfse_provider_artifacts.sql` foi aplicada manualmente no Supabase em 2026-06-13

Proximo foco:
0. tratar este MVP como base oficial de trabalho do mes: `NFC-e` venda mesma
   UF, `NF-e` venda/devolucao e `NFS-e` nas pracas ja validadas
1. concluido em `2026-07-03`: o motor de regras bloqueia NF-e fora do MVP por
   finalidade e por CFOP, com mensagem orientando suporte tecnico e homologacao
   propria
2. concluido em `2026-07-03`: `src/lib/mvp-activation-checklist.ts` define o
   checklist de ativacao por empresa, cobrindo cadastro fiscal, certificado,
   CSC quando NFC-e, servicos, credenciais municipais quando NFS-e, smoke em
   homologacao e fallback de suporte
3. em andamento em `2026-07-03`: preparar piloto controlado com a Autoeletrica
   local apontando producao para a Nuvem Local Fiscal, usando somente os fluxos
   ja homologados do MVP, com acompanhamento proximo e fallback para Nuvem
   Fiscal enquanto ela ainda estiver disponivel
4. cancelar uma NFS-e Guaira/IPM em homologacao para fechar o fluxo de
   cancelamento municipal no MVP, usando o XML no formato aceito pelo schema IPM
5. manter complemento, ajuste, remessa, doacao, transferencia, retorno e demais
   operacoes fechadas por padrao; abrir apenas sob demanda real, com prazo,
   teste especifico e registro neste documento
6. deixar virada de versao por data/hora para depois da estabilizacao do MVP
   operacional deste mes
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
