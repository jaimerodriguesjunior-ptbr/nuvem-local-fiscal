# Publicação central com OG desligado — 26/10/2026

Base publicada do piloto: `79b6761`. A versão preparada acrescenta integração positiva OG, roteamento de callbacks por consumidor, listener OG opcional, adoção histórica apenas para consulta e proteção de chamadas gerenciadas fora do namespace habilitado. As migrações centrais novas foram instaladas manualmente pelo usuário e o verificador retornou zero bindings OG.

## Configuração de publicação

Acrescentar apenas estas configurações ao ambiente atual do serviço:

```dotenv
RECOVERY_OG_OBSERVER_ENABLED=false
RECOVERY_V1_OG_SCOPE_IDS=[]
RECOVERY_OG_FIRST_SEND_ENABLED=false
RECOVERY_OG_CANCELLATION_SEND_ENABLED=false
```

Preservar os controles, segredos, URLs, certificados e os dois IDs atuais do piloto GOP. Não substituir o arquivo inteiro de ambiente por estas quatro linhas. O serviço compartilhado precisa de pausa combinada para o reinício. Banco OG, listener, callbacks e credenciais adicionais não são exigidos com a integração OG desligada.

O build é `npm run build`; o serviço inicia `dist/server.js`. Usar a mesma versão Node e infraestrutura atuais. Nenhuma migração deve ser executada pelo deploy. Após o reinício, conferir o readiness e os escopos GOP antes de encerrar a pausa.

## Ativação futura

A inclusão de bindings e scopes, configuração dos segredos/listener e inscrição da 2494 são uma etapa distinta. O código não ativa lojas automaticamente. Quando ligados os fluxos gerenciados do OG mas mantido o primeiro envio falso, a emissão OG é bloqueada; esse modo é reservado à janela de validação, não ao uso diário.

## Evidência

O pacote de schema central passou sobre o backup real em Docker; ver `docs/validation/CENTRAL_OG_MANUAL_INSTALL_REHEARSAL_20261026.json`. A evidência de execução remota é fornecida pelo usuário em `docs/validation/CENTRAL_OG_REMOTE_DISABLED_INSTALL_USER_REPORTED_20261026.json`. A suíte central passou com 228 testes: 219 aprovados e nove skips existentes. O banco vivo não foi consultado para repetir esses resultados nesta preparação.

Reversão da publicação desligada: restaurar a versão de código anterior e os controles OG falsos, preservando o schema adicional inativo. Depois de qualquer vínculo gerenciado, não remover barreiras nem reativar o escritor legado para o documento.
