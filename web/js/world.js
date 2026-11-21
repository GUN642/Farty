// Darstellung der Flussstrecke: Wasser, Ufer, Deko, Hindernisse, Gegenstände, Tore
import * as THREE from './lib/three.module.min.js';
import { rng, clamp } from './util.js';
import { START, obstaclePose } from './river.js';

export const PALETTE = {
  wald: { deep: 0x1f8fd6, shallow: 0x5fd2f7, foam: 0xf4fdff, grass: 0x6cc644, grass2: 0x58b23a, wall: 0x8a6a3c, sky: 0x7cc8ff, horizon: 0xd8f1ff, crown: [0x4caf50, 0x66bb44, 0x3d9a3d], trunk: 0x7a5230, tree: 'round', spikeBody: 0x2f6b2a, spike: 0xe04fa0, spikeStyle: 'hedge', rock: 0x9e9e94 },
  wueste: { deep: 0x1aa3c4, shallow: 0x62dbe6, foam: 0xfffbea, grass: 0xe9c47f, grass2: 0xdcae62, wall: 0xc9773f, sky: 0x8fcfff, horizon: 0xffe4b8, crown: [0x3f9b4b, 0x4fae55], trunk: 0x3f9b4b, tree: 'cactus', spikeBody: 0x3f9b4b, spike: 0xfff3c4, spikeStyle: 'cactus', rock: 0xc0703c },
  sumpf: { deep: 0x3f7a4e, shallow: 0x7aa563, foam: 0xd9efc4, grass: 0x5c7d3a, grass2: 0x4c6b2f, wall: 0x5b4a2e, sky: 0x9cc3a0, horizon: 0xd9e6c4, crown: [0x556b2f, 0x6b8e23, 0x4a5d23], trunk: 0x5a4030, tree: 'droopy', spikeBody: 0x4b5a2a, spike: 0xb36ad6, spikeStyle: 'hedge', rock: 0x6f6a5a },
  berg: { deep: 0x2489cf, shallow: 0x84dcff, foam: 0xffffff, grass: 0x7fb25a, grass2: 0x6b9e4a, wall: 0x8d8d8d, sky: 0x6fb8f0, horizon: 0xe2f3ff, crown: [0x2e6b3a, 0x3a7d46, 0x285e33], trunk: 0x6a4a2a, tree: 'pine', spikeBody: 0x7a5230, spike: 0xd9d9d9, spikeStyle: 'stakes', rock: 0x8f8f8f },
  park: { deep: 0x1e9be8, shallow: 0x7fe3ff, foam: 0xffffff, grass: 0x7ccf52, grass2: 0x6abf45, wall: 0xf26b5b, sky: 0x6ec6ff, horizon: 0xe6f6ff, crown: [0x4caf50, 0x66bb44, 0xff9ec0, 0x3d9a3d], trunk: 0x7a5230, tree: 'round', spikeBody: 0x2f6b2a, spike: 0xe04fa0, spikeStyle: 'hedge', rock: 0x9a5a2a, support: 0x3f7bd9 },
  eis: { deep: 0x3aaed8, shallow: 0xaeefff, foam: 0xffffff, grass: 0xf2f7fb, grass2: 0xe3eef6, wall: 0xa9cfe6, sky: 0x9fd6f5, horizon: 0xf3fbff, crown: [0xdfeef3, 0xcfe3ea, 0x9cc4b0], trunk: 0x6a4a2a, tree: 'pine', spikeBody: 0xbfeaff, spike: 0xf2fdff, spikeStyle: 'ice', rock: 0xeaf6ff },
};

