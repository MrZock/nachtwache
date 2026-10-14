// Erzeugt das SPARK-Symbol (256×256 PNG): leuchtender Blitz auf dunkler, abgerundeter Platte – ohne zusätzliche Pakete
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const N = 256, px = Buffer.alloc(N * N * 4);
const mix = (a, b, t) => Math.round(a + (b - a) * Math.max(0, Math.min(1, t)));
// Blitz als Vieleck (gleiche Form wie das Logo in der Oberfläche, 24er-Raster → 256)
const BOLT = [[13.5, 1], [4, 13.5], [10.2, 13.5], [8.8, 23], [20, 9.6], [13.6, 9.6], [16.4, 1]].map(([x, y]) => [x / 24 * 196 + 30, y / 24 * 196 + 30]);
function inPoly(x, y, P) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
function distPoly(x, y, P) { let d = 1e9; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [ax, ay] = P[j], [bx, by] = P[i], dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))); d = Math.min(d, Math.hypot(x - ax - t * dx, y - ay - t * dy)); } return d; }
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const i = (y * N + x) * 4, r = 44;
  const dx = Math.max(r - x, 0, x - (N - 1 - r)), dy = Math.max(r - y, 0, y - (N - 1 - r));
  if (dx * dx + dy * dy > r * r) { px[i + 3] = 0; continue; }
  const cd = Math.hypot(x - N / 2, y - N / 2) / (N / 2);
  let R = mix(34, 10, cd), G = mix(22, 12, cd), B = mix(26, 18, cd);
  const inside = inPoly(x + 0.5, y + 0.5, BOLT), d = inside ? 0 : distPoly(x + 0.5, y + 0.5, BOLT);
  // Glühen um den Blitz
  const glow = Math.max(0, 1 - d / 46);
  R = mix(R, 255, glow * 0.55); G = mix(G, 110, glow * 0.45); B = mix(B, 30, glow * 0.2);
  if (inside) { const t = (y - 30) / 196; R = 255; G = mix(222, 92, t); B = mix(90, 26, t); if (distPoly(x + 0.5, y + 0.5, BOLT) < 3) { G = Math.min(255, G + 25); B = Math.min(255, B + 30); } }
  const edge = Math.min(x, y, N - 1 - x, N - 1 - y);
  if (edge < 6) { R = mix(R, 90, 0.5); G = mix(G, 50, 0.5); B = mix(B, 30, 0.5); }
  px[i] = R; px[i + 1] = G; px[i + 2] = B; px[i + 3] = 255;
}
// PNG schreiben
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = b => { let c = -1; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const raw = Buffer.alloc(N * (N * 4 + 1));
for (let y = 0; y < N; y++) { raw[y * (N * 4 + 1)] = 0; px.copy(raw, y * (N * 4 + 1) + 1, y * N * 4, (y + 1) * N * 4); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.png'), png);
console.log('build/icon.png geschrieben');
