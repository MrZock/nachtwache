// BLACKOUT 3.0 – 3D-Renderer (three.js) · Stil: kaputte, rostige Zukunft
// Die komplette Spiellogik steckt in game.js; diese Datei zeichnet nur den Spielzustand in 3D.
// Koordinaten: 1 Einheit = 1 Feld (40 px). Spielwelt (x, y) → 3D (x / 40, Höhe, y / 40).
// Modelle werden aus vielen Grundformen zusammengesetzt und zu wenigen Geometrien verschmolzen
// (Vertex-Farben + Flat-Shading = Low-Poly-Look bei wenigen Draw-Calls).
'use strict';
(function () {
  const T = window.THREE;
  let G = null;                     // Spiel-API (window.NW)
  let renderer, scene, camera, raycaster, groundPlane, canvas3;
  let hemi, sun, fogColor, ground, groundTex, lastS = null, lastSize = '';
  const pointLights = [];
  const NL = 8;                     // feste Anzahl Punktlichter (keine Shader-Neukompilierung)
  const MAXRES = 3600, MAXZ = 420, MAXP = 400, MAXPART = 1600, MAXGLOW = 1600, MAXDECO = 5000, MAXRAIN = 800;
  const TAU = Math.PI * 2;
  const geoCache = new Map();
  const geo = (k, f) => { let g = geoCache.get(k); if (!g) { g = f(); geoCache.set(k, g); } return g; };
  const v3 = new T.Vector3(), m4 = new T.Matrix4(), q4 = new T.Quaternion(), s3 = new T.Vector3(), e3 = new T.Euler(), col = new T.Color(), col2 = new T.Color();
  const mB = new T.Matrix4(), mL = new T.Matrix4(), pB = new T.Vector3(), qB = new T.Quaternion();
  const hash = n => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };

  const R3 = window.NW3D = {
    ready: false, init, render, overlay, pick, zoomLevel: 1, yaw: 0, yawT: 0, fp: false, pitch: -0.12,
    look(dx, dy) { R3.yaw -= dx * 0.0024; R3.yawT = R3.yaw; R3.pitch = Math.max(-1.25, Math.min(0.7, R3.pitch - dy * 0.0024)); },
    rotate(d, instant, reset) { if (reset) { R3.yawT = Math.round(R3.yaw / TAU) * TAU; return; } R3.yawT += d; if (instant) R3.yaw = R3.yawT; },
    zoom(dy) { R3.zoomLevel = Math.min(1.8, Math.max(0.6, R3.zoomLevel * (dy > 0 ? 1.1 : 1 / 1.1))); },
  };

  // ---------------------------------------------------------------- Materialien
  let matLit, matGlow, matInst, glowTex;
  function lambert(color, extra) { return new T.MeshLambertMaterial(Object.assign({ color, flatShading: true }, extra || {})); }

  // ---------------------------------------------------------------- Grundformen (gecacht)
  const BX = (w, h, d) => geo('bx' + w + '_' + h + '_' + d, () => new T.BoxGeometry(w, h, d));
  const CY = (rt, rb, h, s, open, ts, tl) => geo('cy' + [rt, rb, h, s, open, ts, tl].join('_'), () => new T.CylinderGeometry(rt, rb, h, s || 10, 1, !!open, ts || 0, tl || TAU));
  const CO = (r, h, s) => geo('co' + r + '_' + h + '_' + s, () => new T.ConeGeometry(r, h, s || 8));
  const SP = (r, w, h, ps, pl, ts, tl) => geo('sp' + [r, w, h, ps, pl, ts, tl].join('_'), () => new T.SphereGeometry(r, w || 10, h || 8, ps || 0, pl || TAU, ts || 0, tl || Math.PI));
  const IC = (r, d) => geo('ic' + r + '_' + d, () => new T.IcosahedronGeometry(r, d || 0));
  const OC = r => geo('oc' + r, () => new T.OctahedronGeometry(r, 0));
  const DO = r => geo('do' + r, () => new T.DodecahedronGeometry(r, 0));
  const TO = (r, t, rs, ts, arc) => geo('to' + [r, t, rs, ts, arc].join('_'), () => new T.TorusGeometry(r, t, rs || 6, ts || 16, arc || TAU));

  // ---------------------------------------------------------------- Mesh-Baukasten
  // add(layer, geometrie, farbe, x, y, z, rx, ry, rz, sx, sy, sz) – Ebenen: 'lit' (beleuchtet), 'glow' (leuchtet selbst)
  class Kit {
    constructor() { this.L = {}; }
    add(layer, g, c, x, y, z, rx, ry, rz, sx, sy, sz, jit) {
      (this.L[layer] || (this.L[layer] = [])).push({ g, c, x: x || 0, y: y || 0, z: z || 0, rx: rx || 0, ry: ry || 0, rz: rz || 0,
        sx: sx === undefined ? 1 : sx, sy: sy === undefined ? (sx === undefined ? 1 : sx) : sy, sz: sz === undefined ? (sx === undefined ? 1 : sx) : sz, jit: jit === undefined ? 0.07 : jit });
      return this;
    }
    lit(...a) { return this.add('lit', ...a); }
    glow(...a) { return this.add('glow', ...a); }
    build() { const out = {}; for (const k in this.L) out[k] = merge(this.L[k]); return out; }
  }
  const tmpC = new T.Color();
  function merge(parts) {
    const geos = []; let n = 0;
    for (const p of parts) {
      const g = p.g.index ? p.g.toNonIndexed() : p.g.clone();
      e3.set(p.rx, p.ry, p.rz, 'YXZ'); q4.setFromEuler(e3);
      m4.compose(v3.set(p.x, p.y, p.z), q4, s3.set(p.sx, p.sy, p.sz));
      g.applyMatrix4(m4);
      geos.push(g); n += g.attributes.position.count;
    }
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), ca = new Float32Array(n * 3);
    let o = 0;
    parts.forEach((p, k) => {
      const g = geos[k], cnt = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
      tmpC.set(p.c);
      for (let f = 0; f < cnt; f += 3) {
        const j = 1 + (hash(o + f * 1.7 + k * 31) - 0.5) * 2 * p.jit;
        for (let v = 0; v < 3 && f + v < cnt; v++) { const i = (o + f + v) * 3; ca[i] = tmpC.r * j; ca[i + 1] = tmpC.g * j; ca[i + 2] = tmpC.b * j; }
      }
      o += cnt; g.dispose();
    });
    const out = new T.BufferGeometry();
    out.setAttribute('position', new T.BufferAttribute(pos, 3));
    out.setAttribute('normal', new T.BufferAttribute(nor, 3));
    out.setAttribute('color', new T.BufferAttribute(ca, 3));
    out.computeBoundingSphere();
    return out;
  }

  // ---------------------------------------------------------------- Setup
  let fpView = null, fpTools = null, fpMetal = null, lastFp = null;
  let peaks, peakSnow, trunks, pine1, pine2, pine3, oaks, rocks, ores, grass, flowers, bushes, cacti, voids, crystals, cars, barrels, rubble, lamps, snowcap;
  const portalObjs = [];
  let zGore, zSkull, zLeg, zTorso, zHead, zArm, zEye, zHorn, zBarrel, zHelm, zPlate, zHat, zStaff, zSack;
  let projArrow, projBall, parts, glows, rain;
  let boltLines, strikeLines, ghostMat, selBox, selRing, ghostRing;
  const ghostObjs = new Map();
  const buildingObjs = new Map(), chestObjs = new Map(), playerObjs = new Map(), animalObjs = new Map();
  const ringPool = [], pingPool = [];
  const walkPh = new Map();         // id → { x, y, ph } für Laufanimationen (Host und Mitspieler)

  function inst(geometry, material, max, shadow) {
    const m = new T.InstancedMesh(geometry, material, max);
    m.instanceMatrix.setUsage(T.DynamicDrawUsage);
    m.instanceColor = new T.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
    m.instanceColor.setUsage(T.DynamicDrawUsage);
    m.frustumCulled = false; m.count = 0;
    if (shadow) { m.castShadow = true; m.receiveShadow = true; }
    scene.add(m);
    return m;
  }
  function setInst(mesh, i, x, y, z, sx, sy, sz, rotY, rotX, rotZ) {
    e3.set(rotX || 0, rotY || 0, rotZ || 0, 'YXZ');
    q4.setFromEuler(e3);
    m4.compose(v3.set(x, y, z), q4, s3.set(sx, sy, sz));
    mesh.setMatrixAt(i, m4);
  }
  // Basis-Matrix (Position, Drehung, Größe) für Körperteile
  function base(x, y, z, rotY, sc) { e3.set(0, rotY, 0, 'YXZ'); qB.setFromEuler(e3); mB.compose(pB.set(x, y, z), qB, s3.set(sc, sc, sc)); }
  function part(mesh, i, px, py, pz, rx, ry, rz, sx, sy, sz) {
    e3.set(rx, ry, rz, 'YXZ'); q4.setFromEuler(e3);
    mL.compose(v3.set(px, py, pz), q4, s3.set(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz));
    mL.premultiply(mB); mesh.setMatrixAt(i, mL);
  }
  function worldOf(px, py, pz) { return v3.set(px, py, pz).applyMatrix4(mB); }
  function done(...ms) { for (const m of ms) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; } }
  function makeGlowTex() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.75)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t;
  }

  function init(api) {
    G = api;
    canvas3 = document.getElementById('game3d');
    renderer = new T.WebGLRenderer({ canvas: canvas3, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    scene = new T.Scene();
    fogColor = new T.Color('#86aecb');
    scene.background = fogColor.clone();
    scene.fog = new T.Fog(fogColor.clone(), 28, 62);
    camera = new T.PerspectiveCamera(42, 1, 0.5, 220);
    raycaster = new T.Raycaster();
    groundPlane = new T.Plane(new T.Vector3(0, 1, 0), 0);

    matLit = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    matInst = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    matGlow = new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    glowTex = makeGlowTex();
    ghostMat = new T.MeshBasicMaterial({ color: '#60ff90', transparent: true, opacity: 0.45, depthWrite: false });

    hemi = new T.HemisphereLight(0xe8f2ff, 0x4a5c3a, 1.15);
    scene.add(hemi);
    sun = new T.DirectionalLight(0xfff0d6, 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 90;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
    scene.add(sun); scene.add(sun.target);
    scene.add(camera);
    fpView = new T.Group(); fpView.position.set(0.3, -0.32, -0.5); fpView.scale.setScalar(0.72); fpView.visible = false; camera.add(fpView);
    for (let i = 0; i < NL; i++) { const l = new T.PointLight(0xffb060, 0, 9, 1.3); scene.add(l); pointLights.push(l); }

    const outer = new T.Mesh(new T.PlaneGeometry(4000, 4000), lambert('#1d2a18'));
    outer.rotation.x = -Math.PI / 2; outer.position.set(G.MAP / 2, -0.03, G.MAP / 2);
    scene.add(outer);

    // ---- Natur (instanziert)
    trunks = inst(new Kit().lit(CY(0.075, 0.13, 1.45, 6), '#6b4626', 0, 0.72, 0).lit(CY(0.14, 0.19, 0.14, 6), '#5a3a20', 0, 0.07, 0).lit(BX(0.05, 0.3, 0.05), '#5a3a20', 0.1, 0.9, 0, 0, 0, -0.7).build().lit, matInst, MAXRES, true);
    pine1 = inst(new Kit().lit(CO(0.7, 0.9, 7), '#ffffff', 0, 1.2, 0, 0, 0, 0, 1, 1, 1, 0.1).build().lit, matInst, MAXRES, true);
    pine2 = inst(new Kit().lit(CO(0.54, 0.8, 7), '#ffffff', 0, 1.68, 0, 0, 0.3, 0, 1, 1, 1, 0.1).build().lit, matInst, MAXRES, true);
    pine3 = inst(new Kit().lit(CO(0.36, 0.72, 7), '#ffffff', 0, 2.14, 0, 0, 0.6, 0, 1, 1, 1, 0.1).build().lit, matInst, MAXRES, true);
    oaks = inst(new Kit()
      .lit(IC(0.58, 0), '#ffffff', 0, 1.6, 0, 0, 0, 0, 1, 0.9, 1, 0.12)
      .lit(IC(0.36, 0), '#e8ffe0', 0.36, 1.45, 0.2, 0.5, 0, 0, 1, 1, 1, 0.12)
      .lit(IC(0.38, 0), '#f4fff0', -0.32, 1.5, -0.24, 0, 0.7, 0, 1, 1, 1, 0.12)
      .lit(IC(0.33, 0), '#ffffff', 0.05, 2.0, -0.05, 0.3, 0.2, 0, 1, 1, 1, 0.12)
      .lit(IC(0.3, 0), '#dcf0d4', -0.1, 1.4, 0.4, 0, 0, 0.4, 1, 1, 1, 0.12).build().lit, matInst, MAXRES, true);
    rocks = inst(rockGeometry(), matInst, MAXRES, true);
    ores = inst(new Kit()
      .lit(OC(0.1), '#f6d05a', 0, 0, 0, 0, 0, 0, 0.8, 2.2, 0.8, 0.15)
      .lit(OC(0.08), '#ffe27a', 0.12, -0.04, 0.05, 0, 0, -0.6, 0.8, 1.8, 0.8, 0.15)
      .lit(OC(0.07), '#f2c94c', -0.1, -0.05, -0.06, 0.5, 0, 0.5, 0.8, 1.6, 0.8, 0.15).build().lit,
      new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: '#6a4a08' }), MAXRES, false);
    grass = inst(new Kit()
      .lit(CO(0.035, 0.32, 3), '#ffffff', 0, 0.16, 0, 0, 0, 0.12)
      .lit(CO(0.03, 0.26, 3), '#e0f0d0', 0.06, 0.13, 0.04, 0.3, 0, -0.3)
      .lit(CO(0.03, 0.28, 3), '#ffffff', -0.05, 0.14, 0.05, -0.3, 0, 0.25)
      .lit(CO(0.03, 0.22, 3), '#d8ecc8', 0.02, 0.11, -0.07, -0.35, 0, 0).build().lit, matInst, MAXDECO, false);
    flowers = inst(new Kit()
      .lit(CY(0.01, 0.01, 0.22, 3), '#3a7a2a', 0, 0.11, 0)
      .lit(IC(0.07, 0), '#ffffff', 0, 0.24, 0, 0, 0, 0, 1, 0.5, 1, 0)
      .lit(SP(0.03, 6, 4), '#ffe27a', 0, 0.265, 0).build().lit, matInst, MAXDECO, false);
    bushes = inst(new Kit()
      .lit(IC(0.26, 0), '#ffffff', 0, 0.2, 0, 0, 0, 0, 1, 0.8, 1, 0.12)
      .lit(IC(0.2, 0), '#e8ffe8', 0.2, 0.15, 0.08, 0.4, 0, 0, 1, 0.8, 1, 0.12)
      .lit(IC(0.18, 0), '#ffffff', -0.16, 0.14, 0.12, 0, 0.6, 0, 1, 0.8, 1, 0.12)
      .lit(SP(0.035, 5, 4), '#d8304a', 0.12, 0.3, 0.12).lit(SP(0.035, 5, 4), '#d8304a', -0.1, 0.27, 0.18).build().lit, matInst, MAXDECO, true);

    peaks = inst(peakGeometry(false), matInst, MAXRES * 2, true);
    peakSnow = inst(peakGeometry(true), matInst, MAXRES * 2, false);
    cacti = inst(new Kit()
      .lit(CY(0.14, 0.16, 1.1, 8), '#ffffff', 0, 0.55, 0).lit(SP(0.14, 8, 5, 0, TAU, 0, Math.PI / 2), '#ffffff', 0, 1.1, 0)
      .lit(CY(0.08, 0.09, 0.32, 7), '#f0fff0', 0.24, 0.62, 0, 0, 0, Math.PI / 2).lit(CY(0.08, 0.08, 0.4, 7), '#ffffff', 0.38, 0.85, 0)
      .lit(CY(0.07, 0.08, 0.26, 7), '#f0fff0', -0.2, 0.5, 0.02, 0, 0, Math.PI / 2).lit(CY(0.07, 0.07, 0.3, 7), '#ffffff', -0.32, 0.68, 0.02)
      .lit(SP(0.05, 5, 4), '#ff6a8a', 0, 1.24, 0).build().lit, matInst, MAXRES, true);
    snowcap = inst(new Kit().lit(CO(0.57, 0.48, 7), '#ffffff', 0, 1.46, 0, 0, 0, 0, 1, 1, 1, 0.04).lit(CO(0.4, 0.42, 7), '#ffffff', 0, 1.9, 0, 0, 0.3, 0, 1, 1, 1, 0.04)
      .lit(CO(0.27, 0.38, 7), '#ffffff', 0, 2.3, 0, 0, 0.6, 0, 1, 1, 1, 0.04).build().lit, matInst, MAXRES, false);
    voids = inst(new Kit().lit(BX(1.02, 1.6, 1.02), '#ffffff', 0, 0.8, 0, 0, 0, 0, 1, 1, 1, 0.15).lit(OC(0.4), '#d0c0ff', 0.1, 1.8, -0.1, 0.3, 0.5, 0, 1, 1.8, 1, 0.1).build().lit,
      new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: '#120624' }), MAXRES, true);
    crystals = inst(new Kit()
      .glow(OC(0.16), '#c890ff', 0, 0.42, 0, 0, 0, 0, 1, 3, 1, 0.1).glow(OC(0.12), '#e0c0ff', 0.16, 0.3, 0.06, 0, 0, -0.5, 1, 2.6, 1, 0.1)
      .glow(OC(0.11), '#9a5aff', -0.15, 0.26, -0.05, 0.4, 0, 0.5, 1, 2.4, 1, 0.1).glow(OC(0.08), '#f4e8ff', 0.02, 0.2, 0.18, -0.6, 0, 0, 1, 2.2, 1, 0.1)
      .build().glow, new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), MAXRES, false);
    cars = inst(new Kit()
      .lit(BX(1.5, 0.35, 0.7), '#ffffff', 0, 0.38, 0).lit(BX(0.8, 0.3, 0.64), '#e6e6e6', -0.1, 0.7, 0, 0, 0, 0.05)
      .lit(BX(0.04, 0.24, 0.6), '#202428', 0.31, 0.7, 0, 0, 0, -0.5).lit(BX(0.8, 0.22, 0.02), '#202428', -0.1, 0.72, 0.33)
      .lit(CY(0.17, 0.17, 0.12, 8), '#1a1a1a', 0.5, 0.17, 0.36, Math.PI / 2, 0, 0).lit(CY(0.17, 0.17, 0.12, 8), '#1a1a1a', -0.5, 0.12, 0.36, Math.PI / 2, 0, 0.4)
      .lit(CY(0.17, 0.17, 0.12, 8), '#1a1a1a', 0.5, 0.17, -0.36, Math.PI / 2, 0, 0)
      .lit(BX(0.4, 0.05, 0.5), '#8a4a2a', 0.4, 0.57, 0.05, 0, 0.3, 0.1, 1, 1, 1, 0.2).lit(BX(0.3, 0.05, 0.3), '#7a3a20', -0.5, 0.56, -0.1, 0, 0, 0, 1, 1, 1, 0.2)
      .build().lit, matInst, 600, true);
    barrels = inst(new Kit().lit(CY(0.18, 0.18, 0.5, 10), '#ffffff', 0, 0.25, 0).lit(CY(0.19, 0.19, 0.04, 10), '#555555', 0, 0.1, 0).lit(CY(0.19, 0.19, 0.04, 10), '#555555', 0, 0.4, 0)
      .lit(BX(0.02, 0.12, 0.14), '#e8d040', 0.18, 0.28, 0).build().lit, matInst, 1200, true);
    rubble = inst(new Kit().lit(BX(0.7, 0.3, 0.5), '#a8a49c', 0, 0.15, 0, 0, 0.2, 0.1).lit(BX(0.4, 0.25, 0.4), '#8a8680', 0.4, 0.12, 0.25, 0.3, 0.5, 0)
      .lit(BX(0.5, 0.12, 0.3), '#b8b4ac', -0.3, 0.06, -0.3, 0, 0.8, 0).lit(CY(0.02, 0.02, 0.6, 4), '#8a4a2a', 0.1, 0.35, 0, 0.5, 0, 0.6)
      .lit(CY(0.02, 0.02, 0.5, 4), '#8a4a2a', -0.1, 0.3, 0.1, -0.4, 0, 0.7).build().lit, matInst, 1200, true);
    // rostige Straßenlaterne: Sockel, Mast, Ausleger mit Strebe, Lampenschirm (Licht sitzt bei LAMP_HEAD)
    lamps = inst(new Kit()
      .lit(BX(0.34, 0.12, 0.34), '#3a3634', 0, 0.06, 0).lit(CY(0.1, 0.13, 0.36, 8), '#4a4440', 0, 0.3, 0)
      .lit(CY(0.05, 0.065, 2.0, 8), '#5a4e46', 0, 1.46, 0).lit(CY(0.075, 0.075, 0.06, 8), '#7a4a2a', 0, 0.9, 0)
      .lit(CY(0.075, 0.075, 0.06, 8), '#7a4a2a', 0, 1.9, 0).lit(SP(0.07, 6, 4), '#4a4440', 0, 2.48, 0)
      .lit(BX(0.68, 0.06, 0.06), '#5a4e46', 0.32, 2.4, 0)
      .lit(CY(0.022, 0.022, 0.5, 5), '#6a4a34', 0.17, 2.2, 0, 0, 0, -0.9)
      .lit(CO(0.2, 0.16, 4), '#3e3a38', 0.62, 2.3, 0, 0, Math.PI / 4, 0)
      .lit(BX(0.18, 0.05, 0.18), '#fff0c8', 0.62, 2.2, 0)
      .lit(BX(0.08, 0.3, 0.012), '#8a5a30', 0.03, 1.2, 0.055, 0, 0, 0, 1, 1, 1, 0.2)
      .build().lit, matInst, 600, true);

    // ---- Zombies: Körperteile (Maße für Radius 1, Blick nach +x)
    // Bein: zerrissene Hose mit ausgefranstem Saum, Schienbein, kaputter Schuh
    zLeg = inst(new Kit().lit(BX(0.38, 0.6, 0.38), '#ffffff', 0, -0.3, 0)
      .lit(BX(0.13, 0.16, 0.03), '#e8e8e8', 0.12, -0.66, 0.17, 0, 0, 0.2).lit(BX(0.12, 0.2, 0.03), '#f0f0f0', -0.1, -0.68, 0.17, 0, 0, -0.15)
      .lit(BX(0.03, 0.14, 0.12), '#e0e0e0', 0.19, -0.64, -0.08, 0.2, 0, 0).lit(BX(0.12, 0.12, 0.03), '#e8e8e8', 0.02, -0.65, -0.19, 0, 0, 0.25)
      .lit(BX(0.26, 0.3, 0.26), '#8a8a8a', 0, -0.75, 0).lit(BX(0.2, 0.06, 0.2), '#707070', 0.02, -0.55, 0)
      .lit(BX(0.48, 0.16, 0.4), '#4a4a4a', 0.07, -0.98, 0).lit(BX(0.14, 0.08, 0.3), '#3a3a3a', 0.28, -0.94, 0, 0, 0, -0.3)
      .build().lit, matInst, MAXZ * 2, true);
    // Oberkörper: zerfetztes Hemd mit herunterhängenden Fetzen, Buckel, eingesunkene Brust
    { const k = new Kit()
        .lit(BX(0.58, 0.8, 0.9), '#ffffff', 0, 0.06, 0).lit(BX(0.5, 0.2, 0.8), '#f2f2f2', -0.06, -0.42, 0)
        .lit(BX(0.42, 0.34, 0.7), '#e6e6e6', -0.2, 0.32, 0, 0, 0, 0.3)
        .lit(SP(0.29, 7, 5), '#e8e8e8', 0, 0.38, 0.43).lit(SP(0.29, 7, 5), '#dcdcdc', 0, 0.36, -0.43)
        .lit(BX(0.46, 0.1, 0.46), '#cfcfcf', 0.02, 0.5, 0);
      for (let i = 0; i < 7; i++) { const zz = -0.38 + i * 0.13, len = 0.16 + ((i * 37) % 5) * 0.05; k.lit(BX(0.04, len, 0.1), i % 2 ? '#f0f0f0' : '#d8d8d8', 0.27, -0.52 - len / 2 + 0.08, zz, 0, 0, ((i * 13) % 5 - 2) * 0.08); }
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) k.lit(BX(0.12, 0.14 + i * 0.05, 0.04), '#e0e0e0', -0.18 + i * 0.16, -0.58 - i * 0.02, s * 0.44, 0, 0, 0.1 * s);
      zTorso = inst(k.build().lit, matInst, MAXZ, true); }
    // Wunden & Knochen (eigene Farben, werden nicht eingefärbt)
    zGore = inst(new Kit()
      .lit(BX(0.04, 0.3, 0.3), '#4a0e0e', 0.3, -0.02, 0.18, 0, 0, 0.05).lit(BX(0.045, 0.2, 0.18), '#7a1a14', 0.3, 0.02, 0.2)
      .lit(BX(0.05, 0.04, 0.24), '#e8dcc0', 0.31, 0.1, 0.18).lit(BX(0.05, 0.04, 0.22), '#d8ccb0', 0.31, 0.0, 0.19).lit(BX(0.05, 0.04, 0.18), '#e8dcc0', 0.31, -0.1, 0.2)
      .lit(BX(0.03, 0.26, 0.04), '#5a1010', 0.3, -0.2, -0.24).lit(BX(0.03, 0.12, 0.08), '#6a1410', 0.3, 0.25, -0.2)
      .lit(BX(0.1, 0.07, 0.06), '#c8bca0', -0.32, 0.36, 0).lit(BX(0.1, 0.07, 0.06), '#c8bca0', -0.3, 0.22, 0).lit(BX(0.1, 0.07, 0.06), '#b8ac90', -0.3, 0.08, 0)
      .build().lit, matInst, MAXZ, true);
    // Kopf: eingefallene Augenhöhlen, offener Kiefer mit Zähnen, Haarbüschel, Ohr
    { const k = new Kit()
        .lit(BX(0.56, 0.5, 0.54), '#ffffff', 0, 0.04, 0)
        .lit(BX(0.06, 0.16, 0.18), '#3a3a3a', 0.27, 0.06, 0.13).lit(BX(0.06, 0.16, 0.18), '#3a3a3a', 0.27, 0.06, -0.13)
        .lit(BX(0.1, 0.12, 0.08), '#bdbdbd', 0.3, -0.05, 0)
        .lit(BX(0.08, 0.14, 0.42), '#1e0a0a', 0.25, -0.22, 0)
        .lit(BX(0.44, 0.1, 0.46), '#d0d0d0', 0.1, -0.36, 0, 0, 0, 0.32)
        .lit(BX(0.06, 0.06, 0.4), '#ffffff', 0.29, -0.17, 0);
      for (let i = 0; i < 4; i++) k.lit(BX(0.05, 0.06, 0.05), '#f4f4e8', 0.33, -0.27 - (i % 2) * 0.02, -0.14 + i * 0.095, 0, 0, 0.3);
      for (const [x, z, h] of [[-0.05, 0.12, 0.14], [-0.15, -0.1, 0.18], [0.05, -0.16, 0.1], [-0.2, 0.15, 0.12]]) k.lit(BX(0.1, h, 0.08), '#5a5a5a', x, 0.3 + h / 2 - 0.02, z, 0.2, 0, -0.3, 1, 1, 1, 0.1);
      k.lit(BX(0.08, 0.14, 0.05), '#d8d8d8', -0.04, 0.02, 0.29).lit(BX(0.06, 0.1, 0.05), '#c8c8c8', -0.04, 0.02, -0.29, 0, 0, 0.5);
      zHead = inst(k.build().lit, matInst, MAXZ, true); }
    // Schädel-Riss und Blut am Kinn (nicht eingefärbt)
    zSkull = inst(new Kit()
      .lit(BX(0.2, 0.06, 0.18), '#e8dcc0', 0.02, 0.3, -0.12, 0, 0.3, 0).lit(BX(0.12, 0.04, 0.1), '#c87a8a', 0.02, 0.33, -0.12, 0, 0.3, 0)
      .lit(BX(0.03, 0.18, 0.06), '#6a0e0e', 0.3, -0.38, 0.06).lit(BX(0.03, 0.1, 0.05), '#7a1410', 0.3, -0.36, -0.1)
      .build().lit, matInst, MAXZ, true);
    // Arm: zerrissener Ärmel, dürrer Unterarm, Hand mit Krallen
    zArm = inst(new Kit().lit(BX(0.42, 0.32, 0.32), '#a8a8a8', 0.12, 0, 0).lit(BX(0.1, 0.12, 0.33), '#909090', 0.34, -0.08, 0, 0, 0, 0.3)
      .lit(BX(0.62, 0.2, 0.2), '#ffffff', 0.62, 0, 0).lit(BX(0.08, 0.22, 0.22), '#e0e0e0', 0.62, 0, 0)
      .lit(BX(0.2, 0.24, 0.28), '#e8e8e8', 0.98, -0.02, 0)
      .lit(CO(0.035, 0.2, 4), '#f0f0e0', 1.16, -0.04, -0.09, 0, 0, -Math.PI / 2 - 0.3).lit(CO(0.035, 0.22, 4), '#f0f0e0', 1.18, -0.04, 0, 0, 0, -Math.PI / 2 - 0.3)
      .lit(CO(0.035, 0.2, 4), '#f0f0e0', 1.16, -0.04, 0.09, 0, 0, -Math.PI / 2 - 0.3).build().lit, matInst, MAXZ * 2, true);
    zEye = inst(BX(1, 1, 1), new T.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), MAXZ * 2, false);
    zHorn = inst(new Kit().lit(CO(0.14, 0.62, 6), '#ffffff', 0, 0.31, 0).build().lit, matInst, MAXZ, true);
    zBarrel = inst(new Kit()
      .lit(CY(0.3, 0.3, 0.7, 10), '#b03a2a', 0, 0, 0).lit(CY(0.32, 0.32, 0.07, 10), '#3a3030', 0, 0.22, 0).lit(CY(0.32, 0.32, 0.07, 10), '#3a3030', 0, -0.22, 0)
      .lit(BX(0.05, 0.22, 0.3), '#f0e0a0', 0.29, 0, 0).lit(CY(0.02, 0.02, 0.3, 4), '#c8a070', 0, 0.48, 0, 0.4).build().lit, matInst, MAXZ, true);
    zHelm = inst(new Kit()
      .lit(SP(0.4, 10, 6, 0, TAU, 0, Math.PI / 2), '#a8b0ba', 0, 0, 0, 0, 0, 0, 1, 0.9, 1)
      .lit(BX(0.1, 0.42, 0.62), '#8a929c', 0.32, -0.12, 0).lit(BX(0.12, 0.05, 0.4), '#202020', 0.36, -0.1, 0)
      .lit(CO(0.07, 0.25, 5), '#c8d0da', 0, 0.45, 0).build().lit, matInst, MAXZ, true);
    zPlate = inst(new Kit()
      .lit(BX(0.68, 0.7, 1.02), '#9aa4ae', 0, 0, 0).lit(BX(0.7, 0.08, 1.04), '#6a747e', 0, 0.15, 0).lit(BX(0.7, 0.08, 1.04), '#6a747e', 0, -0.15, 0)
      .lit(SP(0.34, 7, 5), '#b8c0ca', 0, 0.36, 0.48).lit(SP(0.34, 7, 5), '#b8c0ca', 0, 0.36, -0.48).build().lit, matInst, MAXZ, true);
    zHat = inst(new Kit()
      .lit(CY(0.48, 0.5, 0.06, 12), '#3a2050', 0, 0, 0).lit(CO(0.32, 0.8, 8), '#4a2a6a', -0.06, 0.42, 0, 0, 0, 0.25)
      .lit(CY(0.33, 0.33, 0.08, 10), '#d8b4ff', 0, 0.08, 0).lit(BX(0.04, 0.35, 0.08), '#ff6a8a', -0.2, 0.3, 0.24, 0, 0, 0.4).build().lit, matInst, MAXZ, true);
    zStaff = inst(new Kit()
      .lit(CY(0.05, 0.06, 2.4, 5), '#5a3a1a', 0, 0, 0).lit(SP(0.18, 6, 5), '#e8e0c8', 0, 1.25, 0, 0, 0, 0, 1, 0.9, 1)
      .lit(BX(0.06, 0.06, 0.06), '#202020', 0.15, 1.27, 0.06).lit(BX(0.06, 0.06, 0.06), '#202020', 0.15, 1.27, -0.06).build().lit, matInst, MAXZ, true);
    zSack = inst(new Kit()
      .lit(SP(0.3, 8, 6), '#9dffb8', 0, 0, 0).lit(SP(0.22, 8, 6), '#7fe0a0', 0.05, 0.3, 0.22).lit(SP(0.2, 8, 6), '#b8ffcc', 0.02, 0.25, -0.24)
      .build().lit, new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: '#1f5a30' }), MAXZ, false);

    // ---- Geschosse, Partikel, Leuchten, Regen
    projArrow = inst(new Kit()
      .lit(BX(0.62, 0.035, 0.035), '#c8a070', 0, 0, 0).lit(CO(0.045, 0.12, 4), '#d8dce4', 0.36, 0, 0, 0, 0, -Math.PI / 2)
      .lit(BX(0.14, 0.01, 0.12), '#e04040', -0.26, 0, 0).lit(BX(0.14, 0.12, 0.01), '#f0f0f0', -0.26, 0, 0).build().lit, matInst, MAXP, false);
    projBall = inst(SP(1, 10, 8), lambert('#ffffff'), MAXP, true);
    parts = inst(BX(1, 1, 1), new T.MeshBasicMaterial({ color: '#ffffff' }), MAXPART, false);
    glows = inst(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false, toneMapped: false }), MAXGLOW, false);
    glows.renderOrder = 5;
    rain = inst(BX(0.018, 0.6, 0.018), new T.MeshBasicMaterial({ color: '#a9c0e0', transparent: true, opacity: 0.5, depthWrite: false }), MAXRAIN, false);

    // Blitze (Kettenblitz + Gewitter)
    const mkLines = (n, c) => {
      const bg = new T.BufferGeometry();
      bg.setAttribute('position', new T.BufferAttribute(new Float32Array(n * 3), 3));
      const l = new T.LineSegments(bg, new T.LineBasicMaterial({ color: c, toneMapped: false }));
      l.frustumCulled = false; scene.add(l); return l;
    };
    boltLines = mkLines(600, '#e4c8ff');
    strikeLines = mkLines(400, '#f4f8ff');

    // Auswahl
    selBox = new T.Mesh(geo('selplane', () => new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), new T.MeshBasicMaterial({ color: '#ffe27a', transparent: true, opacity: 0.25, depthWrite: false }));
    selBox.visible = false; scene.add(selBox);
    selRing = ringMesh('#ffe27a', 0.6); selRing.visible = false;
    ghostRing = ringMesh('#ffffff', 0.5); ghostRing.visible = false;

    R3.ready = true;
  }
  function ringMesh(color, opacity) {
    const m = new T.Mesh(geo('ring', () => new T.RingGeometry(0.96, 1, 64).rotateX(-Math.PI / 2)),
      new T.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: T.DoubleSide }));
    m.position.y = 0.04; scene.add(m);
    return m;
  }
  // Berggipfel: zerklüfteter Kegel (Höhe 1), Schneekappe als eigener Teil
  function peakGeometry(snow) {
    const g = new T.ConeGeometry(snow ? 0.4 : 0.82, snow ? 0.4 : 1, 8, snow ? 1 : 4).toNonIndexed(), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + (hash(Math.round(x * 53) * 3 + Math.round(y * 61) * 7 + Math.round(z * 47) * 11) - 0.5) * 0.7, ky = 1 + (hash(Math.round(x * 31) + Math.round(z * 29) * 5) - 0.5) * 0.25;
      p.setXYZ(i, x * k, y * (y > -0.45 ? ky : 1), z * k);
    }
    g.translate(0, snow ? 0.79 : 0.5, 0);
    g.computeVertexNormals();
    return new Kit().lit(g, '#ffffff', 0, 0, 0, 0, 0, 0, 1, 1, 1, snow ? 0.04 : 0.14).build().lit;
  }
  // Felsbrocken mit Kanten und Moos oben
  function rockGeometry() {
    const mk = (r, seed) => {
      const g = new T.IcosahedronGeometry(r, 0).toNonIndexed(), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + (hash(Math.round(x * 97) * 3 + Math.round(y * 89) * 7 + Math.round(z * 83) * 11 + seed) - 0.5) * 0.45;
        p.setXYZ(i, x * k, y * k * 0.8, z * k);
      }
      g.computeVertexNormals();
      return g;
    };
    const kit = new Kit().lit(mk(0.42, 1), '#ffffff', 0, 0.2, 0, 0, 0, 0, 1, 1, 1, 0.1)
      .lit(mk(0.22, 2), '#e6e6e6', 0.36, 0.08, 0.18, 0.4, 0.3, 0, 1, 1, 1, 0.1)
      .lit(mk(0.14, 3), '#f0f0f0', -0.3, 0.05, 0.28, 0, 0.8, 0, 1, 1, 1, 0.1);
    const g = kit.build().lit, nrm = g.attributes.normal, c = g.attributes.color;
    for (let f = 0; f < nrm.count; f += 3) if (nrm.getY(f) > 0.72) for (let v = 0; v < 3; v++) { c.setXYZ(f + v, c.getX(f + v) * 0.72, c.getY(f + v) * 1.05, c.getZ(f + v) * 0.6); }
    return g;
  }

  // ---------------------------------------------------------------- Boden-Textur
  function buildGround(S) {
    const MAP = G.MAP, px = MAP > 400 ? 4 : MAP > 260 ? 5 : 6;
    // 1) grobe Farbflecken pro Feld, weich hochskaliert
    const small = document.createElement('canvas'); small.width = small.height = MAP;
    const sg = small.getContext('2d'), img = sg.createImageData(MAP, MAP);
    for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
      const v = S.variant[y * MAP + x], n = Math.sin(x * 0.11) * Math.cos(y * 0.13) + Math.sin((x + y) * 0.05) * 0.6;
      const bi = S.biome ? S.biome[y * MAP + x] : 0;
      let r = 82 + n * 8 + (v % 9) - 4, g = 102 + n * 10 + (v % 13) - 6, b = 60 + n * 5;
      if (v < 14) { r = 104; g = 92; b = 70; }           // Erde / Asche
      else if (v > 245) { r += 12; g += 14; b += 4; }
      if (bi === 2) { r = 196 + n * 6 + (v % 9); g = 166 + n * 5 + (v % 7); b = 108 + n * 3; }
      else if (bi === 3) { r = 222 + n * 3 + (v % 7); g = 230 + n * 3 + (v % 5); b = 238 + (v % 5); if (v < 20) { r = 160; g = 176; b = 190; } }
      else if (bi === 4) { r = 58 + n * 5 + (v % 7); g = 72 + n * 6; b = 44 + n * 3; if (v % 9 === 0) { r = 38; g = 60; b = 66; } }
      else if (bi === 5) { r = 30 + (v % 9); g = 18 + (v % 5); b = 44 + (v % 11); if (v % 7 === 0) { r = 120; g = 50; b = 200; } }
      if (S.res[y * MAP + x] === 6) { r = 92 + (v % 9); g = 86 + (v % 7); b = 80 + (v % 5); }
      const i = (y * MAP + x) * 4; img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
    sg.putImageData(img, 0, 0);
    const c = document.createElement('canvas'); c.width = c.height = MAP * px;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true; g.drawImage(small, 0, 0, c.width, c.height);
    // 2) feine Grashalm-Sprenkel
    for (let i = 0; i < MAP * MAP * 1.2; i++) {
      const x = hash(i) * c.width, y = hash(i + 7777) * c.height, k = hash(i + 333);
      g.fillStyle = k < 0.5 ? 'rgba(30,60,20,0.18)' : k < 0.85 ? 'rgba(150,190,90,0.14)' : 'rgba(110,90,60,0.16)';
      g.fillRect(x, y, 1 + (k * 2 | 0), 1);
    }
    if (groundTex) groundTex.dispose();
    groundTex = new T.CanvasTexture(c);
    groundTex.colorSpace = T.SRGBColorSpace;
    groundTex.anisotropy = 4;
    groundTex.magFilter = T.LinearFilter; groundTex.minFilter = T.LinearMipmapLinearFilter;
    if (ground) { ground.geometry.dispose(); scene.remove(ground); }
    ground = new T.Mesh(new T.PlaneGeometry(MAP, MAP), new T.MeshLambertMaterial({ color: '#ffffff', map: groundTex }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(MAP / 2, 0, MAP / 2);
    ground.receiveShadow = true; scene.add(ground);
  }

  // ---------------------------------------------------------------- Gebäude-Modelle
  const PAL = [
    { main: '#7a4a2e', dark: '#3e2a1e', light: '#9a6a46', trim: '#b0582a', metal: '#6e5a4e', roof: '#5a3a26', accent: '#d8782a', stone: '#6a625a' },
    { main: '#8d8a84', dark: '#5a5752', light: '#aaa69e', trim: '#d8a82a', metal: '#7a706a', roof: '#4a4642', accent: '#ffb030', stone: '#7a7670' },
    { main: '#5b6874', dark: '#3a444e', light: '#7a8894', trim: '#c86a2a', metal: '#9aaab8', roof: '#2e363e', accent: '#ff8a3a', stone: '#626a72' },
    { main: '#5a6044', dark: '#363a28', light: '#76805a', trim: '#d8a82a', metal: '#8a9070', roof: '#2e3220', accent: '#ffc040', stone: '#5a5a50' },
    { main: '#2e2e32', dark: '#1a1a1e', light: '#46464c', trim: '#d9a520', metal: '#ffd36b', roof: '#222226', accent: '#ff6a2a', stone: '#3a3a40' },
  ];
  const specCache = new Map();
  function specFor(type, lvl) {
    const key = type + lvl;
    let s = specCache.get(key);
    if (!s) { s = buildSpec(type, lvl); specCache.set(key, s); }
    return s;
  }
  // Mauerzinnen rund um ein Quadrat
  function merlons(k, half, y, size, c, every) {
    const n = Math.max(2, Math.round(half * 2 / every));
    for (let i = 0; i <= n; i++) {
      const t = -half + i * (half * 2 / n);
      k.lit(BX(size, size * 1.1, size), c, t, y, -half).lit(BX(size, size * 1.1, size), c, t, y, half);
      if (i > 0 && i < n) k.lit(BX(size, size * 1.1, size), c, -half, y, t).lit(BX(size, size * 1.1, size), c, half, y, t);
    }
  }
  function buildSpec(type, lvl) {
    const P = PAL[lvl - 1], parts = [], glowsS = [];
    const prt = (anim, x, y, z, extra) => { const k = new Kit(); parts.push(Object.assign({ anim, x: x || 0, y: y || 0, z: z || 0, kit: k }, extra || {})); return k; };
    const glow = (x, y, z, s, c, night, flick) => { const o = { x, y, z, s, c, night: !!night, flick: !!flick }; glowsS.push(o); return o; };
    const st = prt('static');
    switch (type) {
      case 'wall': {
        if (lvl === 1) {
          // Schrott-Barrikade: Paletten, Wellblech, Reifen
          st.lit(BX(0.96, 0.12, 0.9), '#6a4a2e', 0, 0.06, 0);
          for (let i = 0; i < 3; i++) st.lit(BX(0.9, 0.62, 0.05), i % 2 ? '#8a5a36' : '#7a4a2a', 0, 0.38, -0.3 + i * 0.3, 0.06 * (i - 1), 0, 0.04 * (i - 1));
          st.lit(BX(1.0, 0.5, 0.04), '#9a5a32', 0, 0.62, 0.38, 0.12, 0, 0).lit(BX(1.0, 0.5, 0.04), '#7a6a5a', 0.05, 0.6, -0.38, -0.1, 0.2, 0);
          for (let i = 0; i < 6; i++) st.lit(BX(0.02, 0.5, 0.06), '#5a3a26', -0.4 + i * 0.16, 0.62, 0.4, 0.12, 0, 0, 1, 1, 1, 0);
          st.lit(TO(0.2, 0.08, 6, 12), '#1e1e20', 0.3, 0.08, 0.1, Math.PI / 2, 0, 0).lit(TO(0.2, 0.08, 6, 12), '#1e1e20', 0.3, 0.24, 0.1, Math.PI / 2, 0.3, 0);
          st.lit(BX(0.05, 0.9, 0.05), '#4a3a30', -0.42, 0.45, 0.42, 0.1, 0, 0.1).lit(BX(0.05, 0.9, 0.05), '#4a3a30', 0.42, 0.45, -0.42, -0.1, 0, -0.1);
        } else if (lvl === 2) {
          // Betonwand mit Bewehrung
          st.lit(BX(0.98, 0.9, 0.98), P.main, 0, 0.45, 0).lit(BX(1.02, 0.12, 1.02), P.dark, 0, 0.06, 0);
          for (let i = 0; i < 4; i++) st.lit(CY(0.02, 0.02, 0.4, 4), '#8a4a2a', -0.3 + i * 0.2, 1.02, (i % 2) * 0.2 - 0.1, (i % 2 ? 0.3 : -0.2), 0, 0.2);
          st.lit(BX(1.0, 0.1, 1.0), P.trim, 0, 0.75, 0, 0, 0, 0, 1, 1, 1, 0.02).lit(BX(0.2, 0.2, 0.05), '#3a3632', 0.25, 0.4, 0.5, 0, 0, 0.4);
        } else {
          // Stahlplatten mit Nieten (und Gefahrenstreifen)
          st.lit(BX(0.98, 0.9, 0.98), P.main, 0, 0.45, 0).lit(BX(1.02, 0.1, 1.02), P.dark, 0, 0.05, 0).lit(BX(1.02, 0.1, 1.02), P.dark, 0, 0.9, 0);
          for (const s of [-1, 1]) for (let i = 0; i < 3; i++) st.lit(SP(0.03, 4, 3), P.metal, -0.3 + i * 0.3, 0.25 + (i % 2) * 0.4, s * 0.5).lit(SP(0.03, 4, 3), P.metal, s * 0.5, 0.25 + (i % 2) * 0.4, -0.3 + i * 0.3);
          for (let i = 0; i < 5; i++) st.lit(BX(0.1, 0.12, 1.04), i % 2 ? '#1a1a1a' : P.trim, -0.4 + i * 0.2, 0.72, 0, 0, 0, 0.6, 1, 1, 1, 0).lit(BX(1.04, 0.12, 0.1), i % 2 ? '#1a1a1a' : P.trim, 0, 0.72, -0.4 + i * 0.2, 0.6, 0, 0, 1, 1, 1, 0);
          if (lvl >= 4) for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4], [0, 0]]) st.lit(CO(0.05, 0.3, 4), P.metal, x, 1.1, z);
          if (lvl === 5) { st.glow(BX(1.03, 0.03, 1.03), '#ff6a2a', 0, 0.3, 0); glow(0, 0.3, 0, 1.2, '#ff6a2a', true, false); }
        }
        break;
      }
      case 'door': {
        for (const [x, z] of [[-0.39, -0.39], [0.39, -0.39], [-0.39, 0.39], [0.39, 0.39]]) st.lit(BX(0.2, 1.0, 0.2), P.main, x, 0.5, z).lit(BX(0.24, 0.08, 0.24), P.trim, x, 1.03, z);
        st.lit(BX(0.6, 0.82, 0.6), P.metal, 0, 0.41, 0);
        for (let i = 0; i < 4; i++) st.lit(BX(0.62, 0.04, 0.62), P.dark, 0, 0.1 + i * 0.2, 0, 0, 0, 0, 1, 1, 1, 0);
        for (let i = 0; i < 5; i++) st.lit(BX(0.1, 0.1, 0.63), i % 2 ? '#1a1a1a' : '#d8a82a', -0.24 + i * 0.12, 0.72, 0, 0.7, 0, 0, 1, 1, 1, 0);
        st.glow(BX(0.08, 0.06, 0.62), '#3aff6a', 0, 0.9, 0); glow(0, 0.95, 0, 0.5, '#3aff6a', true, false);
        break;
      }
      case 'trap': {
        st.lit(BX(0.94, 0.08, 0.94), '#4a3f36', 0, 0.04, 0).lit(BX(0.98, 0.04, 0.98), P.metal, 0, 0.02, 0);
        const sp = prt('spikes');
        for (let yy = 0; yy < 3; yy++) for (let xx = 0; xx < 3; xx++)
          sp.lit(CO(0.07, 0.32, 5), lvl > 2 ? '#e0e4ee' : '#a4a4ae', -0.28 + xx * 0.28, 0.16, -0.28 + yy * 0.28).lit(CY(0.06, 0.06, 0.04, 5), '#5a5048', -0.28 + xx * 0.28, 0.02, -0.28 + yy * 0.28);
        break;
      }
      case 'hq': {
        // Bunker-Sockel mit Gefahrenstreifen
        st.lit(BX(2.96, 0.32, 2.96), P.stone, 0, 0.16, 0).lit(BX(2.6, 0.5, 2.6), P.main, 0, 0.55, 0);
        for (let i = 0; i < 12; i++) { const t = -1.25 + i * 0.227; for (const s of [-1, 1]) st.lit(BX(0.13, 0.1, 0.03), i % 2 ? '#1a1a1a' : '#d8a82a', t, 0.38, s * 1.31, 0, 0, 0.7, 1, 1, 1, 0).lit(BX(0.03, 0.1, 0.13), i % 2 ? '#1a1a1a' : '#d8a82a', s * 1.31, 0.38, t, 0.7, 0, 0, 1, 1, 1, 0); }
        st.lit(BX(1.0, 0.12, 0.4), P.stone, 0, 0.06, 1.62).lit(BX(0.9, 0.12, 0.3), P.stone, 0, 0.2, 1.5);
        // Reaktorkern: Zylinder mit leuchtenden Bändern
        st.lit(CY(0.82, 0.95, 1.5, 16), P.metal, 0, 1.55, 0).lit(CY(0.88, 0.88, 0.12, 16), P.dark, 0, 0.86, 0).lit(CY(0.86, 0.86, 0.1, 16), P.dark, 0, 2.28, 0);
        for (let i = 0; i < 3; i++) st.glow(CY(0.84 - i * 0.03, 0.86 - i * 0.03, 0.07, 16), '#ff8a2a', 0, 1.15 + i * 0.4, 0);
        for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; st.lit(BX(0.06, 1.2, 0.22), P.dark, Math.cos(a) * 0.92, 1.55, Math.sin(a) * 0.92, 0, -a, 0); }
        st.lit(CY(0.55, 0.82, 0.4, 16), P.roof, 0, 2.5, 0).glow(CY(0.4, 0.4, 0.05, 16), '#ffb050', 0, 2.72, 0);
        // Rohre und Tanks
        for (const [x, z] of [[-1.15, -1.15], [1.15, -1.15], [-1.15, 1.15], [1.15, 1.15]]) {
          st.lit(CY(0.28, 0.3, 1.2, 10), P.main, x, 1.4, z).lit(SP(0.28, 10, 6, 0, TAU, 0, Math.PI / 2), P.light, x, 2.0, z).lit(CY(0.31, 0.31, 0.06, 10), P.trim, x, 1.2, z);
          st.lit(CY(0.06, 0.06, 0.9, 6), '#5a4a40', x * 0.6, 1.9, z * 0.6, 0, 0, 0, 1, 1, 1, 0.1);
          st.lit(CY(0.05, 0.05, Math.hypot(x, z) * 0.55, 6), '#6a5244', x * 0.66, 1.75, z * 0.66, Math.PI / 2, Math.atan2(x, z), 0);
        }
        // Tor
        st.lit(BX(0.8, 0.9, 0.12), P.dark, 0, 1.0, 1.26).lit(BX(0.64, 0.74, 0.12), '#1a1410', 0, 0.95, 1.28);
        for (let i = 0; i < 4; i++) st.lit(BX(0.62, 0.04, 0.02), '#3a3028', 0, 0.7 + i * 0.16, 1.35);
        st.glow(BX(0.5, 0.05, 0.03), '#ff8a2a', 0, 1.42, 1.33);
        // Antennenmast mit Warnlicht + Radarschüssel
        st.lit(BX(0.06, 1.6, 0.06), '#4a4440', 0.9, 2.6, -0.9).lit(BX(0.4, 0.04, 0.04), '#4a4440', 0.9, 3.0, -0.9).lit(BX(0.3, 0.04, 0.04), '#4a4440', 0.9, 3.3, -0.9);
        st.glow(SP(0.07, 6, 5), '#ff2a2a', 0.9, 3.45, -0.9);
        glow(0.9, 3.45, -0.9, 0.6, '#ff3a2a', false, true);
        const dish = prt('spin', -0.95, 2.2, -0.9, { axis: 'y', speed: 0.8 });
        dish.lit(CY(0.04, 0.06, 0.4, 6), '#4a4440', 0, 0, 0).lit(SP(0.35, 10, 5, 0, TAU, 0, Math.PI / 2.5), P.light, 0.12, 0.3, 0, 0, 0, -1.0).lit(CY(0.015, 0.015, 0.3, 4), '#2a2a2a', 0.25, 0.4, 0, 0, 0, -1.0);
        // Schwebender Energiekern
        // Halterung für den Energiekern: Ring auf 4 Streben + leuchtende Leitung aus dem Dach
        st.lit(TO(0.5, 0.045, 5, 24), P.trim, 0, 3.35, 0, Math.PI / 2, 0, 0).lit(TO(0.5, 0.02, 4, 24), '#2a2420', 0, 3.27, 0, Math.PI / 2, 0, 0);
        st.lit(CY(0.11, 0.16, 0.2, 10), P.dark, 0, 2.82, 0).glow(CY(0.05, 0.05, 0.42, 6), '#ffb050', 0, 3.0, 0);
        for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) st.lit(BX(0.07, 0.72, 0.07), P.dark, sx * 0.55, 3.0, sz * 0.55, -sz * 0.16, 0, sx * 0.16).lit(BX(0.12, 0.08, 0.12), P.metal, sx * 0.6, 2.68, sz * 0.6);
        const core = prt('bob', 0, 3.35, 0, { spin: 1.4, bobA: 0.03 });
        core.glow(OC(0.3), '#ffb050', 0, 0, 0, 0, 0, 0, 1, 1.4, 1, 0.05).glow(OC(0.17), '#fff3c0', 0, 0, 0, 0, 0.7, 0, 1, 1.3, 1, 0);
        glow(0, 3.35, 0, 2.6, '#ff9a3a', false, false).bob = true;
        glow(0, 1.5, 0, 2.4, '#ff8a2a', true, true);
        for (const s of [-1, 1]) { st.lit(CY(0.03, 0.03, 0.3, 5), '#5a3a1a', s * 0.5, 1.2, 1.36); st.glow(OC(0.06), '#ffcf6a', s * 0.5, 1.4, 1.36); glow(s * 0.5, 1.42, 1.38, 0.7, '#ff9a3a', false, true); }
        break;
      }
      case 'arrow': {
        st.lit(BX(1.84, 0.22, 1.84), P.stone, 0, 0.11, 0);
        for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) st.lit(BX(0.12, 1.85, 0.12), P.metal, x * 0.85, 1.05, z * 0.85, z * 0.1, 0, -x * 0.1);
        for (let h = 0; h < 3; h++) for (const s of [-1, 1]) st.lit(BX(1.1, 0.05, 0.05), P.dark, 0, 0.45 + h * 0.55, s * 0.5, 0, 0, s * 0.5 * (h % 2 ? 1 : -1)).lit(BX(0.05, 0.05, 1.1), P.dark, s * 0.5, 0.45 + h * 0.55, 0, s * 0.5 * (h % 2 ? -1 : 1), 0, 0);
        st.lit(BX(1.5, 0.14, 1.5), P.main, 0, 1.98, 0);
        for (const s of [-1, 1]) st.lit(BX(1.5, 0.3, 0.06), P.dark, 0, 2.2, s * 0.72).lit(BX(0.06, 0.3, 1.5), P.dark, s * 0.72, 2.2, 0);
        for (let i = 0; i < 4; i++) st.lit(BX(0.18, 0.1, 0.18), '#8a6a3a', -0.5 + i * 0.12, 2.1, -0.5 + (i % 2) * 0.1);
        glow(0.62, 2.35, 0.62, 0.5, '#ff4a2a', false, true); st.glow(SP(0.04, 5, 4), '#ff3a2a', 0.62, 2.35, 0.62);
        const tu = prt('turret', 0, 2.12, 0);
        tu.lit(CY(0.24, 0.3, 0.16, 8), P.metal, 0, 0, 0).lit(BX(0.5, 0.28, 0.36), P.main, 0.05, 0.25, 0).lit(BX(0.18, 0.2, 0.42), P.dark, -0.25, 0.25, 0)
          .lit(CY(0.04, 0.04, 0.7, 6), '#222226', 0.6, 0.29, 0.07, 0, 0, Math.PI / 2).lit(CY(0.04, 0.04, 0.7, 6), '#222226', 0.6, 0.29, -0.07, 0, 0, Math.PI / 2)
          .lit(CY(0.07, 0.07, 0.12, 8), P.dark, 0.95, 0.29, 0, 0, 0, Math.PI / 2).lit(BX(0.2, 0.18, 0.1), '#5a6044', 0, 0.2, 0.26)
          .lit(BX(0.04, 0.3, 0.36), P.trim, 0.32, 0.36, 0, 0, 0, 0.3).glow(BX(0.02, 0.04, 0.04), '#ff4a2a', 0.31, 0.3, 0.15);
        break;
      }
      case 'cannon': {
        st.lit(CY(0.9, 0.98, 0.7, 10), P.main, 0, 0.35, 0).lit(CY(0.94, 0.94, 0.1, 10), P.trim, 0, 0.72, 0);
        for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + 0.3; st.lit(BX(0.25, 0.35, 0.05), '#8a4a2a', Math.cos(a) * 0.97, 0.3, Math.sin(a) * 0.97, 0, -a + Math.PI / 2, 0.1 * (i % 2)); }
        for (let r = 0; r < 2; r++) st.lit(CY(0.985 - r * 0.04, 0.985 - r * 0.04, 0.03, 10), P.dark, 0, 0.2 + r * 0.25, 0, 0, 0, 0, 1, 1, 1, 0);
        for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; st.lit(BX(0.24, 0.22, 0.2), P.light, Math.cos(a) * 0.82, 0.88, Math.sin(a) * 0.82, 0, -a, 0); }
        for (const [x, z] of [[-0.55, 0.55], [-0.4, 0.62], [-0.5, 0.42]]) st.lit(SP(0.09, 8, 6), '#1e1e22', x, 0.86, z);
        const tu = prt('turret', 0, 0.78, 0);
        for (const s of [-1, 1]) tu.lit(BX(0.6, 0.28, 0.08), '#6b4a2a', -0.05, 0.14, s * 0.19).lit(CY(0.18, 0.18, 0.06, 10), '#4a3018', -0.05, 0.16, s * 0.27, Math.PI / 2, 0, 0).lit(CY(0.05, 0.05, 0.08, 6), P.metal, -0.05, 0.16, s * 0.3, Math.PI / 2, 0, 0);
        tu.lit(CY(0.12, 0.17, 1.05, 12), '#2a2a32', 0.32, 0.34, 0, 0, 0, -Math.PI / 2 + 0.12)
          .lit(TO(0.13, 0.03, 5, 12), P.metal, 0.83, 0.4, 0, 0, Math.PI / 2, 0).lit(TO(0.16, 0.025, 5, 12), P.metal, 0.05, 0.31, 0, 0, Math.PI / 2, 0)
          .lit(SP(0.1, 8, 6), '#2a2a32', -0.22, 0.3, 0);
        break;
      }
      case 'mage': {
        st.lit(CY(0.92, 1.0, 0.3, 8), P.stone, 0, 0.15, 0).lit(BX(1.2, 0.35, 1.2), P.main, 0, 0.45, 0);
        for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + Math.PI / 4; st.lit(BX(0.1, 2.0, 0.1), P.metal, Math.cos(a) * 0.5, 1.58, Math.sin(a) * 0.5).lit(BX(0.16, 0.1, 0.16), P.trim, Math.cos(a) * 0.5, 2.52, Math.sin(a) * 0.5); }
        st.lit(CY(0.16, 0.22, 1.8, 10), '#3a3430', 0, 1.5, 0);
        for (let i = 0; i < 9; i++) st.lit(TO(0.22 - i * 0.008, 0.035, 5, 16), i % 2 ? '#c87a3a' : '#a85a2a', 0, 0.85 + i * 0.16, 0, Math.PI / 2, 0, 0);
        st.lit(TO(0.55, 0.12, 8, 24), P.metal, 0, 2.55, 0, Math.PI / 2, 0, 0);
        for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + Math.PI / 4; st.lit(BX(0.5, 0.06, 0.08), P.dark, Math.cos(a) * 0.3, 2.55, Math.sin(a) * 0.3, 0, -a, 0); }
        st.lit(CY(0.13, 0.16, 0.3, 10), P.dark, 0, 2.55, 0).lit(CY(0.05, 0.07, 0.3, 6), P.metal, 0, 2.78, 0);
        for (let i = 0; i < 3; i++) { const a = i / 3 * TAU; st.lit(BX(0.05, 0.42, 0.05), P.metal, Math.cos(a) * 0.17, 2.9, Math.sin(a) * 0.17, Math.sin(a) * -0.45, 0, Math.cos(a) * 0.45); }
        st.glow(TO(0.85, 0.025, 4, 32), '#7ad8ff', 0, 0.65, 0, Math.PI / 2, 0, 0);
        for (const s of [-1, 1]) { st.lit(CY(0.04, 0.04, 0.4, 6), '#d8d0c0', s * 0.6, 0.85, 0.6); st.glow(SP(0.05, 5, 4), '#bfe8ff', s * 0.6, 1.07, 0.6); }
        const cr = prt('bob', 0, 3.02, 0, { spin: 2, bobA: 0.015 });
        cr.glow(IC(0.24, 1), '#c8f0ff', 0, 0, 0).glow(IC(0.13, 0), '#ffffff', 0, 0, 0);
        glow(0, 3.02, 0, 2.2, '#7ad8ff', false, true).bob = true;
        const arcs = prt('spin', 0, 3.02, 0, { axis: 'y', speed: 4 });
        for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; arcs.glow(BX(0.5, 0.025, 0.025), '#dff6ff', Math.cos(a) * 0.4, (i % 2) * 0.1, Math.sin(a) * 0.4, 0, -a, 0.6 * (i % 2 ? 1 : -1)); }
        break;
      }
      case 'bomb': {
        st.lit(CY(0.8, 0.95, 0.55, 12), P.main, 0, 0.28, 0).lit(CY(0.78, 0.78, 0.08, 12), P.trim, 0, 0.58, 0);
        for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; st.lit(SP(0.17, 7, 5), '#b9a37a', Math.cos(a) * 0.86, 0.66 + (i % 2) * 0.04, Math.sin(a) * 0.86, 0, -a, 0, 1.2, 0.6, 0.8); }
        for (const [x, z] of [[0.62, 0.55], [0.48, 0.66], [0.56, 0.62]]) st.lit(SP(0.11, 8, 6), '#202024', x, 0.72, z);
        st.lit(SP(0.11, 8, 6), '#202024', 0.55, 0.88, 0.6);
        const tu = prt('turret', 0, 0.66, 0);
        tu.lit(CY(0.34, 0.4, 0.16, 12), P.metal, 0, 0.06, 0)
          .lit(CY(0.3, 0.36, 0.8, 14), '#26262c', 0.16, 0.38, 0, 0, 0, -Math.PI / 4)
          .lit(TO(0.31, 0.04, 5, 14), P.metal, 0.4, 0.62, 0, Math.PI / 2, 0, -Math.PI / 4)
          .lit(CY(0.27, 0.27, 0.02, 14), '#050505', 0.44, 0.66, 0, 0, 0, -Math.PI / 4);
        break;
      }
      case 'mine': {
        st.lit(BX(1.9, 0.2, 1.9), P.stone, 0, 0.1, 0);
        for (const [x, z, r] of [[-0.6, -0.6, 0.32], [0.65, -0.55, 0.28], [-0.65, 0.6, 0.26]]) st.lit(DO(r), '#7a6a54', x, r * 0.6, z, x, z, 0, 1, 0.8, 1, 0.12);
        for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) st.lit(BX(0.09, 2.2, 0.09), P.metal, x * 0.8, 1.2, z * 0.8, z * 0.18, 0, -x * 0.18);
        for (let h = 0; h < 4; h++) for (const s of [-1, 1]) st.lit(BX(0.75 - h * 0.12, 0.04, 0.04), P.dark, 0, 0.5 + h * 0.5, s * (0.36 - h * 0.06)).lit(BX(0.04, 0.04, 0.75 - h * 0.12), P.dark, s * (0.36 - h * 0.06), 0.5 + h * 0.5, 0);
        st.lit(BX(0.4, 0.2, 0.4), P.trim, 0, 2.35, 0).glow(SP(0.05, 5, 4), '#ff3a2a', 0, 2.5, 0);
        st.lit(BX(0.5, 0.4, 0.5), P.main, 0.6, 0.4, 0.55).lit(CY(0.06, 0.06, 0.6, 6), '#3a3a40', 0.75, 0.9, 0.7);
        for (let i = 0; i < 4; i++) { st.lit(OC(0.07), '#ffd36b', -0.2 + (i % 2) * 0.4, 0.3, 0.6 + (i >> 1) * 0.15, i, i, 0, 0.9, 1.4, 0.9, 0.15); }
        glow(0, 0.35, 0.65, 0.6, '#ffd36b', true, false);
        const drill = prt('spin', 0, 0.9, 0, { axis: 'y', speed: 3 + lvl });
        drill.lit(CY(0.06, 0.06, 1.6, 6), P.metal, 0, 0.4, 0).lit(CO(0.16, 0.5, 8), '#c8c8d0', 0, -0.55, 0, Math.PI, 0, 0);
        for (let i = 0; i < 3; i++) drill.lit(BX(0.3, 0.04, 0.06), '#9a9aa4', 0, -0.4 + i * 0.12, 0, 0, i * 1.0, 0.3);
        st.glow(TO(0.22, 0.03, 4, 16), '#ffb050', 0, 0.12, 0, Math.PI / 2, 0, 0);
        break;
      }
      case 'harv': {
        st.lit(BX(1.84, 0.18, 1.84), '#6b4a2a', 0, 0.09, 0);
        for (let i = 0; i < 6; i++) st.lit(BX(1.86, 0.02, 0.02), '#4a3018', 0, 0.185, -0.75 + i * 0.3, 0, 0, 0, 1, 1, 1, 0);
        st.lit(BX(0.62, 0.58, 0.62), P.main, 0.45, 0.47, -0.45).lit(BX(0.66, 0.06, 0.66), P.trim, 0.45, 0.78, -0.45)
          .lit(CY(0.08, 0.1, 0.6, 8), '#3a3a40', 0.6, 1.05, -0.6).lit(CY(0.11, 0.11, 0.06, 8), P.metal, 0.6, 1.35, -0.6)
          .lit(CY(0.13, 0.13, 0.04, 10), P.metal, 0.17, 0.5, -0.45, 0, 0, Math.PI / 2);
        for (let i = 0; i < 3; i++) st.lit(CY(0.11, 0.11, 0.8, 8), i % 2 ? '#8a5a30' : '#7a5028', -0.45, 0.3 + (i === 2 ? 0.18 : 0), 0.45 + (i === 2 ? 0 : (i ? 0.12 : -0.12)), 0, 0, Math.PI / 2)
          .lit(CY(0.09, 0.09, 0.81, 8), '#c8a070', -0.45, 0.3 + (i === 2 ? 0.18 : 0), 0.45 + (i === 2 ? 0 : (i ? 0.12 : -0.12)), 0, 0, Math.PI / 2, 1, 1, 1, 0);
        for (const [x, z, sp] of [[0.45, 0.45, 1], [-0.45, -0.45, -1]]) {
          st.lit(CY(0.08, 0.1, 0.4, 6), P.metal, x, 0.38, z);
          const saw = prt('spin', x, 0.62, z, { axis: 'y', speed: sp * (3 + lvl) });
          saw.lit(CY(0.38, 0.38, 0.05, 18), '#c8c8d0', 0, 0, 0).lit(CY(0.12, 0.12, 0.07, 8), P.trim, 0, 0, 0);
          for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; saw.lit(CO(0.05, 0.12, 3), '#9a9aa4', Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42, 0, -a, -Math.PI / 2); }
        }
        break;
      }
      case 'heal': {
        st.lit(BX(1.84, 0.16, 1.84), P.stone, 0, 0.08, 0);
        st.lit(BX(1.5, 0.9, 1.0), '#d8dcd8', 0, 0.61, -0.2).lit(BX(1.54, 0.08, 1.04), P.trim, 0, 1.08, -0.2);
        for (let i = 0; i < 7; i++) st.lit(BX(0.03, 0.88, 1.02), '#b8bcb8', -0.66 + i * 0.22, 0.61, -0.2, 0, 0, 0, 1, 1, 1, 0);
        st.lit(BX(0.5, 0.15, 0.04), '#d02a2a', 0, 0.75, 0.31).lit(BX(0.15, 0.5, 0.04), '#d02a2a', 0, 0.75, 0.31);
        st.lit(BX(0.4, 0.6, 0.04), '#2a3a3a', 0.5, 0.45, 0.31).glow(BX(0.3, 0.08, 0.05), '#7dffb0', 0.5, 0.65, 0.33);
        for (let i = 0; i < 3; i++) st.lit(CY(0.12, 0.12, 0.4, 10), i ? '#4a8a5a' : '#2a6a8a', -0.55 + i * 0.3, 0.36, 0.6);
        st.lit(BX(0.04, 0.8, 0.04), '#5a5a5a', 0.6, 1.5, -0.6).glow(SP(0.05, 5, 4), '#3aff6a', 0.6, 1.92, -0.6);
        glow(0, 0.6, 0.4, 1.3, '#7dffb0', true, false);
        st.lit(BX(0.4, 0.06, 0.4), P.trim, 0, 1.15, -0.2).lit(CY(0.045, 0.06, 0.42, 8), '#5a5a5a', 0, 1.36, -0.2).lit(CY(0.09, 0.09, 0.05, 8), P.metal, 0, 1.52, -0.2);
        const cr = prt('bob', 0, 1.8, -0.2, { spin: 1.2, bobA: 0 });
        cr.lit(CY(0.04, 0.04, 0.3, 6), '#7a7a7a', 0, -0.18, 0);
        cr.glow(BX(0.16, 0.5, 0.16), '#3fe07a', 0, 0, 0).glow(BX(0.5, 0.16, 0.16), '#3fe07a', 0, 0, 0);
        glow(0, 1.8, -0.2, 1.4, '#5fff8a', false, false).bob = true;
        break;
      }
      case 'frost': {
        st.lit(CY(0.9, 1.0, 0.22, 10), '#d8e8f0', 0, 0.11, 0);
        for (let i = 0; i < 7; i++) { const a = i / 7 * TAU; st.lit(DO(0.2 + (i % 3) * 0.05), i % 2 ? '#bfe0f0' : '#a8d0e8', Math.cos(a) * 0.72, 0.28, Math.sin(a) * 0.72, a, a, 0, 1, 0.8, 1, 0.1); }
        st.lit(CY(0.32, 0.45, 0.5, 6), P.main, 0, 0.45, 0).lit(CY(0.48, 0.48, 0.08, 6), P.trim, 0, 0.72, 0);
        for (const s of [-1, 1]) { st.lit(CY(0.2, 0.2, 0.9, 10), '#9aa8b4', s * 0.62, 0.6, -0.45).glow(CY(0.21, 0.21, 0.05, 10), '#7fd8ff', s * 0.62, 0.75, -0.45).lit(SP(0.2, 8, 5, 0, TAU, 0, Math.PI / 2), '#b8c4ce', s * 0.62, 1.05, -0.45); }
        for (let i = 0; i < 5; i++) { const a = i / 5 * TAU, r = i ? 0.22 : 0; st.lit(OC(0.16 + (i ? 0 : 0.06)), i % 2 ? '#cdeeff' : '#9fd6f5', Math.cos(a) * r, 1.2 + (i ? 0 : 0.3), Math.sin(a) * r, Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4, 1, i ? 3.4 : 4, 1, 0.12); }
        st.glow(TO(0.7, 0.03, 4, 28), '#9fe6ff', 0, 0.3, 0, Math.PI / 2, 0, 0);
        glow(0, 1.4, 0, 1.6, '#7fd8ff', false, false);
        const cr = prt('bob', 0, 2.42, 0, { spin: 0.8, bobA: 0 });
        cr.glow(OC(0.22), '#e8fbff', 0, 0, 0, 0, 0, 0, 1, 1.6, 1, 0.06);
        for (let i = 0; i < 6; i++) cr.glow(BX(0.04, 0.36, 0.04), '#bfefff', 0, 0, 0, 0, 0, i * Math.PI / 3);
        glow(0, 2.42, 0, 1.4, '#bfefff', false, false).bob = true;
        const orb = prt('spin', 0, 1.9, 0, { axis: 'y', speed: 1.4 });
        orb.lit(TO(0.7, 0.025, 4, 28), '#9aa8b4', 0, 0, 0, Math.PI / 2, 0, 0).lit(CY(0.12, 0.12, 0.08, 8), P.trim, 0, 0, 0);
        for (let i = 0; i < 4; i++) { const a = i / 4 * TAU; orb.lit(BX(0.62, 0.03, 0.03), '#9aa8b4', Math.cos(a) * 0.38, 0, Math.sin(a) * 0.38, 0, -a, 0).lit(OC(0.08), '#dff6ff', Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7, 0, 0, 0, 1, 2, 1); }
        break;
      }
    }
    for (const p of parts) { const g = p.kit.build(); p.lit = g.lit || null; p.glow = g.glow || null; delete p.kit; }
    return { parts, glows: glowsS };
  }
  function makeBuilding(b) {
    const spec = specFor(b.type, b.lvl), grp = new T.Group(), mat = matLit.clone(), anims = [];
    for (const p of spec.parts) {
      const sub = new T.Group(); sub.position.set(p.x, p.y, p.z); grp.add(sub);
      if (p.lit) { const m = new T.Mesh(p.lit, mat); m.castShadow = true; m.receiveShadow = true; sub.add(m); }
      if (p.glow) sub.add(new T.Mesh(p.glow, matGlow));
      anims.push({ o: sub, p });
    }
    grp.userData = { lvl: b.lvl, type: b.type, anims, mat, spec };
    scene.add(grp);
    return grp;
  }
  function disposeGroup(grp) { scene.remove(grp); if (grp.userData.mat) grp.userData.mat.dispose(); }
  function ghostFor(type) {
    let o = ghostObjs.get(type);
    if (o) return o;
    o = new T.Group();
    for (const p of specFor(type, 1).parts) for (const g of [p.lit, p.glow]) if (g) { const m = new T.Mesh(g, ghostMat); m.position.set(p.x, p.y, p.z); o.add(m); }
    o.visible = false; scene.add(o); ghostObjs.set(type, o);
    return o;
  }

  // ---------------------------------------------------------------- Spieler-Modell
  const toolCache = {};
  function toolKit(id) {
    if (toolCache[id]) return toolCache[id];
    const k = new Kit(), W = '#7a5530', D = '#4a3018', GO = '#c9a227';
    switch (id) {
      case 'sword': {
        // Schrott-Machete: umwickelter Griff, Zahnrad-Parierstange, Klinge mit Sägerücken
        for (let i = 0; i < 4; i++) k.lit(CY(0.032, 0.032, 0.035, 6), i % 2 ? '#2a2a2a' : '#8a3a2a', -0.06 + i * 0.04, 0, 0, 0, 0, Math.PI / 2);
        k.lit(SP(0.04, 6, 5), '#5a4a3a', -0.11, 0, 0).add('metal', CY(0.075, 0.075, 0.03, 8), '#ffffff', 0.04, 0, 0, Math.PI / 2, 0, 0)
          .lit(CY(0.02, 0.02, 0.035, 6), '#3a3a3a', 0.04, 0, 0, Math.PI / 2, 0, 0)
          .add('metal', BX(0.6, 0.02, 0.1), '#ffffff', 0.37, 0, 0.005).add('metal', CO(0.058, 0.14, 4), '#ffffff', 0.72, 0, 0.005, Math.PI / 4, 0, -Math.PI / 2, 1, 1, 0.45)
          .lit(BX(0.5, 0.022, 0.012), '#3a3a3e', 0.36, 0, 0.02);
        for (let i = 0; i < 6; i++) k.add('metal', CO(0.018, 0.04, 3), '#d8d8d8', 0.14 + i * 0.075, 0, -0.058, -Math.PI / 2, 0, 0);
        k.lit(BX(0.08, 0.024, 0.03), '#7a1a10', 0.5, 0, 0.03).lit(BX(0.04, 0.024, 0.02), '#6a1410', 0.62, 0, 0.035);
        break;
      }
      case 'pick':
        // Rohr-Spitzhacke mit Klebeband, Schraube und Stahlkopf
        k.lit(CY(0.026, 0.026, 0.66, 6), '#6a6e76', 0.3, 0, 0, 0, 0, Math.PI / 2)
          .lit(CY(0.03, 0.03, 0.12, 6), '#2a2a2a', 0.02, 0, 0, 0, 0, Math.PI / 2).lit(CY(0.03, 0.03, 0.05, 6), '#c8a040', 0.4, 0, 0, 0, 0, Math.PI / 2)
          .add('metal', BX(0.1, 0.09, 0.12), '#ffffff', 0.6, 0, 0).lit(CY(0.02, 0.02, 0.13, 6), '#3a3a3a', 0.6, 0, 0, Math.PI / 2, 0, 0)
          .add('metal', CO(0.04, 0.3, 5), '#ffffff', 0.59, 0, 0.21, Math.PI / 2 - 0.25, 0, 0).add('metal', CO(0.03, 0.22, 4), '#ffffff', 0.6, 0, -0.17, -Math.PI / 2 + 0.2, 0, 0, 1.6, 1, 0.6);
        break;
      case 'axe':
        // Kriegsaxt aus einem Sägeblatt mit Dorn am Rücken
        k.lit(CY(0.028, 0.032, 0.86, 6), '#5a3a1e', 0.36, 0, 0, 0, 0, Math.PI / 2);
        for (let i = 0; i < 3; i++) k.lit(CY(0.034, 0.034, 0.04, 6), '#2a2a2a', 0.04 + i * 0.06, 0, 0, 0, 0, Math.PI / 2);
        k.lit(BX(0.12, 0.08, 0.08), '#3a3a3a', 0.72, 0, 0)
          .add('metal', CY(0.23, 0.23, 0.03, 16), '#ffffff', 0.7, 0, 0.16, 0, 0, 0, 0.75, 1, 1).lit(CY(0.05, 0.05, 0.035, 8), '#3a3a3a', 0.7, 0, 0.06);
        for (let i = 0; i < 8; i++) { const an = -0.9 + i * 0.26; k.add('metal', CO(0.025, 0.06, 3), '#e8e8e8', 0.7 + Math.cos(an) * 0.18, 0, 0.16 + Math.sin(an) * 0.24 + 0.02, 0, 0, 0, 1, 1, 1); }
        k.add('metal', CO(0.04, 0.18, 4), '#ffffff', 0.71, 0, -0.13, -Math.PI / 2, 0, 0).lit(BX(0.06, 0.03, 0.08), '#7a1a10', 0.62, 0.01, 0.26);
        break;
      case 'spear':
        // Speer: Schaft mit Klebeband, Blattspitze, Querstrebe und roter Stofffahne
        k.lit(CY(0.022, 0.024, 1.25, 6), '#6a4a2a', 0.38, 0, 0, 0, 0, Math.PI / 2);
        for (let i = 0; i < 3; i++) k.lit(CY(0.027, 0.027, 0.04, 6), '#2a2a2a', 0.1 + i * 0.05, 0, 0, 0, 0, Math.PI / 2);
        k.lit(CY(0.034, 0.034, 0.1, 6), '#3a3a3a', 0.98, 0, 0, 0, 0, Math.PI / 2).add('metal', BX(0.03, 0.03, 0.18), '#ffffff', 1.02, 0, 0)
          .add('metal', OC(0.075), '#ffffff', 1.16, 0, 0, 0, 0, 0, 2.6, 0.35, 1)
          .lit(BX(0.04, 0.16, 0.012), '#b03a2a', 0.94, -0.09, 0.03, 0, 0, 0.2).lit(BX(0.04, 0.12, 0.012), '#8a2a1e', 0.9, -0.15, 0.03, 0, 0, 0.5);
        break;
      case 'bow':
        // Armbrust: Schaft, gebogene Wurfarme, Sehne, eingelegter Bolzen, Zielfernrohr
        k.lit(BX(0.62, 0.06, 0.07), '#6a4526', 0.18, -0.01, 0).lit(BX(0.16, 0.12, 0.07), '#5a3a1e', -0.1, -0.04, 0)
          .lit(BX(0.04, 0.08, 0.03), '#2a2a2a', 0.08, -0.07, 0).lit(BX(0.1, 0.03, 0.06), '#3a3a3a', 0.43, 0.025, 0)
          .add('metal', BX(0.05, 0.035, 0.3), '#ffffff', 0.45, 0, 0.16, 0, 0.45, 0).add('metal', BX(0.05, 0.035, 0.3), '#ffffff', 0.45, 0, -0.16, 0, -0.45, 0)
          .lit(BX(0.43, 0.008, 0.008), '#e8e8e8', 0.357, 0.03, 0.147, 0, -0.75, 0).lit(BX(0.43, 0.008, 0.008), '#e8e8e8', 0.357, 0.03, -0.147, 0, 0.75, 0)
          .lit(BX(0.48, 0.014, 0.014), '#c8a070', 0.3, 0.04, 0).add('metal', CO(0.022, 0.07, 4), '#ffffff', 0.57, 0.04, 0, 0, 0, -Math.PI / 2)
          .lit(BX(0.04, 0.006, 0.03), '#d84a3a', 0.08, 0.045, 0)
          .lit(CY(0.022, 0.022, 0.2, 8), '#2a2a2e', 0.18, 0.08, 0, 0, 0, Math.PI / 2).lit(BX(0.03, 0.04, 0.02), '#2a2a2e', 0.18, 0.05, 0);
        k.glow(CY(0.016, 0.016, 0.005, 8), '#ff5a3a', 0.281, 0.08, 0, 0, 0, Math.PI / 2);
        break;
      case 'staff':
        // Plasmawerfer: Lauf mit Kühlrippen, leuchtende Energiezellen, Mündung mit Zinken
        k.lit(CY(0.045, 0.05, 0.62, 8), '#3a3e46', 0.42, 0, 0, 0, 0, Math.PI / 2)
          .lit(BX(0.26, 0.1, 0.09), '#4a4e56', 0.08, -0.02, 0).lit(BX(0.07, 0.16, 0.06), '#2a2a2e', 0.02, -0.12, 0, 0, 0, 0.25)
          .lit(BX(0.05, 0.06, 0.04), '#2a2a2e', 0.12, -0.08, 0);
        for (let i = 0; i < 4; i++) k.add('metal', CY(0.065, 0.065, 0.025, 10), '#ffffff', 0.32 + i * 0.07, 0, 0, 0, 0, Math.PI / 2);
        k.lit(CY(0.05, 0.05, 0.2, 8), '#2a2a2e', 0.12, 0.09, 0, 0, 0, Math.PI / 2).glow(CY(0.035, 0.035, 0.17, 8), '#ffb347', 0.12, 0.09, 0, 0, 0, Math.PI / 2)
          .lit(CY(0.065, 0.05, 0.08, 8), '#4a4e56', 0.76, 0, 0, 0, 0, Math.PI / 2);
        for (let i = 0; i < 3; i++) { const a = i / 3 * TAU; k.add('metal', CO(0.02, 0.12, 4), '#ffffff', 0.84, Math.cos(a) * 0.05, Math.sin(a) * 0.05, a, 0, -Math.PI / 2 + 0.3); }
        k.glow(IC(0.05, 1), '#ffb347', 0.86, 0, 0).glow(CY(0.047, 0.047, 0.02, 8), '#ff8a2a', 0.58, 0, 0, 0, 0, Math.PI / 2);
        break;
    }
    return (toolCache[id] = k.build());
  }
  function makePlayer(p) {
    const pc = G.PLAYER_COL[p.id % G.PLAYER_COL.length] || G.PLAYER_COL[0];
    const grp = new T.Group(), body = new T.Group(); grp.add(body);
    const mat = matLit.clone(), metal = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, color: '#dfe6ee', emissive: '#1a1a1a' });
    const mesh = (g, parent, x, y, z, m) => { const o = new T.Mesh(g, m || mat); o.position.set(x || 0, y || 0, z || 0); o.castShadow = true; (parent || body).add(o); return o; };
    const dark = '#' + col.set(pc).offsetHSL(0, 0, -0.12).getHexString();
    const hair = ['#5a3a1a', '#2a1a10', '#c8902a', '#8a3a1a'][p.id % 4];
    // Bein: Cargohose mit Knieschoner, schwere Stiefel
    const legG = new Kit().lit(BX(0.13, 0.32, 0.14), '#3a3f4a', 0, -0.16, 0).lit(BX(0.04, 0.08, 0.06), '#2e323a', 0.0, -0.1, 0.075)
      .lit(BX(0.04, 0.09, 0.11), '#6a6e76', 0.07, -0.2, 0).lit(BX(0.15, 0.1, 0.16), '#4a3020', 0.01, -0.32, 0)
      .lit(BX(0.22, 0.09, 0.16), '#3a2618', 0.035, -0.39, 0).lit(BX(0.23, 0.03, 0.17), '#151010', 0.035, -0.44, 0).build().lit;
    const legs = [];
    for (const s of [-1, 1]) { const g = new T.Group(); g.position.set(0, 0.45, s * 0.09); body.add(g); mesh(legG, g); legs.push(g); }
    // Jacke, Schal, Gürtel mit Taschen, Schulterpanzer, Rucksack mit Schlafsack und Funkantenne
    mesh(new Kit()
      .lit(BX(0.24, 0.4, 0.38), pc, 0, 0.66, 0).lit(BX(0.012, 0.34, 0.03), dark, 0.122, 0.67, 0).lit(BX(0.02, 0.1, 0.1), dark, 0.122, 0.62, 0.12)
      .lit(BX(0.26, 0.07, 0.4), '#4a3020', 0, 0.48, 0).lit(BX(0.02, 0.05, 0.07), '#c8a040', 0.135, 0.48, 0)
      .lit(BX(0.08, 0.1, 0.08), '#5a4a2e', 0.1, 0.47, 0.15).lit(BX(0.08, 0.1, 0.08), '#5a4a2e', 0.1, 0.47, -0.15).lit(BX(0.06, 0.12, 0.06), '#4a3e28', -0.02, 0.46, 0.2)
      .lit(BX(0.26, 0.08, 0.3), '#b0402a', 0.01, 0.89, 0).lit(BX(0.03, 0.2, 0.07), '#9a3422', 0.12, 0.78, 0.09, 0.15, 0, 0.1)
      .lit(BX(0.18, 0.07, 0.15), '#6a5e52', 0, 0.88, 0.2, -0.35, 0, 0).lit(BX(0.18, 0.07, 0.15), '#6a5e52', 0, 0.88, -0.2, 0.35, 0, 0)
      .lit(BX(0.19, 0.03, 0.16), '#8a4a2a', 0, 0.84, 0.215, -0.35, 0, 0).lit(BX(0.19, 0.03, 0.16), '#8a4a2a', 0, 0.84, -0.215, 0.35, 0, 0)
      .lit(BX(0.16, 0.32, 0.3), '#5a4a2a', -0.2, 0.68, 0).lit(BX(0.17, 0.09, 0.31), '#4a3a20', -0.2, 0.82, 0).lit(BX(0.04, 0.12, 0.2), '#4a3a20', -0.29, 0.6, 0)
      .lit(CY(0.075, 0.075, 0.36, 8), '#7a3a2a', -0.22, 0.93, 0, Math.PI / 2, 0, 0).lit(CY(0.078, 0.078, 0.03, 8), '#2a2018', -0.22, 0.93, 0.1, Math.PI / 2, 0, 0)
      .lit(CY(0.008, 0.008, 0.42, 4), '#2a2a2a', -0.27, 1.08, 0.11).build().lit);
    mesh(new Kit().glow(SP(0.022, 5, 4), '#ff3a2a', -0.27, 1.3, 0.11).build().glow, body, 0, 0, 0, matGlow);
    const head = new T.Group(); head.position.set(0, 1.03, 0); body.add(head);
    mesh(new Kit()
      .lit(BX(0.27, 0.27, 0.27), '#f0c9a0', 0, 0, 0).lit(BX(0.29, 0.09, 0.29), hair, -0.01, 0.13, 0).lit(BX(0.1, 0.22, 0.29), hair, -0.1, 0.03, 0)
      .lit(BX(0.02, 0.05, 0.04), '#1a1a2a', 0.136, 0.02, 0.06).lit(BX(0.02, 0.05, 0.04), '#1a1a2a', 0.136, 0.02, -0.06)
      .lit(BX(0.04, 0.05, 0.04), '#e0b088', 0.15, -0.03, 0).lit(BX(0.02, 0.015, 0.06), '#a06a50', 0.137, -0.08, 0)
      .lit(BX(0.285, 0.035, 0.285), '#2a2622', 0, 0.065, 0)
      .lit(CY(0.05, 0.05, 0.05, 8), '#5a4a3a', 0.15, 0.065, 0.065, 0, 0, Math.PI / 2).lit(CY(0.05, 0.05, 0.05, 8), '#5a4a3a', 0.15, 0.065, -0.065, 0, 0, Math.PI / 2)
      .build().lit, head);
    mesh(new Kit().glow(CY(0.038, 0.038, 0.012, 8), '#ffb347', 0.176, 0.065, 0.065, 0, 0, Math.PI / 2).glow(CY(0.038, 0.038, 0.012, 8), '#ffb347', 0.176, 0.065, -0.065, 0, 0, Math.PI / 2).build().glow, head, 0, 0, 0, matGlow);
    const helm = mesh(new Kit().add('metal', SP(0.17, 10, 6, 0, TAU, 0, Math.PI / 2), '#ffffff', 0, 0.06, 0).add('metal', BX(0.36, 0.03, 0.36), '#ffffff', 0, 0.05, 0)
      .lit(CO(0.03, 0.14, 5), '#c0392b', 0, 0.26, 0).build().metal, head, 0, 0, 0, metal);
    const arms = [];
    const armG = new Kit().lit(BX(0.1, 0.2, 0.1), pc, 0, -0.1, 0).lit(BX(0.115, 0.1, 0.115), '#6a5e52', 0, -0.22, 0).lit(BX(0.118, 0.02, 0.118), '#8a4a2a', 0, -0.2, 0)
      .lit(BX(0.11, 0.1, 0.11), '#3a2a1a', 0, -0.32, 0).build().lit;
    for (const s of [-1, 1]) { const g = new T.Group(); g.position.set(0, 0.82, s * 0.25); body.add(g); mesh(armG, g); arms.push(g); }
    const tool = new T.Group(); tool.position.set(0.28, 0.52, 0.28); body.add(tool);
    const tools = {};
    for (const id of ['pick', 'sword', 'bow', 'spear', 'axe', 'staff']) {
      const tg = new T.Group(), k = toolKit(id);
      if (k.lit) mesh(k.lit, tg); if (k.metal) mesh(k.metal, tg, 0, 0, 0, metal); if (k.glow) tg.add(new T.Mesh(k.glow, matGlow));
      tool.add(tg); tools[id] = tg;
    }
    const sh = new T.Mesh(geo('shadowDisc', () => new T.CircleGeometry(0.3, 16).rotateX(-Math.PI / 2)), new T.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.25, depthWrite: false }));
    sh.position.y = 0.02; grp.add(sh);
    scene.add(grp);
    grp.userData = { body, legs, arms, head, helm, tool, tools, mat, metal };
    return grp;
  }

  // Waffe in der Hand (Ego-Perspektive)
  function updateFpView(p, at) {
    if (!fpTools) {
      fpTools = {}; fpMetal = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, color: '#dfe6ee', emissive: '#1a1a1a' });
      const hand = new T.Mesh(new Kit().lit(BX(0.12, 0.12, 0.2), '#f0c9a0', 0, 0, 0.05).lit(BX(0.14, 0.14, 0.3), '#3a6ea8', 0, -0.02, 0.28).build().lit, matLit);
      fpView.add(hand);
      for (const id of ['pick', 'sword', 'bow', 'spear', 'axe', 'staff']) {
        const tg = new T.Group(), k = toolKit(id);
        if (k.lit) tg.add(new T.Mesh(k.lit, matLit)); if (k.metal) tg.add(new T.Mesh(k.metal, fpMetal)); if (k.glow) tg.add(new T.Mesh(k.glow, matGlow));
        tg.rotation.set(0, Math.PI / 2, id === 'bow' ? 0 : 0.5); tg.position.set(0, 0, 0);
        fpView.add(tg); fpTools[id] = tg;
      }
      fpView.traverse(o => { o.renderOrder = 10; if (o.material) { o.material = o.material; } });
    }
    for (const k in fpTools) fpTools[k].visible = k === p.tool;
    const swp = p.swing > 0 ? Math.sin((1 - p.swing / 0.22) * Math.PI) : 0;
    const w = walkPh.get('p' + p.id) || { ph: 0, mv: 0 };
    fpView.position.set(0.3 + Math.sin(w.ph) * 0.015 * w.mv, -0.32 + Math.abs(Math.cos(w.ph)) * 0.015 * w.mv, -0.5 - (p.tool === 'spear' ? swp * 0.35 : 0));
    fpView.rotation.set(p.tool === 'spear' || p.tool === 'bow' || p.tool === 'staff' ? 0 : -swp * 1.3, p.tool === 'axe' ? swp * 1.2 : 0, p.tool === 'pick' ? swp * 0.4 : 0);
    const lv = (p.tl && p.tl[p.tool]) || 1;
    fpMetal.color.set(G.TMET[Math.min(4, lv - 1)]);
  }

  // ---------------------------------------------------------------- Icons aus den echten 3D-Modellen
  let iconR = null, iconScene = null, iconCam = null, iconBudget = 0;
  const iconCache = new Map();
  function iconSetup() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    iconR = new T.WebGLRenderer({ canvas: c, alpha: true, antialias: true, preserveDrawingBuffer: true });
    iconR.setPixelRatio(1); iconR.setSize(128, 128, false);
    iconR.toneMapping = T.ACESFilmicToneMapping; iconR.toneMappingExposure = 1.15;
    iconScene = new T.Scene();
    iconScene.add(new T.HemisphereLight(0xfff4e8, 0x40342c, 1.7));
    const d = new T.DirectionalLight(0xffffff, 2.4); d.position.set(3, 6, 4); iconScene.add(d);
    const r = new T.DirectionalLight(0xff9a50, 1.0); r.position.set(-4, 2, -3); iconScene.add(r);
    iconCam = new T.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  }
  function iconModel(kind, id, lvl) {
    const grp = new T.Group();
    const add = (geom, mat, x, y, z) => { const m = new T.Mesh(geom, mat); m.position.set(x || 0, y || 0, z || 0); grp.add(m); return m; };
    if (kind === 'b') {
      for (const p of specFor(id, lvl).parts) { if (p.lit) add(p.lit, matLit, p.x, p.y, p.z); if (p.glow) add(p.glow, matGlow, p.x, p.y, p.z); }
    } else if (kind === 't') {
      const k = toolKit(id), metal = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, color: G.TMET[Math.min(4, lvl - 1)], emissive: '#222' });
      if (k.lit) add(k.lit, matLit); if (k.metal) add(k.metal, metal); if (k.glow) add(k.glow, matGlow);
      grp.rotation.set(0, Math.PI / 4, 0);
    } else if (kind === 'f') {
      const k = new Kit().lit(BX(0.9, 0.18, 0.4), '#5a5e66', 0.05, 0.62, 0).lit(CO(0.2, 0.42, 4), '#6a6e76', 0.62, 0.62, 0, 0, Math.PI / 4, -Math.PI / 2, 1, 1, 0.7)
        .lit(BX(0.36, 0.34, 0.3), '#4a4e56', 0, 0.36, 0).lit(BX(0.62, 0.16, 0.48), '#3a3e46', 0, 0.1, 0)
        .lit(BX(0.5, 0.06, 0.06), '#7a5530', 0.1, 0.95, 0.2, 0, 0, 0.5).lit(BX(0.14, 0.12, 0.16), '#8a8e96', 0.32, 1.06, 0.2, 0, 0, 0.5)
        .glow(OC(0.06), '#ffb347', -0.25, 0.8, 0.1).glow(OC(0.05), '#ff8a2a', 0.35, 0.85, -0.1).build();
      add(k.lit, matLit); add(k.glow, matGlow); grp.rotation.y = -0.4;
    } else if (kind === 'r') {
      const k = new Kit();
      if (id === 'w') k.lit(CY(0.22, 0.22, 0.9, 8), '#7a5028', 0, 0.22, 0, 0, 0, Math.PI / 2).lit(CY(0.2, 0.2, 0.92, 8), '#c8a070', 0, 0.22, 0, 0, 0, Math.PI / 2, 1, 1, 1, 0)
        .lit(CY(0.18, 0.18, 0.8, 8), '#6a4420', 0.1, 0.52, 0.12, 0, 0.3, Math.PI / 2);
      else if (id === 's') k.lit(DO(0.42), '#8d8a84', 0, 0.35, 0, 0.3, 0.5, 0).lit(DO(0.24), '#a8a49c', 0.4, 0.2, 0.2, 0.7, 0, 0);
      else if (id === 'g') k.lit(OC(0.2), '#f6d05a', 0, 0.35, 0, 0, 0, 0, 1, 2, 1, 0.1).lit(OC(0.16), '#ffe27a', 0.25, 0.25, 0.1, 0, 0, -0.5, 1, 1.8, 1, 0.1).lit(OC(0.14), '#e2b23a', -0.22, 0.22, -0.05, 0.4, 0, 0.5, 1, 1.7, 1, 0.1);
      else k.lit(BX(0.8, 0.22, 0.36), '#9aa4b0', 0, 0.12, 0, 0, 0, 0, 1, 1, 1, 0.05).lit(BX(0.62, 0.06, 0.26), '#c8d0dc', 0, 0.26, 0).lit(BX(0.8, 0.22, 0.36), '#7a848e', 0.1, 0.36, 0.05, 0, 0.3, 0);
      add(k.build().lit, matLit);
    }
    return grp;
  }
  R3.icon = function (kind, id, lvl) {
    lvl = lvl || 1;
    const key = kind + ':' + id + ':' + lvl;
    if (iconCache.has(key)) return iconCache.get(key);
    if (!R3.ready || iconBudget <= 0) return null;
    iconBudget--;
    if (!iconR) iconSetup();
    const grp = iconModel(kind, id, lvl);
    iconScene.add(grp); grp.updateMatrixWorld(true);
    const sph = new T.Box3().setFromObject(grp).getBoundingSphere(new T.Sphere());
    const r = sph.radius * (kind === 't' ? 0.8 : 1.0);
    iconCam.left = -r; iconCam.right = r; iconCam.top = r; iconCam.bottom = -r; iconCam.near = 0.01; iconCam.far = r * 20;
    iconCam.position.copy(sph.center).addScaledVector((kind === 't' ? new T.Vector3(0.12, 1, 0.3) : new T.Vector3(1, 0.95, 1.3)).normalize(), r * 5);
    iconCam.lookAt(sph.center); iconCam.updateProjectionMatrix();
    iconR.setClearColor(0x000000, 0); iconR.clear(); iconR.render(iconScene, iconCam);
    const out = document.createElement('canvas'); out.width = out.height = 128;
    out.getContext('2d').drawImage(iconR.domElement, 0, 0);
    iconScene.remove(grp);
    iconCache.set(key, out);
    return out;
  };

  // ---------------------------------------------------------------- Tier-Modelle
  function makeAnimal(an) {
    // Modelle in Einheiten des Tier-Radius gebaut, dann skaliert. Blick nach +x.
    const D = G.ADEF[an.type], grp = new T.Group(), s = an.r / G.TS;
    const body = new T.Group(); body.scale.setScalar(s * 1.15); grp.add(body);
    const mat = matLit.clone(), fc = D.color;
    const c = new T.Color(fc), lt = '#' + c.clone().offsetHSL(0, -0.05, 0.14).getHexString(), dk = '#' + c.clone().offsetHSL(0, 0, -0.12).getHexString();
    const add = (geom, parent, x, y, z) => { const o = new T.Mesh(geom, mat); o.position.set(x || 0, y || 0, z || 0); o.castShadow = true; (parent || body).add(o); return o; };
    const legs = [];
    const leg = (x, z, L, w, hoof) => {
      const pv = new T.Group(); pv.position.set(x, L, z); body.add(pv);
      add(new Kit().lit(BX(w, L * 0.55, w), fc, 0, -L * 0.27, 0).lit(BX(w * 0.8, L * 0.45, w * 0.8), dk, 0, -L * 0.75, 0).lit(BX(w * 1.05, L * 0.1, w * 1.1), hoof, w * 0.08, -L * 0.96, 0).build().lit, pv);
      legs.push(pv);
    };
    const k = new Kit();
    let L;
    if (an.type === 'deer') {
      L = 1.3;
      k.lit(BX(1.6, 0.68, 0.7), fc, 0, L + 0.36, 0, 0, 0, 0, 1, 1, 1, 0.03).lit(BX(1.3, 0.2, 0.56), '#e8d8b8', 0.05, L + 0.05, 0)
        .lit(BX(0.12, 0.42, 0.52), '#f0e4cc', -0.81, L + 0.38, 0).lit(BX(0.14, 0.26, 0.2), '#f4ead8', -0.88, L + 0.6, 0, 0, 0, -0.5)
        .lit(BX(0.36, 0.86, 0.34), fc, 0.78, L + 0.82, 0, 0, 0, -0.5).lit(BX(0.2, 0.5, 0.3), '#e8d8b8', 0.95, L + 0.68, 0, 0, 0, -0.5)
        .lit(BX(0.56, 0.36, 0.36), fc, 1.12, L + 1.22, 0).lit(BX(0.28, 0.24, 0.28), dk, 1.45, L + 1.14, 0).lit(BX(0.06, 0.1, 0.14), '#141414', 1.6, L + 1.16, 0)
        .lit(BX(0.04, 0.07, 0.07), '#111', 1.3, L + 1.3, 0.18).lit(BX(0.04, 0.07, 0.07), '#111', 1.3, L + 1.3, -0.18);
      for (const sd of [-1, 1]) {
        k.lit(BX(0.1, 0.32, 0.16), fc, 0.95, L + 1.45, sd * 0.24, sd * 0.7, 0, 0).lit(BX(0.04, 0.24, 0.1), '#e8c0b0', 0.97, L + 1.45, sd * 0.25, sd * 0.7, 0, 0);
        // Geweih mit Enden
        k.lit(BX(0.06, 0.62, 0.06), '#d8c090', 0.98, L + 1.68, sd * 0.24, sd * 0.45, 0, 0.1)
          .lit(BX(0.05, 0.3, 0.05), '#e0caa0', 1.12, L + 1.72, sd * 0.3, sd * 0.3, 0, -0.8).lit(BX(0.05, 0.3, 0.05), '#e0caa0', 0.86, L + 1.88, sd * 0.38, sd * 0.6, 0, 0.6)
          .lit(BX(0.04, 0.24, 0.04), '#e8d4aa', 1.0, L + 2.0, sd * 0.42, sd * 0.9, 0, -0.2);
      }
      for (const [x, z] of [[-0.3, 0.2], [0.1, -0.22], [-0.5, -0.15], [0.35, 0.18]]) k.lit(BX(0.1, 0.03, 0.1), '#f0e0c0', x, L + 0.71, z);
      for (const [x, z] of [[0.6, 0.22], [0.6, -0.22], [-0.58, 0.22], [-0.58, -0.22]]) leg(x, z, L, 0.15, '#2a2018');
    } else if (an.type === 'rabbit') {
      L = 0.32;
      k.lit(SP(0.45, 8, 6), fc, -0.05, L + 0.36, 0, 0, 0, 0, 1.25, 0.95, 0.95).lit(SP(0.3, 8, 6), '#f0e8dc', 0.15, L + 0.22, 0, 0, 0, 0, 1.2, 0.7, 1)
        .lit(SP(0.33, 8, 6), fc, 0.5, L + 0.72, 0).lit(SP(0.14, 6, 5), '#f4ece0', 0.76, L + 0.62, 0)
        .lit(SP(0.05, 5, 4), '#e87a90', 0.86, L + 0.68, 0).lit(BX(0.05, 0.08, 0.06), '#111', 0.68, L + 0.82, 0.18).lit(BX(0.05, 0.08, 0.06), '#111', 0.68, L + 0.82, -0.18)
        .lit(BX(0.02, 0.03, 0.03), '#fff', 0.705, L + 0.84, 0.19).lit(BX(0.02, 0.03, 0.03), '#fff', 0.705, L + 0.84, -0.17)
        .lit(SP(0.17, 6, 5), '#ffffff', -0.62, L + 0.46, 0)
        .lit(BX(0.42, 0.12, 0.16), dk, -0.25, 0.06, 0.24).lit(BX(0.42, 0.12, 0.16), dk, -0.25, 0.06, -0.24)
        .lit(SP(0.24, 6, 5), fc, -0.3, L + 0.15, 0.26, 0, 0, 0, 1.1, 1, 0.6).lit(SP(0.24, 6, 5), fc, -0.3, L + 0.15, -0.26, 0, 0, 0, 1.1, 1, 0.6);
      for (const sd of [-1, 1]) k.lit(BX(0.1, 0.62, 0.2), fc, 0.38, L + 1.2, sd * 0.13, sd * 0.25, 0, 0.25).lit(BX(0.02, 0.46, 0.12), '#f0a8b8', 0.43, L + 1.2, sd * 0.135, sd * 0.25, 0, 0.25);
      for (const z of [0.16, -0.16]) leg(0.35, z, L, 0.11, '#f0e8dc');
    } else {
      L = 0.55;
      k.lit(BX(1.5, 0.8, 0.86), fc, -0.05, L + 0.42, 0, 0, 0, 0, 1, 1, 1, 0.04).lit(SP(0.5, 7, 5), fc, 0.25, L + 0.68, 0, 0, 0, 0, 1.4, 0.9, 1.1)
        .lit(BX(1.2, 0.18, 0.7), dk, 0, L + 0.04, 0)
        .lit(BX(0.62, 0.58, 0.6), fc, 0.86, L + 0.38, 0, 0, 0, -0.25).lit(CY(0.17, 0.2, 0.3, 8), '#8a6050', 1.26, L + 0.2, 0, 0, 0, Math.PI / 2 + 0.25)
        .lit(CY(0.17, 0.17, 0.02, 8), '#5a3a30', 1.4, L + 0.16, 0, 0, 0, Math.PI / 2 + 0.25)
        .lit(BX(0.03, 0.05, 0.05), '#1a0a0a', 1.41, L + 0.17, 0.06).lit(BX(0.03, 0.05, 0.05), '#1a0a0a', 1.41, L + 0.17, -0.06)
        .lit(BX(0.05, 0.07, 0.08), '#ffcf4a', 1.05, L + 0.55, 0.22).lit(BX(0.05, 0.07, 0.08), '#ffcf4a', 1.05, L + 0.55, -0.22)
        .lit(BX(0.05, 0.03, 0.08), '#1a0a0a', 1.08, L + 0.55, 0.22).lit(BX(0.05, 0.03, 0.08), '#1a0a0a', 1.08, L + 0.55, -0.22)
        .lit(CY(0.03, 0.03, 0.3, 4), dk, -0.85, L + 0.62, 0, 0, 0, 0.8).lit(SP(0.05, 4, 3), '#2a1a10', -0.98, L + 0.74, 0);
      for (const sd of [-1, 1]) {
        k.lit(CO(0.045, 0.3, 5), '#f4ecd8', 1.28, L + 0.32, sd * 0.2, sd * 0.4, 0, -0.5).lit(CO(0.12, 0.24, 4), dk, 0.7, L + 0.78, sd * 0.25, sd * 0.5, 0, 0.3);
      }
      for (let i = 0; i < 9; i++) k.lit(CO(0.07, 0.22 + (i % 3) * 0.05, 4), '#2a1a10', -0.6 + i * 0.16, L + 0.88 + Math.sin(i * 0.6) * 0.08 + (i > 4 ? 0.06 : 0), 0, 0, i, -0.2);
      for (const [x, z] of [[0.55, 0.26], [0.55, -0.26], [-0.55, 0.26], [-0.55, -0.26]]) leg(x, z, L, 0.2, '#1a1410');
    }
    add(k.build().lit);
    const sh = new T.Mesh(geo('shadowDisc', () => new T.CircleGeometry(0.3, 16).rotateX(-Math.PI / 2)), new T.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.22, depthWrite: false }));
    sh.position.y = 0.02; sh.scale.set(s * 3.2, 1, s * 2.2); grp.add(sh);
    grp.userData = { fur: mat, legs, legH: L * s * 1.15 };
    scene.add(grp);
    return grp;
  }

  // ---------------------------------------------------------------- Hilfen
  const ZCOL = {};
  function zColor(type) { return ZCOL[type] || (ZCOL[type] = new T.Color(G.ZDEF[type].color)); }
  const SHIRTS = ['#5a6e8a', '#7a4a3a', '#4a6a4a', '#8a7a5a', '#6a4a6a', '#9a8a7a', '#3a4a5a', '#7a6a3a'].map(c => new T.Color(c));
  const PANTS = ['#3a3a44', '#4a3a2a', '#2a3a4a', '#4a4a3a', '#3a2a2a'].map(c => new T.Color(c));
  const TSHIRT = { brute: '#5a4030', spitter: '#2f5a4a', bomber: '#6a4a2a', boss: '#3a1448', shaman: '#3a2050', armored: '#4a4a52', shade: '#140a22' };
  const FROST = new T.Color('#bfe6ff'), WHITE = new T.Color('#ffffff'), GOLD = new T.Color('#ffd36b');
  function chestModel() {
    const grp = new T.Group();
    const k = new Kit()
      .lit(BX(0.7, 0.4, 0.45), '#7a4a1e', 0, 0.2, 0).lit(CY(0.225, 0.225, 0.7, 12, false, 0, Math.PI), '#9a6028', 0, 0.4, 0, 0, 0, Math.PI / 2)
      .lit(BX(0.72, 0.06, 0.47), '#e6b83a', 0, 0.33, 0).lit(BX(0.1, 0.14, 0.05), '#e6b83a', 0, 0.32, 0.24)
      .lit(BX(0.06, 0.42, 0.47), '#e6b83a', -0.3, 0.2, 0).lit(BX(0.06, 0.42, 0.47), '#e6b83a', 0.3, 0.2, 0)
      .glow(IC(0.05, 0), '#fff3b0', 0.02, 0.33, 0.26).build();
    const a = new T.Mesh(k.lit, matLit); a.castShadow = true; grp.add(a); grp.add(new T.Mesh(k.glow, matGlow));
    scene.add(grp);
    return grp;
  }
  function pingModel() {
    const grp = new T.Group();
    const mat = new T.MeshBasicMaterial({ color: '#7fd8ff', transparent: true, toneMapped: false });
    const cone = new T.Mesh(geo('pingCone', () => new T.ConeGeometry(0.25, 0.6, 12).rotateX(Math.PI)), mat); cone.position.y = 1.4; grp.add(cone);
    const ball = new T.Mesh(geo('pingBall', () => new T.SphereGeometry(0.25, 12, 8)), mat); ball.position.y = 1.85; grp.add(ball);
    const ring = new T.Mesh(geo('ring', null), new T.MeshBasicMaterial({ color: '#7fd8ff', transparent: true, depthWrite: false, side: T.DoubleSide })); ring.position.y = 0.05; grp.add(ring);
    grp.userData = { mat, cone, ball, ring };
    scene.add(grp);
    return grp;
  }
  // Geländehöhe in Feld-Koordinaten (nur Berge sind erhöht), weich interpoliert
  function hAt(tx, ty) { const S = G.S; if (tx < 0 || ty < 0 || tx >= G.MAP || ty >= G.MAP) return 0; const i = ty * G.MAP + tx; return S.res[i] === 6 && S.mtn ? 0.3 + Math.min(S.mtn[i], 7) * 0.4 : 0; }
  function terrainH(x, z) {
    const fx = x - 0.5, fz = z - 0.5, x0 = Math.floor(fx), z0 = Math.floor(fz), ax = fx - x0, az = fz - z0;
    const a = hAt(x0, z0), b = hAt(x0 + 1, z0), c = hAt(x0, z0 + 1), d = hAt(x0 + 1, z0 + 1);
    return (a * (1 - ax) + b * ax) * (1 - az) + (c * (1 - ax) + d * ax) * az;
  }
  // Laufphase aus der Bewegung (funktioniert auch für Mitspieler/Zombies vom Host)
  function phase(key, x, y, k) {
    let w = walkPh.get(key);
    if (!w) { w = { x, y, ph: hash(x + y) * 6, mv: 0, seen: 0 }; walkPh.set(key, w); }
    const d = Math.hypot(x - w.x, y - w.y);
    if (d < 3) { w.ph += d * k; w.mv = w.mv * 0.85 + Math.min(1, d * 20) * 0.15; } else w.mv *= 0.85;
    w.x = x; w.y = y; w.seen = frameNo;
    return w;
  }
  let frameNo = 0;

  // ---------------------------------------------------------------- Frame
  let gN = 0;
  function glowAt(x, y, z, s, c, a) {
    if (gN >= MAXGLOW || a <= 0.01) return;
    m4.compose(v3.set(x, y, z), camera.quaternion, s3.set(s, s, s));
    glows.setMatrixAt(gN, m4); glows.setColorAt(gN, col2.set(c).multiplyScalar(a)); gN++;
  }
  function render(dt) {
    const S = G.S;
    iconBudget = 4;   // höchstens ein paar neue Icons pro Bild erzeugen
    if (!S) return;
    frameNo++;
    const TS = G.TS, MAP = G.MAP, at = G.animT;
    const w = window.innerWidth, h = window.innerHeight, key = w + 'x' + h;
    if (key !== lastSize) { lastSize = key; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    if (S !== lastS) {
      lastS = S; buildGround(S); walkPh.clear();
      for (const o of buildingObjs.values()) disposeGroup(o); buildingObjs.clear();
      for (const o of chestObjs.values()) scene.remove(o); chestObjs.clear();
      for (const o of animalObjs.values()) scene.remove(o); animalObjs.clear();
    }

    // Kamera: schräg von oben, folgt dem Spieler
    let cx = (G.camX + G.VW / 2) / TS, cz = (G.camY + G.VH / 2) / TS;
    R3.yaw += (R3.yawT - R3.yaw) * Math.min(1, (dt || 0.016) * 8);
    if (G.mode === 'menu') { cx = MAP / 2; cz = MAP / 2; }
    const sy = Math.sin(R3.yaw), cyw = Math.cos(R3.yaw);
    const height = G.clamp(G.VW / TS * 0.72, 13, 24) * R3.zoomLevel;
    let shx = 0, shz = 0;
    if (S.shake > 0.2 && G.mode === 'play') { shx = (Math.random() - 0.5) * S.shake * 0.03; shz = (Math.random() - 0.5) * S.shake * 0.03; }
    const fpOn = R3.fp && G.mode !== 'menu' && S.player && S.player.dead <= 0;
    if (fpOn !== lastFp) {
      lastFp = fpOn;
      camera.fov = fpOn ? 72 : 42; camera.near = fpOn ? 0.05 : 0.5; camera.updateProjectionMatrix();
    }
    if (fpOn) {
      const me = S.player, px = me.x / TS, pz = me.y / TS, wp = walkPh.get('p' + me.id) || { ph: 0, mv: 0 };
      const hy = terrainH(px, pz) + (me.z || 0) / TS + 1.02 + Math.abs(Math.sin(wp.ph)) * 0.04 * wp.mv;
      const cp = Math.cos(R3.pitch);
      camera.position.set(px + shx * 0.3, hy, pz + shz * 0.3);
      camera.lookAt(px - Math.sin(R3.yaw) * cp, hy + Math.sin(R3.pitch), pz - Math.cos(R3.yaw) * cp);
    } else if (G.mode === 'menu') {
      const a = at * 0.05, r = 26, mx = MAP / 2, mz = MAP / 2;
      camera.position.set(mx + Math.cos(a) * r, 13 + Math.sin(at * 0.11) * 2, mz + Math.sin(a) * r);
      camera.lookAt(mx, 1, mz);
    } else {
      camera.position.set(cx + shx + sy * height * 0.68, height, cz + shz + cyw * height * 0.68);
      camera.lookAt(cx + shx - sy * 0.4, 0, cz - cyw * 0.4 + shz);
    }

    // Tag/Nacht/Wetter
    const dk = G.darkness(), night = G.clamp(dk / 0.8, 0, 1), wet = S.weather || 0;
    let strikeA = 0;
    for (const s of S.strikes || []) strikeA = Math.max(strikeA, G.clamp(s.life / 0.45, 0, 1));
    sun.position.set(cx - 14, 30, cz + 8); sun.target.position.set(cx, 0, cz); sun.target.updateMatrixWorld();
    sun.intensity = Math.max(0.05, 2.4 * (1 - night * 0.95) * (wet ? 0.55 : 1));
    sun.color.set(night > 0.3 ? '#9fb0ff' : '#fff0d6');
    hemi.intensity = (1.15 - night * 0.88) * (wet ? 0.8 : 1) + strikeA * 2.5;
    hemi.color.set(night > 0.5 ? '#6a7ab0' : '#e8f2ff');
    const camBi = S.biome ? S.biome[G.clamp(Math.floor(cz), 0, MAP - 1) * MAP + G.clamp(Math.floor(cx), 0, MAP - 1)] : 0, dimV = camBi === 5;
    const dayFog = dimV ? '#2a1438' : camBi === 3 ? '#c8d4de' : camBi === 2 ? '#c8a878' : camBi === 4 ? '#7a8468' : '#a89a88';
    fogColor.set(wet ? '#7d8288' : dayFog).lerp(col.set(S.bloodMoon ? '#2a0306' : dimV ? '#0e0418' : '#06060a'), night);
    if (strikeA) fogColor.lerp(col.set('#c8d4ff'), strikeA * 0.6);
    if (S.bloodMoon && night > 0.3) hemi.color.set('#b03838');
    if (dimV) { hemi.color.set('#8a5ac8'); hemi.intensity = Math.max(0.7, hemi.intensity * 0.8); sun.color.set('#b07aff'); sun.intensity *= 0.35; }
    else if (night < 0.3) sun.color.set(camBi === 3 ? '#f4f8ff' : '#ffe2c0');
    scene.background.copy(fogColor); scene.fog.color.copy(fogColor);
    scene.fog.near = 30 - night * 8 - wet * 4; scene.fog.far = 64 - night * 18 - wet * 8;
    if (R3.fp && G.mode !== 'menu') { scene.fog.near = 7 - night * 3; scene.fog.far = 32 - night * 12 - wet * 6; }

    gN = 0;
    // Punktlichter: die wichtigsten Lichtquellen in Kameranähe
    const cand = [];
    const addL = (x, y, hgt, c, inten, dist, always) => {
      const d2 = (x / TS - cx) ** 2 + (y / TS - cz) ** 2;
      if (d2 < 900) cand.push({ x: x / TS, y: hgt, z: y / TS, c, i: always ? inten : inten * night, dist, d2, always });
    };
    for (const s of S.strikes || []) addL(s.x, s.y, 4, '#d8e4ff', 120 * G.clamp(s.life / 0.45, 0, 1), 16, true);
    for (const f of S.flashes) addL(f.x, f.y, 1.5, '#ffb347', 30 * G.clamp(f.life / f.max, 0, 1), f.r / TS * 1.2, true);
    for (const q of S.players) if (q.dead <= 0) addL(q.x, q.y, 2.2, '#ffd9a0', 14, 8);
    if (S.portal) { addL(S.portal.x, S.portal.y, 2, '#a060ff', 18, 8, true); addL(S.portal2.x, S.portal2.y, 2, '#a060ff', 22, 10, true); }
    for (const b of S.buildings) {
      const c = G.bCenter(b);
      const pul = 1 + Math.sin(at * 2.2 + b.id) * 0.12;
      if (b.type === 'hq') addL(c.x, c.y, 3.4, '#ff9a40', 26 * pul, 12);
      else if (b.type === 'mage') addL(c.x, c.y, 3.0, '#7ad8ff', 13 * (0.8 + 0.25 * (Math.sin(at * 23 + b.id) > 0.3 ? 1 : Math.random())), 7);
      else if (b.type === 'frost') addL(c.x, c.y, 2.4, '#8fd8ff', 12 * pul, 6.5);
      else if (G.TOWERS[b.type]) addL(c.x, c.y, 2.6, '#ffa050', 9, 6);
      else if (b.type === 'heal') addL(c.x, c.y, 2.0, '#80ffa0', 11 * pul, 6);
      else if (b.type === 'mine') addL(c.x, c.y, 1.0, '#ffd36b', 8 * pul, 5);
      else if (b.type === 'door') addL(c.x, c.y, 1.2, '#3aff6a', 3, 3);
    }
    for (const c of S.chests) addL(c.x, c.y, 1.2, '#ffe27a', 6, 4);
    // Straßenlaternen in der Nähe werfen echtes Licht auf den Boden
    if (night > 0.3 && S.variant) {
      const lr = 14, lx0 = Math.max(0, Math.floor(cx - lr)), lx1 = Math.min(MAP - 1, Math.ceil(cx + lr)), lz0 = Math.max(0, Math.floor(cz - lr)), lz1 = Math.min(MAP - 1, Math.ceil(cz + lr));
      for (let ty = lz0; ty <= lz1; ty++) for (let tx = lx0; tx <= lx1; tx++) {
        const i = ty * MAP + tx, v = S.variant[i];
        if (v % 131 !== 40 || !(v % 2) || S.res[i] || S.bmap[i] || (S.biome && S.biome[i] === 5) || (S.hq && Math.abs(tx - S.hq.tx - 1) < 5 && Math.abs(ty - S.hq.ty - 1) < 5)) continue;
        if (Math.sin(at * 17 + v) <= -0.6) continue;
        const ry = v * 0.37;
        addL((tx + 0.5 + 0.62 * Math.cos(ry)) * TS, (ty + 0.5 - 0.62 * Math.sin(ry)) * TS, 2.0, '#ffb050', 7, 6);
      }
    }
    cand.sort((a, b) => (b.always - a.always) || a.d2 - b.d2);
    for (let i = 0; i < NL; i++) {
      const L = pointLights[i], c = cand[i];
      if (c && c.i > 0.05) { L.position.set(c.x, c.y, c.z); L.color.set(c.c); L.intensity = c.i; L.distance = c.dist; }
      else L.intensity = 0;
    }

    // Natur in Sichtweite
    const R = 30, x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(MAP - 1, Math.ceil(cx + R));
    const z0 = Math.max(0, Math.floor(cz - R - 4)), z1 = Math.min(MAP - 1, Math.ceil(cz + R + 4));
    let npk = 0, nps = 0, nt = 0, np = 0, no = 0, nr = 0, ng = 0, ngr = 0, nfl = 0, nbu = 0, nca = 0, nsc = 0, nvo = 0, ncr = 0, ncar = 0, nbar2 = 0, nrub = 0, nlamp = 0;
    const BI = S.biome || null;
    const sway = (wet === 2 ? 0.16 : wet ? 0.09 : 0.05);
    for (let ty = z0; ty <= z1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const i = ty * MAP + tx, k = S.res[i], v = S.variant[i];
      const px = tx + 0.5, pz = ty + 0.5;
      const bi = BI ? BI[i] : 0;
      if (!k) {
        if (S.bmap[i]) continue;
        const hv = hash(i);
        // Ruinen der alten Welt (nur Optik, blockiert nichts)
        if (bi !== 5 && !(S.hq && Math.abs(tx - S.hq.tx - 1) < 5 && Math.abs(ty - S.hq.ty - 1) < 5)) {
          if (v % 61 === 22 && nrub < 1200) { setInst(rubble, nrub, px, 0, pz, 1, 1, 1, v); rubble.setColorAt(nrub, col.setRGB(0.75, 0.73, 0.7)); nrub++; continue; }
          if (v % 131 === 40 && nlamp < 600) {
            const ry = v * 0.37, tilt = (v % 3) * 0.06;
            setInst(lamps, nlamp, px, 0, pz, 1, 1, 1, ry, 0, tilt); lamps.setColorAt(nlamp, WHITE); nlamp++;
            if (v % 2 && night > 0.3) {
              // Lampenkopf mitdrehen, damit das Licht wirklich im Schirm sitzt
              const lx = 0.62 * Math.cos(tilt) - 2.16 * Math.sin(tilt), ly = 0.62 * Math.sin(tilt) + 2.16 * Math.cos(tilt);
              const on = Math.sin(at * 17 + v) > -0.6 ? 1 : 0.15;
              glowAt(px + lx * Math.cos(ry), ly, pz - lx * Math.sin(ry), 0.7, '#ffb050', night * 0.9 * on);
            }
            continue;
          }
        }
        if (bi === 2 || bi === 3 || bi === 5) {
          if (bi === 5 && v % 13 === 0) glowAt(px + Math.sin(at * 0.7 + i) * 0.4, 0.3 + ((at * 0.4 + hash(i) * 3) % 3), pz, 0.22, '#c890ff', 0.7);
          if (bi === 2 && v % 19 === 0 && nbu < MAXDECO) { setInst(bushes, nbu, px, 0, pz, 0.6, 0.5, 0.6, v); bushes.setColorAt(nbu, col.setRGB(0.55, 0.48, 0.28)); nbu++; }
          continue;
        }
        if (hv < (bi === 4 ? 0.7 : 0.45) && ngr < MAXDECO) {
          const ox = (hash(i + 1) - 0.5) * 0.8, oz = (hash(i + 2) - 0.5) * 0.8, sc = 0.7 + hash(i + 3) * 0.6;
          setInst(grass, ngr, px + ox, 0, pz + oz, sc, sc * (0.8 + hv), sc, hv * 9, Math.sin(at * 2 + tx * 0.6 + ty * 0.3) * sway, Math.cos(at * 1.7 + tx * 0.4) * sway);
          if (bi === 4) col.setRGB(0.28 + hv * 0.15, 0.34 + hv * 0.12, 0.16); else col.setRGB(0.3 + hv * 0.2, 0.4 + hv * 0.2, 0.18);
          grass.setColorAt(ngr, col); ngr++;
          if (hv < 0.15 && ngr < MAXDECO) { setInst(grass, ngr, px - ox, 0, pz - oz * 0.7, sc * 0.8, sc * 0.7, sc * 0.8, hv * 20, 0, 0); grass.setColorAt(ngr, col.setRGB(0.3, 0.5, 0.2)); ngr++; }
        }
        if (v % 23 === 0 && nfl < MAXDECO) {
          setInst(flowers, nfl, px + (hash(i + 5) - 0.5) * 0.6, 0, pz + (hash(i + 6) - 0.5) * 0.6, 1.1, 1.1, 1.1, v, Math.sin(at * 2 + tx) * sway, 0);
          flowers.setColorAt(nfl, col.set(['#ff6a8a', '#ffd34a', '#ffffff', '#8ab4ff', '#ff8a3a'][v % 5])); nfl++;
        } else if (v % 41 === 7 && nbu < MAXDECO) {
          const sc = 0.8 + hash(i + 9) * 0.5;
          setInst(bushes, nbu, px + (hash(i + 7) - 0.5) * 0.5, 0, pz + (hash(i + 8) - 0.5) * 0.5, sc, sc, sc, v);
          bushes.setColorAt(nbu, col.setRGB(0.2 + hash(i) * 0.08, 0.42 + hash(i + 4) * 0.12, 0.18)); nbu++;
        }
        // Glühwürmchen
        if (night > 0.4 && !wet && v % 61 === 5) {
          const fx = px + Math.sin(at * 0.6 + i) * 0.8, fz = pz + Math.cos(at * 0.5 + i * 1.3) * 0.8, fy = 0.5 + Math.sin(at * 1.4 + i) * 0.3;
          glowAt(fx, fy, fz, 0.28, '#d8ff70', night * (0.5 + 0.5 * Math.sin(at * 3 + i)));
        }
        continue;
      }
      const sc = G.resScale(i);
      let ox = 0, oz = 0, tilt = 0;
      const wob = S.wobble.get(i);
      if (wob) { const a = Math.sin(wob.t * 40) * 0.1 * (wob.t / 0.25); ox = Math.cos(wob.a) * a; oz = Math.sin(wob.a) * a; tilt = a; }
      const rot = v * 0.05;
      if (k === 7) {
        if (v % 3 === 0) { if (ncar < 600) { setInst(cars, ncar, px + ox, 0, pz + oz, sc, sc, sc, v * 0.7, tilt, v % 2 ? 0.06 : 0); cars.setColorAt(ncar, col.set(['#8a3a2a', '#4a5a6a', '#7a6a3a', '#5a5a52'][v % 4]).multiplyScalar(0.85)); ncar++; } }
        else for (let b = 0; b < 3 && nbar2 < 1200; b++) { const a = v + b * 2.1; setInst(barrels, nbar2, px + ox + Math.cos(a) * 0.22 * sc, 0, pz + oz + Math.sin(a) * 0.2 * sc, sc, sc, sc, v + b, b === 2 ? Math.PI / 2 : tilt, 0); barrels.setColorAt(nbar2, col.set(['#a84a20', '#3a5a3a', '#8a2a20', '#4a4a52'][(v + b) % 4])); nbar2++; }
        continue;
      }
      if (k === 6) {
        if (npk < MAXRES * 2) {
          const hm = S.mtn ? Math.min(S.mtn[i], 7) : 1, hh = 0.45 + hm * 0.62 + hash(i) * 0.45, sw = 1.55 + hash(i + 3) * 0.6 + hm * 0.08;
          setInst(peaks, npk, px + (hash(i + 1) - 0.5) * 0.3, 0, pz + (hash(i + 2) - 0.5) * 0.3, sw, hh, sw, v * 0.3);
          const mc = bi === 2 ? [0.55, 0.36, 0.24] : bi === 3 ? [0.46, 0.48, 0.52] : bi === 4 ? [0.3, 0.31, 0.26] : [0.36 + hm * 0.015, 0.33 + hm * 0.014, 0.3 + hm * 0.012];
          peaks.setColorAt(npk, col.setRGB(mc[0], mc[1], mc[2])); npk++;
          if ((hm >= 4 || (bi === 3 && hm >= 2)) && nps < MAXRES * 2) { setInst(peakSnow, nps, px + (hash(i + 1) - 0.5) * 0.3, 0, pz + (hash(i + 2) - 0.5) * 0.3, sw, hh, sw, v * 0.3); peakSnow.setColorAt(nps, col.setRGB(0.95, 0.96, 1)); nps++; }
        }
        continue;
      }
      if (k === 4) { if (nvo < MAXRES) { setInst(voids, nvo, px, 0, pz, 1, 0.8 + (v % 5) * 0.12, 1, (v % 4) * Math.PI / 2); voids.setColorAt(nvo, col.setRGB(0.09, 0.06, 0.14)); nvo++; if (v % 11 === 0) glowAt(px, 1.4 + (v % 5) * 0.12, pz, 0.6, '#9a5aff', 0.4); } continue; }
      if (k === 5) { if (ncr < MAXRES) { setInst(crystals, ncr, px + ox, 0, pz + oz, sc * 1.1, sc * (1 + (v % 3) * 0.15), sc * 1.1, v); ncr++; glowAt(px, 0.5, pz, 1.4 * sc, '#b47aff', 0.45 + 0.2 * Math.sin(at * 3 + v)); } continue; }
      if (k === 1 && bi === 2) { if (nca < MAXRES) { const s = (0.8 + (v % 5) * 0.1) * sc; setInst(cacti, nca, px + ox, 0, pz + oz, s, s, s, rot * 9, tilt, 0); cacti.setColorAt(nca, col.setRGB(0.22 + (v % 4) * 0.02, 0.48 + (v % 5) * 0.03, 0.22)); nca++; } continue; }
      if (k === 1 && nt < MAXRES) {
        const s = (0.85 + (v % 5) * 0.07) * sc, oak = v % 3 === 2 && bi !== 3;
        const swx = Math.sin(at * 1.3 + tx * 0.5 + ty * 0.3) * sway * 0.3 + tilt, swz = Math.cos(at * 1.1 + tx * 0.3) * sway * 0.3;
        setInst(trunks, nt, px, 0, pz, s * (oak ? 1.5 : 1), s * (oak ? 0.95 : 1), s * (oak ? 1.5 : 1), rot);
        nt++;
        if (oak) {
          setInst(oaks, no, px + ox, 0, pz + oz, s, s * (0.9 + (v % 3) * 0.1), s, rot, swx, swz);
          if (bi === 4) col.setRGB(0.24 + (v % 5) * 0.02, 0.28 + (v % 4) * 0.02, 0.14);
          else { col.setRGB(0.26 + (v % 7) * 0.02, 0.4 + (v % 5) * 0.03, 0.15); if (v % 7 === 0) col.setRGB(0.5, 0.36, 0.14); else if (v % 9 === 0) col.setRGB(0.35, 0.3, 0.2); }
          oaks.setColorAt(no, col); no++;
        } else {
          const hy = 0.9 + (v % 3) * 0.12;
          for (const [m, l] of [[pine1, 0], [pine2, 0.04], [pine3, 0.08]]) {
            setInst(m, np, px + ox, 0, pz + oz, s, s * hy, s, rot, swx, swz);
            if (bi === 3) col.setRGB(0.16 + l, 0.32 + l, 0.28 + l); else col.setRGB(0.14 + (v % 7) * 0.012 + l, 0.3 + (v % 5) * 0.03 + l, 0.18 + l * 0.6);
            m.setColorAt(np, col);
          }
          if (bi === 3 && nsc < MAXRES) { setInst(snowcap, nsc, px + ox, 0.02, pz + oz, s * 1.02, s * hy, s * 1.02, rot, swx, swz); snowcap.setColorAt(nsc, col.setRGB(0.95, 0.97, 1)); nsc++; }
          np++;
        }
      } else if (k >= 2 && nr < MAXRES) {
        const s = (0.85 + (v % 4) * 0.1) * sc;
        setInst(rocks, nr, px + ox, 0, pz + oz, s, s * (0.8 + (v % 3) * 0.12), s, rot * 7, 0, tilt);
        if (k === 3) col.set('#6e5c46');
        else if (bi === 2) col.setRGB(0.72, 0.56, 0.36);
        else if (bi === 3) col.setRGB(0.72, 0.84, 0.92);
        else if (bi === 5) col.setRGB(0.16, 0.12, 0.22);
        else if (bi === 4) col.setRGB(0.36, 0.36, 0.3);
        else col.setRGB(0.5 + (v % 3) * 0.03, 0.5 + (v % 3) * 0.03, 0.54);
        rocks.setColorAt(nr, col);
        nr++;
        if (k === 3) for (let j = 0; j < 3 && ng < MAXRES; j++, ng++) {
          const a = rot * 3 + j * 2.1;
          setInst(ores, ng, px + ox + Math.cos(a) * 0.26 * s, 0.32 * s + j * 0.04, pz + oz + Math.sin(a) * 0.26 * s, s, s, s, a, 0.3 * Math.sin(a), 0.3 * Math.cos(a));
          if (j === 0) glowAt(px + Math.cos(a) * 0.26 * s, 0.4 * s, pz + Math.sin(a) * 0.26 * s, 0.6, '#ffd36b', 0.25 + 0.5 * night + 0.25 * Math.max(0, Math.sin(at * 2 + i)));
        }
      }
    }
    trunks.count = nt; pine1.count = pine2.count = pine3.count = np; oaks.count = no; rocks.count = nr; ores.count = ng;
    peaks.count = npk; peakSnow.count = nps; done(peaks, peakSnow);
    grass.count = ngr; flowers.count = nfl; bushes.count = nbu; cacti.count = nca; snowcap.count = nsc; voids.count = nvo; crystals.count = ncr;
    cars.count = ncar; barrels.count = nbar2; rubble.count = nrub; lamps.count = nlamp;
    done(trunks, pine1, pine2, pine3, oaks, rocks, ores, grass, flowers, bushes, cacti, snowcap, voids, crystals, cars, barrels, rubble, lamps);

    // Gebäude
    const seen = new Set();
    for (const b of S.buildings) {
      seen.add(b.id);
      let o = buildingObjs.get(b.id);
      if (o && (o.userData.lvl !== b.lvl || o.userData.type !== b.type)) { disposeGroup(o); o = null; }
      if (!o) { o = makeBuilding(b); buildingObjs.set(b.id, o); }
      const bx = b.tx + b.size / 2, bz = b.ty + b.size / 2;
      o.position.set(bx, 0, bz);
      const u = o.userData;
      let bobY = 0;
      for (const { o: sub, p } of u.anims) {
        if (p.anim === 'turret') sub.rotation.y = -b.angle;
        else if (p.anim === 'spin') sub.rotation[p.axis] = at * p.speed;
        else if (p.anim === 'bob') { bobY = Math.sin(at * 2.5 + b.id) * p.bobA; sub.position.y = p.y + bobY; sub.rotation.y = at * p.spin; }
        else if (p.anim === 'spikes') sub.position.y = b.spike > 0 ? 0.02 : -0.2;
      }
      const near = Math.abs(bx - cx) < 32 && Math.abs(bz - cz) < 26;
      if (near) for (const gl of u.spec.glows) {
        const fl = gl.flick ? 0.85 + Math.sin(at * 13 + b.id + gl.x) * 0.08 + Math.sin(at * 7.3 + gl.z) * 0.07 : 1;
        glowAt(bx + gl.x, gl.y + (gl.bob ? bobY : 0), bz + gl.z, gl.s * fl, gl.c, (gl.night ? 0.15 + 0.85 * night : 0.45 + 0.55 * night) * fl);
      }
      const fl = b.flash > 0 ? 0.5 : 0;
      if (u.flashOn !== fl) { u.flashOn = fl; u.mat.emissive.setScalar(fl); }
    }
    for (const [id, o] of buildingObjs) if (!seen.has(id)) { disposeGroup(o); buildingObjs.delete(id); }

    // Zombies
    let nz = 0, nl = 0, na = 0, ne = 0, nh = 0, nbar = 0, nhelm = 0, nplate = 0, nhat = 0, nstaff = 0, nsack = 0;
    const K = 1.35;
    for (const z of S.zombies) {
      if (nz >= MAXZ) break;
      const type = z.type, boss = type === 'boss', brute = type === 'brute', runner = type === 'runner';
      const rr = z.r / TS * K, x = z.x / TS, zz = z.y / TS, f = z.face || 0;
      const w = phase('z' + z.id, x, zz, runner ? 4.2 : 3.2 / Math.max(0.6, rr));
      const ph = w.ph, mv = Math.max(w.mv, (Math.abs(z.vx || 0) + Math.abs(z.vy || 0)) > 2 ? 0.8 : 0);
      const lean = runner ? 0.45 : boss ? 0.15 : 0.25;
      const bob = Math.abs(Math.sin(ph)) * 0.08 * mv;
      base(x, bob * rr, zz, -f, rr);
      // Farben
      const flash = z.flash > 0, frozen = z.frostT > 0;
      const skin = col.copy(zColor(type));
      const shirt = col2.set(TSHIRT[type] || SHIRTS[z.id % SHIRTS.length]);
      if (type === 'shade') { glowAt(x, 1.0 * rr * 1.6, zz, 2.6 * rr * 2, '#7a3aff', 0.45 + 0.15 * Math.sin(at * 6 + z.id)); }
      const pants = PANTS[(z.id * 7) % PANTS.length];
      const tint = c => (flash ? WHITE : frozen ? c.clone().lerp(FROST, 0.55) : z.golden ? c.clone().lerp(GOLD, 0.75) : c);
      if (z.golden) glowAt(x, 1.2 * rr, zz, 2.2 * rr * 2, '#ffd36b', 0.5 + 0.2 * Math.sin(at * 8 + z.id));
      const wide = brute ? 1.3 : boss ? 1.15 : runner ? 0.85 : 1;
      // Beine
      for (const s of [-1, 1]) {
        const sw = Math.sin(ph + (s > 0 ? 0 : Math.PI)) * 0.65 * mv;
        part(zLeg, nl, 0, 1.0, s * 0.22 * wide, 0, 0, sw, wide, 1, wide);
        zLeg.setColorAt(nl, tint(pants)); nl++;
      }
      // Körper
      part(zTorso, nz, lean * 0.3, 1.5, 0, 0, 0, -lean, wide, boss ? 1.1 : 1, wide);
      zTorso.setColorAt(nz, tint(shirt));
      part(zGore, nz, lean * 0.3, 1.5, 0, 0, 0, -lean, wide, boss ? 1.1 : 1, wide);
      zGore.setColorAt(nz, flash ? WHITE : frozen ? FROST : z.golden ? GOLD : WHITE);
      const hx = 0.18 + lean * 0.55, tiltX = Math.sin(z.id * 1.7) * 0.22 + Math.sin(at * 2 + z.id) * 0.05;
      part(zHead, nz, hx, 2.24 + (boss ? 0.08 : 0), 0, tiltX, Math.sin(z.id) * 0.2, -0.1, boss ? 1.15 : 1);
      zHead.setColorAt(nz, tint(skin));
      part(zSkull, nz, hx, 2.24 + (boss ? 0.08 : 0), 0, tiltX, Math.sin(z.id) * 0.2, -0.1, boss ? 1.15 : 1);
      zSkull.setColorAt(nz, flash ? WHITE : frozen ? FROST : z.golden ? GOLD : WHITE);
      // Arme: nach vorne gestreckt, beim Zuschlagen hoch
      const lunge = z.lunge > 0 ? 1 : 0;
      for (const s of [-1, 1]) {
        const swing = Math.sin(ph + (s > 0 ? Math.PI : 0)) * 0.18 * mv;
        part(zArm, na, 0.12 + lean * 0.4, 1.92, s * 0.55 * wide, s * 0.1, -s * 0.12, -0.18 + swing + lunge * 0.55 + (type === 'spitter' ? 0.2 : 0), brute ? 1.15 : boss ? 0.8 : 1, brute ? 1.5 : 1, brute ? 1.5 : 1);
        zArm.setColorAt(na, tint(skin)); na++;
        // Augen
        const ex = hx + 0.3, ey = 2.32 + (boss ? 0.08 : 0);
        part(zEye, ne, ex - 0.02, ey - 0.02, s * 0.13, 0, 0, 0, 0.06, 0.07, 0.09);
        const ec = boss ? '#ffde3a' : type === 'shaman' || type === 'shade' ? '#d8b4ff' : '#ff3a3a';
        zEye.setColorAt(ne, col2.set(ec)); ne++;
        if (night > 0.25 || type === 'shade') { const p = worldOf(ex + 0.05, ey, s * 0.13); glowAt(p.x, p.y, p.z, 0.22 * rr * 2.2, ec, Math.max(night, type === 'shade' ? 1 : 0) * 0.7); }
      }
      // Ausrüstung je Typ
      if (boss) {
        for (const s of [-1, 1]) {
          part(zHorn, nh, hx - 0.05, 2.5, s * 0.22, s * 0.6, 0, -0.3, 1); zHorn.setColorAt(nh++, col2.set('#e8dcc0'));
          part(zHorn, nh, 0.05, 2.0, s * 0.5, s * 0.9, 0, 0, 0.8); zHorn.setColorAt(nh++, col2.set('#2a1030'));
          part(zHorn, nh, -0.2, 1.75, s * 0.38, s * 0.7, 0, 0.5, 0.7); zHorn.setColorAt(nh++, col2.set('#2a1030'));
        }
        for (let k2 = 0; k2 < 5; k2++) { const a = k2 / 5 * TAU + at; const p = worldOf(hx + Math.cos(a) * 0.3, 2.75, Math.sin(a) * 0.3); glowAt(p.x, p.y, p.z, 0.35, '#d87bff', 0.8); }
      } else if (type === 'bomber') {
        part(zBarrel, nbar, -0.5, 1.6, 0, 0, 0, 0.2, 1); zBarrel.setColorAt(nbar++, tint(WHITE));
        if (Math.sin(at * 18 + z.id) > -0.2) { const p = worldOf(-0.55, 2.15, 0); glowAt(p.x, p.y, p.z, 0.45, '#ffcf4a', 1); }
      } else if (type === 'armored') {
        part(zHelm, nhelm, hx, 2.3, 0, tiltX * 0.5, 0, -0.1, 1); zHelm.setColorAt(nhelm++, tint(WHITE));
        part(zPlate, nplate, lean * 0.3, 1.55, 0, 0, 0, -lean, 1); zPlate.setColorAt(nplate++, tint(WHITE));
      } else if (type === 'shaman') {
        part(zHat, nhat, hx - 0.02, 2.56, 0, tiltX * 0.5, 0, -0.1, 1); zHat.setColorAt(nhat++, tint(WHITE));
        part(zStaff, nstaff, 0.75, 1.45, 0.72, 0.05, 0, 0.15, 1); zStaff.setColorAt(nstaff++, tint(WHITE));
        const p = worldOf(0.95, 2.7, 0.75); glowAt(p.x, p.y, p.z, 0.7, '#b48cff', 0.7 + 0.3 * Math.sin(at * 6 + z.id));
      } else if (type === 'spitter') {
        part(zSack, nsack, -0.35, 1.7, 0, 0, 0, 0, 1); zSack.setColorAt(nsack++, tint(WHITE));
      }
      nz++;
    }
    for (const [m, n] of [[zGore, nz], [zSkull, nz], [zLeg, nl], [zTorso, nz], [zHead, nz], [zArm, na], [zEye, ne], [zHorn, nh], [zBarrel, nbar], [zHelm, nhelm], [zPlate, nplate], [zHat, nhat], [zStaff, nstaff], [zSack, nsack]]) { m.count = n; done(m); }

    // Tiere
    const aseen = new Set();
    for (const an of S.animals || []) {
      aseen.add(an.id);
      let o = animalObjs.get(an.id);
      if (!o) { o = makeAnimal(an); animalObjs.set(an.id, o); }
      const u = o.userData, wph = phase('a' + an.id, an.x / TS, an.y / TS, 9);
      const moving = wph.mv > 0.2 || Math.abs(an.vx || 0) + Math.abs(an.vy || 0) > 1;
      o.position.set(an.x / TS, moving ? Math.abs(Math.sin(wph.ph)) * 0.05 : 0, an.y / TS);
      o.rotation.y = -(an.face || 0);
      u.legs.forEach((l, k) => { l.rotation.z = moving ? Math.sin(wph.ph * 1.5 + (k % 2 ? Math.PI : 0)) * 0.5 : 0; });
      u.fur.emissive.set(an.flash > 0 ? '#ffffff' : '#000000');
    }
    for (const [id, o] of animalObjs) if (!aseen.has(id)) { scene.remove(o); animalObjs.delete(id); }

    // Spieler
    const pseen = new Set();
    for (const p of S.players) {
      pseen.add(p.id);
      let o = playerObjs.get(p.id);
      if (!o) { o = makePlayer(p); playerObjs.set(p.id, o); }
      o.visible = p.dead <= 0 && !(fpOn && p === S.player);
      if (fpOn && p === S.player) updateFpView(p, at);
      if (!o.visible) continue;
      const u = o.userData, px = p.x / TS, pz = p.y / TS, wp = phase('p' + p.id, px, pz, 11), mv = wp.mv;
      const gy = terrainH(px, pz), jz = (p.z || 0) / TS;
      o.position.set(px, gy + jz + (jz > 0 ? 0 : Math.abs(Math.sin(wp.ph)) * 0.05 * mv), pz);
      o.children[1] && (o.children[1].position.y = 0.02 - jz);
      o.rotation.y = p.danceT > 0 ? -at * 12 : -(p.face || 0);
      if (p.rageT > 0) glowAt(px, 0.6, pz, 1.6, '#ff5a2a', 0.5 + 0.2 * Math.sin(at * 10));
      u.legs[0].rotation.z = Math.sin(wp.ph) * 0.7 * mv; u.legs[1].rotation.z = -Math.sin(wp.ph) * 0.7 * mv;
      u.arms[0].rotation.z = -Math.sin(wp.ph) * 0.6 * mv;
      for (const k in u.tools) u.tools[k].visible = k === p.tool;
      const swp = p.swing > 0 ? Math.sin((1 - p.swing / 0.22) * Math.PI) : 0;
      u.tool.rotation.y = p.tool === 'bow' || p.tool === 'staff' ? 0.9 : p.tool === 'spear' ? 0.25 : p.tool === 'axe' ? 1.6 - swp * 3.6 : 0.9 - swp * 2.2;
      u.tool.position.x = 0.28 + (p.tool === 'spear' ? swp * 0.45 : 0);
      u.tool.rotation.z = p.tool === 'pick' ? swp * 0.6 : 0;
      u.arms[1].rotation.z = 0.75 + swp * 0.4; u.arms[1].rotation.x = -0.35;
      u.body.rotation.y = p.tool === 'axe' ? -swp * 0.5 : 0;
      u.head.rotation.y = Math.sin(at * 0.7 + p.id) * 0.1;
      u.helm.visible = (p.lvl || 1) >= 5;
      const lv = (p.tl && p.tl[p.tool]) || 1;
      if (u.lv !== lv) { u.lv = lv; u.metal.color.set(G.TMET[Math.min(4, lv - 1)]); }
      const hl = (p.lvl || 1) >= 15 ? 4 : (p.lvl || 1) >= 10 ? 2 : 1;
      if (u.hl !== hl) { u.hl = hl; u.helm.material = u.metal; }
      u.mat.emissive.set(p.flash > 0 ? '#aa2020' : '#000000');
      if (p.tool === 'staff') { o.updateMatrixWorld(true); const g = u.tools.staff; v3.set(0.86, 0, 0).applyMatrix4(g.matrixWorld); glowAt(v3.x, v3.y, v3.z, 0.7, '#ffb347', 0.8 + 0.2 * Math.sin(at * 8)); }
      if (night > 0.3) glowAt(px, 0.9, pz, 1.4, '#ffcf8a', 0.18 * night);
    }
    for (const [id, o] of playerObjs) if (!pseen.has(id)) { scene.remove(o); playerObjs.delete(id); }
    if (fpView) fpView.visible = fpOn;

    // Geschosse
    let nb = 0, nsph = 0;
    for (const pr of S.projs) {
      const x = pr.x / TS, zz = pr.y / TS;
      if (pr.k === 'arrow' || pr.k === 'parrow') {
        if (nb >= MAXP) continue;
        setInst(projArrow, nb, x, 0.95, zz, 1, 1, 1, -Math.atan2(pr.vy, pr.vx));
        projArrow.setColorAt(nb, col.set(pr.k === 'arrow' ? '#dfeeff' : '#ffffff')); nb++;
        if (pr.k === 'arrow' && night > 0.3) glowAt(x, 0.95, zz, 0.35, '#9fd0ff', 0.4 * night);
      } else if (nsph < MAXP) {
        const big = pr.k === 'bomb', fire = pr.k === 'fire', glob = pr.k === 'glob';
        const hgt = big ? 0.6 + (pr.h || 0) / TS : glob ? 0.6 : fire ? 0.9 : 0.8;
        const r = big ? 0.2 : glob ? 0.13 : fire ? 0.16 : 0.15;
        setInst(projBall, nsph, x, hgt, zz, r, r, r, at * 5);
        projBall.setColorAt(nsph, col.set(glob ? '#7fe0a0' : fire ? '#ffd27a' : big ? '#1e1e22' : '#2a2a30')); nsph++;
        if (fire) { glowAt(x, hgt, zz, 1.3, '#ff8a2a', 1); glowAt(x, hgt, zz, 0.5, '#fff3c0', 1); }
        else if (glob) glowAt(x, hgt, zz, 0.6, '#7fe0a0', 0.8);
        else if (big) glowAt(x + 0.12, hgt + 0.2, zz, 0.35, '#ffcf4a', 0.6 + 0.4 * Math.sin(at * 30));
      }
    }
    projArrow.count = nb; projBall.count = nsph; done(projArrow, projBall);

    // Partikel
    let npart = 0;
    for (const q of S.parts) {
      if (npart >= MAXPART) break;
      const f = G.clamp(q.life / q.max, 0, 1), s = q.size / TS * 1.3 * (0.4 + 0.6 * f);
      const hgt = q.grav < 0 ? 0.4 + (1 - f) * 1.4 : 0.25 + Math.sin(f * Math.PI) * 0.5;
      setInst(parts, npart, q.x / TS, hgt, q.y / TS, s, s, s, q.x * 0.1, q.y * 0.1);
      parts.setColorAt(npart, col.set(q.color)); npart++;
      if (npart % 3 === 0 && /^#ff[89a-f]/i.test(q.color)) glowAt(q.x / TS, hgt, q.y / TS, s * 6, q.color, 0.35 * f);
    }
    parts.count = npart; done(parts);
    for (const fl of S.flashes) { const a = G.clamp(fl.life / fl.max, 0, 1); glowAt(fl.x / TS, 0.8, fl.y / TS, fl.r / TS * 1.3, '#ffb347', a * 0.9); }

    // Kettenblitze
    const pos = boltLines.geometry.attributes.position.array;
    let nli = 0;
    for (const b of S.bolts) {
      for (let i = 0; i < b.pts.length - 1; i++) {
        const [ax, ay] = b.pts[i], [bx, by] = b.pts[i + 1];
        let px = ax / TS, pz = ay / TS, py = 1.0;
        for (let s = 1; s <= 4 && nli < 598; s++) {
          const ff = s / 4, j = s === 4 ? 0 : Math.sin(b.seed + i * 7 + s * 3 + at * 60) * 0.25;
          const nx = (ax + (bx - ax) * ff) / TS + j, nz2 = (ay + (by - ay) * ff) / TS - j, ny = 1.0 + (s === 4 ? 0 : j);
          pos.set([px, py, pz, nx, ny, nz2], nli * 3); nli += 2;
          glowAt(nx, ny, nz2, 0.5, '#c792ff', 0.5);
          px = nx; py = ny; pz = nz2;
        }
      }
    }
    boltLines.geometry.setDrawRange(0, nli); boltLines.geometry.attributes.position.needsUpdate = true;

    // Gewitter: Blitz vom Himmel
    const sp2 = strikeLines.geometry.attributes.position.array;
    let nsl = 0;
    for (const s of S.strikes || []) {
      const a = G.clamp(s.life / 0.45, 0, 1), x = s.x / TS, zz = s.y / TS;
      let px = x + Math.sin(s.seed) * 3, py = 18, pz = zz - 4;
      for (let k = 1; k <= 12 && nsl < 398; k++) {
        const f = k / 12, nx = x + (px - x) * (1 - f) * 0.6 + (k < 12 ? Math.sin(s.seed + k * 2.1) * 0.5 : 0), ny = 18 * (1 - f), nz = zz + (pz - zz) * (1 - f) * 0.6 + (k < 12 ? Math.cos(s.seed + k * 1.7) * 0.4 : 0);
        sp2.set([px, py, pz, nx, ny, nz], nsl * 3); nsl += 2;
        if (k % 3 === 0) glowAt(nx, ny, nz, 1.2, '#dfe8ff', a * 0.7);
        if (k === 6 && nsl < 396) { sp2.set([nx, ny, nz, nx + Math.sin(s.seed * 3) * 2, ny - 3, nz + 1], nsl * 3); nsl += 2; }
        px = nx; py = ny; pz = nz;
      }
      glowAt(x, 0.5, zz, 5 * a, '#e8f0ff', a);
    }
    strikeLines.geometry.setDrawRange(0, nsl); strikeLines.geometry.attributes.position.needsUpdate = true;

    // Regen
    let nrain = 0;
    const snowy = camBi === 3;
    if (wet && camBi !== 2 && !dimV) {
      const n = wet === 2 ? MAXRAIN : 480, fall = snowy ? 2.2 : 16;
      rain.material.color.set(snowy ? '#ffffff' : '#a9c0e0'); rain.material.opacity = snowy ? 0.9 : 0.5;
      for (let i = 0; i < n; i++) {
        const hx = (hash(i) - 0.5) * 48, hz = (hash(i + 999) - 0.5) * 40 + 2;
        const y = 12 - ((at * fall + hash(i + 555) * 12) % 12);
        if (snowy) setInst(rain, nrain++, cx + hx + Math.sin(at + i) * 0.6, y, cz + hz, 4, 0.12, 4, i, 0, 0);
        else setInst(rain, nrain++, cx + hx + y * 0.15, y, cz + hz, 1, 1, 1, 0, 0, 0.15);
      }
    }
    rain.count = nrain; done(rain);

    // Portale ins Schattenreich
    const pos2 = S.portal ? [S.portal, S.portal2] : [];
    pos2.forEach((po, k) => {
      let o = portalObjs[k];
      if (!o) {
        o = new T.Group();
        const kt = new Kit();
        kt.lit(CY(1.0, 1.1, 0.2, 12), '#2a2236', 0, 0.1, 0);
        for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI; kt.lit(BX(0.3, 0.32, 0.36), i % 2 ? '#3a2e4a' : '#2a2236', Math.cos(a) * 1.05, 0.25 + Math.sin(a) * 1.3, 0, 0, 0, a); }
        for (const s of [-1, 1]) kt.lit(OC(0.16), '#9a5aff', s * 1.1, 2.0, 0, 0, 0, 0, 1, 2, 1);
        const b = kt.build();
        const m1 = new T.Mesh(b.lit, matLit); m1.castShadow = true; o.add(m1);
        const sw = new T.Mesh(geo('portalDisc', () => new T.CircleGeometry(0.95, 32)), new T.MeshBasicMaterial({ map: glowTex, color: '#b47aff', transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false }));
        sw.position.y = 1.25; sw.scale.set(1, 1.3, 1); o.add(sw);
        const ring = new T.Mesh(geo('portalRing', () => new T.TorusGeometry(0.9, 0.05, 6, 32)), new T.MeshBasicMaterial({ color: '#d8b4ff', toneMapped: false }));
        ring.position.y = 1.25; ring.scale.set(1, 1.3, 1); o.add(ring);
        o.userData = { sw, ring }; scene.add(o); portalObjs[k] = o;
      }
      o.visible = true; o.position.set(po.x / TS, 0, po.y / TS);
      o.rotation.y = Math.atan2(cx - po.x / TS, cz - po.y / TS);
      o.userData.sw.rotation.z = at * 2; o.userData.sw.material.opacity = 0.7 + 0.3 * Math.sin(at * 3);
      o.userData.ring.rotation.z = -at;
      glowAt(po.x / TS, 1.3, po.y / TS, 3.2, '#9a5aff', 0.8);
      for (let i = 0; i < 6; i++) { const a = at * 1.5 + i * 1.05, r = 0.6 + ((at * 0.5 + i * 0.3) % 1) * 0.6; glowAt(po.x / TS + Math.cos(a) * r, 1.25 + Math.sin(a) * r * 1.2, po.y / TS, 0.25, '#e0c0ff', 0.8); }
    });
    for (let k = pos2.length; k < portalObjs.length; k++) portalObjs[k].visible = false;

    // Druckwellen-Ringe
    let ri = 0;
    for (const r of S.rings) {
      let m = ringPool[ri];
      if (!m) { m = ringMesh('#ffffff', 1); m.material.toneMapped = false; ringPool[ri] = m; }
      m.visible = true; m.position.set(r.x / TS, 0.06, r.y / TS);
      const s = Math.max(0.05, r.r / TS); m.scale.set(s, 1, s);
      m.material.color.set(r.color); m.material.opacity = G.clamp(r.life / r.maxLife, 0, 1);
      ri++;
    }
    for (; ri < ringPool.length; ri++) ringPool[ri].visible = false;

    // Truhen
    const cseen = new Set();
    for (const c of S.chests) {
      cseen.add(c.id);
      let o = chestObjs.get(c.id);
      if (!o) { o = chestModel(); chestObjs.set(c.id, o); }
      o.position.set(c.x / TS, Math.sin(at * 3 + c.id) * 0.06, c.y / TS);
      o.rotation.y = Math.sin(at * 0.7 + c.id) * 0.3;
      glowAt(c.x / TS, 0.4, c.y / TS, 1.4, '#ffe27a', 0.35 + 0.25 * Math.sin(at * 4 + c.id));
    }
    for (const [id, o] of chestObjs) if (!cseen.has(id)) { scene.remove(o); chestObjs.delete(id); }

    // Markierungen
    let pi = 0;
    for (const pg of S.pings) {
      let o = pingPool[pi]; if (!o) { o = pingModel(); pingPool[pi] = o; }
      const u = o.userData, c = ['#9fd0ff', '#ffb0a8', '#a8f0b0', '#ffe27a', '#d8b4ff', '#9ff0f0', '#ffc890', '#ffaad8'][(pg.pid || 0) % 8], k = (4 - pg.t) % 1;
      o.visible = true; o.position.set(pg.x / TS, Math.sin(at * 4) * 0.1, pg.y / TS);
      u.mat.color.set(c); u.mat.opacity = G.clamp(pg.t, 0, 1);
      u.ring.material.color.set(c); u.ring.material.opacity = (1 - k) * G.clamp(pg.t, 0, 1);
      const rs = 0.3 + k * 1.2; u.ring.scale.set(rs, 1, rs);
      pi++;
    }
    for (; pi < pingPool.length; pi++) pingPool[pi].visible = false;

    // Auswahl
    const sel = S.sel && !S.sel.dead ? S.sel : null;
    selBox.visible = !!sel; selRing.visible = false;
    if (sel) {
      const d = G.BDEF[sel.type], c = G.bCenter(sel);
      selBox.position.set(c.x / TS, 0.05, c.y / TS); selBox.scale.set(sel.size + 0.2, 1, sel.size + 0.2);
      const rad = d.range ? d.range[sel.lvl - 1] : d.radius ? d.radius[sel.lvl - 1] : 0;
      if (rad) { selRing.visible = true; selRing.position.set(c.x / TS, 0.05, c.y / TS); selRing.scale.set(rad, 1, rad); selRing.material.color.set(d.range ? '#ffe27a' : '#a0ff8c'); }
    }

    // Bau-Vorschau: halbtransparentes Modell
    for (const o of ghostObjs.values()) o.visible = false;
    ghostRing.visible = false;
    if (S.place && G.mode === 'play' && !G.hoverSlot) {
      const a = G.aimPoint(), fp = G.footprintAt(S.place, a.x, a.y), d = G.BDEF[S.place];
      const err = G.placeError(S.place, fp.tx, fp.ty);
      const gh = ghostFor(S.place);
      gh.visible = true; gh.position.set(fp.tx + fp.size / 2, 0, fp.ty + fp.size / 2);
      ghostMat.color.set(err ? '#ff5050' : '#60ff90'); ghostMat.opacity = 0.38 + Math.sin(at * 6) * 0.08;
      const rad = d.range ? d.range[0] : d.radius ? d.radius[0] : 0;
      if (rad) { ghostRing.visible = true; ghostRing.position.set(fp.tx + fp.size / 2, 0.05, fp.ty + fp.size / 2); ghostRing.scale.set(rad, 1, rad); }
    }

    glows.count = gN; done(glows);
    if (frameNo % 120 === 0) for (const [k, w2] of walkPh) if (frameNo - w2.seen > 60) walkPh.delete(k);
    renderer.render(scene, camera);
  }

  // ---------------------------------------------------------------- 2D-Overlay (HP-Balken, Texte, Namen)
  function project(x, y, h) {
    v3.set(x / G.TS, h, y / G.TS).project(camera);
    return { x: (v3.x + 1) / 2 * G.VW, y: (1 - v3.y) / 2 * G.VH, ok: v3.z < 1 && v3.x > -1.2 && v3.x < 1.2 && v3.y > -1.2 && v3.y < 1.2 };
  }
  function overlay(ctx) {
    const S = G.S;
    if (!S || !camera) return;
    const TS = G.TS;
    for (const z of S.zombies) {
      if (z.hp >= z.maxHp) continue;
      const rr = z.r / TS * 1.35, p = project(z.x, z.y, rr * 2.9 + 0.25);
      if (!p.ok) continue;
      G.hpBar(p.x, p.y, z.type === 'boss' ? 70 : Math.max(24, z.r * 2), z.hp / z.maxHp, z.type === 'boss' ? '#d87bff' : z.type === 'armored' ? '#9aa4ae' : '#e74c3c');
    }
    for (const an of S.animals || []) {
      if (an.hp >= an.maxHp) continue;
      const pa = project(an.x, an.y, 1.1);
      if (pa.ok) G.hpBar(pa.x, pa.y, 26, an.hp / an.maxHp, '#e0a050');
    }
    for (const b of S.buildings) {
      if (b.hp >= b.maxHp) continue;
      const c = G.bCenter(b), p = project(c.x, c.y, b.type === 'hq' ? 4.2 : b.type === 'wall' || b.type === 'door' ? 1.4 : 2.8);
      if (p.ok) G.hpBar(p.x, p.y, Math.max(30, b.size * 30), b.hp / b.maxHp, b.type === 'hq' ? '#f2c94c' : '#5fd068');
    }
    for (const q of S.players) {
      if (q.dead > 0) continue;
      const p = project(q.x, q.y, 1.6);
      if (!p.ok) continue;
      if (q.hp < q.maxHp) G.hpBar(p.x, p.y, 34, q.hp / q.maxHp, q === S.player ? '#4fc3f7' : '#ff8a80');
      if (S.players.length > 1 || q.afk) {
        const tag = q.clan ? '[' + q.clan + '] ' : '';
        G.text(tag + (q.name || ('P' + (q.id + 1))) + (q.afk ? ' 💤 AFK' : ''), p.x, p.y - 12, 12, q === S.player ? '#cfe8ff' : '#ffb0a8', 'center', 'bold');
      }
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const tx of S.texts) {
      const f = G.clamp(tx.life / tx.max, 0, 1), p = project(tx.x, tx.y, 1.3 + (1 - f) * 0.6);
      if (!p.ok) continue;
      ctx.globalAlpha = G.clamp(f * 1.5, 0, 1);
      G.text(String(tx.text), p.x, p.y, tx.size, tx.color, 'center', 'bold');
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- Maus → Spielwelt
  const ndc = new T.Vector2();
  function pick(sx, sy) {
    if (!camera || !G) return null;
    ndc.set(sx / G.VW * 2 - 1, -(sy / G.VH) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.ray.intersectPlane(groundPlane, v3);
    if (!hit) return null;
    return { x: hit.x * G.TS, y: hit.z * G.TS };
  }
})();
