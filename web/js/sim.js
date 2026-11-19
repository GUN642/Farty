// Floßphysik und Spielregeln. Läuft nur beim Host (bzw. im Einzelspiel); Mitspieler bekommen Schnappschüsse.
import { clamp, wrap, TAU } from './util.js';
import { START, obstaclePose, segDist } from './river.js';

export const RAFT_R = 2.2;       // Außenradius (Kollision)
export const SEAT_R = 1.75;      // Sitzplatz-Radius
export const CONE = 1.75;        // Tiere können sich bis ±100° aus der Blickrichtung „zur Mitte“ drehen
const THRUST = 6.2, TURBO = 1.75, INERTIA = 3.1;
const LIN1 = 0.8, LIN2 = 0.075, ANG = 1.7;
const GAS_USE = 0.3, GAS_REGEN = 0.24, TURN = 7.5;
const DMG = [7, 12, 18];

export function seatAngles(n) {
  // n=2: links/rechts, sonst gleichmäßig verteilt
  if (n === 2) return [Math.PI / 2, -Math.PI / 2];
  if (n === 1) return [Math.PI];
  const out = [];
  for (let i = 0; i < n; i++) out.push(Math.PI * 0.75 - i * TAU / n);
  return out;
}

export class Sim {
  constructor(river, nSeats, difficulty = 1) {
    this.river = river;
    this.diff = clamp(difficulty | 0, 0, 2);
    this.seats = seatAngles(nSeats).map((phi) => ({ phi, face: phi + Math.PI, gas: 1, fart: false, empty: false, idle: 0, turbo: 0 }));
    this.q = {};
    this.wv = { x: 0, z: 0 };
    this.clock = 0;       // läuft immer (bewegliche Hindernisse)
    this.time = 0;        // Rennzeit
    this.phase = 'countdown';
    this.countdown = 3.6;
    this.collected = new Set();
    this.gold = 0;
    this.pops = 0;
    this.cpIndex = -1;
    this.events = [];
    this.hint = START;
    this.respawnAt(START, false);
  }

  respawnAt(s, keepTime = true) {
    const R = this.river, p = R.sample(s);
    this.x = p.x; this.z = p.z; this.a = Math.atan2(p.tz, p.tx);
    this.vx = p.tx * R.cur[Math.round(s)] * 0.5; this.vz = p.tz * R.cur[Math.round(s)] * 0.5; this.w = 0;
    this.hp = 100; this.inv = 1.5; this.hint = Math.round(s);
    for (const st of this.seats) { st.gas = 1; st.face = st.phi + Math.PI; st.fart = false; st.empty = false; st.turbo = 0; }
    if (!keepTime) this.time = 0;
    this.s = s;
  }

  ev(k, extra) { this.events.push(Object.assign({ k }, extra || {})); }

