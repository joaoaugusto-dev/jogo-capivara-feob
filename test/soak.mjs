// Teste de resistência do jogo no Chrome real: 4 bots jogando pelo "celular", troca de jogadores, F5 no host,
// queda do servidor, pausa e troca de qualidade. Mede FPS, frames longos, heap e recursos da GPU (vazamento).
// Uso: npm run soak                (4 min, janela visível = FPS real da GPU)
//      SOAK_MIN=30 npm run soak    (ensaio longo)   HEADLESS=1 npm run soak (sem janela; FPS não vale, só confiabilidade)
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';

const MIN = +process.env.SOAK_MIN || 4, D = MIN * 60e3, PORT = 3990, DBG = 9333;
const HEADLESS = !!process.env.HEADLESS || !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'capy-soak-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now(), el = () => ((Date.now() - t0) / 1000).toFixed(0).padStart(4) + 's';
const log = (...a) => console.log(el(), ...a);
const fails = [], errors = [];
const check = (ok, msg) => { if (!ok) { fails.push(msg); log('❌', msg); } else log('✅', msg); };

// ---------- servidor ----------
let srv;
async function startServer() {
  srv = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT, RANKING_DB: path.join(TMP, 'r.db') }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((r, j) => { srv.stdout.on('data', (d) => /no ar/.test(d) && r()); srv.once('exit', (c) => j(new Error(`servidor saiu (código ${c}) — porta ${PORT} ocupada?`))); });
}

