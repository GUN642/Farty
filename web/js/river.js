// Flussstrecken: Leveldaten, deterministischer Streckengenerator und Abfragen für die Physik
import { clamp, lerp, rng, smooth } from './util.js';

// Abschnittsarten: calm (ruhig), rocks (Felsen), spiky (Kaktus-/Stachelufer), whirl (Strudel),
// bars (Drehbalken), rapids (Stromschnellen), logs (Baumstämme), buoys (Stachelbojen)
export const LEVELS = [
  {
    id: 'bach', name: 'Plätscherbach', desc: 'Gemütlicher Waldbach – zum Eingewöhnen.', theme: 'wald',
    length: 420, hw: [7.5, 10.5], curve: 0.8, current: 2.4, slope: 0.012,
    sections: { calm: 2, rocks: 3, logs: 1.2, buoys: 0.6, spiky: 0.5 },
  },
  {
    id: 'kaktus', name: 'Kaktusschlucht', desc: 'Enge Schlucht mit stacheligen Kakteen am Ufer.', theme: 'wueste',
    length: 560, hw: [6, 8.5], curve: 1.0, current: 2.9, slope: 0.016,
    sections: { calm: 0.6, rocks: 1.4, spiky: 3, buoys: 1.6, bars: 0.6, rapids: 0.6 },
  },
  {
    id: 'sumpf', name: 'Blubbersumpf', desc: 'Kaum Strömung, dafür Strudel – hier muss kräftig gepupst werden!', theme: 'sumpf',
    length: 520, hw: [8, 11.5], curve: 1.05, current: 0.9, slope: 0.004,
    sections: { calm: 1, logs: 2.4, whirl: 2.4, buoys: 0.8, rocks: 0.6, spiky: 0.6 },
  },
  {
    id: 'wild', name: 'Wildwasser', desc: 'Reißende Stromschnellen, Felsen und Drehbalken.', theme: 'berg',
    length: 700, hw: [6, 9.5], curve: 1.15, current: 3.6, slope: 0.022,
    sections: { rocks: 2.4, rapids: 2.2, bars: 1.6, buoys: 1.2, spiky: 1.2, whirl: 0.6 },
  },
  {
    id: 'eis', name: 'Gletscherkanal', desc: 'Eisschollen, Eiszapfen-Ufer und eiskalte Strudel.', theme: 'eis',
    length: 780, hw: [5.5, 9], curve: 1.2, current: 3.1, slope: 0.018,
    sections: { rocks: 1.6, spiky: 2.2, bars: 1.8, whirl: 1.2, buoys: 1.6, rapids: 1 },
  },
  {
    id: 'zufall', name: 'Zufallsfluss', desc: 'Jedes Mal eine neue Strecke – mit allem, was der Fluss hergibt.', theme: 'random', random: true,
    length: 650, hw: [6, 10], curve: 1.1, current: 2.6, slope: 0.015,
    sections: { calm: 0.6, rocks: 1.6, spiky: 1.4, whirl: 1, bars: 1.2, rapids: 1, logs: 1, buoys: 1.2 },
  },
];
export const levelById = (id) => LEVELS.find((l) => l.id === id) || LEVELS[0];
export const THEMES = ['wald', 'wueste', 'sumpf', 'berg', 'eis'];

export const START = 18;   // s der Startlinie
const TAIL = 60;           // Strecke hinter dem Ziel

function weighted(R, obj) {
  const keys = Object.keys(obj);
  let sum = 0;
  for (const k of keys) sum += obj[k];
  let r = R() * sum;
  for (const k of keys) { r -= obj[k]; if (r <= 0) return k; }
  return keys[keys.length - 1];
}

