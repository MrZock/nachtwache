// SPARK Chat – Freunde, Ende-zu-Ende-verschlüsselte Nachrichten, Sprachanrufe und BLACKOUT-Einladungen.
// Sicherheit: Aus Passwort + Benutzername werden auf diesem PC zwei Schlüssel berechnet (PBKDF2):
//  • „auth“ geht zum Server (der speichert davon nur einen Hash) – das Passwort selbst verlässt nie den PC
//  • „wrap“ bleibt hier und verschlüsselt den privaten Schlüssel (ECDH P-256) und den Chatverlauf
// Nachrichten: AES-GCM mit einem Schlüssel, den nur die beiden Freunde aus ihren Schlüsselpaaren ableiten können.
'use strict';
(() => {
const VERSION = 'Alpha 1.0.0';
const $ = id => document.getElementById(id);
const SITE = 'https://mrzock.github.io/spark/';
const LINKS = { terms: SITE + 'nutzungsbedingungen.html', privacy: SITE + 'datenschutz.html#chat', contact: SITE + 'datenschutz.html#kontakt' };
const GAME_WEB = 'https://mrzock.github.io/nachtwache/';
const SPARK = window.SPARK || null;   // im SPARK-Launcher: Spiele starten, sicher angemeldet bleiben
const SERVER = (() => {
  let s = ''; try { s = new URLSearchParams(location.search).get('server') || ''; } catch (e) {}
  if (!s) return 'wss://nachtwache.onrender.com/chat';
  const host = s.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
  return (/^(localhost|127\.)/.test(host) ? 'ws://' : 'wss://') + host + '/chat';
})();
const NAME_RE = /^[A-Za-z0-9_.-]{3,20}$/;
const te = new TextEncoder(), td = new TextDecoder();
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const prefs = Object.assign({ notify: true, sound: true }, lsGet('sparkchat.prefs', {}));

// ---------- Kryptografie (WebCrypto)
const C = crypto.subtle;
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
const hex = b => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
const unhex = h => new Uint8Array((h.match(/../g) || []).map(x => parseInt(x, 16)));
const b64 = buf => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => { const bin = atob(s), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
const cat = (a, b) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
async function deriveKeys(name, pw, saltHex) {
  const base = await C.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await C.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: cat(unhex(saltHex), te.encode(name.toLowerCase())), iterations: 300000 }, base, 512));
  return { auth: hex(bits.slice(0, 32)), wrapRaw: bits.slice(32) };
}
const aesKey = raw => C.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
async function hkdfKey(raw, info, salt) {
  const k = await C.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  return C.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode(salt || 'spark-chat'), info: te.encode(info) }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encWith(key, bytes, ad) {
  const iv = rnd(12), opt = { name: 'AES-GCM', iv }; if (ad) opt.additionalData = te.encode(ad);
  return cat(iv, new Uint8Array(await C.encrypt(opt, key, bytes)));
}
async function decWith(key, all, ad) {
  const opt = { name: 'AES-GCM', iv: all.subarray(0, 12) }; if (ad) opt.additionalData = te.encode(ad);
  return new Uint8Array(await C.decrypt(opt, key, all.subarray(12)));
}
async function wrapPriv(priv, wrapRaw) { return b64(await encWith(await aesKey(wrapRaw), new Uint8Array(await C.exportKey('pkcs8', priv)))); }
async function unwrapPriv(s, wrapRaw) { return C.importKey('pkcs8', await decWith(await aesKey(wrapRaw), unb64(s)), ECDH, false, ['deriveBits']); }

// ---------- Zustand
let ws = null, me = null, pendingKeys = null, stayLogged = false, manualClose = false, retryN = 0, retryT = null;
let friends = new Map(), inReq = [], outReq = [], blocked = [], sel = null, menuFor = null;
const hist = new Map(), shared = new Map(), unread = {}, typingT = {};
let histKey = null, pins = {}, lastTyping = 0, call = null, actNow = '';

