// BLACKOUT als Windows-App: öffnet das Spiel in einem eigenen Fenster (Vollbild, ohne Browser-Leisten)
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

Menu.setApplicationMenu(null);

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
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
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
    w.loadFile(path.join(__dirname, 'app', 'index.html'));
    w.webContents.on('did-finish-load', () => setTimeout(async () => {
      const r = await w.webContents.executeJavaScript('JSON.stringify({ ok: !!window.NW, mode: window.NW && NW.mode, desktop: !!window.BLACKOUT_DESKTOP, r3: !!window.NW3D })').catch(e => 'Fehler: ' + e.message);
      console.log('SELBSTTEST', r); app.quit();
    }, 2500));
  });
} else app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
