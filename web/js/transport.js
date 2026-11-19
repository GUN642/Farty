// Mehrspieler-Transport (übernommen aus medevac-sim)
//
// Ein Gerät eröffnet das Spiel (Host), weitere treten bei. Der Host berechnet das Floß, die anderen
// schicken nur ihre Steuerung und bekommen Schnappschüsse.
//
// Transport: in der Android-App über window.AndroidApp (LanNet.java: TCP + UDP-Broadcast zur
// Spielsuche im WLAN) und zusätzlich per Spielcode (WebRTC/PeerJS). Im Browser nur per Spielcode.
// Für Tests gibt es mit "?net=test" einen BroadcastChannel-Transport zwischen zwei Tabs.

function androidTransport() {
  const A = window.AndroidApp;
  if (!A || !A.netHost) return null;
  return {
    kind: 'lan',
    host: (info) => A.netHost(JSON.stringify(info)),
    info: (info) => A.netInfo(JSON.stringify(info)),
    join: (ip, port) => A.netJoin(String(ip), port | 0),
    send: (peer, obj) => A.netSend(peer, JSON.stringify(obj)),
    poll: () => {
      const s = A.netPoll(), out = [];
      if (!s) return out;
      for (const line of s.split('\n')) {
        const i = line.indexOf('\t');
        if (i < 0) continue;
        try { out.push({ p: +line.slice(0, i), m: JSON.parse(line.slice(i + 1)) }); } catch (e) { /* defekte Nachricht */ }
      }
      return out;
    },
    scan: (on) => A.netScan(!!on),
    hosts: () => { try { return JSON.parse(A.netHosts()); } catch (e) { return []; } },
    ip: () => A.netIp(),
    deviceName: () => (A.deviceName ? A.deviceName() : 'Android'),
    stop: () => A.netStop(),
  };
}

function testTransport() {
  const ch = new BroadcastChannel('farty-net'), tok = Math.random().toString(36).slice(2, 8);
  const inbox = [], peers = new Map(), toks = new Map(), hosts = new Map();
  let role = null, hostTok = null, nextId = 1, info = null, beacon = null;
  ch.onmessage = (e) => {
    const d = e.data;
    if (d.k === 'beacon') { hosts.set(d.tok, { ip: 'test-' + d.tok, port: 1, info: d.info, t: Date.now() }); return; }
    if (role === 'host') {
      if (d.k === 'join' && d.to === tok) {
        const id = nextId++; peers.set(id, d.tok); toks.set(d.tok, id);
        ch.postMessage({ k: 'acc', to: d.tok, from: tok }); inbox.push({ p: id, m: { t: '_join' } });
      } else if (d.k === 'msg' && d.to === tok && toks.has(d.from)) inbox.push({ p: toks.get(d.from), m: d.m });
      else if (d.k === 'bye' && toks.has(d.from)) { const id = toks.get(d.from); toks.delete(d.from); peers.delete(id); inbox.push({ p: id, m: { t: '_leave' } }); }
    } else if (role === 'client') {
      if (d.k === 'acc' && d.to === tok) inbox.push({ p: 0, m: { t: '_open' } });
      else if (d.k === 'msg' && d.from === hostTok && (d.to === tok || d.to === '*')) inbox.push({ p: 0, m: d.m });
      else if (d.k === 'bye' && d.from === hostTok) inbox.push({ p: 0, m: { t: '_leave' } });
    }
  };
  window.addEventListener('beforeunload', () => { if (role) ch.postMessage({ k: 'bye', from: tok }); });
  return {
    kind: 'test',
    host: (inf) => { role = 'host'; info = inf; beacon = setInterval(() => ch.postMessage({ k: 'beacon', tok, info }), 400); return 'ok:test:1'; },
    info: (inf) => { info = inf; },
    join: (ip) => { role = 'client'; hostTok = String(ip).replace('test-', ''); ch.postMessage({ k: 'join', to: hostTok, tok }); },
    send: (peer, m) => {
      if (role === 'host') {
        if (peer < 0) ch.postMessage({ k: 'msg', from: tok, to: '*', m });
        else if (peers.has(peer)) ch.postMessage({ k: 'msg', from: tok, to: peers.get(peer), m });
      } else if (role === 'client') ch.postMessage({ k: 'msg', from: tok, to: hostTok, m });
    },
    poll: () => inbox.splice(0),
    scan: () => {},
    hosts: () => [...hosts.values()].filter((h) => Date.now() - h.t < 2500),
    ip: () => 'test',
    deviceName: () => 'Browser',
    stop: () => { if (beacon) clearInterval(beacon); beacon = null; if (role) ch.postMessage({ k: 'bye', from: tok }); role = null; },
  };
}

