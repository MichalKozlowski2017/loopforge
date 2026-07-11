#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VERSION="1.7.9"
JAR="$ROOT/infra/brouter/brouter-$VERSION/brouter-$VERSION-all.jar"
SEG="$ROOT/infra/brouter/segments4"
PROF="$ROOT/infra/brouter/brouter-$VERSION/profiles2"
CUSTOM="$PROF/customprofiles"
PORT="${BROUTER_PORT:-17777}"

mkdir -p "$CUSTOM"
cp -f "$ROOT/infra/brouter/customprofiles"/*.brf "$CUSTOM/" 2>/dev/null || true

exec java -Xmx256M -DmaxRunningTime=300 \
  -cp "$JAR" btools.server.RouteServer \
  "$SEG" "$PROF" "$CUSTOM" "$PORT" 4
