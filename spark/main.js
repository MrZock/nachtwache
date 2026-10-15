// SPARK – Spiele-Launcher
// Lädt den Spiele-Katalog, installiert und aktualisiert Spiele (nur geänderte Dateien, mit Prüfsumme)
// und startet sie in eigenen Fenstern. Installierte Spiele laufen auch ohne Internet.
const { app, BrowserWindow, Menu, shell, ipcMain, net, safeStorage, session } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto'), { spawn } = require('child_process'), { pathToFileURL } = require('url');
const SPARK_REPO = 'MrZock/spark', SITE = 'https://mrzock.github.io/spark/';
const verName = v => 'Alpha ' + v;   // gleiches Schema wie die Spiele: Alpha 1.X.Y

const CATALOG_URL = process.env.SPARK_CATALOG || 'https://mrzock.github.io/nachtwache/spark/catalog/games.json';
Menu.setApplicationMenu(null);
app.setAppUserModelId('io.github.mrzock.spark');   // Windows-Benachrichtigungen (SPARK Chat)
if (process.env.SPARK_DATA) app.setPath('userData', process.env.SPARK_DATA);   // für Tests
if (!app.requestSingleInstanceLock() && !process.env.SPARK_SELFTEST) app.quit();

// ---------- Ablage: %APPDATA%/SPARK/Spiele/<id>, installiert.json, Katalog- und Cover-Cache
const dataDir = () => app.getPath('userData');
const gamesDir = () => process.env.SPARK_GAMES || path.join(dataDir(), 'Spiele');
const stateFile = () => path.join(dataDir(), 'installiert.json');
const cacheFile = () => path.join(dataDir(), 'katalog.json');
const coverDir = () => path.join(dataDir(), 'Cover');
const setFile = () => path.join(dataDir(), 'einstellungen.json');
const SET_DEF = { autoUpdate: true, hideOnPlay: true, gameFullscreen: true, effects: true };
let settings = null;
const set = () => settings || (settings = Object.assign({}, SET_DEF, readJson(setFile(), {})));
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
    const c = cleanCatalog(JSON.parse((await timeout(getBuf(CATALOG_URL), 45000, 'Katalog')).toString('utf8')));
    catalog = c; offline = false; writeJson(cacheFile(), c);
    await Promise.all(c.games.map(g => cacheCover(g).catch(() => {})));
  } catch (e) {
    console.log('Katalog offline:', e.message);
    catalog = readJson(cacheFile(), { games: [] }); offline = true;
  }
  loading = false;
}
// Titelbild und Symbol einmal laden und für offline aufheben
async function cacheCover(g) {
  for (const [key, file] of [['cover', g.cover], ['icon', g.icon]]) {
    if (!file || !okFile(file)) continue;
    const f = path.join(coverDir(), g.id + (key === 'icon' ? '-icon' : '') + path.extname(file)), meta = st()[key + ':' + g.id];
    if (fs.existsSync(f) && meta === file + g.version) continue;
    const buf = await getBuf(resolve(isWeb(CATALOG_URL) ? CATALOG_URL : path.dirname(CATALOG_URL), file));
    fs.mkdirSync(coverDir(), { recursive: true }); fs.writeFileSync(f, buf);
    st()[key + ':' + g.id] = file + g.version; saveState();
  }
}
// Zustand eines Spiels für die Oberfläche
function view(g) {
  const inst = st()[g.id], dir = path.join(gamesDir(), g.id);
  const installed = !!inst && fs.existsSync(path.join(dir, g.entry || 'index.html'));
  const update = installed && !!inst.files && g.files.some(f => inst.files[f.path] !== f.sha256);
  const cover = g.cover && path.join(coverDir(), g.id + path.extname(g.cover)), icon = g.icon && path.join(coverDir(), g.id + '-icon' + path.extname(g.icon));
  return Object.assign({}, g, { files: undefined, installed, update, playing: running.has(g.id), busy: busy.has(g.id),
    installedVersion: inst && inst.version, playMs: (inst && inst.playMs) || 0, lastPlayed: inst && inst.lastPlayed,
    coverUrl: cover && fs.existsSync(cover) ? pathToFileURL(cover).href + '?v=' + encodeURIComponent(g.version) : '',
    iconUrl: icon && fs.existsSync(icon) ? pathToFileURL(icon).href + '?v=' + encodeURIComponent(g.version) : '' });
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
const rooms = new Map();   // laufende Spiele melden ihren Online-Raum (für Einladungen aus SPARK Chat)
function play(id, extra) {
  const g = findGame(id), inst = st()[id];
  if (!g || !inst || !inst.files) return { ok: false, error: (g ? g.name : 'Das Spiel') + ' ist nicht installiert – installiere es im SPARK-Launcher.' };
  if (running.has(id)) { const rw = running.get(id); if (rw.isMinimized()) rw.restore(); rw.show(); rw.focus(); return { ok: true, running: true }; }
  const isApp = g.type === 'app';
  const entry = path.join(gamesDir(), id, g.entry || 'index.html');
  if (!fs.existsSync(entry)) return { ok: false, error: 'Spieldateien fehlen – bitte neu installieren' };
  const saveName = String(g.saveDir || g.name).replace(/[^\w \-]/g, '').slice(0, 40) || id;
  const w = new BrowserWindow({
    width: isApp ? 1100 : 1280, height: isApp ? 720 : 800, minWidth: isApp ? 380 : 800, minHeight: 500, fullscreen: !isApp && !process.env.SPARK_SELFTEST && set().gameFullscreen, show: !process.env.SPARK_SELFTEST,
    backgroundColor: isApp ? '#05060b' : '#000000', title: g.name, icon: path.join(__dirname, 'build', 'icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'game-preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: isApp,
      additionalArguments: ['--spark-save=' + saveName, '--spark-id=' + id] },
  });
  const q = {}; for (const [k, v] of new URLSearchParams(g.query || '')) q[k] = v; q.spark = '1';
  if (extra && /^[A-Z0-9]{3,8}$/.test(extra.join || '')) q.join = extra.join;   // Einladung: direkt dem Raum beitreten
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
    running.delete(id); rooms.delete(id);
    const s = st()[id]; if (s) { s.playMs = (s.playMs || 0) + (Date.now() - t0); s.lastPlayed = Date.now(); saveState(); }
    if (!isApp && launcher && !launcher.isDestroyed()) { launcher.show(); launcher.focus(); }
    changed();
  });
  if (!isApp && launcher && !process.env.SPARK_SELFTEST && set().hideOnPlay) launcher.hide();
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

