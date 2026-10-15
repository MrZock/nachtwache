// SPARK Chat – Server-Teil: Konten, Freunde, Weiterleitung von Nachrichten und Anrufen.
// Der Server sieht keine Passwörter (nur einen daraus abgeleiteten Schlüssel, den er nochmals hasht)
// und keine Nachrichten: alles ist Ende-zu-Ende-verschlüsselt. Verschlüsselte Nachrichten für Freunde, die gerade
// offline sind, warten max. 7 Tage; kleine (Text) werden mitgespeichert, damit sie einen Neustart überstehen.
// Gruppen: Inhalt wird einmal verschlüsselt, der Schlüssel dazu für jedes Mitglied einzeln (der Server sieht nur Name + Mitglieder).
// Konten werden in einem privaten GitHub-Repo gespeichert (Umgebungsvariablen GH_TOKEN, GH_DATA_REPO),
// ohne Token in chat-data.json neben dem Server.
'use strict';
const crypto = require('crypto'), fs = require('fs'), path = require('path');

const GH_TOKEN = process.env.GH_TOKEN || '', GH_REPO = process.env.GH_DATA_REPO || 'MrZock/spark-daten';
const LOCAL_FILE = path.join(__dirname, 'chat-data.json'), LOCAL_REPORTS = path.join(__dirname, 'chat-reports.json');
const SECRET = crypto.createHash('sha256').update('spark-chat|' + (process.env.CHAT_SECRET || GH_TOKEN || crypto.randomBytes(16).toString('hex'))).digest();
const RESERVED = new Set(['admin', 'administrator', 'spark', 'system', 'support', 'moderator', 'mod', 'root', 'server']);
const QUEUE_MAX = 300, QUEUE_DAYS = 7, MAX_CT = 850000;           // eine Nachricht (inkl. Bild) max. ~850 KB verschlüsselt
const QUEUE_BYTES = 10 * 1048576, QUEUE_TOTAL = 150 * 1048576, AV_MAX = 32000;   // Warteschlange: pro Person 10 MB, insgesamt 150 MB
const QUEUE_KEEP = 32000;                     // Nachrichten bis zu dieser Größe werden für Neustarts mitgespeichert
const GROUP_MAX = 32, GROUPS_PER_USER = 50;
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const okName = s => typeof s === 'string' && /^[A-Za-z0-9_.-]{3,20}$/.test(s);
const okHex = (s, n) => typeof s === 'string' && s.length === n && /^[0-9a-f]+$/.test(s);
const okB64 = (s, max) => typeof s === 'string' && s.length <= max && /^[A-Za-z0-9+/=]+$/.test(s);
const now = () => Date.now();

