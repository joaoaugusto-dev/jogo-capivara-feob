import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CFG, QUALITY, DEFAULT_PLAYER_CFG } from './config.js';
import { FX } from './fx.js';
import { World } from './world.js';
import { Ufo } from './ufo.js';
import { Capys } from './capy.js';
import { Sound } from './audio.js';
import { Net } from './net.js';
import { ui } from './ui.js';

const params = new URLSearchParams(location.search);
const STEP = 1 / 60;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------- renderer / cena ----------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.setClearColor(0x140b28, 1); // célula vazia da tela dividida fica opaca (evita NaN/branco no bloom)
const scene = new THREE.Scene();
const fx = new FX(scene);
const world = new World(renderer, scene, fx);
const pool = [0, 1, 2, 3].map(() => new Ufo(scene, fx)); // 4 OVNIs fixos (luzes constantes = sem recompilar shaders)
pool.forEach((u) => (u.collide = (p, v) => world.collide(p, v)));
const capys = new Capys(scene, world, fx);
const sound = new Sound();
ui.init();

// sombra falsa dos OVNIs (legibilidade em qualquer qualidade)
const blobGeo = new THREE.CircleGeometry(1, 28).rotateX(-Math.PI / 2);
const blobs = pool.map(() => { const m = new THREE.Mesh(blobGeo, new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.22, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })); m.visible = false; scene.add(m); return m; });

// ---------- câmeras (uma por jogador + uma de demonstração) ----------
function makeCam() { return { camera: new THREE.PerspectiveCamera(58, 16 / 9, 0.3, 3000), pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 58, shake: 0, snap: true, shot: 'follow', shotT: 6, side: 1, orbit: 0, yaw: Math.PI, inputY: 0 }; }
const demoCam = makeCam();
const SHOTS = ['follow', 'follow', 'low', 'wide', 'side', 'follow'];
const _d = new THREE.Vector3(), _l = new THREE.Vector3();
function updateCamera(cam, u, st, dt, t) {
  const p = u.rpos;
  let dist = 17, height = 7.6, ahead = 6.5, down = -3.4, fov = 58, rate = 5.5, yawTarget = cam.yaw, orbit = false;
  if (st === 'play' || st === 'count') {
    const fwd = st === 'play' ? Math.max(0, -cam.inputY) : 0;
    cam.yaw += wrap(u.yaw - cam.yaw) * (1 - Math.exp(-1.25 * dt * fwd));
    dist -= u.beamK * 2.2; height -= u.beamK * 0.8; down -= u.beamK * 4.2; ahead += u.beamK * 1.5;
    fov = 58 + Math.min(u.speed, 40) * 0.2 + (u.turbo ? 8 : 0) - u.beamK * 5; if (u.turbo) dist += 2.5;
  } else if (st === 'intro') {
    cam.orbit += dt * 0.75; const a = cam.orbit + 2.4;
    _d.set(p.x + Math.sin(a) * 15.5, p.y + 3.6 + Math.sin(t * 0.8) * 0.4, p.z + Math.cos(a) * 15.5); _l.set(p.x, p.y + 0.2, p.z);
    cam.yaw = wrap(a + Math.PI); return finishCam(cam, u, _d, _l, 46, 7, dt);
  } else { // demonstração / resultado: planos cinematográficos
    cam.shotT -= dt;
    if (cam.shotT <= 0) { cam.shot = SHOTS[(Math.random() * SHOTS.length) | 0]; cam.shotT = rnd(9, 15); cam.side = Math.random() < 0.5 ? -1 : 1; }
    const s = cam.shot; yawTarget = u.yaw + 0.35 * Math.sin(t * 0.13);
    if (s === 'low') { dist = 20; height = 6; down = -4.5; ahead = 2; fov = 54; yawTarget = u.yaw + cam.side * 0.55; }
    else if (s === 'wide') { dist = 48; height = 28; down = -9; ahead = 0; fov = 56; yawTarget = u.yaw + cam.side * 0.4; }
    else if (s === 'side') { dist = 24; height = 8; down = -4; ahead = 1; fov = 54; yawTarget = u.yaw + cam.side * 1.35; }
    if (u.beamK > 0.3) { dist *= 0.82; height *= 0.85; }
    cam.yaw += wrap(yawTarget - cam.yaw) * (1 - Math.exp(-0.9 * dt));
    if (st === 'result') { dist = 28; height = 12; }
  }
  const fx_ = Math.sin(cam.yaw), fz_ = Math.cos(cam.yaw);
  _d.set(p.x - fx_ * dist, p.y + height, p.z - fz_ * dist); _l.set(p.x + fx_ * ahead, p.y + down, p.z + fz_ * ahead);
  finishCam(cam, u, _d, _l, fov, rate, dt);
}
function finishCam(cam, u, want, look, fov, rate, dt) {
  want.y = Math.max(want.y, 2.2);
  if (cam.snap) { cam.pos.copy(want); cam.look.copy(look); cam.fov = fov; cam.snap = false; }
  cam.pos.lerp(want, 1 - Math.exp(-rate * dt)); cam.look.lerp(look, 1 - Math.exp(-6.5 * dt)); cam.fov += (fov - cam.fov) * (1 - Math.exp(-3 * dt));
  cam.shake = Math.max(0, cam.shake - dt * 2.4);
  const sh = cam.shake * cam.shake * 0.9, c = cam.camera;
  c.position.set(cam.pos.x + (Math.random() - 0.5) * sh, cam.pos.y + (Math.random() - 0.5) * sh, cam.pos.z + (Math.random() - 0.5) * sh);
  c.lookAt(cam.look); c.rotateZ(u.tiltZ * 0.3 + (Math.random() - 0.5) * sh * 0.02);
  if (Math.abs(c.fov - cam.fov) > 0.02) { c.fov = cam.fov; c.updateProjectionMatrix(); }
}

