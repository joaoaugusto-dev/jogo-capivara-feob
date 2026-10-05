import * as THREE from 'three';

// ---------- texturas procedurais ----------
function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export const TEX = {
  soft: canvasTex(64, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s);
  }),
  star: canvasTex(64, (g, s) => {
    const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    r.addColorStop(0, 'rgba(255,255,255,.9)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.globalAlpha = 0.35; g.fillRect(0, 0, s, s); g.globalAlpha = 1;
    g.fillStyle = '#fff'; g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 - Math.PI / 2, rad = i % 2 ? s * 0.13 : s * 0.4;
      g.lineTo(s / 2 + Math.cos(a) * rad, s / 2 + Math.sin(a) * rad);
    }
    g.closePath(); g.fill();
  }),
  smoke: canvasTex(64, (g, s) => {
    for (let i = 0; i < 7; i++) {
      const x = s / 2 + (Math.random() - 0.5) * s * 0.35, y = s / 2 + (Math.random() - 0.5) * s * 0.35, rr = s * (0.2 + Math.random() * 0.18);
      const r = g.createRadialGradient(x, y, 0, x, y, rr);
      r.addColorStop(0, 'rgba(255,255,255,.5)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, s, s);
    }
  }),
};
export { canvasTex };

// ---------- pool de partículas (Points + shader, tudo em CPU com buffers fixos) ----------
const VERT = /* glsl */ `
attribute float size; attribute vec4 pcolor; varying vec4 vC; uniform float uScale;
void main(){ vC=pcolor; vec4 mv=modelViewMatrix*vec4(position,1.); gl_PointSize=size*uScale/max(-mv.z,.1); gl_Position=projectionMatrix*mv; }`;
const FRAG = /* glsl */ `
uniform sampler2D map; varying vec4 vC;
void main(){ vec4 t=texture2D(map,gl_PointCoord); float a=t.a*vC.a; if(a<.004) discard; gl_FragColor=vec4(vC.rgb,a); }`;

export class ParticlePool {
  constructor(scene, { tex, additive = true, max = 800 }) {
    this.max = max; this.i = 0; this.mult = 1;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.age = new Float32Array(max).fill(1e9);
    this.s0 = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.grow = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { map: { value: tex }, uScale: { value: 600 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
    this.geo = g;
  }
  // o: grav (m/s²), drag (1/s), grow (tamanho/s), a (alpha inicial)
  emit(x, y, z, vx, vy, vz, r, g, b, size, life, o = {}) {
    if (this.mult < 1 && Math.random() > this.mult) return;
    const i = this.i; this.i = (i + 1) % this.max;
    const p = i * 3, c = i * 4;
    this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;
    this.vel[p] = vx; this.vel[p + 1] = vy; this.vel[p + 2] = vz;
    this.col[c] = r; this.col[c + 1] = g; this.col[c + 2] = b; this.col[c + 3] = o.a ?? 1;
    this.s0[i] = size; this.size[i] = size; this.life[i] = life; this.age[i] = 0;
    this.grav[i] = o.grav ?? 0; this.drag[i] = o.drag ?? 0; this.grow[i] = o.grow ?? 0;
  }
  update(dt) {
    const { pos, vel, col, size, life, age } = this;
    for (let i = 0; i < this.max; i++) {
      if (age[i] > life[i]) { size[i] = 0; continue; }
      age[i] += dt;
      const k = age[i] / life[i];
      if (k >= 1) { size[i] = 0; col[i * 4 + 3] = 0; continue; }
      const p = i * 3, d = Math.max(0, 1 - this.drag[i] * dt);
      vel[p] *= d; vel[p + 1] = vel[p + 1] * d - this.grav[i] * dt; vel[p + 2] *= d;
      pos[p] += vel[p] * dt; pos[p + 1] += vel[p + 1] * dt; pos[p + 2] += vel[p + 2] * dt;
      size[i] = Math.max(0, this.s0[i] + this.grow[i] * age[i]) * (k < 0.12 ? k / 0.12 : 1);
      col[i * 4 + 3] = Math.min(1, (1 - k) * 1.6);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.pcolor.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
  }
}

export class FX {
  constructor(scene) {
    this.glow = new ParticlePool(scene, { tex: TEX.soft, additive: true, max: 1400 });
    this.stars = new ParticlePool(scene, { tex: TEX.star, additive: true, max: 400 });
    this.smoke = new ParticlePool(scene, { tex: TEX.smoke, additive: false, max: 300 });
    this.pools = [this.glow, this.stars, this.smoke];
    // anéis de choque (pool de 6)
    const rg = new THREE.RingGeometry(0.82, 1, 48);
    this.rings = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      m.visible = false; m.userData = { t: 1, dur: 1, s: 1 };
      scene.add(m); this.rings.push(m);
    }
    this.ri = 0;
  }
  setMult(m) { this.pools.forEach((p) => (p.mult = m)); }
  ring(x, y, z, color, size = 6, dur = 0.7, flat = false) {
    const m = this.rings[this.ri++ % this.rings.length];
    m.position.set(x, y, z);
    m.rotation.set(-Math.PI / 2, 0, 0); // sempre horizontal: funciona para qualquer câmera (tela dividida)
    m.userData = { t: 0, dur, s: size, flat };
    m.material.color.set(color); m.visible = true;
  }
  burst(x, y, z, color, n = 40, speed = 9, star = true) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, e = (Math.random() - 0.3) * 1.6, s = speed * (0.4 + Math.random() * 0.8);
      const vx = Math.cos(a) * Math.cos(e) * s, vy = Math.sin(e) * s, vz = Math.sin(a) * Math.cos(e) * s;
      const hot = Math.random() < 0.4;
      this.glow.emit(x, y, z, vx, vy, vz, hot ? 1 : c.r * 1.5, hot ? 1 : c.g * 1.5, hot ? 0.9 : c.b * 1.5, 0.5 + Math.random() * 0.7, 0.6 + Math.random() * 0.6, { drag: 2.2, grav: 3 });
      if (star && i % 3 === 0) this.stars.emit(x, y, z, vx * 0.8, vy * 0.8 + 2, vz * 0.8, 1, 0.95, 0.5, 0.9 + Math.random() * 0.8, 0.9 + Math.random() * 0.7, { drag: 1.6, grav: 4 });
    }
  }
  // tamanho dos pontos depende da viewport/fov atual: chamado antes de renderizar cada câmera
  setView(heightPx, fovDeg) { const s = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360)); this.pools.forEach((p) => (p.uniforms.uScale.value = s)); }
  update(dt) {
    this.pools.forEach((p) => p.update(dt));
    for (const m of this.rings) {
      if (!m.visible) continue;
      const u = m.userData; u.t += dt;
      const k = u.t / u.dur;
      if (k >= 1) { m.visible = false; continue; }
      const e = 1 - Math.pow(1 - k, 3);
      m.scale.setScalar(0.3 + e * u.s);
      m.material.opacity = (1 - k) * 0.55;
    }
  }
}
