import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { UFO_COLORS, LIGHT_COLORS, BEAM_COLORS } from './config.js';

const V3 = THREE.Vector3, Q = new THREE.Quaternion(), E = new THREE.Euler(), M = new THREE.Matrix4();

// geometria colorida por vértice, já transformada — base para mesclar tudo num único draw call
export function part(geo, color, { p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0] } = {}) {
  const g = geo.clone();
  M.compose(new V3(...p), Q.setFromEuler(E.set(...r)), new V3(...s));
  g.applyMatrix4(M);
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
export const merge = (parts) => { const g = mergeGeometries(parts, false); parts.forEach((p) => p.dispose()); return g; };

const SPH = new THREE.SphereGeometry(1, 10, 7), SPHB = new THREE.SphereGeometry(1, 16, 11); // low-poly para partes pequenas; SPHB para corpo/cabeça
const HSPH = new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 18);
const TOR = (r, t) => new THREE.TorusGeometry(r, t, 10, 48);
const lathe = (pts, seg = 36) => new THREE.LatheGeometry(new THREE.SplineCurve(pts.map((p) => new THREE.Vector2(...p))).getPoints(pts.length * 3), seg);

const shade = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getHex();

// ===================== CAPIVARA =====================
// frente = +Z. Pivôs: cabeça em (0,.98,.72) do corpo; pernas nos quadris.
export const CAPY_HEAD_PIVOT = [0, 0.98, 0.72];
export const CAPY_LEGS = [[-0.3, 0.45, 0.5], [0.3, 0.45, 0.5], [-0.3, 0.45, -0.5], [0.3, 0.45, -0.5]];
const PALETTES = [
  { body: 0xa9743f, back: 0x946134, belly: 0xd4a66f, snout: 0xb88350, leg: 0x7d5029 },
  { body: 0xb98349, back: 0xa26f3c, belly: 0xe0b57c, snout: 0xc5915a, leg: 0x8a5a30 },
  { body: 0x93663a, back: 0x7e5430, belly: 0xc29560, snout: 0xa5774a, leg: 0x6b4524 },
  { body: 0xffcf3a, back: 0xf0b21f, belly: 0xfff0a8, snout: 0xffdb62, leg: 0xe0a21a }, // dourada
];
const _capyGeo = {};
export function capyGeos(pal = 0) {
  if (_capyGeo[pal]) return _capyGeo[pal];
  const c = PALETTES[pal], P = CAPY_HEAD_PIVOT;
  const rel = (x, y, z) => [x - P[0], y - P[1], z - P[2]];
  const body = merge([
    part(SPHB, c.body, { p: [0, 0.82, 0], s: [0.62, 0.55, 0.92] }),
    part(SPHB, c.back, { p: [0, 1.0, -0.05], s: [0.56, 0.4, 0.85] }),
    part(SPHB, c.belly, { p: [0, 0.58, 0.05], s: [0.5, 0.35, 0.75] }),
    part(SPH, 0x5a3a20, { p: [0, 0.86, -0.92], s: [0.12, 0.1, 0.1] }),
  ]);
  const head = merge([
    part(SPHB, c.body, { p: rel(0, 1.08, 1.0), s: [0.418, 0.405, 0.44] }),
    part(SPHB, c.snout, { p: rel(0, 0.98, 1.38), s: [0.32, 0.27, 0.34] }),
    part(SPH, 0x2a1c15, { p: rel(0, 1.07, 1.67), s: [0.21, 0.14, 0.14] }),
    part(SPH, 0x15100e, { p: rel(-0.27, 1.22, 1.3), s: [0.085, 0.1, 0.07] }),
    part(SPH, 0x15100e, { p: rel(0.27, 1.22, 1.3), s: [0.085, 0.1, 0.07] }),
    part(SPH, 0xffffff, { p: rel(-0.245, 1.26, 1.355), s: [0.032, 0.032, 0.03] }),
    part(SPH, 0xffffff, { p: rel(0.295, 1.26, 1.355), s: [0.032, 0.032, 0.03] }),
    part(SPH, 0xe89a86, { p: rel(-0.37, 1.02, 1.17), s: [0.07, 0.05, 0.03] }),
    part(SPH, 0xe89a86, { p: rel(0.37, 1.02, 1.17), s: [0.07, 0.05, 0.03] }),
    part(SPH, c.leg, { p: rel(-0.33, 1.43, 0.86), s: [0.1, 0.11, 0.07] }),
    part(SPH, c.leg, { p: rel(0.33, 1.43, 0.86), s: [0.1, 0.11, 0.07] }),
  ]);
  const leg = merge([
    part(CYL, c.leg, { p: [0, -0.225, 0], s: [0.125, 0.45, 0.125] }),
    part(SPH, 0x3a2616, { p: [0, -0.43, 0.05], s: [0.14, 0.08, 0.17] }),
  ]);
  return (_capyGeo[pal] = { body, head, leg });
}
// acessórios de cabeça (relativos ao pivô da cabeça): 1 laranja, 2 capelo de formatura
export function capyHat(kind) {
  if (kind === 1) return merge([
    part(SPH, 0xff8f1f, { p: [0, 0.6, 0.2], s: [0.2, 0.18, 0.2] }),
    part(SPH, 0x3fae3a, { p: [0.04, 0.79, 0.2], s: [0.07, 0.03, 0.05], r: [0, 0, 0.5] }),
  ]);
  return merge([
    part(CYL, 0x16161c, { p: [0, 0.55, 0.2], s: [0.24, 0.12, 0.24] }),
    part(BOX, 0x16161c, { p: [0, 0.63, 0.2], s: [0.74, 0.05, 0.74], r: [0, 0.5, 0] }),
    part(SPH, 0xffc82e, { p: [0.0, 0.64, 0.2], s: [0.05, 0.05, 0.05] }),
    part(CYL, 0xffc82e, { p: [0.34, 0.5, 0.0], s: [0.012, 0.28, 0.012] }),
    part(SPH, 0xffc82e, { p: [0.34, 0.35, 0.0], s: [0.05, 0.05, 0.05] }),
  ]);
}

