# Fygo TV web app integration

Fygo Cinema shows the vendor's own web app (飞牛影视 / Fygo TV, `/v` on the
NAS) and changes nothing on the server. Everything that makes it a TV app runs
in our kiosk: the main process (`kiosk/main.js`), and the page-side layer
(`kiosk/preload.js`, `kiosk/inject/nav.js`, `kiosk/inject/cinema.css`).

This document has three parts:
1. **the behaviour we promise**: what the remote does on every screen;
2. **what that behaviour depends on in the web app**: selectors, routes and
   quirks, each with the code that uses it and what breaks without it;
3. **how to re-check it all** after a Fygo TV update, and how to find the new
   hooks when one has moved.

When the web app changes, the behaviour (part 1) stays the same; the
hooks (part 2) are updated to match. Change part 1 only on purpose, and update
this document with it.

Written against **trim.media 0.9.7-3** (the international Fygo TV), on
2026-09-29. The domestic 影视 (0.9.8) had the same markup when checked on
2026-09-28.

---

## 1. Behaviour

### Keys everywhere

| key | does |
|---|---|
| ← ↑ → ↓ | move the focus ring to the nearest control in that direction; if there is none, scroll that way (lazy rows load) |
| OK (Enter) | activate what has the ring (a real click for the app) |
| Back (BrowserBack, Escape, Backspace) | close the open popup; else leave the text field; else go back a page. Nothing on the start page. |
| Home (BrowserHome) | the start page `/v/` |
| Volume up / down / mute | the TV's system volume (±5 %, max 100 %) with our on-screen display; never the web player's own volume |

- Only real keys count. Synthetic key events (the page's, or our own) are ignored by the nav layer.
- Back returns focus to the control you left on that page.

### Browse pages (home, favourites, libraries, lists, person)

- Units the ring can land on:
  - a card is **one** unit: a poster card, a "continue watching" card, a library card;
  - the sidebar entries;
  - the row headers ("HDR ›");
  - the library toolbar: Filter, sort, Layout, and the options of the expanded filter panel.
- First focus on a page: the top-left content unit (not the sidebar).
- OK on a poster card opens its detail page. OK on a "continue watching" card **resumes playback directly**.
- A card gets the app's own hover state (its play overlay) while it has the ring.

### Detail page (movie / show / episode / person)

- First focus: **Play**.
- The ring reaches:
  - favourite, watched;
  - the subtitle and audio pickers;
  - the cast row;
  - "View All";
  - the back arrow.
- OK on a picker opens it; the list opens on its **current** choice. OK on a choice picks it and closes the list. Back closes it without a change. Either way, focus returns to the picker.

### Hidden: admin and account controls

The remote never reaches these, and they are not shown:

- the "…" menus on cards, library entries and the detail page (scan, refresh
  metadata, edit, rematch, delete, library settings, …);
- the header's search, account (avatar) and settings (gear) buttons (search
  is no use without a keyboard, and the TV has none);
- in the subtitle picker: "Add" (search subtitles, add NAS / computer subtitle
  file) and the per-subtitle delete icons;
- any menu item whose text matches the blocklist (scan, refresh metadata,
  edit, library settings, view by folder, rematch, delete, remove, change
  password, log out, help center, about, appearance, playback preferences,
  add, search subtitles, subtitle file, and their Chinese equivalents);
- external links (IMDb, …).

The main process also keeps the window off **`/v/settings`, `/v/init`,
`/v/welcome`** (it loads the start page instead) and off any other site. New
windows are refused.

### Player (`/v/video/...`, `/v/live`)

There are two states.

**Watching** (controls hidden, no ring):

| key | does |
|---|---|
| ← / → | the player's own seek (10 s) |
| OK | play / pause |
| ↑ / ↓ | bring up the controls |
| Back | leave the player |

**Controls** (the ring is on the control bar):

- The arrows move over:
  - play/pause, −10 s, +10 s;
  - speed, quality, subtitles (CC), settings;
  - the top bar's back arrow and info.
- First focus: play/pause.
- OK opens a menu, on its current choice:
  - speed: the button's label, or 1.0x;
  - quality: e.g. "Original 4k";
  - subtitles: the current track.
- Settings → Audio opens the audio track list inside the same menu.
- Picking a choice closes the menu.
- Back closes the menu, then the controls, then the player.
- The controls hide after **8 s** without a key.