// ---------- minimapa (fundo estático desenhado uma vez) ----------
const MMB = { x: CFG.halfX + 25, z: CFG.halfZ + 25 }, MMW = 420, MMH = Math.round(MMW * MMB.z / MMB.x);
const mmx = (x) => ((x + MMB.x) / (2 * MMB.x)) * MMW, mmz = (z) => ((z + MMB.z) / (2 * MMB.z)) * MMH, mmk = MMW / (2 * MMB.x);
const mmBg = (() => {
  const c = document.createElement('canvas'); c.width = MMW; c.height = MMH; const g = c.getContext('2d'), cp = world.campus;
  g.fillStyle = '#2f6b3a'; g.fillRect(0, 0, MMW, MMH);
  g.strokeStyle = '#9a9ca6'; g.lineCap = 'round';
  for (const [x1, z1, x2, z2, w] of cp.segs) { g.lineWidth = Math.max(1.5, w * mmk); g.beginPath(); g.moveTo(mmx(x1), mmz(z1)); g.lineTo(mmx(x2), mmz(z2)); g.stroke(); }
  g.fillStyle = '#7d808a'; for (const l of cp.lots) { g.save(); g.translate(mmx(l.cx), mmz(l.cz)); g.rotate(l.rot); g.fillRect(-l.W * mmk / 2, -l.D * mmk / 2, l.W * mmk, l.D * mmk); g.restore(); }
  g.fillStyle = '#3aa0d6'; for (const e of cp.ellipses) { g.beginPath(); g.ellipse(mmx(e.x), mmz(e.z), e.rx * mmk, e.rz * mmk, 0, 0, 7); g.fill(); }
  for (const b of world.rects) { if (!b.col) continue; g.save(); g.translate(mmx(b.x), mmz(b.z)); g.rotate(b.rot); g.fillStyle = '#' + b.col.toString(16).padStart(6, '0'); g.fillRect(-b.hw * mmk, -b.hd * mmk, b.hw * 2 * mmk, b.hd * 2 * mmk); g.restore(); }
  return c;
})();
const SLOT_COL = ['#2ef2ff', '#ff7ab8', '#7cff6b', '#ffc82e'];
function drawMinimap(p) {
  const v = ui.views[p.slot], g = v.mctx; if (v.mm.width !== MMW) { v.mm.width = MMW; v.mm.height = MMH; }
  g.drawImage(mmBg, 0, 0);
  for (const c of capys.list) { if (c.state === 'gone' || c.state === 'spawn') continue; g.fillStyle = c.golden ? '#ffe14d' : '#ffb347'; g.beginPath(); g.arc(mmx(c.x), mmz(c.z), c.golden ? 4.5 : 3, 0, 7); g.fill(); g.strokeStyle = '#3a1d00'; g.lineWidth = 1; g.stroke(); }
  for (const q of activeList()) { const u = q.ufo, me = q === p; g.save(); g.translate(mmx(u.pos.x), mmz(u.pos.z)); g.rotate(u.yaw); g.fillStyle = SLOT_COL[q.slot]; g.strokeStyle = me ? '#fff' : '#000'; g.lineWidth = me ? 2.2 : 1; const s = me ? 8 : 5.5; g.beginPath(); g.moveTo(0, s); g.lineTo(-s * 0.7, -s * 0.7); g.lineTo(s * 0.7, -s * 0.7); g.closePath(); g.fill(); g.stroke(); g.restore(); }
}
function updateGuides(p, t) {
  const v = ui.views[p.slot];
  if (p.state !== 'play' && p.state !== 'count') return v.arrowSet(false);
  if (Math.floor(t * 10) !== p.mmT) { p.mmT = Math.floor(t * 10); drawMinimap(p); }
  const u = p.ufo; let best = null, bd = 1e9;
  for (const c of capys.list) { if (c.state === 'gone' || c.state === 'spawn' || c.state === 'abducted' || c.state === 'fall') continue; const d = Math.hypot(c.x - u.pos.x, c.z - u.pos.z); if (d < bd) { bd = d; best = c; } }
  if (!best || bd < 30) return v.arrowSet(false);
  const dx = (best.x - u.pos.x) / bd, dz = (best.z - u.pos.z) / bd, yaw = p.cam.yaw, fw = dx * Math.sin(yaw) + dz * Math.cos(yaw), rt = -dx * Math.cos(yaw) + dz * Math.sin(yaw);
  v.arrowSet(true, Math.atan2(rt, fw), bd);
}

