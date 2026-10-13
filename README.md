# BLACKOUT – 3D Survival Game (Version 3.0)

*Die Welt ist dunkel. Dein Reaktor ist das letzte Licht.*

Browser-Spiel in einer kaputten, rostigen Zukunft: Tagsüber Holz, Stein und Gold sammeln und eine Basis um deinen **Reaktor** bauen, nachts Zombiewellen abwehren. Allein oder mit bis zu **16 Spielern** online – jeder baut seine **eigene Basis**, Clans teilen sich eine. (Früher hieß das Spiel „Nachtwache“.)

## Spielen

- **Spielen:** https://mrzock.github.io/nachtwache/ (der alte Link `/3d.html` geht weiterhin)
- **Bauen:** Taste **I** (Handy: 🛠) öffnet „Inventar & Bauen“ mit allen Gebäuden, Rohstoffen und Werkzeugen. In der Leiste liegen nur die letzten 4 Gebäude.
- **Online:** einer klickt „Online hosten“ und bekommt einen **Raum-Code**, bis zu 15 andere klicken „Online beitreten“ und geben den Code ein. Der Spielserver läuft auf Render.com (nachtwache.onrender.com) und wacht von selbst auf.

**Steuerung (PC):** WASD laufen · Maus zielen · Linksklick angreifen/abbauen · **rechte Maustaste ziehen bzw. `,` `.` = Kamera 360° drehen** · **O / F5 = Ego-Perspektive** (Linksklick fängt die Maus, oder rechte Maustaste halten zum Umsehen) · Mausrad Zoom · Q/E/R/C/V/B Waffen · H Schmiede · K Skills · **Leertaste Springen** · **Shift Spezialfähigkeit** · 1–0, F, J bauen · U Upgrade · X Verkaufen · T Chat · G Markierung · M Karte · **Tab Spielerliste** · ESC Menü · N Ton

**Handy:** im Querformat spielen. **Zwei Joysticks:** links laufen, rechts zielen & angreifen (kurz antippen = automatisch auf den nächsten Zombie). Knöpfe am Rand: ⤒ Springen, Menü, Karte, Skills, Schmiede, ⚡ Fähigkeit, 🔄 Kamera drehen, ⛶ Vollbild, Chat, Markierung. Vollbild auch mit `/full` im Chat.

## Neu in 3.0

- **Eigene Basen:** Jeder Spieler startet weit weg von den anderen auf einer **riesigen Karte (512×512)** und baut seinen eigenen Reaktor mit eigenen Rohstoffen. Im **Clan** teilt ihr Reaktor, Rohstoffe und Gebäude (beim Beitreten wird deine alte Basis zerlegt, die Rohstoffe gehen an den Clan). Fällt eine Basis, kann das Team neu anfangen – das Spiel endet erst, wenn kein Reaktor mehr steht. `/heim` bringt dich zurück zu deiner Basis.
- **Ego-Perspektive** (O / F5, Handy 👁) zusätzlich zur normalen Ansicht.
- **Icons aus den echten 3D-Modellen** in der Leiste.

- **Neuer Name & Look:** BLACKOUT mit Rost-Logo, neues Hauptmenü, alles im Stil einer kaputten Zukunft: Reaktor statt Goldspeicher, Schrott-Barrikaden, Geschütz-, Tesla-, Mörser- und Kryotürme, Bohrturm, Recycler, Sanistation, Autowracks, Fässer, Ruinen und kaputte Laternen.
- **Neue 3D-Modelle** für alles: Gebäude (jede Stufe sieht anders aus), Zombies mit Laufanimation, Spieler mit Ausrüstung, Waffen, Leuchteffekte bei Nacht.
- **Riesige Karte (320×320)** mit **Biomen:** Wiese, Wüste (Kakteen, viel Gold), Schneeland (Schnee statt Regen), Sumpf (bremst) – und **Gebirge** rund um die Welt und mitten drin.
- **Andere Dimension:** Ein **Portal** taucht in der Nähe des Reaktors auf und führt ins **Schattenreich** – dunkel, lila, voller Schattenkristalle (viel Gold & XP) und gefährlicher Schattenwesen.
- **Bis zu 16 Spieler**, **Clans** und Team-Chat:
  - `/clan gründen <Name>` · `/clan einladen <Spieler>` · `/clan beitreten <Name>` · `/clan offen` · `/clan kick <Spieler>` · `/clan verlassen` · `/clan info`
  - `/team <Text>` – nur dein Clan sieht die Nachricht · `/w <Name> <Text>` – flüstern · `/spieler`
  - Clan-Bonus: +10 % Schaden in der Nähe von Clan-Mitgliedern.
