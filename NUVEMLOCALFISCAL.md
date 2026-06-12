# NUVEMLOCALFISCAL

## Summary
Este documento define o projeto `nuvemlocalfiscal`: uma API propria que imita a Nuvem Fiscal o suficiente para que meus sistemas atuais precisem trocar apenas `URL` e `CLIENT_ID/CLIENT_SECRET` no `.env.local` e depois no Vercel.

Objetivo do v1:
- aceitar autenticacao parecida com a da Nuvem Fiscal
- receber os mesmos requests principais que meus sistemas ja enviam hoje
- centralizar certificados por empresa
- traduzir os payloads para SEFAZ
- devolver respostas compativeis o bastante para evitar reescrever os sistemas clientes

Fora do v1:
- cobertura completa de NFS-e por prefeitura
- imitar 100% da Nuvem Fiscal
- dashboard bonito antes da base estar estavel

---

## 0. Marco atual validado em 2026-06-12

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
- o DANFE NF-e proprio ainda precisa ser implementado; o PDF atual nasceu para NFC-e termica
- a UI admin possui cadastro unico por empresa, abas Dados/Certificado/Servicos e separacao por ambiente homologacao/producao
- a inutilizacao de numeracao para NFC-e/NF-e em homologacao ja possui endpoint, assinatura XML, transmissao SEFAZ e formulario simples na UI
- o cancelamento de NFC-e em homologacao ja usa evento real `110111`, com protocolo proprio e persistencia separada do protocolo de autorizacao
- o projeto ja esta versionado em Git e publicado no GitHub em `main`

Marco NF-e homologacao validado:
- documento local: `doc_93323d3e`
- chave: `41260601997929000108550020000090051152123354`
- protocolo: `141260000345721`
- status SEFAZ: `100 - Autorizado o uso da NF-e`
- lote: `104 - Lote processado`
- recebimento: `2026-06-12T10:38:14-03:00`
- CSRT/hashCSRT: configurados por `.env.local` via `NFE_RT_*` e `NFE_CSRT_*`

Endpoints compativeis ja exercitados:
- `POST /oauth/token`
- `POST /nfe`
- `GET /nfe/:id`
- `GET /nfe/:id/xml`
- `GET /nfe/:id/pdf`
- `POST /nfce`
- `GET /nfce/:id`
- `POST /nfce/:id/cancelar`
- `GET /nfce/:id/xml`
- `GET /nfce/:id/pdf`
- `POST /empresas`
- `PUT /empresas/:cnpj`
- `GET /empresas/:cnpj`
- `PUT /empresas/:cnpj/certificado`
- `PUT /empresas/:cnpj/nfce`
- `GET /empresas/:cnpj/nfce`
- `POST /nfce/inutilizacoes`
- `GET /nfce/inutilizacoes/:id`
- `POST /nfe/inutilizacoes`
- `GET /nfe/inutilizacoes/:id`

Configuracoes persistidas:
- empresa/ambiente: UF, IE, CRT, serie NF-e e serie NFC-e
- certificado A1 ativo por CNPJ
- configuracao NFC-e por ambiente: CSC ID e CSC criptografado
- dados do responsavel tecnico e CSRT por ambiente via `.env.local`
- documentos com payload original, payload normalizado, XML gerado, XML assinado, XML autorizado, resposta SEFAZ e dados de protocolo
- inutilizacoes com faixa, justificativa, XML assinado, resposta SEFAZ, protocolo e status
- cancelamentos com justificativa, evento assinado, resposta SEFAZ, protocolo e data de registro

Limites atuais:
- transmissao automatica pode processar NFC-e/NF-e em homologacao quando habilitada; producao permanece bloqueada
- producao permanece bloqueada por seguranca
- NFS-e aparece como area reservada, mas ainda nao esta pronta para emissao
- NF-e homologacao ja emite, mas ainda falta DANFE NF-e proprio e cancelamento NF-e real validado
- cancelamento real esta habilitado apenas em homologacao para documentos autorizados
- o deploy em servidor/VPS ainda nao foi feito; os testes atuais foram locais apontando a Otica para `127.0.0.1:3001`
- filas/retries ainda precisam ser fechados
- a checagem de saude fiscal e diagnostica; ela nao substitui emissao de teste homologada
- para persistir inutilizacoes no Supabase, aplicar a migracao `supabase/migrations/20260611_002_fiscal_inutilizations.sql`
- para persistir cancelamentos no Supabase, aplicar a migracao `supabase/migrations/20260611_003_fiscal_cancellations.sql`

Proximo foco:
1. fechar XML/PDF de NF-e autorizada com DANFE NF-e proprio
2. validar cancelamento real de NF-e em homologacao
3. planejar o deploy em VPS com HTTPS, processo Node persistente e backup
4. manter a checagem de saude fiscal como passo obrigatorio antes de novos testes
5. testar outros sistemas clientes somente depois do ambiente central estar estavel

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
- ainda falta DANFE NF-e proprio e cancelamento NF-e validado

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
