# Architecture

How the parts of Fygo Cinema work and fit together. For the overview
diagram, see the [README](../README.md#how-it-works). For how the remote
navigation depends on the Fygo TV web app, and how to re-check it after an
update, see [web-app-integration.md](web-app-integration.md).

## Parts

| part | what it is |
|---|---|
| `kiosk/` | an Electron app that shows the stock Fygo TV web app fullscreen on the TV; the server side is untouched |
| `cinemad/` | the Rust backend: serves the admin page and supervises the kiosk |
| `web/` | the admin page (a window on the fnOS desktop, administrators only) |
| `packaging/` | builds the FygoOS package, `fygo-cinema.fpk` |

Both the kiosk and the T6 Front Panel are windows of
[appliance-compositor](https://github.com/jiaaom/appliance-compositor), the shared display and
sound server (weston with appliance-shell, and PipeWire). Fygo Cinema uses
only its [runtime contract](https://github.com/jiaaom/appliance-compositor/blob/main/docs/CONTRACT.md): `client.env`, the compositor unit, and
`/etc/appliance-compositor/clients.d/`.

## Kiosk (`kiosk/`)

### `main.js`: the main process

- **Video:** VA-API hardware decoding through fnOS's own libva (set up in
  `run-kiosk.sh`), and GPU compositing.
- **Signing in:** it fills in the page's own login form with the stored
  account.
  - At most 3 tries per start; the error goes to the admin page.
  - The session survives restarts: the page's session cookie gets a 30-day
    expiry.
  - When the stored account changes to another user, the old session is
    dropped.
- **Page size:** Chromium zoom from `CINEMA_ZOOM`.
- **Locked down:** the window stays off admin pages (`/v/settings`, `/init`,
  `/welcome`) and off other sites.
- **Volume keys:** handled before the page sees them. `wpctl` changes the
  TV's output, and an on-screen display shows the level.
- **Real mouse input** for the player's menus (IPC `cinema:pointer`), since
  its speed dropdown ignores synthetic events.
- **The setup screen:** shown when the web app can't be (see below).

### `inject/nav.js`: remote navigation

It runs in the page, loaded by `preload.js`, and gives a web app built for a
mouse a TV-style remote navigation.

- **Moving:** cards, sidebar entries, buttons and pickers are units. The
  arrows move between them spatially, with a focus ring. Left/right stay in
  the row; up/down go to the nearest unit ahead.
- **Keys:**
  - OK clicks.
  - Back closes a popup; otherwise it goes back, to where you were.
  - Home goes to the start page.
- **Player page:**
  - Left/right seek and OK plays or pauses, until up/down brings up the
    controls.
  - With the controls up, the arrows move over the control bar and its
    menus (speed, quality, subtitles, settings → audio track).
  - Back closes a menu, then the controls, then the player. The controls
    also hide after 8 s without a key.
  - The player's own volume is held at 100 % and hidden; so are
    picture-in-picture and fullscreen.
- **Hidden:** admin and account controls: the "…" menus, the header's
  search, account and settings buttons, and adding or deleting subtitles.

### Other files

- **`inject/cinema.css`:** the focus ring, the volume display, and the
  hidden controls.
- **`setup/`:** our own screen for when the web app can't be shown: no
  account yet, the sign-in refused, or the server unreachable.
  - It shows the steps to fix it and a QR code of the NAS's address, so the
    TV is never just black.
  - It uses Fygo TV's login background and logo (copied from its web app) and
    [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)
    (MIT, Kazuhiko Arase).
  - The switch-off from the admin page is the one case where the TV stays
    black on purpose.

## cinemad (`cinemad/`)

It serves the admin page and its API on the FygoOS gateway socket
(administrators only). Every couple of seconds, and right after a change on
the admin page, it brings the machine to the chosen state.

- **Screen.**
  - Auto picks the connector that is connected, has an EDID, is not built in,
    and is not claimed by another client of the compositor. Built in means an
    eDP, LVDS or DSI connector, or a known panel bridge such as the T6's
    IT6616.
  - The choice becomes our window rule in
    `/etc/appliance-compositor/clients.d/fygo-cinema.ini`, read when the
    compositor starts. A change is also sent to the running compositor
    (`set-output` on appliance-shell's control socket), which moves the
    window without a restart. Only a compositor older than 1.1 is restarted
    instead.
  - `output-fallback=none`: while the TV is unplugged the window stays
    hidden, never on the front panel.
  - The rule also sets `focus-priority=10`: the remote's keys stay on the TV
    while the kiosk runs, even when the front panel's screensaver (a higher
    layer, on another screen) is up. After the TV is unplugged, the keys go
    back to the panel.
- **Page size.**
  - Auto: 200 % above 1080 lines, 150 % at 1080 lines and fewer. The admin
    page can override it (50–300 %).
  - It is Chromium zoom, not a compositor output scale, so it can be
    fractional, and a change restarts only the kiosk.
- **Sound.**
  - Auto is the PipeWire sink whose `node.nick` is the TV's EDID name, i.e.
    the TV's HDMI audio. The admin page can pick the system default or any
    sink instead.
  - The choice goes to the kiosk in `/run/fygo-cinema/kiosk.env`, as
    `PULSE_SINK` for Chromium and the volume keys' target.
- **Account.**
  - Sealed with `systemd-creds --with-key=host`. The kiosk unit reads it
    with `LoadCredentialEncrypted=`, so the password is decrypted only into
    that service's private credentials directory.
  - Without an account, cinemad seals an empty placeholder, and the kiosk
    shows its setup screen.
- **Kiosk.** It runs while the app is on and the TV is plugged in: unplugging
  the TV stops it, plugging it in starts it. It also runs without an account.

## Admin page (`web/`)

It follows the fnOS app conventions: the topbar-and-panels layout, light and
dark tokens, and the TrimApp SDK (`web-app.js`, copied verbatim) for theme and
language.

It covers:
- on/off;
- the account;
- the TV screen and page size;
- the sound output and volume;
- restarting the TV app.

## Package (`packaging/`)

- `build-fpk.sh` builds `build/fygo-cinema.fpk`, including the kiosk's own
  Electron runtime.
- Dependencies: `appliance-compositor` and `trim.media` (Fygo TV).
- The lifecycle scripts (`packaging/fpk/fygo-cinema/cmd/`) generate two
  units:
  - `fygo-cinema.service`: cinemad, enabled at boot;
  - `fygo-cinema-kiosk.service`: started and stopped by cinemad, and
    `PartOf` the compositor, so it restarts with it.
- Uninstalling removes the units and our clients.d fragment. The uninstall
  wizard can also remove the settings and the stored account.

## Files on the NAS

| path | what |
|---|---|
| `/var/lib/fygo-cinema/settings.json` | the admin page's choices |
| `/var/lib/fygo-cinema/account.cred`, `account.json` | the sealed account, and who it is |
| `/var/lib/fygo-cinema/kiosk/` | the kiosk's Chromium profile (the web app's session, player preferences; no HTTP disk cache, see `main.js`) |
| `/run/fygo-cinema/kiosk.env` | sound output and page zoom for the kiosk (written by cinemad) |
| `/run/fygo-cinema/state.json` | the kiosk's sign-in state and page (read by cinemad) |
| `/etc/appliance-compositor/clients.d/fygo-cinema.ini` | our window rule (written by cinemad) |
