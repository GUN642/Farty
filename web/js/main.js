// Farty – Das Pups-Floß: Spielablauf, Menüs, Lobby, Mehrspieler
import * as THREE from './lib/three.module.min.js';
import { $, clamp, lerp, lerpAngle, wrap, fmtTime, r2 } from './util.js';
import { loadSettings, saveSettings, loadBest, saveBest, isApp, isMobile, appVersion, appCheckUpdate, fetchVersion, enterFullscreen } from './platform.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { LEVELS, levelById, River, START } from './river.js';
import { Sim, seatAngles } from './sim.js';
import { World, PALETTE, makeSky } from './world.js';
import { RaftView } from './raft.js';
import { Particles, Ripples, Words } from './fx.js';
import { ANIMALS, animalById, SEAT_COLORS } from './critters.js';
import { netTransport, isGameCode } from './transport.js';

const QUALITY = [['high', 'Hoch'], ['medium', 'Mittel'], ['low', 'Niedrig']];
const DIFF = ['Leicht', 'Normal', 'Schwer'];
const CAMS = ['Nah', 'Normal', 'Weit'];
const SNAP_HZ = 20, INPUT_HZ = 30;

class Game {
  constructor() {
    this.settings = loadSettings();
    this.best = loadBest();
    this.input = new Input();
    this.sound = new Sound(this.settings);
    this.tr = null;
    try { this.tr = netTransport(); } catch (e) { this.tr = null; }
    this.mode = null;          // null (Menü) | 'local' | 'host' | 'client'
    this.state = 'menu';       // menu | lobby | race
    this.screen = 'menu';
    this.paused = false;
    this.peers = new Map();    // Host: pid → { name, locals, inputs, seen }
    this.locals = [{ name: this.myName(), animal: this.settings.animal }];
    this.levelId = levelById(this.settings.level).id;
    this.seed = 1;
    this.opts = {};

    // ---------------- Grafik
    const canvas = $('game');
    const q = this.settings.quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: q === 'high', powerPreference: 'high-performance' });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 900);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x88aa66, 1.6);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.8);
    this.sun.position.set(-40, 80, 30);
    this.scene.add(this.hemi, this.sun);
    this.fx = { parts: new Particles(this.scene, q === 'low' ? 700 : 1400), ripples: new Ripples(this.scene, q === 'low' ? 16 : 28), words: new Words(this.scene) };
    this.raft = new RaftView(this.scene, $('labels'));
    this.camYaw = 0; this.camPos = new THREE.Vector3(); this.camLook = new THREE.Vector3(); this.shake = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.setupUi();
    this.input.onDevice = () => this.onDevice();
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.sound.silence(); });
    const unlock = () => { this.sound.unlock(); this.sound.startMusic(1); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('gamepadconnected', unlock);

    // Hintergrund im Menü: ein Floß mit vier Tieren treibt den Fluss hinunter
    this.loadLevel(this.levelId, 7, 4, true);
    this.setupDemoCrew();
    this.showScreen('menu');
    $('loading').classList.add('hidden');

    // Einladungslink ?join=CODE
    const jm = /[?&]join=([A-Za-z0-9]{4,6})/.exec(location.search);
    if (jm && this.tr && this.tr.code) {
      try { history.replaceState(null, '', location.pathname); } catch (_) { /* egal */ }
      this.showScreen('online');
      $('o-code').value = jm[1].toUpperCase();
      this.join(jm[1].toUpperCase());
    }
    this.showVersion();
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
    window.game = this;
  }

  myName() { return (this.settings.name || '').trim() || 'Spieler'; }

  resize() {
    const q = this.settings.quality, dpr = window.devicePixelRatio || 1;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(dpr, 2) : q === 'medium' ? Math.min(dpr, 1.5) : 1);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
    this.camera.updateProjectionMatrix();
    const h = this.renderer.domElement.height;
    this.fx.parts.setScale(h / (2 * Math.tan(this.camera.fov * Math.PI / 360)));
    this.W = window.innerWidth; this.H = window.innerHeight;
  }

  // ================================================================ Strecke laden
  loadLevel(id, seed, nSeats, demo = false) {
    const def = levelById(id);
    if (this.world) this.world.dispose();
    if (this.sky) this.sky.removeFromParent();
    this.river = new River(def, seed);
    this.world = new World(this.scene, this.river, this.settings.quality);
    const P = PALETTE[this.river.theme] || PALETTE.wald;
    this.sky = makeSky(P);
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(P.horizon, this.settings.quality === 'low' ? 55 : 75, this.settings.quality === 'low' ? 190 : 260);
    this.hemi.groundColor.set(P.grass);
    this.sim = new Sim(this.river, nSeats, this.settings.difficulty);
    if (demo) { this.sim.phase = 'race'; this.sim.countdown = 0; }
    this.demo = demo;
    this.fx.parts.clear(); this.fx.ripples.clear(); this.fx.words.clear();
    this.view = this.sim.snapshot();
    this.snaps = [];
    this.clockOfs = null;
    this.collected = this.sim.collected;
    const p = this.river.sample(START);
    this.camYaw = Math.atan2(p.tz, p.tx);
    this.camInit = true;
    this.camHint = START;
    this.lastCp = undefined;
  }

  setupDemoCrew() {
    const ids = ['schwein', 'frosch', 'baer', 'katze'];
    this.seats = seatAngles(4).map((phi, i) => ({ phi, animal: ids[i], name: '' }));
    this.raft.setCrew(this.seats);
    $('labels').classList.add('hidden');
  }

  // ================================================================ Bildschirme und Navigation
  showScreen(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
    this.screen = id;
    if (id === 'online') this.refreshOnline(true);
    if (id === 'settings') this.refreshOpts();
    if (id === 'lobby') this.renderLobby();
    this.updateTouch();
    if (id) setTimeout(() => this.focusFirst(), 30);
  }
  hideScreens() { this.showScreen(null); }

  focusables() {
    const sc = this.screen && $(this.screen);
    if (!sc) return [];
    return [...sc.querySelectorAll('button, .opt, input, a.btnlink')].filter((el) => !el.disabled && el.offsetParent !== null && !el.classList.contains('ro'));
  }
  focusFirst() {
    if (this.input.device === 'touch') return;
    const f = this.focusables();
    if (!f.length) return;
    const cur = document.activeElement;
    if (f.includes(cur)) return;
    const pref = f.find((el) => el.classList.contains('big')) || f[0];
    pref.focus({ preventScroll: false });
  }
  moveFocus(dir) {
    const f = this.focusables();
    if (!f.length) return;
    const cur = document.activeElement;
    if (!f.includes(cur)) { this.focusFirst(); if (!f.includes(document.activeElement)) f[0].focus(); return; }
    const r0 = cur.getBoundingClientRect(), cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    const [dx, dy] = { 'nav-up': [0, -1], 'nav-down': [0, 1], 'nav-left': [-1, 0], 'nav-right': [1, 0] }[dir];
    let best = null, bs = 1e9;
    for (const el of f) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const along = (x - cx) * dx + (y - cy) * dy;
      if (along <= 4) continue;
      const perp = Math.abs((x - cx) * dy - (y - cy) * dx);
      const sc = along + perp * 2.2;
      if (sc < bs) { bs = sc; best = el; }
    }
    if (!best && dy) {
      // vertikal umlaufen
      const sorted = f.slice().sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
      best = dy > 0 ? sorted[0] : sorted[sorted.length - 1];
    }
    if (best) { best.focus(); best.scrollIntoView({ block: 'nearest' }); this.sound.click(); }
  }

  handleMenuAction(a) {
    const el = document.activeElement;
    const isOpt = el && el.classList && el.classList.contains('opt');
    if (a === 'nav-left' || a === 'nav-right') {
      if (isOpt) { this.cycleOpt(el, a === 'nav-right' ? 1 : -1); return; }
      if (el && el.tagName === 'INPUT') return;
      this.moveFocus(a); return;
    }
    if (a === 'nav-up' || a === 'nav-down') { this.moveFocus(a); return; }
    if (a === 'confirm') {
      if (!el || !this.focusables().includes(el)) { this.focusFirst(); return; }
      if (isOpt) { this.cycleOpt(el, 1); return; }
      if (el.tagName === 'INPUT') { el.focus(); return; }
      el.click();
      return;
    }
    if (a === 'back') this.back();
    if (a === 'pause' && this.state === 'race') this.togglePause();
  }

  back() {
    switch (this.screen) {
      case 'online': case 'settings': case 'help': this.showScreen('menu'); return 'handled';
      case 'lobby': this.leave(); return 'handled';
      case 'pause': this.togglePause(false); return 'handled';
      case 'finish': return 'handled';
      case 'menu': return 'menu';
      default:
        if (this.state === 'race') { this.togglePause(true); return 'handled'; }
        return 'menu';
    }
  }
  onBack() { return this.back(); }   // Android-Zurücktaste

  // ---------------------------------------------------------------- Auswahlfelder (◀ Wert ▶)
  defineOpt(key, get, set, values, labels) { this.opts[key] = { get, set, values, labels }; }
  cycleOpt(el, d) {
    const o = this.opts[el.dataset.key];
    if (!o || el.classList.contains('ro')) return;
    const vals = typeof o.values === 'function' ? o.values() : o.values;
    let i = vals.indexOf(o.get());
    i = (i + d + vals.length) % vals.length;
    o.set(vals[i]);
    this.sound.click();
    this.refreshOpts();
  }
  refreshOpts() {
    for (const el of document.querySelectorAll('.opt[data-key]')) {
      const o = this.opts[el.dataset.key];
      if (!o || !o.labels) continue;
      const v = el.querySelector('.ov');
      if (v) v.textContent = o.labels(o.get());
    }
  }

  setupUi() {
    const on = (id, f) => $(id).addEventListener('click', (e) => { e.preventDefault(); this.sound.unlock(); f(); });
    on('m-play', () => { enterFullscreen(); this.openLocal(); });
    on('m-online', () => { enterFullscreen(); this.showScreen('online'); });
    on('m-settings', () => this.showScreen('settings'));
    on('m-help', () => this.showScreen('help'));
    on('m-update', () => appCheckUpdate());
    on('o-back', () => this.showScreen('menu'));
    on('o-host', () => this.host());
    on('o-join', () => this.join($('o-code').value));
    $('o-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.join($('o-code').value); });
    on('l-start', () => this.startRace(this.levelId));
    on('l-back', () => this.leave());
    on('l-openonline', () => this.host());
    on('l-copy', () => this.copyInvite());
    on('p-resume', () => this.togglePause(false));
    on('p-restart', () => { this.togglePause(false); this.startRace(this.levelId); });
    on('p-lobby', () => this.toLobby());
    on('p-quit', () => this.leave());
    on('f-again', () => this.startRace(this.levelId));
    on('f-next', () => { const i = LEVELS.findIndex((l) => l.id === this.levelId); this.setLevel(LEVELS[(i + 1) % LEVELS.length].id); this.startRace(this.levelId); });
    on('f-lobby', () => this.toLobby());
    on('f-quit', () => this.leave());
    on('s-back', () => this.showScreen('menu'));
    on('h-back', () => this.showScreen('menu'));
    $('t-pause').addEventListener('touchstart', (e) => { e.preventDefault(); this.togglePause(true); }, { passive: false });
    $('s-name').value = this.settings.name || '';
    $('s-name').addEventListener('input', () => {
      this.settings.name = $('s-name').value.slice(0, 14); saveSettings(this.settings);
      this.locals[0].name = this.myName(); this.localsChanged();
    });
    for (const el of document.querySelectorAll('.opt')) {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('oprev')) this.cycleOpt(el, -1);
        else this.cycleOpt(el, 1);
        el.focus();
      });
    }
    const S = this.settings, save = () => saveSettings(S);
    this.defineOpt('animal', () => S.animal, (v) => { S.animal = v; save(); this.locals[0].animal = v; this.localsChanged(); }, ANIMALS.map((a) => a.id), (v) => animalById(v).name);
    this.defineOpt('difficulty', () => S.difficulty, (v) => { S.difficulty = v; save(); }, [0, 1, 2], (v) => DIFF[v]);
    this.defineOpt('quality', () => S.quality, (v) => { S.quality = v; save(); this.toast('Gilt ab dem nächsten Start bzw. Fluss.'); this.resize(); }, QUALITY.map((x) => x[0]), (v) => (QUALITY.find((x) => x[0] === v) || QUALITY[0])[1]);
    this.defineOpt('camera', () => S.camera, (v) => { S.camera = v; save(); }, [0, 1, 2], (v) => CAMS[v]);
    this.defineOpt('volume', () => Math.round(S.volume * 10), (v) => { S.volume = v / 10; save(); this.sound.applyVolume(); }, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], (v) => v * 10 + ' %');
    this.defineOpt('music', () => S.music, (v) => { S.music = v; save(); this.sound.applyVolume(); }, [true, false], (v) => (v ? 'An' : 'Aus'));
    this.defineOpt('level', () => this.levelId, (v) => this.setLevel(v), LEVELS.map((l) => l.id), null);
    this.refreshOpts();
  }

  onDevice() {
    this.updateTouch();
    this.updateHint();
    if (this.input.device !== 'touch' && this.screen) this.focusFirst();
  }

  updateTouch() {
    const racing = this.state === 'race' && !this.screen && this.input.device === 'touch';
    if (!racing) { this.input.setTouchMode('none'); return; }
    const mine = this.ownSeats();
    this.input.setTouchMode(mine.length >= 2 && this.seatDefs[mine[0]].pid === this.seatDefs[mine[1]].pid ? 'twin' : mine.length ? 'single' : 'none');
  }

  toast(msg, ms = 2600) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(this.toastT);
    this.toastT = setTimeout(() => t.classList.remove('on'), ms);
  }

  async showVersion() {
    const v = appVersion();
    $('m-foot').textContent = v ? 'Version ' + v : '';
    if (isApp) $('m-update').classList.remove('hidden');
    else if (!/^(file|http:\/\/localhost|http:\/\/127)/.test(location.href)) {
      const j = await fetchVersion();
      if (j && j.versionName && j.versionName !== '1.0.0-dev') { $('m-foot').textContent = 'Version ' + j.versionName; $('m-apk').classList.remove('hidden'); }
    }
  }

  // ================================================================ Lobby
  setLevel(id) {
    this.levelId = levelById(id).id;
    this.settings.level = this.levelId; saveSettings(this.settings);
    if (this.mode === 'host') this.sendLobby();
    this.renderLobby();
  }

  openLocal() {
    this.mode = 'local';
    this.state = 'lobby';
    this.showScreen('lobby');
  }

  // alle Menschen in Sitzreihenfolge
  humans() {
    if (this.mode === 'client') return (this.lobbyInfo && this.lobbyInfo.players) || [];
    const out = this.locals.map((l, li) => ({ pid: 0, li, name: l.name, animal: l.animal }));
    for (const [pid, p] of this.peers) (p.locals || []).forEach((l, li) => out.push({ pid, li, name: String(l.name || 'Gast').slice(0, 14), animal: animalById(l.animal).id }));
    return out;
  }

  buildSeats(H) {
    if (H.length === 0) return [];
    if (H.length === 1) {
      const h = H[0], i = ANIMALS.findIndex((a) => a.id === h.animal);
      // allein: zwei Tiere (rechts sitzt das eigene, links ein zweites)
      return [{ ...h, twin: 'R' }, { ...h, twin: 'L', animal: ANIMALS[(i + 1) % ANIMALS.length].id }];
    }
    // gleiche Tiere/Namen auf einem Boot unterscheidbar machen
    const used = new Set(), names = new Map();
    return H.slice(0, 4).map((h) => {
      let animal = h.animal;
      if (used.has(animal)) animal = (ANIMALS.find((a) => !used.has(a.id)) || ANIMALS[0]).id;
      used.add(animal);
      const n = (names.get(h.name) || 0) + 1;
      names.set(h.name, n);
      return { ...h, animal, name: n > 1 ? h.name + ' ' + n : h.name, twin: null };
    });
  }

  renderLobby() {
    if (this.screen !== 'lobby') return;
    const host = this.mode !== 'client';
    $('l-title').textContent = this.mode === 'local' ? 'Lokales Spiel' : this.mode === 'host' ? 'Lobby (Host)' : 'Lobby';
    const lv = levelById(this.mode === 'client' && this.lobbyInfo ? this.lobbyInfo.level : this.levelId);
    $('l-lname').textContent = lv.name;
    $('l-ldesc').textContent = lv.desc;
    const b = this.best[lv.id];
    $('l-lbest').textContent = b ? `Bestzeit ${fmtTime(b.time)} · ${'★'.repeat(b.stars)}${'☆'.repeat(3 - b.stars)}` : 'noch nicht geschafft';
    document.querySelector('.levelopt').classList.toggle('ro', !host);
    $('l-start').classList.toggle('hidden', !host);
    $('l-openonline').classList.toggle('hidden', this.mode !== 'local' || !this.tr);
    $('l-codebox').classList.toggle('hidden', this.mode !== 'host');
    this.updateCodeBox();
    const H = this.humans(), seats = this.buildSeats(H);
    const box = $('l-players');
    const fk = document.activeElement && box.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    box.innerHTML = '';
    const myPid = this.mode === 'client' ? this.myId : 0;
    H.forEach((h, k) => {
      const card = document.createElement('div');
      const seated = k < 4;
      card.className = 'pcard' + (seated ? '' : ' spect');
      card.style.setProperty('--c', seated ? SEAT_COLORS[k] : '#bbb');
      const mine = h.pid === myPid;
      const dev = mine ? (h.li === 0 ? (this.input.device === 'gamepad' ? '🎮 Controller' : this.input.device === 'touch' ? '👆 Touch' : '⌨ Tastatur') : '🎮 Controller ' + (h.li + 1)) : '🌐 ' + (h.pid === 0 ? 'Host' : 'Mitspieler');
      card.innerHTML = `<div class="pname"></div><div class="pdev"></div>`;
      card.querySelector('.pname').textContent = h.name;
      card.querySelector('.pdev').textContent = dev;
      const opt = document.createElement('div');
      opt.className = 'opt' + (mine ? '' : ' ro');
      opt.tabIndex = 0;
      const key = 'animal-local-' + h.li;
      opt.dataset.key = key;
      opt.innerHTML = '<span class="oarr oprev">◀</span><span class="ov"></span><span class="oarr onext">▶</span>';
      opt.querySelector('.ov').textContent = animalById(h.animal).name;
      if (mine) {
        this.defineOpt(key, () => this.locals[h.li].animal, (v) => { this.locals[h.li].animal = v; if (h.li === 0) { this.settings.animal = v; saveSettings(this.settings); } this.localsChanged(); }, ANIMALS.map((a) => a.id), (v) => animalById(v).name);
        opt.addEventListener('click', (e) => { this.cycleOpt(opt, e.target.classList.contains('oprev') ? -1 : 1); });
      }
      card.appendChild(opt);
      if (seats.length === 2 && H.length === 1) {
        const t = document.createElement('div');
        t.className = 'ptwin';
        t.textContent = `steuert 2 Tiere (2. Tier: ${animalById(seats[1].animal).name})`;
        card.appendChild(t);
      }
      if (!seated) { const t = document.createElement('div'); t.className = 'ptwin'; t.textContent = 'schaut zu (Boot voll)'; card.appendChild(t); }
      box.appendChild(card);
    });
    const hint = [];
    if (this.mode !== 'client' || true) hint.push('Weiterer Controller an diesem Gerät: beliebige Taste drücken (− zum Austreten).');
    if (this.mode === 'host') hint.push('Bis zu 4 Tiere pro Boot.');
    if (this.mode === 'client') hint.push('Der Host wählt den Fluss und startet.');
    $('l-hint').textContent = hint.join(' ');
    // Fokus erhalten
    if (fk) { const el = box.querySelector(`[data-key="${fk}"]`); if (el && !el.classList.contains('ro')) el.focus(); }
    if (!this.focusables().includes(document.activeElement)) this.focusFirst();
  }

  updateCodeBox() {
    if (this.mode !== 'host' || !this.tr) return;
    const st = this.tr.status ? this.tr.status() : '';
    const code = this.tr.code ? this.tr.code() : '';
    let lan = '';
    if (this.tr.ip && this.tr.ip()) lan = 'WLAN: ' + this.tr.ip();
    if (!this.tr.code) { $('l-code').textContent = lan || '–'; $('l-link').textContent = 'Mitspieler im selben WLAN finden das Spiel unter Online / WLAN.'; $('l-copy').classList.add('hidden'); return; }
    if (st === 'ready') { $('l-code').textContent = code; $('l-link').textContent = this.inviteLink() + (lan ? ' · ' + lan : '') + (this.tr.via ? ' · Verbindung: ' + this.tr.via() : ''); $('l-copy').classList.remove('hidden'); }
    else if (String(st).startsWith('err')) { $('l-code').textContent = '–'; $('l-link').textContent = 'Spielcode nicht verfügbar (keine Internetverbindung zu den Servern).' + (lan ? ' Im WLAN: ' + lan : ''); $('l-copy').classList.add('hidden'); }
    else { $('l-code').textContent = '…'; $('l-link').textContent = 'Spielcode wird erstellt …'; $('l-copy').classList.add('hidden'); }
  }

  inviteLink() {
    const code = this.tr && this.tr.code ? this.tr.code() : '';
    const base = /^https?:\/\/appassets/.test(location.href) || location.protocol === 'file:' ? 'https://gun642.github.io/Farty/' : location.origin + location.pathname;
    return base + '?join=' + code;
  }
  copyInvite() {
    const link = this.inviteLink();
    try { navigator.clipboard.writeText(link).then(() => this.toast('Einladungslink kopiert!'), () => this.toast(link, 6000)); } catch (_) { this.toast(link, 6000); }
  }

  localsChanged() {
    if (this.mode === 'client' && this.net) this.send({ t: 'locals', locals: this.locals });
    if (this.mode === 'host') this.sendLobby();
    this.renderLobby();
  }

  handleLocalJoins() {
    for (const idx of this.input.popJoins()) {
      if (this.state !== 'lobby' || this.screen !== 'lobby') continue;
      if (this.input.extraPads.includes(idx) || idx === this.input.primaryPad) continue;
      if (this.locals.length >= 4) { this.toast('Mehr als 4 Spieler pro Gerät gehen nicht.'); continue; }
      this.input.extraPads.push(idx);
      const used = new Set(this.humans().map((h) => h.animal));
      const free = ANIMALS.find((a) => !used.has(a.id)) || ANIMALS[this.locals.length % ANIMALS.length];
      this.locals.push({ name: this.myName() + ' ' + (this.locals.length + 1), animal: free.id });
      this.sound.bean();
      this.toast(`Controller ${this.locals.length} ist dabei!`);
      this.localsChanged();
    }
    for (const k of this.input.popLeaves()) {
      if (k < 1 || k >= this.locals.length) continue;
      if (this.state === 'race') continue;
      this.input.removeLocal(k);
      this.locals.splice(k, 1);
      this.toast('Ein Controller-Spieler ist ausgetreten.');
      this.localsChanged();
    }
  }

  // ================================================================ Netzwerk
  send(obj) { if (this.tr) try { this.tr.send(this.mode === 'host' ? -1 : 0, obj); } catch (e) { /* egal */ } }
  sendTo(pid, obj) { if (this.tr) try { this.tr.send(pid, obj); } catch (e) { /* egal */ } }

  beacon() { return { name: this.myName(), n: this.humans().length, lv: levelById(this.levelId).name, v: 1 }; }

  host() {
    if (!this.tr) { this.toast('Mehrspieler wird von diesem Browser nicht unterstützt.'); return; }
    if (this.mode === 'host') return;
    const r = this.tr.host(this.beacon());
    if (!r || String(r).startsWith('err')) { this.status('Spiel konnte nicht eröffnet werden: ' + r, true); return; }
    this.mode = 'host';
    this.net = true;
    this.state = 'lobby';
    this.peers.clear();
    this.showScreen('lobby');
    clearInterval(this.codeT);
    this.codeT = setInterval(() => { if (this.mode !== 'host') { clearInterval(this.codeT); return; } this.updateCodeBox(); }, 700);
  }

  join(target, directPort) {
    target = String(target || '').trim();
    if (!this.tr) { this.status('Mehrspieler wird von diesem Browser nicht unterstützt.', true); return; }
    if (!target) { this.status('Bitte einen Spielcode eingeben.', true); return; }
    let ip = target, port = 47890;
    if (directPort) port = directPort;
    else if (isGameCode(target)) { if (!this.tr.code) { this.status('Spielcodes gehen nur mit Internetverbindung.', true); return; } ip = target.toUpperCase(); }
    else { const m = /^([\d.]+)(?::(\d+))?$/.exec(target); if (!m) { this.status('Das ist kein gültiger Spielcode.', true); return; } ip = m[1]; port = +m[2] || 47890; }
    this.status('Verbinde …');
    this.mode = 'client';
    this.net = true;
    this.joinTarget = ip;
    this.myId = null;
    this.lobbyInfo = null;
    try { this.tr.join(ip, port); } catch (e) { this.status('Verbindung fehlgeschlagen.', true); this.mode = null; }
  }

  status(msg, err) { const el = $('o-status'); el.textContent = msg; el.classList.toggle('err', !!err); }

  refreshOnline(first) {
    if (this.screen !== 'online') { if (this.tr && this.tr.scan) this.tr.scan(false); return; }
    const lanOk = this.tr && this.tr.kind && (this.tr.kind.startsWith('lan') || this.tr.kind === 'test');
    $('o-lanbox').classList.toggle('hidden', !lanOk);
    if (first) { this.status(this.tr ? '' : 'Mehrspieler wird von diesem Browser nicht unterstützt.', !this.tr); if (lanOk) this.tr.scan(true); }
    if (lanOk) {
      const list = this.tr.hosts();
      const box = $('o-lan');
      const sig = JSON.stringify(list.map((h) => [h.ip, h.port, h.info && h.info.n, h.info && h.info.lv]));
      if (sig !== this.lanSig) {
        this.lanSig = sig;
        const had = box.contains(document.activeElement);
        box.innerHTML = '';
        if (!list.length) box.innerHTML = '<div class="muted small">Noch keine Spiele im WLAN gefunden …</div>';
        for (const h of list) {
          const b = document.createElement('button');
          const i = h.info || {};
          b.textContent = `${i.name || 'Spiel'} – ${i.lv || ''} (${i.n || 1} Spieler)`;
          b.addEventListener('click', () => this.join(h.ip, h.port));
          box.appendChild(b);
        }
        if (had) this.focusFirst();
      }
    }
    clearTimeout(this.onlineT);
    this.onlineT = setTimeout(() => this.refreshOnline(false), 1000);
  }

  leave() {
    if (this.mode === 'host' || this.mode === 'client') { try { this.tr.stop(); } catch (_) { /* egal */ } }
    clearInterval(this.codeT);
    this.mode = null; this.net = null;
    this.peers.clear();
    this.state = 'menu';
    this.paused = false;
    this.sound.silence();
    $('hud').classList.add('hidden');
    this.loadLevel(this.levelId, 7, 4, true);
    this.setupDemoCrew();
    this.showScreen('menu');
  }

  netUpdate(dt) {
    if (!this.tr || !this.net) return;
    let msgs = [];
    try { msgs = this.tr.poll(); } catch (e) { msgs = []; }
    for (const { p, m } of msgs) {
      try { if (this.mode === 'host') this.onHost(p, m); else if (this.mode === 'client') this.onClient(m); } catch (e) { console.error('Netz', m && m.t, e); }
    }
    if (this.mode === 'host' && this.state === 'race') {
      this.snapT = (this.snapT || 0) - dt;
      if (this.snapT <= 0) {
        this.snapT = 1 / SNAP_HZ;
        const s = this.sim.snapshot();
        s.t = 's';
        s.ev = this.pendingEv; this.pendingEv = [];
        this.colT = (this.colT || 0) - 1 / SNAP_HZ;
        if (this.colT <= 0) { this.colT = 1; s.col = [...this.sim.collected]; }
        this.send(s);
      }
    } else if (this.mode === 'client' && this.state === 'race') {
      this.inT = (this.inT || 0) - dt;
      if (this.inT <= 0) {
        this.inT = 1 / INPUT_HZ;
        const s = [];
        this.seatDefs.forEach((sd, i) => { if (sd.pid === this.myId) { const q = this.seatInput(sd); s.push([i, r2(q.dx), r2(q.dz), r2(q.mag), q.fart ? 1 : 0]); } });
        if (s.length) this.send({ t: 'in', s });
      }
    }
  }

  sendLobby() {
    if (this.mode !== 'host') return;
    this.send({ t: 'lobby', level: this.levelId, players: this.humans() });
    try { this.tr.info(this.beacon()); } catch (_) { /* egal */ }
  }

  raceInfo() { return { t: 'start', level: this.levelId, seed: this.seed, diff: this.settings.difficulty, seats: this.seatDefs.map((s) => ({ pid: s.pid, li: s.li, twin: s.twin, name: s.name, animal: s.animal })) }; }

  onHost(p, m) {
    switch (m.t) {
      case '_join': break;
      case 'hello': {
        const locals = Array.isArray(m.locals) ? m.locals.slice(0, 4) : [{ name: 'Gast', animal: 'schwein' }];
        this.peers.set(p, { locals, inputs: {}, seen: performance.now() });
        this.sendTo(p, { t: 'welcome', id: p, level: this.levelId });
        this.sendLobby();
        if (this.state === 'race') this.sendTo(p, this.raceInfo());
        this.toast(`${String(locals[0] && locals[0].name || 'Gast').slice(0, 14)} ist beigetreten.`);
        this.renderLobby();
        break;
      }
      case 'locals': { const pr = this.peers.get(p); if (pr && Array.isArray(m.locals)) { pr.locals = m.locals.slice(0, 4); this.sendLobby(); this.renderLobby(); } break; }
      case 'in': {
        const pr = this.peers.get(p);
        if (!pr || !Array.isArray(m.s)) break;
        for (const [i, dx, dz, mag, fart] of m.s) {
          const sd = this.seatDefs && this.seatDefs[i];
          if (sd && sd.pid === p) pr.inputs[i] = { dx: +dx || 0, dz: +dz || 0, mag: clamp(+mag || 0, 0, 1), fart: !!fart, t: performance.now() };
        }
        break;
      }
      case '_leave': {
        const pr = this.peers.get(p);
        this.peers.delete(p);
        if (pr) this.toast(`${String(pr.locals && pr.locals[0] && pr.locals[0].name || 'Ein Mitspieler').slice(0, 14)} hat das Spiel verlassen.`);
        this.sendLobby();
        this.renderLobby();
        break;
      }
    }
  }

  onClient(m) {
    switch (m.t) {
      case '_open': this.send({ t: 'hello', v: 1, locals: this.locals }); this.status('Verbunden – warte auf den Host …'); break;
      case '_status': this.status(String(m.s || '')); break;
      case '_fail': this.status(isGameCode(this.joinTarget || '') ? 'Kein Spiel mit diesem Code gefunden – Code prüfen.' : 'Verbindung fehlgeschlagen.', true); this.mode = null; this.net = null; break;
      case '_leave':
        this.leave();
        this.toast('Die Verbindung zum Host ist getrennt.', 4000);
        break;
      case 'welcome':
        this.myId = m.id;
        this.state = 'lobby';
        this.lobbyInfo = { level: m.level, players: [] };
        this.showScreen('lobby');
        break;
      case 'lobby':
        this.lobbyInfo = { level: m.level, players: m.players || [] };
        if (this.state === 'lobby') this.renderLobby();
        break;
      case 'start': this.beginRace(m.level, m.seed, m.diff, m.seats); break;
      case 'tolobby': this.lobbyView(); break;
      case 's': this.onSnapshot(m); break;
    }
  }

  // ================================================================ Rennen
  startRace(levelId) {
    if (this.mode === 'client') return;
    this.levelId = levelById(levelId).id;
    const lv = levelById(this.levelId);
    this.seed = lv.random ? (Math.random() * 1e9) | 0 : 1000 + LEVELS.indexOf(lv);
    const seats = this.buildSeats(this.humans());
    this.seatDefs = seats;
    if (this.mode === 'host') {
      for (const p of this.peers.values()) p.inputs = {};
      this.pendingEv = [];
      this.send(this.raceInfo());
    }
    this.beginRace(this.levelId, this.seed, this.settings.difficulty, seats);
  }

  beginRace(levelId, seed, diff, seats) {
    this.levelId = levelById(levelId).id;
    this.seed = seed;
    this.seatDefs = seats.map((s) => ({ ...s, animal: animalById(s.animal).id }));
    const n = this.seatDefs.length || 2;
    const saveDiff = this.settings.difficulty;
    this.settings.difficulty = diff;
    this.loadLevel(this.levelId, seed, n, false);
    this.settings.difficulty = saveDiff;
    const phis = seatAngles(n);
    this.seats = this.seatDefs.map((s, i) => ({ phi: phis[i], animal: s.animal, name: s.name + (s.twin === 'L' ? ' ◀' : s.twin === 'R' ? ' ▶' : '') }));
    this.raft.setCrew(this.seats);
    $('labels').classList.remove('hidden');
    this.state = 'race';
    this.paused = false;
    this.finishShown = false;
    this.finishData = null;
    this.hideScreens();
    $('hud').classList.remove('hidden');
    this.buildProgress();
    this.updateHint();
    this.updateTouch();
    this.sound.startMusic(LEVELS.findIndex((l) => l.id === this.levelId) + 1);
    $('h-net').textContent = this.mode === 'client' && !this.ownSeats().length ? 'Du schaust zu – beim nächsten Rennen bist du dabei.' : '';
  }

  toLobby() {
    if (this.mode === 'client') return;
    if (this.mode === 'host') this.send({ t: 'tolobby' });
    this.lobbyView();
  }

  lobbyView() {
    this.paused = false;
    this.state = 'lobby';
    this.sound.silence();
    $('hud').classList.add('hidden');
    this.loadLevel(this.levelId, 7, 4, true);
    this.setupDemoCrew();
    this.showScreen('lobby');
  }

  togglePause(on) {
    if (this.state !== 'race') return;
    if (on === undefined) on = this.screen !== 'pause';
    if (this.screen === 'finish') return;
    this.paused = on && this.mode === 'local';
    if (on) {
      this.showScreen('pause');
      const ctl = this.mode !== 'client';
      $('p-restart').classList.toggle('hidden', !ctl);
      $('p-lobby').classList.toggle('hidden', !ctl);
      $('p-quit').textContent = this.mode === 'local' ? 'Hauptmenü' : 'Spiel verlassen';
      this.sound.silence();
    } else this.hideScreens();
  }

  ownSeats() {
    if (!this.seatDefs || this.state !== 'race') return [];
    const me = this.mode === 'client' ? this.myId : 0;
    const out = [];
    this.seatDefs.forEach((s, i) => { if (s.pid === me) out.push(i); });
    return out;
  }

  // Stick des lokalen Spielers → Richtung in Weltkoordinaten (bezogen auf die Kamera)
  seatInput(sd) {
    const st = this.input.states[sd.li];
    if (!st || this.screen) return { dx: 0, dz: 0, mag: 0, fart: false };
    let x, y, fart;
    if (sd.twin === 'L') { x = st.lx; y = st.ly; fart = st.fartL; }
    else if (sd.twin === 'R') { x = st.rx; y = st.ry; fart = st.fartR; }
    else {
      if (Math.hypot(st.rx, st.ry) > Math.hypot(st.lx, st.ly)) { x = st.rx; y = st.ry; } else { x = st.lx; y = st.ly; }
      fart = st.fart;
    }
    const mag = Math.min(1, Math.hypot(x, y));
    const fx = Math.cos(this.camYaw), fz = Math.sin(this.camYaw);
    // rechts = (−fz, fx), vorne = (fx, fz)
    const dx = -fz * x + fx * -y, dz = fx * x + fz * -y;
    const l = Math.hypot(dx, dz) || 1;
    return { dx: dx / l, dz: dz / l, mag, fart };
  }

  hostInputs() {
    const now = performance.now();
    return (this.seatDefs || []).map((sd, i) => {
      if (sd.pid === 0) return this.seatInput(sd);
      const p = this.peers.get(sd.pid);
      const inp = p && p.inputs[i];
      if (!inp || now - inp.t > 1200) return null;
      return inp;
    });
  }

  demoInputs() {
    const t = this.sim.clock;
    return this.sim.seats.map((st, i) => {
      const ph = Math.sin(t * 0.7 + i * 1.9) + Math.sin(t * 1.9 + i);
      return { dx: Math.cos(this.camYaw), dz: Math.sin(this.camYaw), mag: 1, fart: ph > 0.9 };
    });
  }

  onSnapshot(m) {
    if (this.state !== 'race') return;
    const now = performance.now() / 1000;
    const ofs = m.ck - now;
    if (this.clockOfs === null || ofs > this.clockOfs || Math.abs(ofs - this.clockOfs) > 1) this.clockOfs = ofs;
    else this.clockOfs += (ofs - this.clockOfs) * 0.05;
    this.snaps.push(m);
    if (this.snaps.length > 30) this.snaps.shift();
    for (const e of m.ev || []) this.onEvent(e);
    if (m.col) for (const id of m.col) this.collected.add(id);
  }

  // Zustand des Mitspielers: zwischen zwei Schnappschüssen interpolieren
  clientView() {
    const S = this.snaps;
    if (!S.length) return this.view;
    const rc = performance.now() / 1000 + this.clockOfs - 0.1;
    let a = S[0], b = S[S.length - 1];
    if (rc >= b.ck) {
      const dt = Math.min(0.25, rc - b.ck);
      return Object.assign({}, b, { x: b.x + b.vx * dt, z: b.z + b.vz * dt, a: b.a + b.w * dt, ck: b.ck + dt });
    }
    for (let i = S.length - 1; i > 0; i--) if (S[i - 1].ck <= rc) { a = S[i - 1]; b = S[i]; break; }
    if (rc <= a.ck) return a;
    const t = clamp((rc - a.ck) / Math.max(0.001, b.ck - a.ck), 0, 1);
    if (Math.hypot(b.x - a.x, b.z - a.z) > 8) return b;
    const out = Object.assign({}, b);
    out.x = lerp(a.x, b.x, t); out.z = lerp(a.z, b.z, t); out.a = lerpAngle(a.a, b.a, t); out.ck = lerp(a.ck, b.ck, t);
    out.st = b.st.map((s, i) => { const p = a.st[i] || s; return [lerpAngle(p[0], s[0], t), lerp(p[1], s[1], t), s[2], s[3]]; });
    return out;
  }

  onEvent(e) {
    const S = this.sound, v = this.view;
    switch (e.k) {
      case 'count': S.count(e.n); this.bigText(String(e.n)); break;
      case 'go': S.count(0); this.bigText('LOS!', 900); break;
      case 'bump': S.bump(e.v || 0.5); this.shake = Math.max(this.shake, 0.15 + (e.v || 0) * 0.3); break;
      case 'hit': S.hit(); this.msg('AUTSCH!', 900); this.shake = 0.5; break;
      case 'pop': S.pop(); this.msg('PENG! Das Boot ist geplatzt!', 2200); this.shake = 1; break;
      case 'fall': S.fall(); this.msg('AAAAH! Runtergefallen!', 2200); this.shake = 0.6; break;
      case 'respawn': this.msg('Weiter geht\'s!', 1200); break;
      case 'pick': {
        this.collected.add(e.id);
        const p = this.river.pickups.find((x) => x.id === e.id);
        const y = this.river.py[clamp(Math.round(p ? p.s : 0), 0, this.river.N - 1)] + 0.6;
        if (e.type === 'bean') { S.bean(); if (p) this.fx.parts.sparkle(p.x, y, p.z, '#ff9a3d', 10); this.msg('BOHNEN! Turbo-Pups!', 1100); }
        else if (e.type === 'gold') { S.gold(); if (p) this.fx.parts.sparkle(p.x, y, p.z, '#ffe14d', 20); this.msg('Goldene Bohne!', 1300); }
        else if (e.type === 'pump') { S.pump(); if (p) this.fx.parts.sparkle(p.x, y, p.z, '#ffffff', 12); this.msg('+ Luft', 1000); }
        break;
      }
      case 'cp': S.checkpoint(); this.msg('Kontrollpunkt!', 1100); this.buildProgress(); break;
      case 'finish': {
        S.finish();
        this.msg('ZIEL!', 2000);
        this.finishData = e;
        setTimeout(() => this.showFinish(), 2200);
        break;
      }
    }
    void v;
  }

  bigText(t, ms = 800) {
    const el = $('h-count');
    el.textContent = t;
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    clearTimeout(this.bigT);
    this.bigT = setTimeout(() => { el.textContent = ''; }, ms);
  }
  msg(t, ms = 1200) {
    const el = $('h-msg');
    el.textContent = t; el.classList.add('on');
    clearTimeout(this.msgT);
    this.msgT = setTimeout(() => el.classList.remove('on'), ms);
  }

  buildProgress() {
    const R = this.river, tr = $('h-track');
    tr.innerHTML = '';
    const cp = this.view ? this.view.cp : -1;
    R.checkpoints.forEach((s, i) => {
      const d = document.createElement('div');
      d.className = 'cp' + (i <= cp ? ' done' : '');
      d.style.left = ((s - START) / R.length * 100) + '%';
      tr.appendChild(d);
    });
    const f = document.createElement('div'); f.className = 'fin'; tr.appendChild(f);
  }

  updateHint() {
    const el = $('h-hint');
    if (!el) return;
    const mine = this.ownSeats();
    const twin = mine.length >= 2;
    const d = this.input.device;
    let t = '';
    if (!mine.length) t = '';
    else if (d === 'gamepad') t = twin ? '◀ linker Stick + ZL/L · rechter Stick + ZR/R ▶' : 'Stick: Richtung · Taste halten: pupsen · + Pause';
    else if (d === 'touch') t = twin ? 'Zwei Daumen-Sticks – weit drücken = pupsen' : 'Links lenken · PUPS! halten';
    else t = twin ? '◀ WASD + Leertaste · Pfeile + Enter ▶ · Esc Pause' : 'WASD/Pfeile: Richtung · Leertaste: pupsen · Esc Pause';
    if (this.input.localCount > 1 && d !== 'touch') t = 'Jeder Controller steuert sein Tier · + Pause';
    el.textContent = t;
    el.classList.toggle('hidden', !t);
  }

  showFinish() {
    if (this.state !== 'race' || !this.finishData) return;
    const e = this.finishData, R = this.river;
    const stars = 1 + (e.gold >= 3 ? 1 : 0) + (e.time <= R.par ? 1 : 0);
    const id = this.levelId;
    const b = this.best[id];
    const isBest = !b || e.time < b.time;
    if (isBest || (b && stars > b.stars)) {
      this.best[id] = { time: isBest ? e.time : b.time, stars: Math.max(stars, b ? b.stars : 0) };
      saveBest(this.best);
    }
    $('f-stars').innerHTML = [0, 1, 2].map((i) => `<span class="${i < stars ? 'on' : ''}">★</span>`).join('');
    $('f-stats').innerHTML = `<span>Zeit</span><b>${fmtTime(e.time)}${isBest ? ' 🏆' : ''}</b><span>Bestzeit</span><b>${fmtTime(this.best[id].time)}</b>
      <span>Vorgabe (★)</span><b>${fmtTime(R.par)}</b><span>Goldene Bohnen</span><b>${e.gold} / 3</b><span>Geplatzt</span><b>${e.pops}×</b>${e.falls ? `<span>Runtergefallen</span><b>${e.falls}×</b>` : ''}`;
    const ctl = this.mode !== 'client';
    for (const id2 of ['f-again', 'f-next', 'f-lobby']) $(id2).classList.toggle('hidden', !ctl);
    $('f-wait').classList.toggle('hidden', ctl);
    $('f-quit').classList.toggle('hidden', ctl);
    this.sound.silence();
    this.showScreen('finish');
  }

  // ================================================================ Hauptschleife
  frame() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t = (this.t || 0) + dt;
    const inp = this.input;
    inp.poll(dt);
    this.handleLocalJoins();
    for (const a of inp.popActions()) {
      if (this.screen) this.handleMenuAction(a);
      else if (this.state === 'race' && (a === 'pause' || a === 'back')) this.togglePause(true);
    }

    this.netUpdate(dt);

    // ---------- Simulation
    if (this.state === 'race' && this.mode !== 'client') {
      if (!this.paused) {
        const ins = this.screen === 'finish' ? [] : this.hostInputs();
        this.acc = (this.acc || 0) + dt;
        let n = 0;
        while (this.acc >= 1 / 60 && n < 5) { this.sim.step(1 / 60, ins); this.acc -= 1 / 60; n++; }
        if (n === 5) this.acc = 0;
        const ev = this.sim.events; this.sim.events = [];
        for (const e of ev) this.onEvent(e);
        if (this.mode === 'host') this.pendingEv = (this.pendingEv || []).concat(ev);
      }
      this.view = this.sim.snapshot();
    } else if (this.state === 'race' && this.mode === 'client') {
      this.view = this.clientView();
      this.sim.clock = this.view.ck || 0;
    } else {
      // Menü/Lobby: Demo-Floß
      this.acc = (this.acc || 0) + dt;
      let n = 0;
      while (this.acc >= 1 / 60 && n < 4) { this.sim.step(1 / 60, this.demoInputs()); this.acc -= 1 / 60; n++; }
      if (n === 4) this.acc = 0;
      this.sim.events = [];
      if (this.sim.s > (this.demoBest || 0) + 1) { this.demoBest = this.sim.s; this.demoT = 0; }
      this.demoT = (this.demoT || 0) + dt;
      if (this.demoT > 10) { this.demoT = 0; this.sim.respawnAt(Math.min(this.river.finish - 20, this.sim.s + 12)); this.camInit = true; }
      if (this.sim.phase !== 'race' || this.sim.s > this.river.finish - 5) {
        this.demoBest = 0;
        this.sim.respawnAt(START + 2);
        this.sim.phase = 'race';
        this.sim.collected.clear();
        this.camInit = true;
      }
      this.view = this.sim.snapshot();
    }

    this.render(dt);
  }

  render(dt) {
    const v = this.view, R = this.river;
    const q = R.nearest(v.x, v.z, this.camHint || START, this.camQ || (this.camQ = {}));
    this.camHint = q.i;
    const y = q.y;
    // Kamera: hinter dem Boot, entlang der Flussrichtung (etwas vorausschauend)
    const a = R.sample(q.s + 5), b = R.sample(q.s + 18);
    const yaw = Math.atan2(a.tz + b.tz, a.tx + b.tx);
    const demo = this.state !== 'race';
    const k = this.settings.camera, dist = [10, 13.5, 18][k], hgt = [8.5, 11.5, 15.5][k];
    if (this.camInit) { this.camYaw = yaw; }
    this.camYaw = lerpAngle(this.camYaw, yaw + (demo ? Math.sin(this.t * 0.15) * 0.5 : 0), Math.min(1, dt * 1.8));
    const fx = Math.cos(this.camYaw), fz = Math.sin(this.camYaw);
    const tx = v.x - fx * dist, tz = v.z - fz * dist, ty = y + hgt;
    if (this.camInit) { this.camPos.set(tx, ty, tz); this.camLook.set(v.x + fx * 5, y, v.z + fz * 5); this.camInit = false; }
    const kk = Math.min(1, dt * 4);
    this.camPos.x += (tx - this.camPos.x) * kk; this.camPos.y += (ty - this.camPos.y) * kk; this.camPos.z += (tz - this.camPos.z) * kk;
    this.camLook.x += (v.x + fx * 5 - this.camLook.x) * kk; this.camLook.y += (y + 0.5 - this.camLook.y) * kk; this.camLook.z += (v.z + fz * 5 - this.camLook.z) * kk;
    this.shake = Math.max(0, this.shake - dt * 2);
    const sh = this.shake * 0.35;
    this.camera.position.set(this.camPos.x + (Math.random() - 0.5) * sh, this.camPos.y + (Math.random() - 0.5) * sh, this.camPos.z + (Math.random() - 0.5) * sh);
    this.camera.lookAt(this.camLook);
    this.sky.position.copy(this.camera.position);
    this.sun.position.set(this.camPos.x - 40, this.camPos.y + 80, this.camPos.z + 30);
    this.sun.target.position.copy(this.camLook);
    this.sun.target.updateMatrixWorld();

    // Welt und Boot
    const simLike = this.mode === 'client' && this.state === 'race' ? { clock: v.ck || 0, collected: this.collected } : this.sim;
    this.world.update(this.t, dt, simLike);
    const fxOn = !(this.paused);
    if (fxOn) {
      this.raft.update(dt, this.t, v, y, this.camera, this.fx, this.state === 'race' && !this.screen ? this.sound : this.mute || (this.mute = { voice: () => null, splash: () => {} }), this.W, this.H, this.ownSeats());
      this.fx.parts.update(dt); this.fx.ripples.update(dt); this.fx.words.update(dt);
    }
    if (this.state === 'race') this.updateHud(v);
    this.renderer.render(this.scene, this.camera);
  }

  updateHud(v) {
    const R = this.river;
    $('h-time').textContent = fmtTime(v.tm || 0);
    const p = clamp(((v.s || START) - START) / R.length, 0, 1);
    $('h-marker').style.left = (p * 100) + '%';
    $('h-gold').querySelector('span').textContent = (v.g || 0) + '/3';
    $('h-air-fill').style.width = clamp(v.hp, 0, 100) + '%';
    $('h-air').classList.toggle('low', v.hp < 30 && v.ph === 'race');
    if (v.cp !== this.lastCp) { this.lastCp = v.cp; this.buildProgress(); }
    if (this.mode === 'client' && v.ph === 'countdown' && v.cd > 0) {
      const n = Math.ceil(v.cd);
      if (n !== this.lastCd) { this.lastCd = n; }
    }
  }
}

window.addEventListener('error', (e) => { const l = document.getElementById('loading'); if (l && !l.classList.contains('hidden')) l.textContent = 'Fehler: ' + e.message; });
new Game();
void wrap; void isMobile;
