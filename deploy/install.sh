#!/usr/bin/env bash
# One-time VPS setup (Ubuntu 22.04+). Run as root from the repo root.
set -euo pipefail
apt-get update && apt-get install -y python3-venv coturn caddy npm
id -u earshot &>/dev/null || useradd -r -m -d /opt/earshot earshot
rsync -a --exclude .git . /opt/earshot/
cd /opt/earshot
python3 -m venv .venv && .venv/bin/pip install -r server/requirements.txt -r sim/requirements.txt
(cd client && npm install && npm run build)
cp deploy/earshot-coordinator.service /etc/systemd/system/
cp deploy/coturn.conf /etc/turnserver.conf   # edit secret + realm first!
cp deploy/Caddyfile /etc/caddy/Caddyfile     # edit domain first!
chown -R earshot:earshot /opt/earshot
systemctl daemon-reload
systemctl enable --now earshot-coordinator coturn caddy
echo "Done. Check: systemctl status earshot-coordinator"