// ------------------------------------------------------------ Browser: WebRTC über PeerJS
// Der Host meldet sich mit einem kurzen Spielcode beim öffentlichen PeerJS-Vermittlungsserver
// (0.peerjs.com, ohne Anmeldung) an; die Spieldaten laufen danach direkt zwischen den Geräten.
// Eine Spielsuche gibt es nicht – Mitspieler geben den Code ein oder öffnen den Einladungslink.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PEER_PREFIX = 'farty-v1-';
export const isGameCode = (s) => /^[A-Z0-9]{4,6}$/i.test(String(s).trim()) && !/^\d+$/.test(String(s).trim());
const newCode = () => Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');

let peerLib = null;
export function loadPeerJs() {
  if (window.peerjs && window.peerjs.Peer) return Promise.resolve(window.peerjs.Peer);
  if (!peerLib) {
    peerLib = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = new URL('./lib/peerjs.min.js', import.meta.url).href;
      s.onload = () => (window.peerjs && window.peerjs.Peer ? res(window.peerjs.Peer) : rej(new Error('PeerJS fehlt')));
      s.onerror = () => { peerLib = null; rej(new Error('PeerJS konnte nicht geladen werden')); };
      document.head.appendChild(s);
    });
  }
  return peerLib;
}

// eigener Vermittlungsserver nur für Tests: ?peer=localhost:9000
export function peerOptions() {
  const m = /[?&]peer=([^&]+)/.exec(location.search);
  if (!m) return { debug: 0 };
  const [host, port] = decodeURIComponent(m[1]).split(':');
  return { host, port: +port || 9000, path: '/', secure: false, debug: 0 };
}

