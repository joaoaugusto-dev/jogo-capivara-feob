import * as THREE from 'three';
import { part, merge } from './models.js';
import { nature } from './nature.js';

// Campus FEOB (Barretos/SP) a partir do mapa digital: norte = -Z, 1 px do mapa = S metros.
const BOX = new THREE.BoxGeometry(1, 1, 1), CYL = new THREE.CylinderGeometry(1, 1, 1, 16), SPH = new THREE.SphereGeometry(1, 14, 10);
// S: tamanho dos prédios (m/px). SP: espaçamento entre eles (posições do mapa esticadas ~1.8x → campus menos apertado)
const TAU = Math.PI * 2, S = 0.42, SP = 0.78, DEG = Math.PI / 180;
export const mp = (x, y) => [(x - 532) * SP, (y - 310) * SP];

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function buildCampus(scene, { windU, fx }) {
  const rand = mulberry(1962);
  const R = (a, b) => a + rand() * (b - a);
  const pick = (arr) => arr[(rand() * arr.length) | 0];
  const rects = [], ellipses = [], anims = [], segs = [], lots = [];
  const GRID = 16, grid = new Map(), gk = (i, j) => i * 4096 + j;
  const addCircle = (x, z, r) => { const c = { x, z, r }, k = gk(Math.floor(x / GRID), Math.floor(z / GRID)); (grid.get(k) || grid.set(k, []).get(k)).push(c); };
  const circleHit = (x, z, r) => {
    const i0 = Math.floor((x - r - 3) / GRID), i1 = Math.floor((x + r + 3) / GRID), j0 = Math.floor((z - r - 3) / GRID), j1 = Math.floor((z + r + 3) / GRID);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const l = grid.get(gk(i, j)); if (l) for (const c of l) { const dx = x - c.x, dz = z - c.z, rr = c.r + r; if (dx * dx + dz * dz < rr * rr) return true; } }
    return false;
  };

  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o });
  const glow = (c, k = 2.2) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), toneMapped: false });
  const add = (geo, mat, x, y, z, o = {}) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = o.cast ?? true; m.receiveShadow = o.recv ?? true;
    if (o.s) m.scale.set(...o.s); if (o.r) m.rotation.set(...o.r); (o.parent || scene).add(m); return m;
  };
  const sway = (mat, amp, grass = false) => {
    mat.onBeforeCompile = (s) => {
      s.uniforms.uTime = windU;
      s.vertexShader = 'uniform float uTime;\n' + s.vertexShader.replace('#include <begin_vertex>', `vec3 transformed=vec3(position);
        #if defined(USE_INSTANCING) || defined(USE_BATCHING)
        #ifdef USE_BATCHING
        vec4 ip=batchingMatrix[3];
        #else
        vec4 ip=instanceMatrix[3];
        #endif
        float ph=ip.x*.21+ip.z*.17, gust=.75+.25*sin(uTime*.37+ip.x*.013);
        float w=${grass ? 'position.y' : '(position.y+1.)*.5'}*gust;
        transformed.x+=sin(uTime*1.5+ph)*${amp.toFixed(3)}*w; transformed.z+=cos(uTime*1.2+ph*1.3)*${amp.toFixed(3)}*w;
        #endif`);
    };
  };
  const M = (x, y, z, sx = 1, sy = sx, sz = sx, ry = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(sx, sy, sz));
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (rand() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // BatchedMesh por célula grande: várias geometrias, 1 draw (multi-draw) por célula, sem culling por objeto → zero CPU por frame.
  // items: {x, z, g: geometria, m: Matrix4, c?: Color}. Devolve [{bm, n}] para ajustar densidade (setVisibleAt).
  const BCELL = 120, prepped = new Map(), ONE = new THREE.Color(1, 1, 1);
  const prep = (g) => prepped.get(g) || prepped.set(g, (() => {
    const p = g.index ? g.toNonIndexed() : g.clone();
    for (const k of Object.keys(p.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') p.deleteAttribute(k);
    if (!p.attributes.color) p.setAttribute('color', new THREE.BufferAttribute(new Float32Array(p.attributes.position.count * 3).fill(1), 3));
    return p;
  })()).get(g);
  function batched(mat, items, { cast = true, recv = true } = {}) {
    const cells = new Map(), out = [];
    for (const it of items) { const k = Math.floor(it.x / BCELL) + ',' + Math.floor(it.z / BCELL); (cells.get(k) || cells.set(k, []).get(k)).push(it); }
    for (const list of cells.values()) {
      shuffle(list); // densidade < 1 esconde um subconjunto uniforme
      const geos = new Map(); let nv = 0;
      for (const it of list) { const g = prep(it.g); if (!geos.has(g)) { geos.set(g, 0); nv += g.attributes.position.count; } }
      const bm = new THREE.BatchedMesh(list.length, nv, 0, mat);
      for (const g of geos.keys()) geos.set(g, bm.addGeometry(g));
      for (const it of list) { const id = bm.addInstance(geos.get(prep(it.g))); bm.setMatrixAt(id, it.m); bm.setColorAt(id, it.c || ONE); }
      bm.perObjectFrustumCulled = false; bm.sortObjects = false; bm.castShadow = cast; bm.receiveShadow = recv;
      bm.computeBoundingSphere(); scene.add(bm); out.push({ bm, n: list.length, list }); // list[i] = instância i
    }
    return out;
  }

  const vegMat = (amp) => { const m = std(0xffffff, { roughness: 0.85, vertexColors: true }); sway(m, amp, true); return m; };
  const vegItems = [], solidItems = [], KIT = 5; // KIT: escala do Nature Kit (árvore padrão ≈ 8.5 m) // montados no fim em BatchedMesh (veg = balança com o vento)

  // instancing em CHUNKS (uma geometria só): cada célula vira um InstancedMesh com bounding sphere → frustum culling por câmera
  const CELL = 120;
  function instChunked(geo, mat, items, { cast = true, recv = true } = {}) {
    const cells = new Map();
    for (const it of items) { const k = Math.floor(it.x / CELL) + ',' + Math.floor(it.z / CELL); (cells.get(k) || cells.set(k, []).get(k)).push(it); }
    const out = [];
    for (const list of cells.values()) {
      for (let i = list.length - 1; i > 0; i--) { const j = (rand() * (i + 1)) | 0; [list[i], list[j]] = [list[j], list[i]]; } // embaralha: count<n segue uniforme
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => { im.setMatrixAt(i, it.m); if (it.c) im.setColorAt(i, it.c); });
      im.castShadow = cast; im.receiveShadow = recv; im.computeBoundingSphere(); im.userData.n = list.length; scene.add(im); out.push(im);
    }
    return out;
  }

  // ---------- fachadas (texturas e materiais compartilhados; UV em metros) ----------
  const facCache = {}, matCache = {}, roofMats = {};
  function facade(style, wall, glass, lit) {
    const key = [style, wall, glass, lit].join();
    if (facCache[key]) return facCache[key];
    const Sz = 512, cols = 4, rows = 4, cw = Sz / cols, rh = Sz / rows; // 1 célula = 3.2 m × 3.6 m (um andar)
    const c = document.createElement('canvas'); c.width = c.height = Sz; const g = c.getContext('2d');
    const e = document.createElement('canvas'); e.width = e.height = Sz; const eg = e.getContext('2d');
    g.fillStyle = wall; g.fillRect(0, 0, Sz, Sz); eg.fillStyle = '#000'; eg.fillRect(0, 0, Sz, Sz);
    for (let i = 0; i < 1400; i++) { g.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,.035)' : 'rgba(255,255,255,.05)'; g.fillRect(rand() * Sz, rand() * Sz, 2 + rand() * 6, 2 + rand() * 4); } // concreto
    for (let r = 0; r < rows; r++) { // laje de cada andar: faixa + sombra logo abaixo
      const y = r * rh; g.fillStyle = 'rgba(0,0,0,.07)'; g.fillRect(0, y, Sz, 14); g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(0, y + 14, Sz, 3);
    }
    if (style !== 'glass') for (let q = 0; q <= cols; q += 2) { g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(q * cw - 7, 0, 14, Sz); g.fillStyle = 'rgba(0,0,0,.1)'; g.fillRect(q * cw + 7, 0, 3, Sz); } // pilares
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const x0 = q * cw, y0 = r * rh; let wx, wy, ww, wh;
      if (style === 'glass') { wx = x0 + 4; wy = y0 + 20; ww = cw - 8; wh = rh - 26; }
      else if (style === 'band') { wx = x0 + (q % 2 ? 2 : 12); wy = y0 + rh * 0.34; ww = cw - 14; wh = rh * 0.42; }
      else { wx = x0 + cw * 0.16; wy = y0 + rh * 0.3; ww = cw * 0.68; wh = rh * 0.46; }
      const gr = g.createLinearGradient(0, wy, 0, wy + wh); // reflexo do céu: claro em cima, vidro escuro embaixo
      gr.addColorStop(0, '#c9d8ea'); gr.addColorStop(0.35, glass); gr.addColorStop(1, '#141c2c');
      g.fillStyle = gr; g.fillRect(wx, wy, ww, wh);
      const k = rand();
      if (k < lit * 0.6) { // sala com luz acesa (poucas, quentes e suaves)
        const l = g.createLinearGradient(0, wy, 0, wy + wh); l.addColorStop(0, 'rgba(255,214,150,.55)'); l.addColorStop(1, 'rgba(255,190,120,.9)'); g.fillStyle = l; g.fillRect(wx, wy + wh * 0.25, ww, wh * 0.75);
        eg.fillStyle = '#7a5a34'; eg.fillRect(wx, wy + wh * 0.25, ww, wh * 0.75);
      } else if (k < 0.45) { // persiana meio baixada
        const bh = wh * (0.25 + rand() * 0.5); g.fillStyle = '#d9d2c0'; g.fillRect(wx, wy, ww, bh);
        g.fillStyle = 'rgba(0,0,0,.12)'; for (let y = wy + 3; y < wy + bh; y += 5) g.fillRect(wx, y, ww, 1);
      }
      g.fillStyle = 'rgba(255,255,255,.14)'; g.beginPath(); g.moveTo(wx, wy); g.lineTo(wx + ww * 0.35, wy); g.lineTo(wx, wy + wh * 0.5); g.fill(); // brilho diagonal
      g.strokeStyle = '#3a414d'; g.lineWidth = 4; g.strokeRect(wx, wy, ww, wh); // caixilho
      g.lineWidth = 3; g.beginPath(); g.moveTo(wx + ww / 2, wy); g.lineTo(wx + ww / 2, wy + wh); if (style === 'glass') { g.moveTo(wx, wy + wh * 0.62); g.lineTo(wx + ww, wy + wh * 0.62); } g.stroke(); // montantes
      if (style !== 'glass') { g.fillStyle = 'rgba(255,255,255,.55)'; g.fillRect(wx - 3, wy + wh + 2, ww + 6, 4); g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(wx - 3, wy + wh + 6, ww + 6, 3); } // peitoril
    }
    const mk = (cv) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };
    return (facCache[key] = { map: mk(c), emi: mk(e) });
  }
  function faceMat(style, wall, glass, lit, emi) {
    const key = [style, wall, glass, lit, emi].join();
    return matCache[key] || (matCache[key] = (() => { const f = facade(style, wall, glass, lit); return new THREE.MeshStandardMaterial({ map: f.map, emissiveMap: f.emi, emissive: 0xffffff, emissiveIntensity: emi, roughness: 0.7, metalness: 0.05 }); })());
  }
  // telha metálica: nervuras a cada 0.5 m + manchas (multiplica a cor do telhado)
  const roofTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${0.02 + rand() * 0.04})`; g.fillRect(rand() * 128, rand() * 128, 4 + rand() * 14, 2 + rand() * 8); }
    for (let x = 0; x < 128; x += 16) { g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(x, 0, 3, 128); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(x + 3, 0, 2, 128); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t;
  })();
  const roofMat = (c) => roofMats[c] || (roofMats[c] = std(new THREE.Color(c).multiplyScalar(0.92), { map: roofTex, roughness: 0.6, metalness: 0.25 }));

  // placas de texto (frente e verso legíveis)
  function plate(text, w, h, bg, fg, accent) {
    const cw = 512, ch = Math.max(48, Math.round(512 * h / w)), c = document.createElement('canvas'); c.width = cw; c.height = ch; const g = c.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, cw, ch); if (accent) { g.fillStyle = accent; g.fillRect(0, ch * 0.9, cw, ch * 0.1); }
    let size = ch * 0.68; g.font = `900 ${size}px Impact, "Arial Black", "DejaVu Sans", sans-serif`;
    while (g.measureText(text).width > cw - 30 && size > 12) { size -= 2; g.font = `900 ${size}px Impact, "Arial Black", sans-serif`; }
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, cw / 2, ch * 0.48);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  }
  function sign(text, x, y, z, w, h, bg, fg, ry = 0, accent = null) { // 1 mesh só: caixa com texto na frente e no verso
    const m = new THREE.MeshBasicMaterial({ map: plate(text, w, h, bg, fg, accent), toneMapped: false }), d = signDark || (signDark = new THREE.MeshBasicMaterial({ color: 0x1c1f29 }));
    return add(new THREE.BoxGeometry(w, h, 0.14), [d, d, d, d, m, m], x, y, z, { r: [0, ry, 0], cast: false, recv: false });
  }
  let signDark = null;

  // ---------- prédios ----------
  const logo = new THREE.TextureLoader().load('/assets/unifeob.webp', (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; });
  logo.colorSpace = THREE.SRGBColorSpace; logo.repeat.set(0.7, 0.36); logo.offset.set(0.15, 0.32);
  const logoMat = new THREE.MeshBasicMaterial({ map: logo, toneMapped: false });
  const acParts = []; let plinth = null;
  // px do mapa; w = comprimento (eixo local X), d = espessura; a = ângulo no mapa (graus, horário)
  function bldg({ x, y, w, d, a = 0, h, style = 'band', wall = '#f4f4f7', glass = '#2a4f86', lit = 0.25, roof, emi = 1.1 }) {
    const [cx, cz] = mp(x, y), W = w * S, D = d * S, rot = -a * DEG;
    const g = new THREE.BoxGeometry(W, h, D), uv = g.attributes.uv;
    for (const [i0, i1, fw] of [[0, 3, D], [4, 7, D], [16, 19, W], [20, 23, W]]) for (let i = i0; i <= i1; i++) uv.setXY(i, uv.getX(i) * fw / 12.8, uv.getY(i) * h / 14.4);
    const mS = faceMat(style, wall, glass, lit, emi), rm = roofMat(roof);
    const grp = new THREE.Group(); grp.position.set(cx, 0, cz); grp.rotation.y = rot; scene.add(grp);
    add(g, [mS, mS, rm, rm, mS, mS], 0, h / 2, 0, { parent: grp });
    const rg = new THREE.BoxGeometry(W + 0.9, 0.7, D + 0.9), ru = rg.attributes.uv; for (let i = 8; i < 12; i++) ru.setXY(i, ru.getX(i) * W / 4, ru.getY(i) * D / 4); // topo: UV em metros (nervura = 0.5 m)
    add(rg, rm, 0, h + 0.35, 0, { parent: grp });
    add(BOX, plinth || (plinth = std(0x6d6a66, { roughness: 0.95 })), 0, 0.45, 0, { parent: grp, s: [W + 0.25, 0.9, D + 0.25], cast: false }); // rodapé do térreo
    const c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i < Math.max(1, (W * D) / 180); i++) { const lx = R(-W / 3, W / 3), lz = R(-D / 3, D / 3); if (W > 12 && Math.hypot(lx, lz) < 6) continue; acParts.push(part(BOX, 0xb7bcc7, { p: [cx + lx * c + lz * s, h + 1.2, cz - lx * s + lz * c], s: [R(1, 2), R(0.6, 1), R(1, 1.8)], r: [0, rot, 0] })); }
    rects.push({ x: cx, z: cz, hw: W / 2, hd: D / 2, rot, c, s, h, col: roof });
    return { grp, cx, cz, W, D, h, rot };
  }
  const WHITE = '#f4f4f7', CREAM = '#efeadd', B = {};
  B.E = bldg({ x: 290, y: 52, w: 280, d: 24, a: 12, h: 10, roof: 0x4fae3a });
  B.D = bldg({ x: 476, y: 103, w: 300, d: 26, a: 17, h: 10, roof: 0x4fae3a });
  B.C = bldg({ x: 595, y: 130, w: 150, d: 30, a: 25, h: 10, roof: 0x2d4fd6 });
  B.F = bldg({ x: 205, y: 108, w: 62, d: 52, h: 13, style: 'glass', roof: 0xe0392f, lit: 0.3 });
  bldg({ x: 188, y: 80, w: 42, d: 28, h: 11, style: 'glass', roof: 0xe0392f });
  B.A = bldg({ x: 548, y: 392, w: 88, d: 70, a: -18, h: 12, style: 'glass', glass: '#2f6bd0', roof: 0x2f66d0, lit: 0.3 });
  bldg({ x: 508, y: 430, w: 58, d: 46, a: -18, h: 10, style: 'glass', glass: '#2f6bd0', roof: 0x2f66d0 });
  B.B = bldg({ x: 655, y: 215, w: 74, d: 50, h: 12, style: 'glass', glass: '#27406a', roof: 0xf5c426, lit: 0.3 });
  bldg({ x: 726, y: 214, w: 38, d: 84, a: 8, h: 12, roof: 0xf5c426 });
  const CA = bldg({ x: 612, y: 233, w: 20, d: 56, h: 8, roof: 0x27b9d8 });
  bldg({ x: 795, y: 238, w: 58, d: 22, a: 18, h: 7, wall: CREAM, roof: 0xc65a1e });
  bldg({ x: 778, y: 287, w: 62, d: 22, a: -6, h: 8, wall: CREAM, roof: 0x8b3fc4 });
  bldg({ x: 780, y: 318, w: 58, d: 24, h: 8, wall: CREAM, roof: 0xe0572a });
  bldg({ x: 882, y: 262, w: 95, d: 22, a: 28, h: 8, wall: CREAM, roof: 0x7a4a34 });
  bldg({ x: 848, y: 303, w: 78, d: 22, a: 30, h: 8, wall: CREAM, roof: 0x7a4a34 });
  bldg({ x: 665, y: 352, w: 86, d: 28, h: 6, wall: '#f8e2c0', roof: 0xf29a1f, lit: 0.5 });
  bldg({ x: 728, y: 373, w: 42, d: 34, h: 7, wall: '#d8dbe2', roof: 0x8d93a0 });
  bldg({ x: 460, y: 176, w: 52, d: 22, a: 15, h: 5, wall: '#f8e2c0', roof: 0xf5a623 });
  add(merge(acParts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 }), 0, 0, 0);

  // placas apoiadas no telhado (base encostada no teto, nada flutuando nem atravessando o prédio)
  const roofAt = (px, py) => { const [x, z] = mp(px, py); const r = rects.find((q) => { const dx = x - q.x, dz = z - q.z; return Math.abs(dx * q.c - dz * q.s) < q.hw && Math.abs(dx * q.s + dz * q.c) < q.hd; }); return { x, z, top: (r ? r.h : 0) + 0.7 }; };
  const roofSign = (px, py, text, w, h, bg, fg) => { const r = roofAt(px, py); const g = sign(text, r.x, r.top + h / 2 + 0.2, r.z, w, h, bg, fg, 0); addProp(r.x, r.z, Math.min(w, 8) / 2); return g; };
  const addProp = () => {};
  roofSign(290, 52, 'E', 5.5, 5, '#4fae3a', '#fff'); roofSign(476, 103, 'D', 5.5, 5, '#4fae3a', '#fff'); roofSign(595, 130, 'C', 5.5, 5, '#2d4fd6', '#fff');
  roofSign(205, 108, 'F', 6, 5.5, '#e0392f', '#fff'); roofSign(548, 392, 'A', 7, 6.5, '#2f66d0', '#fff'); roofSign(655, 215, 'B', 7, 6.5, '#f5c426', '#1a1a1a');
  roofSign(612, 233, 'CENTRAL ACADÊMICA', 14, 2.2, '#27b9d8', '#06222b');
  [[780, 318, 'REITORIA', 11, '#e0572a', '#fff'], [778, 287, 'BIBLIOTECA', 12, '#8b3fc4', '#fff'], [795, 238, 'CLÍNICA DE PSICOLOGIA', 15, '#c65a1e', '#fff'], [882, 262, 'CV', 6, '#7a4a34', '#fff'], [665, 352, 'CANTINA', 11, '#f29a1f', '#1a1a1a']]
    .forEach(([px, py, t, w, bg, fg]) => roofSign(px, py, t, w, w > 8 ? 2.4 : 3, bg, fg));
  { // logo UniFEOB nas fachadas de B e A
    const b = B.B; add(BOX, std(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.3 }), b.cx, 8.2, b.cz + b.D / 2 + 0.2, { s: [11.4, 3.2, 0.3], cast: false });
    add(new THREE.PlaneGeometry(10.8, 2.7), logoMat, b.cx, 8.2, b.cz + b.D / 2 + 0.38, { cast: false });
    const a = B.A, g = new THREE.Group(); g.position.set(a.cx + Math.sin(a.rot) * (a.D / 2 + 0.3), 9, a.cz + Math.cos(a.rot) * (a.D / 2 + 0.3)); g.rotation.y = a.rot; scene.add(g);
    add(BOX, std(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.3 }), 0, 0, -0.15, { parent: g, s: [10.4, 3, 0.3], cast: false }); add(new THREE.PlaneGeometry(9.8, 2.5), logoMat, 0, 0, 0.05, { parent: g, cast: false });
  }

  // ---------- vias, estacionamentos, calçadas ----------
  const asph = [], walk = [], marks = [];
  const curve = (ptsPx, w, list, color, y, smooth = true) => {
    const v3 = ptsPx.map(([px, py]) => { const [x, z] = mp(px, py); return new THREE.Vector3(x, 0, z); });
    const cs = smooth && v3.length > 2 ? new THREE.CatmullRomCurve3(v3, false, 'centripetal').getSpacedPoints(Math.max(8, Math.ceil(v3.reduce((s, p, i) => s + (i ? p.distanceTo(v3[i - 1]) : 0), 0) / 5))) : v3;
    const W = w * S;
    for (let i = 0; i < cs.length - 1; i++) {
      const a = cs[i], b = cs[i + 1], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) + 0.25;
      list.push(part(BOX, color, { p: [(a.x + b.x) / 2, y, (a.z + b.z) / 2], s: [W, 0.08, len], r: [0, Math.atan2(dx, dz), 0] }));
      if (i % 3 === 0) { const e = cs[Math.min(i + 3, cs.length - 1)]; segs.push([a.x, a.z, e.x, e.z, W]); }
    }
    for (let i = 0; i < cs.length; i += 2) list.push(part(CYL, color, { p: [cs[i].x, y, cs[i].z], s: [W / 2, 0.08, W / 2] }));
    return cs;
  };
  const ASPH = 0x5a5d66, WALK = 0xd9d1c0, LOT = 0x6b6e78;
  const roads = {
    perim: curve([[-30, 424], [130, 462], [280, 520], [430, 578], [620, 606], [820, 596], [1000, 548], [1100, 512]], 34, asph, ASPH, 0.05),
    diag: curve([[272, 492], [350, 425], [430, 335], [500, 265], [548, 232], [595, 194], [640, 168]], 24, asph, ASPH, 0.055),
    south: curve([[642, 502], [612, 440], [600, 380], [590, 310], [572, 250], [552, 234]], 22, asph, ASPH, 0.055),
    alameda: curve([[250, 188], [248, 112], [262, 84], [292, 72], [385, 92], [476, 120], [560, 148], [640, 168]], 22, asph, ASPH, 0.055), // colada nas fachadas de E/D/C
    ring: curve([[640, 168], [700, 152], [800, 158], [900, 200], [960, 265], [990, 340], [1012, 374]], 24, asph, ASPH, 0.055),
    west: curve([[95, 190], [180, 196], [250, 190], [330, 192], [420, 200], [500, 215], [548, 232]], 20, asph, ASPH, 0.055), // F → entroncamento, por baixo dos estacionamentos
    east: curve([[606, 418], [700, 411], [790, 399], [890, 376], [960, 362], [1005, 368]], 20, asph, ASPH, 0.055), // quadra/estacionamento → Portão 3
    sw: curve([[390, 382], [440, 425], [505, 480], [600, 498], [642, 502]], 18, asph, ASPH, 0.055), // estacionamento ao sul do A → Portão 2
  };
  { // faixa central tracejada + bordas brancas
    const ROADW = { perim: 34, diag: 24, south: 22, alameda: 22, ring: 24, west: 20, east: 20, sw: 18 };
    for (const k in roads) {
      const cs = roads[k], W = ROADW[k] * S;
      for (let i = 0; i < cs.length - 1; i++) {
        const a = cs[i], b = cs[i + 1], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1, yaw = Math.atan2(dx, dz), mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        if (i % 2 === 0) marks.push(part(BOX, 0xf0d870, { p: [mx, 0.12, mz], s: [0.2, 0.02, L * 0.95], r: [0, yaw, 0] }));
        for (const sd of [-1, 1]) marks.push(part(BOX, 0xe2e2e8, { p: [mx - (dz / L) * sd * (W / 2 - 0.55), 0.12, mz + (dx / L) * sd * (W / 2 - 0.55)], s: [0.14, 0.02, L + 0.1], r: [0, yaw, 0] }));
      }
    }
  }
  curve([[642, 500], [646, 610]], 24, asph, ASPH, 0.055, false); curve([[262, 480], [270, 512]], 24, asph, ASPH, 0.055, false);
  curve([[345, 86], [345, 192]], 16, asph, ASPH, 0.055, false); // acesso Alameda → estacionamento entre E e D
  const paths = [
    curve([[612, 262], [700, 276], [790, 258]], 9, walk, WALK, 0.07), curve([[593, 335], [640, 332], [700, 330], [745, 300]], 9, walk, WALK, 0.07),
    curve([[640, 332], [660, 300], [655, 232]], 8, walk, WALK, 0.07), curve([[700, 330], [735, 345], [800, 345], [850, 330]], 8, walk, WALK, 0.07),
  ];
  const lot = (x, y, w, d, a, color, rows) => {
    const [cx, cz] = mp(x, y), W = w * S, D = d * S, rot = -a * DEG, c = Math.cos(rot), s = Math.sin(rot);
    asph.push(part(BOX, color, { p: [cx, 0.06, cz], s: [W, 0.1, D], r: [0, rot, 0] }));
    lots.push({ cx, cz, W, D, rot });
    for (let i = 0; i < rows; i++) { const lx = -W / 2 + (i + 0.5) * W / rows; marks.push(part(BOX, 0xe8e8ec, { p: [cx + lx * c, 0.13, cz - lx * s], s: [0.15, 0.02, D * 0.9], r: [0, rot, 0] })); }
  };
  lot(343, 140, 66, 56, 12, 0xa9acb3, 6); lot(268, 125, 50, 52, 10, 0xa9acb3, 5); lot(440, 275, 118, 128, -25, LOT, 9); lot(712, 440, 230, 34, -8, LOT, 22); lot(130, 172, 70, 52, 10, LOT, 6); lot(575, 478, 110, 26, -4, LOT, 12);
  { // quadra poliesportiva (verde com borda rosa, como na foto)
    const [qx, qz] = mp(668, 390), qW = 62 * S, qD = 42 * S;
    const c = document.createElement('canvas'); c.width = 512; c.height = 340; const g = c.getContext('2d');
    g.fillStyle = '#e0467d'; g.fillRect(0, 0, 512, 340); g.fillStyle = '#4db58a'; g.fillRect(24, 24, 464, 292);
    g.strokeStyle = '#fff'; g.lineWidth = 5; g.strokeRect(24, 24, 464, 292); g.beginPath(); g.moveTo(256, 24); g.lineTo(256, 316); g.stroke(); g.beginPath(); g.arc(256, 170, 50, 0, TAU); g.stroke();
    g.strokeRect(24, 100, 70, 140); g.strokeRect(418, 100, 70, 140);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    add(new THREE.PlaneGeometry(qW, qD).rotateX(-Math.PI / 2), std(0xffffff, { map: t, roughness: 0.9 }), qx, 0.1, qz, { cast: false });
    rects.push({ x: qx, z: qz, hw: qW / 2, hd: qD / 2, rot: 0, c: 1, s: 0, h: 0 });
    for (const sx of [-1, 1]) { add(CYL, std(0xffffff, { metalness: 0.5 }), qx + sx * qW * 0.47, 1.4, qz, { s: [0.08, 2.8, 0.08] }); add(BOX, std(0xffffff), qx + sx * qW * 0.47, 2.8, qz, { s: [0.1, 0.1, 3] }); }
  }
  { // calçada da porta de cada prédio até a via/calçada mais próxima (nenhum prédio isolado no gramado)
    const net = [...Object.entries(roads).filter(([k]) => k !== 'perim').flatMap(([, cs]) => cs), ...paths.flat()], px = (v) => v / SP + 532, pz = (v) => v / SP + 310;
    for (const b of rects) if (b.h) {
      let best = net[0], bd = Infinity;
      for (const p of net) { const d = Math.hypot(p.x - b.x, p.z - b.z); if (d < bd) { bd = d; best = p; } }
      curve([[px(b.x), pz(b.z)], [px(best.x), pz(best.z)]], 7, walk, WALK, 0.07, false);
    }
  }
  add(merge(asph), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), 0, 0, 0, { cast: false });
  add(merge(walk), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 0, 0.01, 0, { cast: false });
  add(merge(marks), new THREE.MeshBasicMaterial({ vertexColors: true }), 0, 0, 0, { cast: false });

  const nearRoad = (x, z, m) => {
    for (const [x1, z1, x2, z2, w] of segs) { const dx = x2 - x1, dz = z2 - z1, t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / (dx * dx + dz * dz || 1))); if (Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t)) < w / 2 + m) return true; }
    for (const l of lots) { const dx = x - l.cx, dz = z - l.cz, c = Math.cos(l.rot), s = Math.sin(l.rot), lx = dx * c - dz * s, lz = dx * s + dz * c; if (Math.abs(lx) < l.W / 2 + m && Math.abs(lz) < l.D / 2 + m) return true; }
    return false;
  };
  const inLot = (x, z, m) => lots.some((l) => { const dx = x - l.cx, dz = z - l.cz, c = Math.cos(l.rot), s = Math.sin(l.rot); return Math.abs(dx * c - dz * s) < l.W / 2 + m && Math.abs(dx * s + dz * c) < l.D / 2 + m; });
  const inRect = (x, z, m) => { for (const b of rects) { const dx = x - b.x, dz = z - b.z, lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c; if (Math.abs(lx) < b.hw + m && Math.abs(lz) < b.hd + m) return true; } return false; };

  // ---------- lagos ----------
  const LAKES = [{ px: 255, py: 345, rx: 118, rz: 100 }, { px: 398, py: 502, rx: 46, rz: 56 }].map((l) => { const [x, z] = mp(l.px, l.py); return { x, z, rx: l.rx * SP * 0.8, rz: l.rz * SP * 0.8 }; });
  {
    const nc = document.createElement('canvas'); nc.width = nc.height = 128; const ng = nc.getContext('2d'), id = ng.createImageData(128, 128);
    const hh = (x, y) => Math.sin(x * 0.31) * Math.cos(y * 0.23) + Math.sin((x + y) * 0.3) * 0.5 + Math.sin(x * 0.55 - y * 0.35) * 0.3;
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) { const dx = hh(x + 1, y) - hh(x, y), dy = hh(x, y + 1) - hh(x, y), i = (y * 128 + x) * 4; id.data[i] = 128 - dx * 90; id.data[i + 1] = 128 - dy * 90; id.data[i + 2] = 255; id.data[i + 3] = 255; }
    ng.putImageData(id, 0, 0);
    const nt = new THREE.CanvasTexture(nc); nt.wrapS = nt.wrapT = THREE.RepeatWrapping; nt.repeat.set(6, 5);
    const wm = new THREE.MeshStandardMaterial({ color: 0x2aa0d6, roughness: 0.1, metalness: 0.5, normalMap: nt, normalScale: new THREE.Vector2(0.3, 0.3), envMapIntensity: 1.1, transparent: true, opacity: 0.94 });
    wm.onBeforeCompile = (sh) => { // anti-repetição da ondulação: soma uma segunda escala/rotação do normal map
      sh.fragmentShader = sh.fragmentShader.split('texture2D( normalMap, vNormalMapUv )').join('(texture2D( normalMap, vNormalMapUv ) + texture2D( normalMap, mat2(0.8, -0.6, 0.6, 0.8) * vNormalMapUv * 0.37 + 0.21 ) - 0.5)');
    };
    for (const L of LAKES) {
      const mud = new THREE.Mesh(new THREE.CircleGeometry(1, 56).rotateX(-Math.PI / 2), std(0x8a7656, { roughness: 1 })); mud.scale.set(L.rx + 2.2, 1, L.rz + 2.2); mud.position.set(L.x, 0.04, L.z); mud.receiveShadow = true; scene.add(mud);
      const water = new THREE.Mesh(new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2), wm); water.scale.set(L.rx, 1, L.rz); water.position.set(L.x, 0.12, L.z); scene.add(water);
      ellipses.push({ x: L.x, z: L.z, rx: L.rx + 1.5, rz: L.rz + 1.5 });
      const n = Math.round((L.rx + L.rz) * 0.9);
      for (let i = 0; i < n * 1.4; i++) { const a = R(0, TAU), x = L.x + Math.cos(a) * (L.rx + R(-1.2, 0.8)), z = L.z + Math.sin(a) * (L.rz + R(-1.2, 0.8)), s = KIT * R(0.6, 1.1); vegItems.push({ x, z, g: pick(nature.reeds), m: M(x, 0, z, s, s * R(1, 1.8), s, R(0, 6)) }); }
      for (let i = 0; i < n * 0.5; i++) { const a = R(0, TAU), rr = Math.sqrt(R(0.05, 0.8)), x = L.x + Math.cos(a) * L.rx * rr, z = L.z + Math.sin(a) * L.rz * rr, s = KIT * R(0.9, 1.6); solidItems.push({ x, z, g: pick(nature.lily), m: M(x, 0.12, z, s, s, s, R(0, 6)) }); }
      for (let i = 0; i < n * 0.7; i++) { const a = (i / (n * 0.7)) * TAU, x = L.x + Math.cos(a) * (L.rx + R(0.8, 1.8)), z = L.z + Math.sin(a) * (L.rz + R(0.8, 1.8)), s = KIT * R(0.5, 1.1); solidItems.push({ x, z, g: pick(nature.stones), m: M(x, 0, z, s, s * R(0.6, 1.2), s, R(0, 6)), c: new THREE.Color().setScalar(R(0.85, 1.1)) }); }
    }
    anims.push((t) => nt.offset.set(t * 0.01, t * 0.007));
  }

  // ---------- praça central: escultura átomo + billboard UNIVERSO 2026 ----------
  const [plx, plz] = mp(615, 318);
  {
    const pp = [part(CYL, 0xe8e2d4, { p: [plx, 0.07, plz], s: [17, 0.1, 17] }), part(CYL, 0x1a22ff, { p: [plx, 0.13, plz], s: [5.2, 0.05, 5.2] }), part(new THREE.TorusGeometry(1, 0.012, 4, 72).rotateX(Math.PI / 2), 0x1a22ff, { p: [plx, 0.14, plz], s: [13.2, 1, 13.2] })];
    add(merge(pp), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 0, 0, 0, { cast: false });
    const atom = new THREE.Group(); atom.position.set(plx, 6, plz); scene.add(atom);
    add(CYL, std(0xdfe4ee, { metalness: 0.7, roughness: 0.3 }), plx, 1.2, plz, { s: [2.4, 2.4, 2.4] }); addCircle(plx, plz, 3);
    add(SPH, glow(0x2ef2ff, 2.4), 0, 0, 0, { s: [1.3, 1.3, 1.3], parent: atom, cast: false });
    const rings = [0, 1, 2].map(() => { const r = add(new THREE.TorusGeometry(3, 0.09, 8, 64), std(0xf5f7fb, { metalness: 1, roughness: 0.2 }), 0, 0, 0, { parent: atom }); add(SPH, glow(0x1a22ff, 3), 3, 0, 0, { s: [0.3, 0.3, 0.3], parent: r, cast: false }); return r; });
    anims.push((t) => { rings.forEach((r, i) => r.rotation.set(i * 1.05 + t * (0.5 + i * 0.2), i * 0.6 + t * 0.4, t * 0.3 * (i + 1))); atom.position.y = 6 + Math.sin(t * 1.2) * 0.2; });
    const benchG = merge([part(BOX, 0x9a6b3c, { p: [0, 0.6, 0], s: [2.2, 0.12, 0.8] }), part(BOX, 0x9a6b3c, { p: [0, 1.05, -0.38], s: [2.2, 0.55, 0.1], r: [-0.15, 0, 0] }), part(BOX, 0x2a2d38, { p: [-0.95, 0.3, 0], s: [0.12, 0.6, 0.7] }), part(BOX, 0x2a2d38, { p: [0.95, 0.3, 0], s: [0.12, 0.6, 0.7] })]);
    const bm = [];
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.2, x = plx + Math.cos(a) * 14.2, z = plz + Math.sin(a) * 14.2; bm.push({ x, z, m: M(x, 0, z, 1, 1, 1, -a - Math.PI / 2) }); addCircle(x, z, 1.2); }
    instChunked(benchG, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), bm);
    const [bx, bz] = mp(705, 300);
    const ptex = new THREE.TextureLoader().load('/assets/universo.png', (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; }); ptex.colorSpace = THREE.SRGBColorSpace;
    const bb = new THREE.Group(); bb.position.set(bx, 0, bz); bb.rotation.y = Math.atan2(-0.6, 1); scene.add(bb);
    add(BOX, std(0x14151b, { metalness: 0.6 }), 0, 8.6, -0.3, { s: [13.2, 13.2, 0.5], parent: bb });
    add(new THREE.PlaneGeometry(12.4, 12.4), new THREE.MeshBasicMaterial({ map: ptex, toneMapped: false, color: new THREE.Color(1.15, 1.15, 1.15) }), 0, 8.6, 0, { parent: bb, cast: false });
    add(new THREE.PlaneGeometry(12.4, 12.4), new THREE.MeshBasicMaterial({ map: ptex, toneMapped: false }), 0, 8.6, -0.6, { parent: bb, cast: false }).rotation.y = Math.PI;
    for (const sx of [-4.5, 4.5]) add(BOX, std(0x2a2d38, { metalness: 0.6 }), sx, 1.2, -0.3, { s: [0.5, 4.8, 0.5], parent: bb });
    const neon = glow(0x1a22ff, 3);
    add(BOX, neon, 0, 15.3, 0, { s: [13.4, 0.18, 0.2], parent: bb, cast: false }); add(BOX, neon, 0, 1.9, 0, { s: [13.4, 0.18, 0.2], parent: bb, cast: false });
    addCircle(bx - 4, bz, 1.2); addCircle(bx + 4, bz, 1.2);
  }

  // ---------- portões ----------
  [[275, 494, 'PORTÃO 1', 0.5], [642, 502, 'PORTÃO 2', 0], [995, 372, 'PORTÃO 3', -1.2]].forEach(([px, py, name, ry]) => {
    const [x, z] = mp(px, py), g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
    for (const sx of [-8, 8]) add(BOX, std(0xe8ecf5), sx, 3, 0, { parent: g, s: [1.8, 6, 1.8] });
    add(BOX, std(0xd0305a), 0, 6.4, 0, { parent: g, s: [18, 1.1, 1.6] });
    sign(name, x, 8.2, z, 9, 1.8, '#d0305a', '#fff', ry);
    for (const sx of [-8, 8]) addCircle(x + sx * Math.cos(ry), z - sx * Math.sin(ry), 1.3);
  });

  // ---------- postes e carros ----------
  {
    const lamps = []; let acc = 0;
    for (const key of ['alameda', 'diag', 'south', 'ring', 'west', 'east', 'sw', 'perim']) {
      const cs = roads[key];
      for (let i = 1; i < cs.length; i++) { acc += cs[i].distanceTo(cs[i - 1]); if (acc > 52) { acc = 0; const a = cs[i], b = cs[i - 1], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1, off = (key === 'perim' ? 8 : 7) * (lamps.length % 2 ? 1 : -1); lamps.push([a.x + (-dz / L) * off, a.z + (dx / L) * off]); } }
    }
    const lp = lamps.filter(([x, z]) => !inRect(x, z, 1) && !inLot(x, z, 2) && !ellipses.some((e) => ((x - e.x) / e.rx) ** 2 + ((z - e.z) / e.rz) ** 2 < 1));
    instChunked(new THREE.CylinderGeometry(0.1, 0.14, 5.2, 8).translate(0, 2.6, 0), std(0x2a2d38, { metalness: 0.7 }), lp.map(([x, z]) => ({ x, z, m: M(x, 0, z) })));
    instChunked(SPH, glow(0xffc070, 3), lp.map(([x, z]) => ({ x, z, m: M(x, 5.4, z, 0.38) })), { cast: false });
    lp.forEach(([x, z]) => addCircle(x, z, 0.35));
    const cars = [];
    for (const l of lots) {
      const c = Math.cos(l.rot), s = Math.sin(l.rot), rows = Math.max(3, Math.floor(l.W / 3.3)), along = Math.max(1, Math.floor(l.D / 6));
      for (let i = 0; i < rows; i++) for (let j = 0; j < along; j++) {
        const lx = -l.W / 2 + (i + 0.5) * l.W / rows, lz = -l.D / 2 + (j + 0.5) * l.D / along;
        if (rand() < 0.55 || Math.abs(lx) > l.W / 2 - 1 || Math.abs(lz) > l.D / 2 - 2) continue;
        const x = l.cx + lx * c + lz * s, z = l.cz - lx * s + lz * c;
        cars.push({ x, z, m: M(x, 0.1, z, 1, 1, 1, l.rot + (rand() < 0.5 ? 0 : Math.PI)) }); addCircle(x, z, 1.6);
      }
    }
    for (const c of cars) { c.g = pick(nature.cars); c.m.elements[13] = 0.08; solidItems.push(c); } // carros Kenney: a cor vem do modelo
  }

  // ---------- vegetação: bosques densos na periferia, árvores esparsas no campus (BatchedMesh) ----------
  const inLake = (x, z, m) => ellipses.some((e) => ((x - e.x) / (e.rx + m)) ** 2 + ((z - e.z) / (e.rz + m)) ** 2 < 1);
  // mata do mapa oficial: bitmask 133×78 (1 bit = 8×8 px do mapa) das manchas de árvores + entorno fora do campus ao norte
  const WOODS = Uint8Array.from(atob('//9/zOH//////////////////88B+P//////////////////7AGe/////////////////4//AMD///////////////9/3B8A+P///////////////8/HwwH+////////////////+ID+gw/+/////////////58fgP+BgP//////////////8QMAPwDw/////////////59/AIAHAP7/////////////8wYAAAAA/////////////z8PAAAAAAD/9P//////////8wEAAAAAAA78/////////z8+AAAAAAAAAP//////////8wcAAAAAAACA9////////3/eAgAAAAAAAAD8////////58AAAAAAAAAAAPD///////8cAAAAAAAAAAAs4P//////xwEAAAAAGAAA/P+w//////8MAAAAAIAfAMAMdoD/////zwEAAAAAgB8AGFG4w/////8cAAAAAACAfwD4fsDh////nwMAMAAAAPA//B988OD///8ZAKAfAIAb/s9/AH1w4f//nwPA/z8A+P///wmAfz74//95gP//nwHPP/8DAMA/Pv//nz//f/97AAHAHQAAHJiP///z/////34AAPgAAPABx/P/P///////HwAABwAAHuD3+P/x/9////8DADAAAMAA/j38P///////DwAABgAAMPB/D/z3///78f8DAEAxAADmj/8P/v//O+D/fwAAbg4A8P/A38//v/8H+P4HAODPAcB/HoD38f/+/QH+fwAA/jngP4A/wH/4//8fgP8fAMA+vv8H8AfwP////wHA/wMAwMf//wAGAP4H/vsfAPB/AMD48f8cAADA/8P//wMA8A8A/DN+3gcAgP//989+AAD+AYC/z4/nAADg8f/v3w8AAH8AuP/5cR5gABj8//9/AADABwD/Px/ABwQAA/D//w8AAPAD8DvmAfCPAQB4gP//AQAA/oA/wAHA/zAAgH/w/z8AAAAf8AcgAD4eAAB8DP7/AwAAwKfzAATwwQMAwAPAf3cAAAD4/x/AAT54AIB/APjnDwAAAP75ATgABg8A/Bkg//4BAACAnweAh8zgAP6//+///wEAAPhxAPCBOQDw/+P//f97AAAAHwwAOAQHwP+//4/7v/8AAPABAQCGAAD+//zf4f//HwAAzwEAgAEA4P///yW8//8fAGB8AAAwAAD///8PAND8/wOA/x8AAA4A+P+X/wAAYP9vA3j/AwDAAYD/H6YNAADA///Bc3gAgAwA/P/jHQAAAIDff74PHAAYAMD/f/gBAAAAAP//eYAHAAAA/P//AwAAAAAA/IcHwAMAAPh//h8AAAAAAIA/fAD4AAAAgP8/AAAAAAAA4AMAAD8AAADwbwAAAAAAAACwAADADwAAAL4AAAAAAAAAAHAAAfgHAIH6AwAAAAAAAAAA+H+A/wB++AcAAAAAAAAAAAD+H/Af/B9eAAAAAAAAAAAAAP4H/v//QwAAAAAAAAAAAACA/+H//38AAAAAAAAAAAAAAID//f//BwAAAAAAAAAAAAAA4P///wEAAAAAAAAAAAAAAADA//8/AAAAAAAAAAAAAAAAAID/PwAAAAAAAAAAAAAAAAAAwMkBAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=='), (ch) => ch.charCodeAt(0));
  const woods = (x, z) => { const i = Math.floor((x / SP + 532) / 8), j = Math.floor((z / SP + 310) / 8); if (i < 0 || j < 0 || i >= 133 || j >= 78) return 0; const k = j * 133 + i; return (WOODS[k >> 3] >> (k & 7)) & 1; };
  const core = (x, z) => { const [a, b] = mp(500, 150), [c, d] = mp(1010, 470); return x > a && x < c && z > b && z < d; };
  const free = (x, z, m = 1.5) => !inRect(x, z, m + 1) && !inLake(x, z, m + 2) && !nearRoad(x, z, m) && Math.hypot(x - plx, z - plz) > 18 + m && !circleHit(x, z, m);
  // mancha de bosque (0..1): agrupa as árvores em capões em vez de espalhar uniforme
  const grove = (x, z) => 0.5 + 0.28 * Math.sin(x * 0.029 + 1.3) * Math.cos(z * 0.034 - 0.4) + 0.22 * Math.sin(x * 0.071 - z * 0.053 + 2.1);
  const tint = (l = 0.1, h = 0.04) => new THREE.Color().setHSL(0.25 + R(-h, h), 0.6, 0.5).lerp(ONE, 0.82).multiplyScalar(1 + R(-l, l));
  const HX = 395, HZ = 228;
  { // palmeiras imperiais nas vias principais
    for (const key of ['alameda', 'diag', 'south']) {
      const cs = roads[key]; let acc = 0;
      for (let i = 1; i < cs.length; i++) { acc += cs[i].distanceTo(cs[i - 1]); if (acc > 24) { acc = 0; const a = cs[i], b = cs[i - 1], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1; for (const sd of [-1, 1]) { const off = 9.5 * sd, x = a.x + (-dz / L) * off, z = a.z + (dx / L) * off; if (!inRect(x, z, 2) && !inLot(x, z, 2) && !inLake(x, z, 2) && !circleHit(x, z, 1)) { const s = KIT * 1.6 * R(0.9, 1.15); vegItems.push({ x, z, g: pick(nature.palms), m: M(x, 0, z, s * 0.7, s * 1.15, s * 0.7, R(0, 6)), c: tint(0.06) }); addCircle(x, z, 0.5); } } } }
    }
  }
  const trees = [], tg = new Map(), TG = 6, tk = (i, j) => i * 4096 + j;
  const crowded = (x, z, d) => { const n = Math.ceil(d / TG), i0 = Math.floor(x / TG), j0 = Math.floor(z / TG); for (let i = i0 - n; i <= i0 + n; i++) for (let j = j0 - n; j <= j0 + n; j++) for (const p of tg.get(tk(i, j)) || []) if (Math.hypot(p.x - x, p.z - z) < d) return true; return false; };
  for (let tries = 0; tries < 120000 && trees.length < 6500; tries++) { // mata fechada onde o mapa tem mata; gramados abertos com árvores esparsas
    const x = R(-HX, HX), z = R(-HZ, HZ), w = woods(x, z), c = !w && core(x, z), gv = grove(x, z);
    if (rand() > (w ? 0.9 : c ? 0.12 : 0.08 + gv * gv * 0.5)) continue;
    if (!free(x, z, 2.2) || crowded(x, z, w ? 6.2 + (1 - gv) * 2.2 : c ? 16 : 12)) continue;
    const k = rand(), s = KIT * R(0.85, 1.3);
    const broad = rand() < 0.8 ? nature.trees.slice(0, 6) : nature.trees; // copas cheias dominam; altas/finas só de vez em quando
    const g = c ? (k < 0.1 ? pick(nature.ipe) : pick(broad)) : k < 0.12 ? pick(nature.pines) : k < 0.14 ? pick(nature.ipe) : pick(broad);
    const t = { x, z, g, m: M(x, 0, z, s, s * R(0.9, 1.15), s, R(0, 6)), c: tint() }; trees.push(t);
    const key = tk(Math.floor(x / TG), Math.floor(z / TG)); (tg.get(key) || tg.set(key, []).get(key)).push(t);
    addCircle(x, z, 0.8);
  }
  { // sub-bosque: tocos, troncos caídos e cogumelos nas bordas dos capões
    for (let i = 0; i < 160; i++) {
      const t = trees[(rand() * trees.length) | 0], a = R(0, TAU), r = R(3, 6), x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r;
      if (core(x, z) || !free(x, z, 1)) continue;
      const s = KIT * R(0.8, 1.3); solidItems.push({ x, z, g: pick(nature.forest), m: M(x, 0, z, s, s, s, R(0, 6)) });
    }
  }
  const forest = batched(vegMat(0.05), trees);
  let farCells = [];
  { // floresta distante (sem sombra) — horizonte nunca vazio; só modelos de poucos triângulos
    const far = [], cheap = [nature.trees[3], nature.trees[5], nature.trees[6], nature.pines[1]];
    for (let i = 0; i < 2600; i++) { // mais denso colado no campus, rareando para longe
      const a = R(0, TAU), rr = 1 + R(0, 0.84) ** 2, x = Math.cos(a) * (HX + 25) * rr, z = Math.sin(a) * (HZ + 40) * rr, s = KIT * R(1.4, 2.4);
      if (Math.abs(x) < HX + 10 && Math.abs(z) < HZ + 10) continue;
      far.push({ x, z, g: pick(cheap), m: M(x, 0, z, s, s, s, R(0, 6)), c: tint(0.12) });
    }
    farCells = batched(std(0xffffff, { roughness: 0.9, vertexColors: true }), far, { cast: false, recv: false });
  }
  for (let i = 0, tries = 0; i < 320 && tries < 14000; tries++) { // arbustos: metade encostada nos prédios/borda da mata
    const x = R(-HX, HX), z = R(-HZ, HZ); if (!free(x, z, 1.2) || (rand() < 0.5 && !inRect(x, z, 5) && !woods(x, z))) continue;
    const s = KIT * R(0.7, 1.3); vegItems.push({ x, z, g: pick(nature.bushes), m: M(x, 0, z, s, s * R(0.8, 1.2), s, R(0, 6)), c: tint(0.08) }); i++;
  }
  { // flores em manchas de uma cor só + canteiro da praça
    for (let k = 0, tries = 0; k < 55 && tries < 6000; tries++) {
      const cx = R(-HX, HX), cz = R(-HZ, HZ); if (!free(cx, cz, 2)) continue; k++;
      const kind = (rand() * 3) | 0, n = 6 + ((rand() * 8) | 0);
      for (let i = 0; i < n; i++) { const a = R(0, TAU), r = Math.sqrt(rand()) * 2.6, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, s = KIT * R(0.5, 0.8); vegItems.push({ x, z, g: nature.flowers[kind * 2 + (rand() < 0.5 ? 1 : 0)], m: M(x, 0, z, s, s, s, R(0, 6)) }); }
    }
    for (let i = 0; i < 90; i++) { const a = (i / 90) * TAU, r = 10.5 + (i % 2) * 1.1, x = plx + Math.cos(a) * r, z = plz + Math.sin(a) * r, s = KIT * 0.7; vegItems.push({ x, z, g: nature.flowers[(i % 3) * 2], m: M(x, 0, z, s, s, s, R(0, 6)) }); }
    for (let k = 0, tries = 0; k < 45 && tries < 5000; tries++) {
      const x = R(-HX, HX), z = R(-HZ, HZ); if (!free(x, z, 1.6)) continue; k++;
      const big = rand() < 0.25, s = KIT * (big ? R(1.4, 2.2) : R(0.8, 1.4));
      solidItems.push({ x, z, g: big ? pick(nature.rocks.slice(3)) : pick(nature.rocks.slice(0, 3)), m: M(x, 0, z, s, s * R(0.8, 1.3), s, R(0, 6)) });
      if (big) addCircle(x, z, s * 0.25);
    }
  }
  const veg = batched(vegMat(0.06), vegItems);
  batched(std(0xffffff, { roughness: 0.85, vertexColors: true }), solidItems);

  // grama: tufos de lâminas com gradiente escuro→claro e normal para cima (iluminação igual à do chão → se funde ao gramado)
  const tuft = (() => {
    const pos = [], col = [], nor = [], base = new THREE.Color(0x3f8a34), tip = new THREE.Color(0xa6cc5c);
    for (let i = 0; i < 9; i++) {
      const a = R(0, TAU), r = R(0, 0.28), x = Math.cos(a) * r, z = Math.sin(a) * r, h = R(0.35, 0.8), w = R(0.05, 0.08), ba = R(0, TAU), lean = R(0.05, 0.25);
      const bx = Math.cos(ba) * w, bz = Math.sin(ba) * w, tx = x + Math.cos(a) * lean, tz = z + Math.sin(a) * lean;
      pos.push(x - bx, 0, z - bz, x + bx, 0, z + bz, tx, h, tz);
      const t = tip.clone().lerp(base, R(0, 0.35));
      col.push(base.r, base.g, base.b, base.r, base.g, base.b, t.r, t.g, t.b); nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  })();
  const gm = [];
  for (let k = 0, tries = 0; k < 1900 && tries < 40000; tries++) { // touceiras em manchas, mais densas na borda dos bosques
    const cx = R(-HX, HX), cz = R(-HZ, HZ); if (!free(cx, cz, 1.2) || rand() > 0.3 + (woods(cx, cz) ? 0.6 : grove(cx, cz) * 0.5)) continue; k++;
    for (let i = 0, n = 4 + ((rand() * 6) | 0); i < n; i++) { const a = R(0, TAU), r = Math.sqrt(rand()) * 1.8, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r, s = R(0.8, 1.7); gm.push({ x, z, m: M(x, 0, z, s, s * R(0.8, 1.3), s, R(0, 6)), c: new THREE.Color().setScalar(R(0.85, 1.1)) }); }
  }
  const grassM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }); sway(grassM, 0.22, true);
  const grass = instChunked(tuft, grassM, gm, { cast: false });


  // drones discretos (tecnologia)
  const droneG = merge([part(BOX, 0x2a2d38, { s: [0.9, 0.22, 0.9] }), ...[[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]].flatMap(([x, z]) => [part(BOX, 0x2a2d38, { p: [x * 0.5, 0, z * 0.5], s: [0.1, 0.08, 0.1], r: [0, Math.atan2(x, z), 0] }), part(CYL, 0xc7d0e0, { p: [x, 0.14, z], s: [0.5, 0.02, 0.5] })])]);
  const drones = [0, 1, 2].map((i) => { const g = new THREE.Group(); scene.add(g); add(droneG, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.4 }), 0, 0, 0, { parent: g, s: [1.6, 1.6, 1.6] }); const led = add(SPH, glow(i % 2 ? 0x34ff6a : 0xff3b3b, 3), 0, -0.1, 0.7, { s: [0.12, 0.12, 0.12], parent: g, cast: false }); return { g, led, r: 30 + i * 14, h: 26 + i * 3, sp: (i % 2 ? -1 : 1) * (0.1 + i * 0.03), ph: i * 2.1 }; });
  anims.push((t) => drones.forEach((d) => { const a = t * d.sp + d.ph; d.g.position.set(plx + Math.cos(a) * d.r, d.h + Math.sin(t * 1.3 + d.ph) * 0.6, plz + Math.sin(a) * d.r); d.g.rotation.y = -a * Math.sign(d.sp) + 1.57; d.led.visible = Math.sin(t * 5 + d.ph) > -0.3; }));

  // ---------- zonas de spawn de capivaras: gramados e beira dos lagos ----------
  const zones = LAKES.map((L, i) => ({ kind: 'lake', L, w: i ? 2.5 : 5 }));
  [[690, 252, 38, 2], [860, 368, 40, 2], [560, 330, 28, 1.5], [350, 232, 38, 2], [905, 330, 30, 1.5], [430, 170, 22, 1], [720, 410, 34, 1.5], [640, 150, 30, 1.2], [500, 470, 30, 1.5]].forEach(([px, py, r, w]) => { const [x, z] = mp(px, py); zones.push({ kind: 'disc', x, z, r: r * SP, w }); });
  const zw = zones.reduce((s, z) => s + z.w, 0);
  const spawns = [[-12, 4], [12, 4], [-12, -10], [12, -10]].map(([ox, oz]) => [plx + ox, plz + 22 + oz]);

  return {
    rects, ellipses, circleHit, rand, spawns, plaza: [plx, plz], segs, lots, lakes: LAKES,
    sampleZone() {
      let r = rand() * zw;
      for (const z of zones) {
        r -= z.w; if (r > 0) continue;
        if (z.kind === 'lake') { const a = Math.random() * TAU, k = 1.12 + Math.random() * 0.45; return [z.L.x + Math.cos(a) * (z.L.rx + 2) * k, z.L.z + Math.sin(a) * (z.L.rz + 2) * k]; }
        const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * z.r; return [z.x + Math.cos(a) * rr, z.z + Math.sin(a) * rr];
      }
      return [plx, plz + 30];
    },
    setDensity(q) {
      for (const m of grass) m.count = Math.max(1, Math.floor(m.userData.n * q.grass));
      for (const { bm, n, off } of forest) for (let i = 0; i < n; i++) bm.setVisibleAt(i, !off?.[i] && i < Math.ceil(n * q.trees));
    },
    // esconde árvores dentro dos morros do horizonte (world.buildFar): furavam a encosta
    cull(inside) {
      for (const c of [...forest, ...farCells]) c.off = c.list.map((it) => inside(it.x, it.z));
      for (const { bm, n, off } of farCells) for (let i = 0; i < n; i++) bm.setVisibleAt(i, !off[i]);
    },
    update(dt, t, focuses) {
      for (const a of anims) a(t, dt);
      for (const f of focuses) { for (let i = 0, nf = Math.floor(dt * 5) + (Math.random() < (dt * 5) % 1 ? 1 : 0); i < nf; i++) fx.glow.emit(f.x + R(-45, 45), R(0.5, 3.5), f.z + R(-45, 45), R(-0.5, 0.5), R(-0.1, 0.35), R(-0.5, 0.5), 1.2, 1.5, 0.35, R(0.12, 0.2), R(2.5, 4.5), { a: 0.9, drag: 0.2 }); const n = dt * 0.8, k = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0); for (let i = 0; i < k; i++) fx.glow.emit(f.x + R(-40, 40), R(0.8, 16), f.z + R(-40, 40), R(-0.4, 0.4), R(0.1, 0.5), R(-0.4, 0.4), 1.5, 1.2, 0.6, R(0.18, 0.3), R(3, 5.5), { a: 0.35 }); }
    },
  };
}
