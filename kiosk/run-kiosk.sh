#!/bin/bash
# Launch the Fygo Cinema kiosk: a window of appliance-compositor (see its
# docs/CONTRACT.md), placed on the TV by our clients.d fragment, which cinemad
# writes (app-id fygo-cinema).
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ELECTRON="$APP_DIR/node_modules/electron/dist/electron"

# The compositor's client environment; the unit loads it with EnvironmentFile=,
# this covers manual starts.
CLIENT_ENV=/usr/local/lib/appliance-compositor/client.env
if [ -z "${WAYLAND_DISPLAY:-}" ] && [ -f "$CLIENT_ENV" ]; then
  set -a; . "$CLIENT_ENV"; set +a
fi
: "${XDG_RUNTIME_DIR:=/run/user/0}"
: "${WAYLAND_DISPLAY:=wayland-appliance}"
export XDG_RUNTIME_DIR WAYLAND_DISPLAY

# Where the sound goes (cinemad's choice of sink): Chromium plays through the
# PulseAudio protocol, which honours PULSE_SINK.
# (CINEMA_KIOSK_ENV: another file, or /dev/null, for test runs next to the real kiosk)
KIOSK_ENV=${CINEMA_KIOSK_ENV:-/run/fygo-cinema/kiosk.env}
if [ -f "$KIOSK_ENV" ]; then
  set -a; . "$KIOSK_ENV"; set +a
fi
if [ -n "${CINEMA_SINK:-}" ]; then export PULSE_SINK="$CINEMA_SINK"; fi

# Hardware video decoding: fnOS ships its own current libva + Intel iHD driver
# for its media server (the system's bookworm libva is too old for Chromium).
# Use them when present; without them Chromium decodes in software.
MEDIASRV=/usr/trim/lib/mediasrv/lib
if [ -f "$MEDIASRV/dri/iHD_drv_video.so" ]; then
  export LD_LIBRARY_PATH="$MEDIASRV${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  export LIBVA_DRIVERS_PATH="$MEDIASRV/dri"
  export LIBVA_DRIVER_NAME=iHD
fi

for _ in $(seq 1 40); do
  [ -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ] && break
  sleep 0.25
done

# --no-sandbox: runs as root on the appliance; Chromium's sandbox refuses uid 0.
# --ozone-platform=wayland must be on the real command line (read before main.js).
exec "$ELECTRON" \
  --no-sandbox \
  --ozone-platform=wayland \
  "$APP_DIR"
