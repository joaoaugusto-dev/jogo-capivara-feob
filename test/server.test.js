// Bateria do servidor: HTTP, segurança, protocolo WebSocket, robustez e carga. Rodar: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import WebSocket from 'ws';

const PORT = 3900 + ((Math.random() * 90) | 0);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-test-'));
let srv, stderr = '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (p, h = {}) => fetch(BASE + p, { headers: h });
// envia uma linha HTTP crua (fetch normaliza a URL e não deixa mandar lixo)
const raw = (line) => new Promise((res) => {
  const s = net.connect(PORT, '127.0.0.1', () => s.write(`GET ${line} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
  let d = ''; s.on('data', (c) => (d += c)); s.on('close', () => res(d)); s.on('error', () => res(d));
});

// cliente WS com fila de mensagens e espera por predicado
function client(hello) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const c = { ws, msgs: [], closed: null, waiters: [] };
  ws.on('message', (d) => { const m = JSON.parse(d); c.msgs.push(m); c.waiters = c.waiters.filter((w) => !(w.f(m) && (w.r(m), true))); });
  ws.on('close', (code) => { c.closed = code; c.waiters.forEach((w) => w.r(null)); });
  ws.on('error', () => {});
  c.send = (o) => ws.readyState === 1 && ws.send(typeof o === 'string' ? o : JSON.stringify(o));
  c.wait = (f, ms = 2000) => {
    const hit = c.msgs.find(f); if (hit) return Promise.resolve(hit);
    return new Promise((r, j) => { const t = setTimeout(() => j(new Error('timeout esperando mensagem')), ms); c.waiters.push({ f, r: (m) => { clearTimeout(t); r(m); } }); });
  };
  c.open = new Promise((r) => ws.on('open', () => { if (hello) c.send(hello); r(); }));
  c.close = () => new Promise((r) => { if (ws.readyState === 3) return r(); ws.once('close', r); ws.close(); });
  return c;
}
const player = async (tok) => { const c = client({ t: 'hello', role: 'player', tok }); await c.open; c.w = await c.wait((m) => m.t === 'w'); return c; };
const host = async () => { const c = client({ t: 'hello', role: 'host' }); await c.open; await c.wait((m) => m.t === 'lb'); return c; };

before(async () => {
  srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT, RANKING_DB: path.join(TMP, 'r.db'), HOST_IP: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', (d) => (stderr += d));
  await new Promise((res, rej) => { srv.stdout.on('data', (d) => /no ar/.test(d) && res()); srv.on('exit', (c) => rej(new Error('servidor saiu: ' + c + '\n' + stderr))); });
});
after(() => { srv.kill(); fs.rmSync(TMP, { recursive: true, force: true }); });
const alive = async () => assert.equal((await get('/api/info')).status, 200, 'servidor caiu');

// ---------------- HTTP ----------------
test('páginas e assets respondem', async () => {
  for (const p of ['/', '/join', '/admin', '/host/main.js', '/vendor/three/build/three.module.js', '/assets/lowpo+carpincho.FBX', '/assets/capivarias.png']) {
    const r = await get(p); assert.equal(r.status, 200, p); await r.arrayBuffer();
  }
  const js = await get('/host/main.js'); assert.match(js.headers.get('content-type'), /javascript/);
});

test('todo arquivo referenciado pelo host existe (import/asset quebrado = tela de erro no dia)', async () => {
  const files = fs.readdirSync('public/host').filter((f) => f.endsWith('.js'));
  const refs = new Set();
  for (const f of [...files.map((f) => 'public/host/' + f), 'public/host/index.html']) {
    const src = fs.readFileSync(f, 'utf8');
    for (const [, u] of src.matchAll(/['"(](\/(?:assets|host|vendor)\/[^'")\s`]+)['")]/g)) refs.add(u);
    for (const [, u] of src.matchAll(/from '(\.\/[^']+)'/g)) refs.add('/host/' + u.slice(2));
    for (const [, u] of src.matchAll(/from 'three\/addons\/([^']+)'/g)) refs.add('/vendor/three/examples/jsm/' + u);
  }
  const missing = [];
  for (const u of refs) { if (u.includes('${') || u.endsWith('/')) continue; const r = await get(encodeURI(u)); await r.arrayBuffer(); if (r.status !== 200) missing.push(`${u} → ${r.status}`); }
  assert.deepEqual(missing, []);
});

