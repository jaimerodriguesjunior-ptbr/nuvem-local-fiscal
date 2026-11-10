# Documentos e Logs: notas tradicionais e gerenciadas

Preparação local concluída em 09/11/2026. Aplicação do SQL e publicação em produção
aguardam confirmação de backup recente do banco **da central Nuvem Local Fiscal**
e autorização do usuário, conforme combinado na conversa.

## Resultado preparado

As notas gerenciadas entram automaticamente em Documentos, Logs, movimento recente
e contagens por empresa. Empresa, ambiente, modelo, status e período usam os mesmos
filtros das notas tradicionais. A NFC-e 1919 da Globo 5 aparece ao selecionar a
empresa e Produção, sem informar seu ID.

O leitor administrativo é independente do runtime de transmissão. Pausar um
escopo não esconde seu histórico. O endpoint autentica antes de ler. A nova RPC
consulta dados e não agenda operações fiscais. Segredos de CSC e tokens de lease
ficam fora do resultado. As ações de transmissão do painel permanecem bloqueadas
para documentos gerenciados.

Um documento tradicional associado explicitamente ao controlador aparece uma vez,
com seus eventos antigos preservados sob a identidade gerenciada. Notas distintas
com o mesmo número não são eliminadas por aproximação.

Logs exibem os eventos tradicionais e os marcos efetivamente persistidos das
gerenciadas: registro, início de envio, correções documentadas de horário,
cancelamento e situação atual. Não existe histórico durável completo de todas as
transições antigas; essa limitação aparece na tela. A data da situação atual não
é apresentada como data da autorização. Uma nota sem eventos detalhados também
continua visível ao lado das demais.

Foi corrigida a carga tradicional sem paginação, que recebia no máximo 1.000 linhas
por consulta. A nova carga percorre documentos e eventos por ID, com data de corte
fixa e ordenação final por data. Uma falha interrompe a carga em vez de aceitar um
histórico parcial. A consulta das gerenciadas também percorre páginas; falha ou
limite excedido produz aviso explícito de lista/contagens incompletas.

## Evidência

- Base: cópia isolada e limpa de `40c759dfa401938e57decbc49459d67dd0081da8`,
  release registrada como publicada. O checkout original foi preservado.
- `npm run build`: aprovado, incluindo verificação TypeScript.
- `npm test`: 298 casos, 285 aprovados e zero falhas. Os 13 ignorados exigem execução
  compilada; `node --test dist/lib/nfce-first-send.test.js dist/lib/nfce-time-retry.test.js`
  aprovou seus 18 casos, incluindo aqueles 13.
- PostgreSQL nativo, descartável e restrito a loopback: oito verificações aprovadas,
  103 registros sintéticos em páginas. A RPC funcionou em transação READ ONLY;
  ACLs, registros fiscais, fila e funções preexistentes foram conferidos.
  [Resultado SQL](validation/admin-managed-documents-sql-20261109.json).
- Leitura real: 1.504 documentos tradicionais e 5.869 eventos carregados integralmente,
  sem IDs repetidos, em aproximadamente oito segundos na máquina local. Isso não
  substitui medição de consumo/tempo no servidor após a publicação.
- Conferência ERP/central: 30 documentos gerenciados e oito tradicionais vinculados
  às notas de saída em produção do OG, sem duplicação de IDs. Novembro: 19 notas da
  Globo 1 e uma da Globo 5. Os filtros reais do cliente foram usados nessa conferência.
  A nova RPC de listagem ainda não existe em produção; essa parte usou a RPC de
  consulta individual já instalada. [Conferência](validation/admin-managed-documents-reconciliation-20261109.json).
- NF-e 2499 / registro ERP 39: divergência preexistente encontrada entre ERP
  `rejected` e central `pending` / `processamento`, código 539. Nenhum estado foi
  corrigido por este trabalho; o painel mostra o estado da central.
- [Prévia HTML](validation/admin-managed-documents-preview.html): dados de exemplo,
  sem chamadas à produção. Filtros, renderização e inspeção foram testados no script
  real do cliente em VM; não foi realizada inspeção visual em navegador nesta etapa.

## Aplicação proposta, após autorização

1. Confirmar backup recente da central e revalidar a versão ativa para não sobrescrever
   outra publicação. O pacote parte de `40c759d`.
2. Aplicar somente [a nova função de leitura](../migrations/manual/20261109_admin_managed_documents_READ_ONLY.sql).
   O SQL cria uma função e seu grant de execução para `service_role`, com autenticação
   administrativa na API. Não atualiza tabelas fiscais nem altera o histórico de migrations.
   Possui timeout e consulta de verificação antes do commit; resultado esperado:
   `ADMIN_MANAGED_READ_INSTALLED`. Não reaplicar se a função já estiver instalada.
3. Publicar o código preparado e validar build, inicialização e `/ready`, preservando
   as variáveis e configurações fiscais atuais.
4. Validar o snapshot autenticado e o painel: Globo 5/Produção deve conter a 1919;
   Globo 1/Novembro deve conter 19 notas no inventário conferido. Recontar se novas
   notas tiverem sido emitidas. Conferir Logs, filtros, contagens e ausência de duplicação.
   Não emitir nem consultar a SEFAZ para testar a listagem.

Reversão proposta: restaurar o código anterior se a publicação apresentar problema.
A função adicional é somente leitura e pode permanecer instalada; não restaurar
banco antigo sobre dados fiscais novos para reverter uma mudança de interface.

## Limites operacionais

A interface ainda carrega o histórico em um snapshot, mantendo o desenho existente.
A paginação evita perda silenciosa, mas históricos muito maiores exigirão uma
evolução para filtros/paginação no servidor. O leitor gerenciado recusa mais de
10.000 registros por atualização com aviso de incompletude, sem ocultar o problema.
O snapshot em memória dos documentos tradicionais é atualizado na inicialização
e pelas operações deste processo, conforme o comportamento existente.

Nenhuma instalação remota, publicação, emissão, cancelamento, reenvio ou alteração
de status foi executada durante esta preparação.
