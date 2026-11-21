// Darstellung des Schlauchboots mit Besatzung, Namensschildern und Pups-Effekten
import * as THREE from './lib/three.module.min.js';
import { Critter, SEAT_COLORS } from './critters.js';
import { SEAT_R, RAFT_R } from './sim.js';
import { merge } from './world.js';

export class RaftView {
  constructor(scene, labelsEl) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.boat = new THREE.Group();
    this.group.add(this.boat);
    // Schlauch mit Streifen
    const tor = new THREE.TorusGeometry(1.88, 0.44, 12, 40);
    tor.rotateX(Math.PI / 2);
    const pos = tor.attributes.position, col = [];
    const a = new THREE.Color(0xff6a2b), b = new THREE.Color(0xffe066);
    for (let i = 0; i < pos.count; i++) {
      const ang = Math.atan2(pos.getZ(i), pos.getX(i));
      const c = Math.floor((ang + Math.PI) / (Math.PI / 6)) % 2 ? a : b;
      col.push(c.r, c.g, c.b);
    }
    tor.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.ringMat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x000000 });
    this.ring = new THREE.Mesh(tor, this.ringMat);
    this.ring.position.y = 0.3;
    this.boat.add(this.ring);
    const floor = merge([
      { geo: new THREE.CylinderGeometry(1.7, 1.75, 0.16, 32), color: 0x4fc3f7, m: new THREE.Matrix4().makeTranslation(0, 0.08, 0) },
      { geo: new THREE.CylinderGeometry(0.9, 0.9, 0.02, 24), color: 0x81d4fa, m: new THREE.Matrix4().makeTranslation(0, 0.17, 0) },
      { geo: new THREE.TorusGeometry(2.3, 0.045, 4, 48), color: 0x3b3b3b, m: new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, 0.42, 0) },
    ]);
    this.boat.add(new THREE.Mesh(floor, new THREE.MeshLambertMaterial({ vertexColors: true })));
    // Schatten auf dem Wasser
    const sc = document.createElement('canvas'); sc.width = sc.height = 64;
    const g = sc.getContext('2d'), gr = g.createRadialGradient(32, 32, 10, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,30,60,0.45)'); gr.addColorStop(1, 'rgba(0,30,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(RAFT_R * 2.8, RAFT_R * 2.8), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
    sh.rotation.x = -Math.PI / 2; sh.position.y = 0.04; sh.renderOrder = 1;
    this.group.add(sh);
    this.shadow = sh;
    this.critters = [];
    this.labelsEl = labelsEl;
    this.labels = [];
    this.flyers = [];
    this.popped = false;
    this._v = new THREE.Vector3();
  }

  // seats: [{ phi, animal, name, color }]
  setCrew(seats) {
    for (const c of this.critters) c.dispose();
    this.critters = [];
    this.labelsEl.innerHTML = '';
    this.labels = [];
    seats.forEach((s, i) => {
      const c = new Critter(s.animal);
      c.phi = s.phi;
      c.group.position.set(Math.cos(s.phi) * SEAT_R, 0.48, Math.sin(s.phi) * SEAT_R);
      this.boat.add(c.group);
      this.critters.push(c);
      const el = document.createElement('div');
      el.className = 'plabel';
      el.innerHTML = `<span class="pn"></span><div class="pg"><div></div></div>`;
      el.style.setProperty('--c', SEAT_COLORS[i % SEAT_COLORS.length]);
      el.querySelector('.pn').textContent = s.name || '';
      this.labelsEl.appendChild(el);
      this.labels.push({ el, bar: el.querySelector('.pg div'), last: -1 });
    });
  }

  // st: Schnappschuss-Zustand (x, z, a, seats …), y: Wasserhöhe
  update(dt, t, st, y, camera, fx, sound, w, h, ownSeats) {
    const G = this.group;
    const fy = st.ph === 'fallen' ? (st.fy || 0) : 0;
    G.position.set(st.x, y + fy + Math.sin(t * 2.1) * 0.05, st.z);
    this.boat.rotation.y = -st.a;
    // Schaukeln und Neigen in Fahrtrichtung
    this.boat.rotation.x = Math.sin(t * 1.7) * 0.04 + (fy < 0 ? Math.min(1.2, -fy * 0.08) : 0);
    this.boat.rotation.z = Math.cos(t * 1.3) * 0.04;
    this.shadow.visible = fy === 0;
    if (st.ph === 'fallen' && !this.wasFallen) { this.splashT = 0; }
    this.wasFallen = st.ph === 'fallen';
    this.ringMat.emissive.setHex(st.inv && Math.floor(t * 12) % 2 ? 0x662222 : 0x000000);
    const popped = st.ph === 'popped';
    if (popped !== this.popped) {
      this.popped = popped;
      if (popped) this.burst(st, y, fx);
      else { this.boat.visible = true; this.boat.scale.set(1, 1, 1); for (const c of this.critters) { c.group.visible = true; } this.flyers = []; }
    }
    if (popped) {
      const k = Math.max(0.05, this.boat.scale.x - dt * 3);
      this.boat.scale.set(k, k * 0.3, k);
      if (k <= 0.06) this.boat.visible = false;
    }
    this.updateFlyers(dt, fx, sound);

    const seats = st.st || [];
    this.critters.forEach((c, i) => {
      const s = seats[i] || [c.phi + Math.PI, 1, 0, 0];
      const face = s[0], gas = s[1], fart = !!s[2] && !popped, turbo = !!s[3];
      c.group.rotation.y = -face;
      c.update(dt, fart, turbo, gas);
      // Po-Position in Weltkoordinaten
      const wa = st.a + c.phi, fa = st.a + face;
      const bx = st.x + Math.cos(wa) * SEAT_R - Math.cos(fa) * 0.55, bz = st.z + Math.sin(wa) * SEAT_R - Math.sin(fa) * 0.55;
      if (fart) {
        c.emit = (c.emit || 0) + dt * (turbo ? 70 : 45);
        const n = Math.floor(c.emit);
        c.emit -= n;
        if (n > 0) fx.parts.fart(bx, y + 0.75, bz, -Math.cos(fa), -Math.sin(fa), st.vx || 0, st.vz || 0, turbo, n);
        c.ring = (c.ring || 0) - dt;
        if (c.ring <= 0) { c.ring = 0.12; fx.ripples.add(bx - Math.cos(fa) * 0.8, y, bz - Math.sin(fa) * 0.8, 0.4, 1.8, 0.7, 0.5); }
        if (!c.wasFart) { c.wordT = 0; if (Math.random() < 0.6) fx.words.add(bx, y + 2.6, bz); }
        c.wordT += dt;
        if (c.wordT > 2.2) { c.wordT = 0; fx.words.add(bx, y + 2.6, bz); }
      }
      c.wasFart = fart;
      // Klang
      const v = sound.voice(i, c.def.pitch);
      if (v) {
        this._v.set(bx, y + 1, bz).project(camera);
        v.set(fart, gas, turbo, this._v.x);
      }
      // Namensschild
      const L = this.labels[i];
      if (L) {
        this._v.set(st.x + Math.cos(wa) * SEAT_R, y + 2.25, st.z + Math.sin(wa) * SEAT_R).project(camera);
        const vis = this._v.z < 1 && !popped && fy === 0;
        L.el.style.display = vis ? '' : 'none';
        if (vis) L.el.style.transform = `translate(${((this._v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - this._v.y) / 2 * h).toFixed(1)}px) translate(-50%, -100%)`;
        const g = Math.round(gas * 40);
        if (g !== L.last) { L.last = g; L.bar.style.width = (gas * 100).toFixed(0) + '%'; L.el.classList.toggle('low', gas < 0.2); }
        L.el.classList.toggle('turbo', turbo);
        L.el.classList.toggle('me', !!(ownSeats && ownSeats.includes(i)));
      }
    });
    // Kielwasser
    const sp = Math.hypot(st.vx || 0, st.vz || 0);
    this.wake = (this.wake || 0) - dt * (0.5 + sp * 0.4);
    if (this.wake <= 0 && !popped) { this.wake = 1; fx.ripples.add(st.x, y, st.z, 2.3, 3.6, 1.4, 0.25); }
  }

  burst(st, y, fx) {
    fx.parts.splash(st.x, y + 0.4, st.z, 30, 6);
    for (let k = 0; k < 18; k++) fx.parts.add(st.x, y + 0.6, st.z, (Math.random() - 0.5) * 10, 3 + Math.random() * 4, (Math.random() - 0.5) * 10, 1.2, 0.6, 0.2, '#ff6a2b', 1, 0.5, 9);
    this.flyers = this.critters.map((c) => {
      const p = new THREE.Vector3();
      c.group.getWorldPosition(p);
      this.scene.attach(c.group);
      const a = Math.random() * Math.PI * 2;
      return { c, vx: Math.cos(a) * 4, vy: 8 + Math.random() * 3, vz: Math.sin(a) * 4, y0: y, spin: (Math.random() - 0.5) * 12, splashed: false };
    });
  }

  updateFlyers(dt, fx, sound) {
    for (const f of this.flyers) {
      const g = f.c.group;
      if (f.splashed) { g.position.y -= dt * 0.6; if (g.position.y < f.y0 - 1.5) g.visible = false; continue; }
      f.vy -= 20 * dt;
      g.position.x += f.vx * dt; g.position.y += f.vy * dt; g.position.z += f.vz * dt;
      g.rotation.x += f.spin * dt; g.rotation.z += f.spin * 0.7 * dt;
      if (g.position.y < f.y0 && f.vy < 0) { f.splashed = true; fx.parts.splash(g.position.x, f.y0, g.position.z, 12, 3); fx.ripples.add(g.position.x, f.y0, g.position.z, 0.5, 3, 1.2, 0.6); sound.splash(); }
    }
    if (!this.popped && this.critters.some((c) => c.group.parent !== this.boat)) {
      // nach dem Wiedereinstieg zurück aufs Boot
      for (const c of this.critters) {
        this.boat.add(c.group);
        c.group.position.set(Math.cos(c.phi) * SEAT_R, 0.48, Math.sin(c.phi) * SEAT_R);
        c.group.rotation.set(0, 0, 0);
        c.group.visible = true;
      }
    }
  }

  dispose() {
    for (const c of this.critters) c.dispose();
    this.labelsEl.innerHTML = '';
    this.group.removeFromParent();
  }
}
