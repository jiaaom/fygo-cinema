// Page side of the kiosk: the remote navigation layer (inject/nav.js), the TV
// stylesheet (inject/cinema.css) and the volume display. Runs in the preload's
// isolated world: it shares the page's DOM, never its scripts.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const nav = require('./inject/nav');

const CSS = fs.readFileSync(path.join(__dirname, 'inject', 'cinema.css'), 'utf8');

function addStyle() {
  const s = document.createElement('style');
  s.id = 'cinema-style';
  s.textContent = CSS;
  (document.head || document.documentElement).appendChild(s);
}

// ---- volume display ---------------------------------------------------------------

let osd = null;
let osdTimer = null;

function showOsd({ volume, muted }) {
  if (!osd || !osd.isConnected) {
    osd = document.createElement('div');
    osd.id = 'cinema-osd';
    osd.innerHTML = '<div class="cinema-osd-icon"></div><div class="cinema-osd-bar"><div></div></div><div class="cinema-osd-value"></div>';
    document.documentElement.appendChild(osd);
  }
  const v = volume == null ? 0 : volume;
  osd.classList.toggle('muted', !!muted);
  osd.querySelector('.cinema-osd-bar > div').style.width = `${muted ? 0 : v}%`;
  osd.querySelector('.cinema-osd-value').textContent = muted ? '' : String(v);
  osd.classList.add('shown');
  clearTimeout(osdTimer);
  osdTimer = setTimeout(() => osd.classList.remove('shown'), 2000);
}

ipcRenderer.on('cinema:osd', (_e, v) => { if (v) showOsd(v); });

// The main process takes the volume keys before the page sees them; this
// covers keys that reach the page anyway.
const VOLUME_KEYS = { AudioVolumeUp: 'up', AudioVolumeDown: 'down', AudioVolumeMute: 'mute' };
window.addEventListener('keydown', (e) => {
  const action = e.isTrusted && VOLUME_KEYS[e.key];
  if (!action) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  ipcRenderer.invoke('cinema:volume', action).then((v) => { if (v) showOsd(v); }).catch(() => {});
}, true);

// Our own setup screen (setup/index.html, a file:// page) has its own look
// and keys; it only needs a way to say "try again".
const ownPage = location.protocol === 'file:';
if (ownPage) contextBridge.exposeInMainWorld('cinema', { retry: () => ipcRenderer.send('cinema:retry') });

window.addEventListener('DOMContentLoaded', () => {
  addStyle();   // (also on our own page: the volume display)
  if (ownPage) return;
  nav.start({ pointer: (type, x, y) => ipcRenderer.send('cinema:pointer', { type, x, y }) });
});
