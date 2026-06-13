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
- o deploy atual da VPS esta no commit `3e42884 fix: require municipal NFSe cancellation confirmation`
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
- dados do responsavel tecnico e CSRT por ambiente via `.env.local`
- documentos com payload original, payload normalizado, XML gerado, XML assinado, XML autorizado, resposta SEFAZ e dados de protocolo
- inutilizacoes com faixa, justificativa, XML assinado, resposta SEFAZ, protocolo e status
- cancelamentos com justificativa, evento assinado, resposta SEFAZ, protocolo e data de registro
- a aba NF-e do admin e propositalmente enxuta; Documentos e Logs e debug possuem filtros e downloads de XML autorizado, DANFE, cancelamento e inutilizacao

Limites atuais:
- transmissao automatica pode processar NFC-e/NF-e em homologacao quando habilitada; producao permanece bloqueada
- producao permanece bloqueada por seguranca
- NFS-e Toledo/Equiplano possui configuracao no admin e fluxo homologado de emissao, consulta, XML, PDF e cancelamento
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
1. abrir o conector Guaira/IPM usando o fluxo e os payloads existentes na Autoeletrica
2. confirmar endpoint, homologacao, autenticacao e contrato municipal de Guaira antes de transmitir
3. manter compatibilidade com payloads dos sistemas clientes; nao alterar cliente sem necessidade
4. manter producao bloqueada na Nuvem Local Fiscal
5. fechar retries agendados e estrategia de processamento distribuido antes de qualquer uso fiscal amplo
6. manter a checagem de saude fiscal como passo obrigatorio antes de novos testes

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
