// Fygo Cinema kiosk: the 飞牛影视 / Fygo TV web app (/v) fullscreen on the TV.
//
// The page is the stock web app, untouched on the server. This main process
// adds what a TV needs and a browser tab can't do:
//   - hardware video decoding (VA-API through fnOS's own libva, see
//     run-kiosk.sh) and GPU compositing
//   - signing in by itself with the account stored by cinemad (the page's own
//     login form, filled in), and staying signed in across restarts (the
//     page's session cookie is kept on disk; the form is the fallback)
//   - the page's size on the TV (zoom chosen by cinemad from the TV's
//     resolution and size)
//   - its own screen when the web app can't be shown (setup/: no account yet,
//     the account refused, the media server unreachable), never a black TV
//   - keeping the remote away from admin pages (/v/settings) and other sites
//   - system volume / mute on the remote's volume keys, with an on-screen
//     display (the web player has no output or system volume)
// The remote navigation layer itself runs in the page (preload.js,
// inject/nav.js).
//
// Environment (set by the kiosk unit, see packaging):
//   CINEMA_DATA_DIR    Chromium profile dir (default /var/lib/fygo-cinema/kiosk)
//   CINEMA_URL         start page (default http://127.0.0.1:5666/v/)
//   CINEMA_SINK        PipeWire node.name of the TV's sound output (volume keys)
//   CINEMA_ZOOM        page zoom (1 = the web app's own 1920-wide layout at 1080p)
//   CREDENTIALS_DIRECTORY  systemd's; holds "fygo-cinema-account" ({"username","password"})
//   CINEMA_ACCOUNT_FILE    plain-JSON account instead (development only)
//   CINEMA_STATE       where to report login state (default /run/fygo-cinema/state.json)
//   CINEMA_DEBUG_PORT  open Chromium's DevTools protocol on 127.0.0.1:<port> (tests)
//   WINDOWED           run in a 1280x720 window instead of fullscreen (development)
//   CINEMA_MUTE        play no sound at all (unattended tests)
//   CINEMA_LANG        language of the setup screen (default: the web app's last, else $LANG)

const { app, BrowserWindow, ipcMain, net, session } = require('electron');
const { execFile, execFileSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.CINEMA_DATA_DIR || '/var/lib/fygo-cinema/kiosk';
const START_URL = process.env.CINEMA_URL || 'http://127.0.0.1:5666/v/';
const ORIGIN = new URL(START_URL).origin;
const STATE_FILE = process.env.CINEMA_STATE || '/run/fygo-cinema/state.json';
const PW_ENV = { ...process.env, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || '/run/user/0' };

// The profile (cookies = the web app's session, localStorage = its player
// preferences) must not land in /tmp: under systemd there is no $HOME and
// Chromium falls back to the temp dir, which is wiped at boot.
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  app.setPath('userData', DATA_DIR);
} catch (e) {
  console.error(`cinema: profile dir ${DATA_DIR}: ${e.message}; using the default`);
}

// GPU. VA-API video decode needs these features (Chromium's Linux VA-API path
// is off by default and checks for a driver it knows; fnOS ships iHD), and
// compositing on the iGPU needs ANGLE on GLES. --ozone-platform=wayland is on
// the real command line (run-kiosk.sh): Electron reads it before this runs.
app.commandLine.appendSwitch('enable-features',
  'VaapiVideoDecoder,VaapiVideoDecodeLinuxGL,VaapiIgnoreDriverChecks,PlatformHEVCDecoderSupport');
app.commandLine.appendSwitch('use-angle', 'gles');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
// A TV plays sound without anyone clicking first.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (process.env.CINEMA_MUTE) app.commandLine.appendSwitch('mute-audio');
if (process.env.CINEMA_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  app.commandLine.appendSwitch('remote-debugging-port', process.env.CINEMA_DEBUG_PORT);
}

// ---- state report (read by cinemad for the admin page) --------------------------

const state = { login: 'unknown', message: '', page: '', since: new Date().toISOString() };

