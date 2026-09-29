// Remote-control navigation for the 飞牛影视 / Fygo TV web app (/v), run in
// the kiosk's preload (isolated world: shares the page's DOM, not its JS).
//
// The web app is built for a mouse: arrow keys do nothing on its browse
// pages, cards are a poster link + a title link + a hover "…" menu, and admin
// actions (scan library, edit metadata, settings) sit next to everything.
// This layer turns it into a TV UI without touching the app itself:
//
//   - navigation *units*: a card (poster/continue/library) is one unit, as is
//     each sidebar entry, button and link; icon-only popup buttons ("…",
//     account) and the header's settings are not units
//   - arrow keys move to the nearest unit in that direction (same row first),
//     scrolling it into view; a drawn focus ring follows it, and a card gets
//     mouse-hover events so the app shows its own hover state
//   - OK / Enter activates (a full synthetic click); Back closes a menu or
//     goes back; Home goes to the start page
//   - an open menu/popup takes the focus until it closes; admin items in
//     menus are hidden
//   - on the player page the keys belong to the app's player (left/right
//     seek, OK = play/pause) until up/down brings up its controls; then the
//     arrows move between the controls and their menus (subtitles, quality,
//     settings), and Back or a few seconds without keys hide them again
//   - admin controls (the "…" menus, account and settings buttons) are hidden
//     (the kiosk's main process keeps the window off /v/settings)
//
// Written against the international (Fygo TV 0.9.7) and domestic (影视 0.9.8)
// builds, which share their markup. Everything here degrades to "nothing
// happens" when the markup changes, never to a broken page.
'use strict';

const CARD_UNITS = '.card-root, .continue-card-root, .library-card-root';
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"], [role="tab"], [role="menuitem"], [role="option"]';
// Popups: Semi UI's menus/dialogs, and the app's own popovers (the subtitle
// picker), which are fixed-position children of <body> (see popups()).
const MENUS = '.semi-dropdown-menu, .semi-select-option-list, [role="listbox"], [role="menu"], .semi-popover-content, .semi-modal-content, .semi-sidesheet-inner, .trim-ui__player--popover';
const MENU_ITEMS = '.semi-dropdown-item, .semi-select-option, .semi-radio, .semi-checkbox';
// Menu items that change the library or the account: hidden on the TV.
const BLOCKED_ITEMS = [
  /^scan( library)?/i, /refresh metadata/i, /edit (cover|metadata|info)/i, /library settings/i, /view by folder/i,
  /re-?match/i, /delete/i, /remove/i, /change password/i, /log ?out/i, /help center/i, /^about\b/i,
  /appearance/i, /playback preferences/i, /^add$/i, /search subtitles/i, /subtitle file/i,
  /扫描/, /刷新元数据/, /编辑/, /媒体库设置/, /按文件夹/, /重新匹配/, /删除/, /移除/, /修改密码/, /退出登录/, /帮助中心/, /关于/, /外观/, /播放偏好/,
  /^添加$/, /搜索字幕/, /字幕文件/,
];
const PLAYER_PATHS = /^\/v\/(video|live)\b/;
const DETAIL_PATHS = /^\/v\/(movie|tv|episode|season|person|actor|item|mdb)\b/;

let current = null;          // the focused unit's element
let lastPath = '';
let ring = null;
const hoverTarget = new WeakMap();

// ---- geometry & visibility ---------------------------------------------------

function rectOf(el) { return el.getBoundingClientRect(); }

function shown(el) {
  if (!el || !el.isConnected) return false;
  const r = rectOf(el);
  if (r.width < 12 || r.height < 12) return false;
  const s = getComputedStyle(el);
  if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity < 0.05) return false;
  // laid out somewhere reachable by scrolling (not far off to the left/top)
  return r.bottom > -4000 && r.right > -4000;
}

function text(el) { return (el.innerText || el.getAttribute('aria-label') || el.title || '').trim(); }

