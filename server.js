// Nachtwache – Spielserver
// Liefert index.html aus und leitet die Spieldaten zwischen Host und Mitspieler weiter (WebSocket).
// Läuft lokal (LAN) und im Internet (z. B. kostenlos auf Render.com). Keine Pakete nötig:
//   node server.js          (Port 8080, oder Umgebungsvariable PORT)
//   node server.js 9000
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || process.argv[2] || '8080', 10);
const ROOT = __dirname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };
const MAX_MSG = 2 * 1024 * 1024;   // max. Nachrichtengröße
const MAX_ROOMS = 500;

function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${PORT}`);
  }
  return out;
}

// ---------- HTTP: Spieldateien ausliefern
const server = http.createServer((req, res) => {
  let file = decodeURIComponent((req.url || '/').split('?')[0]);
  if (file === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }); res.end('ok ' + rooms.size); return; }
  if (file === '/') file = '/index.html';
  const full = path.join(ROOT, path.normalize(file));
  if (!full.startsWith(ROOT) || !TYPES[path.extname(full)]) { res.writeHead(404); res.end('Nicht gefunden'); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('Nicht gefunden'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(full)], 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

// ---------- Minimaler WebSocket-Server (RFC 6455, Textnachrichten)
function wsSend(sock, str) {
  if (sock.destroyed) return;
  const payload = Buffer.from(str, 'utf8'), len = payload.length;
  let head;
  if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  head[0] = 0x81; // FIN + Text
  sock.write(Buffer.concat([head, payload]));
}
function wsControl(sock, opcode, payload) {
  if (sock.destroyed) return;
  const p = payload || Buffer.alloc(0);
  sock.write(Buffer.concat([Buffer.from([0x80 | opcode, p.length]), p]));
}

// ---------- Räume: ein Host und bis zu 15 Mitspieler, verbunden über einen 4-stelligen Code
// Mitspieler → Host: "~<id>|<json>"   Host → einzelner Mitspieler: "@<id>|<json>", sonst an alle
const MAX_GUESTS = 15;
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(c)) return c;
  }
}
const send = (c, o) => c && wsSend(c.sock, JSON.stringify(o));

function onClientMessage(c, text) {
  if (!c.role) {
    let m; try { m = JSON.parse(text); } catch (e) { return; }
    if (m.t !== '_hello') return;
    if (m.want === 'host') {
      if (rooms.size >= MAX_ROOMS) return send(c, { t: '_err', msg: 'Der Server ist gerade voll. Bitte später nochmal versuchen.' });
      const code = newCode();
      const room = { code, host: c, guests: new Map(), next: 1 };
      rooms.set(code, room);
      c.role = 'host'; c.room = room;
      send(c, { t: '_role', role: 'host', code, urls: lanUrls() });
      log(`Raum ${code} erstellt (${rooms.size} offen)`);
    } else {
      let code = String(m.room || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      // Ohne Code: wenn genau ein Raum offen ist (typisch im LAN), diesen nehmen
      if (!code && rooms.size === 1) code = rooms.keys().next().value;
      const room = rooms.get(code);
      if (!room) return send(c, { t: '_err', msg: code ? `Kein Spiel mit dem Code ${code} gefunden.` : 'Bitte den Raum-Code des Hosts eingeben.' });
      if (room.guests.size >= MAX_GUESTS) return send(c, { t: '_err', msg: 'Dieses Spiel ist schon voll (max. ' + (MAX_GUESTS + 1) + ' Spieler).' });
      const gid = room.next++;
      room.guests.set(gid, c); c.role = 'guest'; c.room = room; c.gid = gid;
      send(c, { t: '_role', role: 'client', code, gid });
      send(room.host, { t: '_peer', id: gid });
      log(`Mitspieler ${gid} in Raum ${code} (${room.guests.size + 1} Spieler)`);
    }
    return;
  }
  const room = c.room;
  if (!room) return;
  if (c === room.host) {
    if (text[0] === '@') {
      const i = text.indexOf('|'), to = room.guests.get(parseInt(text.slice(1, i), 10));
      if (to) wsSend(to.sock, text.slice(i + 1));
    } else for (const gc of room.guests.values()) wsSend(gc.sock, text);
  } else if (room.host) wsSend(room.host.sock, '~' + c.gid + '|' + text);
}
function onClientClose(c) {
  if (c.closed) return;
  c.closed = true;
  clearInterval(c.pinger);
  const room = c.room;
  if (!room) return;
  if (c === room.host) {
    rooms.delete(room.code);
    for (const gc of room.guests.values()) { send(gc, { t: '_gone' }); gc.sock.end(); }
    log(`Raum ${room.code} geschlossen (${rooms.size} offen)`);
  } else if (room.guests.get(c.gid) === c) {
    room.guests.delete(c.gid);
    send(room.host, { t: '_gone', id: c.gid });
  }
}

server.on('upgrade', (req, sock) => {
  if ((req.url || '').split('?')[0] !== '/ws' || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { sock.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key) { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  sock.setNoDelay(true);
  const c = { sock, role: null, room: null, buf: Buffer.alloc(0), frag: [], fragLen: 0 };
  // Ping alle 25 s, damit Proxys die Verbindung nicht wegen Leerlauf schließen
  c.pinger = setInterval(() => wsControl(sock, 0x9), 25000);
  sock.on('data', chunk => {
    c.buf = c.buf.length ? Buffer.concat([c.buf, chunk]) : chunk;
    for (;;) {
      const b = c.buf;
      if (b.length < 2) break;
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) break; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) break; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > MAX_MSG) { sock.destroy(); onClientClose(c); return; }
      const need = off + (masked ? 4 : 0) + len;
      if (b.length < need) break;
      let data = b.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const mask = b.subarray(off, off + 4), out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) out[i] = data[i] ^ mask[i & 3];
        data = out;
      }
      c.buf = b.subarray(need);
      if (op === 0x8) { wsControl(sock, 0x8); sock.end(); onClientClose(c); return; }
      if (op === 0x9) { wsControl(sock, 0xA, data); continue; }
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x0) {
        c.frag.push(Buffer.from(data)); c.fragLen += data.length;
        if (c.fragLen > MAX_MSG) { sock.destroy(); onClientClose(c); return; }
        if (fin) { const text = Buffer.concat(c.frag).toString('utf8'); c.frag = []; c.fragLen = 0; onClientMessage(c, text); }
      }
    }
  });
  sock.on('close', () => onClientClose(c));
  sock.on('error', () => onClientClose(c));
});

function log(s) { console.log(new Date().toLocaleTimeString('de-DE') + '  ' + s); }

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} ist schon belegt. Starte mit einem anderen Port, z. B.:  node server.js 9000`);
  else console.error(e);
  process.exit(1);
});
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  NACHTWACHE – Spielserver läuft (Port ' + PORT + ')');
  console.log('  -----------------------------------------');
  console.log(`  Du (Host):     http://localhost:${PORT}   →  „Online hosten“`);
  const urls = lanUrls();
  urls.forEach(u => console.log(`  Im selben Netz: ${u}   →  „Online beitreten“`));
  console.log('');
  console.log('  Fenster offen lassen, solange ihr spielt. Beenden mit Strg+C.');
  console.log('');
});