// ---------- renderização em tela dividida ----------
// Um único passe renderiza a cena uma vez por viewport dentro do render target do composer;
// bloom + tonemap rodam depois, uma vez só, sobre a imagem inteira.
let views = [];            // [{cam, rect:{x,y,w,h}, ufo}] em px CSS (y de cima)
class MultiViewPass extends Pass {
  constructor() { super(); this.needsSwap = false; }
  render(r, writeBuffer, readBuffer) {
    const pr = r.getPixelRatio(), H = readBuffer.height, W = readBuffer.width;
    readBuffer.scissorTest = false; readBuffer.viewport.set(0, 0, W, H); r.setRenderTarget(readBuffer); r.clear();
    for (const v of views) {
      const x = Math.round(v.rect.x * pr), w = Math.round(v.rect.w * pr), h = Math.round(v.rect.h * pr), y = H - Math.round(v.rect.y * pr) - h;
      readBuffer.viewport.set(x, y, w, h); readBuffer.scissor.set(x, y, w, h); readBuffer.scissorTest = true; r.setRenderTarget(readBuffer);
      beforeView(v); r.render(scene, v.cam.camera);
    }
    if (fillRect) { // célula vazia (3 jogadores): renderiza uma cena vazia para o resolve MSAA cobrir todos os pixels
      const f = fillRect, x = Math.round(f.x * pr), w = Math.round(f.w * pr), h = Math.round(f.h * pr), y = H - Math.round(f.y * pr) - h;
      readBuffer.viewport.set(x, y, w, h); readBuffer.scissor.set(x, y, w, h); readBuffer.scissorTest = true; r.setRenderTarget(readBuffer); r.render(emptyScene, emptyCam);
    }
    readBuffer.scissorTest = false; readBuffer.viewport.set(0, 0, W, H);
  }
}
const emptyScene = new THREE.Scene(); emptyScene.background = new THREE.Color(0x140b28); const emptyCam = new THREE.PerspectiveCamera();
let fillRect = null;
function beforeView(v) { for (const u of pool) if (u.name) u.tag.visible = u !== v.ufo; world.focusSun(v.ufo.rpos.x, v.ufo.rpos.z); fx.setView(v.rect.h * renderer.getPixelRatio(), v.cam.camera.fov); }

let quality = (params.get('q') || 'HIGH').toUpperCase(), auto = params.get('auto') !== '0', prScale = 1;
let composer = null, bloom = null, composerMsaa = -1;
function buildComposer(msaa) {
  composer?.dispose();
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: msaa }));
  composer.addPass(new MultiViewPass());
  bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.24, 0.5, 1.05);
  composer.addPass(bloom); composer.addPass(new OutputPass());
  composerMsaa = msaa;
}
function resize() {
  const q = QUALITY[quality];
  renderer.setPixelRatio(Math.min(devicePixelRatio, q.pr) * prScale);
  renderer.setSize(innerWidth, innerHeight, false);
  const ms = views.length > 1 ? 0 : q.msaa; // MSAA só com 1 jogador (multi-view: cada viewport faz resolve → caro)
  if (q.bloom) { if (!composer || composerMsaa !== ms) buildComposer(ms); else { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight); } }
  layoutKey = '';
}
function applyQuality(name) {
  if (!QUALITY[name]) return;
  quality = name; const q = QUALITY[name];
  world.setQuality(q, Math.max(1, views.length)); fx.setMult(q.particles); resize();
  console.info('[qualidade]', name, 'pr×', prScale.toFixed(2));
}
addEventListener('resize', resize);

// ---------- jogadores ----------
const players = new Map();   // id -> {id,name,cfg,online,input,lastIn,...}
const act = [null, null, null, null]; // slots ativos (tela dividida)
const kb = { x: 0, y: 0, a: 0, b: 0 };
let lb = [], paused = false, layoutKey = '';
const flags = { debug: params.has('debug') };
const activeList = () => act.filter(Boolean);

const net = new Net(onMsg, (ok) => { if (ok) players.forEach((p) => sendState(p)); });
const send = (to, o) => { if (typeof to === 'number') net.send({ to, ...o }); }; // teclado/controles físicos têm id texto: não há celular para avisar

function onMsg(m) {
  const p = players.get(m.id);
  switch (m.t) {
    case 'join': { const q = p || { id: m.id, input: { x: 0, y: 0, a: 0, b: 0 }, lastIn: 0, score: 0 }; Object.assign(q, { name: m.n, cfg: m.cfg, online: true }); players.set(m.id, q); sendState(q); break; }
    case 'leave': if (p) { p.online = false; p.input = { x: 0, y: 0, a: 0, b: 0 }; p.offAt = performance.now(); } break;
    case 'gone': players.delete(m.id); break;
    case 'cfg': if (p) { p.name = m.n; p.cfg = m.cfg; } break;
    case 'q': if (p) join(p); break;
    case 'i': if (p) { p.input = m; p.lastIn = performance.now(); } break;
    case 'cmd': command(m.k, m.v); break;
    case 'lb': lb = m.lb; ui.rank(lb); break;
  }
}
function sendState(p) {
  if (!p || typeof p.id !== 'number') return;
  if (!p.active) return send(p.id, { t: 'st', st: 'idle' });
  if (p.state === 'intro') send(p.id, { t: 'st', st: 'intro', n: p.name });
  else if (p.state === 'count') send(p.id, { t: 'st', st: 'count', v: 3 });
  else if (p.state === 'play') { send(p.id, { t: 'st', st: 'play' }); send(p.id, { t: 'h', sc: p.score, tm: Math.ceil(p.left), cb: p.combo, nc: p.nCap }); }
  else if (p.last) send(p.id, { t: 'st', st: 'end', ...p.last });
}
function ensureKb() { if (!players.has('kb')) players.set('kb', { id: 'kb', name: 'TECLADO', cfg: { ...DEFAULT_PLAYER_CFG, m: 1, c: 1 }, online: true, input: kb, lastIn: 0, score: 0 }); return players.get('kb'); }

