#!/bin/bash
# Build fygo-cinema.fpk (FygoOS package) into build/.
#
#   packaging/build-fpk.sh
#
# Needs: fygopack, cargo, and the kiosk's Electron (`npm ci` in kiosk/).
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)   # packaging/
REPO=$(dirname "$SCRIPT_DIR")
BUILD_DIR=$REPO/build
NAME=fygo-cinema

log() { printf '==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

command -v fygopack >/dev/null || die "fygopack not found (https://developer.fygonas.com/docs/cli/fygopack/)"
command -v cargo >/dev/null || die "cargo not found"
[ -x "$REPO/kiosk/node_modules/electron/dist/electron" ] \
    || die "kiosk/node_modules/electron missing — run 'npm ci' in kiosk/ first"

dst=$BUILD_DIR/fpk/$NAME
rm -rf "$dst"
mkdir -p "$BUILD_DIR/fpk"
cp -r "$SCRIPT_DIR/fpk/$NAME" "$dst"
app=$dst/app
mkdir -p "$app/bin" "$app/kiosk/node_modules" "$app/web"

log "building cinemad"
(cd "$REPO/cinemad" && cargo build --release --quiet) || die "cinemad build failed"
cp "$REPO/cinemad/target/release/cinemad" "$app/bin/"

# The kiosk: our Electron app and its own Electron runtime.
cp "$REPO/kiosk/main.js" "$REPO/kiosk/preload.js" "$REPO/kiosk/run-kiosk.sh" "$REPO/kiosk/package.json" "$app/kiosk/"
cp -r "$REPO/kiosk/inject" "$REPO/kiosk/setup" "$app/kiosk/"
cp -a "$REPO/kiosk/node_modules/electron" "$app/kiosk/node_modules/electron"

# The admin page.
cp "$REPO/web/"*.html "$REPO/web/"*.js "$REPO/web/"*.css "$app/web/"

# Plain permissions (the source tree may carry odd ones, e.g. from ACLs).
find "$dst" -type d -exec chmod 755 {} +
find "$dst" -type f -exec chmod 644 {} +
chmod 755 "$dst"/cmd/* "$app/bin/"* "$app/kiosk/run-kiosk.sh"
# Electron's own executables (the runtime, its helpers)
find "$app/kiosk/node_modules/electron/dist" -maxdepth 1 -type f \( -name electron -o -name chrome_crashpad_handler -o -name chrome-sandbox -o -name '*.so' -o -name '*.so.*' \) -exec chmod 755 {} +

log "packing $NAME $(sed -n 's/^version="\(.*\)"/\1/p' "$dst/manifest")"
(cd "$BUILD_DIR" && fygopack build --directory "$dst" >/dev/null) || die "fygopack build failed"
ls -l "$BUILD_DIR/$NAME.fpk"
