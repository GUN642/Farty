// Effekte: Pupswolken, Spritzer, Wellenringe und Comic-Schriftzüge
import * as THREE from './lib/three.module.min.js';

function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  // weiche, leicht klumpige Wolke
  for (let k = 0; k < 7; k++) {
    const x = 32 + (Math.random() - 0.5) * 18, y = 32 + (Math.random() - 0.5) * 18, r = 14 + Math.random() * 10;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const VS = `
attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
varying float vAlpha; varying vec3 vColor;
uniform float uScale;
void main() {
  vAlpha = aAlpha; vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FS = `
uniform sampler2D uMap;
varying float vAlpha; varying vec3 vColor;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(vColor * (0.75 + 0.25 * t.r), t.a * vAlpha);
  if (gl_FragColor.a < 0.01) discard;
  #include <colorspace_fragment>
}`;

export class Particles {
  constructor(scene, max = 1400) {
    this.max = max;
    this.list = [];
    const geo = this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3); this.size = new Float32Array(max); this.alpha = new Float32Array(max); this.col = new Float32Array(max * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: cloudTexture() }, uScale: { value: 400 } },
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.c = new THREE.Color();
  }

  setScale(v) { this.mat.uniforms.uScale.value = v; }

  add(x, y, z, vx, vy, vz, life, s0, s1, color, a0 = 0.85, drag = 1.5, grav = 0) {
    if (this.list.length >= this.max) this.list.shift();
    this.c.set(color);
    this.list.push({ x, y, z, vx, vy, vz, t: 0, life, s0, s1, r: this.c.r, g: this.c.g, b: this.c.b, a0, drag, grav });
  }

  // grüne Pupswolke aus dem Po: Richtung (dx, dz) ist die Austrittsrichtung
  fart(x, y, z, dx, dz, bvx, bvz, turbo, k = 1) {
    const sp = turbo ? 7.5 : 5.5;
    const cols = turbo ? ['#ffb13b', '#ffe066', '#ff7a2f'] : ['#9be03a', '#c4ee5a', '#7cc63b', '#d8f27a'];
    for (let i = 0; i < k; i++) {
      const j = 0.35;
      const vx = dx * sp * (0.7 + Math.random() * 0.6) + (Math.random() - 0.5) * sp * j + bvx * 0.6;
      const vz = dz * sp * (0.7 + Math.random() * 0.6) + (Math.random() - 0.5) * sp * j + bvz * 0.6;
      this.add(x, y, z, vx, 0.6 + Math.random() * 0.8, vz, 0.9 + Math.random() * 0.7, turbo ? 1.2 : 0.9, turbo ? 4.2 : 3.4, cols[(Math.random() * cols.length) | 0], 0.8, 2.2, -0.4);
    }
  }

  splash(x, y, z, n = 14, speed = 4) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.4 + Math.random() * 0.6);
      this.add(x, y, z, Math.cos(a) * s, 2 + Math.random() * 4, Math.sin(a) * s, 0.7 + Math.random() * 0.4, 0.5, 1.2, '#ffffff', 0.9, 0.6, 9);
    }
  }

  sparkle(x, y, z, color = '#ffe14d', n = 12) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 2 + Math.random() * 3;
      this.add(x, y, z, Math.cos(a) * s, 1 + Math.random() * 3, Math.sin(a) * s, 0.6 + Math.random() * 0.3, 0.6, 0.1, color, 1, 1.5, 3);
    }
  }

  update(dt) {
    const L = this.list;
    let n = 0;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      p.t += dt;
      if (p.t >= p.life) continue;
      const dr = Math.max(0, 1 - p.drag * dt);
      p.vx *= dr; p.vz *= dr; p.vy = p.vy * dr - p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const k = p.t / p.life;
      L[n++] = p;
    }
    L.length = n;
    for (let i = 0; i < n; i++) {
      const p = L[i], k = p.t / p.life;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.size[i] = p.s0 + (p.s1 - p.s0) * k;
      this.alpha[i] = p.a0 * (k < 0.1 ? k / 0.1 : 1 - (k - 0.1) / 0.9);
      this.col[i * 3] = p.r; this.col[i * 3 + 1] = p.g; this.col[i * 3 + 2] = p.b;
    }
    this.geo.setDrawRange(0, n);
    for (const a of ['position', 'aSize', 'aAlpha', 'aColor']) this.geo.attributes[a].needsUpdate = true;
  }

  clear() { this.list.length = 0; }
}

// flache Wellenringe auf dem Wasser
export class Ripples {
  constructor(scene, n = 28) {
    const geo = new THREE.RingGeometry(0.8, 1, 28);
    geo.rotateX(-Math.PI / 2);
    this.pool = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false;
      m.renderOrder = 2;
      scene.add(m);
      this.pool.push({ m, t: 0, life: 1, s0: 1, s1: 2 });
    }
    this.k = 0;
  }
  add(x, y, z, s0 = 1, s1 = 3, life = 1.2, op = 0.6) {
    const r = this.pool[this.k++ % this.pool.length];
    r.m.position.set(x, y + 0.03, z);
    r.t = 0; r.life = life; r.s0 = s0; r.s1 = s1; r.op = op;
    r.m.visible = true;
  }
  update(dt) {
    for (const r of this.pool) {
      if (!r.m.visible) continue;
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) { r.m.visible = false; continue; }
      const s = r.s0 + (r.s1 - r.s0) * k;
      r.m.scale.set(s, 1, s);
      r.m.material.opacity = r.op * (1 - k);
    }
  }
  clear() { for (const r of this.pool) r.m.visible = false; }
}

// Comic-Schriftzüge über den Tieren („PRRRT!“)
const WORDS = ['PRRRT!', 'PFFFT!', 'BRRAP!', 'TÖÖT!', 'PUPS!', 'FLATSCH!', 'BLUBB!', 'PÖÖK!'];
export class Words {
  constructor(scene) {
    this.tex = WORDS.map((w) => {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 96;
      const g = c.getContext('2d');
      g.font = '900 64px "Arial Black", Impact, sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineJoin = 'round'; g.lineWidth = 14; g.strokeStyle = '#3a2a00';
      g.strokeText(w, 128, 50);
      const gr = g.createLinearGradient(0, 20, 0, 80);
      gr.addColorStop(0, '#fff36b'); gr.addColorStop(1, '#8fe03a');
      g.fillStyle = gr; g.fillText(w, 128, 50);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    });
    this.pool = [];
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex[0], transparent: true, depthWrite: false, depthTest: false }));
      s.visible = false; s.renderOrder = 10;
      scene.add(s);
      this.pool.push({ s, t: 0 });
    }
    this.k = 0;
  }
  add(x, y, z) {
    const w = this.pool[this.k++ % this.pool.length];
    w.s.material.map = this.tex[(Math.random() * this.tex.length) | 0];
    w.s.position.set(x, y, z);
    w.s.material.rotation = (Math.random() - 0.5) * 0.5;
    w.t = 0; w.s.visible = true;
  }
  update(dt) {
    for (const w of this.pool) {
      if (!w.s.visible) continue;
      w.t += dt;
      if (w.t > 1.1) { w.s.visible = false; continue; }
      const k = w.t / 1.1, sc = 2.4 * (k < 0.15 ? k / 0.15 * 1.2 : 1.2 - (k - 0.15) * 0.25);
      w.s.scale.set(sc, sc * 0.375, 1);
      w.s.position.y += dt * 1.2;
      w.s.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    }
  }
  clear() { for (const w of this.pool) w.s.visible = false; }
}