// ---------- bots (celulares) ----------
class Bot {
  constructor(n) { this.n = n; this.tok = ''; this.st = ''; this.alive = true; this.ang = Math.random() * 6; this.beamT = 0; this.plays = 0; this.connect(); }
  connect() {
    const ws = (this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`));
    ws.on('open', () => ws.send(JSON.stringify({ t: 'hello', role: 'player', tok: this.tok })));
    ws.on('message', (d) => this.onMsg(JSON.parse(d)));
    ws.on('close', (c) => { this.st = ''; if (this.alive && c !== 4001) setTimeout(() => this.alive && this.connect(), 600); });
    ws.on('error', () => {});
  }
  tx(o) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  onMsg(m) {
    if (m.t === 'w') { this.tok = m.tok; this.tx({ t: 'cfg', n: 'BOT' + this.n, m: this.n % 5, c: (this.n * 3) % 12, s: this.n % 4, l: this.n % 8, b: this.n % 6, e: this.n % 6, a: this.n % 8, p: this.n % 4 }); this.tx({ t: 'q' }); }
    if (m.t !== 'st') return;
    this.st = m.st;
    if (m.st === 'play') this.plays++;
    if (m.st === 'end' || m.st === 'idle' || m.st === 'full') setTimeout(() => this.alive && this.tx({ t: 'q' }), m.st === 'end' ? 1500 : 2500);
  }
  tick() { // joystick vagando + raio em rajadas + turbo de vez em quando, ~30 Hz como o controle real
    if (this.st !== 'play' && this.st !== 'count') return;
    this.ang += (Math.random() - 0.5) * 0.3; this.beamT -= 0.033;
    if (this.beamT < -2.5) this.beamT = 1 + Math.random() * 2;
    const beam = this.beamT > 0;
    this.tx({ t: 'i', x: +(Math.sin(this.ang) * (beam ? 0.3 : 1)).toFixed(2), y: +(-Math.abs(Math.cos(this.ang)) * (beam ? 0.3 : 1)).toFixed(2), a: beam ? 1 : 0, b: Math.random() < 0.01 ? 1 : 0 });
  }
  leave() { this.alive = false; this.ws.close(); }
}
let bots = [], botN = 0;
const addBot = () => bots.push(new Bot(++botN));
setInterval(() => bots.forEach((b) => b.tick()), 33);

// ---------- admin ----------
let adm, lastAdm = {};
function admin() {
  adm = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  adm.on('open', () => adm.send(JSON.stringify({ t: 'hello', role: 'admin' })));
  adm.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'adm') lastAdm = m; });
  adm.on('close', () => setTimeout(admin, 600)); adm.on('error', () => {});
}
const cmd = (k, v) => adm.readyState === 1 && adm.send(JSON.stringify({ t: 'cmd', k, v }));

// ---------- Chrome + CDP ----------
function chromeBin() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const b of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) try { return execSync(`command -v ${b}`, { encoding: 'utf8' }).trim(); } catch { /* próximo */ }
  throw new Error('Chrome/Chromium não encontrado (defina CHROME=/caminho)');
}
let chrome, page, navs = 0;
async function startChrome() {
  chrome = spawn(chromeBin(), [
    ...(HEADLESS ? ['--headless=new'] : []), `--remote-debugging-port=${DBG}`, `--user-data-dir=${path.join(TMP, 'chrome')}`, '--no-first-run', '--no-default-browser-check',
    '--window-size=1920,1080', '--window-position=0,0', '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info', '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', `http://localhost:${PORT}/`,
  ], { stdio: 'ignore' });
  let target;
  for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${DBG}/json/list`)).json()).find((t) => t.type === 'page' && t.url.includes(`:${PORT}`)); } catch { /* subindo */ } }
  if (!target) throw new Error('não achei a aba do jogo no Chrome');
  const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 1 << 28 });
  await new Promise((r) => ws.on('open', r));
  let id = 0; const pend = new Map();
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.id) { const p = pend.get(m.id); pend.delete(m.id); return m.error ? p.j(new Error(m.error.message)) : p.r(m.result); }
    if (m.method === 'Runtime.exceptionThrown') { const e = m.params.exceptionDetails; errors.push(`exceção: ${e.exception?.description || e.text}`); log('💥', errors.at(-1)); }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') { errors.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' ')); log('💥', errors.at(-1)); }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !(phase === 'srv caiu' && /ERR_CONNECTION_REFUSED/.test(m.params.entry.text))) { errors.push('log: ' + m.params.entry.text + ' ' + (m.params.entry.url || '')); log('💥', errors.at(-1)); }
    if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) navs++;
  });
  page = (method, params = {}) => new Promise((r, j) => { const i = ++id; pend.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); });
  await page('Runtime.enable'); await page('Log.enable'); await page('Page.enable');
}
const ev = async (expr) => { const r = await page('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result.value; };

async function waitLoaded(ms = 90e3) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await ev(`(() => { const m = document.getElementById('ld-msg'); return { err: m && m.textContent, ok: !!window.__game && (!document.getElementById('loading') || document.getElementById('loading').classList.contains('done')) }; })()`).catch(() => ({}));
    if (s.err) throw new Error('tela de loading mostrou erro: ' + s.err);
    if (s.ok) {
      await ev(`(() => { if (window.__ft) return; const a = window.__ft = []; let l = performance.now(); const f = (t) => { a.push(t - l); l = t; requestAnimationFrame(f); }; requestAnimationFrame(f); })()`);
      return Date.now() - (end - ms);
    }
    await sleep(500);
  }
  throw new Error('jogo não carregou em ' + ms / 1000 + ' s');
}
const until = async (f, ms, msg) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await sleep(500); } check(false, msg); return false; };
const activeOnHost = () => ev('window.__game.act.filter(Boolean).length').catch(() => -1);
const playingBots = () => bots.filter((b) => b.alive && (b.st === 'play' || b.st === 'count' || b.st === 'intro')).length;

// ---------- amostragem ----------
let phase = 'boot';
const samples = [];
async function sample(phase) {
  const s = await ev(`(() => { const g = window.__game, ft = window.__ft.splice(0).sort((a, b) => a - b), i = g.renderer.info;
    return { fps: g.fps, q: (document.getElementById('dbg').textContent.match(/(LOW|MEDIUM|HIGH)[^\\n]*?pr×[\\d.]+/) || [''])[0], n: g.act.filter(Boolean).length,
      p50: ft[ft.length >> 1] || 0, p95: ft[Math.floor(ft.length * 0.95)] || 0, max: ft.at(-1) || 0, long: ft.filter((x) => x > 50).length, frames: ft.length,
      heap: performance.memory.usedJSHeapSize / 1048576, geo: i.memory.geometries, tex: i.memory.textures, prog: i.programs.length, capys: g.capys.list.length, stex: (() => { const set = new Set(); g.scene.traverse((o) => [].concat(o.material || []).forEach((m) => { for (const k in m) if (m[k]?.isTexture) set.add(m[k]); })); return set.size; })(), dom: document.getElementsByTagName('*').length }; })()`).catch(() => null);
  if (!s) return;
  s.phase = phase; s.t = (Date.now() - t0) / 1000; samples.push(s);
  log(`${phase.padEnd(10)} jog ${s.n} fps ${s.fps.toFixed(0).padStart(3)} | frame p50 ${s.p50.toFixed(1)} p95 ${s.p95.toFixed(1)} max ${s.max.toFixed(0).padStart(4)} ms longos ${String(s.long).padStart(3)} | heap ${s.heap.toFixed(0)} MB geo ${s.geo} tex ${s.tex}/${s.stex} prog ${s.prog} dom ${s.dom} capys ${s.capys}`);
}
const gcHeap = async () => { await page('HeapProfiler.collectGarbage'); await sleep(300); return ev('performance.memory.usedJSHeapSize / 1048576'); };

// ---------- roteiro ----------
async function main() {
  await startServer(); admin(); await startChrome();
  const gl = await ev(`(() => { const g = window.__game?.renderer.getContext() || document.createElement('canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); })()`).catch(() => '?');
  log(`Chrome ${HEADLESS ? 'headless' : 'com janela'} · GPU: ${gl} · duração ${MIN} min`);
  if (/swiftshader|llvmpipe|software/i.test(gl)) log('⚠️  renderização por software: FPS NÃO representa o PC da feira; vale só para confiabilidade/vazamento');
  const lt = await waitLoaded(); log(`carregou em ${(lt / 1000).toFixed(1)} s`);
  check(lt < 30e3, `loading < 30 s (${(lt / 1000).toFixed(1)} s)`);
  const sampler = setInterval(() => sample(phase), 5000);

  phase = 'demo'; await sleep(15e3);
  phase = 'entrando';
  for (let i = 0; i < 4; i++) { addBot(); await sleep(6e3); }
  await until(async () => (await activeOnHost()) === 4, 20e3, '4 jogadores ativos no host') && log('✅ 4 jogadores ativos no host');
  // 5º jogador: deve receber "mesa cheia" e entrar quando abrir vaga
  addBot(); await sleep(3e3); check(bots.at(-1).st === 'full', `5º jogador recebe "mesa cheia" (${bots.at(-1).st})`);

  phase = '4 jogando'; await sleep(20e3);
  const heap0 = await gcHeap(), r0 = samples.at(-1); log(`heap de referência (pós-GC): ${heap0.toFixed(1)} MB`);

  phase = 'pausa'; cmd('pause'); await sleep(3e3);
  const pz = await ev('document.getElementById("pause").classList.contains("hide")'); check(!pz, 'pausa pelo admin aparece na tela');
  cmd('pause'); await sleep(2e3);

  const rest = () => D - (Date.now() - t0);
  // troca de jogadores (sai um, entra outro) durante todo o ensaio
  const churn = setInterval(() => { const b = bots.find((x) => x.alive && x.st === 'play'); if (b) { b.leave(); addBot(); log(`🔁 BOT${b.n} saiu, BOT${botN} entrou`); } }, 30e3);

  phase = 'jogando'; await sleep(Math.max(10e3, rest() * 0.3));

  phase = 'F5 host'; log('🔄 recarregando a tela do host (F5)');
  await ev('delete window.__ft'); await page('Page.reload');
  await sleep(1500); await waitLoaded();
  await until(async () => (await activeOnHost()) >= 3, 40e3, 'após F5 os celulares voltam a jogar') && log('✅ após F5 os celulares voltam a jogar');

  phase = 'jogando'; await sleep(Math.max(10e3, rest() * 0.3));

  phase = 'srv caiu'; log('🔌 derrubando e religando o servidor');
  srv.kill('SIGKILL'); await sleep(3e3); await startServer();
  await until(async () => playingBots() >= 3 && (await activeOnHost()) >= 3, 45e3, 'após queda do servidor os jogadores voltam') && log('✅ após queda do servidor os jogadores voltam');

  phase = 'qualidade';
  for (const q of ['LOW', 'MEDIUM', 'HIGH', 'AUTO']) { cmd('quality', q); await sleep(5e3); }

  phase = 'jogando'; await sleep(Math.max(15e3, rest()));
  clearInterval(churn); clearInterval(sampler);

  // ---------- veredito ----------
  const heap1 = await gcHeap(), r1 = samples.at(-1);
  log(`heap pós-GC: ${heap0.toFixed(1)} → ${heap1.toFixed(1)} MB (após F5 o heap reinicia; compare com o ensaio longo)`);
  const steady = samples.filter((s) => s.n === 4 && s.phase !== 'pausa' && s.phase !== 'qualidade');
  const avg = (k, l = steady) => l.reduce((a, s) => a + s[k], 0) / Math.max(1, l.length);
  const geoTrend = samples.filter((s) => s.t > samples.at(-1).t * 0.6), first = geoTrend[0], last = geoTrend.at(-1);
  console.log('\n================ RESUMO ================');
  console.log(`GPU: ${gl}`);
  console.log(`4 jogadores: FPS médio ${avg('fps').toFixed(0)} · mínimo ${Math.min(...steady.map((s) => s.fps)).toFixed(0)} · frame p95 médio ${avg('p95').toFixed(1)} ms · frames > 50 ms: ${steady.reduce((a, s) => a + s.long, 0)} de ${steady.reduce((a, s) => a + s.frames, 0)}`);
  console.log(`maior travada: ${Math.max(...samples.map((s) => s.max)).toFixed(0)} ms · recursos GPU (último terço): geo ${first?.geo}→${last?.geo} tex ${first?.tex}→${last?.tex} programas ${first?.prog}→${last?.prog}`);
  console.log(`partidas iniciadas pelos bots: ${bots.reduce((a, b) => a + b.plays, 0)} · recarregamentos inesperados da página: ${navs - 2}`);
  check(errors.length === 0, `sem erros no console/exceções (${errors.length})`);
  check(navs - 2 <= 0, 'página não recarregou sozinha (WebGL context lost)');
  check(!last || !first || last.geo - first.geo < 40, `geometrias não crescem sem parar (${first?.geo}→${last?.geo})`);
  // texturas sobem sob demanda (fachada entra na tela pela 1ª vez) até um teto; vazamento = continuar subindo depois disso
  check(!r0 || !r1 || r1.tex - r0.tex < 20, `texturas na GPU estáveis (${r0?.tex} → ${r1?.tex})`);
  // trocar qualidade compila variantes novas (uma vez cada); fora disso o número de shaders não pode mudar
  const preQ = samples.filter((s) => s.phase !== 'qualidade' && s.t < (samples.find((x) => x.phase === 'qualidade')?.t ?? 1e9)).at(-1), postQ = samples.find((s, i) => i && samples[i - 1].phase === 'qualidade');
  check(!r0 || !preQ || preQ.prog === r0.prog, `shaders estáveis jogando (${r0?.prog} → ${preQ?.prog})`);
  check(!postQ || !r1 || postQ.prog === r1.prog, `shaders estáveis após trocar qualidade (${postQ?.prog} → ${r1?.prog})`);
  check(!r0 || !r1 || r1.dom - r0.dom < 200, `DOM não cresce (${r0?.dom} → ${r1?.dom})`);
  if (!HEADLESS) check(avg('fps') >= 50, `FPS médio com 4 jogadores ≥ 50 (${avg('fps').toFixed(0)})`);
  fs.writeFileSync(path.join('test', 'soak-result.json'), JSON.stringify({ gl, samples, errors, fails }, null, 1));
  console.log(fails.length ? `\n${fails.length} FALHA(S):\n - ${fails.join('\n - ')}` : '\nTUDO OK');
}

const cleanup = () => { try { chrome?.kill(); srv?.kill(); } catch { /* já morto */ } fs.rmSync(TMP, { recursive: true, force: true }); };
main().then(() => { cleanup(); process.exit(fails.length ? 1 : 0); }, (e) => { console.error('ABORTOU:', e.message); cleanup(); process.exit(2); });
process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });
