// Nachtwache 2.0 – 3D-Renderer (three.js)
// Die komplette Spiellogik steckt in game.js; diese Datei zeichnet nur den Spielzustand in 3D.
// Koordinaten: 1 Einheit = 1 Feld (40 px). Spielwelt (x, y) → 3D (x / 40, Höhe, y / 40).
'use strict';
(function () {
  const T = window.THREE;
  let G = null;                     // Spiel-API (window.NW)
  let renderer, scene, camera, raycaster, groundPlane, canvas3;
  let hemi, sun, fogColor, ground, groundTex, lastS = null, lastSize = '';
  const pointLights = [];
  const NL = 8;                     // feste Anzahl Punktlichter (keine Shader-Neukompilierung)
  const MAXRES = 3200, MAXZ = 420, MAXP = 400, MAXPART = 1600;
  const geoCache = new Map();
  const geo = (k, f) => { let g = geoCache.get(k); if (!g) { g = f(); geoCache.set(k, g); } return g; };
  const v3 = new T.Vector3(), m4 = new T.Matrix4(), q4 = new T.Quaternion(), s3 = new T.Vector3(), e3 = new T.Euler(), col = new T.Color();
  const up = new T.Vector3(0, 1, 0);

  const R3 = window.NW3D = {
    ready: false, init, render, overlay, pick, zoomLevel: 1,
    zoom(dy) { R3.zoomLevel = Math.min(1.8, Math.max(0.6, R3.zoomLevel * (dy > 0 ? 1.1 : 1 / 1.1))); },
  };

  // ---------------------------------------------------------------- Setup
  let trunks, canopies, canopies2, rocks, nuggets;
  let zBody, zHead, zArm, zEye, zSpark;
  let projBox, projSphere, parts;
  let boltLines, ghost, ghostRing, selBox, selRing;
  const buildingObjs = new Map(), chestObjs = new Map(), playerObjs = new Map();
  const ringPool = [], pingPool = [];

  function lambert(color, extra) { return new T.MeshLambertMaterial(Object.assign({ color }, extra || {})); }
  function inst(geometry, material, max, shadow) {
    const m = new T.InstancedMesh(geometry, material, max);
    m.instanceMatrix.setUsage(T.DynamicDrawUsage);
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

  function init(api) {
    G = api;
    canvas3 = document.getElementById('game3d');
    renderer = new T.WebGLRenderer({ canvas: canvas3, antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    scene = new T.Scene();
    fogColor = new T.Color('#7fa6c4');
    scene.background = fogColor.clone();
    scene.fog = new T.Fog(fogColor.clone(), 28, 62);
    camera = new T.PerspectiveCamera(42, 1, 0.5, 220);
    raycaster = new T.Raycaster();
    groundPlane = new T.Plane(new T.Vector3(0, 1, 0), 0);

    hemi = new T.HemisphereLight(0xe8f2ff, 0x46593a, 1.1);
    scene.add(hemi);
    sun = new T.DirectionalLight(0xfff0d6, 2.2);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera; sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 90;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
    scene.add(sun); scene.add(sun.target);
    for (let i = 0; i < NL; i++) { const l = new T.PointLight(0xffb060, 0, 9, 1.3); scene.add(l); pointLights.push(l); }

    // Boden außerhalb der Karte
    const outer = new T.Mesh(new T.PlaneGeometry(2000, 2000), lambert('#1a2416'));
    outer.rotation.x = -Math.PI / 2; outer.position.set(G.MAP / 2, -0.02, G.MAP / 2);
    scene.add(outer);

    // Bäume, Felsen, Golderz (instanziert)
    trunks = inst(geo('trunk', () => new T.CylinderGeometry(0.08, 0.12, 0.7, 6).translate(0, 0.35, 0)), lambert('#6b4626'), MAXRES, true);
    canopies = inst(geo('canopy', () => new T.ConeGeometry(0.55, 1.0, 7).translate(0, 1.05, 0)), lambert('#ffffff'), MAXRES, true);
    canopies2 = inst(geo('canopy2', () => new T.ConeGeometry(0.42, 0.8, 7).translate(0, 1.55, 0)), lambert('#ffffff'), MAXRES, true);
    rocks = inst(geo('rock', () => new T.DodecahedronGeometry(0.42, 0)), lambert('#ffffff'), MAXRES, true);
    nuggets = inst(geo('nugget', () => new T.OctahedronGeometry(0.11, 0)), lambert('#f2c94c', { emissive: '#8a6a10' }), MAXRES, false);

    // Zombies (instanziert: Körper, Kopf, Arme, Augen)
    zBody = inst(geo('zbody', () => new T.CylinderGeometry(0.85, 1, 1, 8).translate(0, 0.5, 0)), lambert('#ffffff'), MAXZ, true);
    zHead = inst(geo('zhead', () => new T.SphereGeometry(1, 10, 8)), lambert('#ffffff'), MAXZ, true);
    zArm = inst(geo('zarm', () => new T.BoxGeometry(1, 1, 1)), lambert('#ffffff'), MAXZ * 2, true);
    zEye = inst(geo('zeye', () => new T.BoxGeometry(1, 1, 1)), new T.MeshBasicMaterial({ color: '#ffffff' }), MAXZ * 2, false);
    zSpark = inst(geo('zspark', () => new T.SphereGeometry(1, 6, 5)), new T.MeshBasicMaterial({ color: '#ffe14a' }), MAXZ, false);

    // Geschosse & Partikel
    projBox = inst(geo('pbox', () => new T.BoxGeometry(1, 1, 1)), new T.MeshBasicMaterial({ color: '#ffffff' }), MAXP, false);
    projSphere = inst(geo('psph', () => new T.SphereGeometry(1, 8, 6)), lambert('#ffffff', { emissive: '#000000' }), MAXP, true);
    parts = inst(geo('part', () => new T.BoxGeometry(1, 1, 1)), new T.MeshBasicMaterial({ color: '#ffffff' }), MAXPART, false);

    // Blitze (Kettenblitz)
    const bg = new T.BufferGeometry();
    bg.setAttribute('position', new T.BufferAttribute(new Float32Array(600 * 3), 3));
    boltLines = new T.LineSegments(bg, new T.LineBasicMaterial({ color: '#e4c8ff' }));
    boltLines.frustumCulled = false; scene.add(boltLines);

    // Bau-Vorschau & Auswahl
    ghost = new T.Mesh(geo('unitbox', () => new T.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)), new T.MeshBasicMaterial({ color: '#60ff90', transparent: true, opacity: 0.35, depthWrite: false }));
    ghost.visible = false; scene.add(ghost);
    ghostRing = ringMesh('#ffffff', 0.5); ghostRing.visible = false;
    selBox = new T.Mesh(geo('selplane', () => new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)), new T.MeshBasicMaterial({ color: '#ffe27a', transparent: true, opacity: 0.25, depthWrite: false }));
    selBox.visible = false; scene.add(selBox);
    selRing = ringMesh('#ffe27a', 0.6); selRing.visible = false;

    R3.ready = true;
  }
  function ringMesh(color, opacity) {
    const m = new T.Mesh(geo('ring', () => new T.RingGeometry(0.96, 1, 64).rotateX(-Math.PI / 2)),
      new T.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: T.DoubleSide }));
    m.position.y = 0.04; scene.add(m);
    return m;
  }

  // ---------------------------------------------------------------- Boden-Textur
  function buildGround(S) {
    const MAP = G.MAP, px = 6;
    const c = document.createElement('canvas'); c.width = c.height = MAP * px;
    const g = c.getContext('2d');
    g.fillStyle = '#4a6b3b'; g.fillRect(0, 0, c.width, c.height);
    for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
      const v = S.variant[y * MAP + x];
      if (v < 70) { g.fillStyle = v < 30 ? '#45653a' : '#527544'; g.fillRect(x * px, y * px, px, px); }
      else if (v > 230) { g.fillStyle = '#5d8048'; g.fillRect(x * px + (v % 4), y * px + (v % 3), 2, 2); }
    }
    if (groundTex) groundTex.dispose();
    groundTex = new T.CanvasTexture(c);
    groundTex.colorSpace = T.SRGBColorSpace;
    groundTex.magFilter = T.LinearFilter; groundTex.minFilter = T.LinearMipmapLinearFilter;
    if (!ground) {
      ground = new T.Mesh(new T.PlaneGeometry(MAP, MAP), lambert('#ffffff'));
      ground.rotation.x = -Math.PI / 2; ground.position.set(MAP / 2, 0, MAP / 2);
      ground.receiveShadow = true; scene.add(ground);
    }
    ground.material.map = groundTex; ground.material.needsUpdate = true;
  }

  // ---------------------------------------------------------------- Gebäude-Modelle
  function makeBuilding(b) {
    const grp = new T.Group(), s = b.size, lc = G.LV_COL[b.lvl - 1], mats = [];
    const M = (c, extra) => { const m = lambert(c, extra); mats.push(m); return m; };
    const add = (geometry, mat, x, y, z, parent) => {
      const mesh = new T.Mesh(geometry, mat); mesh.position.set(x, y, z);
      mesh.castShadow = true; mesh.receiveShadow = true; (parent || grp).add(mesh); return mesh;
    };
    const box = (w, h, d) => geo('b' + w + '_' + h + '_' + d, () => new T.BoxGeometry(w, h, d));
    const cyl = (rt, rb, h, seg) => geo('c' + rt + '_' + rb + '_' + h + '_' + (seg || 12), () => new T.CylinderGeometry(rt, rb, h, seg || 12));
    const base = (h, c) => add(box(s * 0.94, h, s * 0.94), M(c || lc), 0, h / 2, 0);
    const turret = new T.Group(); const spin = []; let bob = null;
    switch (b.type) {
      case 'wall':
        add(box(0.98, 0.95, 0.98), M(lc), 0, 0.475, 0);
        add(box(0.9, 0.12, 0.9), M('#' + col.set(lc).offsetHSL(0, 0, 0.08).getHexString()), 0, 1.01, 0);
        break;
      case 'door':
        add(box(0.98, 0.75, 0.98), M('#5a3a1e'), 0, 0.375, 0);
        add(box(0.82, 0.62, 1.0), M(lc), 0, 0.4, 0);
        add(box(1.0, 0.07, 1.02), M('#2a2a2a'), 0, 0.25, 0);
        add(box(1.0, 0.07, 1.02), M('#2a2a2a'), 0, 0.58, 0);
        break;
      case 'mine': {
        base(0.35, '#4a3b2a');
        for (let i = 0; i < 5; i++) add(geo('ore', () => new T.DodecahedronGeometry(0.18, 0)), M('#f2c94c', { emissive: '#5a4008' }), Math.cos(i * 1.3) * 0.55, 0.45, Math.sin(i * 1.3) * 0.55);
        const wheel = new T.Group(); wheel.position.set(0, 1.0, 0); grp.add(wheel);
        add(geo('wheel', () => new T.TorusGeometry(0.45, 0.06, 6, 18)), M('#c8a050'), 0, 0, 0, wheel);
        add(box(0.9, 0.06, 0.06), M('#c8a050'), 0, 0, 0, wheel);
        add(box(0.06, 0.9, 0.06), M('#c8a050'), 0, 0, 0, wheel);
        add(box(0.1, 1.0, 0.1), M('#6b4a2a'), -0.5, 0.5, 0); add(box(0.1, 1.0, 0.1), M('#6b4a2a'), 0.5, 0.5, 0);
        spin.push({ o: wheel, axis: 'z', speed: 1.5 + b.lvl * 0.5 });
        break;
      }
      case 'arrow':
        base(0.4);
        add(cyl(0.5, 0.62, 1.5), M('#62707e'), 0, 1.15, 0);
        add(cyl(0.72, 0.6, 0.2), M(lc), 0, 1.98, 0);
        turret.position.set(0, 2.2, 0);
        add(box(0.95, 0.1, 0.14), M('#8a6a3a'), 0.15, 0, 0, turret);
        add(geo('bow', () => new T.TorusGeometry(0.38, 0.04, 5, 12, Math.PI).rotateX(Math.PI / 2).rotateY(Math.PI / 2)), M('#d9b87a'), 0.2, 0, 0, turret);
        add(box(0.55, 0.04, 0.04), M('#cfe8ff', { emissive: '#3a5a7a' }), 0.35, 0.05, 0, turret);
        grp.add(turret);
        break;
      case 'cannon':
        base(0.5);
        add(cyl(0.6, 0.7, 0.4), M('#3a3a40'), 0, 0.7, 0);
        turret.position.set(0, 1.05, 0);
        add(geo('csph', () => new T.SphereGeometry(0.45, 14, 10)), M('#2a2a30'), 0, 0, 0, turret);
        add(geo('barrel', () => new T.CylinderGeometry(0.14, 0.17, 1.0, 10).rotateZ(-Math.PI / 2)), M('#1a1a1f'), 0.55, 0.05, 0, turret);
        grp.add(turret);
        break;
      case 'mage': {
        base(0.35);
        add(cyl(0.18, 0.28, 1.4), M('#5a4a7a'), 0, 1.0, 0);
        add(geo('mring', () => new T.TorusGeometry(0.55, 0.04, 6, 24).rotateX(Math.PI / 2)), M('#c792ff', { emissive: '#6a3aaa' }), 0, 0.45, 0);
        const cry = add(geo('crystal', () => new T.OctahedronGeometry(0.35, 0).scale(1, 1.6, 1)), M('#d8b4ff', { emissive: '#8a4aff' }), 0, 2.1, 0);
        bob = cry; spin.push({ o: cry, axis: 'y', speed: 1.5 });
        break;
      }
      case 'bomb':
        base(0.45);
        add(cyl(0.65, 0.75, 0.35), M('#3a2a2a'), 0, 0.62, 0);
        turret.position.set(0, 0.85, 0);
        add(geo('mortar', () => new T.CylinderGeometry(0.42, 0.48, 0.75, 14, 1, true).rotateZ(-Math.PI / 4)), M('#202024', { side: T.DoubleSide }), 0.15, 0.2, 0, turret);
        add(geo('mortarHole', () => new T.CircleGeometry(0.38, 14).rotateZ(-Math.PI / 4).rotateY(Math.PI / 2)), M('#000000'), 0.15, 0.2, 0, turret);
        grp.add(turret);
        break;
      case 'harv':
        base(0.4, '#5d6b3c');
        for (let k = 0; k < 2; k++) {
          const saw = new T.Group(); saw.position.set(k ? 0.45 : -0.45, 0.62, k ? 0.45 : -0.45); grp.add(saw);
          add(geo('saw', () => new T.CylinderGeometry(0.38, 0.38, 0.06, 16)), M('#c8c8d0'), 0, 0, 0, saw);
          for (let i = 0; i < 8; i++) { const tth = add(box(0.12, 0.06, 0.12), M('#9a9aa4'), Math.cos(i * Math.PI / 4) * 0.4, 0, Math.sin(i * Math.PI / 4) * 0.4, saw); tth.rotation.y = i * Math.PI / 4; }
          spin.push({ o: saw, axis: 'y', speed: (k ? -1 : 1) * (3 + b.lvl) });
        }
        add(box(0.4, 0.9, 0.4), M(lc), 0.45, 0.85, -0.45);
        break;
      case 'heal': {
        base(0.35);
        add(cyl(0.55, 0.6, 0.6), M('#e9f7ee'), 0, 0.65, 0);
        const cross = new T.Group(); cross.position.set(0, 1.45, 0); grp.add(cross);
        add(box(0.22, 0.7, 0.22), M('#2fbf5a', { emissive: '#1a8a3a' }), 0, 0, 0, cross);
        add(box(0.7, 0.22, 0.22), M('#2fbf5a', { emissive: '#1a8a3a' }), 0, 0, 0, cross);
        spin.push({ o: cross, axis: 'y', speed: 1.2 }); bob = cross;
        break;
      }
      case 'hq': {
        add(box(2.9, 0.6, 2.9), M('#6b5224'), 0, 0.3, 0);
        add(box(2.4, 1.1, 2.4), M(lc), 0, 1.15, 0);
        add(geo('roof', () => new T.ConeGeometry(1.95, 1.1, 4).rotateY(Math.PI / 4)), M('#8a6514'), 0, 2.25, 0);
        const coin = add(geo('coin', () => new T.CylinderGeometry(0.42, 0.42, 0.1, 24).rotateX(Math.PI / 2)), M('#f2c94c', { emissive: '#a07810' }), 0, 3.3, 0);
        spin.push({ o: coin, axis: 'y', speed: 1.4 }); bob = coin;
        for (const [x, z] of [[-1.25, -1.25], [1.25, -1.25], [-1.25, 1.25], [1.25, 1.25]]) add(cyl(0.18, 0.22, 1.7), M('#a67c1c'), x, 0.85, z);
        break;
      }
    }
    grp.scale.y = 1 + (b.lvl - 1) * 0.07;
    grp.userData = { lvl: b.lvl, type: b.type, turret, spin, bob, mats, bobY: bob ? bob.position.y : 0 };
    scene.add(grp);
    return grp;
  }
  function disposeGroup(grp) {
    scene.remove(grp);
    for (const m of grp.userData.mats || []) m.dispose();
  }

  // ---------------------------------------------------------------- Spieler-Modell
  function makePlayer(p) {
    const grp = new T.Group(), body = new T.Group(); grp.add(body);
    const shirt = lambert(G.PLAYER_COL[p.id] || G.PLAYER_COL[0]), skin = lambert('#f0c9a0');
    const mk = (g, m, x, y, z, parent) => { const o = new T.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; (parent || body).add(o); return o; };
    mk(geo('pbody', () => new T.CylinderGeometry(0.26, 0.3, 0.7, 12)), shirt, 0, 0.35, 0);
    mk(geo('phead', () => new T.SphereGeometry(0.22, 14, 10)), skin, 0, 0.9, 0);
    mk(geo('phair', () => new T.SphereGeometry(0.23, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), lambert('#5a3a1a'), -0.03, 0.93, 0);
    mk(geo('phand', () => new T.SphereGeometry(0.09, 8, 6)), skin, 0.25, 0.5, -0.28);
    const tool = new T.Group(); tool.position.set(0.28, 0.5, 0.28); body.add(tool);
    mk(geo('phand', null), skin, 0, 0, 0, tool);
    const tools = {
      pick: new T.Group(), sword: new T.Group(), bow: new T.Group(),
    };
    mk(geo('pickHandle', () => new T.BoxGeometry(0.6, 0.05, 0.05).translate(0.3, 0, 0)), lambert('#7a5530'), 0, 0, 0, tools.pick);
    mk(geo('pickHead', () => new T.BoxGeometry(0.06, 0.06, 0.42)), lambert('#b8bcc8'), 0.58, 0, 0, tools.pick);
    mk(geo('swordBlade', () => new T.BoxGeometry(0.7, 0.03, 0.08).translate(0.42, 0, 0)), lambert('#e8eef5', { emissive: '#333' }), 0, 0, 0, tools.sword);
    mk(geo('swordGuard', () => new T.BoxGeometry(0.04, 0.05, 0.26)), lambert('#c9a227'), 0.06, 0, 0, tools.sword);
    mk(geo('bowArc', () => new T.TorusGeometry(0.34, 0.03, 5, 14, Math.PI).rotateY(Math.PI / 2)), lambert('#8a5a2a'), 0.05, 0, 0, tools.bow);
    for (const k in tools) tool.add(tools[k]);
    scene.add(grp);
    grp.userData = { body, tool, tools, shirt };
    return grp;
  }

  // ---------------------------------------------------------------- Hilfen
  const ZCOL = {};
  function zColor(type) { return ZCOL[type] || (ZCOL[type] = new T.Color(G.ZDEF[type].color)); }
  function chestModel() {
    const grp = new T.Group();
    const m1 = lambert('#7a4a1e'), m2 = lambert('#9a6028'), m3 = lambert('#e6b83a', { emissive: '#6a5010' });
    const a = new T.Mesh(geo('chestBase', () => new T.BoxGeometry(0.7, 0.4, 0.45)), m1); a.position.y = 0.2; a.castShadow = true; grp.add(a);
    const b = new T.Mesh(geo('chestLid', () => new T.CylinderGeometry(0.225, 0.225, 0.7, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2)), m2); b.position.y = 0.4; b.castShadow = true; grp.add(b);
    const c = new T.Mesh(geo('chestBand', () => new T.BoxGeometry(0.72, 0.06, 0.47)), m3); c.position.y = 0.33; grp.add(c);
    const d = new T.Mesh(geo('chestLock', () => new T.BoxGeometry(0.1, 0.14, 0.05)), m3); d.position.set(0, 0.32, 0.24); grp.add(d);
    scene.add(grp);
    return grp;
  }
  function pingModel() {
    const grp = new T.Group();
    const mat = new T.MeshBasicMaterial({ color: '#7fd8ff', transparent: true });
    const cone = new T.Mesh(geo('pingCone', () => new T.ConeGeometry(0.25, 0.6, 12).rotateX(Math.PI)), mat); cone.position.y = 1.4; grp.add(cone);
    const ball = new T.Mesh(geo('pingBall', () => new T.SphereGeometry(0.25, 12, 8)), mat); ball.position.y = 1.85; grp.add(ball);
    const ring = new T.Mesh(geo('ring', null), new T.MeshBasicMaterial({ color: '#7fd8ff', transparent: true, depthWrite: false, side: T.DoubleSide })); ring.position.y = 0.05; grp.add(ring);
    grp.userData = { mat, cone, ball, ring };
    scene.add(grp);
    return grp;
  }

  // ---------------------------------------------------------------- Frame
  function render(dt) {
    const S = G.S;
    if (!S) return;
    const TS = G.TS, MAP = G.MAP, t = S.t, at = G.animT;
    // Größe
    const w = window.innerWidth, h = window.innerHeight, key = w + 'x' + h;
    if (key !== lastSize) { lastSize = key; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    // Neues Spiel → Boden neu, Objekte weg
    if (S !== lastS) {
      lastS = S; buildGround(S);
      for (const o of buildingObjs.values()) disposeGroup(o); buildingObjs.clear();
      for (const o of chestObjs.values()) scene.remove(o); chestObjs.clear();
    }

    // Kamera: schräg von oben, folgt dem Spieler
    const cx = (G.camX + G.VW / 2) / TS, cz = (G.camY + G.VH / 2) / TS;
    const height = G.clamp(G.VW / TS * 0.72, 13, 24) * R3.zoomLevel;
    let shx = 0, shz = 0;
    if (S.shake > 0.2 && G.mode === 'play') { shx = (Math.random() - 0.5) * S.shake * 0.03; shz = (Math.random() - 0.5) * S.shake * 0.03; }
    camera.position.set(cx + shx, height, cz + height * 0.68 + shz);
    camera.lookAt(cx + shx, 0, cz - 0.4 + shz);

    // Tag/Nacht
    const dk = G.darkness(), night = dk / 0.8;
    sun.position.set(cx - 14, 30, cz + 8); sun.target.position.set(cx, 0, cz); sun.target.updateMatrixWorld();
    sun.intensity = Math.max(0.05, 2.2 * (1 - night * 0.95));
    sun.color.set(night > 0.3 ? '#9fb0ff' : '#fff0d6');
    hemi.intensity = 1.1 - night * 0.85;
    hemi.color.set(night > 0.5 ? '#6a7ab0' : '#e8f2ff');
    fogColor.set('#7fa6c4').lerp(col.set('#04060f'), night);
    scene.background.copy(fogColor); scene.fog.color.copy(fogColor);
    scene.fog.near = 30 - night * 8; scene.fog.far = 64 - night * 18;

    // Punktlichter: die wichtigsten Lichtquellen in Kameranähe
    const cand = [];
    const addL = (x, y, hgt, c, inten, dist, always) => {
      const d2 = (x / TS - cx) ** 2 + (y / TS - cz) ** 2;
      if (d2 < 900) cand.push({ x: x / TS, y: hgt, z: y / TS, c, i: always ? inten : inten * night, dist, d2, always });
    };
    for (const f of S.flashes) addL(f.x, f.y, 1.5, '#ffb347', 30 * G.clamp(f.life / f.max, 0, 1), f.r / TS * 1.2, true);
    for (const q of S.players) if (q.dead <= 0) addL(q.x, q.y, 2.2, '#ffd9a0', 14, 8);
    for (const b of S.buildings) {
      const c = G.bCenter(b);
      if (b.type === 'hq') addL(c.x, c.y, 3.5, '#ffc060', 22, 11);
      else if (G.TOWERS[b.type]) addL(c.x, c.y, 2.6, '#ffa050', 10, 6.5);
      else if (b.type === 'heal') addL(c.x, c.y, 2.2, '#80ffa0', 10, 6);
      else if (b.type === 'mage') addL(c.x, c.y, 2.5, '#c792ff', 10, 6);
    }
    for (const c of S.chests) addL(c.x, c.y, 1.2, '#ffe27a', 6, 4);
    cand.sort((a, b) => (b.always - a.always) || a.d2 - b.d2);
    for (let i = 0; i < NL; i++) {
      const L = pointLights[i], c = cand[i];
      if (c && c.i > 0.05) { L.position.set(c.x, c.y, c.z); L.color.set(c.c); L.intensity = c.i; L.distance = c.dist; }
      else L.intensity = 0;
    }

    // Ressourcen in Sichtweite
    const R = 30, x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(MAP - 1, Math.ceil(cx + R));
    const z0 = Math.max(0, Math.floor(cz - R - 4)), z1 = Math.min(MAP - 1, Math.ceil(cz + R * 0.5));
    let nt = 0, nr = 0, ng = 0;
    for (let ty = z0; ty <= z1; ty++) for (let tx = x0; tx <= x1; tx++) {
      const i = ty * MAP + tx, k = S.res[i];
      if (!k) continue;
      const v = S.variant[i], sc = G.resScale(i);
      let ox = 0, oz = 0;
      const wob = S.wobble.get(i);
      if (wob) { const a = Math.sin(wob.t * 40) * 0.1 * (wob.t / 0.25); ox = Math.cos(wob.a) * a; oz = Math.sin(wob.a) * a; }
      const px = tx + 0.5, pz = ty + 0.5, rot = v * 0.05;
      if (k === 1 && nt < MAXRES) {
        const s = (0.85 + (v % 5) * 0.07) * sc;
        setInst(trunks, nt, px, 0, pz, s, s, s, rot);
        setInst(canopies, nt, px + ox, 0, pz + oz, s, s * (0.9 + (v % 3) * 0.1), s, rot);
        setInst(canopies2, nt, px + ox, 0, pz + oz, s, s * (0.9 + (v % 3) * 0.1), s, rot + 0.4);
        col.setRGB(0.16 + (v % 7) * 0.012, 0.38 + (v % 5) * 0.03, 0.17);
        canopies.setColorAt(nt, col); col.offsetHSL(0, 0, 0.06); canopies2.setColorAt(nt, col);
        nt++;
      } else if (k >= 2 && nr < MAXRES) {
        const s = (0.9 + (v % 4) * 0.08) * sc;
        setInst(rocks, nr, px + ox, 0.18 * s, pz + oz, s, s * 0.75, s, rot, 0.2, 0.1);
        if (k === 3) col.set('#7a6a54'); else col.setRGB(0.47 + (v % 3) * 0.03, 0.47 + (v % 3) * 0.03, 0.52);
        rocks.setColorAt(nr, col);
        nr++;
        if (k === 3) for (let j = 0; j < 3 && ng < MAXRES; j++, ng++) {
          const a = rot * 3 + j * 2.1;
          setInst(nuggets, ng, px + ox + Math.cos(a) * 0.28 * s, 0.32 * s, pz + oz + Math.sin(a) * 0.28 * s, s, s, s, a);
        }
      }
    }
    for (const m of [trunks, canopies, canopies2]) { m.count = nt; m.instanceMatrix.needsUpdate = true; }
    if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
    if (canopies2.instanceColor) canopies2.instanceColor.needsUpdate = true;
    rocks.count = nr; rocks.instanceMatrix.needsUpdate = true; if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
    nuggets.count = ng; nuggets.instanceMatrix.needsUpdate = true;

    // Gebäude
    const seen = new Set();
    for (const b of S.buildings) {
      seen.add(b.id);
      let o = buildingObjs.get(b.id);
      if (o && (o.userData.lvl !== b.lvl || o.userData.type !== b.type)) { disposeGroup(o); o = null; }
      if (!o) { o = makeBuilding(b); buildingObjs.set(b.id, o); }
      o.position.set(b.tx + b.size / 2, 0, b.ty + b.size / 2);
      const u = o.userData;
      u.turret.rotation.y = -b.angle;
      for (const sp of u.spin) sp.o.rotation[sp.axis] = at * sp.speed;
      if (u.bob) u.bob.position.y = u.bobY + Math.sin(at * 2.5 + b.id) * 0.08;
      const fl = b.flash > 0 ? 0.55 : 0;
      if (u.flashOn !== fl) { u.flashOn = fl; for (const m of u.mats) { if (!m.userData.e0) m.userData.e0 = m.emissive.clone(); m.emissive.copy(m.userData.e0).lerp(col.set('#ffffff'), fl); } }
    }
    for (const [id, o] of buildingObjs) if (!seen.has(id)) { disposeGroup(o); buildingObjs.delete(id); }

    // Zombies
    let nz = 0, na = 0, ne = 0, ns = 0;
    for (const z of S.zombies) {
      if (nz >= MAXZ) break;
      const D = G.ZDEF[z.type], rr = z.r / TS, x = z.x / TS, zz = z.y / TS, f = z.face || 0;
      const boss = z.type === 'boss', brute = z.type === 'brute';
      const bh = rr * (boss ? 2.6 : brute ? 2.2 : 2.4), bob = Math.abs(Math.sin(z.walk || 0)) * rr * 0.15;
      const fx = Math.cos(f), fz = Math.sin(f), sxv = -fz, szv = fx;
      setInst(zBody, nz, x, bob, zz, rr * 0.9, bh, rr * 0.9, -f);
      setInst(zHead, nz, x + fx * rr * 0.15, bh + rr * 0.55 + bob, zz + fz * rr * 0.15, rr * 0.62, rr * 0.62, rr * 0.62, -f);
      const flash = z.flash > 0;
      col.copy(flash ? col.set('#ffffff') : zColor(z.type));
      zBody.setColorAt(nz, col); zHead.setColorAt(nz, flash ? col : col.clone().offsetHSL(0, 0, 0.06));
      const lunge = z.lunge > 0 ? rr * 0.5 : 0, sw = Math.sin(z.walk || 0) * rr * 0.25;
      for (const side of [-1, 1]) {
        const reach = rr * 0.9 + lunge + side * sw;
        setInst(zArm, na, x + fx * reach + sxv * side * rr * 0.7, bh * 0.72 + bob, zz + fz * reach + szv * side * rr * 0.7, rr * 1.2, rr * 0.28, rr * 0.28, -f);
        zArm.setColorAt(na, col); na++;
        setInst(zEye, ne, x + fx * rr * 0.72 + sxv * side * rr * 0.22, bh + rr * 0.62 + bob, zz + fz * rr * 0.72 + szv * side * rr * 0.22, rr * 0.14, rr * 0.14, rr * 0.14, -f);
        zEye.setColorAt(ne, col.set(boss ? '#ffde3a' : '#ff3a3a')); ne++;
        col.copy(flash ? col.set('#ffffff') : zColor(z.type));
      }
      if (z.type === 'bomber' && Math.sin(at * 18 + z.id) > 0) {
        setInst(zSpark, ns, x - fx * rr * 0.3, bh + rr * 1.5 + bob, zz - fz * rr * 0.3, 0.08, 0.08, 0.08); ns++;
      }
      if (boss) {
        // Krone aus Stacheln über Funken-Instanzen
        for (let k = 0; k < 6 && ns < MAXZ; k++) { const a = k * Math.PI / 3 + at; setInst(zSpark, ns, x + Math.cos(a) * rr * 0.5, bh + rr * 1.15, zz + Math.sin(a) * rr * 0.5, 0.07, 0.07, 0.07); ns++; }
      }
      nz++;
    }
    for (const m of [zBody, zHead]) { m.count = nz; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    zArm.count = na; zArm.instanceMatrix.needsUpdate = true; if (zArm.instanceColor) zArm.instanceColor.needsUpdate = true;
    zEye.count = ne; zEye.instanceMatrix.needsUpdate = true; if (zEye.instanceColor) zEye.instanceColor.needsUpdate = true;
    zSpark.count = ns; zSpark.instanceMatrix.needsUpdate = true;

    // Spieler
    const pseen = new Set();
    for (const p of S.players) {
      pseen.add(p.id);
      let o = playerObjs.get(p.id);
      if (!o) { o = makePlayer(p); playerObjs.set(p.id, o); }
      o.visible = p.dead <= 0;
      if (!o.visible) continue;
      const u = o.userData;
      o.position.set(p.x / TS, Math.abs(Math.sin(p.walk || 0)) * 0.05, p.y / TS);
      o.rotation.y = -(p.face || 0);
      for (const k in u.tools) u.tools[k].visible = k === p.tool;
      const swp = p.swing > 0 ? Math.sin((1 - p.swing / 0.22) * Math.PI) : 0;
      u.tool.rotation.y = p.tool === 'bow' ? 0.9 : 0.9 - swp * 2.2;
      u.tool.rotation.z = p.tool === 'pick' ? swp * 0.6 : 0;
      u.shirt.emissive.set(p.flash > 0 ? '#aa2020' : '#000000');
    }
    for (const [id, o] of playerObjs) if (!pseen.has(id)) { scene.remove(o); playerObjs.delete(id); }

    // Geschosse
    let nb = 0, nsph = 0;
    for (const pr of S.projs) {
      const x = pr.x / TS, zz = pr.y / TS;
      if (pr.k === 'arrow' || pr.k === 'parrow') {
        if (nb >= MAXP) continue;
        setInst(projBox, nb, x, 0.9, zz, 0.55, 0.05, 0.05, -Math.atan2(pr.vy, pr.vx));
        projBox.setColorAt(nb, col.set(pr.k === 'arrow' ? '#cfe8ff' : '#f0e0b0')); nb++;
      } else if (nsph < MAXP) {
        const big = pr.k === 'bomb', hgt = big ? 0.6 + (pr.h || 0) / TS : pr.k === 'glob' ? 0.6 : 0.8;
        const r = big ? 0.22 : pr.k === 'glob' ? 0.14 : 0.15;
        setInst(projSphere, nsph, x, hgt, zz, r, r, r);
        projSphere.setColorAt(nsph, col.set(pr.k === 'glob' ? '#7fe0a0' : big ? '#222222' : '#1a1a1a')); nsph++;
      }
    }
    projBox.count = nb; projBox.instanceMatrix.needsUpdate = true; if (projBox.instanceColor) projBox.instanceColor.needsUpdate = true;
    projSphere.count = nsph; projSphere.instanceMatrix.needsUpdate = true; if (projSphere.instanceColor) projSphere.instanceColor.needsUpdate = true;

    // Partikel
    let np = 0;
    for (const q of S.parts) {
      if (np >= MAXPART) break;
      const f = G.clamp(q.life / q.max, 0, 1), s = q.size / TS * 1.3 * (0.4 + 0.6 * f);
      const hgt = q.grav < 0 ? 0.4 + (1 - f) * 1.4 : 0.25 + Math.sin(f * Math.PI) * 0.5;
      setInst(parts, np, q.x / TS, hgt, q.y / TS, s, s, s, q.x * 0.1);
      parts.setColorAt(np, col.set(q.color)); np++;
    }
    parts.count = np; parts.instanceMatrix.needsUpdate = true; if (parts.instanceColor) parts.instanceColor.needsUpdate = true;

    // Kettenblitze
    const pos = boltLines.geometry.attributes.position.array;
    let nl = 0;
    for (const b of S.bolts) {
      for (let i = 0; i < b.pts.length - 1; i++) {
        const [ax, ay] = b.pts[i], [bx, by] = b.pts[i + 1];
        let px = ax / TS, pz = ay / TS, py = 1.0;
        for (let s = 1; s <= 4 && nl < 598; s++) {
          const ff = s / 4, j = s === 4 ? 0 : Math.sin(b.seed + i * 7 + s * 3 + at * 60) * 0.25;
          const nx = (ax + (bx - ax) * ff) / TS + j, nz2 = (ay + (by - ay) * ff) / TS - j, ny = 1.0 + (s === 4 ? 0 : j);
          pos.set([px, py, pz, nx, ny, nz2], nl * 3); nl += 2;
          px = nx; py = ny; pz = nz2;
        }
      }
    }
    boltLines.geometry.setDrawRange(0, nl); boltLines.geometry.attributes.position.needsUpdate = true;

    // Druckwellen-Ringe
    let ri = 0;
    for (const r of S.rings) {
      let m = ringPool[ri];
      if (!m) { m = ringMesh('#ffffff', 1); ringPool[ri] = m; }
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
    }
    for (const [id, o] of chestObjs) if (!cseen.has(id)) { scene.remove(o); chestObjs.delete(id); }

    // Markierungen
    let pi = 0;
    for (const pg of S.pings) {
      let o = pingPool[pi]; if (!o) { o = pingModel(); pingPool[pi] = o; }
      const u = o.userData, c = pg.pid === 0 ? '#7fd8ff' : '#ff8a80', k = (4 - pg.t) % 1;
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

    // Bau-Vorschau
    ghost.visible = false; ghostRing.visible = false;
    if (S.place && G.mode === 'play' && !G.hoverSlot) {
      const a = G.aimPoint(), fp = G.footprintAt(S.place, a.x, a.y), d = G.BDEF[S.place];
      const err = G.placeError(S.place, fp.tx, fp.ty);
      ghost.visible = true;
      ghost.position.set(fp.tx + fp.size / 2, 0, fp.ty + fp.size / 2);
      ghost.scale.set(fp.size * 0.96, S.place === 'wall' || S.place === 'door' ? 1 : 1.4 + fp.size * 0.3, fp.size * 0.96);
      ghost.material.color.set(err ? '#ff5050' : '#60ff90');
      const rad = d.range ? d.range[0] : d.radius ? d.radius[0] : 0;
      if (rad) { ghostRing.visible = true; ghostRing.position.set(fp.tx + fp.size / 2, 0.05, fp.ty + fp.size / 2); ghostRing.scale.set(rad, 1, rad); }
    }

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
      const rr = z.r / TS, p = project(z.x, z.y, rr * 2.4 + rr * 1.5 + 0.2);
      if (!p.ok) continue;
      G.hpBar(p.x, p.y, z.type === 'boss' ? 70 : Math.max(24, z.r * 2), z.hp / z.maxHp, z.type === 'boss' ? '#d87bff' : '#e74c3c');
    }
    for (const b of S.buildings) {
      if (b.hp >= b.maxHp) continue;
      const c = G.bCenter(b), p = project(c.x, c.y, b.type === 'hq' ? 4 : b.type === 'wall' || b.type === 'door' ? 1.4 : 2.6);
      if (p.ok) G.hpBar(p.x, p.y, Math.max(30, b.size * 30), b.hp / b.maxHp, b.type === 'hq' ? '#f2c94c' : '#5fd068');
    }
    for (const q of S.players) {
      if (q.dead > 0) continue;
      const p = project(q.x, q.y, 1.45);
      if (!p.ok) continue;
      if (q.hp < q.maxHp) G.hpBar(p.x, p.y, 34, q.hp / q.maxHp, q === S.player ? '#4fc3f7' : '#ff8a80');
      if (S.players.length > 1) G.text(q.name || ('P' + (q.id + 1)), p.x, p.y - 12, 12, q === S.player ? '#cfe8ff' : '#ffb0a8', 'center', 'bold');
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
