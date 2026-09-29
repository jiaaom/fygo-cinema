//! The machine's display connectors (DRM, sysfs), what is plugged into them
//! (EDID), and which ones other apps of appliance-compositor have claimed
//! (their clients.d fragments place windows on named outputs).
//!
//! Connector names are the compositor's output names (weston uses the DRM
//! connector name: HDMI-A-2, DP-1, eDP-1, ...).

use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Serialize, Clone, Debug)]
pub struct Screen {
    /// Connector / output name, e.g. "HDMI-A-2".
    pub name: String,
    pub connected: bool,
    /// The monitor's name from its EDID ("LG TV SSCR2", "SONY TV").
    pub monitor: Option<String>,
    /// PNP manufacturer id from the EDID ("GSM", "SNY").
    pub vendor: Option<String>,
    /// Preferred mode, e.g. "3840x2160".
    pub mode: Option<String>,
    /// Physical size of the picture from the EDID, in mm (None: not given,
    /// as with projectors and some TVs).
    pub size_mm: Option<(u32, u32)>,
    /// A built-in screen (eDP, LVDS, DSI connector, or a known panel
    /// bridge): never a TV in auto mode.
    pub internal: bool,
    /// Another app whose windows are placed on this output.
    pub claimed_by: Option<String>,
}

impl Screen {
    /// (width, height) of the preferred mode.
    pub fn pixels(&self) -> Option<(u32, u32)> {
        let (w, h) = self.mode.as_deref()?.split_once('x')?;
        // "1920x1080i" and the like
        let h: String = h.chars().take_while(|c| c.is_ascii_digit()).collect();
        Some((w.parse().ok()?, h.parse().ok()?))
    }

    /// What auto mode would take: something with an EDID (a TV always has
    /// one; bridged built-in panels often have none), not a built-in
    /// connector, not another app's screen.
    pub fn is_tv_candidate(&self) -> bool {
        self.connected && self.monitor.is_some() && !self.internal && self.claimed_by.is_none()
    }
}

/// EDID names of display bridges that drive built-in screens over an HDMI
/// or DP connector (so the connector type doesn't tell): the ZSpace T6 /
/// UnifyDrive UP6 front panel is an IT6616 on HDMI-A-1.
const BRIDGES: &[&str] = &["IT6616"];

pub fn scan() -> Vec<Screen> {
    let claims = claims();
    let mut out: BTreeMap<String, Screen> = BTreeMap::new();
    let Ok(dir) = std::fs::read_dir(crate::paths::drm_dir()) else { return vec![] };
    for e in dir.flatten() {
        let file = e.file_name().to_string_lossy().to_string();
        // card<N>-<connector>
        let Some((card, name)) = file.split_once('-') else { continue };
        if !card.starts_with("card") || name.starts_with("Writeback") {
            continue;
        }
        let p = e.path();
        let connected = std::fs::read_to_string(p.join("status")).map(|s| s.trim() == "connected").unwrap_or(false);
        let edid = std::fs::read(p.join("edid")).unwrap_or_default();
        let Edid { monitor, vendor, size_mm } = parse_edid(&edid);
        let mode = std::fs::read_to_string(p.join("modes")).ok().and_then(|m| m.lines().next().map(str::to_string));
        let internal = ["eDP", "LVDS", "DSI"].iter().any(|t| name.starts_with(t))
            || monitor.as_deref().is_some_and(|m| BRIDGES.contains(&m));
        let s = Screen {
            name: name.to_string(),
            connected,
            monitor,
            vendor,
            mode: if connected { mode } else { None },
            size_mm: if connected { size_mm } else { None },
            internal,
            claimed_by: claims.get(name).cloned(),
        };
        // two GPUs can't share a connector name in weston anyway; keep the first
        out.entry(name.to_string()).or_insert(s);
    }
    out.into_values().collect()
}

/// output name -> the app (fragment name) that placed windows or settings on it.
fn claims() -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    let dir = crate::paths::compositor_etc().join("clients.d");
    let Ok(entries) = std::fs::read_dir(dir) else { return map };
    for e in entries.flatten() {
        let file = e.file_name().to_string_lossy().to_string();
        let Some(app) = file.strip_suffix(".ini") else { continue };
        if app == crate::paths::APP_ID {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(e.path()) else { continue };
        let mut section = String::new();
        for line in text.lines().map(str::trim) {
            if line.starts_with('[') {
                section = line.to_string();
            } else if let Some((k, v)) = line.split_once('=') {
                let key = k.trim();
                if (section == "[appliance-rule]" && key == "output") || (section == "[output]" && key == "name") {
                    map.entry(v.trim().to_string()).or_insert_with(|| app.to_string());
                }
            }
        }
    }
    map
}

#[derive(Debug, PartialEq, Default)]
struct Edid {
    monitor: Option<String>,
    vendor: Option<String>,
    size_mm: Option<(u32, u32)>,
}

