// BLACKOUT als Windows-App: öffnet das Spiel in einem eigenen Fenster (Vollbild, ohne Browser-Leisten)
const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

Menu.setApplicationMenu(null);

// Spielstände: Dokumente/BLACKOUT/Spielstand 1.txt … 3.txt (gleich für Online- und Offline-Version)
const saveDir = () => process.env.BLACKOUT_SAVEDIR || path.join(app.getPath('documents'), 'BLACKOUT');
const saveFile = k => path.join(saveDir(), 'Spielstand ' + (Math.max(0, Math.min(2, k | 0)) + 1) + '.txt');
ipcMain.on('save', (e, op, k, data) => {
  try {
    if (op === 'dir') e.returnValue = saveDir();
    else if (op === 'read') e.returnValue = fs.existsSync(saveFile(k)) ? fs.readFileSync(saveFile(k), 'utf8') : null;
    else if (op === 'write') {
      fs.mkdirSync(saveDir(), { recursive: true });
      const f = saveFile(k), tmp = f + '.neu';
      fs.writeFileSync(tmp, data, 'utf8'); fs.renameSync(tmp, f);   // erst fertig schreiben, dann ersetzen
      e.returnValue = true;
    } else if (op === 'del') { if (fs.existsSync(saveFile(k))) fs.renameSync(saveFile(k), saveFile(k) + '.alt'); e.returnValue = true; }
    else e.returnValue = null;
  } catch (err) { console.log('Spielstand-Fehler:', err.message); e.returnValue = op === 'write' ? false : null; }
});

// Mit Internet immer die aktuelle Web-Version laden (gleicher Stand wie im Browser → Web- und PC-Spieler können
// zusammen spielen). Ohne Internet die mitgelieferte Version.
const WEB_URL = 'https://mrzock.github.io/nachtwache/';
const LOCAL = () => path.join(__dirname, 'app', 'index.html');
async function loadGame(win) {
  try {
    await win.webContents.session.clearCache();
    await Promise.race([win.loadURL(WEB_URL + '?app=1'), new Promise((_, rej) => setTimeout(() => rej(new Error('Zeitüberschreitung')), 8000))]);
  } catch (e) {
    console.log('Offline – starte mitgelieferte Version:', e.message);
    win.loadFile(LOCAL());
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 500,
    fullscreen: true,
    backgroundColor: '#120d0a',
    title: 'BLACKOUT',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  loadGame(win);
  // F11 oder Alt+Enter: Vollbild an/aus · F12: Entwicklerwerkzeuge
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F12') win.webContents.toggleDevTools();
  });
  // Links (z. B. Einladungslinks) im normalen Browser öffnen
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

// Selbsttest ohne sichtbares Fenster: BLACKOUT_SELFTEST=1 → prüft, ob das Spiel lädt, und beendet sich
if (process.env.BLACKOUT_SELFTEST) {
  app.whenReady().then(() => {
    const w = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
    if (process.env.BLACKOUT_SELFTEST === 'offline') w.loadFile(LOCAL()); else loadGame(w);
    w.webContents.once('did-finish-load', () => setTimeout(async () => {
      // Spielstand-Dateien: schreiben, lesen, löschen (nur mit BLACKOUT_SAVEDIR, damit der Test nichts in „Dokumente“ anlegt)
      const saveJs = process.env.BLACKOUT_SAVEDIR
        ? '(() => { const B = window.BLACKOUT_SAVE, t = "info\\n{}"; if (!B || !B.write(2, t) || B.read(2) !== t) return false; B.del(2); return B.read(2) === null; })()'
        : '!!window.BLACKOUT_SAVE';
      const r = await w.webContents.executeJavaScript('JSON.stringify({ url: location.href, ok: !!window.NW, mode: window.NW && NW.mode, desktop: !!window.BLACKOUT_DESKTOP, r3: !!window.NW3D, save: ' + saveJs + ', dir: window.BLACKOUT_SAVE && window.BLACKOUT_SAVE.dir })').catch(e => 'Fehler: ' + e.message);
      console.log('SELBSTTEST', r); app.quit();
    }, 2500));
  });
} else app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
