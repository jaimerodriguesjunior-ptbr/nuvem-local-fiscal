# Aplicação manual da recuperação OG — lado central

O plano específico completo está em [APLICACAO_MANUAL_RECUPERACAO_OG_20261026.md](../../preparacao-og/docs/APLICACAO_MANUAL_RECUPERACAO_OG_20261026.md) no worktree OG.

O arquivo `migrations/manual/INSTALL_RECOVERY_DISABLED_CENTRAL_OG_20261026.sql` incorpora apenas as duas migrações novas da integração OG em uma transação, com preflight e conferência de preservação das linhas existentes. Nenhum binding ou escopo é cadastrado. `migrations/manual/VERIFY_RECOVERY_DISABLED_CENTRAL_OG_20261026.sql` é somente leitura.

Antes de instalar no banco central compartilhado, confirmar um backup novo que inclua `public` **e `fiscal_recovery`**, a restauração correspondente e a janela sem operações fiscais. O exportador antigo do piloto contemplava somente `public` no central e precisa ser ampliado antes de ser reutilizado para esta etapa.

O ensaio com baseline sintético usa o próprio arquivo manual em `scripts/recovery-pilot/test-og-managed.mjs`. Não houve execução no banco central real, configuração de namespace OG, publicação ou alteração dos escopos GOP.

Em 26/10, o backup atualizado `backup_2026-10-26 (1).sql.gz`, modificado às 18:26 -03:00, foi restaurado integralmente em Docker isolado. Inclui `public` e `fiscal_recovery`. O instalador central manual passou sobre essa cópia real, com fingerprints de registros preservados, zero bindings OG, duas RPCs apenas para serviço, RLS ligado e segunda instalação recusada. Evidência: `docs/validation/CENTRAL_OG_MANUAL_INSTALL_REHEARSAL_20261026.json`. A condição de backup/restauração central foi atendida para este arquivo e instalador. Resta combinar a pausa de todos os consumidores antes de executar o SQL no banco compartilhado.

O usuário informou execução bem-sucedida do instalador OG e forneceu o resultado do verificador: controles falsos, nenhuma nota assumida, fila vazia, dois triggers habilitados e nenhuma execução pública das novas RPCs. Trata-se de evidência fornecida pelo usuário, sem nova conexão ao banco nesta etapa.