// ---------- Verbindung zum Server
const waiters = [];
function waitFor(type, ms) {
  return new Promise((res, rej) => {
    const w = { type, res, rej };
    waiters.push(w);
    setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); rej(new Error('Keine Antwort vom Server – bitte nochmal versuchen.')); } }, ms || 60000);
  });
}
function settle(type, val, err) {
  const i = waiters.findIndex(w => err ? true : w.type === type);
  if (i < 0) return false;
  const [w] = waiters.splice(i, 1);
  err ? w.rej(err) : w.res(val);
  return true;
}
const wsReady = () => ws && ws.readyState === 1;
function send(o) { if (wsReady()) { ws.send(JSON.stringify(o)); return true; } return false; }
function connect() {
  return new Promise((res, rej) => {
    if (wsReady()) return res();
    if (ws) { try { ws.onclose = null; ws.close(); } catch (e) {} }
    const s = ws = new WebSocket(SERVER);
    let opened = false;
    const slow = setTimeout(() => { if (!opened) status('Server wacht auf … das kann beim ersten Mal bis zu einer Minute dauern.'); }, 3500);
    s.onopen = () => { opened = true; clearTimeout(slow); retryN = 0; res(); };
    s.onmessage = e => onRaw(e.data);
    s.onclose = () => {
      clearTimeout(slow);
      if (ws !== s) return;
      ws = null;
      while (waiters.length) waiters.shift().rej(new Error('Verbindung zum Server getrennt.'));
      if (!opened) rej(new Error('Keine Verbindung zum Server.'));
      onDisconnect();
    };
  });
}
// Kostenlose Server schlafen – bis zu ~90 s lang neu versuchen
async function connectRetry() {
  const t0 = Date.now();
  for (;;) {
    try { await connect(); return; } catch (e) {
      if (Date.now() - t0 > 90000) throw new Error('Der Chat-Server ist nicht erreichbar. Prüf dein Internet und versuch es gleich nochmal.');
      status('Server wacht auf … bitte kurz warten.');
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}
function onDisconnect() {
  if (call) endCall(false, 'Verbindung getrennt');
  if (!me || manualClose) return;
  conn('Verbindung getrennt – verbinde neu …');
  clearTimeout(retryT);
  retryT = setTimeout(reconnect, Math.min(30000, 1500 * Math.pow(2, retryN++)));
}
async function reconnect() {
  if (!me || manualClose) return;
  try {
    await connect();
    pendingKeys = { auth: me.auth, wrapRaw: me.wrapRaw };
    send({ t: 'login', u: me.u, auth: me.auth });
  } catch (e) { onDisconnect(); }
}
// Nachrichten nacheinander verarbeiten (Entschlüsseln ist asynchron, die Reihenfolge muss stimmen)
let chain = Promise.resolve();
function onRaw(data) {
  let m; try { m = JSON.parse(data); } catch (e) { return; }
  chain = chain.then(() => handle(m)).catch(e => console.error(e));
}
async function handle(m) {
  switch (m.t) {
    case 'salt': settle('salt', m); return;
    case 'av': {
      if (typeof m.img !== 'string' || (m.img && !/^\/9j\/[A-Za-z0-9+/=]+$/.test(m.img))) return;
      const k = String(m.u).toLowerCase();
      if (m.img) avCache[k] = { v: m.v, img: m.img }; else delete avCache[k];
      lsSet('sparkchat.av', avCache);
      renderAll(); if (call) callUi();
      return;
    }
    case 'hello': {
      if (pendingKeys) { const k = pendingKeys; pendingKeys = null; try { await onHello(m, k); settle('hello', m); } catch (e) { settle('hello', null, e); } }
      else if (me) { me.invisible = !!m.me.invisible; renderMe(); }
      return;
    }
    case 'err': {
      if (waiters.length) { settle(null, null, Object.assign(new Error(m.msg), { auth: m.auth, retry: m.retry })); return; }
      if (pendingKeys) { pendingKeys = null; if (m.auth) return logout(m.msg); }
      if (m.fatal) return logout(m.msg);
      toast(m.msg);
      return;
    }
    case 'social': return onSocial(m);
    case 'pres': {
      const f = friends.get(String(m.u).toLowerCase()); if (!f) return;
      const was = f.on; f.on = !!m.on; f.act = m.act || '';
      if (!was && f.on) blip([660, 880], .06, .04);
      renderFriends(); if (sel === f.key) renderHead();
      return;
    }
    case 'req': toast('🤝 ' + m.u + ' möchte dein Freund sein', true); notify('Freundschaftsanfrage', m.u + ' möchte dein Freund sein.'); blip([523, 784], .09); return;
    case 'info': toast(m.msg, !!m.ok); return;
    case 'msg': return onMessage(m);
    case 'dlv': case 'queued': case 'nack': {
      const fk = String(m.to || (sel || '')).toLowerCase(), e = findMsg(m.id, fk);
      if (!e) return;
      e.st = m.t === 'dlv' ? 'dlv' : m.t === 'queued' ? 'wait' : 'fail';
      if (m.t === 'nack') toast(m.msg || 'Nachricht konnte nicht gesendet werden.');
      saveHist(e.fk); if (e.fk === sel) renderMsgs();
      return;
    }
    case 'typing': {
      const k = String(m.u).toLowerCase();
      clearTimeout(typingT[k]); typingT[k] = setTimeout(() => { delete typingT[k]; renderTyping(); }, 4500);
      renderTyping(); return;
    }
    case 'call': return onCall(m);
    case 'a': return onAudio(m);
    case 'pwok': return onPwOk(m);
    case 'mydata': return showMyData(m.data);
    case 'deleted': {
      const k = me && me.key;
      if (k) imgDel(k + '|');
      if (k) for (const key of Object.keys(localStorage)) if (key.startsWith('sparkchat.h.' + k + '.') || key === 'sparkchat.pin.' + k || key === 'sparkchat.unread.' + k) localStorage.removeItem(key);
      return logout('Dein Konto und alle Daten dazu wurden gelöscht.', true);
    }
  }
}

// ---------- Anmeldung
let regMode = false;
function setMode(reg) {
  regMode = reg;
  $('tabLogin').classList.toggle('on', !reg); $('tabReg').classList.toggle('on', reg);
  $('regOnly').hidden = !reg;
  $('authTitle').textContent = reg ? 'Konto erstellen' : 'Willkommen zurück';
  $('authSub').textContent = reg ? 'Wähle einen Benutzernamen – darüber finden dich deine Freunde.' : 'Melde dich an, um mit deinen Freunden zu schreiben und zu telefonieren.';
  $('authBtn').textContent = reg ? 'KONTO ERSTELLEN' : 'ANMELDEN';
  $('aPass').autocomplete = reg ? 'new-password' : 'current-password';
  authMsg('');
}
function authMsg(s, ok) { $('authMsg').textContent = s || ''; $('authMsg').className = 'msgline' + (ok ? ' ok' : ''); }
function status(s) { if (me) conn(s); else authMsg(s, true); }
$('tabLogin').onclick = () => setMode(false);
$('tabReg').onclick = () => setMode(true);
$('authForm').onsubmit = async e => {
  e.preventDefault();
  const u = $('aUser').value.trim(), pw = $('aPass').value;
  if (!NAME_RE.test(u)) return authMsg('Benutzername: 3–20 Zeichen, nur Buchstaben, Ziffern, _ . -');
  if (regMode) {
    if (pw.length < 8) return authMsg('Das Passwort braucht mindestens 8 Zeichen.');
    if (pw !== $('aPass2').value) return authMsg('Die Passwörter stimmen nicht überein.');
    if (!$('aAge').checked) return authMsg('Für SPARK Chat musst du mindestens 16 Jahre alt sein.');
    if (!$('aAgree').checked) return authMsg('Bitte akzeptiere die Nutzungsbedingungen und die Datenschutzerklärung.');
  } else if (!pw) return authMsg('Bitte Passwort eingeben.');
  $('authBtn').disabled = true;
  try {
    authMsg('Verbinde …', true);
    await connectRetry();
    stayLogged = $('aStay').checked;
    let salt;
    if (regMode) salt = hex(rnd(16));
    else { send({ t: 'salt', u }); salt = (await waitFor('salt')).salt; }
    authMsg('Schlüssel werden berechnet …', true);
    const keys = await deriveKeys(u, pw, salt);
    const helloP = waitFor('hello');
    pendingKeys = keys;
    if (regMode) {
      authMsg('Erstelle dein Schlüsselpaar …', true);
      const kp = await C.generateKey(ECDH, true, ['deriveBits']);
      const pub = b64(await C.exportKey('raw', kp.publicKey)), encPriv = await wrapPriv(kp.privateKey, keys.wrapRaw);
      send({ t: 'register', u, salt, auth: keys.auth, pub, encPriv, agree: true });
    } else send({ t: 'login', u, auth: keys.auth });
    await helloP;
    $('aPass').value = $('aPass2').value = '';
  } catch (err) {
    pendingKeys = null;
    authMsg(err.message);
  }
  $('authBtn').disabled = false;
};
async function onHello(m, keys) {
  const key = m.me.u.toLowerCase(), same = me && me.key === key;
  const priv = await unwrapPriv(m.me.encPriv, keys.wrapRaw);
  wantAv(m.me.u, m.me.av || 0);
  me = { u: m.me.u, key, auth: keys.auth, wrapRaw: keys.wrapRaw, priv, pub: m.me.pub, salt: m.me.salt, invisible: !!m.me.invisible, created: m.me.created, encPrivRaw: m.me.encPriv };
  manualClose = false;
  if (!same) {
    shared.clear(); hist.clear(); friends.clear(); sel = null;
    histKey = await hkdfKey(keys.wrapRaw, 'spark-chat/history/v1');
    pins = lsGet('sparkchat.pin.' + key, {});
    Object.assign(unread, lsGet('sparkchat.unread.' + key, {}));
    await loadHist();
    saveLogin();
    showApp();
  }
  conn('');
  renderMe();
  // Nachrichten, die noch nicht zugestellt wurden, nochmal schicken (der Server merkt sie sich nur im Arbeitsspeicher)
  setTimeout(resendPending, 400);
}
// Angemeldet bleiben: im SPARK-Launcher von Windows verschlüsselt, im Browser im Speicher dieses Geräts
// (nur wenn gewünscht – sonst nur bis der Tab geschlossen wird)
function saveLogin() {
  const d = JSON.stringify({ u: me.u, auth: me.auth, wrap: hex(me.wrapRaw) });
  clearLogin(true);
  if (stayLogged && SPARK && SPARK.vault) SPARK.vault.set('chat', d);
  else if (stayLogged) try { localStorage.setItem('sparkchat.keep', d); } catch (e) {}
  else try { sessionStorage.setItem('sparkchat.s', d); } catch (e) {}
}
function clearLogin(keepVault) {
  if (!keepVault && SPARK && SPARK.vault) SPARK.vault.del('chat');
  try { localStorage.removeItem('sparkchat.keep'); sessionStorage.removeItem('sparkchat.s'); } catch (e) {}
}
function showApp() { $('auth').hidden = true; $('app').hidden = false; renderAll(); updateActivity(); }
async function logout(msg, ok) {
  manualClose = true; clearTimeout(retryT);
  if (call) endCall(true);
  send({ t: 'logout' });
  try { if (ws) ws.close(); } catch (e) {}
  ws = null; me = null; histKey = null; friends.clear(); hist.clear(); shared.clear(); sel = null;
  for (const k of Object.keys(unread)) delete unread[k];
  clearLogin();
  closeModal();
  $('app').hidden = true; $('auth').hidden = false; setMode(false);
  if (msg) authMsg(msg, ok);
  document.title = 'SPARK Chat';
}
// Gespeicherte Anmeldung (Windows-geschützt im SPARK-Launcher, sonst nur bis das Fenster zu ist)
async function autoLogin() {
  let saved = null;
  try { saved = SPARK && SPARK.vault ? await SPARK.vault.get('chat') : null; } catch (e) {}
  if (saved) stayLogged = true;
  if (!saved) try { saved = sessionStorage.getItem('sparkchat.s'); } catch (e) {}
  if (!saved) try { saved = localStorage.getItem('sparkchat.keep'); if (saved) stayLogged = true; } catch (e) {}
  if (!saved) return;
  let d; try { d = JSON.parse(saved); } catch (e) { return; }
  $('aUser').value = d.u || '';
  $('authBtn').disabled = true;
  for (let tries = 0; tries < 4; tries++) {
    try {
      authMsg('Melde an …', true);
      await connectRetry();
      const helloP = waitFor('hello');
      pendingKeys = { auth: d.auth, wrapRaw: unhex(d.wrap) };
      send({ t: 'login', u: d.u, auth: d.auth });
      await helloP;
      break;
    } catch (err) {
      pendingKeys = null;
      if (err.auth) { clearLogin(); authMsg(err.message + ' Bitte neu anmelden.'); break; }
      authMsg(err.message);
      if (!err.retry) break;
      await new Promise(r => setTimeout(r, 8000));
    }
  }
  $('authBtn').disabled = false;
}

// ---------- Freunde
function onSocial(m) {
  const old = friends; friends = new Map();
  for (const f of m.friends) {
    const key = f.u.toLowerCase(), o = old.get(key);
    const e = { key, u: f.u, pub: f.pub, on: f.on, act: f.act || '', warn: false, av: f.av || 0 };
    wantAv(f.u, e.av);
    if (o && o.pub === f.pub) e.warn = o.warn;
    if (!pins[key]) pins[key] = f.pub;
    else if (pins[key] !== f.pub) e.warn = true;
    friends.set(key, e);
    if (shared.has(key) && shared.get(key).pub !== f.pub) shared.delete(key);
  }
  lsSet('sparkchat.pin.' + me.key, pins);
  inReq = m.inReq; outReq = m.outReq; blocked = m.blocked;
  if (sel && !friends.has(sel)) { sel = null; }
  renderAll();
}
$('addForm').onsubmit = e => {
  e.preventDefault();
  const u = $('addName').value.trim();
  if (!NAME_RE.test(u)) return toast('Gib den genauen Benutzernamen deines Freundes ein.');
  if (me && u.toLowerCase() === me.key) return toast('Das bist du selbst 🙂');
  send({ t: 'freq', u }); $('addName').value = '';
};
const hue = s => { let h = 0; for (const c of String(s).toLowerCase()) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
// Profilbilder: nur Freunde bekommen sie vom Server; hier zwischengespeichert (Name → {v, img})
let avCache = lsGet('sparkchat.av', {});
const avImg = s => { const a = avCache[String(s).toLowerCase()]; return a && a.img ? a.img : ''; };
const avStyle = s => avImg(s) ? 'background:#111 url(data:image/jpeg;base64,' + avImg(s) + ') center/cover' : 'background:linear-gradient(135deg,hsl(' + hue(s) + ',95%,68%),hsl(' + ((hue(s) + 40) % 360) + ',90%,52%))';
const avLetter = s => avImg(s) ? '' : esc(String(s)[0].toUpperCase());
const avHtml = (s, extra) => '<div class="avw"><div class="av" style="' + avStyle(s) + '">' + avLetter(s) + '</div>' + (extra || '') + '</div>';
function setAv(el, s) { el.innerHTML = avLetter(s); el.setAttribute('style', avStyle(s)); }
function wantAv(name, v) {
  const k = String(name).toLowerCase(), c = avCache[k];
  if (!v) { if (c) { delete avCache[k]; lsSet('sparkchat.av', avCache); return true; } return false; }
  if (!c || c.v !== v) send({ t: 'getav', u: name });
  return false;
}
function stOf(f) { return !f.on ? ['Offline', ''] : f.act ? [f.act, 'play'] : ['Online', 'on']; }
function lastTs(k) { const h = hist.get(k); return h && h.length ? h[h.length - 1].ts : 0; }
function renderFriends() {
  const list = [...friends.values()].sort((a, b) => (b.on - a.on) || (lastTs(b.key) - lastTs(a.key)) || a.u.localeCompare(b.u));
  $('frCount').textContent = list.filter(f => f.on).length + ' / ' + list.length + ' online';
  $('friends').innerHTML = list.length ? list.map(f => {
    const [st, cls] = stOf(f), n = unread[f.key] || 0;
    return '<button class="fr' + (f.key === sel ? ' sel' : '') + '" data-k="' + esc(f.key) + '">' + avHtml(f.u, '<div class="pd ' + cls + '"></div>') +
      '<div class="meta"><div class="nm">' + esc(f.u) + (f.warn ? ' ⚠' : '') + '</div><div class="st ' + cls + '">' + esc(st) + '</div></div>' + (n ? '<div class="unread">' + (n > 99 ? '99+' : n) + '</div>' : '') + '</button>';
  }).join('') : '<div class="empty-side">Noch keine Freunde.<br>Gib oben den Benutzernamen eines Freundes ein.</div>';
  for (const b of $('friends').querySelectorAll('.fr')) b.onclick = () => openChat(b.dataset.k);
  let rq = '';
  if (inReq.length) rq += '<div class="label" style="padding:14px 10px 6px;display:block;color:var(--amber)">Anfragen · ' + inReq.length + '</div>' + inReq.map(u => '<div class="req">' + avHtml(u) + '<div class="nm">' + esc(u) + '</div><button class="ico yes" data-yes="' + esc(u) + '" title="Annehmen">✔</button><button class="ico no" data-no="' + esc(u) + '" title="Ablehnen">✖</button></div>').join('');
  if (outReq.length) rq += '<div class="label" style="padding:14px 10px 6px;display:block">Gesendet · ' + outReq.length + '</div>' + outReq.map(u => '<div class="req">' + avHtml(u) + '<div class="nm" style="color:var(--dim)">' + esc(u) + '</div><button class="ico no" data-cancel="' + esc(u) + '" title="Anfrage zurückziehen">✖</button></div>').join('');
  $('reqBox').innerHTML = rq;
  for (const b of $('reqBox').querySelectorAll('[data-yes]')) b.onclick = () => send({ t: 'fans', u: b.dataset.yes, yes: true });
  for (const b of $('reqBox').querySelectorAll('[data-no]')) b.onclick = () => send({ t: 'fans', u: b.dataset.no, yes: false });
  for (const b of $('reqBox').querySelectorAll('[data-cancel]')) b.onclick = () => send({ t: 'fcancel', u: b.dataset.cancel });
  const total = Object.values(unread).reduce((s, n) => s + n, 0);
  document.title = (total ? '(' + total + ') ' : '') + 'SPARK Chat';
}
function renderMe() {
  if (!me) return;
  $('meName').textContent = me.u;
  setAv($('meAv'), me.u);
  $('meSt').textContent = me.invisible ? 'Unsichtbar' : actNow || 'Online';
  $('meSt').style.color = me.invisible ? 'var(--faint)' : actNow ? 'var(--amber)' : '';
  $('mePd').className = 'pd ' + (me.invisible ? '' : actNow ? 'play' : 'on');
}
function renderAll() { renderMe(); renderFriends(); renderChat(); }

// ---------- Chat
function openChat(k) {
  sel = k; unread[k] = 0; lsSet('sparkchat.unread.' + me.key, unread);
  $('app').classList.add('chatting');
  renderFriends(); renderChat();
  setTimeout(() => $('text').focus(), 0);
}
$('back').onclick = () => { sel = null; $('app').classList.remove('chatting'); renderFriends(); renderChat(); };
function renderChat() {
  const f = sel && friends.get(sel);
  $('welcome').hidden = !!f; $('chat').hidden = !f;
  if (!f) return;
  renderHead(); renderMsgs(); renderTyping();
}
function renderHead() {
  const f = friends.get(sel); if (!f) return;
  const [st, cls] = stOf(f);
  $('cName').textContent = f.u;
  setAv($('cAv'), f.u);
  $('cPd').className = 'pd ' + cls;
  $('cSt').textContent = st; $('cSt').className = 'st ' + cls;
  $('cCall').disabled = !f.on || !!call;
  $('cCall').title = f.on ? 'Sprachanruf' : f.u + ' ist offline';
  $('keyWarn').hidden = !f.warn;
  if (f.warn) {
    $('keyWarn').innerHTML = '⚠ <b>Der Sicherheitsschlüssel von ' + esc(f.u) + ' hat sich geändert.</b> Das passiert, wenn das Konto gelöscht und neu erstellt wurde. Frag ' + esc(f.u) + ' persönlich, ob das stimmt, und vergleicht die Sicherheitsnummer. <button class="sec" id="keyOk" style="height:30px;margin-left:8px">Neuen Schlüssel bestätigen</button>';
    $('keyOk').onclick = () => { pins[f.key] = f.pub; lsSet('sparkchat.pin.' + me.key, pins); f.warn = false; renderHead(); renderFriends(); };
  }
}
const linkify = s => esc(s).replace(/\bhttps?:\/\/[^\s<>&]+(?:&amp;[^\s<>&]+)*/g, u => '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + u + '</a>');
const hm = ts => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
function dayLabel(ts) {
  const d = new Date(ts), t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((t - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  return diff === 0 ? 'HEUTE' : diff === 1 ? 'GESTERN' : d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }).toUpperCase();
}
const ST_ICON = { send: ['s-wait', '◌'], wait: ['s-wait', '⏳ wartet'], dlv: ['s-dlv', '✓✓'], fail: ['s-fail', '✖ nicht gesendet'] };
function renderMsgs() {
  const f = friends.get(sel); if (!f) return;
  const box = $('msgs'), atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const h = hist.get(sel) || [];
  let out = '<div class="e2e">🔒 Nachrichten und Anrufe mit ' + esc(f.u) + ' sind Ende-zu-Ende-verschlüsselt. Der Verlauf liegt nur auf deinen Geräten.</div>', lastDay = '', last = null;
  for (const e of h) {
    const d = dayLabel(e.ts); if (d !== lastDay) { out += '<div class="day">' + d + '</div>'; lastDay = d; last = null; }
    if (e.k === 'inv') {
      const old = Date.now() - e.ts > 3 * 3600e3;
      out += '<div class="inv' + (e.me ? ' mine' : '') + '"><span class="label">// Einladung · ' + esc(e.game === 'blackout' ? 'BLACKOUT' : e.game) + '</span><b>' + (e.me ? 'Du hast ' + esc(f.u) + ' eingeladen' : esc(f.u) + ' lädt dich ein') + '</b><div class="code">RAUM ' + esc(e.code) + '</div>' +
        (!e.me ? '<button class="btn ok" data-join="' + esc(e.code) + '"' + (old ? ' disabled title="Einladung ist abgelaufen"' : '') + '>' + (old ? 'ABGELAUFEN' : '▶ BEITRETEN') + '</button>' : '') +
        '<span class="tm">' + hm(e.ts) + (e.me ? ' · <span class="' + ST_ICON[e.st || 'dlv'][0] + '">' + ST_ICON[e.st || 'dlv'][1] + '</span>' : '') + '</span></div>';
      last = null; continue;
    }
    if (e.k === 'sys') { out += '<div class="sysm">' + esc(e.text) + ' · ' + hm(e.ts) + '</div>'; last = null; continue; }
    if (e.k === 'img') {
      const w = Math.min(300, e.w || 300), hh = Math.round(w * (e.h || 200) / (e.w || 300));
      out += '<div class="m pic' + (e.me ? ' mine' : '') + ' gap"><img data-img="' + esc(e.id) + '" alt="Bild" style="width:' + w + 'px;aspect-ratio:' + (e.w || 3) + '/' + (e.h || 2) + ';max-height:' + Math.max(hh, 60) + 'px">' +
        '<span class="tm">' + hm(e.ts) + (e.me ? ' <span class="' + ST_ICON[e.st || 'dlv'][0] + '">' + ST_ICON[e.st || 'dlv'][1] + '</span>' : '') + '</span></div>';
      last = null; continue;
    }
    const gap = !last || last.me !== e.me || e.ts - last.ts > 5 * 60000;
    out += '<div class="m' + (e.me ? ' mine' : '') + (gap ? ' gap' : '') + '">' + linkify(e.text) + '<span class="tm">' + hm(e.ts) + (e.me ? ' <span class="' + ST_ICON[e.st || 'dlv'][0] + '">' + ST_ICON[e.st || 'dlv'][1] + '</span>' : '') + '</span></div>';
    last = e;
  }
  box.innerHTML = out;
  for (const b of box.querySelectorAll('[data-join]')) b.onclick = () => joinGame(b.dataset.join);
  const fk = sel;
  for (const im of box.querySelectorAll('img[data-img]')) {
    imgUrl(fk, im.dataset.img).then(u => { if (u) { im.src = u; im.onload = () => { if (atBottom || box.dataset.for !== fk) box.scrollTop = box.scrollHeight; }; } else im.alt = 'Bild nicht mehr vorhanden'; });
    im.onclick = () => im.src && showImage(im.src);
  }
  if (atBottom || box.dataset.for !== sel) box.scrollTop = box.scrollHeight;
  box.dataset.for = sel;
}
function renderTyping() { const f = sel && friends.get(sel); $('typing').textContent = f && typingT[f.key] ? f.u + ' schreibt …' : ''; }
$('text').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('compose').requestSubmit(); } });
$('text').addEventListener('input', () => {
  const t = $('text'); t.style.height = 'auto'; t.style.height = Math.min(160, t.scrollHeight + 2) + 'px';
  const f = sel && friends.get(sel);
  if (f && f.on && Date.now() - lastTyping > 3000) { lastTyping = Date.now(); send({ t: 'typing', u: f.u }); }
});
$('compose').onsubmit = e => {
  e.preventDefault();
  const text = $('text').value.trim();
  if (!text || !sel) return;
  if (text.length > 4000) return toast('Die Nachricht ist zu lang (max. 4000 Zeichen).');
  $('text').value = ''; $('text').style.height = 'auto'; lastTyping = 0;
  sendMsg(sel, { k: 'text', text });
};
const rid = () => hex(rnd(9));
function sendMsg(fk, body, id) {
  const e = Object.assign({ id: id || rid(), me: true, ts: Date.now(), st: 'send', fk }, body);
  pushHist(fk, e);
  transmit(fk, e);
  if (fk === sel) renderMsgs();
  renderFriends();
}
async function transmit(fk, e) {
  const f = friends.get(fk); if (!f || !wsReady()) return;
  try {
    let body;
    if (e.k === 'inv') body = { k: 'inv', game: e.game, code: e.code };
    else if (e.k === 'img') { const bytes = await imgGet(fk, e.id); if (!bytes) throw new Error('Bild fehlt'); body = { k: 'img', data: b64(bytes), w: e.w, h: e.h }; }
    else body = { k: 'text', text: e.text };
    const ct = await encWith((await sharedKey(fk)).msgKey, te.encode(JSON.stringify(body)), me.key + '>' + fk + '|' + e.id);
    send({ t: 'msg', u: f.u, id: e.id, iv: b64(ct.subarray(0, 12)), ct: b64(ct.subarray(12)) });
  } catch (err) { e.st = 'fail'; saveHist(fk); if (fk === sel) renderMsgs(); }
}
function resendPending() {
  const cut = Date.now() - 6 * 864e5;
  for (const [fk, h] of hist) { if (!friends.has(fk)) continue; for (const e of h) if (e.me && (e.st === 'send' || e.st === 'wait') && e.ts > cut) transmit(fk, e); }
}
async function onMessage(m) {
  const fk = String(m.from).toLowerCase(), f = friends.get(fk);
  if (!f || !me) return;
  const h = hist.get(fk) || [];
  if (h.some(e => e.id === m.id)) return;   // doppelt (z. B. nach Neuverbindung)
  let body;
  try { body = JSON.parse(td.decode(await decWith((await sharedKey(fk)).msgKey, cat(unb64(m.iv), unb64(m.ct)), fk + '>' + me.key + '|' + m.id))); }
  catch (e) { body = { k: 'sys', text: '⚠ Eine Nachricht von ' + f.u + ' konnte nicht entschlüsselt werden' }; }
  const e = { id: m.id, me: false, ts: Math.min(Date.now(), m.ts || Date.now()), fk };
  if (body.k === 'inv' && /^[A-Z0-9]{3,8}$/.test(body.code || '')) Object.assign(e, { k: 'inv', game: 'blackout', code: body.code });
  else if (body.k === 'sys') Object.assign(e, { k: 'sys', text: body.text });
  else if (body.k === 'img' && typeof body.data === 'string') {
    const bytes = unb64(body.data);
    if (bytes.length > MAX_IMG * 1.1 || bytes[0] !== 0xff || bytes[1] !== 0xd8) Object.assign(e, { k: 'sys', text: '⚠ Ungültiges Bild von ' + f.u + ' verworfen' });
    else { await imgPut(fk, m.id, bytes); Object.assign(e, { k: 'img', w: Math.min(4000, body.w | 0), h: Math.min(4000, body.h | 0) }); }
  }
  else Object.assign(e, { k: 'text', text: String(body.text || '').slice(0, 4000) });
  pushHist(fk, e);
  const seen = sel === fk && document.hasFocus() && !$('app').hidden;
  if (!seen) { unread[fk] = (unread[fk] || 0) + 1; lsSet('sparkchat.unread.' + me.key, unread); }
  if (!seen || !document.hasFocus()) {
    notify(f.u, e.k === 'inv' ? '🎮 Einladung zu BLACKOUT – Raum ' + e.code : e.k === 'img' ? '📷 Bild' : e.text || '', fk);
    blip(e.k === 'inv' ? [523, 659, 784] : [740, 988], .07);
  }
  delete typingT[fk];
  if (fk === sel) { renderMsgs(); renderTyping(); }
  renderFriends();
}
window.addEventListener('focus', () => { if (sel && unread[sel]) { unread[sel] = 0; lsSet('sparkchat.unread.' + me.key, unread); renderFriends(); } });
async function sharedKey(fk) {
  const f = friends.get(fk); if (!f) throw new Error('Kein Freund');
  const c = shared.get(fk); if (c && c.pub === f.pub) return c;
  const theirs = await C.importKey('raw', unb64(f.pub), ECDH, false, []);
  const bits = new Uint8Array(await C.deriveBits({ name: 'ECDH', public: theirs }, me.priv, 256));
  const pair = [me.key, fk].sort().join('|');
  const e = { pub: f.pub, bits, pair, msgKey: await hkdfKey(bits, 'spark-chat/dm/v1', pair) };
  shared.set(fk, e); return e;
}

// ---------- Verlauf: nur auf diesem PC, verschlüsselt
function pushHist(fk, e) { const h = hist.get(fk) || []; h.push(e); if (h.length > 400) h.splice(0, h.length - 400); hist.set(fk, h); saveHist(fk); }
function findMsg(id, fk) { const h = hist.get(fk); if (h) { const e = h.find(x => x.id === id); if (e) return e; } for (const h2 of hist.values()) { const e = h2.find(x => x.id === id); if (e) return e; } return null; }
const saveT = {};
function saveHist(fk) {
  clearTimeout(saveT[fk]);
  saveT[fk] = setTimeout(async () => {
    if (!me || !histKey) return;
    const data = (hist.get(fk) || []).map(({ fk: _, ...r }) => r);
    try { localStorage.setItem('sparkchat.h.' + me.key + '.' + fk, b64(await encWith(histKey, te.encode(JSON.stringify(data))))); } catch (e) { console.warn('Verlauf nicht gespeichert', e); }
  }, 400);
}
async function loadHist() {
  const pre = 'sparkchat.h.' + me.key + '.';
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith(pre)) continue;
    const fk = k.slice(pre.length);
    try { hist.set(fk, JSON.parse(td.decode(await decWith(histKey, unb64(localStorage.getItem(k))))).map(e => Object.assign(e, { fk }))); } catch (e) {}
  }
}
// Bilder: verschlüsselt in der Gerätedatenbank (IndexedDB) – localStorage wäre dafür zu klein
const MAX_IMG = 420 * 1024;
let idbP = null;
function idb() { return idbP || (idbP = new Promise((res, rej) => { const r = indexedDB.open('sparkchat', 1); r.onupgradeneeded = () => r.result.createObjectStore('img'); r.onsuccess = () => res(r.result); r.onerror = () => { idbP = null; rej(r.error); }; })); }
async function idbDo(mode, fn) { const db = await idb(); return new Promise((res, rej) => { const tx = db.transaction('img', mode), r = fn(tx.objectStore('img')); tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); }); }
const imgKey = (fk, id) => me.key + '|' + fk + '|' + id;
async function imgPut(fk, id, bytes) { const enc = await encWith(histKey, bytes); await idbDo('readwrite', st => st.put(enc, imgKey(fk, id))); }
const urlCache = new Map();
async function imgGet(fk, id) { try { const enc = await idbDo('readonly', st => st.get(imgKey(fk, id))); return enc ? await decWith(histKey, new Uint8Array(enc)) : null; } catch (e) { return null; } }
async function imgUrl(fk, id) {
  const k = imgKey(fk, id); if (urlCache.has(k)) return urlCache.get(k);
  const b = await imgGet(fk, id); if (!b) return '';
  const u = URL.createObjectURL(new Blob([b], { type: 'image/jpeg' })); urlCache.set(k, u); return u;
}
async function imgDel(prefix) { try { await idbDo('readwrite', st => st.delete(IDBKeyRange.bound(prefix, prefix + '\uffff'))); } catch (e) {} for (const k of urlCache.keys()) if (k.startsWith(prefix)) { URL.revokeObjectURL(urlCache.get(k)); urlCache.delete(k); } }
// Nach Passwortwechsel: alle Bilder mit dem neuen Schlüssel neu verschlüsseln
async function imgRekey(oldKey, newKey) {
  const pre = me.key + '|', db = await idb();
  const all = await new Promise((res, rej) => { const out = [], tx = db.transaction('img', 'readonly'), r = tx.objectStore('img').openCursor(IDBKeyRange.bound(pre, pre + '\uffff')); r.onsuccess = () => { const c = r.result; if (c) { out.push([c.key, c.value]); c.continue(); } else res(out); }; r.onerror = () => rej(r.error); });
  for (const [k, v] of all) { try { const plain = await decWith(oldKey, new Uint8Array(v)); const enc = await encWith(newKey, plain); await idbDo('readwrite', st => st.put(enc, k)); } catch (e) {} }
}
// Bild verkleinern und als JPEG kodieren (Größe begrenzt, EXIF/Standort fällt dabei weg)
async function prepImage(file, max, maxBytes, square) {
  if (!file || !/^image\//.test(file.type)) throw new Error('Das ist kein Bild.');
  if (file.size > 40 * 1024 * 1024) throw new Error('Das Bild ist zu groß (max. 40 MB).');
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) { src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Bild konnte nicht gelesen werden.')); i.src = URL.createObjectURL(file); }); }
  const W = src.width, H = src.height;
  let size = max, q = 0.82;
  for (let i = 0; i < 6; i++) {
    let sx = 0, sy = 0, sw = W, sh = H;
    if (square) { const m = Math.min(W, H); sx = (W - m) / 2; sy = (H - m) / 2; sw = sh = m; }
    const s = Math.min(1, size / Math.max(sw, sh)), w = Math.max(1, Math.round(sw * s)), h = Math.max(1, Math.round(sh * s));
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
    const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size <= maxBytes) return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h };
    size = Math.round(size * 0.8); q = Math.max(0.5, q - 0.07);
  }
  throw new Error('Das Bild lässt sich nicht klein genug machen.');
}
async function sendImage(fk, file) {
  if (!friends.has(fk)) return;
  try {
    toast('Bild wird vorbereitet …', true);
    const { bytes, w, h } = await prepImage(file, 1600, MAX_IMG);
    const id = rid();
    await imgPut(fk, id, bytes);
    sendMsg(fk, { k: 'img', w, h }, id);
    $('toast').className = 'toast';
  } catch (e) { toast(e.message); }
}
function showImage(url) {
  openModal('<span class="label">// Bild</span><img src="' + url + '" alt="Bild" style="display:block;max-width:100%;max-height:70vh;margin:10px auto 14px"><div class="btnrow"><a class="sec" style="display:inline-flex;align-items:center;text-decoration:none" href="' + url + '" download="spark-chat-bild.jpg">⬇ Speichern</a></div>', true);
}
function clearHist(fk) {
  imgDel(me.key + '|' + (fk ? fk + '|' : ''));
  const pre = 'sparkchat.h.' + me.key + '.';
  for (const k of Object.keys(localStorage)) if (k.startsWith(pre) && (!fk || k === pre + fk)) localStorage.removeItem(k);
  if (fk) hist.delete(fk); else hist.clear();
  renderAll();
}

