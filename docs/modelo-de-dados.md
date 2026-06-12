# Modelo de dados do v0

## Em memoria

### `apiClients`

- `id`
- `name`
- `clientId`
- `clientSecret`
- `allowedScopes`
- `allowedEnvironments`

### `issuers`

- `id`
- `cnpj`
- `razaoSocial`
- `nomeFantasia`
- `ambiente`
- `uf`
- `ie`
- `crt`
- `serieNfe`
- `serieNfce`

### `certificates`

- `id`
- `issuerId`
- `cnpj`
- `fileName`
- `uploadedAt`
- `validUntil`
- `active`

### `documents`

- `id`
- `providerLikeId`
- `tipoDocumento`
- `issuerCnpj`
- `ambiente`
- `status`
- `numero`
- `serie`
- `chave`
- `protocolo`
- `payloadOriginal`
- `payloadNormalizado`
- `xml`
- `pdfUrl`
- `createdAt`
- `updatedAt`
- `mensagens`