test('304 com If-Modified-Since (F5 não rebaixa os modelos)', async () => {
  const a = await get('/assets/lowpo+carpincho.FBX'); await a.arrayBuffer();
  const b = await get('/assets/lowpo+carpincho.FBX', { 'If-Modified-Since': a.headers.get('last-modified') });
  assert.equal(b.status, 304);
});

test('/api/info e /api/qr.svg', async () => {
  const j = await (await get('/api/info')).json();
  assert.equal(j.local, true); assert.match(j.url, /\/join$/); assert.ok(Array.isArray(j.lb));
  const q = await get('/api/qr.svg'); assert.equal(q.status, 200); assert.match(await q.text(), /<svg/);
});

test('path traversal não vaza arquivos fora de public/', async () => {
  for (const p of ['/../server/index.js', '/%2e%2e/server/index.js', '/..%2fserver%2findex.js', '/vendor/three/../../package.json', '/vendor/three/%2e%2e/%2e%2e/server/index.js', '/host/../../data/r.db']) {
    const r = await raw(p);
    assert.doesNotMatch(r, /WebSocketServer|"dependencies"|SQLite format/, p);
  }
});

test('URL malformada não derruba o servidor', async () => {
  for (const p of ['/%E0%A4%A', '/%', '/vendor/three/%zz', '/%00', '/' + 'a'.repeat(8000)]) await raw(p);
  await alive();
});

// ---------------- WebSocket: protocolo ----------------
test('jogador entra, host recebe join, input é limitado e repassado', async () => {
  const h = await host(), p = await player();
  const id = p.w.id; assert.ok(id > 0); assert.equal(typeof p.w.tok, 'string');
  await h.wait((m) => m.t === 'join' && m.id === id);
  p.send({ t: 'i', x: 99, y: -5, a: 'sim', b: 0 });
  const i = await h.wait((m) => m.t === 'i' && m.id === id);
  assert.deepEqual(i, { t: 'i', id, x: 1, y: -1, a: 1, b: 0 });
  p.send({ t: 'i', x: 'NaN', y: null, a: 0, b: 0 });
  const i2 = await h.wait((m) => m.t === 'i' && m.id === id && m.x === 0 && m.a === 0);
  assert.equal(i2.y, 0);
  await p.close(); await h.wait((m) => m.t === 'leave' && m.id === id); await h.close();
});

test('cfg: nome e personalização são sanitizados', async () => {
  const h = await host(), p = await player();
  p.send({ t: 'cfg', n: '<img src=x onerror=alert(1)>JOAO', m: 99, c: -3, s: 2.7, l: '5', b: {}, e: 5, a: 7, p: 3 });
  const c = await h.wait((m) => m.t === 'cfg' && m.id === p.w.id);
  assert.doesNotMatch(c.n, /[<>=()]/); assert.ok(c.n.length <= 12);
  assert.deepEqual(c.cfg, { m: 4, c: 0, s: 2, l: 5, b: 0, e: 5, a: 7, p: 3 });
  p.send({ t: 'cfg', n: '   ' }); assert.equal((await h.wait((m) => m.t === 'cfg' && m.n === 'VISITANTE')).n, 'VISITANTE');
  await p.close(); await h.close();
});

test('reconexão por token mantém o id e derruba a aba antiga (4001)', async () => {
  const a = await player(), b = await player(a.w.tok);
  assert.equal(b.w.id, a.w.id);
  await sleep(100); assert.equal(a.closed, 4001);
  await b.close();
});

test('host recebe de volta os jogadores já conectados ao recarregar (F5)', async () => {
  const p = await player(), h = await host();
  await h.wait((m) => m.t === 'join' && m.id === p.w.id && m.re === 1);
  await p.close(); await h.close();
});

test('segundo host derruba o primeiro (4000)', async () => {
  const h1 = await host(), h2 = await host();
  await sleep(100); assert.equal(h1.closed, 4000); assert.equal(h2.closed, null);
  await h2.close();
});

