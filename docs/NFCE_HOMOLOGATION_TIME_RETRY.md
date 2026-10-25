# Retomar NFC-e de homologação após rejeição 704

No administrador, **Processar** identifica NFC-e de homologação em erro/rejeitada com código 704 e informa que renovará o horário. A API usa o opt-in `refreshHomologationIssueTime: true` em `POST /admin/api/documents/:id/process-automatic`, com autenticação administrativa e confirmação `PROCESSAR FISCAL`.

O fluxo padrão dos clientes permanece sem renovação automática. O opt-in exige modelo NFC-e, ambiente homologação, rejeição 704, ausência de protocolo/recibo pendente e identidade do payload correspondente ao registro. Mudanças de mês são bloqueadas para preservar a chave original.

A consulta prévia usa a chave existente. Se já houver autorização, ela é recuperada sem alterar o horário. O retorno 217 ou a confirmação 704 da mesma chave sem protocolo permite preparar o novo horário de São Paulo. Outros retornos bloqueiam a renovação. Um erro genérico do processador só é elegível quando a observação fiscal mais recente do histórico confirma 704 e está vinculada à mesma chave/tentativa. O XML é novamente assinado e validado, sua chave deve permanecer igual e a preparação deve ser persistida antes do envio. O evento `homologation_issue_time_refreshed` registra os dois horários, código da consulta e hashes dos payloads.

Validação: `npm run typecheck`, `npm test`, `npm run build` e `node --test dist/lib/nfce-time-retry.test.js`. Os casos de integração que usam mocks de exports CommonJS precisam do último comando: o tsx expõe getters não configuráveis e esses casos são sinalizados como ignorados na execução via tsx. Na versão compilada eles devem executar sem nenhum caso ignorado. Os testes cobrem o caminho padrão, produção/estados bloqueados, recuperação de autorização, falha de consulta, mudança de chave e falha de persistência.

Não há migração de banco ou alteração nas credenciais, no CSC, nos itens ou na numeração.
