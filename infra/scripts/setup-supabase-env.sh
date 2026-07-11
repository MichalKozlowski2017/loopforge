#!/usr/bin/env bash
set -euo pipefail

# Uzupełnia apps/web/.env.local kluczami z zlinkowanego projektu Supabase.
# Hasło bazy: ustaw SUPABASE_DB_PASSWORD w env albo w .env.local (DATABASE_URL).

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="$ROOT/apps/web/.env.local"
REF_FILE="$ROOT/supabase/.temp/project-ref"

if ! command -v supabase >/dev/null 2>&1; then
  echo "Brak supabase CLI"
  exit 1
fi

if [[ ! -f "$REF_FILE" ]]; then
  echo "Projekt nie jest zlinkowany. Uruchom: supabase link --project-ref ivaarrzxpoffwbmvwitc"
  exit 1
fi

PROJECT_REF="$(tr -d '[:space:]' < "$REF_FILE")"
API_URL="https://${PROJECT_REF}.supabase.co"
DB_HOST="db.${PROJECT_REF}.supabase.co"

echo "→ Projekt: $PROJECT_REF"

KEYS_JSON="$(supabase projects api-keys --project-ref "$PROJECT_REF" -o json)"
ANON_KEY="$(node -e "
const keys = JSON.parse(process.argv[1]);
const anon = keys.find(k => k.id === 'anon' || k.name === 'anon');
if (!anon) throw new Error('Brak anon key');
process.stdout.write(anon.api_key);
" "$KEYS_JSON")"
SERVICE_KEY="$(node -e "
const keys = JSON.parse(process.argv[1]);
const svc = keys.find(k => k.id === 'service_role' || k.name === 'service_role');
if (!svc) throw new Error('Brak service_role key');
process.stdout.write(svc.api_key);
" "$KEYS_JSON")"

DB_PASSWORD="${SUPABASE_DB_PASSWORD:-}"
if [[ -z "$DB_PASSWORD" && -f "$ENV_FILE" ]]; then
  DB_PASSWORD="$(node -e "
const fs = require('fs');
const path = process.argv[1];
if (!fs.existsSync(path)) process.exit(0);
const text = fs.readFileSync(path, 'utf8');
const m = text.match(/^SUPABASE_DB_PASSWORD=(.*)$/m);
if (m && m[1] && !m[1].includes('[')) process.stdout.write(m[1].trim());
" "$ENV_FILE")"
fi

DATABASE_URL=""
if [[ -n "$DB_PASSWORD" ]]; then
  ENCODED="$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$DB_PASSWORD")"
  DATABASE_URL="postgresql://postgres:${ENCODED}@${DB_HOST}:5432/postgres"
fi

mkdir -p "$(dirname "$ENV_FILE")"
cat > "$ENV_FILE" <<EOF
# Supabase — loopforge ($PROJECT_REF), wygenerowano: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
NEXT_PUBLIC_SUPABASE_URL=${API_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}

# Hasło bazy: Dashboard → Settings → Database (Reset password jeśli nie pamiętasz)
# SUPABASE_DB_PASSWORD=twoje_haslo
DATABASE_URL=${DATABASE_URL}

ROUTING_ENGINE=brouter
EOF

echo "✓ Zapisano $ENV_FILE"

if [[ -z "$DATABASE_URL" ]]; then
  echo ""
  echo "Brak DATABASE_URL — dodaj hasło bazy:"
  echo "  export SUPABASE_DB_PASSWORD='...'"
  echo "  pnpm setup:supabase"
  echo "albo wpisz DATABASE_URL ręcznie w $ENV_FILE"
  exit 0
fi

echo "✓ DATABASE_URL ustawione (direct connection)"