export function peerTransport() {
  if (!window.RTCPeerConnection) return null;
  const inbox = [], conns = new Map(), seen = new Map();
  let peer = null, role = null, code = null, nextId = 1, hostConn = null, status = '', beat = null;
  const push = (p, m) => inbox.push({ p, m });

  // Herzschlag: geschlossene Tabs/abgerissene Verbindungen werden sonst erst spät bemerkt
  const startBeat = () => {
    if (beat) return;
    beat = setInterval(() => {
      const now = Date.now();
      if (role === 'host') {
        for (const [id, c] of conns) {
          if (c.open) c.send({ t: '_ping' });
          if (now - (seen.get(id) || now) > 20000) { conns.delete(id); try { c.close(); } catch (e) { /* egal */ } push(id, { t: '_leave' }); }
        }
      } else if (role === 'client' && hostConn) {
        if (hostConn.open) hostConn.send({ t: '_ping' });
        if (now - (seen.get(0) || now) > 20000) { const c = hostConn; hostConn = null; try { c.close(); } catch (e) { /* egal */ } push(0, { t: '_leave' }); }
      }
    }, 2000);
  };

  const wire = (c, id) => {
    c.on('data', (d) => {
      if (role === 'host' && conns.get(id) !== c) return;
      seen.set(id, Date.now());
      if (d && typeof d === 'object' && d.t !== '_ping') push(id, d);
    });
    c.on('close', () => {
      if (role === 'host') { if (conns.delete(id)) push(id, { t: '_leave' }); }
      else if (role === 'client' && c === hostConn) { hostConn = null; push(0, { t: '_leave' }); }
    });
    c.on('error', () => {});
  };

  const startHost = (Peer, tries = 0) => {
    code = newCode();
    const p = new Peer(PEER_PREFIX + code, peerOptions());
    peer = p;
    p.on('open', () => { status = 'ready'; });
    p.on('connection', (c) => {
      c.on('open', () => {
        const id = nextId++;
        conns.set(id, c);
        seen.set(id, Date.now());
        wire(c, id);
        startBeat();
        push(id, { t: '_join' });
      });
    });
    p.on('disconnected', () => { if (role === 'host' && !p.destroyed) setTimeout(() => { try { p.reconnect(); } catch (e) { /* egal */ } }, 2000); });
    p.on('error', (e) => {
      if (e.type === 'unavailable-id' && tries < 4) { p.destroy(); startHost(Peer, tries + 1); return; }
      if (['network', 'server-error', 'socket-error', 'browser-incompatible', 'ssl-unavailable'].includes(e.type) && status !== 'ready') status = 'err:' + e.type;
    });
  };

  return {
    kind: 'peer',
    // liefert sofort den Code; die Anmeldung beim Vermittlungsserver läuft im Hintergrund
    host: () => {
      role = 'host'; status = 'pending';
      code = newCode();
      loadPeerJs().then((Peer) => startHost(Peer)).catch(() => { status = 'err:lib'; });
      return 'pending';
    },
    code: () => code,
    status: () => status,
    info: () => {},
    join: (target) => {
      role = 'client';
      const want = String(target).trim().toUpperCase();
      loadPeerJs().then((Peer) => {
        const p = new Peer(undefined, peerOptions());
        peer = p;
        let opened = false, asked = false;
        const fail = () => { if (!opened && role === 'client') { role = null; push(0, { t: '_fail' }); } };
        const to = setTimeout(fail, 15000);
        p.on('open', () => {
          if (asked) return;
          asked = true;
          const c = p.connect(PEER_PREFIX + want, { serialization: 'json', reliable: true });
          hostConn = c;
          c.on('open', () => { opened = true; clearTimeout(to); seen.set(0, Date.now()); startBeat(); push(0, { t: '_open' }); });
          wire(c, 0);
        });
        p.on('error', (e) => { if (!opened) { clearTimeout(to); fail(); } else if (e.type === 'network' || e.type === 'peer-unavailable') { /* Verbindung bleibt evtl. bestehen */ } });
      }).catch(() => push(0, { t: '_fail' }));
    },
    send: (to, obj) => {
      if (role === 'host') {
        if (to < 0) { for (const c of conns.values()) if (c.open) c.send(obj); }
        else { const c = conns.get(to); if (c && c.open) c.send(obj); }
      } else if (hostConn && hostConn.open) hostConn.send(obj);
    },
    poll: () => inbox.splice(0),
    scan: () => {},
    hosts: () => [],
    ip: () => '',
    deviceName: () => (/Android/i.test(navigator.userAgent) ? 'Android' : /iPhone|iPad/i.test(navigator.userAgent) ? 'iPhone' : 'Browser'),
    stop: () => { role = null; clearInterval(beat); beat = null; seen.clear(); for (const c of conns.values()) try { c.close(); } catch (e) { /* egal */ } conns.clear(); hostConn = null; if (peer) try { peer.destroy(); } catch (e) { /* egal */ } peer = null; code = null; status = ''; },
  };
}

// Android-App: LAN (Spielsuche im WLAN) und Spielcode (Browser-Mitspieler) gleichzeitig.
// Spieler-IDs der Code-Verbindungen werden um 1000 verschoben.
const PEER_OFS = 1000;
function comboTransport(lan, pe) {
  let via = null;   // als Client: 'lan' | 'peer'
  return {
    kind: 'lan+peer',
    host: (info) => { const r = lan.host(info); if (!String(r).startsWith('err')) pe.host(info); return r; },
    code: () => pe.code(),
    status: () => pe.status(),
    info: (info) => lan.info(info),
    join: (ip, port) => { via = isGameCode(ip) ? 'peer' : 'lan'; return via === 'peer' ? pe.join(ip) : lan.join(ip, port); },
    send: (to, obj) => {
      if (via) return (via === 'peer' ? pe : lan).send(to, obj);
      if (to < 0) { lan.send(to, obj); pe.send(to, obj); } else if (to >= PEER_OFS) pe.send(to - PEER_OFS, obj); else lan.send(to, obj);
    },
    poll: () => {
      if (via === 'peer') return pe.poll();
      if (via === 'lan') return lan.poll();
      return lan.poll().concat(pe.poll().map((x) => ({ p: x.p + PEER_OFS, m: x.m })));
    },
    scan: (on) => lan.scan(on),
    hosts: () => lan.hosts(),
    ip: () => lan.ip(),
    deviceName: () => lan.deviceName(),
    stop: () => { via = null; try { lan.stop(); } catch (e) { /* egal */ } pe.stop(); },
  };
}

export function netTransport() {
  if (/[?&]net=test/.test(location.search) && window.BroadcastChannel) return testTransport();
  const lan = androidTransport(), pe = peerTransport();
  if (lan && pe) return comboTransport(lan, pe);
  return lan || pe;
}