**Always, in the player:**
- the player's own volume is held at **100 %, unmuted**;
- the volume button, picture-in-picture and fullscreen are hidden (the TV's
  volume is the remote's; the kiosk is always fullscreen).

### Signing in and staying signed in

- On `/v/login`, the kiosk fills in the page's own login form with the stored
  account and submits it.
- It tries at most **3 times** per kiosk start, 5 s, then 10 s apart.
- After the third failure it stops. The page's own error text ("Username or
  password is incorrect.") goes to `/run/fygo-cinema/state.json`, and the
  admin page shows it.
- The session survives kiosk restarts and reboots: the app's session cookie
  is kept on disk for **30 days**.
- An expired session lands on the login page, which is filled in again.
- When the admin page stores a **different** user, the kept session is
  dropped first.

### Never a black TV: the setup screen

When the web app can't be shown, the kiosk shows its own screen instead:
`kiosk/setup/`, a local page in the look of Fygo TV's login page, whose
background and logo are copied there.

| state | when | shows |
|---|---|---|
| `no-account` | no account stored: the kiosk runs anyway, with an empty placeholder credential sealed by cinemad | "One more step": 3 steps and a QR code of the NAS's web address (`http://<LAN IP>:5666/`; the IP is the source address of the default route) |
| `failed` | the stored account refused 3 times, or the login form not recognised | "Couldn't sign in", the page's own error text, the same steps and QR code |
| `connecting` | the start page fails to load (server starting or updating) | a spinner; the kiosk probes the start page every 3 s and goes on by itself when it answers |

- **OK** on the setup screen tries again: the web app if an account is
  stored, else the `no-account` screen.
- Saving an account on the admin page restarts the kiosk, which then signs
  in by itself.
- The app switched **off** on the admin page: no kiosk at all, a black TV (on
  purpose).
- Language: the web app's own, remembered from its last visit
  (`localStorage['trim.media/language']`, kept in the profile as
  `language`); else `$LANG`; `CINEMA_LANG` overrides.
- The QR code points at the fnOS desktop, not at `/app/fygo-cinema/`: opened
  directly, without the desktop's token, that answers "invalid token". No
  deep link that opens an app from the desktop's URL has been found.

### Page size

The page is zoomed (Chromium zoom, not a compositor scale):
- **200 %** on screens with more than 1080 lines;
- **150 %** at 1080 lines and fewer.

The admin page can override it (50–300 %).

---

## 2. What it depends on

Each entry gives the hook, the code that uses it, and the symptom when it
breaks.

### Routes

| hook | used by | if it changes |
|---|---|---|
| start page `/v/` | `main.js` START_URL | the kiosk opens a blank or wrong page |
| login `/v/login`, `/v/oauth…` | `main.js` isLoginPage | no automatic sign-in |
| admin `/v/settings…`, `/v/init`, `/v/welcome` | `main.js` BLOCKED | admin pages reachable |
| player `/v/video/…`, `/v/live` | `nav.js` PLAYER_PATHS | player keys handled like a browse page (arrows stop seeking) |
| detail `/v/(movie\|tv\|episode\|season\|person\|actor\|item\|mdb)/…` | `nav.js` DETAIL_PATHS | first focus not on Play |

### Sign-in and session (`main.js`)

- **Login form**, filled in by `fillLoginJs`:
  - fields: `input[type=password]` and the first other text input;
  - button: the one whose text matches `/登录|登入|log ?in|sign ?in/i`.
  - The fields are React-controlled, so values go in with the native
    `HTMLInputElement.prototype.value` setter plus `input` and `change`
    events. A plain `.value =` is ignored.
  - If broken: state `failed`, "Login page not recognised (no-form |
    no-button)", and the TV shows the setup screen's `failed` state.
- **Error text**, read by `LOGIN_ERROR_JS`: `.semi-toast-content-text`,
  `.semi-toast-content`, `[role=alert]`, `.semi-form-field-error-message`.
  - Nested toast elements repeat the text, so it is de-duplicated.
  - If broken: failures still stop after 3 tries, but without a reason.
- **Session cookie**: `Trim-MC-token`, a session cookie (no expiry) on the
  page's host.
  - `keepSessionCookies` re-sets **every** session cookie of that host with a
    30-day expiry, whatever its name.
  - If the app moves its token to localStorage, that already survives
    restarts; if it moves to sessionStorage, the session is lost on each
    restart and the login form takes over (slower start, same result).