// Fixed-position children of <body> other than the app itself: the app's
// own popovers (portals). Ours (ring, OSD) live on <html>, not <body>.
function portals() {
  return [...document.body.children].filter((e) => {
    if (e.tagName === 'SCRIPT' || e.tagName === 'STYLE') return false;
    const pos = getComputedStyle(e).position;
    return (pos === 'fixed' || pos === 'absolute') && shown(e) && rectOf(e).width > 40 && rectOf(e).height > 40;
  });
}

function popups() {
  const all = [...document.querySelectorAll(MENUS)].filter(shown).concat(portals());
  // outermost only
  return all.filter((e) => !all.some((o) => o !== e && o.contains(e)));
}

function inMenu(el) {
  return !!el.closest(MENUS) || portals().some((p) => p.contains(el));
}

// ---- units ----------------------------------------------------------------------

function isExternal(el) {
  const href = el.getAttribute && el.getAttribute('href');
  return !!href && /^https?:/i.test(href) && !href.startsWith(location.origin);
}

// Icon-only popup triggers: the "…" menus on cards/libraries/details and the
// account button. Popup triggers with text (audio/subtitle pickers) stay.
function isIconPopup(el) {
  const trigger = el.closest('[aria-haspopup]');
  return !!trigger && trigger.getAttribute('aria-haspopup') !== 'false' && !text(trigger);
}

// The header's icon buttons (search, account, settings): none is a unit, all
// are hidden. Search is no use without a keyboard, and there is none on a TV.
// (Not on the player page: its top-right info button is the player's.)
function headerIcons() {
  return [...document.querySelectorAll('button, [tabindex="0"]')].filter((e) => {
    const r = rectOf(e);
    return r.top < 80 && r.left > innerWidth * 0.6 && !text(e) && shown(e);
  }).sort((a, b) => rectOf(a).left - rectOf(b).left);
}

function openMenu() {
  const menus = popups();
  return menus.length ? menus[menus.length - 1] : null;
}

function enabled(e) { return !e.disabled && e.getAttribute('aria-disabled') !== 'true' && !e.closest('[data-cinema-hidden]'); }

function isPointer(e) {
  return getComputedStyle(e).cursor === 'pointer' &&
    !(e.parentElement && getComputedStyle(e.parentElement).cursor === 'pointer');
}

// The navigation units within root: cards, focusable controls, and
// pointer-only controls (favourite/watched toggles, pickers, "View All",
// Filter, popup choices: cursor:pointer, not inside anything already counted).
function collect(root, menu, iconPopups = false) {
  const cards = [...root.querySelectorAll(CARD_UNITS)].filter(shown);
  const headerSkip = menu || iconPopups ? new Set() : new Set(headerIcons());
  const others = [...root.querySelectorAll(`${FOCUSABLE}, ${MENU_ITEMS}`)].filter((e) =>
    shown(e) && enabled(e) && !e.closest(CARD_UNITS) && (iconPopups || !isIconPopup(e)) && !isExternal(e) && !headerSkip.has(e));
  const pointer = [...root.querySelectorAll('div, span, li, p, strong')].filter((e) =>
    shown(e) && enabled(e) && isPointer(e) && !e.closest(CARD_UNITS) && !e.closest(FOCUSABLE) && (iconPopups || !isIconPopup(e)));
  let all = [...cards, ...others, ...pointer];
  if (menu) all = all.filter((e) => text(e));        // a popup's icon buttons are its admin actions
  else all = all.filter((e) => !inMenu(e));
  // one unit per nested group: keep the outermost, unless it is a page-sized wrapper
  all = all.filter((e) => !all.some((o) => o !== e && o.contains(e) && rectOf(o).width < innerWidth * 0.6));
  return [...new Set(all)];
}

function units() {
  const menu = openMenu();
  if (menu) return collect(menu, true);
  if (playerUi) return playerUnits();
  return collect(document, false);
}

// ---- the player's controls -------------------------------------------------------

const inPlayerPage = () => PLAYER_PATHS.test(location.pathname);
const playerRoot = () => document.querySelector('.xgplayer');

