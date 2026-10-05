// WebSocket do host: reconecta sozinho; o servidor repassa mensagens dos celulares/admin.
export class Net {
  constructor(onMsg, onStatus) {
    this.onMsg = onMsg; this.onStatus = onStatus; this.ws = null; this.delay = 400; this.connect();
  }
  connect() {
    const ws = (this.ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`));
    ws.onopen = () => { this.delay = 400; ws.send(JSON.stringify({ t: 'hello', role: 'host' })); this.onStatus?.(true); };
    ws.onmessage = (e) => { try { this.onMsg(JSON.parse(e.data)); } catch { /* ignora lixo */ } };
    ws.onclose = () => { this.onStatus?.(false); setTimeout(() => this.connect(), this.delay); this.delay = Math.min(3000, this.delay * 1.5); };
  }
  send(o) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(o)); }
}
