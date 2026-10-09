import * as THREE from 'three';
import { CFG } from './config.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { capyHat } from './models.js';
import { canvasTex } from './fx.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- capivara: malha FBX (sem rig) + esqueleto procedural, pesos por região e pelagem pintada no vértice ----
// frente = +Z, base no chão, ~2.5 de comprimento. Ossos (espaço do modelo): 0 raiz · 1 corpo · 2 cabeça · 3..6 patas FE FD TE TD
const P_BODY = [0, 0.75, -0.3], P_HEAD = [0, 1.02, 0.42], P_LEGS = [[0.19, 0.5, 0.14], [-0.19, 0.5, 0.14], [0.2, 0.56, -0.82], [-0.2, 0.56, -0.82]];
let capyGeo;
export async function loadCapy() {
  const o = await new FBXLoader().loadAsync('/assets/lowpo+carpincho.FBX', (e) => e.total && window.__progress?.(0.7 + 0.2 * (e.loaded / e.total), 'CARREGANDO CAPIVARAS…'));
  o.updateMatrixWorld(true);
  const src = o.getObjectByProperty('isMesh', true);
  const g = src.geometry.clone().applyMatrix4(src.matrixWorld); // aplica o Z-up→Y-up do loader
  g.deleteAttribute('uv'); g.rotateY(Math.PI / 2).scale(0.55, 0.55, 0.55);
  g.computeBoundingBox(); const b = g.boundingBox;
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  // olhos: raio lateral acha a superfície da cabeça; esfera preta + brilho branco, mesclados na mesma malha (1 draw)
  const hit = (sx) => new THREE.Raycaster(new THREE.Vector3(sx, 1.3, 0.92), new THREE.Vector3(-sx, 0, 0)).intersectObject(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })))[0]?.point;
  const parts = [g];
  for (const sx of [1, -1]) {
    const e = hit(sx); if (!e) continue;
    const ball = new THREE.SphereGeometry(0.062, 8, 6).toNonIndexed().translate(e.x - sx * 0.02, e.y, e.z); ball.deleteAttribute('uv'); ball.userData.c = [0.035, 0.035, 0.035];
    const shine = new THREE.SphereGeometry(0.02, 5, 4).toNonIndexed().translate(e.x + sx * 0.025, e.y + 0.025, e.z + 0.025); shine.deleteAttribute('uv'); shine.userData.c = [2.6, 6.5, 22]; // cancela o tom da pelagem → brilho quase branco
    parts.push(ball, shine);
  }
  for (const q of parts.slice(1)) { const n = q.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set(q.userData.c, i * 3); q.setAttribute('color', new THREE.BufferAttribute(a, 3)); }
  paintFur(g);
  capyGeo = mergeGeometries(parts);
  rigWeights(capyGeo);
  capyGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), 1.9); // fixa: evita recalcular com skinning
}
function paintFur(g) { // multiplica a cor do material: dorso escuro, barriga creme, focinho e patas escuros, orelhas escuras
  const p = g.attributes.position, n = g.attributes.normal, col = new Float32Array(p.count * 3), c = new THREE.Color();
  const BELLY = new THREE.Color(1.22, 1.12, 0.92), BACK = new THREE.Color(0.86, 0.82, 0.8), DARK = new THREE.Color(0.32, 0.26, 0.24);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ny = n.getY(i);
    c.setRGB(1, 1, 1);
    c.lerp(BELLY, smooth(-0.1, -0.6, ny) * smooth(0.95, 0.6, y));
    c.lerp(BACK, smooth(0.4, 0.85, ny) * smooth(1.0, 1.3, y));
    c.lerp(DARK, Math.max(smooth(1.06, 1.24, z) * 0.85, smooth(0.16, 0.03, y) * 0.7, smooth(1.43, 1.5, y) * 0.75));
    const h = Math.sin(x * 37.1 + z * 19.7 + y * 11.3) * 43758.5; c.multiplyScalar(0.94 + 0.12 * (h - Math.floor(h))); // leve variação por vértice: pelagem menos “plástica”
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}
function rigWeights(g) {
  const p = g.attributes.position, si = new Uint16Array(p.count * 4), sw = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const head = smooth(0.28, 0.62, z), leg = smooth(0.62, 0.3, y) * (1 - head), lb = 3 + (z > -0.35 ? 0 : 2) + (x > 0 ? 0 : 1);
    si.set([1, 2, lb, 0], i * 4); sw.set([1 - head - leg, head, leg, 0], i * 4);
  }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
}
function makeSkinned(mat) {
  const mesh = new THREE.SkinnedMesh(capyGeo, mat), root = new THREE.Bone(), body = new THREE.Bone(), head = new THREE.Bone();
  body.position.set(...P_BODY); head.position.set(P_HEAD[0] - P_BODY[0], P_HEAD[1] - P_BODY[1], P_HEAD[2] - P_BODY[2]);
  const legs = P_LEGS.map((q) => { const l = new THREE.Bone(); l.position.set(q[0] - P_BODY[0], q[1] - P_BODY[1], q[2] - P_BODY[2]); body.add(l); return l; });
  root.add(body); body.add(head); mesh.add(root); mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([root, body, head, ...legs])); mesh.boundingSphere = capyGeo.boundingSphere.clone();
  mesh.castShadow = true;
  return { mesh, body, head, legs };
}
const FUR = [0xab8258, 0xba9264, 0x977455].map((color) => new THREE.MeshStandardMaterial({ color, vertexColors: true, roughness: 0.9, metalness: 0 }));

