#!/usr/bin/env bash
set -euo pipefail

# Import OSM Poland into Supabase/Postgres and build pgRouting graph.
#
# Requirements:
#   osm2pgsql, supabase CLI (zalogowany + link)
#   DATABASE_URL lub SUPABASE_DB_PASSWORD (+ zlinkowany projekt)
#
# Usage:
#   pnpm setup:supabase          # klucze API + DATABASE_URL (jeśli SUPABASE_DB_PASSWORD)
#   pnpm import:osm:mazowsze     # ~15 min
#   pnpm import:osm              # cała Polska, 20–90 min

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DATA_DIR="$ROOT/infra/osm-data"
SQL_DIR="$ROOT/infra/sql"
REGION="${1:-poland}"
OSM_BBOX=""

mkdir -p "$DATA_DIR"

resolve_db_url() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    echo "$DATABASE_URL"
    return
  fi
  if [[ -n "${SUPABASE_DB_URL:-}" ]]; then
    echo "$SUPABASE_DB_URL"
    return
  fi
  if [[ -f "$ROOT/apps/web/.env.local" ]]; then
    local from_env
    from_env="$(node -e "
const fs = require('fs');
const text = fs.readFileSync(process.argv[1], 'utf8');
const m = text.match(/^DATABASE_URL=(.*)$/m);
if (m && m[1] && m[1].trim() && !m[1].includes('[')) console.log(m[1].trim());
" "$ROOT/apps/web/.env.local")"
    if [[ -n "$from_env" ]]; then
      echo "$from_env"
      return
    fi
  fi
  if [[ -n "${SUPABASE_DB_PASSWORD:-}" && -f "$ROOT/supabase/.temp/project-ref" ]]; then
    local ref host encoded
    ref="$(tr -d '[:space:]' < "$ROOT/supabase/.temp/project-ref")"
    host="db.${ref}.supabase.co"
    encoded="$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$SUPABASE_DB_PASSWORD")"
    echo "postgresql://postgres:${encoded}@${host}:5432/postgres"
    return
  fi
  return 1
}

DB_URL="$(resolve_db_url || true)"
if [[ -z "$DB_URL" ]]; then
  echo "Brak DATABASE_URL. Uruchom:"
  echo "  export SUPABASE_DB_PASSWORD='haslo_z_dashboardu'"
  echo "  pnpm setup:supabase && pnpm import:osm:mazowsze"
  exit 1
fi

# Supabase: wyłącz statement_timeout na sesji importu
if [[ "$DB_URL" != *"statement_timeout"* ]]; then
  if [[ "$DB_URL" == *"?"* ]]; then
    DB_URL="${DB_URL}&options=-c%20statement_timeout%3D0"
  else
    DB_URL="${DB_URL}?options=-c%20statement_timeout%3D0"
  fi
fi

if ! command -v osm2pgsql >/dev/null 2>&1; then
  echo "Brak osm2pgsql. macOS: brew install osm2pgsql"
  exit 1
fi

case "$REGION" in
  poland)
    PBF_URL="https://download.geofabrik.de/europe/poland-latest.osm.pbf"
    PBF_FILE="$DATA_DIR/poland-latest.osm.pbf"
    ;;
  mazowsze)
    PBF_URL="https://download.geofabrik.de/europe/poland/mazowieckie-latest.osm.pbf"
    PBF_FILE="$DATA_DIR/mazowieckie-latest.osm.pbf"
    ;;
  warszawa)
    # Bbox wokół Warszawy — mieści się w limicie 500 MB Supabase Free
    PBF_FILE="$DATA_DIR/mazowieckie-latest.osm.pbf"
    PBF_URL=""
    OSM_BBOX="20.85,52.05,21.25,52.40"
    ;;
  *)
    echo "Nieznany region: $REGION (poland | mazowsze)"
    exit 1
    ;;
esac

if [[ ! -f "$PBF_FILE" ]]; then
  if [[ -z "${PBF_URL:-}" ]]; then
    echo "Brak pliku $PBF_FILE — najpierw: pnpm import:osm:mazowsze (pobierze PBF)"
    exit 1
  fi
  echo "→ Pobieram $PBF_FILE ..."
  curl -fsSL -o "$PBF_FILE" "$PBF_URL"
fi

echo "→ Migracje Supabase (jeśli lokalnie: supabase db push)"
if command -v supabase >/dev/null 2>&1 && [[ "$DB_URL" == *"127.0.0.1:54322"* ]]; then
  (cd "$ROOT" && supabase db push --local)
fi

echo "→ Import OSM do planet_osm_* ..."
FLAT_NODES="$DATA_DIR/${REGION}-flat-nodes.bin"
OSM_PROCESSES="${OSM2PGSQL_PROCESSES:-2}"
OSM_ARGS=(
  --create
  --slim
  --drop
  --hstore
  --latlong
  --number-processes "$OSM_PROCESSES"
  --database "$DB_URL"
)
if [[ -n "${OSM_BBOX:-}" ]]; then
  OSM_ARGS+=(--bbox "$OSM_BBOX")
  echo "   bbox: $OSM_BBOX"
elif [[ "$DB_URL" == *"127.0.0.1"* || "$DB_URL" == *"localhost"* ]]; then
  # flat-nodes na lokalnym Postgresie — oszczędza RAM. Na macOS plik rośnie
  # do ~max_node_id×8 B (Geofabrik ≈ 50–100 GB), więc NIE używaj tego w chmurze.
  OSM_ARGS+=(--flat-nodes "$FLAT_NODES")
  echo "   flat-nodes: $FLAT_NODES"
else
  echo "   slim (bez flat-nodes) — node'y idą do Supabase, nie na dysk Maca"
fi

osm2pgsql "${OSM_ARGS[@]}" "$PBF_FILE"

echo "→ Buduję loopforge.ways + topologię pgRouting..."
node "$ROOT/infra/scripts/run-sql.mjs" "$SQL_DIR/build-ways.sql"

echo "→ RLS na tabelach planet_osm_* (bez dostępu przez anon API)..."
node "$ROOT/infra/scripts/apply-osm-rls.mjs"

if command -v supabase >/dev/null 2>&1 && [[ -f "$ROOT/supabase/.temp/project-ref" ]]; then
  echo "→ Rejestruję migrację 20260711000004_osm_tables_rls..."
  (cd "$ROOT" && supabase db push --yes) || echo "   (db push pominięty — uruchom ręcznie: supabase db push)"
fi

echo "✓ Import zakończony. Sprawdź: select ways_count from loopforge.import_status;"
