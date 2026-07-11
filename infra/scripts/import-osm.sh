#!/usr/bin/env bash
set -euo pipefail

# Import OSM Poland into Supabase/Postgres and build pgRouting graph.
#
# Requirements:
#   osm2pgsql (https://osm2pgsql.org/)
#   psql
#   DATABASE_URL or SUPABASE_DB_URL
#
# Usage:
#   DATABASE_URL=postgresql://... pnpm import:osm
#   DATABASE_URL=... pnpm import:osm --region mazowsze   # smaller extract (~200 MB)

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DATA_DIR="$ROOT/infra/osm-data"
SQL_DIR="$ROOT/infra/sql"
REGION="${1:-poland}"

mkdir -p "$DATA_DIR"

DB_URL="${DATABASE_URL:-${SUPABASE_DB_URL:-}}"
if [[ -z "$DB_URL" ]]; then
  echo "Ustaw DATABASE_URL lub SUPABASE_DB_URL"
  exit 1
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
  *)
    echo "Nieznany region: $REGION (poland | mazowsze)"
    exit 1
    ;;
esac

if [[ ! -f "$PBF_FILE" ]]; then
  echo "→ Pobieram $PBF_FILE ..."
  curl -fsSL -o "$PBF_FILE" "$PBF_URL"
fi

echo "→ Migracje Supabase (jeśli lokalnie: supabase db push)"
if command -v supabase >/dev/null 2>&1 && [[ "$DB_URL" == *"127.0.0.1:54322"* ]]; then
  (cd "$ROOT" && supabase db push --local)
fi

echo "→ Import OSM do planet_osm_* (może potrwać 20–90 min dla całej Polski)..."
osm2pgsql \
  --create \
  --slim \
  --drop \
  --hstore \
  --latlong \
  --number-processes "$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)" \
  --database "$DB_URL" \
  "$PBF_FILE"

echo "→ Buduję loopforge.ways + topologię pgRouting..."
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_DIR/build-ways.sql"

echo "✓ Import zakończony. Sprawdź: select ways_count from loopforge.import_status;"