let playerUi = false;         // the player's controls are up and ours to move in
let playerUiTimer = 0;
let playerPing = 0;
const PLAYER_UI_IDLE_MS = 8000;

// The control bar's buttons and the top bar's (back, info), not the title.
function playerUnits() {
  const root = playerRoot();
  if (!root) return [];
  // (the player's icon buttons with menus, CC and settings, are its own
  // controls, not the library's admin "…" menus; volume, picture-in-picture
  // and fullscreen are hidden by cinema.css)
  return collect(root, false, true).filter((e) => {
    const b = rectOf(e);
    if (b.top < 100 && !e.matches('button') && text(e)) return false;   // the title
    return true;
  });
}

// The player's own volume stays at 100 %, unmuted: the one volume on the TV
// is the system's (the remote's volume keys, the admin page), so nothing can
// quietly turn the film down underneath it (the player remembers a volume
// per browser, and its keys change it).
const lockedVideos = new WeakSet();

function lockPlayerVolume() {
  for (const v of document.querySelectorAll('video')) {
    const fix = () => {
      if (v.volume !== 1) v.volume = 1;
      if (v.muted) v.muted = false;
    };
    fix();
    if (!lockedVideos.has(v)) {
      lockedVideos.add(v);
      v.addEventListener('volumechange', fix);
    }
  }
}

// The player hides its controls when the mouse rests: keep "moving" it
// while they are ours.
let wiggle = 1;
function pingPlayer() {
  const root = playerRoot();
  if (!root) return;
  if (realPointer) {
    if (!pointerAt) parkPointer();
    else { wiggle = -wiggle; realPointer('move', pointerAt.x + wiggle, pointerAt.y); }
    return;
  }
  const b = rectOf(root);
  const init = { bubbles: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 };
  root.dispatchEvent(new MouseEvent('mousemove', init));
  root.dispatchEvent(new PointerEvent('pointermove', { ...init, pointerType: 'mouse' }));
}

function showPlayerUi() {
  if (!playerUi) {
    playerUi = true;
    pingPlayer();
    clearInterval(playerPing);
    playerPing = setInterval(pingPlayer, 1000);
    setTimeout(() => {
      const list = playerUnits();
      // start on play/pause, the first button of the bar
      const bar = list.filter((e) => e.closest('.xgplayer-controls'));
      const first = (bar.length ? bar : list).slice().sort((a, b) => rectOf(a).left - rectOf(b).left)[0];
      if (first) focusUnit(first, false);
    }, 150);
  }
  touchPlayerUi();
}

function touchPlayerUi() {
  clearTimeout(playerUiTimer);
  playerUiTimer = setTimeout(() => { if (!openMenu()) hidePlayerUi(); else touchPlayerUi(); }, PLAYER_UI_IDLE_MS);
}

function hidePlayerUi() {
  playerUi = false;
  parkPointer();
  clearTimeout(playerUiTimer);
  clearInterval(playerPing);
  if (current && current.isConnected) current.blur?.();
  if (document.activeElement && playerRoot()?.contains(document.activeElement)) document.activeElement.blur();
  current = null;
  drawRing();
}

// ---- focus ring & hover ---------------------------------------------------------

function ensureRing() {
  if (ring && ring.isConnected) return ring;
  ring = document.createElement('div');
  ring.id = 'cinema-focus-ring';
  document.documentElement.appendChild(ring);
  return ring;
}

function drawRing() {
  const r = ensureRing();
  if (!current || !shown(current) || (inPlayerPage() && !playerUi && !openMenu())) {
    r.style.opacity = '0';
    return;
  }
  const b = rectOf(current);
  const pad = 4;
  Object.assign(r.style, {
    opacity: '1',
    transform: `translate(${Math.round(b.left - pad)}px, ${Math.round(b.top - pad)}px)`,
    width: `${Math.round(b.width + pad * 2)}px`,
    height: `${Math.round(b.height + pad * 2)}px`,
  });
}