function command(k, v) {
  if (k === 'start') join(ensureKb());
  else if (k === 'pause') setPause(!paused);
  else if (k === 'reset') { activeList().forEach((p) => { send(p.id, { t: 'st', st: 'idle' }); leave(p, true); }); }
  else if (k === 'end') activeList().forEach((p) => p.state === 'play' && endMatch(p));
  else if (k === 'time' && v >= 30 && v <= 600) CFG.matchSeconds = v | 0;
  else if (k === 'caps' && v >= 4 && v <= 80) { CFG.capyCount = v | 0; capys.setCount(CFG.capyCount); }
  else if (k === 'quality') { if (v === 'AUTO') auto = true; else if (QUALITY[v]) { auto = false; applyQuality(v); } }
  else if (k === 'kick') { const p = players.get(v) || players.get(String(v)); if (p?.active) { send(p.id, { t: 'st', st: 'idle' }); leave(p, true); } }
}
function setPause(b) { paused = b; ui.pause(b); }

// ---------- entrada / saída da partida (sem fila: até 4 simultâneos) ----------
function join(p) {
  if (p.active) { if (p.state === 'result') { p.again = true; p.t = 1e9; } return; }
  const slot = act.indexOf(null);
  if (slot < 0) return send(p.id, { t: 'st', st: 'full' });
  const wasDemo = activeList().length === 0;
  Object.assign(p, { active: true, slot, state: 'intro', t: 0, score: 0, combo: 0, comboT: 0, nCap: 0, best: 1, left: CFG.matchSeconds, again: false, last: null, lastCap: -99, hb: 0, cn: 4, cam: makeCam(), ufo: pool[slot] });
  act[slot] = p;
  const u = p.ufo; u.setActive(true); u.setCfg(p.cfg || DEFAULT_PLAYER_CFG); u.setName(p.name);
  const [sx, sz] = world.spawns[slot]; u.teleport(sx, sz); u.yaw = u.prevYaw = Math.PI; u.rpos.copy(u.pos);
  if (wasDemo) { ai.target = null; ai.beam = false; sound.setIntensity(0.5); sound.sfxScale = 1; }
  const v = ui.views[slot]; v.resetFx(); v.hud(false); v.introShow(p.name); v.player(p.name); v.score(0); v.time(CFG.matchSeconds); v.comboSet(0, 0);
  send(p.id, { t: 'st', st: 'intro', n: p.name }); sound.blip(); layoutKey = '';
}
function leave(p, silent) {
  if (!p.active) return;
  p.active = false; act[p.slot] = null; p.ufo.setActive(false); ui.views[p.slot].hide(); layoutKey = '';
  const again = p.again && p.online;
  if (again) join(p);
  else if (!activeList().length) enterDemo();
}
function enterDemo() { pool[0].setActive(true); pool[0].setCfg(DEMO_CFGS[demoCfgI++ % DEMO_CFGS.length]); demoCfgT = 14; ai.target = null; ai.beam = false; sound.setIntensity(0.1); sound.sfxScale = 0.45; demoCam.snap = false; layoutKey = ''; }
function beginPlay(p) {
  p.state = 'play'; p.t = 0; p.left = CFG.matchSeconds; ui.views[p.slot].hud(true); send(p.id, { t: 'st', st: 'play' }); sound.setIntensity(0.9);
}
function endMatch(p) {
  p.state = 'result'; p.t = 0; sound.end(); p.ufo.beamOn = false;
  const name = p.name || 'PILOTO', score = p.score, rank = lb.filter((e) => e.s > score).length + 1;
  if (score > 0) net.send({ t: 'score', n: name, s: score, c: p.nCap, b: p.best });
  p.last = { sc: score, rank, nc: p.nCap, best: p.best };
  const v = ui.views[p.slot]; v.hud(false); v.resultShow({ name, score, caps: p.nCap, best: p.best, rank }); v.bannerShow('TEMPO!', true);
  send(p.id, { t: 'st', st: 'end', ...p.last });
}

