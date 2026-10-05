// DOM do host: HUD por viewport (tela dividida), lobby e cartão de entrada.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const restart = (e, cls) => { e.classList.remove(cls); void e.offsetWidth; e.classList.add(cls); };

const TEMPLATE = `
<div class="pchip panel"><span class="ic">🛸</span><b class="pname">PILOTO</b></div>
<div class="timer panel"><span class="tval">2:00</span></div>
<div class="scorebox panel"><b class="sval">0</b><small>PTS</small></div>
<div class="combo hide"><b class="cval"></b><i><u class="cbar"></u></i></div>
<div class="foot panel">🐹 <b class="ncamp">0</b> NO CAMPUS &nbsp;·&nbsp; ✨ <b class="ngot">0</b></div>
<div class="center"><div class="banner"></div><div class="count"></div></div>
<div class="intro panel hide"><small>PILOTO</small><b class="iname"></b><span>PREPARE-SE!</span></div>
<div class="result hide"><div class="card panel"><small>FIM DE JOGO</small><h2 class="rname"></h2>
  <div class="pts"><span class="rpts">0</span><em>PTS</em></div>
  <div class="stats"><div><b class="rcap">0</b>CAPIVARAS</div><div><b class="rcmb">x1</b>MELHOR COMBO</div><div><b class="rrank">#1</b>RANKING</div></div>
  <div class="again">OLHE O CELULAR: JOGAR DE NOVO!</div></div></div>
<canvas class="mm panel"></canvas><div class="arrow hide"><i>▲</i><b></b></div>
<div class="pops"></div>`;

