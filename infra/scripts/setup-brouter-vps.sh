#!/usr/bin/env bash
# Setup BRouter on Ubuntu 24.04 VPS (OVH Warsaw).
# Run ON the VPS as root after copying infra/brouter from your machine.
#
# From Mac (before/after SSH):
#   pnpm setup:brouter
#   rsync -avz infra/brouter/ ubuntu@VPS_IP:/opt/loopforge/brouter/
#   rsync -avz infra/scripts/setup-brouter-vps.sh ubuntu@VPS_IP:/tmp/
#   ssh ubuntu@VPS_IP 'sudo bash /tmp/setup-brouter-vps.sh'

set -euo pipefail

BROUTER_ROOT="${BROUTER_ROOT:-/opt/loopforge/brouter}"
VERSION="1.7.9"
PORT="${BROUTER_PORT:-17777}"
JAVA_HEAP="${BROUTER_JAVA_HEAP:-512M}"
SERVICE_USER="${BROUTER_USER:-brouter}"

echo "→ Java 17..."
apt-get update -qq
apt-get install -y -qq openjdk-17-jre-headless curl

echo "→ User + katalogi..."
id "$SERVICE_USER" &>/dev/null || useradd --system --home "$BROUTER_ROOT" --shell /usr/sbin/nologin "$SERVICE_USER"
mkdir -p "$BROUTER_ROOT"
chown -R "$SERVICE_USER:$SERVICE_USER" "$BROUTER_ROOT"

JAR="$BROUTER_ROOT/brouter-$VERSION/brouter-$VERSION-all.jar"
SEG="$BROUTER_ROOT/segments4"
PROF="$BROUTER_ROOT/brouter-$VERSION/profiles2"
CUSTOM_SRC="$BROUTER_ROOT/customprofiles"
CUSTOM="$PROF/customprofiles"

if [[ ! -f "$JAR" ]]; then
  echo "Brak JAR: $JAR"
  echo "Najpierw: rsync -avz infra/brouter/ user@vps:/opt/loopforge/brouter/"
  exit 1
fi

mkdir -p "$CUSTOM"
if [[ -d "$CUSTOM_SRC" ]]; then
  cp -f "$CUSTOM_SRC"/*.brf "$CUSTOM/" 2>/dev/null || true
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$BROUTER_ROOT"

echo "→ systemd..."
cat > /etc/systemd/system/brouter.service <<EOF
[Unit]
Description=BRouter for Loopforge
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$BROUTER_ROOT
ExecStart=/usr/bin/java -Xmx${JAVA_HEAP} -DmaxRunningTime=300 \\
  -cp $JAR btools.server.RouteServer \\
  $SEG $PROF $CUSTOM $PORT 4
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable brouter
systemctl restart brouter

echo "→ Firewall (ufw)..."
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable || true
fi

echo "→ Health check..."
sleep 3
if curl -sf "http://127.0.0.1:${PORT}/brouter?lonlats=21.0,52.2|21.01,52.2&profile=trekking&engineMode=3" >/dev/null; then
  echo "✓ BRouter działa na porcie $PORT (localhost only)"
else
  echo "⚠ BRouter jeszcze się podnosi — sprawdź: journalctl -u brouter -f"
fi

cat <<EOF

Następne kroki:
1. Caddy/nginx: HTTPS proxy router.twojadomena.pl → 127.0.0.1:$PORT
2. NIE wystawiaj portu $PORT publicznie — tylko 443 przez reverse proxy
3. Vercel env: BROUTER_URL=https://router.twojadomena.pl
4. Segmenty PL: pobierz więcej .rd5 do $SEG (pnpm setup:brouter lokalnie + rsync)

EOF
