import * as THREE from 'three';
import { CFG } from './config.js';
import { canvasTex } from './fx.js';
import { buildUfo, ufoPalette } from './models.js';

const BEAM_V = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){ vUv=uv; vec4 mv=modelViewMatrix*vec4(position,1.); vN=normalize(normalMatrix*normal); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`;
const BEAM_F = /* glsl */ `
uniform float uTime, uAlpha, uCore; uniform vec3 uColor;
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){
  float h=vUv.y;
  float facing=abs(dot(normalize(vN),normalize(vV)));
  float edge=pow(1.-facing,1.6);
  float bands=.55+.45*sin(h*34.-uTime*8.);
  float streak=.62+.38*sin(vUv.x*6.2831*9.+uTime*1.6+h*5.);
  float sparkle=smoothstep(.93,1.,sin(vUv.x*80.+h*40.-uTime*5.)*sin(vUv.x*37.+uTime*3.));
  float a=(.16+.5*edge+.3*facing*uCore)*(.3+.7*h)*(bands*.4+.6)*streak+sparkle*.2*h;
  vec3 c=mix(uColor,vec3(1.),.25+.55*h*uCore+edge*.2);
  gl_FragColor=vec4(c*(1.2+h*.8),a*uAlpha);
}`;
const GROUND_F = /* glsl */ `
uniform float uTime, uAlpha; uniform vec3 uColor; varying vec2 vUv;
void main(){
  vec2 p=vUv*2.-1.; float r=length(p); float an=atan(p.y,p.x);
  float ring=smoothstep(.05,0.,abs(r-.93));
  float dash=.55+.45*step(.5,fract(an*2.+uTime*.9));
  float ring2=smoothstep(.04,0.,abs(r-.62))*.45*(.5+.5*sin(an*6.-uTime*3.));
  float glow=smoothstep(1.,0.,r)*.5;
  float a=(glow+ring*dash+ring2)*step(r,1.)*uAlpha;
  gl_FragColor=vec4(mix(uColor,vec3(1.),.35)*(1.4),a);
}`;
const BEAM_BASE = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false };

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dispose = (o) => o.traverse((c) => { if (c.isMesh) { c.geometry.dispose(); [].concat(c.material).forEach((m) => m.dispose()); } });

export class Ufo {
  constructor(scene, fx) {
    this.scene = scene; this.fx = fx;
    this.pos = new THREE.Vector3(0, CFG.ufoAlt, 0); this.prev = this.pos.clone();
    this.vel = new THREE.Vector3(); this.accel = new THREE.Vector3(); this.yaw = Math.PI; this.prevYaw = this.yaw;
    this.tiltX = 0; this.tiltZ = 0; this.turboT = 0; this.turboCd = 0; this.beamOn = false; this.beamK = 0; this.t = 0;
    this.beamHeld = 0;
    // render state (interpolado)
    this.rpos = this.pos.clone(); this.ryaw = this.yaw;
    this.group = new THREE.Group(); this.group.scale.setScalar(1.25); scene.add(this.group);

    // raio de abdução
    const R = 1;
    this.bu = { uTime: { value: 0 }, uAlpha: { value: 0 }, uCore: { value: 0 }, uColor: { value: new THREE.Color() } };
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.2, R, 1, 40, 1, true).translate(0, -0.5, 0), new THREE.ShaderMaterial({ ...BEAM_BASE, uniforms: this.bu, vertexShader: BEAM_V, fragmentShader: BEAM_F }));
    this.beam.frustumCulled = false; this.beam.renderOrder = 6;
    this.core = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.34, 1, 24, 1, true).translate(0, -0.5, 0), new THREE.ShaderMaterial({ ...BEAM_BASE, uniforms: { ...this.bu, uCore: { value: 1 } }, vertexShader: BEAM_V, fragmentShader: BEAM_F }));
    this.core.frustumCulled = false; this.core.renderOrder = 7;
    this.gu = { uTime: this.bu.uTime, uAlpha: { value: 0 }, uColor: this.bu.uColor };
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ ...BEAM_BASE, uniforms: this.gu, vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }', fragmentShader: GROUND_F }));
    this.ground.renderOrder = 4; this.ground.frustumCulled = false;
    scene.add(this.beam, this.core, this.ground);
    this.light = new THREE.PointLight(0x2ef2ff, 0, 60, 2); scene.add(this.light);
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, transparent: true, toneMapped: false })); this.tag.renderOrder = 20; this.tag.visible = false; scene.add(this.tag);
    this.cfg = null; this.model = null; this.active = false; this.setActive(false);
  }
  setActive(b) {
    this.active = b; this.group.visible = b; this.beamOn = false; this.beamK = 0;
    if (!b) { this.beam.visible = this.core.visible = this.ground.visible = false; this.light.intensity = 0; this.name = ''; this.tag.visible = false; }
  }

  // plaquinha com o nome flutuando sobre o OVNI (visível só para os outros pilotos)
  setName(name) {
    this.name = name || '';
    this.tag.material.map?.dispose();
    if (!this.name) { this.tag.material.map = null; return; }
    const t = canvasTex(256, (g, s) => {
      g.font = '900 54px Impact, "Arial Black", sans-serif'; const w = Math.min(s - 16, g.measureText(this.name).width + 44);
      g.fillStyle = 'rgba(8,10,24,.72)'; g.beginPath(); g.roundRect((s - w) / 2, 84, w, 84, 42); g.fill();
      g.lineWidth = 5; g.strokeStyle = '#' + this.pal.light.toString(16).padStart(6, '0'); g.stroke();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(this.name, s / 2, 128, s - 50);
    });
    this.tag.material.map = t; this.tag.material.needsUpdate = true; this.tag.scale.set(9, 9, 1);
  }

  setCfg(cfg) {
    if (this.model) { this.group.remove(this.model.root); dispose(this.model.root); }
    this.cfg = { ...cfg };
    this.model = buildUfo(cfg);
    this.group.add(this.model.root);
    const p = ufoPalette(cfg);
    this.bu.uColor.value.set(p.beam); this.light.color.set(p.beam);
    this.pal = p;
    if (this.active) { this.fx.ring(this.rpos.x, this.rpos.y - 1, this.rpos.z, p.light, 8, 0.8); this.fx.burst(this.rpos.x, this.rpos.y, this.rpos.z, p.light, 36, 8); }
  }

  teleport(x, z) { this.pos.set(x, CFG.ufoAlt, z); this.prev.copy(this.pos); this.vel.set(0, 0, 0); }

  // passo fixo: wish = vetor de mundo (x,z) com |wish| ≤ 1
  step(dt, wx, wz, beam, turbo) {
    this.prev.copy(this.pos); this.prevYaw = this.yaw;
    this.beamOn = beam; this.beamHeld = beam ? this.beamHeld + dt : 0;
    if (turbo && this.turboCd <= 0 && this.turboT <= 0) { this.turboT = CFG.turboTime; this.turboCd = CFG.turboCooldown; this.onTurbo?.(); }
    this.turboT = Math.max(0, this.turboT - dt); this.turboCd = Math.max(0, this.turboCd - dt);
    const mag = Math.min(1, Math.hypot(wx, wz));
    const max = CFG.ufoSpeed * (beam ? CFG.beamSlow : 1) * (this.turboT > 0 ? CFG.turboMult : 1);
    const dx = mag > 0.001 ? (wx / mag) * mag * max : 0, dz = mag > 0.001 ? (wz / mag) * mag * max : 0;
    const k = 1 - Math.exp(-(mag > 0.05 ? (this.turboT > 0 ? 4 : 2.3) : 1.35) * dt);
    const ox = this.vel.x, oz = this.vel.z;
    this.vel.x += (dx - this.vel.x) * k; this.vel.z += (dz - this.vel.z) * k;
    this.accel.set((this.vel.x - ox) / dt, 0, (this.vel.z - oz) / dt);
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    if (Math.abs(this.pos.x) > CFG.halfX) { this.pos.x = Math.sign(this.pos.x) * CFG.halfX; this.vel.x *= -0.15; }
    if (Math.abs(this.pos.z) > CFG.halfZ) { this.pos.z = Math.sign(this.pos.z) * CFG.halfZ; this.vel.z *= -0.15; }
    this.collide?.(this.pos, this.vel);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 1.2) this.yaw += wrapAngle(Math.atan2(this.vel.x, this.vel.z) - this.yaw) * (1 - Math.exp(-3.2 * dt));
  }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get turbo() { return this.turboT > 0; }

  // raio no chão (m) para uma altura y
  radiusAt(y) { const f = Math.min(1, Math.max(0, y / (this.pos.y - 0.6))); return CFG.beamRadius * (1 - f) + 0.95 * f; }

  render(alpha, dt, t) {
    if (!this.active) return;
    this.t = t;
    this.rpos.lerpVectors(this.prev, this.pos, alpha);
    this.ryaw = this.prevYaw + wrapAngle(this.yaw - this.prevYaw) * alpha;
    const m = this.model, hov = Math.sin(t * 1.7) * 0.28 + Math.sin(t * 0.9 + 1) * 0.15;
    const y = this.rpos.y + hov;
    this.group.position.set(this.rpos.x + Math.sin(t * 1.1) * 0.08, y, this.rpos.z + Math.cos(t * 0.8) * 0.08);
    // inclinação: frente/trás, laterais, curvas
    const fx = Math.sin(this.ryaw), fz = Math.cos(this.ryaw);
    const f = this.vel.x * fx + this.vel.z * fz, r = this.vel.x * fz - this.vel.z * fx;
    const af = this.accel.x * fx + this.accel.z * fz, ar = this.accel.x * fz - this.accel.z * fx;
    const tx = THREE.MathUtils.clamp(f * 0.011 + af * 0.003, -0.4, 0.4) + Math.sin(t * 1.3) * 0.02;
    const tz = THREE.MathUtils.clamp(-r * 0.02 - ar * 0.004, -0.45, 0.45) + Math.sin(t * 1.1 + 2) * 0.025;
    const kk = 1 - Math.exp(-6 * dt);
    this.tiltX += (tx - this.tiltX) * kk; this.tiltZ += (tz - this.tiltZ) * kk;
    this.group.rotation.set(this.tiltX, this.ryaw, this.tiltZ, 'YXZ');
    m.spin.rotation.y += dt * (1.2 + this.speed * 0.06 + this.beamK * 2.2);
    m.lightAnim(t, this.beamK * 1.2 + (this.turbo ? 1 : 0));
    for (const a of m.anim) a(t, dt);

    // raio
    this.beamK += ((this.beamOn ? 1 : 0) - this.beamK) * (1 - Math.exp(-(this.beamOn ? 7 : 9) * dt));
    if (this.beamK < 0.01) this.beamK = 0;
    const bk = this.beamK;
    this.bu.uTime.value = t; this.bu.uAlpha.value = bk * (0.68 + Math.sin(t * 14) * 0.06);
    const len = Math.max(1, y - 0.7);
    this.beam.visible = this.core.visible = bk > 0;
    this.ground.visible = bk > 0.02;
    const bx = this.group.position.x, bz = this.group.position.z;
    this.beam.position.set(bx, y - 0.7, bz); this.core.position.copy(this.beam.position);
    const rr = CFG.beamRadius * (0.35 + 0.65 * bk);
    this.beam.scale.set(rr, len, rr); this.core.scale.set(rr * 0.95, len, rr * 0.95);
    this.gu.uAlpha.value = bk * 0.7;
    this.ground.position.set(bx, 0.09, bz); this.ground.scale.setScalar(rr * 1.12);
    this.ground.rotation.y = 0;
    this.light.position.set(bx, y - 2.2, bz);
    if (this.pal.rainbow) { this.bu.uColor.value.setHSL((t * 0.2) % 1, 0.9, 0.6); this.light.color.copy(this.bu.uColor.value); }
    this.tag.visible = !!this.name; this.tag.position.set(bx, y + 4.6, bz);
    this.light.intensity = 30 + bk * 170 + (this.turbo ? 60 : 0);

    // efeitos
    this.emitFx(dt, t, bx, y, bz, len, bk);
  }

  emitFx(dt, t, bx, y, bz, len, bk) {
    const fx = this.fx, c = this.pal.lightColor, e = this.cfg.e ?? 0, sp = this.speed, rimR = this.model.rimR;
    const n = (rate) => { const v = rate * dt; return Math.floor(v) + (Math.random() < v % 1 ? 1 : 0); };
    const vx = this.vel.x, vz = this.vel.z;
    const rim = () => { const a = Math.random() * 6.283; return [bx + Math.cos(a) * rimR * 0.85, y - 0.6, bz + Math.sin(a) * rimR * 0.85, a]; };
    if (e === 0) for (let i = n(9 + sp * 0.7); i--;) { const [x, yy, z, a] = rim(); fx.glow.emit(x, yy, z, -vx * 0.15 + Math.cos(a) * 0.8, -1.2 - Math.random(), -vz * 0.15 + Math.sin(a) * 0.8, c.r * 1.6, c.g * 1.6, c.b * 1.6, 0.35 + Math.random() * 0.3, 1.1, { drag: 0.6 }); }
    else if (e === 1) for (let i = n(4 + sp * 0.4); i--;) { const [x, yy, z] = rim(); fx.smoke.emit(x, yy - 0.2, z, -vx * 0.25, -0.4, -vz * 0.25, 0.85, 0.87, 0.95, 1.1 + Math.random() * 0.8, 1.5, { grow: 1.8, drag: 0.9, a: 0.5 }); }
    else if (e === 2) for (let i = n(6 + sp * 0.35); i--;) { const [x, yy, z] = rim(); const h = new THREE.Color().setHSL((t * 0.25 + Math.random() * 0.3) % 1, 0.9, 0.62); fx.stars.emit(x, yy, z, -vx * 0.2 + (Math.random() - 0.5), -0.4, -vz * 0.2 + (Math.random() - 0.5), h.r, h.g, h.b, 0.7 + Math.random() * 0.5, 1.3, { grav: 1.6, drag: 0.4 }); }
    else if (e === 4) for (let i = n(16 + sp * 0.6); i--;) { const [x, yy, z] = rim(); fx.glow.emit(x, yy, z, -vx * 0.2 + (Math.random() - 0.5) * 1.5, 1 + Math.random() * 2.5, -vz * 0.2 + (Math.random() - 0.5) * 1.5, 2.2, 0.8 + Math.random() * 0.5, 0.15, 0.3 + Math.random() * 0.25, 0.7 + Math.random() * 0.4, { drag: 0.5 }); }
    else if (e === 5) for (let i = n(10 + sp * 0.4); i--;) { const [x, yy, z] = rim(); const h = new THREE.Color().setHSL(Math.random(), 1, 0.6); fx.stars.emit(x, yy, z, -vx * 0.25 + (Math.random() - 0.5) * 5, Math.random() * 2, -vz * 0.25 + (Math.random() - 0.5) * 5, h.r * 1.3, h.g * 1.3, h.b * 1.3, 0.5 + Math.random() * 0.4, 1.6, { grav: 4, drag: 0.3 }); }
    else {
      for (let i = n(20 + sp * 0.8); i--;) { const [x, yy, z, a] = rim(); const s = 7 + Math.random() * 6; fx.glow.emit(x, yy + Math.random() * 1.4, z, -Math.sin(a) * s, (Math.random() - 0.5) * 6, Math.cos(a) * s, c.r * 2, c.g * 2, c.b * 2, 0.22 + Math.random() * 0.15, 0.22, { drag: 1 }); }
      if (Math.floor(t * 0.8) !== Math.floor((t - dt) * 0.8)) fx.ring(bx, y - 0.7, bz, this.pal.light, rimR * 1.7, 0.7, true);
    }
    // turbo: rastro forte
    if (this.turbo) for (let i = n(36); i--;) { const [x, yy, z] = rim(); fx.glow.emit(x, yy + 0.5, z, -vx * 0.35, 0.2, -vz * 0.35, 1.5, 1.4, 1.2, 0.5 + Math.random() * 0.4, 0.5, { drag: 1.5 }); }
    // partículas do raio: sobem em espiral + folhas/grama
    if (bk > 0.3) {
      const R = CFG.beamRadius;
      for (let i = n(34); i--;) {
        const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * R * 0.92, swirl = 2.2;
        fx.glow.emit(bx + Math.cos(a) * r, 0.2 + Math.random() * 0.5, bz + Math.sin(a) * r, -Math.sin(a) * swirl - Math.cos(a) * r * 0.25, 5.5 + Math.random() * 6, Math.cos(a) * swirl - Math.sin(a) * r * 0.25, c.r * 1.4 + 0.3, c.g * 1.4 + 0.3, c.b * 1.4 + 0.3, 0.3 + Math.random() * 0.3, Math.min(1.6, len / 6), { drag: 0.15 });
      }
      for (let i = n(4); i--;) { const a = Math.random() * 6.283, r = Math.random() * R * 0.8; fx.glow.emit(bx + Math.cos(a) * r, 0.3, bz + Math.sin(a) * r, -Math.sin(a) * 2.6, 4 + Math.random() * 5, Math.cos(a) * 2.6, 0.45, 0.85, 0.25, 0.22, 1.7, { drag: 0.1 }); }
      for (let i = n(2); i--;) { const a = Math.random() * 6.283, r = Math.random() * R * 0.8; fx.stars.emit(bx + Math.cos(a) * r, 0.5, bz + Math.sin(a) * r, 0, 3 + Math.random() * 3, 0, 1, 0.95, 0.7, 0.55, 1.7, { drag: 0.1 }); }
    }
  }

  dispose() { this.scene.remove(this.group, this.beam, this.core, this.ground, this.light, this.tag); dispose(this.group); }
}