// um HUD completo por slot de jogador
export class ViewUI {
  constructor(parent) {
    this.el = document.createElement('div'); this.el.className = 'vp hide'; this.el.innerHTML = TEMPLATE; parent.appendChild(this.el);
    const q = (c) => this.el.querySelector('.' + c);
    for (const k of ['pname', 'tval', 'timer', 'sval', 'combo', 'cval', 'cbar', 'ncamp', 'ngot', 'banner', 'count', 'intro', 'iname', 'result', 'rname', 'rpts', 'rcap', 'rcmb', 'rrank', 'pops', 'foot', 'scorebox', 'pchip', 'mm', 'arrow']) this[k] = q(k);
    this.c = {}; this.mctx = this.mm.getContext('2d'); this.arrowI = this.arrow.querySelector('i'); this.arrowB = this.arrow.querySelector('b');
  }
  set(k, v) { if (this.c[k] !== v) { this.c[k] = v; this[k].textContent = v; } }
  layout(r) { const s = this.el.style; s.left = r.x + 'px'; s.top = r.y + 'px'; s.width = r.w + 'px'; s.height = r.h + 'px'; s.setProperty('--u', r.h / 100 + 'px'); this.r = r; this.el.classList.remove('hide'); }
  hide() { this.el.classList.add('hide'); this.c = {}; this.resetFx(); }
  resetFx() { this.intro.classList.add('hide'); this.result.classList.add('hide'); this.combo.classList.add('hide'); this.pops.innerHTML = ''; }
  hud(on) { for (const k of ['pchip', 'timer', 'scorebox', 'foot', 'mm']) this[k].classList.toggle('hide', !on); if (!on) { this.combo.classList.add('hide'); this.arrow.classList.add('hide'); } }
  // seta na borda da viewport apontando para a capivara mais próxima (ang: 0 = frente/cima, horário)
  arrowSet(show, ang, dist) {
    this.arrow.classList.toggle('hide', !show); if (!show || !this.r) return;
    const w = this.r.w, h = this.r.h, m = h * 0.1, dx = Math.sin(ang), dy = -Math.cos(ang), t = 1 / Math.max(Math.abs(dx) / (w / 2 - m * 1.6), Math.abs(dy) / (h / 2 - m * 1.6), 1e-6);
    this.arrow.style.left = w / 2 + dx * t + 'px'; this.arrow.style.top = h / 2 + dy * t + 'px'; this.arrowI.style.transform = `rotate(${ang}rad)`;
    const d = Math.round(dist / 5) * 5; if (this.c.ad !== d) { this.c.ad = d; this.arrowB.textContent = d + ' m'; }
  }
  player(n) { this.set('pname', n); }
  score(n) { if (this.c.sval !== n) { const up = this.c.sval !== undefined && n > this.c.sval; this.set('sval', n); if (up) restart(this.sval, 'bump'); } }
  time(sec) { const s = Math.max(0, Math.ceil(sec)); this.set('tval', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`); this.timer.classList.toggle('low', s <= 10 && s > 0); }
  comboSet(n, frac) {
    this.combo.classList.toggle('hide', n < 2);
    if (n < 2) { this.c.cv = 0; return; }
    if (this.c.cv !== n) { this.c.cv = n; this.cval.textContent = `COMBO x${n}`; this.cval.style.animation = 'none'; void this.cval.offsetWidth; this.cval.style.animation = ''; }
    this.cbar.style.width = `${Math.max(0, frac) * 100}%`;
  }
  foots(camp, got) { this.set('ncamp', camp); this.set('ngot', got); }
  bannerShow(html, big = false) { this.banner.innerHTML = html; this.banner.classList.toggle('big', big); restart(this.banner, 'show'); }
  countShow(txt) { this.count.textContent = txt; restart(this.count, 'show'); }
  introShow(name) { this.intro.classList.toggle('hide', !name); if (name) this.iname.textContent = name; }
  pop(x, y, text, sub, gold) {
    const d = document.createElement('div'); d.className = 'pop' + (gold ? ' gold' : ''); d.style.left = x + 'px'; d.style.top = y + 'px';
    d.innerHTML = esc(text) + (sub ? `<small>${esc(sub)}</small>` : ''); this.pops.appendChild(d); setTimeout(() => d.remove(), 1600);
  }
  resultShow(r) {
    this.result.classList.toggle('hide', !r); if (!r) return;
    this.rname.textContent = r.name; this.rcap.textContent = r.caps; this.rcmb.textContent = 'x' + r.best; this.rrank.textContent = '#' + r.rank;
    const t0 = performance.now(), el = this.rpts;
    (function tick(now) { const k = Math.min(1, ((now || performance.now()) - t0) / 1400); el.textContent = Math.round(r.score * (1 - (1 - k) ** 3)); if (k < 1) requestAnimationFrame(tick); })();
  }
}

const dividers = [];
function divider(x, y, w, h) {
  let d = dividers.pop() || Object.assign(document.createElement('div'), { className: 'div' });
  Object.assign(d.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' }); document.body.appendChild(d); return d;
}
let live = [];

export const ui = {
  views: [],
  init() { const p = $('views'); for (let i = 0; i < 4; i++) this.views.push(new ViewUI(p)); },
  // rects: viewports ativas; joinRect: onde mostrar o cartão de entrada (ou null)
  setLayout(items, joinRect, free) {
    this.views.forEach((v, i) => { const it = items.find((x) => x.slot === i); it ? v.layout(it.rect) : v.hide(); });
    const rects = items;
    live.forEach((d) => { d.remove(); dividers.push(d); }); live = [];
    const W = innerWidth, H = innerHeight, g = 4;
    if (rects.length === 2) live.push(divider(W / 2 - g / 2, 0, g, H));
    if (rects.length >= 3) { live.push(divider(W / 2 - g / 2, 0, g, H), divider(0, H / 2 - g / 2, W, g)); }
    const jc = $('joincard');
    jc.classList.toggle('hide', !joinRect);
    if (joinRect) { jc.style.left = joinRect.x + 'px'; jc.style.top = joinRect.y + 'px'; jc.style.setProperty('--u', joinRect.u + 'px'); $('slots').textContent = free === 1 ? 'ÚLTIMA VAGA!' : `${free} VAGAS`; }
  },
  mode(demo) { document.body.classList.toggle('playing', !demo); },
  pause(b) { $('pause').classList.toggle('hide', !b); },
  lobby({ url, qr }) { if (url) { $('joinurl').textContent = url.replace('http://', ''); $('joinurl2').textContent = url.replace('http://', ''); } if (qr) { $('qr').src = qr; $('qr2').src = qr; } },
  rank(lb) { $('rankl').innerHTML = lb.length ? lb.slice(0, 5).map((e) => `<li><span>${esc(e.n)}</span><b style="font-weight:400">${e.s}</b></li>`).join('') : '<li class="empty">Seja o primeiro!</li>'; },
  qstat(txt) { const e = $('qstat'); if (e.textContent !== txt) e.textContent = txt; },
  gate(show) { $('gate').classList.toggle('hide', !show); },
  loaded() { const l = $('loading'); l.classList.add('done'); setTimeout(() => l.remove(), 1000); },
  dbg(txt, show) { const e = $('dbg'); e.classList.toggle('hide', !show); if (show) e.textContent = txt; },
};