module.exports = function createChat({ wsSend, log }) {
  // ---------- Daten: { users: { key: {...} } }, Meldungen, Sperrliste
  let db = { v: 1, users: {} }, reports = [], bans = new Set(), ready = false, dirty = false, repDirty = false;
  let avatars = {}, avDirty = false, qDirty = false;   // Profilbilder (JPEG, Base64) – getrennte Datei, nur für Freunde sichtbar
  const LOCAL_AV = path.join(__dirname, 'chat-avatars.json'), LOCAL_QUEUE = path.join(__dirname, 'chat-queue.json');
  const sha = {};   // GitHub-Dateiversionen
  const user = k => db.users[k];
  const rm = (arr, x) => { const i = arr.indexOf(x); if (i >= 0) arr.splice(i, 1); };

  async function gh(method, file, body) {
    const r = await fetch('https://api.github.com/repos/' + GH_REPO + '/' + (file.startsWith('git/') ? file : 'contents/' + file), {
      method, headers: { Authorization: 'Bearer ' + GH_TOKEN, Accept: 'application/vnd.github+json', 'User-Agent': 'spark-chat', 'X-GitHub-Api-Version': '2022-11-28' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (method === 'GET' && r.status === 404) return null;
    if (!r.ok) throw new Error('GitHub ' + r.status + ' bei ' + file);
    return r.json();
  }
  async function ghRead(file) {
    const j = await gh('GET', file);
    if (!j) return null;
    sha[file] = j.sha;
    let text = j.content ? Buffer.from(j.content, 'base64').toString('utf8') : '';
    if (!text && j.size && j.download_url) text = await (await fetch(j.download_url, { headers: { Authorization: 'Bearer ' + GH_TOKEN } })).text();
    return JSON.parse(text);
  }
  // Schreiben ohne Versionsgeschichte: jedes Mal ein neuer Commit ohne Vorgänger, der den alten ersetzt.
  // So sind gelöschte Konten und Meldungen wirklich weg (Recht auf Löschung) und nicht im Git-Verlauf.
  async function ghWriteAll(files) {
    const ref = await gh('GET', 'git/ref/heads/main');
    const head = ref ? await gh('GET', 'git/commits/' + ref.object.sha) : null;
    const old = head ? (await gh('GET', 'git/trees/' + head.tree.sha)).tree.filter(e => e.type === 'blob' && !(e.path in files)) : [];
    const tree = old.map(e => ({ path: e.path, mode: e.mode, type: 'blob', sha: e.sha }));
    for (const [p, obj] of Object.entries(files)) tree.push({ path: p, mode: '100644', type: 'blob', content: JSON.stringify(obj, null, p === 'konten.json' ? 0 : 1) });
    const t = await gh('POST', 'git/trees', { tree });
    const c = await gh('POST', 'git/commits', { message: 'Daten (ohne Verlauf)', tree: t.sha, parents: [] });
    if (ref) await gh('PATCH', 'git/refs/heads/main', { sha: c.sha, force: true });
    else await gh('POST', 'git/refs', { ref: 'refs/heads/main', sha: c.sha });
  }
  async function load() {
    try {
      if (GH_TOKEN) {
        db = (await ghRead('konten.json')) || { v: 1, users: {} };
        reports = (await ghRead('meldungen.json')) || [];
        avatars = (await ghRead('profilbilder.json')) || {};
        restoreQueue((await ghRead('warteschlange.json')) || {});
        await loadBans();
      } else {
        try { db = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8')); } catch (e) { db = { v: 1, users: {} }; }
        try { reports = JSON.parse(fs.readFileSync(LOCAL_REPORTS, 'utf8')); } catch (e) { reports = []; }
        try { avatars = JSON.parse(fs.readFileSync(LOCAL_AV, 'utf8')); } catch (e) { avatars = {}; }
        try { restoreQueue(JSON.parse(fs.readFileSync(LOCAL_QUEUE, 'utf8'))); } catch (e) {}
      }
      if (!db.users) db.users = {};
      if (!db.groups) db.groups = {};
      prune();
      ready = true;
      log('Chat: ' + Object.keys(db.users).length + ' Konten geladen (' + (GH_TOKEN ? 'GitHub ' + GH_REPO : 'lokale Datei') + ')');
    } catch (e) {
      log('Chat: Konten konnten nicht geladen werden (' + e.message + ') – neuer Versuch in 30 s');
      setTimeout(load, 30000);
    }
  }
  // Sperrliste: gesperrt.json im Daten-Repo, z. B. {"gesperrt": ["name1", "name2"]} – direkt auf GitHub bearbeiten
  async function loadBans() {
    if (!GH_TOKEN) return;
    try {
      const b = await ghRead('gesperrt.json');
      bans = new Set(((b && b.gesperrt) || []).map(s => String(s).toLowerCase()));
      for (const k of bans) for (const c of conns(k)) { send(c, { t: 'err', msg: 'Dieses Konto wurde wegen eines Verstoßes gegen die Nutzungsbedingungen gesperrt.', fatal: true }); c.sock.end(); }
    } catch (e) { log('Chat: Sperrliste nicht lesbar (' + e.message + ')'); }
  }
  // Speicherfristen: Meldungen 6 Monate, Konten 2 Jahre nach der letzten Anmeldung
  function prune() {
    const cutRep = new Date(now() - 183 * 864e5).toISOString(), cutUser = new Date(now() - 730 * 864e5).toISOString().slice(0, 10);
    const nr = reports.filter(r => r.zeit >= cutRep); if (nr.length !== reports.length) { reports = nr; repDirty = true; }
    for (const [k, u] of Object.entries(db.users)) if ((u.seen || u.created) < cutUser) { removeUser(k); dirty = true; }
  }
  function removeUser(k) {
    for (const u of Object.values(db.users)) { rm(u.friends, k); rm(u.inReq, k); rm(u.outReq, k); rm(u.blocked, k); }
    for (const g of Object.values(db.groups || {})) if (g.members.includes(k)) leaveGroup(g, k);
    delete db.users[k]; queue.delete(k); qDirty = true;
    if (avatars[k]) { delete avatars[k]; avDirty = true; }
  }
  setInterval(prune, 24 * 3600e3).unref();
  let saving = false;
  async function save() {
    if (!ready || saving || (!dirty && !repDirty && !avDirty && !qDirty)) return;
    saving = true;
    const d = dirty, rd = repDirty, ad = avDirty, qd = qDirty; dirty = repDirty = avDirty = qDirty = false;
    try {
      if (GH_TOKEN) {
        const files = { 'konten.json': db, 'meldungen.json': reports };
        if (ad) files['profilbilder.json'] = avatars;
        if (qd) files['warteschlange.json'] = keptQueue();
        await ghWriteAll(files);
      } else {
        if (d) fs.writeFileSync(LOCAL_FILE, JSON.stringify(db));
        if (rd) fs.writeFileSync(LOCAL_REPORTS, JSON.stringify(reports, null, 1));
        if (ad) fs.writeFileSync(LOCAL_AV, JSON.stringify(avatars));
        if (qd) fs.writeFileSync(LOCAL_QUEUE, JSON.stringify(keptQueue()));
      }
    } catch (e) {
      dirty = dirty || d; repDirty = repDirty || rd; avDirty = avDirty || ad; qDirty = qDirty || qd;
      log('Chat: Speichern fehlgeschlagen (' + e.message + ')');
    }
    saving = false;
  }
  const touch = () => { dirty = true; };
  setInterval(save, GH_TOKEN ? 45000 : 5000).unref();
  setInterval(loadBans, 10 * 60000).unref();
  async function flush() { await save(); }

  // ---------- Verbindungen
  const online = new Map();   // key → Set(conn)
  const conns = k => online.get(k) || new Set();
  const isOn = k => conns(k).size > 0;
  const send = (c, o) => wsSend(c.sock, JSON.stringify(o));
  const sendUser = (k, o) => { for (const c of conns(k)) send(c, o); };
  const queue = new Map();    // key → [{...msg}] – nur im Arbeitsspeicher
  const calls = new Map();    // cid → { a: key, ac: conn, b: key, bc: conn|null, t }
  const ipHits = new Map();
  function limited(ip, kind, max, ms) {
    const k = kind + ip, t = now(), e = ipHits.get(k) || { n: 0, t };
    if (t - e.t > ms) { e.n = 0; e.t = t; }
    e.n++; ipHits.set(k, e);
    if (ipHits.size > 20000) ipHits.clear();
    return e.n > max;
  }
  // Pseudo-Salz für unbekannte Namen, damit man nicht herausfinden kann, wer ein Konto hat
  const fakeSalt = k => crypto.createHmac('sha256', SECRET).update(k).digest('hex').slice(0, 32);
  const hashAuth = (auth, hs) => new Promise((res, rej) => crypto.scrypt(Buffer.from(auth, 'hex'), Buffer.from(hs, 'hex'), 32, { N: 16384, r: 8, p: 1 }, (e, d) => e ? rej(e) : res(d.toString('hex'))));
  async function checkAuth(u, auth) {
    if (!u || !okHex(auth, 64)) return false;
    if (u.lock && u.lock > now()) return false;
    const h = await hashAuth(auth, u.hs);
    const ok = crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(u.hash, 'hex'));
    if (!ok) { u.fails = (u.fails || 0) + 1; if (u.fails >= 10) { u.lock = now() + 15 * 60000; u.fails = 0; } }
    else { u.fails = 0; delete u.lock; }
    return ok;
  }

  function social(k) {
    const u = user(k);
    if (!u) return null;
    return {
      t: 'social',
      friends: u.friends.filter(user).map(f => ({ u: user(f).name, pub: user(f).pub, av: user(f).av || 0, status: user(f).status || '', on: isOn(f) && !user(f).invisible, act: (isOn(f) && !user(f).invisible && actOf(f)) || '' })),
      inReq: u.inReq.filter(user).map(f => user(f).name), outReq: u.outReq.filter(user).map(f => user(f).name), blocked: u.blocked.filter(user).map(f => user(f).name),
      groups: Object.entries(db.groups).filter(([, g]) => g.members.includes(k)).map(([id, g]) => groupView(id, g)),
    };
  }
  const pushSocial = k => { const s = social(k); if (s) sendUser(k, s); };
  const groupView = (id, g) => ({ id, name: g.name, owner: user(g.owner) ? user(g.owner).name : '', members: g.members.filter(user).map(m => ({ u: user(m).name, pub: user(m).pub, av: user(m).av || 0 })) });
  function leaveGroup(g, k) {
    rm(g.members, k);
    const id = Object.keys(db.groups).find(x => db.groups[x] === g);
    if (!g.members.length) { delete db.groups[id]; return; }
    if (g.owner === k) g.owner = g.members[0];
    touch();
  }
  const pushGroup = g => { for (const m of g.members) pushSocial(m); };
  function actOf(k) { for (const c of conns(k)) if (c.act) return c.act; return ''; }
  function presence(k) {
    const u = user(k); if (!u) return;
    const on = isOn(k) && !u.invisible, act = on ? actOf(k) : '';
    for (const f of u.friends) sendUser(f, { t: 'pres', u: u.name, on, act, status: u.status || '' });
  }

  let queueBytes = 0;
  const mSize = m => (m.ct ? m.ct.length : 0) + 200;
  function deliver(k, m) {
    if (isOn(k)) { sendUser(k, m); return true; }
    const q = queue.get(k) || [];
    if (q.some(x => x.id === m.id && x.from === m.from)) return false;
    if (queueBytes + mSize(m) > QUEUE_TOTAL) return null;   // Server-Speicher voll
    q.push(m); queueBytes += mSize(m); q.bytes = (q.bytes || 0) + mSize(m);
    while (q.length > QUEUE_MAX || q.bytes > QUEUE_BYTES) { const x = q.shift(); q.bytes -= mSize(x); queueBytes -= mSize(x); }
    queue.set(k, q);
    if (mSize(m) <= QUEUE_KEEP) qDirty = true;
    return false;
  }
  // Kleine wartende Nachrichten (verschlüsselt) mitspeichern, damit sie einen Neustart überstehen
  function keptQueue() {
    const out = {}, cut = now() - QUEUE_DAYS * 864e5;
    for (const [k, q] of queue) { const keep = q.filter(m => mSize(m) <= QUEUE_KEEP && m.ts >= cut); if (keep.length) out[k] = keep; }
    return out;
  }
  function restoreQueue(o) {
    const cut = now() - QUEUE_DAYS * 864e5;
    for (const [k, list] of Object.entries(o || {})) {
      if (!Array.isArray(list)) continue;
      const q = list.filter(m => m && m.ts >= cut && typeof m.ct === 'string');
      if (!q.length) continue;
      q.bytes = q.reduce((s2, m) => s2 + mSize(m), 0); queueBytes += q.bytes; queue.set(k, q);
    }
  }
  function flushQueue(k, c) {
    const q = queue.get(k); if (!q) return;
    queue.delete(k); queueBytes -= q.bytes || 0; qDirty = true;
    const cut = now() - QUEUE_DAYS * 864e5;
    for (const m of q) {
      if (m.ts < cut) continue;
      send(c, m);
      if (m.t === 'msg') sendUser(m.from.toLowerCase(), { t: 'dlv', id: m.id, to: user(k) ? user(k).name : '' });
    }
  }
  setInterval(() => {
    const cut = now() - QUEUE_DAYS * 864e5;
    for (const [k, q] of queue) { const n = q.filter(m => m.ts >= cut); n.bytes = n.reduce((s, m) => s + mSize(m), 0); queueBytes -= (q.bytes || 0) - n.bytes; n.length ? queue.set(k, n) : queue.delete(k); }
  }, 3600000).unref();

  function endCallsOf(c, why) {
    for (const [cid, call] of calls) {
      if (call.ac !== c && call.bc !== c) continue;
      calls.delete(cid);
      const other = call.ac === c ? (call.bc ? [call.bc] : [...conns(call.b)]) : [call.ac];
      const me = call.ac === c ? user(call.a) : user(call.b);
      for (const o of other) send(o, { t: 'call', op: 'end', cid, u: me ? me.name : '', why: why || '' });
    }
  }

  // ---------- Nachrichten vom Client
  async function onText(c, text) {
    let m; try { m = JSON.parse(text); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'a') return relayAudio(c, m);
    // allgemeines Tempolimit (Audio ausgenommen)
    const t = now(); if (t - c.rt > 10000) { c.rt = t; c.rn = 0; }
    if (++c.rn > 60) { send(c, { t: 'err', msg: 'Langsamer bitte – zu viele Nachrichten.' }); return; }
    if (!ready && m.t !== 'ping') { send(c, { t: 'err', msg: 'Der Chat-Server startet gerade. Bitte in einer Minute nochmal versuchen.', retry: true }); return; }
    try {
      if (!c.key) return await onAuth(c, m);
      return await onCmd(c, m, user(c.key));
    } catch (e) { log('Chat-Fehler: ' + e.message); send(c, { t: 'err', msg: 'Serverfehler – bitte nochmal versuchen.' }); }
  }

  async function onAuth(c, m) {
    const k = String(m.u || '').toLowerCase();
    if (m.t === 'salt') { const u = user(k); return send(c, { t: 'salt', u: m.u, salt: u ? u.salt : fakeSalt(k) }); }
    if (m.t === 'register') {
      if (!okName(m.u)) return send(c, { t: 'err', msg: 'Benutzername: 3–20 Zeichen, nur Buchstaben, Ziffern, _ . -' });
      if (m.agree !== true) return send(c, { t: 'err', msg: 'Bitte Nutzungsbedingungen und Datenschutz akzeptieren.' });
      if (RESERVED.has(k) || user(k) || bans.has(k)) return send(c, { t: 'err', msg: 'Dieser Benutzername ist schon vergeben.' });
      if (!okHex(m.salt, 32) || !okHex(m.auth, 64) || !okB64(m.pub, 200) || !okB64(m.encPriv, 600)) return send(c, { t: 'err', msg: 'Ungültige Daten.' });
      if (limited(c.ip, 'reg', 5, 3600000)) return send(c, { t: 'err', msg: 'Zu viele neue Konten von hier – bitte später nochmal.' });
      const hs = crypto.randomBytes(16).toString('hex');
      db.users[k] = { name: m.u, salt: m.salt, hs, hash: await hashAuth(m.auth, hs), pub: m.pub, encPriv: m.encPriv, friends: [], inReq: [], outReq: [], blocked: [], created: new Date().toISOString().slice(0, 10) };
      touch(); log('Chat: neues Konto (' + Object.keys(db.users).length + ' gesamt)');
      return login(c, k);
    }
    if (m.t === 'login') {
      if (limited(c.ip, 'login', 20, 300000)) return send(c, { t: 'err', msg: 'Zu viele Anmeldeversuche – bitte 5 Minuten warten.' });
      const u = user(k);
      if (u && u.lock && u.lock > now()) return send(c, { t: 'err', msg: 'Zu viele falsche Passwörter – das Konto ist für 15 Minuten gesperrt.', auth: true });
      if (!(await checkAuth(u, m.auth))) { touch(); return send(c, { t: 'err', msg: 'Benutzername oder Passwort falsch.', auth: true }); }
      if (bans.has(k)) return send(c, { t: 'err', msg: 'Dieses Konto wurde wegen eines Verstoßes gegen die Nutzungsbedingungen gesperrt.', fatal: true, auth: true });
      return login(c, k);
    }
    if (m.t === 'ping') return send(c, { t: 'pong' });
    send(c, { t: 'err', msg: 'Bitte zuerst anmelden.' });
  }

  function login(c, k) {
    const u = user(k);
    const today = new Date().toISOString().slice(0, 10); if (u.seen !== today) { u.seen = today; touch(); }
    c.key = k; c.act = typeof c.act === 'string' ? c.act : '';
    if (!online.has(k)) online.set(k, new Set());
    const first = !isOn(k);
    online.get(k).add(c);
    send(c, { t: 'hello', me: { u: u.name, pub: u.pub, encPriv: u.encPriv, salt: u.salt, invisible: !!u.invisible, created: u.created, av: u.av || 0, status: u.status || '' } });
    send(c, social(k));
    for (const f of u.inReq) if (user(f)) send(c, { t: 'req', u: user(f).name });
    flushQueue(k, c);
    if (first) presence(k);
  }

  async function onCmd(c, m, me) {
    if (!me) { send(c, { t: 'err', msg: 'Konto nicht mehr vorhanden.', fatal: true }); c.sock.end(); return; }
    const k = c.key, ok = String(m.u || '').toLowerCase(), other = user(ok);
    switch (m.t) {
      case 'ping': return send(c, { t: 'pong' });
      case 'msg': {   // verschlüsselte Nachricht an einen Freund
        if (!other || !me.friends.includes(ok)) return send(c, { t: 'nack', id: m.id, msg: 'Ihr seid keine Freunde (mehr).' });
        if (typeof m.id !== 'string' || m.id.length > 40 || !okB64(m.iv, 24) || !okB64(m.ct, MAX_CT)) return send(c, { t: 'nack', id: String(m.id || '').slice(0, 40), msg: 'Nachricht zu groß.' });
        const tb = now(); if (tb - c.bt > 60000) { c.bt = tb; c.bb = 0; }
        if ((c.bb += m.ct.length) > 25 * 1048576) return send(c, { t: 'nack', id: m.id, msg: 'Zu viele Bilder auf einmal – bitte kurz warten.' });
        const out = { t: 'msg', from: me.name, id: m.id, iv: m.iv, ct: m.ct, ts: now() };
        const r = deliver(ok, out);
        if (r) send(c, { t: 'dlv', id: m.id, to: other.name });
        else if (r === null) send(c, { t: 'nack', id: m.id, msg: other.name + ' ist offline und der Server-Speicher ist gerade voll. Versuch es später nochmal.' });
        else send(c, { t: 'queued', id: m.id, to: other.name });
        return;
      }
      case 'avatar': {
        const img = String(m.img || '');
        if (img && (img.length > AV_MAX || !/^\/9j\/[A-Za-z0-9+/=]+$/.test(img))) return send(c, { t: 'info', msg: 'Ungültiges Profilbild.' });
        if (limited(c.ip, 'av', 20, 3600000)) return send(c, { t: 'info', msg: 'Zu oft geändert – bitte später nochmal.' });
        if (img) avatars[k] = img; else delete avatars[k];
        me.av = img ? now() : 0; avDirty = true; touch();
        for (const cc of conns(k)) send(cc, { t: 'av', u: me.name, v: me.av, img });
        for (const f of me.friends) pushSocial(f);
        return;
      }
      case 'getav': {   // nur eigenes Bild, das von Freunden oder von Leuten aus gemeinsamen Gruppen
        if (!other || (ok !== k && !me.friends.includes(ok) && !Object.values(db.groups).some(g => g.members.includes(k) && g.members.includes(ok)))) return;
        return send(c, { t: 'av', u: other.name, v: other.av || 0, img: avatars[ok] || '' });
      }
      case 'status': {   // eigener Status-Text, nur für Freunde sichtbar
        me.status = clean(m.text, 60); touch(); presence(k);
        for (const cc of conns(k)) send(cc, { t: 'mystatus', text: me.status });
        return;
      }
      case 'gcreate': {
        const name = clean(m.name, 40);
        if (!name) return send(c, { t: 'info', msg: 'Bitte gib der Gruppe einen Namen.' });
        if (Object.values(db.groups).filter(g => g.members.includes(k)).length >= GROUPS_PER_USER) return send(c, { t: 'info', msg: 'Du bist schon in zu vielen Gruppen.' });
        const mem = [k];
        for (const n of (Array.isArray(m.members) ? m.members : []).slice(0, GROUP_MAX - 1)) { const kk = String(n).toLowerCase(); if (me.friends.includes(kk) && !mem.includes(kk) && !user(kk).blocked.includes(k)) mem.push(kk); }
        const id = crypto.randomBytes(6).toString('hex');
        db.groups[id] = { name, owner: k, members: mem, created: new Date().toISOString().slice(0, 10) };
        touch(); pushGroup(db.groups[id]);
        return send(c, { t: 'gnew', id });
      }
      case 'gadd': case 'gkick': case 'grename': case 'gleave': {
        const g = db.groups[String(m.g || '')];
        if (!g || !g.members.includes(k)) return;
        if (m.t === 'gleave') { const before = g.members.slice(); leaveGroup(g, k); touch(); pushSocial(k); for (const x of before) if (x !== k) pushSocial(x); return; }
        if (g.owner !== k) return send(c, { t: 'info', msg: 'Das darf nur der Gruppenleiter.' });
        if (m.t === 'grename') { const name = clean(m.name, 40); if (name) { g.name = name; touch(); pushGroup(g); } return; }
        if (m.t === 'gadd') {
          if (!other || !me.friends.includes(ok)) return send(c, { t: 'info', msg: 'Du kannst nur deine Freunde hinzufügen.' });
          if (g.members.includes(ok)) return;
          if (g.members.length >= GROUP_MAX) return send(c, { t: 'info', msg: 'Die Gruppe ist voll (max. ' + GROUP_MAX + ').' });
          if (other.blocked.includes(k)) return send(c, { t: 'info', msg: other.name + ' konnte nicht hinzugefügt werden.' });
          g.members.push(ok); touch(); pushGroup(g); return;
        }
        if (m.t === 'gkick') { if (ok === k || !g.members.includes(ok)) return; rm(g.members, ok); touch(); pushGroup(g); pushSocial(ok); return; }
        return;
      }
      case 'gmsg': {   // Gruppen-Nachricht: ein verschlüsselter Inhalt + pro Mitglied ein verpackter Schlüssel
        const g = db.groups[String(m.g || '')];
        if (!g || !g.members.includes(k)) return send(c, { t: 'nack', id: String(m.id || '').slice(0, 40), msg: 'Du bist nicht (mehr) in dieser Gruppe.' });
        if (typeof m.id !== 'string' || m.id.length > 40 || !okB64(m.ct, MAX_CT) || !m.keys || typeof m.keys !== 'object') return send(c, { t: 'nack', id: String(m.id || '').slice(0, 40), msg: 'Nachricht zu groß.' });
        const tb = now(); if (tb - c.bt > 60000) { c.bt = tb; c.bb = 0; }
        if ((c.bb += m.ct.length * Math.min(4, g.members.length - 1)) > 40 * 1048576) return send(c, { t: 'nack', id: m.id, msg: 'Zu viel auf einmal – bitte kurz warten.' });
        let n = 0, q = 0;
        for (const mk of g.members) {
          if (mk === k) continue;
          const kk = m.keys[user(mk) ? user(mk).name : mk];
          if (!okB64(kk, 200)) continue;
          if (user(mk) && user(mk).blocked.includes(k)) continue;   // wer blockiert hat, bekommt nichts
          const r = deliver(mk, { t: 'gmsg', g: m.g, from: me.name, id: m.id, ct: m.ct, k: kk, ts: now() });
          if (r) n++; else if (r === false) q++;
        }
        return send(c, { t: 'gack', id: m.id, n, q });
      }
      case 'gtyping': { const g = db.groups[String(m.g || '')]; if (g && g.members.includes(k)) for (const mk of g.members) if (mk !== k) sendUser(mk, { t: 'typing', u: me.name, g: m.g }); return; }
      case 'read': if (other && me.friends.includes(ok) && typeof m.id === 'string') sendUser(ok, { t: 'read', u: me.name, id: m.id.slice(0, 40) }); return;
      case 'typing': if (other && me.friends.includes(ok)) sendUser(ok, { t: 'typing', u: me.name }); return;
      case 'act': {   // Aktivität („spielt BLACKOUT“) – nur für Freunde sichtbar
        const a = String(m.act || '').replace(/[\u0000-\u001f<>]/g, '').slice(0, 40);
        if (a !== c.act) { c.act = a; presence(k); }
        return;
      }
      case 'invisible': me.invisible = !!m.on; touch(); presence(k); for (const cc of conns(k)) send(cc, { t: 'hello', me: { u: me.name, pub: me.pub, encPriv: me.encPriv, salt: me.salt, invisible: me.invisible, created: me.created, av: me.av || 0, status: me.status || '' } }); return;
      case 'freq': {   // Freundschaftsanfrage
        if (!other || ok === k) return send(c, { t: 'info', msg: 'Kein Konto mit dem Namen „' + String(m.u || '').slice(0, 20) + '“ gefunden.' });
        if (me.friends.includes(ok)) return send(c, { t: 'info', msg: other.name + ' ist schon dein Freund.' });
        if (me.blocked.includes(ok)) return send(c, { t: 'info', msg: 'Du hast ' + other.name + ' blockiert. Hebe die Blockierung zuerst auf.' });
        if (me.inReq.includes(ok)) return accept(k, ok);
        if (me.outReq.length >= 100 || me.friends.length >= 500) return send(c, { t: 'info', msg: 'Zu viele Freunde/Anfragen.' });
        if (!me.outReq.includes(ok)) me.outReq.push(ok);
        // Wer blockiert wurde, merkt das nicht – die Anfrage kommt nur nicht an
        if (!other.blocked.includes(k) && !other.inReq.includes(k)) { other.inReq.push(k); sendUser(ok, { t: 'req', u: me.name }); pushSocial(ok); }
        touch(); pushSocial(k);
        return send(c, { t: 'info', msg: 'Anfrage an ' + other.name + ' gesendet.', ok: true });
      }
      case 'fans': {   // Anfrage annehmen / ablehnen
        if (!other || !me.inReq.includes(ok)) return pushSocial(k);
        if (m.yes) return accept(k, ok);
        rm(me.inReq, ok); rm(other.outReq, k); touch(); pushSocial(k); pushSocial(ok); return;
      }
      case 'fcancel': if (other) { rm(me.outReq, ok); rm(other.inReq, k); touch(); pushSocial(k); pushSocial(ok); } return;
      case 'unfriend': if (other) { rm(me.friends, ok); rm(other.friends, k); touch(); pushSocial(k); pushSocial(ok); } return;
      case 'block': {
        if (!other || ok === k) return;
        if (m.on) {
          if (!me.blocked.includes(ok)) me.blocked.push(ok);
          rm(me.friends, ok); rm(other.friends, k); rm(me.inReq, ok); rm(me.outReq, ok); rm(other.inReq, k); rm(other.outReq, k);
          for (const [cid, call] of calls) if ((call.a === k && call.b === ok) || (call.a === ok && call.b === k)) { calls.delete(cid); sendUser(ok, { t: 'call', op: 'end', cid, u: me.name }); sendUser(k, { t: 'call', op: 'end', cid, u: other.name }); }
        } else rm(me.blocked, ok);
        touch(); pushSocial(k); pushSocial(ok); return;
      }
      case 'call': return onCall(c, m, me, ok, other);
      case 'report': {   // Meldung (DSA): der Meldende schickt die betroffenen Nachrichten selbst mit
        if (!other) return send(c, { t: 'info', msg: 'Konto nicht gefunden.' });
        if (limited(c.ip, 'rep', 10, 3600000)) return send(c, { t: 'info', msg: 'Zu viele Meldungen – bitte später nochmal.' });
        const msgs = (Array.isArray(m.msgs) ? m.msgs : []).slice(-30).map(x => ({ von: String(x.from || '').slice(0, 20), zeit: new Date(+x.ts || 0).toISOString(), text: String(x.text || '').slice(0, 2000) }));
        reports.push({ zeit: new Date().toISOString(), von: me.name, gemeldet: other.name, grund: String(m.reason || '').slice(0, 60), text: String(m.text || '').slice(0, 2000), nachrichten: msgs, status: 'offen' });
        if (reports.length > 2000) reports.splice(0, reports.length - 2000);
        repDirty = true; save();
        log('Chat: neue Meldung');
        return send(c, { t: 'info', msg: 'Danke! Deine Meldung wurde übermittelt und wird geprüft.', ok: true });
      }
      case 'pw': {   // Passwort ändern: neuer Schlüssel + privater Schlüssel neu verpackt
        if (!(await checkAuth(me, m.auth))) { touch(); return send(c, { t: 'info', msg: 'Altes Passwort falsch.' }); }
        if (!okHex(m.salt, 32) || !okHex(m.auth2, 64) || !okB64(m.encPriv, 600)) return;
        me.salt = m.salt; me.hs = crypto.randomBytes(16).toString('hex'); me.hash = await hashAuth(m.auth2, me.hs); me.encPriv = m.encPriv; touch();
        for (const cc of conns(k)) if (cc !== c) { send(cc, { t: 'err', msg: 'Das Passwort wurde geändert – bitte neu anmelden.', fatal: true, auth: true }); cc.sock.end(); }
        return send(c, { t: 'pwok', salt: me.salt, encPriv: me.encPriv });
      }
      case 'mydata': {   // Auskunft (Art. 15 DSGVO): alles, was der Server über dich gespeichert hat
        const { hash, hs, fails, lock, ...rest } = me;   // seen = Datum der letzten Anmeldung
        const name = f => (user(f) ? user(f).name : f);
        return send(c, { t: 'mydata', data: Object.assign(rest, { friends: me.friends.map(name), inReq: me.inReq.map(name), outReq: me.outReq.map(name), blocked: me.blocked.map(name),
          profilbild: avatars[k] ? 'data:image/jpeg;base64,' + avatars[k] : 'keins',
          gruppen: Object.values(db.groups).filter(g => g.members.includes(k)).map(g => ({ name: g.name, leiter: name(g.owner), mitglieder: g.members.map(name) })),
          hinweis: 'Zusätzlich gespeichert: ein Hash deines Anmeldeschlüssels (nicht dein Passwort). Verschlüsselte Nachrichten an dich, die noch nicht zugestellt wurden: ' + ((queue.get(k) || []).length) }) });
      }
      case 'delete': {   // Konto löschen (Art. 17 DSGVO)
        if (!(await checkAuth(me, m.auth))) { touch(); return send(c, { t: 'info', msg: 'Passwort falsch – Konto wurde nicht gelöscht.' }); }
        const touched = Object.keys(db.users).filter(kk => kk !== k && (db.users[kk].friends.includes(k) || db.users[kk].inReq.includes(k) || db.users[kk].outReq.includes(k) || Object.values(db.groups).some(g => g.members.includes(k) && g.members.includes(kk))));
        const friends = me.friends.slice();
        removeUser(k); touch(); save();
        for (const kk of touched) pushSocial(kk);
        for (const f of friends) sendUser(f, { t: 'pres', u: me.name, on: false, act: '' });
        log('Chat: Konto gelöscht');
        for (const cc of conns(k)) { send(cc, { t: 'deleted' }); endCallsOf(cc); cc.sock.end(); }
        online.delete(k);
        return;
      }
      case 'logout': c.sock.end(); return;
    }
  }

  function accept(k, ok) {
    const me = user(k), other = user(ok);
    rm(me.inReq, ok); rm(me.outReq, ok); rm(other.outReq, k); rm(other.inReq, k);
    if (!me.friends.includes(ok)) me.friends.push(ok);
    if (!other.friends.includes(k)) other.friends.push(k);
    touch(); pushSocial(k); pushSocial(ok);
    sendUser(ok, { t: 'info', msg: me.name + ' hat deine Freundschaftsanfrage angenommen.', ok: true });
  }

  // ---------- Sprachanrufe: Klingeln/Annehmen/Auflegen; Ton läuft verschlüsselt über den Server
  function onCall(c, m, me, ok, other) {
    const cid = String(m.cid || '').slice(0, 24);
    if (!cid) return;
    if (m.op === 'ring') {
      if (!other || !me.friends.includes(ok)) return send(c, { t: 'call', op: 'end', cid, u: String(m.u || ''), why: 'Nur Freunde können angerufen werden.' });
      if (!isOn(ok) || other.invisible) return send(c, { t: 'call', op: 'end', cid, u: other.name, why: other.name + ' ist offline.' });
      for (const [xid, call] of calls) {
        // Beide rufen sich gleichzeitig an → den anderen Anruf direkt verbinden
        if (call.a === ok && call.b === c.key && !call.bc) { call.bc = c; send(call.ac, { t: 'call', op: 'accept', cid: xid, u: me.name }); return send(c, { t: 'call', op: 'joined', cid: xid, old: cid, u: other.name }); }
        if (call.a === ok || call.b === ok) return send(c, { t: 'call', op: 'end', cid, u: other.name, why: other.name + ' telefoniert gerade.' });
      }
      for (const [xid, call] of calls) if (call.ac === c || call.bc === c) { calls.delete(xid); }   // alter, hängender Anruf dieses Geräts
      if (calls.size > 200) return send(c, { t: 'call', op: 'end', cid, u: other.name, why: 'Server ausgelastet.' });
      calls.set(cid, { a: c.key, ac: c, b: ok, bc: null, t: now() });
      sendUser(ok, { t: 'call', op: 'ring', cid, u: me.name });
      setTimeout(() => { const call = calls.get(cid); if (call && !call.bc) { calls.delete(cid); send(call.ac, { t: 'call', op: 'end', cid, u: other.name, why: 'Keine Antwort.' }); sendUser(ok, { t: 'call', op: 'end', cid, u: me.name, why: 'Verpasster Anruf' }); } }, 45000);
      return;
    }
    const call = calls.get(cid);
    if (!call) return;
    if (m.op === 'accept' && call.b === c.key && !call.bc) {
      call.bc = c;
      send(call.ac, { t: 'call', op: 'accept', cid, u: me.name });
      for (const cc of conns(c.key)) if (cc !== c) send(cc, { t: 'call', op: 'end', cid, u: user(call.a).name, why: 'Auf einem anderen Gerät angenommen' });
      return;
    }
    if ((m.op === 'decline' || m.op === 'end') && (call.ac === c || call.b === c.key)) {
      calls.delete(cid);
      const to = call.ac === c ? (call.bc ? [call.bc] : [...conns(call.b)]) : [call.ac];
      for (const o of to) send(o, { t: 'call', op: 'end', cid, u: me.name, why: m.op === 'decline' ? 'Abgelehnt' : '' });
      if (call.ac !== c) for (const cc of conns(call.b)) if (cc !== c) send(cc, { t: 'call', op: 'end', cid, u: user(call.a) ? user(call.a).name : '' });
    }
  }
  function relayAudio(c, m) {
    const call = calls.get(String(m.cid || ''));
    if (!call || !call.bc || typeof m.d !== 'string' || m.d.length > 4000) return;
    const t = now(); if (t - c.at > 1000) { c.at = t; c.an = 0; }
    if (++c.an > 60) return;
    const to = call.ac === c ? call.bc : call.bc === c ? call.ac : null;
    if (to) wsSend(to.sock, JSON.stringify({ t: 'a', cid: m.cid, d: m.d }));
  }

  load();   // erst hier: alle Zustände oben sind angelegt
  return {
    open(sock, ip) { return { sock, ip, key: null, act: '', rt: 0, rn: 0, at: 0, an: 0, bt: 0, bb: 0 }; },
    text: onText,
    close(c) {
      endCallsOf(c, 'Verbindung getrennt');
      if (!c.key) return;
      const set = online.get(c.key);
      if (set) { set.delete(c); if (!set.size) { online.delete(c.key); presence(c.key); } else presence(c.key); }
    },
    stats: () => ({ users: Object.keys(db.users).length, online: online.size, ready }),
    flush,
  };
};