const mats = {
  gold: new THREE.MeshStandardMaterial({ color: 0xffcf3a, vertexColors: true, roughness: 0.35, metalness: 0.6, emissive: 0xffa800, emissiveIntensity: 0.14, envMapIntensity: 1.2 }),
  hat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
  blob: new THREE.MeshBasicMaterial({
    map: canvasTex(64, (g, s) => { const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2); r.addColorStop(0, 'rgba(0,0,0,.55)'); r.addColorStop(0.6, 'rgba(0,0,0,.25)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, s, s); }),
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  }),
  mark: new THREE.SpriteMaterial({
    map: canvasTex(64, (g, s) => { g.fillStyle = '#ff5a1f'; g.beginPath(); g.arc(s / 2, s / 2, s * 0.44, 0, 7); g.fill(); g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke(); g.fillStyle = '#fff'; g.font = '900 44px Impact, Arial Black, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', s / 2, s / 2 + 3); }),
    depthTest: false, transparent: true,
  }),
};
const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const HATS = {}; // geometria do chapéu compartilhada por tipo (antes: uma nova por capivara, nunca liberada)

class Capy {
  constructor(scene, world, fx) {
    this.world = world; this.fx = fx; this.scene = scene;
    this.golden = Math.random() < CFG.goldenChance;
    const pal = this.golden ? 3 : (Math.random() * 3) | 0;
    this.hatKind = this.golden ? 0 : [0, 0, 0, 1, 2][(Math.random() * 5) | 0];
    this.size = (this.golden ? 1.15 : rnd(0.9, 1.12)) * 1.4;
    this.root = new THREE.Group(); this.rig = new THREE.Group(); this.root.add(this.rig);
    const mat = this.golden ? mats.gold : FUR[pal];
    const sk = makeSkinned(mat); this.rig.add(sk.mesh); this.skeleton = sk.mesh.skeleton; this.body = sk.body; this.head = sk.head; this.legs = sk.legs;
    if (this.hatKind) { const h = new THREE.Mesh(HATS[this.hatKind] ||= capyHat(this.hatKind), mats.hat); h.position.set(0, -0.13, 0.12); this.head.add(h); } // chapéu acompanha a cabeça
    this.pose = { walk: 0, run: 0, graze: 0, sit: 0, lie: 0, alert: 0, flail: 0, dizzy: 0 }; this.idleMode = 'stand';
    this.mark = new THREE.Sprite(mats.mark); this.mark.scale.setScalar(0.9); this.mark.position.set(0, 2.5, 0.6); this.mark.visible = false; this.root.add(this.mark);
    this.blob = new THREE.Mesh(blobGeo, mats.blob); this.blob.renderOrder = 2;
    this.root.scale.setScalar(this.size);
    scene.add(this.root, this.blob);
    this.skit = Math.random() < 0.15 ? 0.15 : rnd(0.5, 1);
    this.seed = Math.random() * 100; this.phase = 0; this.squash = 0;
    this.respawn(true);
  }
  respawn(initial, ufos) {
    const p = this.world.randomSpot(ufos && !initial ? ufos.map((u) => u.pos) : null, initial ? 0 : 40);
    this.x = this.px = p.x; this.z = this.pz = p.z; this.y = this.py = 0; this.yaw = this.pyaw = rnd(-3.14, 3.14);
    for (const k in this.pose) this.pose[k] = 0; this.idleMode = 'stand'; this.idleFor = null;
    this.vy = 0; this.state = initial ? 'idle' : 'spawn'; this.t = initial ? rnd(0, 3) : 0; this.target = null; this.grabT = 0; this.beamHeld = 0;
    this.root.visible = this.blob.visible = true; this.root.scale.setScalar(initial ? this.size : 0.001);
    if (!initial) this.fx.burst(this.x, 0.6, this.z, 0xfff1c0, 14, 4, false);
  }
  dispose() {
    this.scene.remove(this.root, this.blob);
    this.skeleton.dispose(); // libera a textura de ossos na GPU
  }

  // passo fixo (60Hz)
  step(dt, ufos, cb) {
    this.px = this.x; this.pz = this.z; this.py = this.y; this.pyaw = this.yaw;
    this.t += dt; this.moveSpeed = 0;
    const s = this.state;
    if (s === 'gone') { if (this.t > this.goneFor) this.respawn(false, ufos); return; }
    if (s === 'spawn') { if (this.t > 0.5) { this.state = 'idle'; this.t = 0; } return; }

    if (s === 'abducted') return this.stepAbducted(dt, cb);
    if (s === 'fall') {
      this.vy -= 22 * dt; this.y += this.vy * dt;
      if (this.y <= 0) { this.y = 0; this.vy = 0; this.state = 'stun'; this.t = 0; this.squash = 1; this.fx.burst(this.x, 0.2, this.z, 0xcaa070, 8, 3, false); }
      return;
    }
    if (s === 'stun') { if (this.t > 0.9) { this.state = 'flee'; this.t = 0; this.fleeT = 0; } return; }

    // UFO mais próximo (ameaça) e qualquer raio que me alcance
    let ufo = null, d = 1e9, beamOn = false;
    for (const u of ufos) {
      const du = Math.hypot(this.x - u.pos.x, this.z - u.pos.z);
      if (du < d) { d = du; ufo = u; }
      if (u.beamOn && du < u.radiusAt(this.y)) { this.owner = u; this.state = 'abducted'; this.grabT = 0; this.beamHeld = u.beamHeld; cb.onGrab?.(this); return; }
    }
    if (!ufo) return;
    beamOn = ufo.beamOn;
    const threat = beamOn ? d < 7 + this.skit * 14 : d < 3 + this.skit * 5;
    if (s !== 'flee' && s !== 'look' && threat && this.skit > 0.2) { this.state = 'look'; this.t = 0; this.react = rnd(0.25, 0.6); cb.onStartle?.(this); return; }
    if (s === 'look') {
      this.faceTo(Math.atan2(ufo.pos.x - this.x, ufo.pos.z - this.z), dt, 8);
      if (this.t > this.react) { this.state = threat ? 'flee' : 'idle'; this.t = 0; this.fleeT = 0; this.fleeA = rnd(-0.6, 0.6); }
      return;
    }
    if (s === 'flee') {
      this.fleeT += dt;
      let a = Math.atan2(this.x - ufo.pos.x, this.z - ufo.pos.z) + this.fleeA + Math.sin(this.t * 3 + this.seed) * 0.25;
      // evita obstáculos: tenta girar
      for (let k = 0; k < 6 && this.world.isBlocked(this.x + Math.sin(a) * 2.2, this.z + Math.cos(a) * 2.2, 0.8); k++) a += (k % 2 ? 1 : -1) * 0.55 * (k + 1);
      this.faceTo(a, dt, 10); this.moveForward(dt, 6.6 * (0.9 + this.skit * 0.15));
      if (d > 28 || this.fleeT > 5) { this.state = 'idle'; this.t = 0; }
      return;
    }
    if (s === 'idle') {
      if (this.idleFor == null) { // pasta, fica parada, senta ou deita (descansos mais longos)
        const r = Math.random();
        [this.idleMode, this.idleFor] = r < 0.45 ? ['graze', rnd(2.5, 6)] : r < 0.7 ? ['stand', rnd(1.5, 4)] : r < 0.88 ? ['sit', rnd(5, 10)] : ['lie', rnd(7, 14)];
      }
      if (this.t > this.idleFor) { this.idleFor = null; this.pickTarget(); }
      return;
    }
    if (s === 'walk') {
      const dx = this.target.x - this.x, dz = this.target.z - this.z;
      if (Math.hypot(dx, dz) < 1.2 || this.t > 14) { this.state = 'idle'; this.t = 0; this.idleFor = null; return; }
      if (this.world.isBlocked(this.x + Math.sin(this.yaw) * 1.8, this.z + Math.cos(this.yaw) * 1.8, 0.8)) { this.pickTarget(); return; }
      this.faceTo(Math.atan2(dx, dz), dt, 3); this.moveForward(dt, 1.7);
    }
  }
  pickTarget() {
    for (let i = 0; i < 8; i++) {
      const a = rnd(0, 6.283), r = rnd(6, 24), x = this.x + Math.sin(a) * r, z = this.z + Math.cos(a) * r;
      if (!this.world.isBlocked(x, z, 1) && Math.abs(x) < 370 && Math.abs(z) < 205) { this.target = { x, z }; this.state = 'walk'; this.t = 0; return; }
    }
    this.t = 0; this.idleFor = 1;
  }
  faceTo(a, dt, rate) { this.yaw += wrap(a - this.yaw) * (1 - Math.exp(-rate * dt)); }
  moveForward(dt, sp) {
    const nx = this.x + Math.sin(this.yaw) * sp * dt, nz = this.z + Math.cos(this.yaw) * sp * dt;
    if (!this.world.isBlocked(nx, nz, 0.7)) { this.x = nx; this.z = nz; }
    this.moveSpeed = sp;
  }
  stepAbducted(dt, cb) {
    const ufo = this.owner; this.grabT += dt; this.moveSpeed = 0;
    const ux = ufo.pos.x, uz = ufo.pos.z;
    const out = Math.hypot(this.x - ux, this.z - uz) > ufo.radiusAt(this.y) + 1.6;
    if (!ufo.beamOn || !ufo.active || out) { this.state = 'fall'; this.vy = 2; this.t = 0; cb.onDrop?.(this); return; }
    const vy = this.grabT < 0.45 ? 1.7 : 1.7 + (this.grabT - 0.45) * 12;
    this.y += vy * dt;
    const k = Math.min(1, 2.6 * dt);
    this.x += (ux - this.x) * k; this.z += (uz - this.z) * k;
    this.yaw += dt * (2 + this.grabT * 5);
    if (this.y >= ufo.pos.y - 1.5) {
      this.state = 'gone'; this.t = 0; this.goneFor = rnd(1.8, 3.5); this.root.visible = this.blob.visible = false; this.mark.visible = false;
      cb.onCapture?.(this, ufo);
    }
  }

  // render: interpolação + animação procedural
  render(alpha, dt, t, foci) {
    if (this.state === 'gone') return;
    if (foci) { let near = false; for (const f of foci) if ((f.x - this.x) ** 2 + (f.z - this.z) ** 2 < 150 * 150) { near = true; break; } if (!near) { this.root.visible = this.blob.visible = false; return; } this.root.visible = this.blob.visible = true; }
    const x = this.px + (this.x - this.px) * alpha, z = this.pz + (this.z - this.pz) * alpha, y = this.py + (this.y - this.py) * alpha;
    const yaw = this.pyaw + wrap(this.yaw - this.pyaw) * alpha;
    this.root.position.set(x, y, z); this.root.rotation.y = yaw;
    const s = this.state, sp = this.moveSpeed || 0, T = t + this.seed;
    let sc = this.size;
    if (s === 'spawn') sc *= Math.min(1, this.t / 0.5) * (1 + Math.sin(Math.min(1, this.t / 0.5) * 3.14) * 0.25);
    if (s === 'abducted') sc *= 1 - 0.45 * smooth(2, 10, y);
    this.root.scale.setScalar(Math.max(0.001, sc));
    this.squash = Math.max(0, this.squash - dt * 2.5);

    // poses mescladas: cada peso persegue seu alvo suavemente → transições sem estalo entre estados
    const P = this.pose, idle = s === 'idle' || s === 'spawn' || s === 'gone';
    const tgt = {
      walk: s === 'walk' ? 1 : 0, run: s === 'flee' ? 1 : 0, alert: s === 'look' ? 1 : 0, flail: s === 'abducted' || s === 'fall' ? 1 : 0, dizzy: s === 'stun' ? 1 : 0,
      graze: idle && this.idleMode === 'graze' && Math.sin(T * 0.9) > -0.6 ? 1 : 0, sit: idle && this.idleMode === 'sit' ? 1 : 0, lie: idle && this.idleMode === 'lie' ? 1 : 0,
    };
    for (const k in P) P[k] += (tgt[k] - P[k]) * (1 - Math.exp(-(k === 'sit' || k === 'lie' ? 3.5 : 9) * dt));
    // marcha: fase pela velocidade real (pé não escorrega): ω = vπ / (2·L·sen a)
    const amp = 0.42 + 0.43 * P.run, L = 0.5 * this.size;
    if (sp > 0.1) this.phase += dt * Math.min(24, (sp * Math.PI) / (2 * L * Math.sin(amp)));
    const ph = this.phase, wk = P.walk * (1 - P.run), rn = P.run;
    const gait = (i) => wk * 0.42 * Math.sin(ph + (i === 0 || i === 3 ? 0 : Math.PI)) + rn * 0.85 * Math.sin(ph + (i < 2 ? 0 : Math.PI) + (i % 2) * 0.45);
    const fl = P.flail, flailA = (i) => fl * 0.9 * Math.sin(T * 23 + i * 1.7);
    const sit = P.sit, lie = P.lie;
    const legs = this.legs;
    for (let i = 0; i < 4; i++) {
      const front = i < 2;
      legs[i].rotation.x = gait(i) + flailA(i) + sit * (front ? 0.38 : -1.25) + lie * (front ? -1.35 : 1.3);
      legs[i].rotation.z = fl * (i % 2 ? -0.35 : 0.35);
    }
    const bounce = Math.abs(Math.sin(ph)), breathe = Math.sin(T * 1.8) * 0.012 * (1 - wk - rn);
    const b = this.body;
    b.position.y = P_BODY[1] + wk * bounce * 0.05 + rn * bounce * 0.16 + breathe - sit * 0.12 - lie * 0.36 + P.alert * 0.04;
    b.rotation.x = rn * Math.sin(ph + 1.57) * 0.13 - sit * 0.38 - P.alert * 0.06;
    b.rotation.z = wk * Math.sin(ph) * 0.05 + fl * Math.sin(T * 9) * 0.25;
    b.scale.y = 1 + breathe;
    const chew = P.graze * Math.sin(T * 11) * 0.04, look = Math.sin(T * 0.6) * 0.5 * (1 - P.graze) * (1 - wk - rn) * (1 - fl);
    const h = this.head;
    h.rotation.x = P.graze * 0.72 + chew + wk * Math.sin(ph * 2) * 0.06 - rn * 0.12 - P.alert * 0.45 - fl * 0.5 + sit * 0.34 + lie * (0.12 + Math.max(0, Math.sin(T * 0.4)) * 0.18);
    h.rotation.y = look * (1 - P.alert) + P.dizzy * Math.sin(T * 7) * 0.35;
    h.rotation.z = P.dizzy * Math.sin(T * 10) * 0.22 + fl * Math.sin(T * 13) * 0.2;
    h.scale.setScalar(1 + P.alert * 0.06 + fl * 0.12);
    this.mark.visible = s === 'look' || s === 'abducted' || s === 'fall' || (s === 'flee' && this.fleeT < 1.2);
    if (this.mark.visible) this.mark.position.y = 2.6 + Math.sin(T * 14) * 0.06;
    const sq = this.squash * Math.sin(this.squash * 9) * 0.25;
    this.rig.position.y = 0; this.rig.rotation.set(s === 'abducted' ? Math.sin(T * 6) * 0.2 : 0, 0, 0); this.rig.scale.set(1 + sq, 1 - sq, 1 + sq);
    // sombra falsa no chão
    const hh = Math.max(0, 1 - y * 0.05);
    this.blob.position.set(x, 0.06, z); this.blob.scale.set(2.6 * this.size * hh, 1, 3.4 * this.size * hh);
    this.blob.rotation.y = yaw; this.blob.material.opacity = 1;
    if (this.golden && Math.random() < dt * 14) this.fx.stars.emit(x + rnd(-1, 1), y + rnd(0.3, 1.8), z + rnd(-1, 1), 0, 0.8, 0, 1, 0.85, 0.3, 0.55, 1, { drag: 0.5 });
  }
}

export class Capys {
  constructor(scene, world, fx) { this.scene = scene; this.world = world; this.fx = fx; this.list = []; this.cb = {}; }
  setCount(n) {
    while (this.list.length < n) this.list.push(new Capy(this.scene, this.world, this.fx));
    while (this.list.length > n) this.list.pop().dispose();
  }
  step(dt, ufos) { if (ufos.length) for (const c of this.list) c.step(dt, ufos, this.cb); }
  render(alpha, dt, t, foci) { for (const c of this.list) c.render(alpha, dt, t, foci); }
  get alive() { return this.list.filter((c) => c.state !== 'gone' && c.state !== 'spawn').length; }
  // para a IA do modo demonstração: capivara livre mais próxima
  nearest(x, z, maxD = 1e9, ok = () => true) {
    let best = null, bd = maxD;
    for (const c of this.list) {
      if (c.state === 'gone' || c.state === 'spawn' || c.state === 'abducted' || c.state === 'fall' || !ok(c)) continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
}
