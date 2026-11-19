// Einstellungen, Bestzeiten, Versionsinfo und Android-Brücke
const SKEY = 'farty.settings.v1';
const BKEY = 'farty.best.v1';

export const isApp = typeof window.AndroidApp !== 'undefined';
export const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);

function read(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { return null; }
}
function write(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch (_) { /* privater Modus */ }
}

export function isTv() {
  let tv = /Android TV|AFT[A-Z]|BRAVIA|SMART-TV|SmartTV|GoogleTV|\bTV\b/i.test(navigator.userAgent);
  try { if (window.AndroidApp && window.AndroidApp.isTv) tv = tv || !!window.AndroidApp.isTv(); } catch (_) { /* ältere App */ }
  return tv;
}

export function loadSettings() {
  const d = { quality: 'high', volume: 0.8, music: true, difficulty: 1, name: '', animal: 'schwein', camera: 1, level: 'bach' };
  const s = Object.assign(d, read(SKEY) || {});
  // Fernseher und Handys: einmalig eine sparsamere Grafik wählen – lässt sich in den Einstellungen ändern
  if (!s.qInit) {
    s.qInit = true;
    if (isTv()) s.quality = 'low';
    else if (isMobile) s.quality = 'medium';
    write(SKEY, s);
  }
  return s;
}
export const saveSettings = (s) => write(SKEY, s);

export const loadBest = () => read(BKEY) || {};
export const saveBest = (b) => write(BKEY, b);

export async function fetchVersion() {
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch (_) { return null; }
}

export function appVersion() {
  try { return isApp ? window.AndroidApp.getVersionName() : null; } catch (_) { return null; }
}
export function appCheckUpdate() {
  try { if (isApp) window.AndroidApp.checkForUpdates(); } catch (_) { /* ignorieren */ }
}

export function enterFullscreen() {
  if (isApp) return;
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement && el.requestFullscreen && isMobile) {
      el.requestFullscreen({ navigationUI: 'hide' }).then(() => {
        if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
      }).catch(() => {});
    }
  } catch (_) { /* nicht unterstützt */ }
}
