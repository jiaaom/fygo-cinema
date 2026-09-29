//! The admin page's static files, from the directory given with `--web DIR`.

use std::path::PathBuf;

pub struct Www {
    dir: PathBuf,
}

impl Www {
    pub fn new(dir: PathBuf) -> Self {
        Www { dir }
    }

    /// (content type, body) for a page file, or `None` if unknown/missing.
    pub fn get(&self, name: &str) -> Option<(&'static str, Vec<u8>)> {
        let name = if name.is_empty() { "index.html" } else { name };
        if name.contains("..") || name.contains('/') {
            return None;
        }
        let ctype = mime_for(name)?;
        let body = std::fs::read(self.dir.join(name)).ok()?;
        if name != "index.html" {
            return Some((ctype, body));
        }
        // Stamp `?v=__V__` asset URLs with a content hash, so a webview that
        // ignores no-store can't pair a new page with a stale script.
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        for f in ["app.js", "style.css", "web-app.js"] {
            std::fs::read(self.dir.join(f)).ok().hash(&mut h);
        }
        let v = format!("{:016x}", h.finish());
        let html = String::from_utf8_lossy(&body);
        Some((ctype, html.replace("?v=__V__", &format!("?v={}", &v[..10])).into_bytes()))
    }
}

fn mime_for(name: &str) -> Option<&'static str> {
    Some(match name.rsplit('.').next()? {
        "html" => "text/html; charset=utf-8",
        "js" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        _ => return None,
    })
}