export class River {
  constructor(def, seed) {
    this.def = def;
    this.seed = seed >>> 0;
    const R = rng(this.seed * 7919 + 13);
    this.theme = def.random ? R.pick(THEMES) : def.theme;
    this.length = def.length;
    this.finish = START + def.length;
    const N = this.N = Math.ceil(this.finish + TAIL);
    this.px = new Float32Array(N); this.pz = new Float32Array(N); this.py = new Float32Array(N);
    this.tx = new Float32Array(N); this.tz = new Float32Array(N);
    this.hw = new Float32Array(N); this.cur = new Float32Array(N);
    this.spiky = new Uint8Array(N);   // Bit 1: Seite +n, Bit 2: Seite −n
    this.rapid = new Float32Array(N);

    // ---------- Abschnitte festlegen
    const secs = [];
    let s = START + 26;
    let last = '';
    secs.push({ type: 'start', a: 0, b: s });
    while (s < this.finish - 30) {
      const len = R.range(38, 70);
      let type = weighted(R, def.sections);
      if (type === last && R() < 0.7) type = weighted(R, def.sections);
      last = type;
      secs.push({ type, a: s, b: Math.min(s + len, this.finish - 30) });
      s += len;
    }
    secs.push({ type: 'end', a: s, b: N });
    this.sections = secs;
    const secAt = (x) => { for (const q of secs) if (x >= q.a && x < q.b) return q; return secs[secs.length - 1]; };

    // ---------- Mittellinie: Richtung als Summe von Sinuswellen (keine Schleifen, begrenzte Krümmung)
    const c = def.curve;
    const waves = [
      [0.55 * c, 70, R.range(0, 6.28)], [0.33 * c, 34, R.range(0, 6.28)], [0.18 * c, 19, R.range(0, 6.28)],
    ];
    const rawHw = new Float32Array(N), rawCur = new Float32Array(N), rawSlope = new Float32Array(N), rawRapid = new Float32Array(N);
    const hwPh = R.range(0, 6.28), hwPh2 = R.range(0, 6.28);
    let x = 0, z = 0;
    for (let i = 0; i < N; i++) {
      const env = smooth(clamp((i - 6) / 40, 0, 1)) * smooth(clamp((this.finish + 25 - i) / 40, 0, 1));
      let h = 0;
      for (const [A, L, P] of waves) h += A * Math.sin(i / L + P);
      h *= env;
      this.px[i] = x; this.pz[i] = z;
      x += Math.cos(h); z += Math.sin(h);
      const q = secAt(i);
      const n = 0.5 + 0.3 * Math.sin(i / 47 + hwPh) + 0.2 * Math.sin(i / 21 + hwPh2);
      let w = lerp(def.hw[0], def.hw[1], n);
      let cu = def.current, sl = def.slope, rp = 0;
      if (q.type === 'rapids') { w *= 0.88; cu *= 1.45; sl *= 4; rp = 1; }
      else if (q.type === 'whirl') { w += 2.5; cu *= 0.7; }
      else if (q.type === 'calm') { cu *= 0.9; sl *= 0.6; }
      else if (q.type === 'start' || q.type === 'end') { w = Math.max(w, 8.5); }
      rawHw[i] = w; rawCur[i] = cu; rawSlope[i] = sl; rawRapid[i] = rp;
    }
    // glätten
    const box = (src, dst, r) => {
      for (let i = 0; i < N; i++) {
        let sum = 0, k = 0;
        for (let j = Math.max(0, i - r); j <= Math.min(N - 1, i + r); j++) { sum += src[j]; k++; }
        dst[i] = sum / k;
      }
    };
    box(rawHw, this.hw, 9);
    box(rawCur, this.cur, 10);
    box(rawRapid, this.rapid, 6);
    const slope = new Float32Array(N);
    box(rawSlope, slope, 10);
    let y = 0;
    for (let i = 0; i < N; i++) { this.py[i] = y; y -= slope[i]; }
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - 1), b = Math.min(N - 1, i + 1);
      const dx = this.px[b] - this.px[a], dz = this.pz[b] - this.pz[a], l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l; this.tz[i] = dz / l;
    }

    // ---------- Hindernisse und Gegenstände
    this.obstacles = [];
    this.whirls = [];
    this.pickups = [];
    let pid = 1;
    const at = (si, lat) => {
      const i = clamp(Math.round(si), 0, N - 1);
      return { x: this.px[i] - this.tz[i] * lat, z: this.pz[i] + this.tx[i] * lat, i };
    };
    this.at = at;
    const free = (x0, z0, r) => {
      for (const o of this.obstacles) {
        // Lücken zwischen Hindernissen: entweder breit genug fürs Boot (Ø 4,4 m) oder gar keine
        if (o.type === 'rock' || o.type === 'buoy') { if (Math.hypot(o.x - x0, o.z - z0) < o.r + r + 5.2) return false; }
        else if (o.type === 'bar' && Math.hypot(o.px - x0, o.pz - z0) < o.len + r + 2) return false;
        else if (o.type === 'log' && segDist(x0, z0, o.ax, o.az, o.bx, o.bz) < o.r + r + 5.2) return false;
      }
      for (const w of this.whirls) if (Math.hypot(w.x - x0, w.z - z0) < w.r + r + 1.5) return false;
      return true;
    };
    const hwAt = (si) => this.hw[clamp(Math.round(si), 0, N - 1)];
    // keine Engstellen zwischen Hindernis und Ufer, in denen das Boot stecken bleibt
    const noPinch = (si, lat, r) => {
      const w = hwAt(si), gap = w - Math.abs(lat) - r;
      return gap < 5 ? Math.sign(lat || 1) * (w - r + 0.2) : lat;
    };
    const addRock = (si, lat, r) => { lat = noPinch(si, lat, r); const p = at(si, lat); if (free(p.x, p.z, r)) this.obstacles.push({ type: 'rock', x: p.x, z: p.z, r, s: si, h: R.range(0.7, 1.6), rot: R.range(0, 6.28) }); };
    const addBuoy = (si, lat, move) => {
      if (!move) lat = noPinch(si, lat, 0.85);
      const p = at(si, lat);
      if (!free(p.x, p.z, 0.9)) return;
      const i = p.i, o = { type: 'buoy', x: p.x, z: p.z, x0: p.x, z0: p.z, r: 0.85, s: si };
      if (move) o.move = { nx: -this.tz[i], nz: this.tx[i], amp: Math.max(0.5, hwAt(si) - Math.abs(lat) - 1.6), w: R.range(0.6, 1.1), ph: R.range(0, 6.28) };
      this.obstacles.push(o);
    };

    for (const q of secs) {
      const a = q.a, b = q.b, len = b - a;
      if (q.type === 'start' || q.type === 'end') continue;
      if (q.type === 'rocks' || q.type === 'rapids') {
        const n = Math.round(len / (q.type === 'rapids' ? 7 : 9));
        for (let k = 0; k < n; k++) {
          const si = a + (k + 0.5) * len / n + R.range(-2, 2), w = hwAt(si);
          addRock(si, R.range(-w + 1.2, w - 1.2), R.range(0.9, q.type === 'rapids' ? 1.6 : 2.1));
        }
      } else if (q.type === 'buoys') {
        const n = Math.round(len / 10);
        for (let k = 0; k < n; k++) { const si = a + (k + 0.5) * len / n, w = hwAt(si); addBuoy(si, R.range(-w + 1.5, w - 1.5), R() < 0.55); }
      } else if (q.type === 'spiky') {
        const side = R() < 0.4 ? 3 : R() < 0.5 ? 1 : 2;
        for (let i = Math.floor(a); i < Math.min(N, b); i++) this.spiky[i] |= side;
        const n = Math.round(len / 16);
        for (let k = 0; k < n; k++) { const si = a + (k + 0.5) * len / n, w = hwAt(si); addRock(si, R.range(-w * 0.5, w * 0.5), R.range(0.8, 1.3)); }
      } else if (q.type === 'whirl') {
        const n = Math.max(1, Math.round(len / 30));
        for (let k = 0; k < n; k++) {
          const si = a + (k + 0.5) * len / n, w = hwAt(si), r = Math.min(6, w - 1.5);
          const p = at(si, R.range(-w + r + 0.5, w - r - 0.5) * 0.5);
          if (free(p.x, p.z, r)) this.whirls.push({ x: p.x, z: p.z, r, s: si, dir: R.sign() });
        }
      } else if (q.type === 'bars') {
        const n = Math.max(1, Math.round(len / 26));
        for (let k = 0; k < n; k++) {
          const si = a + (k + 0.5) * len / n, w = hwAt(si);
          const p = at(si, R.range(-1, 1));
          if (free(p.x, p.z, 1)) this.obstacles.push({ type: 'bar', px: p.x, pz: p.z, len: w - 1.0, r: 0.35, w: R.sign() * R.range(0.6, 1.0), ph: R.range(0, 6.28), s: si, spiky: def.id !== 'bach' });
        }
      } else if (q.type === 'logs') {
        const n = Math.max(1, Math.round(len / 18));
        for (let k = 0; k < n; k++) {
          const si = a + (k + 0.5) * len / n, w = hwAt(si), side = R.sign();
          const p1 = at(si, side * (w + 0.5)), p2 = at(si + R.range(-5, 5), side * (w - w * R.range(0.8, 1.15)));
          if (free((p1.x + p2.x) / 2, (p1.z + p2.z) / 2, 1)) this.obstacles.push({ type: 'log', ax: p1.x, az: p1.z, bx: p2.x, bz: p2.z, r: 0.45, s: si });
        }
      } else if (q.type === 'calm') {
        // ein paar Seerosen und vereinzelt ein Fels
        if (R() < 0.6) { const si = a + len / 2, w = hwAt(si); addRock(si, R.sign() * R.range(w * 0.3, w - 1.5), R.range(0.8, 1.4)); }
      }
    }

    // Bohnen (Pupsgas), goldene Bohnen (Sammelobjekte), Luftpumpen (Floß flicken)
    for (let si = START + 30; si < this.finish - 15; si += R.range(14, 24)) {
      const w = hwAt(si), lat = R.range(-w + 1.8, w - 1.8), p = at(si, lat);
      if (free(p.x, p.z, 0.2)) this.pickups.push({ id: pid++, type: 'bean', x: p.x, z: p.z, s: si });
    }
    for (let k = 0; k < 3; k++) {
      for (let tries = 0; tries < 30; tries++) {
        const si = START + 50 + (k + R.range(0.15, 0.85)) * (this.length - 80) / 3, w = hwAt(si);
        const p = at(si, R.sign() * R.range(w * 0.55, w - 1.4));
        if (free(p.x, p.z, 0.3)) { this.pickups.push({ id: pid++, type: 'gold', x: p.x, z: p.z, s: si }); break; }
      }
    }
    const pumps = Math.max(2, Math.round(this.length / 220));
    for (let k = 0; k < pumps; k++) {
      const si = START + (k + 0.6) * this.length / (pumps + 0.4), w = hwAt(si);
      const p = at(si, R.range(-w * 0.6, w * 0.6));
      this.pickups.push({ id: pid++, type: 'pump', x: p.x, z: p.z, s: si });
    }

    // Kontrollpunkte (Wiedereinstieg nach dem Platzen)
    const ncp = Math.max(2, Math.round(this.length / 130));
    this.checkpoints = [];
    for (let k = 1; k <= ncp; k++) this.checkpoints.push(START + k * this.length / (ncp + 1));

    // Bestzeit-Vorgabe (für den dritten Stern)
    let est = 0;
    for (let i = START; i < this.finish; i++) est += 1 / (this.cur[i] * 0.9 + 3.2);
    est += this.whirls.length * 2.5 + this.obstacles.filter((o) => o.type === 'bar').length * 1.5;
    this.par = Math.round(est * 1.1);
  }

  // Nächster Punkt der Mittellinie (lokale Suche ab hint)
  nearest(x, z, hint, out) {
    const N = this.N, px = this.px, pz = this.pz;
    let i = clamp(hint | 0, 0, N - 1);
    const d = (k) => (px[k] - x) * (px[k] - x) + (pz[k] - z) * (pz[k] - z);
    let best = d(i);
    while (i + 1 < N && d(i + 1) < best) { i++; best = d(i); }
    while (i > 0 && d(i - 1) < best) { i--; best = d(i); }
    const tx = this.tx[i], tz = this.tz[i], dx = x - px[i], dz = z - pz[i];
    const o = out || {};
    o.i = i;
    o.s = i + clamp(dx * tx + dz * tz, -0.5, 0.5);
    o.tx = tx; o.tz = tz; o.nx = -tz; o.nz = tx;
    o.lat = dx * -tz + dz * tx;
    o.hw = this.hw[i]; o.cur = this.cur[i]; o.y = this.py[i]; o.spiky = this.spiky[i]; o.rapid = this.rapid[i];
    return o;
  }

  // Punkt und Richtung bei Streckenposition s
  sample(s, out) {
    const N = this.N, f = clamp(s, 0, N - 1.001), i = Math.floor(f), t = f - i, j = Math.min(N - 1, i + 1);
    const o = out || {};
    o.x = lerp(this.px[i], this.px[j], t); o.z = lerp(this.pz[i], this.pz[j], t); o.y = lerp(this.py[i], this.py[j], t);
    o.tx = lerp(this.tx[i], this.tx[j], t); o.tz = lerp(this.tz[i], this.tz[j], t);
    o.hw = lerp(this.hw[i], this.hw[j], t);
    return o;
  }

  // Wassergeschwindigkeit an einem Punkt (Strömung + Strudel)
  waterVel(x, z, q, out) {
    const k = clamp(q.lat / q.hw, -1, 1);
    const sp = q.cur * (1 - 0.45 * k * k);
    let vx = q.tx * sp, vz = q.tz * sp;
    for (const w of this.whirls) {
      if (Math.abs(w.s - q.s) > w.r + 3) continue;
      const dx = x - w.x, dz = z - w.z, d = Math.hypot(dx, dz);
      if (d >= w.r || d < 0.01) continue;
      const f = 1 - d / w.r;
      vx += (-dz / d) * w.dir * 4.2 * f - (dx / d) * 1.8 * f;
      vz += (dx / d) * w.dir * 4.2 * f - (dz / d) * 1.8 * f;
    }
    // Wasser fließt um Felsen, Bojen und Baumstämme herum (Boote werden seitlich abgelenkt statt festgedrückt)
    for (const o of this.obstacles) {
      if (Math.abs(o.s - q.s) > 9 || o.type === 'bar') continue;
      let dx, dz, d, r = o.r;
      if (o.type === 'log') {
        d = segDist(x, z, o.ax, o.az, o.bx, o.bz, this._c || (this._c = {}));
        dx = x - this._c.x; dz = z - this._c.z;
      } else { dx = x - o.x; dz = z - o.z; d = Math.hypot(dx, dz); }
      const reach = 4.2;
      if (d < 0.01 || d > r + reach) continue;
      const f = 1 - Math.max(0, d - r) / reach, k = sp * 0.75 * f;
      vx += dx / d * k; vz += dz / d * k;
      if (o.type === 'log') {
        // entlang des Stamms zur freien Spitze
        const lx = o.bx - o.ax, lz = o.bz - o.az, ll = Math.hypot(lx, lz) || 1;
        vx += lx / ll * k * 0.8; vz += lz / ll * k * 0.8;
      }
    }
    out.x = vx; out.z = vz;
    return out;
  }
}

// Position eines beweglichen Hindernisses zur Zeit t
export function obstaclePose(o, t) {
  if (o.type === 'buoy' && o.move) {
    const m = o.move, d = Math.sin(t * m.w + m.ph) * m.amp;
    o.x = o.x0 + m.nx * d; o.z = o.z0 + m.nz * d;
  } else if (o.type === 'bar') {
    const a = o.ph + t * o.w;
    o.ang = a;
    o.ax = o.px; o.az = o.pz;
    o.bx = o.px + Math.cos(a) * o.len; o.bz = o.pz + Math.sin(a) * o.len;
  }
}

export function segDist(x, z, ax, az, bx, bz, out) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
  const t = clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
  const cx = ax + dx * t, cz = az + dz * t;
  if (out) { out.x = cx; out.z = cz; out.t = t; }
  return Math.hypot(x - cx, z - cz);
}