/// Monitor name, PNP vendor id and picture size from an EDID base block.
fn parse_edid(e: &[u8]) -> Edid {
    if e.len() < 128 || e[0..8] != [0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0] {
        return Edid::default();
    }
    let id = u16::from_be_bytes([e[8], e[9]]);
    let letter = |v: u16| char::from(b'A' - 1 + (v & 0x1f) as u8);
    let vendor = Some([letter(id >> 10), letter(id >> 5), letter(id)].iter().collect());
    let mut monitor = None;
    let mut size_mm = None;
    for off in [54, 72, 90, 108] {
        let d = &e[off..off + 18];
        if d[0] == 0 && d[1] == 0 {
            if d[3] == 0xfc {
                let name: String = d[5..18].iter().take_while(|&&b| b != 0x0a).map(|&b| b as char).collect();
                let name = name.trim().to_string();
                if !name.is_empty() {
                    monitor = Some(name);
                }
            }
        } else if size_mm.is_none() {
            // detailed timing: image size in mm (12..14)
            let w = d[12] as u32 | ((d[14] as u32 & 0xf0) << 4);
            let h = d[13] as u32 | ((d[14] as u32 & 0x0f) << 8);
            if w > 0 && h > 0 {
                size_mm = Some((w, h));
            }
        }
    }
    // else the basic size in cm (21, 22); one of them 0 means an aspect ratio
    if size_mm.is_none() && e[21] > 0 && e[22] > 0 {
        size_mm = Some((e[21] as u32 * 10, e[22] as u32 * 10));
    }
    // sizes a few mm across are placeholders (some TVs send 16x9 "mm")
    size_mm = size_mm.filter(|&(w, h)| w >= 100 && h >= 60);
    Edid { monitor, vendor, size_mm }
}

/// How big the web app is drawn: 1.0 is its own layout (1920 px wide, made
/// for a desktop browser). On a TV or a monitor used as one that is too small
/// to read from a distance, so: above 1080 lines 2.0, 1080 lines and fewer
/// 1.5. By lines, not width: an ultrawide 2560x1080 is a 1080p screen.
/// (A finer rule by resolution and EDID size came out too small in practice,
/// e.g. 1.25-1.5 on a 28" 4K monitor.) The admin page can override it.
pub fn auto_zoom(s: &Screen) -> f64 {
    match s.pixels() {
        Some((_, h)) if h > 1080 => 2.0,
        _ => 1.5,
    }
}

/// The screen to use for a setting: a named connector (whether or not
/// something is plugged in), or in auto mode the first TV candidate.
pub fn resolve<'a>(setting: &str, screens: &'a [Screen]) -> Option<&'a Screen> {
    if setting == "auto" || setting.is_empty() {
        screens.iter().find(|s| s.is_tv_candidate())
    } else {
        screens.iter().find(|s| s.name == setting)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edid(size_cm: (u8, u8), dtd_mm: Option<(u32, u32)>) -> Vec<u8> {
        let mut e = vec![0u8; 128];
        e[0..8].copy_from_slice(&[0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0]);
        // "GSM" = G(7) S(19) M(13)
        let id: u16 = (7 << 10) | (19 << 5) | 13;
        e[8..10].copy_from_slice(&id.to_be_bytes());
        e[21] = size_cm.0;
        e[22] = size_cm.1;
        if let Some((w, h)) = dtd_mm {
            e[54] = 0x02; // pixel clock != 0: a detailed timing
            e[55] = 0x3a;
            e[66] = (w & 0xff) as u8;
            e[67] = (h & 0xff) as u8;
            e[68] = (((w >> 8) as u8) << 4) | ((h >> 8) as u8 & 0x0f);
        }
        e[72..77].copy_from_slice(&[0, 0, 0, 0xfc, 0]);
        e[77..90].copy_from_slice(b"LG TV SSCR2\n ");
        e
    }

    #[test]
    fn edid_fields() {
        let got = parse_edid(&edid((121, 68), Some((1210, 680))));
        assert_eq!(got.monitor.as_deref(), Some("LG TV SSCR2"));
        assert_eq!(got.vendor.as_deref(), Some("GSM"));
        assert_eq!(got.size_mm, Some((1210, 680)));
        // no timing size: the basic cm size; an aspect ratio (one 0) is no size
        assert_eq!(parse_edid(&edid((60, 34), None)).size_mm, Some((600, 340)));
        assert_eq!(parse_edid(&edid((0, 79), None)).size_mm, None);
        // placeholder "16x9 mm"
        assert_eq!(parse_edid(&edid((0, 0), Some((16, 9)))).size_mm, None);
        assert_eq!(parse_edid(&[]), Edid::default());
    }

    fn screen(mode: &str) -> Screen {
        Screen { name: "HDMI-A-2".into(), connected: true, monitor: Some("TV".into()), vendor: None, mode: Some(mode.into()), size_mm: None, internal: false, claimed_by: None }
    }

    #[test]
    fn zoom() {
        assert_eq!(auto_zoom(&screen("3840x2160")), 2.0);
        assert_eq!(auto_zoom(&screen("2560x1440")), 2.0);
        assert_eq!(auto_zoom(&screen("1920x1080")), 1.5);
        assert_eq!(auto_zoom(&screen("1920x1080i")), 1.5);
        assert_eq!(auto_zoom(&screen("2560x1080")), 1.5);
        assert_eq!(auto_zoom(&screen("1280x720")), 1.5);
    }
}
