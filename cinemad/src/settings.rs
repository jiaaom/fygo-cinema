//! The admin page's choices, in `settings.json` of the state dir.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct Settings {
    /// Off: the TV app is not started, whatever else is set up.
    pub enabled: bool,
    /// "auto" (the connected TV no other app claims) or a connector name.
    pub screen: String,
    /// "auto" (the TV's own speakers), "default" (the system's default
    /// output) or a PipeWire sink's node.name.
    pub audio: String,
    /// "auto" (from the TV's resolution and size, screens::auto_zoom) or a
    /// page zoom in percent, e.g. "125".
    pub zoom: String,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { enabled: true, screen: "auto".into(), audio: "auto".into(), zoom: "auto".into() }
    }
}

fn file() -> std::path::PathBuf {
    crate::paths::state_dir().join("settings.json")
}

pub fn load() -> Settings {
    std::fs::read(file()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn save(s: &Settings) -> std::io::Result<()> {
    let dir = crate::paths::state_dir();
    std::fs::create_dir_all(&dir)?;
    let tmp = dir.join("settings.json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(s).unwrap_or_default())?;
    std::fs::rename(tmp, file())
}

impl Settings {
    /// The page zoom for a screen: the set percentage, or the automatic one.
    pub fn zoom_for(&self, screen: Option<&crate::screens::Screen>) -> f64 {
        match self.zoom.parse::<f64>() {
            Ok(p) if (25.0..=400.0).contains(&p) => p / 100.0,
            _ => screen.map(crate::screens::auto_zoom).unwrap_or(1.0),
        }
    }
}
