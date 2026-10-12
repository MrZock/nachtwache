#!/usr/bin/env bash
# Startet den Nachtwache-Spielserver im Hintergrund und macht Port 8080 öffentlich,
# damit Freunde ohne GitHub-Login mitspielen können.
cd "$(dirname "$0")/.." || exit 0
pkill -f "node server.js" 2>/dev/null
nohup node server.js 8080 > /tmp/nachtwache.log 2>&1 &
sleep 2
if [ -n "$CODESPACE_NAME" ]; then
  gh codespace ports visibility 8080:public -c "$CODESPACE_NAME" >/dev/null 2>&1 || true
  echo ""
  echo "Nachtwache läuft:  https://${CODESPACE_NAME}-8080.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}/"
fi
