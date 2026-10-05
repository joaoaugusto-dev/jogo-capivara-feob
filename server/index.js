// OVNI x CAPIVARAS — servidor da feira. Sem banco, sem internet: tudo em memória na rede local.
//
// PROTOCOLO WebSocket (JSON compacto, endpoint /ws)
//  Cliente -> servidor (primeira mensagem sempre "hello"):
//   {t:'hello', role:'host'|'player'|'admin', tok?, pin?}   (host/admin só de localhost, admin aceita pin)
//   player:  {t:'cfg', n:'NOME', m:0-4, c:0-11, s:0-3, l:0-7, b:0-5, e:0-5, a:0-7, p:0-3}  nome + personalização
//            {t:'q'}                       entrar na fila / jogar de novo
//            {t:'i', x:-1..1, y:-1..1, a:0|1, b:0|1}  input (x direita+, y: -1 = frente/cima na tela)
//   admin:   {t:'cmd', k:'start|pause|reset|end|time|caps|quality|clearlb|kick', v?}
//   host:    {to:id|'*'|'adm', ...}        repassa o resto da mensagem ao(s) jogador(es)/admins
//            {t:'score', n, s}             grava no ranking (em memória)
//  Servidor -> cliente:
//   player:  {t:'w', id, tok}   boas-vindas | demais mensagens vindas do host (st/h/ev/...)
//   host:    {t:'join', id, n, cfg} {t:'leave', id} {t:'cfg', id, ...} {t:'q', id} {t:'i', id, x,y,a,b} {t:'cmd', ...}
//            {t:'lb', lb:[...]}
//   admin:   mensagens {to:'adm'} do host (estado) + {t:'lb'}
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite'; // SQLite embutido no Node (22.5+), sem dependência extra
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const THREE = path.join(ROOT, 'node_modules', 'three');
const PORT = +process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '';
const MAX_PLAYERS = 40;

// ---------- ranking persistente (SQLite em arquivo local) ----------
const DB_PATH = process.env.RANKING_DB || path.join(ROOT, 'data', 'ranking.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS scores(
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, score INTEGER NOT NULL,
  caps INTEGER NOT NULL DEFAULT 0, best INTEGER NOT NULL DEFAULT 1,
  cleared INTEGER NOT NULL DEFAULT 0, ts TEXT NOT NULL DEFAULT (datetime('now','localtime')));
CREATE INDEX IF NOT EXISTS idx_scores_ts ON scores(ts, score DESC);`);
const qInsert = db.prepare('INSERT INTO scores(name, score, caps, best) VALUES (?,?,?,?)');
const qTop = db.prepare("SELECT name AS n, score AS s FROM scores WHERE cleared=0 AND date(ts)=date('now','localtime') ORDER BY score DESC, id LIMIT 20");
const qClear = db.prepare("UPDATE scores SET cleared=1 WHERE date(ts)=date('now','localtime')"); // 'limpar' só esconde do ranking do dia; o histórico fica no arquivo
const getLB = () => qTop.all().map((r) => ({ n: r.n, s: r.s }));

// ---------- rede ----------
function lanIPs() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (/^(docker|br-|veth|virbr|vmnet|vboxnet|lo)/.test(name)) continue;
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  // prefere faixas privadas comuns de roteador
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b));
}
const localAddrs = () => new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', ...lanIPs(), ...lanIPs().map((i) => '::ffff:' + i)]);
const isLocal = (req) => localAddrs().has(req.socket.remoteAddress);
const hostIP = () => process.env.HOST_IP || lanIPs()[0] || 'localhost';
const joinURL = () => `http://${hostIP()}:${PORT}/join`;

