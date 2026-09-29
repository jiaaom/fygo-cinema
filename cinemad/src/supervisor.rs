//! Keeps the machine in the state the admin page asked for, every couple of
//! seconds and right after any change:
//!
//!   - the TV: the chosen (or auto-detected) screen gets our window rule in
//!     /etc/appliance-compositor/clients.d/fygo-cinema.ini, with 2x scaling on
//!     4K so the web app is laid out for 1080p. The compositor reads fragments
//!     at start, so a changed fragment means restarting it (the other apps'
//!     windows come back with it: their units are PartOf= it).
//!   - the sound: the chosen (or the TV's own) output goes to the kiosk in
//!     /run/fygo-cinema/kiosk.env; a change restarts the kiosk.
//!   - the kiosk runs while the app is on, an account is stored and the TV is
//!     plugged in; unplugging the TV stops it, plugging it in starts it.

use crate::{account, audio, paths, screens, settings};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::process::Command;
use tokio::sync::{Notify, RwLock};

#[derive(Serialize, Clone, Default)]
pub struct Status {
    pub settings: settings::Settings,
    pub account: Option<account::Meta>,
    pub screens: Vec<screens::Screen>,
    /// The screen in use (setting resolved), connected or not.
    pub screen: Option<screens::Screen>,
    pub sinks: Vec<audio::Sink>,
    /// The output in use; `None` = the system default.
    pub sink: Option<audio::Sink>,
    pub level: audio::Level,
    /// Page zoom in use, and what auto would choose.
    pub zoom: f64,
    pub zoom_auto: f64,
    pub kiosk_active: bool,
    pub compositor_active: bool,
    /// Why the kiosk is not running, when it should not be.
    pub idle_reason: Option<String>,
    /// The kiosk's own report (sign-in state, page): /run/fygo-cinema/state.json.
    pub kiosk_state: Option<serde_json::Value>,
}

pub struct Supervisor {
    pub status: RwLock<Status>,
    kick: Notify,
    restart_kiosk: AtomicBool,
}

impl Supervisor {
    pub fn new() -> Arc<Self> {
        Arc::new(Supervisor { status: RwLock::new(Status::default()), kick: Notify::new(), restart_kiosk: AtomicBool::new(false) })
    }

    /// Re-check now (after a settings change).
    pub fn kick(&self) {
        self.kick.notify_one();
    }

    /// The kiosk must restart to pick up a change (the account).
    pub fn restart_kiosk(&self) {
        self.restart_kiosk.store(true, Ordering::SeqCst);
        self.kick();
    }