// ---------- Schnittstelle für Spiele und Apps (SPARK Chat): Spiele starten, Online-Räume, sichere Ablage
const callerId = e => { for (const [id, w] of running) if (!w.isDestroyed() && w.webContents === e.sender) return id; return null; };
ipcMain.handle('spark-launch', (e, id, q) => {
  if (!callerId(e) || !okId(id) || !findGame(id)) return { ok: false, error: 'Unbekanntes Spiel' };
  const r = play(id, q && typeof q === 'object' ? { join: String(q.join || '').toUpperCase() } : null);
  return { ok: r.ok, error: r.error, running: !!r.running };
});
ipcMain.handle('spark-running', e => callerId(e) ? [...running.keys()] : []);
ipcMain.handle('spark-rooms', e => callerId(e) ? Object.fromEntries(rooms) : {});
ipcMain.on('spark-presence', (e, p) => {
  const id = callerId(e); if (!id) return;
  if (p && /^[A-Z0-9]{3,8}$/.test(p.room || '')) rooms.set(id, { room: p.room, role: p.role === 'host' ? 'host' : 'client', t: Date.now() }); else rooms.delete(id);
});
// Tresor: von Windows verschlüsselt (DPAPI über safeStorage), getrennt pro Spiel/App – nie im Klartext
const vaultFile = () => path.join(dataDir(), 'tresor.json');
ipcMain.handle('spark-vault', (e, op, key, val) => {
  const id = callerId(e); if (!id || typeof key !== 'string' || !/^[\w.-]{1,40}$/.test(key)) return null;
  const v = readJson(vaultFile(), {}), k = id + ':' + key;
  if (op === 'get') { try { return v[k] && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v[k], 'base64')) : null; } catch (err) { return null; } }
  if (op === 'set') { if (!safeStorage.isEncryptionAvailable() || typeof val !== 'string' || val.length > 8000) return false; v[k] = safeStorage.encryptString(val).toString('base64'); writeJson(vaultFile(), v); return true; }
  if (op === 'del') { delete v[k]; writeJson(vaultFile(), v); return true; }
  return null;
});