function mouse(el, type, relatedTarget = null) {
  const b = rectOf(el);
  const init = { bubbles: true, cancelable: true, composed: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, view: window, relatedTarget };
  const E = type.startsWith('pointer') ? PointerEvent : MouseEvent;
  el.dispatchEvent(new E(type, type.startsWith('pointer') ? { ...init, pointerType: 'mouse', isPrimary: true } : init));
}

// Leaving says where the pointer went (relatedTarget): React derives its
// mouseleave from mouseout's relatedTarget, and without one the player's
// hover menus stay open.
function hover(el, on) {
  const t = hoverTarget.get(el) || el;
  if (on) ['pointerover', 'pointerenter', 'mouseover', 'mouseenter'].forEach((ty) => mouse(t, ty));
  else {
    const to = document.body;
    ['pointerout', 'pointerleave', 'mouseout', 'mouseleave'].forEach((ty) => mouse(t, ty, to));
    ['pointerover', 'mouseover'].forEach((ty) => mouse(to, ty, t));
  }
}

// The real pointer (main.js, trusted input): set by start(). Used on the
// player page, whose menus only open for input the browser delivered.
let realPointer = null;
let pointerAt = null;          // {x, y} CSS px, where we last put it

function realMove(x, y) {
  if (!realPointer) return;
  pointerAt = { x, y };
  realPointer('move', x, y);
}

function realHover(el) {
  const b = rectOf(el);
  realMove(b.left + b.width / 2, b.top + b.height / 2);
}

function realClick(el) {
  const b = rectOf(el);
  pointerAt = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  if (realPointer) realPointer('click', pointerAt.x, pointerAt.y);
  else click(el);
}

// Park the pointer over the picture, away from every control and menu (hover
// menus close when it leaves them).
function parkPointer() {
  const v = document.querySelector('.xgplayer video') || playerRoot();
  if (!v) return;
  const b = rectOf(v);
  realMove(b.left + b.width / 2, b.top + b.height * 0.4);
}

