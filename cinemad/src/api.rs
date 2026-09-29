//! The admin page's HTTP API and files, on the gateway socket. Everything is
//! for administrators: the page's window is admin-only (allUsers: false), and
//! each request is checked again from the gateway's identity headers.

use crate::gateway::User;
use crate::supervisor::Supervisor;
use crate::{account, audio, settings, www::Www};
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post, put};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;

#[derive(Clone)]
struct AppState {
    sup: Arc<Supervisor>,
    web: Arc<Www>,
}

pub fn router(sup: Arc<Supervisor>, web: Www, prefix: &str) -> Router {
    let p = |s: &str| format!("{prefix}{s}");
    let state = AppState { sup, web: Arc::new(web) };
    Router::new()
        .route(&p("/api/status"), get(get_status))
        .route(&p("/api/enabled"), put(put_enabled))
        .route(&p("/api/account"), put(put_account).delete(delete_account))
        .route(&p("/api/screen"), put(put_screen))
        .route(&p("/api/audio"), put(put_audio))
        .route(&p("/api/volume"), put(put_volume))
        .route(&p("/api/zoom"), put(put_zoom))
        .route(&p("/api/kiosk/restart"), post(post_restart))
        .route(&p("/"), get(index))
        .route(&p("/{file}"), get(file))
        .with_state(state)
}

fn forbidden() -> Response {
    (StatusCode::FORBIDDEN, "administrator sign-in required").into_response()
}

fn bad(msg: impl Into<String>) -> Response {
    (StatusCode::BAD_REQUEST, msg.into()).into_response()
}

fn admin(h: &HeaderMap) -> bool {
    let u = User::from_headers(h);
    u.username.is_some() && u.is_admin
}

async fn status_json(s: &AppState) -> Response {
    let st = s.sup.status.read().await.clone();
    Json(json!({ "version": env!("CARGO_PKG_VERSION"), "status": st })).into_response()
}

async fn get_status(State(s): State<AppState>, h: HeaderMap) -> Response {
    if !admin(&h) {
        return forbidden();
    }
    status_json(&s).await
}

/// Apply a settings change, re-run the supervisor, answer with the new status
/// (after a moment, so it reflects what the change started).
async fn update(s: &AppState, f: impl FnOnce(&mut settings::Settings)) -> Response {
    let mut st = settings::load();
    f(&mut st);
    if let Err(e) = settings::save(&st) {
        return (StatusCode::INTERNAL_SERVER_ERROR, format!("cannot save settings: {e}")).into_response();
    }
    s.sup.kick();
    tokio::time::sleep(std::time::Duration::from_millis(600)).await;
    status_json(s).await
}

#[derive(Deserialize)]
struct Enabled {
    enabled: bool,
}

async fn put_enabled(State(s): State<AppState>, h: HeaderMap, Json(b): Json<Enabled>) -> Response {
    if !admin(&h) {
        return forbidden();
    }
    update(&s, |st| st.enabled = b.enabled).await
}

#[derive(Deserialize)]
struct Account {
    username: String,
    password: String,
}

async fn put_account(State(s): State<AppState>, h: HeaderMap, Json(b): Json<Account>) -> Response {
    if !admin(&h) {
        return forbidden();
    }
    let username = b.username.trim();
    if username.is_empty() || b.password.is_empty() {
        return bad("username and password are required");
    }
    let r = tokio::task::spawn_blocking({
        let (u, p) = (username.to_string(), b.password);
        move || account::save(&u, &p)
    })
    .await;
    match r {
        Ok(Ok(_)) => {
            s.sup.restart_kiosk();
            update(&s, |_| {}).await
        }
        Ok(Err(e)) => (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn delete_account(State(s): State<AppState>, h: HeaderMap) -> Response {
    if !admin(&h) {
        return forbidden();
    }
    tokio::task::spawn_blocking(account::clear).await.ok();
    // the kiosk signs out: back to its "add an account" screen
    s.sup.restart_kiosk();
    update(&s, |_| {}).await
}

#[derive(Deserialize)]
struct Choice {
    value: String,
}

async fn put_screen(State(s): State<AppState>, h: HeaderMap, Json(b): Json<Choice>) -> Response {
    if !admin(&h) {
        return forbidden();
    }
    let v = b.value.trim().to_string();
    if v != "auto" && !crate::screens::scan().iter().any(|x| x.name == v) {
        return bad("no such screen");
    }
    update(&s, |st| st.screen = v).await
}

async fn put_audio(State(s): State<AppState>, h: HeaderMap, Json(b): Json<Choice>) -> Response {
    if !admin(&h) {
        return forbidden();
    }
    let v = b.value.trim().to_string();
    if v.is_empty() {
        return bad("no output given");
    }
    update(&s, |st| st.audio = v).await
}

async fn put_zoom(State(s): State<AppState>, h: HeaderMap, Json(b): Json<Choice>) -> Response {
    if !admin(&h) {
        return forbidden();
    }
    let v = b.value.trim().to_string();
    if v != "auto" && !v.parse::<f64>().is_ok_and(|p| (25.0..=400.0).contains(&p)) {
        return bad("zoom is \"auto\" or a percentage from 25 to 400");
    }
    update(&s, |st| st.zoom = v).await
}

#[derive(Deserialize)]
struct Volume {
    volume: Option<u32>,
    muted: Option<bool>,
}

async fn put_volume(State(s): State<AppState>, h: HeaderMap, Json(b): Json<Volume>) -> Response {
    if !admin(&h) {
        return forbidden();
    }
    let sink = s.sup.status.read().await.sink.clone();
    if let Some(v) = b.volume {
        audio::set_volume(sink.as_ref(), v).await;
    }
    if let Some(m) = b.muted {
        audio::set_mute(sink.as_ref(), m).await;
    }
    s.sup.kick();
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    status_json(&s).await
}

async fn post_restart(State(s): State<AppState>, h: HeaderMap) -> Response {
    if !admin(&h) {
        return forbidden();
    }
    s.sup.restart_kiosk();
    tokio::time::sleep(std::time::Duration::from_millis(600)).await;
    status_json(&s).await
}

async fn index(State(s): State<AppState>, h: HeaderMap) -> Response {
    serve(&s, &h, "index.html")
}

async fn file(State(s): State<AppState>, h: HeaderMap, Path(name): Path<String>) -> Response {
    serve(&s, &h, &name)
}

fn serve(s: &AppState, h: &HeaderMap, name: &str) -> Response {
    if !admin(h) {
        return forbidden();
    }
    match s.web.get(name) {
        Some((ctype, body)) => ([(header::CONTENT_TYPE, ctype), (header::CACHE_CONTROL, "no-store")], body).into_response(),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}