// ===================== OVNI =====================
export function ufoPalette(cfg) {
  const hull = UFO_COLORS[cfg.c] ?? UFO_COLORS[0];
  const light = LIGHT_COLORS[cfg.l] ?? LIGHT_COLORS[1];
  const rainbow = cfg.b === 5;
  return { hull, light, lightColor: new THREE.Color(light), beam: BEAM_COLORS[cfg.b] ?? light, rainbow };
}

function ufoMats(cfg) {
  const { hull, light } = ufoPalette(cfg);
  const glowCol = new THREE.Color(light).multiplyScalar(1.3);
  const mk = (c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
  return {
    hull: new THREE.MeshStandardMaterial({ color: hull, map: hullTex(cfg.s), metalness: 0.3, roughness: 0.36, envMapIntensity: 1.0, emissive: hull, emissiveIntensity: 0.12 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2e3d, metalness: 0.6, roughness: 0.4, envMapIntensity: 1.2, emissive: 0x151826, emissiveIntensity: 0.6 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xe6eaf2, metalness: 0.55, roughness: 0.28, envMapIntensity: 1.5, emissive: 0x8a93a8, emissiveIntensity: 0.25 }),
    glowA: mk(glowCol.clone()), glowB: mk(glowCol.clone()),
    glass: new THREE.MeshPhysicalMaterial({ color: new THREE.Color(light).lerp(new THREE.Color(0xffffff), 0.6), transparent: true, opacity: 0.3, roughness: 0.04, metalness: 0, clearcoat: 1, envMapIntensity: 2.4, depthWrite: false }),
    alien: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }),
    vcol: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.4 }),
    base: glowCol,
  };
}

function bulbRing(n, radius, y, size, phase0, mats, parts = [[], []]) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    parts[i % 2].push(part(SPH, 0xffffff, { p: [Math.cos(a) * radius, y, Math.sin(a) * radius], s: [size, size, size] }));
  }
  return parts;
}