// ---------- Menü & Fenster
function showMenu(anchor, items) {
  const m = $('menu');
  m.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : '<button data-i="' + i + '" class="' + (it.danger ? 'danger' : '') + '">' + it.label + '</button>').join('');
  m.hidden = false;
  const r = anchor.getBoundingClientRect();
  m.style.top = Math.min(innerHeight - m.offsetHeight - 8, r.bottom + 6) + 'px';
  m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth)) + 'px';
  for (const b of m.querySelectorAll('button')) b.onclick = () => { m.hidden = true; items[+b.dataset.i].fn(); };
}
document.addEventListener('mousedown', e => { if (!$('menu').hidden && !$('menu').contains(e.target) && e.target.id !== 'cMore') $('menu').hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('menu').hidden = true; closeModal(); } });
function openModal(html, wide) {
  $('sheet').style.width = wide ? 'min(720px,100%)' : '';
  $('sheet').innerHTML = '<button class="ico x" data-close>✕</button>' + html;
  $('modal').classList.add('open');
  for (const b of $('sheet').querySelectorAll('[data-close]')) b.onclick = closeModal;
  bindLinks($('sheet'));
}
let modalTick = null;
function closeModal() { $('modal').classList.remove('open'); clearInterval(modalTick); modalTick = null; }
$('modal').addEventListener('mousedown', e => { if (e.target === $('modal')) closeModal(); });
function bindLinks(root) { for (const a of root.querySelectorAll('[data-link]')) a.onclick = e => { e.preventDefault(); window.open(LINKS[a.dataset.link], '_blank'); }; }
bindLinks(document);

