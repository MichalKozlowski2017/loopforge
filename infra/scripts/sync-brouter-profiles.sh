#!/usr/bin/env bash
# Sync custom BRouter profiles to the VPS (no full segments re-upload).
#
# Usage:
#   BROUTER_VPS=ubuntu@YOUR_VPS_IP bash infra/scripts/sync-brouter-profiles.sh
#
# Requires rsync + SSH. Restarts the brouter systemd unit after copy.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VPS="${BROUTER_VPS:?Set BROUTER_VPS, e.g. ubuntu@203.0.113.10}"
REMOTE_ROOT="${BROUTER_ROOT:-/opt/loopforge/brouter}"
VERSION="${BROUTER_VERSION:-1.7.9}"
REMOTE_CUSTOM="$REMOTE_ROOT/brouter-$VERSION/profiles2/customprofiles"

echo "→ Sync custom profiles to $VPS..."
rsync -avz "$ROOT/infra/brouter/customprofiles/" "$VPS:$REMOTE_ROOT/customprofiles/"

echo "→ Install into BRouter profiles dir + restart..."
ssh "$VPS" "sudo mkdir -p '$REMOTE_CUSTOM' && \
  sudo cp -f '$REMOTE_ROOT/customprofiles/'*.brf '$REMOTE_CUSTOM/' && \
  sudo systemctl restart brouter && \
  sleep 2 && \
  curl -sf 'http://127.0.0.1:${BROUTER_PORT:-17777}/brouter?lonlats=21.0,52.2|21.01,52.2&profile=customprofiles/loopforge-mtb&format=geojson' >/dev/null && \
  echo '✓ loopforge-mtb profile OK' || echo '⚠ Health check failed — see journalctl -u brouter'"

echo "Done."
