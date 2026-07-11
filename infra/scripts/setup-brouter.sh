#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BR_DIR="$ROOT/infra/brouter"
SEG_DIR="$BR_DIR/segments4"
VERSION="1.7.9"

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
  if [[ ! -f "$SEG_DIR/$file" ]]; then
    echo "→ Pobieram segment $file..."
    curl -fsSL -o "$SEG_DIR/$file" "https://brouter.de/brouter/segments4/$file"
  fi
}

# Polska środkowa — Warszawa i okolice
download_segment "E15_N50.rd5"
download_segment "E20_N50.rd5"

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

echo "✓ BRouter gotowy. Uruchom: pnpm dev (serwer startuje automatycznie przy generowaniu)"
