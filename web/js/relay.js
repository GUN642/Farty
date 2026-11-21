// Ausweich-Verbindung über öffentliche MQTT-Server (WebSocket). Funktioniert auch dort, wo eine direkte
// WebRTC-Verbindung an NAT/Firewall scheitert (Mobilfunk, manche Router): Alle Nachrichten laufen über
// den Server. Minimaler MQTT-3.1.1-Client (nur QoS 0) ohne zusätzliche Bibliothek.

// Test: ?relay=ws://localhost:9001
const TEST = /[?&]relay=([^&]+)/.exec(typeof location !== 'undefined' ? location.search : '');
export const BROKERS = TEST ? [decodeURIComponent(TEST[1])] : [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];
export const TOPIC = 'farty/v2/';

const enc = new TextEncoder(), dec = new TextDecoder();
const u16 = (n) => [(n >> 8) & 255, n & 255];
const strBytes = (s) => { const b = enc.encode(s); return [...u16(b.length), ...b]; };
function remLen(n) { const out = []; do { let b = n % 128; n = Math.floor(n / 128); if (n > 0) b |= 128; out.push(b); } while (n > 0); return out; }
function packet(type, parts) {
  let len = 0;
  for (const p of parts) len += p.length;
  const rl = remLen(len), out = new Uint8Array(1 + rl.length + len);
  out[0] = type; out.set(rl, 1);
  let o = 1 + rl.length;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export class Mqtt {
  constructor(url) {
    this.url = url;
    this.onMessage = null;
    this.onClose = null;
    this.ok = false;
    this.buf = new Uint8Array(0);
    this.pid = 1;
  }

  connect(timeout = 5000) {
    return new Promise((res, rej) => {
      let done = false;
      const fin = (e) => { if (done) return; done = true; clearTimeout(to); if (e) { try { this.ws && this.ws.close(); } catch (_) { /* egal */ } rej(e); } else res(this); };
      const to = setTimeout(() => fin(new Error('Zeitüberschreitung')), timeout);
      let ws;
      try { ws = this.ws = new WebSocket(this.url, ['mqtt']); } catch (e) { fin(e); return; }
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        const id = 'farty-' + Math.random().toString(36).slice(2, 12);
        ws.send(packet(0x10, [strBytes('MQTT'), [4, 0x02, 0, 60], strBytes(id)]));
      };
      ws.onmessage = (e) => this.data(new Uint8Array(e.data), fin);
      ws.onerror = () => fin(new Error('Verbindungsfehler'));
      ws.onclose = () => {
        const was = this.ok;
        this.ok = false;
        clearInterval(this.ping);
        fin(new Error('geschlossen'));
        if (was && this.onClose) this.onClose();
      };
    });
  }

  data(chunk, fin) {
    const b = new Uint8Array(this.buf.length + chunk.length);
    b.set(this.buf); b.set(chunk, this.buf.length);
    let o = 0;
    while (b.length - o >= 2) {
      let mul = 1, len = 0, i = o + 1, byte;
      do { if (i >= b.length) { this.buf = b.slice(o); return; } byte = b[i++]; len += (byte & 127) * mul; mul *= 128; } while (byte & 128);
      if (i + len > b.length) break;
      const type = b[o] >> 4, flags = b[o] & 15, body = b.subarray(i, i + len);
      if (type === 2) {   // CONNACK
        if (body[1] === 0) { this.ok = true; this.ping = setInterval(() => this.raw(new Uint8Array([0xC0, 0])), 25000); fin(); }
        else fin(new Error('abgelehnt ' + body[1]));
      } else if (type === 3) {   // PUBLISH
        const tl = (body[0] << 8) | body[1];
        const topic = dec.decode(body.subarray(2, 2 + tl));
        let p = 2 + tl;
        if ((flags >> 1) & 3) p += 2;
        if (this.onMessage) { try { this.onMessage(topic, dec.decode(body.subarray(p))); } catch (e) { console.error(e); } }
      }
      o = i + len;
    }
    this.buf = b.slice(o);
  }

  raw(p) { try { if (this.ws && this.ws.readyState === 1) this.ws.send(p); } catch (_) { /* egal */ } }
  sub(topic) { const id = this.pid++ & 0xffff || 1; this.raw(packet(0x82, [u16(id), strBytes(topic), [0]])); }
  pub(topic, text) { this.raw(packet(0x30, [strBytes(topic), enc.encode(text)])); }
  close() { this.ok = false; clearInterval(this.ping); this.raw(new Uint8Array([0xE0, 0])); try { this.ws.close(); } catch (_) { /* egal */ } }
}

// kleine Verbindung, die sich wie eine PeerJS-DataConnection verhält (on/send/close/open)
export function relayConn(sendFn, closeFn) {
  const h = { data: [], close: [], error: [] };
  const c = {
    open: true,
    on: (ev, f) => { (h[ev] || (h[ev] = [])).push(f); },
    emit: (ev, x) => { for (const f of h[ev] || []) f(x); },
    send: (obj) => { if (c.open) sendFn(obj); },
    close: () => { if (!c.open) return; c.open = false; try { closeFn && closeFn(); } catch (_) { /* egal */ } c.emit('close'); },
  };
  return c;
}

// erster erreichbarer Server (Mitspieler)
export async function connectFirst() {
  for (const url of BROKERS) {
    try { return await new Mqtt(url).connect(4500); } catch (_) { /* nächster */ }
  }
  return null;
}

// alle erreichbaren Server (Host – damit jeder Mitspieler ihn findet, egal welchen Server er erreicht)
export async function connectAll() {
  const res = await Promise.all(BROKERS.map((u) => new Mqtt(u).connect(6000).catch(() => null)));
  return res.filter(Boolean);
}