$('cMore').onclick = () => {
  const f = friends.get(sel); if (!f) return;
  showMenu($('cMore'), [
    { label: '🔐 Sicherheitsnummer anzeigen', fn: () => showSafety(f) },
    { label: '🗑 Verlauf auf diesem PC löschen', fn: () => { clearHist(f.key); toast('Verlauf gelöscht.', true); } },
    '-',
    { label: '🚩 Melden', fn: () => showReport(f) },
    { label: '⛔ Blockieren', danger: true, fn: () => confirmBox('⛔ ' + esc(f.u) + ' blockieren?', esc(f.u) + ' wird als Freund entfernt und kann dir keine Anfragen, Nachrichten oder Anrufe mehr schicken. ' + esc(f.u) + ' erfährt davon nichts.', 'BLOCKIEREN', () => send({ t: 'block', u: f.u, on: true })) },
    { label: '✖ Als Freund entfernen', danger: true, fn: () => confirmBox('Freundschaft beenden?', esc(f.u) + ' wird aus deiner Freundesliste entfernt. Ihr könnt euch danach keine Nachrichten mehr schicken.', 'ENTFERNEN', () => send({ t: 'unfriend', u: f.u })) },
  ]);
};
function confirmBox(title, text, btn, fn) {
  openModal('<h2>' + title + '</h2><p style="color:#cdd3e1">' + text + '</p><div class="btnrow"><button class="btn red" id="cfOk">' + btn + '</button><button class="sec" data-close>Abbrechen</button></div>');
  $('cfOk').onclick = () => { closeModal(); fn(); };
}
async function showSafety(f) {
  const a = [me.pub, f.pub].sort().join('|'), h = new Uint8Array(await C.digest('SHA-256', te.encode(a)));
  const groups = []; for (let i = 0; i < 6; i++) groups.push(String(((h[i * 3] << 16) | (h[i * 3 + 1] << 8) | h[i * 3 + 2]) % 100000).padStart(5, '0'));
  openModal('<span class="label">// Verschlüsselung prüfen</span><h2>🔐 SICHERHEITS<span>NUMMER</span></h2><p style="color:#cdd3e1">Vergleiche diese Nummer mit ' + esc(f.u) + ' – am besten persönlich oder im Anruf. Wenn sie bei euch beiden gleich ist, kann niemand (auch nicht der Server) mitlesen.</p><div class="safety">' + groups.slice(0, 3).join(' ') + '<br>' + groups.slice(3).join(' ') + '</div>');
}
const REASONS = ['Belästigung oder Mobbing', 'Hass, Hetze oder Diskriminierung', 'Drohung oder Gewalt', 'Sexuelle Inhalte / Belästigung', 'Spam oder Betrug', 'Illegale Inhalte', 'Gefährdung von Kindern/Jugendlichen', 'Sonstiges'];
function showReport(f) {
  openModal('<span class="label">// Inhalte melden</span><h2>🚩 ' + esc(f.u) + ' <span>MELDEN</span></h2>' +
    '<label class="field"><span>Grund</span><select class="inp" id="rpWhy">' + REASONS.map(r => '<option>' + r + '</option>').join('') + '</select></label>' +
    '<label class="field"><span>Was ist passiert? (freiwillig)</span><textarea class="inp" id="rpText" rows="3" maxlength="2000"></textarea></label>' +
    '<label class="check"><input type="checkbox" id="rpMsgs" checked> <span>Die letzten 20 Nachrichten dieses Chats mitschicken. <small class="hint">Weil alles verschlüsselt ist, können wir Inhalte nur prüfen, wenn du sie mitschickst.</small></span></label>' +
    '<label class="check"><input type="checkbox" id="rpBlock" checked> <span>' + esc(f.u) + ' außerdem blockieren</span></label>' +
    '<p class="hint">Bei akuter Gefahr wende dich sofort an die Polizei (110). Hilfe für Jugendliche: Nummer gegen Kummer 116 111.</p>' +
    '<div class="btnrow"><button class="btn red" id="rpGo">MELDUNG SENDEN</button><button class="sec" data-close>Abbrechen</button></div>');
  $('rpGo').onclick = () => {
    const msgs = $('rpMsgs').checked ? (hist.get(f.key) || []).filter(e => e.k === 'text').slice(-20).map(e => ({ from: e.me ? me.u : f.u, text: e.text, ts: e.ts })) : [];
    send({ t: 'report', u: f.u, reason: $('rpWhy').value, text: $('rpText').value.trim(), msgs });
    if ($('rpBlock').checked) send({ t: 'block', u: f.u, on: true });
    closeModal();
  };
}

