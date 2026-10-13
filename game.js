"use strict";
(function () {
const HEADLESS = typeof document === 'undefined' || (typeof window !== 'undefined' && !!window.__HEADLESS);
const ROOT = typeof window !== 'undefined' ? window : globalThis;
// 3D-Renderer (Version 2.0), falls 3d.html ihn geladen hat
const R3 = (!HEADLESS && ROOT.NW3D) || null;

// =====================================================================
// Konstanten & Hilfsfunktionen
// =====================================================================
const TS = 40;            // Tile-Größe in Pixeln
const MAP = 320;          // Karte: MAP x MAP Tiles
const WORLD = TS * MAP;
const DAY_LEN = 90, NIGHT_LEN = 60;
const BUILD_RANGE = 16;   // Bauradius um den Reaktor (Tiles, Chebyshev) – wächst mit der Stufe
const buildRange = () => BUILD_RANGE + (S && S.hq ? S.hq.lvl - 1 : 0) * 4;
const RES_R = 16;         // Kollisionsradius von Bäumen/Felsen
const TAU = Math.PI * 2;
const FONT = '"Segoe UI", "Trebuchet MS", Roboto, sans-serif';
const FONT_T = '"Black Ops One", Impact, "Arial Black", sans-serif';   // Titel im Rost-Look
const FONT_P = 'Silkscreen, "Courier New", monospace';                  // Pixel-Schrift

const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => (a + Math.random() * (b - a + 1)) | 0;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const fmtTime = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const inMap = (tx, ty) => tx >= 0 && ty >= 0 && tx < MAP && ty < MAP;
const tileAt = (x, y) => { const tx = Math.floor(x / TS), ty = Math.floor(y / TS); return inMap(tx, ty) ? ty * MAP + tx : -1; };
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
const HS_KEY = 'nachtwache.highscore';

// Netzwerk-Zustand (Details siehe Abschnitt "Online-Modus")
const NET = { peers: new Map(), role: null, pc: null, chR: null, chU: null, ws: null, peer: false, urls: [], room: '', copied: 0, ev: [], sendT: 0, inT: 0, bDirty: true, bT: 0, ping: 0, pingT: 0, lastRecv: 0 };

// =====================================================================
// Definitionen: Gebäude & Zombies
// =====================================================================
const BDEF = {
  hq:     { name: 'Reaktor', size: 3, hp: [1500, 2600, 4000, 6000, 9000], gold: [1, 1.6, 2.4, 3.4, 4.6],
            desc: 'Herz deiner Basis. Erzeugt Gold. Zerstört = Game Over.' },
  wall:   { name: 'Barrikade', size: 1, hp: [250, 450, 750, 1150, 1700], cost: { w: 4, s: 0, g: 0 }, gup: 4, max: 250,
            desc: 'Hält Zombies auf.' },
  door:   { name: 'Tor', size: 1, hp: [220, 400, 650, 1000, 1450], cost: { w: 6, s: 4, g: 0 }, gup: 5, max: 40,
            desc: 'Nur du kannst hindurchgehen.' },
  mine:   { name: 'Goldbohrer', size: 2, hp: [300, 500, 750, 1100, 1600], cost: { w: 15, s: 15, g: 0 }, gup: 30, max: 8,
            gold: [0.8, 1.3, 2, 3, 4.5], desc: 'Erzeugt passiv Gold.' },
  arrow:  { name: 'Geschützturm', size: 2, hp: [300, 480, 720, 1050, 1500], cost: { w: 15, s: 10, g: 0 }, gup: 20, max: 10,
            range: [7, 7.5, 8, 8.5, 9], dmg: [10, 15, 22, 32, 46], rate: [0.45, 0.4, 0.35, 0.3, 0.26],
            desc: 'Schnelle, schwache Pfeile.' },
  cannon: { name: 'Kanonenturm', size: 2, hp: [350, 550, 800, 1150, 1600], cost: { w: 15, s: 25, g: 0 }, gup: 30, max: 8,
            range: [6, 6.3, 6.6, 7, 7.5], dmg: [22, 34, 50, 72, 100], rate: [1.4, 1.3, 1.2, 1.1, 1.0], splash: [1.2, 1.3, 1.45, 1.6, 1.8],
            desc: 'Flächenschaden.' },
  mage:   { name: 'Teslaturm', size: 2, hp: [300, 480, 720, 1050, 1500], cost: { w: 20, s: 20, g: 40 }, gup: 40, max: 6,
            range: [6.5, 6.8, 7.1, 7.5, 8], dmg: [18, 27, 40, 58, 82], rate: [1.6, 1.5, 1.4, 1.3, 1.2], chain: [3, 4, 5, 6, 8],
            desc: 'Kettenblitz springt zwischen Zombies.' },
  bomb:   { name: 'Mörserturm', size: 2, hp: [350, 550, 800, 1150, 1600], cost: { w: 25, s: 30, g: 60 }, gup: 45, max: 6,
            range: [6, 6.3, 6.6, 7, 7.5], dmg: [80, 120, 175, 250, 350], rate: [3.2, 3.0, 2.8, 2.6, 2.4], splash: [1.8, 1.9, 2.0, 2.2, 2.4],
            desc: 'Langsam, enormer Flächenschaden.' },
  harv:   { name: 'Recycler', size: 2, hp: [300, 480, 720, 1050, 1500], cost: { w: 30, s: 30, g: 20 }, gup: 30, max: 4,
            rate: [0.08, 0.11, 0.15, 0.2, 0.27], radius: [4, 4.5, 5, 5.5, 6],
            desc: 'Erntet Holz & Stein von Bäumen/Felsen in der Nähe.' },
  heal:   { name: 'Sanistation', size: 2, hp: [300, 480, 720, 1050, 1500], cost: { w: 25, s: 25, g: 50 }, gup: 40, max: 4,
            heal: [10, 15, 22, 32, 45], radius: [4, 4.5, 5, 5.5, 6],
            desc: 'Repariert Gebäude und heilt Spieler in der Nähe – auch nachts.' },
  trap:   { name: 'Stachelfalle', size: 1, hp: [200, 320, 480, 700, 1000], cost: { w: 10, s: 10, g: 10 }, gup: 12, max: 40,
            dmg: [14, 20, 28, 40, 55],
            desc: 'Zombies laufen darüber, nehmen Schaden und werden gebremst. Nutzt sich ab.' },
  frost:  { name: 'Kryoturm', size: 2, hp: [320, 500, 760, 1100, 1550], cost: { w: 20, s: 30, g: 50 }, gup: 40, max: 6,
            radius: [3.6, 4, 4.4, 4.8, 5.2], slow: [0.35, 0.4, 0.45, 0.5, 0.55], dmg: [3, 5, 8, 12, 17],
            desc: 'Eisige Aura: verlangsamt alle Zombies im Umkreis stark und friert sie langsam ein.' },
};
const BORDER = ['wall', 'door', 'mine', 'arrow', 'cannon', 'mage', 'bomb', 'harv', 'hq']; // Tasten 1..9
const KEY_BUILD = { 1: 'wall', 2: 'door', 3: 'mine', 4: 'arrow', 5: 'cannon', 6: 'mage', 7: 'bomb', 8: 'harv', 9: 'hq', 0: 'heal' };
const BAR_ORDER = [['wall', 1], ['door', 2], ['mine', 3], ['arrow', 4], ['cannon', 5], ['mage', 6], ['bomb', 7], ['harv', 8], ['heal', 0], ['trap', 'F'], ['frost', 'J'], ['hq', 9]];
const TOWERS = { arrow: 1, cannon: 1, mage: 1, bomb: 1 };
const LV_MULT = [1, 1.5, 2.4, 3.8, 6];
const G_MULT = [0, 2, 5, 12, 26];
const HQ_UP = [null, { w: 80, s: 80, g: 120 }, { w: 200, s: 200, g: 500, i: 30 }, { w: 400, s: 400, g: 1300, i: 90 }, { w: 800, s: 800, g: 3000, i: 200 }];
const LV_COL = ['#8a5232', '#8d8a84', '#5b7896', '#6a7046', '#d9a520'];

function costFor(type, lvl) {
  if (type === 'hq') return lvl === 1 ? { w: 0, s: 0, g: 0 } : HQ_UP[lvl - 1];
  const d = BDEF[type], m = LV_MULT[lvl - 1];
  return { w: Math.round(d.cost.w * m), s: Math.round(d.cost.s * m), g: Math.round(d.cost.g * m + d.gup * G_MULT[lvl - 1]), i: lvl >= 3 ? Math.max(1, Math.round((d.cost.w + d.cost.s) * m * 0.12)) : 0 };
}

const ZDEF = {
  normal:  { name: 'Zombie',  hp: 45,   speed: 62,  r: 13, dmg: 9,  bdmg: 14,  atk: 1.0, gold: 1,   xp: 6, color: '#6fae5a' },
  runner:  { name: 'Läufer',  hp: 24,   speed: 118, r: 10, dmg: 6,  bdmg: 7,   atk: 0.7, gold: 1,   xp: 5, color: '#b5d86a' },
  brute:   { name: 'Brute',   hp: 240,  speed: 38,  r: 20, dmg: 22, bdmg: 70,  atk: 1.5, gold: 4,   xp: 18, color: '#4f7a3e' },
  spitter: { name: 'Spucker', hp: 50,   speed: 52,  r: 13, dmg: 10, bdmg: 16,  atk: 2.2, gold: 2,   xp: 9, color: '#5cc8a0', range: 230 },
  bomber:  { name: 'Bomber',  hp: 35,   speed: 80,  r: 13, dmg: 25, bdmg: 130, atk: 1.0, gold: 3,   xp: 9, color: '#d9622b' },
  boss:    { name: 'Boss',    hp: 2300, speed: 42,  r: 34, dmg: 40, bdmg: 110, atk: 1.6, gold: 150, xp: 200, color: '#9b3fb0' },
  shade:   { name: 'Schattenwesen', hp: 95, speed: 105, r: 13, dmg: 13, bdmg: 0, atk: 0.9, gold: 7, xp: 24, color: '#4a2a7a', shade: true },
  shaman:  { name: 'Schamane', hp: 75,  speed: 54,  r: 13, dmg: 8,  bdmg: 12,  atk: 1.2, gold: 5,   xp: 15, color: '#8a6ad0' },
  armored: { name: 'Panzerzombie', hp: 170, speed: 46, r: 16, dmg: 14, bdmg: 30, atk: 1.2, gold: 4,   xp: 16, color: '#6f8a62', armor: 0.45 },
};
const hpScale = N => 1 + 0.13 * (N - 1) + 0.012 * (N - 1) * (N - 1);
const dmgScale = N => 1 + 0.07 * (N - 1);

// =====================================================================
// Audio (Web Audio API, alles synthetisch)
// =====================================================================
let camX = 0, camY = 0, VW = 1280, VH = 720, DPR = 1;
const SFX = (() => {
  let ac = null, out = null, nb = null, muted = false, vf = 1;
  const last = {};
  function init() {
    if (HEADLESS) return;
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 5;
    out = ac.createGain(); out.gain.value = muted ? 0 : 0.55;
    out.connect(comp); comp.connect(ac.destination);
    nb = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  function tone(f, dur, type, vol, f2, delay) {
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, vol, freq, ftype, f2, delay) {
    const t = ac.currentTime + (delay || 0);
    const s = ac.createBufferSource(); s.buffer = nb;
    const fl = ac.createBiquadFilter(); fl.type = ftype || 'lowpass';
    fl.frequency.setValueAtTime(freq, t);
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(out);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  const lib = {
    chop()   { tone(rand(170, 220), 0.09, 'triangle', 0.28 * vf, 90); noise(0.06, 0.14 * vf, 1800, 'bandpass'); },
    mine()   { tone(rand(900, 1150), 0.05, 'square', 0.07 * vf, 600); noise(0.08, 0.2 * vf, 3500, 'highpass'); },
    swing()  { noise(0.13, 0.13 * vf, 900, 'bandpass', 4000); },
    bow()    { tone(330, 0.12, 'triangle', 0.14 * vf, 140); },
    hit()    { tone(rand(140, 180), 0.07, 'square', 0.1 * vf, 70); },
    tarrow() { tone(rand(700, 820), 0.05, 'triangle', 0.05 * vf, 400); },
    cannon() { noise(0.25, 0.3 * vf, 900, 'lowpass', 80); tone(110, 0.2, 'sine', 0.25 * vf, 40); },
    boom()   { noise(0.7, 0.45 * vf, 1500, 'lowpass', 50); tone(80, 0.6, 'sine', 0.35 * vf, 25); },
    zap()    { noise(0.18, 0.16 * vf, 4000, 'highpass'); tone(1600, 0.14, 'sawtooth', 0.06 * vf, 300); },
    place()  { tone(300, 0.08, 'square', 0.08, 450); tone(450, 0.08, 'square', 0.06, 600, 0.06); },
    upgrade(){ [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.14, 'square', 0.07, null, i * 0.06)); },
    sell()   { tone(900, 0.08, 'sine', 0.1, 500); tone(600, 0.12, 'sine', 0.08, 300, 0.07); },
    error()  { tone(150, 0.18, 'square', 0.1, 100); },
    hurt()   { tone(260, 0.22, 'sawtooth', 0.18, 70); },
    die()    { [400, 300, 200, 120].forEach((f, i) => tone(f, 0.25, 'sawtooth', 0.15, null, i * 0.15)); },
    zdie()   { noise(0.15, 0.15 * vf, 700, 'lowpass', 200); tone(rand(90, 130), 0.15, 'sawtooth', 0.06 * vf, 50); },
    groan()  { tone(rand(70, 95), 0.7, 'sawtooth', 0.06 * vf, rand(50, 65)); },
    bhit()   { tone(rand(90, 120), 0.06, 'square', 0.08 * vf, 60); noise(0.05, 0.1 * vf, 600, 'lowpass'); },
    bdestroy(){ noise(0.5, 0.35 * vf, 900, 'lowpass', 60); tone(70, 0.4, 'square', 0.12 * vf, 30); },
    horn()   { tone(110, 1.4, 'sawtooth', 0.16, 98); tone(165, 1.4, 'sawtooth', 0.09, 147); },
    chime()  { [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.5, 'sine', 0.1, null, i * 0.12)); },
    spit()   { noise(0.15, 0.12 * vf, 1200, 'bandpass', 300); },
    roar()   { tone(60, 1.2, 'sawtooth', 0.3, 35); noise(1, 0.25, 500, 'lowpass', 80); },
    click()  { tone(1200, 0.03, 'square', 0.04); },
    hqhit()  { tone(200, 0.12, 'square', 0.12, 120); },
    goldore(){ tone(rand(1300, 1500), 0.08, 'triangle', 0.08 * vf, 2200); noise(0.06, 0.12 * vf, 4000, 'highpass'); },
    rbreak() { noise(0.35, 0.28 * vf, 700, 'lowpass', 90); tone(rand(110, 140), 0.3, 'triangle', 0.18 * vf, 50); },
    join()   { [440, 554, 659, 880].forEach((f, i) => tone(f, 0.16, 'triangle', 0.09, null, i * 0.08)); },
    ping()   { tone(1320, 0.09, 'sine', 0.12); tone(1760, 0.14, 'sine', 0.1, null, 0.09); },
    levelup(){ [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.22, 'triangle', 0.1, null, i * 0.07)); },
    chat()   { tone(980, 0.05, 'triangle', 0.07); tone(1300, 0.07, 'triangle', 0.05, null, 0.05); },
  };
  const gates = { chop: 60, mine: 60, swing: 80, bow: 60, hit: 40, tarrow: 70, cannon: 80, boom: 90, zap: 80, zdie: 50,
                  groan: 500, bhit: 80, bdestroy: 120, spit: 120, click: 30, hurt: 150, hqhit: 600, goldore: 60, rbreak: 100 };
  const LOCAL_ONLY = { click: 1, error: 1, hurt: 1, die: 1, join: 1, ping: 1, chat: 1, levelup: 1 };
  function play(name, x, y, noNet) {
    // Host: Sound an den Mitspieler weiterreichen (mit Position, er rechnet die Lautstärke selbst)
    if (!noNet && NET.role === 'host' && !LOCAL_ONLY[name]) NET.ev.push(['s', name, x === undefined ? null : x | 0, y === undefined ? null : y | 0]);
    if (!ac || muted) return;
    if (x === null) x = undefined;
    if (x !== undefined) {
      const d = Math.hypot(x - (camX + VW / 2), y - (camY + VH / 2));
      vf = clamp(1.15 - d / 900, 0, 1);
      if (vf < 0.05) return;
    } else vf = 1;
    if (gates[name]) {
      const now = ac.currentTime * 1000;
      if (last[name] !== undefined && now - last[name] < gates[name]) return;
      last[name] = now;
    }
    try { lib[name](); } catch (e) {}
  }
  return {
    init, play,
    toggle() { muted = !muted; if (out) out.gain.value = muted ? 0 : 0.55; return muted; },
    get muted() { return muted; }
  };
})();

// =====================================================================
// Spielzustand
// =====================================================================
let S = null;
let mode = 'menu';       // menu | play | paused | over
let modeT = 0, animT = 0;
let highscore = store.get(HS_KEY, null);
let lastResult = null;
let repathQ = [];
let menuMsg = null;
const input = { down: false, sx: 0, sy: 0, aim: null };
const keys = {};

// Ressourcen: 1 = Baum, 2 = Fels, 3 = Golderz
const RES_HP = [0, 30, 35, 24, 255, 40, 255, 30];   // 7 = Schrott (Autowrack/Fässer) → Eisen   // 4 = Leere (unzerstörbar), 5 = Schattenkristall, 6 = Berg (unzerstörbar)
const SOLID_RES = k => k === 4 || k === 6;
// ---------- Biome: 0 Wiese, 2 Wüste, 3 Schnee, 4 Sumpf, 5 Schattenreich (eigene Dimension hinter einem Portal)
const BIOME_NAME = ['Wiese', 'Wald', 'Wüste', 'Schneeland', 'Sumpf', 'Schattenreich'];
const DIM = { x0: MAP - 72, y0: 6, x1: MAP - 8, y1: 70 };   // Schattenreich: abgeschotteter Bereich in der Ecke
const inDim = (tx, ty) => tx >= DIM.x0 && tx < DIM.x1 && ty >= DIM.y0 && ty < DIM.y1;
const biomeAtW = (x, y) => { if (!S || !S.biome) return 0; const tx = clamp(Math.floor(x / TS), 0, MAP - 1), ty = clamp(Math.floor(y / TS), 0, MAP - 1); return S.biome[ty * MAP + tx]; };
function genBiomes() {
  S.biome = new Uint8Array(MAP * MAP);
  const sd = S.seed || 1, c = MAP / 2, a0 = (sd % 628) / 100;
  const centers = [2, 3, 4].map((b, k) => ({ b, x: c + Math.cos(a0 + k * 2.09) * 108, y: c + Math.sin(a0 + k * 2.09) * 108 }));
  const s1 = sd % 97, s2 = sd % 89, s3 = sd % 83;
  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
    const i = y * MAP + x;
    if (inDim(x, y)) { S.biome[i] = 5; continue; }
    const n = Math.sin(x * 0.07 + s1) * 7 + Math.sin(y * 0.061 + s2) * 7 + Math.sin((x + y) * 0.043 + s3) * 6 + Math.sin((x - y) * 0.12 + s1) * 3;
    if (Math.hypot(x - c, y - c) + n < 52) continue;
    let best = 0, bd = 1e9;
    for (const q of centers) { const d = Math.hypot(x - q.x, y - q.y) + n; if (d < bd) { bd = d; best = q.b; } }
    S.biome[i] = bd < 92 ? best : 0;
  }
}
const NAME_KEY = 'nachtwache.name';
let playerName = store.get(NAME_KEY, '') || ('Spieler' + randi(10, 99));
const chatLog = [];   // { name, text, color, t }
function cleanText(s, n) { return String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, n); }
const PLAYER_COL = ['#3a6ea8', '#b8433f', '#3f9a4a', '#c9a227', '#8a4ac0', '#2aa8a8', '#d07a2a', '#c04a8a'];

// ---------- Level & Skills
const SKILLS = [
  { id: 'str',  icon: '⚔', name: 'Stärke',     max: 5, desc: l => '+' + (l * 15) + '% Nahkampfschaden' },
  { id: 'bow',  icon: '➶', name: 'Schütze',    max: 5, desc: l => '+' + (l * 12) + '% Fernkampfschaden, ' + (l * 6) + '% schneller' },
  { id: 'gath', icon: '⛏', name: 'Sammler',    max: 5, desc: l => (l * 20) + '% Chance auf doppelte Ausbeute' },
  { id: 'vit',  icon: '❤', name: 'Ausdauer',   max: 5, desc: l => '+' + (l * 15) + ' Max-HP, +' + l + ' HP/s Regeneration' },
  { id: 'spd',  icon: '➤', name: 'Flinkheit',  max: 5, desc: l => '+' + (l * 6) + '% Laufgeschwindigkeit' },
  { id: 'loot', icon: '$', name: 'Plünderer',  max: 5, desc: l => '+' + (l * 15) + '% Gold von Zombies & Truhen' },
  { id: 'crit', icon: '✦', name: 'Präzision',  max: 5, desc: l => (l * 7) + '% Chance auf doppelten Schaden' },
  { id: 'armor', icon: '🛡', name: 'Rüstung',  max: 5, desc: l => '-' + (l * 7) + '% erlittener Schaden' },
  { id: 'vamp', icon: '❣', name: 'Lebensraub', max: 5, desc: l => 'Heilt dich um ' + (l * 3) + '% deines Schadens' },
];
const xpNeed = L => Math.round(40 + (L - 1) * 30 + (L - 1) * (L - 1) * 4);
// Spezialfähigkeiten: ab Level 5 eine wählen, mit der Leertaste (Handy: ⚡) auslösen
const ABIL_LVL = 5;
const ABIL = [
  { id: 'whirl', icon: '🌀', name: 'Wirbelsturm',  cd: 8,  desc: 'Doppelter Schaden an allem im Umkreis + Rückstoß' },
  { id: 'dash',  icon: '💨', name: 'Sturmangriff', cd: 6,  desc: 'Sprintet nach vorn, rammt Zombies, kurz unverwundbar' },
  { id: 'heal',  icon: '💚', name: 'Heilwelle',    cd: 20, desc: 'Heilt dich und Mitspieler in der Nähe um 40 %' },
  { id: 'rage',  icon: '🔥', name: 'Kriegsschrei', cd: 25, desc: 'Team in der Nähe: +40 % Schaden & +20 % Tempo (8 s)' },
];
const RESPEC_COST = 100;
let skillsOpen = false;
const ACH_KEY = 'nachtwache.erfolge';
const ACHIEVEMENTS = [
  { id: 'kill1',   name: 'Erstes Blut',       desc: 'Töte deinen ersten Zombie',             ok: S => S.kills >= 1 },
  { id: 'kill100', name: 'Zombiejäger',       desc: '100 Zombies in einer Runde',            ok: S => S.kills >= 100 },
  { id: 'kill500', name: 'Zombieschlächter',  desc: '500 Zombies in einer Runde',            ok: S => S.kills >= 500 },
  { id: 'night5',  name: 'Überlebender',      desc: 'Überlebe 5 Nächte',                     ok: S => S.survived >= 5 },
  { id: 'night10', name: 'Unbeugsam',         desc: 'Überlebe 10 Nächte',                    ok: S => S.survived >= 10 },
  { id: 'night15', name: 'Legende',           desc: 'Überlebe 15 Nächte',                    ok: S => S.survived >= 15 },
  { id: 'boss',    name: 'Bossbezwinger',     desc: 'Besiege einen Boss',                    ok: S => (S.bossKills || 0) >= 1 },
  { id: 'blood',   name: 'Blutmond',          desc: 'Überstehe einen Blutmond',              ok: S => (S.bloodSurvived || 0) >= 1 },
  { id: 'lvl10',   name: 'Veteran',           desc: 'Erreiche Level 10',                     ok: S => S.player.lvl >= 10 },
  { id: 'gold',    name: 'Goldrausch',        desc: 'Verdiene 2000 Gold in einer Runde',     ok: S => S.goldEarned >= 2000 },
  { id: 'build50', name: 'Baumeister',        desc: 'Habe 50 Gebäude gleichzeitig',          ok: S => S.buildings.length >= 50 },
  { id: 'chest5',  name: 'Schatzjäger',       desc: 'Öffne 5 Schatztruhen',                  ok: S => (S.chestsOpened || 0) >= 5 },
  { id: 'bomber',  name: 'Entschärft',        desc: 'Erledige 10 Bomber, bevor sie explodieren', ok: S => (S.bomberKills || 0) >= 10 },
  { id: 'hq5',     name: 'Festung',           desc: 'Reaktor auf Stufe 5',              ok: S => !!S.hq && S.hq.lvl >= 5 },
  { id: 'hunter',  name: 'Jäger',             desc: 'Erlege 10 Tiere',                       ok: S => (S.animalKills || 0) >= 10 },
  { id: 'coop',    name: 'Zusammen stark',    desc: 'Überlebe 3 Nächte zu zweit',            ok: S => S.players.length > 1 && S.survived >= 3 },
  { id: 'squad',   name: 'Trupp',             desc: 'Überlebe 3 Nächte mit 4 Spielern',      ok: S => S.players.length >= 4 && S.survived >= 3 },
  { id: 'clan',    name: 'Clanchef',          desc: 'Gründe einen Clan oder tritt einem bei', ok: S => !!S.player.clan },
  { id: 'dim',     name: 'Dimensionsreisender', desc: 'Betritt das Schattenreich',          ok: S => (S.player.dimVisits || 0) >= 1 || (S.biome && S.biome[tileAt(S.player.x, S.player.y)] === 5) },
  { id: 'crystal', name: 'Kristallsammler',   desc: 'Baue 30 Schattenkristalle ab',          ok: S => (S.crystals || 0) >= 30 },
  { id: 'iron',    name: 'Schrotthändler',    desc: 'Sammle 100 Eisen',                      ok: S => (S.iron || 0) >= 100 },
  { id: 'peak',    name: 'Gipfelstürmer',     desc: 'Steig auf einen hohen Berg',            ok: S => S.mtn && S.mtn[tileAt(S.player.x, S.player.y)] >= 4 },
  { id: 'egg3',    name: 'Ostereisucher',     desc: 'Finde 3 Easter Eggs',                   ok: () => eggsFound.size >= 3 },
  { id: 'eggall',  name: 'Meisterdetektiv',   desc: 'Finde alle 7 Easter Eggs',              ok: () => eggsFound.size >= EGGS.length },
  { id: 'ult',     name: 'Spezialist',        desc: 'Setze 10-mal eine Spezialfähigkeit ein', ok: S => (S.player.abUses || 0) >= 10 },
  { id: 'storm',   name: 'Sturmerprobt',      desc: 'Überlebe eine Gewitternacht',           ok: S => (S.stormSurvived || 0) >= 1 },
  { id: 'arsenal', name: 'Waffenarsenal',     desc: 'Schalte alle Waffen frei',              ok: S => TOOL_ORDER.every(k => S.player.tl[k] > 0) },
  { id: 'smith',   name: 'Meisterschmied',    desc: 'Bringe ein Werkzeug auf Stufe 5',       ok: S => TOOL_ORDER.some(k => S.player.tl[k] >= 5) },
];
const achDone = new Set(store.get(ACH_KEY, []));
const EGG_KEY = 'nachtwache.eier';
const EGGS = [
  { id: 'konami', name: 'Konami-Code' }, { id: 'dance', name: 'Tanzbär' }, { id: '42', name: 'Die Antwort' },
  { id: 'cake', name: 'Kuchenlüge' }, { id: 'party', name: 'Partylöwe' }, { id: 'golden', name: 'Goldzombie' }, { id: 'tickle', name: 'Kitzlig' },
];
const eggsFound = new Set(store.get(EGG_KEY, []));
function foundEgg(id) {
  const e = EGGS.find(x => x.id === id);
  if (!e || eggsFound.has(id)) return;
  eggsFound.add(id); store.set(EGG_KEY, [...eggsFound]);
  if (S) toast('🥚 Easter Egg gefunden: ' + e.name + ' (' + eggsFound.size + '/' + EGGS.length + ')', '#ffe27a');
  SFX.play('levelup', undefined, undefined, true);
}
function hostGiveEgg(p, id) { if (p === S.player) foundEgg(id); else netSendTo(p, { t: 'egg', id }); }
// Easter Eggs, die der Client beim Host auslöst
function hostEgg(p, id) {
  if (id === 'konami') {
    if (S.eggUsed['konami']) { hostGiveEgg(p, 'konami'); return; }
    S.eggUsed['konami'] = 1;
    S.gold += 300; S.goldEarned += 300;
    for (let i = 0; i < 5; i++) burst(p.x, p.y - 10, ['#ff5b5b', '#ffe27a', '#7fd8ff', '#8fe08f', '#ff8ad8'][i], 12, 260, 1.3, 3.5, 140);
    banner('↑↑↓↓←→←→ B A', '+300 Gold – du alter Zocker!', '#ffe27a');
    SFX.play('levelup', p.x, p.y);
    hostGiveEgg(p, 'konami');
  } else if (id === 'tickle') {
    if (!S.hq) return;
    const c = bCenter(S.hq);
    floatText(c.x, c.y - 60, 'Hihi, das kitzelt! 🤭', '#ffe27a', 18);
    if (!S.eggUsed['tickle']) { S.eggUsed['tickle'] = 1; S.gold += 25; burst(c.x, c.y - 20, '#ffd36b', 30, 200, 0.9, 3.5, 150); }
    hostGiveEgg(p, 'tickle');
  }
}
function actEgg(id) {
  if (NET.role === 'client') netSendR({ t: 'egg', id }); else hostEgg(S.player, id);
}
const achQueue = [];
let achT = 0, achOpen = false;
function checkAchievements(dt) {
  achT += dt;
  if (achT < 0.5 || !S || !S.started || (mode !== 'play' && mode !== 'paused' && mode !== 'over')) return;
  achT = 0;
  for (const a of ACHIEVEMENTS) {
    if (achDone.has(a.id)) continue;
    let ok = false; try { ok = a.ok(S); } catch (e) {}
    if (ok) { achDone.add(a.id); store.set(ACH_KEY, [...achDone]); achQueue.push({ a, t: 4 }); SFX.play('levelup', undefined, undefined, true); }
  }
}
function drawAchPopup(dt) {
  const q = achQueue[0];
  if (!q) return;
  q.t -= dt;
  if (q.t <= 0) { achQueue.shift(); return; }
  const a = clamp(Math.min(q.t, 4 - q.t) * 3, 0, 1), w = 330, x = VW / 2 - w / 2, y = 84;
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(40,30,8,0.92)'; rr(x, y, w, 54, 10); ctx.fill();
  ctx.strokeStyle = '#ffd36b'; ctx.lineWidth = 2; ctx.stroke();
  text('🏆', x + 28, y + 27, 24, '#ffd36b', 'center');
  text('Erfolg freigeschaltet: ' + q.a.name, x + 52, y + 19, 14, '#ffe27a');
  text(q.a.desc, x + 52, y + 38, 12, '#ddd', 'left', '600');
  ctx.globalAlpha = 1;
}
function drawAchList() {
  const w = Math.min(640, VW - 24), cols = w > 520 ? 2 : 1, rowH = 44, rows = Math.ceil(ACHIEVEMENTS.length / cols);
  const h = 70 + rows * rowH, x = VW / 2 - w / 2, y = Math.max(20, VH / 2 - h / 2);
  panel(x, y, w, h, 0.96);
  ui.push({ x, y, w, h, fn: () => {} });
  text('🏆 Erfolge  ' + achDone.size + ' / ' + ACHIEVEMENTS.length, x + 18, y + 26, 20, '#ffe27a');
  text('×', x + w - 20, y + 25, 20, '#aaa', 'center');
  ui.push({ x: x + w - 36, y: y + 6, w: 32, h: 32, fn: () => { achOpen = false; } });
  const cw = (w - 36 - (cols - 1) * 10) / cols;
  ACHIEVEMENTS.forEach((a, i) => {
    const done = achDone.has(a.id), cx = x + 18 + (i % cols) * (cw + 10), cy = y + 52 + Math.floor(i / cols) * rowH;
    ctx.fillStyle = done ? 'rgba(255,211,107,0.14)' : 'rgba(255,255,255,0.05)'; rr(cx, cy, cw, rowH - 6, 6); ctx.fill();
    text(done ? '🏆' : '🔒', cx + 18, cy + 19, 16, done ? '#ffd36b' : '#777', 'center');
    text(a.name, cx + 38, cy + 12, 13, done ? '#ffe27a' : '#aaa');
    text(a.desc, cx + 38, cy + 28, 11, done ? '#ddd' : '#888', 'left', '600');
  });
}
function newSkills() { return { str: 0, bow: 0, gath: 0, vit: 0, spd: 0, loot: 0, crit: 0, armor: 0, vamp: 0 }; }
function newTools() { return { pick: 1, sword: 1, bow: 1, spear: 0, axe: 0, staff: 0 }; }
function mkPlayer(id) {
  return { id, x: WORLD / 2, y: WORLD / 2, r: 14, hp: 100, maxHp: 100, dead: 0, face: 0, tool: 'sword', cd: 0, swing: 0,
           lastHurt: -99, flash: 0, walk: 0, tp: 0, remote: false, lastInput: 0,
           inp: { mx: 0, my: 0, ax: 0, ay: 0, down: false }, tx: 0, ty: 0,
           lvl: 1, xp: 0, sp: 0, sk: newSkills(), tl: newTools(), afk: false, z: 0, vz: 0 };
}
function newGame(opts) {
  opts = opts || {};
  S = {
    t: 0, phase: 'day', phaseT: DAY_LEN, night: 1, survived: 0, nightT: 0, started: false,
    res: new Uint8Array(MAP * MAP), rhp: new Uint8Array(MAP * MAP), variant: new Uint8Array(MAP * MAP), bmap: new Int32Array(MAP * MAP),
    wobble: new Map(), grow: new Map(), resCount: [0, 0, 0, 0, 0, 0, 0, 0], resTarget: [0, 0, 0, 0, 0, 0, 0, 0], seed: (Math.random() * 1e6) | 0, regrowT: 3,
    buildings: [], bById: new Map(), nextId: 1, hq: null, counts: {},
    wood: 40, stone: 40, gold: 0, iron: 0,
    players: [], player: null,
    zombies: [], projs: [], parts: [], texts: [], bolts: [], rings: [], flashes: [],
    kills: 0, navVer: 0, cacheVer: -1, pathCache: new Map(),
    spawnQueue: [], spawnPts: [], qLen: 0,
    shake: 0, sel: null, place: 'hq', lastPlaceTile: -1, msg: null, banner: null, ending: 0,
    nextZid: 1, groanT: 3, goldEarned: 0,
    chests: [], chestT: 25, nextChest: 1, pings: [],
    weather: 0, strikes: [], strikeT: 4, stormSurvived: 0,
  };
  repathQ = [];
  S.players.push(mkPlayer(opts.localId || 0));
  S.player = S.players[0];
  S.clans = new Map(); S.eggUsed = {};
  S.player.name = playerName;
  if (!opts.noMap) genMap();
  S.players.forEach((p, i) => {
    const f = findFreeNear((MAP / 2 | 0) + i * 2, MAP / 2 | 0, false);
    p.x = (f % MAP + 0.5) * TS; p.y = ((f / MAP | 0) + 0.5) * TS;
  });
  const p = S.player;
  camX = p.x - VW / 2; camY = p.y - VH / 2;
  if (!HEADLESS && !opts.noMap) buildMinimap();
}

function genMap() {
  const R = S.res;
  const blob = (kind, n, rmin, rmax, prob) => {
    for (let k = 0; k < n; k++) {
      const cx = randi(3, MAP - 4), cy = randi(3, MAP - 4), rad = rand(rmin, rmax);
      for (let y = Math.floor(cy - rad); y <= cy + rad; y++)
        for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
          if (x < 2 || y < 2 || x >= MAP - 2 || y >= MAP - 2) continue;
          const d = Math.hypot(x - cx, y - cy);
          if (d <= rad && Math.random() < prob * (1 - d / (rad + 1) * 0.5)) R[y * MAP + x] = kind;
        }
    }
  };
  const f = MAP * MAP / 40000;   // Größenfaktor gegenüber der alten 200er-Karte
  blob(1, 260 * f | 0, 2, 5.5, 0.55);   // Wälder
  blob(2, 195 * f | 0, 1, 3, 0.6);      // Felsen
  blob(3, 72 * f | 0, 1, 1.7, 0.7);     // Golderz-Adern
  // vereinzelte Bäume / Felsen / Golderz
  for (let i = 0; i < 1200 * f; i++) {
    const x = randi(2, MAP - 3), y = randi(2, MAP - 3), r = Math.random();
    R[y * MAP + x] = r < 0.62 ? 1 : r < 0.93 ? 2 : 3;
  }
  genBiomes();
  for (let i = 0; i < MAP * MAP; i++) {
    const b = S.biome[i], r = Math.random();
    if (b === 2) { if (R[i] === 1 && r < 0.75) R[i] = 0; else if (R[i] === 2 && r < 0.35) R[i] = 3; else if (!R[i] && r < 0.006) R[i] = 3; }
    else if (b === 3) { if (!R[i] && r < 0.012) R[i] = 2; }
    else if (b === 4) { if (R[i] === 2 && r < 0.5) R[i] = 0; else if (!R[i] && r < 0.03) R[i] = 1; }
    else if (b === 5) R[i] = 0;
  }
  // Schrott der alten Welt: einzelne Wracks + ein paar Schrottplätze
  for (let i = 0; i < MAP * MAP; i++) { const b = S.biome[i]; if (!R[i] && (b === 0 || b === 2 || b === 4) && Math.random() < 0.0045) R[i] = 7; }
  for (let k = 0; k < 9; k++) {
    const cx = randi(20, MAP - 21), cy = randi(20, MAP - 21);
    if (Math.hypot(cx - MAP / 2, cy - MAP / 2) < 30 || inDim(cx, cy)) continue;
    for (let n = 0; n < 14; n++) { const x = cx + randi(-4, 4), y = cy + randi(-4, 4); if (inMap(x, y) && S.biome[y * MAP + x] !== 5) R[y * MAP + x] = 7; }
  }
  // Gebirge: Ring um die ganze Karte + einige Bergketten (für Zombies unpassierbar)
  const nearDim = (x, y) => x >= DIM.x0 - 4 && x < DIM.x1 + 4 && y >= DIM.y0 - 4 && y < DIM.y1 + 4;
  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
    const e = Math.min(x, y, MAP - 1 - x, MAP - 1 - y), w = 4 + Math.sin(x * 0.09 + y * 0.05 + S.seed % 7) * 1.5 + Math.sin((x - y) * 0.13) * 1.2;
    if (e < w && !nearDim(x, y)) R[y * MAP + x] = 6;
  }
  for (let k = 0; k < 7; k++) {
    const a = rand(0, TAU), d = rand(62, MAP / 2 - 20);
    let x = MAP / 2 + Math.cos(a) * d, y = MAP / 2 + Math.sin(a) * d, dir = rand(0, TAU);
    const len = randi(22, 46), wd = rand(1.4, 3);
    for (let s = 0; s < len; s++) {
      dir += rand(-0.35, 0.35);
      x += Math.cos(dir); y += Math.sin(dir);
      const wv = wd * (1 - Math.abs(s / len - 0.5) * 1.2) + 0.8;
      for (let yy = Math.floor(y - wv); yy <= y + wv; yy++) for (let xx = Math.floor(x - wv); xx <= x + wv; xx++) {
        if (!inMap(xx, yy) || nearDim(xx, yy) || Math.hypot(xx - MAP / 2, yy - MAP / 2) < 50) continue;
        if (Math.hypot(xx - x, yy - y) <= wv) R[yy * MAP + xx] = 6;
      }
    }
  }
  // Schattenreich: Wand aus Leere, Obsidian-Spitzen und Kristalle
  for (let y = DIM.y0 - 2; y < DIM.y1 + 2; y++) for (let x = DIM.x0 - 2; x < DIM.x1 + 2; x++) {
    if (!inMap(x, y)) continue;
    if (!inDim(x, y) || x < DIM.x0 + 1 || y < DIM.y0 + 1 || x >= DIM.x1 - 1 || y >= DIM.y1 - 1) R[y * MAP + x] = 4;
  }
  const dcx = (DIM.x0 + DIM.x1) >> 1, dcy = (DIM.y0 + DIM.y1) >> 1;
  for (let k = 0; k < 34; k++) {
    const cx = randi(DIM.x0 + 3, DIM.x1 - 4), cy = randi(DIM.y0 + 3, DIM.y1 - 4), rad = rand(1, 2.4);
    for (let y = Math.floor(cy - rad); y <= cy + rad; y++) for (let x = Math.floor(cx - rad); x <= cx + rad; x++)
      if (Math.hypot(x - cx, y - cy) <= rad && Math.random() < 0.6 && inDim(x, y) && R[y * MAP + x] !== 4) R[y * MAP + x] = 2;
  }
  for (let k = 0; k < 70; k++) { const x = randi(DIM.x0 + 3, DIM.x1 - 4), y = randi(DIM.y0 + 3, DIM.y1 - 4); if (!R[y * MAP + x]) R[y * MAP + x] = 5; }
  for (let y = dcy - 4; y <= dcy + 4; y++) for (let x = dcx - 4; x <= dcx + 4; x++) R[y * MAP + x] = 0;
  // Startbereich in der Mitte etwas lichten
  const c = MAP / 2 | 0;
  for (let y = c - 3; y <= c + 3; y++) for (let x = c - 3; x <= c + 3; x++) R[y * MAP + x] = 0;
  for (let i = 0; i < MAP * MAP; i++) {
    S.variant[i] = (Math.random() * 256) | 0;
    if (R[i]) { S.rhp[i] = RES_HP[R[i]]; S.resCount[R[i]]++; }
  }
  S.resTarget = S.resCount.slice();
  calcMountains();
}
// Berghöhe = Abstand zum Bergrand (für hohe Gipfel in der Mitte von Gebirgen)
function calcMountains() {
  const h = S.mtn = new Uint8Array(MAP * MAP);
  for (let i = 0; i < MAP * MAP; i++) if (S.res[i] === 6) h[i] = 99;
  for (let d = 1; d <= 7; d++) {
    for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
      const i = y * MAP + x;
      if (h[i] !== 99) continue;
      let edge = false;
      for (let k = 0; k < 8 && !edge; k++) {
        const nx = x + DIRS[k][0], ny = y + DIRS[k][1];
        if (!inMap(nx, ny)) continue;
        const v = h[ny * MAP + nx];
        if (v === d - 1 && (d > 1 || S.res[ny * MAP + nx] !== 6)) edge = true;
      }
      if (edge) h[i] = d;
    }
  }
  for (let i = 0; i < MAP * MAP; i++) if (h[i] === 99) h[i] = 8;
}

// ---------- Ressourcen abbauen, zerstören, nachwachsen
function setRes(i, kind, hp, grow) {
  const old = S.res[i];
  if (old !== kind) {
    if (old) S.resCount[old]--;
    if (kind) S.resCount[kind]++;
    S.res[i] = kind;
    S.navVer++;
    mmSet(i);
  }
  S.rhp[i] = hp;
  if (grow) S.grow.set(i, 1.2);
  if (NET.role === 'host') NET.ev.push(['r', i, kind, hp, grow ? 1 : 0]);
}
// zieht "amt" Einheiten ab; gibt zurück, wie viel tatsächlich abgebaut wurde
function mineRes(i, amt) {
  const kind = S.res[i];
  if (!kind || SOLID_RES(kind)) return 0;
  const got = Math.min(amt, S.rhp[i]);
  const left = S.rhp[i] - got;
  if (left <= 0) {
    const cx = (i % MAP + 0.5) * TS, cy = ((i / MAP | 0) + 0.5) * TS;
    setRes(i, 0, 0);
    burst(cx, cy, kind === 1 ? '#7a5530' : kind === 3 ? '#f2c94c' : kind === 5 ? '#c890ff' : '#8d8d96', 22, 200, 0.7, 4);
    if (kind === 1) burst(cx, cy, '#2f7334', 16, 160, 0.8, 4);
    SFX.play('rbreak', cx, cy);
  } else setRes(i, kind, left);
  return got;
}
// ---------- Schatztruhen: tauchen tagsüber auf, Beute für den, der sie zuerst erreicht
function chestTick(dt) {
  if (!S.started || !S.hq) return;
  if (S.phase === 'day') {
    S.chestT -= dt;
    if (S.chestT <= 0) {
      S.chestT = rand(18, 30);
      if (S.chests.length < 3) {
        const hx = S.hq.tx + 1, hy = S.hq.ty + 1;
        for (let tries = 0; tries < 60; tries++) {
          const a = rand(0, TAU), d = rand(9, 32);
          const tx = Math.round(hx + Math.cos(a) * d), ty = Math.round(hy + Math.sin(a) * d);
          if (tx < 2 || ty < 2 || tx >= MAP - 2 || ty >= MAP - 2) continue;
          const i = ty * MAP + tx;
          if (S.res[i] || S.bmap[i]) continue;
          const c = { id: S.nextChest++, x: (tx + 0.5) * TS, y: (ty + 0.5) * TS };
          S.chests.push(c);
          burst(c.x, c.y, '#ffe27a', 16, 120, 0.7, 3);
          toastAll('Eine Schatztruhe ist aufgetaucht! (gelb auf der Minimap)', '#ffe27a');
          break;
        }
      }
    }
  }
  for (const c of S.chests) {
    if (c.open) continue;
    const q = S.players.find(pl => pl.dead <= 0 && Math.hypot(pl.x - c.x, pl.y - c.y) < 34);
    if (q) openChest(c, q);
  }
  S.chests = S.chests.filter(c => !c.open);
}
function openChest(c, q) {
  c.open = true;
  const m = 1 + 0.15 * (S.night - 1), r = Math.random();
  let txt;
  if (r < 0.32) { const n = Math.round(rand(30, 70) * m); S.wood += n; txt = '+' + n + ' Holz'; }
  else if (r < 0.62) { const n = Math.round(rand(30, 70) * m); S.stone += n; txt = '+' + n + ' Stein'; }
  else if (r < 0.9) { const n = Math.round(rand(60, 140) * m * lootMul()); S.gold += n; S.goldEarned += n; txt = '+' + n + ' Gold'; }
  else { for (const pl of S.players) pl.hp = pl.maxHp; const n = Math.round(30 * m * lootMul()); S.gold += n; S.goldEarned += n; txt = 'Heiltrank! Alle geheilt +' + n + ' Gold'; }
  giveXp(q, 25);
  S.chestsOpened = (S.chestsOpened || 0) + 1;
  burst(c.x, c.y, '#ffe27a', 30, 200, 0.8, 3.5);
  ring(c.x, c.y, 60, 0.4, '#ffe27a');
  floatText(c.x, c.y - 24, txt, '#ffe27a', 16);
  SFX.play('upgrade', c.x, c.y);
  const who = q.name || ('Spieler ' + (q.id + 1));
  toastAll(who + ' hat eine Truhe geöffnet: ' + txt, '#ffe27a');
}
// ---------- Tiere: Hirsche & Hasen flüchten, Wildschweine wehren sich
const ADEF = {
  deer:   { name: 'Hirsch',     hp: 40, r: 14, walk: 40, run: 150, gold: 12, xp: 10, heal: 20, color: '#a0703c', flee: true },
  rabbit: { name: 'Hase',       hp: 12, r: 8,  walk: 35, run: 175, gold: 4,  xp: 4,  heal: 8,  color: '#c8b8a0', flee: true },
  boar:   { name: 'Wildschwein', hp: 90, r: 15, walk: 35, run: 125, gold: 20, xp: 18, heal: 25, color: '#5a4030', dmg: 12 },
};
const ATYPES = Object.keys(ADEF);
function animalTick(dt) {
  if (!S.animals) S.animals = [];
  S.animalT = (S.animalT || 0) - dt;
  const alive = S.players.filter(q => q.dead <= 0);
  if (S.animalT <= 0 && S.animals.length < 30 + 5 * alive.length && alive.length) {
    S.animalT = rand(2, 4);
    const base = alive[randi(0, alive.length - 1)];
    for (let tries = 0; tries < 30; tries++) {
      const a = rand(0, TAU), d = rand(18, 50) * TS, x = base.x + Math.cos(a) * d, y = base.y + Math.sin(a) * d;
      const ti = tileAt(x, y);
      if (ti < 0 || S.res[ti] || S.bmap[ti] || S.biome[ti] === 5) continue;
      if (S.hq && Math.hypot(x - bCenter(S.hq).x, y - bCenter(S.hq).y) < 12 * TS) continue;
      const r = Math.random(), type = r < 0.45 ? 'deer' : r < 0.8 ? 'rabbit' : 'boar', D = ADEF[type];
      S.animals.push({ id: S.nextAnimal = (S.nextAnimal || 0) + 1, type, x, y, r: D.r, hp: D.hp, maxHp: D.hp, face: rand(0, TAU), dir: rand(0, TAU), t: 0, flash: 0, walk: 0, angry: null, atkCd: 0, vx: 0, vy: 0, dead: false });
      break;
    }
  }
  for (const an of S.animals) {
    const D = ADEF[an.type];
    an.flash -= dt; an.t -= dt; an.atkCd -= dt;
    let sp = D.walk, dx = Math.cos(an.dir), dy = Math.sin(an.dir);
    const near = nearestPlayer(an.x, an.y);
    const dp = near ? Math.hypot(near.x - an.x, near.y - an.y) : 1e9;
    if (an.angry && (an.angry.dead > 0 || an.angry.afk || Math.hypot(an.angry.x - an.x, an.angry.y - an.y) > 500)) an.angry = null;
    if (an.angry) {
      const q = an.angry, d = Math.hypot(q.x - an.x, q.y - an.y) || 1;
      dx = (q.x - an.x) / d; dy = (q.y - an.y) / d; sp = D.run;
      if (d < an.r + q.r + 4) { sp = 0; if (an.atkCd <= 0) { an.atkCd = 1; hurtPlayer(q, D.dmg); } }
    } else if (D.flee && near && dp < 170) {
      dx = (an.x - near.x) / dp; dy = (an.y - near.y) / dp; sp = D.run;
    } else {
      if (an.t <= 0) { an.t = rand(2, 5); an.dir = rand(0, TAU); an.idle = Math.random() < 0.4; }
      if (an.idle) sp = 0;
    }
    an.vx = dx * sp; an.vy = dy * sp;
    an.x += an.vx * dt; an.y += an.vy * dt;
    if (sp > 0) { an.face = Math.atan2(dy, dx); an.walk += dt * sp * 0.1; }
    const ox = an.x, oy = an.y;
    collideTiles(an, false, false);
    if (Math.abs(an.x - ox) + Math.abs(an.y - oy) > 0.5) an.dir = rand(0, TAU);
    // zu weit weg von allen Spielern → verschwinden
    if (!S.players.some(q => Math.hypot(q.x - an.x, q.y - an.y) < 70 * TS)) an.dead = true;
  }
  S.animals = S.animals.filter(an => !an.dead);
}
function hurtAnimal(an, dmg, p) {
  if (an.dead) return;
  an.hp -= dmg; an.flash = 0.12;
  floatText(an.x, an.y - an.r - 6, Math.round(dmg), '#fff', 12);
  burst(an.x, an.y, '#8a2a2a', 5, 110, 0.4, 2.5);
  if (an.type === 'boar' && p) an.angry = p;
  else if (p) { an.t = 0; }
  if (an.hp <= 0) {
    an.dead = true;
    const D = ADEF[an.type], g = Math.round(D.gold * lootMul());
    S.gold += g; S.goldEarned += g; S.animalKills = (S.animalKills || 0) + 1;
    if (p) { giveXp(p, D.xp); p.hp = Math.min(p.maxHp, p.hp + D.heal); }
    floatText(an.x, an.y - 24, D.name + ': +' + g + ' Gold, +' + D.heal + ' HP', '#ffd36b', 13);
    burst(an.x, an.y, '#8a2a2a', 16, 150, 0.6, 3);
    SFX.play('zdie', an.x, an.y);
  }
}
// ---------- Markierung (Ping) für den Mitspieler
function addPing(x, y, pid) {
  S.pings.push({ x, y, pid, t: 4 });
  if (S.pings.length > 6) S.pings.shift();
  hostEv(['P', x | 0, y | 0, pid]);
  SFX.play('ping', undefined, undefined, true);
}
function pingAt(x, y) {
  if (NET.role === 'client') { netSendR({ t: 'pin', x: x | 0, y: y | 0 }); return; }
  addPing(x, y, S.player.id);
}
function regrowTick(dt) {
  S.regrowT -= dt;
  if (S.regrowT > 0) return;
  S.regrowT = rand(1.5, 3);
  // Art mit dem größten Defizit bevorzugen
  let kind = 0, best = 0;
  for (const k of [1, 2, 3, 7]) { const def = (S.resTarget[k] - S.resCount[k]) / Math.max(1, S.resTarget[k]); if (def > best) { best = def; kind = k; } }
  if (!kind || best < 0.02) return;
  for (let tries = 0; tries < 30; tries++) {
    let tx, ty;
    if (Math.random() < 0.7) { // neben einer bestehenden Ressource derselben Art (Wälder wachsen)
      const j = randi(0, MAP * MAP - 1);
      let found = -1;
      for (let s = 0; s < 400 && found < 0; s++) { const q = (j + s * 37) % (MAP * MAP); if (S.res[q] === kind) found = q; }
      if (found < 0) continue;
      tx = found % MAP + randi(-2, 2); ty = (found / MAP | 0) + randi(-2, 2);
    } else { tx = randi(2, MAP - 3); ty = randi(2, MAP - 3); }
    if (tx < 2 || ty < 2 || tx >= MAP - 2 || ty >= MAP - 2) continue;
    const i = ty * MAP + tx;
    if (S.res[i] || S.bmap[i] || (S.biome && S.biome[i] === 5)) continue;
    if (S.hq && Math.max(Math.abs(tx - S.hq.tx - 1), Math.abs(ty - S.hq.ty - 1)) <= 6) continue;
    if (S.portal && Math.hypot((tx + 0.5) * TS - S.portal.x, (ty + 0.5) * TS - S.portal.y) < TS * 2.5) continue;
    const cx = (tx + 0.5) * TS, cy = (ty + 0.5) * TS;
    let blocked = false;
    for (const p of S.players) if (Math.hypot(p.x - cx, p.y - cy) < TS * 2) blocked = true;
    for (const z of S.zombies) if (Math.abs(z.x - cx) < TS * 1.5 && Math.abs(z.y - cy) < TS * 1.5) { blocked = true; break; }
    let near = false;
    for (let y = ty - 1; y <= ty + 1 && !near; y++) for (let x = tx - 1; x <= tx + 1; x++) if (S.bmap[y * MAP + x]) near = true;
    if (blocked || near) continue;
    setRes(i, kind, RES_HP[kind], true);
    return;
  }
}

function findFreeNear(tx, ty, avoidBuild) {
  for (let r = 0; r < 30; r++) {
    for (let y = ty - r; y <= ty + r; y++) for (let x = tx - r; x <= tx + r; x++) {
      if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) !== r) continue;
      if (!inMap(x, y)) continue;
      const i = y * MAP + x;
      if (!S.res[i] && !S.bmap[i]) return i;
    }
  }
  return ty * MAP + tx;
}

// =====================================================================
// Räumliche Partitionierung für Zombies
// =====================================================================
const HC = 64;
const zHash = new Map();
const hashPool = [];
let hashUsed = 0;
const hk = (cx, cy) => cy * 1000 + cx;
function buildHash() {
  zHash.clear(); hashUsed = 0;
  for (const z of S.zombies) {
    if (z.dead) continue;
    const k = hk(z.x / HC | 0, z.y / HC | 0);
    let a = zHash.get(k);
    if (!a) {
      a = hashPool[hashUsed];
      if (!a) { a = []; hashPool[hashUsed] = a; }
      hashUsed++; a.length = 0; zHash.set(k, a);
    }
    a.push(z);
  }
}
function forZ(x, y, r, fn) {
  const x0 = Math.max(0, (x - r) / HC | 0), x1 = Math.max(0, (x + r) / HC | 0);
  const y0 = Math.max(0, (y - r) / HC | 0), y1 = Math.max(0, (y + r) / HC | 0);
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    const a = zHash.get(hk(cx, cy));
    if (!a) continue;
    for (let i = 0; i < a.length; i++) { const z = a[i]; if (!z.dead && fn(z) === false) return; }
  }
}
function nearestZombie(x, y, range) {
  let best = null, bd = range * range;
  forZ(x, y, range + 40, z => {
    const dx = z.x - x, dy = z.y - y, d2 = dx * dx + dy * dy;
    if (d2 < bd) { bd = d2; best = z; }
  });
  return best;
}

// =====================================================================
// A*-Pfadsuche auf dem Grid (gewichtete Kosten: Gebäude = durchbrechbar)
// =====================================================================
const NN = MAP * MAP;
const aG = new Float32Array(NN), aFrom = new Int32Array(NN), aSeen = new Uint32Array(NN), aClosed = new Uint32Array(NN);
let aStamp = 0;
const heapI = [], heapF = [];
function hpush(i, f) {
  let n = heapI.length; heapI.push(i); heapF.push(f);
  while (n > 0) { const p = (n - 1) >> 1; if (heapF[p] <= f) break; heapI[n] = heapI[p]; heapF[n] = heapF[p]; n = p; }
  heapI[n] = i; heapF[n] = f;
}
function hpop() {
  const top = heapI[0], li = heapI.pop(), lf = heapF.pop(), len = heapI.length;
  if (len > 0) {
    let n = 0;
    for (;;) {
      let c = 2 * n + 1; if (c >= len) break;
      if (c + 1 < len && heapF[c + 1] < heapF[c]) c++;
      if (heapF[c] >= lf) break;
      heapI[n] = heapI[c]; heapF[n] = heapF[c]; n = c;
    }
    heapI[n] = li; heapF[n] = lf;
  }
  return top;
}
const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
// -1 = unpassierbar, 0 = Ziel (Reaktor), 1 = frei, >1 = Gebäude (Kosten ~ HP)
function tileCost(i) {
  if (S.res[i]) return -1;
  const id = S.bmap[i];
  if (!id) return 1;
  const b = S.bById.get(id);
  if (b.type === 'hq') return 0;
  if (b.type === 'trap') return 0.8;   // Zombies laufen bevorzugt hinein
  return 1 + b.hp / 30;
}
function findPath(start) {
  const hq = S.hq; if (!hq) return null;
  const gx = hq.tx + 1, gy = hq.ty + 1;
  const h = i => { const dx = Math.abs(i % MAP - gx), dy = Math.abs((i / MAP | 0) - gy); return Math.max(0, (dx > dy ? dx + 0.414 * dy : dy + 0.414 * dx) - 1.5); };
  aStamp++; heapI.length = 0; heapF.length = 0;
  aG[start] = 0; aSeen[start] = aStamp; aFrom[start] = -1;
  hpush(start, h(start));
  while (heapI.length) {
    const cur = hpop();
    if (aClosed[cur] === aStamp) continue;
    aClosed[cur] = aStamp;
    if (cur !== start && tileCost(cur) === 0) {
      const path = [];
      let c = cur;
      while (c !== start && c !== -1) { path.push(c); c = aFrom[c]; }
      path.reverse();
      return path;
    }
    const cx = cur % MAP, cy = cur / MAP | 0;
    for (let k = 0; k < 8; k++) {
      const d = DIRS[k], nx = cx + d[0], ny = cy + d[1];
      if (!inMap(nx, ny)) continue;
      const ni = ny * MAP + nx;
      if (aClosed[ni] === aStamp) continue;
      let c = tileCost(ni);
      if (c < 0) continue;
      if (k >= 4) { // keine Ecken schneiden
        if (tileCost(cy * MAP + nx) !== 1 || tileCost(ny * MAP + cx) !== 1) continue;
      }
      if (c === 0) c = 1;
      const g = aG[cur] + c * d[2];
      if (aSeen[ni] !== aStamp || g < aG[ni]) {
        aSeen[ni] = aStamp; aG[ni] = g; aFrom[ni] = cur;
        hpush(ni, g + h(ni) * 1.2);
      }
    }
  }
  return null;
}
function getPath(start) {
  if (S.cacheVer !== S.navVer) { S.pathCache.clear(); S.cacheVer = S.navVer; }
  let p = S.pathCache.get(start);
  if (p) return { path: p, cached: true };
  p = findPath(start) || [];
  S.pathCache.set(start, p);
  return { path: p, cached: false };
}
function processRepaths() {
  let budget = 6, guard = 200;
  while (budget > 0 && repathQ.length && guard-- > 0) {
    const z = repathQ.shift();
    z.queued = false;
    if (z.dead) continue;
    const st = tileAt(z.x, z.y);
    if (st < 0) continue;
    const r = getPath(st);
    z.path = r.path; z.pi = 0; z.ver = S.navVer;
    if (!r.cached) budget--;
  }
}

// =====================================================================
// Kollision
// =====================================================================
function collideTiles(e, isPlayer, ignoreRes) {
  const r = e.r;
  const x0 = Math.max(0, Math.floor((e.x - r) / TS)), x1 = Math.min(MAP - 1, Math.floor((e.x + r) / TS));
  const y0 = Math.max(0, Math.floor((e.y - r) / TS)), y1 = Math.min(MAP - 1, Math.floor((e.y + r) / TS));
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const i = ty * MAP + tx;
    if (S.res[i]) {
      if (ignoreRes || (isPlayer && S.res[i] === 6)) continue;   // Spieler können auf Berge steigen
      const cx = (tx + 0.5) * TS, cy = (ty + 0.5) * TS, rr = r + RES_R;
      const dx = e.x - cx, dy = e.y - cy, d2 = dx * dx + dy * dy;
      if (d2 < rr * rr) { const d = Math.sqrt(d2) || 0.01; e.x = cx + dx / d * rr; e.y = cy + dy / d * rr; }
    } else if (S.bmap[i]) {
      const btype = S.bById.get(S.bmap[i]).type;
      if (btype === 'trap' || (isPlayer && btype === 'door')) continue;
      if (isPlayer && e.z > 24 && (btype === 'wall' || btype === 'door')) continue;   // über Mauern springen
      const rx = tx * TS, ry = ty * TS;
      const nx = clamp(e.x, rx, rx + TS), ny = clamp(e.y, ry, ry + TS);
      const dx = e.x - nx, dy = e.y - ny, d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        if (d2 > 1e-6) { const d = Math.sqrt(d2); e.x += dx / d * (r - d); e.y += dy / d * (r - d); }
        else {
          const l = e.x - rx, rt = rx + TS - e.x, t = e.y - ry, b = ry + TS - e.y, m = Math.min(l, rt, t, b);
          if (m === l) e.x = rx - r; else if (m === rt) e.x = rx + TS + r; else if (m === t) e.y = ry - r; else e.y = ry + TS + r;
        }
      }
    }
  }
  e.x = clamp(e.x, r, WORLD - r); e.y = clamp(e.y, r, WORLD - r);
}

// =====================================================================
// Effekte
// =====================================================================
// Alle sichtbaren Effekte laufen über diese Funktionen; der Host spiegelt sie als Events zum Mitspieler.
const hostEv = e => { if (NET.role === 'host') NET.ev.push(e); };
function burst(x, y, color, n, speed, life, size, grav) {
  hostEv(['b', x | 0, y | 0, color, n, speed, life, size, grav || 0]);
  if (HEADLESS) return;
  for (let i = 0; i < n; i++) {
    if (S.parts.length > 1600) S.parts.shift();
    const a = rand(0, TAU), s = rand(0.25, 1) * speed, l = rand(0.5, 1) * life;
    S.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: l, max: l, color, size: rand(0.6, 1.2) * size, grav: grav || 0 });
  }
}
function floatText(x, y, text, color, size) {
  hostEv(['t', x | 0, y | 0, String(text), color, size || 13]);
  if (S.texts.length > 70) S.texts.shift();
  S.texts.push({ x: x + rand(-6, 6), y, text, color, size: size || 13, life: 0.8, max: 0.8 });
}
function addShake(v, x, y) {
  if (x !== undefined) {
    hostEv(['k', v, x | 0, y | 0]);
    const d = Math.hypot(x - (camX + VW / 2), y - (camY + VH / 2));
    v *= clamp(1.2 - d / 800, 0, 1);
  }
  S.shake = Math.min(18, S.shake + v);
}
// Effekte, die nur einen bestimmten Spieler betreffen (Treffer, Tod, Hinweise)
function shakeFor(p, v) { if (p === S.player) S.shake = Math.min(18, S.shake + v); else hostEv(['K', p.id, v]); }
function sfxFor(p, name) { if (p === S.player) SFX.play(name, undefined, undefined, true); else hostEv(['S', p.id, name]); }
function toastFor(p, text, color) { if (p === S.player) toast(text, color); else netSendTo(p, { t: 'T', text, color }); }
function toast(text, color) { S.msg = { text, color: color || '#ffd36b', t: 2.2 }; }
function toastAll(text, color) { hostEv(['m', text, color]); toast(text, color); }
function banner(text, sub, color) { hostEv(['n', text, sub || '', color || '#fff']); S.banner = { text, sub: sub || '', color: color || '#fff', t: 3.2 }; }
function ring(x, y, max, life, color) { hostEv(['g', x | 0, y | 0, max, life, color]); S.rings.push({ x, y, r: 8, max, life, maxLife: life, color }); }
function lightFlash(x, y, r, life) { hostEv(['f', x | 0, y | 0, r, life]); S.flashes.push({ x, y, r, life, max: life }); }
function bolt(pts, color) { hostEv(['l', pts.map(q => [q[0] | 0, q[1] | 0]), color]); S.bolts.push({ pts, life: 0.25, max: 0.25, color, seed: Math.random() * 1000 }); }

// =====================================================================
// Gebäude
// =====================================================================
const bCenter = b => ({ x: (b.tx + b.size / 2) * TS, y: (b.ty + b.size / 2) * TS });
function hqLvl() { return S.hq ? S.hq.lvl : 1; }
function canAfford(c) { return S.wood >= c.w && S.stone >= c.s && S.gold >= c.g && (S.iron || 0) >= (c.i || 0); }
function pay(c) { S.wood -= c.w; S.stone -= c.s; S.gold -= c.g; S.iron = (S.iron || 0) - (c.i || 0); }
function costText(c) {
  const parts = [];
  if (c.w) parts.push(c.w + ' Holz');
  if (c.s) parts.push(c.s + ' Stein');
  if (c.g) parts.push(c.g + ' Gold');
  if (c.i) parts.push(c.i + ' Eisen');
  return parts.length ? parts.join(' · ') : 'kostenlos';
}
function missingText(c) {
  const m = [];
  if (S.wood < c.w) m.push('Holz'); if (S.stone < c.s) m.push('Stein'); if (S.gold < c.g) m.push('Gold'); if ((S.iron || 0) < (c.i || 0)) m.push('Eisen');
  return 'Nicht genug ' + m.join(', ');
}
function footprintAt(type, wx, wy) {
  const sz = BDEF[type].size;
  return { tx: Math.round(wx / TS - sz / 2), ty: Math.round(wy / TS - sz / 2), size: sz };
}
function placeError(type, tx, ty) {
  const d = BDEF[type], sz = d.size;
  if (type !== 'hq' && !S.hq) return 'Platziere zuerst den Reaktor!';
  if (type === 'hq' && S.hq) return 'Es gibt nur einen Reaktor';
  if (type === 'hq') {
    if (tx < 10 || ty < 10 || tx + sz > MAP - 10 || ty + sz > MAP - 10) return 'Zu nah am Kartenrand';
  } else {
    const hx = S.hq.tx + 1.5, hy = S.hq.ty + 1.5, cx = tx + sz / 2, cy = ty + sz / 2;
    if (Math.max(Math.abs(cx - hx), Math.abs(cy - hy)) > buildRange()) return 'Außerhalb des Baubereichs – Reaktor aufwerten vergrößert ihn';
    if ((S.counts[type] || 0) >= d.max) return 'Limit erreicht (' + d.max + ')';
  }
  for (let y = ty; y < ty + sz; y++) for (let x = tx; x < tx + sz; x++) {
    if (!inMap(x, y) || x < 1 || y < 1 || x >= MAP - 1 || y >= MAP - 1) return 'Ungültige Position';
    const i = y * MAP + x;
    if (S.res[i]) return 'Blockiert durch ' + (S.res[i] === 1 ? 'Baum' : S.res[i] === 3 ? 'Golderz' : S.res[i] === 4 ? 'die Leere' : S.res[i] === 5 ? 'Kristall' : S.res[i] === 6 ? 'einen Berg' : S.res[i] === 7 ? 'Schrott' : 'Fels');
    if (S.portal && Math.hypot((x + 0.5) * TS - S.portal.x, (y + 0.5) * TS - S.portal.y) < TS * 1.6) return 'Hier steht das Portal';
    if (S.bmap[i]) return 'Blockiert durch Gebäude';
  }
  const rx = tx * TS, ry = ty * TS, rw = sz * TS;
  const overlaps = e => {
    const nx = clamp(e.x, rx, rx + rw), ny = clamp(e.y, ry, ry + rw);
    return (e.x - nx) ** 2 + (e.y - ny) ** 2 < (e.r - 2) ** 2;
  };
  for (const p of S.players) if (type !== 'door' && type !== 'trap' && p.dead <= 0 && overlaps(p)) return p === S.player ? 'Du stehst im Weg' : 'Dein Mitspieler steht im Weg';
  if (type !== 'trap') for (const z of S.zombies) if (!z.dead && overlaps(z)) return 'Zombie im Weg';
  const c = costFor(type, 1);
  if (!canAfford(c)) return missingText(c);
  return null;
}
function placeBuilding(type, tx, ty, who) {
  if (!HEADLESS || who) giveXp(who || S.player, type === 'wall' || type === 'door' ? 1 : 4);
  const d = BDEF[type];
  pay(costFor(type, 1));
  const b = {
    id: S.nextId++, type, tx, ty, size: d.size, lvl: 1, hp: d.hp[0], maxHp: d.hp[0], cd: rand(0, 0.5),
    flash: 0, angle: -Math.PI / 2, spent: Object.assign({}, costFor(type, 1)), dead: false, acc: 0, nodes: { t: 0, r: 0 }, born: S.t,
  };
  S.buildings.push(b); S.bById.set(b.id, b);
  for (let y = ty; y < ty + d.size; y++) for (let x = tx; x < tx + d.size; x++) S.bmap[y * MAP + x] = b.id;
  S.counts[type] = (S.counts[type] || 0) + 1;
  if (type === 'harv') countNodes(b);
  if (type === 'hq') {
    S.hq = b; S.started = true; S.place = null;
    banner('Reaktor errichtet', 'Sammle Holz & Stein und baue Verteidigung – Nacht 1 kommt!', '#ffd36b');
  }
  const c = bCenter(b);
  SFX.play(type === 'hq' ? 'upgrade' : 'place', c.x, c.y);
  burst(c.x, c.y, '#d8c8a0', 10 + d.size * 6, 120, 0.5, 3);
  S.navVer++; NET.bDirty = true;
  return b;
}
function countNodes(b) {
  const c = bCenter(b), rad = BDEF.harv.radius[b.lvl - 1];
  const lists = [null, [], [], []];
  const cx = c.x / TS, cy = c.y / TS;
  for (let y = Math.floor(cy - rad); y <= cy + rad; y++) for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
    if (!inMap(x, y)) continue;
    if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > rad) continue;
    const i = y * MAP + x, v = S.res[i];
    if (v && v <= 3 && lists[v].length < 14) lists[v].push(i);
  }
  b.nodes = { t: lists[1].length, r: lists[2].length, g: lists[3].length };
  return lists;
}
function upgradeError(b) {
  if (b.lvl >= 5) return 'Maximale Stufe erreicht';
  if (b.type !== 'hq' && b.lvl >= hqLvl()) return 'Reaktor Stufe ' + (b.lvl + 1) + ' benötigt';
  const c = costFor(b.type, b.lvl + 1);
  if (!canAfford(c)) return missingText(c);
  return null;
}
function upgradeBuilding(b, who) {
  who = who || S.player;
  const err = upgradeError(b);
  if (err) { toastFor(who, err, '#ff7b6b'); sfxFor(who, 'error'); return false; }
  const c = costFor(b.type, b.lvl + 1);
  pay(c);
  b.spent.w += c.w; b.spent.s += c.s; b.spent.g += c.g;
  b.lvl++;
  b.maxHp = BDEF[b.type].hp[b.lvl - 1]; b.hp = b.maxHp;
  if (b.type === 'harv') countNodes(b);
  if (b.type === 'hq') { for (const p of S.players) recalcMaxHp(p); toastAll('Baubereich vergrößert! (' + (buildRange() * 2 + 1) + ' × ' + (buildRange() * 2 + 1) + ' Felder)', '#ffe27a'); }
  giveXp(who, 6);
  const ce = bCenter(b);
  burst(ce.x, ce.y, '#ffe27a', 24, 160, 0.7, 3);
  ring(ce.x, ce.y, b.size * TS, 0.4, '#ffe27a');
  SFX.play('upgrade', ce.x, ce.y);
  S.navVer++; NET.bDirty = true;
  return true;
}
function sellBuilding(b, who) {
  who = who || S.player;
  if (b.type === 'hq') { toastFor(who, 'Der Reaktor kann nicht verkauft werden', '#ff7b6b'); sfxFor(who, 'error'); return; }
  const f = 0.5 * (b.hp / b.maxHp);
  S.wood += Math.floor(b.spent.w * f); S.stone += Math.floor(b.spent.s * f); S.gold += Math.floor(b.spent.g * f);
  const ce = bCenter(b);
  removeBuilding(b);
  SFX.play('sell', ce.x, ce.y);
}
function removeBuilding(b) {
  if (b.dead) return;
  b.dead = true;
  for (let y = b.ty; y < b.ty + b.size; y++) for (let x = b.tx; x < b.tx + b.size; x++) S.bmap[y * MAP + x] = 0;
  S.bById.delete(b.id);
  const i = S.buildings.indexOf(b); if (i >= 0) S.buildings.splice(i, 1);
  S.counts[b.type]--;
  if (S.sel === b) S.sel = null;
  S.navVer++; NET.bDirty = true;
}
function damageBuilding(b, dmg) {
  if (b.dead) return;
  b.hp -= dmg; b.flash = 0.12;
  const c = bCenter(b);
  burst(c.x + rand(-10, 10), c.y + rand(-10, 10), '#b8a890', 3, 90, 0.35, 2.5);
  SFX.play(b.type === 'hq' ? 'hqhit' : 'bhit', c.x, c.y);
  if (b.type === 'hq' && b.hp < b.maxHp * 0.5 && !S.hqWarned) { S.hqWarned = true; toastAll('Der Reaktor wird angegriffen!', '#ff5b5b'); }
  if (b.hp <= 0) {
    burst(c.x, c.y, '#a89878', 26 + b.size * 10, 220, 0.8, 4);
    burst(c.x, c.y, '#ff9a3a', 12, 180, 0.5, 3);
    addShake(4 + b.size * 2, c.x, c.y);
    SFX.play('bdestroy', c.x, c.y);
    if (b.type === 'hq') {
      removeBuilding(b);
      S.hq = null;
      burst(c.x, c.y, '#ffd36b', 120, 420, 1.4, 5);
      ring(c.x, c.y, 300, 0.8, '#ffb347');
      addShake(18, c.x, c.y); SFX.play('boom', c.x, c.y);
      S.ending = 2.6;
      banner('Der Reaktor ist gefallen!', '', '#ff5b5b');
    } else removeBuilding(b);
  }
}
// Tile mit festem Gebäude (Fallen sind begehbar)
function solidAt(ti) { const id = ti >= 0 ? S.bmap[ti] : 0; return id && S.bById.get(id).type !== 'trap' ? id : 0; }
function nearestBuilding(x, y, range) {
  let best = null, bd = range * range;
  for (const b of S.buildings) {
    if (b.type === 'trap') continue;
    const c = bCenter(b), dx = c.x - x, dy = c.y - y, d2 = dx * dx + dy * dy;
    if (d2 < bd) { bd = d2; best = b; }
  }
  return best;
}
function buildingAtWorld(x, y) { const i = tileAt(x, y); return i >= 0 && S.bmap[i] ? S.bById.get(S.bmap[i]) : null; }

function updBuildings(dt) {
  for (const b of S.buildings) {
    b.flash -= dt;
    if (S.phase === 'day' && b.hp < b.maxHp) b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.015 * dt);
    const d = BDEF[b.type], L = b.lvl - 1;
    if (b.type === 'hq' || b.type === 'mine') { const g = d.gold[L] * dt; S.gold += g; S.goldEarned += g; continue; }
    if (b.type === 'trap') {
      b.cd -= dt;
      if (b.cd <= 0) {
        b.cd = 0.5;
        const c = bCenter(b);
        let hits = 0;
        forZ(c.x, c.y, TS, z => {
          if (Math.abs(z.x - c.x) < TS / 2 + z.r * 0.5 && Math.abs(z.y - c.y) < TS / 2 + z.r * 0.5) {
            hurtZombie(z, d.dmg[L], null); z.slowT = 0.6; hits++;
          }
        });
        if (hits) {
          b.flash = 0.15; b.spike = 0.3;
          burst(c.x, c.y, '#c0392b', 3 + hits, 80, 0.35, 2.5);
          SFX.play('bhit', c.x, c.y);
          damageBuilding(b, 3 * hits);
        }
      }
      if (b.spike) b.spike = Math.max(0, b.spike - dt);
      continue;
    }
    if (b.type === 'frost') {
      b.acc += dt; b.angle += dt * 1.5;
      if (b.acc >= 0.5) {
        b.acc -= 0.5;
        const c = bCenter(b), R = d.radius[L] * TS;
        let n = 0;
        forZ(c.x, c.y, R + 30, z => {
          if (Math.hypot(z.x - c.x, z.y - c.y) > R + z.r) return;
          z.frostT = 0.7; z.frostS = d.slow[L];
          hurtZombie(z, d.dmg[L] * 0.5, null, true);
          if (n++ < 6 && !HEADLESS) burst(z.x, z.y - 6, '#bfe8ff', 2, 40, 0.5, 2.2, -30);
        });
      }
      continue;
    }
    if (b.type === 'heal') {
      b.acc += dt; b.angle += dt;
      if (b.acc >= 1) {
        b.acc -= 1;
        const c = bCenter(b), R = d.radius[L] * TS, amt = d.heal[L];
        let fx = 0;
        for (const o of S.buildings) {
          if (o === b || o.hp >= o.maxHp) continue;
          const oc = bCenter(o);
          if (Math.hypot(oc.x - c.x, oc.y - c.y) > R + o.size * TS * 0.5) continue;
          o.hp = Math.min(o.maxHp, o.hp + amt);
          if (fx++ < 4) burst(oc.x, oc.y, '#7dff9a', 3, 50, 0.6, 2.5, -40);
        }
        for (const q of S.players) if (q.dead <= 0 && q.hp < q.maxHp && Math.hypot(q.x - c.x, q.y - c.y) < R) {
          q.hp = Math.min(q.maxHp, q.hp + amt * 0.5);
          burst(q.x, q.y, '#7dff9a', 3, 50, 0.6, 2.5, -40);
        }
      }
      continue;
    }
    if (b.type === 'harv') {
      b.acc += dt; b.angle += dt * (2 + b.lvl);
      if (b.acc >= 1) {
        b.acc -= 1;
        // Ernte verbraucht die Ressourcen in der Nähe – sie gehen irgendwann kaputt
        const lists = countNodes(b);
        if (!b.dep) b.dep = [0, 0, 0, 0];
        for (let k = 1; k <= 3; k++) {
          const gain = lists[k].length * d.rate[L];
          if (k === 1) S.wood += gain; else if (k === 2) S.stone += gain; else { S.gold += gain * 2; S.goldEarned += gain * 2; }
          b.dep[k] += gain;
          while (b.dep[k] >= 1 && lists[k].length) { b.dep[k] -= 1; mineRes(lists[k][randi(0, lists[k].length - 1)], 1); }
          if (!lists[k].length) b.dep[k] = 0;
        }
        if (b.nodes.t + b.nodes.r + b.nodes.g > 0) { const c = bCenter(b); burst(c.x, c.y - 8, b.nodes.g ? '#f2c94c' : b.nodes.t >= b.nodes.r ? '#c89a5a' : '#b0b0b8', 3, 50, 0.5, 2); }
      }
      continue;
    }
    if (!TOWERS[b.type]) continue;
    b.cd -= dt;
    if (b.cd > 0) continue;
    const c = bCenter(b), range = d.range[L] * TS;
    const z = nearestZombie(c.x, c.y, range);
    if (!z) { b.cd = 0.15; continue; }
    b.cd = d.rate[L];
    const tAng = Math.atan2(z.y - c.y, z.x - c.x);
    b.angle = tAng;
    const dmg = d.dmg[L];
    if (b.type === 'arrow') {
      const sp = 760, dist = Math.hypot(z.x - c.x, z.y - c.y), tt = dist / sp;
      const ax = z.x + z.vx * tt, ay = z.y + z.vy * tt, a = Math.atan2(ay - c.y, ax - c.x);
      S.projs.push({ k: 'arrow', x: c.x, y: c.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: range / sp + 0.15, dmg, r: 4 });
      SFX.play('tarrow', c.x, c.y);
    } else if (b.type === 'cannon') {
      const sp = 520, dist = Math.hypot(z.x - c.x, z.y - c.y), tt = dist / sp;
      const ax = z.x + z.vx * tt, ay = z.y + z.vy * tt, dd = Math.hypot(ax - c.x, ay - c.y), a = Math.atan2(ay - c.y, ax - c.x);
      S.projs.push({ k: 'ball', x: c.x + Math.cos(a) * 26, y: c.y + Math.sin(a) * 26, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: dd / sp, dmg, r: 6, splash: d.splash[L] * TS });
      burst(c.x + Math.cos(a) * 30, c.y + Math.sin(a) * 30, '#ffcf6b', 6, 120, 0.25, 2.5);
      SFX.play('cannon', c.x, c.y);
      addShake(0.8, c.x, c.y);
    } else if (b.type === 'mage') {
      mageChain(c.x, c.y - 12, z, dmg, d.chain[L]);
    } else if (b.type === 'bomb') {
      const T = 0.9, ax = z.x + z.vx * T * 0.8, ay = z.y + z.vy * T * 0.8;
      S.projs.push({ k: 'bomb', sx: c.x, sy: c.y, x: c.x, y: c.y, tx: ax, ty: ay, t: 0, T, dmg, splash: d.splash[L] * TS, h: 0 });
      SFX.play('cannon', c.x, c.y);
    }
  }
}
function mageChain(x, y, first, dmg, jumps) {
  const hit = new Set(), pts = [[x, y]];
  let cur = first;
  for (let i = 0; i < jumps && cur; i++) {
    hit.add(cur); pts.push([cur.x, cur.y]);
    const cx = cur.x, cy = cur.y;
    hurtZombie(cur, dmg * (1 - i * 0.07), null);
    let nxt = null, bd = 160 * 160;
    forZ(cx, cy, 200, o => {
      if (hit.has(o)) return;
      const d2 = (o.x - cx) ** 2 + (o.y - cy) ** 2;
      if (d2 < bd) { bd = d2; nxt = o; }
    });
    cur = nxt;
  }
  bolt(pts, '#c792ff');
  lightFlash(x, y, 160, 0.2);
  SFX.play('zap', x, y);
}
function explode(x, y, rad, dmg, big, owner) {
  forZ(x, y, rad + 40, z => {
    const d = Math.hypot(z.x - x, z.y - y);
    if (d < rad + z.r) {
      const f = 1 - 0.5 * clamp(d / rad, 0, 1);
      const a = Math.atan2(z.y - y, z.x - x);
      if (owner) { z.lastHit = owner; lifeSteal(owner, dmg * f * 0.5); }
      hurtZombie(z, dmg * f, { x: Math.cos(a) * (big ? 260 : 160), y: Math.sin(a) * (big ? 260 : 160) });
    }
  });
  if (!HEADLESS) {
    burst(x, y, '#ffb347', big ? 36 : 18, big ? 300 : 200, 0.55, big ? 4.5 : 3.5);
    burst(x, y, '#ff6a2b', big ? 20 : 10, big ? 200 : 140, 0.45, 3);
    burst(x, y, '#5a5048', big ? 18 : 8, 80, 1.1, 5);
  }
  ring(x, y, rad, 0.35, '#ffcf6b');
  lightFlash(x, y, rad * 2.2, 0.3);
  SFX.play(big ? 'boom' : 'cannon', x, y);
  addShake(big ? 6 : 2.2, x, y);
}

// =====================================================================
// Zombies
// =====================================================================
function nightPlan(N) {
  const total = Math.round(6 + 4 * N + 0.5 * N * N);
  const pRun = N >= 2 ? Math.min(0.3, 0.12 + 0.02 * N) : 0;
  const pBrute = N >= 3 ? Math.min(0.14, 0.04 + 0.01 * N) : 0;
  const pSpit = N >= 4 ? Math.min(0.15, 0.05 + 0.01 * N) : 0;
  const pBomb = N >= 6 ? Math.min(0.1, 0.03 + 0.008 * N) : 0;
  const pSham = N >= 8 ? Math.min(0.06, 0.02 + 0.003 * N) : 0;
  const pArm = N >= 9 ? Math.min(0.12, 0.03 + 0.006 * N) : 0;
  const list = [];
  for (let i = 0; i < total; i++) {
    let r = Math.random();
    if (r < pSham) { list.push('shaman'); continue; } r -= pSham;
    if (r < pArm) { list.push('armored'); continue; } r -= pArm;
    list.push(r < pRun ? 'runner' : r < pRun + pBrute ? 'brute' : r < pRun + pBrute + pSpit ? 'spitter' : r < pRun + pBrute + pSpit + pBomb ? 'bomber' : 'normal');
  }
  return list;
}
function edgePoint() {
  const hx = S.hq ? S.hq.tx + 1 : MAP / 2, hy = S.hq ? S.hq.ty + 1 : MAP / 2;
  for (let tries = 0; tries < 80; tries++) {
    const a = rand(0, TAU), d = rand(Math.max(44, buildRange() + 16), Math.max(52, buildRange() + 24));
    const tx = clamp(Math.round(hx + Math.cos(a) * d), 1, MAP - 2), ty = clamp(Math.round(hy + Math.sin(a) * d), 1, MAP - 2);
    const i = ty * MAP + tx;
    if (!S.res[i] && !S.bmap[i]) return { tx, ty };
  }
  return { tx: 1, ty: 1 };
}
function startNight() {
  const N = S.night;
  S.phase = 'night'; S.phaseT = NIGHT_LEN; S.nightT = 0; S.hqWarned = false;
  const plan = nightPlan(N);
  S.bloodMoon = N % 7 === 0;
  if (S.bloodMoon) { const extra = Math.round(plan.length * 0.3); for (let k = 0; k < extra; k++) plan.push(plan[randi(0, plan.length - 1)]); }
  const nPts = Math.min(6, 2 + Math.floor(N / 3));
  S.spawnPts = [];
  for (let i = 0; i < nPts; i++) S.spawnPts.push(edgePoint());
  const dur = Math.min(40, 18 + N * 2);
  S.spawnQueue = plan.map((type, i) => ({ type, at: (i / plan.length) * dur + rand(0, 1.5), pt: i % nPts }));
  if (N % 5 === 0) {
    const nb = Math.max(1, Math.floor(N / 10) + (N % 10 === 5 && N > 5 ? 1 : 0));
    for (let i = 0; i < nb; i++) S.spawnQueue.push({ type: 'boss', at: 6 + i * 8, pt: i % nPts });
  }
  S.spawnQueue.sort((a, b) => a.at - b.at);
  if (S.bloodMoon) banner('🩸 BLUTMOND 🩸', 'Mehr und stärkere Zombies – dafür doppelt Gold und XP!', '#ff3a3a');
  else banner('NACHT ' + N, N % 5 === 0 ? '⚠ Ein Boss nähert sich! ⚠' : 'Verteidige den Reaktor!', '#ff6b6b');
  SFX.play('horn');
  if (N % 5 === 0) setTimeout(() => SFX.play('roar'), 900);
}
function startDay() {
  S.survived = S.night;
  teamXp(30 + 10 * S.night);
  S.night++;
  if (S.bloodMoon) S.bloodSurvived = (S.bloodSurvived || 0) + 1;
  S.bloodMoon = false;
  if (S.weather === 2) S.stormSurvived = (S.stormSurvived || 0) + 1;
  S.phase = 'day'; S.phaseT = DAY_LEN; S.spawnQueue = [];
  const wr = Math.random();
  S.weather = S.night < 3 ? 0 : wr < 0.5 ? 0 : wr < 0.8 ? 1 : 2;
  banner('TAG ' + S.night, S.weather === 2 ? '⛈ Ein Gewitter zieht auf – Blitze treffen nachts die Zombies!' : S.weather === 1 ? '🌧 Regen – Zombies kommen im Schlamm langsamer voran.' : 'Nacht ' + S.survived + ' überlebt! Zombies verbrennen im Sonnenlicht.', '#ffe27a');
  SFX.play('chime');
}
function spawnZombie(type, pt) {
  const D = ZDEF[type], N = S.night;
  const hpM = hpScale(N) * (type === 'boss' ? (1 + 0.8 * (Math.floor(N / 5) - 1)) : 1) * (S.bloodMoon ? 1.25 : 1);
  const z = {
    id: S.nextZid++, type, x: (pt.tx + 0.5) * TS + rand(-12, 12), y: (pt.ty + 0.5) * TS + rand(-12, 12), r: D.r,
    hp: D.hp * hpM, maxHp: D.hp * hpM, dmg: D.dmg * dmgScale(N), bdmg: D.bdmg * dmgScale(N) * (type === 'boss' ? 1 + 0.5 * (Math.floor(N / 5) - 1) : 1),
    spMul: (1 + Math.min(0.25, 0.015 * (N - 1))) * rand(0.9, 1.1),
    atkCd: 0, flash: 0, lunge: 0, kx: 0, ky: 0, vx: 0, vy: 0, face: 0, path: null, pi: 0, ver: -1, queued: false,
    stuck: 0, lx: 0, ly: 0, scan: 0, tgt: null, burnT: 0, dead: false, chasing: false, slamT: 5, summonT: 10, walk: rand(0, TAU),
  };
  if (type === 'normal' && N >= 2 && Math.random() < 0.025) { z.golden = true; z.spMul *= 1.5; z.hp = z.maxHp = z.maxHp * 1.5; }
  z.lx = z.x; z.ly = z.y;
  const st = tileAt(z.x, z.y);
  if (st >= 0 && S.hq) { const r = getPath(st); z.path = r.path; z.ver = S.navVer; }
  S.zombies.push(z);
  if (type === 'boss') banner('BOSS ERSCHEINT', 'Bring deine Türme in Stellung!', '#d87bff');
  if (type === 'shade') { z.hp = z.maxHp = D.hp * (1 + 0.1 * (N - 1)); }
  return z;
}
// ---------- Portal & Schattenreich
function makePortal() {
  const hx = S.hq.tx + 1, hy = S.hq.ty + 1;
  for (let tries = 0; tries < 200; tries++) {
    const a = rand(0, TAU), d = rand(22, 30), tx = Math.round(hx + Math.cos(a) * d), ty = Math.round(hy + Math.sin(a) * d);
    if (!inMap(tx, ty) || tx < 4 || ty < 4 || tx > MAP - 5 || ty > MAP - 5 || inDim(tx, ty)) continue;
    if (S.bmap[ty * MAP + tx] || S.biome[ty * MAP + tx] === 5) continue;
    for (let y = ty - 2; y <= ty + 2; y++) for (let x = tx - 2; x <= tx + 2; x++) if (S.res[y * MAP + x] && S.res[y * MAP + x] !== 4) setRes(y * MAP + x, 0, 0);
    S.portal = { x: (tx + 0.5) * TS, y: (ty + 0.5) * TS };
    S.portal2 = { x: (((DIM.x0 + DIM.x1) >> 1) + 0.5) * TS, y: (((DIM.y0 + DIM.y1) >> 1) + 0.5) * TS };
    return;
  }
}
function portalTick(p, dt) {
  p.portalCd = (p.portalCd || 0) - dt;
  if (!S.portal || p.portalCd > 0 || p.dead > 0) return;
  const into = Math.hypot(p.x - S.portal.x, p.y - S.portal.y) < 26, back = Math.hypot(p.x - S.portal2.x, p.y - S.portal2.y) < 26;
  if (!into && !back) return;
  const to = into ? S.portal2 : S.portal;
  p.x = to.x; p.y = to.y + 48; p.tp++; p.portalCd = 2.5;
  burst(p.x, p.y, '#b47aff', 30, 220, 0.8, 3.5); ring(p.x, p.y, 70, 0.4, '#b47aff');
  sfxFor(p, 'zap');
  if (into) {
    toastFor(p, '🌀 Willkommen im Schattenreich – Kristalle geben viel Gold, aber Vorsicht vor den Schattenwesen!', '#d8b4ff');
    if (!S.dimVisited) { S.dimVisited = 1; banner('DAS SCHATTENREICH', (p.name || 'Jemand') + ' hat eine andere Dimension betreten!', '#c890ff'); }
    p.dimVisits = (p.dimVisits || 0) + 1;
  } else toastFor(p, 'Zurück in der normalen Welt.', '#cfe8ff');
}
function dimTick(dt) {
  if (S.hq && !S.portal) makePortal();
  if (!S.portal) return;
  const inside = S.players.filter(q => q.dead <= 0 && !q.afk && S.biome[tileAt(q.x, q.y)] === 5);
  S.shadeT = (S.shadeT || 2) - dt;
  if (inside.length && S.shadeT <= 0) {
    S.shadeT = rand(1.4, 2.8);
    const n = S.zombies.filter(z => z.type === 'shade').length;
    if (n < 5 + 3 * inside.length + Math.min(8, S.night)) {
      const q = inside[randi(0, inside.length - 1)];
      for (let tries = 0; tries < 20; tries++) {
        const a = rand(0, TAU), d = rand(8, 14), tx = Math.floor(q.x / TS + Math.cos(a) * d), ty = Math.floor(q.y / TS + Math.sin(a) * d);
        if (!inMap(tx, ty) || !inDim(tx, ty) || S.res[ty * MAP + tx]) continue;
        const z = spawnZombie('shade', { tx, ty });
        burst(z.x, z.y, '#4a2a7a', 14, 120, 0.6, 3);
        break;
      }
    }
  }
  // Kristalle wachsen nach
  S.crystT = (S.crystT || 5) - dt;
  if (S.crystT <= 0) {
    S.crystT = rand(4, 8);
    if (S.resCount[5] < 60) for (let tries = 0; tries < 20; tries++) {
      const x = randi(DIM.x0 + 3, DIM.x1 - 4), y = randi(DIM.y0 + 3, DIM.y1 - 4), i = y * MAP + x;
      if (S.res[i] || Math.hypot((x + 0.5) * TS - S.portal2.x, (y + 0.5) * TS - S.portal2.y) < 4 * TS) continue;
      if (S.players.some(q => Math.hypot(q.x - (x + 0.5) * TS, q.y - (y + 0.5) * TS) < 2 * TS)) continue;
      setRes(i, 5, RES_HP[5], true); break;
    }
  }
}
// Schattenwesen jagen nur Spieler im Schattenreich, ohne Wegsuche
function shadeTick(z, dt) {
  const D = ZDEF.shade;
  let best = null, bd = 700;
  for (const q of S.players) { if (q.dead > 0 || q.afk || S.biome[tileAt(q.x, q.y)] !== 5) continue; const d = Math.hypot(q.x - z.x, q.y - z.y); if (d < bd) { bd = d; best = q; } }
  let tx, ty, sp = D.speed * z.spMul * (z.frostT > 0 ? 0.6 : 1);
  if (best) {
    tx = best.x; ty = best.y;
    if (bd < z.r + best.r + 5) { tx = z.x; ty = z.y; z.face = Math.atan2(best.y - z.y, best.x - z.x); if (z.atkCd <= 0) { z.atkCd = D.atk; z.lunge = 0.18; hurtPlayer(best, z.dmg); } }
  } else {
    if (!z.wx || Math.hypot(z.wx - z.x, z.wy - z.y) < 20) { z.wx = z.x + rand(-200, 200); z.wy = z.y + rand(-200, 200); }
    tx = z.wx; ty = z.wy; sp *= 0.35;
    z.idleT = (z.idleT || 0) + dt;
    if (z.idleT > 40) { z.dead = true; return; }   // verschwindet, wenn lange niemand da ist
  }
  if (best) z.idleT = 0;
  const dx = tx - z.x, dy = ty - z.y, d = Math.hypot(dx, dy);
  if (d > 2) { z.face = Math.atan2(dy, dx); z.vx = dx / d * sp; z.vy = dy / d * sp; z.x += z.vx * dt; z.y += z.vy * dt; z.walk += dt * sp * 0.08; } else z.vx = z.vy = 0;
  if (z.kx || z.ky) { z.x += z.kx * dt; z.y += z.ky * dt; const f = Math.max(0, 1 - dt * 10); z.kx *= f; z.ky *= f; if (Math.abs(z.kx) + Math.abs(z.ky) < 2) z.kx = z.ky = 0; }
  collideTiles(z, false, false);
}
let lastBiome = -1;
function biomeNotice() {
  if (!S || !S.player || !S.biome || mode !== 'play') return;
  const b = biomeAtW(S.player.x, S.player.y);
  if (b !== lastBiome) { if (lastBiome >= 0) toast((['🌿', '🌲', '🏜', '❄', '🐸', '🌀'][b]) + ' ' + BIOME_NAME[b] + (b === 4 ? ' – der Schlamm bremst dich' : ''), b === 5 ? '#d8b4ff' : '#cfe8ff'); lastBiome = b; }
}
function weatherTick(dt) {
  if (S.weather !== 2 || !S.started) return;
  S.strikeT -= dt;
  if (S.strikeT > 0) return;
  S.strikeT = S.phase === 'night' ? rand(2.5, 5.5) : rand(6, 12);
  let x, y;
  const zs = S.zombies.filter(z => !z.dead && z.type !== 'boss');
  if (S.phase === 'night' && zs.length && Math.random() < 0.8) { const z = zs[randi(0, zs.length - 1)]; x = z.x; y = z.y; }
  else { const p = S.player; x = p.x + rand(-500, 500); y = p.y + rand(-350, 350); if (Math.hypot(x - p.x, y - p.y) < 140) x += 200; }
  S.strikes.push({ x, y, life: 0.45, seed: Math.random() * 99 });
  hostEv(['L', x | 0, y | 0]);
  lightFlash(x, y, 260, 0.35);
  addShake(4, x, y); SFX.play('boom', x, y); SFX.play('zap', x, y);
  if (S.phase === 'night') {
    forZ(x, y, 90, z => { if (Math.hypot(z.x - x, z.y - y) < 70 + z.r) { hurtZombie(z, 90 * dmgScale(S.night), null); z.frostT = 0; } });
    burst(x, y, '#e8f0ff', 20, 220, 0.5, 3); burst(x, y, '#5a5048', 10, 100, 0.9, 4);
    ring(x, y, 70, 0.3, '#e8f0ff');
  }
}
function spawnTick(dt) {
  weatherTick(dt);
  dimTick(dt);
  if (S.phase !== 'night') return;
  S.nightT += dt;
  while (S.spawnQueue.length && S.spawnQueue[0].at <= S.nightT) {
    if (S.zombies.length >= 380) break;
    const q = S.spawnQueue.shift();
    spawnZombie(q.type, S.spawnPts[q.pt]);
  }
}
function hurtZombie(z, dmg, kb, silent) {
  if (z.dead) return;
  const arm = ZDEF[z.type].armor;
  if (arm) dmg *= 1 - arm;
  z.hp -= dmg; z.flash = 0.1;
  if (kb && z.type !== 'boss') { const m = z.type === 'brute' ? 0.35 : 1; z.kx += kb.x * m; z.ky += kb.y * m; }
  if (!silent && !HEADLESS) floatText(z.x, z.y - z.r - 6, Math.round(dmg), arm ? '#b8c4d0' : '#fff', dmg > 60 ? 16 : 12);
  if (z.hp <= 0) killZombie(z);
}
// Bomber sprengt sich an Gebäuden/Spielern in die Luft
function bomberBlast(z) {
  if (z.dead) return;
  z.dead = true;
  const R = 1.9 * TS;
  for (const b of S.buildings.slice()) { const c = bCenter(b); if (Math.hypot(c.x - z.x, c.y - z.y) < R + b.size * TS * 0.5) damageBuilding(b, z.bdmg); }
  for (const q of S.players) if (q.dead <= 0 && Math.hypot(q.x - z.x, q.y - z.y) < R) hurtPlayer(q, z.dmg);
  burst(z.x, z.y, '#ffb347', 30, 280, 0.6, 4.5); burst(z.x, z.y, '#ff4a1a', 16, 200, 0.5, 3.5);
  ring(z.x, z.y, R, 0.35, '#ff8a3a'); lightFlash(z.x, z.y, R * 2.5, 0.3);
  addShake(6, z.x, z.y); SFX.play('boom', z.x, z.y);
}
function killXp(z) {
  const xp = (ZDEF[z.type].xp || 5) * (S.bloodMoon ? 2 : 1);
  if (z.lastHit && S.players.includes(z.lastHit)) giveXp(z.lastHit, xp); else teamXp(Math.ceil(xp / 3));
}
function killZombie(z) {
  if (z.dead) return;
  killXp(z);
  if (z.type === 'bomber') {
    // vorher erledigt: die Explosion trifft nur die Zombies drumherum
    z.dead = true; S.kills++;
    const gb = Math.round(ZDEF.bomber.gold * lootMul()); S.gold += gb; S.goldEarned += gb;
    S.bomberKills = (S.bomberKills || 0) + 1;
    floatText(z.x, z.y - 20, 'BUMM!', '#ffb347', 16);
    explode(z.x, z.y, 2 * TS, 70 * hpScale(S.night), true);
    return;
  }
  z.dead = true; S.kills++;
  if (z.golden) {
    S.gold += 75; S.goldEarned += 75;
    burst(z.x, z.y, '#ffd36b', 40, 260, 1.0, 4); ring(z.x, z.y, 90, 0.5, '#ffd36b');
    floatText(z.x, z.y - 34, 'GOLDZOMBIE! +75 Gold', '#ffe27a', 18);
    const killer = z.lastHit && S.players.includes(z.lastHit) ? z.lastHit : S.player;
    hostGiveEgg(killer, 'golden');
  }
  const g = Math.round(ZDEF[z.type].gold * lootMul() * (S.bloodMoon ? 2 : 1));
  S.gold += g; S.goldEarned += g;
  if (!HEADLESS) {
    burst(z.x, z.y, '#5f9a3a', 10 + z.r, 160, 0.6, 3);
    burst(z.x, z.y, '#8a2a2a', 6, 100, 0.5, 2.5);
    if (g >= 2) floatText(z.x, z.y - 20, '+' + g + ' Gold', '#ffd36b', 12);
  }
  SFX.play('zdie', z.x, z.y);
  if (z.type === 'boss') {
    burst(z.x, z.y, '#d87bff', 80, 380, 1.2, 5);
    ring(z.x, z.y, 220, 0.6, '#d87bff');
    addShake(12, z.x, z.y); SFX.play('boom', z.x, z.y);
    S.bossKills = (S.bossKills || 0) + 1;
    banner('BOSS BESIEGT!', '+' + g + ' Gold', '#d87bff');
  }
}
function hurtPlayer(p, dmg) {
  if (p.dead > 0 || p.afk || p.invT > 0 || p.z > 6) return;   // in der Luft weicht man aus
  dmg *= 1 - 0.07 * (p.sk.armor || 0);
  p.hp -= dmg; p.lastHurt = S.t; p.flash = 0.15;
  burst(p.x, p.y, '#c0392b', 8, 130, 0.45, 2.5);
  shakeFor(p, 2.5);
  sfxFor(p, 'hurt');
  if (p.hp <= 0) {
    p.hp = 0; p.dead = 5;
    burst(p.x, p.y, '#c0392b', 40, 220, 0.9, 3.5);
    sfxFor(p, 'die');
    toastFor(p, 'Du bist gestorben – Respawn in 5 Sekunden', '#ff7b6b');
    for (const o of S.players) if (o !== p) toastFor(o, pName(p) + ' ist gestorben!', '#ff9a7a');
  }
}
function giveXp(p, n) {
  if (!p || n <= 0) return;
  p.xp += n;
  while (p.xp >= xpNeed(p.lvl)) {
    p.xp -= xpNeed(p.lvl); p.lvl++; p.sp++;
    burst(p.x, p.y, '#ffe27a', 30, 180, 0.8, 3.5);
    ring(p.x, p.y, 70, 0.5, '#ffe27a');
    floatText(p.x, p.y - 40, 'LEVEL ' + p.lvl + '!', '#ffe27a', 20);
    sfxFor(p, 'levelup');
    toastFor(p, 'Level ' + p.lvl + '! +1 Skillpunkt – drück K', '#ffe27a');
  }
}
function teamXp(n) { for (const p of S.players) giveXp(p, n); }
function recalcMaxHp(p) {
  const m = 100 + 25 * (hqLvl() - 1) + 15 * p.sk.vit;
  p.hp = Math.max(1, p.hp + m - p.maxHp); p.maxHp = m;
}
function spendSkill(p, id) {
  const sk = SKILLS.find(s => s.id === id);
  if (!sk || p.sp <= 0 || p.sk[id] >= sk.max) return false;
  p.sk[id]++; p.sp--;
  if (id === 'vit') recalcMaxHp(p);
  burst(p.x, p.y, '#9fd0ff', 16, 120, 0.6, 3);
  sfxFor(p, 'upgrade');
  return true;
}
function selectAbility(p, id) {
  const A = ABIL.find(a => a.id === id);
  if (!A || p.lvl < ABIL_LVL) { toastFor(p, 'Spezialfähigkeiten gibt es ab Level ' + ABIL_LVL, '#ff9a7a'); return; }
  if (p.ab === id) return;
  p.ab = id; p.abCd = Math.max(p.abCd || 0, 2);
  toastFor(p, A.icon + ' ' + A.name + ' gewählt – Shift zum Auslösen', '#ffe27a'); sfxFor(p, 'upgrade');
}
function actAbilitySelect(id) {
  if (NET.role === 'client') { netSendR({ t: 'abSel', id }); SFX.play('click'); return; }
  selectAbility(S.player, id);
}
function useAbility(p) {
  const A = ABIL.find(a => a.id === p.ab);
  if (!A || p.dead > 0 || (p.abCd || 0) > 0) return;
  p.abCd = A.cd; p.abUses = (p.abUses || 0) + 1;
  if (p.afk) setAfk(p, false);
  const mul = (1 + 0.3 * (hqLvl() - 1)) * (1 + 0.15 * p.sk.str) * (p.rageT > 0 ? 1.4 : 1) * clanBonus(p);
  if (A.id === 'whirl') {
    const R = 110, dmg = 2 * 34 * mul;
    forZ(p.x, p.y, R + 40, z => {
      const d = Math.hypot(z.x - p.x, z.y - p.y);
      if (d > R + z.r) return;
      const a = Math.atan2(z.y - p.y, z.x - p.x); z.lastHit = p;
      hurtZombie(z, critDmg(p, dmg), { x: Math.cos(a) * 420, y: Math.sin(a) * 420 }); lifeSteal(p, dmg * 0.5);
    });
    ring(p.x, p.y, R, 0.35, '#9fd8ff'); burst(p.x, p.y, '#cfe8ff', 30, 260, 0.5, 3); p.swing = 0.22;
    SFX.play('swing', p.x, p.y); SFX.play('boom', p.x, p.y); shakeFor(p, 4);
  } else if (A.id === 'dash') {
    p.dashHit = 0.3; p.dashN = (p.dashN || 0) + 1; p.invT = 0.4;
    if (!p.remote) p.dashT = 0.18;
    burst(p.x, p.y, '#ffffff', 16, 200, 0.4, 3); SFX.play('swing', p.x, p.y);
  } else if (A.id === 'heal') {
    for (const q of S.players) if (q.dead <= 0 && Math.hypot(q.x - p.x, q.y - p.y) < 260) {
      q.hp = Math.min(q.maxHp, q.hp + q.maxHp * 0.4);
      burst(q.x, q.y, '#7dff9a', 16, 120, 0.8, 3, -60);
      if (q !== p) toastFor(q, '💚 ' + (p.name || 'Ein Mitspieler') + ' hat dich geheilt!', '#7dff9a');
    }
    ring(p.x, p.y, 260, 0.6, '#7dff9a'); SFX.play('chime', p.x, p.y);
  } else if (A.id === 'rage') {
    for (const q of S.players) if (q.dead <= 0 && Math.hypot(q.x - p.x, q.y - p.y) < 300) {
      q.rageT = 8; burst(q.x, q.y, '#ff6a3a', 14, 160, 0.6, 3, -40);
      if (q !== p) toastFor(q, '🔥 Kriegsschrei von ' + (p.name || 'Mitspieler') + ': +40 % Schaden!', '#ff8a5a');
    }
    ring(p.x, p.y, 300, 0.5, '#ff6a3a'); SFX.play('horn', p.x, p.y); shakeFor(p, 3);
  }
}
function jump(p) {
  p = p || S.player;
  if (!p || p.dead > 0 || p.z > 0.5 || mode !== 'play') return;
  p.vz = 440; p.z = 0.1;
  if (p.afk) setAfk(p, false);
  SFX.play('swing', p.x, p.y);
}
function actAbility() {
  const p = S.player;
  if (!p.ab) { if (p.lvl >= ABIL_LVL) { skillsOpen = true; toast('Wähle zuerst eine Spezialfähigkeit', '#ffe27a'); } else toast('Spezialfähigkeiten gibt es ab Level ' + ABIL_LVL, '#ff9a7a'); return; }
  if ((p.abCd || 0) > 0) { SFX.play('error', undefined, undefined, true); return; }
  if (NET.role === 'client') {
    netSendR({ t: 'abUse', f: r2(p.face) });
    const A = ABIL.find(a => a.id === p.ab); p.abCd = A.cd;
    if (p.ab === 'dash') { p.dashT = 0.18; p.invT = 0.4; }
    if (p.ab === 'whirl') p.swing = 0.22;
    return;
  }
  useAbility(p);
}
function respecSkills(p) {
  const spent = SKILLS.reduce((a, s) => a + p.sk[s.id], 0);
  if (!spent) { toastFor(p, 'Du hast noch keine Skillpunkte verteilt.', '#ff9a7a'); return; }
  if (S.gold < RESPEC_COST) { toastFor(p, 'Zurücksetzen kostet ' + RESPEC_COST + ' Gold', '#ff7b6b'); sfxFor(p, 'error'); return; }
  S.gold -= RESPEC_COST;
  p.sk = newSkills(); p.sp += spent; recalcMaxHp(p);
  toastFor(p, 'Skills zurückgesetzt – ' + spent + ' Punkte neu verteilen!', '#9fd0ff'); sfxFor(p, 'upgrade');
}
function actRespec() {
  if (NET.role === 'client') { netSendR({ t: 'respec' }); SFX.play('click'); return; }
  respecSkills(S.player);
}
function lootMul() { let m = 0; for (const p of S.players) m = Math.max(m, p.sk.loot); return 1 + 0.15 * m; }
function nearestPlayer(x, y) {
  let best = null, bd = Infinity;
  for (const p of S.players) { if (p.dead > 0 || p.afk) continue; const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
  return best;
}
function updZombie(z, dt) {
  const D = ZDEF[z.type];
  z.flash -= dt; z.atkCd -= dt; z.lunge = Math.max(0, z.lunge - dt); z.slowT = (z.slowT || 0) - dt; z.frostT = (z.frostT || 0) - dt;
  if (D.shade) { shadeTick(z, dt); return; }
  if (z.type === 'shaman') {
    z.healT = (z.healT === undefined ? 2 : z.healT) - dt;
    if (z.healT <= 0) {
      z.healT = 3.2;
      let n = 0;
      forZ(z.x, z.y, 170, o => {
        if (o === z || o.hp >= o.maxHp || Math.hypot(o.x - z.x, o.y - z.y) > 160) return;
        o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.14); n++;
        if (!HEADLESS) burst(o.x, o.y - 6, '#b48cff', 3, 50, 0.5, 2.5, -50);
      });
      if (n) { ring(z.x, z.y, 160, 0.5, '#b48cff'); SFX.play('zap', z.x, z.y); }
    }
  }
  if (S.phase === 'day') {
    z.burnT += dt;
    if (z.burnT > 0.5) {
      z.burnT = 0;
      hurtZombie(z, z.maxHp * 0.045 + 2, null, true);
      if (!HEADLESS) burst(z.x, z.y - 4, '#ff9a3a', 2, 40, 0.5, 2.5, -60);
      if (z.dead) return;
    }
  }
  const p = nearestPlayer(z.x, z.y) || S.players[0], alive = p.dead <= 0;
  const dxp = p.x - z.x, dyp = p.y - z.y, dp = Math.hypot(dxp, dyp);
  let tx = z.x, ty = z.y, wantMove = true, attacking = false;
  const aggro = alive && dp < (z.type === 'boss' ? 240 : 190);

  // Boss-Spezialfähigkeiten
  if (z.type === 'boss') {
    z.slamT -= dt; z.summonT -= dt;
    if (z.slamT <= 0) {
      z.slamT = 6;
      const R = 2.6 * TS;
      for (const b of S.buildings.slice()) { const c = bCenter(b); if (Math.hypot(c.x - z.x, c.y - z.y) < R + b.size * TS * 0.5) damageBuilding(b, z.bdmg * 0.6); }
      for (const q of S.players) if (q.dead <= 0 && Math.hypot(q.x - z.x, q.y - z.y) < R) hurtPlayer(q, z.dmg * 0.8);
      ring(z.x, z.y, R, 0.45, '#d87bff');
      burst(z.x, z.y, '#7a5a8a', 30, 260, 0.6, 4);
      addShake(7, z.x, z.y); SFX.play('boom', z.x, z.y);
    }
    if (z.summonT <= 0) {
      z.summonT = 12;
      const ti = tileAt(z.x, z.y);
      if (ti >= 0) for (let i = 0; i < 3 + Math.floor(S.night / 5); i++) spawnZombie(Math.random() < 0.5 ? 'runner' : 'normal', { tx: ti % MAP, ty: ti / MAP | 0 });
    }
  }

  // Spucker: Fernkampf gegen Spieler oder Gebäude
  if (z.type === 'spitter') {
    z.scan -= dt;
    if (z.scan <= 0) {
      z.scan = 0.4;
      z.tgt = alive && dp < D.range ? p : nearestBuilding(z.x, z.y, D.range);
    }
    const tg = z.tgt;
    const isP = !!tg && !!tg.inp;
    if (tg && (isP ? tg.dead <= 0 : !tg.dead)) {
      const tc = isP ? tg : bCenter(tg);
      wantMove = false; attacking = true;
      z.face = Math.atan2(tc.y - z.y, tc.x - z.x);
      if (z.atkCd <= 0) {
        z.atkCd = D.atk;
        const a = z.face, sp = 300;
        S.projs.push({ k: 'glob', x: z.x + Math.cos(a) * 14, y: z.y + Math.sin(a) * 14, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: (D.range + 60) / sp, dmg: z.dmg, bdmg: z.bdmg, r: 6 });
        SFX.play('spit', z.x, z.y);
      }
    }
  }

  if (!attacking) {
    if (aggro) {
      tx = p.x; ty = p.y; z.chasing = true;
      if (dp < z.r + p.r + 5) {
        wantMove = false; z.face = Math.atan2(dyp, dxp);
        if (z.type === 'bomber') { bomberBlast(z); return; }
        if (z.atkCd <= 0) { z.atkCd = D.atk; z.lunge = 0.18; hurtPlayer(p, z.dmg); }
      }
    } else {
      if (z.chasing) { z.chasing = false; z.path = null; }
      if ((!z.path || z.ver !== S.navVer) && !z.queued) { z.queued = true; repathQ.push(z); }
      if (z.path && z.pi < z.path.length) {
        let ti = z.path[z.pi];
        let wx = (ti % MAP + 0.5) * TS, wy = ((ti / MAP | 0) + 0.5) * TS;
        if (!solidAt(ti) && Math.abs(wx - z.x) < TS * 0.55 && Math.abs(wy - z.y) < TS * 0.55 && z.pi < z.path.length - 1) {
          z.pi++; ti = z.path[z.pi];
          wx = (ti % MAP + 0.5) * TS; wy = ((ti / MAP | 0) + 0.5) * TS;
        }
        tx = wx; ty = wy;
      } else if (S.hq) { const c = bCenter(S.hq); tx = c.x; ty = c.y; }
      else wantMove = false;
    }
  }

  let probeHit = false;
  if (wantMove) {
    let dx = tx - z.x, dy = ty - z.y;
    const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    z.face = Math.atan2(dy, dx);
    const pr = z.r + 8;
    const pti = tileAt(z.x + dx * pr, z.y + dy * pr);
    const bid = solidAt(pti);
    if (bid) {
      probeHit = true;
      const b = S.bById.get(bid);
      z.vx = z.vy = 0;
      if (z.type === 'bomber') { bomberBlast(z); return; }
      if (z.atkCd <= 0) { z.atkCd = D.atk; z.lunge = 0.18; damageBuilding(b, z.bdmg); }
    } else {
      const sp = D.speed * z.spMul * (z.slowT > 0 ? 0.5 : 1) * (z.frostT > 0 ? 1 - (z.frostS || 0.4) : 1) * (S.weather === 1 ? 0.9 : 1);
      z.vx = dx * sp; z.vy = dy * sp;
      z.x += z.vx * dt; z.y += z.vy * dt;
      z.walk += dt * sp * 0.08;
    }
  } else { z.vx = z.vy = 0; }

  if (z.kx || z.ky) {
    z.x += z.kx * dt; z.y += z.ky * dt;
    const f = Math.max(0, 1 - dt * 10); z.kx *= f; z.ky *= f;
    if (Math.abs(z.kx) + Math.abs(z.ky) < 2) z.kx = z.ky = 0;
  }
  collideTiles(z, false, z.type === 'boss');

  // Festgefahren? -> angrenzendes Gebäude angreifen oder neu planen
  const moved = Math.hypot(z.x - z.lx, z.y - z.ly);
  z.lx = z.x; z.ly = z.y;
  if (wantMove && !probeHit && moved < D.speed * dt * 0.2) {
    z.stuck += dt;
    if (z.stuck > 0.8) {
      z.stuck = 0;
      let tb = null;
      for (let a = 0; a < 8 && !tb; a++) {
        const ang = z.face + (a % 2 ? 1 : -1) * Math.ceil(a / 2) * 0.6;
        const ti = tileAt(z.x + Math.cos(ang) * (z.r + 10), z.y + Math.sin(ang) * (z.r + 10));
        if (solidAt(ti)) tb = S.bById.get(S.bmap[ti]);
      }
      if (tb && z.type === 'bomber') { bomberBlast(z); return; }
      if (tb) { z.atkCd = D.atk; z.lunge = 0.18; damageBuilding(tb, z.bdmg); }
      else { z.path = null; z.x += rand(-6, 6); z.y += rand(-6, 6); }
    }
  } else z.stuck = 0;
}
function separate() {
  for (const z of S.zombies) {
    if (z.dead) continue;
    let pushed = false;
    forZ(z.x, z.y, z.r + 36, o => {
      if (o === z) return;
      const dx = z.x - o.x, dy = z.y - o.y, rr = z.r + o.r, d2 = dx * dx + dy * dy;
      if (d2 < rr * rr) {
        const d = Math.sqrt(d2) || 0.01, w = z.type === 'boss' ? 0.1 : (o.type === 'boss' ? 1 : 0.5);
        const push = (rr - d) * w;
        z.x += (d2 > 0.0001 ? dx / d : rand(-1, 1)) * push; z.y += (d2 > 0.0001 ? dy / d : rand(-1, 1)) * push;
        pushed = true;
      }
    });
    if (pushed) collideTiles(z, false, z.type === 'boss');
  }
}

// =====================================================================
// Spieler
// =====================================================================
const TOOLS = {
  pick:  { name: 'Spitzhacke', key: 'Q', cd: 0.33, dmg: 12, reach: 52, arc: 0.9, kb: 220 },
  sword: { name: 'Schwert',    key: 'E', cd: 0.38, dmg: 32, reach: 64, arc: 1.1, kb: 220 },
  bow:   { name: 'Armbrust',      key: 'R', cd: 0.55, dmg: 20, reach: 600 },
  spear: { name: 'Speer',      key: 'C', cd: 0.5,  dmg: 30, reach: 112, arc: 0.36, kb: 300, unlock: { w: 60, s: 40, g: 40 }, hq: 1 },
  axe:   { name: 'Streitaxt',  key: 'V', cd: 0.8,  dmg: 56, reach: 72, arc: 3.2, kb: 340, unlock: { w: 150, s: 80, g: 100 }, hq: 2 },
  staff: { name: 'Plasmawerfer',  key: 'B', cd: 0.9,  dmg: 34, reach: 520, unlock: { w: 100, s: 150, g: 250, i: 20 }, hq: 2 },
};
const TOOL_ORDER = Object.keys(TOOLS);
// Kosten, um ein Werkzeug von Stufe L auf L+1 zu bringen
const TOOL_UP = [null, { w: 40, s: 40, g: 30 }, { w: 110, s: 110, g: 110, i: 15 }, { w: 240, s: 240, g: 300, i: 40 }, { w: 480, s: 480, g: 700, i: 90 }];
const TMET = ['#a9a9a9', '#dfe6ee', '#7fb4ff', '#c890ff', '#ffd36b'];
const TLV_NAME = ['Stein', 'Eisen', 'Stahl', 'Kristall', 'Gold'];
const toolMul = L => 1 + 0.3 * (L - 1);
const toolMet = (p, id) => TMET[clamp(((p.tl && p.tl[id]) || 1) - 1, 0, 4)];
function toolDesc(id, L) {
  if (id === 'pick') return 'Baut Holz, Stein & Gold ab' + (L > 1 ? ' · +' + (L - 1) + ' pro Schlag' : '');
  if (id === 'sword') return 'Starker Nahkampf mit Rückstoß';
  if (id === 'bow') return 'Fernkampf, Pfeile kostenlos' + (L >= 5 ? ' · 3 Pfeile' : L >= 3 ? ' · 2 Pfeile' : ' · ab Stufe 3: 2 Pfeile');
  if (id === 'spear') return 'Große Reichweite, durchbohrt ganze Reihen';
  if (id === 'axe') return 'Rundumschlag, fällt Bäume doppelt so schnell';
  return 'Feuerball, explodiert im Umkreis';
}
function toolCost(p, id) { const L = p.tl[id] || 0; return L ? TOOL_UP[L] : TOOLS[id].unlock; }
function toolError(p, id) {
  const T = TOOLS[id];
  if (!T) return 'Unbekanntes Werkzeug';
  const L = p.tl[id] || 0;
  if (L >= 5) return 'Schon auf Maximalstufe';
  if (!L && T.hq && hqLvl() < T.hq) return 'Benötigt Reaktor Stufe ' + T.hq;
  if (L && L >= hqLvl() + 1) return 'Erst den Reaktor aufwerten';
  if (!canAfford(toolCost(p, id))) return 'Nicht genug Rohstoffe';
  return null;
}
function upgradeTool(p, id) {
  const err = toolError(p, id);
  if (err) return err;
  pay(toolCost(p, id));
  const L = ++p.tl[id];
  burst(p.x, p.y, TMET[L - 1], 22, 150, 0.6, 3);
  ring(p.x, p.y, 60, 0.4, TMET[L - 1]);
  sfxFor(p, 'upgrade');
  toastFor(p, L === 1 ? TOOLS[id].name + ' freigeschaltet! (Taste ' + TOOLS[id].key + ')' : TOOLS[id].name + ' → Stufe ' + L + ' (' + TLV_NAME[L - 1] + ')', TMET[L - 1]);
  if (L === 1 && !p.remote) p.tool = id;
  return null;
}
let forgeOpen = false;
function actTool(id) {
  if (NET.role === 'client') { netSendR({ t: 'tool', id }); SFX.play('click'); return; }
  const err = upgradeTool(S.player, id);
  if (err) { toast(err, '#ff7b6b'); SFX.play('error', undefined, undefined, true); }
}
function critDmg(p, d) { return p.sk.crit && Math.random() < 0.07 * p.sk.crit ? d * 2 : d; }
function lifeSteal(p, d) {
  if (p && p.sk && p.sk.vamp && p.dead <= 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + d * 0.03 * p.sk.vamp);
}
function aimPoint() {
  if (input.aim) return input.aim;
  if (R3 && R3.ready) { const w = R3.pick(input.sx, input.sy); if (w) return w; }
  return { x: input.sx + camX, y: input.sy + camY };
}
// Lokale Eingabe (Tastatur/Maus bzw. Test-Bot) in die Eingabestruktur des eigenen Spielers schreiben
function readLocalInput(p) {
  let mx = 0, my = 0;
  if (mode === 'play') { if (keys.left) mx--; if (keys.right) mx++; if (keys.up) my--; if (keys.down) my++; }
  if (mode === 'play' && touch.joyId !== null) {
    const dx = touch.kx - touch.jx, dy = touch.ky - touch.jy;
    if (Math.hypot(dx, dy) > 8) { mx = dx; my = dy; }
  }
  if (ROOT.__botMove) { const m = ROOT.__botMove(S); mx = m.x; my = m.y; }
  const yaw = R3 ? R3.yaw || 0 : 0;
  if (yaw && (mx || my)) { const c = Math.cos(yaw), s = Math.sin(yaw), rx = mx * c + my * s, ry = -mx * s + my * c; mx = rx; my = ry; }
  let a = aimPoint(), down = input.down;
  if (mode === 'play' && touch.aimId !== null) { const s = stickAim(p); a = s; down = s.down; }
  else if (isTouch && touch.atkId === null && touch.placeId === null && touch.lastAng !== null && !S.place) a = { x: p.x + Math.cos(touch.lastAng) * 220, y: p.y + Math.sin(touch.lastAng) * 220 };
  p.inp.mx = mx; p.inp.my = my; p.inp.ax = a.x; p.inp.ay = a.y;
  p.inp.down = down && !S.place && mode === 'play';
}
// Bewegung + Kollision (läuft beim Host für den eigenen Spieler und beim Client für seinen Spieler)
function movePlayer(p, dt) {
  let mx = p.inp.mx, my = p.inp.my;
  const ml = Math.hypot(mx, my);
  const onMtn = S.res[tileAt(p.x, p.y)] === 6;
  const spd = 190 * (1 + 0.06 * (p.sk ? p.sk.spd : 0)) * (p.rageT > 0 ? 1.2 : 1) * (biomeAtW(p.x, p.y) === 4 && !onMtn ? 0.85 : 1) * (onMtn ? 0.75 : 1);
  // Sprung
  if (p.z > 0 || p.vz > 0) { p.vz -= 1500 * dt; p.z = Math.max(0, p.z + p.vz * dt); if (p.z <= 0) { p.vz = 0; if (!HEADLESS) burst(p.x, p.y + 8, '#a89a88', 4, 60, 0.35, 2.5); } }
  if (ml > 0) { mx /= ml; my /= ml; p.x += mx * spd * dt; p.y += my * spd * dt; p.walk += dt * 10; }
  if (p.dashT > 0) { p.dashT -= dt; p.x += Math.cos(p.face) * 950 * dt; p.y += Math.sin(p.face) * 950 * dt; if (!HEADLESS && Math.random() < 0.7) burst(p.x, p.y, '#e8f4ff', 2, 40, 0.3, 2.5); }
  forZ(p.x, p.y, p.r + 40, z => {
    const dx = p.x - z.x, dy = p.y - z.y, rr = p.r + z.r, d2 = dx * dx + dy * dy;
    if (d2 < rr * rr && d2 > 0.01) { const d = Math.sqrt(d2), o = rr - d; p.x += dx / d * o * 0.6; p.y += dy / d * o * 0.6; }
  });
  collideTiles(p, true, false);
  p.face = Math.atan2(p.inp.ay - p.y, p.inp.ax - p.x);
}
function updPlayer(p, dt) {
  p.flash -= dt;
  if (p.dead > 0) {
    p.dead -= dt;
    if (p.dead <= 0) {
      if (S.hq) {
        const f = findFreeNear(S.hq.tx + 1 + p.id, S.hq.ty + 3, true);
        p.x = (f % MAP + 0.5) * TS; p.y = ((f / MAP | 0) + 0.5) * TS;
      }
      p.tp++;
      p.hp = p.maxHp; p.dead = 0; p.lastHurt = S.t;
      burst(p.x, p.y, '#7fd8ff', 24, 160, 0.6, 3);
      toastFor(p, 'Du bist wieder da!', '#7fd8ff');
    }
    return;
  }
  if (p.remote) {
    // Position kommt vom Mitspieler selbst; ohne Eingaben nicht weiter angreifen
    if (S.t - p.lastInput > 1.5) p.inp.down = false;
  } else {
    if (p.afk && (p.inp.mx || p.inp.my || p.inp.down)) setAfk(p, false);
    movePlayer(p, dt);
  }
  portalTick(p, dt);
  if (S.t - p.lastHurt > 4 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 4 * dt);
  if (p.sk.vit && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + p.sk.vit * dt);
  p.cd -= dt; p.swing -= dt;
  p.abCd = Math.max(0, (p.abCd || 0) - dt); p.rageT = Math.max(0, (p.rageT || 0) - dt); p.invT = (p.invT || 0) - dt; p.danceT = (p.danceT || 0) - dt;
  if (p.dashHit > 0) {
    p.dashHit -= dt;
    const dmg = 45 * (1 + 0.3 * (hqLvl() - 1)) * (1 + 0.15 * p.sk.str) * (p.rageT > 0 ? 1.4 : 1);
    forZ(p.x, p.y, 70, z => {
      if (z.dashN === p.dashN + '_' + p.id || Math.hypot(z.x - p.x, z.y - p.y) > 40 + z.r) return;
      z.dashN = p.dashN + '_' + p.id; z.lastHit = p;
      const a = Math.atan2(z.y - p.y, z.x - p.x);
      hurtZombie(z, critDmg(p, dmg), { x: Math.cos(a) * 380, y: Math.sin(a) * 380 });
    });
  }
  if (p.inp.down && p.cd <= 0 && !(p.danceT > 0)) playerAttack(p);
}
function playerAttack(p) {
  if (!(p.tl[p.tool] > 0)) p.tool = 'sword';
  const T = TOOLS[p.tool] || TOOLS.sword, L = p.tl[p.tool] || 1, mul = (1 + 0.3 * (hqLvl() - 1)) * toolMul(L) * (p.rageT > 0 ? 1.4 : 1) * clanBonus(p);
  const ranged = p.tool === 'bow' || p.tool === 'staff', melee = (1 + 0.15 * p.sk.str), rangedM = (1 + 0.12 * p.sk.bow);
  p.cd = T.cd * (ranged ? 1 - 0.06 * p.sk.bow : 1); p.swing = 0.22;
  if (p.tool === 'bow') {
    const sp = 760, n = L >= 5 ? 3 : L >= 3 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const a = p.face + (k - (n - 1) / 2) * 0.09;
      S.projs.push({ k: 'parrow', x: p.x + Math.cos(a) * 16, y: p.y + Math.sin(a) * 16, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: T.reach / sp, dmg: critDmg(p, T.dmg * mul * rangedM), r: 4, owner: p.id });
    }
    SFX.play('bow', p.x, p.y);
    return;
  }
  if (p.tool === 'staff') {
    const sp = 520, a = p.face;
    S.projs.push({ k: 'fire', x: p.x + Math.cos(a) * 20, y: p.y + Math.sin(a) * 20, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: T.reach / sp, dmg: critDmg(p, T.dmg * mul * rangedM), splash: TS * (1.1 + 0.12 * L), r: 7, owner: p.id });
    SFX.play('zap', p.x, p.y);
    return;
  }
  // Nahkampf: Zombies im Bogen vor dem Spieler
  let hitAny = false;
  const reach = T.reach + (p.tool === 'sword' || p.tool === 'spear' ? (L - 1) * 5 : 0), arc = T.arc;
  forZ(p.x, p.y, reach + 40, z => {
    const d = Math.hypot(z.x - p.x, z.y - p.y);
    if (d > reach + z.r) return;
    if (Math.abs(angDiff(Math.atan2(z.y - p.y, z.x - p.x), p.face)) > arc) return;
    const ka = Math.atan2(z.y - p.y, z.x - p.x), base = T.dmg * mul * melee, dmg = critDmg(p, base);
    z.lastHit = p;
    hurtZombie(z, dmg, { x: Math.cos(ka) * T.kb, y: Math.sin(ka) * T.kb });
    lifeSteal(p, dmg);
    if (dmg > base) floatText(z.x, z.y - z.r - 22, 'KRITISCH!', '#ffe27a', 13);
    burst(z.x, z.y, '#5f9a3a', 5, 120, 0.35, 2.5);
    hitAny = true;
  });
  for (const an of S.animals || []) {
    const d = Math.hypot(an.x - p.x, an.y - p.y);
    if (d > reach + an.r || Math.abs(angDiff(Math.atan2(an.y - p.y, an.x - p.x), p.face)) > arc) continue;
    hurtAnimal(an, T.dmg * mul * melee, p); hitAny = true;
  }
  if (hitAny) SFX.play('hit', p.x, p.y);
  if (p.tool === 'axe') ring(p.x, p.y, reach, 0.18, TMET[L - 1]);
  // Spitzhacke (alles) bzw. Streitaxt (nur Bäume): Ressourcen abbauen
  if (p.tool === 'pick' || p.tool === 'axe') {
    const axe = p.tool === 'axe';
    let best = -1, bd = 1e9;
    const ptx = Math.floor(p.x / TS), pty = Math.floor(p.y / TS);
    for (let y = pty - 2; y <= pty + 2; y++) for (let x = ptx - 2; x <= ptx + 2; x++) {
      if (!inMap(x, y)) continue;
      const i = y * MAP + x;
      if (!S.res[i] || SOLID_RES(S.res[i]) || (axe && S.res[i] !== 1)) continue;
      const cx = (x + 0.5) * TS, cy = (y + 0.5) * TS, d = Math.hypot(cx - p.x, cy - p.y);
      if (d > reach + RES_R) continue;
      if (Math.abs(angDiff(Math.atan2(cy - p.y, cx - p.x), p.face)) > (axe ? 1.4 : 1.0)) continue;
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) {
      const kind = S.res[best], cx = (best % MAP + 0.5) * TS, cy = ((best / MAP | 0) + 0.5) * TS;
      S.wobble.set(best, { t: 0.25, a: p.face }); hostEv(['w', best, +p.face.toFixed(2)]);
      let amt = mineRes(best, (axe ? 2 : 1) + Math.floor((hqLvl() - 1) / 2) + (L - 1));
      if (amt > 0 && Math.random() < 0.2 * p.sk.gath) { amt *= 2; burst(cx, cy, '#ffffff', 6, 100, 0.4, 2.5); }
      giveXp(p, kind === 3 || kind === 7 ? amt * 2 : kind === 5 ? amt * 5 : amt);
      if (kind === 1) { S.wood += amt; SFX.play('chop', cx, cy); burst(cx, cy, '#a0763f', 6, 120, 0.45, 2.5); burst(cx, cy, '#4f8a3a', 4, 90, 0.6, 3); floatText(cx, cy - 18, '+' + amt + ' Holz', '#e0b070', 13); }
      else if (kind === 2) { S.stone += amt; SFX.play('mine', cx, cy); burst(cx, cy, '#a8a8b0', 7, 140, 0.4, 2.5); floatText(cx, cy - 18, '+' + amt + ' Stein', '#d0d0e0', 13); }
      else if (kind === 7) { S.iron += amt; SFX.play('mine', cx, cy); burst(cx, cy, '#a8582a', 8, 140, 0.45, 2.5); burst(cx, cy, '#8a8a92', 5, 120, 0.4, 2.5); floatText(cx, cy - 18, '+' + amt + ' Eisen', '#c8d0dc', 13); }
      else if (kind === 5) { S.gold += amt * 6; S.goldEarned += amt * 6; S.crystals = (S.crystals || 0) + amt; SFX.play('zap', cx, cy); burst(cx, cy, '#c890ff', 10, 160, 0.5, 2.5); floatText(cx, cy - 18, '+' + amt * 6 + ' Gold ✦', '#d8b4ff', 14); }
      else { S.gold += amt * 2; S.goldEarned += amt * 2; SFX.play('goldore', cx, cy); burst(cx, cy, '#f2c94c', 8, 150, 0.45, 2.5); floatText(cx, cy - 18, '+' + amt * 2 + ' Gold', '#ffd36b', 13); }
      return;
    }
  }
  if (!hitAny) SFX.play('swing', p.x, p.y);
}

// =====================================================================
// Projektile & Effekte
// =====================================================================
function updProjs(dt) {
  for (const pr of S.projs) {
    if (pr.dead) continue;
    if (pr.k === 'bomb') {
      pr.t += dt;
      const f = Math.min(1, pr.t / pr.T);
      pr.x = lerp(pr.sx, pr.tx, f); pr.y = lerp(pr.sy, pr.ty, f); pr.h = Math.sin(f * Math.PI) * 90;
      if (f >= 1) { pr.dead = true; explode(pr.x, pr.y, pr.splash, pr.dmg, true); }
      continue;
    }
    pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.life -= dt;
    if (pr.k === 'glob') {
      const p = S.players.find(q => q.dead <= 0 && !q.afk && Math.hypot(q.x - pr.x, q.y - pr.y) < q.r + pr.r);
      if (p) { hurtPlayer(p, pr.dmg); pr.dead = true; }
      else {
        const ti = tileAt(pr.x, pr.y);
        if (solidAt(ti)) { damageBuilding(S.bById.get(S.bmap[ti]), pr.bdmg); pr.dead = true; }
      }
      if (pr.dead) burst(pr.x, pr.y, '#7fe0a0', 8, 100, 0.4, 2.5);
      if (pr.life <= 0) pr.dead = true;
      continue;
    }
    if (pr.k === 'parrow' && S.animals) {
      const an = S.animals.find(a => !a.dead && (a.x - pr.x) ** 2 + (a.y - pr.y) ** 2 < (a.r + pr.r) ** 2);
      if (an) { hurtAnimal(an, pr.dmg, pById(pr.owner)); pr.dead = true; continue; }
    }
    let hitZ = null;
    forZ(pr.x, pr.y, pr.r + 40, z => {
      if ((z.x - pr.x) ** 2 + (z.y - pr.y) ** 2 < (z.r + pr.r) ** 2) { hitZ = z; return false; }
    });
    if (pr.k === 'ball' || pr.k === 'fire') {
      if (pr.k === 'fire' && !HEADLESS && Math.random() < 0.6) burst(pr.x, pr.y, '#ff9a3a', 1, 30, 0.3, 2.5);
      if (hitZ || pr.life <= 0) { pr.dead = true; explode(pr.x, pr.y, pr.splash, pr.dmg, false, pr.owner !== undefined ? pById(pr.owner) : null); }
      continue;
    }
    if (hitZ) {
      const sp = Math.hypot(pr.vx, pr.vy);
      if (pr.owner !== undefined) { const ow = pById(pr.owner); if (ow) { hitZ.lastHit = ow; lifeSteal(ow, pr.dmg); } }
      hurtZombie(hitZ, pr.dmg, { x: pr.vx / sp * 60, y: pr.vy / sp * 60 });
      burst(pr.x, pr.y, '#e8e0c0', 4, 90, 0.25, 2);
      if (pr.k === 'parrow') SFX.play('hit', pr.x, pr.y);
      pr.dead = true;
    } else if (pr.life <= 0) pr.dead = true;
  }
  S.projs = S.projs.filter(p => !p.dead);
}
function updFx(dt) {
  for (const q of S.parts) { q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; const f = Math.max(0, 1 - dt * 4); q.vx *= f; q.vy = q.vy * f + q.grav * dt; }
  S.parts = S.parts.filter(q => q.life > 0);
  for (const t of S.texts) { t.life -= dt; t.y -= 32 * dt; }
  S.texts = S.texts.filter(t => t.life > 0);
  for (const b of S.bolts) b.life -= dt;
  S.bolts = S.bolts.filter(b => b.life > 0);
  for (const r of S.rings) { r.life -= dt; r.r = lerp(r.max, 8, r.life / r.maxLife); }
  S.rings = S.rings.filter(r => r.life > 0);
  for (const f of S.flashes) f.life -= dt;
  S.flashes = S.flashes.filter(f => f.life > 0);
  for (const [k, w] of S.wobble) { w.t -= dt; if (w.t <= 0) S.wobble.delete(k); }
  for (const [k, v] of S.grow) { const n = v - dt; if (n <= 0) S.grow.delete(k); else S.grow.set(k, n); }
  for (const pg of S.pings) pg.t -= dt;
  if (S.strikes) { for (const s of S.strikes) s.life -= dt; S.strikes = S.strikes.filter(s => s.life > 0); }
  S.pings = S.pings.filter(pg => pg.t > 0);
  S.shake = Math.max(0, S.shake - (S.shake * 5 + 3) * dt);
  if (S.msg) { S.msg.t -= dt; if (S.msg.t <= 0) S.msg = null; }
  if (S.banner) { S.banner.t -= dt; if (S.banner.t <= 0) S.banner = null; }
}

// =====================================================================
// Haupt-Update
// =====================================================================
function update(dt) {
  S.t += dt;
  if (S.started && !S.ending) {
    S.phaseT -= dt;
    if (S.phaseT <= 0) { if (S.phase === 'day') startNight(); else startDay(); }
  }
  spawnTick(dt);
  regrowTick(dt);
  chestTick(dt);
  animalTick(dt);
  buildHash();
  readLocalInput(S.player);
  for (const p of S.players) updPlayer(p, dt);
  processRepaths();
  for (let i = 0; i < S.zombies.length; i++) { const z = S.zombies[i]; if (!z.dead) updZombie(z, dt); }
  separate();
  S.zombies = S.zombies.filter(z => !z.dead);
  buildHash();
  updBuildings(dt);
  updProjs(dt);
  updFx(dt);
  if (S.phase === 'night' && S.zombies.length) {
    S.groanT -= dt;
    if (S.groanT <= 0) { S.groanT = rand(1.5, 4); const z = S.zombies[randi(0, S.zombies.length - 1)]; SFX.play('groan', z.x, z.y); }
  }
  if (S.ending > 0) { S.ending -= dt; if (S.ending <= 0) gameOver(); }
  if (NET.role === 'host') netHostTick(dt);
  followCam(dt);
}
function followCam(dt) {
  biomeNotice();
  const p = S.player;
  const tx = p.x - VW / 2, ty = p.y - VH / 2;
  const k = Math.min(1, dt * 8);
  camX += (tx - camX) * k; camY += (ty - camY) * k;
}

function startGame() {
  if (NET.role === 'client') return;
  newGame({});
  mode = 'play'; modeT = 0;
  SFX.init();
  banner('Platziere deinen Reaktor', NET.role === 'host' ? 'Ihr baut gemeinsam – Ressourcen werden geteilt' : 'Linksklick auf eine freie Fläche', '#ffd36b');
  if (NET.role === 'host') {
    const gids = [...NET.peers.keys()];
    NET.peers.clear();
    for (const gid of gids) sendWorldTo(addRemotePlayer(gid));
    NET.peer = NET.peers.size > 0;
    NET.ev = [];
    netHostTick(1);
  }
}
function finishResult(r) {
  const better = !highscore || r.nights > highscore.nights || (r.nights === highscore.nights && r.kills > highscore.kills);
  r.newBest = better;
  if (better) { highscore = { nights: r.nights, kills: r.kills }; store.set(HS_KEY, highscore); }
  lastResult = r;
}
function gameOver() {
  mode = 'over'; modeT = 0; S.sel = null; S.place = null; input.down = false;
  const r = { nights: S.survived, kills: S.kills, time: S.t, gold: Math.floor(S.goldEarned), buildings: S.buildings.length };
  if (NET.role === 'host') { netHostTick(1); netSendR({ t: 'O', r: Object.assign({}, r) }); }
  finishResult(r);
  SFX.play('die', undefined, undefined, true);
}

// =====================================================================
// Online-Modus (WebRTC, direkt zwischen zwei Browsern)
//  - Der Host simuliert das komplette Spiel.
//  - Der Mitspieler (Client) steuert seine Figur lokal, schickt Position/Eingaben
//    und bekommt ~20x pro Sekunde einen Schnappschuss + Effekt-Events zurück.
//  - Verbindungsaufbau per Copy-&-Paste-Codes (kein eigener Server nötig).
// =====================================================================
const ZTYPES = Object.keys(ZDEF), BTYPES = Object.keys(BDEF), PKINDS = ['arrow', 'parrow', 'ball', 'bomb', 'glob', 'fire'], TOOLIDS = TOOL_ORDER;
const RTC_CFG = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };
const r2 = v => Math.round(v * 100) / 100;

function u8ToB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function b64ToU8(b) { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
async function packCode(desc) {
  const raw = new TextEncoder().encode(JSON.stringify({ t: desc.type, s: desc.sdp }));
  if (typeof CompressionStream !== 'undefined') {
    const buf = await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
    return 'NW1z' + u8ToB64(new Uint8Array(buf));
  }
  return 'NW1p' + u8ToB64(raw);
}
async function unpackCode(code) {
  code = (code || '').replace(/\s+/g, '');
  if (!code.startsWith('NW1')) throw new Error('Das ist kein gültiger Nachtwache-Code.');
  let raw = b64ToU8(code.slice(4));
  if (code[3] === 'z') raw = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  const o = JSON.parse(new TextDecoder().decode(raw));
  return { type: o.t, sdp: o.s };
}
function waitIce(pc) {
  return new Promise(res => {
    if (pc.iceGatheringState === 'complete') return res();
    const done = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', done); res(); } };
    pc.addEventListener('icegatheringstatechange', done);
    setTimeout(res, 4000);
  });
}
// Host → genau ein Mitspieler (über den Server mit "@id|" adressiert)
function netSendTo(p, o) {
  if (!p || p === S.player || !p.remote) return;
  if (NET.ws) { if (NET.ws.readyState === 1) NET.ws.send('@' + (p.gid || 1) + '|' + JSON.stringify(o)); return; }
  if (NET.chR && NET.chR.readyState === 'open') NET.chR.send(JSON.stringify(o));
}
function netSendR(o) {
  if (NET.ws) { if (NET.ws.readyState === 1) NET.ws.send(JSON.stringify(o)); return; }
  if (NET.chR && NET.chR.readyState === 'open') NET.chR.send(JSON.stringify(o));
}
function netSendU(o) {
  if (NET.ws) { if (NET.ws.readyState === 1 && NET.ws.bufferedAmount < 512 * 1024) NET.ws.send(JSON.stringify(o)); return; }
  const ch = NET.chU && NET.chU.readyState === 'open' ? NET.chU : null;
  if (ch && ch.bufferedAmount < 256 * 1024) ch.send(JSON.stringify(o));
}

// ---------- Online-Modus über den Spielserver (server.js – lokal oder z. B. auf Render.com)
// Adresse des Internet-Servers, wenn das Spiel z. B. auf GitHub Pages liegt:
const RELAY_URL = 'upgraded-broccoli-wpx74r756p625pp-8080.app.github.dev';  // Spielserver im GitHub Codespace
function serverWsUrl() {
  if (typeof location === 'undefined') return null;
  let q = null;
  try { q = new URLSearchParams(location.search).get('server'); } catch (e) {}
  const norm = s => {
    const secure = !/^(http|ws):\/\//i.test(s);
    const host = s.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '').replace(/\/ws$/, '');
    return (secure ? 'wss://' : 'ws://') + host + '/ws';
  };
  if (q) return norm(q);
  // Spiel wird direkt vom Spielserver ausgeliefert (localhost, LAN, Render …)
  if (/^https?:$/.test(location.protocol) && !/\.github\.io$/i.test(location.hostname)) return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
  return RELAY_URL ? norm(RELAY_URL) : null;
}
const ONLINE_URL = serverWsUrl();
const INVITE = (() => { try { return (new URLSearchParams(location.search).get('join') || '').toUpperCase(); } catch (e) { return ''; } })();
function inviteLink(code) {
  const u = new URL(location.href);
  u.search = '';
  if (/\.github\.io$/i.test(location.hostname) || location.protocol === 'file:') { /* Server-Adresse steckt im Spiel */ }
  try { const s = new URLSearchParams(location.search).get('server'); if (s) u.searchParams.set('server', s); } catch (e) {}
  u.searchParams.set('join', code);
  return u.toString();
}
function lanConnect(want, room, tries) {
  tries = tries || 0;
  if (!tries) netClose();
  if (!ONLINE_URL) { lobbyOpen('lan-info'); return; }
  if (!tries) {
    lobbyOpen(want === 'join' ? 'lan-join' : 'lan-host', room);
    lobbyStatus('Verbinde mit dem Server …');
  }
  NET.role = want === 'host' ? 'host-wait' : 'client-wait';
  let opened = false;
  const ws = NET.ws = new WebSocket(ONLINE_URL);
  // Kostenlose Server schlafen nach Inaktivität – das Aufwachen dauert bis ca. 1 Minute
  const CS = /app\.github\.dev/.test(ONLINE_URL);
  const offMsg = CS ? 'Der Spielserver (GitHub Codespace) ist gerade aus. Der Host startet ihn auf github.com/codespaces → „urban train“ öffnen – danach klappt es nach ca. 1–2 Minuten. Ich versuche es weiter …'
                    : 'Server wird gestartet … das kann beim ersten Mal bis zu einer Minute dauern.';
  const slow = setTimeout(() => { if (!opened && NET.ws === ws) lobbyStatus(offMsg, CS); }, 3500);
  ws.onopen = () => { opened = true; clearTimeout(slow); ws.send(JSON.stringify({ t: '_hello', want, room: room || '' })); };
  ws.onmessage = e => {
    NET.lastRecv = performance.now();
    let raw = e.data, gid = 1;
    if (raw[0] === '~') { const i = raw.indexOf('|'); gid = parseInt(raw.slice(1, i), 10); raw = raw.slice(i + 1); }
    let m; try { m = JSON.parse(raw); } catch (err) { return; }
    if (m.t === '_role') {
      NET.room = m.code || '';
      if (m.role === 'host') {
        NET.role = 'host'; NET.peer = false; NET.peers.clear(); NET.urls = m.urls || [];
        lobbyHide(); startGame();
        banner('Raum-Code: ' + NET.room, 'Bis zu 7 Freunde klicken „Online beitreten“ und geben den Code ein', '#7fd8ff');
      } else { NET.role = 'client'; lobbyStatus('Verbunden! Warte auf die Spieldaten vom Host …'); SFX.play('join', undefined, undefined, true); }
    } else if (m.t === '_peer') hostAddPeer(m.id || 1);
    else if (m.t === '_gone') { if (NET.role === 'host') hostPeerGone(m.id || 1); else netClose('Der Host hat das Spiel beendet.'); }
    else if (m.t === '_err') { const r = NET.role; netClose(); lobbyOpen(r === 'host-wait' ? 'lan-host' : 'lan-join', room); lobbyStatus(m.msg, true); }
    else { try { netOnMessage(m, gid); } catch (err) { console.error(err); } }
  };
  ws.onerror = () => {};
  ws.onclose = () => {
    clearTimeout(slow);
    if (NET.ws !== ws) return;
    if (!opened && tries < 60 && lobbyOpenNow()) {
      lobbyStatus(offMsg, CS);   // Server wacht noch auf → erneut versuchen
      NET.ws = null;
      setTimeout(() => { if (lobbyOpenNow() && !NET.ws) lanConnect(want, room, tries + 1); }, 3000);
      return;
    }
    netClose(opened ? 'Verbindung zum Server verloren.' : (CS ? 'Spielserver ist aus – auf github.com/codespaces „urban train“ starten.' : 'Server nicht erreichbar.'));
  };
}
// Mitspieler kommt (auch mitten im laufenden Spiel) dazu – bis zu 7 Stück
function addRemotePlayer(gid) {
  let id = 1; while (S.players.some(q => q.id === id)) id++;
  const q = mkPlayer(id); q.remote = true; q.gid = gid; q.name = 'Spieler ' + (id + 1);
  const base = S.player, a = id * 0.9;
  q.x = base.x + Math.cos(a) * 34; q.y = base.y + Math.sin(a) * 34; q.lastInput = S.t; q.lastNet = performance.now();
  recalcMaxHp(q); q.hp = q.maxHp;
  collideTiles(q, true, false);
  S.players.push(q);
  NET.peers.set(gid, id); NET.peer = true;
  return q;
}
function sendWorldTo(q) {
  netSendTo(q, { t: 'M', you: q.id, seed: S.seed, res: u8ToB64(S.res), rhp: u8ToB64(S.rhp), v: u8ToB64(S.variant), tgt: S.resTarget });
  NET.bDirty = true; NET.bT = 1;
}
function hostAddPeer(gid) {
  NET.lastRecv = performance.now();
  SFX.play('join', undefined, undefined, true);
  if (!S || mode === 'menu' || (!S.started && S.players.length < 2 && S.t < 0.5)) { NET.peers.set(gid, -1); NET.peer = true; startGame(); return; }
  if (NET.peers.has(gid) && pById(NET.peers.get(gid))) return;
  const q = addRemotePlayer(gid);
  toast('Ein Mitspieler ist beigetreten! (' + S.players.length + ' Spieler)', '#7fd8ff');
  addChat('', 'Ein Mitspieler ist beigetreten. Chat mit T oder Enter – Clans mit /clan!', '#8fe08f');
  hostEv(['c', '', 'Ein neuer Mitspieler ist da! Jetzt ' + S.players.length + ' Spieler.', 103]);
  sendWorldTo(q);
  netHostTick(1);
  if (mode === 'over' && lastResult) netSendTo(q, { t: 'O', r: lastResult });
}
function hostPeerGone(gid) {
  const id = NET.peers.get(gid);
  NET.peers.delete(gid); NET.peer = NET.peers.size > 0;
  const q = S && id !== undefined ? pById(id) : null;
  if (!q || q === S.player) return;
  const msg = pName(q) + ' hat das Spiel verlassen.';
  addChat('', msg, '#ff9a7a'); hostEv(['c', '', msg, 101]);
  clanLeave(q, true);
  S.players = S.players.filter(o => o !== q);
  if (mode !== 'menu') toast(msg, '#ff9a7a');
}
function copyText(t) {
  try { navigator.clipboard.writeText(t).catch(() => fallbackCopy(t)); } catch (e) { fallbackCopy(t); }
}
function fallbackCopy(t) {
  const ta = document.createElement('textarea'); ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove();
}
// ---------- Chat
const CHAT_COL = ['#9fd0ff', '#ffb0a8', '#a8f0b0', '#ffe27a', '#d8b4ff', '#9ff0f0', '#ffc890', '#ffaad8'];
const chatCol = i => i >= 100 ? ['#c8a8ff', '#aaa', '#ffe27a', '#8fe08f', '#7fffd0'][i - 100] || '#ddd' : CHAT_COL[i % CHAT_COL.length];
const pingCol = pid => CHAT_COL[(pid || 0) % CHAT_COL.length];
const pById = id => S.players.find(q => q.id === id);
const pName = p => (p.clan ? '[' + p.clan + '] ' : '') + (p.name || ('Spieler ' + (p.id + 1)));
function addChat(name, text, color) {
  chatLog.push({ name, text, color: color || '#ddd', t: performance.now() });
  if (chatLog.length > 40) chatLog.shift();
}
function toggleFullscreen() {
  const el = document.documentElement;
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else {
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (!req) { toast('Vollbild geht hier nicht – auf dem iPhone: Teilen → Zum Home-Bildschirm', '#ff9a7a'); return; }
      const pr = req.call(el);
      if (pr && pr.then) pr.then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (e) {} }).catch(() => toast('Vollbild wurde vom Browser blockiert', '#ff9a7a'));
    }
  } catch (e) { toast('Vollbild geht hier nicht', '#ff9a7a'); }
}
function chatSend(text) {
  text = cleanText(text, 120);
  if (!text || !S) return;
  if (/^\/(full|vollbild|fullscreen|fs)$/i.test(text)) { toggleFullscreen(); return; }
  if (text[0] === '/') {
    if (NET.role === 'client') { netSendR({ t: 'chat', text }); return; }
    runCommand(S.player, text); return;
  }
  if (NET.role === 'client') { netSendR({ t: 'chat', text }); return; }
  const me = S.player;
  addChat(pName(me), text, chatCol(me.id));
  hostEv(['c', pName(me), text, me.id]);
  SFX.play('chat', undefined, undefined, true);
}
let chatEl = null;
function chatOpen() {
  if (HEADLESS) return;
  if (!chatEl) {
    chatEl = document.createElement('input');
    chatEl.id = 'chatin'; chatEl.maxLength = 120; chatEl.autocomplete = 'off';
    chatEl.placeholder = 'Nachricht … (Enter senden, ESC abbrechen)';
    document.body.appendChild(chatEl);
    chatEl.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { chatSend(chatEl.value); chatClose(); }
      else if (e.key === 'Escape') chatClose();
    });
    chatEl.addEventListener('blur', () => setTimeout(chatClose, 0));
  }
  for (const k in keys) keys[k] = false;
  input.down = false;
  chatEl.value = ''; chatEl.style.display = 'block';
  setTimeout(() => chatEl.focus(), 0);
}
function chatClose() { if (chatEl) { chatEl.style.display = 'none'; chatEl.blur(); } }
function chatIsOpen() { return !!chatEl && chatEl.style.display === 'block'; }
function setName() {
  const n = cleanText(prompt('Wie soll dein Spielername lauten?', playerName), 16);
  if (!n) return;
  playerName = n; store.set(NAME_KEY, n);
  if (S && S.player) S.player.name = n;
  if (NET.role === 'client') netSendR({ t: 'name', name: n });
}
// ---------- Chat-Befehle (laufen beim Host bzw. im Einzelspieler)
function sysMsg(p, text, color) {
  if (p === S.player) addChat('', text, color || '#9fd0ff');
  else netSendTo(p, { t: 'sys', text, color });
}
// Chatzeile nur an einen Spieler (Team-Chat, Flüstern)
function chatTo(p, name, text, color) {
  if (p === S.player) { addChat(name, text, color); SFX.play('chat', undefined, undefined, true); }
  else netSendTo(p, { t: 'chat2', name, text, color });
}
function setAfk(p, on) {
  if (p.afk === on) return;
  p.afk = on;
  const who = p.name || ('Spieler ' + (p.id + 1));
  const msg = on ? who + ' ist jetzt AFK 💤' : who + ' ist wieder da!';
  addChat('', msg, '#c8a8ff'); hostEv(['c', '', msg, 100]);
  if (on) sysMsg(p, 'AFK an: Du wirst nicht rausgeworfen und Zombies ignorieren dich. Beweg dich oder schreib /afk, um zurückzukommen.');
}
const CLAN_RE = /^[A-Za-z0-9ÄÖÜäöüß_-]{2,10}$/;
function findPlayer(name) {
  name = String(name || '').toLowerCase();
  if (!name) return null;
  return S.players.find(q => (q.name || '').toLowerCase() === name) || S.players.find(q => (q.name || '').toLowerCase().startsWith(name)) || null;
}
function findClan(name) { name = String(name || '').toLowerCase(); for (const c of S.clans.values()) if (c.name.toLowerCase() === name) return c; return null; }
function clanMembers(c) { return S.players.filter(q => q.clan === c.name); }
function clanSay(c, text, color) { for (const q of clanMembers(c)) sysMsg(q, text, color || '#7fffd0'); }
function clanJoin(p, c) {
  if (p.clan) clanLeave(p, false);
  p.clan = c.name; c.invites.delete(p.id);
  clanSay(c, '🛡 ' + (p.name || 'Spieler') + ' ist dem Clan [' + c.name + '] beigetreten! (' + clanMembers(c).length + ' Mitglieder)');
}
function clanLeave(p, silent) {
  const c = p.clan ? S.clans.get(p.clan) : null;
  p.clan = '';
  if (!c) return;
  const rest = clanMembers(c);
  if (!silent) sysMsg(p, 'Du hast den Clan [' + c.name + '] verlassen.');
  if (!rest.length) { S.clans.delete(c.name); return; }
  if (c.leader === p.id) { c.leader = rest[0].id; clanSay(c, '👑 ' + (rest[0].name || 'Spieler') + ' führt jetzt den Clan.'); }
  clanSay(c, (p.name || 'Spieler') + ' hat den Clan verlassen.');
}
function clanBonus(p) {
  if (!p.clan) return 1;
  for (const q of S.players) if (q !== p && q.clan === p.clan && q.dead <= 0 && Math.hypot(q.x - p.x, q.y - p.y) < 8 * TS) return 1.1;
  return 1;
}
function runCommand(p, text) {
  const parts = text.slice(1).trim().split(/\s+/), cmd = (parts[0] || '').toLowerCase(), args = parts.slice(1);
  const rest = args.join(' ');
  if (cmd === 'afk') setAfk(p, !p.afk);
  else if (cmd === 'hilfe' || cmd === 'help' || cmd === '?') {
    sysMsg(p, 'Befehle: /afk · /full (Vollbild) · /team <Text> (nur dein Clan) · /w <Name> <Text> (flüstern) · /spieler');
    sysMsg(p, 'Clans: /clan gründen <Name> · /clan einladen <Spieler> · /clan beitreten <Name> · /clan verlassen · /clan offen · /clan kick <Spieler> · /clan info');
    sysMsg(p, 'Tasten: M Karte · K Skills · H Schmiede · Shift Spezialfähigkeit · Leertaste Springen · Tab Spielerliste · J Kryoturm · G Markierung · N Ton · 3D: rechte Maus ziehen bzw. , . = Kamera drehen');
    sysMsg(p, '🥚 Psst … in diesem Spiel sind ' + EGGS.length + ' Easter Eggs versteckt. Viel Spaß beim Suchen!', '#ffe27a');
  } else if (cmd === 'team' || cmd === 't' || cmd === 'tc') {
    if (!p.clan) { sysMsg(p, 'Du bist in keinem Clan. Gründe einen mit /clan gründen <Name>', '#ff9a7a'); return; }
    if (!rest) { sysMsg(p, 'Schreib: /team <Nachricht>', '#ff9a7a'); return; }
    const c = S.clans.get(p.clan), line = cleanText(rest, 120);
    for (const q of clanMembers(c)) chatTo(q, '[Team] ' + (p.name || 'Spieler'), line, '#7fffd0');
  } else if (cmd === 'w' || cmd === 'flüstern' || cmd === 'msg' || cmd === 'pm') {
    const q = findPlayer(args[0]), line = cleanText(args.slice(1).join(' '), 120);
    if (!q) { sysMsg(p, 'Spieler „' + (args[0] || '') + '“ nicht gefunden – /spieler zeigt alle.', '#ff9a7a'); return; }
    if (!line) { sysMsg(p, 'Schreib: /w <Name> <Nachricht>', '#ff9a7a'); return; }
    chatTo(q, '✉ ' + (p.name || 'Spieler') + ' → dich', line, '#ffaad8');
    if (q !== p) chatTo(p, '✉ du → ' + (q.name || 'Spieler'), line, '#ffaad8');
  } else if (cmd === 'spieler' || cmd === 'online' || cmd === 'who' || cmd === 'liste') {
    sysMsg(p, S.players.length + ' Spieler: ' + S.players.map(q => pName(q) + ' (Lv ' + q.lvl + (q.afk ? ', AFK' : '') + ')').join(', '));
  } else if (cmd === 'clan' || cmd === 'c') {
    const sub = (args[0] || 'info').toLowerCase(), arg = args.slice(1).join(' ');
    const mine = p.clan ? S.clans.get(p.clan) : null;
    if (sub === 'gründen' || sub === 'gruenden' || sub === 'erstellen' || sub === 'create' || sub === 'neu') {
      const name = cleanText(arg, 10);
      if (!CLAN_RE.test(name)) { sysMsg(p, 'Clan-Name: 2–10 Zeichen, nur Buchstaben, Zahlen, _ und -', '#ff9a7a'); return; }
      if (findClan(name)) { sysMsg(p, 'Den Clan [' + name + '] gibt es schon.', '#ff9a7a'); return; }
      if (p.clan) clanLeave(p, false);
      const c = { name, leader: p.id, invites: new Set(), open: false };
      S.clans.set(name, c); p.clan = name;
      const msg = '🛡 ' + (p.name || 'Spieler') + ' hat den Clan [' + name + '] gegründet!';
      addChat('', msg, '#7fffd0'); hostEv(['c', '', msg, 104]);
      sysMsg(p, 'Lade Leute ein mit /clan einladen <Name> oder öffne den Clan mit /clan offen. Clan-Bonus: +10 % Schaden in der Nähe von Clan-Mitgliedern.');
    } else if (sub === 'einladen' || sub === 'invite') {
      if (!mine) { sysMsg(p, 'Du bist in keinem Clan.', '#ff9a7a'); return; }
      const q = findPlayer(arg);
      if (!q || q === p) { sysMsg(p, 'Spieler „' + arg + '“ nicht gefunden.', '#ff9a7a'); return; }
      if (q.clan === mine.name) { sysMsg(p, (q.name || 'Spieler') + ' ist schon in deinem Clan.'); return; }
      mine.invites.add(q.id);
      sysMsg(q, '🛡 ' + (p.name || 'Spieler') + ' lädt dich in den Clan [' + mine.name + '] ein – schreib /clan beitreten ' + mine.name, '#7fffd0');
      sysMsg(p, 'Einladung an ' + (q.name || 'Spieler') + ' verschickt.');
    } else if (sub === 'beitreten' || sub === 'join' || sub === 'annehmen') {
      const c = arg ? findClan(arg) : [...S.clans.values()].find(c2 => c2.invites.has(p.id));
      if (!c) { sysMsg(p, arg ? 'Den Clan [' + arg + '] gibt es nicht.' : 'Du hast keine offene Einladung.', '#ff9a7a'); return; }
      if (!c.open && !c.invites.has(p.id)) { sysMsg(p, 'Du brauchst eine Einladung (oder der Clan muss offen sein).', '#ff9a7a'); return; }
      clanJoin(p, c);
    } else if (sub === 'verlassen' || sub === 'leave' || sub === 'austreten') {
      if (!mine) { sysMsg(p, 'Du bist in keinem Clan.', '#ff9a7a'); return; }
      clanLeave(p, false);
    } else if (sub === 'offen' || sub === 'open' || sub === 'zu' || sub === 'close') {
      if (!mine || mine.leader !== p.id) { sysMsg(p, 'Nur der Clan-Anführer kann das.', '#ff9a7a'); return; }
      mine.open = sub === 'offen' || sub === 'open';
      clanSay(mine, mine.open ? '🔓 Der Clan [' + mine.name + '] ist jetzt offen – jeder kann mit /clan beitreten ' + mine.name + ' rein.' : '🔒 Der Clan ist jetzt nur noch mit Einladung.');
      if (mine.open) hostEv(['c', '', '🔓 Der Clan [' + mine.name + '] nimmt neue Mitglieder auf: /clan beitreten ' + mine.name, 104]);
    } else if (sub === 'kick' || sub === 'rauswerfen') {
      if (!mine || mine.leader !== p.id) { sysMsg(p, 'Nur der Clan-Anführer kann das.', '#ff9a7a'); return; }
      const q = findPlayer(arg);
      if (!q || q.clan !== mine.name || q === p) { sysMsg(p, 'Kein Mitglied „' + arg + '“.', '#ff9a7a'); return; }
      sysMsg(q, 'Du wurdest aus dem Clan [' + mine.name + '] geworfen.', '#ff9a7a');
      clanLeave(q, true);
    } else {
      if (!S.clans.size) { sysMsg(p, 'Es gibt noch keine Clans. Gründe einen: /clan gründen <Name>'); return; }
      for (const c of S.clans.values()) {
        const lead = pById(c.leader);
        sysMsg(p, '[' + c.name + ']' + (c.open ? ' 🔓' : ' 🔒') + ' Anführer: ' + (lead ? lead.name : '?') + ' · ' + clanMembers(c).map(q => q.name).join(', '));
      }
    }
  }
  // ---- Easter Eggs
  else if (cmd === 'tanzen' || cmd === 'dance' || cmd === 'tanz') {
    p.danceT = 3; hostEv(['D', p.id]);
    for (let i = 0; i < 6; i++) floatText(p.x + rand(-30, 30), p.y - 20 - i * 6, ['♪', '♫', '♬'][i % 3], ['#ffe27a', '#7fd8ff', '#ff8ad8'][i % 3], 18);
    hostGiveEgg(p, 'dance');
  } else if (cmd === '42') {
    sysMsg(p, 'Die Antwort auf die endgültige Frage nach dem Leben, dem Universum und dem ganzen Rest. 🐬', '#ffe27a');
    if (!S.eggUsed['42_' + p.id]) { S.eggUsed['42_' + p.id] = 1; S.gold += 42; floatText(p.x, p.y - 30, '+42 Gold', '#ffd36b', 16); }
    hostGiveEgg(p, '42');
  } else if (cmd === 'kuchen' || cmd === 'cake') {
    sysMsg(p, '🍰 Der Kuchen ist eine Lüge.', '#ffe27a');
    hostGiveEgg(p, 'cake');
  } else if (cmd === 'party') {
    for (const q of S.players) for (let i = 0; i < 4; i++) burst(q.x, q.y - 10, ['#ff5b5b', '#ffe27a', '#7fd8ff', '#8fe08f', '#ff8ad8'][i], 10, 220, 1.2, 3, 120);
    SFX.play('levelup', p.x, p.y);
    hostEv(['c', '', '🎉 ' + (p.name || 'Jemand') + ' schmeißt eine Party!', 102]); addChat('', '🎉 ' + (p.name || 'Jemand') + ' schmeißt eine Party!', '#ffe27a');
    hostGiveEgg(p, 'party');
  } else sysMsg(p, 'Unbekannter Befehl „/' + cmd + '“ – schreib /hilfe');
}
function leaveGame() { netClose(); mode = 'menu'; newGame(); }
function startSingle() { netClose(); startGame(); }
function netClose(reason) {
  const was = NET.role;
  NET.role = null; NET.ev = []; NET.lastRecv = 0; NET.peer = false; NET.peers.clear();
  const pc = NET.pc, a = NET.chR, b = NET.chU, ws = NET.ws;
  NET.pc = NET.chR = NET.chU = NET.ws = null;
  try { if (a) a.close(); if (b) b.close(); if (pc) pc.close(); if (ws) ws.close(); } catch (e) {}
  if (was === 'client') { mode = 'menu'; newGame(); menuMsg = reason || 'Verbindung zum Host getrennt.'; }
  else if (was === 'host' && S) {
    S.players = [S.player];
    if (mode !== 'menu') toast(reason || 'Mitspieler hat das Spiel verlassen', '#ff9a7a');
  }
  if (reason && was && was.endsWith('-wait')) lobbyStatus(reason, true);
  else lobbyHide();
}
function setupChannel(ch) {
  ch.onmessage = e => { NET.lastRecv = performance.now(); try { netOnMessage(JSON.parse(e.data), 1); } catch (err) { console.error(err); } };
  ch.onclose = () => { if (NET.role && (NET.chR === ch || NET.chU === ch)) netClose(NET.role === 'host' ? 'Mitspieler hat die Verbindung getrennt' : 'Verbindung zum Host getrennt.'); };
  if (ch.label === 'r') ch.onopen = () => netOnOpen();
}
function newPeer() {
  const pc = new RTCPeerConnection(RTC_CFG);
  pc.onconnectionstatechange = () => {
    if (pc === NET.pc && pc.connectionState === 'failed') netClose('Verbindung fehlgeschlagen (Firewall/NAT?). Versucht es erneut.');
  };
  return pc;
}
async function netHostCreate() {
  netClose();
  NET.role = 'host-wait';
  const pc = NET.pc = newPeer();
  NET.chR = pc.createDataChannel('r', { ordered: true });
  NET.chU = pc.createDataChannel('u', { ordered: false, maxRetransmits: 0 });
  setupChannel(NET.chR); setupChannel(NET.chU);
  await pc.setLocalDescription(await pc.createOffer());
  await waitIce(pc);
  return packCode(pc.localDescription);
}
async function netHostAccept(code) {
  const desc = await unpackCode(code);
  if (desc.type !== 'answer') throw new Error('Das ist ein Einladungs-Code – du brauchst den ANTWORT-Code deines Freundes.');
  if (!NET.pc) throw new Error('Keine offene Einladung – bitte neu hosten.');
  await NET.pc.setRemoteDescription(desc);
}
async function netJoin(code) {
  const desc = await unpackCode(code);
  if (desc.type !== 'offer') throw new Error('Das ist ein Antwort-Code – du brauchst den EINLADUNGS-Code des Hosts.');
  netClose();
  NET.role = 'client-wait';
  const pc = NET.pc = newPeer();
  pc.ondatachannel = e => {
    if (e.channel.label === 'r') NET.chR = e.channel; else NET.chU = e.channel;
    setupChannel(e.channel);
    if (e.channel.label === 'r' && e.channel.readyState === 'open') netOnOpen();
  };
  await pc.setRemoteDescription(desc);
  await pc.setLocalDescription(await pc.createAnswer());
  await waitIce(pc);
  return packCode(pc.localDescription);
}
function netOnOpen() {
  NET.lastRecv = performance.now();
  if (NET.role === 'host-wait') {
    NET.role = 'host';
    lobbyHide();
    hostAddPeer(1);
  } else if (NET.role === 'client-wait') {
    NET.role = 'client';
    lobbyStatus('Verbunden! Warte auf den Spielstart …');
    SFX.play('join', undefined, undefined, true);
  }
}

// ---------- Host → Client
function netSendFull() {
  for (const q of S.players) if (q.remote) sendWorldTo(q);
  NET.ev = [];
  netHostTick(1);
}
function netHostTick(dt) {
  if (!NET.peer || NET.mute) return;
  NET.sendT += dt; NET.bT += dt;
  netPingTick(dt);
  if (NET.sendT < 0.05) return;
  NET.sendT = 0;
  if (NET.bDirty && NET.bT > 0.2) {
    NET.bDirty = false; NET.bT = 0;
    netSendR({ t: 'B', b: S.buildings.map(b => [b.id, BTYPES.indexOf(b.type), b.tx, b.ty, b.lvl, Math.ceil(b.hp), b.maxHp, b.spent.w, b.spent.s, b.spent.g]) });
  }
  if (NET.ev.length) { netSendR({ t: 'E', e: NET.ev }); NET.ev = []; }
  const bd = [];
  for (const b of S.buildings) if (TOWERS[b.type] || b.type === 'harv' || b.hp < b.maxHp || b.flash > 0) bd.push([b.id, Math.ceil(b.hp), r2(b.angle), b.flash > 0 ? 1 : 0]);
  netSendU({
    t: 'S',
    g: [r2(S.t), S.phase === 'night' ? 1 : 0, r2(S.phaseT), S.night, S.survived, r2(S.nightT), S.kills, r2(S.wood), r2(S.stone), r2(S.gold),
        S.started ? 1 : 0, r2(S.ending), S.spawnQueue.length, S.hq ? S.hq.id : 0, Math.floor(S.goldEarned),
        S.bossKills || 0, S.chestsOpened || 0, S.bloodMoon ? 1 : 0, S.bloodSurvived || 0, S.bomberKills || 0, S.animalKills || 0, S.weather || 0, S.stormSurvived || 0, r2(S.iron || 0)],
    p: S.players.map(p => [p.id, p.x | 0, p.y | 0, r2(p.face), TOOLIDS.indexOf(p.tool), Math.ceil(p.hp), p.maxHp, r2(p.dead), r2(p.swing), p.flash > 0 ? 1 : 0, p.tp, p.name || '', p.lvl, Math.floor(p.xp), p.sp, SKILLS.map(s => p.sk[s.id]), p.afk ? 1 : 0, TOOL_ORDER.map(k => p.tl[k]), p.clan || '', ABIL.findIndex(a => a.id === p.ab), r2(Math.max(0, p.abCd || 0)), r2(Math.max(0, p.rageT || 0)), p.danceT > 0 ? 1 : 0, p.z | 0]),
    ch: S.chests.map(c => [c.id, c.x | 0, c.y | 0]),
    po: S.portal ? [S.portal.x | 0, S.portal.y | 0, S.portal2.x | 0, S.portal2.y | 0] : 0,
    an: (S.animals || []).map(a => [a.id, ATYPES.indexOf(a.type), a.x | 0, a.y | 0, r2(a.face), Math.round(100 * a.hp / a.maxHp), a.flash > 0 ? 1 : 0, a.vx | 0, a.vy | 0]),
    z: S.zombies.map(z => [z.id, ZTYPES.indexOf(z.type), z.x | 0, z.y | 0, r2(z.face), Math.round(100 * z.hp / z.maxHp), z.flash > 0 ? 1 : 0, z.lunge > 0 ? 1 : 0, z.vx | 0, z.vy | 0, z.frostT > 0 ? 1 : 0, z.golden ? 1 : 0]),
    pr: S.projs.map(q => [PKINDS.indexOf(q.k), q.x | 0, q.y | 0, q.k === 'bomb' ? ((q.tx - q.sx) / q.T) | 0 : q.vx | 0, q.k === 'bomb' ? ((q.ty - q.sy) / q.T) | 0 : q.vy | 0, q.h | 0]),
    bd,
  });
}
function hostHandleClient(m, p) {
  if (!p) return;
  if (m.t === 'I') {
    const nx = clamp(+m.x || 0, 0, WORLD), ny = clamp(+m.y || 0, 0, WORLD);
    if (p.afk && (m.d || Math.hypot(nx - p.x, ny - p.y) > 3)) setAfk(p, false);
    if (mode !== 'over' && p.dead <= 0) { p.x = nx; p.y = ny; }
    p.face = +m.f || 0; p.tool = TOOLIDS[m.tool] || 'sword'; p.lastNet = performance.now(); p.z = clamp(+m.z || 0, 0, 200);
    if (!(p.tl[p.tool] > 0)) p.tool = 'sword';
    p.inp.down = !!m.d; p.lastInput = S.t;
  } else if (m.t === 'name') {
    const old = p.name; p.name = cleanText(m.name, 16) || p.name;
    if (old && old !== p.name) { addChat('', old + ' heißt jetzt ' + p.name, '#aaa'); hostEv(['c', '', old + ' heißt jetzt ' + p.name, 101]); }
  } else if (m.t === 'chat') {
    const text = cleanText(m.text, 120);
    if (!text) return;
    if (text[0] === '/') { runCommand(p, text); return; }
    addChat(pName(p), text, chatCol(p.id));
    hostEv(['c', pName(p), text, p.id]);
    SFX.play('chat', undefined, undefined, true);
  } else if (m.t === 'skill') {
    spendSkill(p, String(m.id));
  } else if (m.t === 'abSel') {
    selectAbility(p, String(m.id));
  } else if (m.t === 'abUse') {
    p.face = +m.f || p.face; useAbility(p);
  } else if (m.t === 'respec') {
    respecSkills(p);
  } else if (m.t === 'egg') {
    hostEgg(p, String(m.id));
  } else if (m.t === 'tool') {
    const err = upgradeTool(p, String(m.id));
    if (err) netSendR({ t: 'T', text: err, color: '#ff7b6b', err: 1 });
  } else if (m.t === 'pin') {
    addPing(clamp(+m.x || 0, 0, WORLD), clamp(+m.y || 0, 0, WORLD), 1);
  } else if (m.t === 'C' && mode !== 'over') {
    if (m.c === 'place' && BDEF[m.type]) {
      const err = placeError(m.type, m.tx | 0, m.ty | 0);
      if (err) { netSendR({ t: 'T', text: err, color: '#ff7b6b', err: 1 }); return; }
      placeBuilding(m.type, m.tx | 0, m.ty | 0, p);
    } else if (m.c === 'up' || m.c === 'sell') {
      const b = S.bById.get(m.id);
      if (!b) return;
      if (m.c === 'up') upgradeBuilding(b, p); else sellBuilding(b, p);
    }
  }
}

// ---------- Client
function netOnMessage(m, gid) {
  if (NET.role === 'host') {
    const p = pById(NET.peers.get(gid || 1));
    if (!p) return;
    p.lastNet = performance.now();
    if (m.t === 'p') { netSendTo(p, { t: 'q', ts: m.ts }); return; }
    if (m.t === 'q') { p.ping = performance.now() - m.ts; NET.ping = p.ping; return; }
    hostHandleClient(m, p); return;
  }
  if (m.t === 'p') { netSendR({ t: 'q', ts: m.ts }); return; }
  if (m.t === 'q') { NET.ping = performance.now() - m.ts; return; }
  if (NET.role !== 'client') return;
  switch (m.t) {
    case 'M': clientInitMap(m); break;
    case 'B': if (S && S.isClient) clientBuildings(m.b); break;
    case 'S': if (S && S.isClient) clientSnapshot(m); break;
    case 'E': if (S && S.isClient) for (const e of m.e) clientEvent(e); break;
    case 'T': if (S) { toast(m.text, m.color); if (m.err) SFX.play('error', undefined, undefined, true); } break;
    case 'sys': addChat('', m.text, m.color || '#9fd0ff'); break;
    case 'chat2': addChat(m.name, m.text, m.color); SFX.play('chat', undefined, undefined, true); break;
    case 'egg': foundEgg(m.id); break;
    case 'O': if (S) { finishResult(m.r); mode = 'over'; modeT = 0; S.sel = null; S.place = null; input.down = false; SFX.play('die', undefined, undefined, true); } break;
  }
}
function clientInitMap(m) {
  newGame({ localId: m.you || 1, noMap: true });
  S.isClient = true;
  S.res = b64ToU8(m.res); S.rhp = b64ToU8(m.rhp); S.variant = b64ToU8(m.v);
  S.resTarget = m.tgt; S.seed = m.seed || 1; genBiomes(); calcMountains();
  S.place = null;
  if (!HEADLESS) buildMinimap();
  lobbyHide();
  mode = 'play'; modeT = 0; menuMsg = null;
  SFX.init();
  banner('Verbunden!', 'Ihr baut gemeinsam – Ressourcen werden geteilt', '#7fd8ff');
  netSendR({ t: 'name', name: playerName });
  addChat('', 'Verbunden! Chat mit T oder Enter, Markierung mit G.', '#8fe08f');
}
function clientBuildings(list) {
  const old = S.bById;
  S.buildings = []; S.bById = new Map(); S.bmap.fill(0); S.counts = {}; S.hq = null;
  for (const a of list) {
    const type = BTYPES[a[1]], d = BDEF[type];
    const b = old.get(a[0]) || { id: a[0], flash: 0, angle: -Math.PI / 2, nodes: { t: 0, r: 0, g: 0 } };
    Object.assign(b, { type, tx: a[2], ty: a[3], size: d.size, lvl: a[4], hp: a[5], maxHp: a[6], spent: { w: a[7], s: a[8], g: a[9] }, dead: false });
    S.buildings.push(b); S.bById.set(b.id, b);
    for (let y = b.ty; y < b.ty + b.size; y++) for (let x = b.tx; x < b.tx + b.size; x++) S.bmap[y * MAP + x] = b.id;
    S.counts[type] = (S.counts[type] || 0) + 1;
    if (type === 'hq') S.hq = b;
    if (type === 'harv') countNodes(b);
  }
  for (const b of old.values()) if (!S.bById.has(b.id)) b.dead = true;
  if (S.sel) S.sel = S.bById.get(S.sel.id) || null;
  if (S.hq && S.place === 'hq') S.place = null;
}
function clientSnapshot(m) {
  const g = m.g;
  S.phase = g[1] ? 'night' : 'day'; S.phaseT = g[2]; S.night = g[3]; S.survived = g[4]; S.nightT = g[5]; S.kills = g[6];
  S.wood = g[7]; S.stone = g[8]; S.gold = g[9]; S.started = !!g[10]; S.ending = g[11]; S.qLen = g[12]; S.goldEarned = g[14];
  S.bossKills = g[15] || 0; S.chestsOpened = g[16] || 0; S.bloodMoon = !!g[17]; S.bloodSurvived = g[18] || 0; S.bomberKills = g[19] || 0; S.animalKills = g[20] || 0; S.weather = g[21] || 0; S.stormSurvived = g[22] || 0; S.iron = g[23] || 0;
  if (!g[13]) S.hq = null;
  const ids = new Set();
  for (const a of m.p) {
    ids.add(a[0]);
    let p = pById(a[0]);
    if (!p) { p = mkPlayer(a[0]); p.remote = true; p.x = p.tx = a[1]; p.y = p.ty = a[2]; S.players.push(p); }
    p.clan = a[18] || ''; p.ab = a[19] >= 0 ? ABIL[a[19]].id : null; p.abCd = a[20] || 0; p.rageT = a[21] || 0; if (a[22] && !(p.danceT > 0)) p.danceT = 1;
    p.hp = a[5]; p.maxHp = a[6]; p.dead = a[7]; if (a[9]) p.flash = 0.15;
    if (p !== S.player && a[11]) p.name = a[11];
    p.afk = !!a[16];
    if (a[12]) {
      if (p === S.player && a[12] > p.lvl) SFX.play('levelup', undefined, undefined, true);
      p.lvl = a[12]; p.xp = a[13]; p.sp = a[14];
      SKILLS.forEach((s, k) => { p.sk[s.id] = a[15][k] || 0; });
    }
    if (a[17]) TOOL_ORDER.forEach((k, i) => { p.tl[k] = a[17][i] || 0; });
  }
  S.players = S.players.filter(q => q === S.player || ids.has(q.id));
  for (const a of m.p) {
    const p = pById(a[0]);
    if (p === S.player) {
      if (a[10] !== p.tp) { p.tp = a[10]; p.x = a[1]; p.y = a[2]; }
    } else {
      p.tx = a[1]; p.ty = a[2]; p.face = a[3]; p.tool = TOOLIDS[a[4]] || 'sword'; p.swing = a[8]; p.z = a[23] || 0;
      if (Math.hypot(p.tx - p.x, p.ty - p.y) > 300) { p.x = p.tx; p.y = p.ty; }
    }
  }
  const am = new Map((S.animals || []).map(a => [a.id, a]));
  S.animals = (m.an || []).map(a => {
    let an = am.get(a[0]);
    const type = ATYPES[a[1]];
    if (!an) an = { id: a[0], type, x: a[2], y: a[3], r: ADEF[type].r, walk: 0 };
    an.tx = a[2]; an.ty = a[3]; an.face = a[4]; an.hp = a[5]; an.maxHp = 100; an.flash = a[6] ? 0.1 : 0; an.vx = a[7]; an.vy = a[8];
    return an;
  });
  const zm = new Map(S.zombies.map(z => [z.id, z]));
  S.zombies = m.z.map(a => {
    let z = zm.get(a[0]);
    const type = ZTYPES[a[1]];
    if (!z) z = { id: a[0], type, x: a[2], y: a[3], r: ZDEF[type].r, walk: rand(0, TAU) };
    z.tx = a[2]; z.ty = a[3]; z.face = a[4]; z.hp = a[5]; z.maxHp = 100; z.flash = a[6] ? 0.1 : 0; z.lunge = a[7] ? 0.1 : 0; z.vx = a[8]; z.vy = a[9]; z.frostT = a[10] ? 0.2 : 0; z.golden = !!a[11];
    return z;
  });
  S.projs = m.pr.map(a => ({ k: PKINDS[a[0]], x: a[1], y: a[2], vx: a[3], vy: a[4], h: a[5], r: 6 }));
  if (m.ch) S.chests = m.ch.map(a => ({ id: a[0], x: a[1], y: a[2] }));
  if (m.po) { S.portal = { x: m.po[0], y: m.po[1] }; S.portal2 = { x: m.po[2], y: m.po[3] }; }
  for (const a of m.bd) {
    const b = S.bById.get(a[0]);
    if (b) { b.hp = a[1]; b.angle = a[2]; if (a[3]) b.flash = 0.12; }
  }
}
function clientEvent(e) {
  switch (e[0]) {
    case 'b': burst(e[1], e[2], e[3], e[4], e[5], e[6], e[7], e[8]); break;
    case 'L': S.strikes.push({ x: e[1], y: e[2], life: 0.45, seed: Math.random() * 99 }); break;
    case 't': floatText(e[1], e[2], e[3], e[4], e[5]); break;
    case 's': SFX.play(e[1], e[2] === null ? undefined : e[2], e[3] === null ? undefined : e[3], true); break;
    case 'S': if (e[1] === S.player.id) SFX.play(e[2], undefined, undefined, true); break;
    case 'k': addShake(e[1], e[2], e[3]); break;
    case 'K': if (e[1] === S.player.id) S.shake = Math.min(18, S.shake + e[2]); break;
    case 'g': ring(e[1], e[2], e[3], e[4], e[5]); break;
    case 'f': lightFlash(e[1], e[2], e[3], e[4]); break;
    case 'l': bolt(e[1], e[2]); break;
    case 'w': S.wobble.set(e[1], { t: 0.25, a: e[2] }); break;
    case 'r': setRes(e[1], e[2], e[3], !!e[4]); break;
    case 'n': banner(e[1], e[2], e[3]); break;
    case 'm': toast(e[1], e[2]); break;
    case 'c': addChat(e[1], e[2], chatCol(e[3])); SFX.play('chat', undefined, undefined, true); break;
    case 'D': { const q = pById(e[1]); if (q) q.danceT = 3; break; }
    case 'P': S.pings.push({ x: e[1], y: e[2], pid: e[3], t: 4 }); SFX.play('ping', undefined, undefined, true); break;
  }
}
function clientUpdate(dt) {
  S.t += dt;
  S.phaseT = Math.max(0, S.phaseT - dt);
  buildHash();
  const p = S.player;
  readLocalInput(p);
  p.flash -= dt;
  if (p.dead <= 0) movePlayer(p, dt);
  // Schwung-Animation lokal vorhersagen (Treffer berechnet der Host)
  p.cd -= dt; p.swing -= dt; p.abCd = Math.max(0, (p.abCd || 0) - dt); p.invT = (p.invT || 0) - dt;
  for (const q of S.players) q.danceT = (q.danceT || 0) - dt;
  if (p.inp.down && p.cd <= 0 && p.dead <= 0) { p.cd = (TOOLS[p.tool] || TOOLS.sword).cd; p.swing = 0.22; }
  const k = Math.min(1, dt * 12);
  for (const q of S.players) if (q !== p) {
    const ox = q.x, oy = q.y;
    q.x += (q.tx - q.x) * k; q.y += (q.ty - q.y) * k; q.swing -= dt; q.flash -= dt;
    if (Math.abs(q.x - ox) + Math.abs(q.y - oy) > 0.3) q.walk += dt * 10;
  }
  for (const z of S.zombies) {
    z.tx += z.vx * dt; z.ty += z.vy * dt;
    z.x += (z.tx - z.x) * k; z.y += (z.ty - z.y) * k;
    z.walk += dt * Math.hypot(z.vx, z.vy) * 0.08; z.flash -= dt;
  }
  for (const q of S.projs) { q.x += q.vx * dt; q.y += q.vy * dt; }
  for (const an of S.animals || []) {
    an.tx += an.vx * dt; an.ty += an.vy * dt;
    an.x += (an.tx - an.x) * k; an.y += (an.ty - an.y) * k;
    an.walk += dt * Math.hypot(an.vx, an.vy) * 0.1; an.flash -= dt;
  }
  updFx(dt);
  followCam(dt);
  netPingTick(dt);
  // Eingaben an den Host
  NET.inT += dt;
  if (NET.inT >= 1 / 30) {
    NET.inT = 0;
    netSendU({ t: 'I', x: r2(p.x), y: r2(p.y), f: r2(p.face), tool: TOOLIDS.indexOf(p.tool), d: p.inp.down ? 1 : 0, z: p.z | 0 });
  }
}
function netPingTick(dt) {
  if (NET.role !== 'host' && NET.role !== 'client') return;
  NET.pingT += dt;
  if (NET.pingT > 2) { NET.pingT = 0; netSendR({ t: 'p', ts: performance.now() }); }
  // AFK-Spieler werden nie rausgeworfen; sonst erst nach 30 s Funkstille
  if (NET.role === 'host') {
    if (S) for (const [gid, id] of [...NET.peers]) { const q = pById(id); if (q && !q.afk && q.lastNet && performance.now() - q.lastNet > 30000) hostPeerGone(gid); }
    return;
  }
  const afk = S && S.player && S.player.afk;
  if (!afk && NET.lastRecv && performance.now() - NET.lastRecv > 30000) netClose('Zeitüberschreitung – keine Daten vom Host.');
}
// Bau-/Upgrade-Aktionen: als Client an den Host schicken, sonst direkt ausführen
function actPlace(type, tx, ty) {
  if (NET.role === 'client') { netSendR({ t: 'C', c: 'place', type, tx, ty }); return; }
  placeBuilding(type, tx, ty);
}
function actUpgrade(b) {
  if (NET.role === 'client') {
    const err = upgradeError(b);
    if (err) { toast(err, '#ff7b6b'); SFX.play('error', undefined, undefined, true); return; }
    netSendR({ t: 'C', c: 'up', id: b.id }); return;
  }
  upgradeBuilding(b);
}
function actSell(b) {
  if (NET.role === 'client') { netSendR({ t: 'C', c: 'sell', id: b.id }); S.sel = null; return; }
  sellBuilding(b);
}

// ---------- Lobby (HTML-Overlay für die Verbindungs-Codes)
let lobbyEl = null;
function lobbyHide() { if (lobbyEl) lobbyEl.style.display = 'none'; }
function lobbyOpenNow() { return !!lobbyEl && lobbyEl.style.display !== 'none'; }
function lobbyStatus(t, err) { const s = lobbyEl && lobbyEl.querySelector('#lb-status'); if (s) { s.textContent = t; s.style.color = err ? '#ff8a7a' : '#cfe8ff'; } }
function lobbyOpen(kind, room) {
  SFX.init();
  if (!lobbyEl) {
    lobbyEl = document.createElement('div');
    lobbyEl.id = 'lobby';
    document.body.appendChild(lobbyEl);
  }
  lobbyEl.style.display = 'flex';
  if (kind === 'lan-join' || kind === 'lan-host' || kind === 'lan-info') {
    const where = ONLINE_URL ? ONLINE_URL.replace(/^wss?:\/\//, '').replace(/\/ws$/, '') : '';
    lobbyEl.innerHTML = kind === 'lan-join' ? `
      <div class="lb-box"><h2>Online beitreten</h2>
        <p>Gib den <b>Raum-Code</b> ein, den dein Freund (der Host) oben im Spiel sieht:</p>
        <input id="lb-code" maxlength="4" placeholder="z. B. K7QX" autocomplete="off" spellcheck="false">
        <button id="lb-go" class="primary">Beitreten</button>
        <p id="lb-status"></p><button id="lb-cancel">Abbrechen</button>
        <p class="lb-hint">Server: ${where}</p></div>` : kind === 'lan-host' ? `
      <div class="lb-box"><h2>Online hosten</h2>
        <p id="lb-status"></p><button id="lb-cancel">Abbrechen</button>
        <p class="lb-hint">Server: ${where}</p></div>` : `
      <div class="lb-box"><h2>Online-Modus</h2>
        <p>Für den Online-Modus braucht das Spiel den Spielserver (server.js).</p>
        <p><b>Übers Internet:</b> Öffne die Online-Version des Spiels (GitHub-Pages- oder Render-Link).</p>
        <p><b>Im Heimnetz:</b> Doppelklick auf <b>start-server.bat</b>, dann <b>http://localhost:8080</b> öffnen.</p>
        <p id="lb-status"></p><button id="lb-cancel">Schließen</button></div>`;
    lobbyEl.querySelector('#lb-cancel').onclick = () => { netClose(); lobbyHide(); };
    const codeIn = lobbyEl.querySelector('#lb-code');
    if (codeIn) {
      codeIn.value = room || INVITE || '';
      const go = () => {
        const code = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (code.length !== 4) { lobbyStatus('Der Raum-Code hat 4 Zeichen.', true); return; }
        lanConnect('join', code, 1);
        lobbyStatus('Verbinde mit dem Server …');
      };
      lobbyEl.querySelector('#lb-go').onclick = go;
      codeIn.onkeydown = e => { if (e.key === 'Enter') go(); };
      setTimeout(() => codeIn.focus(), 30);
    }
    return;
  }
  const host = kind === 'host';
  lobbyEl.innerHTML = `
    <div class="lb-box">
      <h2>${host ? 'Online-Spiel hosten' : 'Online-Spiel beitreten'}</h2>
      ${host ? `
        <p><b>1.</b> Kopiere deinen <b>Einladungs-Code</b> und schicke ihn deinem Freund (z. B. per Discord oder WhatsApp).</p>
        <textarea id="lb-out" readonly placeholder="Code wird erzeugt …"></textarea>
        <button id="lb-copy" disabled>Code kopieren</button>
        <p><b>2.</b> Füge hier den <b>Antwort-Code</b> deines Freundes ein:</p>
        <textarea id="lb-in" placeholder="Antwort-Code hier einfügen"></textarea>
        <button id="lb-go" class="primary">Verbinden</button>` : `
        <p><b>1.</b> Füge den <b>Einladungs-Code</b> des Hosts ein:</p>
        <textarea id="lb-in" placeholder="Einladungs-Code hier einfügen"></textarea>
        <button id="lb-go" class="primary">Antwort-Code erzeugen</button>
        <p><b>2.</b> Schicke diesen <b>Antwort-Code</b> zurück an den Host:</p>
        <textarea id="lb-out" readonly placeholder="Erscheint nach Schritt 1"></textarea>
        <button id="lb-copy" disabled>Code kopieren</button>`}
      <p id="lb-status"></p>
      <button id="lb-cancel">Abbrechen</button>
      <p class="lb-hint">Beide lassen dieses Fenster offen, bis die Verbindung steht. Der Code gilt nur für einen Verbindungsversuch.
      In sehr strengen Netzwerken (manche Schul-/Firmen-WLANs) kann eine direkte Verbindung scheitern – dann z. B. über Handy-Hotspot probieren.</p>
    </div>`;
  const $ = s => lobbyEl.querySelector(s);
  const out = $('#lb-out'), inp = $('#lb-in'), copy = $('#lb-copy'), go = $('#lb-go');
  const showCode = c => { out.value = c; copy.disabled = false; };
  copy.onclick = async () => {
    out.select();
    let ok = false;
    try { await navigator.clipboard.writeText(out.value); ok = true; } catch (e) { try { ok = document.execCommand('copy'); } catch (e2) {} }
    lobbyStatus(ok ? 'Code kopiert!' : 'Bitte den markierten Code mit Strg+C kopieren.');
  };
  $('#lb-cancel').onclick = () => { netClose(); lobbyHide(); };
  if (host) {
    lobbyStatus('Erzeuge Einladungs-Code …');
    netHostCreate().then(c => { showCode(c); lobbyStatus('Warte auf den Antwort-Code deines Freundes …'); })
      .catch(e => lobbyStatus('Fehler: ' + e.message, true));
    go.onclick = () => {
      lobbyStatus('Verbinde …');
      netHostAccept(inp.value).then(() => lobbyStatus('Verbinde … (kann ein paar Sekunden dauern)'))
        .catch(e => lobbyStatus('Fehler: ' + e.message, true));
    };
  } else {
    go.onclick = () => {
      lobbyStatus('Erzeuge Antwort-Code …');
      netJoin(inp.value).then(c => { showCode(c); lobbyStatus('Schicke den Antwort-Code an den Host und warte …'); })
        .catch(e => lobbyStatus('Fehler: ' + e.message, true));
    };
  }
}


// =====================================================================
// Rendering
// =====================================================================
let canvas = null, ctx = null, lightC = null, lctx = null, lightSprite = null, mmC = null;
// Handy/Tablet: Touch-Steuerung + verkleinerte Oberfläche
let isTouch = !HEADLESS && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
let uiS = 1;
let tickles = [];
function tickleCheck(b) {
  if (b.type !== 'hq') return;
  const now = performance.now();
  tickles = tickles.filter(t => now - t < 3000); tickles.push(now);
  if (tickles.length >= 10) { tickles = []; actEgg('tickle'); }
}
const touch = { joyId: null, jx: 0, jy: 0, kx: 0, ky: 0, atkId: null, placeId: null, pingMode: false,
                aimId: null, ax: 0, ay: 0, akx: 0, aky: 0, lastAng: null };
let JOY_R = 58;
// Feste Plätze der beiden Joysticks (Bildschirm-Pixel)
function joyHomes() {
  JOY_R = Math.max(48, 66 * uiS);
  // immer in echten Bildschirm-Pixeln rechnen (VW/VH sind beim HUD-Zeichnen skaliert)
  const W = typeof innerWidth !== 'undefined' ? innerWidth : VW, H = typeof innerHeight !== 'undefined' ? innerHeight : VH;
  const y = H - 205 * uiS;
  return { lx: 135 * uiS, ly: y, rx: Math.min(W - 215 * uiS, W - (mmSize() + 30) * uiS - JOY_R - 14), ry: y };
}
// Rechter Joystick: kleiner Ausschlag = automatisch auf das nächste Ziel, großer Ausschlag = in diese Richtung
function stickAim(p) {
  let dx = touch.akx - touch.ax, dy = touch.aky - touch.ay;
  const m = Math.hypot(dx, dy), yaw = R3 ? R3.yaw || 0 : 0;
  if (yaw) { const c = Math.cos(yaw), s = Math.sin(yaw), rx = dx * c + dy * s, ry = -dx * s + dy * c; dx = rx; dy = ry; }
  if (m > JOY_R * 0.3) { touch.lastAng = Math.atan2(dy, dx); return { x: p.x + dx / m * 220, y: p.y + dy / m * 220, down: m > JOY_R * 0.45 }; }
  let best = null, bd = 260;
  for (const z of S.zombies) { if (z.dead) continue; const d = Math.hypot(z.x - p.x, z.y - p.y); if (d < bd) { bd = d; best = z; } }
  if (!best && (p.tool === 'pick' || p.tool === 'axe')) {
    const ptx = Math.floor(p.x / TS), pty = Math.floor(p.y / TS);
    bd = 3 * TS;
    for (let y = pty - 2; y <= pty + 2; y++) for (let x = ptx - 2; x <= ptx + 2; x++) {
      if (!inMap(x, y) || !S.res[y * MAP + x] || SOLID_RES(S.res[y * MAP + x]) || (p.tool === 'axe' && S.res[y * MAP + x] !== 1)) continue;
      const cx = (x + 0.5) * TS, cy = (y + 0.5) * TS, d = Math.hypot(cx - p.x, cy - p.y);
      if (d < bd) { bd = d; best = { x: cx, y: cy }; }
    }
  }
  if (best) { touch.lastAng = Math.atan2(best.y - p.y, best.x - p.x); return { x: best.x, y: best.y, down: true }; }
  const a = touch.lastAng !== null ? touch.lastAng : p.face;
  return { x: p.x + Math.cos(a) * 220, y: p.y + Math.sin(a) * 220, down: true };
}
function calcUiScale() { uiS = isTouch ? clamp(Math.min(VW / 1050, VH / 620), 0.6, 1) : 1; }
let ui = [];
let hoverSlot = null;

function makeLightSprite() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.75)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return c;
}
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  VW = Math.max(1, window.innerWidth); VH = Math.max(1, window.innerHeight);
  canvas.width = VW * DPR | 0; canvas.height = VH * DPR | 0;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  lightC.width = Math.max(1, Math.ceil(VW / 2)); lightC.height = Math.max(1, Math.ceil(VH / 2));
  calcUiScale();
}
const MM_COL = ['rgb(58,84,48)', 'rgb(34,92,40)', 'rgb(120,120,128)', 'rgb(214,176,52)'];
function buildMinimap() {
  mmC = document.createElement('canvas'); mmC.width = MAP; mmC.height = MAP;
  const g = mmC.getContext('2d'), img = g.createImageData(MAP, MAP);
  for (let i = 0; i < MAP * MAP; i++) {
    const c = mmColor(i), o = i * 4;
    img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}
const MM_BIOME = [[58, 84, 48], [58, 84, 48], [200, 172, 108], [222, 232, 240], [52, 68, 42], [36, 22, 52]];
const MM_RES = [null, [34, 92, 40], [120, 120, 128], [214, 176, 52], [8, 4, 14], [190, 120, 255], null, [168, 92, 50]];
function mmColor(i) {
  const k = S.res[i], b = S.biome ? S.biome[i] : 0;
  if (!k) return MM_BIOME[b];
  if (k === 1 && b === 2) return [70, 140, 60];
  if (k === 1 && b === 3) return [200, 220, 230];
  if (k === 2 && b === 5) return [60, 50, 80];
  if (k === 7) return [168, 92, 50];
  if (k === 6) { const h = S.mtn ? S.mtn[i] : 1; return h >= 3 || b === 3 ? [214, 218, 224] : b === 2 ? [150, 108, 78] : [96 + h * 6, 90 + h * 6, 84 + h * 6]; }
  return MM_RES[k];
}
function mmSet(i) {
  if (!mmC) return;
  const g = mmC.getContext('2d'), c = mmColor(i);
  g.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
  g.fillRect(i % MAP, i / MAP | 0, 1, 1);
}
function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); }
function darkness() {
  if (!S.started) return 0;
  const base = S.player && S.biome && S.biome[tileAt(S.player.x, S.player.y)] === 5 ? Math.max(0.62, darkness0()) : darkness0();
  return S.weather ? Math.min(0.86, base + (S.weather === 2 ? 0.22 : 0.12) * (1 - base)) : base;
}
function darkness0() {
  if (S.phase === 'day') { const el = DAY_LEN - S.phaseT; if (el < 6) return 0.35 * (1 - el / 6); if (S.phaseT < 12) return 0.45 * (1 - S.phaseT / 12); return 0; }
  const el = NIGHT_LEN - S.phaseT;
  if (el < 4) return lerp(0.45, 0.8, el / 4);
  if (S.phaseT < 6) return lerp(0.35, 0.8, S.phaseT / 6);
  return 0.8;
}

// ---------- Gebäude zeichnen (lokale Koordinaten, Ursprung oben links, w = Breite in px)
function drawBuildingShape(type, lvl, w, ang, t, flash) {
  const col = LV_COL[lvl - 1];
  const base = (fill) => {
    ctx.fillStyle = 'rgba(0,0,0,0.28)'; rr(3, 5, w - 3, w - 3, 6); ctx.fill();
    ctx.fillStyle = fill; rr(2, 2, w - 4, w - 4, 6); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.stroke();
  };
  const c = w / 2;
  switch (type) {
    case 'trap': {
      ctx.fillStyle = 'rgba(0,0,0,0.25)'; rr(3, 4, w - 5, w - 5, 4); ctx.fill();
      ctx.fillStyle = '#4a3f36'; rr(3, 3, w - 6, w - 6, 4); ctx.fill();
      ctx.fillStyle = lvl > 2 ? '#c8ccd8' : '#9a9aa4';
      for (let yy = 0; yy < 3; yy++) for (let xx = 0; xx < 3; xx++) {
        const px = w * (0.22 + xx * 0.28), py = w * (0.22 + yy * 0.28);
        ctx.beginPath(); ctx.moveTo(px, py - w * 0.11); ctx.lineTo(px + w * 0.08, py + w * 0.07); ctx.lineTo(px - w * 0.08, py + w * 0.07); ctx.closePath(); ctx.fill();
      }
      break;
    }
    case 'wall': {
      base(col);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(4, w * 0.36); ctx.lineTo(w - 4, w * 0.36); ctx.moveTo(4, w * 0.66); ctx.lineTo(w - 4, w * 0.66);
      ctx.moveTo(c, 4); ctx.lineTo(c, w * 0.36); ctx.moveTo(w * 0.3, w * 0.36); ctx.lineTo(w * 0.3, w * 0.66);
      ctx.moveTo(w * 0.7, w * 0.36); ctx.lineTo(w * 0.7, w * 0.66); ctx.moveTo(c, w * 0.66); ctx.lineTo(c, w - 4); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(4, 4, w - 8, 3);
      break;
    }
    case 'door': {
      base('#6b4a2a');
      ctx.fillStyle = col; rr(6, 6, w - 12, w - 12, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5; ctx.beginPath();
      for (let i = 1; i < 4; i++) { ctx.moveTo(6 + (w - 12) * i / 4, 7); ctx.lineTo(6 + (w - 12) * i / 4, w - 7); } ctx.stroke();
      ctx.fillStyle = '#2a2a2a'; ctx.fillRect(6, w * 0.28, w - 12, 3); ctx.fillRect(6, w * 0.66, w - 12, 3);
      ctx.fillStyle = '#ffd36b'; circle(w * 0.72, c, 2.5); ctx.fill();
      break;
    }
    case 'mine': {
      base('#4a3b2a');
      ctx.fillStyle = col; rr(w * 0.12, w * 0.12, w * 0.76, w * 0.76, 8); ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#2a2018'; circle(c, c, w * 0.26); ctx.fill();
      ctx.save(); ctx.translate(c, c); ctx.rotate(t * (1 + lvl * 0.4));
      ctx.strokeStyle = '#c8a050'; ctx.lineWidth = 3;
      for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 4); ctx.beginPath(); ctx.moveTo(-w * 0.22, 0); ctx.lineTo(w * 0.22, 0); ctx.stroke(); }
      ctx.restore();
      ctx.fillStyle = '#f2c94c';
      [[0.2, 0.22], [0.78, 0.25], [0.24, 0.78], [0.8, 0.76]].forEach(q => { circle(w * q[0], w * q[1], w * 0.07); ctx.fill(); });
      break;
    }
    case 'arrow': {
      base(col);
      ctx.fillStyle = '#3d4d5e'; circle(c, c, w * 0.32); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.save(); ctx.translate(c, c); ctx.rotate(ang);
      ctx.strokeStyle = '#d9b87a'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.arc(-w * 0.04, 0, w * 0.24, -1.1, 1.1); ctx.stroke();
      ctx.strokeStyle = '#eee'; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(-w * 0.04 + Math.cos(-1.1) * w * 0.24, Math.sin(-1.1) * w * 0.24); ctx.lineTo(-w * 0.12, 0);
      ctx.lineTo(-w * 0.04 + Math.cos(1.1) * w * 0.24, Math.sin(1.1) * w * 0.24); ctx.stroke();
      ctx.fillStyle = '#8fd0ff'; ctx.fillRect(-w * 0.12, -1.5, w * 0.4, 3);
      ctx.restore();
      break;
    }
    case 'cannon': {
      base(col);
      ctx.fillStyle = '#2e2e33'; circle(c, c, w * 0.3); ctx.fill();
      ctx.save(); ctx.translate(c, c); ctx.rotate(ang);
      ctx.fillStyle = '#1d1d22'; rr(0, -w * 0.09, w * 0.44, w * 0.18, 3); ctx.fill();
      ctx.fillStyle = '#55555e'; ctx.fillRect(w * 0.36, -w * 0.11, w * 0.08, w * 0.22);
      ctx.restore();
      ctx.fillStyle = '#55555e'; circle(c, c, w * 0.12); ctx.fill();
      break;
    }
    case 'mage': {
      base(col);
      ctx.strokeStyle = '#c792ff'; ctx.lineWidth = 2; ctx.globalAlpha = 0.7;
      ctx.save(); ctx.translate(c, c); ctx.rotate(t * 0.8); ctx.beginPath();
      for (let i = 0; i < 5; i++) { const a = i * TAU * 2 / 5; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * w * 0.32, Math.sin(a) * w * 0.32); }
      ctx.closePath(); ctx.stroke(); ctx.restore(); ctx.globalAlpha = 1;
      const bob = Math.sin(t * 3) * 3;
      ctx.fillStyle = '#e0c4ff'; ctx.beginPath();
      ctx.moveTo(c, c - w * 0.24 + bob); ctx.lineTo(c + w * 0.12, c + bob); ctx.lineTo(c, c + w * 0.24 + bob); ctx.lineTo(c - w * 0.12, c + bob); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#9b5cff'; ctx.beginPath();
      ctx.moveTo(c, c - w * 0.24 + bob); ctx.lineTo(c + w * 0.12, c + bob); ctx.lineTo(c, c + w * 0.24 + bob); ctx.closePath(); ctx.fill();
      break;
    }
    case 'bomb': {
      base(col);
      ctx.fillStyle = '#3a2a2a'; circle(c, c, w * 0.33); ctx.fill();
      ctx.save(); ctx.translate(c, c); ctx.rotate(ang);
      ctx.fillStyle = '#26262b'; rr(-w * 0.05, -w * 0.17, w * 0.32, w * 0.34, 6); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#111'; circle(c, c, w * 0.15); ctx.fill();
      ctx.fillStyle = '#ff5a3a'; circle(c, c, w * 0.05); ctx.fill();
      break;
    }
    case 'harv': {
      base('#5d6b3c');
      for (let k = 0; k < 2; k++) {
        const sx = k ? w * 0.68 : w * 0.32, sy = k ? w * 0.68 : w * 0.32;
        ctx.save(); ctx.translate(sx, sy); ctx.rotate(k ? -ang : ang);
        ctx.fillStyle = '#c8c8d0'; ctx.beginPath();
        for (let i = 0; i < 16; i++) { const a = i * TAU / 16, r = i % 2 ? w * 0.13 : w * 0.18; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#555'; circle(0, 0, w * 0.05); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = col; rr(w * 0.6, w * 0.1, w * 0.28, w * 0.28, 4); ctx.fill();
      break;
    }
    case 'heal': {
      base(col);
      const pulse = 1 + Math.sin(t * 3) * 0.06;
      ctx.fillStyle = '#e9f7ee'; circle(c, c, w * 0.3); ctx.fill();
      ctx.strokeStyle = 'rgba(80,220,120,0.6)'; ctx.lineWidth = 2; circle(c, c, w * 0.36 * pulse); ctx.stroke();
      ctx.fillStyle = '#2fbf5a';
      ctx.fillRect(c - w * 0.07, c - w * 0.2, w * 0.14, w * 0.4);
      ctx.fillRect(c - w * 0.2, c - w * 0.07, w * 0.4, w * 0.14);
      break;
    }
    case 'frost': {
      base(col);
      const pulse = 1 + Math.sin(t * 2.2) * 0.05;
      ctx.fillStyle = 'rgba(160,220,255,0.25)'; circle(c, c, w * 0.42 * pulse); ctx.fill();
      ctx.save(); ctx.translate(c, c); ctx.rotate(t * 0.6);
      ctx.fillStyle = '#d8f2ff'; ctx.strokeStyle = '#6ab8e8'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) {
        ctx.rotate(Math.PI / 3);
        ctx.beginPath(); ctx.moveTo(0, -w * 0.06); ctx.lineTo(w * 0.07, -w * 0.2); ctx.lineTo(0, -w * 0.36); ctx.lineTo(-w * 0.07, -w * 0.2); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = '#ffffff'; circle(c, c, w * 0.08); ctx.fill();
      break;
    }
    case 'hq': {
      base('#6b5224');
      ctx.fillStyle = col; rr(w * 0.1, w * 0.1, w * 0.8, w * 0.8, 10); ctx.fill();
      ctx.fillStyle = '#5a4020'; rr(w * 0.2, w * 0.2, w * 0.6, w * 0.6, 8); ctx.fill();
      const pulse = 1 + Math.sin(t * 2.5) * 0.04;
      ctx.fillStyle = '#f2c94c'; circle(c, c, w * 0.2 * pulse); ctx.fill();
      ctx.strokeStyle = '#a67c1c'; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = '#8a6514'; ctx.font = 'bold ' + (w * 0.22 | 0) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('G', c, c + 1);
      ctx.fillStyle = '#e6b83a';
      [[0.18, 0.18], [0.82, 0.18], [0.18, 0.82], [0.82, 0.82]].forEach(q => { circle(w * q[0], w * q[1], w * 0.05); ctx.fill(); });
      break;
    }
  }
  if (lvl > 1) {
    for (let i = 0; i < lvl; i++) {
      ctx.fillStyle = '#ffe27a';
      circle(w / 2 + (i - (lvl - 1) / 2) * 6, w - 6, 2); ctx.fill();
    }
  }
  if (flash) { ctx.fillStyle = 'rgba(255,255,255,0.45)'; rr(2, 2, w - 4, w - 4, 6); ctx.fill(); }
}

function drawZombie(z) {
  const D = ZDEF[z.type], r = z.r, fl = z.flash > 0;
  ctx.save(); ctx.translate(z.x, z.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(2, r * 0.6, r, r * 0.5, 0, 0, TAU); ctx.fill();
  ctx.rotate(z.face);
  const sw = Math.sin(z.walk) * r * 0.2, lunge = z.lunge > 0 ? r * 0.4 : 0;
  ctx.fillStyle = fl ? '#fff' : D.color;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5;
  circle(r * 0.75 + sw + lunge, -r * 0.7, r * 0.32); ctx.fill(); ctx.stroke();
  circle(r * 0.75 - sw + lunge, r * 0.7, r * 0.32); ctx.fill(); ctx.stroke();
  if (z.type === 'boss') {
    ctx.fillStyle = fl ? '#fff' : '#5a2070';
    for (let i = 0; i < 8; i++) { const a = i * TAU / 8 + 0.2; ctx.beginPath(); ctx.moveTo(Math.cos(a - 0.2) * r, Math.sin(a - 0.2) * r); ctx.lineTo(Math.cos(a) * r * 1.35, Math.sin(a) * r * 1.35); ctx.lineTo(Math.cos(a + 0.2) * r, Math.sin(a + 0.2) * r); ctx.fill(); }
  }
  ctx.fillStyle = fl ? '#fff' : D.color;
  circle(0, 0, r); ctx.fill(); ctx.stroke();
  if (z.type === 'brute') { ctx.fillStyle = fl ? '#fff' : '#3a5a2e'; circle(-r * 0.15, -r * 0.65, r * 0.4); ctx.fill(); circle(-r * 0.15, r * 0.65, r * 0.4); ctx.fill(); }
  if (z.type === 'spitter') { ctx.fillStyle = '#9dffb8'; circle(r * 0.55, 0, r * 0.35); ctx.fill(); }
  if (z.type === 'armored') {
    ctx.fillStyle = fl ? '#fff' : '#9aa4ae'; circle(-r * 0.05, 0, r * 0.78); ctx.fill();
    ctx.strokeStyle = '#5a646e'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#6a747e'; ctx.fillRect(-r * 0.5, -r * 0.08, r, r * 0.16);
  }
  if (z.type === 'shade') {
    ctx.fillStyle = 'rgba(160,90,255,' + (0.25 + 0.15 * Math.sin(animT * 7 + z.id)) + ')'; circle(0, 0, r * 1.5); ctx.fill();
    ctx.fillStyle = fl ? '#fff' : '#1a0a2a'; for (let k = 0; k < 5; k++) { const a = Math.PI + (k - 2) * 0.35; ctx.beginPath(); ctx.moveTo(Math.cos(a - 0.15) * r * 0.8, Math.sin(a - 0.15) * r * 0.8); ctx.lineTo(Math.cos(a) * r * (1.6 + 0.2 * Math.sin(animT * 9 + k)), Math.sin(a) * r * 1.6); ctx.lineTo(Math.cos(a + 0.15) * r * 0.8, Math.sin(a + 0.15) * r * 0.8); ctx.fill(); }
  }
  if (z.type === 'shaman') {
    ctx.fillStyle = fl ? '#fff' : '#4a2a7a';
    ctx.beginPath(); ctx.moveTo(-r * 0.9, -r * 0.6); ctx.lineTo(r * 0.3, 0); ctx.lineTo(-r * 0.9, r * 0.6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(190,150,255,' + (0.5 + 0.3 * Math.sin(animT * 6 + z.id)) + ')'; circle(r * 1.1, r * 0.9, r * 0.32); ctx.fill();
  }
  if (z.type === 'bomber') {
    ctx.fillStyle = '#3a2a22'; circle(-r * 0.2, 0, r * 0.55); ctx.fill();
    ctx.strokeStyle = '#c8a070'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-r * 0.2, -r * 0.5); ctx.lineTo(-r * 0.5, -r * 1.1); ctx.stroke();
    if (Math.sin(animT * 18 + z.id) > 0) { ctx.fillStyle = '#ffe14a'; circle(-r * 0.5, -r * 1.15, 3); ctx.fill(); }
  }
  if (z.type === 'runner') { ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.moveTo(-r * 0.6, -r * 0.3); ctx.lineTo(-r * 0.2, 0); ctx.lineTo(-r * 0.6, r * 0.3); ctx.stroke(); }
  ctx.fillStyle = z.type === 'boss' ? '#ffde3a' : z.type === 'shaman' || z.type === 'shade' ? '#d8b4ff' : '#ff3a3a';
  circle(r * 0.45, -r * 0.3, Math.max(1.8, r * 0.13)); ctx.fill();
  circle(r * 0.45, r * 0.3, Math.max(1.8, r * 0.13)); ctx.fill();
  if (z.frostT > 0) { ctx.fillStyle = 'rgba(170,225,255,0.45)'; circle(0, 0, r * 1.05); ctx.fill(); }
  if (z.golden) { ctx.fillStyle = 'rgba(255,211,107,' + (0.45 + 0.2 * Math.sin(animT * 8)) + ')'; circle(0, 0, r * 1.1); ctx.fill(); }
  ctx.restore();
}

function drawAnimal(an) {
  const D = ADEF[an.type], r = an.r, fl = an.flash > 0, leg = Math.sin(an.walk || 0) * r * 0.3;
  ctx.save(); ctx.translate(an.x, an.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.ellipse(2, r * 0.5, r * 1.1, r * 0.5, 0, 0, TAU); ctx.fill();
  ctx.rotate(an.face || 0);
  ctx.fillStyle = fl ? '#fff' : '#3a2a1a';
  for (const [lx, ly] of [[r * 0.5, -r * 0.5], [r * 0.5, r * 0.5], [-r * 0.5, -r * 0.5], [-r * 0.5, r * 0.5]]) { circle(lx + (ly > 0 ? leg : -leg), ly * 1.05, r * 0.18); ctx.fill(); }
  ctx.fillStyle = fl ? '#fff' : D.color;
  ctx.beginPath(); ctx.ellipse(0, 0, r * 1.05, r * 0.65, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.2; ctx.stroke();
  circle(r * 0.95, 0, r * 0.45); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#111'; circle(r * 1.15, -r * 0.18, Math.max(1.3, r * 0.08)); ctx.fill(); circle(r * 1.15, r * 0.18, Math.max(1.3, r * 0.08)); ctx.fill();
  if (an.type === 'deer') {
    ctx.strokeStyle = '#d8c090'; ctx.lineWidth = 2;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(r * 0.85, s * r * 0.3); ctx.lineTo(r * 0.55, s * r * 0.95); ctx.lineTo(r * 0.3, s * r * 1.1); ctx.moveTo(r * 0.62, s * r * 0.75); ctx.lineTo(r * 0.85, s * r * 1.05); ctx.stroke(); }
    ctx.fillStyle = '#f0e0c8'; circle(-r * 0.95, 0, r * 0.22); ctx.fill();
  } else if (an.type === 'rabbit') {
    ctx.fillStyle = fl ? '#fff' : '#d8c8b0';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(r * 0.6, s * r * 0.45, r * 0.55, r * 0.17, s * 0.5, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#fff'; circle(-r * 1.0, 0, r * 0.3); ctx.fill();
  } else {
    ctx.fillStyle = '#f2ead8';
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(r * 1.25, s * r * 0.2); ctx.lineTo(r * 1.55, s * r * 0.45); ctx.lineTo(r * 1.2, s * r * 0.35); ctx.fill(); }
    ctx.fillStyle = '#3a2a1a'; circle(r * 1.35, 0, r * 0.2); ctx.fill();
  }
  ctx.restore();
  if (an.hp < an.maxHp) hpBar(an.x, an.y - r - 10, 26, an.hp / an.maxHp, '#e0a050');
}
function drawPlayer(p) {
  if (p.dead > 0) return;
  ctx.save(); ctx.translate(p.x, p.y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(2, 9, 14, 7, 0, 0, TAU); ctx.fill();
  if (p.z > 0) { const k = 1 + p.z / 420; ctx.translate(0, -p.z * 0.45); ctx.scale(k, k); }
  ctx.rotate(p.danceT > 0 ? animT * 12 : p.face);
  const sw = p.swing > 0 ? Math.sin((1 - p.swing / 0.22) * Math.PI) : 0;
  const skin = p.flash > 0 ? '#ff8080' : '#f0c9a0';
  if (p.rageT > 0) { ctx.fillStyle = 'rgba(255,90,40,' + (0.25 + 0.1 * Math.sin(animT * 10)) + ')'; circle(0, 0, p.r * 1.7); ctx.fill(); }
  // Werkzeug
  ctx.save();
  const met = toolMet(p, p.tool);
  if (p.tool === 'spear') { ctx.rotate(-0.25); ctx.translate(sw * 18, 0); }
  else if (p.tool === 'axe') ctx.rotate(-1.6 + sw * 3.2);
  else if (p.tool !== 'bow') { ctx.rotate(-0.9 + sw * 1.9); }
  ctx.translate(14, 10);
  if (p.tool === 'pick') {
    ctx.fillStyle = '#7a5530'; ctx.fillRect(0, -2, 24, 4);
    ctx.strokeStyle = met; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(22, 0, 10, -1.3, 1.3); ctx.stroke();
  } else if (p.tool === 'sword') {
    ctx.fillStyle = '#5a3a1a'; ctx.fillRect(-2, -2, 8, 4);
    ctx.fillStyle = '#c9a227'; ctx.fillRect(5, -6, 3, 12);
    ctx.fillStyle = met; ctx.beginPath(); ctx.moveTo(8, -3); ctx.lineTo(32, -2); ctx.lineTo(36, 0); ctx.lineTo(32, 2); ctx.lineTo(8, 3); ctx.closePath(); ctx.fill();
  } else if (p.tool === 'spear') {
    ctx.fillStyle = '#7a5530'; ctx.fillRect(-8, -1.5, 44, 3);
    ctx.fillStyle = met; ctx.beginPath(); ctx.moveTo(35, -4.5); ctx.lineTo(48, 0); ctx.lineTo(35, 4.5); ctx.closePath(); ctx.fill();
  } else if (p.tool === 'axe') {
    ctx.fillStyle = met; ctx.beginPath(); ctx.ellipse(24, 0, 7, 13, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#6a4526'; ctx.fillRect(-2, -2, 32, 4);
  } else if (p.tool === 'staff') {
    ctx.fillStyle = '#5a3a1a'; ctx.fillRect(-4, -2, 32, 4);
    ctx.fillStyle = 'rgba(255,150,50,' + (0.3 + 0.15 * Math.sin(animT * 8)) + ')'; circle(31, 0, 10); ctx.fill();
    ctx.fillStyle = met === TMET[0] ? '#ff7a2a' : met; circle(31, 0, 5); ctx.fill();
  } else {
    ctx.translate(-2, -10);
    const pull = p.cd > 0.2 ? 0 : 4;
    ctx.strokeStyle = '#8a5a2a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(4, 0, 15, -1.25, 1.25); ctx.stroke();
    ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(4 + Math.cos(-1.25) * 15, Math.sin(-1.25) * 15); ctx.lineTo(4 - pull, 0); ctx.lineTo(4 + Math.cos(1.25) * 15, Math.sin(1.25) * 15); ctx.stroke();
    if (p.cd < 0.25) { ctx.fillStyle = '#ddd'; ctx.fillRect(4 - pull, -1, 22, 2); }
  }
  ctx.restore();
  // Körper
  ctx.fillStyle = skin; ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5;
  circle(12, -11, 5); ctx.fill(); ctx.stroke();
  circle(14, 10, 5); ctx.fill(); ctx.stroke();
  ctx.fillStyle = PLAYER_COL[p.id % PLAYER_COL.length]; circle(0, 0, p.r); ctx.fill(); ctx.stroke();
  ctx.fillStyle = skin; circle(2, 0, p.r * 0.62); ctx.fill();
  ctx.fillStyle = '#5a3a1a'; ctx.beginPath(); ctx.arc(0, 0, p.r * 0.64, Math.PI * 0.55, Math.PI * 1.45); ctx.fill();
  ctx.restore();
}

function resScale(i) {
  const k = S.res[i], f = 0.6 + 0.4 * clamp(S.rhp[i] / RES_HP[k], 0, 1);
  const gr = S.grow.get(i);
  return gr ? f * (1 - gr / 1.2 * 0.85) : f;
}
const GROUND2D = [null, null, ['#c8ad6e', '#bc9f62', '#d2b97c'], ['#e4ecf2', '#d6e0ea', '#eef4f8'], ['#3a4a2c', '#33422a', '#425432'], ['#1e1428', '#180f22', '#261a34']];
function drawTree(x, y, v, wob, sc, bi) {
  const s = (0.9 + (v % 5) * 0.06) * sc;
  let ox = 0, oy = 0;
  if (wob) { const k = Math.sin(wob.t * 40) * 4 * (wob.t / 0.25); ox = Math.cos(wob.a) * k; oy = Math.sin(wob.a) * k; }
  if (bi === 2) {   // Kaktus
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; circle(x + 4, y + 6, 13 * s); ctx.fill();
    ctx.fillStyle = '#3f8a3a'; rr(x + ox - 7 * s, y + oy - 18 * s, 14 * s, 30 * s, 7 * s); ctx.fill();
    ctx.fillStyle = '#4fa048'; rr(x + ox - 17 * s, y + oy - 8 * s, 8 * s, 14 * s, 4 * s); ctx.fill(); rr(x + ox + 9 * s, y + oy - 13 * s, 8 * s, 12 * s, 4 * s); ctx.fill();
    if (v % 4 === 0) { ctx.fillStyle = '#ff6a8a'; circle(x + ox, y + oy - 18 * s, 3 * s); ctx.fill(); }
    return;
  }
  if (bi === 4) {   // toter Sumpfbaum
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; circle(x + 5, y + 7, 20 * s); ctx.fill();
    ctx.strokeStyle = '#4a3a26'; ctx.lineWidth = 5 * s; ctx.beginPath();
    for (let k = 0; k < 4; k++) { const a = v + k * 1.6; ctx.moveTo(x, y); ctx.lineTo(x + ox + Math.cos(a) * 20 * s, y + oy + Math.sin(a) * 20 * s); }
    ctx.stroke();
    ctx.fillStyle = 'rgba(70,90,50,0.85)'; circle(x + ox - 3, y + oy - 3, 13 * s); ctx.fill();
    ctx.fillStyle = '#3a2a1a'; circle(x, y, 6 * sc); ctx.fill();
    return;
  }
  if (bi === 3) {   // verschneite Tanne
    ctx.fillStyle = 'rgba(0,0,0,0.2)'; circle(x + 5, y + 7, 22 * s); ctx.fill();
    ctx.fillStyle = '#2a5a44'; circle(x + ox, y + oy, 22 * s); ctx.fill();
    ctx.fillStyle = '#f2f8fc'; circle(x + ox - 4, y + oy - 4, 15 * s); ctx.fill();
    ctx.fillStyle = '#ffffff'; circle(x + ox - 8, y + oy - 8, 8 * s); ctx.fill();
    return;
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; circle(x + 5, y + 7, 22 * s); ctx.fill();
  ctx.fillStyle = '#5a3d22'; circle(x, y, 7 * sc); ctx.fill();
  ctx.fillStyle = '#245a2a'; circle(x + ox, y + oy, 23 * s); ctx.fill();
  ctx.fillStyle = '#2f7334'; circle(x + ox - 4, y + oy - 4, 17 * s); ctx.fill();
  ctx.fillStyle = '#3d8c3f'; circle(x + ox - 8, y + oy - 8, 9 * s); ctx.fill();
}
function drawScrap(x, y, v, sc, wob) {
  if (wob) { const k = Math.sin(wob.t * 40) * 3 * (wob.t / 0.25); x += Math.cos(wob.a) * k; y += Math.sin(wob.a) * k; }
  ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(x + 3, y + 5, 19 * sc, 12 * sc, 0, 0, TAU); ctx.fill();
  if (v % 3 === 0) {   // Autowrack
    ctx.save(); ctx.translate(x, y); ctx.rotate(v * 0.7); ctx.scale(sc, sc);
    ctx.fillStyle = ['#8a3a2a', '#4a5a6a', '#7a6a3a', '#5a5a52'][v % 4]; rr(-19, -10, 38, 20, 5); ctx.fill();
    ctx.fillStyle = '#a8582a'; rr(-6, -7, 14, 14, 3); ctx.fill();
    ctx.fillStyle = '#202428'; ctx.fillRect(9, -8, 4, 16); ctx.fillRect(-14, -8, 4, 16);
    ctx.fillStyle = 'rgba(160,80,40,0.7)'; circle(-10 + v % 9, -3, 3); ctx.fill(); circle(12, 4, 2.5); ctx.fill();
    ctx.restore();
  } else {   // Fässer & Blech
    const cols = ['#a84a20', '#3a5a3a', '#8a2a20', '#4a4a52'];
    for (let k = 0; k < 3; k++) { const a = v + k * 2.1; ctx.fillStyle = cols[(v + k) % 4]; circle(x + Math.cos(a) * 8 * sc, y + Math.sin(a) * 7 * sc, 7 * sc); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = 1.5; ctx.stroke(); }
    ctx.fillStyle = '#7a6a5a'; ctx.fillRect(x - 12 * sc, y + 6 * sc, 18 * sc, 4 * sc);
  }
}
function drawMountain(x, y, v, h, bi) {
  const base = bi === 2 ? [150, 104, 72] : bi === 3 ? [120, 128, 140] : bi === 4 ? [80, 82, 70] : [104, 98, 92];
  const k = 0.75 + Math.min(h, 6) * 0.06 + (v % 5) * 0.02;
  ctx.fillStyle = 'rgb(' + (base[0] * k | 0) + ',' + (base[1] * k | 0) + ',' + (base[2] * k | 0) + ')';
  ctx.fillRect(x, y, TS + 0.5, TS + 0.5);
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.moveTo(x + 4 + v % 9, y + 6); ctx.lineTo(x + 30, y + 14 + v % 11); ctx.lineTo(x + 12, y + 34); ctx.fill();
  if (h >= 3 || bi === 3) { ctx.fillStyle = 'rgba(240,244,250,' + (0.55 + Math.min(h, 6) * 0.07) + ')'; ctx.beginPath(); ctx.moveTo(x + 20, y + 4); ctx.lineTo(x + 34, y + 20); ctx.lineTo(x + 20, y + 26); ctx.lineTo(x + 6, y + 18); ctx.fill(); }
}
function drawVoid(x, y, v) {
  ctx.fillStyle = '#0a0610'; ctx.fillRect(x - 21, y - 21, 42, 42);
  ctx.fillStyle = 'rgba(140,60,220,' + (0.15 + 0.1 * Math.sin(animT * 2 + v)) + ')'; circle(x + (v % 9) - 4, y + (v % 7) - 3, 6 + v % 6); ctx.fill();
}
function drawCrystal(x, y, v, sc) {
  ctx.fillStyle = 'rgba(0,0,0,0.3)'; circle(x + 3, y + 5, 14 * sc); ctx.fill();
  const glow = 0.6 + 0.3 * Math.sin(animT * 3 + v);
  ctx.fillStyle = 'rgba(180,110,255,' + 0.25 * glow + ')'; circle(x, y, 22 * sc); ctx.fill();
  for (let k = 0; k < 4; k++) {
    const a = v + k * 1.57, ox = Math.cos(a) * 7 * sc, oy = Math.sin(a) * 7 * sc, h = (12 + (k % 2) * 6) * sc;
    ctx.fillStyle = k % 2 ? '#c890ff' : '#8a4ae0';
    ctx.beginPath(); ctx.moveTo(x + ox, y + oy - h); ctx.lineTo(x + ox + 5 * sc, y + oy); ctx.lineTo(x + ox, y + oy + 4 * sc); ctx.lineTo(x + ox - 5 * sc, y + oy); ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = '#f4e8ff'; circle(x - 2, y - 6 * sc, 2); ctx.fill();
}
const ROCK2D = { 2: ['#c09a60', '#d8b880'], 3: ['#a8c8dc', '#d0e6f2'], 4: ['#5a5a4a', '#707060'], 5: ['#2a2236', '#3e3450'] };
function drawRock(x, y, v, wob, sc, gold, bi) {
  let ox = 0, oy = 0;
  if (wob) { const k = Math.sin(wob.t * 40) * 3 * (wob.t / 0.25); ox = Math.cos(wob.a) * k; oy = Math.sin(wob.a) * k; }
  x += ox; y += oy;
  const n = 7, rot = v / 40;
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; circle(x + 4, y + 5, 17 * sc); ctx.fill();
  const rc = ROCK2D[bi];
  ctx.fillStyle = gold ? '#6e6252' : rc ? rc[0] : '#7d7d86'; ctx.beginPath();
  for (let i = 0; i < n; i++) { const a = rot + i * TAU / n, r = (15 + ((v >> (i % 5)) & 3) * 1.4) * sc; ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * r, y + Math.sin(a) * r); }
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = gold ? '#8a7c66' : rc ? rc[1] : '#9a9aa4'; circle(x - 4 * sc, y - 4 * sc, 7 * sc); ctx.fill();
  if (gold) {
    // Goldadern + Funkeln
    ctx.fillStyle = '#f2c94c';
    for (let i = 0; i < 4; i++) { const a = rot * 3 + i * 1.7; circle(x + Math.cos(a) * 8 * sc, y + Math.sin(a) * 7 * sc, (2.4 + (i % 2)) * sc); ctx.fill(); }
    const tw = Math.sin(animT * 4 + v) * 0.5 + 0.5;
    if (tw > 0.7) { ctx.fillStyle = 'rgba(255,250,210,' + ((tw - 0.7) * 3) + ')'; circle(x + 5 * sc, y - 6 * sc, 2.5); ctx.fill(); }
  }
}
function hpBar(x, y, w, frac, col) {
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - w / 2 - 1, y - 1, w + 2, 6);
  ctx.fillStyle = col; ctx.fillRect(x - w / 2, y, w * clamp(frac, 0, 1), 4);
}

function render(dt) {
  animT += dt;
  ui = [];
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  if (R3) {
    // 3D: Welt zeichnet three.js, hier nur noch Overlays + HUD
    ctx.clearRect(0, 0, VW, VH);
    if (!S) return;
    if (!R3.ready) R3.init(ROOT.NW);
    R3.render(dt);
    R3.overlay(ctx);
    drawUI();
    return;
  }
  ctx.fillStyle = '#0b0f0a'; ctx.fillRect(0, 0, VW, VH);
  if (!S) return;
  const t = S.t;
  let sx = 0, sy = 0;
  if (S.shake > 0.2 && mode === 'play') { sx = rand(-1, 1) * S.shake; sy = rand(-1, 1) * S.shake; }
  const cx = Math.round(camX + sx), cy = Math.round(camY + sy);
  ctx.save(); ctx.translate(-cx, -cy);

  // Boden
  const tx0 = Math.max(0, Math.floor(cx / TS)), ty0 = Math.max(0, Math.floor(cy / TS));
  const tx1 = Math.min(MAP - 1, Math.floor((cx + VW) / TS)), ty1 = Math.min(MAP - 1, Math.floor((cy + VH) / TS));
  ctx.fillStyle = '#3d5a32'; ctx.fillRect(0, 0, WORLD, WORLD);
  for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) {
    const i = y * MAP + x, v = S.variant[i], bi = S.biome ? S.biome[i] : 0;
    if (bi >= 2) {
      const pal = GROUND2D[bi];
      ctx.fillStyle = pal[v < 70 ? (v < 30 ? 1 : 2) : 0]; ctx.fillRect(x * TS, y * TS, TS + 0.5, TS + 0.5);
      if (bi === 4 && v % 9 === 0) { ctx.fillStyle = 'rgba(40,70,80,0.75)'; ctx.beginPath(); ctx.ellipse(x * TS + 20, y * TS + 20, 15, 9, v, 0, TAU); ctx.fill(); }
      else if (bi === 5 && v % 7 === 0) { ctx.strokeStyle = 'rgba(190,90,255,' + (0.35 + 0.25 * Math.sin(animT * 2 + v)) + ')'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x * TS + 5, y * TS + 10 + v % 20); ctx.lineTo(x * TS + 20, y * TS + 20); ctx.lineTo(x * TS + 34, y * TS + 6 + v % 30); ctx.stroke(); }
      else if (bi === 3 && v > 240) { ctx.fillStyle = '#ffffff'; circle(x * TS + (v % 7) * 5 + 5, y * TS + (v % 5) * 6 + 8, 2); ctx.fill(); }
      else if (bi === 2 && v > 245) { ctx.fillStyle = '#8a7a50'; circle(x * TS + (v % 7) * 5 + 5, y * TS + (v % 5) * 6 + 8, 2); ctx.fill(); }
      continue;
    }
    if (v < 70) { ctx.fillStyle = v < 30 ? '#38532e' : '#42613a'; ctx.fillRect(x * TS, y * TS, TS, TS); }
    else if (v > 245) { ctx.fillStyle = '#4f6e3c'; circle(x * TS + (v % 7) * 5 + 5, y * TS + (v % 5) * 6 + 8, 2); ctx.fill(); }
  }
  // Portale
  for (const po of S.portal ? [S.portal, S.portal2] : []) {
    if (po.x < cx - 80 || po.x > cx + VW + 80 || po.y < cy - 80 || po.y > cy + VH + 80) continue;
    ctx.save(); ctx.translate(po.x, po.y);
    ctx.fillStyle = '#2a2236'; circle(0, 0, 34); ctx.fill();
    for (let k = 0; k < 3; k++) { ctx.rotate(animT * (1.2 + k * 0.6)); ctx.strokeStyle = ['#b47aff', '#7a3aff', '#e2c4ff'][k]; ctx.lineWidth = 4 - k; ctx.beginPath(); ctx.arc(0, 0, 26 - k * 7, 0, Math.PI * 1.4); ctx.stroke(); }
    ctx.fillStyle = 'rgba(200,150,255,0.8)'; circle(0, 0, 5 + Math.sin(animT * 5) * 2); ctx.fill();
    ctx.restore();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 6; ctx.strokeRect(0, 0, WORLD, WORLD);

  // Bauraster & Bauzone
  if (S.place && mode === 'play') {
    if (S.hq) {
      const hx = (S.hq.tx + 1.5) * TS, hy = (S.hq.ty + 1.5) * TS, R = (buildRange() + 0.5) * TS;
      ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(hx - R, hy - R, 2 * R, 2 * R);
      ctx.strokeStyle = 'rgba(255,230,140,0.35)'; ctx.lineWidth = 2; ctx.setLineDash([10, 8]); ctx.strokeRect(hx - R, hy - R, 2 * R, 2 * R); ctx.setLineDash([]);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1; ctx.beginPath();
    for (let x = tx0; x <= tx1 + 1; x++) { ctx.moveTo(x * TS, ty0 * TS); ctx.lineTo(x * TS, (ty1 + 1) * TS); }
    for (let y = ty0; y <= ty1 + 1; y++) { ctx.moveTo(tx0 * TS, y * TS); ctx.lineTo((tx1 + 1) * TS, y * TS); }
    ctx.stroke();
  }

  // Felsen
  for (let y = ty0 - 1; y <= ty1 + 1; y++) for (let x = tx0 - 1; x <= tx1 + 1; x++) {
    if (!inMap(x, y)) continue;
    const i = y * MAP + x;
    const k = S.res[i];
    if (k === 7) drawScrap((x + 0.5) * TS, (y + 0.5) * TS, S.variant[i], resScale(i), S.wobble.get(i));
    else if (k === 6) drawMountain(x * TS, y * TS, S.variant[i], S.mtn ? S.mtn[i] : 1, S.biome ? S.biome[i] : 0);
    else if (k === 4) drawVoid((x + 0.5) * TS, (y + 0.5) * TS, S.variant[i]);
    else if (k === 5) drawCrystal((x + 0.5) * TS, (y + 0.5) * TS, S.variant[i], resScale(i));
    else if (k >= 2) drawRock((x + 0.5) * TS, (y + 0.5) * TS, S.variant[i], S.wobble.get(i), resScale(i), k === 3, S.biome ? S.biome[i] : 0);
  }
  // Gebäude
  for (const b of S.buildings) {
    const bx = b.tx * TS, by = b.ty * TS, w = b.size * TS;
    if (bx > cx + VW || by > cy + VH || bx + w < cx || by + w < cy) continue;
    ctx.save(); ctx.translate(bx, by);
    drawBuildingShape(b.type, b.lvl, w, b.angle, t + b.id, b.flash > 0);
    ctx.restore();
  }
  // Projektile (bodennah)
  for (const pr of S.projs) {
    if (pr.k === 'bomb') {
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; circle(pr.x, pr.y, 6); ctx.fill();
    }
  }
  // Zombies
  for (const z of S.zombies) {
    if (z.x < cx - 60 || z.y < cy - 60 || z.x > cx + VW + 60 || z.y > cy + VH + 60) continue;
    drawZombie(z);
  }
  // Tiere
  for (const an of S.animals || []) {
    if (an.x < cx - 60 || an.y < cy - 60 || an.x > cx + VW + 60 || an.y > cy + VH + 60) continue;
    drawAnimal(an);
  }
  // Schatztruhen
  for (const c of S.chests) {
    const bob = Math.sin(t * 3 + c.id) * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(c.x + 2, c.y + 12, 15, 5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#7a4a1e'; rr(c.x - 14, c.y - 8 + bob, 28, 18, 3); ctx.fill();
    ctx.fillStyle = '#9a6028'; rr(c.x - 14, c.y - 14 + bob, 28, 9, 4); ctx.fill();
    ctx.fillStyle = '#e6b83a'; ctx.fillRect(c.x - 14, c.y - 6 + bob, 28, 3); ctx.fillRect(c.x - 2.5, c.y - 9 + bob, 5, 8);
    if (Math.sin(animT * 5 + c.id) > 0.6) { ctx.fillStyle = '#fff6c0'; circle(c.x + 9, c.y - 15 + bob, 2.2); ctx.fill(); }
  }
  for (const q of S.players) drawPlayer(q);
  if (S.players.length > 1 || S.player.afk) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = 'bold 11px ' + FONT;
    for (const q of S.players) if (q.dead <= 0) {
      const nm = pName(q) + (q.afk ? ' 💤 AFK' : '');
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillText(nm, q.x + 1, q.y - 35);
      ctx.fillStyle = q === S.player ? '#cfe8ff' : '#ffb0a8'; ctx.fillText(nm, q.x, q.y - 36);
    }
  }
  // Markierungen (G)
  for (const pg of S.pings) {
    const k = (4 - pg.t) % 1, col = pingCol(pg.pid);
    ctx.globalAlpha = clamp(pg.t, 0, 1);
    ctx.strokeStyle = col; ctx.lineWidth = 3;
    circle(pg.x, pg.y, 10 + k * 40); ctx.globalAlpha *= 1 - k; ctx.stroke();
    ctx.globalAlpha = clamp(pg.t, 0, 1);
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(pg.x, pg.y); ctx.lineTo(pg.x - 9, pg.y - 22); ctx.lineTo(pg.x + 9, pg.y - 22); ctx.closePath(); ctx.fill();
    circle(pg.x, pg.y - 26, 9); ctx.fill();
    ctx.fillStyle = '#fff'; circle(pg.x, pg.y - 26, 3.5); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // Projektile
  for (const pr of S.projs) {
    if (pr.k === 'arrow' || pr.k === 'parrow') {
      const a = Math.atan2(pr.vy, pr.vx);
      ctx.save(); ctx.translate(pr.x, pr.y); ctx.rotate(a);
      ctx.fillStyle = pr.k === 'arrow' ? '#cfe8ff' : '#f0e0b0'; ctx.fillRect(-14, -1, 16, 2);
      ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(-1, -3); ctx.lineTo(-1, 3); ctx.fill();
      ctx.fillStyle = '#c04040'; ctx.fillRect(-15, -2.5, 4, 5);
      ctx.restore();
    } else if (pr.k === 'fire') {
      ctx.fillStyle = 'rgba(255,140,40,0.35)'; circle(pr.x, pr.y, 13); ctx.fill();
      ctx.fillStyle = '#ffb347'; circle(pr.x, pr.y, 7); ctx.fill();
      ctx.fillStyle = '#fff3c0'; circle(pr.x, pr.y, 3); ctx.fill();
    } else if (pr.k === 'ball') {
      ctx.fillStyle = '#1a1a1a'; circle(pr.x, pr.y, 6); ctx.fill();
      ctx.fillStyle = '#555'; circle(pr.x - 2, pr.y - 2, 2); ctx.fill();
    } else if (pr.k === 'bomb') {
      const y = pr.y - pr.h, s = 7 + pr.h / 25;
      ctx.fillStyle = '#222'; circle(pr.x, y, s); ctx.fill();
      ctx.fillStyle = '#ff7a3a'; circle(pr.x + s * 0.6, y - s * 0.6, 2.5 + Math.sin(t * 30)); ctx.fill();
    } else if (pr.k === 'glob') {
      ctx.fillStyle = '#7fe0a0'; circle(pr.x, pr.y, pr.r); ctx.fill();
      ctx.fillStyle = '#cfffe0'; circle(pr.x - 2, pr.y - 2, 2); ctx.fill();
    }
  }
  // Bäume (über allem, was am Boden ist)
  for (let y = ty0 - 1; y <= ty1 + 1; y++) for (let x = tx0 - 1; x <= tx1 + 1; x++) {
    if (!inMap(x, y)) continue;
    const i = y * MAP + x;
    if (S.res[i] === 1) drawTree((x + 0.5) * TS, (y + 0.5) * TS, S.variant[i], S.wobble.get(i), resScale(i), S.biome ? S.biome[i] : 0);
  }
  // Partikel
  for (const q of S.parts) {
    ctx.globalAlpha = clamp(q.life / q.max, 0, 1);
    ctx.fillStyle = q.color; ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size);
  }
  ctx.globalAlpha = 1;
  // Ringe
  for (const r of S.rings) {
    ctx.globalAlpha = clamp(r.life / r.maxLife, 0, 1);
    ctx.strokeStyle = r.color; ctx.lineWidth = 3; circle(r.x, r.y, r.r); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Blitze
  for (const b of S.bolts) {
    ctx.globalAlpha = clamp(b.life / b.max, 0, 1);
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? '#ffffff' : b.color; ctx.lineWidth = pass ? 1.5 : 5;
      ctx.beginPath();
      for (let i = 0; i < b.pts.length - 1; i++) {
        const [ax, ay] = b.pts[i], [bx, by] = b.pts[i + 1];
        if (i === 0) ctx.moveTo(ax, ay);
        for (let s = 1; s <= 4; s++) {
          const f = s / 4, j = s === 4 ? 0 : Math.sin(b.seed + i * 7 + s * 3 + animT * 60) * 10;
          ctx.lineTo(lerp(ax, bx, f) + j, lerp(ay, by, f) - j);
        }
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  // HP-Balken
  for (const z of S.zombies) {
    if (z.hp < z.maxHp && z.x > cx - 40 && z.y > cy - 40 && z.x < cx + VW + 40 && z.y < cy + VH + 40)
      hpBar(z.x, z.y - z.r - 10, z.type === 'boss' ? 70 : Math.max(24, z.r * 2), z.hp / z.maxHp, z.type === 'boss' ? '#d87bff' : '#e74c3c');
  }
  for (const b of S.buildings) {
    if (b.hp < b.maxHp) { const c = bCenter(b); hpBar(c.x, b.ty * TS - 4, Math.max(30, b.size * TS - 10), b.hp / b.maxHp, b.type === 'hq' ? '#f2c94c' : '#5fd068'); }
  }
  const p = S.player;
  for (const q of S.players) if (q.dead <= 0 && q.hp < q.maxHp) hpBar(q.x, q.y - 26, 34, q.hp / q.maxHp, q === p ? '#4fc3f7' : '#ff8a80');
  // Texte
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const tx of S.texts) {
    ctx.globalAlpha = clamp(tx.life / tx.max * 1.5, 0, 1);
    ctx.font = 'bold ' + tx.size + 'px ' + FONT;
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillText(tx.text, tx.x + 1, tx.y + 1);
    ctx.fillStyle = tx.color; ctx.fillText(tx.text, tx.x, tx.y);
  }
  ctx.globalAlpha = 1;

  // Auswahl & Platzierungsvorschau
  if (S.sel && !S.sel.dead) {
    const b = S.sel, c = bCenter(b), d = BDEF[b.type];
    ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 2; ctx.strokeRect(b.tx * TS - 2, b.ty * TS - 2, b.size * TS + 4, b.size * TS + 4);
    if (d.range) { ctx.fillStyle = 'rgba(255,230,140,0.06)'; circle(c.x, c.y, d.range[b.lvl - 1] * TS); ctx.fill(); ctx.strokeStyle = 'rgba(255,230,140,0.4)'; ctx.stroke(); }
    if (d.radius) { ctx.strokeStyle = 'rgba(160,255,140,0.4)'; circle(c.x, c.y, d.radius[b.lvl - 1] * TS); ctx.stroke(); }
  }
  if (S.place && mode === 'play' && !hoverSlot) {
    const a = aimPoint(), fp = footprintAt(S.place, a.x, a.y), d = BDEF[S.place];
    const err = placeError(S.place, fp.tx, fp.ty), w = fp.size * TS;
    ctx.save(); ctx.translate(fp.tx * TS, fp.ty * TS); ctx.globalAlpha = 0.6;
    drawBuildingShape(S.place, 1, w, -Math.PI / 2, t, false);
    ctx.globalAlpha = 1;
    ctx.fillStyle = err ? 'rgba(255,60,60,0.35)' : 'rgba(80,255,120,0.25)'; ctx.fillRect(0, 0, w, w);
    ctx.strokeStyle = err ? '#ff5050' : '#60ff90'; ctx.lineWidth = 2; ctx.strokeRect(0, 0, w, w);
    ctx.restore();
    if (d.range) { ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5; circle(fp.tx * TS + w / 2, fp.ty * TS + w / 2, d.range[0] * TS); ctx.stroke(); }
    if (d.radius) { ctx.strokeStyle = 'rgba(160,255,140,0.45)'; ctx.lineWidth = 1.5; circle(fp.tx * TS + w / 2, fp.ty * TS + w / 2, d.radius[0] * TS); ctx.stroke(); }
  }
  ctx.restore();

  drawLighting(cx, cy);
  drawWeather2D();
  drawUI();
}
function drawWeather2D() {
  if (!S.weather && biomeAtW(S.player.x, S.player.y) !== 5) return;
  const bi = biomeAtW(S.player.x, S.player.y), t = animT;
  if (bi === 5) {   // Schattenreich: aufsteigende Funken
    for (let i = 0; i < 60; i++) {
      const x = (i * 137.5 + Math.sin(i + t * 0.5) * 40) % VW, y = VH - ((i * 53 + t * (30 + i % 20)) % (VH + 20));
      ctx.fillStyle = 'rgba(190,110,255,' + (0.35 + 0.3 * Math.sin(t * 3 + i)) + ')'; circle(x, y, 1.5 + i % 3); ctx.fill();
    }
  }
  if (S.weather && bi !== 2 && bi !== 5) {
    const n = S.weather === 2 ? 260 : 160;
    if (bi === 3) {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      for (let i = 0; i < n; i++) { const x = ((i * 137.5 + Math.sin(t + i) * 30 - t * 40) % VW + VW) % VW, y = ((i * 97 + t * (60 + i % 40)) % (VH + 20)) - 10; circle(x, y, 1.5 + i % 3); ctx.fill(); }
    } else {
      ctx.strokeStyle = 'rgba(180,200,230,0.35)'; ctx.lineWidth = 1.2; ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const sx = (i * 137.5 + Math.sin(i) * 50) % VW, sp = 700 + (i % 7) * 60;
        const y = ((i * 97 + t * sp) % (VH + 40)) - 20, x = (sx - t * 120 + VW * 4) % VW;
        ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 14);
      }
      ctx.stroke();
    }
  }
  for (const s of S.strikes) {
    const a = clamp(s.life / 0.45, 0, 1), x = s.x - camX, y = s.y - camY;
    ctx.fillStyle = 'rgba(230,240,255,' + 0.35 * a + ')'; ctx.fillRect(0, 0, VW, VH);
    ctx.strokeStyle = 'rgba(240,245,255,' + a + ')'; ctx.lineWidth = 3; ctx.beginPath();
    let px = x + Math.sin(s.seed) * 60, py = -10;
    ctx.moveTo(px, py);
    for (let k = 1; k <= 8; k++) { const f = k / 8; px = lerp(px, x, 0.35) + Math.sin(s.seed + k * 2.3) * 22 * (1 - f); py = lerp(-10, y, f); ctx.lineTo(px, py); }
    ctx.stroke();
  }
}
// HUD & Menüs in "logischen" Koordinaten zeichnen (auf dem Handy verkleinert)
function drawUI() {
  const rw = VW, rh = VH, sx = input.sx, sy = input.sy;
  if (uiS !== 1) { ctx.save(); ctx.scale(uiS, uiS); VW = rw / uiS; VH = rh / uiS; input.sx = sx / uiS; input.sy = sy / uiS; }
  try {
    drawHUD();
    drawOverlays();
    if (isTouch && rh > rw * 1.05) {
      ctx.fillStyle = 'rgba(5,8,12,0.88)'; ctx.fillRect(0, 0, VW, VH);
      text('📱 ↻', VW / 2, VH * 0.4, 60, '#ffd36b', 'center');
      text('Bitte dreh dein Handy quer', VW / 2, VH * 0.4 + 70, 28, '#fff', 'center');
      text('Das Spiel ist für das Querformat gemacht.', VW / 2, VH * 0.4 + 110, 18, '#bbb', 'center', '600');
    }
  } finally {
    if (uiS !== 1) { ctx.restore(); VW = rw; VH = rh; input.sx = sx; input.sy = sy; }
  }
}
// Touch-Bedienelemente (Joystick + Knöpfe)
function drawTouchUI() {
  if (!isTouch || mode !== 'play') return;
  // Zwei Joysticks: links laufen, rechts zielen & angreifen
  const H = joyHomes(), R = JOY_R / uiS;
  const stick = (bx, by, kx, ky, active, label, icon, colr) => {
    ctx.globalAlpha = active ? 0.95 : 0.6;
    const gr = ctx.createRadialGradient(bx, by, R * 0.2, bx, by, R);
    gr.addColorStop(0, 'rgba(255,255,255,0.04)'); gr.addColorStop(1, 'rgba(255,255,255,0.16)');
    ctx.fillStyle = gr; circle(bx, by, R); ctx.fill();
    ctx.strokeStyle = active ? colr : 'rgba(255,255,255,0.45)'; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; circle(bx, by, R * 0.45); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; circle(kx + 2, ky + 3, R * 0.42); ctx.fill();
    ctx.fillStyle = active ? colr : 'rgba(230,230,230,0.75)'; circle(kx, ky, R * 0.42); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5; ctx.stroke();
    text(icon, kx, ky + 1, R * 0.38, active ? '#2a2010' : '#333', 'center');
    if (!active) text(label, bx, by + R + 14, 12, '#fff', 'center', '600');
    ctx.globalAlpha = 1;
  };
  if (touch.joyId !== null) stick(touch.jx / uiS, touch.jy / uiS, touch.kx / uiS, touch.ky / uiS, true, '', '➤', '#ffe27a');
  else stick(H.lx / uiS, H.ly / uiS, H.lx / uiS, H.ly / uiS, false, 'Laufen', '➤', '#ffe27a');
  const atkCol = S.place ? '#7fd8ff' : '#ff8a6a';
  if (touch.aimId !== null) stick(touch.ax / uiS, touch.ay / uiS, touch.akx / uiS, touch.aky / uiS, true, '', '⚔', atkCol);
  else if (!S.place) stick(H.rx / uiS, H.ry / uiS, H.rx / uiS, H.ry / uiS, false, 'Zielen & angreifen', '⚔', atkCol);
  // Knöpfe am rechten Rand
  const btns = [
    ['⤒', 'Springen', () => jump()],
    ['☰', 'Menü', () => { mode = 'paused'; }],
    ['🗺', 'Karte', () => { mapOpen = !mapOpen; }],
    ['★', 'Skills', () => { skillsOpen = !skillsOpen; forgeOpen = false; }],
    ['⚒', 'Schmiede', () => { forgeOpen = !forgeOpen; skillsOpen = false; }],
    ['⚡', 'Fähigkeit', () => actAbility()],
    ...(R3 ? [['🔄', 'Drehen', () => R3.rotate(Math.PI / 2)]] : []),
    ['⛶', 'Vollbild', () => toggleFullscreen()],
    ...(S.players.length > 1 ? [['👥', 'Spieler', () => { listOpen = !listOpen; }]] : []),
    ['💬', 'Chat', () => chatOpen()],
    ['📍', 'Markieren', () => { touch.pingMode = !touch.pingMode; if (touch.pingMode) toast('Tippe auf die Stelle, die du markieren willst', '#7fd8ff'); }],
  ];
  if (S.place && S.hq) btns.push(['✖', 'Bauen aus', () => { S.place = null; }]);
  if (S.sel && !S.sel.dead) btns.push(['✖', 'Schließen', () => { S.sel = null; }]);
  const bs = 50, y0 = S.hq ? 70 : 14, maxY = VH - mmSize() - 30;
  const perCol = Math.max(3, Math.floor((maxY - y0) / (bs + 10)));
  btns.forEach((b, i) => {
    const col = Math.floor(i / perCol), x = VW - bs - 12 - col * (bs + 10), y = y0 + (i % perCol) * (bs + 10);
    const on = (b[1] === 'Markieren' && touch.pingMode) || (b[1] === 'Karte' && mapOpen) || (b[1] === 'Skills' && skillsOpen) || (b[1] === 'Schmiede' && forgeOpen) || (b[1] === 'Spieler' && listOpen);
    if (b[1] === 'Fähigkeit' && S.player.abCd > 0) { ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.moveTo(x + bs / 2, y + bs / 2); ctx.arc(x + bs / 2, y + bs / 2, bs / 2, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(S.player.abCd / ((ABIL.find(a => a.id === S.player.ab) || { cd: 1 }).cd), 0, 1)); ctx.fill(); ctx.restore(); }
    ctx.fillStyle = on ? 'rgba(255,226,122,0.45)' : 'rgba(12,16,22,0.7)'; circle(x + bs / 2, y + bs / 2, bs / 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1.5; ctx.stroke();
    text(b[0], x + bs / 2, y + bs / 2 + 1, 22, '#fff', 'center');
    if (b[1] === 'Skills' && S.player.sp > 0) { ctx.fillStyle = '#ff5b5b'; circle(x + bs - 6, y + 8, 9); ctx.fill(); text(String(S.player.sp), x + bs - 6, y + 8, 11, '#fff', 'center'); }
    ui.push({ x, y, w: bs, h: bs, fn: b[2] });
  });
}

function drawLighting(cx, cy) {
  const dk = darkness();
  if (dk <= 0.01) return;
  const W2 = lightC.width, H2 = lightC.height;
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.globalCompositeOperation = 'source-over';
  lctx.clearRect(0, 0, W2, H2);
  const shadowRealm = S.biome && S.biome[tileAt(S.player.x, S.player.y)] === 5;
  lctx.fillStyle = (S.bloodMoon ? 'rgba(46,4,10,' : shadowRealm ? 'rgba(30,6,48,' : 'rgba(6,10,32,') + dk + ')';
  lctx.fillRect(0, 0, W2, H2);
  lctx.globalCompositeOperation = 'destination-out';
  const light = (x, y, r, a) => {
    const sx = (x - cx) / 2, sy = (y - cy) / 2, sr = r / 2;
    if (sx + sr < 0 || sy + sr < 0 || sx - sr > W2 || sy - sr > H2) return;
    lctx.globalAlpha = a; lctx.drawImage(lightSprite, sx - sr, sy - sr, sr * 2, sr * 2);
  };
  const flick = 1 + Math.sin(animT * 13) * 0.03 + Math.sin(animT * 7.3) * 0.03;
  const p = S.player;
  for (const q of S.players) if (q.dead <= 0) light(q.x, q.y, 230 * flick, 1);
  for (const b of S.buildings) {
    const c = bCenter(b);
    if (b.type === 'hq') light(c.x, c.y, 330 * flick, 1);
    else if (TOWERS[b.type]) light(c.x, c.y, 170 * flick, 0.9);
    else if (b.type === 'mine' || b.type === 'harv') light(c.x, c.y, 110, 0.7);
    else if (b.type === 'heal') light(c.x, c.y, 150 * flick, 0.85);
    else if (b.type === 'frost') light(c.x, c.y, 140 * flick, 0.8);
  }
  for (const c of S.chests) light(c.x, c.y, 90, 0.8);
  if (S.portal) { light(S.portal.x, S.portal.y, 200 * flick, 1); light(S.portal2.x, S.portal2.y, 220 * flick, 1); }
  for (const pg of S.pings) light(pg.x, pg.y, 120, 0.7);
  for (const f of S.flashes) light(f.x, f.y, f.r, clamp(f.life / f.max, 0, 1));
  for (const pr of S.projs) if (pr.k === 'bomb' || pr.k === 'glob') light(pr.x, pr.y - (pr.h || 0), 50, 0.6);
  lctx.globalAlpha = 1;
  ctx.drawImage(lightC, 0, 0, VW, VH);
  // warmer Fackelschein
  ctx.globalCompositeOperation = 'lighter';
  const warm = (x, y, r, a) => {
    const sx = x - cx, sy = y - cy;
    if (sx + r < 0 || sy + r < 0 || sx - r > VW || sy - r > VH) return;
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
    g.addColorStop(0, 'rgba(255,170,80,' + a + ')'); g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g; ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
  };
  if (S.hq) { const c = bCenter(S.hq); warm(c.x, c.y, 200 * flick, 0.12 * dk); }
  for (const b of S.buildings) if (TOWERS[b.type]) { const c = bCenter(b); warm(c.x, c.y, 90 * flick, 0.1 * dk); }
  ctx.globalCompositeOperation = 'source-over';
}

// ---------- HUD
function panel(x, y, w, h, a) {
  ctx.fillStyle = 'rgba(20,17,15,' + (a || 0.74) + ')'; rr(x, y, w, h, 6); ctx.fill();
  ctx.strokeStyle = 'rgba(200,110,50,0.38)'; ctx.lineWidth = 1.2; ctx.stroke();
  if (w > 110 && h > 50) {
    ctx.fillStyle = 'rgba(160,90,50,0.6)';
    for (const [px, py] of [[x + 6, y + 6], [x + w - 6, y + 6], [x + 6, y + h - 6], [x + w - 6, y + h - 6]]) { ctx.beginPath(); ctx.arc(px, py, 1.8, 0, TAU); ctx.fill(); }
  }
}
function titleText(s, x, y, size, color, align) {
  ctx.font = size + 'px ' + FONT_T; ctx.textAlign = align || 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillText(s, x + 3, y + 4);
  ctx.fillStyle = color; ctx.fillText(s, x, y);
}
// ---------- BLACKOUT-Logo: rostige Buchstaben mit Glut im Inneren
let logoCache = null;
if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) document.fonts.ready.then(() => { logoCache = null; });
function makeLogo(size) {
  const word = 'BLACKOUT', pad = size * 0.35;
  const m = document.createElement('canvas').getContext('2d');
  m.font = size + 'px ' + FONT_T;
  const tw = Math.ceil(m.measureText(word).width);
  const W = tw + pad * 2, H = Math.ceil(size * 1.5);
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const mask = mk(), mc = mask.getContext('2d');
  mc.font = size + 'px ' + FONT_T; mc.textAlign = 'center'; mc.textBaseline = 'middle';
  mc.fillStyle = '#fff'; mc.fillText(word, W / 2, H / 2);
  // Rost-Metall
  const base = mk(), b = base.getContext('2d');
  b.drawImage(mask, 0, 0);
  b.globalCompositeOperation = 'source-in';
  const gr = b.createLinearGradient(0, H * 0.15, 0, H * 0.85);
  gr.addColorStop(0, '#9a928a'); gr.addColorStop(0.35, '#6a5a50'); gr.addColorStop(0.7, '#4a3228'); gr.addColorStop(1, '#2a1a14');
  b.fillStyle = gr; b.fillRect(0, 0, W, H);
  b.globalCompositeOperation = 'source-atop';
  let sd = 7;
  const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
  for (let i = 0; i < W * H / 55; i++) {
    const x = rnd() * W, y = rnd() * H, r = rnd(), s = 1 + rnd() * size * 0.025;
    b.fillStyle = r < 0.35 ? 'rgba(140,60,20,0.55)' : r < 0.6 ? 'rgba(30,20,16,0.6)' : r < 0.8 ? 'rgba(190,110,60,0.35)' : 'rgba(200,200,200,0.18)';
    b.fillRect(x | 0, y | 0, s, s);
  }
  for (let i = 0; i < 14; i++) {   // Kratzer
    b.strokeStyle = 'rgba(220,210,200,' + (0.15 + rnd() * 0.25) + ')'; b.lineWidth = 1 + rnd();
    const x = rnd() * W, y = rnd() * H; b.beginPath(); b.moveTo(x, y); b.lineTo(x + (rnd() - 0.5) * size * 0.8, y + (rnd() - 0.5) * size * 0.3); b.stroke();
  }
  for (let i = 0; i < 26; i++) {   // Löcher / Durchbrüche
    const x = pad + rnd() * tw, y = H * 0.3 + rnd() * H * 0.45;
    b.fillStyle = 'rgba(10,6,4,0.85)'; b.beginPath(); b.arc(x, y, 1.5 + rnd() * size * 0.05, 0, TAU); b.fill();
  }
  b.globalCompositeOperation = 'source-over';
  // Rand + Glanzkante
  const edge = mk(), e = edge.getContext('2d');
  e.font = size + 'px ' + FONT_T; e.textAlign = 'center'; e.textBaseline = 'middle';
  e.lineJoin = 'round';
  e.strokeStyle = '#120a06'; e.lineWidth = Math.max(3, size * 0.06); e.strokeText(word, W / 2, H / 2);
  e.strokeStyle = 'rgba(255,180,120,0.25)'; e.lineWidth = Math.max(1, size * 0.015); e.strokeText(word, W / 2 - 1, H / 2 - 1);
  const shadow = mk(), sh = shadow.getContext('2d');
  sh.drawImage(mask, 0, 0); sh.globalCompositeOperation = 'source-in'; sh.fillStyle = '#000'; sh.fillRect(0, 0, W, H);
  return { size, W, H, mask, base, edge, shadow, fire: mk() };
}
function drawLogo(cx, cy, size) {
  if (!logoCache || logoCache.size !== size) logoCache = makeLogo(size);
  const L = logoCache, x = cx - L.W / 2, y = cy - L.H / 2;
  // Glut im Inneren (animiert, nur innerhalb der Buchstaben)
  const f = L.fire.getContext('2d');
  f.globalCompositeOperation = 'source-over'; f.clearRect(0, 0, L.W, L.H);
  const n = 11;
  for (let i = 0; i < n; i++) {
    const fx = L.W * (0.12 + 0.76 * i / (n - 1)) + Math.sin(animT * 1.3 + i * 2.1) * size * 0.08;
    const fh = L.H * (0.5 + 0.2 * Math.sin(animT * 3.1 + i * 1.7) + 0.08 * Math.sin(animT * 7.3 + i));
    const gr = f.createRadialGradient(fx, L.H * 0.8, 2, fx, L.H * 0.8, fh);
    gr.addColorStop(0, 'rgba(255,230,120,0.95)'); gr.addColorStop(0.35, 'rgba(255,140,30,0.8)'); gr.addColorStop(0.7, 'rgba(200,50,10,0.45)'); gr.addColorStop(1, 'rgba(120,20,0,0)');
    f.fillStyle = gr; f.fillRect(0, 0, L.W, L.H);
  }
  f.globalCompositeOperation = 'destination-in'; f.drawImage(L.mask, 0, 0); f.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.globalAlpha = 0.7; ctx.drawImage(L.shadow, x + size * 0.05, y + size * 0.07); ctx.globalAlpha = 1;
  ctx.shadowColor = 'rgba(255,90,20,' + (0.55 + 0.2 * Math.sin(animT * 4)) + ')'; ctx.shadowBlur = size * 0.35;
  ctx.drawImage(L.edge, x, y);
  ctx.shadowBlur = 0;
  ctx.drawImage(L.base, x, y);
  ctx.globalAlpha = 0.72 + 0.12 * Math.sin(animT * 5);
  ctx.globalCompositeOperation = 'lighter';
  ctx.drawImage(L.fire, x, y);
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  ctx.restore();
}
// Glut, Asche und Kratzer im Hintergrund des Menüs
const embers = [];
function drawMenuFx() {
  const g = ctx.createRadialGradient(VW / 2, VH * 0.35, 40, VW / 2, VH * 0.45, Math.max(VW, VH) * 0.75);
  g.addColorStop(0, 'rgba(40,36,34,0.55)'); g.addColorStop(0.6, 'rgba(14,12,12,0.82)'); g.addColorStop(1, 'rgba(0,0,0,0.96)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
  // Pixel-Raster wie auf dem Logo
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  for (let y = 0; y < VH * 0.55; y += 6) for (let x = (y / 6 % 2) * 3; x < VW; x += 6) { const d = Math.hypot(x - VW / 2, (y - VH * 0.12) * 1.6) / (VW * 0.45); if (d < 1 && ((x * 7 + y * 13) % 11) / 11 > d) ctx.fillRect(x, y, 2, 2); }
  ctx.strokeStyle = 'rgba(200,200,200,0.08)'; ctx.lineWidth = 1.5;
  for (let i = 0; i < 12; i++) { const x = ((i * 397) % 1000) / 1000 * VW, y = ((i * 613) % 1000) / 1000 * VH, l = 30 + (i * 37) % 70; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + l, y - l * 0.6); ctx.stroke(); }
  if (embers.length < 70) embers.push({ x: Math.random() * VW, y: VH + 10, v: 20 + Math.random() * 50, s: 1 + Math.random() * 2.5, ph: Math.random() * 9, ash: Math.random() < 0.35 });
  for (const e of embers) {
    e.y -= e.v / 60; e.x += Math.sin(animT * 1.3 + e.ph) * 0.4;
    ctx.fillStyle = e.ash ? 'rgba(160,150,140,0.35)' : 'rgba(255,' + (120 + (e.ph * 20 | 0) % 80) + ',40,' + (0.4 + 0.4 * Math.sin(animT * 4 + e.ph)) + ')';
    ctx.fillRect(e.x, e.y, e.s, e.s);
    if (e.y < -10) { e.y = VH + 10; e.x = Math.random() * VW; }
  }
}
function text(s, x, y, size, color, align, weight) {
  ctx.font = (weight || 'bold') + ' ' + size + 'px ' + FONT;
  ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(s, x + 1, y + 1.5);
  ctx.fillStyle = color; ctx.fillText(s, x, y);
}
function resIcon(kind, x, y) {
  if (kind === 'w') { ctx.fillStyle = '#8a5a2a'; rr(x - 8, y - 5, 16, 10, 3); ctx.fill(); ctx.fillStyle = '#c89a5a'; circle(x + 7, y, 4.5); ctx.fill(); ctx.fillStyle = '#8a5a2a'; circle(x + 7, y, 1.8); ctx.fill(); }
  else if (kind === 's') { ctx.fillStyle = '#9a9aa4'; ctx.beginPath(); ctx.moveTo(x - 8, y + 6); ctx.lineTo(x - 5, y - 5); ctx.lineTo(x + 3, y - 7); ctx.lineTo(x + 8, y + 1); ctx.lineTo(x + 5, y + 6); ctx.closePath(); ctx.fill(); }
  else if (kind === 'i') { ctx.fillStyle = '#8a929e'; ctx.beginPath(); ctx.moveTo(x - 9, y + 5); ctx.lineTo(x - 5, y - 4); ctx.lineTo(x + 9, y - 4); ctx.lineTo(x + 5, y + 5); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#c8d0dc'; ctx.fillRect(x - 4, y - 3, 11, 2); }
  else { ctx.fillStyle = '#f2c94c'; circle(x, y, 7); ctx.fill(); ctx.strokeStyle = '#a67c1c'; ctx.lineWidth = 1.5; ctx.stroke(); }
}
function goldRate() {
  let r = 0;
  for (const b of S.buildings) if (b.type === 'hq' || b.type === 'mine') r += BDEF[b.type].gold[b.lvl - 1];
  return r;
}
function drawHUD() {
  if (mode === 'menu') return;
  const p = S.player;
  // Ressourcen
  panel(12, 12, 200, 144);
  const rows = [['w', 'Holz', S.wood, '#e0b070'], ['s', 'Stein', S.stone, '#d0d0e0'], ['g', 'Gold', S.gold, '#ffd36b'], ['i', 'Eisen', S.iron || 0, '#c8d0dc']];
  rows.forEach((r, i) => {
    const y = 32 + i * 26;
    resIcon(r[0], 32, y);
    text(r[1], 48, y, 14, '#c8c8c8', 'left', '600');
    text(String(Math.floor(r[2])), 196, y, 18, r[3], 'right');
  });
  text('+' + goldRate().toFixed(1) + ' Gold/s', 48, 136, 12, '#b8a060', 'left', '600');
  text('☠ ' + S.kills, 196, 136, 12, '#ff9a9a', 'right', '600');

  // Phase & Countdown
  const pw = 300; const px = VW / 2 - pw / 2;
  panel(px, 10, pw, 62);
  if (!S.started) {
    text('Platziere deinen Reaktor', VW / 2, 32, 18, '#ffd36b', 'center');
    text('Taste 9 · Linksklick zum Bauen', VW / 2, 55, 13, '#aaa', 'center', '600');
  } else if (S.phase === 'day') {
    text('☀ TAG ' + S.night, VW / 2, 30, 20, '#ffe27a', 'center');
    const urgent = S.phaseT < 15;
    text('Nacht ' + S.night + ' beginnt in ' + fmtTime(S.phaseT), VW / 2, 54, 14, urgent ? (Math.sin(animT * 8) > 0 ? '#ff7b6b' : '#ffb0a0') : '#cfcfcf', 'center', '600');
  } else {
    text(S.bloodMoon ? '🩸 BLUTMOND · NACHT ' + S.night : '☾ NACHT ' + S.night, VW / 2, 30, 20, S.bloodMoon ? '#ff3a3a' : '#ff6b6b', 'center');
    const left = S.zombies.length + (S.isClient ? S.qLen : S.spawnQueue.length);
    text('Morgengrauen in ' + fmtTime(S.phaseT) + '  ·  Zombies: ' + left, VW / 2, 54, 14, '#cfcfcf', 'center', '600');
  }
  // Phasen-Fortschritt
  if (S.started) {
    const f = S.phase === 'day' ? 1 - S.phaseT / DAY_LEN : 1 - S.phaseT / NIGHT_LEN;
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(px + 10, 66, pw - 20, 3);
    ctx.fillStyle = S.phase === 'day' ? '#ffe27a' : '#ff6b6b'; ctx.fillRect(px + 10, 66, (pw - 20) * f, 3);
  }
  // Reaktor-HP
  if (S.hq) {
    const narrow = VW / 2 + pw / 2 + 240 > VW;
    const hx = narrow ? 12 : VW - 232, hy = narrow ? 138 : 12, hw = narrow ? 200 : 220;
    panel(hx, hy, hw, 46);
    text('Reaktor  Stufe ' + S.hq.lvl, hx + 10, hy + 15, 13, '#ffd36b', 'left');
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(hx + 10, hy + 26, hw - 20, 10);
    const f = S.hq.hp / S.hq.maxHp;
    ctx.fillStyle = f > 0.5 ? '#f2c94c' : f > 0.25 ? '#ff9a3a' : '#ff4a3a'; ctx.fillRect(hx + 10, hy + 26, (hw - 20) * f, 10);
  }

  // Werkzeug- & Bauleiste
  const slots = [];
  TOOL_ORDER.forEach(k => { if (p.tl[k] > 0) slots.push({ kind: 'tool', id: k }); });
  slots.push({ kind: 'forge', id: 'forge' });
  const nTool = slots.length;
  BAR_ORDER.forEach(([k, key]) => { if (k !== 'hq' || !S.hq) slots.push({ kind: 'build', id: k, key }); });
  const mmS = mmSize(), gap = 5;
  const areaR = VW - mmS - 28, areaL = VW > 1100 ? mmS + 28 : 12;
  const SW = Math.floor(clamp((areaR - areaL - 14) / slots.length - gap, 30, 50));
  const totalW = slots.length * (SW + gap) + 14;
  let x = clamp(VW / 2 - totalW / 2, 12, Math.max(12, areaR - totalW));
  const y = VH - SW - 14;
  hoverSlot = null;
  // Spieler-HP
  const hbw = 260;
  panel(VW / 2 - hbw / 2 - 6, y - 34, hbw + 12, 26);
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(VW / 2 - hbw / 2, y - 27, hbw, 12);
  if (p.dead > 0) {
    text('Respawn in ' + p.dead.toFixed(1) + ' s', VW / 2, y - 21, 13, '#ff9a9a', 'center');
  } else {
    const f = p.hp / p.maxHp;
    ctx.fillStyle = f > 0.5 ? '#4fc3f7' : f > 0.25 ? '#ffb74d' : '#ef5350'; ctx.fillRect(VW / 2 - hbw / 2, y - 27, hbw * f, 12);
    text('HP ' + Math.ceil(p.hp) + ' / ' + p.maxHp, VW / 2, y - 21, 11, '#fff', 'center');
  }
  // Level & XP
  const need = xpNeed(p.lvl);
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(VW / 2 - hbw / 2, y - 13, hbw, 4);
  ctx.fillStyle = '#ffd36b'; ctx.fillRect(VW / 2 - hbw / 2, y - 13, hbw * clamp(p.xp / need, 0, 1), 4);
  const lx = VW / 2 - hbw / 2 - 74;
  panel(lx, y - 34, 62, 26);
  text('Lv ' + p.lvl, lx + 31, y - 21, 14, '#ffe27a', 'center');
  {
    const A = ABIL.find(a => a.id === p.ab), ax = lx - 46, ay = y - 40, as = 38;
    ctx.fillStyle = A && !(p.abCd > 0) ? 'rgba(255,200,60,0.35)' : 'rgba(12,16,22,0.72)'; rr(ax, ay, as, as, 8); ctx.fill();
    ctx.strokeStyle = A ? '#ffd36b' : 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1.5; ctx.stroke();
    if (A) {
      text(A.icon, ax + as / 2, ay + as / 2 + 1, 20, '#fff', 'center');
      if (p.abCd > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(ax, ay, as, as * clamp(p.abCd / A.cd, 0, 1));
        text(Math.ceil(p.abCd) + '', ax + as / 2, ay + as / 2 + 1, 15, '#fff', 'center');
      }
      if (!isTouch) text('Shift', ax + as / 2, ay + as + 7, 9, '#aaa', 'center', '600');
    } else text(p.lvl >= ABIL_LVL ? '⚡?' : '🔒', ax + as / 2, ay + as / 2 + 1, p.lvl >= ABIL_LVL ? 14 : 16, p.lvl >= ABIL_LVL && Math.sin(animT * 6) > 0 ? '#ffe27a' : '#888', 'center');
    ui.push({ x: ax, y: ay, w: as, h: as, fn: () => { if (A) actAbility(); else { skillsOpen = true; forgeOpen = false; } } });
    if (p.rageT > 0) text('🔥 ' + Math.ceil(p.rageT) + ' s', VW / 2, y - 48, 13, '#ff8a5a', 'center');
  }
  const bx = VW / 2 + hbw / 2 + 12, bw = 104, glow = p.sp > 0 && Math.sin(animT * 6) > 0;
  ctx.fillStyle = skillsOpen ? 'rgba(255,226,122,0.35)' : glow ? 'rgba(255,200,60,0.55)' : 'rgba(12,16,22,0.72)';
  rr(bx, y - 34, bw, 26, 8); ctx.fill();
  ctx.strokeStyle = p.sp > 0 ? '#ffd36b' : 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1; ctx.stroke();
  text(p.sp > 0 ? 'Skills (K) +' + p.sp : 'Skills (K)', bx + bw / 2, y - 21, 12, p.sp > 0 ? '#fff6c0' : '#ccc', 'center');
  ui.push({ x: bx, y: y - 34, w: bw, h: 26, fn: () => { skillsOpen = !skillsOpen; } });
  ui.push({ x: lx, y: y - 34, w: 62, h: 26, fn: () => { skillsOpen = !skillsOpen; } });
  panel(x - 4, y - 4, totalW + 8, SW + 8);
  slots.forEach((s, i) => {
    if (i === nTool) x += 14;
    const sel = s.kind === 'forge' ? forgeOpen : s.kind === 'tool' ? (!S.place && p.tool === s.id) : S.place === s.id;
    const hov = input.sx >= x && input.sx <= x + SW && input.sy >= y && input.sy <= y + SW;
    if (hov) hoverSlot = { s, x, y };
    let afford = true;
    if (s.kind === 'build') afford = canAfford(costFor(s.id, 1)) && (s.id === 'hq' || (S.counts[s.id] || 0) < BDEF[s.id].max) && (s.id === 'hq' || !!S.hq);
    ctx.fillStyle = sel ? 'rgba(255,226,122,0.28)' : hov ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.05)';
    rr(x, y, SW, SW, 6); ctx.fill();
    ctx.strokeStyle = sel ? '#ffe27a' : 'rgba(255,255,255,0.15)'; ctx.lineWidth = sel ? 2 : 1; ctx.stroke();
    ctx.save();
    if (!afford) ctx.globalAlpha = 0.35;
    if (s.kind === 'tool') drawToolIcon(s.id, x + SW / 2, y + SW / 2, SW, toolMet(p, s.id));
    else if (s.kind === 'forge') drawToolIcon('forge', x + SW / 2, y + SW / 2, SW);
    else {
      const sz = BDEF[s.id].size, sc = (SW - 12) / (sz * TS);
      ctx.translate(x + 6, y + 6); ctx.scale(sc, sc);
      drawBuildingShape(s.id, 1, sz * TS, -Math.PI / 4, animT, false);
    }
    ctx.restore();
    text(s.kind === 'forge' ? 'H' : s.kind === 'tool' ? TOOLS[s.id].key : String(s.key), x + 5, y + 9, 11, '#fff', 'left');
    if (s.kind === 'tool' && p.tl[s.id] > 1) text(String(p.tl[s.id]), x + SW - 5, y + SW - 8, 11, TMET[p.tl[s.id] - 1], 'right');
    if (s.kind === 'forge' && TOOL_ORDER.some(k => !toolError(p, k)) && Math.sin(animT * 5) > 0) { ctx.fillStyle = '#8fe08f'; circle(x + SW - 6, y + 6, 4); ctx.fill(); }
    const sx = x;
    ui.push({ x, y, w: SW, h: SW, fn: () => { if (s.kind === 'forge') { forgeOpen = !forgeOpen; skillsOpen = false; SFX.play('click'); } else if (s.kind === 'tool') selectTool(s.id); else selectBuild(s.id); } });
    x = sx + SW + gap;
  });
  if (hoverSlot) drawSlotTooltip(hoverSlot);

  drawMinimap();
  if (NET.role === 'host' || NET.role === 'client') {
    const mm = mmSize(), ox = VW - 12, oy = VH - mm - 30;
    const con = NET.role === 'client' || NET.peer;
    const label = 'Online' + (NET.room ? ' · Raum ' + NET.room : '') + ' · ' + (con ? S.players.length + ' Spieler' + (NET.ping ? ' · ' + Math.round(NET.ping) + ' ms' : '') + ' · Tab = Liste' : 'warte auf Mitspieler');
    text(label, ox, oy, 12, con ? '#8fe08f' : '#ffcf7a', 'right');
    if (NET.role === 'host' && !NET.peer && NET.room) {
      panel(ox - 220, oy - 86, 220, 70, 0.85);
      text('Raum-Code', ox - 110, oy - 72, 12, '#cfe8ff', 'center', '600');
      text(NET.room, ox - 110, oy - 48, 26, '#ffd36b', 'center');
      const bx = ox - 214, by = oy - 82, bw = 64, bh = 22;
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; rr(bx, by, bw, bh, 5); ctx.fill();
      text(NET.copied > animT ? 'Kopiert!' : 'Link', bx + bw / 2, by + bh / 2, 11, '#fff', 'center');
      ui.push({ x: bx, y: by, w: bw, h: bh, fn: () => { copyText(inviteLink(NET.room)); NET.copied = animT + 2; toast('Einladungslink kopiert – schick ihn deinem Freund!', '#7fd8ff'); } });
    }
  }
  // Pfeil zum Mitspieler, wenn er nicht im Bild ist
  for (const q of S.players) {
    if (q === S.player || q.dead > 0) continue;
    const sx = (q.x - camX) / uiS, sy = (q.y - camY) / uiS;
    if (sx > 0 && sy > 0 && sx < VW && sy < VH) continue;
    const a = Math.atan2(sy - VH / 2, sx - VW / 2);
    const ex = clamp(VW / 2 + Math.cos(a) * VW, 40, VW - 40), ey = clamp(VH / 2 + Math.sin(a) * VH, 90, VH - 110);
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(a);
    ctx.fillStyle = '#ff8a80'; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -9); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill();
    ctx.restore();
    text('P' + (q.id + 1), ex, ey - 16, 11, '#ffb0a8', 'center');
  }
  if (S.sel && !S.sel.dead) drawBuildMenu(S.sel);

  // Toast & Banner
  if (S.msg) {
    ctx.globalAlpha = clamp(S.msg.t * 2, 0, 1);
    ctx.font = 'bold 16px ' + FONT;
    const w = ctx.measureText(S.msg.text).width + 30;
    panel(VW / 2 - w / 2, y - 76, w, 32, 0.8);
    text(S.msg.text, VW / 2, y - 60, 16, S.msg.color, 'center');
    ctx.globalAlpha = 1;
  }
  if (S.banner) {
    const b = S.banner, a = clamp(Math.min(b.t, 3.2 - b.t) * 2.5, 0, 1);
    ctx.globalAlpha = a;
    text(b.text, VW / 2, VH * 0.3, Math.min(52, VW / 14), b.color, 'center');
    if (b.sub) text(b.sub, VW / 2, VH * 0.3 + 40, 18, '#e8e8e8', 'center', '600');
    ctx.globalAlpha = 1;
  }
  // Markierungen außerhalb des Bildes: Pfeil am Rand
  for (const pg of S.pings) {
    const sx = (pg.x - camX) / uiS, sy = (pg.y - camY) / uiS;
    if (sx > 0 && sy > 0 && sx < VW && sy < VH) continue;
    const a = Math.atan2(sy - VH / 2, sx - VW / 2);
    const ex = clamp(VW / 2 + Math.cos(a) * VW, 50, VW - 50), ey = clamp(VH / 2 + Math.sin(a) * VH, 100, VH - 120);
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(a);
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(animT * 8);
    ctx.fillStyle = pingCol(pg.pid); ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-8, -11); ctx.lineTo(-8, 11); ctx.closePath(); ctx.fill();
    ctx.restore(); ctx.globalAlpha = 1;
  }
  drawChat();
  // Steuerungshinweis
  if (!isTouch && VW > 1100 && VH > 600 && !chatIsOpen() && !chatLog.some(c => performance.now() - c.t < 12000)) {
    const lines = [R3 ? 'WASD laufen · Maus zielen · Linksklick angreifen · Mausrad Zoom' : 'WASD laufen · Maus zielen · Linksklick angreifen', 'Q E R C V B Waffen · H Schmiede · 1–0 Bauen · G Markierung · T Chat', 'M Karte · K Skills · F Falle · U Upgrade · X Verkaufen · N Ton'];
    lines.forEach((l, i) => text(l, 14, VH - 150 + i * 18, 12, 'rgba(255,255,255,0.55)', 'left', '600'));
  }
  if (skillsOpen) drawSkills();
  if (forgeOpen) drawForge();
  if (listOpen && !skillsOpen && !forgeOpen) drawPlayerList();
  if (mapOpen) drawBigMap();
  drawTouchUI();
  drawAchPopup(1 / 60);
  // Niedrige HP Vignette
  if (p.dead <= 0 && p.hp / p.maxHp < 0.3) {
    const a = (0.3 - p.hp / p.maxHp) * 1.5 * (0.6 + Math.sin(animT * 6) * 0.4);
    const g = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * 0.35, VW / 2, VH / 2, Math.max(VW, VH) * 0.7);
    g.addColorStop(0, 'rgba(255,0,0,0)'); g.addColorStop(1, 'rgba(200,0,0,' + a + ')');
    ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);
  }
}
function drawChat() {
  const open = chatIsOpen(), now = performance.now();
  const list = chatLog.filter(c => open || now - c.t < 12000).slice(open ? -10 : -6);
  if (!list.length && !open) return;
  const x = 14, w = Math.min(420, VW - 28), lh = 19, bottom = VH - (open ? 178 : 140);
  ctx.font = '600 13px ' + FONT;
  const rows = [];
  for (const c of list) {
    const head = c.name ? c.name + ': ' : '';
    rows.push(...wrapLines(head + c.text, w - 20, '600 13px ' + FONT).map((l, i) => ({ l, c, first: i === 0, head })));
  }
  const shown = rows.slice(-12);
  const h = shown.length * lh + 12;
  if (open || shown.length) { ctx.globalAlpha = open ? 1 : 0.85; panel(x - 4, bottom - h, w, h, open ? 0.75 : 0.45); }
  shown.forEach((r, i) => {
    const age = now - r.c.t;
    ctx.globalAlpha = open ? 1 : clamp((12000 - age) / 1500, 0, 1);
    const y = bottom - h + 6 + i * lh + lh / 2;
    if (r.first && r.head) {
      text(r.head, x + 4, y, 13, r.c.color, 'left', 'bold');
      ctx.font = 'bold 13px ' + FONT;
      text(r.l.slice(r.head.length), x + 4 + ctx.measureText(r.head).width, y, 13, '#eee', 'left', '600');
    } else text(r.l, x + 4, y, 13, r.c.name ? '#eee' : r.c.color, 'left', '600');
  });
  ctx.globalAlpha = 1;
}
function drawToolIcon(id, x, y, s, met) {
  met = met || '#dfe6ee';
  ctx.save(); ctx.translate(x, y); ctx.rotate(-Math.PI / 4); const k = s / 50; ctx.scale(k, k);
  if (id === 'forge') {
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#5d5f66'; ctx.beginPath(); ctx.moveTo(-17, -6); ctx.lineTo(15, -6); ctx.quadraticCurveTo(20, -6, 19, -2); ctx.lineTo(8, 0); ctx.lineTo(6, 8); ctx.lineTo(-6, 8); ctx.lineTo(-8, 0); ctx.lineTo(-13, -1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#3a3c42'; ctx.fillRect(-10, 8, 20, 5);
    ctx.fillStyle = '#ffb347'; circle(10, -13, 3); ctx.fill(); circle(4, -16, 2); ctx.fill();
  } else if (id === 'pick') {
    ctx.fillStyle = '#7a5530'; ctx.fillRect(-16, -2, 30, 4);
    ctx.strokeStyle = met; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(12, 0, 12, -1.3, 1.3); ctx.stroke();
  } else if (id === 'spear') {
    ctx.fillStyle = '#7a5530'; ctx.fillRect(-20, -1.5, 32, 3);
    ctx.fillStyle = met; ctx.beginPath(); ctx.moveTo(10, -5); ctx.lineTo(22, 0); ctx.lineTo(10, 5); ctx.closePath(); ctx.fill();
  } else if (id === 'axe') {
    ctx.fillStyle = met; ctx.beginPath(); ctx.ellipse(10, 0, 7, 13, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#6a4526'; ctx.fillRect(-18, -2, 34, 4);
  } else if (id === 'staff') {
    ctx.fillStyle = '#5a3a1a'; ctx.fillRect(-18, -2, 30, 4);
    ctx.fillStyle = 'rgba(255,150,50,0.35)'; circle(14, 0, 10); ctx.fill();
    ctx.fillStyle = '#ff8a2a'; circle(14, 0, 6); ctx.fill();
    ctx.fillStyle = '#fff3c0'; circle(13, -1, 2.2); ctx.fill();
  } else if (id === 'sword') {
    ctx.fillStyle = '#5a3a1a'; ctx.fillRect(-18, -2.5, 9, 5);
    ctx.fillStyle = '#c9a227'; ctx.fillRect(-10, -7, 4, 14);
    ctx.fillStyle = met; ctx.beginPath(); ctx.moveTo(-6, -3.5); ctx.lineTo(16, -2.5); ctx.lineTo(20, 0); ctx.lineTo(16, 2.5); ctx.lineTo(-6, 3.5); ctx.closePath(); ctx.fill();
  } else {
    ctx.rotate(Math.PI / 4);
    ctx.strokeStyle = '#a06a32'; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.arc(-4, 0, 16, -1.2, 1.2); ctx.stroke();
    ctx.strokeStyle = '#ddd'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-4 + Math.cos(-1.2) * 16, Math.sin(-1.2) * 16); ctx.lineTo(-4 + Math.cos(1.2) * 16, Math.sin(1.2) * 16); ctx.stroke();
    ctx.fillStyle = '#ddd'; ctx.fillRect(-6, -1, 22, 2);
  }
  ctx.restore();
}
function wrapLines(str, maxW, font) {
  ctx.font = font;
  const words = str.split(' '), lines = [];
  let cur = '';
  for (const w of words) { const tst = cur ? cur + ' ' + w : w; if (ctx.measureText(tst).width > maxW && cur) { lines.push(cur); cur = w; } else cur = tst; }
  if (cur) lines.push(cur);
  return lines;
}
function actSkill(id) {
  if (NET.role === 'client') { netSendR({ t: 'skill', id }); SFX.play('click'); return; }
  if (!spendSkill(S.player, id)) SFX.play('error', undefined, undefined, true);
}
function drawSkills() {
  const p = S.player;
  const w = Math.min(820, VW - 24), cols = w > 760 ? 3 : w > 480 ? 2 : 1, cw = (w - 36 - (cols - 1) * 12) / cols, chh = cols === 3 ? 84 : 74;
  const rows = Math.ceil(SKILLS.length / cols), h = 92 + rows * (chh + 10) + 112;
  const x = VW / 2 - w / 2, y = Math.max(cols === 3 ? 60 : 20, VH / 2 - h / 2 - 40);
  panel(x, y, w, h, 0.94);
  ui.push({ x, y, w, h, fn: () => {} });
  text('Fähigkeiten', x + 18, y + 24, 20, '#ffe27a');
  text('Level ' + p.lvl + ' · XP ' + Math.floor(p.xp) + ' / ' + xpNeed(p.lvl), x + 18, y + 50, 13, '#ccc', 'left', '600');
  text(p.sp > 0 ? p.sp + ' Skillpunkt' + (p.sp > 1 ? 'e' : '') + ' frei' : 'Keine Skillpunkte – sammle XP!', x + w - 50, y + 24, 14, p.sp > 0 ? '#8fe08f' : '#999', 'right');
  text('×', x + w - 20, y + 23, 20, '#aaa', 'center');
  ui.push({ x: x + w - 34, y: y + 6, w: 30, h: 30, fn: () => { skillsOpen = false; } });
  SKILLS.forEach((s, i) => {
    const cx = x + 18 + (i % cols) * (cw + 12), cy = y + 70 + Math.floor(i / cols) * (chh + 10), lv = p.sk[s.id];
    ctx.fillStyle = 'rgba(255,255,255,0.06)'; rr(cx, cy, cw, chh, 8); ctx.fill();
    ctx.fillStyle = 'rgba(255,211,107,0.15)'; circle(cx + 30, cy + chh / 2, 22); ctx.fill();
    text(s.icon, cx + 30, cy + chh / 2 + 1, 22, '#ffd36b', 'center');
    text(s.name, cx + 62, cy + 18, 15, '#fff');
    for (let k = 0; k < s.max; k++) { ctx.fillStyle = k < lv ? '#ffd36b' : 'rgba(255,255,255,0.18)'; rr(cx + 62 + k * 18, cy + 30, 14, 7, 2); ctx.fill(); }
    const descW = cw - 62 - 46;
    const now = lv ? s.desc(lv) : 'noch nicht gelernt', next = lv < s.max ? 'Nächste: ' + s.desc(lv + 1) : 'Maximal!';
    const lines = wrapLines(lv < s.max ? next : now, descW, '600 11px ' + FONT);
    lines.slice(0, chh > 80 ? 3 : 2).forEach((l, k) => text(l, cx + 62, cy + 50 + k * 13, 11, lv < s.max ? '#9fd0ff' : '#8fe08f', 'left', '600'));
    if (lv < s.max) {
      const can = p.sp > 0, bx = cx + cw - 40, by = cy + chh / 2 - 15;
      ctx.fillStyle = can ? 'rgba(60,160,80,0.9)' : 'rgba(255,255,255,0.08)'; rr(bx, by, 30, 30, 6); ctx.fill();
      text('+', bx + 15, by + 15, 20, can ? '#fff' : '#666', 'center');
      if (can) ui.push({ x: bx, y: by, w: 30, h: 30, fn: () => actSkill(s.id) });
    }
  });
  // Spezialfähigkeit
  const sy = y + h - 104;
  text('Spezialfähigkeit' + (p.lvl >= ABIL_LVL ? ' – wähle eine (Shift / ⚡)' : ' – ab Level ' + ABIL_LVL), x + 18, sy, 14, p.lvl >= ABIL_LVL ? '#ffe27a' : '#999');
  const aw = (w - 36 - 3 * 10) / 4;
  ABIL.forEach((A, i) => {
    const ax = x + 18 + i * (aw + 10), ay = sy + 14, ah = 62, on = p.ab === A.id, ok = p.lvl >= ABIL_LVL;
    ctx.fillStyle = on ? 'rgba(255,211,107,0.25)' : 'rgba(255,255,255,0.06)'; rr(ax, ay, aw, ah, 8); ctx.fill();
    if (on) { ctx.strokeStyle = '#ffd36b'; ctx.lineWidth = 2; ctx.stroke(); }
    ctx.globalAlpha = ok ? 1 : 0.45;
    text(A.icon, ax + 18, ay + 18, 18, '#fff', 'center');
    text(A.name, ax + 34, ay + 16, 13, on ? '#ffe27a' : '#fff');
    text(A.cd + ' s', ax + aw - 8, ay + 16, 11, '#aaa', 'right', '600');
    wrapLines(A.desc, aw - 16, '600 10px ' + FONT).slice(0, 2).forEach((l, k) => text(l, ax + 8, ay + 36 + k * 12, 10, '#bbb', 'left', '600'));
    ctx.globalAlpha = 1;
    if (ok) ui.push({ x: ax, y: ay, w: aw, h: ah, fn: () => actAbilitySelect(A.id) });
  });
  // Zurücksetzen
  const spent = SKILLS.reduce((a, s) => a + p.sk[s.id], 0);
  if (spent) {
    const rw = 190, rx = x + w - rw - 50, ry = y + 34;
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; rr(rx, ry, rw, 24, 6); ctx.fill();
    text('↺ Zurücksetzen (' + RESPEC_COST + ' Gold)', rx + rw / 2, ry + 12, 12, S.gold >= RESPEC_COST ? '#cfe8ff' : '#888', 'center', '600');
    ui.push({ x: rx, y: ry, w: rw, h: 24, fn: () => actRespec() });
  }
}
let listOpen = false;
function drawPlayerList() {
  const list = S.players.slice().sort((a, b) => (a.clan || '~').localeCompare(b.clan || '~') || a.id - b.id);
  const w = Math.min(460, VW - 24), rowH = 30, h = 64 + list.length * rowH, x = VW / 2 - w / 2, y = 70;
  panel(x, y, w, h, 0.92);
  text('👥 Spieler (' + list.length + '/8)' + (NET.room ? ' · Raum ' + NET.room : ''), x + 16, y + 22, 16, '#ffe27a');
  text('Clan · Name · Level', x + w - 16, y + 22, 11, '#999', 'right', '600');
  list.forEach((q, i) => {
    const ry = y + 48 + i * rowH;
    if (q === S.player) { ctx.fillStyle = 'rgba(255,255,255,0.07)'; rr(x + 8, ry - 12, w - 16, rowH - 4, 6); ctx.fill(); }
    ctx.fillStyle = PLAYER_COL[q.id % 8]; circle(x + 22, ry + 2, 7); ctx.fill();
    text((q.clan ? '[' + q.clan + '] ' : '') + (q.name || 'Spieler'), x + 38, ry + 2, 14, q.clan && q.clan === S.player.clan ? '#7fffd0' : '#fff', 'left', '600');
    text('Lv ' + q.lvl + (q.afk ? ' · 💤' : '') + (q.dead > 0 ? ' · ☠' : '') + (q.ping ? ' · ' + Math.round(q.ping) + ' ms' : ''), x + w - 16, ry + 2, 12, '#ccc', 'right', '600');
  });
}
function drawForge() {
  const p = S.player, rowH = 64;
  const w = Math.min(660, VW - 24), h = 78 + TOOL_ORDER.length * rowH;
  const x = VW / 2 - w / 2, y = Math.max(12, VH / 2 - h / 2 - 50);
  panel(x, y, w, h, 0.95);
  ui.push({ x, y, w, h, fn: () => {} });
  text('⚒ Schmiede', x + 18, y + 24, 20, '#ffe27a');
  text('Holz ' + Math.floor(S.wood) + ' · Stein ' + Math.floor(S.stone) + ' · Gold ' + Math.floor(S.gold) + ' · Eisen ' + Math.floor(S.iron || 0), x + 18, y + 50, 13, '#ccc', 'left', '600');
  text('Max. Stufe = Reaktor + 1', x + w - 50, y + 24, 12, '#999', 'right', '600');
  text('×', x + w - 20, y + 23, 20, '#aaa', 'center');
  ui.push({ x: x + w - 34, y: y + 6, w: 30, h: 30, fn: () => { forgeOpen = false; } });
  const bw = w > 520 ? 170 : 120;
  TOOL_ORDER.forEach((id, i) => {
    const T = TOOLS[id], L = p.tl[id] || 0, cy = y + 66 + i * rowH, cx = x + 14, cw = w - 28;
    ctx.fillStyle = L ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.025)'; rr(cx, cy, cw, rowH - 6, 8); ctx.fill();
    ctx.save(); if (!L) ctx.globalAlpha = 0.45;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; rr(cx + 8, cy + 6, 46, 46, 8); ctx.fill();
    drawToolIcon(id, cx + 31, cy + 29, 46, TMET[Math.max(0, L - 1)]);
    ctx.restore();
    text(T.name + ' (' + T.key + ')', cx + 64, cy + 15, 15, L ? '#fff' : '#aaa');
    for (let k = 0; k < 5; k++) { ctx.fillStyle = k < L ? TMET[k] : 'rgba(255,255,255,0.15)'; rr(cx + 64 + k * 17, cy + 27, 13, 6, 2); ctx.fill(); }
    if (L) text(TLV_NAME[L - 1] + ' · Schaden ' + Math.round(T.dmg * (1 + 0.3 * (hqLvl() - 1)) * toolMul(L)), cx + 64 + 5 * 17 + 6, cy + 30, 11, TMET[L - 1], 'left', '600');
    const lines = wrapLines(toolDesc(id, Math.max(1, L)), cw - 64 - bw - 16, '600 11px ' + FONT);
    text(lines[0] + (lines.length > 1 ? ' …' : ''), cx + 64, cy + 46, 11, '#bbb', 'left', '600');
    const bx = cx + cw - bw - 8, by = cy + 7, bh = rowH - 20;
    if (L >= 5) { text('Maximal!', bx + bw / 2, by + bh / 2, 14, '#8fe08f', 'center'); return; }
    const err = toolError(p, id), cost = toolCost(p, id), ok = !err;
    ctx.fillStyle = ok ? 'rgba(60,160,80,0.9)' : 'rgba(255,255,255,0.08)'; rr(bx, by, bw, bh, 7); ctx.fill();
    text(L ? 'Aufwerten → ' + (L + 1) : 'Freischalten', bx + bw / 2, by + 13, 13, ok ? '#fff' : '#bbb', 'center');
    const sub = err && err !== 'Nicht genug Rohstoffe' ? err : costText(cost);
    text(sub, bx + bw / 2, by + 31, 10, ok ? '#e8ffe8' : err === 'Nicht genug Rohstoffe' ? '#ff9a8a' : '#ffcf7a', 'center', '600');
    ui.push({ x: bx, y: by, w: bw, h: bh, fn: () => actTool(id) });
  });
}
function drawSlotTooltip(h) {
  const s = h.s;
  let title, lines = [], cost = null;
  if (s.kind === 'forge') {
    title = 'Schmiede (H)'; lines = ['Neue Waffen freischalten', 'und Werkzeuge aufwerten.'];
  } else if (s.kind === 'tool') {
    const T = TOOLS[s.id], L = S.player.tl[s.id] || 1; title = T.name + ' (' + T.key + ') · Stufe ' + L;
    lines = wrapLines(toolDesc(s.id, L), 220, '600 13px ' + FONT);
    lines.push('Schaden: ' + Math.round(T.dmg * (1 + 0.3 * (hqLvl() - 1)) * toolMul(L)));
  } else {
    const d = BDEF[s.id]; title = d.name + ' (' + s.key + ')';
    lines = wrapLines(d.desc, 220, '600 13px ' + FONT);
    if (d.max) lines.push('Gebaut: ' + (S.counts[s.id] || 0) + ' / ' + d.max);
    cost = costFor(s.id, 1);
  }
  const w = 240, hh = 34 + lines.length * 18 + (cost ? 22 : 0);
  const x = clamp(h.x + 25 - w / 2, 8, VW - w - 8), y = h.y - hh - 50;
  panel(x, y, w, hh, 0.92);
  text(title, x + 10, y + 16, 14, '#ffe27a');
  lines.forEach((l, i) => text(l, x + 10, y + 36 + i * 18, 13, '#ddd', 'left', '600'));
  if (cost) text(costText(cost), x + 10, y + hh - 14, 13, canAfford(cost) ? '#8fe08f' : '#ff8a7a');
}
function mmSize() { return VW < 900 ? 120 : 170; }
let mapOpen = false;
function drawBigMap() {
  const size = Math.min(VW - 40, VH - 175), x = VW / 2 - size / 2, y = Math.max(46, (VH - 120) / 2 - size / 2 + 20);
  ctx.fillStyle = 'rgba(5,8,12,0.6)'; ctx.fillRect(0, 0, VW, VH);
  panel(x - 8, y - 34, size + 16, size + 42, 0.95);
  text('Karte (M zum Schließen) · Klick setzt eine Markierung', x, y - 17, 13, '#ffe27a', 'left');
  ctx.imageSmoothingEnabled = false;
  if (mmC) ctx.drawImage(mmC, x, y, size, size);
  ctx.imageSmoothingEnabled = true;
  const k = size / WORLD;
  if (S.hq) {
    const hx = (S.hq.tx + 1.5) * TS, hy = (S.hq.ty + 1.5) * TS, R = (buildRange() + 0.5) * TS;
    ctx.strokeStyle = 'rgba(255,230,140,0.5)'; ctx.lineWidth = 1; ctx.strokeRect(x + (hx - R) * k, y + (hy - R) * k, 2 * R * k, 2 * R * k);
  }
  for (const b of S.buildings) {
    ctx.fillStyle = b.type === 'hq' ? '#ffd36b' : TOWERS[b.type] ? '#5fb0ff' : b.type === 'trap' ? '#c0392b' : '#c8b898';
    const s = Math.max(2, b.size * TS * k); ctx.fillRect(x + b.tx * TS * k, y + b.ty * TS * k, s, s);
  }
  for (const a of S.animals || []) { ctx.fillStyle = '#c8955a'; ctx.fillRect(x + a.x * k - 2, y + a.y * k - 2, 4, 4); }
  for (const c of S.chests) { ctx.fillStyle = '#ffe14a'; ctx.fillRect(x + c.x * k - 4, y + c.y * k - 4, 8, 8); }
  for (const z of S.zombies) { ctx.fillStyle = z.type === 'boss' ? '#e07bff' : '#ff4a4a'; const s = z.type === 'boss' ? 7 : 3; ctx.fillRect(x + z.x * k - s / 2, y + z.y * k - s / 2, s, s); }
  for (const pg of S.pings) { ctx.strokeStyle = pingCol(pg.pid); ctx.lineWidth = 2; circle(x + pg.x * k, y + pg.y * k, 8 + Math.sin(animT * 8) * 2); ctx.stroke(); }
  for (const q of S.players) if (q.dead <= 0) {
    ctx.fillStyle = q === S.player ? '#ffffff' : '#ff9a90'; circle(x + q.x * k, y + q.y * k, 5); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
    text(q.name || ('P' + (q.id + 1)), x + q.x * k, y + q.y * k - 12, 11, '#fff', 'center');
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
  ctx.strokeRect(x + camX * k, y + camY * k, VW * k, VH * k);
  // Legende
  const lg = [['#ffffff', 'Du'], ['#ffd36b', 'Reaktor'], ['#5fb0ff', 'Türme'], ['#ff4a4a', 'Zombies'], ['#ffe14a', 'Truhen'], ['#c8955a', 'Tiere'], ['rgb(214,176,52)', 'Golderz']];
  lg.forEach((l, i) => { ctx.fillStyle = l[0]; ctx.fillRect(x + 6 + i * 92, y + size - 18, 10, 10); text(l[1], x + 20 + i * 92, y + size - 13, 11, '#eee', 'left', '600'); });
  ui.push({ x: x - 8, y: y - 34, w: size + 16, h: size + 42, fn: () => {
    const wx = (input.sx / uiS - x) / k, wy = (input.sy / uiS - y) / k;
    if (wx >= 0 && wy >= 0 && wx <= WORLD && wy <= WORLD) pingAt(wx, wy);
  } });
}
function drawMinimap() {
  const size = mmSize(), m = 12;
  const x = VW - size - m, y = VH - size - m;
  panel(x - 4, y - 4, size + 8, size + 8, 0.8);
  ctx.imageSmoothingEnabled = false;
  if (mmC) ctx.drawImage(mmC, x, y, size, size);
  ctx.imageSmoothingEnabled = true;
  const k = size / WORLD;
  if (S.hq) {
    const hx = (S.hq.tx + 1.5) * TS, hy = (S.hq.ty + 1.5) * TS, R = (buildRange() + 0.5) * TS;
    ctx.strokeStyle = 'rgba(255,230,140,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(x + (hx - R) * k, y + (hy - R) * k, 2 * R * k, 2 * R * k);
  }
  for (const b of S.buildings) {
    ctx.fillStyle = b.type === 'hq' ? '#ffd36b' : TOWERS[b.type] ? '#5fb0ff' : '#c8b898';
    const s = Math.max(2, b.size * TS * k);
    ctx.fillRect(x + b.tx * TS * k, y + b.ty * TS * k, s, s);
  }
  for (const c of S.chests) { ctx.fillStyle = '#ffe14a'; ctx.fillRect(x + c.x * k - 3, y + c.y * k - 3, 6, 6); }
  if (S.portal) for (const po of [S.portal, S.portal2]) { ctx.fillStyle = Math.sin(animT * 4) > 0 ? '#d8b4ff' : '#8a4ae0'; circle(x + po.x * k, y + po.y * k, 4); ctx.fill(); }
  for (const a of S.animals || []) { ctx.fillStyle = '#c8955a'; ctx.fillRect(x + a.x * k - 1.5, y + a.y * k - 1.5, 3, 3); }
  for (const pg of S.pings) if (Math.sin(animT * 10) > 0) { ctx.strokeStyle = pingCol(pg.pid); ctx.lineWidth = 2; circle(x + pg.x * k, y + pg.y * k, 6); ctx.stroke(); }
  for (const z of S.zombies) {
    ctx.fillStyle = z.type === 'boss' ? '#e07bff' : '#ff4a4a';
    const s = z.type === 'boss' ? 5 : 2.5;
    ctx.fillRect(x + z.x * k - s / 2, y + z.y * k - s / 2, s, s);
  }
  const p = S.player;
  for (const q of S.players) if (q.dead <= 0) { ctx.fillStyle = q === p ? '#fff' : q.clan && q.clan === p.clan ? '#7fffa0' : CHAT_COL[q.id % 8]; circle(x + q.x * k, y + q.y * k, 3); ctx.fill(); }
  ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
  ctx.strokeRect(x + camX * k, y + camY * k, VW * k, VH * k);
  ui.push({ x, y, w: size, h: size, fn: () => {} });
}
function towerStats(type, L) {
  const d = BDEF[type];
  if (TOWERS[type]) {
    const extra = type === 'mage' ? ' · Sprünge ' + d.chain[L] : d.splash ? ' · Radius ' + d.splash[L] : '';
    return 'Schaden ' + d.dmg[L] + ' · ' + (1 / d.rate[L]).toFixed(1) + '/s · Reichw. ' + d.range[L] + extra;
  }
  if (type === 'hq' || type === 'mine') return '+' + d.gold[L] + ' Gold/s';
  if (type === 'harv') return 'Ernte ' + d.rate[L] + '/s pro Baum/Fels · Radius ' + d.radius[L];
  if (type === 'trap') return 'Schaden ' + d.dmg[L] + ' alle 0,5 s · bremst Zombies';
  if (type === 'heal') return 'Heilt ' + d.heal[L] + ' HP/s · Radius ' + d.radius[L];
  return 'Max. HP ' + d.hp[L];
}
function drawBuildMenu(b) {
  const d = BDEF[b.type], c = bCenter(b);
  const w = 270, h = 172;
  const scx = (c.x - camX) / uiS, scy = (c.y - camY) / uiS, half = b.size * TS / 2 / uiS;
  let x = scx + half + 14, y = scy - h / 2;
  if (x + w > VW - 70) x = scx - half - 14 - w;
  x = clamp(x, 8, VW - w - 8); y = clamp(y, x < 230 ? 196 : 80, Math.max(x < 230 ? 196 : 80, VH - h - 120));
  panel(x, y, w, h, 0.92);
  ui.push({ x, y, w, h, fn: () => {} });
  text(d.name, x + 12, y + 18, 16, '#ffe27a');
  text('Stufe ' + b.lvl + ' / 5', x + w - 36, y + 18, 13, '#ccc', 'right', '600');
  // Schließen
  text('×', x + w - 16, y + 17, 18, '#aaa', 'center');
  ui.push({ x: x + w - 28, y: y + 4, w: 24, h: 26, fn: () => { S.sel = null; } });
  text('HP ' + Math.ceil(b.hp) + ' / ' + b.maxHp, x + 12, y + 42, 13, '#8fe08f', 'left', '600');
  text(towerStats(b.type, b.lvl - 1), x + 12, y + 62, 12, '#ccc', 'left', '600');
  if (b.lvl < 5) text('→ ' + towerStats(b.type, b.lvl), x + 12, y + 80, 12, '#9fd0ff', 'left', '600');
  // Upgrade-Button
  const err = upgradeError(b);
  const bx = x + 10, by = y + 96, bw = b.type === 'hq' ? w - 20 : 158, bh = 64;
  ctx.fillStyle = err ? 'rgba(120,60,60,0.5)' : 'rgba(60,140,70,0.75)'; rr(bx, by, bw, bh, 6); ctx.fill();
  text(b.lvl >= 5 ? 'MAXIMAL' : 'Upgrade (U)', bx + 10, by + 16, 14, '#fff');
  if (b.lvl < 5) {
    const cst = costFor(b.type, b.lvl + 1);
    text(costText(cst), bx + 10, by + 36, 12, err ? '#ffb0a0' : '#d8ffd8', 'left', '600');
    if (err) text(err, bx + 10, by + 53, 11, '#ff9a8a', 'left', '600');
  }
  ui.push({ x: bx, y: by, w: bw, h: bh, fn: () => actUpgrade(b) });
  if (b.type !== 'hq') {
    const sx = bx + bw + 8, sw = w - 20 - bw - 8, f = 0.5 * b.hp / b.maxHp;
    ctx.fillStyle = 'rgba(160,80,50,0.7)'; rr(sx, by, sw, bh, 6); ctx.fill();
    text('Verkaufen', sx + sw / 2, by + 16, 13, '#fff', 'center');
    text('(X)', sx + sw / 2, by + 32, 11, '#eee', 'center', '600');
    text('+' + Math.floor((b.spent.w + b.spent.s + b.spent.g) * f), sx + sw / 2, by + 50, 11, '#ffd8a0', 'center', '600');
    ui.push({ x: sx, y: by, w: sw, h: bh, fn: () => actSell(b) });
  }
}
function button(label, x, y, w, h, fn, primary, small) {
  const hov = input.sx >= x && input.sx <= x + w && input.sy >= y && input.sy <= y + h;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  if (primary) { g.addColorStop(0, hov ? '#ff8a3a' : '#d8641e'); g.addColorStop(1, hov ? '#b0381a' : '#8a2a10'); }
  else { g.addColorStop(0, hov ? '#4a4038' : '#33302c'); g.addColorStop(1, hov ? '#2a2420' : '#1c1a18'); }
  if (hov) { ctx.shadowColor = primary ? 'rgba(255,120,40,0.7)' : 'rgba(255,140,60,0.35)'; ctx.shadowBlur = 16; }
  ctx.fillStyle = g; rr(x, y, w, h, 4); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = primary ? '#ffb070' : hov ? '#c86a32' : 'rgba(200,110,50,0.5)'; ctx.lineWidth = primary ? 2 : 1.5; ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x + 3, y + 3, w - 6, Math.max(2, h * 0.18));
  const fs = small ? 14 : Math.min(19, h * 0.42);
  ctx.font = fs + 'px ' + FONT_T; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(label, x + w / 2 + 1, y + h / 2 + 2);
  ctx.fillStyle = primary ? '#fff3e0' : '#e8e0d8'; ctx.fillText(label, x + w / 2, y + h / 2);
  ui.push({ x, y, w, h, fn });
}
function drawOverlays() {
  if (mode === 'play') return;
  if (mode !== 'menu') { ctx.fillStyle = 'rgba(8,6,5,0.74)'; ctx.fillRect(0, 0, VW, VH); }
  const cx = VW / 2;
  if (mode === 'menu') {
    drawMenuFx();
    const small = VH < 700 || VW < 820, wide = VW > 1180;
    const ls = Math.round(Math.min(small ? 86 : 132, VW / 6.4));
    let y = small ? Math.max(58, ls * 0.8) : Math.max(110, VH * 0.2);
    drawLogo(cx, y, ls);
    y += ls * 0.62;
    ctx.font = Math.round(ls * 0.26) + 'px ' + FONT_P; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillText('3D SURVIVAL GAME', cx + 3, y + 3);
    ctx.fillStyle = '#c8c0b8'; ctx.fillText(R3 ? '3D SURVIVAL GAME' : 'SURVIVAL GAME · 2D', cx, y);
    y += ls * 0.32;
    ctx.font = '12px ' + FONT_P; ctx.fillStyle = '#ff8a3a';
    ctx.fillText('v3.0 · DIE WELT IST DUNKEL. DEIN REAKTOR IST DAS LETZTE LICHT.', cx, y);
    // Umschalter 2D/3D
    button(R3 ? '◀ 2D-VERSION' : '3D-VERSION ▶', VW - 210, 14, 196, 40, () => { location.href = (R3 ? 'index.html' : '3d.html') + location.search; }, !R3, true);
    if (isTouch) button(document.fullscreenElement ? 'VOLLBILD AUS' : '⛶ VOLLBILD', 14, 14, 170, 40, () => {
      const el = document.documentElement;
      if (document.fullscreenElement) document.exitFullscreen();
      else if (el.requestFullscreen) el.requestFullscreen().then(() => { try { screen.orientation.lock('landscape').catch(() => {}); } catch (e) {} }).catch(() => {});
    }, false, true);
    // Knöpfe
    y += small ? 22 : 40;
    const bw = small ? Math.min(250, (VW - 60) / 3) : 300, bh = small ? 46 : 54;
    if (small) {
      button('▶ EINZELSPIELER', cx - bw * 1.5 - 10, y, bw, bh, startSingle, true);
      button('ONLINE HOSTEN', cx - bw / 2, y, bw, bh, () => lanConnect('host'));
      button('ONLINE BEITRETEN', cx + bw / 2 + 10, y, bw, bh, () => lobbyOpen(ONLINE_URL ? 'lan-join' : 'lan-info'));
      y += bh + 10;
      button('NAME: ' + playerName, cx - bw * 1.5 - 10, y, bw, 34, setName, false, true);
      button('🏆 ERFOLGE ' + achDone.size + '/' + ACHIEVEMENTS.length, cx - bw / 2, y, bw, 34, () => { achOpen = true; }, false, true);
      button('DIREKT (OHNE SERVER)', cx + bw / 2 + 10, y, bw, 34, () => lobbyOpen('host'), false, true);
      y += 46;
    } else {
      const bx = cx - bw / 2;
      button('▶ EINZELSPIELER', bx, y, bw, bh + 6, startSingle, true); y += bh + 18;
      button('ONLINE HOSTEN', bx, y, bw, bh, () => lanConnect('host')); y += bh + 10;
      button('ONLINE BEITRETEN', bx, y, bw, bh, () => lobbyOpen(ONLINE_URL ? 'lan-join' : 'lan-info')); y += bh + 16;
      button('DIREKT HOSTEN', bx, y, bw / 2 - 5, 34, () => lobbyOpen('host'), false, true);
      button('DIREKT BEITRETEN', bx + bw / 2 + 5, y, bw / 2 - 5, 34, () => lobbyOpen('join'), false, true); y += 44;
      button('NAME: ' + playerName + '  ✎', bx, y, bw / 2 - 5, 34, setName, false, true);
      button('🏆 ' + achDone.size + '/' + ACHIEVEMENTS.length, bx + bw / 2 + 5, y, bw / 2 - 5, 34, () => { achOpen = true; }, false, true); y += 48;
    }
    if (menuMsg) { text(menuMsg, cx, y, 15, '#ff9a8a', 'center'); y += 24; }
    const info = (highscore ? 'REKORD: ' + highscore.nights + ' NÄCHTE · ' + highscore.kills + ' KILLS   ·   ' : '') + '🥚 ' + eggsFound.size + '/' + EGGS.length;
    ctx.font = '13px ' + FONT_P; ctx.fillStyle = '#ffb070'; ctx.textAlign = 'center'; ctx.fillText(info, cx, y);
    // Seitenpanels auf großen Bildschirmen
    if (wide) {
      const pw = Math.min(330, (VW - bw) / 2 - 70), py = VH * 0.47;
      const news = ['8 SPIELER ONLINE + CLANS', '/team · /w · /clan', 'RIESIGE KARTE MIT 4 BIOMEN', 'WÜSTE · SCHNEE · SUMPF', 'PORTAL INS SCHATTENREICH', 'NEUE 3D-MODELLE', 'SPRINGEN · BERGE · EISEN AUS SCHROTT', 'GEWITTER · KRYOTURM · SCHAMANEN', '7 VERSTECKTE EASTER EGGS 🥚'];
      panel(40, py, pw, 46 + news.length * 24, 0.78);
      titleText('NEU IN 3.0', 40 + pw / 2, py + 24, 20, '#ff8a3a');
      ctx.font = '11px ' + FONT_P; ctx.textAlign = 'left';
      news.forEach((l, i) => { ctx.fillStyle = i % 2 ? '#a8a098' : '#e8dcd0'; ctx.fillText((i % 2 ? '   ' : '▸ ') + l, 56, py + 54 + i * 24); });
      const ctl = isTouch ? ['LINKER STICK: LAUFEN', 'RECHTER STICK: ANGREIFEN', '⚡ SPEZIALFÄHIGKEIT', '⚒ SCHMIEDE · ★ SKILLS'] :
        ['WASD  LAUFEN', 'MAUS  ZIELEN & ANGREIFEN', R3 ? 'RECHTE MAUS ZIEHEN  360° DREHEN' : 'MAUSRAD  WERKZEUG', 'Q E R C V B  WAFFEN', '1–0 · F · J  BAUEN', 'LEER SPRINGEN · SHIFT FÄHIGKEIT', 'H SCHMIEDE · K SKILLS', 'M KARTE · TAB SPIELER', 'T CHAT · /hilfe'];
      const px = VW - 40 - pw;
      panel(px, py, pw, 46 + ctl.length * 24, 0.78);
      titleText('STEUERUNG', px + pw / 2, py + 24, 20, '#ff8a3a');
      ctx.font = '11px ' + FONT_P; ctx.textAlign = 'left'; ctx.fillStyle = '#d8d0c8';
      ctl.forEach((l, i) => ctx.fillText(l, px + 16, py + 54 + i * 24));
    } else if (!small) {
      ctx.font = '11px ' + FONT_P; ctx.fillStyle = '#a8a098'; ctx.textAlign = 'center';
      ctx.fillText(isTouch ? 'LINKER STICK LAUFEN · RECHTER STICK ANGREIFEN · ⚡ FÄHIGKEIT' : 'WASD LAUFEN · MAUS ANGREIFEN · 1–0 BAUEN · LEER SPRINGEN · SHIFT FÄHIGKEIT · T CHAT', cx, VH - 24);
    }
    if (achOpen) drawAchList();
  } else if (mode === 'paused') {
    titleText(NET.role ? 'MENÜ' : 'PAUSE', cx, VH * 0.3, 60, '#e8dcd0');
    text('Nacht ' + S.night + ' · ' + S.kills + ' Kills · ' + S.buildings.length + ' Gebäude', cx, VH * 0.3 + 48, 17, '#ccc', 'center', '600');
    if (NET.role) text('Online-Spiel – das Spiel läuft im Hintergrund weiter!', cx, VH * 0.3 + 76, 15, '#ffb07a', 'center', '600');
    button('Fortsetzen (ESC)', cx - 120, VH * 0.48, 240, 50, () => { mode = 'play'; }, true);
    button(SFX.muted ? 'Ton an (N)' : 'Ton aus (N)', cx - 120, VH * 0.48 + 62, 240, 44, () => SFX.toggle());
    button(NET.role ? 'Spiel verlassen' : 'Hauptmenü', cx - 120, VH * 0.48 + 116, 240, 44, leaveGame);
  } else if (mode === 'over') {
    const r = lastResult;
    titleText('BLACKOUT', cx, VH * 0.2, Math.min(80, VW / 9), '#ff5b2a');
    text('Der Reaktor wurde zerstört – das letzte Licht ist aus.', cx, VH * 0.2 + 50, 18, '#ddd', 'center', '600');
    const stats = [
      ['Überlebte Nächte', r.nights], ['Zombies getötet', r.kills], ['Spielzeit', fmtTime(r.time)], ['Gold verdient', r.gold],
    ];
    panel(cx - 170, VH * 0.34, 340, stats.length * 32 + 24, 0.85);
    stats.forEach((s, i) => {
      text(s[0], cx - 150, VH * 0.34 + 28 + i * 32, 17, '#ccc', 'left', '600');
      text(String(s[1]), cx + 150, VH * 0.34 + 28 + i * 32, 19, '#fff', 'right');
    });
    const hy = VH * 0.34 + stats.length * 32 + 52;
    if (r.newBest) text('★ NEUER HIGHSCORE! ★', cx, hy, 22, '#ffd36b', 'center');
    else if (highscore) text('Highscore: ' + highscore.nights + ' Nächte · ' + highscore.kills + ' Kills', cx, hy, 16, '#ffd36b', 'center', '600');
    if (modeT > 1) {
      if (NET.role === 'client') text('Warte, bis der Host ein neues Spiel startet …', cx, hy + 56, 16, '#cfe8ff', 'center', '600');
      else button('Neues Spiel (ENTER)', cx - 130, hy + 30, 260, 52, startGame, true);
      button(NET.role ? 'Spiel verlassen' : 'Hauptmenü', cx - 130, hy + 92, 260, 44, leaveGame);
    }
  }
}

// =====================================================================
// Eingabe
// =====================================================================
function selectTool(id) {
  if (!(S.player.tl[id] > 0)) { forgeOpen = true; toast(TOOLS[id].name + ' ist noch gesperrt – schalte es in der Schmiede frei', '#ffcf7a'); SFX.play('click'); return; }
  S.player.tool = id; if (S.hq) S.place = null; SFX.play('click');
}
function selectBuild(id) {
  if (id === 'hq' && S.hq) return;
  if (S.place === id && S.hq) { S.place = null; return; }
  if (!S.hq && id !== 'hq') { toast('Platziere zuerst den Reaktor!', '#ff7b6b'); SFX.play('error'); S.place = 'hq'; return; }
  S.place = id; S.sel = null; S.lastPlaceTile = -1; SFX.play('click');
}
function tryPlaceAtAim(silent) {
  const a = aimPoint(), fp = footprintAt(S.place, a.x, a.y);
  const key = fp.ty * MAP + fp.tx;
  if (silent && key === S.lastPlaceTile) return;
  const err = placeError(S.place, fp.tx, fp.ty);
  if (err) { if (!silent) { toast(err, '#ff7b6b'); SFX.play('error'); } return; }
  S.lastPlaceTile = key;
  actPlace(S.place, fp.tx, fp.ty);
}
const KEYMAP = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
function hitUI(x, y) {
  x /= uiS; y /= uiS;
  for (let i = ui.length - 1; i >= 0; i--) { const u = ui[i]; if (x >= u.x && x <= u.x + u.w && y >= u.y && y <= u.y + u.h) return u; }
  return null;
}
if (!HEADLESS) {
  canvas = document.getElementById('game'); ctx = canvas.getContext('2d');
  lightC = document.createElement('canvas'); lctx = lightC.getContext('2d');
  lightSprite = makeLightSprite();
  window.addEventListener('resize', resize); resize();

  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];
  let konami = [];
  window.addEventListener('keydown', e => {
    SFX.init();
    if (!e.repeat) { konami.push(e.code); if (konami.length > 10) konami.shift(); if (konami.join() === KONAMI.join() && S && mode === 'play') { konami = []; actEgg('konami'); } }
    if (lobbyOpenNow()) { if (e.code === 'Escape') { netClose(); lobbyHide(); } return; }
    if (chatIsOpen()) return;
    if (KEYMAP[e.code]) { keys[KEYMAP[e.code]] = true; e.preventDefault(); }
    if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'KeyN') { SFX.toggle(); if (S && mode === 'play') toast(SFX.muted ? 'Ton aus' : 'Ton an'); return; }
    if (e.code === 'KeyM' && mode === 'play') { mapOpen = !mapOpen; SFX.play('click'); return; }
    if (e.code === 'Escape' && achOpen) { achOpen = false; return; }
    if (mode === 'menu') { if (e.code === 'Enter' || e.code === 'Space') startSingle(); return; }
    if (mode === 'over') { if ((e.code === 'Enter' || e.code === 'Space') && modeT > 1 && NET.role !== 'client') startGame(); return; }
    if (mode === 'paused') { if (e.code === 'Escape' || e.code === 'KeyP') mode = 'play'; return; }
    if (mode !== 'play') return;
    if (e.code === 'Escape') {
      if (mapOpen) mapOpen = false; else if (forgeOpen) forgeOpen = false; else if (skillsOpen) skillsOpen = false; else if (S.place && S.hq) S.place = null; else if (S.sel) S.sel = null; else mode = 'paused';
      return;
    }
    if (e.code === 'KeyP') { mode = 'paused'; return; }
    const dm = /^(Digit|Numpad)([0-9])$/.exec(e.code);
    if (dm) { selectBuild(KEY_BUILD[dm[2]]); return; }
    if (e.code === 'KeyT' || e.code === 'Enter') { e.preventDefault(); chatOpen(); return; }
    if (e.code === 'KeyG') { const a = aimPoint(); pingAt(a.x, a.y); return; }
    if (e.code === 'KeyK') { skillsOpen = !skillsOpen; forgeOpen = false; SFX.play('click'); return; }
    if (e.code === 'KeyH') { forgeOpen = !forgeOpen; skillsOpen = false; SFX.play('click'); return; }
    if (e.code === 'KeyF') { selectBuild('trap'); return; }
    if (e.code === 'KeyJ') { selectBuild('frost'); return; }
    if (e.code === 'Space') { jump(); return; }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { actAbility(); return; }
    if (R3 && e.code === 'Comma') { R3.rotate(-Math.PI / 4); return; }
    if (R3 && e.code === 'Period') { R3.rotate(Math.PI / 4); return; }
    if (e.code === 'KeyQ') selectTool('pick');
    else if (e.code === 'KeyE') selectTool('sword');
    else if (e.code === 'KeyR') selectTool('bow');
    else if (e.code === 'KeyC') selectTool('spear');
    else if (e.code === 'KeyV') selectTool('axe');
    else if (e.code === 'KeyB') selectTool('staff');
    else if (e.code === 'KeyU' && S.sel) actUpgrade(S.sel);
    else if ((e.code === 'KeyX' || e.code === 'Delete') && S.sel) actSell(S.sel);
  });
  window.addEventListener('keyup', e => { if (KEYMAP[e.code]) keys[KEYMAP[e.code]] = false; if (e.code === 'Tab') listOpen = false; });
  window.addEventListener('keydown', e => { if (e.code === 'Tab' && mode === 'play' && !chatIsOpen()) listOpen = true; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; input.down = false; if (mode === 'play' && !NET.role) mode = 'paused'; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  let rotDrag = null;
  canvas.addEventListener('mousedown', e => { if (R3 && e.button === 2) { rotDrag = e.clientX; e.preventDefault(); } });
  window.addEventListener('mouseup', e => { if (e.button === 2) rotDrag = null; });
  canvas.addEventListener('mousemove', e => {
    if (rotDrag !== null && R3) { R3.rotate((e.clientX - rotDrag) * 0.008, true); rotDrag = e.clientX; }
    input.sx = e.clientX; input.sy = e.clientY;
    if (mode === 'play' && input.down && S.place && (S.place === 'wall' || S.place === 'door') && !hitUI(e.clientX, e.clientY)) tryPlaceAtAim(true);
  });
  canvas.addEventListener('mousedown', e => {
    SFX.init();
    input.sx = e.clientX; input.sy = e.clientY;
    const u = hitUI(e.clientX, e.clientY);
    if (mode !== 'play') { if (u && e.button === 0) { SFX.play('click'); u.fn(); } return; }
    if (e.button === 2) {
      if (S.place && S.hq) { S.place = null; return; }
      const wp = aimPoint(), b = buildingAtWorld(wp.x, wp.y);
      S.sel = b || null;
      return;
    }
    if (e.button !== 0) return;
    if (u) { u.fn(); return; }
    if (S.place) { input.down = true; tryPlaceAtAim(false); return; }
    const wp = aimPoint(), b = buildingAtWorld(wp.x, wp.y);
    if (b) { tickleCheck(b); S.sel = S.sel === b ? null : b; SFX.play('click'); return; }
    S.sel = null;
    input.down = true;
  });
  window.addEventListener('mouseup', () => { input.down = false; });
  // Maus benutzt → wieder Desktop-Bedienung
  window.addEventListener('mousemove', e => { if (isTouch && e.movementX + e.movementY !== 0 && !matchMedia('(pointer: coarse)').matches) { isTouch = false; calcUiScale(); } });

  // ---------- Touch-Steuerung
  const onTouchStart = t => {
    const x = t.clientX, y = t.clientY;
    const u = hitUI(x, y), H = joyHomes();
    if (!u && mode === 'play' && !touch.pingMode && x < VW * 0.42 && touch.joyId === null) {
      // linke Seite: Lauf-Joystick (rastet am festen Platz ein, wenn man ihn dort berührt)
      const home = Math.hypot(x - H.lx, y - H.ly) < JOY_R * 1.7;
      touch.joyId = t.identifier; touch.jx = home ? H.lx : x; touch.jy = home ? H.ly : y;
      touch.kx = x; touch.ky = y; onTouchMove(t); return;
    }
    if (!u && mode === 'play' && !touch.pingMode && !S.place && touch.aimId === null && Math.hypot(x - H.rx, y - H.ry) < JOY_R * 1.6) {
      // rechter Joystick: zielen & angreifen
      touch.aimId = t.identifier; touch.ax = H.rx; touch.ay = H.ry; touch.akx = x; touch.aky = y; S.sel = null;
      onTouchMove(t); return;
    }
    input.sx = x; input.sy = y;
    if (mode !== 'play') { if (u) { SFX.play('click'); u.fn(); } return; }
    if (u) { u.fn(); return; }
    if (touch.pingMode) { const a = aimPoint(); pingAt(a.x, a.y); touch.pingMode = false; return; }
    if (S.place) { touch.placeId = t.identifier; tryPlaceAtAim(false); return; }
    const wp = aimPoint(), b = buildingAtWorld(wp.x, wp.y);
    if (b) { tickleCheck(b); S.sel = S.sel === b ? null : b; SFX.play('click'); return; }
    S.sel = null;
    touch.atkId = t.identifier; input.down = true;
  };
  const onTouchMove = t => {
    if (t.identifier === touch.joyId) {
      let dx = t.clientX - touch.jx, dy = t.clientY - touch.jy;
      const d = Math.hypot(dx, dy);
      if (d > JOY_R) { dx = dx / d * JOY_R; dy = dy / d * JOY_R; }
      touch.kx = touch.jx + dx; touch.ky = touch.jy + dy;
    } else if (t.identifier === touch.aimId) {
      let dx = t.clientX - touch.ax, dy = t.clientY - touch.ay;
      const d = Math.hypot(dx, dy);
      if (d > JOY_R) { dx = dx / d * JOY_R; dy = dy / d * JOY_R; }
      touch.akx = touch.ax + dx; touch.aky = touch.ay + dy;
    } else if (t.identifier === touch.atkId || t.identifier === touch.placeId) {
      input.sx = t.clientX; input.sy = t.clientY;
      if (t.identifier === touch.placeId && S.place && (S.place === 'wall' || S.place === 'door' || S.place === 'trap')) tryPlaceAtAim(true);
    }
  };
  const onTouchEnd = t => {
    if (t.identifier === touch.joyId) touch.joyId = null;
    if (t.identifier === touch.aimId) touch.aimId = null;
    if (t.identifier === touch.atkId) { touch.atkId = null; input.down = false; }
    if (t.identifier === touch.placeId) touch.placeId = null;
  };
  const touchOpts = { passive: false };
  canvas.addEventListener('touchstart', e => {
    e.preventDefault(); SFX.init();
    if (!isTouch) { isTouch = true; calcUiScale(); }
    for (const t of e.changedTouches) onTouchStart(t);
  }, touchOpts);
  canvas.addEventListener('touchmove', e => { e.preventDefault(); for (const t of e.changedTouches) onTouchMove(t); }, touchOpts);
  canvas.addEventListener('touchend', e => { e.preventDefault(); for (const t of e.changedTouches) onTouchEnd(t); }, touchOpts);
  canvas.addEventListener('touchcancel', e => { for (const t of e.changedTouches) onTouchEnd(t); });
  canvas.addEventListener('wheel', e => {
    if (R3) { R3.zoom(e.deltaY); return; }
    if (mode !== 'play') return;
    const order = TOOL_ORDER.filter(k => S.player.tl[k] > 0), n = order.length;
    const i = Math.max(0, order.indexOf(S.player.tool));
    selectTool(order[(i + (e.deltaY > 0 ? 1 : n - 1)) % n]);
  }, { passive: true });

  newGame();
  if (INVITE && ONLINE_URL) setTimeout(() => lobbyOpen('lan-join', INVITE), 50);
  let lastT = performance.now();
  setInterval(() => {
    if (!S) return;   // greift, sobald der Browser das Zeichnen pausiert (Tab im Hintergrund, minimiert …)
    const now = performance.now(), behind = (now - lastT) / 1000;
    if (behind < 0.5) return;
    try {
      if (NET.role === 'host' && NET.peer && (mode === 'play' || mode === 'paused')) {
        // Simulation nachholen (max. 60 s am Stück), nur der letzte Schritt verschickt Daten
        let steps = Math.min(1200, Math.round(Math.min(behind, 60) / 0.05));
        NET.mute = true;
        while (steps-- > 1) update(0.05);
        NET.mute = false; NET.sendT = 1;
        update(0.05);
      } else if (NET.role === 'client' && S.isClient) {
        const p = S.player;
        netSendU({ t: 'I', x: r2(p.x), y: r2(p.y), f: r2(p.face), tool: TOOLIDS.indexOf(p.tool), d: 0 });
        netPingTick(behind);
      }
    } catch (err) { console.error(err); }
    lastT = now;
  }, 1000);
  const frame = now => {
    const dt = Math.min(0.05, (now - lastT) / 1000 || 0);
    lastT = now; modeT += dt;
    requestAnimationFrame(frame);
    if (VW !== window.innerWidth || VH !== window.innerHeight) { if (window.innerWidth > 0 && window.innerHeight > 0) resize(); }
    try {
      checkAchievements(dt);
      if (NET.role === 'client') { if (S && S.isClient && mode !== 'menu') clientUpdate(dt); }
      else if (mode === 'play' || (mode === 'paused' && NET.role === 'host' && NET.peer)) update(dt);
      else if (mode === 'menu') { camX += Math.sin(animT * 0.1) * 0.4; camY += 0.25; if (camY > WORLD - VH) camY = 0; }
      render(dt);
    } catch (err) { console.error(err); }
  };
  requestAnimationFrame(frame);
}

// Schnittstelle für automatisierte Tests
ROOT.NW = {
  jump,
  DIM, BIOME_NAME, biomeAtW, get mapOpen() { return mapOpen; },
  netOnMessage, hostAddPeer, clientUpdate: typeof clientUpdate !== "undefined" ? clientUpdate : null, ABIL, useAbility, selectAbility, runCommand, buildRange, foundEgg, eggsFound, NET, addRemotePlayer, hostPeerGone, hostHandleClient, pById,
  touch, joyHomes, get isTouch() { return isTouch; },
  TMET, TOOL_ORDER, upgradeTool, actTool, get forgeOpen() { return forgeOpen; }, set forgeOpen(v) { forgeOpen = v; },
  newGame, update, startGame, get S() { return S; }, get mode() { return mode; }, set mode(m) { mode = m; },
  placeError, placeBuilding, upgradeBuilding, upgradeError, costFor, BDEF, ZDEF, input, findPath, tileAt, TS, MAP, render,
  setView(w, h) { VW = w; VH = h; },
  // für den 3D-Renderer
  get camX() { return camX; }, get camY() { return camY; }, get VW() { return VW; }, get VH() { return VH; },
  get animT() { return animT; }, get hoverSlot() { return hoverSlot; }, get netRole() { return NET.role; },
  ADEF, get mapOpen() { return mapOpen; }, get uiS() { return uiS; }, setTouch(on) { isTouch = on; calcUiScale(); }, chat: t => chatSend(t), get chatLog() { return chatLog; },
  darkness, LV_COL, TOWERS, PLAYER_COL, RES_HP, WORLD, footprintAt, bCenter, resScale, hpBar, text, aimPoint, clamp,
};
})();
