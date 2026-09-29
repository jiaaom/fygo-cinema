//! The one account the TV signs in with: the Fygo TV / 飞牛影视 username and
//! password, sealed with `systemd-creds` using the host key (the root-only
//! /var/lib/systemd/credential.secret). The kiosk unit hands it to the kiosk
//! with LoadCredentialEncrypted=, so the password is decrypted only into that
//! service's private credentials directory. A copy of the file alone can't be
//! opened; root on this machine can, as with anything that signs in
//! unattended. (No TPM: FygoOS ships without the tpm2-tss libraries.)

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::process::{Command, Stdio};

/// Bound into the credential (decrypting under another name fails) and the
/// name the kiosk finds it under in $CREDENTIALS_DIRECTORY.
pub const CRED_NAME: &str = "fygo-cinema-account";

#[derive(Serialize)]
struct Secret<'a> {
    username: &'a str,
    password: &'a str,
}

/// Non-secret sidecar: who is stored.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Meta {
    pub username: String,
}

pub fn cred_file() -> std::path::PathBuf {
    crate::paths::state_dir().join("account.cred")
}

fn meta_file() -> std::path::PathBuf {
    crate::paths::state_dir().join("account.json")
}

fn set_private(path: &std::path::Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}

/// Seal `plain` into the credential file.
fn seal(plain: &[u8]) -> Result<(), String> {
    let dir = crate::paths::state_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = dir.join("account.cred.tmp");
    let mut child = Command::new("systemd-creds")
        .args(["encrypt", "--with-key=host", &format!("--name={CRED_NAME}"), "-"])
        .arg(&tmp)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("systemd-creds: {e}"))?;
    let wrote = child.stdin.take().map(|mut s| s.write_all(plain).is_ok()).unwrap_or(false);
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !wrote || !out.status.success() {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("could not seal the account: {}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    set_private(&tmp);
    std::fs::rename(&tmp, cred_file()).map_err(|e| e.to_string())
}

pub fn save(username: &str, password: &str) -> Result<Meta, String> {
    let plain = serde_json::to_vec(&Secret { username, password }).map_err(|e| e.to_string())?;
    seal(&plain)?;
    let meta = Meta { username: username.into() };
    std::fs::write(meta_file(), serde_json::to_vec(&meta).unwrap_or_default()).map_err(|e| e.to_string())?;
    set_private(&meta_file());
    Ok(meta)
}

/// Without an account the kiosk still runs (it shows how to add one), and
/// its unit's LoadCredentialEncrypted= needs a file to load: an empty one,
/// "{}", which the kiosk reads as "no account".
pub fn ensure_placeholder() {
    if !cred_file().exists() {
        if let Err(e) = seal(b"{}") {
            eprintln!("cinemad: placeholder credential: {e}");
        }
    }
}

/// Who is stored; `None` also for the empty placeholder (no sidecar).
pub fn meta() -> Option<Meta> {
    if !cred_file().exists() {
        return None;
    }
    std::fs::read(meta_file()).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

pub fn clear() {
    let _ = std::fs::remove_file(meta_file());
    let _ = std::fs::remove_file(cred_file());
    ensure_placeholder();
}
