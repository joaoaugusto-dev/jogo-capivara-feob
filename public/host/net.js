// WebSocket do host: reconecta sozinho; o servidor repassa mensagens dos celulares/admin.
export class Net {
  constructor(onMsg, onStatus) {
    this.onMsg = onMsg; this.onStatus = onStatus; this.ws = null; this.delay = 400; this.connect();
  }
  connect() {
    const ws = (this.ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`));
    ws.onopen = () => { this.delay = 400; ws.send(JSON.stringify({ t: 'hello', role: 'host', pin: new URLSearchParams(location.search).get('pin') || '' })); this.onStatus?.(true); };
    ws.onmessage = (e) => { try { this.onMsg(JSON.parse(e.data)); } catch { /* ignora lixo */ } };
    ws.onclose = (e) => { this.onStatus?.(false); if (e.code === 4000) { document.body.insertAdjacentHTML('beforeend', '<div style="position:fixed;inset:0;z-index:99;display:grid;place-items:center;background:#07070d;color:#fff;font:700 4vh sans-serif;text-align:center;padding:4vh">OUTRA TELA DO HOST ASSUMIU.<br>FECHE ESTA ABA.</div>'); return; } /* outro host assumiu: não briga por ele */ setTimeout(() => this.connect(), this.delay); this.delay = Math.min(3000, this.delay * 1.5); };
  }
  send(o) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(o)); }
}
