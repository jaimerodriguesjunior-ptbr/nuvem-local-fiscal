# Cadastro de empresas mediante certificado

`POST /empresas/cadastro-certificado` recebe cadastro e certificado A1 de
um consumidor autorizado da Nuvem Local Fiscal. Não emite documentos fiscais.

## Permissões e isolamento

- Exige Bearer com os escopos `empresa` e `empresa-cadastro`.
- `empresa-cadastro` é uma autorização explícita no painel Integrações;
  não é acrescentada automaticamente às integrações já existentes.
- Aceita somente os ambientes permitidos para o token.
- Um CNPJ já existente e não permitido para a integração retorna 409.
  A associação de uma empresa preexistente continua sendo administrativa.
- Para um CNPJ novo, valida abertura do PFX, validade temporal e titularidade
  pelo OID ICP-Brasil no subject/SAN ou pelo sufixo explícito nome:CNPJ no CN.
  Essa conferência de titularidade não representa validação da cadeia ICP-Brasil.
- Depois da validação, registra empresa/certificado e vincula somente esse
  CNPJ à integração solicitante. Não concede acesso irrestrito a empresas.
- A atualização da integração revoga tokens anteriores; obter novo token
  antes de configurar NFS-e ou consultar a empresa recém-criada.

## Corpo JSON

Enviar `empresa` com os campos cadastrais usados pelo NF Toledo (`cnpj`,
`razao_social`, `codigo_municipio_ibge`, endereço, contato e regime),
`externalCompanyId` com o identificador da organização do consumidor,
`ambientes`, `fileName`, `pfxBase64` e `password`.

O PFX pode ter até 2 MB. A resposta não devolve certificado nem senha.
O bundle é armazenado pelo mecanismo AES-GCM já utilizado no serviço.
Metadados registram integração de origem, organização externa, integração
do último envio de certificado e horário.

Esta rota não substitui a configuração NFS-e. Após o cadastro, o consumidor
configura/confirma `nfse-nacional` e registra seu próprio resultado local.
Erros de persistência são informados sem declarar sucesso.
