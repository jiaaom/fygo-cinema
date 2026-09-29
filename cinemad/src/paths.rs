//! Where things live. The defaults are the installed layout; the environment
//! overrides exist so the daemon can be run unprivileged in development.

use std::path::PathBuf;

fn env_or(key: &str, default: &str) -> PathBuf {
    PathBuf::from(std::env::var(key).unwrap_or_else(|_| default.to_string()))
}

/// Settings, the sealed account, the kiosk's Chromium profile.
pub fn state_dir() -> PathBuf {
    env_or("CINEMA_STATE_DIR", "/var/lib/fygo-cinema")
}

/// Runtime files shared with the kiosk: kiosk.env (ours), state.json (its).
pub fn run_dir() -> PathBuf {
    env_or("CINEMA_RUN_DIR", "/run/fygo-cinema")
}

/// appliance-compositor's configuration (docs/CONTRACT.md there).
pub fn compositor_etc() -> PathBuf {
    env_or("CINEMA_COMPOSITOR_ETC", "/etc/appliance-compositor")
}

pub fn drm_dir() -> PathBuf {
    env_or("CINEMA_DRM_DIR", "/sys/class/drm")
}

/// Our app-id (Wayland) and clients.d fragment name.
pub const APP_ID: &str = "fygo-cinema";
pub const KIOSK_UNIT: &str = "fygo-cinema-kiosk.service";
pub const COMPOSITOR_UNIT: &str = "appliance-compositor.service";
/// The compositor's clients (and PipeWire) run as root in this runtime dir.
pub const CLIENT_RUNTIME_DIR: &str = "/run/user/0";
