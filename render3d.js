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
  const frus = new T.Frustum(), projM = new T.Matrix4(), sph = new T.Sphere(), vC = new T.Vector3();
  const inView = (x, y, z, r) => frus.intersectsSphere(sph.set(vC.set(x, y, z), r));
  const FH = 1.9;                   // Stockwerkhöhe der Stadtruinen
  const hash = n => { const s = Math.sin(n * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };

  const R3 = window.NW3D = {
    ready: false, init, render, overlay, pick, zoomLevel: 1, yaw: 0, yawT: 0, fp: true, eye: false, pitch: -0.12,
    look(dx, dy) { const k = 0.0024 * (R3.lookSens || 1); R3.yaw -= dx * k; R3.yawT = R3.yaw; R3.pitch = Math.max(-1.25, Math.min(0.7, R3.pitch - dy * k)); },
    rotate(d, instant, reset) { if (reset) { R3.yawT = Math.round(R3.yaw / TAU) * TAU; return; } R3.yawT += d; if (instant) R3.yaw = R3.yawT; },
    zoom(dy) { R3.zoomLevel = Math.min(1.8, Math.max(0.55, R3.zoomLevel * (dy > 0 ? 1.1 : 1 / 1.1))); },
    stats() { const r = renderer.info.render; return { calls: r.calls, tris: r.triangles, geos: renderer.info.memory.geometries }; },
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
  let fpView = null, fpTools = null, fpMetal = null, fpHand = null, lastFp = null;
  let ruinFloor, ruinTop, bunkerWall, bPipe, bLamp, bLampG, bCrate, bMachine, bTank, bTankG, peaks, peakSnow, trunks, pine1, pine2, pine3, oaks, rocks, ores, grass, flowers, bushes, cacti, voids, crystals, cars, barrels, rubble, lamps, snowcap;
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
    { const k = new Kit().lit(CY(0.075, 0.13, 1.45, 7), '#6b4626', 0, 0.72, 0).lit(CY(0.14, 0.19, 0.14, 7), '#5a3a20', 0, 0.07, 0)
        .lit(CY(0.085, 0.085, 0.03, 7), '#4a2e18', 0, 0.55, 0).lit(BX(0.05, 0.3, 0.05), '#5a3a20', 0.1, 0.9, 0, 0, 0, -0.7).lit(BX(0.04, 0.22, 0.04), '#5a3a20', -0.08, 1.15, 0.05, 0.4, 0, 0.6);
      for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + 0.4; k.lit(CY(0.035, 0.06, 0.3, 5), '#5a3a20', Math.cos(a) * 0.15, 0.05, Math.sin(a) * 0.15, Math.sin(a) * 1.15, 0, -Math.cos(a) * 1.15); }
      for (let i = 0; i < 5; i++) k.lit(BX(0.02, 0.12, 0.02), '#4a2e18', Math.cos(i * 1.3) * 0.1, 0.35 + i * 0.18, Math.sin(i * 1.3) * 0.1);
      trunks = inst(k.build().lit, matInst, MAXRES, true); }
    pine1 = inst(new Kit().lit(CO(0.72, 0.95, 8), '#ffffff', 0, 1.2, 0, 0, 0, 0, 1, 1, 1, 0.08).lit(CO(0.778, 0.399, 8), '#dfeedd', 0, 0.877, 0, 0, 0+0.39, 0, 1, 1, 1, 0.12).build().lit, matInst, MAXRES, true);
    pine2 = inst(new Kit().lit(CO(0.56, 0.85, 8), '#ffffff', 0, 1.68, 0, 0, 0.3, 0, 1, 1, 1, 0.08).lit(CO(0.605, 0.357, 8), '#dfeedd', 0, 1.391, 0, 0, 0.3+0.39, 0, 1, 1, 1, 0.12).build().lit, matInst, MAXRES, true);
    pine3 = inst(new Kit().lit(CO(0.38, 0.75, 8), '#ffffff', 0, 2.14, 0, 0, 0.6, 0, 1, 1, 1, 0.08).lit(CO(0.41, 0.315, 8), '#dfeedd', 0, 1.885, 0, 0, 0.6+0.39, 0, 1, 1, 1, 0.12).lit(CO(0.08, 0.3, 5), '#ffffff', 0, 2.6, 0, 0, 0, 0, 1, 1, 1, 0.05).build().lit, matInst, MAXRES, true);
    { const k = new Kit().lit(IC(0.6, 1), '#ffffff', 0, 1.62, 0, 0, 0, 0, 1, 0.85, 1, 0.1)
        .lit(IC(0.4, 0), '#e8ffe0', 0.42, 1.48, 0.22, 0.5, 0, 0, 1, 0.9, 1, 0.12).lit(IC(0.42, 0), '#f4fff0', -0.38, 1.52, -0.26, 0, 0.7, 0, 1, 0.9, 1, 0.12)
        .lit(IC(0.36, 0), '#ffffff', 0.05, 2.05, -0.05, 0.3, 0.2, 0, 1, 1, 1, 0.12).lit(IC(0.34, 0), '#dcf0d4', -0.12, 1.42, 0.44, 0, 0, 0.4, 1, 0.9, 1, 0.12)
        .lit(IC(0.32, 0), '#eaffea', 0.3, 1.9, -0.3, 0.2, 0.4, 0, 1, 1, 1, 0.12).lit(IC(0.3, 0), '#f8fff4', -0.32, 1.9, 0.22, 0.6, 0, 0.3, 1, 1, 1, 0.12)
        .lit(IC(0.28, 0), '#d0e4c8', 0.38, 1.3, -0.28, 0, 0.3, 0, 1, 0.8, 1, 0.12)
        .lit(IC(0.5, 0), '#a8bca0', 0, 1.3, 0, 0, 0.5, 0, 1.15, 0.45, 1.15, 0.1);
      oaks = inst(k.build().lit, matInst, MAXRES, true); }
    rocks = inst(rockGeometry(), matInst, MAXRES, true);
    { const k = new Kit().lit(BX(1, FH, 1), '#ffffff', 0, FH / 2, 0).lit(BX(1.04, 0.1, 1.04), '#c4c4c4', 0, FH - 0.05, 0);
      for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        k.lit(BX(nz ? 0.42 : 0.02, 0.8, nx ? 0.42 : 0.02), '#18181c', nx * 0.505, 1.0, nz * 0.505);               // Fensterhöhle
        k.lit(BX(nz ? 0.5 : 0.06, 0.06, nx ? 0.5 : 0.06), '#b8b8b8', nx * 0.52, 0.58, nz * 0.52);              // Fensterbank
      }
      ruinFloor = inst(k.build().lit, matInst, 9000, true); }
    { const k = new Kit().lit(BX(1, 0.12, 1), '#e6e6e6', 0, 0.06, 0).lit(BX(0.4, 0.22, 0.3), '#d0d0d0', -0.25, 0.2, 0.2, 0, 0.3, 0.2).lit(BX(0.3, 0.16, 0.4), '#dcdcdc', 0.28, 0.16, -0.22, 0.2, 0, 0)
        .lit(CY(0.02, 0.02, 0.4, 4), '#8a4a2a', 0.1, 0.3, 0.1, 0.3, 0, 0.2).lit(CY(0.02, 0.02, 0.32, 4), '#8a4a2a', -0.2, 0.26, -0.15, -0.4, 0, 0.3);
      ruinTop = inst(k.build().lit, matInst, 9000, true); }
    bunkerWall = inst(new Kit().lit(BX(1, 2.2, 1), '#ffffff', 0, 1.1, 0).lit(BX(1.02, 0.18, 1.02), '#d8a82a', 0, 0.09, 0).lit(BX(1.02, 0.06, 1.02), '#1a1a1a', 0, 0.2, 0)
      .lit(BX(1.04, 0.08, 1.04), '#6a6e76', 0, 2.2, 0).build().lit, matInst, 6000, true);
    // Rohre laufen durchgehend an den Wänden entlang (ein Stück pro Wandfeld, immer gleich ausgerichtet)
    bPipe = inst(new Kit().lit(CY(0.06, 0.06, 1.0, 6), '#7a7e86', 0, 2.0, 0, 0, 0, Math.PI / 2).lit(CY(0.04, 0.04, 1.0, 6), '#8a4a2a', 0, 1.82, 0, 0, 0, Math.PI / 2)
      .lit(BX(0.04, 0.3, 0.06), '#4a4e56', 0, 1.9, -0.04).build().lit, matInst, 6000, false);
    // Bunker-Einrichtung: Wandlampen mit Gitter, Kistenstapel, Maschinen, Labortanks
    bLamp = inst(new Kit().lit(BX(0.1, 0.16, 0.36), '#3a3e46', 0, 0, 0).lit(BX(0.04, 0.02, 0.38), '#8a8e96', 0.06, 0.06, 0).lit(BX(0.04, 0.02, 0.38), '#8a8e96', 0.06, -0.06, 0)
      .lit(BX(0.2, 0.03, 0.06), '#3a3e46', -0.06, 0.1, 0).build().lit, matInst, 400, false);
    bLampG = inst(BX(0.05, 0.1, 0.3), new T.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), 400, false);
    { const k = new Kit().lit(BX(0.62, 0.5, 0.62), '#ffffff', -0.1, 0.25, 0.05).lit(BX(0.64, 0.05, 0.64), '#5a4a32', -0.1, 0.5, 0.05)
        .lit(BX(0.5, 0.42, 0.5), '#e8e8e8', 0.18, 0.21, -0.2, 0, 0.3, 0).lit(BX(0.44, 0.38, 0.44), '#f0f0f0', -0.05, 0.69, 0, 0, 0.5, 0)
        .lit(BX(0.04, 0.5, 0.64), '#5a4a32', 0.21, 0.25, 0.05).lit(BX(0.04, 0.5, 0.64), '#5a4a32', -0.41, 0.25, 0.05);
      bCrate = inst(k.build().lit, matInst, 500, true); }
    { const k = new Kit().lit(BX(0.8, 0.9, 0.6), '#5a6068', 0, 0.45, 0).lit(BX(0.84, 0.08, 0.64), '#3a3e46', 0, 0.04, 0).lit(BX(0.5, 0.3, 0.02), '#1a2a22', 0.05, 0.65, 0.31)
        .lit(CY(0.12, 0.12, 0.5, 8), '#7a7e86', -0.25, 1.1, 0).lit(CY(0.05, 0.05, 0.6, 6), '#8a4a2a', 0.25, 1.15, -0.1, 0, 0, 0.5)
        .lit(CY(0.09, 0.09, 0.04, 10), '#c8a040', 0.3, 0.5, 0.31, Math.PI / 2, 0, 0).lit(BX(0.06, 0.06, 0.02), '#d82a2a', -0.25, 0.8, 0.31).lit(BX(0.06, 0.06, 0.02), '#2ad84a', -0.12, 0.8, 0.31);
      bMachine = inst(k.build().lit, matInst, 300, true); }
    bTank = inst(new Kit().lit(CY(0.32, 0.36, 0.14, 12), '#4a4e56', 0, 0.07, 0).lit(CY(0.32, 0.32, 0.12, 12), '#4a4e56', 0, 1.5, 0).lit(CY(0.05, 0.05, 0.4, 6), '#7a7e86', 0, 1.75, 0)
      .lit(BX(0.04, 1.3, 0.04), '#6a6e76', 0.3, 0.8, 0).lit(BX(0.04, 1.3, 0.04), '#6a6e76', -0.3, 0.8, 0).lit(BX(0.04, 1.3, 0.04), '#6a6e76', 0, 0.8, 0.3).lit(BX(0.04, 1.3, 0.04), '#6a6e76', 0, 0.8, -0.3)
      .build().lit, matInst, 200, true);
    bTankG = inst(new Kit().lit(CY(0.28, 0.28, 1.3, 12), '#ffffff', 0, 0.79, 0).lit(SP(0.12, 7, 5), '#c8ffc8', 0.05, 0.9, 0.05).build().lit, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, toneMapped: false }), 200, false);
    ores = inst(new Kit()
      .lit(OC(0.1), '#f6d05a', 0, 0, 0, 0, 0, 0, 0.8, 2.2, 0.8, 0.15)
      .lit(OC(0.08), '#ffe27a', 0.12, -0.04, 0.05, 0, 0, -0.6, 0.8, 1.8, 0.8, 0.15)
      .lit(OC(0.07), '#f2c94c', -0.1, -0.05, -0.06, 0.5, 0, 0.5, 0.8, 1.6, 0.8, 0.15).build().lit,
      new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: '#6a4a08' }), MAXRES, false);
    { const k = new Kit();
      for (let i = 0; i < 8; i++) { const a = i * 2.4, r = 0.03 + (i % 3) * 0.03, h = 0.2 + ((i * 7) % 5) * 0.035; k.lit(CO(0.026, h, 3), i % 3 ? '#ffffff' : '#d8ecc8', Math.cos(a) * r, h / 2, Math.sin(a) * r, Math.sin(a) * 0.35, a, -Math.cos(a) * 0.35); }
      grass = inst(k.build().lit, matInst, MAXDECO, false); }
    { const k = new Kit().lit(CY(0.01, 0.012, 0.24, 4), '#3a7a2a', 0, 0.12, 0).lit(BX(0.08, 0.01, 0.035), '#4a8a3a', 0.04, 0.08, 0, 0, 0, 0.4);
      for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; k.lit(SP(0.035, 5, 3), '#ffffff', Math.cos(a) * 0.045, 0.25, Math.sin(a) * 0.045, 0, -a, 0, 1.4, 0.4, 0.9); }
      k.lit(SP(0.028, 6, 4), '#ffe27a', 0, 0.262, 0);
      flowers = inst(k.build().lit, matInst, MAXDECO, false); }
    { const k = new Kit().lit(IC(0.27, 1), '#ffffff', 0, 0.21, 0, 0, 0, 0, 1, 0.8, 1, 0.08)
        .lit(IC(0.2, 0), '#e8ffe8', 0.22, 0.15, 0.08, 0.4, 0, 0, 1, 0.8, 1, 0.12).lit(IC(0.19, 0), '#ffffff', -0.18, 0.14, 0.12, 0, 0.6, 0, 1, 0.8, 1, 0.12)
        .lit(IC(0.17, 0), '#dcefd8', 0.05, 0.13, -0.22, 0.3, 0.2, 0, 1, 0.8, 1, 0.12).lit(IC(0.15, 0), '#f0fff0', -0.12, 0.32, -0.08, 0.2, 0, 0.4, 1, 0.9, 1, 0.12);
      for (const [x, y, z] of [[0.12, 0.3, 0.14], [-0.1, 0.27, 0.2], [0.24, 0.22, -0.05], [-0.2, 0.25, -0.12], [0.02, 0.38, 0.05], [0.15, 0.18, -0.2]]) k.lit(SP(0.032, 5, 4), '#d8304a', x, y, z);
      bushes = inst(k.build().lit, matInst, MAXDECO, true); }

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
    { const k = new Kit()
        .lit(BX(1.5, 0.32, 0.7), '#ffffff', 0, 0.4, 0).lit(BX(1.52, 0.08, 0.72), '#9a9a9a', 0, 0.24, 0)
        .lit(BX(0.82, 0.3, 0.64), '#e6e6e6', -0.12, 0.71, 0, 0, 0, 0.04)
        .lit(BX(0.04, 0.26, 0.58), '#26303a', 0.3, 0.71, 0, 0, 0, -0.55).lit(BX(0.04, 0.24, 0.56), '#26303a', -0.54, 0.71, 0, 0, 0, 0.45)
        .lit(BX(0.32, 0.2, 0.02), '#26303a', 0.05, 0.73, 0.325).lit(BX(0.32, 0.2, 0.02), '#26303a', -0.3, 0.73, 0.325)
        .lit(BX(0.32, 0.2, 0.02), '#26303a', 0.05, 0.73, -0.325).lit(BX(0.15, 0.15, 0.02), '#151a1e', -0.3, 0.73, -0.33, 0, 0, 0.3)
        .lit(BX(0.01, 0.26, 0.012), '#555', -0.12, 0.42, 0.355).lit(BX(0.01, 0.26, 0.012), '#555', -0.12, 0.42, -0.355)
        .lit(BX(0.03, 0.08, 0.14), '#f4ecc8', 0.755, 0.45, 0.22).lit(BX(0.03, 0.08, 0.14), '#3a3a3a', 0.755, 0.45, -0.22)
        .lit(BX(0.03, 0.07, 0.12), '#c82a2a', -0.755, 0.45, 0.24).lit(BX(0.03, 0.07, 0.12), '#c82a2a', -0.755, 0.45, -0.24)
        .lit(BX(0.04, 0.08, 0.66), '#5a5a5a', 0.77, 0.3, 0).lit(BX(0.04, 0.08, 0.66), '#5a5a5a', -0.77, 0.3, 0);
      for (const [x, z, y, t] of [[0.5, 0.36, 0.17, 0], [-0.5, 0.36, 0.13, 0.4], [0.5, -0.36, 0.17, 0], [-0.48, -0.37, 0.1, -0.3]]) k.lit(CY(0.17, 0.17, 0.12, 10), '#1a1a1a', x, y, z, Math.PI / 2, 0, t).lit(CY(0.08, 0.08, 0.13, 6), '#7a7a7a', x, y, z, Math.PI / 2, 0, t);
      k.lit(BX(0.42, 0.05, 0.5), '#8a4a2a', 0.42, 0.57, 0.05, 0, 0.3, 0.1, 1, 1, 1, 0.2).lit(BX(0.3, 0.05, 0.3), '#7a3a20', -0.5, 0.57, -0.1, 0, 0, 0, 1, 1, 1, 0.2)
        .lit(BX(0.2, 0.04, 0.2), '#9a5a32', -0.1, 0.87, 0.12, 0, 0.5, 0, 1, 1, 1, 0.2);
      cars = inst(k.build().lit, matInst, 600, true); }
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
      for (let i = 0; i < 7; i++) { const zz = -0.38 + i * 0.13, len = 0.16 + ((i * 37) % 5) * 0.05; k.lit(BX(0.04, len, 0.1), i % 2 ? '#f0f0f0' : '#d8d8d8', 0.27, -0.32 - len / 2, zz, 0, 0, ((i * 13) % 5 - 2) * 0.08); }
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
      .lit(mk(0.26, 2), '#e6e6e6', 0.36, 0.1, 0.18, 0.4, 0.3, 0, 1, 1, 1, 0.1)
      .lit(mk(0.18, 3), '#f0f0f0', -0.3, 0.07, 0.28, 0, 0.8, 0, 1, 1, 1, 0.1)
      .lit(mk(0.2, 4), '#dadada', -0.22, 0.12, -0.3, 0.5, 0.2, 0.3, 1, 1, 1, 0.1)
      .lit(mk(0.07, 5), '#cfcfcf', 0.5, 0.03, -0.2).lit(mk(0.06, 6), '#e0e0e0', -0.48, 0.03, 0.05).lit(mk(0.05, 7), '#d4d4d4', 0.15, 0.03, 0.45)
      .lit(BX(0.02, 0.22, 0.12), '#5a5a5a', 0.38, 0.25, 0.05, 0, 0.2, 0.3);
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
      if (bi === 6) {
        if (G.isStreet(x, y)) { const m = (x + 1500) % 15 === 1 || (y + 1500) % 15 === 1; r = 58 + (v % 6); g = 58 + (v % 6); b = 62 + (v % 5); if (m && (x + y) % 3 === 0 && !((x + 1500) % 15 < 3 && (y + 1500) % 15 < 3)) { r = 170; g = 150; b = 70; } }
        else { r = 112 + (v % 11); g = 108 + (v % 9); b = 100 + (v % 7); if (v < 30) { r = 82; g = 92; b = 62; } }
      } else if (bi === 7) {
        const bk = Math.floor((x - G.DUN.x0) / G.DUN.w), tone = [[50, 50, 54], [58, 50, 42], [52, 60, 64]][G.clamp(bk, 0, 2)];
        r = tone[0] + (v % 6); g = tone[1] + (v % 5); b = tone[2] + (v % 6); if ((x + y) % 2 === 0) { r -= 5; g -= 5; b -= 5; }
      }
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
        glow(0.72, 2.4, 0.72, 0.5, '#ff4a2a', false, true); st.glow(SP(0.045, 5, 4), '#ff3a2a', 0.72, 2.39, 0.72);
        const tu = prt('turret', 0, 2.12, 0);
        tu.lit(CY(0.24, 0.3, 0.16, 8), P.metal, 0, 0, 0).lit(BX(0.5, 0.28, 0.36), P.main, 0.05, 0.2, 0).lit(BX(0.18, 0.2, 0.42), P.dark, -0.25, 0.2, 0)
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
        for (let i = 0; i < 4; i++) { st.lit(OC(0.07), '#ffd36b', -0.2 + (i % 2) * 0.4, 0.26, 0.6 + (i >> 1) * 0.15, i, i, 0, 0.9, 1.4, 0.9, 0.15); }
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
    if (b.plated) grp.add(new T.Mesh(platingGeo(b.size), matLit));
    grp.userData = { lvl: b.lvl, type: b.type, plated: !!b.plated, anims, mat, spec };
    scene.add(grp);
    return grp;
  }
  // Stahlplatten mit Nieten rund um den Sockel (Eisen-Verstärkung), je Größe nur einmal gebaut
  function platingGeo(n) {
    return geo('plating' + n, () => {
      const k = new Kit(), h = 0.42, r = n / 2 + 0.03;
      for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const along = n * 0.94, px = sx * r, pz = sz * r;
        k.lit(BX(sz ? along : 0.05, h, sx ? along : 0.05), '#8a929c', px, h / 2, pz).lit(BX(sz ? along + 0.02 : 0.06, 0.05, sx ? along + 0.02 : 0.06), '#5a626c', px, h, pz);
        for (let i = 0; i < Math.max(2, n * 2); i++) {
          const t = (i + 0.5) / Math.max(2, n * 2) - 0.5;
          k.lit(SP(0.025, 5, 4), '#c8d0dc', px + (sz ? t * along : sx * 0.03), h * 0.72, pz + (sx ? t * along : sz * 0.03));
        }
      }
      return k.build().lit;
    });
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
        for (let i = 0; i < 9; i++) { const an = -1.0 + i * 0.26, ex = Math.cos(an) * 0.1725, ez = Math.sin(an) * 0.23, n = Math.atan2(ez / 0.0529, ex / 0.0298); k.add('metal', CO(0.022, 0.055, 3), '#e8e8e8', 0.7 + ex + Math.cos(n) * 0.018, 0, 0.16 + ez + Math.sin(n) * 0.018, 0, -n, -Math.PI / 2, 0.5, 1, 1); }
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
          .lit(CY(0.022, 0.022, 0.2, 8), '#2a2a2e', 0.18, 0.075, 0, 0, 0, Math.PI / 2).lit(BX(0.05, 0.05, 0.03), '#2a2a2e', 0.18, 0.04, 0);
        k.glow(CY(0.016, 0.016, 0.005, 8), '#ff5a3a', 0.281, 0.08, 0, 0, 0, Math.PI / 2);
        break;
      case 'staff':
        // Plasmawerfer: Lauf mit Kühlrippen, leuchtende Energiezellen, Mündung mit Zinken
        k.lit(CY(0.045, 0.05, 0.62, 8), '#3a3e46', 0.42, 0, 0, 0, 0, Math.PI / 2)
          .lit(BX(0.26, 0.1, 0.09), '#4a4e56', 0.08, -0.02, 0).lit(BX(0.07, 0.16, 0.06), '#2a2a2e', 0.02, -0.12, 0, 0, 0, 0.25)
          .lit(BX(0.05, 0.06, 0.04), '#2a2a2e', 0.12, -0.08, 0);
        for (let i = 0; i < 4; i++) k.add('metal', CY(0.065, 0.065, 0.025, 10), '#ffffff', 0.32 + i * 0.07, 0, 0, 0, 0, Math.PI / 2);
        k.lit(CY(0.05, 0.05, 0.2, 8), '#2a2a2e', 0.12, 0.075, 0, 0, 0, Math.PI / 2).glow(CY(0.035, 0.035, 0.17, 8), '#ffb347', 0.12, 0.075, 0, 0, 0, Math.PI / 2)
          .lit(CY(0.065, 0.05, 0.08, 8), '#4a4e56', 0.76, 0, 0, 0, 0, Math.PI / 2);
        for (let i = 0; i < 3; i++) { const a = i / 3 * TAU; k.add('metal', CO(0.02, 0.12, 4), '#ffffff', 0.84, Math.cos(a) * 0.05, Math.sin(a) * 0.05, a, 0, -Math.PI / 2 + 0.3); }
        k.glow(IC(0.05, 1), '#ffb347', 0.86, 0, 0).glow(CY(0.047, 0.047, 0.02, 8), '#ff8a2a', 0.58, 0, 0, 0, 0, Math.PI / 2);
        break;
    }
    return (toolCache[id] = k.build());
  }
  // Spielermodell nach Skin bauen (Blick nach +x). Gibt eine Gruppe zurück, ohne sie in die Szene zu hängen.
  function buildPlayer(p) {
    const sk = G.skinParse(p.skin || ''), O = G.SKIN_OPTS, pick = id => { const d = O.find(o => o.id === id); return (d.colors || d.list)[sk[id]]; };
    const J = pick('c'), SKN = pick('s'), HC = pick('hc'), LENS = pick('v'), PN = pick('p'), hair = sk.h, gear = sk.g, back = sk.b;
    const Jd = '#' + col.set(J).offsetHSL(0, 0, -0.12).getHexString(), Jl = '#' + col.set(J).offsetHSL(0, 0, 0.08).getHexString();
    const SKd = '#' + col.set(SKN).offsetHSL(0, 0, -0.1).getHexString();
    const grp = new T.Group(), body = new T.Group(); grp.add(body);
    const mat = matLit.clone(), metal = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, color: '#dfe6ee', emissive: '#1a1a1a' });
    const steel = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, color: '#9aa0a8', emissive: '#151515' });
    const mesh = (g, parent, x, y, z, m) => { if (!g) return null; const o = new T.Mesh(g, m || mat); o.position.set(x || 0, y || 0, z || 0); o.castShadow = true; (parent || body).add(o); return o; };
    // Beine: Hose, Knieschoner, Stiefel
    const legG = new Kit().lit(BX(0.14, 0.2, 0.15), PN, 0, -0.1, 0).lit(BX(0.125, 0.16, 0.135), PN, 0.005, -0.26, 0)
      .lit(BX(0.04, 0.08, 0.06), '#2a2a2e', 0.0, -0.08, 0.078).lit(BX(0.045, 0.09, 0.11), '#6a6e76', 0.07, -0.2, 0)
      .lit(BX(0.15, 0.05, 0.15), '#4a3020', 0.01, -0.335, 0).lit(BX(0.21, 0.09, 0.16), '#3a2618', 0.035, -0.39, 0).lit(BX(0.22, 0.03, 0.17), '#151010', 0.035, -0.44, 0).build().lit;
    const legs = [];
    for (const s of [-1, 1]) { const gl = new T.Group(); gl.position.set(0, 0.45, s * 0.09); body.add(gl); mesh(legG, gl); legs.push(gl); }
    // Oberkörper: Brust breiter als Taille, Kragen, Reißverschluss, Gürtel mit Taschen, Schulterpanzer, Hals
    const tk = new Kit()
      .lit(BX(0.2, 0.16, 0.33), J, 0, 0.55, 0).lit(BX(0.25, 0.26, 0.41), J, 0, 0.72, 0).lit(BX(0.27, 0.06, 0.36), Jl, 0, 0.84, 0)
      .lit(BX(0.012, 0.36, 0.03), Jd, 0.128, 0.67, 0).lit(BX(0.02, 0.09, 0.09), Jd, 0.128, 0.66, 0.12).lit(BX(0.02, 0.06, 0.07), Jd, 0.128, 0.76, -0.12)
      .lit(BX(0.22, 0.07, 0.26), Jd, -0.005, 0.89, 0).lit(BX(0.04, 0.09, 0.08), Jd, 0.1, 0.9, 0.1, 0, 0, 0.3).lit(BX(0.04, 0.09, 0.08), Jd, 0.1, 0.9, -0.1, 0, 0, 0.3)
      .lit(BX(0.24, 0.07, 0.36), '#4a3020', 0, 0.48, 0).lit(BX(0.02, 0.05, 0.07), '#c8a040', 0.125, 0.48, 0)
      .lit(BX(0.08, 0.1, 0.08), '#5a4a2e', 0.09, 0.47, 0.14).lit(BX(0.08, 0.1, 0.08), '#5a4a2e', 0.09, 0.47, -0.14).lit(BX(0.06, 0.12, 0.06), '#4a3e28', -0.03, 0.46, 0.19)
      .lit(BX(0.18, 0.07, 0.15), '#6a5e52', 0, 0.88, 0.21, -0.38, 0, 0).lit(BX(0.18, 0.07, 0.15), '#6a5e52', 0, 0.88, -0.21, 0.38, 0, 0)
      .lit(BX(0.19, 0.025, 0.16), '#8a4a2a', 0, 0.845, 0.225, -0.38, 0, 0).lit(BX(0.19, 0.025, 0.16), '#8a4a2a', 0, 0.845, -0.225, 0.38, 0, 0)
      .lit(CY(0.06, 0.07, 0.08, 8), SKN, 0, 0.94, 0);
    const gk = new Kit();
    if (back === 0) {   // Rucksack mit Schlafsack und Funkantenne
      tk.lit(BX(0.16, 0.32, 0.3), '#5a4a2a', -0.2, 0.68, 0).lit(BX(0.17, 0.09, 0.31), '#4a3a20', -0.2, 0.82, 0).lit(BX(0.04, 0.12, 0.2), '#4a3a20', -0.29, 0.6, 0)
        .lit(CY(0.075, 0.075, 0.36, 8), '#7a3a2a', -0.22, 0.93, 0, Math.PI / 2, 0, 0).lit(CY(0.078, 0.078, 0.03, 8), '#2a2018', -0.22, 0.93, 0.1, Math.PI / 2, 0, 0)
        .lit(CY(0.008, 0.008, 0.42, 4), '#2a2a2a', -0.27, 1.08, 0.11);
      gk.glow(SP(0.022, 5, 4), LENS, -0.27, 1.3, 0.11);
    } else if (back === 1) {   // Jetpack: zwei Tanks mit Düsen
      for (const s of [-1, 1]) tk.lit(CY(0.07, 0.07, 0.34, 10), '#8a8e96', -0.2, 0.7, s * 0.08).lit(SP(0.07, 8, 5, 0, TAU, 0, Math.PI / 2), '#a8acb4', -0.2, 0.87, s * 0.08)
        .lit(CY(0.05, 0.035, 0.07, 8), '#3a3a3e', -0.2, 0.5, s * 0.08).lit(BX(0.02, 0.3, 0.02), '#c84a2a', -0.27, 0.7, s * 0.08);
      tk.lit(BX(0.06, 0.24, 0.26), '#4a4e56', -0.15, 0.7, 0);
      for (const s of [-1, 1]) gk.glow(CO(0.03, 0.09, 6), LENS, -0.2, 0.43, s * 0.08, Math.PI, 0, 0);
    } else if (back === 2) {   // Schwert-Halfter quer über dem Rücken
      tk.lit(BX(0.04, 0.62, 0.07), '#3a2a1a', -0.16, 0.74, 0, 0.75, 0, 0).lit(BX(0.05, 0.05, 0.12), '#c8a040', -0.17, 0.95, 0.2, 0.75, 0, 0)
        .lit(CY(0.022, 0.022, 0.14, 6), '#5a3a1a', -0.17, 1.02, 0.28, 0.75, 0, 0).lit(BX(0.26, 0.03, 0.03), '#4a3020', 0, 0.72, 0, 0.75, 0, 0);
    }
    // Rüstung (aus der Ausrüstung): Weste, Stiefel, Handschuhe, Helm-Farbe
    const EQ = p.eq || {}, AC = G.ARMOR_COL || [];
    if (EQ.v) {
      const c = AC[EQ.v], cd = '#' + col.set(c).offsetHSL(0, 0, -0.1).getHexString();
      tk.lit(BX(0.04, 0.3, 0.34), c, 0.135, 0.7, 0).lit(BX(0.04, 0.26, 0.32), c, -0.135, 0.7, 0)
        .lit(BX(0.27, 0.04, 0.42), cd, 0, 0.6, 0).lit(BX(0.015, 0.06, 0.1), '#2a2a2a', 0.158, 0.76, 0.08).lit(BX(0.015, 0.06, 0.1), '#2a2a2a', 0.158, 0.76, -0.08);
      if (EQ.v >= 3) for (const s of [-1, 1]) tk.lit(BX(0.2, 0.1, 0.16), cd, 0, 0.9, s * 0.23, s * -0.4, 0, 0);
    }
    if (EQ.b) for (const s of [-1, 1]) tk.lit(BX(0.23, 0.12, 0.18), AC[EQ.b], 0.035, 0.06, s * 0.09);
    mesh(tk.build().lit);
    const gg = gk.build().glow; if (gg) mesh(gg, body, 0, 0, 0, matGlow);
    // Kopf
    const head = new T.Group(); head.position.set(0, 1.03, 0); body.add(head);
    const hk = new Kit()
      .lit(BX(0.26, 0.27, 0.26), SKN, 0, 0, 0).lit(BX(0.04, 0.06, 0.04), SKd, 0.145, -0.02, 0)
      .lit(BX(0.04, 0.07, 0.04), SKd, -0.01, 0, 0.135).lit(BX(0.04, 0.07, 0.04), SKd, -0.01, 0, -0.135)
      .lit(BX(0.015, 0.04, 0.055), '#f4f4f4', 0.131, 0.02, 0.058).lit(BX(0.015, 0.04, 0.055), '#f4f4f4', 0.131, 0.02, -0.058)
      .lit(BX(0.018, 0.035, 0.028), '#1a1a2a', 0.135, 0.018, 0.064).lit(BX(0.018, 0.035, 0.028), '#1a1a2a', 0.135, 0.018, -0.064)
      .lit(BX(0.016, 0.018, 0.07), HC, 0.133, 0.06, 0.058, 0.15, 0, 0).lit(BX(0.016, 0.018, 0.07), HC, 0.133, 0.06, -0.058, -0.15, 0, 0)
      .lit(BX(0.014, 0.014, 0.07), '#8a4a3a', 0.131, -0.075, 0);
    const hood = gear === 3, helmet = gear === 0, mask = gear === 2;
    // Haare (unter Helm/Kapuze nur das, was herausschaut)
    if (!hood) {
      if (hair === 0 || hair === 4 || hair === 5) { if (!helmet) hk.lit(BX(0.28, 0.07, 0.28), HC, -0.005, 0.13, 0); hk.lit(BX(0.08, 0.2, 0.28), HC, -0.105, 0.04, 0).lit(BX(0.06, 0.08, 0.02), HC, 0.03, 0.09, 0.135).lit(BX(0.06, 0.08, 0.02), HC, 0.03, 0.09, -0.135); }
      if (hair === 1 && !helmet) for (let i = 0; i < 5; i++) hk.lit(BX(0.06, 0.08 + (i === 2 ? 0.04 : i % 2 ? 0.03 : 0), 0.05), HC, 0.1 - i * 0.055, 0.17 + (i === 2 ? 0.02 : 0), 0);
      if (hair === 2) { if (!helmet) hk.lit(BX(0.28, 0.07, 0.28), HC, -0.005, 0.13, 0); hk.lit(BX(0.08, 0.36, 0.28), HC, -0.11, -0.04, 0).lit(BX(0.09, 0.24, 0.03), HC, -0.02, -0.02, 0.14).lit(BX(0.09, 0.24, 0.03), HC, -0.02, -0.02, -0.14); }
      if (hair === 4 && !helmet) for (let i = 0; i < 6; i++) hk.lit(CO(0.045, 0.14, 4), HC, 0.06 - (i % 3) * 0.08, 0.2, (i < 3 ? 1 : -1) * 0.06, (i < 3 ? 0.3 : -0.3), 0, (i % 3 - 1) * 0.3);
      if (hair === 5) hk.lit(CY(0.035, 0.02, 0.22, 6), HC, -0.19, -0.02, 0, 0, 0, -0.6).lit(SP(0.04, 6, 4), '#8a2a1a', -0.15, 0.04, 0);
    }
    // Kopfbedeckung
    const goggles = !mask && gear !== 5 && gear !== 2;
    const gogY = helmet ? 0.15 : 0.085;
    if (helmet) {
      hk.add('metal', SP(0.17, 10, 6, 0, TAU, 0, Math.PI / 2), '#ffffff', 0, 0.07, 0).add('metal', BX(0.36, 0.03, 0.36), '#ffffff', 0, 0.065, 0)
        .lit(BX(0.04, 0.05, 0.37), '#8a4a2a', 0, 0.08, 0).lit(CO(0.03, 0.14, 5), '#c0392b', -0.02, 0.27, 0);
    } else if (gear === 1) {
      hk.lit(BX(0.29, 0.07, 0.29), Jd, -0.005, 0.16, 0).lit(BX(0.27, 0.05, 0.27), Jd, -0.005, 0.2, 0).lit(BX(0.13, 0.02, 0.24), Jd, 0.19, 0.13, 0).lit(BX(0.02, 0.05, 0.06), Jl, 0.146, 0.17, 0);
    } else if (mask) {
      hk.lit(BX(0.29, 0.035, 0.29), '#2a2622', 0, 0.06, 0).lit(BX(0.07, 0.16, 0.22), '#3a3e40', 0.13, -0.04, 0)
        .lit(CY(0.06, 0.07, 0.08, 8), '#5a5e60', 0.2, -0.08, 0, 0, 0, Math.PI / 2).lit(CY(0.062, 0.062, 0.02, 8), '#2a2a2a', 0.24, -0.08, 0, 0, 0, Math.PI / 2)
        .lit(CY(0.05, 0.05, 0.04, 8), '#4a4e50', 0.15, 0.04, 0.065, 0, 0, Math.PI / 2).lit(CY(0.05, 0.05, 0.04, 8), '#4a4e50', 0.15, 0.04, -0.065, 0, 0, Math.PI / 2);
    } else if (hood) {
      hk.lit(BX(0.31, 0.08, 0.31), Jd, -0.01, 0.15, 0).lit(BX(0.1, 0.32, 0.31), Jd, -0.12, 0.0, 0).lit(BX(0.26, 0.3, 0.03), Jd, 0.0, 0.0, 0.15).lit(BX(0.26, 0.3, 0.03), Jd, 0.0, 0.0, -0.15)
        .lit(BX(0.1, 0.14, 0.2), Jd, -0.14, -0.14, 0, 0, 0, 0.4);
    } else if (gear === 4) {
      hk.lit(BX(0.28, 0.04, 0.28), '#b0402a', 0, 0.075, 0).lit(BX(0.03, 0.12, 0.04), '#9a3422', -0.15, 0.02, 0.04, 0.3, 0, -0.3).lit(BX(0.03, 0.1, 0.04), '#9a3422', -0.15, 0.03, -0.03, -0.3, 0, -0.4);
    }
    if (goggles) hk.lit(BX(0.285, 0.035, 0.285), '#2a2622', 0, gogY, 0)
      .lit(CY(0.05, 0.05, 0.05, 8), '#5a4a3a', 0.15, gogY, 0.065, 0, 0, Math.PI / 2).lit(CY(0.05, 0.05, 0.05, 8), '#5a4a3a', 0.15, gogY, -0.065, 0, 0, Math.PI / 2);
    const hb = hk.build();
    if (p.eq && p.eq.h) steel.color.set(['#9aa0a8', '#a07a50', '#8a6440', '#c8d0d8', '#5a6a48'][p.eq.h]);
    mesh(hb.lit, head); const helm = mesh(hb.metal, head, 0, 0, 0, steel);
    const lk = new Kit();
    if (goggles) lk.glow(CY(0.038, 0.038, 0.012, 8), LENS, 0.176, gogY, 0.065, 0, 0, Math.PI / 2).glow(CY(0.038, 0.038, 0.012, 8), LENS, 0.176, gogY, -0.065, 0, 0, Math.PI / 2);
    if (mask) lk.glow(CY(0.04, 0.04, 0.01, 8), LENS, 0.172, 0.04, 0.065, 0, 0, Math.PI / 2).glow(CY(0.04, 0.04, 0.01, 8), LENS, 0.172, 0.04, -0.065, 0, 0, Math.PI / 2);
    const lg = lk.build().glow; if (lg) mesh(lg, head, 0, 0, 0, matGlow);
    // Arme: Ärmel, Ellbogen, Armschiene, Handschuh
    const arms = [];
    const armG = new Kit().lit(BX(0.1, 0.17, 0.1), J, 0, -0.085, 0).lit(BX(0.105, 0.05, 0.105), Jd, 0, -0.17, 0)
      .lit(BX(0.115, 0.1, 0.115), '#6a5e52', 0, -0.23, 0).lit(BX(0.118, 0.02, 0.118), '#8a4a2a', 0, -0.2, 0)
      .lit(BX(0.11, 0.09, 0.11), p.eq && p.eq.g ? (G.ARMOR_COL || [])[p.eq.g] : '#3a2a1a', 0, -0.32, 0).lit(BX(0.04, 0.05, 0.05), '#3a2a1a', 0.05, -0.33, 0.03).build().lit;
    for (const s of [-1, 1]) { const ga = new T.Group(); ga.position.set(0, 0.82, s * 0.255); body.add(ga); mesh(armG, ga); arms.push(ga); }
    const tool = new T.Group(); tool.position.set(0.28, 0.52, 0.28); body.add(tool);
    const tools = {};
    for (const id of ['pick', 'sword', 'bow', 'spear', 'axe', 'staff']) {
      const tg = new T.Group(), k = toolKit(id);
      if (k.lit) mesh(k.lit, tg); if (k.metal) mesh(k.metal, tg, 0, 0, 0, metal); if (k.glow) tg.add(new T.Mesh(k.glow, matGlow));
      tool.add(tg); tools[id] = tg;
    }
    const sh = new T.Mesh(geo('shadowDisc', () => new T.CircleGeometry(0.3, 16).rotateX(-Math.PI / 2)), new T.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.25, depthWrite: false }));
    sh.position.y = 0.02; grp.add(sh);
    grp.userData = { body, legs, arms, head, helm, tool, tools, mat, metal, skin: lookKey(p) };
    return grp;
  }
  function makePlayer(p) { const grp = buildPlayer(p); scene.add(grp); return grp; }
  // Waffe in der Hand: der Arm führt die Bewegung, der Griff sitzt immer genau in der Hand (auch mitten im Schlag)
  const HAND = new T.Vector3();
  function poseTool(u, tool, swp) {
    for (const k in u.tools) u.tools[k].visible = k === tool;
    const arm = u.arms[1], ranged = tool === 'bow' || tool === 'staff';
    arm.rotation.set(ranged ? -0.15 : -0.35, 0, (ranged ? 1.15 : 0.75) + swp * (tool === 'spear' ? 0.85 : tool === 'pick' ? 0.9 : 0.4));
    arm.updateMatrix();
    HAND.set(0.005, -0.31, 0).applyMatrix4(arm.matrix);
    u.tool.position.copy(HAND);
    u.tool.rotation.set(0, ranged ? 0.12 : tool === 'spear' ? 0.25 : tool === 'axe' ? 1.6 - swp * 3.6 : tool === 'pick' ? 0.9 - swp * 0.6 : 0.9 - swp * 2.2, tool === 'pick' ? 0.35 - swp * 1.1 : ranged ? 0.1 : 0);
    u.body.rotation.y = tool === 'axe' ? -swp * 0.5 : 0;
  }
  // Aussehen = Skin + Rüstungsstufen; nur wenn sich das ändert, wird das Modell neu gebaut
  function lookKey(p) { const e = p.eq; return (p.skin || '') + '|' + (e ? e.h + '' + e.v + e.g + e.b : ''); }

  // Vorschau für den Skin-Editor im Hauptmenü (eigener kleiner Renderer)
  let pvR = null, pvScene = null, pvCam = null, pvObj = null, pvKey = '';
  R3._dbg = { toolKit, buildPlayer, poseTool };   // für Modell-Vorschauen in Tests
  R3.skinPreview = function (skin, ang) {
    if (!R3.ready) return null;
    if (!pvR) {
      const c = document.createElement('canvas'); c.width = 256; c.height = 320;
      pvR = new T.WebGLRenderer({ canvas: c, alpha: true, antialias: true, preserveDrawingBuffer: true });
      pvR.setPixelRatio(1); pvR.setSize(256, 320, false); pvR.toneMapping = T.ACESFilmicToneMapping; pvR.toneMappingExposure = 1.2;
      pvScene = new T.Scene();
      pvScene.add(new T.HemisphereLight(0xfff4e8, 0x40342c, 1.6));
      const d = new T.DirectionalLight(0xffffff, 2.2); d.position.set(3, 5, 4); pvScene.add(d);
      const r = new T.DirectionalLight(0xff8a40, 1.4); r.position.set(-4, 2, -3); pvScene.add(r);
      pvCam = new T.PerspectiveCamera(30, 256 / 320, 0.1, 50); pvCam.position.set(2.6, 1.25, 0); pvCam.lookAt(0, 0.66, 0);
    }
    if (pvKey !== skin) {
      if (pvObj) pvScene.remove(pvObj);
      pvObj = buildPlayer({ id: 0, skin }); pvKey = skin;
      for (const k in pvObj.userData.tools) pvObj.userData.tools[k].visible = k === 'sword';
      pvObj.userData.tool.rotation.y = 0.9; pvObj.userData.arms[1].rotation.z = 0.75; pvObj.userData.arms[1].rotation.x = -0.35;
      pvObj.children[1].visible = false;
      pvScene.add(pvObj);
    }
    pvObj.rotation.y = ang;
    pvObj.userData.head.rotation.y = Math.sin(ang * 1.7) * 0.15;
    pvR.setClearColor(0x000000, 0); pvR.clear(); pvR.render(pvScene, pvCam);
    return pvR.domElement;
  };

  // Waffe in der Hand (Ego-Perspektive)
  function updateFpView(p, at) {
    // Hand in den Farben des eigenen Skins: Ärmel, Armschiene, Handschuh (Faust um den Griff, Daumen oben)
    const hk = lookKey(p);
    if (fpHand && fpHand.userData.key !== hk) { fpView.remove(fpHand); fpHand.geometry.dispose(); fpHand = null; }
    if (!fpHand) {
      const sk = G.skinParse(p.skin || ''), O = G.SKIN_OPTS, pick = id => { const d = O.find(o => o.id === id); return (d.colors || d.list)[sk[id]]; };
      const J = pick('c'), GL = p.eq && p.eq.g ? (G.ARMOR_COL || [])[p.eq.g] : '#3a2a1a';
      fpHand = new T.Mesh(new Kit().lit(BX(0.13, 0.12, 0.13), GL, 0, -0.005, 0.03).lit(BX(0.05, 0.04, 0.07), GL, 0.04, 0.07, 0.02)
        .lit(BX(0.135, 0.125, 0.06), '#6a5e52', 0, -0.01, 0.12).lit(BX(0.138, 0.02, 0.062), '#8a4a2a', 0, -0.01, 0.15)
        .lit(BX(0.15, 0.15, 0.26), J, 0, -0.02, 0.27).build().lit, matLit);
      fpHand.userData.key = hk; fpHand.renderOrder = 10; fpView.add(fpHand);
    }
    if (!fpTools) {
      fpTools = {}; fpMetal = new T.MeshLambertMaterial({ vertexColors: true, flatShading: true, color: '#dfe6ee', emissive: '#1a1a1a' });
      for (const id of ['pick', 'sword', 'bow', 'spear', 'axe', 'staff']) {
        const tg = new T.Group(), k = toolKit(id);
        if (k.lit) tg.add(new T.Mesh(k.lit, matLit)); if (k.metal) tg.add(new T.Mesh(k.metal, fpMetal)); if (k.glow) tg.add(new T.Mesh(k.glow, matGlow));
        tg.rotation.set(0, Math.PI / 2, id === 'bow' || id === 'staff' ? 0.04 : 0.5); tg.position.set(0, 0, 0);
        fpView.add(tg); fpTools[id] = tg;
      }
      fpView.traverse(o => { o.renderOrder = 10; if (o.material) { o.material = o.material; } });
    }
    for (const k in fpTools) fpTools[k].visible = k === p.tool;
    const swp = p.swing > 0 ? Math.sin((1 - p.swing / 0.22) * Math.PI) : 0;
    const w = walkPh.get('p' + p.id) || { ph: 0, mv: 0 };
    const aim = p.tool === 'bow' || p.tool === 'staff';   // Fernwaffen zeigen auf das Fadenkreuz
    fpView.position.set((aim ? 0.2 : 0.3) + Math.sin(w.ph) * 0.015 * w.mv, (aim ? -0.25 : -0.32) + Math.abs(Math.cos(w.ph)) * 0.015 * w.mv, -0.5 - (p.tool === 'spear' ? swp * 0.35 : 0));
    fpView.rotation.set(aim ? 0.05 + swp * 0.12 : p.tool === 'spear' ? 0 : -swp * 1.3, aim ? 0.1 : p.tool === 'axe' ? swp * 1.2 : 0, p.tool === 'pick' ? swp * 0.4 : 0);
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
    // Rundere Low-Poly-Tiere: Körper aus Ellipsoiden, verjüngte Beine mit Gelenk, Blick nach +x
    const D = G.ADEF[an.type], grp = new T.Group(), s = an.r / G.TS;
    const body = new T.Group(); body.scale.setScalar(s * 1.15); grp.add(body);
    const mat = matLit.clone(), fc = D.color;
    const c = new T.Color(fc), lt = '#' + c.clone().offsetHSL(0, -0.05, 0.16).getHexString(), dk = '#' + c.clone().offsetHSL(0, 0, -0.13).getHexString();
    const add = (geom, parent, x, y, z) => { const o = new T.Mesh(geom, mat); o.position.set(x || 0, y || 0, z || 0); o.castShadow = true; (parent || body).add(o); return o; };
    const legs = [];
    // Bein mit Oberschenkel, Gelenk und Huf/Pfote; hind = Hinterbein (Knie nach hinten)
    const leg = (x, z, L, w, foot, hind) => {
      const pv = new T.Group(); pv.position.set(x, L, z); body.add(pv);
      const k = new Kit().lit(SP(w * 0.75, 7, 5), fc, 0, -w * 0.2, 0, 0, 0, 0, 1.1, 1.5, 1)
        .lit(CY(w * 0.5, w * 0.32, L * 0.5, 6), fc, hind ? -w * 0.25 : w * 0.05, -L * 0.3, 0, 0, 0, hind ? 0.25 : -0.05)
        .lit(SP(w * 0.3, 6, 4), dk, hind ? -w * 0.42 : w * 0.08, -L * 0.55, 0)
        .lit(CY(w * 0.3, w * 0.24, L * 0.42, 6), dk, hind ? -w * 0.25 : w * 0.05, -L * 0.76, 0, 0, 0, hind ? -0.2 : 0.03)
        .lit(CY(w * 0.3, w * 0.36, L * 0.09, 6), foot, w * 0.02, -L * 0.96, 0);
      add(k.build().lit, pv); legs.push(pv);
    };
    const k = new Kit();
    let L;
    if (an.type === 'deer') {
      L = 1.3;
      k.lit(SP(0.5, 10, 7), fc, 0.05, L + 0.38, 0, 0, 0, 0, 1.75, 0.75, 0.72).lit(SP(0.36, 8, 6), fc, 0.45, L + 0.45, 0, 0, 0, 0.2, 1.1, 1, 0.95)
        .lit(SP(0.38, 8, 6), fc, -0.48, L + 0.42, 0, 0, 0, 0, 1.1, 0.95, 0.9).lit(SP(0.42, 8, 6), lt, 0.05, L + 0.14, 0, 0, 0, 0, 1.6, 0.42, 0.62)
        .lit(SP(0.26, 7, 5), '#f4ead8', -0.82, L + 0.42, 0, 0, 0, 0, 0.4, 1, 1.1).lit(CO(0.1, 0.24, 6), '#f4ead8', -0.88, L + 0.62, 0, 0, 0, 0.9)
        .lit(CY(0.15, 0.21, 0.82, 8), fc, 0.78, L + 0.85, 0, 0, 0, -0.55).lit(CY(0.08, 0.13, 0.6, 7), lt, 0.88, L + 0.74, 0, 0, 0, -0.55)
        .lit(SP(0.2, 8, 6), fc, 1.1, L + 1.22, 0, 0, 0, 0, 1.25, 0.95, 0.9).lit(CY(0.09, 0.14, 0.32, 7), fc, 1.36, L + 1.14, 0, 0, 0, Math.PI / 2 + 0.3)
        .lit(SP(0.08, 6, 4), '#1a1410', 1.52, L + 1.08, 0).lit(SP(0.035, 5, 4), '#0a0a0a', 1.2, L + 1.28, 0.16).lit(SP(0.035, 5, 4), '#0a0a0a', 1.2, L + 1.28, -0.16)
        .lit(SP(0.012, 4, 3), '#ffffff', 1.225, L + 1.3, 0.17).lit(SP(0.012, 4, 3), '#ffffff', 1.225, L + 1.3, -0.15);
      for (const sd of [-1, 1]) {
        k.lit(SP(0.1, 6, 4), fc, 1.0, L + 1.42, sd * 0.2, sd * 0.6, 0, 0, 0.6, 1.6, 1.2).lit(SP(0.07, 6, 4), '#e8c0b0', 1.02, L + 1.42, sd * 0.215, sd * 0.6, 0, 0, 0.3, 1.4, 1);
        // Geweih: Stange mit drei Enden, leicht nach hinten geschwungen
        k.lit(CY(0.025, 0.04, 0.55, 5), '#d8c090', 0.98, L + 1.62, sd * 0.2, sd * 0.4, 0, 0.15)
          .lit(CY(0.02, 0.03, 0.28, 5), '#e0caa0', 1.1, L + 1.66, sd * 0.27, sd * 0.25, 0, -0.85).lit(CY(0.02, 0.03, 0.3, 5), '#e0caa0', 0.88, L + 1.84, sd * 0.34, sd * 0.55, 0, 0.55)
          .lit(CY(0.015, 0.025, 0.26, 5), '#e8d4aa', 1.0, L + 1.96, sd * 0.4, sd * 0.85, 0, -0.25).lit(CY(0.015, 0.02, 0.2, 5), '#e8d4aa', 0.82, L + 2.0, sd * 0.42, sd * 0.4, 0, 0.9);
      }
      for (const [x, z] of [[-0.3, 0.2], [0.1, -0.24], [-0.5, -0.12], [0.35, 0.18], [-0.1, 0.06], [0.2, -0.05]]) k.lit(SP(0.045, 5, 3), '#f4e8cc', x, L + 0.74, z, 0, 0, 0, 1, 0.4, 1);
      leg(0.55, 0.2, L, 0.15, '#2a2018'); leg(0.55, -0.2, L, 0.15, '#2a2018'); leg(-0.55, 0.2, L, 0.17, '#2a2018', true); leg(-0.55, -0.2, L, 0.17, '#2a2018', true);
    } else if (an.type === 'rabbit') {
      L = 0.3;
      k.lit(SP(0.45, 10, 7), fc, -0.08, L + 0.36, 0, 0, 0, 0.15, 1.25, 0.95, 0.95).lit(SP(0.32, 8, 6), lt, 0.12, L + 0.22, 0, 0, 0, 0, 1.2, 0.7, 1)
        .lit(SP(0.3, 8, 6), fc, 0.5, L + 0.72, 0, 0, 0, 0, 1.1, 1, 0.95).lit(SP(0.15, 7, 5), lt, 0.74, L + 0.62, 0, 0, 0, 0, 1, 0.8, 1.3)
        .lit(SP(0.05, 5, 4), '#e87a90', 0.86, L + 0.68, 0).lit(SP(0.06, 6, 4), '#0a0a0a', 0.68, L + 0.8, 0.17).lit(SP(0.06, 6, 4), '#0a0a0a', 0.68, L + 0.8, -0.17)
        .lit(SP(0.018, 4, 3), '#ffffff', 0.72, L + 0.83, 0.19).lit(SP(0.018, 4, 3), '#ffffff', 0.72, L + 0.83, -0.15)
        .lit(SP(0.17, 7, 5), '#ffffff', -0.62, L + 0.48, 0)
        .lit(SP(0.26, 7, 5), fc, -0.3, L + 0.04, 0.26, 0, 0, 0, 1.2, 1, 0.6).lit(SP(0.26, 7, 5), fc, -0.3, L + 0.04, -0.26, 0, 0, 0, 1.2, 1, 0.6)
        .lit(SP(0.14, 6, 4), lt, -0.12, 0.05, 0.26, 0, 0, 0, 2.2, 0.5, 0.9).lit(SP(0.14, 6, 4), lt, -0.12, 0.05, -0.26, 0, 0, 0, 2.2, 0.5, 0.9);
      for (let i = 0; i < 3; i++) for (const sd of [-1, 1]) k.lit(BX(0.008, 0.008, 0.22), '#e8e8e8', 0.8, L + 0.66 + (i - 1) * 0.03, sd * 0.14, 0, sd * (i - 1) * 0.2, 0);
      for (const sd of [-1, 1]) k.lit(SP(0.1, 7, 5), fc, 0.36, L + 1.18, sd * 0.13, sd * 0.25, 0, 0.3, 0.55, 3.2, 1.1).lit(SP(0.07, 6, 4), '#f0a8b8', 0.39, L + 1.18, sd * 0.135, sd * 0.25, 0, 0.3, 0.3, 2.8, 0.9);
      leg(0.33, 0.15, L, 0.1, lt); leg(0.33, -0.15, L, 0.1, lt);
    } else {
      L = 0.55;
      k.lit(SP(0.52, 10, 7), fc, -0.05, L + 0.44, 0, 0, 0, 0, 1.55, 0.85, 0.85).lit(SP(0.48, 9, 6), fc, 0.35, L + 0.56, 0, 0, 0, 0, 1.1, 1.05, 1)
        .lit(SP(0.44, 8, 6), dk, -0.05, L + 0.12, 0, 0, 0, 0, 1.4, 0.4, 0.75)
        .lit(SP(0.3, 8, 6), fc, 0.86, L + 0.42, 0, 0, 0, -0.35, 1.35, 1, 0.95).lit(CY(0.13, 0.19, 0.3, 8), '#8a6050', 1.22, L + 0.26, 0, 0, 0, Math.PI / 2 + 0.35)
        .lit(CY(0.13, 0.13, 0.02, 8), '#5a3a30', 1.37, L + 0.21, 0, 0, 0, Math.PI / 2 + 0.35)
        .lit(SP(0.025, 4, 3), '#1a0a0a', 1.385, L + 0.22, 0.05).lit(SP(0.025, 4, 3), '#1a0a0a', 1.385, L + 0.22, -0.05)
        .lit(SP(0.04, 5, 4), '#ffcf4a', 1.02, L + 0.58, 0.2).lit(SP(0.04, 5, 4), '#ffcf4a', 1.02, L + 0.58, -0.2)
        .lit(SP(0.02, 4, 3), '#1a0a0a', 1.05, L + 0.58, 0.21).lit(SP(0.02, 4, 3), '#1a0a0a', 1.05, L + 0.58, -0.21)
        .lit(CY(0.025, 0.015, 0.3, 4), dk, -0.85, L + 0.6, 0, 0, 0, 0.9).lit(SP(0.045, 4, 3), '#2a1a10', -0.97, L + 0.71, 0);
      for (const sd of [-1, 1]) k.lit(CO(0.04, 0.3, 5), '#f4ecd8', 1.24, L + 0.36, sd * 0.17, sd * 0.4, 0, -0.55).lit(CO(0.11, 0.22, 4), dk, 0.74, L + 0.8, sd * 0.22, sd * 0.5, 0, 0.35);
      for (let i = 0; i < 11; i++) k.lit(CO(0.06, 0.2 + (i % 3) * 0.06, 4), '#2a1a10', -0.62 + i * 0.13, L + 0.86 + Math.sin(i * 0.5) * 0.06 + (i > 5 ? 0.1 : 0), 0, 0, i, -0.25);
      leg(0.5, 0.25, L, 0.21, '#1a1410'); leg(0.5, -0.25, L, 0.21, '#1a1410'); leg(-0.55, 0.25, L, 0.21, '#1a1410', true); leg(-0.55, -0.25, L, 0.21, '#1a1410', true);
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
  let hatchObjs = null;
  function lootModel(big) {
    const grp = new T.Group(), k = new Kit();
    // Sack: bauchiger Körper, abgebundener Hals, Kordel, Flicken und ein Goldstück obenauf
    k.lit(SP(0.24, 9, 7), '#8a6a3e', 0, 0.2, 0, 0, 0, 0, 1, 0.85, 1).lit(CY(0.08, 0.14, 0.12, 8), '#7a5a32', 0, 0.42, 0)
      .lit(TO(0.085, 0.022, 5, 10), '#c8a050', 0, 0.42, 0, Math.PI / 2, 0, 0).lit(CO(0.12, 0.12, 8), '#8a6a3e', 0, 0.53, 0, Math.PI)
      .lit(BX(0.12, 0.1, 0.02), '#6a4a2a', 0.1, 0.18, 0.2, 0, 0.4, 0).lit(CY(0.06, 0.06, 0.02, 10), '#ffd36b', -0.06, 0.6, 0.02, 0.3, 0, 0.5);
    if (big) k.lit(SP(0.18, 8, 6), '#6a5a3a', 0.26, 0.15, 0.1, 0, 0, 0, 1, 0.8, 1).lit(CY(0.07, 0.07, 0.03, 10), '#ffd36b', 0.3, 0.3, 0.1, 0.4, 0, 0.2)
      .lit(BX(0.3, 0.2, 0.22), '#4a5a3a', -0.3, 0.1, 0.05, 0, 0.3, 0).lit(BX(0.31, 0.04, 0.23), '#d8a82a', -0.3, 0.15, 0.05, 0, 0.3, 0);
    k.glow(IC(0.04, 0), '#fff3b0', -0.06, 0.62, 0.04);
    const g2 = k.build(), a = new T.Mesh(g2.lit, matLit); a.castShadow = true; grp.add(a); grp.add(new T.Mesh(g2.glow, matGlow));
    if (big) grp.scale.setScalar(1.5);
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
  let quality = 2;
  const GRASS_Q = [0.35, 0.7, 1];   // Grasdichte je Grafikstufe
  R3.setQuality = q => { quality = Math.max(0, Math.min(2, q | 0)); };
  function render(dt) {
    const S = G.S;
    iconBudget = 4;   // höchstens ein paar neue Icons pro Bild erzeugen
    if (!S) return;
    frameNo++;
    const TS = G.TS, MAP = G.MAP, at = G.animT;
    const w = window.innerWidth, h = window.innerHeight, key = w + 'x' + h + 'q' + quality;
    if (key !== lastSize) {
      lastSize = key;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, [0.75, 1, 1.5][quality]));
      sun.castShadow = quality > 0;
      renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    if (S !== lastS) {
      lastS = S; buildGround(S); walkPh.clear();
      for (const o of buildingObjs.values()) disposeGroup(o); buildingObjs.clear();
      for (const o of chestObjs.values()) scene.remove(o); chestObjs.clear();
      for (const o of animalObjs.values()) scene.remove(o); animalObjs.clear();
      if (hatchObjs) { for (const hb of hatchObjs) { scene.remove(hb.o1); scene.remove(hb.o2); } hatchObjs = null; }
    }

    // Kamera: schräg von oben, folgt dem Spieler
    let cx = (G.camX + G.VW / 2) / TS, cz = (G.camY + G.VH / 2) / TS;
    R3.yaw += (R3.yawT - R3.yaw) * Math.min(1, (dt || 0.016) * 8);
    if (G.mode === 'menu') { cx = MAP / 2; cz = MAP / 2; }
    const sy = Math.sin(R3.yaw), cyw = Math.cos(R3.yaw);
    const height = G.clamp(G.VW / TS * 0.72, 13, 24) * R3.zoomLevel;
    let shx = 0, shz = 0;
    if (S.shake > 0.2 && G.mode === 'play' && R3.shakeOn !== false) { shx = (Math.random() - 0.5) * S.shake * 0.03; shz = (Math.random() - 0.5) * S.shake * 0.03; }
    // Ansichten: Third-Person (Kamera hinter der Schulter) oder Ego-Perspektive (R3.eye)
    const viewOn = R3.fp && G.mode !== 'menu' && S.player && S.player.dead <= 0, fpOn = viewOn && R3.eye, tpOn = viewOn && !R3.eye;
    if (viewOn) { cx = S.player.x / TS; cz = S.player.y / TS; }   // Umgebung immer um die Figur (auch direkt nach einem Teleport)
    const camKey = fpOn ? 'fp' : tpOn ? 'tp' : 'top';
    if (camKey !== lastFp) {
      lastFp = camKey;
      camera.fov = fpOn ? 72 : tpOn ? 62 : 42; camera.near = fpOn ? 0.05 : tpOn ? 0.1 : 0.5; camera.updateProjectionMatrix();
    }
    if (tpOn) {
      const me = S.player, px = me.x / TS, pz = me.y / TS;
      const pivotY = terrainH(px, pz) + (me.z || 0) / TS + 1.35;
      const cp = Math.cos(R3.pitch), fx = -Math.sin(R3.yaw) * cp, fy = Math.sin(R3.pitch), fz = -Math.cos(R3.yaw) * cp;
      const rx = Math.cos(R3.yaw), rz = -Math.sin(R3.yaw), dist = 3.6 * R3.zoomLevel, side = 0.55;
      let camX = px - fx * dist + rx * side, camY = pivotY - fy * dist + 0.35, camZ = pz - fz * dist + rz * side;
      // Kamera nicht in Gebäude oder Bäume schieben: von der Figur aus prüfen und davor stehen bleiben
      for (let t = 0.2; t <= 1.001; t += 0.1) {
        const sx = px + (camX - px) * t, sz = pz + (camZ - pz) * t, ti = Math.floor(sz) * MAP + Math.floor(sx);
        if (ti >= 0 && ti < MAP * MAP && (S.bmap[ti] || S.res[ti] === 1 || S.res[ti] === 4 || S.res[ti] === 8)) {
          const k = Math.max(0.12, t - 0.15); camX = px + (camX - px) * k; camY = pivotY + (camY - pivotY) * k + 0.25 * (1 - k); camZ = pz + (camZ - pz) * k; break;
        }
      }
      camY = Math.max(camY, terrainH(camX, camZ) + 0.35);
      camera.position.set(camX + shx * 0.4, camY, camZ + shz * 0.4);
      camera.lookAt(px + rx * side + fx * 12, pivotY + 0.35 + fy * 12, pz + rz * side + fz * 12);
    } else if (fpOn) {
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

    camera.updateMatrixWorld();
    projM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frus.setFromProjectionMatrix(projM);

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
    const bunkerV = camBi === 7;
    if (bunkerV) { hemi.color.set('#5a6070'); hemi.intensity = 0.32; sun.intensity = 0.04; fogColor.set('#050608'); }
    if (dimV) { hemi.color.set('#8a5ac8'); hemi.intensity = Math.max(0.7, hemi.intensity * 0.8); sun.color.set('#b07aff'); sun.intensity *= 0.35; }
    else if (night < 0.3) sun.color.set(camBi === 3 ? '#f4f8ff' : '#ffe2c0');
    scene.background.copy(fogColor); scene.fog.color.copy(fogColor);
    scene.fog.near = 30 - night * 8 - wet * 4; scene.fog.far = 64 - night * 18 - wet * 8;
    if (fpOn) { scene.fog.near = 7 - night * 3; scene.fog.far = 32 - night * 12 - wet * 6; }
    else if (tpOn) { scene.fog.near = 9 - night * 3; scene.fog.far = 36 - night * 11 - wet * 6; }
    if (bunkerV) { scene.background.copy(fogColor); scene.fog.color.copy(fogColor); scene.fog.near = 4; scene.fog.far = 20; }

    gN = 0;
    // Punktlichter: die wichtigsten Lichtquellen in Kameranähe
    const cand = [];
    const addL = (x, y, hgt, c, inten, dist, always) => {
      const d2 = (x / TS - cx) ** 2 + (y / TS - cz) ** 2;
      if (d2 < 900) cand.push({ x: x / TS, y: hgt, z: y / TS, c, i: always ? inten : inten * night, dist, d2, always });
    };
    for (const s of S.strikes || []) addL(s.x, s.y, 4, '#d8e4ff', 120 * G.clamp(s.life / 0.45, 0, 1), 16, true);
    for (const f of S.flashes) addL(f.x, f.y, 1.5, '#ffb347', 30 * G.clamp(f.life / f.max, 0, 1), f.r / TS * 1.2, true);
    for (const q of S.players) if (q.dead <= 0) { const inB = S.biome && S.biome[G.clamp(Math.floor(q.y / TS), 0, MAP - 1) * MAP + G.clamp(Math.floor(q.x / TS), 0, MAP - 1)] === 7; addL(q.x, q.y, inB ? 1.8 : 2.2, inB ? '#fff2d8' : '#ffd9a0', inB ? 11 : 14, inB ? 9 : 8, inB); }
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
    for (const f of S.fires || []) addL(f.x, f.y, 1.0, '#ff8a2a', 16 * Math.min(1, f.t), f.r / TS * 2.2, true);
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
    if (bunkerV) {
      const lr = 10;
      for (let ty = Math.max(0, Math.floor(cz - lr)); ty <= Math.min(MAP - 1, Math.ceil(cz + lr)); ty++) for (let tx = Math.max(0, Math.floor(cx - lr)); tx <= Math.min(MAP - 1, Math.ceil(cx + lr)); tx++) {
        const i = ty * MAP + tx, v = S.variant[i];
        if (S.res[i] !== 8 || v % 7 || S.biome[i] !== 7) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const j = i + dz * MAP + dx; if (S.res[j] === 8 || S.biome[j] !== 7) continue;
          const lx = tx + 0.5 + dx * 0.9, lz = ty + 0.5 + dz * 0.9, d2 = (lx - cx) ** 2 + (lz - cz) ** 2;
          cand.push({ x: lx, y: 1.75, z: lz, c: v % 12 === 0 ? '#ff4a3a' : '#ffd890', i: Math.sin(at * 9 + v) > -0.92 ? 3.2 : 0.6, dist: 5, d2, always: false });
          break;
        }
      }
    }
    cand.sort((a, b) => (b.always - a.always) || a.d2 - b.d2);
    for (let i = 0; i < NL; i++) {
      const L = pointLights[i], c = cand[i];
      if (c && c.i > 0.05) { L.position.set(c.x, c.y, c.z); L.color.set(c.c); L.intensity = c.i; L.distance = c.dist; }
      else L.intensity = 0;
    }

    // Natur in Sichtweite
    // nur so weit, wie man durch den Nebel sieht
    const R = Math.min(30, Math.ceil(scene.fog.far) + 5), R2 = R * R, x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(MAP - 1, Math.ceil(cx + R));
    const z0 = Math.max(0, Math.floor(cz - R - 4)), z1 = Math.min(MAP - 1, Math.ceil(cz + R + 4));
    let nbp = 0, nbl = 0, nbc = 0, nbm = 0, nbt = 0, nbw = 0, nrf = 0, nrt = 0, npk = 0, nps = 0, nt = 0, np = 0, no = 0, nr = 0, ng = 0, ngr = 0, nfl = 0, nbu = 0, nca = 0, nsc = 0, nvo = 0, ncr = 0, ncar = 0, nbar2 = 0, nrub = 0, nlamp = 0;
    const BI = S.biome || null;
    const sway = (wet === 2 ? 0.16 : wet ? 0.09 : 0.05);
    for (let ty = z0; ty <= z1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const i = ty * MAP + tx, k = S.res[i], v = S.variant[i];
      const px = tx + 0.5, pz = ty + 0.5;
      // Leistung: nur zeichnen, was im Sichtfeld der Kamera liegt (Nebelgrenze + Sichtkegel)
      const dxv = px - cx, dzv = pz - cz, dd = dxv * dxv + dzv * dzv;
      if (dd > R2) continue;
      const bi = BI ? BI[i] : 0;
      if (dd > 6 && !(k === 8 && bi === 6 ? inView(px, 4.5, pz, 5.2) : k === 6 ? inView(px, 2, pz, 3.6) : inView(px, 1.2, pz, 2.2))) continue;
      if (!k) {
        if (S.bmap[i]) continue;
        const hv = hash(i);
        // Ruinen der alten Welt (nur Optik, blockiert nichts)
        if (bi !== 5 && bi !== 7 && !(S.hq && Math.abs(tx - S.hq.tx - 1) < 5 && Math.abs(ty - S.hq.ty - 1) < 5)) {
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
        if (bi === 7) continue;
        if (bi === 6 && v % 7) continue;   // Stadt: nur vereinzeltes Unkraut
        if (bi === 2 || bi === 3 || bi === 5) {
          if (bi === 5 && v % 13 === 0) glowAt(px + Math.sin(at * 0.7 + i) * 0.4, 0.3 + ((at * 0.4 + hash(i) * 3) % 3), pz, 0.22, '#c890ff', 0.7);
          if (bi === 2 && v % 19 === 0 && nbu < MAXDECO) { setInst(bushes, nbu, px, 0, pz, 0.6, 0.5, 0.6, v); bushes.setColorAt(nbu, col.setRGB(0.55, 0.48, 0.28)); nbu++; }
          continue;
        }
        if (hv < (bi === 4 ? 0.7 : 0.45) * GRASS_Q[quality] && ngr < MAXDECO && dd < 400) {
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
      if (k === 7 && bi === 7) {
        const bk = Math.floor((tx - G.DUN.x0) / G.DUN.w);
        if (bk === 2 && v % 2 === 0) { if (nbt < 200) { setInst(bTank, nbt, px, 0, pz, 1, 1, 1, v); setInst(bTankG, nbt, px, 0, pz, 1, 1, 1, v); bTankG.setColorAt(nbt, col.set(v % 4 ? '#5aff8a' : '#5ac8ff')); nbt++; glowAt(px, 0.9, pz, 1.3, v % 4 ? '#5aff8a' : '#5ac8ff', 0.35); } }
        else if (bk === 1 && v % 2 === 0) { if (nbm < 300) { setInst(bMachine, nbm, px, 0, pz, 1, 1, 1, (v % 4) * Math.PI / 2); bMachine.setColorAt(nbm, WHITE); nbm++; } }
        else if (nbc < 500) { setInst(bCrate, nbc, px, 0, pz, 1, 1, 1, (v % 4) * Math.PI / 2 + (v % 3) * 0.1); bCrate.setColorAt(nbc, col.set(['#6a7a4a', '#7a6a4a', '#5a6a5a'][v % 3])); nbc++; }
        continue;
      }
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
      if (k === 8) {
        // Mauer: in der Stadt je Grundstück 1–4 Stockwerke, im Bunker niedrig und dunkel
        if (bi === 7) {
          if (nbw < 6000) { setInst(bunkerWall, nbw, px, 0, pz, 1, 1, 1, (v % 4) * Math.PI / 2); bunkerWall.setColorAt(nbw, col.setRGB(0.12 + (v % 5) * 0.006, 0.125, 0.14)); nbw++; }
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const j = i + dz * MAP + dx;
            if (S.res[j] === 8 || BI[j] !== 7) continue;
            if (nbp < 6000) { setInst(bPipe, nbp, px + dx * 0.56, 0, pz + dz * 0.56, 1, 1, 1, Math.atan2(-dz, dx) + Math.PI / 2); bPipe.setColorAt(nbp, WHITE); nbp++; }
            if (v % 7 || nbl >= 400) continue;
            const lx = px + dx * 0.56, lz = pz + dz * 0.56, ry = Math.atan2(-dz, dx), on = Math.sin(at * 9 + v) > -0.92 ? 1 : 0.2;
            setInst(bLamp, nbl, lx, 1.75, lz, 1, 1, 1, ry); bLamp.setColorAt(nbl, WHITE);
            setInst(bLampG, nbl, lx + dx * 0.04, 1.75, lz + dz * 0.04, 1, 1, 1, ry); bLampG.setColorAt(nbl, col.set(v % 12 === 0 ? '#ff4a3a' : '#ffe6b0').multiplyScalar(on)); nbl++;
            glowAt(lx + dx * 0.15, 1.75, lz + dz * 0.15, 1.1, v % 12 === 0 ? '#ff4a3a' : '#ffd890', 0.45 * on);
          }
          continue;
        }
        const lot = Math.floor(tx / 15) * 977 + Math.floor(ty / 15) * 131 + (S.seed | 0);
        let fl = 2 + Math.floor(hash(lot) * 4);
        if (v % 5 === 0) fl--;                       // abgebrochene Kanten
        if (v % 11 === 0) fl = 1;
        const c0 = 0.58 + hash(lot + 3) * 0.22, tint = hash(lot + 7);
        col.setRGB(c0 * (tint > 0.66 ? 1.05 : 1), c0 * 0.97, c0 * (tint < 0.33 ? 0.82 : 0.92));
        for (let f = 0; f < fl && nrf < 9000; f++) { setInst(ruinFloor, nrf, px, f * FH, pz, 1, 1, 1, 0); ruinFloor.setColorAt(nrf, col); nrf++; }
        if (nrt < 9000) { setInst(ruinTop, nrt, px, fl * FH, pz, 1, 0.6 + (v % 4) * 0.25, 1, (v % 4) * Math.PI / 2); ruinTop.setColorAt(nrt, col); nrt++; }
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
    ruinFloor.count = nrf; ruinTop.count = nrt; bunkerWall.count = nbw; done(ruinFloor, ruinTop, bunkerWall);
    bPipe.count = nbp; bLamp.count = bLampG.count = nbl; bCrate.count = nbc; bMachine.count = nbm; bTank.count = bTankG.count = nbt; done(bPipe, bLamp, bLampG, bCrate, bMachine, bTank, bTankG);
    grass.count = ngr; flowers.count = nfl; bushes.count = nbu; cacti.count = nca; snowcap.count = nsc; voids.count = nvo; crystals.count = ncr;
    cars.count = ncar; barrels.count = nbar2; rubble.count = nrub; lamps.count = nlamp;
    done(trunks, pine1, pine2, pine3, oaks, rocks, ores, grass, flowers, bushes, cacti, snowcap, voids, crystals, cars, barrels, rubble, lamps);

    // Gebäude
    const seen = new Set();
    for (const b of S.buildings) {
      seen.add(b.id);
      let o = buildingObjs.get(b.id);
      if (o && (o.userData.lvl !== b.lvl || o.userData.type !== b.type || o.userData.plated !== !!b.plated)) { disposeGroup(o); o = null; }
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
      if (!inView(x, rr, zz, rr * 2 + 0.6)) continue;
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
      if (o && o.userData.skin !== lookKey(p)) { scene.remove(o); o.userData.mat.dispose(); o.userData.metal.dispose(); o = null; }
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
      poseTool(u, p.tool, p.swing > 0 ? Math.sin((1 - p.swing / 0.22) * Math.PI) : 0);
      u.head.rotation.y = Math.sin(at * 0.7 + p.id) * 0.1;
      const lv = (p.tl && p.tl[p.tool]) || 1;
      if (u.lv !== lv) { u.lv = lv; u.metal.color.set(G.TMET[Math.min(4, lv - 1)]); }
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
    // Molotow-Feuer: wenige flackernde Leuchtpunkte (günstig, keine eigenen Meshes)
    for (const f of S.fires || []) {
      const a = Math.min(1, f.t), r = f.r / TS;
      for (let k = 0; k < 5; k++) { const an = k * 1.26 + at * 0.7, d = r * (0.2 + 0.5 * ((k * 37) % 10) / 10); glowAt(f.x / TS + Math.cos(an) * d, 0.3 + 0.25 * Math.abs(Math.sin(at * 9 + k)), f.y / TS + Math.sin(an) * d, 1.1, k % 2 ? '#ff8a2a' : '#ffcf4a', a * 0.85); }
      glowAt(f.x / TS, 0.05, f.y / TS, r * 2.2, '#ff5a1a', a * 0.35);
    }

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

    // Bunker-Luken (draußen) und Ausgänge (drinnen) – einmal gebaut, dann nur noch Leuchten
    if (!hatchObjs) {
      hatchObjs = [];
      for (let k = 0; k < G.DUN.n; k++) {
        const h = G.hatchPos(k), e = G.dunExit(k);
        const out = new T.Group(), ki = new Kit()
          .lit(BX(1.8, 0.2, 1.8), '#5a5a5e', 0, 0.1, 0).lit(BX(1.9, 0.08, 0.2), '#d8a82a', 0, 0.2, 0.85).lit(BX(1.9, 0.08, 0.2), '#d8a82a', 0, 0.2, -0.85)
          .lit(CY(0.55, 0.6, 0.18, 14), '#6a6e76', 0, 0.28, 0).lit(CY(0.45, 0.45, 0.06, 14), '#3a3e46', 0, 0.39, 0)
          .lit(TO(0.25, 0.04, 5, 14), '#9aa0a8', 0, 0.44, 0, Math.PI / 2, 0, 0).lit(BX(0.06, 0.9, 0.06), '#4a4a4e', 0.75, 0.6, 0.75).lit(BX(0.4, 0.3, 0.04), '#c8b070', 0.75, 1.0, 0.76);
        const m = new T.Mesh(ki.build().lit, matLit); m.castShadow = true; out.add(m); out.position.set(h.x / TS, 0, h.y / TS); scene.add(out);
        const inn = new T.Group(), ke = new Kit();
        for (let s = 0; s < 6; s++) ke.lit(BX(0.05, 0.05, 0.62), '#8a8e96', 0, 0.3 + s * 0.4, 0);
        ke.lit(BX(0.05, 2.4, 0.05), '#6a6e76', 0, 1.2, 0.3).lit(BX(0.05, 2.4, 0.05), '#6a6e76', 0, 1.2, -0.3).lit(CY(0.5, 0.5, 0.1, 12), '#4a4e56', 0, 2.45, 0);
        const m2 = new T.Mesh(ke.build().lit, matLit); inn.add(m2); inn.position.set(e.x / TS, 0, e.y / TS); scene.add(inn);
        hatchObjs.push({ h, e, o1: out, o2: inn });
      }
    }
    for (const hb of hatchObjs) {
      glowAt(hb.h.x / TS + 0.75, 1.0, hb.h.y / TS + 0.76, 0.9, '#ffcf6a', 0.35 + 0.2 * Math.sin(at * 3));
      glowAt(hb.e.x / TS, 2.5, hb.e.y / TS, 1.6, '#cfe8ff', 0.5);
    }
    // Beutebeutel
    const cseen = new Set();
    for (const c of S.chests) {
      cseen.add(c.id);
      let o = chestObjs.get(c.id);
      if (!o) { o = lootModel(c.dun !== undefined); chestObjs.set(c.id, o); }
      o.position.set(c.x / TS, 0, c.y / TS);
      o.rotation.y = c.id * 1.7;
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
      if ((S.players.length > 1 || q.afk) && !(G.SET && G.SET.names === 0)) {
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
