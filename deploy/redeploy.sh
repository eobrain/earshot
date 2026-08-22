#!/usr/bin/env bash
# Fast redeploy. Safe to run from any directory: sudo bash deploy/redeploy.sh
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
[ -f "$REPO/server/app.py" ] || { echo "cannot locate repo from $REPO"; exit 1; }
rsync -a --exclude .git --exclude node_modules --exclude .venv --exclude client/dist "$REPO/" /opt/earshot/
(cd /opt/earshot/client && npm install --silent && npm run build)
chown -R earshot:earshot /opt/earshot
systemctl restart earshot-coordinator   # needed only for server/ changes
echo "redeployed from $REPO"