// ---------- Einstellungen
$('gear').onclick = $('gear2').onclick = () => showSettings();
function sw(id, on) { return '<button class="sw' + (on ? ' on' : '') + '" id="' + id + '"></button>'; }
function showSettings() {
  if (!me) return;
  openModal('<span class="label">// Einstellungen</span><h2>⚙ SPARK <span>CHAT</span></h2>' +
    '<div class="grp"><span class="label">// Konto</span><div class="row"><div><b>' + esc(me.u) + '</b><small>Mitglied seit ' + esc(me.created ? new Date(me.created).toLocaleDateString('de-DE') : '–') + '</small></div>' + avHtml(me.u) + '</div>' +
    '<div class="row"><div><b>Profilbild</b><small>Sehen nur deine Freunde.</small></div><div class="btnrow" style="margin:0"><button class="sec" id="avSet" style="height:34px">📷 Ändern</button>' + (avImg(me.u) ? '<button class="sec danger" id="avDel" style="height:34px">Entfernen</button>' : '') + '</div></div>' +
    '<div class="row"><div><b>Unsichtbar</b><small>Freunde sehen dich als offline. Anrufe kommen dann nicht an.</small></div>' + sw('sInv', me.invisible) + '</div></div>' +
    '<div class="grp"><span class="label">// Benachrichtigungen</span><div class="row"><div><b>Desktop-Benachrichtigungen</b><small>Bei neuen Nachrichten, wenn das Fenster im Hintergrund ist</small></div>' + sw('sNot', prefs.notify) + '</div>' +
    '<div class="row"><div><b>Töne</b><small>Signalton bei Nachrichten und Anrufen</small></div>' + sw('sSnd', prefs.sound) + '</div></div>' +
    '<div class="grp"><span class="label">// Gesperrte Nutzer</span>' + (blocked.length ? blocked.map(u => '<div class="row"><b>' + esc(u) + '</b><button class="sec" data-unblock="' + esc(u) + '" style="height:32px">Aufheben</button></div>').join('') : '<small class="hint">Du hast niemanden blockiert.</small>') + '</div>' +
    '<div class="grp"><span class="label">// Sicherheit</span>' +
    '<label class="field"><span>Altes Passwort</span><input class="inp" type="password" id="pwOld" autocomplete="current-password"></label>' +
    '<label class="field"><span>Neues Passwort (min. 8 Zeichen)</span><input class="inp" type="password" id="pwNew" autocomplete="new-password"></label>' +
    '<label class="field"><span>Neues Passwort wiederholen</span><input class="inp" type="password" id="pwNew2" autocomplete="new-password"></label>' +
    '<div class="msgline" id="pwMsg"></div><div class="btnrow"><button class="sec" id="pwGo">Passwort ändern</button><button class="sec" id="sOut">Abmelden</button></div></div>' +
    '<div class="grp"><span class="label">// Deine Daten</span><div class="btnrow"><button class="sec" id="sData">📄 Meine Daten anzeigen</button><button class="sec" id="sClear">🗑 Verläufe auf diesem PC löschen</button></div>' +
    '<div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.06)"><b style="color:#ffb4b4">Konto löschen</b><p class="hint" style="margin:4px 0 8px">Löscht dein Konto, deine Freundesliste und alle Daten auf dem Server sofort und endgültig.</p>' +
    '<div style="display:flex;gap:8px"><input class="inp" type="password" id="delPw" placeholder="Passwort zur Bestätigung" autocomplete="current-password"><button class="sec danger" id="sDel" style="flex:none;height:44px">Konto löschen</button></div><div class="msgline" id="delMsg"></div></div></div>' +
    '<div class="grp"><span class="label">// Rechtliches</span><div class="btnrow"><a href="#" class="sec" style="display:inline-flex;align-items:center;text-decoration:none" data-link="terms">Nutzungsbedingungen</a><a href="#" class="sec" style="display:inline-flex;align-items:center;text-decoration:none" data-link="privacy">Datenschutz</a><a href="#" class="sec" style="display:inline-flex;align-items:center;text-decoration:none" data-link="contact">Kontakt</a></div>' +
    '<p class="hint" style="margin:10px 0 0">SPARK Chat ' + VERSION + ' · Ende-zu-Ende-verschlüsselt (ECDH P-256 + AES-256-GCM)</p></div>', true);
  $('sInv').onclick = () => { send({ t: 'invisible', on: !me.invisible }); me.invisible = !me.invisible; $('sInv').classList.toggle('on', me.invisible); renderMe(); };
  $('sNot').onclick = () => { prefs.notify = !prefs.notify; lsSet('sparkchat.prefs', prefs); $('sNot').classList.toggle('on', prefs.notify); if (prefs.notify && window.Notification && Notification.permission === 'default') Notification.requestPermission(); };
  $('sSnd').onclick = () => { prefs.sound = !prefs.sound; lsSet('sparkchat.prefs', prefs); $('sSnd').classList.toggle('on', prefs.sound); };
  for (const b of $('sheet').querySelectorAll('[data-unblock]')) b.onclick = () => { send({ t: 'block', u: b.dataset.unblock, on: false }); b.closest('.row').remove(); };
  $('sOut').onclick = () => logout('Du wurdest abgemeldet.', true);
  $('avSet').onclick = () => pickFile(async file => {
    try { const { bytes } = await prepImage(file, 192, 22000, true); send({ t: 'avatar', img: b64(bytes) }); toast('Profilbild gespeichert.', true); setTimeout(showSettings, 600); }
    catch (e) { toast(e.message); }
  });
  if ($('avDel')) $('avDel').onclick = () => { send({ t: 'avatar', img: '' }); setTimeout(showSettings, 600); };
  $('sData').onclick = () => send({ t: 'mydata' });
  $('sClear').onclick = () => confirmBox('Verläufe löschen?', 'Alle Chatverläufe auf diesem PC werden gelöscht. Auf den Geräten deiner Freunde bleiben sie erhalten.', 'LÖSCHEN', () => { clearHist(); toast('Alle Verläufe auf diesem PC gelöscht.', true); });
  $('pwGo').onclick = changePw;
  $('sDel').onclick = deleteAccount;
}
let pwPending = null;
async function changePw() {
  const o = $('pwOld').value, n = $('pwNew').value, msg = s => { $('pwMsg').textContent = s; };
  if (n.length < 8) return msg('Das neue Passwort braucht mindestens 8 Zeichen.');
  if (n !== $('pwNew2').value) return msg('Die neuen Passwörter stimmen nicht überein.');
  msg('Schlüssel werden berechnet …');
  const old = await deriveKeys(me.u, o, me.salt);
  if (old.auth !== me.auth) return msg('Altes Passwort falsch.');
  const salt = hex(rnd(16)), keys = await deriveKeys(me.u, n, salt);
  pwPending = keys;
  send({ t: 'pw', auth: old.auth, salt, auth2: keys.auth, encPriv: await wrapPriv(await exportablePriv(), keys.wrapRaw) });
}
// Der private Schlüssel wird nicht exportierbar geladen – für die Neuverpackung einmal exportierbar entpacken
async function exportablePriv() {
  const d = await decWith(await aesKey(me.wrapRaw), unb64(me.encPrivRaw || ''));
  return C.importKey('pkcs8', d, ECDH, true, ['deriveBits']);
}
async function onPwOk(m) {
  if (!pwPending) return;
  const keys = pwPending; pwPending = null;
  me.auth = keys.auth; me.wrapRaw = keys.wrapRaw; me.salt = m.salt; me.encPrivRaw = m.encPriv;
  const oldHist = histKey;
  histKey = await hkdfKey(keys.wrapRaw, 'spark-chat/history/v1');
  for (const fk of hist.keys()) saveHist(fk);
  imgRekey(oldHist, histKey);   // Verlauf mit dem neuen Schlüssel neu verschlüsseln
  saveLogin();
  closeModal(); toast('Passwort geändert.', true);
}
async function deleteAccount() {
  const pw = $('delPw').value;
  if (!pw) { $('delMsg').textContent = 'Bitte gib dein Passwort ein.'; return; }
  const k = await deriveKeys(me.u, pw, me.salt);
  if (k.auth !== me.auth) { $('delMsg').textContent = 'Passwort falsch.'; return; }
  confirmBox('Konto endgültig löschen?', 'Das kann nicht rückgängig gemacht werden. Dein Benutzername wird frei und deine Freunde verlieren dich aus ihrer Liste.', 'ENDGÜLTIG LÖSCHEN', () => send({ t: 'delete', auth: k.auth }));
}
function showMyData(d) {
  const json = JSON.stringify(d, null, 2);
  openModal('<span class="label">// Auskunft nach Art. 15 DSGVO</span><h2>📄 MEINE <span>DATEN</span></h2><p class="hint">Das hat der Server über dich gespeichert. „pub“ ist dein öffentlicher Schlüssel, „encPriv“ dein privater Schlüssel – verschlüsselt mit deinem Passwort, der Server kann ihn nicht lesen. Deine Chatverläufe liegen nur auf deinen Geräten.</p><pre class="data">' + esc(json) + '</pre><div class="btnrow"><button class="sec" id="dlData">⬇ Als Datei speichern</button></div>', true);
  $('dlData').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); a.download = 'spark-chat-meine-daten.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
}