    pub fn start(self: &Arc<Self>) {
        let me = self.clone();
        tokio::spawn(async move {
            let mut last_start: Option<Instant> = None;
            loop {
                me.tick(&mut last_start).await;
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(2)) => {}
                    _ = me.kick.notified() => {}
                }
            }
        });
    }

    async fn tick(&self, last_start: &mut Option<Instant>) {
        let settings = settings::load();
        let account = account::meta();
        let screens = screens::scan();
        let screen = screens::resolve(&settings.screen, &screens).cloned();
        let compositor_active = is_active(paths::COMPOSITOR_UNIT).await;
        let sinks = audio::sinks().await;
        let sink = audio::resolve(&settings.audio, &sinks, screen.as_ref().and_then(|s| s.monitor.as_deref())).cloned();

        // window rule for the TV (kept when it is unplugged: no restart churn)
        let mut compositor_restarted = false;
        if let Some(s) = &screen {
            if write_if_changed(&fragment_path(), &fragment(s)) {
                eprintln!("cinemad: TV screen is now {} ({})", s.name, s.monitor.as_deref().unwrap_or("no name"));
                if compositor_active {
                    compositor_restarted = systemctl(&["restart", paths::COMPOSITOR_UNIT]).await;
                }
            }
        }

        let zoom = settings.zoom_for(screen.as_ref());
        let zoom_auto = screen.as_ref().map(screens::auto_zoom).unwrap_or(1.0);
        let env = format!(
            "# written by cinemad\nCINEMA_SINK={}\nCINEMA_ZOOM={zoom}\n",
            sink.as_ref().map(|s| s.name.as_str()).unwrap_or("")
        );
        let env_changed = write_if_changed(&paths::run_dir().join("kiosk.env"), &env);

        let idle_reason = if !settings.enabled {
            Some("off")
        } else if screen.is_none() {
            Some("no-screen")
        } else if !screen.as_ref().is_some_and(|s| s.connected) {
            Some("disconnected")
        } else if !compositor_active {
            Some("no-compositor")
        } else {
            None
        };
        let want = idle_reason.is_none();
        let mut kiosk_active = is_active(paths::KIOSK_UNIT).await;
        let restart = self.restart_kiosk.swap(false, Ordering::SeqCst) || env_changed;
        if want && account.is_none() {
            account::ensure_placeholder();
        }
        if want && !kiosk_active {
            // systemd restarts a crashed kiosk itself; this is for plug-in,
            // switch-on and after it gave up
            if last_start.is_none_or(|t| t.elapsed() > Duration::from_secs(15)) {
                *last_start = Some(Instant::now());
                let _ = systemctl(&["reset-failed", paths::KIOSK_UNIT]).await;
                kiosk_active = systemctl(&["start", paths::KIOSK_UNIT]).await;
            }
        } else if !want && kiosk_active {
            systemctl(&["stop", paths::KIOSK_UNIT]).await;
            kiosk_active = false;
        } else if want && restart && !compositor_restarted {
            systemctl(&["restart", paths::KIOSK_UNIT]).await;
        }

        let level = audio::level(sink.as_ref()).await;
        let kiosk_state = std::fs::read(paths::run_dir().join("state.json")).ok().and_then(|b| serde_json::from_slice(&b).ok());
        *self.status.write().await = Status {
            settings,
            account,
            screens,
            screen,
            sinks,
            sink,
            level,
            zoom,
            zoom_auto,
            kiosk_active,
            compositor_active,
            idle_reason: idle_reason.map(str::to_string),
            kiosk_state,
        };
    }
}

pub fn fragment_path() -> std::path::PathBuf {
    paths::compositor_etc().join("clients.d").join(format!("{}.ini", paths::APP_ID))
}

/// Our clients.d fragment for a TV screen: the window rule only. (No output
/// scale: the page size is the kiosk's zoom, see CINEMA_ZOOM.)
pub fn fragment(s: &screens::Screen) -> String {
    format!(
        "# Fygo Cinema (written by cinemad; the screen is chosen on its admin page):\n\
         # the TV kiosk's window on the TV.\n\
         [appliance-rule]\napp-id={app}\nlayer=0\noutput={name}\n",
        name = s.name,
        app = paths::APP_ID,
    )
}

/// True when the file's content changed (and was written).
fn write_if_changed(path: &std::path::Path, content: &str) -> bool {
    if std::fs::read_to_string(path).ok().as_deref() == Some(content) {
        return false;
    }
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let tmp = path.with_extension("tmp");
    match std::fs::write(&tmp, content).and_then(|_| std::fs::rename(&tmp, path)) {
        Ok(()) => true,
        Err(e) => {
            eprintln!("cinemad: cannot write {}: {e}", path.display());
            false
        }
    }
}

fn dry_run() -> bool {
    std::env::var_os("CINEMA_DRY_RUN").is_some()
}

async fn is_active(unit: &str) -> bool {
    Command::new("systemctl").args(["is-active", "--quiet", unit]).status().await.map(|s| s.success()).unwrap_or(false)
}

async fn systemctl(args: &[&str]) -> bool {
    if dry_run() {
        eprintln!("cinemad: (dry run) systemctl {}", args.join(" "));
        return false;
    }
    match Command::new("systemctl").args(args).output().await {
        Ok(o) if o.status.success() => true,
        Ok(o) => {
            eprintln!("cinemad: systemctl {}: {}", args.join(" "), String::from_utf8_lossy(&o.stderr).trim());
            false
        }
        Err(e) => {
            eprintln!("cinemad: systemctl: {e}");
            false
        }
    }
}
