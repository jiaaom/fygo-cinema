#!/bin/bash
# A test kiosk next to the real one: its own headless weston (GL, as root:
# it needs /dev/dri), its own profile, muted, DevTools on a port, and none of
# the live kiosk's settings (CINEMA_KIOSK_ENV=/dev/null).
#
#   sudo tools/test-kiosk.sh start <account.json> [WIDTHxHEIGHT] [zoom]
#   sudo tools/test-kiosk.sh stop
#
# account.json: {"username": "...", "password": "..."} (mode 600). Then drive
# it with tools/cdp.js 9333 ...; logs and the kiosk's state in $TEST_DIR.
set -euo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
KIOSK=${KIOSK_DIR:-$(dirname "$HERE")/kiosk}
TEST_DIR=${TEST_DIR:-/tmp/fygo-cinema-test}
SOCKET=cinema-test
PORT=${CINEMA_DEBUG_PORT:-9333}
export XDG_RUNTIME_DIR=/run/user/0

stop() {
    pkill -f "^$KIOSK/node_modules/electron/dist/electron --no-sandbox" 2>/dev/null || true
    pkill -f "^weston --backend=headless.*--socket=$SOCKET" 2>/dev/null || true
}

case "${1:-}" in
    start)
        account=${2:?usage: test-kiosk.sh start <account.json> [WIDTHxHEIGHT] [zoom]}
        size=${3:-1920x1080}
        stop; sleep 1
        mkdir -p "$TEST_DIR"
        nohup weston --backend=headless --renderer=gl --width="${size%x*}" --height="${size#*x}" \
            --socket=$SOCKET --idle-time=0 > "$TEST_DIR/weston.log" 2>&1 &
        sleep 2
        cd "$KIOSK"
        WAYLAND_DISPLAY=$SOCKET CINEMA_KIOSK_ENV=/dev/null CINEMA_MUTE=1 CINEMA_ZOOM="${4:-1}" \
            CINEMA_DEBUG_PORT=$PORT CINEMA_ACCOUNT_FILE="$(realpath "$account")" \
            CINEMA_DATA_DIR="$TEST_DIR/profile" CINEMA_STATE="$TEST_DIR/state.json" \
            nohup ./run-kiosk.sh > "$TEST_DIR/kiosk.log" 2>&1 &
        echo "test kiosk starting: DevTools on 127.0.0.1:$PORT, state in $TEST_DIR/state.json"
        ;;
    stop) stop ;;
    *) echo "usage: test-kiosk.sh start <account.json> [WIDTHxHEIGHT] [zoom] | stop" >&2; exit 2 ;;
esac