- **Requests** are signed by the page (`authx` header). We never make API
  calls ourselves, and must not start to: the signing is the page's business.

### Browse units (`nav.js`)

| hook | used for | if it changes |
|---|---|---|
| `.card-root` (poster card; its `a[href]` opens the item) | one unit per card; OK = the link | each card becomes 2–3 stops (poster, title, "…") or none |
| `.continue-card-root`, `.play-mask__btn--play` | continue watching: OK resumes | OK opens the detail page instead of playing |
| `.library-card-root` | library cards | not reachable |
| `cursor: pointer` (computed; Tailwind `cursor-pointer`) on plain divs and spans | "pointer-only" controls: row headers, favourite/watched, subtitle picker, filter options, "View All" | those controls unreachable |
| `.semi-button-primary` on the detail page | first focus = Play | first focus top-left |

Two constraints come with the `cursor: pointer` rule:
- **Never set `cursor` in `cinema.css`.** It would hide `cursor: pointer`,
  and with it every pointer-only control. (It happened once: the row headers
  vanished.)
- Page-sized wrappers (≥ 60 % of the width) don't swallow the units inside
  them, and nested pointer elements count once (the outermost).

### Admin controls (`nav.js` hideAdminControls, BLOCKED_ITEMS; `cinema.css`)

- **"…" menus and the account menu**: elements with `[aria-haspopup]` and no
  text. They get `data-cinema-hidden`, which is `visibility: hidden`, so the
  layout doesn't move.
  - Not on the player page: there, icon buttons with menus (CC, settings) are
    the player's own.
  - If broken: the "…" menus are visible and reachable again.
- **Header icons**: textless `button` / `[tabindex="0"]` in the top 80 px and
  the right 40 % of the window: search, avatar, gear. All are hidden and are
  not units.
  - Not on the player page, where the top-right info button is the player's.
- **Blocked menu items**: `BLOCKED_ITEMS`, matched against the text of
  `.semi-dropdown-item, [role=menuitem], [role=option], li, button, a` (under
  40 characters).
  - They get `display: none`.
  - Add both the English and the Chinese wording when a new admin item
    appears.

### Popups (`nav.js` popups, MENUS, closeMenu, selectedItem)

A popup, when open, takes the arrows until it closes. Three kinds exist:

1. **Semi UI**: `.semi-dropdown-menu`, `.semi-select-option-list`,
   `[role=listbox]`, `[role=menu]`, `.semi-popover-content`,
   `.semi-modal-content`, `.semi-sidesheet-inner`.
2. **The app's own portals**: fixed or absolute children of `<body>` (other
   than the app root), larger than 40×40. The detail page's subtitle picker
   is one of these.
3. **The player's**:
   - `.trim-ui__player--popover` (quality, subtitles, settings), inside a
     fixed layer within `.xgplayer`;
   - the speed list, a Semi Dropdown (`.trim-ui__player--dropdown`, whose list
     is a `.semi-dropdown-menu`).

Menu items are:
- `.semi-dropdown-item, .semi-select-option, .semi-radio, .semi-checkbox`;
- focusables;
- pointer-only elements **with text** (textless icons in a popup, such as the
  subtitle delete buttons, are left out).

Behaviours the code relies on:

- **Opening.** Pickers open on hover, not on click: the detail subtitle
  picker, and all player menus.
  - Browse pages: OK sends synthetic hover events, then a synthetic click if
    nothing opened within 120 ms.
  - Player page: see the real pointer below.
  - Focus alone must never hover a picker. It would open on focus, which is
    wrong on a TV. Only cards get hover on focus.
- **Closing.** Hover popups close only on a "mouse leave".
  - React derives `mouseleave` from `mouseout` **with a `relatedTarget`**.
    `hover(el, false)` sends `mouseout` / `pointerout` / `…leave` with
    `relatedTarget = <body>`, then `mouseover` on `<body>`.
  - `closeMenu` also sends Escape and an outside click.
  - If broken: Back leaves the menu open, and the next Back goes to the
    previous page.