- **Springen** (Leertaste / ⤒): in der Luft trifft dich nichts, und du kannst über eigene Mauern springen.
- **Berge besteigen:** Spieler können auf die Berge laufen (langsamer), Zombies kommen nicht hoch.
- **Schrott → Eisen:** Autowracks und Fässer mit der Spitzhacke abbauen. Eisen brauchst du für Upgrades ab Stufe 3, für Werkzeug-Upgrades und den Plasmawerfer.
- **Spezialfähigkeiten** ab Level 5 (Shift / ⚡): Wirbelsturm, Sturmangriff, Heilwelle, Kriegsschrei. Skills für 100 Gold zurücksetzen.
- **Baubereich wächst** mit jeder Reaktor-Stufe (16 → 32 Felder).
- Neue Gegner: **Schamane** (heilt Zombies), **Panzerzombie** (45 % Rüstung), seltener **Goldzombie**, Schattenwesen.
- **Wetter:** Regen, Gewitter mit Blitzen, die Zombies treffen.
- **7 versteckte Easter Eggs** 🥚 – viel Spaß beim Suchen!

**Level & Skills:** XP für Kills, Abbauen, Bauen, Truhen und überlebte Nächte. Skillpunkte für Stärke, Schütze, Sammler, Ausdauer, Flinkheit, Plünderer, Präzision, Rüstung und Lebensraub (je 5 Stufen, Menü mit K).

**Schmiede (H):** Speer, Streitaxt und Plasmawerfer freischalten, alle Waffen bis Stufe 5 aufwerten. Höchststufe = Reaktor-Stufe + 1.

**Chat-Befehle:** `/hilfe` zeigt alles · `/afk` · `/full` (Vollbild) · Clan-Befehle siehe oben.

## Windows-Version

Im Ordner `desktop/` liegt eine richtige Windows-App (Electron) mit denselben Spieldateien wie die Web-Version:

- Vollbild ohne Browser-Leisten (F11 oder Alt+Enter schaltet um), eigener „Beenden“-Knopf im Menü
- Online-Modus läuft über denselben Server wie die Web-Version – Web- und Windows-Spieler können zusammen spielen

Selbst bauen (Node.js nötig):

```
cd desktop
npm install
npm run build
```

Danach liegen in `desktop/dist/`:
- `BLACKOUT-Setup-3.0.0.exe` – Installer mit Desktop- und Startmenü-Verknüpfung
- `BLACKOUT-3.0.0-portable.exe` – startet direkt ohne Installation

Zum Ausprobieren ohne Bauen: `npm start` im Ordner `desktop`.

## Aufbau

| Datei | Zweck |
|---|---|
| `index.html` | Klassische 2D-Version |
| `3d.html` | Version 2.0 in 3D (three.js) |
| `game.js` | Spiellogik, Netzwerk, HUD – von beiden Versionen genutzt |
| `render3d.js` | 3D-Grafik der Version 2.0 |
| `three.min.js` | 3D-Bibliothek three.js r158 (MIT-Lizenz) |
| `style.css` | Stile für Chat & Lobby |
| `server.js` | Spielserver: liefert das Spiel aus und leitet die Daten zwischen zwei Spielern weiter (WebSocket, Räume mit 4-stelligem Code). Reines Node.js, keine Pakete. |
| `render.yaml` | Konfiguration für den kostenlosen Server auf [Render.com](https://render.com) |
| `start-server.bat` | Startet den Server lokal (Heimnetz) |

## Online-Modus einrichten

1. **GitHub Pages** (Spiel-Seite): Repository → *Settings* → *Pages* → *Deploy from a branch* → `main` / `/ (root)`.
2. **Render** (Spielserver): Auf render.com mit GitHub anmelden → *New* → *Blueprint* → dieses Repository wählen → *Apply*. Render zeigt danach eine Adresse wie `https://nachtwache-xxxx.onrender.com`.
3. Diese Adresse in `game.js` bei `const RELAY_URL` eintragen (aktuell `'nachtwache.onrender.com'`) und hochladen.

Hinweis: Der kostenlose Render-Server schläft nach 15 Minuten ohne Spieler ein. Beim nächsten Verbinden dauert das Aufwachen bis zu einer Minute – das Spiel versucht es automatisch weiter.

Im Heimnetz geht es auch ohne Internet-Server: `start-server.bat` starten, `http://localhost:8080` öffnen.