function pickFile(fn) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => { if (inp.files && inp.files[0]) fn(inp.files[0]); };
  inp.click();
}
$('attach').onclick = () => { const fk = sel; if (fk) pickFile(f => sendImage(fk, f)); };
$('text').addEventListener('paste', e => { const it = [...(e.clipboardData ? e.clipboardData.items : [])].find(i => i.type.startsWith('image/')); if (it && sel) { e.preventDefault(); sendImage(sel, it.getAsFile()); } });
$('chat').addEventListener('dragover', e => { if (sel) e.preventDefault(); });
$('chat').addEventListener('drop', e => { const f = e.dataTransfer && [...e.dataTransfer.files].find(x => x.type.startsWith('image/')); if (f && sel) { e.preventDefault(); sendImage(sel, f); } });

// ---------- BLACKOUT-Einladungen
async function currentRoom() { try { if (SPARK && SPARK.rooms) { const r = await SPARK.rooms(); return (r && r.blackout && r.blackout.room) || ''; } } catch (e) {} return ''; }
$('cInvite').onclick = async () => {
  const f = friends.get(sel); if (!f) return;
  const room = await currentRoom();
  const canLaunch = !!(SPARK && SPARK.launch);
  openModal('<span class="label">// Zu BLACKOUT einladen</span><h2>🎮 ' + esc(f.u) + ' <span>EINLADEN</span></h2>' +
    '<div id="invRoom"></div>' +
    '<label class="field" style="margin-top:12px"><span>Raum-Code (steht in BLACKOUT oben, wenn du hostest)</span><input class="inp" id="invCode" maxlength="8" style="text-transform:uppercase;font:700 18px var(--f-mono);letter-spacing:4px" value="' + esc(room) + '"></label>' +
    '<div class="btnrow"><button class="btn" id="invGo">EINLADUNG SENDEN</button>' + (canLaunch ? '<button class="sec" id="invStart">▶ BLACKOUT starten</button>' : '') + '</div>');
  const upd = r => { $('invRoom').innerHTML = r ? '<div class="warnbox" style="color:#c8ffe0;background:rgba(79,240,160,.08);box-shadow:inset 0 0 0 1px rgba(79,240,160,.35)">✔ Du bist gerade in BLACKOUT-Raum <b>' + esc(r) + '</b>.</div>' : '<p class="hint">Starte BLACKOUT und wähle <b>Online → Hosten</b>. ' + (canLaunch ? 'Der Raum-Code wird dann automatisch erkannt.' : 'Gib danach den Raum-Code hier ein.') + '</p>'; };
  upd(room);
  if (canLaunch) {
    $('invStart').onclick = async () => { const r = await SPARK.launch('blackout', {}); if (!r || !r.ok) toast((r && r.error) || 'BLACKOUT konnte nicht gestartet werden.'); };
    modalTick = setInterval(async () => { const r = await currentRoom(); if (r && r !== $('invCode').value) { $('invCode').value = r; upd(r); } }, 1500);
  }
  $('invGo').onclick = () => {
    const code = $('invCode').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!/^[A-Z0-9]{3,8}$/.test(code)) return toast('Bitte einen gültigen Raum-Code eingeben.');
    sendMsg(f.key, { k: 'inv', game: 'blackout', code });
    closeModal();
  };
};
async function joinGame(code) {
  if (SPARK && SPARK.launch) {
    const r = await SPARK.launch('blackout', { join: code });
    if (r && r.ok) { toast(r.running ? 'BLACKOUT läuft schon – gib dort unter Online → Beitreten den Code ' + code + ' ein.' : 'BLACKOUT startet …', true); return; }
    toast((r && r.error) || 'BLACKOUT konnte nicht gestartet werden.');
    if (r && /installiert/i.test(r.error || '')) return;
  }
  window.open(GAME_WEB + '?join=' + encodeURIComponent(code), '_blank');
}
// Aktivität für Freunde: „spielt BLACKOUT“
async function updateActivity() {
  let a = '';
  try { if (SPARK && SPARK.running) { const r = await SPARK.running(); if (r && r.includes('blackout')) a = 'spielt BLACKOUT'; } } catch (e) {}
  if (call && call.state === 'live') a = a || 'im Anruf';
  if (a !== actNow) { actNow = a; send({ t: 'act', act: a }); renderMe(); }
}
setInterval(updateActivity, 8000);