function focusUnit(el, scroll = true) {
  if (!el) return;
  if (current && current !== el && current.isConnected && current.matches(CARD_UNITS)) hover(current, false);
  current = el;
  if (inPlayerPage() && openMenu() && openMenu().contains(el)) realHover(el);
  // cards show their own hover state (play button, highlight); anything else
  // may be a hover-opened menu, which must wait for OK
  if (el.matches(CARD_UNITS)) hover(el, true);
  const f = el.matches(FOCUSABLE) ? el : el.querySelector(FOCUSABLE);
  if (f && !(f.matches('input, textarea') && !inMenu(f))) f.focus({ preventScroll: true });
  if (scroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  remember(location.href);
  drawRing();
  setTimeout(drawRing, 250);   // after the smooth scroll settles
  setTimeout(drawRing, 600);
}

// ---- movement ---------------------------------------------------------------------

function centre(b) { return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }

function move(dir) {
  const list = units();
  if (!list.length) return;
  if (!current || !list.includes(current) || !shown(current)) {
    focusUnit(initial(list));
    return;
  }
  const from = rectOf(current);
  const c = centre(from);
  let best = null;
  let bestScore = Infinity;
  for (const el of list) {
    if (el === current) continue;
    const b = rectOf(el);
    const p = centre(b);
    let along, across, overlap;
    // only what lies beyond the current unit's edge (a little overlap allowed)
    const slack = 12;
    if (dir === 'left' || dir === 'right') {
      along = dir === 'left' ? from.left - b.right : b.left - from.right;
      if (along < -slack || (dir === 'left' ? p.x >= c.x : p.x <= c.x)) continue;
      overlap = Math.min(from.bottom, b.bottom) - Math.max(from.top, b.top);
      across = Math.abs(p.y - c.y);
    } else {
      along = dir === 'up' ? from.top - b.bottom : b.top - from.bottom;
      if (along < -slack || (dir === 'up' ? p.y >= c.y : p.y <= c.y)) continue;
      overlap = Math.min(from.right, b.right) - Math.max(from.left, b.left);
      across = Math.abs(p.x - c.x);
    }
    along = Math.max(along, 0);
    // Left/right: the same row (overlapping) first, however far along it
    // (the detail page's subtitle picker, not the cast below); another row
    // only when the row has nothing more (a low card → the sidebar).
    // Up/down: the nearest ahead, the same column preferred but not over
    // something much closer beside it (the filter panel's options, not the
    // card far below the Filter button).
    const sideways = dir === 'left' || dir === 'right';
    const score = overlap > 0 ? along + across * 0.3
      : (sideways ? 10000 + along + across * 2 : 100 + along + across);
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) { focusUnit(best); return; }
  // nothing further that way: scroll, so lazily loaded rows can appear
  const scroller = scrollParent(current, dir);
  if (scroller) {
    const dx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
    const dy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
    const view = scroller === document.scrollingElement ? { w: innerWidth, h: innerHeight } : { w: scroller.clientWidth, h: scroller.clientHeight };
    scroller.scrollBy({ left: dx * view.w * 0.6, top: dy * view.h * 0.6, behavior: 'smooth' });
  }
}

function scrollParent(el, dir) {
  const vertical = dir === 'up' || dir === 'down';
  for (let e = el.parentElement; e; e = e.parentElement) {
    const s = getComputedStyle(e);
    const over = vertical ? s.overflowY : s.overflowX;
    const room = vertical ? e.scrollHeight > e.clientHeight + 4 : e.scrollWidth > e.clientWidth + 4;
    if (room && /(auto|scroll)/.test(over)) return e;
  }
  const d = document.scrollingElement;
  return vertical && d.scrollHeight > innerHeight + 4 ? d : null;
}

// Where focus starts on a page.
function initial(list) {
  const path = location.pathname;
  if (DETAIL_PATHS.test(path)) {
    const play = list.find((e) => e.matches('.semi-button-primary') || e.querySelector('.semi-button-primary'));
    if (play) return play;
  }
  const content = list.filter((e) => rectOf(e).left > 250 && rectOf(e).top > 70);
  const pool = content.length ? content : list;
  return pool.slice().sort((a, b) => (rectOf(a).top - rectOf(b).top) || (rectOf(a).left - rectOf(b).left))[0];
}

// ---- activation -----------------------------------------------------------------

// Like a real click: on the innermost element under the unit's centre (the
// app's handlers sit on inner elements as often as on the unit itself).
function click(el) {
  const b = rectOf(el);
  const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  const target = hit && el.contains(hit) && hit.id !== 'cinema-focus-ring' ? hit : el;
  ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((ty) => mouse(target, ty));
}

let menuOpener = null;        // the unit that opened the open popup

function activate() {
  if (!current || !current.isConnected) return;
  const el = current;
  if (el.matches('.continue-card-root')) {
    // continue watching: resume, like a TV
    const play = el.querySelector('.play-mask__btn--play');
    if (play) { hover(el, true); return click(play); }
  }
  if (el.matches('.card-root')) {
    const link = el.querySelector('a[href]');
    if (link) return link.click();
  }
  if (el.matches('input, textarea')) { el.focus(); return; }
  const menu = openMenu();
  if (inPlayerPage()) {
    if (menu && menu.contains(el)) {
      const before = menu.innerText;
      realClick(el);
      setTimeout(() => { if (openMenu() === menu && menu.innerText === before) closeMenu(); }, 350);
      return;
    }
    menuOpener = el;
    realHover(el);
    setTimeout(() => { if (!openMenu()) realClick(el); }, 300);
    return;
  }
  if (menu && menu.contains(el)) {
    // a choice in a popup: pick it, then close the popup (hover popups stay
    // open by themselves, a TV picker should not)
    const before = menu.innerText;
    click(el);
    // a submenu is a newer popup, or the same one with new content (the
    // player's settings -> audio track list); anything else was a choice
    setTimeout(() => { if (openMenu() === menu && menu.innerText === before) closeMenu(); }, 350);
    return;
  }
  menuOpener = el;
  if (el.matches('a[href]')) return el.click();
  // hover first: some pickers (subtitles) open on hover, others on click
  hover(el, true);
  setTimeout(() => { if (!openMenu()) click(el); }, 120);
}

function closeMenu() {
  const menu = openMenu();
  if (!menu) return;
  if (inPlayerPage()) parkPointer();
  const esc = { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true };
  (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', esc));
  document.dispatchEvent(new KeyboardEvent('keydown', esc));
  // hover popups close when the pointer leaves the opener and the popup
  if (menuOpener && menuOpener.isConnected) hover(menuOpener, false);
  hover(menu, false);
  // popovers close on an outside click
  setTimeout(() => { if (openMenu() === menu) click(document.body); }, 120);
  setTimeout(returnFromMenu, 300);
}

function returnFromMenu() {
  if (openMenu()) return;
  if (menuOpener && shown(menuOpener)) focusUnit(menuOpener, false);
  menuOpener = null;
}

function back() {
  if (openMenu()) { closeMenu(); return; }
  if (location.pathname.replace(/\/$/, '') === '/v') return;
  history.back();
}

// The current choice in a popup: marked by ARIA or Semi; else the item the
// opener's label names (the player's speed button reads "1.5x"); else the
// one item with a background of its own; a speed list without a named one
// is at 1.0x (its button then reads "Speed").
function selectedItem(items) {
  const marked = items.find((e) => e.matches('[aria-selected="true"], [aria-checked="true"], [class*="-selected"], [class*="-active"]'));
  if (marked) return marked;
  const label = menuOpener && menuOpener.isConnected ? text(menuOpener) : '';
  // (exactly, or as the start of a longer line: "Original" → "Original 4k 15Mbps")
  const named = label && (items.find((e) => text(e) === label) || items.find((e) => text(e).startsWith(label) && /\s/.test(text(e)[label.length] || '')));
  if (named) return named;
  if (items.length > 1 && items.every((e) => /^\d+(\.\d+)?x$/i.test(text(e)))) {
    const normal = items.find((e) => /^1(\.0+)?x$/i.test(text(e)));
    if (normal) return normal;
  }
  const filled = items.filter((e) => { const c = getComputedStyle(e).backgroundColor; return c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c); });
  return filled.length === 1 ? filled[0] : items[0];
}

// ---- keys -----------------------------------------------------------------------

const DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

function onKey(e) {
  // only real keys: the page's and our own synthetic ones (back() sends
  // Escape to close menus) pass through untouched
  if (!e.isTrusted) return;
  const key = e.key;
  const inPlayer = inPlayerPage();
  const typing = e.target && e.target.matches && e.target.matches('input, textarea') && !inMenu(e.target);
  const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
  if (inPlayer && playerUi) touchPlayerUi();
  if (key === 'BrowserBack' || key === 'GoBack' || key === 'Escape' || (key === 'Backspace' && !typing)) {
    if (typing) {
      // leave the field (the app closes its search box on Escape / blur)
      const t = e.target;
      t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      t.blur();
    } else if (inPlayer && openMenu()) closeMenu();          // a player menu
    else if (inPlayer && playerUi) hidePlayerUi();           // then its controls
    else back();                                             // then the player
    stop();
    return;
  }
  if (key === 'BrowserHome' || key === 'Home' && !typing) {
    location.assign('/v/');
    stop();
    return;
  }
  if (inPlayer && !playerUi && !openMenu()) {
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      showPlayerUi();
      stop();
    } else if (key === 'Enter') {
      // OK = play/pause in the app's player (it listens for Space)
      stop();
      const sp = { key: ' ', code: 'Space', keyCode: 32, bubbles: true };
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', sp));
      document.activeElement.dispatchEvent(new KeyboardEvent('keyup', sp));
    }
    return;   // left/right (seek), space etc.: the player's
  }
  if (typing) {
    if (key === 'ArrowUp' || key === 'ArrowDown') { e.target.blur(); } else return;
  }
  if (DIRS[key]) {
    move(DIRS[key]);
    stop();
  } else if (key === 'Enter' || key === ' ') {
    activate();
    stop();
  }
}

