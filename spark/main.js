// SPARK – Spiele-Launcher
// Lädt den Spiele-Katalog, installiert und aktualisiert Spiele (nur geänderte Dateien, mit Prüfsumme)
// und startet sie in eigenen Fenstern. Installierte Spiele laufen auch ohne Internet.
const { app, BrowserWindow, Menu, shell, ipcMain, net } = require('electron');
const path = require('path'), fs = require('fs'), crypto = require('crypto'), { pathToFileURL } = require('url');

const CATALOG_URL = process.env.SPARK_CATALOG || 'https://mrzock.github.io/nachtwache/spark/catalog/games.json';
Menu.setApplicationMenu(null);
if (process.env.SPARK_DATA) app.setPath('userData', process.env.SPARK_DATA);   // für Tests
if (!app.requestSingleInstanceLock() && !process.env.SPARK_SELFTEST) app.quit();

// ---------- Ablage: %APPDATA%/SPARK/Spiele/<id>, installiert.json, Katalog- und Cover-Cache
const dataDir = () => app.getPath('userData');
const gamesDir = () => process.env.SPARK_GAMES || path.join(dataDir(), 'Spiele');
const stateFile = () => path.join(dataDir(), 'installiert.json');
const cacheFile = () => path.join(dataDir(), 'katalog.json');
const coverDir = () => path.join(dataDir(), 'Cover');
function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } }
function writeJson(f, o) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.neu', JSON.stringify(o, null, 1)); fs.renameSync(f + '.neu', f); }
let state = null;
const st = () => state || (state = readJson(stateFile(), {}));
const saveState = () => writeJson(stateFile(), st());
const okId = id => typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id);
const okFile = f => typeof f === 'string' && /^[A-Za-z0-9_\-./]{1,160}$/.test(f) && !f.split('/').some(p => p === '..' || p === '.' || p === '');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const isWeb = u => /^https?:\/\//i.test(u);
const resolve = (base, rel) => isWeb(base) ? new URL(rel, base).href : path.join(base, rel);

// ---------- Netz (über Electron, nutzt Proxy-Einstellungen von Windows)
function timeout(p, ms, what) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ': keine Antwort')), ms))]); }
async function getBuf(url) {
  if (!isWeb(url)) return fs.readFileSync(url);
  const r = await timeout(net.fetch(url, { cache: 'no-store' }), 60000, url);
  if (!r.ok) throw new Error('Download fehlgeschlagen (' + r.status + '): ' + url.split('/').pop());
  return Buffer.from(await r.arrayBuffer());
}

// ---------- Katalog
let catalog = { games: [] }, offline = true, loading = true;
function cleanCatalog(c) {
  if (!c || !Array.isArray(c.games)) throw new Error('Katalog ist ungültig');
  c.games = c.games.filter(g => okId(g.id) && typeof g.name === 'string' && Array.isArray(g.files) && g.files.length && g.files.every(f => okFile(f.path))
    && okFile(g.entry || 'index.html') && (isWeb(g.base) || !!process.env.SPARK_CATALOG));
  return c;
}
async function loadCatalog() {
  try {
    const c = cleanCatalog(JSON.parse((await timeout(getBuf(CATALOG_URL), 12000, 'Katalog')).toString('utf8')));
    catalog = c; offline = false; writeJson(cacheFile(), c);
    await Promise.all(c.games.map(g => cacheCover(g).catch(() => {})));
  } catch (e) {
    console.log('Katalog offline:', e.message);
    catalog = readJson(cacheFile(), { games: [] }); offline = true;
  }
  loading = false;
}
async function cacheCover(g) {
  if (!g.cover || !okFile(g.cover)) return;
  const f = path.join(coverDir(), g.id + path.extname(g.cover)), meta = st()['cover:' + g.id];
  if (fs.existsSync(f) && meta === g.cover + g.version) return;
  const buf = await getBuf(resolve(isWeb(CATALOG_URL) ? CATALOG_URL : path.dirname(CATALOG_URL), g.cover));
  fs.mkdirSync(coverDir(), { recursive: true }); fs.writeFileSync(f, buf);
  st()['cover:' + g.id] = g.cover + g.version; saveState();
}
// Zustand eines Spiels für die Oberfläche
function view(g) {
  const inst = st()[g.id], dir = path.join(gamesDir(), g.id);
  const installed = !!inst && fs.existsSync(path.join(dir, g.entry || 'index.html'));
  const update = installed && !!inst.files && g.files.some(f => inst.files[f.path] !== f.sha256);
  const cover = g.cover && path.join(coverDir(), g.id + path.extname(g.cover));
  return Object.assign({}, g, { files: undefined, installed, update, playing: running.has(g.id), busy: busy.has(g.id),
    installedVersion: inst && inst.version, playMs: (inst && inst.playMs) || 0, lastPlayed: inst && inst.lastPlayed,
    coverUrl: cover && fs.existsSync(cover) ? pathToFileURL(cover).href + '?v=' + encodeURIComponent(g.version) : '' });
}
const findGame = id => catalog.games.find(g => g.id === id);

