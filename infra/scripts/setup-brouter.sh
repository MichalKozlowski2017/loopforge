#!/usr/bin/env bash
set -euo pipefail

# BRouter JAR + routing segments (.rd5).
#
# BROUTER_SEGMENTS:
#   poland  — cała Polska, 11 segmentów (~850 MB) [domyślnie]
#   minimal — Warszawa i okolice, 2 segmenty (~150 MB)
#   italy   — Włochy (~0.8 GiB)
#   europe  — Europa (~3 GiB)
#   planet  — cały świat z brouter.de (~9 GiB, ~1100 plików)
#
#   pnpm setup:brouter:planet
#   BROUTER_DOWNLOAD_JOBS=6 pnpm setup:brouter:planet
#
# VPS (po pobraniu lokalnie — katalog segments4 należy do usera brouter):
#   rsync -avz --progress infra/brouter/segments4/ ubuntu@51.83.202.158:~/segments4-staging/
#   ssh ubuntu@51.83.202.158 'sudo rsync -a ~/segments4-staging/ /opt/loopforge/brouter/segments4/ && sudo chown -R brouter:brouter /opt/loopforge/brouter && rm -rf ~/segments4-staging && sudo systemctl restart brouter'

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BR_DIR="$ROOT/infra/brouter"
SEG_DIR="$BR_DIR/segments4"
VERSION="1.7.9"
SEGMENTS_MODE="${BROUTER_SEGMENTS:-poland}"
DOWNLOAD_JOBS="${BROUTER_DOWNLOAD_JOBS:-4}"
SEGMENTS_BASE_URL="https://brouter.de/brouter/segments4"

mkdir -p "$SEG_DIR" "$BR_DIR/customprofiles"

sync_custom_profiles() {
  local src="$BR_DIR/customprofiles"
  local dest="$BR_DIR/brouter-$VERSION/profiles2/customprofiles"
  if [[ ! -d "$src" ]]; then
    return
  fi
  mkdir -p "$dest"
  cp -f "$src"/*.brf "$dest/" 2>/dev/null || true
}

if [[ ! -f "$BR_DIR/brouter-$VERSION/brouter-$VERSION-all.jar" ]]; then
  echo "→ Pobieram BRouter $VERSION..."
  curl -fsSL -o "$BR_DIR/brouter-$VERSION.zip" \
    "https://github.com/abrensch/brouter/releases/download/v$VERSION/brouter-$VERSION.zip"
  unzip -qo "$BR_DIR/brouter-$VERSION.zip" -d "$BR_DIR"
fi

sync_custom_profiles

# 5°×5° kafelki BRoutera pokrywające Polskę (14–24°E, 49–55°N)
POLAND_SEGMENTS=(
  E10_N45.rd5
  E15_N45.rd5
  E20_N45.rd5
  E25_N45.rd5
  E10_N50.rd5
  E15_N50.rd5
  E20_N50.rd5
  E25_N50.rd5
  E10_N55.rd5
  E15_N55.rd5
  E20_N55.rd5
)

MINIMAL_SEGMENTS=(
  E15_N50.rd5
  E20_N50.rd5
)

download_via_python() {
  local mode="$1"
  shift
  # Remaining args: explicit file list for poland/minimal (optional).
  BROUTER_SEGMENTS_MODE="$mode" \
  BROUTER_SEGMENTS_DIR="$SEG_DIR" \
  BROUTER_SEGMENTS_BASE_URL="$SEGMENTS_BASE_URL" \
  BROUTER_DOWNLOAD_JOBS="$DOWNLOAD_JOBS" \
  BROUTER_SEGMENT_FILES="${*:-}" \
  python3 "$ROOT/infra/scripts/download-brouter-segments.py"
}

case "$SEGMENTS_MODE" in
  poland)
    echo "→ Segmenty: cała Polska (${#POLAND_SEGMENTS[@]} plików, ~850 MB)"
    download_via_python poland "${POLAND_SEGMENTS[@]}"
    ;;
  minimal)
    echo "→ Segmenty: minimal / Warszawa (${#MINIMAL_SEGMENTS[@]} pliki, ~150 MB)"
    download_via_python minimal "${MINIMAL_SEGMENTS[@]}"
    ;;
  italy)
    echo "→ Segmenty: Włochy (~0.8 GiB)"
    download_via_python italy
    ;;
  europe)
    echo "→ Segmenty: Europa (~3 GiB)"
    download_via_python europe
    ;;
  planet)
    echo "→ Segmenty: cały świat (~9 GiB)"
    download_via_python planet
    ;;
  *)
    echo "Nieznany BROUTER_SEGMENTS=$SEGMENTS_MODE (użyj: poland | minimal | italy | europe | planet)"
    exit 1
    ;;
esac

total_mb="$(du -sm "$SEG_DIR" 2>/dev/null | awk '{print $1}')"
count="$(find "$SEG_DIR" -name '*.rd5' | wc -l | tr -d ' ')"
echo "✓ BRouter gotowy ($SEGMENTS_MODE, ${count} plików .rd5, ${total_mb} MB w segments4/)"
echo "  Lokalnie: pnpm brouter  (albo pnpm dev z auto-spawn)"
echo "  VPS: rsync -avz --progress infra/brouter/segments4/ ubuntu@51.83.202.158:~/segments4-staging/"
echo "       ssh ubuntu@51.83.202.158 'sudo rsync -a ~/segments4-staging/ /opt/loopforge/brouter/segments4/ && sudo chown -R brouter:brouter /opt/loopforge/brouter && rm -rf ~/segments4-staging && sudo systemctl restart brouter'"

ENV_FILE="$ROOT/apps/web/.env.local"
if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<EOF
# BRouter — ścieżki względem apps/web
BROUTER_JAR=../../infra/brouter/brouter-$VERSION/brouter-$VERSION-all.jar
BROUTER_SEGMENTS_DIR=../../infra/brouter/segments4
BROUTER_PROFILES_DIR=../../infra/brouter/brouter-$VERSION/profiles2
BROUTER_CUSTOM_PROFILES_DIR=../../infra/brouter/customprofiles
BROUTER_PORT=17777
EOF
  echo "→ Utworzono $ENV_FILE"
fi
