#!/usr/bin/env bash
# Startet den Nachtwache-Spielserver dauerhaft im Hintergrund und macht Port 8080 öffentlich,
# damit Freunde ohne GitHub-Login mitspielen können.
cd "$(dirname "$0")/.." || exit 0
pkill -f "node server.js" 2>/dev/null
setsid nohup node server.js 8080 > /tmp/nachtwache.log 2>&1 < /dev/null &
if [ -n "$CODESPACE_NAME" ]; then
  # Die Port-Weiterleitung existiert erst kurz nach dem Start – ein paar Mal versuchen
  ( for i in 1 2 3 4 5 6 7 8 9 10; do
      sleep 6
      gh codespace ports visibility 8080:public -c "$CODESPACE_NAME" >/dev/null 2>&1 && break
    done ) > /dev/null 2>&1 &
  echo "Nachtwache läuft:  https://${CODESPACE_NAME}-8080.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}/"
fi
exit 0
