# Suporte Técnico VPS

Este documento serve como base para uma nova repo de suporte técnico que vai usar a mesma VPS já usada para fiscal e WhatsApp.

Objetivo:
- receber chamados por botão nos sistemas clientes
- identificar `programa`, `store_id` e `tipo`
- encaminhar o chamado para Telegram
- manter uma trilha operacional clara para a futura fase de acesso remoto com autorização

## Decisão de arquitetura

O suporte técnico deve nascer como um serviço separado.

Motivos:
- o fluxo é transversal a vários programas
- evita misturar suporte com fiscal e WhatsApp
- facilita evoluir depois para controle remoto autorizado
- reduz risco de quebrar integrações já estabilizadas

## VPS atual e caminhos corretos

Estes são os caminhos e pontos de acesso que hoje devem ser tratados como canonicos:

- SSH da VPS principal: `root@191.252.205.29`
- dominio fiscal publicado: `https://fiscal.mentebinaria.com`
- app fiscal na VPS: `/opt/nuvem-local-fiscal`
- arquivo de ambiente da VPS: `/etc/nuvem-local-fiscal.env`
- service systemd atual: `nuvem-local-fiscal.service`
- certificado ICP-Brasil na VPS: `/opt/nuvem-local-fiscal/certificates/icp-brasil-root-v10.pem`
- porta interna do app fiscal: `127.0.0.1:3001`
- listener IPM local quando usado: `127.0.0.1:9443`

## O que nao usar mais

Nao usar como referencia principal:
- caminhos antigos que apontem para instancias desativadas na DigitalOcean ou EC2
- placeholders do tipo `SEU_IP`, `SEU_DOMINIO` ou `SEU-PROJETO`
- qualquer rota ou host antigo que nao bata com `root@191.252.205.29` e `https://fiscal.mentebinaria.com`

Referencia historica obsoleta:
- `root@147.182.214.129` apareceu em scripts e notas antigas, mas nao deve mais ser usado como referencia principal

## Credenciais e variaveis atuais da VPS

Estas sao as variaveis que hoje existem na configuracao da VPS e que precisam ser mantidas coerentes ao subir o novo servico ou reaproveitar o ambiente:

```env
SUPABASE_URL=https://kfebaoocbgmcvveumlem.supabase.co
NEXT_PUBLIC_SUPABASE_URL=https://kfebaoocbgmcvveumlem.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmZWJhb29jYmdtY3Z2ZXVtbGVtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTE2NzA4OSwiZXhwIjoyMDk2NzQzMDg5fQ.bqVqu5BunnLA8kGZD9huCAIXP9QDgRieBklCAeNtfyQ

NFE_RT_CNPJ=65667543000102
NFE_RT_CONTATO=Jaime Rodrigues Jr
NFE_RT_EMAIL=jaimerodriguesjunior@outlook.com
NFE_RT_FONE=44999261487

NFE_CSRT_ID_HOMOLOGATION=1
NFE_CSRT_TOKEN_HOMOLOGATION=AYSZW8MOQD5RHOL3N1LL5A8YLGG2R5GTDFTH

NFE_CSRT_ID_PRODUCTION=2
NFE_CSRT_TOKEN_PRODUCTION=9E287L9K2XCLN21NL89QB6HUEHHNA1XAITNZ
```

Observacao:
- estes valores sao os que hoje estao no `.env.local` da base atual
- qualquer novo repositorio deve tratar isso como informacao sensivel
- se o novo servico precisar de credenciais proprias, crie variaveis novas e nao misture com o bloco fiscal sem necessidade

## Configuracao base esperada para o novo servico

O novo projeto deve nascer com suas proprias variaveis, por exemplo:

```env
PORT=300X
HOST=127.0.0.1
APP_ENV=production

SUPPORT_TELEGRAM_BOT_TOKEN=
SUPPORT_TELEGRAM_CHAT_ID=
SUPPORT_API_KEY=
SUPPORT_WEBHOOK_SECRET=
SUPPORT_STORAGE_URL=
SUPPORT_STORAGE_KEY=
```

Sugestao:
- manter o novo servico escutando localmente na VPS e publicar via Nginx
- proteger a API com uma chave propria por cliente ou por familia de sistemas
- enviar para Telegram apenas o necessario para abrir o chamado

## Payload minimo do chamado

Todo chamado deve enviar:

- `programa`
- `store_id`
- `tipo`

Valores aceitos para `tipo`:

- `problema`
- `duvida`
- `sugestao`

Campos extras uteis:

- `versao`
- `usuario`
- `origem`
- `mensagem`
- `timestamp`

## Fluxo recomendado

1. O usuario clica no botao de suporte dentro do sistema.
2. O sistema envia o payload para a API da VPS.
3. A VPS valida o token e o payload.
4. A VPS normaliza a mensagem.
5. A VPS envia a notificacao para Telegram.
6. A API responde para o sistema chamador com sucesso ou erro claro.

## Fase 2

Depois do botao de suporte funcionando, a evolucao natural e permitir acesso remoto autorizado.

Essa fase deve ser separada porque envolve:
- consentimento explicito
- auditoria
- controle de sessao
- seguranca forte

## Recomendacao pratica

Primeiro passo:
- criar a repo nova
- subir apenas a API de suporte e o envio ao Telegram
- validar com um unico botao em um sistema

Segundo passo:
- adicionar a camada de acesso remoto com autorizacao

## Notas finais

Este documento deve ser mantido como a base operacional do projeto de suporte.

Se algum caminho ou credencial mudar, atualize este MD primeiro para que a proxima implementacao nao fique perdida entre referencias antigas de DigitalOcean, EC2 ou placeholders.
