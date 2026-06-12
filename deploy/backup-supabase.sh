#!/usr/bin/env bash
set -euo pipefail

umask 077

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "SUPABASE_DB_URL nao configurada." >&2
  exit 1
fi

BACKUP_DIR="${BACKUP_DIR:-/var/backups/nuvem-local-fiscal}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${BACKUP_DIR}/nuvem-local-fiscal-${TIMESTAMP}.dump"

install -d -m 0700 "${BACKUP_DIR}"
pg_dump \
  --dbname="${SUPABASE_DB_URL}" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="${TARGET}"

find "${BACKUP_DIR}" -type f -name 'nuvem-local-fiscal-*.dump' \
  -mtime "+${RETENTION_DAYS}" -delete

echo "${TARGET}"