// pilotos da cúpula: 0 alien verde · 1 alien roxo · 2 robô · 3 capivara
function pilot(kind) {
  if (kind === 3) { const g = capyGeos(0).head.clone(); g.scale(0.62, 0.62, 0.62); g.translate(0, 0.28, -0.28); return g; }
  if (kind === 2) return merge([
    part(BOX, 0xc9d1de, { p: [0, 0.3, 0], s: [0.62, 0.5, 0.52] }),
    part(BOX, 0x2a2e3d, { p: [0, 0.3, 0.27], s: [0.5, 0.2, 0.04] }),
    part(SPH, 0x39f0ff, { p: [-0.13, 0.3, 0.3], s: [0.07, 0.07, 0.04] }),
    part(SPH, 0x39f0ff, { p: [0.13, 0.3, 0.3], s: [0.07, 0.07, 0.04] }),
    part(CYL, 0x8a93a8, { p: [0, 0.65, 0], s: [0.03, 0.2, 0.03] }),
    part(SPH, 0xff4b4b, { p: [0, 0.88, 0], s: [0.08, 0.08, 0.08] }),
    part(CYL, 0x2c3340, { p: [0, -0.1, 0], s: [0.3, 0.2, 0.26] }),
  ]);
  const [skin, dark] = kind === 1 ? [0xb59cff, 0x5a3fd0] : [0x74e36f, 0x5ac556];
  return merge([
    part(SPH, skin, { p: [0, 0.22, 0], s: [0.4, 0.5, 0.4] }),
    part(SPH, 0x0b0f12, { p: [-0.19, 0.2, 0.3], s: [0.17, 0.1, 0.08], r: [0, 0, 0.5] }),
    part(SPH, 0x0b0f12, { p: [0.19, 0.2, 0.3], s: [0.17, 0.1, 0.08], r: [0, 0, -0.5] }),
    part(CYL, dark, { p: [0, -0.18, 0], s: [0.1, 0.22, 0.1] }),
    part(CYL, 0x2c3340, { p: [0, -0.32, 0], s: [0.3, 0.12, 0.26] }),
  ]);
}

// estampas do casco (multiplicam a cor): 1 listras radiais · 2 xadrez · 3 camuflagem
const _hullTex = {};
function hullTex(kind) {
  if (!kind) return null;
  return (_hullTex[kind] ||= (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 128); g.fillStyle = 'rgba(0,0,0,.42)';
    if (kind === 1) for (let i = 0; i < 12; i++) g.fillRect(i * (256 / 12), 0, 256 / 24, 128);
    else if (kind === 2) for (let y = 0; y < 8; y++) for (let x = 0; x < 16; x++) if ((x + y) & 1) g.fillRect(x * 16, y * 16, 16, 16);
    else for (let i = 0; i < 90; i++) { g.globalAlpha = 0.5 + Math.random() * 0.5; g.beginPath(); g.ellipse(Math.random() * 256, Math.random() * 128, 8 + Math.random() * 18, 5 + Math.random() * 10, Math.random() * 3, 0, 7); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  })());
}

