import * as THREE from 'three';
import { buildCampus } from './campus.js';

// sol baixo ao norte (como nas fotos aéreas do campus ao entardecer)
export const SUN = new THREE.Vector3(-0.22, 0.3, -0.93).normalize();
const HORIZON = [1.0, 0.66, 0.45];

const SKY_V = /* glsl */ `varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const SKY_F = /* glsl */ `
varying vec3 vD; uniform vec3 uSun; uniform float uTime;
float hash(vec3 p){ p=fract(p*.3183099+.1); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
void main(){
  vec3 d=normalize(vD); float h=d.y;
  vec3 hor=vec3(${HORIZON.join(',')}), pink=vec3(.98,.40,.52), purple=vec3(.40,.30,.74), top=vec3(.06,.10,.34);
  vec3 c=mix(hor,pink,smoothstep(0.,.13,h));
  c=mix(c,purple,smoothstep(.1,.4,h));
  c=mix(c,top,smoothstep(.32,.95,h));
  c=mix(hor*.85,c,smoothstep(-.1,.01,h));
  c=pow(c,vec3(2.2));
  float sd=max(dot(d,uSun),0.);
  c+=vec3(1.,.5,.2)*pow(sd,5.)*.6+vec3(1.,.72,.38)*pow(sd,48.)*1.1;
  c=mix(c,vec3(1.,.9,.7)*5.,smoothstep(.9988,.9993,sd));
  float st=step(.9962,hash(floor(d*230.)))*smoothstep(.28,.6,h);
  c+=vec3(.85,.92,1.)*st*(.55+.45*sin(uTime*2.+hash(floor(d*230.))*60.))*1.6;
  gl_FragColor=vec4(c,1.);
}`;

const lerp = (a, b, t) => a + (b - a) * t;
const h2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
export function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(h2(xi, yi), h2(xi + 1, yi), u), lerp(h2(xi, yi + 1), h2(xi + 1, yi + 1), u), v);
}

export class World {
  constructor(renderer, scene, fx) {
    this.renderer = renderer; this.scene = scene; this.fx = fx;
    scene.fog = new THREE.Fog(new THREE.Color().setRGB(...HORIZON, THREE.SRGBColorSpace), 200, 1500);
    scene.background = scene.fog.color;

    this.skyU = { uSun: { value: SUN }, uTime: { value: 0 } };
    const skyMat = new THREE.ShaderMaterial({ uniforms: this.skyU, vertexShader: SKY_V, fragmentShader: SKY_F, side: THREE.BackSide, depthWrite: false, fog: false });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 40, 20), skyMat);
    this.sky.renderOrder = -10; this.sky.frustumCulled = false; scene.add(this.sky);
    const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), skyMat));
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(envScene, 0, 1, 4000).texture; scene.environmentIntensity = 0.55; pm.dispose();

    this.hemi = new THREE.HemisphereLight(0xffd0a8, 0x6a5090, 1.0); scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffb272, 3.3);
    this.sun.castShadow = true; this.sun.shadow.camera.near = 10; this.sun.shadow.camera.far = 380;
    this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.06;
    const sc = this.sun.shadow.camera; sc.left = -66; sc.right = 66; sc.top = 66; sc.bottom = -66;
    scene.add(this.sun, this.sun.target);
    this.fill = new THREE.DirectionalLight(0x7f9bff, 0.55); this.fill.position.copy(SUN).multiplyScalar(-100); scene.add(this.fill);

    this.windU = { value: 0 };
    this.campus = buildCampus(scene, { windU: this.windU, fx });
    this.rects = this.campus.rects; this.ellipses = this.campus.ellipses; this.spawns = this.campus.spawns;
    this.buildGround(scene);
    this.buildFar(scene);
    this.shadowSize = 0;
    this.setShadow(2048);
  }

  buildGround(scene) {
    const SX = 1100, SZ = 700, NX = 220, NZ = 140;
    const g = new THREE.PlaneGeometry(SX, SZ, NX, NZ).rotateX(-Math.PI / 2);
    const pos = g.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
    const A = new THREE.Color(0x4e9d44), B = new THREE.Color(0x86c45a), Y = new THREE.Color(0xb7c663), D = new THREE.Color(0x3c8a46);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const n1 = vnoise(x * 0.04, z * 0.04), n2 = vnoise(x * 0.15 + 9, z * 0.15), n3 = vnoise(x * 0.012 + 3, z * 0.012);
      const mow = 1 + Math.sin((x + z * 0.35) * 0.35) * 0.035 + Math.sin(x * 0.07 - z * 0.05) * 0.03;
      c.copy(A).lerp(B, n1 * 0.8).lerp(D, Math.max(0, n3 - 0.5) * 1.3).lerp(Y, Math.max(0, n2 - 0.72) * 1.2);
      c.multiplyScalar(mow); col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const cv = document.createElement('canvas'); cv.width = cv.height = 512; const x = cv.getContext('2d');
    x.fillStyle = '#d9d9d9'; x.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2600; i++) {
      const px = Math.random() * 512, py = Math.random() * 512, a = -1.57 + (Math.random() - 0.5) * 1.2, l = 5 + Math.random() * 9;
      x.strokeStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.4)' : 'rgba(70,90,60,.3)'; x.lineWidth = 1 + Math.random() * 1.5;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
    }
    for (let i = 0; i < 90; i++) { // trevos e florzinhas no gramado
      const px = Math.random() * 512, py = Math.random() * 512; x.fillStyle = ['rgba(255,255,255,.75)', 'rgba(255,225,90,.7)', 'rgba(255,150,190,.55)'][i % 3];
      x.beginPath(); x.arc(px, py, 1.3 + Math.random() * 1.2, 0, 7); x.fill();
    }
    for (let i = 0; i < 24; i++) { x.fillStyle = 'rgba(60,85,40,.16)'; x.beginPath(); x.ellipse(Math.random() * 512, Math.random() * 512, 18 + Math.random() * 30, 10 + Math.random() * 18, Math.random() * 3, 0, 7); x.fill(); }
    const tex = new THREE.CanvasTexture(cv); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(SX / 4, SZ / 4); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    this.ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 1, metalness: 0 }));
    this.ground.receiveShadow = true; scene.add(this.ground);
    const far = new THREE.Mesh(new THREE.CircleGeometry(3000, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4a8a44, roughness: 1 }));
    far.position.y = -0.08; scene.add(far);
  }

  // skyline (Barretos ao fundo), morros, montanhas e nuvens
  buildFar(scene) {
    const rnd = this.campus.rand, sky = new THREE.Group(); this.far = sky; scene.add(sky);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    const ring = (rx, rz, a) => [Math.cos(a) * rx, Math.sin(a) * rz];
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128; const g = cv.getContext('2d');
    g.fillStyle = '#463a78'; g.fillRect(0, 0, 64, 128);
    for (let y = 4; y < 124; y += 8) for (let x = 4; x < 60; x += 8) { g.fillStyle = rnd() < 0.35 ? '#ffc778' : '#352b5e'; g.fillRect(x, y, 4, 5); }
    const ct = new THREE.CanvasTexture(cv); ct.colorSpace = THREE.SRGBColorSpace;
    const bm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ map: ct }), 130);
    for (let i = 0; i < 130; i++) {
      const a = (i / 130) * 6.283 + rnd() * 0.05, [x, z] = ring(820 + rnd() * 120, 600 + rnd() * 120, a), w = 12 + rnd() * 22, h = 16 + rnd() * rnd() * 80;
      m.compose(new THREE.Vector3(x, 0, z), q.setFromEuler(new THREE.Euler(0, -a + rnd() * 0.3, 0)), new THREE.Vector3(w, h, w * (0.8 + rnd() * 0.6)));
      bm.setMatrixAt(i, m); col.setHSL(0.72 + rnd() * 0.06, 0.25, 0.7 + rnd() * 0.3); bm.setColorAt(i, col);
    }
    bm.frustumCulled = false; sky.add(bm);
    const hm = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 10, 0, 6.283, 0, 1.6), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x1a2a10 }), 30);
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * 6.283 + rnd() * 0.2, [x, z] = ring(560 + rnd() * 150, 380 + rnd() * 120, a), w = 90 + rnd() * 120;
      m.compose(new THREE.Vector3(x, -2, z), q.identity(), new THREE.Vector3(w, 12 + rnd() * 22, w * 0.8)); hm.setMatrixAt(i, m); col.setHSL(0.27 + rnd() * 0.05, 0.38, 0.3 + rnd() * 0.1); hm.setColorAt(i, col);
    }
    hm.frustumCulled = false; sky.add(hm);
    const mm = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7, 1).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x30204a, flatShading: true }), 26);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * 6.283 + rnd() * 0.1, [x, z] = ring(1250 + rnd() * 200, 950 + rnd() * 150, a), w = 260 + rnd() * 260;
      m.compose(new THREE.Vector3(x, -6, z), q.setFromEuler(new THREE.Euler(0, rnd() * 6, 0)), new THREE.Vector3(w, 110 + rnd() * 190, w * 0.9)); mm.setMatrixAt(i, m); col.setHSL(0.74 + rnd() * 0.05, 0.3, 0.38 + rnd() * 0.1); mm.setColorAt(i, col);
    }
    mm.frustumCulled = false; sky.add(mm);
    const cm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), new THREE.MeshLambertMaterial({ color: 0xffd6c4, emissive: 0x8a4a70 }), 16 * 8);
    let k = 0;
    for (let i = 0; i < 16; i++) {
      const a = rnd() * 6.283, r = 300 + rnd() * 800, cx = Math.cos(a) * r, cz = Math.sin(a) * r * 0.8, cy = 90 + rnd() * 90, s = 20 + rnd() * 26;
      for (let j = 0; j < 8; j++, k++) { const o = (rnd() - 0.5) * s * 2.2, p = (rnd() - 0.5) * s * 1.1, sz = s * (0.5 + rnd() * 0.6); m.compose(new THREE.Vector3(cx + o, cy + (rnd() - 0.5) * 4 + (1 - Math.abs(o) / (s * 1.1)) * 4, cz + p), q.identity(), new THREE.Vector3(sz * 1.4, sz * 0.5, sz)); cm.setMatrixAt(k, m); }
    }
    cm.frustumCulled = false; this.clouds = cm; scene.add(cm);
  }

  // sombras: resolução e liga/desliga; o foco é reposicionado a cada viewport (focusSun)
  setShadow(size) {
    const on = size > 0, wasOn = this.renderer.shadowMap.enabled;
    this.renderer.shadowMap.enabled = on; this.renderer.shadowMap.autoUpdate = false; this.sun.castShadow = on;
    if (on && this.shadowSize !== size) { this.sun.shadow.mapSize.set(size, size); this.sun.shadow.map?.dispose(); this.sun.shadow.map = null; }
    this.shadowSize = size;
    if (wasOn !== on) this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((mm) => (mm.needsUpdate = true)); });
  }
  setQuality(q, views = 1) {
    this.q = q; this.setShadow(q.shadow ? (views > 1 ? Math.min(q.shadow, 1024) : q.shadow) : 0);
    this.campus.setDensity(q);
    this.far.visible = q.far > 0.7; this.clouds.visible = q.far > 0.5;
  }
  focusSun(x, z) {
    const texel = (this.sun.shadow.camera.right * 2) / Math.max(1, this.sun.shadow.mapSize.x), fx = Math.round(x / texel) * texel, fz = Math.round(z / texel) * texel;
    this.sun.target.position.set(fx, 0, fz); this.sun.position.set(fx + SUN.x * 150, SUN.y * 150, fz + SUN.z * 150);
    this.sun.target.updateMatrixWorld(); this.sun.updateMatrixWorld();
    this.renderer.shadowMap.needsUpdate = true;
  }

  // ---- colisão / navegação ----
  isBlocked(x, z, r = 0.5) {
    for (const b of this.rects) { const dx = x - b.x, dz = z - b.z, lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c; if (Math.abs(lx) < b.hw + r && Math.abs(lz) < b.hd + r) return true; }
    for (const e of this.ellipses) { const dx = (x - e.x) / (e.rx + r), dz = (z - e.z) / (e.rz + r); if (dx * dx + dz * dz < 1) return true; }
    return this.campus.circleHit(x, z, r);
  }
  // `from`: posição ou lista de posições a evitar
  randomSpot(from, minDist = 0) {
    const list = from ? (Array.isArray(from) ? from : [from]) : [];
    const near = list.length ? list[(Math.random() * list.length) | 0] : null; // 65% das capivaras nascem ao alcance de algum jogador
    for (let i = 0; i < 90; i++) {
      const [x, z] = this.campus.sampleZone();
      if (near && i < 60 && Math.random() < 0.65 && Math.hypot(x - near.x, z - near.z) > 170) continue;
      if (Math.abs(x) > 375 || Math.abs(z) > 210 || this.isBlocked(x, z, 1.6)) continue;
      if (list.some((p) => Math.hypot(x - p.x, z - p.z) < minDist)) continue;
      return { x, z };
    }
    return { x: this.campus.plaza[0], z: this.campus.plaza[1] + 25 };
  }
  collide(pos, vel) { // com altitude 15 o OVNI sobrevoa tudo; mantido por segurança se a altitude for reduzida
    for (const b of this.rects) {
      if (pos.y > b.h + 1.5) continue;
      const dx = pos.x - b.x, dz = pos.z - b.z, lx = dx * b.c - dz * b.s, lz = dx * b.s + dz * b.c, R = 2.6, ox = b.hw + R - Math.abs(lx), oz = b.hd + R - Math.abs(lz);
      if (ox > 0 && oz > 0) { const px = ox < oz ? Math.sign(lx || 1) * ox : 0, pz = ox < oz ? 0 : Math.sign(lz || 1) * oz; pos.x += px * b.c + pz * b.s; pos.z += -px * b.s + pz * b.c; vel.x *= -0.1; vel.z *= -0.1; }
    }
  }

  update(dt, t, focuses) {
    this.skyU.uTime.value = t; this.windU.value = t;
    this.clouds.rotation.y += dt * 0.002;
    this.campus.update(dt, t, focuses);
  }
}