// ---------- captura / pontuação ----------
const _v = new THREE.Vector3();
capys.cb.onGrab = () => sound.grab();
let startleCd = 0;
capys.cb.onStartle = () => { if (startleCd <= 0) { sound.startle(); startleCd = 0.35; } };
let bloomKick = 0;
capys.cb.onCapture = (c, u) => {
  fx.burst(u.pos.x, u.pos.y - 0.4, u.pos.z, u.pal.light, c.golden ? 36 : 20, 9);
  fx.ring(u.pos.x, u.pos.y - 0.5, u.pos.z, u.pal.light, 5, 0.6);
  bloomKick = 0.9;
  const p = activeList().find((q) => q.ufo === u);
  if (!p) return sound.capture(1, c.golden);
  p.cam.shake = Math.min(1, p.cam.shake + 0.55); if (p.pad !== undefined) rumble(p, 220, 0.7, 0.35);
  if (p.state !== 'play') return;
  p.comboT > 0 ? p.combo++ : (p.combo = 1);
  p.comboT = CFG.comboWindow; p.best = Math.max(p.best, p.combo);
  const fast = c.beamHeld + c.grabT <= CFG.fastWindow;
  const pts = (CFG.baseScore + (fast ? CFG.fastBonus : 0) + CFG.comboStep * (p.combo - 1)) * (c.golden ? CFG.goldenMult : 1);
  p.score += pts; p.nCap++;
  const v = ui.views[p.slot], r = v.r, cam = p.cam.camera;
  _v.set(u.pos.x, u.pos.y + 1.5, u.pos.z).project(cam);
  v.pop((_v.x * 0.5 + 0.5) * r.w, (-_v.y * 0.5 + 0.5) * r.h, `+${pts}`, c.golden ? 'CAPIVARA DOURADA!' : fast ? 'RÁPIDA! +' + CFG.fastBonus : '', c.golden);
  v.bannerShow(c.golden ? 'DOURADA!<small>x3 PONTOS</small>' : p.combo >= 2 ? `COMBO x${p.combo}<small>CAPTURA!</small>` : 'CAPTURA!');
  sound.capture(p.combo, c.golden); if (p.combo >= 2) sound.combo(p.combo);
  send(p.id, { t: 'ev', k: 'cap', p: pts, cb: p.combo });
};
pool.forEach((u) => (u.onTurbo = () => sound.turbo()));

// ---------- IA do modo demonstração (usa o OVNI 0 enquanto ninguém joga) ----------
const ai = { target: null, t: 0, cool: 1, beam: false, beamT: 0, wx: 0, wz: 0, wander: { x: 0, z: 0 }, stuck: 0, ignore: new Map() };
function aiThink(dt, ufo) {
  ai.cool -= dt; const now = performance.now();
  if (ai.target && (ai.target.state === 'gone' || ai.target.state === 'spawn')) { ai.target = null; ai.beam = false; ai.cool = 0.6; }
  if (!ai.target && ai.cool <= 0) { ai.target = capys.nearest(ufo.pos.x, ufo.pos.z, 1e9, (c) => (ai.ignore.get(c) || 0) < now); ai.t = 0; ai.beamT = 0; ai.stuck = 0; }
  let wx = 0, wz = 0;
  if (ai.target) {
    const c = ai.target; ai.t += dt;
    const lead = c.state === 'flee' ? 0.7 : 0, tx = c.x + Math.sin(c.yaw) * 6 * lead, tz = c.z + Math.cos(c.yaw) * 6 * lead;
    const dx = tx - ufo.pos.x, dz = tz - ufo.pos.z, d = Math.hypot(dx, dz);
    ai.beam = d < CFG.beamRadius * 0.75 || c.state === 'abducted';
    const mag = ai.beam ? Math.min(1, d / 3) : Math.min(1, d / 18 + 0.35), a = Math.atan2(dx, dz); wx = Math.sin(a) * mag; wz = Math.cos(a) * mag;
    ai.beamT = ai.beam ? ai.beamT + dt : 0; ai.stuck = !ai.beam && mag > 0.3 && ufo.speed < 2.5 ? ai.stuck + dt : 0;
    if (ai.stuck > 1.4) ai.ignore.set(c, now + 15000);
    if (ai.t > 14 || ai.beamT > 4.5 || ai.stuck > 1.4) { ai.target = null; ai.beam = false; ai.cool = 0.3; }
  } else {
    ai.beam = false;
    const dx = ai.wander.x - ufo.pos.x, dz = ai.wander.z - ufo.pos.z, d = Math.hypot(dx, dz) || 1;
    if (d < 6 || (ufo.speed < 1 && ai.cool < -1.5)) ai.wander = world.randomSpot(null, 0);
    wx = (dx / d) * 0.6; wz = (dz / d) * 0.6;
  }
  ai.wx = wx; ai.wz = wz;
}
let demoCfgT = 14, demoCfgI = 0;
const DEMO_CFGS = [
  { m: 1, c: 1, s: 0, l: 1, b: 0, e: 2, a: 1, p: 0 }, { m: 3, c: 8, s: 1, l: 7, b: 5, e: 0, a: 4, p: 3 }, { m: 2, c: 4, s: 2, l: 3, b: 1, e: 1, a: 2, p: 2 },
  { m: 4, c: 9, s: 0, l: 6, b: 2, e: 3, a: 6, p: 1 }, { m: 0, c: 3, s: 3, l: 0, b: 4, e: 4, a: 5, p: 0 }, { m: 3, c: 10, s: 2, l: 5, b: 3, e: 5, a: 7, p: 3 }, { m: 1, c: 6, s: 1, l: 2, b: 0, e: 2, a: 0, p: 2 },
];