// ---------- Launcher-Updates: neueste Version aus den GitHub-Releases von MrZock/spark
const vnum = v => String(v).replace(/^[^\d]*/, '').split('.').map(n => parseInt(n, 10) || 0);
const newer = (a, b) => { const x = vnum(a), y = vnum(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
const curVer = () => process.env.SPARK_TEST_VERSION || app.getVersion();   // Testmodus: ältere Version vortäuschen
const portableExe = () => process.env.PORTABLE_EXECUTABLE_FILE || '';
let upd = { checked: 0, latest: null, asset: null, error: '', busy: false, p: 0, notes: '', changes: [] };
async function checkUpdate() {
  upd.error = '';
  try {
    const r = await timeout(net.fetch('https://api.github.com/repos/' + SPARK_REPO + '/releases?per_page=15', { cache: 'no-store', headers: { 'User-Agent': 'SPARK-Launcher', Accept: 'application/vnd.github+json' } }), 30000, 'GitHub');
    if (!r.ok) throw new Error('GitHub antwortet nicht (' + r.status + ')');
    const list = await r.json();
    const rels = (Array.isArray(list) ? list : []).filter(x => !x.draft && !x.prerelease && /^v?\d/.test(x.tag_name)).sort((a, b) => newer(a.tag_name, b.tag_name) ? -1 : 1), rel = rels[0];
    // Changelog: alle Versionen, die neuer sind als die installierte (neueste zuerst)
    upd.changes = rels.filter(x => newer(x.tag_name, curVer())).slice(0, 10).map(x => ({ version: verName(x.tag_name.replace(/^v/, '')), date: x.published_at, body: String(x.body || '').slice(0, 3000) }));
    upd.checked = Date.now();
    if (!rel) { upd.latest = null; return publicUpd(); }
    const want = portableExe() ? /portable.*\.exe$/i : /setup.*\.exe$/i;
    upd.latest = rel.tag_name.replace(/^v/, ''); upd.notes = String(rel.body || '').slice(0, 600);
    upd.asset = rel.assets.find(a => want.test(a.name)) || null;
  } catch (e) { upd.error = e.message; }
  return publicUpd();
}
function publicUpd() {
  const cur = curVer(), avail = !!upd.latest && newer(upd.latest, cur);
  return { current: verName(cur), latest: upd.latest ? verName(upd.latest) : '', available: avail && !!upd.asset, checked: upd.checked, error: upd.error, busy: upd.busy, p: upd.p, portable: !!portableExe(), notes: upd.notes, changes: upd.changes };
}
// Herunterladen (mit Fortschritt), Größe prüfen, dann Installer still ausführen bzw. neue portable Version starten
async function runUpdate() {
  if (upd.busy) return { ok: false, error: 'Läuft schon' };
  if (!upd.asset || !newer(upd.latest, curVer())) { await checkUpdate(); if (!upd.asset || !newer(upd.latest, curVer())) return { ok: false, error: 'Du hast schon die neueste Version' }; }
  if (running.size || busy.size) return { ok: false, error: 'Bitte zuerst alle Spiele schließen und Downloads abwarten' };
  upd.busy = true; upd.p = 0;
  const a = upd.asset, dir = portableExe() ? path.dirname(portableExe()) : path.join(os.tmpdir(), 'SPARK-Update'), file = path.join(dir, a.name);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const r = await timeout(net.fetch(a.browser_download_url, { headers: { 'User-Agent': 'SPARK-Launcher' } }), 60000, 'Download');
    if (!r.ok || !r.body) throw new Error('Download fehlgeschlagen (' + r.status + ')');
    const out = fs.openSync(file + '.part', 'w'), rd = r.body.getReader();
    let got = 0, last = 0;
    for (;;) {
      const { done, value } = await rd.read(); if (done) break;
      fs.writeSync(out, Buffer.from(value)); got += value.length; upd.p = Math.min(1, got / (a.size || got));
      if (Date.now() - last > 120) { last = Date.now(); send('uprogress', publicUpd()); }
    }
    fs.closeSync(out);
    if (a.size && got !== a.size) throw new Error('Download unvollständig – bitte nochmal versuchen');
    fs.rmSync(file, { force: true }); fs.renameSync(file + '.part', file);
    upd.p = 1; send('uprogress', publicUpd());
    // Installer: still installieren (/S) und danach SPARK neu starten; Portable: neue Datei direkt starten
    if (process.env.SPARK_SELFTEST) { upd.busy = false; return { ok: true, file, size: got }; }   // Test: nicht installieren
    spawn(file, portableExe() ? [] : ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 600);
    return { ok: true };
  } catch (e) {
    try { fs.rmSync(file + '.part', { force: true }); } catch (e2) {}
    upd.busy = false; send('uprogress', publicUpd());
    return { ok: false, error: e.message };
  }
}

// ---------- Verbindung zur Oberfläche
function send(ch, data) { if (launcher && !launcher.isDestroyed()) launcher.webContents.send(ch, data); }
function changed() { send('changed'); }
ipcMain.handle('state', () => ({ games: catalog.games.map(view), offline, loading, version: verName(app.getVersion()), gamesDir: gamesDir(), settings: set(), update: publicUpd(), site: SITE }));
ipcMain.handle('set', (e, k, v) => { if (k in SET_DEF && typeof v === 'boolean') { set()[k] = v; writeJson(setFile(), set()); } return set(); });
ipcMain.handle('update-check', () => checkUpdate());
ipcMain.handle('update-run', () => runUpdate());
ipcMain.handle('open-web', (e, which) => shell.openExternal(which === 'github' ? 'https://github.com/' + SPARK_REPO + '/releases' : which === 'privacy' ? SITE + 'datenschutz.html' : SITE));
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
  launcher.on('closed', () => { launcher = null; for (const [id, w] of running) { const g = findGame(id); if (!g || g.type !== 'app') w.close(); } });
}
app.on('second-instance', () => { if (launcher) { launcher.show(); launcher.focus(); } });