- **Current choice** (`selectedItem`), in order:
  1. ARIA or Semi marks: `[aria-selected=true]`, `[aria-checked=true]`,
     `[class*=-selected]`, `[class*=-active]`;
  2. the item whose text equals, or starts with, the opener's label (speed
     "1.25x", quality "Original" → "Original 4k 15Mbps");
  3. in a list of speeds, 1.0x;
  4. the one item with its own background (the detail subtitle picker);
  5. the first item.
- **Second levels.** Settings → Audio replaces the popover's content in
  place. After a pick, if the same popover is still open **and its text
  changed**, it is a second level: keep it open and move focus into it.
  Otherwise the pick was a choice: close the menu.

### Player (`nav.js` player section; `main.js` cinema:pointer; `cinema.css`)

| hook | used for |
|---|---|
| `.xgplayer` (root), `.xgplayer video` | the player, and parking the pointer over the picture |
| `.xgplayer-controls` | the control bar: first focus is its leftmost unit (play/pause) |
| `.xg-right-grid` (flex **row-reverse**) containing `.xgplayer-volume` | hiding volume, PiP and fullscreen: `.xg-right-grid > .xgplayer-volume, .xg-right-grid > :has(~ .xgplayer-volume)`, i.e. the volume and its DOM predecessors, which render to its right |
| top bar: `button[aria-label=返回]` (back), a title `div[tabindex=0]` with text, the info icon | units; the title is excluded (top 100 px, not a button, has text) |
| the player's keys: Space = play/pause, ←/→ = seek | watching state (we pass ←/→ through and turn OK into a synthetic Space) |
| controls appear on mouse movement and hide after a rest | the controls state keeps them up with a 1 px pointer wiggle every second |
| `<video>` `volume` / `muted` | held at 1 / false (`volumechange` listener) |

**The real pointer.** The speed dropdown ignores synthetic DOM mouse events:
it opens only for input the browser itself delivered. So on the player page,
`nav.js` asks the main process (IPC `cinema:pointer`) to send real mouse
input with `webContents.sendInputEvent`. Coordinates are CSS px times the
page zoom.

- OK: move the pointer onto the control; if no menu opened within 300 ms,
  click it.
- In a menu: the pointer follows the focus. This keeps hover menus open and
  shows the hover highlight.
- Closing a menu, or hiding the controls: park the pointer over the picture.
- Leaving the player: move the pointer out of the window (−20, −20), so no
  hover sticks on the next page.

This pointer is Chromium's own, not the compositor's, so no cursor ever shows.

If the player's menus stop opening on OK, check first whether the
synthetic/real distinction moved (see part 3, probes).

### Volume and on-screen display (`main.js`, `preload.js`)

- The keys `AudioVolumeUp`, `AudioVolumeDown` and `AudioVolumeMute` are taken
  in `before-input-event`, before the page sees them.
- `wpctl` acts on the sink named by `CINEMA_SINK`, resolved to its id with
  `pw-dump`, else the default sink.
- The display is `#cinema-osd`, added to `<html>`; it is not a part of the
  app.
- `preload.js` catches volume keys that reach the page anyway (keys sent over
  DevTools skip `before-input-event`).
- Nothing here depends on the web app.

---

## 3. After a Fygo TV update

### Re-test

As root on the NAS. The test kiosk runs next to the real one: its own
headless weston, its own profile, muted, the live settings ignored.

```sh
sudo tools/test-kiosk.sh start ~/cinema-test-account.json      # {"username","password"}, mode 600
node tools/cdp.js 9333 where                                    # ring on the first unit?
# … the checks below …
sudo tools/test-kiosk.sh stop
```

`tools/cdp.js` sends keys (`key:ArrowDown`) and reports where the ring is
(`where`). It also evaluates JS (`eval:`, `evalf:`), takes screenshots
(`shot:`) and sends real mouse input (`mmove:`, `mclick:`). See its header.

Quirks of the harness:
- **Screenshots of a headless weston can be stale** (`capturePage` shows an
  old frame). Trust `where` and `eval` over the picture.
- **Keys sent over DevTools skip Electron's `before-input-event`.** Volume
  keys then go through the preload fallback, not the main process.
- **The controls hide 8 s after the last key.** Chain the player's steps in
  one `cdp.js` call, or the arrows seek instead.
- **Settings stick to the account.** Subtitle, audio track, speed and quality
  choices made in a test may be remembered; set them back.

Checklist (expected result → the section of part 2 to look at when it fails):