// ---------- teclado local (testes / plano B) ----------
const keys = new Set();
addEventListener('keydown', (e) => {
  startAudio(); if (e.repeat) return; keys.add(e.code);
  if (e.code === 'Enter') join(ensureKb());
  else if (e.code === 'Escape') command('reset');
  else if (e.code === 'KeyP') setPause(!paused);
  else if (e.code === 'KeyF') flags.debug = !flags.debug;
  else if (e.code === 'KeyM') sound.mute(!sound.muted);
  else if (e.code === 'Digit1') { auto = false; applyQuality('LOW'); } else if (e.code === 'Digit2') { auto = false; applyQuality('MEDIUM'); } else if (e.code === 'Digit3') { auto = false; applyQuality('HIGH'); }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('pointerdown', startAudio);
function startAudio() { if (sound.start()) ui.gate(false); }
setInterval(() => ui.gate(!sound.ready), 700);
function kbInput() {
  const k = (c) => keys.has(c);
  kb.x = (k('ArrowRight') || k('KeyD') ? 1 : 0) - (k('ArrowLeft') || k('KeyA') ? 1 : 0);
  kb.y = (k('ArrowDown') || k('KeyS') ? 1 : 0) - (k('ArrowUp') || k('KeyW') ? 1 : 0);
  kb.a = k('Space') ? 1 : 0; kb.b = k('ShiftLeft') || k('ShiftRight') ? 1 : 0;
  const m = Math.hypot(kb.x, kb.y); if (m > 1) { kb.x /= m; kb.y /= m; }
  return kb;
}
const NOIN = { x: 0, y: 0, a: 0, b: 0 };
const inputOf = (p) => (p.id === 'kb' ? kbInput() : p.pad !== undefined ? padInput(p) : performance.now() - p.lastIn > 700 ? NOIN : p.input);

// ---------- controles físicos (Gamepad API): até 4, padrão Xbox/PlayStation ----------
// analógico esquerdo/direcional = mover · A/X ou gatilho direito = raio · B/Y/bumpers = turbo · START/A = entrar
const PAD_CFGS = [{ ...DEFAULT_PLAYER_CFG }, { ...DEFAULT_PLAYER_CFG, m: 1, c: 3, l: 2, e: 3, a: 1, p: 2 }, { ...DEFAULT_PLAYER_CFG, m: 3, c: 2, l: 3, e: 2, a: 2, p: 3 }, { ...DEFAULT_PLAYER_CFG, m: 4, c: 4, l: 0, e: 1, a: 3, p: 1 }];
const padOf = (idx) => { const p = players.get('pad' + idx); return p; };
function ensurePad(gp) {
  let p = players.get('pad' + gp.index);
  if (!p) { p = { id: 'pad' + gp.index, pad: gp.index, name: 'CONTROLE ' + (gp.index + 1), cfg: { ...PAD_CFGS[gp.index % 4] }, online: true, input: NOIN, lastIn: 0, score: 0, prev: {} }; players.set(p.id, p); }
  p.online = true; return p;
}
const padIn = { x: 0, y: 0, a: 0, b: 0 };
function padInput(p) {
  const gp = navigator.getGamepads?.()[p.pad]; if (!gp) return NOIN;
  const bt = (i) => !!gp.buttons[i]?.pressed || (gp.buttons[i]?.value || 0) > 0.4;
  let x = gp.axes[0] || 0, y = gp.axes[1] || 0;
  if (Math.hypot(x, y) < 0.18) { x = y = 0; }
  if (bt(14)) x -= 1; if (bt(15)) x += 1; if (bt(12)) y -= 1; if (bt(13)) y += 1;
  const mg = Math.hypot(x, y); if (mg > 1) { x /= mg; y /= mg; }
  padIn.x = x; padIn.y = y; padIn.a = bt(0) || bt(7) ? 1 : 0; padIn.b = bt(1) || bt(2) || bt(3) || bt(4) || bt(5) || bt(6) ? 1 : 0;
  return padIn;
}
function pollPads() { // chamado todo frame: detecta controles, botão de entrada e desconexões
  const pads = navigator.getGamepads?.(); if (!pads) return;
  for (const gp of pads) {
    if (!gp || !gp.connected) continue;
    const p = ensurePad(gp), start = !!gp.buttons[9]?.pressed || !!gp.buttons[0]?.pressed;
    if (start && !p.prevStart && gp.index < 4) { startAudio(); join(p); }
    p.prevStart = start;
  }
  for (const [id, p] of players) if (p.pad !== undefined && p.online && !pads[p.pad]?.connected) { p.online = false; p.offAt = performance.now(); }
}
function rumble(p, ms, weak, strong) { try { navigator.getGamepads()[p.pad]?.vibrationActuator?.playEffect('dual-rumble', { duration: ms, weakMagnitude: weak, strongMagnitude: strong }); } catch { /* sem vibração */ } }

// ---------- simulação (passo fixo) ----------
function stepPlayer(p, dt) {
  p.t += dt; const u = p.ufo, v = ui.views[p.slot];
  if (!p.online && p.id !== "kb" && performance.now() - (p.offAt || 0) > 12000 && p.state !== 'result') { if (p.state === 'play') endMatch(p); else return leave(p); }
  let wx = 0, wz = 0, beam = false, turbo = false;
  switch (p.state) {
    case 'intro': if (p.t >= 3.2) { p.state = 'count'; p.t = 0; p.cn = 4; v.introShow(null); v.hud(true); p.cam.yaw = u.yaw; } break;
    case 'count': {
      const n = 3 - Math.floor(p.t);
      if (n !== p.cn && n >= 0) { p.cn = n; v.countShow(n > 0 ? String(n) : 'VAI!'); sound.count(n); send(p.id, { t: 'st', st: 'count', v: n }); }
      if (p.t >= 3.7) beginPlay(p);
      break;
    }
    case 'play': {
      p.left -= dt;
      if (p.comboT > 0) { p.comboT -= dt; if (p.comboT <= 0) p.combo = 0; }
      const sec = Math.ceil(p.left); if (sec !== p.lastSec) { p.lastSec = sec; if (sec <= 10 && sec > 0 && activeList().length === 1) sound.tick(); }
      if (p.left <= 0) endMatch(p);
      else { const i = inputOf(p), c = p.cam.yaw, f = [Math.sin(c), Math.cos(c)], r = [-Math.cos(c), Math.sin(c)]; wx = r[0] * i.x + f[0] * -i.y; wz = r[1] * i.x + f[1] * -i.y; beam = !!i.a; turbo = !!i.b; p.cam.inputY = i.y; }
      break;
    }
    case 'result': if (p.t > CFG.resultSeconds) leave(p); break;
  }
  if (p.active) u.step(dt, wx, wz, beam, turbo);
}
function stepSim(dt) {
  startleCd -= dt;
  const list = activeList();
  if (!list.length) { // demonstração
    const u = pool[0]; aiThink(dt, u);
    demoCfgT -= dt; if (demoCfgT <= 0) { demoCfgT = 14; u.setCfg(DEMO_CFGS[demoCfgI++ % DEMO_CFGS.length]); }
    u.step(dt, ai.wx, ai.wz, ai.beam, false);
    capys.step(dt, [u]);
    return;
  }
  for (const p of list) stepPlayer(p, dt);
  capys.step(dt, activeList().map((p) => p.ufo));
}

// ---------- layout da tela dividida ----------
function computeViews() {
  const list = activeList(), W = innerWidth, H = innerHeight;
  if (!list.length) return [{ cam: demoCam, rect: { x: 0, y: 0, w: W, h: H }, ufo: pool[0], st: 'demo' }];
  const n = list.length, g = 0; // células contíguas (divisória é DOM); evita pixels sem resolve MSAA
  const cell = (i) => {
    if (n === 1) return { x: 0, y: 0, w: W, h: H };
    if (n === 2) return { x: i * (W / 2) + (i ? g : 0), y: 0, w: W / 2 - g, h: H };
    const cx = i % 2, cy = (i / 2) | 0; return { x: cx * (W / 2) + (cx ? g : 0), y: cy * (H / 2) + (cy ? g : 0), w: W / 2 - g, h: H / 2 - g };
  };
  fillRect = n === 3 ? cell(3) : null;
  return list.map((p, i) => ({ cam: p.cam, rect: cell(i), ufo: p.ufo, st: p.state, p, slot: p.slot, cellIdx: i }));
}
function applyLayout() {
  const list = activeList(), W = innerWidth, H = innerHeight, key = `${W}x${H}:${list.map((p) => p.slot)}`;
  if (key === layoutKey) return; layoutKey = key;
  const n = list.length; ui.mode(n === 0);
  const items = views.filter((v) => v.p).map((v) => ({ slot: v.slot, rect: v.rect }));
  let join = null; const free = 4 - n;
  if (n > 0 && free > 0) {
    if (n === 3) { const c = { x: W / 2 + 2, y: H / 2 + 2, w: W / 2 - 2, h: H / 2 - 2 }; join = { x: c.x + c.w / 2, y: c.y + c.h / 2, u: c.h / 100 * 1.5 }; }
    else if (n === 2) join = { x: W / 2, y: H - H * 0.17, u: H / 100 * 0.62 };
    else join = { x: W - H * 0.2, y: H - H * 0.26, u: H / 100 * 0.72 };
  }
  ui.setLayout(items, join, free);
  world.setQuality(QUALITY[quality], Math.max(1, n));
  if (QUALITY[quality].bloom && composerMsaa !== (n > 1 ? 0 : QUALITY[quality].msaa)) resize();
  fx.setMult(QUALITY[quality].particles * (n > 2 ? 0.7 : 1));
}

// ---------- loop ----------
let last = performance.now(), acc = 0, T = 0, frames = 0, fpsT = 0, fps = 60, lowT = 0, firstFrame = true, hb = 0;
const focuses = [];
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now; T += dt;
  if (!paused) { acc += dt; let n = 0; while (acc >= STEP && n++ < 5) { stepSim(STEP); acc -= STEP; } if (n >= 5) acc = 0; }
  const alpha = paused ? 1 : acc / STEP, rdt = paused ? 0 : dt;

  pollPads(); views = computeViews(); applyLayout();
  const list = activeList();
  const ufos = list.length ? list.map((p) => p.ufo) : [pool[0]];
  ufos.forEach((u, i) => { u.render(alpha, rdt, T); const b = blobs[pool.indexOf(u)]; b.visible = true; b.position.set(u.group.position.x, 0.07, u.group.position.z); b.scale.setScalar(5.6); b.material.opacity = 0.2 + u.beamK * 0.1; });
  pool.forEach((u, i) => { if (!u.active) blobs[i].visible = false; });
  focuses.length = 0; ufos.forEach((u) => focuses.push(u.rpos));
  capys.render(alpha, rdt, T, focuses);
  world.update(rdt, T, focuses);
  for (const v of views) { if (params.has('map') && v.st === 'demo') { const c = v.cam.camera; c.position.set(0, 760, 330); c.lookAt(0, 0, 10); c.fov = 52; c.updateProjectionMatrix(); } else updateCamera(v.cam, v.ufo, v.st === 'demo' ? 'demo' : v.st, dt, T); }
  for (const v of views) { const c = v.cam.camera, a = v.rect.w / v.rect.h; if (Math.abs(c.aspect - a) > 1e-3) { c.aspect = a; c.updateProjectionMatrix(); } }
  fx.update(rdt);

  if (sound.ready) { let bk = 0, sp = 0, tb = false; ufos.forEach((u) => { bk = Math.max(bk, u.beamK); sp = Math.max(sp, u.speed); tb ||= u.turbo; }); sound.setBeam(bk * (list.length ? 1 : 0.45)); sound.setFly(sp, tb); }

  for (const p of list) {
    const v = ui.views[p.slot];
    if (p.state === 'play' || p.state === 'count') { v.score(p.score); v.time(p.state === 'count' ? CFG.matchSeconds : p.left); v.comboSet(p.combo, p.comboT / CFG.comboWindow); v.foots(capys.alive, p.nCap); }
  }
  for (const p of list) updateGuides(p, T);
  lobbyStatus();
  hb += dt; if (hb > 0.5) { hb = 0; for (const p of list) if (p.state === 'play') send(p.id, { t: 'h', sc: p.score, tm: Math.ceil(p.left), cb: p.combo, nc: p.nCap }); adminBeat(); }

  if (bloomKick > 0) bloomKick = Math.max(0, bloomKick - dt * 3);
  const q = QUALITY[quality];
  if (q.bloom && composer) { bloom.strength = 0.24 + bloomKick * 0.3 + Math.max(...ufos.map((u) => u.beamK)) * 0.08; composer.render(); }
  else {
    const pr = renderer.getPixelRatio(); void pr; renderer.setRenderTarget(null); renderer.setScissorTest(true);
    renderer.setScissor(0, 0, innerWidth, innerHeight); renderer.setViewport(0, 0, innerWidth, innerHeight); renderer.clear();
    for (const v of views) { const r = v.rect, y = innerHeight - r.y - r.h; renderer.setViewport(r.x, y, r.w, r.h); renderer.setScissor(r.x, y, r.w, r.h); beforeView(v); renderer.render(scene, v.cam.camera); }
    renderer.setScissorTest(false);
  }

  frames++; fpsT += dt;
  if (fpsT >= 2) {
    fps = frames / fpsT; frames = 0; fpsT = 0;
    if (auto && fps < 50) { lowT++; if (lowT >= 2) { lowT = 0; if (quality === 'HIGH') applyQuality('MEDIUM'); else if (quality === 'MEDIUM') applyQuality('LOW'); else if (prScale > 0.55) { prScale *= 0.88; resize(); } } } else lowT = 0;
  }
  ui.dbg(`FPS ${fps.toFixed(0)}  ${quality}${auto ? ' (auto)' : ''}  pr×${prScale.toFixed(2)}  views ${views.length}\ngeo ${renderer.info.memory.geometries}  tex ${renderer.info.memory.textures}  prog ${renderer.info.programs?.length}\njogadores ${list.length}/4`, flags.debug);
  if (firstFrame) { firstFrame = false; ui.loaded(); }
}

let lastStat = '';
function lobbyStatus() {
  const on = [...players.values()].filter((p) => p.online && p.id !== 'kb').length;
  const pads = [...players.values()].filter((p) => p.pad !== undefined && p.online).length;
  const s = activeList().length ? '' : pads ? `🎮 ${pads} CONTROLE${pads > 1 ? 'S' : ''} — APERTE START!` : on ? `${on} CONECTADO${on > 1 ? 'S' : ''} — TOQUE EM JOGAR!` : 'SEJA O PRIMEIRO PILOTO!';
  if (s !== lastStat) { lastStat = s; ui.qstat(s); }
}
function adminBeat() {
  const list = [...players.values()].map((p) => ({ id: p.id, n: p.name, on: p.online ? 1 : 0, pos: 0, sc: p.active ? p.score : p.score || 0, act: p.active ? 1 : 0 }));
  const st = activeList().length ? (activeList().some((p) => p.state === 'play') ? 'play' : 'intro') : 'demo';
  net.send({ to: 'adm', t: 'adm', st, paused: paused ? 1 : 0, left: Math.max(0, ...activeList().filter((p) => p.state === 'play').map((p) => Math.ceil(p.left))), dur: CFG.matchSeconds, caps: CFG.capyCount, q: quality, auto: auto ? 1 : 0, fps: Math.round(fps), players: list, ver: 1 });
}

// ---------- init ----------
async function init() {
  capys.setCount(CFG.capyCount);
  views = computeViews();
  applyQuality(QUALITY[quality] ? quality : 'HIGH');
  const [px, pz] = world.campus.plaza;
  const u = pool[0]; u.setActive(true); u.setCfg(DEMO_CFGS[0]); u.teleport(px + 40, pz + 40); u.yaw = u.prevYaw = Math.PI; u.rpos.copy(u.pos);
  ai.wander = world.randomSpot(null, 0); sound.sfxScale = 0.45; sound.setIntensity(0.1);
  try { const info = await (await fetch('/api/info')).json(); ui.lobby({ url: info.url, qr: '/api/qr.svg' }); lb = info.lb || []; ui.rank(lb); } catch { /* sem servidor: segue em demo */ }
  requestAnimationFrame((t) => { last = t; requestAnimationFrame(frame); });
}
window.__game = { ai, pool, act, capys, world, players, command, join, ensureKb, applyQuality, fx, sound, ui, get views() { return views; }, get fps() { return fps; }, THREE, scene, renderer, demoCam };
init();