test('host repassa para um jogador, para todos e para o admin', async () => {
  const h = await host(), p1 = await player(), p2 = await player(), adm = client({ t: 'hello', role: 'admin' }); await adm.open; await adm.wait((m) => m.t === 'lb');
  h.send({ to: p1.w.id, t: 'st', st: 'play' });
  assert.equal((await p1.wait((m) => m.t === 'st')).st, 'play');
  h.send({ to: '*', t: 'pz', v: 1 });
  await p1.wait((m) => m.t === 'pz'); await p2.wait((m) => m.t === 'pz');
  assert.ok(!p2.msgs.some((m) => m.t === 'st'), 'mensagem individual vazou para outro jogador');
  h.send({ to: 'adm', t: 'adm', st: 'demo', fps: 60 });
  assert.equal((await adm.wait((m) => m.t === 'adm')).fps, 60);
  // admin que chega depois recebe o último estado
  const adm2 = client({ t: 'hello', role: 'admin' }); await adm2.open; await adm2.wait((m) => m.t === 'adm');
  for (const c of [h, p1, p2, adm, adm2]) await c.close();
});

test('admin manda comando e ele chega ao host saneado', async () => {
  const h = await host(), adm = client({ t: 'hello', role: 'admin' }); await adm.open; await adm.wait((m) => m.t === 'lb');
  adm.send({ t: 'cmd', k: 'time', v: 90 });
  assert.deepEqual(await h.wait((m) => m.t === 'cmd'), { t: 'cmd', k: 'time', v: 90 });
  adm.send({ t: 'cmd', k: 'kick'.repeat(10), v: { evil: 1 } });
  const c = await h.wait((m) => m.t === 'cmd' && m.k.startsWith('kickkick'));
  assert.equal(c.k.length, 12); assert.equal(c.v, undefined);
  await h.close(); await adm.close();
});

test('jogador não consegue se passar por host/admin nem mandar score', async () => {
  const h = await host(), p = await player();
  p.send({ t: 'score', n: 'HACK', s: 9999999 }); p.send({ to: '*', t: 'st', st: 'end' }); p.send({ t: 'cmd', k: 'reset' }); p.send({ t: 'hello', role: 'host' });
  await sleep(200);
  assert.ok(!h.msgs.some((m) => m.t === 'cmd' || m.t === 'lb' && m.lb.some((e) => e.n === 'HACK')));
  assert.equal(h.closed, null);
  await p.close(); await h.close();
});

test('ranking: score grava, ordena, sanitiza e limpa', async () => {
  const h = await host(), adm = client({ t: 'hello', role: 'admin' }); await adm.open; await adm.wait((m) => m.t === 'lb');
  h.send({ t: 'score', n: 'ANA', s: 500, c: 5, b: 2 });
  h.send({ t: 'score', n: '<b>BIA</b>', s: 900, c: 9, b: 3 });
  h.send({ t: 'score', n: 'X', s: -50 });
  const lb = (await adm.wait((m) => m.t === 'lb' && m.lb.length >= 3, 3000)).lb;
  assert.equal(lb[0].s, 900); assert.doesNotMatch(lb[0].n, /[<>]/);
  assert.ok(lb.every((e, i) => i === 0 || lb[i - 1].s >= e.s));
  assert.ok(lb.every((e) => e.s >= 0));
  adm.msgs.length = 0; adm.send({ t: 'cmd', k: 'clearlb' });
  assert.deepEqual((await adm.wait((m) => m.t === 'lb')).lb, []);
  await h.close(); await adm.close();
});

// ---------------- robustez ----------------
test('lixo no socket não derruba nada', async () => {
  const h = await host(), p = await player();
  for (const g of ['', 'null', '[]', '123', '"x"', '{', '{"t":"i","x":{"toString":1}}', '{"__proto__":{"t":"x"}}', '{"t":"cfg","n":{"a":1}}', Buffer.from([0xff, 0xfe, 0])]) p.send(g);
  p.send({ t: 'i', x: 0.5, y: 0, a: 0, b: 0 });
  await h.wait((m) => m.t === 'i' && m.x === 0.5);
  await p.close(); await h.close(); await alive();
});

