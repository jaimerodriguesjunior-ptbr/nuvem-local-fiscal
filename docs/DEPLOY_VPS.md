# Deploy em VPS

Este roteiro publica a Nuvem Local Fiscal com Node.js, `systemd`, Nginx,
HTTPS e Supabase. O deploy do servidor nao libera operacoes fiscais em
producao: o bloqueio permanece no codigo.

Deploy validado em 2026-06-13:

- dominio: `https://fiscal.mentebinaria.com`
- VPS: DigitalOcean / Ubuntu 24.04
- persistencia: Supabase
- clientes homologacao ja validados pela VPS: Otica Prisma e Autoeletrica/NHT
- producao fiscal: bloqueada

## Requisitos

- Ubuntu ou Debian atualizado
- Node.js LTS compativel com o projeto
- Nginx
- PostgreSQL client (`pg_dump`)
- dominio apontando para a VPS
- certificado TLS, por exemplo via Certbot
- migracoes aplicadas no Supabase

## Instalacao

```bash
sudo useradd --system --home /opt/nuvem-local-fiscal \
  --shell /usr/sbin/nologin nuvemfiscal
sudo mkdir -p /opt/nuvem-local-fiscal/storage
sudo chown -R nuvemfiscal:nuvemfiscal /opt/nuvem-local-fiscal
```

Clone ou copie o repositorio para `/opt/nuvem-local-fiscal` e execute:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Crie `/etc/nuvem-local-fiscal.env` a partir de
`deploy/production.env.example`, com permissao `0600`. Nunca envie esse
arquivo ao Git.

```bash
sudo chown root:root /etc/nuvem-local-fiscal.env
sudo chmod 600 /etc/nuvem-local-fiscal.env
```

Quando `APP_ENV=production`, o processo recusa iniciar com credenciais
padrao, sem Supabase ou sem chaves de criptografia explicitas.

## Processo persistente

```bash
sudo cp deploy/nuvem-local-fiscal.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nuvem-local-fiscal
sudo systemctl status nuvem-local-fiscal
curl http://127.0.0.1:3001/ready
```

Logs:

```bash
journalctl -u nuvem-local-fiscal -f
```

## HTTPS

Copie `deploy/nginx.conf.example`, substitua o dominio e os caminhos do
certificado. Antes de ativar, crie a autenticacao HTTP do Nginx para proteger
a pagina administrativa:

```bash
sudo apt install apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd-nuvem-local-fiscal operador
sudo chown root:www-data /etc/nginx/.htpasswd-nuvem-local-fiscal
sudo chmod 640 /etc/nginx/.htpasswd-nuvem-local-fiscal
```

O Nginx deve proteger `/admin`, mas nao deve sobrescrever a autenticacao das
APIs internas em `/admin/api/`. Essas APIs ja validam `ADMIN_USERNAME` e
`ADMIN_PASSWORD` dentro da propria aplicacao, e a pagina admin envia esse
cabecalho automaticamente. Mantenha o bloco de `/admin/api/` antes do bloco de
`/admin`:

```nginx
location ^~ /admin/api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
}

location ^~ /admin {
    auth_basic "Administracao fiscal";
    auth_basic_user_file /etc/nginx/.htpasswd-nuvem-local-fiscal;
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
}
```

Depois valide e recarregue:

```bash
sudo nginx -t
sudo systemctl reload nginx
curl https://fiscal.seu-dominio.com.br/ready
```

Somente as portas `80` e `443` devem ficar publicas. A porta `3001` deve
permanecer acessivel apenas pela propria VPS; por isso o exemplo de producao
usa `HOST=127.0.0.1`. O caminho `/admin` exige a autenticacao adicional do
Nginx porque a pagina administrativa opera com credenciais privilegiadas.

## Cadeia ICP-Brasil

As chamadas reais para SEFAZ usam a cadeia ICP-Brasil junto do certificado A1.
Garanta que o arquivo versionado localmente tambem exista na VPS:

```bash
sudo mkdir -p /opt/nuvem-local-fiscal/certificates
sudo chown -R nuvemfiscal:nuvemfiscal /opt/nuvem-local-fiscal/certificates
```

No computador local:

```powershell
scp G:\projetos\nuvem-local-fiscal\certificates\icp-brasil-root-v10.pem root@SEU_IP:/opt/nuvem-local-fiscal/certificates/icp-brasil-root-v10.pem
```

Na VPS:

```bash
sudo chown nuvemfiscal:nuvemfiscal /opt/nuvem-local-fiscal/certificates/icp-brasil-root-v10.pem
sudo chmod 644 /opt/nuvem-local-fiscal/certificates/icp-brasil-root-v10.pem
sudo systemctl restart nuvem-local-fiscal
curl http://127.0.0.1:3001/ready
```

Sem esse arquivo, a emissao pode gerar, assinar e validar o XML, mas falhar na
transmissao com erro de arquivo ausente.

## Certificados A1

`CERTIFICATE_ENCRYPTION_KEY` precisa ser estavel no servidor que vai abrir o
certificado. Se o A1 foi cadastrado em outro ambiente com outra chave, a VPS
nao conseguira descriptografar o bundle e pode registrar erro como:

```text
Unsupported state or unable to authenticate data
```

Para uma VPS nova, prefira manter uma chave forte em
`CERTIFICATE_ENCRYPTION_KEY` e recadastrar o A1 pela pagina
`https://fiscal.seu-dominio.com.br/admin`. Isso regrava o certificado no
Supabase com a chave correta da VPS.

Se um certificado aparece na UI e some apos atualizar/reiniciar, confira se a
persistencia no Supabase esta salvando em `fiscal_certificates`. A aplicacao
deve atualizar o certificado ativo existente para o CNPJ, nao criar multiplos
certificados ativos para a mesma empresa.

## Clientes em homologacao

Para apontar um sistema cliente para a VPS, configure a URL da API e tambem a
URL de autenticacao. Alguns clientes usam autenticacao separada da URL base:

```env
NUVEMFISCAL_HOM_CLIENT_ID=local-client
NUVEMFISCAL_HOM_CLIENT_SECRET=<mesmo API_CLIENT_DEFAULT_SECRET da VPS>
NUVEMFISCAL_HOM_URL=https://fiscal.seu-dominio.com.br
NUVEMFISCAL_HOM_AUTH_URL=https://fiscal.seu-dominio.com.br/oauth/token
```

Depois de alterar `.env.local` no cliente, reinicie o servidor do cliente. Se
o OAuth retornar `Unknown client: local-client`, normalmente o cliente ainda
esta chamando a autenticacao oficial da Nuvem Fiscal ou leu variaveis antigas.

## Backup

O Supabase pode oferecer backups gerenciados conforme o plano. O timer local
adiciona uma copia independente em formato `pg_dump`:

```bash
sudo chmod 750 deploy/backup-supabase.sh
sudo cp deploy/nuvem-local-fiscal-backup.service /etc/systemd/system/
sudo cp deploy/nuvem-local-fiscal-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nuvem-local-fiscal-backup.timer
sudo systemctl list-timers nuvem-local-fiscal-backup.timer
```

Os arquivos ficam em `/var/backups/nuvem-local-fiscal` por 14 dias. Para
protecao real contra perda da VPS, sincronize essa pasta com armazenamento
externo criptografado.

Teste o backup antes de considerar o deploy concluido:

```bash
sudo systemctl start nuvem-local-fiscal-backup.service
sudo journalctl -u nuvem-local-fiscal-backup.service --no-pager
```

## Atualizacao

```bash
git pull --ff-only
npm ci
npm run typecheck
npm test
npm run build
sudo systemctl restart nuvem-local-fiscal
curl https://fiscal.seu-dominio.com.br/ready
```

Antes de apontar qualquer cliente ao servidor, faca uma emissao completa em
homologacao e confirme XML, DANFE, protocolo, cancelamento e inutilizacao.
