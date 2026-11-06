# Cadastro transacional por certificado — preparação local de 06/11/2026

O cadastro novo usa `POST /empresas/cadastro-certificado`, com Bearer e escopos
`empresa empresa-cadastro`. A integração deve receber explicitamente essa
permissão. Nenhuma integração existente é habilitada automaticamente.

## Contrato e isolamento

O corpo contém `request_id` UUID estável, `externalCompanyId`, `empresa`,
`ambientes`, `fileName`, `pfxBase64` e `password`. `empresa` contém CNPJ, razão
social, nome fantasia, IE, regime tributário, código IBGE, UF e endereço completo.
O PFX tem limite de 2 MB; o ERP Ótica Gestão mantém o limite de 700 KB compatível
com a rota legada de substituição do certificado. Não registrar o corpo HTTP.

- CNPJ precisa passar na verificação de dígitos; endereço/regime são obrigatórios.
- A chave privada deve corresponder exatamente ao certificado selecionado.
  A ordem dos certificados dentro do PFX não determina o titular.
- Validade, assinaturas e cadeia até autoridades configuradas são verificadas.
  Certificado autoassinado enviado pelo consumidor não vira autoridade confiável.
- CNPJ é extraído do OID ICP-Brasil no subject/SAN ou do sufixo explícito do CN;
  identificadores conflitantes ou malformados são recusados.
- `COMPANY_ENROLLMENT_TRUST_FILE` aponta para um PEM de autoridades confiáveis,
  instalado pelo operador a partir de fonte oficial verificada. Sem essa
  configuração o cadastro novo retorna 503, preservando os fluxos legados.
  Nunca instalar a CA sintética dos testes no servidor.
- `COMPANY_ENROLLMENT_INTERMEDIATES_FILE` fornece candidatos públicos para
  completar PFX exportados apenas com o certificado do titular. Esses candidatos
  não viram âncoras de confiança: a cadeia ainda precisa chegar a uma raiz
  explicitamente configurada. O pacote oficial do ITI deve ter SHA-512 conferido.
- A implementação atual usa o suporte RSA do parser existente e não consulta
  revogação online (OCSP/CRL). Não equivale a uma validação jurídica completa da
  ICP-Brasil. Não faz download de certificados/URLs fornecidos pelo solicitante.
- Cadastro novo não altera empresa preexistente, mesmo quando o CNPJ já está
  na lista da integração. Atualização usa as rotas existentes; vinculação de
  CNPJ pertencente a outra integração continua administrativa.

## Persistência, concorrência e recuperação

Aplicar primeiro a migração preparada
`supabase/migrations/20261106_001_atomic_company_enrollment.sql` no banco da
**Nuvem Local Fiscal**, nunca no banco do ERP. Ela permite o novo escopo,
cria o registro durável de solicitações e a RPC exclusiva de `service_role`.
Não existe fallback de cadastro por gravações parciais em memória/arquivo.

A RPC verifica novamente versão/permissões atuais da integração e grava
empresa, ambientes, certificado cifrado, autorização de CNPJ e recibo numa
única transação. Bloqueios de linha e por CNPJ coordenam sessões concorrentes.
Falha em qualquer etapa desfaz a operação. A memória recebe apenas resultados
confirmados. Não há reenvio automático de emissão nem comunicação com SEFAZ.

Repetir `(client_id, request_id)` com o mesmo fingerprint retorna o mesmo
recibo, sem substituir certificado. Conteúdo diferente retorna 409.
`GET /empresas/cadastro-certificado/:requestId` permite verificar uma resposta
perdida, sem reenviar PFX. A consulta exige a permissão atual e é restrita à
integração; não expõe senha, bundle, hash de credencial ou chave privada.
Incerteza de transporte resulta em 503 e deve ser consultada pelo mesmo UUID.

Acrescentar um CNPJ via RPC preserva a versão do cliente. Tokens existentes
continuam limitados às listas assinadas anteriormente e seguem atendendo as
outras lojas. Obter novo token dá acesso ao novo CNPJ. Alterações administrativas
de permissão/segredo e remoções continuam invalidando tokens. OAuth recarrega a
integração do banco e hidrata novos cadastros provenientes de outra instância.
Isso não transforma a persistência legada de todas as demais operações em uma
arquitetura plenamente transacional para múltiplas instâncias.

## Publicação proposta, ainda não executada

1. Revisar a migração específica e confirmar backup recente do banco fiscal.
   Inventariar tabela/constraints/triggers atuais; não executar `db push` geral.
2. Preparar o PEM confiável e definir `COMPANY_ENROLLMENT_TRUST_FILE` no serviço.
   Conferir certificados reais de homologação sem salvar chaves/senhas em logs.
3. Aplicar a migração revisada, publicar o serviço e verificar o novo endpoint.
4. Habilitar somente a integração aprovada para `empresa-cadastro`. Credenciais
   compartilhadas concedem essa permissão a todos os consumidores que as possuem;
   confirmar o alcance antes da ativação. Preservar demais escopos/CNPJs/ambientes.
5. Publicar o ERP adaptado. Ele consulta existência, renova token desatualizado,
   cadastra com A1 quando necessário, renova os caches e continua com CSC.
   O cadastro automático nos dois ambientes exige as mesmas credenciais/base.
6. Verificar cadastro de homologação e uma retomada após falha simulada de rede.
   Não emitir documento fiscal como efeito do teste de cadastro.

O novo fluxo foi testado com material sintético e PostgreSQL descartável local.
Não houve aplicação remota, alteração de histórico, ativação de permissão ou
publicação nesta rodada. Não reaplicar migrações históricas para instalar esta.