test('payload gigante fecha só aquele socket', async () => {
  const p = await player();
  p.send(JSON.stringify({ t: 'cfg', n: 'x'.repeat(5000) }));
  await sleep(200); assert.notEqual(p.closed, null);
  await alive();
});

test('rate limit: flood de um jogador é cortado em ~70 msg/s', async () => {
  const h = await host(), p = await player();
  for (let i = 0; i < 500; i++) p.send({ t: 'i', x: 0, y: 0, a: i % 2, b: 0 });
  await sleep(400);
  const n = h.msgs.filter((m) => m.t === 'i' && m.id === p.w.id).length;
  assert.ok(n <= 71 && n >= 60, `repassou ${n}`);
  await p.close(); await h.close();
});

test('socket sem hello é fechado em 5 s', { timeout: 8000 }, async () => {
  const c = client(); await c.open; await sleep(5500); assert.notEqual(c.closed, null);
});

test('lotação: 41º jogador recebe 4002 e o servidor segue de pé', { timeout: 20000 }, async () => {
  // vagas de quem saiu são recicladas; só lota com 40 conectados de verdade
  const list = []; let full = null;
  for (let i = 0; i < 45 && !full; i++) {
    const c = client({ t: 'hello', role: 'player' }); await c.open;
    const r = await Promise.race([c.wait((m) => m.t === 'w').catch(() => null), new Promise((r) => c.ws.once('close', () => r('closed')))]);
    if (r === 'closed') full = c.closed; else list.push(c);
  }
  assert.equal(full, 4002); assert.equal(list.length, 40);
  for (const c of list) await c.close();
  // quem fechou libera vaga na hora para o próximo
  const novo = await player(); assert.ok(novo.w.id > 0); await novo.close();
  await alive();
});

// ---------------- carga ----------------
test('carga: host + 4 jogando a 30 Hz + 30 no lobby por 8 s — latência e perda', { timeout: 30000 }, async () => {
  const h = await host();
  const ps = [];
  for (let i = 0; i < 34; i++) { const c = client({ t: 'hello', role: 'player' }); await c.open; const w = await c.wait((m) => m.t === 'w', 1000).catch(() => null); if (!w) break; c.w = w; ps.push(c); }
  const playing = ps.slice(0, 4);
  assert.ok(playing.length === 4, `só ${ps.length} conexões aceitas`);
  const lat = [], sent = new Map();
  h.ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'i') { const t0 = sent.get(m.id + ':' + m.x); if (t0) lat.push(performance.now() - t0); } });
  let k = 0, nSent = 0;
  const iv = setInterval(() => {
    k++;
    for (const p of playing) { const x = +((k % 200) / 100 - 1).toFixed(2); sent.set(p.w.id + ':' + x, performance.now()); p.send({ t: 'i', x, y: 0, a: k % 2, b: 0 }); nSent++; }
    // host mandando HUD e estado como no jogo real
    if (k % 15 === 0) for (const p of playing) h.send({ to: p.w.id, t: 'h', sc: k, tm: 60, cb: 1, nc: 2 });
    if (k % 15 === 0) h.send({ to: 'adm', t: 'adm', st: 'play', players: ps.map((p) => ({ id: p.w.id, n: 'X' })) });
  }, 33);
  await sleep(8000); clearInterval(iv); await sleep(300);
  lat.sort((a, b) => a - b);
  const p50 = lat[lat.length >> 1], p99 = lat[Math.floor(lat.length * 0.99)], got = h.msgs.filter((m) => m.t === 'i').length;
  console.log(`  carga: enviados ${nSent}, recebidos ${got}, latência p50 ${p50?.toFixed(1)} ms p99 ${p99?.toFixed(1)} ms`);
  assert.ok(got >= nSent * 0.98, `perdeu inputs: ${got}/${nSent}`);
  assert.ok(p99 < 50, `p99 ${p99} ms`);
  for (const p of ps) await p.close(); await h.close(); await alive();
});

test('stderr do servidor sem erros inesperados', () => assert.equal(stderr.split('\n').filter((l) => l && !l.startsWith('[http]')).join('\n'), ''));
