# Encerramento administrativo de conflito de numeração OG

Uma resolução administrativa no Ótica Gestão pode encerrar a tentativa de uma NF-e
com retorno 539 e criar outra nota, sem transformar o retorno em rejeição fiscal
definitiva. A central precisa registrar essa disposição separadamente do estado
fiscal para finalizar o acompanhamento antigo.

## Fluxo

O utilitário `scripts/operations/close-og-number-conflict.mjs` opera em preview por
padrão. Lê o ledger de resolução, a nota antiga, sua tentativa encerrada e a
sucessora no ERP. Depois lê os dois pedidos correspondentes na central e valida
tenant, loja, cliente, chave, série, número, valor, estados e identidades.

O `successor_request_id` do ledger é a chave do **rascunho** `nfe_request_key`.
O pedido gerenciado da central é obtido de `recovery_request_id` da nota sucessora.
Não presumir que esses dois identificadores são iguais. O vínculo é conferido
nos dois passos antes da geração da evidência.

Somente `--apply` chama a RPC privada de serviço. A função exige versão canônica
atual, original pendente 539 sem protocolo, ausência de leases mesmo expirados,
namespace OG, sucessora NF-e de entrada/devolução autorizada e totais idênticos.
Pedidos distintos são bloqueados em ordem estável. Uma corrida com o worker aborta
por versão/lease; não força liberação de tokens ou alteração do resultado fiscal.

O encerramento cria um ledger com evidência e cópia do estado fiscal original.
Na solicitação antiga, apenas limpa `next_at` e incrementa a revisão para notificar
o consumidor pelo outbox existente. Preserva documento, XML, chave, número,
protocolo, código 539, fase fiscal e data da última atualização fiscal. A sucessora
e as demais solicitações ficam intactas. Repetir a mesma operação é idempotente;
uma evidência diferente para o mesmo pedido é recusada.

O trigger de proteção impede que um caller antigo reagende ou sobrescreva o pedido
encerrado. A consulta manual autorizada retorna `ADMINISTRATIVELY_CLOSED`, sem nova
consulta à SEFAZ. A API conserva os estados fiscais conhecidos pelo ERP e acrescenta
somente `recovery.administrativeClosure`. O wrapper do ERP continua protegendo a
resolução contra eventos atrasados e põe autorização inesperada em conferência.

## Interface

Documentos mostra “Encerrada administrativamente”, com a nota sucessora nos
detalhes. Logs acrescenta um evento administrativo `info`, mais recente que o
aviso fiscal preservado no histórico. Há filtro próprio para encerradas; elas
deixam de constar no filtro de processamento ativo. A assinatura/API continua
indicando a situação fiscal preservada, sem fabricar cancelamento ou autorização.

## Validação

- Build TypeScript e suíte fiscal do projeto.
- Suítes compiladas de primeiro envio/retry, que cobrem os casos condicionados a CJS.
- Testes de evidência com divergência de tenant, identidades, chave, valor, tentativa
  não encerrada, autorização ausente e revisão pendente.
- PostgreSQL nativo descartável: instalação sem backfill; privilégios; evidências;
  versão; leases ativos/expirados; concorrência; bytes fiscais preservados;
  idempotência; proteção contra reagendamento/reescrita; consulta manual encerrada;
  continuidade do worker para outros pedidos; metadados no snapshot administrativo.

A instalação do SQL não encerra nenhuma nota automaticamente. A aplicação é
explícita, por registro, após conferir a evidência real no ERP. Uma eventual nova
evidência fiscal precisa de conferência assistida; não remover o ledger nem
restaurar uma solicitação encerrada ao polling por uma simples mudança de interface.