// ---- page changes, hidden items, blocked routes -------------------------------------

function hideBlockedItems(root) {
  for (const item of root.querySelectorAll('.semi-dropdown-item, [role="menuitem"], [role="option"], li, button, a')) {
    if (item.hasAttribute('data-cinema-hidden')) continue;
    const t = text(item);
    if (t && t.length < 40 && BLOCKED_ITEMS.some((re) => re.test(t))) {
      item.setAttribute('data-cinema-hidden', '');
      item.style.setProperty('display', 'none', 'important');
    }
  }
}

// Admin controls off the screen: the icon-only popup buttons ("…" on cards,
// libraries and the detail page; the account menu) and the header's icon
// buttons (search, settings). They keep their space, so the layout does not
// move.
function hideAdminControls() {
  if (PLAYER_PATHS.test(location.pathname)) return;
  const hide = (e) => { e.setAttribute('data-cinema-hidden', ''); };
  for (const e of document.querySelectorAll('[aria-haspopup]:not([data-cinema-hidden])')) {
    if (e.getAttribute('aria-haspopup') !== 'false' && !text(e) && !inMenu(e)) hide(e);
  }
  headerIcons().forEach(hide);
}

// Where focus was on each page visited, so Back lands where you left.
const remembered = new Map();   // location.href -> {x, y} page coordinates of the unit's centre