function report(changes) {
  Object.assign(state, changes, { updated: new Date().toISOString() });
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(`${STATE_FILE}.tmp`, JSON.stringify(state));
    fs.renameSync(`${STATE_FILE}.tmp`, STATE_FILE);
  } catch (e) {
    console.error(`cinema: state ${STATE_FILE}: ${e.message}`);
  }
}

// ---- account & sign-in ----------------------------------------------------------

function account() {
  const tryRead = (file) => {
    try {
      const a = JSON.parse(fs.readFileSync(file, 'utf8'));
      return a && a.username && a.password ? a : null;
    } catch { return null; }
  };
  if (process.env.CINEMA_ACCOUNT_FILE) return tryRead(process.env.CINEMA_ACCOUNT_FILE);
  if (process.env.CREDENTIALS_DIRECTORY) {
    return tryRead(path.join(process.env.CREDENTIALS_DIRECTORY, 'fygo-cinema-account'));
  }
  return null;
}

// Fill the page's own login form. React-controlled inputs ignore a plain
// .value assignment, hence the native setter + input event.
function fillLoginJs(a) {
  return `(() => {
    const pw = document.querySelector('input[type=password]');
    if (!pw) return 'no-form';
    const user = [...document.querySelectorAll('input')].find((i) => i !== pw && !['checkbox', 'radio', 'hidden'].includes(i.type));
    if (!user) return 'no-form';
    const set = (el, v) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set(user, ${JSON.stringify(a.username)});
    set(pw, ${JSON.stringify(a.password)});
    const btn = [...document.querySelectorAll('button')].find((b) => /登录|登入|log ?in|sign ?in/i.test(b.innerText));
    if (!btn) return 'no-button';
    btn.click();
    return 'submitted';
  })()`;
}

// Error text the page shows after a rejected sign-in (a toast).
const LOGIN_ERROR_JS = `(() => {
  const t = [...document.querySelectorAll('.semi-toast-content-text, .semi-toast-content, [role=alert], .semi-form-field-error-message')]
    .map((e) => (e.innerText || '').trim()).filter(Boolean);
  return [...new Set(t)].join(' / ');   // (nested toast elements repeat the text)
})()`;

const LOGIN_ATTEMPTS = 3;          // per kiosk start; a wrong password stays wrong
let loginAttempts = 0;
let loginBusy = false;