  // inputs[i] = { dx, dz, mag, fart } in Weltkoordinaten
  step(dt, inputs) {
    const R = this.river;
    this.clock += dt;
    for (const o of R.obstacles) obstaclePose(o, this.clock);

    if (this.phase === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (after !== before && after > 0) this.ev('count', { n: after });
      if (this.countdown <= 0) { this.phase = 'race'; this.ev('go'); }
    } else if (this.phase === 'race') this.time += dt;
    else if (this.phase === 'popped') {
      this.popT -= dt;
      if (this.popT <= 0) {
        this.phase = 'race';
        this.respawnAt(this.cpIndex >= 0 ? R.checkpoints[this.cpIndex] : START + 2);
        this.ev('respawn');
      }
      return;
    }

    // ---------- Tiere drehen und pupsen
    let fx = 0, fz = 0, tq = 0;
    const move = this.phase !== 'countdown';
    for (let i = 0; i < this.seats.length; i++) {
      const st = this.seats[i], inp = inputs[i];
      const inward = st.phi + Math.PI;
      let rel = wrap(st.face - inward);
      if (inp && inp.mag > 0.3) {
        const tgt = clamp(wrap(Math.atan2(inp.dz, inp.dx) - this.a - inward), -CONE, CONE);
        const d = tgt - rel, m = TURN * dt;
        rel += clamp(d, -m, m);
      }
      st.face = inward + rel;
      st.turbo = Math.max(0, st.turbo - dt);
      const want = !!(inp && inp.fart);
      if (!want) st.empty = false;
      if (st.gas <= 0.001) st.empty = true;
      st.fart = want && !st.empty && st.gas > 0;
      if (st.fart) {
        st.idle = 0;
        if (st.turbo <= 0) st.gas = Math.max(0, st.gas - GAS_USE * dt);
        if (move) {
          const T = THRUST * (st.turbo > 0 ? TURBO : 1), fa = this.a + st.face;
          const Fx = Math.cos(fa) * T, Fz = Math.sin(fa) * T;
          const rx = Math.cos(this.a + st.phi) * SEAT_R, rz = Math.sin(this.a + st.phi) * SEAT_R;
          fx += Fx; fz += Fz;
          tq += rx * Fz - rz * Fx;
        }
      } else {
        st.idle += dt;
        if (st.idle > 0.45) st.gas = Math.min(1, st.gas + GAS_REGEN * dt);
      }
    }
    if (!move) return;

    // ---------- Wasser: Strömung, Widerstand
    const q = R.nearest(this.x, this.z, this.hint, this.q);
    this.hint = q.i; this.s = q.s;
    R.waterVel(this.x, this.z, q, this.wv);
    const rvx = this.vx - this.wv.x, rvz = this.vz - this.wv.z, rv = Math.hypot(rvx, rvz);
    const drag = LIN1 + LIN2 * rv;
    this.vx += (fx - rvx * drag) * dt;
    this.vz += (fz - rvz * drag) * dt;
    // Strudel drehen das Floß mit
    let spin = 0;
    for (const wh of R.whirls) {
      const d = Math.hypot(this.x - wh.x, this.z - wh.z);
      if (d < wh.r) spin += wh.dir * 2.2 * (1 - d / wh.r);
    }
    // Stromschnellen schütteln
    if (q.rapid > 0.2) spin += Math.sin(this.clock * 3.1) * 0.9 * q.rapid;
    this.w += (tq / INERTIA - (this.w - spin) * ANG) * dt;
    this.x += this.vx * dt; this.z += this.vz * dt; this.a += this.w * dt;
    if (this.a > Math.PI * 64 || this.a < -Math.PI * 64) this.a = wrap(this.a);
    this.inv = Math.max(0, this.inv - dt);

    // ---------- Ufer
    const lim = q.hw - RAFT_R;
    if (Math.abs(q.lat) > lim) {
      const sg = Math.sign(q.lat), pen = Math.abs(q.lat) - lim;
      this.x -= q.nx * sg * pen; this.z -= q.nz * sg * pen;
      const vn = (this.vx * q.nx + this.vz * q.nz) * sg;
      const spiky = q.spiky & (sg > 0 ? 1 : 2);
      if (vn > 0) {
        const e = spiky ? 1.1 : 0.35;
        this.vx -= (1 + e) * vn * q.nx * sg; this.vz -= (1 + e) * vn * q.nz * sg;
        // Reibung am Ufer dreht das Floß
        const vt = this.vx * q.tx + this.vz * q.tz;
        this.w += -sg * vt * 0.12;
        if (vn > 1.2) this.ev('bump', { v: Math.min(1, vn / 6) });
      }
      if (spiky) this.hurt(-q.nx * sg, -q.nz * sg);
    }
    // Startbereich nach hinten begrenzen
    if (q.s < 3) { const p = 3 - q.s; this.x += q.tx * p; this.z += q.tz * p; const vt = this.vx * q.tx + this.vz * q.tz; if (vt < 0) { this.vx -= vt * q.tx; this.vz -= vt * q.tz; } }

    // ---------- Hindernisse
    const c = {};
    for (const o of R.obstacles) {
      if (Math.abs(o.s - q.s) > 16) continue;
      let d, nx, nz, ovx = 0, ovz = 0;
      if (o.type === 'rock' || o.type === 'buoy') {
        d = Math.hypot(this.x - o.x, this.z - o.z);
        if (d > o.r + RAFT_R) continue;
        nx = (this.x - o.x) / (d || 1); nz = (this.z - o.z) / (d || 1);
        d -= o.r;
      } else {
        d = segDist(this.x, this.z, o.ax, o.az, o.bx, o.bz, c);
        if (d > o.r + RAFT_R) continue;
        nx = (this.x - c.x) / (d || 1); nz = (this.z - c.z) / (d || 1);
        d -= o.r;
        if (o.type === 'bar') { const rr = c.t * o.len; ovx = -Math.sin(o.ang) * o.w * rr; ovz = Math.cos(o.ang) * o.w * rr; }
      }
      const pen = RAFT_R - d;
      this.x += nx * pen; this.z += nz * pen;
      const vn = (this.vx - ovx) * nx + (this.vz - ovz) * nz;
      const spiky = o.type === 'buoy' || (o.type === 'bar' && o.spiky);
      if (vn < 0) {
        const e = spiky ? 1.0 : o.type === 'rock' ? 0.45 : 0.3;
        this.vx -= (1 + e) * vn * nx; this.vz -= (1 + e) * vn * nz;
        const tx = -nz, tz = nx, vt = this.vx * tx + this.vz * tz;
        this.w += vt * 0.18;
        if (-vn > 1.2) this.ev('bump', { v: Math.min(1, -vn / 6) });
      }
      if (o.type === 'bar') { this.vx += ovx * 0.5 * dt * 10; this.vz += ovz * 0.5 * dt * 10; }
      if (spiky) this.hurt(nx, nz);
    }

    // ---------- Gegenstände einsammeln
    for (const p of R.pickups) {
      if (this.collected.has(p.id) || Math.abs(p.s - q.s) > 6) continue;
      if (Math.hypot(this.x - p.x, this.z - p.z) > RAFT_R + 0.6) continue;
      this.collected.add(p.id);
      // nächstgelegenes Tier bekommt die Bohne
      let best = 0, bd = 1e9;
      this.seats.forEach((st, i) => {
        const sx = this.x + Math.cos(this.a + st.phi) * SEAT_R, sz = this.z + Math.sin(this.a + st.phi) * SEAT_R;
        const dd = Math.hypot(sx - p.x, sz - p.z);
        if (dd < bd) { bd = dd; best = i; }
      });
      if (p.type === 'bean') { const st = this.seats[best]; st.gas = 1; st.turbo = 3; st.empty = false; }
      else if (p.type === 'gold') this.gold++;
      else if (p.type === 'pump') this.hp = Math.min(100, this.hp + 35);
      this.ev('pick', { id: p.id, seat: best, type: p.type });
    }

    // ---------- Kontrollpunkte und Ziel
    const cps = R.checkpoints;
    while (this.cpIndex + 1 < cps.length && q.s >= cps[this.cpIndex + 1]) { this.cpIndex++; this.ev('cp', { n: this.cpIndex }); }
    if (this.phase === 'race' && q.s >= R.finish) {
      this.phase = 'finished';
      this.ev('finish', { time: this.time, gold: this.gold, pops: this.pops });
    }
  }

  hurt(nx, nz) {
    if (this.inv > 0 || this.phase !== 'race') return;
    this.inv = 0.9;
    this.hp -= DMG[this.diff];
    this.vx += nx * 3.5; this.vz += nz * 3.5;
    this.w += (Math.random() - 0.5) * 3;
    if (this.hp <= 0) {
      this.hp = 0;
      this.phase = 'popped';
      this.popT = 2.4;
      this.pops++;
      this.ev('pop');
    } else this.ev('hit');
  }

  // Zustand für Netz und Darstellung
  snapshot() {
    const r = (v, k = 100) => Math.round(v * k) / k;
    return {
      x: r(this.x), z: r(this.z), a: r(this.a, 1000), vx: r(this.vx), vz: r(this.vz), w: r(this.w),
      hp: Math.round(this.hp), ph: this.phase, tm: r(this.time), ck: r(this.clock, 1000), cd: r(this.countdown), cp: this.cpIndex, g: this.gold, s: r(this.s, 10), pops: this.pops, inv: this.inv > 0 ? 1 : 0,
      st: this.seats.map((st) => [r(st.face, 1000), r(st.gas), st.fart ? 1 : 0, st.turbo > 0 ? 1 : 0]),
    };
  }
}
