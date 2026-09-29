# History

## The Android route (abandoned)

The first plan was to run Fygo TV's own Android TV app on the NAS under
[Waydroid](https://waydro.id): Android in an LXC container, shown as a Wayland
window on the TV.

It got surprisingly far. On a UnifyDrive T6, the domestic 飞牛TV app played 4K
HEVC 10-bit Dolby Vision and HDR10 at 24 fps with no dropped frames and about
8 % CPU.

It was abandoned on 2026-09-28, for two reasons:
- **Too hard to control.** It needed a whole Android system to be set up,
  networked and kept alive next to fnOS.
- **Incompatible with the international app.** The international Fygo TV
  server does not serve the domestic TV app, and the international Android
  app is phone-only and licensed through Google Play.

Everything that was learned is kept in [research/waydroid/](../research/waydroid/).
The APKs themselves are not committed.

## The web route

Fygo TV ships a web app (`/v`) that plays the same 4K HEVC 10-bit Dolby Vision
file at 24 fps with no dropped frames, at about 17 % CPU. This needs Chromium
with VA-API through fnOS's own libva.

Two things the web app lacks:
- **Remote navigation** on its browse pages, which Fygo Cinema adds.
- **A TV way to sign in**, which Fygo Cinema covers by filling in the page's
  own login form with a stored account.

The evaluation is in
[notes/2026-09-28-web-route.md](../notes/2026-09-28-web-route.md).

## Releases

- **1.0.0** (2026-09-29): the first release.