// ---------- Installieren / Aktualisieren: in einen Zwischenordner laden, prüfen, dann austauschen
const busy = new Set();
async function install(id) {
  const g = findGame(id);
  if (!g) return { ok: false, error: 'Spiel nicht im Katalog' };
  if (busy.has(id)) return { ok: false, error: 'Läuft schon' };
  if (running.has(id)) return { ok: false, error: 'Bitte zuerst das Spiel schließen' };
  busy.add(id); changed();
  const dir = path.join(gamesDir(), id), tmp = dir + '.neu';
  try {
    fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
    const total = g.files.reduce((s, f) => s + (f.size || 0), 0) || 1, hashes = {};
    let done = 0, loaded = 0;
    for (const f of g.files) {
      const have = path.join(dir, f.path), dst = path.join(tmp, f.path);
      let buf = null;
      if (fs.existsSync(have)) { const b = fs.readFileSync(have); if (sha(b) === f.sha256) buf = b; }   // unverändert → behalten
      if (!buf) {
        buf = await getBuf(resolve(g.base, f.path)); loaded += buf.length;
        if (f.sha256 && sha(buf) !== f.sha256) throw new Error('Datei fehlerhaft heruntergeladen: ' + f.path + ' – bitte nochmal versuchen');
      }
      fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, buf);
      hashes[f.path] = sha(buf); done += f.size || buf.length;
      send('progress', { id, p: Math.min(1, done / total), file: f.path });
    }
    fs.rmSync(dir, { recursive: true, force: true }); fs.renameSync(tmp, dir);
    st()[id] = Object.assign(st()[id] || {}, { version: g.version, files: hashes, installedAt: Date.now(), size: total }); saveState();
    return { ok: true, loaded };
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return { ok: false, error: e.message };
  } finally { busy.delete(id); changed(); }
}
function uninstall(id) {
  if (!okId(id) || running.has(id) || busy.has(id)) return { ok: false, error: 'Geht gerade nicht' };
  fs.rmSync(path.join(gamesDir(), id), { recursive: true, force: true });
  const s = st()[id]; if (s) { delete s.files; delete s.version; } saveState(); changed();
  return { ok: true };
}

// ---------- Spielen: eigenes Fenster, Spielstände in Dokumente/<saveDir>
const running = new Map();
let launcher = null;
function play(id) {
  const g = findGame(id), inst = st()[id];
  if (!g || !inst || !inst.files) return { ok: false, error: 'Nicht installiert' };
  if (running.has(id)) { running.get(id).focus(); return { ok: true }; }
  const entry = path.join(gamesDir(), id, g.entry || 'index.html');
  if (!fs.existsSync(entry)) return { ok: false, error: 'Spieldateien fehlen – bitte neu installieren' };
  const saveName = String(g.saveDir || g.name).replace(/[^\w \-]/g, '').slice(0, 40) || id;
  const w = new BrowserWindow({
    width: 1280, height: 800, minWidth: 800, minHeight: 500, fullscreen: !process.env.SPARK_SELFTEST, show: !process.env.SPARK_SELFTEST,
    backgroundColor: '#000000', title: g.name, icon: path.join(__dirname, 'build', 'icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'game-preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
      additionalArguments: ['--spark-save=' + saveName] },
  });
  const q = {}; for (const [k, v] of new URLSearchParams(g.query || '')) q[k] = v; q.spark = '1';
  w.loadFile(entry, { query: q });
  w.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) { w.setFullScreen(!w.isFullScreen()); e.preventDefault(); }
    if (input.key === 'F12') w.webContents.toggleDevTools();
  });
  w.webContents.setWindowOpenHandler(({ url }) => { if (isWeb(url)) shell.openExternal(url); return { action: 'deny' }; });
  w.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) { e.preventDefault(); if (isWeb(url)) shell.openExternal(url); } });
  const t0 = Date.now();
  running.set(id, w);
  w.on('closed', () => {
    running.delete(id);
    const s = st()[id]; if (s) { s.playMs = (s.playMs || 0) + (Date.now() - t0); s.lastPlayed = Date.now(); saveState(); }
    if (launcher && !launcher.isDestroyed()) { launcher.show(); launcher.focus(); }
    changed();
  });
  if (launcher && !process.env.SPARK_SELFTEST) launcher.hide();
  changed();
  return { ok: true, window: w };
}