// ---------- Sprachanrufe: Mikrofon → 16 kHz → µ-law → AES-GCM → Server → Freund
const RATE = 16000, FRAME = 960;   // 60 ms pro Paket
const MU_DEC = new Float32Array(256);
for (let u = 0; u < 256; u++) { const v = ~u & 0xff, sign = v & 0x80, ex = (v >> 4) & 7, man = v & 0x0f; let s = ((man << 3) + 132) << ex; s -= 132; MU_DEC[u] = (sign ? -s : s) / 32768; }
function muEnc(x) {
  let s = Math.max(-1, Math.min(1, x)) * 32635; const sign = s < 0 ? 0x80 : 0; if (sign) s = -s; s = (s | 0) + 132;
  let ex = 7; for (let m = 0x4000; (s & m) === 0 && ex > 0; m >>= 1) ex--;
  return ~(sign | (ex << 4) | ((s >> (ex + 3)) & 0x0f)) & 0xff;
}
const WORKLET = 'class Cap extends AudioWorkletProcessor{process(i,o){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor("cap",Cap);';
function callUi() {
  if (!call) { $('call').hidden = true; if (sel) renderHead(); return; }
  const f = friends.get(call.fk), name = f ? f.u : call.fk;
  $('call').hidden = false;
  $('call').classList.toggle('ring', call.state === 'ring');
  $('callName').textContent = name;
  setAv($('callAv'), name);
  $('callLbl').textContent = call.state === 'ring' ? (call.dir === 'in' ? '// Eingehender Anruf' : '// Ruft an …') : call.state === 'end' ? '// Anruf beendet' : '// Sprachanruf · 🔒 verschlüsselt';
  let b = '';
  if (call.state === 'ring' && call.dir === 'in') b = '<button class="btn ok" id="caYes">📞 ANNEHMEN</button><button class="btn red" id="caNo">ABLEHNEN</button>';
  else if (call.state !== 'end') b = (call.state === 'live' ? '<button class="sec" id="caMute">' + (call.muted ? '🔇 Stumm' : '🎙 Mikro an') + '</button>' : '') + '<button class="btn red" id="caEnd">AUFLEGEN</button>';
  $('callBtns').innerHTML = b;
  if ($('caYes')) $('caYes').onclick = acceptCall;
  if ($('caNo')) $('caNo').onclick = () => { send({ t: 'call', op: 'decline', cid: call.cid }); endCall(false, 'Abgelehnt', true); };
  if ($('caEnd')) $('caEnd').onclick = () => endCall(true);
  if ($('caMute')) $('caMute').onclick = () => { call.muted = !call.muted; callUi(); };
  callStatus();
  if (sel) renderHead();
}
function callStatus() {
  if (!call) return;
  const s = call.state === 'live' ? (() => { const t = Math.floor((Date.now() - call.t0) / 1000); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0') + (call.noMic ? ' · ohne Mikrofon' : ''); })()
    : call.state === 'ring' ? (call.dir === 'in' ? 'möchte mit dir sprechen' : 'klingelt …') : call.why || '';
  $('callSt').textContent = s;
}
setInterval(callStatus, 1000);
$('cCall').onclick = () => {
  const f = friends.get(sel); if (!f || call) return;
  if (!f.on) return toast(f.u + ' ist gerade offline.');
  call = { cid: rid(), fk: f.key, dir: 'out', state: 'ring', ctx: audioCtx() };
  send({ t: 'call', op: 'ring', u: f.u, cid: call.cid });
  ringtone(true); callUi();
};
function onCall(m) {
  const fk = String(m.u || '').toLowerCase();
  if (m.op === 'ring') {
    if (call || !friends.has(fk)) { send({ t: 'call', op: 'decline', cid: m.cid }); return; }
    call = { cid: m.cid, fk, dir: 'in', state: 'ring' };
    ringtone(true); callUi();
    notify('📞 ' + friends.get(fk).u + ' ruft an', 'Klick hier, um den Anruf anzunehmen.', fk);
    return;
  }
  if (!call || call.cid !== m.cid) return;
  if (m.op === 'accept' && call.dir === 'out') { startAudio(); return; }
  if (m.op === 'end') endCall(false, m.why || 'Aufgelegt');
}
async function acceptCall() {
  if (!call || call.state !== 'ring') return;
  ringtone(false);
  call.ctx = audioCtx();
  send({ t: 'call', op: 'accept', cid: call.cid });
  startAudio();
}
async function startAudio() {
  const c = call; if (!c) return;
  ringtone(false);
  c.state = 'live'; c.t0 = Date.now(); c.acc = 0; c.accN = 0; c.pos = 0; c.out = new Float32Array(FRAME); c.outN = 0; c.next = 0;
  hist.has(c.fk) || hist.set(c.fk, []);
  callUi(); updateActivity();
  try {
    c.key = await callKey(c.fk, c.cid);
    c.ctx = c.ctx || audioCtx();
    if (c.ctx.state === 'suspended') c.ctx.resume().catch(() => {});
    c.gain = c.ctx.createGain(); c.gain.connect(c.ctx.destination);
    try {
      c.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    } catch (e) { c.noMic = true; toast('Kein Mikrofon gefunden oder nicht erlaubt – du kannst nur zuhören.'); }
    if (call !== c) return cleanupAudio(c);
    if (c.stream) {
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await c.ctx.audioWorklet.addModule(url);
      const src = c.ctx.createMediaStreamSource(c.stream), node = new AudioWorkletNode(c.ctx, 'cap'), mute = c.ctx.createGain();
      mute.gain.value = 0; node.connect(mute); mute.connect(c.ctx.destination);
      node.port.onmessage = e => capture(c, e.data);
      src.connect(node); c.node = node;
    }
  } catch (e) { console.error(e); toast('Audio konnte nicht gestartet werden: ' + e.message); }
}
function capture(c, f) {
  if (call !== c || c.state !== 'live' || c.muted) return;
  const r = c.ctx.sampleRate / RATE;
  for (let i = 0; i < f.length; i++) {
    c.acc += f[i]; c.accN++; c.pos += 1;
    if (c.pos >= r) {
      c.pos -= r; c.out[c.outN++] = c.acc / c.accN; c.acc = 0; c.accN = 0;
      if (c.outN === FRAME) { sendFrame(c, c.out); c.outN = 0; }
    }
  }
}
async function sendFrame(c, samples) {
  if (!wsReady() || ws.bufferedAmount > 64 * 1024 || !c.key) return;   // Leitung voll → Paket auslassen statt Verzögerung
  const bytes = new Uint8Array(FRAME); let e = 0;
  for (let i = 0; i < FRAME; i++) { bytes[i] = muEnc(samples[i]); e += samples[i] * samples[i]; }
  talk('callAv', Math.sqrt(e / FRAME) > 0.02 ? 'me' : '');
  const d = await encWith(c.key, bytes);
  send({ t: 'a', cid: c.cid, d: b64(d) });
}
async function onAudio(m) {
  const c = call; if (!c || c.cid !== m.cid || !c.key || !c.ctx) return;
  let bytes; try { bytes = await decWith(c.key, unb64(m.d)); } catch (e) { return; }
  const buf = c.ctx.createBuffer(1, bytes.length, RATE), ch = buf.getChannelData(0); let e = 0;
  for (let i = 0; i < bytes.length; i++) { ch[i] = MU_DEC[bytes[i]]; e += ch[i] * ch[i]; }
  talk('callAv', Math.sqrt(e / bytes.length) > 0.02 ? 'them' : '');
  const t = c.ctx.currentTime;
  if (c.next < t + 0.03) c.next = t + 0.12;   // Puffer leer → kurz vorpuffern
  if (c.next > t + 0.4) return;               // zu viel Verzögerung → Paket verwerfen
  const s = c.ctx.createBufferSource(); s.buffer = buf; s.connect(c.gain); s.start(c.next); c.next += buf.duration;
}
let talkT = 0;
function talk(id, who) { if (who) { talkT = Date.now(); $(id).classList.add('talk'); } else if (Date.now() - talkT > 250) $(id).classList.remove('talk'); }
function audioCtx() { const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); ctx.resume && ctx.resume().catch(() => {}); return ctx; }
async function callKey(fk, cid) { const s = await sharedKey(fk); return hkdfKey(s.bits, 'spark-chat/call/v1/' + cid, s.pair); }
function cleanupAudio(c) {
  try { if (c.stream) c.stream.getTracks().forEach(t => t.stop()); } catch (e) {}
  try { if (c.node) c.node.port.onmessage = null; } catch (e) {}
  try { if (c.ctx) c.ctx.close(); } catch (e) {}
}
function endCall(local, why, silent) {
  const c = call; if (!c) return;
  if (local) send({ t: 'call', op: 'end', cid: c.cid });
  ringtone(false); cleanupAudio(c);
  const f = friends.get(c.fk);
  if (c.state === 'live') { const t = Math.floor((Date.now() - c.t0) / 1000); pushHist(c.fk, { id: rid(), me: true, k: 'sys', text: '📞 Anruf · ' + Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'), ts: Date.now(), st: 'dlv', fk: c.fk }); }
  else if (c.dir === 'in' && !silent) pushHist(c.fk, { id: rid(), me: false, k: 'sys', text: '📞 Verpasster Anruf von ' + (f ? f.u : c.fk), ts: Date.now(), fk: c.fk });
  if (c.fk === sel) renderMsgs();
  c.state = 'end'; c.why = why || 'Aufgelegt'; callUi();
  blip([440, 330], .12);
  setTimeout(() => { if (call === c) { call = null; callUi(); updateActivity(); } }, 1800);
}

// ---------- Töne & Benachrichtigungen
let actx = null, ringT = null;
function blip(freqs, dur, vol) {
  if (!prefs.sound) return;
  try {
    actx = actx || new AudioContext();
    let t = actx.currentTime;
    for (const f of freqs) {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'triangle'; o.frequency.value = f; g.gain.setValueAtTime(vol || .08, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + dur + .02); t += dur * .9;
    }
  } catch (e) {}
}
function ringtone(on) {
  clearInterval(ringT); ringT = null;
  if (on) { const r = () => blip(call && call.dir === 'in' ? [784, 988, 784, 988] : [440, 440], .18, .07); r(); ringT = setInterval(r, 2200); }
}
function notify(title, body, fk) {
  if (!prefs.notify || document.hasFocus() || !window.Notification) return;
  try {
    if (Notification.permission === 'default') { Notification.requestPermission(); return; }
    if (Notification.permission !== 'granted') return;
    const n = new Notification(title, { body: String(body).slice(0, 140), silent: true });
    n.onclick = () => { window.focus(); if (fk && friends.has(fk)) openChat(fk); n.close(); };
  } catch (e) {}
}
let toastT = null;
function toast(msg, ok) { const t = $('toast'); t.textContent = msg; t.className = 'toast show' + (ok ? ' ok' : ''); clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast' + (ok ? ' ok' : ''); }, 4200); }
function conn(s) { $('conn').hidden = !s; $('conn').textContent = s || ''; }

setMode(false);
if (!(SPARK && SPARK.vault)) { $('aStay').checked = false; $('stayHint').textContent = '(nur auf deinem eigenen Gerät)'; }
autoLogin();
// Für Tests
window.__chat = { get me() { return me; }, friends: () => friends, hist: () => hist, get call() { return call; }, send, SERVER };
})();
