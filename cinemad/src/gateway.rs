//! FygoOS unified-gateway integration: user identity from the forwarded
//! headers, and socket permissions so only the gateway can connect.

use axum::http::HeaderMap;
use std::path::Path;

/// Identity of the NAS user behind a request, as asserted by the gateway.
pub struct User {
    pub username: Option<String>,
    pub is_admin: bool,
}

impl User {
    pub fn from_headers(h: &HeaderMap) -> Self {
        let get = |k: &str| h.get(k).and_then(|v| v.to_str().ok()).map(str::to_string);
        User { username: get("x-trim-username"), is_admin: get("x-trim-isadmin").as_deref() == Some("true") }
    }
}

/// Owner (root) only, so nobody can bypass the gateway and forge the
/// `X-Trim-*` headers. The fnOS gateway runs as root.
pub fn restrict_socket(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
}
