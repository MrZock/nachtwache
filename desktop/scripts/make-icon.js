// Erzeugt das App-Symbol (256×256 PNG): rostige Platte mit glühendem „B“ – ohne zusätzliche Pakete
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const N = 256, px = Buffer.alloc(N * N * 4);
const set = (x, y, r, g, b, a) => { const i = (y * N + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a; };
const mix = (a, b, t) => Math.round(a + (b - a) * t);
// „B“ als Pixelraster (7×9)
const B = ['1111100', '1100110', '1100110', '1111100', '1100110', '1100011', '1100011', '1100110', '1111100'];
const cell = 20, bx0 = (N - 7 * cell) / 2, by0 = (N - 9 * cell) / 2 + 4;
const inB = (x, y) => { const cx = Math.floor((x - bx0) / cell), cy = Math.floor((y - by0) / cell); return cx >= 0 && cy >= 0 && cx < 7 && cy < 9 && B[cy][cx] === '1'; };
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const noise = new Float32Array(N * N).map(() => rnd());
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const r = 28, inside = (() => { const dx = Math.max(r - x, 0, x - (N - 1 - r)), dy = Math.max(r - y, 0, y - (N - 1 - r)); return dx * dx + dy * dy <= r * r; })();
  if (!inside) { set(x, y, 0, 0, 0, 0); continue; }
  const d = Math.hypot(x - N / 2, y - N / 2) / (N / 2), n = noise[y * N + x];
  // Grund: dunkles, rostiges Metall mit Glut in der Mitte
  let R = mix(70, 22, d), G = mix(34, 14, d), Bc = mix(18, 10, d);
  if (n > 0.86) { R += 40; G += 14; } else if (n < 0.08) { R -= 12; G -= 8; Bc -= 4; }
  const glow = Math.max(0, 1 - d * 1.3);
  R = Math.min(255, R + glow * 120); G = Math.min(255, G + glow * 45);
  // Rand
  const edge = Math.min(x, y, N - 1 - x, N - 1 - y);
  if (edge < 10) { R = mix(R, 150, 0.6); G = mix(G, 78, 0.6); Bc = mix(Bc, 36, 0.6); }
  // Buchstabe mit Schatten und Feuerverlauf
  if (inB(x - 6, y - 6)) { R = Math.round(R * 0.25); G = Math.round(G * 0.25); Bc = Math.round(Bc * 0.25); }
  if (inB(x, y)) {
    const t = (y - by0) / (9 * cell);
    R = mix(255, 220, t); G = mix(225, 70, t); Bc = mix(120, 10, t);
    if (n > 0.9) { R -= 60; G -= 40; }
    if ((x - bx0) % cell < 2 || (y - by0) % cell < 2) { R -= 25; G -= 20; }
  }
  set(x, y, Math.max(0, R), Math.max(0, G), Math.max(0, Bc), 255);
}
// PNG schreiben
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = b => { let c = -1; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const raw = Buffer.alloc((N * 4 + 1) * N);
for (let y = 0; y < N; y++) { raw[y * (N * 4 + 1)] = 0; px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, png);
console.log('Symbol geschrieben:', out);
