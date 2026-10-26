# Sincronização inicial do Ótica Gestão — preparação local

**Histórico da primeira etapa.** A preparação posterior inclui escopos positivos OG, roteamento de notificações e associação de histórico pendente ao worker existente. O estado atual e o roteiro específico constam em `docs/INTEGRACAO_RECUPERACAO_COMPLETA_OG_20261026.md` no worktree OG. Este texto descreve apenas o ponto de partida.

Branch `codex/preparacao-consulta-og`, base `79b6761`. Não publicada. Nenhuma mudança remota ou emissão foi feita nesta etapa.

O pump opcional `og-observation-pump.ts` usa o mecanismo já existente de demanda/LISTEN e um corpo assinado próprio (`schema: og-observation-v1`, propósito drain e client do OG), enviado ao endpoint fixo HTTPS `/api/fiscal/recovery-v1/drain` do OG. Não transporta resultado fiscal, XML, token ou escolha de loja. O endpoint seleciona a tentativa de modo autorizado no banco do OG.

Configuração separada: `RECOVERY_OG_OBSERVER_ENABLED` inicialmente ausente/falsa, `RECOVERY_OG_SUPABASE_URL`, `RECOVERY_OG_DATABASE_URL`, `RECOVERY_OG_DRAIN_URL`, `RECOVERY_OG_SYNC_SECRET` e `RECOVERY_OG_CLIENT_ID`. Banco com role limitada e sessão persistente, endpoint fixado no projeto e TLS verificado. Não reaproveitar credenciais/segredo do GOP. Sem configuração positiva, nenhum listener/HTTP do OG é criado.

Sem pendências o drain devolve `nextWakeAt: null`. A fonte apenas mantém LISTEN; não executa varredura a cada cinco minutos. Notificação, inicialização e reconexão podem acordar trabalho durável. Falhas do endpoint têm backoff. Se configurado e indisponível, o componente aparece no readiness; não há fallback para emitir pelo legado.

Esta preparação não altera o allowlist do controlador GOP, não cadastra escopos do OG e não autoriza transmissores do OG. O objetivo inicial é sincronizar resultados que a central já tem: a NF-e histórica 2494 permanece sem alteração para o teste futuro de `processing` no OG versus rejeição SEFAZ 974 armazenada na central.

Limite obrigatório: GET legado de NF-e/NFC-e lê apenas estado salvo. A etapa preparada não consulta novamente a SEFAZ para uma nota ainda sem resultado na central. Ela não substitui a ampliação revisada do controlador `recovery-v1`, a adoção de histórico pendente, a correlação durável anterior ao POST e o orçamento de consultas. Não ativar ou apresentar como recuperação fiscal completa enquanto essas condições estiverem pendentes.

A especificação do lado OG, migração inicialmente desligada, testes e roteiro de aceitação estão em `docs/PREPARACAO_RECUPERACAO_OG_20261026.md` na preparação isolada do repositório `otica-gestao`. Continuam vigentes os holds de backup/plano/aplicação do AGENTS daquele repositório. Não foi pedido novo relatório de auditoria.