async function signIn(wc) {
  if (loginBusy) return;
  const a = account();
  if (!a) {
    report({ login: 'no-account', message: 'No account stored' });
    showSetup(wc, 'no-account');
    return;
  }
  if (loginAttempts >= LOGIN_ATTEMPTS) {
    report({ login: 'failed', message: state.message || 'Sign-in failed' });
    showSetup(wc, 'failed', state.message);
    return;
  }
  loginBusy = true;
  loginAttempts += 1;
  console.log(`cinema: signing in as ${a.username} (attempt ${loginAttempts} of ${LOGIN_ATTEMPTS})`);
  report({ login: 'signing-in', message: '' });
  try {
    // the form is rendered by the app after its bundle loads
    let result = 'no-form';
    for (let i = 0; i < 20 && result === 'no-form'; i++) {
      result = await wc.executeJavaScript(fillLoginJs(a));
      if (result === 'no-form') await sleep(500);
    }
    if (result !== 'submitted') {
      report({ login: 'failed', message: `Login page not recognised (${result})` });
      loginAttempts = LOGIN_ATTEMPTS;
      showSetup(wc, 'failed', state.message);
      return;
    }
    // success navigates away from /login; a failure leaves a toast
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      if (!isLoginPage(wc.getURL())) return;   // did-navigate reports 'ok'
      const err = await wc.executeJavaScript(LOGIN_ERROR_JS).catch(() => '');
      if (err) {
        report({ login: loginAttempts >= LOGIN_ATTEMPTS ? 'failed' : 'retrying', message: err });
        break;
      }
    }
  } catch (e) {
    report({ login: 'retrying', message: String(e.message || e) });
  } finally {
    loginBusy = false;
  }
  if (isLoginPage(wc.getURL()) && loginAttempts < LOGIN_ATTEMPTS) {
    setTimeout(() => signIn(wc), 5000 * loginAttempts);
  } else if (isLoginPage(wc.getURL())) {
    report({ login: 'failed' });
    // the login form is no use to a remote: say what to do instead
    showSetup(wc, 'failed', state.message);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isLoginPage = (url) => { try { return /^\/v\/(login|oauth)\b/.test(new URL(url).pathname); } catch { return false; } };

// ---- staying signed in -------------------------------------------------------------

// The web app keeps its session in a session cookie (Trim-MC-token, no
// expiry), which Chromium drops on exit: every restart of the kiosk (a
// compositor restart, a reboot, a TV plugged back in) would sign in again.
// Give the app's session cookies an expiry so they are kept on disk. The
// server still decides whether a session is valid; an expired one lands on
// the login page, which signIn() fills in.
const KEEP_DAYS = 30;

function keepSessionCookies(ses) {
  const host = new URL(START_URL).hostname;
  ses.cookies.on('changed', (_e, cookie, _cause, removed) => {
    if (removed || !cookie.session || cookie.domain.replace(/^\./, '') !== host) return;
    const { name, value, path: cpath, secure, httpOnly, sameSite } = cookie;
    ses.cookies.set({
      url: `${ORIGIN}${cpath || '/'}`, name, value, path: cpath, secure, httpOnly,
      sameSite: sameSite === 'unspecified' ? undefined : sameSite,
      expirationDate: Date.now() / 1000 + KEEP_DAYS * 86400,
    }).then(() => ses.cookies.flushStore()).catch((e) => console.error(`cinema: keep cookie ${name}: ${e.message}`));
  });
}

// A session belongs to the account that made it: when the admin page stores
// a different user, drop the old session so the TV signs in as the new one.
async function forgetOtherAccount(ses) {
  const a = account();
  const file = path.join(DATA_DIR, 'account-user');
  let before = null;
  try { before = fs.readFileSync(file, 'utf8'); } catch { /* first start */ }
  if (!a || before === a.username) return;
  if (before !== null) {
    await ses.clearStorageData({ origin: ORIGIN, storages: ['cookies'] }).catch(() => {});
    console.log('cinema: account changed; signed out the previous one');
  }
  try { fs.writeFileSync(file, a.username); } catch (e) { console.error(`cinema: ${file}: ${e.message}`); }
}

// ---- page size ------------------------------------------------------------------------

const ZOOM = Math.min(4, Math.max(0.25, parseFloat(process.env.CINEMA_ZOOM) || 1));

// ---- our own screen: setup / status ---------------------------------------------------

// Shown instead of a black or stuck TV (setup/index.html): no account stored
// yet, the stored one refused (the login form is no use to a remote), or the
// media server not answering. It tells what to do, with a QR code of the NAS's
// web address, where the admin opens Fygo Cinema's page. Storing an account
// there restarts this kiosk (cinemad), which then signs in.
const SETUP_PAGE = path.join(__dirname, 'setup', 'index.html');
const SETUP_URL = new URL(`file://${SETUP_PAGE}`).href;
const LANG_FILE = path.join(DATA_DIR, 'language');
let setupState = null;
let probeTimer = 0;

const isSetupPage = (url) => typeof url === 'string' && url.startsWith(SETUP_URL);

// The NAS's address as seen from the LAN: the source address of the default
// route, with the web port of our start page (fnOS: 5666).
function nasAddress() {
  const port = new URL(START_URL).port || '80';
  let ip = null;
  try {
    const out = execFileSync('ip', ['-4', 'route', 'get', '1.1.1.1'], { encoding: 'utf8', timeout: 2000 });
    ip = (out.match(/\bsrc (\d+\.\d+\.\d+\.\d+)/) || [])[1] || null;
  } catch { /* no default route */ }
  if (!ip) {
    for (const addrs of Object.values(os.networkInterfaces())) {
      const a = (addrs || []).find((x) => x.family === 'IPv4' && !x.internal);
      if (a) { ip = a.address; break; }
    }
  }
  return ip ? `http://${ip}:${port}/` : '';
}

// The setup screen speaks the web app's language (remembered from its last
// visit, see rememberLanguage), else the system's.
function setupLanguage() {
  if (process.env.CINEMA_LANG) return process.env.CINEMA_LANG;
  try { return fs.readFileSync(LANG_FILE, 'utf8').trim(); } catch { /* not yet */ }
  return (process.env.LANG || 'en').replace('_', '-');
}

async function rememberLanguage(wc) {
  const lang = await wc.executeJavaScript("localStorage.getItem('trim.media/language') || ''").catch(() => '');
  if (lang) { try { fs.writeFileSync(LANG_FILE, lang); } catch { /* read-only profile */ } }
}

function showSetup(wc, which, message = '') {
  setupState = which;
  report({ page: 'setup', message: message || state.message });
  wc.loadFile(SETUP_PAGE, { query: { state: which, msg: message || '', url: nasAddress(), lang: setupLanguage() } });
  clearInterval(probeTimer);
  // unreachable: come back by ourselves as soon as the server answers
  if (which === 'connecting') probeTimer = setInterval(() => probe(wc), 3000);
}

async function probe(wc) {
  try {
    const r = await net.fetch(START_URL, { method: 'GET', cache: 'no-store' });
    if (r.ok) leaveSetup(wc);
  } catch { /* still down */ }
}

// OK on the setup screen, a server that is back: try the web app again.
function leaveSetup(wc) {
  clearInterval(probeTimer);
  setupState = null;
  if (!account()) { showSetup(wc, 'no-account'); return; }
  loginAttempts = 0;
  wc.loadURL(START_URL);
}

ipcMain.on('cinema:retry', (e) => leaveSetup(e.sender));

// ---- pages the TV may show ------------------------------------------------------

// Admin pages (library/user/server settings, first-run setup) are not for the
// remote; everything outside the web app is not for this window.
const BLOCKED = /^\/v\/(settings|init|welcome)\b/;

function allowed(url) {
  try {
    const u = new URL(url);
    return u.origin === ORIGIN && u.pathname.startsWith('/v') && !BLOCKED.test(u.pathname);
  } catch { return false; }
}

function onPage(wc, url) {
  if (isSetupPage(url)) return;
  if (!allowed(url)) {
    wc.loadURL(START_URL);
    return;
  }
  const p = new URL(url).pathname;
  report({ page: p });
  clearTimeout(okTimer);
  if (isLoginPage(url)) signIn(wc);
  // signed in once a page other than the login page stays up (the start page
  // itself shows for a moment before the app redirects a stale session)
  else if (state.login !== 'ok') {
    okTimer = setTimeout(() => {
      if (isLoginPage(wc.getURL())) return;
      loginAttempts = 0;
      report({ login: 'ok', message: '' });
    }, 3000);
  }
}
let okTimer = null;

// ---- sound: volume & mute of the TV's output -------------------------------------

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { env: PW_ENV, timeout: 4000, maxBuffer: 16 << 20 }, (err, stdout) => resolve(err ? null : stdout));
  });
}

