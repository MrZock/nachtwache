# Nachtwache – Zombie-Survival mit Basisbau

Browser-Spiel (eine einzige `index.html`, keine Abhängigkeiten): Tagsüber Holz, Stein und Gold sammeln und eine Basis bauen, nachts Zombiewellen abwehren. Allein oder zu zweit online.

## Spielen

- **Allein:** `index.html` im Browser öffnen → „Einzelspieler“.
- **Zu zweit online:** Online-Version öffnen → einer klickt „Online hosten“ und bekommt einen **Raum-Code**, der andere klickt „Online beitreten“ und gibt den Code ein (oder öffnet den Einladungslink).

**Steuerung:** WASD laufen · Maus zielen · Linksklick angreifen/abbauen · Q/E/R Spitzhacke/Schwert/Bogen · 1–0 Gebäude · Gebäude anklicken → Upgrade (U) / Verkaufen (X) · T/Enter Chat · G Markierung · ESC Pause/Menü · M Ton

**Neu:** große Karte (140×140), Heilturm, Bomber-Zombies, Schatztruhen, Ingame-Chat, Markierungen für den Mitspieler.

## Aufbau

| Datei | Zweck |
|---|---|
| `index.html` | Das komplette Spiel |
| `server.js` | Spielserver: liefert das Spiel aus und leitet die Daten zwischen zwei Spielern weiter (WebSocket, Räume mit 4-stelligem Code). Reines Node.js, keine Pakete. |
| `render.yaml` | Konfiguration für den kostenlosen Server auf [Render.com](https://render.com) |
| `start-server.bat` | Startet den Server lokal (Heimnetz) |

## Online-Modus einrichten

1. **GitHub Pages** (Spiel-Seite): Repository → *Settings* → *Pages* → *Deploy from a branch* → `main` / `/ (root)`.
2. **Render** (Spielserver): Auf render.com mit GitHub anmelden → *New* → *Blueprint* → dieses Repository wählen → *Apply*. Render zeigt danach eine Adresse wie `https://nachtwache-xxxx.onrender.com`.
3. Diese Adresse in `index.html` bei `const RELAY_URL = '';` eintragen (z. B. `'nachtwache-xxxx.onrender.com'`) und hochladen.

Hinweis: Der kostenlose Render-Server schläft nach 15 Minuten ohne Spieler ein. Beim nächsten Verbinden dauert das Aufwachen bis zu einer Minute – das Spiel versucht es automatisch weiter.

Im Heimnetz geht es auch ohne Internet-Server: `start-server.bat` starten, `http://localhost:8080` öffnen.