// Selbsttest ohne sichtbare Fenster: SPARK_SELFTEST=1 → Katalog laden, BLACKOUT installieren, starten, prüfen, beenden
async function selftest() {
  const out = {};
  try {
    await loadCatalog(); createLauncher();
    out.offline = offline; out.games = catalog.games.map(g => g.id);
    const g = catalog.games[0];
    if (!g) throw new Error('Katalog leer/offline');
    const r1 = await install(g.id); out.install = r1.ok ? Math.round(r1.loaded / 1024) + ' KB geladen' : r1.error;
    const r2 = await install(g.id); out.reinstall = r2.ok ? r2.loaded + ' Bytes geladen (nichts geändert)' : r2.error;
    out.update = view(g).update;
    const p = play(g.id); out.play = p.ok;
    await new Promise(res => p.window.webContents.once('did-finish-load', res));
    await new Promise(res => setTimeout(res, 2500));
    out.game = await p.window.webContents.executeJavaScript('JSON.stringify({ nw: !!window.NW, mode: window.NW && NW.mode, desktop: !!window.BLACKOUT_DESKTOP, save: !!window.BLACKOUT_SAVE && window.BLACKOUT_SAVE.dir, r3: !!window.NW3D })');
    out.ui = await launcher.webContents.executeJavaScript('document.querySelectorAll(".game").length + " Spiel(e) in der Liste"');
    out.updateCheck = await checkUpdate();
    if (process.env.SPARK_TEST_UPDATE) { for (const w of running.values()) w.close(); await new Promise(r => setTimeout(r, 1000)); out.updateRun = await runUpdate(); }
    const chat = catalog.games.find(x => x.id === 'spark-chat');
    if (chat) {
      const r3 = await install(chat.id); out.chatInstall = r3.ok ? Math.round(r3.loaded / 1024) + ' KB' : r3.error;
      const pc = play(chat.id);
      if (pc.ok) {
        await new Promise(res => pc.window.webContents.once('did-finish-load', res));
        await new Promise(res => setTimeout(res, 1500));
        out.chat = await pc.window.webContents.executeJavaScript('(async () => { const s = window.SPARK; await s.vault.set("test", "geheim-123"); const back = await s.vault.get("test"); await s.vault.del("test"); return JSON.stringify({ api: !!(s.launch && s.rooms && s.running && s.vault), vault: back === "geheim-123", running: await s.running(), authUi: !!document.getElementById("authForm"), stayRow: !document.getElementById("stayRow").hidden, crypto: !!(window.crypto && crypto.subtle) && isSecureContext }); })()');
        out.chatFullscreen = pc.window.isFullScreen();
        const vaultRaw = fs.readFileSync(vaultFile(), 'utf8'); out.vaultPlain = vaultRaw.includes('geheim');
        out.launchJoin = await pc.window.webContents.executeJavaScript('window.SPARK.launch("blackout", { join: "AB12" }).then(r => JSON.stringify(r))');
        // Spiel schließen, dann über Einladung neu starten → BLACKOUT bekommt ?join=AB12
        running.get(g.id).close(); await new Promise(r => setTimeout(r, 800));
        await pc.window.webContents.executeJavaScript('window.SPARK.launch("blackout", { join: "AB12" })');
        const gw = running.get(g.id); await new Promise(res => gw.webContents.once('did-finish-load', res));
        out.joinQuery = await gw.webContents.executeJavaScript('location.search');
        await gw.webContents.executeJavaScript('window.SPARK.presence({ room: "AB12", role: "host" })');
        out.rooms = await pc.window.webContents.executeJavaScript('window.SPARK.rooms().then(r => JSON.stringify(r))');
      } else out.chat = pc.error;
    }
    out.settingsUi = await launcher.webContents.executeJavaScript('(document.getElementById("gear") ? "Zahnrad da" : "kein Zahnrad")');
  } catch (e) { out.error = e.message; }
  console.log('SPARK-SELBSTTEST', JSON.stringify(out));
  app.exit(0);
}
const DENY = new Set(['geolocation', 'midi', 'midiSysex', 'idle-detection', 'display-capture', 'mediaKeySystem', 'window-management', 'hid', 'serial', 'usb', 'openExternal']);
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, d) => cb(!DENY.has(perm) && !(perm === 'media' && d && (d.mediaTypes || []).includes('video'))));
  if (process.env.SPARK_SELFTEST) return selftest();
  catalog = readJson(cacheFile(), { games: [] });   // sofort die bekannten Spiele zeigen, dann aktualisieren
  createLauncher();
  await loadCatalog(); changed();
  if (set().autoUpdate) { await checkUpdate(); send('update', publicUpd()); }
});
app.on('window-all-closed', () => app.quit());