const V = new THREE.Vector3(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3();
const M4 = (x, y, z, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(V.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S.set(sx, sy, sz)).clone();

// Mehrere Grundformen mit Farben zu einer Geometrie verschmelzen (spart Zeichenaufrufe)
export function merge(parts) {
  const gs = parts.map((p) => {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    g.applyMatrix4(p.m);
    g.computeVertexNormals();
    return g;
  });
  let n = 0;
  for (const g of gs) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  const c = new THREE.Color();
  gs.forEach((g, k) => {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    c.set(parts[k].color);
    for (let i = 0; i < g.attributes.position.count; i++) { col[(o + i) * 3] = c.r; col[(o + i) * 3 + 1] = c.g; col[(o + i) * 3 + 2] = c.b; }
    o += g.attributes.position.count;
    g.dispose();
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

const WATER_VS = `
attribute float aCur; attribute float aRap;
varying vec2 vUv; varying float vCur; varying float vRap;
#include <fog_pars_vertex>
void main() {
  vUv = uv; vCur = aCur; vRap = aRap;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const WATER_FS = `
uniform float uTime; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uFoam;
varying vec2 vUv; varying float vCur; varying float vRap;
#include <fog_pars_fragment>
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
void main() {
  float u = vUv.x, s = vUv.y, e = abs(u);
  vec3 col = mix(uDeep, uShallow, smoothstep(0.25, 1.0, e));
  float fl = s * 0.13 - uTime * vCur * 0.13;
  float n = noise(vec2(u * 6.0, fl)) * 0.6 + noise(vec2(u * 13.0 + 3.0, fl * 2.6 + 1.7)) * 0.4;
  float streak = smoothstep(0.66 - vRap * 0.2, 0.74 - vRap * 0.2, n) * clamp(vCur / 2.4, 0.35, 1.0);
  float ef = smoothstep(0.84, 0.97, e + 0.06 * sin(s * 1.3 + uTime * 2.2));
  float sparkle = step(0.985, noise(vec2(u * 40.0, s * 3.0 - uTime * 2.0)));
  col = mix(col, uFoam, clamp(max(streak * (0.45 + vRap * 0.4), ef * 0.85) + sparkle * 0.4, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function spiralTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.translate(64, 64);
  for (let k = 0; k < 3; k++) {
    g.beginPath();
    for (let a = 0; a < 9; a += 0.05) {
      const r = 4 + a * 6.6, x = Math.cos(a + k * 2.09) * r, y = Math.sin(a + k * 2.09) * r;
      if (a === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 5; g.stroke();
  }
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 64);
  gr.addColorStop(0, 'rgba(0,40,80,0.45)'); gr.addColorStop(1, 'rgba(0,40,80,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 64, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function bannerTexture(text, finish) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  if (finish) {
    for (let x = 0; x < 512; x += 32) for (let y = 0; y < 128; y += 32) { g.fillStyle = ((x + y) / 32) % 2 ? '#111' : '#fff'; g.fillRect(x, y, 32, 32); }
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(90, 14, 332, 100);
  } else {
    const gr = g.createLinearGradient(0, 0, 0, 128); gr.addColorStop(0, '#ff6b3d'); gr.addColorStop(1, '#ff2d6f');
    g.fillStyle = gr; g.fillRect(0, 0, 512, 128);
  }
  g.font = '900 88px "Arial Black", Impact, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 10; g.strokeStyle = finish ? '#fff' : '#5a1020'; g.strokeText(text, 256, 68);
  g.fillStyle = finish ? '#ff2d6f' : '#ffe14d'; g.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class World {
  constructor(scene, river, quality) {
    this.scene = scene;
    this.river = river;
    this.quality = quality;
    this.P = PALETTE[river.theme] || PALETTE.wald;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.vc = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.vcFlat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.disposables = [this.vc, this.vcFlat];
    this.anim = [];
    this.build();
  }

  add(obj) { this.root.add(obj); if (obj.geometry) this.disposables.push(obj.geometry); if (obj.material && obj.material !== this.vc && obj.material !== this.vcFlat) this.disposables.push(obj.material); return obj; }

  bankRows(hill) {
    return [[0, -0.8], [0, 1.0], [1.0, 1.12], [6, 1.45], [16, 2.2 + hill], [34, 5 + hill * 2], [60, 9 + hill * 3], [110, 16 + hill * 4]];
  }
  bankY(off, hill) {
    const rows = this.bankRows(hill);
    for (let k = 2; k < rows.length; k++) {
      if (off <= rows[k][0]) { const a = rows[k - 1], b = rows[k], t = (off - a[0]) / (b[0] - a[0] || 1); return a[1] + (b[1] - a[1]) * t; }
    }
    return rows[rows.length - 1][1];
  }

  build() {
    const R = this.river, P = this.P, N = R.N, q = this.quality;
    const rand = rng(R.seed + 99);
    const deco = q === 'high' ? 1 : q === 'medium' ? 0.6 : 0.3;
    this.hillPh = [rand() * 6.28, rand() * 6.28, rand() * 6.28, rand() * 6.28];
    this.hill = (i, sg) => { const p = sg > 0 ? 0 : 2; return 1.6 + 1.4 * Math.sin(i / 37 + this.hillPh[p]) + 0.9 * Math.sin(i / 13 + this.hillPh[p + 1]); };

    // ---------------- Wasser
    {
      const us = [-1, -0.5, 0, 0.5, 1], cols = us.length;
      const pos = [], uv = [], cur = [], rap = [], idx = [];
      for (let i = 0; i < N; i++) {
        const hw = R.hw[i] + (R.flume ? 0.12 : 0.4), nx = -R.tz[i], nz = R.tx[i];
        for (const u of us) {
          pos.push(R.px[i] + nx * u * hw, R.py[i], R.pz[i] + nz * u * hw);
          uv.push(u, i); cur.push(R.cur[i]); rap.push(R.rapid[i]);
        }
        if (i > 0) for (let k = 0; k < cols - 1; k++) { const a = (i - 1) * cols + k, b = a + cols; idx.push(a, b, a + 1, a + 1, b, b + 1); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('aCur', new THREE.Float32BufferAttribute(cur, 1));
      g.setAttribute('aRap', new THREE.Float32BufferAttribute(rap, 1));
      g.setIndex(idx);
      this.waterMat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uDeep: { value: new THREE.Color(P.deep) }, uShallow: { value: new THREE.Color(P.shallow) }, uFoam: { value: new THREE.Color(P.foam) } }]),
        vertexShader: WATER_VS, fragmentShader: WATER_FS, fog: true, side: THREE.DoubleSide,
      });
      this.add(new THREE.Mesh(g, this.waterMat));
    }

    if (R.flume) this.buildFlume(rand);
    // ---------------- Ufer (beidseitig): Wand, Wiese, Hügel
    const grass = new THREE.Color(P.grass), grass2 = new THREE.Color(P.grass2), wall = new THREE.Color(P.wall), tmp = new THREE.Color();
    for (const sg of (R.flume ? [] : [1, -1])) {
      const pos = [], col = [], idx = [];
      const step = 2;
      let rowsN = 0, ni = 0;
      for (let i = 0; i < N + step; i += step) {
        const ii = Math.min(i, N - 1);
        const hw = R.hw[ii], nx = -R.tz[ii] * sg, nz = R.tx[ii] * sg, y0 = R.py[ii];
        const rows = this.bankRows(this.hill(ii, sg));
        rowsN = rows.length;
        rows.forEach(([off, dy], k) => {
          pos.push(R.px[ii] + nx * (hw + off), y0 + dy, R.pz[ii] + nz * (hw + off));
          if (k < 2) tmp.copy(wall).multiplyScalar(k === 0 ? 0.7 : 1);
          else tmp.copy(grass).lerp(grass2, (Math.sin(ii * 0.37 + k * 1.7) * 0.5 + 0.5) * 0.8).multiplyScalar(k > 5 ? 0.9 : 1);
          col.push(tmp.r, tmp.g, tmp.b);
        });
        if (ni > 0) for (let k = 0; k < rowsN - 1; k++) { const a = (ni - 1) * rowsN + k, b = a + rowsN; idx.push(a, b, a + 1, a + 1, b, b + 1); }
        ni++;
        if (ii === N - 1) break;
      }
      // Endkappen (Start und Ziel) nicht nötig – Nebel und Kamera verdecken sie
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      this.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    }
    // Wasserfläche vor dem Start und hinter dem Ziel abschließen
    for (const [i, dir] of (R.flume ? [] : [[0, -1], [N - 1, 1]])) {
      const w = R.hw[i] * 2 + 140, g = new THREE.BoxGeometry(30, 40, w);
      const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: P.grass }));
      m.position.set(R.px[i] + R.tx[i] * dir * 15, R.py[i] - 18.8, R.pz[i] + R.tz[i] * dir * 15);
      m.rotation.y = -Math.atan2(R.tz[i], R.tx[i]);
      this.add(m);
    }

    // ---------------- Stachelufer
    {
      const spikes = [], bodies = [];
      for (const sg of [1, -1]) {
        const bit = sg > 0 ? 1 : 2;
        for (let s = 0; s < N; s += 0.85) {
          const i = Math.floor(s);
          if (!(R.spiky[i] & bit)) continue;
          const hw = R.hw[i], nx = -R.tz[i] * sg, nz = R.tx[i] * sg, ang = Math.atan2(nz, nx);
          const x = R.px[i] + R.tx[i] * (s - i), z = R.pz[i] + R.tz[i] * (s - i), y = R.py[i];
          for (const [h, l] of [[0.35, 0.05], [0.95, 0.1]]) spikes.push({ x: x + nx * (hw + l), y: y + h + rand() * 0.15, z: z + nz * (hw + l), ang });
          if (Math.floor(s / 0.85) % 2 === 0) bodies.push({ x: x + nx * (hw + 0.7), y: y + 1.0, z: z + nz * (hw + 0.7), ang });
        }
      }
      if (spikes.length) {
        const cone = new THREE.ConeGeometry(0.16, 0.75, 6);
        cone.rotateZ(Math.PI / 2);   // Spitze zeigt nach −x … Richtung Flussmitte
        const im = new THREE.InstancedMesh(cone, new THREE.MeshLambertMaterial({ color: P.spike }), spikes.length);
        spikes.forEach((p, k) => im.setMatrixAt(k, M4(p.x, p.y, p.z, 1, 1, 1, 0, -p.ang, (rand() - 0.5) * 0.5)));
        this.add(im);
        const st = P.spikeStyle;
        const bg = st === 'cactus' ? new THREE.CylinderGeometry(0.42, 0.48, 2.2, 8) : st === 'stakes' ? new THREE.CylinderGeometry(0.18, 0.2, 1.8, 6) : st === 'ice' ? new THREE.BoxGeometry(1.1, 1.4, 1.1) : new THREE.IcosahedronGeometry(0.85, 0);
        const bm = new THREE.InstancedMesh(bg, new THREE.MeshLambertMaterial({ color: P.spikeBody, flatShading: true }), bodies.length);
        bodies.forEach((p, k) => bm.setMatrixAt(k, M4(p.x, p.y + (st === 'cactus' ? 0.4 : 0), p.z, 1, st === 'hedge' ? 0.9 : 1, 1, 0, -p.ang + rand(), 0)));
        this.add(bm);
      }
    }

    // ---------------- Bäume, Büsche, Felsen am Ufer
    {
      const trees = [], rocks = [];
      for (const sg of [1, -1]) {
        for (let s = 2; s < N - 2; s += 3.2 / deco) {
          const i = Math.floor(s + rand() * 2);
          if (i >= N) break;
          const off = (R.flume ? 4 : 2.2) + Math.pow(rand(), 1.6) * 70;
          if (R.spiky[i] & (sg > 0 ? 1 : 2) && off < 3.5) continue;
          const hw = R.hw[i], nx = -R.tz[i] * sg, nz = R.tx[i] * sg;
          const x = R.px[i] + nx * (hw + off), z = R.pz[i] + nz * (hw + off), y = R.flume ? this.groundY : R.py[i] + this.bankY(off, this.hill(i, sg));
          if (rand() < 0.22) rocks.push({ x, y, z, s: 0.5 + rand() * 1.4 });
          else trees.push({ x, y, z, s: 0.75 + rand() * 0.7 });
        }
      }
      const kind = P.tree;
      let trunkG, crownG, crownY;
      if (kind === 'pine') { trunkG = new THREE.CylinderGeometry(0.2, 0.28, 1.6, 6); crownG = new THREE.ConeGeometry(1.4, 3.6, 7); crownY = 3.0; }
      else if (kind === 'cactus') { trunkG = new THREE.CylinderGeometry(0.35, 0.4, 2.6, 8); crownG = new THREE.SphereGeometry(0.36, 8, 6); crownY = 2.6; }
      else if (kind === 'droopy') { trunkG = new THREE.CylinderGeometry(0.22, 0.35, 2.6, 6); crownG = new THREE.IcosahedronGeometry(1.6, 0); crownY = 3.2; }
      else { trunkG = new THREE.CylinderGeometry(0.2, 0.3, 2.0, 6); crownG = new THREE.IcosahedronGeometry(1.5, 1); crownY = 2.9; }
      const tm = new THREE.InstancedMesh(trunkG, new THREE.MeshLambertMaterial({ color: P.trunk }), trees.length);
      const cm = new THREE.InstancedMesh(crownG, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), trees.length);
      const cc = new THREE.Color();
      trees.forEach((t, k) => {
        tm.setMatrixAt(k, M4(t.x, t.y + (kind === 'cactus' ? 1.3 : 0.9) * t.s, t.z, t.s));
        cm.setMatrixAt(k, M4(t.x, t.y + crownY * t.s, t.z, t.s, t.s * (kind === 'droopy' ? 0.7 : 1), t.s, 0, rand() * 6, 0));
        cc.set(P.crown[k % P.crown.length]);
        cm.setColorAt(k, cc);
      });
      this.add(tm); this.add(cm);
      const rm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: P.rock, flatShading: true }), rocks.length);
      rocks.forEach((r, k) => rm.setMatrixAt(k, M4(r.x, r.y + r.s * 0.3, r.z, r.s, r.s * 0.7, r.s, rand(), rand() * 6, rand())));
      this.add(rm);
      // Seerosen im Sumpf (und ein paar im Wald)
      if (R.theme === 'sumpf' || R.theme === 'wald') {
        const pads = [];
        for (let s = 10; s < N; s += (R.theme === 'sumpf' ? 2.2 : 7) / deco) {
          const i = Math.floor(s), sg = rand() < 0.5 ? 1 : -1, hw = R.hw[i];
          const off = hw - 0.4 - rand() * 1.6;
          pads.push({ x: R.px[i] - R.tz[i] * sg * off, y: R.py[i] + 0.04, z: R.pz[i] + R.tx[i] * sg * off, s: 0.4 + rand() * 0.5, r: rand() * 6 });
        }
        const pg = merge([
          { geo: new THREE.CylinderGeometry(1, 1, 0.05, 12, 1, false, 0.4, Math.PI * 2 - 0.4), color: 0x4caf50, m: M4(0, 0, 0) },
          { geo: new THREE.SphereGeometry(0.25, 6, 4), color: 0xff8fc8, m: M4(0.3, 0.12, 0.2, 1, 0.6, 1) },
        ]);
        const pm = new THREE.InstancedMesh(pg, this.vc, pads.length);
        pads.forEach((p, k) => pm.setMatrixAt(k, M4(p.x, p.y, p.z, p.s, 1, p.s, 0, p.r, 0)));
        this.add(pm);
      }
    }

    // ---------------- Hindernisse
    const rocksO = R.obstacles.filter((o) => o.type === 'rock');
    if (rocksO.length) {
      const ice = R.theme === 'eis', barrel = R.theme === 'park';
      const im = new THREE.InstancedMesh(ice ? new THREE.CylinderGeometry(1, 1.05, 1, 7) : barrel ? new THREE.CylinderGeometry(0.9, 0.9, 1.6, 12) : new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: ice ? 0xeaf6ff : P.rock, flatShading: true }), rocksO.length);
      rocksO.forEach((o, k) => {
        const i = clamp(Math.round(o.s), 0, N - 1);
        if (barrel) { im.setMatrixAt(k, M4(o.x, R.py[i] + 0.3, o.z, o.r, 1, o.r, 0, o.rot, 0)); return; }
        im.setMatrixAt(k, ice ? M4(o.x, R.py[i] + 0.15, o.z, o.r, 0.5, o.r, 0, o.rot, 0) : M4(o.x, R.py[i] - 0.1, o.z, o.r * 1.05, o.h, o.r * 1.05, 0.2, o.rot, 0.1));
      });
      this.add(im);
    }
    this.buoys = R.obstacles.filter((o) => o.type === 'buoy');
    if (this.buoys.length) {
      const parts = [
        { geo: new THREE.SphereGeometry(0.62, 12, 8), color: 0xff4d4d, m: M4(0, 0, 0) },
        { geo: new THREE.CylinderGeometry(0.63, 0.63, 0.22, 14), color: 0xffffff, m: M4(0, 0, 0) },
      ];
      for (let k = 0; k < 10; k++) {
        const a = k * Math.PI * 2 / 10, up = k % 2 ? 0.35 : -0.15;
        parts.push({ geo: new THREE.ConeGeometry(0.12, 0.55, 5), color: 0x444444, m: M4(Math.cos(a) * 0.7, up, Math.sin(a) * 0.7, 1, 1, 1, 0, -a, -Math.PI / 2) });
      }
      parts.push({ geo: new THREE.ConeGeometry(0.12, 0.5, 5), color: 0x444444, m: M4(0, 0.75, 0) });
      this.buoyMesh = new THREE.InstancedMesh(merge(parts), this.vc, this.buoys.length);
      this.buoyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.add(this.buoyMesh);
    }
    this.bars = [];
    for (const o of R.obstacles.filter((x) => x.type === 'bar')) {
      const parts = [
        { geo: new THREE.CylinderGeometry(0.45, 0.55, 2.6, 10), color: 0x8a5a2b, m: M4(0, 0.6, 0) },
        { geo: new THREE.CylinderGeometry(0.55, 0.55, 0.25, 10), color: 0xffd23f, m: M4(0, 1.95, 0) },
        { geo: new THREE.BoxGeometry(o.len, 0.38, 0.38), color: 0xb5793c, m: M4(o.len / 2, 0.65, 0) },
        { geo: new THREE.BoxGeometry(0.4, 0.42, 0.42), color: 0xff5a5f, m: M4(o.len - 0.2, 0.65, 0) },
      ];
      if (o.spiky) for (let x = 0.9; x < o.len - 0.3; x += 0.7) for (const sz of [1, -1]) parts.push({ geo: new THREE.ConeGeometry(0.1, 0.45, 5), color: 0xdddddd, m: M4(x, 0.65, sz * 0.38, 1, 1, 1, sz * Math.PI / 2, 0, 0) });
      const m = this.add(new THREE.Mesh(merge(parts), this.vc));
      const i = clamp(Math.round(o.s), 0, N - 1);
      m.position.set(o.px, R.py[i], o.pz);
      this.bars.push({ o, m });
    }
    for (const o of R.obstacles.filter((x) => x.type === 'log')) {
      const L = Math.hypot(o.bx - o.ax, o.bz - o.az);
      const g = merge([
        { geo: new THREE.CylinderGeometry(0.45, 0.45, L, 10), color: 0x7a5230, m: M4(0, 0, 0, 1, 1, 1, 0, 0, Math.PI / 2) },
        { geo: new THREE.CylinderGeometry(0.4, 0.4, 0.05, 10), color: 0xd9b48a, m: M4(L / 2 + 0.01, 0, 0, 1, 1, 1, 0, 0, Math.PI / 2) },
        { geo: new THREE.CylinderGeometry(0.4, 0.4, 0.05, 10), color: 0xd9b48a, m: M4(-L / 2 - 0.01, 0, 0, 1, 1, 1, 0, 0, Math.PI / 2) },
        { geo: new THREE.CylinderGeometry(0.1, 0.12, 0.8, 5), color: 0x6a4524, m: M4(L * 0.2, 0.4, 0.2, 1, 1, 1, 0.5, 0, 0.3) },
      ]);
      const m = this.add(new THREE.Mesh(g, this.vc));
      const i = clamp(Math.round(o.s), 0, N - 1);
      m.position.set((o.ax + o.bx) / 2, R.py[i] + 0.1, (o.az + o.bz) / 2);
      m.rotation.y = -Math.atan2(o.bz - o.az, o.bx - o.ax);
      this.anim.push((t) => { m.position.y = R.py[i] + 0.1 + Math.sin(t * 1.3 + i) * 0.06; });
    }
    if (R.whirls.length) {
      const tex = spiralTexture();
      this.disposables.push(tex);
      for (const w of R.whirls) {
        const i = clamp(Math.round(w.s), 0, N - 1);
        const m = this.add(new THREE.Mesh(new THREE.CircleGeometry(w.r, 32), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })));
        m.rotation.x = -Math.PI / 2;
        m.position.set(w.x, R.py[i] + 0.06, w.z);
        m.renderOrder = 1;
        if (w.dir < 0) m.scale.x = -1;
        this.anim.push((t) => { m.rotation.z = t * 1.6 * w.dir; });
      }
    }

    // ---------------- Gegenstände
    const can = merge([
      { geo: new THREE.CylinderGeometry(0.34, 0.34, 0.7, 12), color: 0xc9d1d9, m: M4(0, 0, 0) },
      { geo: new THREE.CylinderGeometry(0.35, 0.35, 0.42, 12), color: 0xff7a2f, m: M4(0, 0, 0) },
      { geo: new THREE.SphereGeometry(0.12, 6, 4), color: 0x8a3a1a, m: M4(0.3, 0.05, 0, 0.6, 1, 0.9) },
      { geo: new THREE.SphereGeometry(0.1, 6, 4), color: 0x8a3a1a, m: M4(0.22, -0.08, 0.2, 0.6, 1, 0.9) },
    ]);
    const gold = merge([
      { geo: new THREE.SphereGeometry(0.4, 12, 8), color: 0xffd23f, m: M4(0, 0, 0, 1.3, 0.85, 0.85) },
      { geo: new THREE.SphereGeometry(0.1, 6, 4), color: 0xfff7c2, m: M4(0.2, 0.18, 0.2) },
    ]);
    const pump = merge([
      { geo: new THREE.CylinderGeometry(0.22, 0.26, 0.9, 10), color: 0xff3b3b, m: M4(0, 0, 0) },
      { geo: new THREE.CylinderGeometry(0.05, 0.05, 0.5, 6), color: 0x666666, m: M4(0, 0.6, 0) },
      { geo: new THREE.BoxGeometry(0.6, 0.1, 0.1), color: 0x333333, m: M4(0, 0.85, 0) },
      { geo: new THREE.BoxGeometry(0.5, 0.06, 0.4), color: 0x333333, m: M4(0, -0.45, 0) },
    ]);
    this.pick = {};
    for (const [type, geo] of [['bean', can], ['gold', gold], ['pump', pump]]) {
      const list = R.pickups.filter((p) => p.type === type);
      if (!list.length) { geo.dispose(); continue; }
      const im = new THREE.InstancedMesh(geo, this.vc, list.length);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.add(im);
      this.pick[type] = { im, list };
    }

    // ---------------- Tore: Start, Kontrollpunkte, Ziel
    const gate = (s, kind) => {
      const p = R.sample(s), hw = p.hw + 1.0, nx = -p.tz, nz = p.tx, ang = Math.atan2(p.tz, p.tx);
      const parts = [];
      const H = kind === 'cp' ? 5.5 : 9.5;
      for (const sg of [1, -1]) parts.push({ geo: new THREE.CylinderGeometry(0.22, 0.26, H + 2, 8), color: kind === 'cp' ? 0xffffff : 0xffd23f, m: M4(0, H / 2, sg * hw) });
      if (kind === 'cp') {
        parts.push({ geo: new THREE.CylinderGeometry(0.04, 0.04, hw * 2, 4), color: 0x555555, m: M4(0, H, 0, 1, 1, 1, Math.PI / 2, 0, 0) });
        const cols = [0xff5a5f, 0xffd23f, 0x3fa7ff, 0x5ce06b];
        for (let z = -hw + 0.6, k = 0; z < hw - 0.4; z += 0.9, k++) parts.push({ geo: new THREE.ConeGeometry(0.32, 0.8, 3), color: cols[k % 4], m: M4(0, H - 0.45, z, 1, 1, 0.3, Math.PI, 0, 0) });
      } else {
        parts.push({ geo: new THREE.BoxGeometry(0.4, 0.4, hw * 2 + 0.6), color: 0xffd23f, m: M4(0, H + 1.6, 0) });
      }
      const m = this.add(new THREE.Mesh(merge(parts), this.vc));
      m.position.set(p.x, p.y, p.z);
      m.rotation.y = -ang;
      if (kind !== 'cp') {
        const tex = bannerTexture(kind === 'finish' ? 'ZIEL' : 'START', kind === 'finish');
        this.disposables.push(tex);
        const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
        const b = this.add(new THREE.Mesh(new THREE.PlaneGeometry(Math.min(hw * 2 - 0.6, 12), 2.4), mat));
        b.position.set(p.x, p.y + H + 0.3, p.z);
        b.rotation.y = -ang - Math.PI / 2;   // Schrift zeigt dem ankommenden Boot entgegen
      }
    };
    gate(START, 'start');
    R.checkpoints.forEach((s) => gate(s, 'cp'));
    gate(R.finish, 'finish');
  }

  // Wildwasserbahn: Rinne auf Stelzen hoch über dem Boden, an offenen Stellen ohne Wand
  buildFlume(rand) {
    const R = this.river, P = this.P, N = R.N;
    let minY = 0, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < N; i++) { minY = Math.min(minY, R.py[i]); x0 = Math.min(x0, R.px[i]); x1 = Math.max(x1, R.px[i]); z0 = Math.min(z0, R.pz[i]); z1 = Math.max(z1, R.pz[i]); }
    const gy = this.groundY = minY - 16;
    // Boden
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0 + 500, z1 - z0 + 500), new THREE.MeshLambertMaterial({ color: P.grass }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((x0 + x1) / 2, gy, (z0 + z1) / 2);
    this.add(ground);
    // Wandhöhe je Seite (geglättet)
    const wallH = (i, bit) => {
      let k = 0, n = 0;
      for (let j = i - 2; j <= i + 2; j++) { if (j < 0 || j >= N) continue; k += R.open[j] & bit ? 1 : 0; n++; }
      const f = k / n;
      return 1.1 * (1 - f) + 0.12 * f;
    };
    const inner = new THREE.Color(0xeaf7ff), rim = new THREE.Color(0xffffff), warn = new THREE.Color(0xffd23f), outer = new THREE.Color(P.wall), under = new THREE.Color(P.wall).multiplyScalar(0.6), c = new THREE.Color();
    for (const sg of [1, -1]) {
      const bit = sg > 0 ? 1 : 2, pos = [], col = [], idx = [];
      const rowsN = 6;
      for (let i = 0; i < N; i++) {
        const hw = R.hw[i], nx = -R.tz[i] * sg, nz = R.tx[i] * sg, y0 = R.py[i], h = wallH(i, bit);
        const openK = (1.1 - h) / 0.98;
        const rows = [[0, -0.5, inner], [0, h, inner], [0, h, rim], [0.3, h, rim], [0.3, -1.3, outer], [-hw, -1.3, under]];
        for (const [off, dy, cc] of rows) {
          pos.push(R.px[i] + nx * (hw + off), y0 + dy, R.pz[i] + nz * (hw + off));
          c.copy(cc);
          if (cc === rim) c.lerp(warn, openK);
          col.push(c.r, c.g, c.b);
        }
        if (i > 0) for (let k = 0; k < rowsN - 1; k++) { if (k === 1) continue; const a = (i - 1) * rowsN + k, b = a + rowsN; idx.push(a, b, a + 1, a + 1, b, b + 1); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      this.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    }
    // Endwände
    for (const i of [0, N - 1]) {
      const m = this.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.4, R.hw[i] * 2 + 0.6), new THREE.MeshLambertMaterial({ color: P.wall })));
      m.position.set(R.px[i], R.py[i] - 0.1, R.pz[i]);
      m.rotation.y = -Math.atan2(R.tz[i], R.tx[i]);
    }
    // Stelzen mit Querträger
    const legs = [], beams = [];
    for (let i = 3; i < N - 1; i += 7) {
      const hw = R.hw[i], nx = -R.tz[i], nz = R.tx[i], top = R.py[i] - 1.3, h = top - gy;
      for (const sg of [1, -1]) legs.push({ x: R.px[i] + nx * sg * (hw - 0.4), z: R.pz[i] + nz * sg * (hw - 0.4), y: gy + h / 2, h });
      beams.push({ x: R.px[i], y: top - 0.25, z: R.pz[i], w: hw * 2, ang: Math.atan2(R.tz[i], R.tx[i]) });
    }
    const lm = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.34, 1, 8), new THREE.MeshLambertMaterial({ color: P.support }), legs.length);
    legs.forEach((l, k) => lm.setMatrixAt(k, M4(l.x, l.y, l.z, 1, l.h, 1)));
    this.add(lm);
    const bm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.5, 1), new THREE.MeshLambertMaterial({ color: P.support }), beams.length);
    beams.forEach((b, k) => bm.setMatrixAt(k, M4(b.x, b.y, b.z, 1, 1, b.w, 0, -b.ang, 0)));
    this.add(bm);
    void rand;
  }

  update(t, dt, sim) {
    this.waterMat.uniforms.uTime.value = t;
    for (const f of this.anim) f(t);
    const R = this.river;
    if (this.buoyMesh) {
      this.buoys.forEach((o, k) => {
        obstaclePose(o, sim.clock);
        const i = clamp(Math.round(o.s), 0, R.N - 1);
        this.buoyMesh.setMatrixAt(k, M4(o.x, R.py[i] + 0.15 + Math.sin(t * 2 + k) * 0.08, o.z, 1, 1, 1, Math.sin(t * 1.7 + k) * 0.12, t * 0.6 + k, 0));
      });
      this.buoyMesh.instanceMatrix.needsUpdate = true;
    }
    for (const b of this.bars) { obstaclePose(b.o, sim.clock); b.m.rotation.y = -b.o.ang; }
    for (const type in this.pick) {
      const { im, list } = this.pick[type];
      list.forEach((p, k) => {
        const got = sim.collected.has(p.id);
        const i = clamp(Math.round(p.s), 0, R.N - 1);
        const sc = got ? 0.0001 : type === 'gold' ? 1.2 : 1;
        im.setMatrixAt(k, M4(p.x, R.py[i] + 0.55 + Math.sin(t * 2.5 + p.id) * 0.15, p.z, sc, sc, sc, type === 'bean' ? 0.4 : 0, t * 1.8 + p.id, 0));
      });
      im.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    this.root.removeFromParent();
    for (const d of this.disposables) try { d.dispose(); } catch (_) { /* egal */ }
    this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
}

// Himmelskuppel mit Farbverlauf
export function makeSky(P) {
  const g = new THREE.SphereGeometry(500, 24, 12);
  const top = new THREE.Color(P.sky), hor = new THREE.Color(P.horizon), c = new THREE.Color();
  const col = [];
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 500;
    c.copy(hor).lerp(top, clamp(y * 2.2, 0, 1));
    col.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  m.renderOrder = -10;
  return m;
}
