# Prompt para novo contexto: NFS-e homologacao

Estamos no repo `g:\projetos\nuvem-local-fiscal`.

Antes de comecar, leia o arquivo `NUVEMLOCALFISCAL.md`, porque ele e o documento de apoio principal e foi atualizado com o estado real do projeto em 13/06/2026.

Resumo do estado atual:

1. A NFC-e em homologacao ja funciona ponta a ponta.
2. A NF-e em homologacao ja funciona ponta a ponta.
3. A Nuvem Local Fiscal ja esta publicada em VPS:
   - `https://fiscal.mentebinaria.com`
   - DigitalOcean + Ubuntu 24.04
   - Node.js via `systemd`
   - Nginx + HTTPS Let's Encrypt
   - Supabase como persistencia
   - admin protegido
4. A producao fiscal continua bloqueada por seguranca.
5. A Otica Prisma ja emitiu NFC-e e NF-e homologacao usando a Nuvem Local.
6. A Autoeletrica/NHT Centro Automotivo ja emitiu NFC-e homologacao usando a Nuvem Local na VPS.
7. Certificados A1 e CSC estao persistindo no Supabase.
8. Foram corrigidos bugs de persistencia em:
   - `fiscal_service_configs`
   - `fiscal_certificates`
9. O endpoint de configuracao NFS-e ja existe apenas como compatibilidade de cadastro:
   - `PUT /empresas/:cnpj/nfse`
   - `POST /empresas/:cnpj/nfse`
   - `GET /empresas/:cnpj/nfse`
10. Esses endpoints NFS-e ainda nao emitem nota; apenas armazenam login/senha de prefeitura de forma criptografada.

Contexto operacional validado:

- NFC-e Autoeletrica homologacao autorizada:
  - emitente: `35181069000143`
  - modelo: `65`
  - serie: `2`
  - numero: `7`
  - chave: `41260635181069000143650020000000071162019552`
  - protocolo: `141260001358339`
  - status: `100 - Autorizado o uso da NF-e`
- NF-e/NFC-e usam A1, validacao XSD, transmissao real SEFAZ-PR homologacao, XML autorizado e DANFE/PDF.
- NF-e nao usa CSC.
- NFC-e usa CSC salvo por empresa/ambiente/servico.
- NFS-e sera prefeitura por prefeitura.

Objetivo deste novo contexto:

Comecar a frente de NFS-e homologacao de forma controlada, sem quebrar NF-e/NFC-e e sem mexer nos programas clientes sem necessidade.

Prioridade inicial:

1. NFS-e homologacao em Guaira/PR.
2. NFS-e homologacao em Toledo/PR.

Primeiro, por favor:

1. Verifique `git status --short`.
2. Leia `NUVEMLOCALFISCAL.md`.
3. Inspecione o que ja existe sobre NFS-e:
   - rotas em `src/routes/documents.ts`
   - persistencia em `src/lib/supabase-persistence.ts`
   - tipos em `src/types.ts`
   - testes em `src/app.integration.test.ts`
   - qualquer referencia a NFS-e no admin
4. Diga o que ja esta pronto e o que falta para uma NFS-e real.
5. Antes de implementar, proponha o menor caminho para identificar provedor/layout de Guaira e Toledo.

Direcao tecnica desejada:

1. Descobrir qual provedor de NFS-e cada prefeitura usa.
2. Confirmar se existe ambiente de homologacao.
3. Confirmar autenticacao exigida:
   - login/senha prefeitura
   - certificado A1
   - token
   - outro metodo
4. Mapear o contrato minimo para emissao:
   - payload recebido dos sistemas clientes
   - normalizacao interna
   - XML/API do provedor
   - transmissao
   - retorno autorizado/rejeitado
   - consulta
   - cancelamento se for necessario
5. Implementar primeiro o caminho feliz de uma prefeitura.
6. Corrigir rejeicoes uma a uma, como foi feito com NFC-e/NF-e.

Cuidados importantes:

1. Nao mexer no payload dos sistemas clientes sem necessidade.
2. A Nuvem Local Fiscal deve aceitar payloads parecidos com os que os sistemas ja enviam para a Nuvem Fiscal.
3. Se houver erro real em programa cliente, informar antes de alterar.
4. Nao deixar regra de SEFAZ/NF-e/NFC-e vazar indevidamente para NFS-e.
5. Producao continua bloqueada.
6. Nao commitar `.env.local`, PFX, certificados, XMLs soltos, `storage`, `dist`, `node_modules`.
7. Se fizer alteracoes importantes e os testes passarem, sugerir commit antes de teste real grande.

Comandos uteis:

- `npm run dev`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `git status --short`
- `git diff --stat`

Contexto de clientes:

- A Otica Prisma foi o primeiro cliente real validado.
- A Autoeletrica/NHT Centro Automotivo tambem ja foi validada para NFC-e homologacao pela VPS.
- A ideia segue sendo trocar principalmente variaveis de ambiente nos clientes, nao reescrever chamadas.

Por favor, comece verificando o estado atual do repo e siga a partir dai.
