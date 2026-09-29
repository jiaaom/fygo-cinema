# Fygo Cinema

**English** · [中文](README.zh-CN.md)

Fygo TV on the TV. The NAS's own Fygo TV web app runs fullscreen on
a TV plugged into the NAS, driven by a remote, with hardware video decoding.

## Screenshots

Captured from the kiosk at 1920×1080. The white ring is the focus the remote
moves.

| | |
|---|---|
| ![Home page, focus on a "continue watching" card](assets/home.jpg) | ![Detail page with the subtitle picker open on the current track](assets/detail-subtitles.jpg) |
| **Home.** Every card, row header and sidebar entry is reachable with the arrow keys. | **Detail page.** OK opens a picker on its current choice; Back closes it. |
| ![Player with the controls up and the subtitle menu open](assets/player-subtitles.jpg) | ![Player with the volume display](assets/player-volume.jpg) |
| **Player.** ↑/↓ bring up the controls: speed, quality, subtitles, settings. | **Volume.** The remote's volume keys set the TV's volume. |
| ![Setup screen with steps and a QR code](assets/setup.jpg) | ![Admin page in the fnOS desktop](assets/admin.png) |
| **Setup screen.** Shown instead of a black TV when there is no account yet, the sign-in fails or the server can't be reached. | **Admin page.** In the fnOS desktop, for administrators only. |

## Features

- **Remote navigation** on every page: arrows, OK, Back and Home, with a
  focus ring. In the player, the controls and their menus work from the
  remote too.
- **Hardware video decoding**, up to 4K HEVC 10-bit HDR: about 17 % CPU on a
  Core Ultra 5 125H.
- **Signs in by itself** with the account entered on the admin page, and
  stays signed in across restarts.
- **Follows the TV:** it starts when the TV is plugged in and stops when it
  is unplugged. It plays through the TV's speakers, and the page is sized for
  the screen.
- **Nothing to break:** admin and account controls are hidden from the
  remote. When something is missing, the TV says what to do instead of
  staying black (it is black only when the app is switched off).

## Requirements

- FygoOS / fnOS 1.2 or newer, with an Intel GPU.
- **Fygo TV** (`trim.media`) and **[Appliance Compositor](https://github.com/jiaaom/appliance-compositor)**. App Center
  installs both as dependencies; the compositor's `.fpk` is also on its
  [releases page](https://github.com/jiaaom/appliance-compositor/releases).
- A TV (or monitor) on the NAS's HDMI or DisplayPort output, and a remote or
  keyboard for it (Bluetooth or USB).

Fygo Cinema runs next to T6 Front Panel, which is optional: both are windows
of [appliance-compositor](https://github.com/jiaaom/appliance-compositor), the shared display and
sound server.

## Install

1. In App Center, install `fygo-cinema.fpk` (manual installation).
2. Open **Fygo Cinema** on the fnOS desktop and enter the Fygo TV account the
   TV should sign in with.
3. Plug in the TV. Fygo TV appears on it.

Without an account, the TV shows these same steps, with a QR code of the
NAS's address.

## How it works

![How Fygo Cinema fits together: the admin page talks to cinemad; cinemad places, feeds and supervises the kiosk; the kiosk shows the unchanged Fygo TV web app; both go through appliance-compositor to the TV](assets/architecture.svg)

- The **kiosk** (Electron) shows the unchanged Fygo TV web app and adds what
  a TV needs: remote navigation, sign-in, volume, the setup screen.
- **cinemad** (Rust) serves the admin page. It chooses the TV screen and
  sound output, and starts and stops the kiosk with the TV.

Details: [docs/architecture.md](docs/architecture.md).

## Build

```sh
(cd kiosk && npm ci)          # the kiosk's own Electron
packaging/build-fpk.sh        # → build/fygo-cinema.fpk
```

Needs [`fygopack`](https://developer.fygonas.com/docs/cli/fygopack/) and
cargo.

## Documentation

- [Architecture](docs/architecture.md): the parts, what each does, files on
  the NAS.
- [Web app integration](docs/web-app-integration.md): the remote behaviour
  on every screen, what it depends on in Fygo TV, and the re-test checklist
  for Fygo TV updates.
- [Development](docs/development.md): repository layout, running cinemad and
  a test kiosk, deploying by hand.
- [History](docs/history.md): the abandoned Android route, and why the web
  app.

## License

MIT (see `LICENSE`). The setup screen uses Fygo TV's login background and
logo, and [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)
(MIT, Kazuhiko Arase).
