# NFC-e Center: primeiro envio e numeracao

## Correcao preparada em 07/11/2026

Base conferida no servico em execucao: `5bcad9d87eeed183b0c84c4ee4312654864877c3`.
A correcao esta na branch local `fix/nfce-center-first-send-20261107`.
Nao houve push, deploy ou reinicio do servico. O usuario fara a publicacao.

`InMemoryStore.createDocument` preenchia `xml` com `<mock ... />` em toda
criacao. O primeiro envio legado de NFC-e de producao chama
`refreshNfceIssueTime`, que recusa documento com XML existente. Isso bloqueava
uma nota nova antes mesmo da geracao da chave, assinatura ou transmissao.

`src/store.ts` agora inicia `xml` vazio exclusivamente para novas NFC-e de
producao nao autorizadas. O guard de horario continua intacto, assim como
os snapshots antigos, homologacao, NF-e e NFS-e. Nao ha migration.

`src/lib/nfce-first-send.test.ts` exercita o store real, recarga do documento e
processamento com dependencias fiscais externas simuladas. Cobre preparacao
de horario, assinatura persistida antes da consulta/transmissao simuladas,
autorizacao, repeticao sem reenvio, falha de XSD, falha de persistencia e
preservacao do bloqueio dos documentos antigos com placeholder.

## Conferencia das tentativas

Loja 5, Otica Center, venda 14212, serie 2, producao, valor R$ 1.550,00.

| Registro MB Optical | Documento central | Numero |
| --- | --- | --- |
| 589 | doc_16ba3960 | 152 |
| 590 | doc_4e65011c | 153 |
| 591 | doc_32ceb564 | 154 |
| 592 | doc_89185c7f | 155 |

Foram conferidos o banco do aplicativo, o banco central e o historico em
memoria do servico em execucao. Nos quatro documentos:

- existe somente o XML placeholder original, sem XML gerado ou assinado;
- nao existe chave, protocolo, lote, recibo ou resposta SEFAZ;
- o unico evento e `authorization_attempt_failed`, com tentativa zero,
  `NFCE_TIME_REFRESH_UNPROVEN`, `uncertainExternalState=false` e
  `retryable=false`, sem proxima tentativa agendada;
- nao existe evento de inicio de consulta ou transmissao.

O codigo publicado falha antes dessas etapas. Isso comprova nao transmissao
dessas quatro tentativas pelo servico. Nao houve consulta direta a SEFAZ:
nenhuma chave havia sido gerada para consultar. Nao foi fabricada uma chave.
A nota 151 esta autorizada, com protocolo; nao havia documento posterior a
155 nem inutilizacao abrangendo 152 a 155 no servico central.

## Ajuste realizado no contador

Em 07/11/2026 as 13:02:34 de Brasilia, a linha 168 de `nfce_sequences`
(loja 5, serie 2, producao) passou de `last_number=155` para `151`.
O proximo numero e **152**. Nenhuma outra loja, serie ou ambiente foi ajustado.

Primeiro foi executado um ensaio com rollback, inclusive chamando
`get_next_nfce_number` dentro da transacao desfeita e confirmando retorno 152.
Na aplicacao, uma transacao serializavel bloqueou a linha do contador e as
quatro notas, validou os IDs/estados esperados e repetiu a conferencia central
antes do update. Alteracao concorrente do contador ou dos documentos abortaria
o procedimento. A aplicacao efetiva nao reservou um novo numero.

Os quatro registros de erro e seus documentos centrais foram preservados.
Nao foram apagados, cancelados, inutilizados, renumerados ou retransmitidos.
A conferencia posterior confirmou o contador 151 e os registros do aplicativo
identicos aos snapshots anteriores. Evidencias operacionais completas ficam
na pasta local `tmp/nfce-center-20261107` do repositorio MB Optical.

**Publicar o servico corrigido antes de nova tentativa.** Iniciar a emissao
normalmente pelo MB Optical. Os quatro registros antigos ficam como historico
da falha; nao assina-los ou transmiti-los manualmente, pois seus numeros foram
devolvidos a sequencia. O erro do servidor atual continua ate a publicacao.

## Validacao

- `npm run typecheck`: aprovado.
- `npm run build`: aprovado.
- `npm test`: 270 aprovados, 13 pulados pelo mock de exports CommonJS no tsx.
- `node --test dist/lib/*.test.js dist/lib/recovery/*.test.js dist/*.test.js`:
  283 aprovados, zero falhas, zero pulados.
- Os 22 testes de primeiro envio/horario tambem passaram isoladamente na
  versao compilada.

Testes usam documentos e transportes sinteticos. Nao houve emissao fiscal
real, assinatura com certificado de cliente ou chamada de autorizacao a SEFAZ.
A publicacao e a primeira emissao operacional apos a correcao ficam pendentes.
