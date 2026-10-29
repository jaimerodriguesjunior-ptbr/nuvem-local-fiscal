# Compatibilidade TLS no cancelamento — 29/10/2026

O cancelamento de NF-e/NFC-e usava o PFX diretamente no HTTPS, enquanto emissão e consulta já utilizavam `buildCertificateTlsOptions`. Na VPS, o certificado da Globo 1 reproduziu `ERR_CRYPTO_UNSUPPORTED_OPERATION: Unsupported PKCS12 PFX data`; o mesmo certificado abriu como PEM pelo helper existente.

O transporte de cancelamento agora utiliza esse helper. PFX aceitos continuam no caminho original; somente a incompatibilidade PKCS12 já reconhecida pelo helper usa PEM. Permanecem a cadeia de confiança, TLS mínimo 1.2, verificação do servidor e a barreira de transmissão. O lote, evento assinado, justificativa e identidade preparados não são regenerados.

Validação em checkout isolado baseado na versão de produção `ddf209a81929fc9a507a4407048dcfc9d0edc721`:

- TypeScript e build aprovados.
- 16 testes de certificado, transporte de cancelamento e evidência de evento aprovados, sem rede fiscal.
- Cinco casos novos: PFX e compatibilidade PEM em NF-e/NFC-e, preservação dos bytes do evento/lote embutido e ausência de pedido HTTPS quando as credenciais do certificado são inválidas.
- Certificados, senha, CA de teste e respostas HTTPS dos testes são sintéticos.

Não há migração nem alteração de estado fiscal nesta correção. Tentativas antigas pendentes não são liberadas ou reenviadas pelo patch. A NF-e 2497 exige recuperação operacional específica, conservando intenção, evento e evidências; uma consulta com código 100 não confirma cancelamento nem libera nova transmissão.
