# Development

## Repository layout

```
kiosk/        the Electron kiosk: main.js, preload.js, run-kiosk.sh,
              inject/ (nav.js, cinema.css), setup/ (the setup screen)
cinemad/      the Rust backend
web/          the admin page
packaging/    build-fpk.sh, the FygoOS package skeleton (fpk/), icon generator
tools/        test-kiosk.sh and cdp.js: a scriptable test kiosk
docs/         architecture, the web app integration, development, history
assets/       README images
notes/        dated evaluation notes
research/     the abandoned Waydroid route, kept for reference
```

## Build

```sh
(cd kiosk && npm ci)          # the kiosk's own Electron
packaging/build-fpk.sh        # → build/fygo-cinema.fpk
```

Needs [`fygopack`](https://developer.fygonas.com/docs/cli/fygopack/) and
cargo. `cargo test` in `cinemad/` runs the unit tests: EDID parsing, page
size, sound output choice.

## Deploying a change by hand

App Center's command line can't upgrade an installed app: `install-fpk` of a
newer version only answers "is installed". There are two ways:

- **Test builds:** copy the new files into
  `/usr/local/apps/@appcenter/fygo-cinema/`, then restart the units:
  `systemctl restart fygo-cinema` for cinemad and
  `systemctl restart fygo-cinema-kiosk` for the kiosk.
- **Releases:** a manual install of the new `.fpk` from the App Center web
  UI. It upgrades the app and updates the version App Center shows.

## Running cinemad in development

```sh
CINEMA_DRY_RUN=1 cinemad --listen 127.0.0.1:8977 --web web
```

- `--listen` serves the page and API over TCP instead of the gateway socket.
  Requests then need `X-Trim-Username` and `X-Trim-Isadmin: true` set by
  hand.
- `CINEMA_DRY_RUN=1` logs systemctl calls instead of making them.
- `CINEMA_STATE_DIR`, `CINEMA_RUN_DIR`, `CINEMA_COMPOSITOR_ETC` and
  `CINEMA_DRM_DIR` point it at test directories, for example a fake
  `/sys/class/drm` with a "TV" (a connector with `status`, `modes` and an
  `edid`).
- Root can't execute files in a user's 0700 build tree on the FygoOS data
  volume. Copy the binary out before running it as root (which is needed for
  `systemd-creds`).

## A test kiosk

```sh
sudo tools/test-kiosk.sh start <account.json> [WIDTHxHEIGHT] [zoom]
node tools/cdp.js 9333 where key:ArrowDown where key:Enter wait:2500 where
sudo tools/test-kiosk.sh stop
```

- `test-kiosk.sh` runs a kiosk next to the real one:
  - its own headless weston (GL, as root for `/dev/dri`);
  - its own profile, in `$TEST_DIR` (default `/tmp/fygo-cinema-test`);
  - muted;
  - the DevTools protocol on port 9333;
  - none of the live kiosk's settings (`CINEMA_KIOSK_ENV=/dev/null`).
- `account.json` is `{"username": "...", "password": "..."}` (mode 600). With
  `{}` the kiosk shows the setup screen.
- `cdp.js` sends keys and reports where the focus ring is. It also evaluates
  JS, takes screenshots and sends real mouse input; see its header.

The kiosk's own environment is listed in the header of `kiosk/main.js`:
`CINEMA_URL`, `CINEMA_ACCOUNT_FILE`, `CINEMA_DEBUG_PORT`, `CINEMA_MUTE`,
`CINEMA_ZOOM`, `CINEMA_LANG`, `WINDOWED`, and others.

After a Fygo TV update, run the checklist in
[web-app-integration.md](web-app-integration.md#3-after-a-fygo-tv-update).
