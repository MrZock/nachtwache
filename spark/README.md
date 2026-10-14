# SPARK – Spiele-Launcher

SPARK ist eine Windows-App, mit der man unsere Spiele **installiert, aktualisiert und startet** – wie ein kleiner eigener Steam.

- **Bibliothek** links, große Spielseite mit Titelbild, Beschreibung, Version, Größe, Spielzeit und „zuletzt gespielt“
- **Installieren / Update / Spielen** mit einem Knopf; Updates laden nur geänderte Dateien, jede Datei wird per SHA-256 geprüft
- Spiele laufen in einem eigenen Vollbild-Fenster (F11 / Alt+Enter umschalten), SPARK versteckt sich so lange
- **Offline**: installierte Spiele starten auch ohne Internet
- Spielstände liegen in `Dokumente/<Spiel>` (bei BLACKOUT dieselben wie in der BLACKOUT-App)
- Installierte Spiele: `%APPDATA%/SPARK/Spiele`

## Bauen

```
cd spark
npm install
npm run build
```

Danach liegen in `spark/dist/`: `SPARK-Setup-1.0.0.exe` (Installer) und `SPARK-1.0.0-portable.exe`.
Ausprobieren ohne Bauen: `npm start`.

## Katalog – so kommt ein Spiel (oder ein Update) in SPARK

SPARK lädt beim Start `https://mrzock.github.io/nachtwache/spark/catalog/games.json`.

1. In `catalog/games.src.json` das Spiel eintragen bzw. die Version erhöhen
   (`base` = Adresse, unter der die Spieldateien online liegen; `local` = Ordner mit denselben Dateien hier im Projekt; `files` = alle Dateien des Spiels).
2. Titelbild (16:9, z. B. `meinspiel.jpg`) nach `catalog/` legen.
3. `npm run catalog` – berechnet Größen und Prüfsummen und schreibt `catalog/games.json`.
4. Committen und pushen. Sobald GitHub Pages aktualisiert ist, zeigt SPARK das Spiel bzw. „Update verfügbar“.

**Wichtig:** Nach jeder Änderung an BLACKOUT `npm run catalog` ausführen und mit committen – sonst passen die Prüfsummen nicht und SPARK meldet beim Update einen Fehler.

## Selbsttest

```
set SPARK_SELFTEST=1 && npx electron .
```

Lädt den Katalog, installiert das erste Spiel, startet es unsichtbar und prüft, ob es läuft.