// PipeWire node ids change when the sound server restarts; node.name doesn't.
async function sinkId() {
  const want = process.env.CINEMA_SINK;
  if (!want) return '@DEFAULT_AUDIO_SINK@';
  const out = await run('pw-dump', []);
  try {
    const n = JSON.parse(out).find((o) => o.type === 'PipeWire:Interface:Node' && o.info?.props?.['node.name'] === want);
    if (n) return String(n.id);
  } catch { /* fall through */ }
  return '@DEFAULT_AUDIO_SINK@';
}

async function volume(action) {
  const id = await sinkId();
  if (action === 'up') await run('wpctl', ['set-volume', '-l', '1.0', id, '5%+']);
  else if (action === 'down') await run('wpctl', ['set-volume', id, '5%-']);
  else if (action === 'mute') await run('wpctl', ['set-mute', id, 'toggle']);
  const out = (await run('wpctl', ['get-volume', id])) || '';
  const m = out.match(/Volume:\s*([\d.]+)/);
  return { volume: m ? Math.round(parseFloat(m[1]) * 100) : null, muted: /MUTED/.test(out) };
}

const VOLUME_KEYS = { AudioVolumeUp: 'up', AudioVolumeDown: 'down', AudioVolumeMute: 'mute' };
let volumeQueue = Promise.resolve();

// ---- window ---------------------------------------------------------------------

