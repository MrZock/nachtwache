# BLACKOUT – 3D Survival Game (Version 3.0)

*Die Welt ist dunkel. Dein Reaktor ist das letzte Licht.*

Browser-Spiel in einer kaputten, rostigen Zukunft: Tagsüber Holz, Stein und Gold sammeln und eine Basis um deinen **Reaktor** bauen, nachts Zombiewellen abwehren. Allein oder mit bis zu **16 Spielern** online – jeder baut seine **eigene Basis**, Clans teilen sich eine. (Früher hieß das Spiel „Nachtwache“.)

## Spielen

- **Spielen:** https://mrzock.github.io/nachtwache/ (der alte Link `/3d.html` geht weiterhin)
- **Bauen:** Taste **I** (Handy: 🛠) öffnet „Inventar & Bauen“ mit allen Gebäuden, Rohstoffen und Werkzeugen. In der Leiste liegen nur die letzten 4 Gebäude.
- **Online:** einer klickt „Online hosten“ und bekommt einen **Raum-Code**, bis zu 15 andere klicken „Online beitreten“ und geben den Code ein. Der Spielserver läuft auf Render.com (nachtwache.onrender.com) und wacht von selbst auf.

**Steuerung (PC):** WASD laufen · **Maus umsehen** (Third-Person-Kamera hinter der Schulter; Linksklick fängt die Maus, oder rechte Maustaste halten) · Linksklick angreifen/abbauen · **O / F5 = Ego-Perspektive ↔ Third-Person** · Mausrad Kamera-Abstand · Q/E/R/C/V/B Waffen · H Schmiede · K Skills · **Leertaste Springen** · **Shift Spezialfähigkeit** · 1–0, F, J bauen · U Upgrade · X Verkaufen · T Chat · Y Markierung · I Inventar · **L Medkit · G Granate · Z Molotow** · M Karte · **Tab Spielerliste** · ESC Menü · N Ton

**Handy:** im Querformat spielen. **Zwei Joysticks:** links laufen, rechts zielen & angreifen (kurz antippen = automatisch auf den nächsten Zombie). Knöpfe am Rand: ⤒ Springen, Menü, Karte, Skills, Schmiede, ⚡ Fähigkeit, 🔄 Kamera drehen, ⛶ Vollbild, Chat, Markierung. Vollbild auch mit `/full` im Chat.



## SPARK – unser Spiele-Launcher

**[⚡ SPARK herunterladen](https://github.com/MrZock/nachtwache/releases/download/spark-v1.0.0/SPARK-Setup-1.0.0.exe)** (Windows-Installer)

Im Ordner [`spark/`](spark/README.md) liegt **SPARK**, eine Windows-App zum Installieren, Aktualisieren und Starten unserer Spiele (BLACKOUT ist das erste). Neue Spiele und Updates kommen über den Katalog `spark/catalog/games.json`. **Nach jeder Änderung an BLACKOUT:** `cd spark && npm run catalog` und mit committen.

## Windows-Version

Im Ordner `desktop/` liegt eine richtige Windows-App (Electron) mit denselben Spieldateien wie die Web-Version:

- Vollbild ohne Browser-Leisten (F11 oder Alt+Enter schaltet um), eigener „Beenden“-Knopf im Menü
- Online-Modus läuft über denselben Server wie die Web-Version – Web- und Windows-Spieler können zusammen spielen
- Mit Internet lädt die App immer die aktuelle Web-Version (gleicher Stand für alle, Updates ohne Neuinstallation); ohne Internet startet die mitgelieferte Version
- Einladungslinks aus der App zeigen auf die Web-Version; beim Beitreten wird die Spielversion geprüft (`NET_VER` in `game.js`)
- Spielstände als Dateien in `Dokumente/BLACKOUT` (ab App-Version 4.0.0; ältere Apps speichern im App-Speicher)

