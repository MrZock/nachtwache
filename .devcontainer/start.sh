#!/usr/bin/env bash
# Startet den Nachtwache-Spielserver im Vordergrund dieses Terminals und macht Port 8080 öffentlich,
# damit Freunde ohne GitHub-Login mitspielen können. Das Terminal einfach offen lassen.
cd "$(dirname "$0")/.." || exit 1
pkill -f "node server.js" 2>/dev/null
sleep 1
if [ -n "$CODESPACE_NAME" ]; then
  # Die Port-Weiterleitung existiert erst kurz nach dem Start – ein paar Mal versuchen
  ( for i in 1 2 3 4 5 6 7 8 9 10; do
      sleep 5
      gh codespace ports visibility 8080:public -c "$CODESPACE_NAME" >/dev/null 2>&1 && break
    done ) > /dev/null 2>&1 &
  echo ""
  echo "  Spiel-Link:  https://mrzock.github.io/nachtwache/"
  echo "  Server:      https://${CODESPACE_NAME}-8080.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}/"
fi
exec node server.js 8080
