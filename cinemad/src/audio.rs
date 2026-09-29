//! Sound outputs (PipeWire sinks), and volume/mute of the TV's output.
//! PipeWire here is appliance-compositor's, running as root in
//! /run/user/0; `pw-dump` lists it, `wpctl` sets volume.

use serde::Serialize;
use tokio::process::Command;

#[derive(Serialize, Clone, Debug)]
pub struct Sink {
    pub id: u64,
    /// Stable across sound-server restarts; what the kiosk is given.
    pub name: String,
    pub description: String,
    /// For HDMI/DP outputs PipeWire sets this to the monitor's EDID name.
    pub nick: Option<String>,
    pub default: bool,
}

async fn tool(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd)
        .args(args)
        .env("XDG_RUNTIME_DIR", crate::paths::CLIENT_RUNTIME_DIR)
        .kill_on_drop(true)
        .output();
    let out = tokio::time::timeout(std::time::Duration::from_secs(4), out).await.ok()?.ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

pub async fn sinks() -> Vec<Sink> {
    let Some(text) = tool("pw-dump", &[]).await else { return vec![] };
    let Ok(objs) = serde_json::from_str::<Vec<serde_json::Value>>(&text) else { return vec![] };
    // the default sink's node.name, from the "default" metadata
    let default_name = objs.iter().find_map(|o| {
        let md = o.get("metadata")?.as_array()?;
        md.iter().find(|m| m.get("key").and_then(|k| k.as_str()) == Some("default.audio.sink")).and_then(|m| {
            let v = m.get("value")?;
            v.get("name").and_then(|n| n.as_str()).map(str::to_string)
                .or_else(|| v.as_str().and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok()?.get("name")?.as_str().map(str::to_string)))
        })
    });
    objs.iter()
        .filter(|o| o.get("type").and_then(|t| t.as_str()) == Some("PipeWire:Interface:Node"))
        .filter_map(|o| {
            let props = o.get("info")?.get("props")?;
            let s = |k: &str| props.get(k).and_then(|v| v.as_str()).map(str::to_string);
            if s("media.class").as_deref() != Some("Audio/Sink") {
                return None;
            }
            let name = s("node.name")?;
            Some(Sink {
                id: o.get("id")?.as_u64()?,
                description: s("node.description").unwrap_or_else(|| name.clone()),
                nick: s("node.nick"),
                default: default_name.as_deref() == Some(name.as_str()),
                name,
            })
        })
        .collect()
}

/// The sink the kiosk plays to, or `None` for the system default.
///   auto: the sink carrying the TV's EDID name (its HDMI audio), else default
///   default: always the default
///   <node.name>: that sink while it exists
pub fn resolve<'a>(setting: &str, sinks: &'a [Sink], tv_monitor: Option<&str>) -> Option<&'a Sink> {
    match setting {
        "default" => None,
        "auto" | "" => {
            let tv = tv_monitor?.to_lowercase();
            sinks.iter().find(|s| s.nick.as_deref().map(str::to_lowercase).as_deref() == Some(tv.as_str()))
        }
        name => sinks.iter().find(|s| s.name == name),
    }
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct Level {
    pub volume: Option<u32>,
    pub muted: bool,
}

fn target(sink: Option<&Sink>) -> String {
    sink.map(|s| s.id.to_string()).unwrap_or_else(|| "@DEFAULT_AUDIO_SINK@".into())
}

pub async fn level(sink: Option<&Sink>) -> Level {
    let out = tool("wpctl", &["get-volume", &target(sink)]).await.unwrap_or_default();
    // "Volume: 0.45 [MUTED]"
    let volume = out.split_whitespace().nth(1).and_then(|v| v.parse::<f64>().ok()).map(|v| (v * 100.0).round() as u32);
    Level { volume, muted: out.contains("MUTED") }
}

pub async fn set_volume(sink: Option<&Sink>, percent: u32) -> bool {
    let v = format!("{:.2}", percent.min(100) as f64 / 100.0);
    tool("wpctl", &["set-volume", &target(sink), &v]).await.is_some()
}

pub async fn set_mute(sink: Option<&Sink>, muted: bool) -> bool {
    tool("wpctl", &["set-mute", &target(sink), if muted { "1" } else { "0" }]).await.is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sink(name: &str, nick: Option<&str>) -> Sink {
        Sink { id: 1, name: name.into(), description: name.into(), nick: nick.map(str::to_string), default: false }
    }

    #[test]
    fn auto_picks_the_tv_by_edid_name() {
        let sinks = vec![sink("speaker", None), sink("hdmi1", Some("LG TV SSCR2")), sink("hdmi2", Some("HDMI 2"))];
        assert_eq!(resolve("auto", &sinks, Some("lg tv sscr2")).map(|s| s.name.as_str()), Some("hdmi1"));
        assert!(resolve("auto", &sinks, Some("SONY TV")).is_none());
        assert!(resolve("auto", &sinks, None).is_none());
        assert!(resolve("default", &sinks, Some("LG TV SSCR2")).is_none());
        assert_eq!(resolve("hdmi2", &sinks, None).map(|s| s.name.as_str()), Some("hdmi2"));
        assert!(resolve("gone", &sinks, None).is_none());
    }
}
