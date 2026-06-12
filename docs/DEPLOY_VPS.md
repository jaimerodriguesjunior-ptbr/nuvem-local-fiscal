# Deploy em VPS

Este roteiro publica a Nuvem Local Fiscal com Node.js, `systemd`, Nginx,
HTTPS e Supabase. O deploy do servidor nao libera operacoes fiscais em
producao: o bloqueio permanece no codigo.

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
certificado. Antes de ativar, crie a segunda autenticacao que protege todo o
admin e suas APIs:

```bash
sudo apt install apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd-nuvem-local-fiscal operador
sudo chown root:www-data /etc/nginx/.htpasswd-nuvem-local-fiscal
sudo chmod 640 /etc/nginx/.htpasswd-nuvem-local-fiscal
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
