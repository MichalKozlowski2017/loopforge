#!/usr/bin/env bash
# HTTPS reverse proxy for BRouter on OVH VPS.
# Prerequisite: DNS A record → VPS IP (e.g. router.loopforge.pl).
#
#   rsync -avz infra/scripts/setup-caddy-vps.sh ubuntu@VPS:/tmp/
#   ssh ubuntu@VPS 'sudo ROUTER_DOMAIN=router.loopforge.pl bash /tmp/setup-caddy-vps.sh'

set -euo pipefail

ROUTER_DOMAIN="${ROUTER_DOMAIN:?Set ROUTER_DOMAIN, e.g. router.loopforge.pl}"
BROUTER_PORT="${BROUTER_PORT:-17777}"
EMAIL="${CADDY_EMAIL:-}"

echo "→ Caddy (domain: $ROUTER_DOMAIN → 127.0.0.1:$BROUTER_PORT)..."
apt-get update -qq
apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/gpg.key" | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf "https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt" | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update -qq
apt-get install -y -qq caddy

GLOBAL_OPTS=""
if [[ -n "$EMAIL" ]]; then
  GLOBAL_OPTS="email $EMAIL"
fi

cat > /etc/caddy/Caddyfile <<EOF
{
  $GLOBAL_OPTS
}

$ROUTER_DOMAIN {
  reverse_proxy 127.0.0.1:$BROUTER_PORT
}
EOF

systemctl enable caddy
systemctl reload caddy || systemctl restart caddy

echo "→ Health check (HTTPS)..."
sleep 2
if curl -sf "https://$ROUTER_DOMAIN/brouter?lonlats=21.0,52.2|21.01,52.2&profile=trekking&engineMode=3" >/dev/null; then
  echo "✓ https://$ROUTER_DOMAIN działa"
else
  echo "⚠ HTTPS jeszcze nie odpowiada — sprawdź DNS (A → $(curl -4 -s ifconfig.me 2>/dev/null || echo VPS_IP)) i: journalctl -u caddy -f"
fi

cat <<EOF

Vercel (Production):
  ROUTING_ENGINE=brouter
  BROUTER_URL=https://$ROUTER_DOMAIN

EOF