| # | do | expect |
|---|---|---|
| 1 | start with a fresh profile | `state.json` login `ok`; journal "signing in as …" once → Sign-in |
| 2 | restart the test kiosk (same profile) | no "signing in" line → Session cookie |
| 3 | home: `where`, then ↓ ↓ → ↑ | ring on the first content card, then row header, cards; ↑ from the top row stays there, not the sidebar → Browse units |
| 4 | look for `[data-cinema-hidden]` | card/detail "…", and the header's search, avatar and gear hidden → Admin controls |
| 5 | OK on a poster | detail page, ring on Play → Routes, `.semi-button-primary` |
| 6 | → to the subtitle picker, OK, ↑, OK | list opens on the current track; the pick applies (the label changes); ring back on the picker → Popups |
| 7 | the subtitle picker again, Back | closes, ring on the picker; "Add" absent → Popups closing, blocked items |
| 8 | ← to the sidebar, OK on a library, OK on Filter, ↓ → OK | filter panel options reachable and applied → pointer-only units |
| 10 | Back from a detail page | the previous page, ring where it was → focus memory |
| 11 | in the player: → | position +10 s → player keys |
| 12 | ↓, → → → (speed), OK | speed list opens on 1.0x and **stays open** → real pointer |
| 13 | ↑, OK; then again OK, ↓, OK | 1.25x applied, then back to 1.0x → selectedItem by label |
| 14 | quality, OK / CC, OK / settings, OK, ↓ ↓, OK | each opens on its current choice; Settings → Audio lists the tracks in place → second levels |
| 15 | Back ×2 | menu closes, then the controls (ring gone); OK pauses and resumes → player states |
| 16 | eval `v.volume = 0.3; v.muted = true` | back to `1, false` at once; volume/PiP/fullscreen buttons not shown → player volume |
| 17 | ↓, wait 9 s, → | controls gone, → seeks → auto-hide |
| 18 | test-kiosk with a wrong account (a user that doesn't exist) | 3 tries, then `failed` with the page's message → Error text |
| 19 | continue watching card, OK | playback resumes where it stopped → `.continue-card-root` |
| 20 | test-kiosk with `{}` as the account | the `no-account` setup screen with a QR code; write a real account into the file, press OK: signed in → setup screen |
| 21 | fresh profile, then `url:/v/login`: note the background image and logo URLs | if Fygo TV's look changed, copy the new `login-bg.jpg` / `logo.png` into `kiosk/setup/` |

### Finding a moved hook

In `tools/cdp.js eval:` / `evalf:`:

- **Focusables and pointer-only controls of a page.** List `a[href], button,
  [tabindex]:not([tabindex="-1"]), [role]` and every element whose computed
  `cursor` is `pointer` (its parent's isn't), with `getBoundingClientRect()`,
  class and text.
- **Where a popup lives.**
  1. Snapshot the visible elements.
  2. Open the popup, first with synthetic hover on the trigger, then with a
     synthetic click, then with `mmove:` / `mclick:` (real).
  3. Diff the visible elements, and print the new top elements' class and
     ancestor chain.
  Which way opens it tells whether synthetic events still work (§ The real
  pointer).
- **Body portals.** Print `document.body.children` with their computed
  `position`, `z-index` and size.
- **How a popup closes.** Try `mouseout` with a `relatedTarget`, Escape, an
  outside click, and the real pointer moving away.

Then update the selector in the code and its entry in part 2. If a behaviour
in part 1 can no longer be kept, write down why and what it does now.

### Other gotchas met on this machine

- **`CINEMA_KIOSK_ENV`.** `run-kiosk.sh` sources the live
  `/run/fygo-cinema/kiosk.env` (sink, zoom) unless `CINEMA_KIOSK_ENV` points
  elsewhere. `test-kiosk.sh` sets it to `/dev/null`.
- **`pkill -f` from an interactive shell** can match the shell's own command
  line (when the pattern is part of it) and kill it. Kill by PID, or run the
  pattern from a script, as `test-kiosk.sh` does.
- **Root and the build tree.** Root cannot execute files in a user's 0700
  build tree on the FygoOS data volume. Copy binaries out first (cinemad
  tests).
- **Chromium on Wayland as root** needs `--no-sandbox`, and a GL-capable
  compositor for VA-API. The headless weston needs `--renderer=gl`, and must
  run as root for `/dev/dri`.
