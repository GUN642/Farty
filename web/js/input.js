// Eingabe: Tastatur, Touchscreen und Gamepads (z. B. Nintendo Switch Pro Controller / Joy-Cons, auch am Android TV)
//
// Lokale Spieler: Spieler 0 nutzt Tastatur, Touch und den ersten Controller. Jeder weitere Controller kann
// in der Lobby mit einer beliebigen Taste als zusätzlicher Spieler am selben Gerät beitreten.
// Jeder Spieler liefert pro Bild: linker/rechter Stick (x, y) und „pupsen links/rechts/irgendeine Taste“.
import { isApp } from './platform.js';

const DEAD = 0.18;
const dz = (v) => (Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD));
const newState = () => ({ lx: 0, ly: 0, rx: 0, ry: 0, fartL: false, fartR: false, fart: false });

export class Input {
  constructor() {
    this.keys = new Set();
    this.actions = [];
    this.device = 'keyboard';
    this.primaryPad = null;           // Index des Controllers von Spieler 0
    this.extraPads = [];              // Controller weiterer lokaler Spieler (Index in getGamepads)
    this.joinRequests = [];
    this.leaveRequests = [];
    this.states = [newState()];
    this.gpPrev = {};
    this.gpCal = {};
    this.hatPrev = {};
    this.navState = {};
    this.lastNav = {};
    this.touchMode = 'none';          // 'single' | 'twin' | 'none'
    this.touch = { l: null, r: null, fart: false };
    this.onDevice = null;

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepaddisconnected', (e) => {
      const i = e.gamepad.index;
      delete this.gpCal[i];
      if (this.primaryPad === i) this.primaryPad = null;
      const k = this.extraPads.indexOf(i);
      if (k >= 0) this.leaveRequests.push(k + 1);
    });
    this.setupTouch();
  }

  get localCount() { return 1 + this.extraPads.length; }
  removeLocal(k) { if (k >= 1) this.extraPads.splice(k - 1, 1); }

  // ---------------------------------------------------------------- Tastatur
  onKey(e, down) {
    const k = e.code || e.key;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) {
      if (down && (k === 'Escape' || k === 'Enter')) { e.target.blur(); if (k === 'Escape') this.actions.push('back'); }
      return;
    }
    if (down) {
      if (!this.keys.has(k)) {
        if (k === 'Escape' || k === 'Backspace') this.actions.push('back');
        if (k === 'KeyP') this.actions.push('pause');
        if (k === 'Enter' || k === 'NumpadEnter' || k === 'Space') this.pushConfirm();
        const nav = { ArrowUp: 'nav-up', ArrowDown: 'nav-down', ArrowLeft: 'nav-left', ArrowRight: 'nav-right', KeyW: 'nav-up', KeyS: 'nav-down', KeyA: 'nav-left', KeyD: 'nav-right' }[k];
        if (nav) this.pushNav(nav, 'key');
      }
      this.keys.add(k);
      if (this.device !== 'keyboard' && !this.padKeySuspect()) { this.device = 'keyboard'; this.onDevice && this.onDevice(); }
    } else this.keys.delete(k);
    // Enter/Leertaste lösen sonst zusätzlich den Klick des fokussierten Knopfs aus (doppelt mit 'confirm')
    if (['Space', 'Enter', 'NumpadEnter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace'].includes(k)) e.preventDefault();
  }

  // In der Android-App kommen Steuerkreuz/Tasten des Controllers zusätzlich als Tastaturereignis an:
  // dort Pfeiltasten und Enter nicht als Spielsteuerung werten, solange ein Controller verbunden ist.
  padKeySuspect() {
    if (!isApp) return false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return true;
    return false;
  }
  key(...ks) { for (const k of ks) if (this.keys.has(k)) return 1; return 0; }

  // ---------------------------------------------------------------- Touch: schwebende Sticks + Pups-Knopf
  setupTouch() {
    const el = document.getElementById('touch');
    if (!el) return;
    const zoneL = document.getElementById('tz-l'), zoneR = document.getElementById('tz-r'), btn = document.getElementById('t-fart');
    const stick = (zone, side) => {
      const base = zone.querySelector('.tbase'), knob = zone.querySelector('.tknob');
      let id = null, cx = 0, cy = 0;
      const R = 60;
      zone.addEventListener('touchstart', (e) => {
        if (this.device !== 'touch') { this.device = 'touch'; this.onDevice && this.onDevice(); }
        const t = e.changedTouches[0];
        if (id !== null) return;
        id = t.identifier;
        const rc = zone.getBoundingClientRect();
        cx = t.clientX; cy = t.clientY;
        base.style.left = (cx - rc.left) + 'px'; base.style.top = (cy - rc.top) + 'px';
        base.classList.add('on');
        knob.style.transform = 'translate(-50%,-50%)';
        this.touch[side] = { x: 0, y: 0 };
        e.preventDefault();
      }, { passive: false });
      zone.addEventListener('touchmove', (e) => {
        for (const t of e.changedTouches) {
          if (t.identifier !== id) continue;
          let dx = t.clientX - cx, dy = t.clientY - cy;
          const l = Math.hypot(dx, dy);
          if (l > R) { dx *= R / l; dy *= R / l; }
          knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
          this.touch[side] = { x: dx / R, y: dy / R };
        }
        e.preventDefault();
      }, { passive: false });
      const end = (e) => {
        for (const t of e.changedTouches) if (t.identifier === id) { id = null; this.touch[side] = null; base.classList.remove('on'); }
      };
      zone.addEventListener('touchend', end);
      zone.addEventListener('touchcancel', end);
    };
    stick(zoneL, 'l');
    stick(zoneR, 'r');
    const fartOn = (e) => { this.touch.fart = true; btn.classList.add('on'); if (this.device !== 'touch') { this.device = 'touch'; this.onDevice && this.onDevice(); } e.preventDefault(); };
    const fartOff = (e) => { this.touch.fart = false; btn.classList.remove('on'); e.preventDefault(); };
    btn.addEventListener('touchstart', fartOn, { passive: false });
    btn.addEventListener('touchend', fartOff, { passive: false });
    btn.addEventListener('touchcancel', fartOff, { passive: false });
    window.addEventListener('touchstart', () => { if (this.device !== 'touch') { this.device = 'touch'; this.onDevice && this.onDevice(); } }, { passive: true });
  }

  setTouchMode(m) {
    if (m === this.touchMode) return;
    this.touchMode = m;
    const el = document.getElementById('touch');
    if (!el) return;
    el.className = m === 'none' ? 'hidden' : m;
    if (m === 'none') this.touch = { l: null, r: null, fart: false };
  }

  // ---------------------------------------------------------------- Abfrage pro Bild
  poll(dt) {
    const S = this.states;
    while (S.length < this.localCount) S.push(newState());
    S.length = this.localCount;
    for (let i = 0; i < S.length; i++) Object.assign(S[i], newState());
    const s0 = S[0];

    // Tastatur → Spieler 0
    const suspect = this.padKeySuspect();
    s0.lx = this.key('KeyD') - this.key('KeyA');
    s0.ly = this.key('KeyS') - this.key('KeyW');
    if (!suspect) { s0.rx = this.key('ArrowRight') - this.key('ArrowLeft'); s0.ry = this.key('ArrowDown') - this.key('ArrowUp'); }
    s0.fartL = !!this.key('Space', 'ShiftLeft', 'KeyQ', 'KeyE');
    s0.fartR = !!(this.key('ShiftRight', 'ControlRight', 'Numpad0', 'Slash', 'Minus', 'Period') || (!suspect && this.key('Enter', 'NumpadEnter')));
    s0.fart = s0.fartL || s0.fartR;

    // Touch → Spieler 0
    const T = this.touch;
    if (T.l) { s0.lx += T.l.x; s0.ly += T.l.y; }
    if (T.r) { s0.rx += T.r.x; s0.ry += T.r.y; }
    if (this.touchMode === 'twin') {
      if (T.l && Math.hypot(T.l.x, T.l.y) > 0.55) s0.fartL = true;
      if (T.r && Math.hypot(T.r.x, T.r.y) > 0.55) s0.fartR = true;
    }
    if (T.fart) { s0.fart = true; s0.fartR = true; }
    s0.fart = s0.fart || s0.fartL || s0.fartR;

    // Controller
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      // Controller, die (noch) keinem Spieler gehören, steuern das Menü nicht – ihr erster Tastendruck ist „Mitmachen“
      const owned = this.primaryPad === null || this.primaryPad === gp.index || this.extraPads.includes(gp.index);
      const st = this.readPad(gp, dt, owned);
      if (!st) continue;
      if (st.any && this.primaryPad === null && !this.extraPads.includes(gp.index)) this.primaryPad = gp.index;
      let who = -1;
      if (gp.index === this.primaryPad) who = 0;
      else {
        const k = this.extraPads.indexOf(gp.index);
        if (k >= 0) who = k + 1;
        else if (st.pressedAny) this.joinRequests.push(gp.index);
      }
      if (who >= 0) {
        const s = S[who];
        s.lx += st.lx; s.ly += st.ly; s.rx += st.rx; s.ry += st.ry;
        s.fartL = s.fartL || st.fartL; s.fartR = s.fartR || st.fartR; s.fart = s.fart || st.fart;
        if (who > 0 && st.minus) this.leaveRequests.push(who);
      }
    }
    for (const s of S) {
      s.lx = Math.max(-1, Math.min(1, s.lx)); s.ly = Math.max(-1, Math.min(1, s.ly));
      s.rx = Math.max(-1, Math.min(1, s.rx)); s.ry = Math.max(-1, Math.min(1, s.ry));
    }
    return S;
  }

  // Einen Controller lesen (Standard-Mapping und die nicht-standardisierten Varianten unter Android)
  readPad(gp, dt, owned = true) {
    const ax = gp.axes, prev = this.gpPrev[gp.index] || [];
    const b = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.4));
    const pressed = (i) => gp.buttons[i] && gp.buttons[i].pressed && !prev[i];
    // Achsen kalibrieren: manche Controller (Switch Pro/Joy-Con an Android, nicht-Standard-Mapping) melden
    // unbenutzte Achsen oder Schultertasten dauerhaft bei −1/+1. Solche Achsen gelten als Ruhelage.
    const cal = this.gpCal[gp.index] || (this.gpCal[gp.index] = { rest: ax.map(() => 0), nchg: ax.map(() => 0), center: ax.map(() => false), last: ax.slice(), still: ax.map(() => 0), moved: ax.map(() => 0) });
    for (let i = 2; i < ax.length; i++) {
      const v = ax[i] || 0;
      if (v === cal.last[i]) cal.still[i] += dt; else { cal.still[i] = 0; cal.last[i] = v; cal.nchg[i]++; }
      if (cal.nchg[i] > 3 && Math.abs(v) < 0.15) { cal.center[i] = true; cal.rest[i] = 0; }
      if (!cal.center[i] && cal.nchg[i] <= 3 && cal.still[i] > 0.4 && Math.abs(v) > 0.5) cal.rest[i] = v;
      cal.moved[i] = Math.max(cal.moved[i], Math.abs(v - cal.rest[i]));
    }
    const A = (i) => {
      if (i >= ax.length) return 0;
      const r = cal.rest[i], v = (ax[i] || 0) - r;
      return Math.abs(r) > 0.3 ? 0 : dz(v);
    };
    // Trigger als Achse (Ruhelage −1/+1): weit durchgedrückt = gedrückt
    const trig = (i) => i < ax.length && Math.abs(cal.rest[i]) > 0.5 && Math.abs((ax[i] || 0) - cal.rest[i]) > 0.9;
    let ri = 2, rj = 3;
    if (gp.mapping !== 'standard' && ax.length >= 6 && (Math.abs(cal.rest[3]) > 0.3 || (cal.moved[5] > 0.35 && cal.moved[3] < 0.2))) rj = 5;
    if (gp.mapping !== 'standard' && ax.length >= 6 && Math.abs(cal.rest[2]) > 0.3 && Math.abs(cal.rest[3]) < 0.3) { ri = 3; rj = 5; }
    let lx = A(0), ly = A(1);
    const rx = A(ri), ry = A(rj);
    // Steuerkreuz: Tasten 12–15 oder als Achse (Android)
    let hx = (b(15) ? 1 : 0) - (b(14) ? 1 : 0), hy = (b(13) ? 1 : 0) - (b(12) ? 1 : 0);
    if (gp.mapping !== 'standard' && ax.length >= 8) {
      if (Math.abs(ax[7] || 0) > 0.5 && Math.abs(cal.rest[7]) < 0.3) hy = Math.sign(ax[7]);
      if (Math.abs(ax[6] || 0) > 0.5 && Math.abs(cal.rest[6]) < 0.3) hx = Math.sign(ax[6]);
    }
    if (ax.length > 9 && gp.mapping !== 'standard' && Math.abs(ax[9] || 0) <= 1) {
      const hv = ax[9];
      if (Math.abs(hv + 1) < 0.1) hy = -1; else if (Math.abs(hv - 0.143) < 0.1) hy = 1;
      else if (Math.abs(hv - 0.714) < 0.1) hx = -1; else if (Math.abs(hv + 0.429) < 0.1) hx = 1;
    }
    if (Math.abs(lx) + Math.abs(ly) < 0.1) { lx = hx; ly = hy; }

    // Tasten: 0=B(unten) 1=A(rechts) 2=Y(links) 3=X(oben) 4=L 5=R 6=ZL 7=ZR 8=− 9=+ 12-15=Steuerkreuz
    const fartL = b(4) || b(6);
    const fartR = b(5) || b(7) || b(0) || b(1) || b(2) || b(3);
    let trigAny = false;
    for (let i = 2; i < ax.length; i++) if (trig(i)) trigAny = true;
    const fart = fartL || fartR || trigAny || b(10) || b(11);
    const any = fart || Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + Math.abs(ry) > 0.3;
    let pressedAny = false;
    for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 9]) if (pressed(i)) pressedAny = true;
    if (any && this.device !== 'gamepad') { this.device = 'gamepad'; this.onDevice && this.onDevice(); }

    if (!owned) {
      this.gpPrev[gp.index] = gp.buttons.map((x) => x.pressed);
      return { lx, ly, rx, ry, fartL, fartR, fart, any, pressedAny, minus: false };
    }
    // Menü
    if (pressed(0) || pressed(1)) this.pushConfirm();
    if (pressed(8)) this.actions.push('back');
    if (pressed(9)) this.actions.push('pause');
    if (pressed(2)) this.actions.push('alt');
    if (pressed(4)) this.actions.push('prev');
    if (pressed(5)) this.actions.push('next');
    if (pressed(12)) this.pushNav('nav-up', 'pad');
    if (pressed(13)) this.pushNav('nav-down', 'pad');
    if (pressed(14)) this.pushNav('nav-left', 'pad');
    if (pressed(15)) this.pushNav('nav-right', 'pad');
    // Steuerkreuz als Achse und linker Stick für die Menü-Navigation
    const hat = hy < 0 ? 'nav-up' : hy > 0 ? 'nav-down' : hx < 0 ? 'nav-left' : hx > 0 ? 'nav-right' : null;
    const ph = this.hatPrev[gp.index];
    const btnHat = b(12) || b(13) || b(14) || b(15);
    if (hat && hat !== ph && !btnHat) this.pushNav(hat, 'pad');
    this.hatPrev[gp.index] = hat;
    this.stickNav(gp.index, A(0), A(1), dt);

    this.gpPrev[gp.index] = gp.buttons.map((x) => x.pressed);
    return { lx, ly, rx, ry, fartL, fartR, fart, any, pressedAny, minus: pressed(8) };
  }

  stickNav(idx, x, y, dt) {
    const st = this.navState[idx] || (this.navState[idx] = { dir: null, t: 0 });
    const dir = y < -0.6 ? 'nav-up' : y > 0.6 ? 'nav-down' : x < -0.6 ? 'nav-left' : x > 0.6 ? 'nav-right' : null;
    if (dir !== st.dir) { st.dir = dir; st.t = 0.45; if (dir) this.pushNav(dir, 'stick'); return; }
    if (!dir) return;
    st.t -= dt;
    if (st.t <= 0) { st.t = 0.18; this.pushNav(dir, 'stick'); }
  }

  // Auf Android kommt das Steuerkreuz doppelt an (Gamepad-API und Tastenereignis der WebView): nur einmal werten
  pushNav(dir, src) {
    const now = performance.now();
    const last = this.lastNav[dir] || { t: 0, src: '' };
    if (last.src !== src && now - last.t < 160) return;
    this.lastNav[dir] = { t: now, src };
    this.actions.push(dir);
  }

  // Android: Taste A bzw. OK kommt teils zusätzlich als Enter-Taste an – nur einmal werten
  pushConfirm() {
    const now = performance.now();
    if (now - (this.lastConfirm || 0) < 220) return;
    this.lastConfirm = now;
    this.actions.push('confirm');
  }

  popActions() { const a = this.actions; this.actions = []; return a; }
  popJoins() { const a = [...new Set(this.joinRequests)]; this.joinRequests = []; return a; }
  popLeaves() { const a = [...new Set(this.leaveRequests)].sort((x, y) => y - x); this.leaveRequests = []; return a; }
}
