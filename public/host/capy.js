import * as THREE from 'three';
import { CFG } from './config.js';
import { capyGeos, capyHat, CAPY_HEAD_PIVOT, CAPY_LEGS } from './models.js';
import { canvasTex } from './fx.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const mats = {
  normal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 }),
  gold: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.6, emissive: 0xffa800, emissiveIntensity: 0.35, envMapIntensity: 1.4 }),
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

class Capy {
  constructor(scene, world, fx) {
    this.world = world; this.fx = fx; this.scene = scene;
    this.golden = Math.random() < CFG.goldenChance;
    const pal = this.golden ? 3 : (Math.random() * 3) | 0;
    const geo = capyGeos(pal);
    this.hatKind = this.golden ? 0 : [0, 0, 0, 1, 2][(Math.random() * 5) | 0];
    this.size = (this.golden ? 1.15 : rnd(0.9, 1.12)) * 1.4;
    this.root = new THREE.Group(); this.rig = new THREE.Group(); this.root.add(this.rig);
    const mat = this.golden ? mats.gold : mats.normal;
    const mk = (g, m = mat) => { const o = new THREE.Mesh(g, m); o.castShadow = true; return o; };
    this.rig.add(mk(geo.body));
    this.head = mk(geo.head); this.head.position.set(...CAPY_HEAD_PIVOT); this.rig.add(this.head);
    if (this.hatKind) { const h = mk(capyHat(this.hatKind), mats.hat); h.castShadow = false; this.head.add(h); }
    this.legs = CAPY_LEGS.map((p) => { const l = mk(geo.leg); l.castShadow = false; l.position.set(...p); this.rig.add(l); return l; });
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
    this.vy = 0; this.state = initial ? 'idle' : 'spawn'; this.t = initial ? rnd(0, 3) : 0; this.target = null; this.grabT = 0; this.beamHeld = 0;
    this.root.visible = this.blob.visible = true; this.root.scale.setScalar(initial ? this.size : 0.001);
    if (!initial) this.fx.burst(this.x, 0.6, this.z, 0xfff1c0, 14, 4, false);
  }
  dispose() {
    this.scene.remove(this.root, this.blob);
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
      if (this.idleFor == null) this.idleFor = rnd(1.5, 5);
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

    let swing = 0, bob = 0, headX = 0, headY = 0, roll = 0, pitch = 0, headS = 1, flail = 0;
    if (sp > 0.1) { this.phase += dt * (sp > 4 ? 15 : 7); swing = (sp > 4 ? 0.95 : 0.5) * Math.sin(this.phase); bob = Math.abs(Math.sin(this.phase)) * (sp > 4 ? 0.14 : 0.05); roll = Math.sin(this.phase) * 0.05; headX = Math.sin(this.phase * 2) * 0.06; pitch = sp > 4 ? 0.1 : 0; }
    if (s === 'idle') { // respira, olha em volta, pasta de vez em quando
      const graze = Math.sin(T * 0.35) > 0.55 ? 0.55 : 0;
      headX = graze + Math.sin(T * 1.4) * 0.03; headY = Math.sin(T * 0.6) * 0.45; bob = Math.sin(T * 1.8) * 0.012;
    }
    if (s === 'look' || s === 'flee') { headX = s === 'look' ? -0.45 : -0.1; headS = 1.12; }
    if (s === 'abducted') { flail = 1; headX = -0.55; headS = 1.2; roll = Math.sin(T * 9) * 0.25; pitch = Math.sin(T * 6) * 0.2; }
    if (s === 'fall') { flail = 1; headS = 1.15; pitch = -0.2; }
    this.mark.visible = s === 'look' || s === 'abducted' || s === 'fall' || (s === 'flee' && this.fleeT < 1.2);
    if (this.mark.visible) { this.mark.position.y = 2.6 + Math.sin(T * 14) * 0.06; this.mark.material.rotation = 0; }
    const sq = this.squash * Math.sin(this.squash * 9) * 0.25;
    this.rig.position.y = bob; this.rig.rotation.set(pitch, 0, roll); this.rig.scale.set(1 + sq, 1 - sq, 1 + sq);
    this.head.rotation.set(headX, headY, 0); this.head.scale.setScalar(headS);
    const l = this.legs;
    if (flail) { const f = Math.sin(T * 22) * 0.9; l[0].rotation.x = f; l[3].rotation.x = f; l[1].rotation.x = -f; l[2].rotation.x = -f; }
    else { l[0].rotation.x = l[3].rotation.x = swing; l[1].rotation.x = l[2].rotation.x = -swing; }
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