// (called on every focus change: by the time a page change is noticed the old
// page's elements are gone)
function remember(href) {
  if (!current || !current.isConnected || inMenu(current)) return;
  const b = rectOf(current);
  remembered.set(href, { x: b.left + b.width / 2 + scrollX, y: b.top + b.height / 2 + scrollY });
}

function recalled(list) {
  const at = remembered.get(location.href);
  if (!at) return null;
  let best = null;
  let bestD = Infinity;
  for (const e of list) {
    const b = rectOf(e);
    const d = Math.hypot(b.left + b.width / 2 + scrollX - at.x, b.top + b.height / 2 + scrollY - at.y);
    if (d < bestD) { bestD = d; best = e; }
  }
  return bestD < 80 ? best : null;
}

function onPageChange() {
  const path = location.pathname;
  if (path === lastPath) return;
  lastPath = path;
  current = null;
  if (playerUi) hidePlayerUi();
  // out of the player: the real pointer leaves the window (no stray hover)
  if (pointerAt && !inPlayerPage()) { realMove(-20, -20); pointerAt = null; }
  if (!PLAYER_PATHS.test(path)) {
    // the app renders the page, then may restore its scroll position
    setTimeout(() => {
      const list = units();
      if (list.length) focusUnit(recalled(list) || initial(list), !!remembered.get(location.href));
    }, 700);
  }
  drawRing();
}

function tick() {
  onPageChange();
  if (inPlayerPage()) lockPlayerVolume();
  hideAdminControls();
  const menu = openMenu();
  // the app moved focus into a text field (search opens as one): follow it
  const a = document.activeElement;
  if (a && a !== current && a.matches('input:not([type=checkbox]):not([type=radio]), textarea') && shown(a)) {
    current = a;
  }
  // the focused unit vanished (list re-rendered, popup closed): refocus
  if (current && !shown(current) && (!inPlayerPage() || playerUi || menu)) {
    current = null;
    if (!menu && menuOpener && shown(menuOpener)) returnFromMenu();
    else { const list = units(); if (list.length) focusUnit(menu ? selectedItem(list) : initial(list), false); }
  }
  // a popup opened: move into it, onto its current choice
  if (menu && (!current || !menu.contains(current))) {
    hideBlockedItems(menu);
    const items = units();
    if (items.length) focusUnit(selectedItem(items), false);
  }
  drawRing();
}

function start(opts = {}) {
  realPointer = opts.pointer || null;
  window.addEventListener('keydown', onKey, true);
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) hideBlockedItems(n);
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('scroll', drawRing, true);
  window.addEventListener('resize', drawRing);
  setInterval(tick, 400);
  onPageChange();
}

module.exports = { start, units, move, activate, back, closeMenu, focusUnit, get current() { return current; } };
