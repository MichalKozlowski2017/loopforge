#!/usr/bin/env bash
# Sync custom BRouter profiles to the VPS (no full segments re-upload).
#
# Usage:
#   BROUTER_VPS=ubuntu@YOUR_VPS_IP bash infra/scripts/sync-brouter-profiles.sh
#
# /opt/loopforge is owned by the brouter user — rsync goes via ~/customprofiles-staging.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VPS="${BROUTER_VPS:?Set BROUTER_VPS, e.g. ubuntu@203.0.113.10}"
REMOTE_ROOT="${BROUTER_ROOT:-/opt/loopforge/brouter}"
VERSION="${BROUTER_VERSION:-1.7.9}"
STAGING="~/customprofiles-staging"
REMOTE_CUSTOM="$REMOTE_ROOT/brouter-$VERSION/profiles2/customprofiles"
BROUTER_PORT="${BROUTER_PORT:-17777}"

echo "→ Upload custom profiles to $VPS (staging)..."
rsync -avz "$ROOT/infra/brouter/customprofiles/" "$VPS:$STAGING/"

echo "→ Install into BRouter profiles dir + restart..."
ssh "$VPS" "sudo mkdir -p '$REMOTE_CUSTOM' '$REMOTE_ROOT/customprofiles' && \
  sudo rsync -a ~/customprofiles-staging/ '$REMOTE_ROOT/customprofiles/' && \
  sudo cp -f '$REMOTE_ROOT/customprofiles/'*.brf '$REMOTE_CUSTOM/' && \
  sudo chown -R brouter:brouter '$REMOTE_ROOT' && \
  rm -rf ~/customprofiles-staging && \
  sudo systemctl restart brouter && \
  sleep 2 && \
  curl -sf 'http://127.0.0.1:${BROUTER_PORT}/brouter?lonlats=21.0,52.2|21.01,52.2&profile=customprofiles/loopforge-approach&format=geojson' >/dev/null && \
  echo '✓ loopforge-approach profile OK' || echo '⚠ loopforge-approach health check failed' && \
  curl -sf 'http://127.0.0.1:${BROUTER_PORT}/brouter?lonlats=21.0,52.2|21.01,52.2&profile=customprofiles/loopforge-road&format=geojson' >/dev/null && \
  echo '✓ loopforge-road profile OK' || echo '⚠ loopforge-road health check failed' && \
  curl -sf 'http://127.0.0.1:${BROUTER_PORT}/brouter?lonlats=21.0,52.2|21.01,52.2&profile=customprofiles/loopforge-mtb&format=geojson' >/dev/null && \
  echo '✓ loopforge-mtb profile OK' || echo '⚠ loopforge-mtb health check failed'"

echo "Done."