// Spielstände der Spiele (gleiche Schnittstelle wie die BLACKOUT-Windows-App → gleiche Dateien)
const saveDirOf = name => path.join(app.getPath('documents'), String(name).replace(/[^\w \-]/g, '') || 'SPARK');
const saveFile = (name, k) => path.join(saveDirOf(name), 'Spielstand ' + (Math.max(0, Math.min(9, k | 0)) + 1) + '.txt');
ipcMain.on('game-save', (e, name, op, k, data) => {
  try {
    if (op === 'dir') e.returnValue = saveDirOf(name);
    else if (op === 'read') e.returnValue = fs.existsSync(saveFile(name, k)) ? fs.readFileSync(saveFile(name, k), 'utf8') : null;
    else if (op === 'write') { fs.mkdirSync(saveDirOf(name), { recursive: true }); const f = saveFile(name, k); fs.writeFileSync(f + '.neu', data, 'utf8'); fs.renameSync(f + '.neu', f); e.returnValue = true; }
    else if (op === 'del') { const f = saveFile(name, k); if (fs.existsSync(f)) fs.renameSync(f, f + '.alt'); e.returnValue = true; }
    else e.returnValue = null;
  } catch (err) { e.returnValue = op === 'write' ? false : null; }
});

// ---------- Verbindung zur Oberfläche
function send(ch, data) { if (launcher && !launcher.isDestroyed()) launcher.webContents.send(ch, data); }
function changed() { send('changed'); }
ipcMain.handle('state', () => ({ games: catalog.games.map(view), offline, loading, version: app.getVersion(), gamesDir: gamesDir() }));
ipcMain.handle('refresh', async () => { await loadCatalog(); return true; });
ipcMain.handle('install', (e, id) => install(String(id)));
ipcMain.handle('uninstall', (e, id) => uninstall(String(id)));
ipcMain.handle('play', (e, id) => { const r = play(String(id)); return { ok: r.ok, error: r.error }; });
ipcMain.handle('folder', (e, id) => { const d = okId(id) ? path.join(gamesDir(), id) : gamesDir(); fs.mkdirSync(d, { recursive: true }); shell.openPath(d); });
ipcMain.handle('saves', (e, id) => { const g = findGame(String(id)); if (g) { const d = saveDirOf(g.saveDir || g.name); fs.mkdirSync(d, { recursive: true }); shell.openPath(d); } });

function createLauncher() {
  launcher = new BrowserWindow({
    width: 1180, height: 720, minWidth: 860, minHeight: 540, show: false, backgroundColor: '#0b0d12', title: 'SPARK',
    icon: path.join(__dirname, 'build', 'icon.png'), titleBarStyle: 'hidden', titleBarOverlay: { color: '#0b0d12', symbolColor: '#c8c8d0', height: 38 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  launcher.loadFile(path.join(__dirname, 'ui', 'index.html'));
  launcher.once('ready-to-show', () => { if (!process.env.SPARK_SELFTEST) launcher.show(); });
  launcher.webContents.setWindowOpenHandler(({ url }) => { if (isWeb(url)) shell.openExternal(url); return { action: 'deny' }; });
  launcher.on('closed', () => { launcher = null; for (const w of running.values()) w.close(); });
}
app.on('second-instance', () => { if (launcher) { launcher.show(); launcher.focus(); } });

// Selbsttest ohne sichtbare Fenster: SPARK_SELFTEST=1 → Katalog laden, BLACKOUT installieren, starten, prüfen, beenden
async function selftest() {
  const out = {};
  try {
    await loadCatalog(); createLauncher();
    out.offline = offline; out.games = catalog.games.map(g => g.id);
    const g = catalog.games[0];
    const r1 = await install(g.id); out.install = r1.ok ? Math.round(r1.loaded / 1024) + ' KB geladen' : r1.error;
    const r2 = await install(g.id); out.reinstall = r2.ok ? r2.loaded + ' Bytes geladen (nichts geändert)' : r2.error;
    out.update = view(g).update;
    const p = play(g.id); out.play = p.ok;
    await new Promise(res => p.window.webContents.once('did-finish-load', res));
    await new Promise(res => setTimeout(res, 2500));
    out.game = await p.window.webContents.executeJavaScript('JSON.stringify({ nw: !!window.NW, mode: window.NW && NW.mode, desktop: !!window.BLACKOUT_DESKTOP, save: !!window.BLACKOUT_SAVE && window.BLACKOUT_SAVE.dir, r3: !!window.NW3D })');
    out.ui = await launcher.webContents.executeJavaScript('document.querySelectorAll(".game").length + " Spiel(e) in der Liste"');
  } catch (e) { out.error = e.message; }
  console.log('SPARK-SELBSTTEST', JSON.stringify(out));
  app.exit(0);
}
app.whenReady().then(async () => {
  if (process.env.SPARK_SELFTEST) return selftest();
  catalog = readJson(cacheFile(), { games: [] });   // sofort die bekannten Spiele zeigen, dann aktualisieren
  createLauncher();
  await loadCatalog(); changed();
});
app.on('window-all-closed', () => app.quit());
