#!/usr/bin/env bash
# Generates a production .env from .env.example with fresh secrets.
# Usage: scripts/setup-env.sh [domain]   (default: localhost)
# Refuses to overwrite an existing .env, because its keys decrypt stored data.
set -euo pipefail
cd "$(dirname "$0")/.."
DOMAIN="${1:-localhost}"
if [ -e .env ]; then
  echo "File .env sudah ada; tidak ditimpa (kuncinya dipakai untuk membaca data terenkripsi)." >&2
  exit 1
fi
key() { openssl rand -base64 32; }
PGP="$(openssl rand -hex 16)"
cp .env.example .env
set_var() {
  local k="$1" v="$2"
  # '|' delimiter: base64 values may contain '/' and '+'.
  sed -i.bak "s|^${k}=.*$|${k}=${v}|" .env
}
set_var POSTGRES_PASSWORD "$PGP"
set_var DATABASE_URL "postgresql://halokampus:${PGP}@postgres:5432/halokampus"
set_var REDIS_URL "redis://redis:6379"
set_var DATA_ENCRYPTION_KEY "$(key)"
set_var BLIND_INDEX_KEY "$(key)"
set_var RESEARCH_PSEUDONYM_KEY "$(key)"
set_var API_PUBLIC_URL "https://${DOMAIN}"
set_var WEB_PUBLIC_URL "https://${DOMAIN}"
set_var CORS_ORIGINS "https://${DOMAIN}"
set_var COOKIE_SECURE true
set_var AI_INLINE false
set_var REALTIME_REDIS true
set_var ENABLE_SIMULATORS false
set_var CONFIG_DIR /app/config
set_var PMB_API_URL "http://mock-pmb:4100"
set_var SMTP_HOST mailpit
set_var MAILPIT_API_URL "http://mailpit:8025"
set_var EMAIL_WEBHOOK_TOKEN "$(openssl rand -hex 24)"
set_var SEED_DEFAULT_PASSWORD ""
rm -f .env.bak
printf '\nHALOKAMPUS_DOMAIN=%s\n' "$DOMAIN" >> .env
chmod 600 .env
echo ".env produksi dibuat untuk https://${DOMAIN}. Simpan salinannya di tempat aman."