// ---------- http estático ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const PAGES = { '/': 'host/index.html', '/join': 'join/index.html', '/admin': 'admin/index.html' };

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(body);
}
function serveFile(res, file) {
  fs.readFile(file, (err, data) => (err ? send(res, 404, 'not found') : send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream')));
}
function safeJoin(base, rel) {
  const f = path.normalize(path.join(base, rel));
  return f.startsWith(base) ? f : null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
  if (p === '/api/info') {
    const local = isLocal(req);
    return send(res, 200, JSON.stringify({ url: joinURL(), ips: lanIPs(), port: PORT, local, lb: getLB() }), MIME['.json']);
  }
  if (p === '/api/qr.svg') {
    const svg = await QRCode.toString(joinURL(), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    return send(res, 200, svg, MIME['.svg']);
  }
  if (PAGES[p]) return serveFile(res, path.join(PUB, PAGES[p]));
  if (p.startsWith('/vendor/three/')) {
    const f = safeJoin(THREE, p.slice('/vendor/three/'.length));
    return f ? serveFile(res, f) : send(res, 403, 'forbidden');
  }
  const f = safeJoin(PUB, p);
  return f ? serveFile(res, f) : send(res, 403, 'forbidden');
});

// ---------- websocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });
let host = null;
const admins = new Set();
const players = new Map(); // id -> {id, tok, ws, name, cfg, last, n, win}
const byTok = new Map();
let lastAdm = null;
let nextId = 1;

const tx = (ws, o) => ws && ws.readyState === 1 && ws.send(JSON.stringify(o));
const clamp = (v, a, b) => (Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : 0);
const int = (v, max) => Math.min(max, Math.max(0, v | 0));
const cleanName = (s) => String(s ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 12) || 'VISITANTE';

function validCfg(m) {
  return { m: int(m.m, 4), c: int(m.c, 11), s: int(m.s, 3), l: int(m.l, 7), b: int(m.b, 5), e: int(m.e, 5), a: int(m.a, 7), p: int(m.p, 3) };
}
function pushLB() {
  const m = { t: 'lb', lb: getLB() };
  tx(host, m);
  admins.forEach((a) => tx(a, m));
}

wss.on('connection', (ws, req) => {
  let me = null; // {role, player?}
  const local = isLocal(req);
  const hello = setTimeout(() => !me && ws.close(), 5000);

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object') return;

    if (!me) {
      if (m.t !== 'hello') return;
      clearTimeout(hello);
      if (m.role === 'host') {
        if (!local) return ws.close(4003, 'host só de localhost');
        if (host && host !== ws) host.close(4000, 'novo host');
        host = ws; me = { role: 'host' };
        tx(ws, { t: 'lb', lb: getLB() });
        players.forEach((p) => p.ws && tx(ws, { t: 'join', id: p.id, n: p.name, cfg: p.cfg, re: 1 }));
      } else if (m.role === 'admin') {
        if (!local && !(ADMIN_PIN && m.pin === ADMIN_PIN)) return ws.close(4003, 'admin negado');
        admins.add(ws); me = { role: 'admin' };
        tx(ws, { t: 'lb', lb: getLB() });
        lastAdm && tx(ws, lastAdm);
      } else {
        // player (reconexão por token)
        let p = typeof m.tok === 'string' ? byTok.get(m.tok) : null;
        if (p) {
          if (p.ws && p.ws !== ws) p.ws.close(4001, 'outra aba');
          p.ws = ws;
        } else {
          if (players.size >= MAX_PLAYERS) return ws.close(4002, 'lotado');
          p = { id: nextId++, tok: randomBytes(9).toString('base64url'), ws, name: 'VISITANTE', cfg: validCfg({}), last: 0, n: 0, win: 0 };
          players.set(p.id, p); byTok.set(p.tok, p);
        }
        me = { role: 'player', p };
        tx(ws, { t: 'w', id: p.id, tok: p.tok });
        tx(host, { t: 'join', id: p.id, n: p.name, cfg: p.cfg, re: 1 });
      }
      return;
    }

    if (me.role === 'player') {
      const p = me.p;
      // rate limit: 70 msgs/s por jogador
      const now = Date.now();
      if (now - p.win > 1000) { p.win = now; p.n = 0; }
      if (++p.n > 70) return;
      if (m.t === 'i') {
        tx(host, { t: 'i', id: p.id, x: +clamp(m.x, -1, 1).toFixed(2), y: +clamp(m.y, -1, 1).toFixed(2), a: m.a ? 1 : 0, b: m.b ? 1 : 0 });
      } else if (m.t === 'cfg') {
        p.name = cleanName(m.n); p.cfg = validCfg(m);
        tx(host, { t: 'cfg', id: p.id, n: p.name, cfg: p.cfg });
      } else if (m.t === 'q') {
        tx(host, { t: 'q', id: p.id });
      }
    } else if (me.role === 'admin') {
      if (m.t === 'cmd' && typeof m.k === 'string') {
        if (m.k === 'clearlb') { qClear.run(); pushLB(); }
        else tx(host, { t: 'cmd', k: m.k.slice(0, 12), v: typeof m.v === 'number' ? m.v : typeof m.v === 'string' ? m.v.slice(0, 12) : undefined });
      }
    } else if (me.role === 'host') {
      if (m.t === 'score') {
        qInsert.run(cleanName(m.n), int(m.s, 1e7), int(m.c, 1e5), Math.max(1, int(m.b, 1e3)));
        return pushLB();
      }
      const { to, ...msg } = m;
      if (to === 'adm') { if (msg.t === 'adm') lastAdm = msg; admins.forEach((a) => tx(a, msg)); }
      else if (to === '*') players.forEach((p) => tx(p.ws, msg));
      else if (players.has(to)) tx(players.get(to).ws, msg);
    }
  });

  ws.on('close', () => {
    clearTimeout(hello);
    if (!me) return;
    if (me.role === 'host' && host === ws) host = null;
    else if (me.role === 'admin') admins.delete(ws);
    else if (me.role === 'player' && me.p.ws === ws) {
      me.p.ws = null;
      tx(host, { t: 'leave', id: me.p.id });
      // esquece o jogador depois de 2 min sem reconectar
      const p = me.p;
      setTimeout(() => { if (!p.ws) { players.delete(p.id); byTok.delete(p.tok); tx(host, { t: 'gone', id: p.id }); } }, 120000);
    }
  });
  ws.on('error', () => {});
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = lanIPs();
  console.log('\n  🛸  OVNI x CAPIVARAS — servidor no ar\n');
  console.log(`  TELA (abrir no PC da feira):  http://localhost:${PORT}/`);
  console.log(`  CONTROLE (QR / celular):      ${joinURL()}`);
  console.log(`  ADMIN (só neste PC):          http://localhost:${PORT}/admin`);
  console.log(`  RANKING (SQLite):             ${DB_PATH}`);
  if (ips.length > 1) console.log(`  outros IPs detectados: ${ips.join(', ')}  (force com HOST_IP=...)`);
  console.log('');
});
