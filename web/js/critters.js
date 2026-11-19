// Die Floß-Besatzung: knuffige Tiere aus einfachen Grundformen (Blickrichtung +x, Po bei −x)
import * as THREE from './lib/three.module.min.js';

export const ANIMALS = [
  { id: 'schwein', name: 'Schwein', body: 0xf6a6b8, belly: 0xfcd0da, pitch: 1.0 },
  { id: 'frosch', name: 'Frosch', body: 0x6cc04a, belly: 0xd7ef9a, pitch: 1.35 },
  { id: 'baer', name: 'Bär', body: 0x9a6a44, belly: 0xd9b48a, pitch: 0.7 },
  { id: 'kuh', name: 'Kuh', body: 0xf4f1ea, belly: 0xf4f1ea, pitch: 0.8 },
  { id: 'katze', name: 'Katze', body: 0xf29a3c, belly: 0xffe0b8, pitch: 1.55 },
  { id: 'pinguin', name: 'Pinguin', body: 0x2c3442, belly: 0xf7f7f2, pitch: 1.2 },
];
export const animalById = (id) => ANIMALS.find((a) => a.id === id) || ANIMALS[0];
export const SEAT_COLORS = ['#ff5a5f', '#3fa7ff', '#ffd23f', '#5ce06b'];

const mats = new Map();
const mat = (c) => {
  if (!mats.has(c)) mats.set(c, new THREE.MeshLambertMaterial({ color: c }));
  return mats.get(c);
};
const SPH = new THREE.SphereGeometry(1, 18, 12);
const SPH_LO = new THREE.SphereGeometry(1, 10, 8);
const CONE = new THREE.ConeGeometry(1, 1, 10);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 12);
const TOR = new THREE.TorusGeometry(1, 0.32, 6, 12, Math.PI * 1.6);

function ball(parent, color, x, y, z, sx, sy = sx, sz = sx, lo = false) {
  const m = new THREE.Mesh(lo ? SPH_LO : SPH, mat(color));
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  parent.add(m);
  return m;
}