function createWindow() {
  const windowed = !!process.env.WINDOWED;
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    fullscreen: !windowed,
    kiosk: !windowed,
    frame: windowed,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,            // the preload loads inject/*.js
      backgroundThrottling: false,
    },
  });
  const wc = win.webContents;

  // An HTTP error page is a page that loaded: at boot the gateway (nginx) is
  // often up before the media server behind it and answers 502 Bad Gateway
  // (black text on our black window: a black TV with a line). Treat it like
  // an unreachable server: the "connecting" screen, which reloads the web app
  // as soon as it answers 200.
  wc.on('did-navigate', (_e, url, code, status) => {
    if (code >= 400 && !isSetupPage(url)) {
      console.log(`cinema: ${url} answered ${code} ${status || ''}; waiting for the media server`);
      report({ page: '', message: `The media server answered ${code} ${status || ''}`.trim() });
      showSetup(wc, 'connecting');
      return;
    }
    onPage(wc, url);
  });
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => { if (isMainFrame) onPage(wc, url); });
  wc.on('will-navigate', (e, url) => { if (!allowed(url) && !isSetupPage(url)) { e.preventDefault(); } });
  wc.on('did-finish-load', () => { if (!isSetupPage(wc.getURL())) rememberLanguage(wc); });
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));

  // The server may be starting (boot) or restarting (update): keep trying.
  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || isSetupPage(url)) return;   // -3 = aborted by a newer navigation
    report({ page: '', message: `Cannot reach the media server (${desc})` });
    showSetup(wc, 'connecting');
  });
  wc.on('render-process-gone', (_e, d) => {
    if (quitting) return;   // stopping: the renderer goes first, nothing to reload
    console.error(`cinema: renderer gone (${d.reason}); reloading`);
    setTimeout(() => wc.loadURL(START_URL), 1000);
  });

  // Volume keys belong to us, not the page, on every screen. (preload.js
  // catches any that get past this, e.g. keys sent over DevTools.)
  wc.on('before-input-event', (e, input) => {
    const action = input.type === 'keyDown' && VOLUME_KEYS[input.key];
    if (!action) return;
    e.preventDefault();
    volumeQueue = volumeQueue.then(() => volume(action)).then((v) => wc.send('cinema:osd', v)).catch(() => {});
  });

  // Our zoom, whatever Chromium remembered or a key combination changed.
  const applyZoom = () => { if (Math.abs(wc.getZoomFactor() - ZOOM) > 0.001) wc.setZoomFactor(ZOOM); };
  wc.on('did-finish-load', applyZoom);
  wc.on('did-navigate', applyZoom);
  wc.on('zoom-changed', () => setTimeout(applyZoom, 0));

  if (account()) win.loadURL(START_URL);
  else showSetup(wc, 'no-account');
  return win;
}

ipcMain.handle('cinema:volume', (_e, action) => volume(action));

// A real (trusted) mouse for the nav layer: the player's menus (Semi UI
// dropdowns) ignore synthetic DOM mouse events and open only for input the
// browser itself delivered. x/y are CSS px of the page; input events are in
// window coordinates, i.e. times the page zoom. Chromium's own pointer, not
// the compositor's: no cursor appears.
ipcMain.on('cinema:pointer', (e, { type, x, y }) => {
  const wc = e.sender;
  const z = wc.getZoomFactor();
  const p = { x: Math.round(x * z), y: Math.round(y * z) };
  wc.sendInputEvent({ type: 'mouseMove', ...p });
  if (type === 'click') {
    wc.sendInputEvent({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', ...p, button: 'left', clickCount: 1 });
  }
});

app.whenReady().then(async () => {
  const ses = session.defaultSession;
  // no permission prompts on a TV; the web app needs none but fullscreen
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'fullscreen'));
  await forgetOtherAccount(ses);
  keepSessionCookies(ses);
  report({ login: account() ? 'unknown' : 'no-account' });
  createWindow();
});
// flush the kept session to disk on the way out (systemd stop = SIGTERM)
let quitting = false;
app.on('before-quit', () => {
  quitting = true;
  session.defaultSession.cookies.flushStore().catch(() => {});
});
process.on('SIGTERM', () => app.quit());
app.on('window-all-closed', () => app.quit());