// retorna {group, spin, tilt parts…, anim(t, dt, info)} — group.position = centro do casco
export function buildUfo(cfg) {
  const mats = ufoMats(cfg);
  const root = new THREE.Group();
  const spin = new THREE.Group(); // gira (luzes percorrendo)
  const still = new THREE.Group(); // não gira (cúpula, alien, acessórios)
  root.add(spin, still);
  const anim = [];
  const add = (parent, geo, mat, cast = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; parent.add(m); return m; };
  const M0 = cfg.m ?? 0;
  const glowDisc = (r, y) => { const m = add(still, new THREE.CircleGeometry(r, 32), mats.glowA, false); m.rotation.x = Math.PI / 2; m.position.y = y; return m; };

  let domeY = 0.5, domeS = [1.35, 1.2, 1.35], rimR = 3.0, alienY = 0.55, alienS = 1;
  if (M0 === 0) { // CLÁSSICO
    add(spin, lathe([[0.0, -0.66], [0.6, -0.64], [1.4, -0.5], [2.3, -0.24], [2.9, 0.02], [3.05, 0.2]]), mats.trim);
    add(spin, lathe([[3.05, 0.2], [2.85, 0.36], [2.1, 0.5], [1.4, 0.6], [1.05, 0.66]]), mats.hull);
    add(spin, TOR(3.02, 0.17), mats.dark).rotation.x = Math.PI / 2;
    spin.children.at(-1).position.y = 0.2;
    const [a, b] = bulbRing(14, 3.08, 0.2, 0.2, 0, mats);
    add(spin, merge(a), mats.glowA, false); add(spin, merge(b), mats.glowB, false);
    add(still, new THREE.CylinderGeometry(0.75, 0.9, 0.3, 24), mats.dark).position.y = -0.78;
    glowDisc(1.1, -0.95).rotation.x = Math.PI / 2;
    const r1 = add(still, TOR(1.95, 0.07), mats.glowB, false); r1.rotation.x = Math.PI / 2; r1.position.y = -0.52;
  } else if (M0 === 1) { // FUTURISTA
    domeY = 0.42; domeS = [1.0, 0.8, 1.55]; rimR = 3.45; alienY = 0.5;
    add(spin, lathe([[0.0, -0.55], [0.8, -0.54], [1.9, -0.38], [3.0, -0.1], [3.55, 0.04]]), mats.dark);
    add(spin, lathe([[3.55, 0.04], [3.0, 0.2], [1.9, 0.4], [1.1, 0.52], [0.85, 0.56]]), mats.hull);
    const stripes = [];
    for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.283; stripes.push(part(BOX, 0xffffff, { p: [Math.cos(a) * 2.5, 0.27, Math.sin(a) * 2.5], s: [1.3, 0.05, 0.14], r: [0, -a, 0] })); }
    add(spin, merge(stripes), mats.glowA, false);
    const ra = add(still, TOR(2.4, 0.1), mats.glowB, false); ra.rotation.x = Math.PI / 2; ra.position.y = -1.0;
    anim.push((t) => { ra.rotation.z = t * 1.8; ra.position.y = -1.0 + Math.sin(t * 2.2) * 0.07; });
    const wings = merge([
      part(BOX, 0xffffff, { p: [-3.7, 0.08, -1.3], s: [2.8, 0.07, 0.8], r: [0, 0.6, 0.1] }),
      part(BOX, 0xffffff, { p: [3.7, 0.08, -1.3], s: [2.8, 0.07, 0.8], r: [0, -0.6, -0.1] }),
      part(BOX, 0xffffff, { p: [0, 0.8, -2.7], s: [0.1, 0.9, 1.1], r: [0.45, 0, 0] }),
    ]);
    add(still, wings, mats.hull);
    add(still, merge([part(BOX, 0xffffff, { p: [-4.2, 0.13, -1.5], s: [1.2, 0.03, 0.1], r: [0, 0.6, 0.1] }), part(BOX, 0xffffff, { p: [4.2, 0.13, -1.5], s: [1.2, 0.03, 0.1], r: [0, -0.6, -0.1] })]), mats.glowA, false);
    glowDisc(1.2, -0.62);
  } else if (M0 === 3) { // BOLHA: tigela metálica + cúpula enorme (o piloto aparece bem)
    domeY = 0.1; domeS = [2.1, 1.75, 2.1]; rimR = 2.5; alienY = 0.25; alienS = 1.5;
    add(spin, lathe([[0.0, -1.15], [0.8, -1.08], [1.6, -0.75], [2.2, -0.25], [2.45, 0.1]]), mats.hull);
    add(spin, TOR(2.4, 0.2), mats.dark).rotation.x = Math.PI / 2;
    spin.children.at(-1).position.y = 0.1;
    const [a, b] = bulbRing(12, 2.5, 0.1, 0.17, 0, mats);
    add(spin, merge(a), mats.glowA, false); add(spin, merge(b), mats.glowB, false);
    add(still, new THREE.CylinderGeometry(0.5, 0.7, 0.35, 20), mats.dark).position.y = -1.25;
    glowDisc(0.9, -1.45);
  } else if (M0 === 4) { // MANTA: triangular, achatada, luzes nas pontas
    domeY = 0.5; domeS = [1.15, 0.95, 1.15]; rimR = 3.2; alienY = 0.5;
    add(spin, lathe([[0.0, -0.45], [2.0, -0.4], [3.6, -0.18], [4.0, 0.02]], 3), mats.dark);
    add(spin, lathe([[4.0, 0.02], [3.5, 0.26], [2.0, 0.6], [0.9, 0.78], [0.0, 0.82]], 3), mats.hull);
    const tips = [];
    for (let i = 0; i < 3; i++) { const a = (i / 3) * 6.283; tips.push(part(SPH, 0xffffff, { p: [Math.sin(a) * 3.85, 0.05, Math.cos(a) * 3.85], s: [0.34, 0.2, 0.34] })); }
    add(spin, merge(tips), mats.glowA, false);
    const ra = add(still, TOR(1.5, 0.08), mats.glowB, false); ra.rotation.x = Math.PI / 2; ra.position.y = -0.62;
    glowDisc(1.0, -0.5);
  } else { // COMPACTO
    domeY = 0.5; domeS = [1.3, 1.35, 1.3]; rimR = 1.9; alienY = 0.52; alienS = 1.15;
    add(spin, lathe([[0.0, -0.92], [0.7, -0.88], [1.4, -0.52], [1.82, 0.0], [1.78, 0.36], [1.3, 0.62]]), mats.hull);
    add(spin, TOR(1.8, 0.2), mats.dark).rotation.x = Math.PI / 2;
    const [a, b] = bulbRing(8, 1.95, 0.0, 0.2, 0, mats);
    add(spin, merge(a), mats.glowA, false); add(spin, merge(b), mats.glowB, false);
    const pods = [], tips = [];
    for (let i = 0; i < 3; i++) {
      const ang = (i / 3) * 6.283 + 1.57;
      pods.push(part(CYL, 0x1b1e28, { p: [Math.cos(ang) * 2.0, -0.35, Math.sin(ang) * 2.0], s: [0.28, 0.9, 0.28] }));
      tips.push(part(CYL, 0xffffff, { p: [Math.cos(ang) * 2.0, -0.82, Math.sin(ang) * 2.0], s: [0.22, 0.05, 0.22] }));
    }
    add(spin, merge(pods), mats.dark); add(spin, merge(tips), mats.glowB, false);
    glowDisc(0.85, -0.93);
  }
  // cúpula + alien
  const dome = add(still, HSPH, mats.glass, false); dome.scale.set(...domeS); dome.position.y = domeY; dome.renderOrder = 5;
  const al = add(still, pilot(cfg.p ?? 0), mats.alien); al.position.y = domeY + 0.08; al.scale.setScalar(alienS);
  anim.push((t) => { al.rotation.y = Math.sin(t * 1.3) * 0.7; al.position.y = domeY + 0.08 + Math.sin(t * 3) * 0.04; });

  // acessórios
  const acc = cfg.a ?? 0;
  const topY = domeY + domeS[1] + 0.02;
  if (acc === 0) { // antena
    const ant = new THREE.Group(); ant.position.set(0.0, topY - 0.15, -0.2); still.add(ant);
    add(ant, new THREE.CylinderGeometry(0.035, 0.05, 1.6, 8), mats.trim).position.y = 0.8;
    const tip = add(ant, new THREE.SphereGeometry(0.17, 12, 10), mats.glowA, false); tip.position.y = 1.65;
    anim.push((t) => { ant.rotation.z = Math.sin(t * 2.4) * 0.07; ant.rotation.x = Math.sin(t * 1.9) * 0.05; tip.scale.setScalar(1 + Math.sin(t * 7) * 0.2); });
  } else if (acc === 1) { // anel flutuante
    const ring = new THREE.Group(); still.add(ring);
    const r = add(ring, TOR(rimR + 0.9, 0.09), mats.glowA, false); r.rotation.x = Math.PI / 2;
    const dots = []; for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.283; dots.push(part(SPH, 0xffffff, { p: [Math.cos(a) * (rimR + 0.9), 0, Math.sin(a) * (rimR + 0.9)], s: [0.18, 0.18, 0.18] })); }
    add(ring, merge(dots), mats.glowB, false);
    ring.position.y = 0.55;
    anim.push((t) => { ring.rotation.y = t * 0.9; ring.rotation.z = Math.sin(t * 1.2) * 0.12; ring.rotation.x = Math.cos(t * 0.9) * 0.1; });
  } else if (acc === 2) { // detalhes: pods laterais + radar giratório
    const sidePods = [];
    for (const s of [-1, 1]) {
      sidePods.push(part(CYL, 0x1b1e28, { p: [s * (rimR * 0.68), 0.3, 0.2], s: [0.24, 0.9, 0.24], r: [Math.PI / 2, 0, 0] }));
      sidePods.push(part(SPH, 0xffffff, { p: [s * (rimR * 0.68), 0.3, 0.7], s: [0.2, 0.2, 0.2] }));
    }
    add(still, merge(sidePods), mats.vcol);
    const dish = new THREE.Group(); dish.position.set(0, topY - 0.1, -0.3); still.add(dish);
    add(dish, new THREE.CylinderGeometry(0.06, 0.08, 0.5, 8), mats.trim).position.y = 0.25;
    const bowl = add(dish, new THREE.SphereGeometry(0.55, 16, 8, 0, 6.283, 0, 1.2), mats.trim); bowl.position.set(0, 0.62, 0); bowl.rotation.x = -0.8; bowl.material = mats.trim;
    add(dish, new THREE.SphereGeometry(0.09, 8, 8), mats.glowB, false).position.set(0, 0.95, 0.35);
    anim.push((t) => { dish.rotation.y = t * 2.2; });
  } else if (acc === 3) { // holograma
    const holo = new THREE.Group(); holo.position.y = topY + 1.5; still.add(holo);
    const wire = new THREE.MeshBasicMaterial({ color: mats.base.clone(), wireframe: true, transparent: true, opacity: 0.85, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false });
    const ico = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 1), wire); holo.add(ico);
    const orb = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.025, 6, 40), wire); orb.rotation.x = 1.2; holo.add(orb);
    const base = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.5, 24, 1, true), new THREE.MeshBasicMaterial({ color: mats.base.clone().multiplyScalar(0.4), transparent: true, opacity: 0.25, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    base.position.y = -1.0; base.rotation.x = Math.PI; holo.add(base);
    anim.push((t) => { ico.rotation.y = t * 1.4; ico.rotation.x = t * 0.7; orb.rotation.z = t * 1.6; holo.position.y = topY + 1.5 + Math.sin(t * 2) * 0.12; wire.opacity = 0.65 + Math.sin(t * 9) * 0.15; });
  } else if (acc === 4) { // coroa
    const gold = new THREE.MeshStandardMaterial({ color: 0xffc82e, metalness: 0.9, roughness: 0.25, emissive: 0x6a4a00, emissiveIntensity: 0.5 });
    const crown = new THREE.Group(); crown.position.y = topY - 0.12; still.add(crown);
    add(crown, new THREE.CylinderGeometry(0.62, 0.52, 0.34, 20, 1, true), gold).material.side = THREE.DoubleSide;
    const spikes = [], gems = [];
    for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.283; spikes.push(part(new THREE.ConeGeometry(0.13, 0.5, 6), 0xffffff, { p: [Math.cos(a) * 0.58, 0.4, Math.sin(a) * 0.58] })); gems.push(part(SPH, 0xffffff, { p: [Math.cos(a) * 0.58, 0.7, Math.sin(a) * 0.58], s: [0.07, 0.07, 0.07] })); }
    add(crown, merge(spikes), gold); add(crown, merge(gems), mats.glowA, false);
    anim.push((t) => { crown.rotation.y = t * 0.6; });
  } else if (acc === 5) { // capelo de formatura (o mesmo da capivara)
    const cap = add(still, capyHat(2), mats.vcol); cap.scale.setScalar(3.4); cap.position.y = topY + 0.25 - 0.63 * 3.4; cap.position.z = -0.2 - 0.2 * 3.4;
  } else if (acc === 6) { // bandeira UniFEOB
    const fl = new THREE.Group(); fl.position.set(0, topY - 0.1, -0.4); still.add(fl);
    add(fl, new THREE.CylinderGeometry(0.04, 0.05, 2.4, 8), mats.trim).position.y = 1.2;
    const cloth = new THREE.Group(); cloth.position.set(0, 2.05, 0); fl.add(cloth);
    const clothM = new THREE.MeshStandardMaterial({ color: 0x1a22ff, roughness: 0.7, side: THREE.DoubleSide, emissive: 0x1a22ff, emissiveIntensity: 0.25 });
    add(cloth, new THREE.PlaneGeometry(1.5, 0.9), clothM, false).position.x = 0.75;
    add(cloth, new THREE.PlaneGeometry(1.5, 0.16), new THREE.MeshBasicMaterial({ color: 0xffc82e, side: THREE.DoubleSide }), false).position.set(0.75, 0, 0.01);
    add(fl, new THREE.SphereGeometry(0.1, 8, 8), mats.glowA, false).position.y = 2.45;
    anim.push((t) => { cloth.rotation.y = Math.sin(t * 3) * 0.25; cloth.scale.x = 0.92 + Math.sin(t * 6) * 0.06; fl.rotation.z = Math.sin(t * 1.7) * 0.03; });
  } else { // laranja (a capivara sabe)
    const o = add(still, capyHat(1), mats.vcol); o.scale.setScalar(3.4); o.position.y = topY + 0.1 - 0.6 * 3.4; o.position.z = -0.2 * 3.4;
    anim.push((t) => { o.rotation.z = Math.sin(t * 2.1) * 0.05; });
  }

  // luzes alternando
  const lightAnim = (t, boost = 0) => {
    const k = 0.5 + 0.5 * Math.sin(t * 8), s = 1.1 + boost * 0.7;
    mats.glowA.color.copy(mats.base).multiplyScalar((0.45 + k * 0.9) * s * 0.7);
    mats.glowB.color.copy(mats.base).multiplyScalar((0.45 + (1 - k) * 0.9) * s * 0.7);
  };
  root.traverse((o) => { if (o.isMesh && o.material !== mats.glass) o.receiveShadow = false; });
  return { root, spin, still, mats, anim, lightAnim, rimR, underY: -0.95 };
}