export class Critter {
  constructor(animalId) {
    const A = this.def = animalById(animalId);
    const g = this.group = new THREE.Group();
    const body = this.body = new THREE.Group();
    g.add(body);
    // Körper (sitzend, leicht nach hinten über den Rand gelehnt)
    ball(body, A.body, -0.05, 0.42, 0, 0.5, 0.48, 0.46);
    ball(body, A.belly, 0.2, 0.38, 0, 0.32, 0.36, 0.34);
    // Po-Backen (für die Pups-Animation)
    this.buttL = ball(body, A.body, -0.42, 0.3, 0.17, 0.2, 0.22, 0.2, true);
    this.buttR = ball(body, A.body, -0.42, 0.3, -0.17, 0.2, 0.22, 0.2, true);
    // Füße
    ball(body, A.id === 'pinguin' || A.id === 'frosch' ? 0xf5a623 : A.body, 0.38, 0.1, 0.2, 0.16, 0.1, 0.13, true);
    ball(body, A.id === 'pinguin' || A.id === 'frosch' ? 0xf5a623 : A.body, 0.38, 0.1, -0.2, 0.16, 0.1, 0.13, true);
    if (A.id === 'frosch') { this.legs = true; }
    // Arme
    ball(body, A.body, 0.12, 0.45, 0.42, 0.12, 0.2, 0.12, true);
    ball(body, A.body, 0.12, 0.45, -0.42, 0.12, 0.2, 0.12, true);
    // Kopf
    const head = this.head = new THREE.Group();
    head.position.set(0.12, 0.95, 0);
    body.add(head);
    const hr = A.id === 'frosch' ? 0.36 : 0.34;
    ball(head, A.body, 0, 0, 0, hr, A.id === 'frosch' ? 0.28 : hr, A.id === 'frosch' ? 0.42 : hr);
    // Augen
    const eyeY = A.id === 'frosch' ? 0.22 : 0.08, eyeX = A.id === 'frosch' ? 0.1 : 0.27, eyeZ = A.id === 'frosch' ? 0.18 : 0.13, er = A.id === 'frosch' ? 0.14 : 0.085;
    this.eyes = [];
    for (const sz of [1, -1]) {
      if (A.id === 'frosch') ball(head, A.body, eyeX - 0.02, eyeY - 0.02, eyeZ * sz, er + 0.03);
      const e = ball(head, 0xffffff, eyeX, eyeY, eyeZ * sz, er, er * 1.1, er);
      ball(head, 0x1a1a1a, eyeX + er * 0.7, eyeY + 0.01, eyeZ * sz, er * 0.45, er * 0.55, er * 0.45, true);
      this.eyes.push(e);
    }
    // Wangen (blähen sich beim Pupsen auf)
    this.cheeks = [ball(head, 0xff8fa3, 0.24, -0.08, 0.2, 0.07, 0.05, 0.07, true), ball(head, 0xff8fa3, 0.24, -0.08, -0.2, 0.07, 0.05, 0.07, true)];
    // tierspezifische Teile
    const ear = (x, y, z, s, c, rz = 0, rx = 0) => {
      const m = new THREE.Mesh(CONE, mat(c));
      m.position.set(x, y, z); m.scale.set(s, s * 1.4, s * 0.6); m.rotation.set(rx, 0, rz); m.castShadow = true;
      head.add(m); return m;
    };
    if (A.id === 'schwein') {
      const sn = new THREE.Mesh(CYL, mat(0xf27d98)); sn.rotation.z = Math.PI / 2; sn.position.set(0.33, -0.05, 0); sn.scale.set(0.12, 0.1, 0.12); head.add(sn);
      ball(head, 0x8a3a50, 0.385, -0.03, 0.045, 0.025, 0.035, 0.025, true); ball(head, 0x8a3a50, 0.385, -0.03, -0.045, 0.025, 0.035, 0.025, true);
      ear(-0.02, 0.3, 0.2, 0.12, A.body, -0.3, 0.5); ear(-0.02, 0.3, -0.2, 0.12, A.body, -0.3, -0.5);
      const tail = new THREE.Mesh(TOR, mat(0xf27d98)); tail.scale.setScalar(0.07); tail.position.set(-0.55, 0.45, 0); tail.rotation.y = Math.PI / 2; body.add(tail);
    } else if (A.id === 'frosch') {
      const mouth = new THREE.Mesh(TOR, mat(0x3d7a2a)); mouth.scale.set(0.22, 0.12, 0.22); mouth.position.set(0.3, -0.06, 0); mouth.rotation.set(0, Math.PI / 2, Math.PI * 1.3); head.add(mouth);
      this.cheeks.forEach((c) => c.material = mat(0xa6e07a));
    } else if (A.id === 'baer') {
      ball(head, A.belly, 0.27, -0.07, 0, 0.14, 0.11, 0.15);
      ball(head, 0x2a1a10, 0.4, -0.03, 0, 0.05, 0.04, 0.06, true);
      ball(head, A.body, -0.03, 0.27, 0.24, 0.11, 0.11, 0.06); ball(head, A.body, -0.03, 0.27, -0.24, 0.11, 0.11, 0.06);
      ball(head, A.belly, -0.01, 0.27, 0.245, 0.06, 0.06, 0.04, true); ball(head, A.belly, -0.01, 0.27, -0.245, 0.06, 0.06, 0.04, true);
    } else if (A.id === 'kuh') {
      ball(body, 0x222222, -0.2, 0.55, 0.3, 0.2, 0.18, 0.12, true); ball(body, 0x222222, 0.05, 0.3, -0.33, 0.18, 0.16, 0.14, true); ball(body, 0x222222, -0.35, 0.5, -0.15, 0.15, 0.15, 0.15, true);
      ball(head, 0xf7b9c4, 0.27, -0.1, 0, 0.14, 0.11, 0.17);
      ball(head, 0x222222, 0.05, 0.2, 0.2, 0.1, 0.08, 0.06, true);
      ear(0, 0.28, 0.2, 0.06, 0xe8dcc0, -0.2, 0.7); ear(0, 0.28, -0.2, 0.06, 0xe8dcc0, -0.2, -0.7);
      const e1 = ball(head, A.body, -0.05, 0.12, 0.36, 0.06, 0.12, 0.06, true); e1.rotation.x = 1.2; const e2 = ball(head, A.body, -0.05, 0.12, -0.36, 0.06, 0.12, 0.06, true); e2.rotation.x = -1.2;
    } else if (A.id === 'katze') {
      ear(0, 0.3, 0.17, 0.1, A.body, 0, 0.25); ear(0, 0.3, -0.17, 0.1, A.body, 0, -0.25);
      ball(head, A.belly, 0.27, -0.09, 0, 0.12, 0.09, 0.15);
      ball(head, 0xff6f91, 0.37, -0.03, 0, 0.035, 0.03, 0.04, true);
      const tail = new THREE.Mesh(CYL, mat(A.body)); tail.scale.set(0.06, 0.7, 0.06); tail.position.set(-0.6, 0.6, 0); tail.rotation.z = 0.7; body.add(tail);
      ball(body, 0xc8701e, -0.05, 0.62, 0, 0.36, 0.08, 0.4, true);
    } else if (A.id === 'pinguin') {
      const beak = new THREE.Mesh(CONE, mat(0xf5a623)); beak.rotation.z = -Math.PI / 2; beak.position.set(0.4, -0.04, 0); beak.scale.set(0.09, 0.18, 0.09); head.add(beak);
      ball(head, A.belly, 0.15, -0.02, 0, 0.24, 0.24, 0.26);
      this.eyes.forEach((e) => e.position.x += 0.03);
    }
    this.fartAmt = 0;
    this.t = Math.random() * 10;
    this.flying = null;
  }

  // Animation: farting 0..1, turbo, dt
  update(dt, farting, turbo, gas) {
    this.t += dt;
    this.fartAmt += ((farting ? 1 : 0) - this.fartAmt) * Math.min(1, dt * 12);
    const f = this.fartAmt, t = this.t;
    const shake = f * (turbo ? 0.05 : 0.03);
    this.body.position.set(Math.sin(t * 47) * shake, Math.abs(Math.sin(t * 2.2)) * 0.03 + f * 0.05, Math.cos(t * 39) * shake);
    // beim Pupsen nach vorne lehnen, Po hoch
    this.body.rotation.z = -f * 0.28;
    const sq = 1 + f * 0.12 * Math.sin(t * 30);
    this.body.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
    const ck = 0.07 + f * 0.05;
    for (const c of this.cheeks) c.scale.set(ck, 0.05 + f * 0.04, ck);
    this.head.rotation.x = Math.sin(t * 1.3) * 0.08;
    this.head.rotation.z = f * 0.25;
    // Augen zukneifen beim Pressen, bei wenig Gas große Augen
    const ey = f > 0.3 ? 0.35 : gas < 0.15 ? 1.35 : (Math.sin(t * 0.9) > 0.985 ? 0.1 : 1);
    for (const e of this.eyes) e.scale.y = e.scale.x * 1.1 * ey;
    const bs = 1 + f * 0.25;
    this.buttL.scale.set(0.2 * bs, 0.22 * bs, 0.2 * bs);
    this.buttR.scale.set(0.2 * bs, 0.22 * bs, 0.2 * bs);
  }

  dispose() { this.group.removeFromParent(); }
}
