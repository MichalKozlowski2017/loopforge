#!/usr/bin/env bash
set -euo pipefail

# BRouter JAR + routing segments (.rd5).
#
# BROUTER_SEGMENTS:
#   poland  — cała Polska, 11 segmentów (~850 MB) [domyślnie]
#   minimal — Warszawa i okolice, 2 segmenty (~150 MB)
#
#   pnpm setup:brouter
#   BROUTER_SEGMENTS=minimal pnpm setup:brouter
#
# VPS (po pobraniu lokalnie — katalog segments4 należy do usera brouter):
#   rsync -avz infra/brouter/segments4/ ubuntu@VPS:~/segments4-staging/
#   ssh ubuntu@VPS 'sudo rsync -a ~/segments4-staging/ /opt/loopforge/brouter/segments4/ && sudo chown -R brouter:brouter /opt/loopforge/brouter && rm -rf ~/segments4-staging && sudo systemctl restart brouter'

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BR_DIR="$ROOT/infra/brouter"
SEG_DIR="$BR_DIR/segments4"
VERSION="1.7.9"
SEGMENTS_MODE="${BROUTER_SEGMENTS:-poland}"

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

download_segment() {
  local file="$1"
  if [[ -f "$SEG_DIR/$file" ]]; then
    echo "  ✓ $file"
    return
  fi
  echo "→ Pobieram $file..."
  curl -fSL --progress-bar -o "$SEG_DIR/$file" \
    "https://brouter.de/brouter/segments4/$file"
  echo "  ✓ $file"
}

# 5°×5° kafelki BRoutera pokrywające Polskę (14–24°E, 49–55°N)
POLAND_SEGMENTS=(
  E10_N45.rd5 # zachód (Szczecin, zach. granica)
  E15_N45.rd5 # południowy zachód (Wrocław, Sudety)
  E20_N45.rd5 # południe (Kraków, Katowice, Beskidy)
  E25_N45.rd5 # południowy wschód (Rzeszów, Bieszczady)
  E10_N50.rd5 # środkowy zachód
  E15_N50.rd5 # centrum (Poznań, Łódź)
  E20_N50.rd5 # centrum-wschód (Warszawa, Lublin)
  E25_N50.rd5 # wschód (Białystok)
  E10_N55.rd5 # północny zachód
  E15_N55.rd5 # północ (Gdańsk, Trójmiasto)
  E20_N55.rd5 # północny wschód (Warmia)
)

MINIMAL_SEGMENTS=(
  E15_N50.rd5
  E20_N50.rd5
)

case "$SEGMENTS_MODE" in
  poland)
    SEGMENTS=("${POLAND_SEGMENTS[@]}")
    echo "→ Segmenty: cała Polska (${#SEGMENTS[@]} plików, ~850 MB)"
    ;;
  minimal)
    SEGMENTS=("${MINIMAL_SEGMENTS[@]}")
    echo "→ Segmenty: minimal / Warszawa (${#SEGMENTS[@]} pliki, ~150 MB)"
    ;;
  *)
    echo "Nieznany BROUTER_SEGMENTS=$SEGMENTS_MODE (użyj: poland | minimal)"
    exit 1
    ;;
esac

for seg in "${SEGMENTS[@]}"; do
  download_segment "$seg"
done

total_mb="$(du -sm "$SEG_DIR" 2>/dev/null | awk '{print $1}')"
echo "✓ BRouter gotowy ($SEGMENTS_MODE, ${total_mb} MB w segments4/)"
echo "  Lokalnie: pnpm dev"
if [[ "$SEGMENTS_MODE" == "poland" ]]; then
  echo "  VPS: rsync -avz infra/brouter/segments4/ ubuntu@VPS:~/segments4-staging/"
  echo "       ssh ubuntu@VPS 'sudo rsync -a ~/segments4-staging/ /opt/loopforge/brouter/segments4/ && sudo chown -R brouter:brouter /opt/loopforge/brouter && rm -rf ~/segments4-staging && sudo systemctl restart brouter'"
fi

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
