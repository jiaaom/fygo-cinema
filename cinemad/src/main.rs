//! cinemad: the Fygo Cinema backend.
//!
//! - serves the admin page and its API on the FygoOS gateway socket (the App
//!   Center entry forwards /app/fygo-cinema there, admins only)
//! - keeps the TV kiosk where the admin page says: on the chosen screen,
//!   playing to the chosen output, running only while the TV is plugged in
//!   (see supervisor.rs)
//!
//! usage: cinemad --gateway-socket PATH [--prefix /app/fygo-cinema] --web DIR
//!        (a TCP --listen ADDR:PORT instead is for development: no gateway,
//!        so requests need the X-Trim-* headers set by hand)

mod account;
mod api;
mod audio;
mod gateway;
mod paths;
mod screens;
mod settings;
mod supervisor;
mod www;

use std::path::PathBuf;
use tokio::net::{TcpListener, UnixListener};

fn usage() -> ! {
    eprintln!("usage: cinemad (--gateway-socket PATH | --listen ADDR:PORT) --web DIR [--prefix /app/fygo-cinema]");
    std::process::exit(2);
}

#[tokio::main]
async fn main() {
    let (mut socket, mut listen, mut web, mut prefix) = (None::<PathBuf>, None::<String>, None::<PathBuf>, "/app/fygo-cinema".to_string());
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        let mut value = || args.next().unwrap_or_else(|| usage());
        match a.as_str() {
            "--gateway-socket" => socket = Some(PathBuf::from(value())),
            "--listen" => listen = Some(value()),
            "--web" => web = Some(PathBuf::from(value())),
            "--prefix" => prefix = value().trim_end_matches('/').to_string(),
            _ => usage(),
        }
    }
    let Some(web) = web else { usage() };
    if socket.is_none() && listen.is_none() {
        usage();
    }

    let sup = supervisor::Supervisor::new();
    sup.start();
    let app = api::router(sup.clone(), www::Www::new(web), &prefix);

    if let Some(path) = &socket {
        let _ = std::fs::remove_file(path);
        let listener = UnixListener::bind(path).unwrap_or_else(|e| {
            eprintln!("cannot bind {}: {e}", path.display());
            std::process::exit(1);
        });
        if let Err(e) = gateway::restrict_socket(path) {
            eprintln!("cannot set permissions on {}: {e}", path.display());
            std::process::exit(1);
        }
        println!("cinemad listening on {} (gateway, prefix {prefix})", path.display());
        let app = app.clone();
        tokio::spawn(async move { axum::serve(listener, app).await });
    }
    if let Some(addr) = &listen {
        let listener = TcpListener::bind(addr).await.unwrap_or_else(|e| {
            eprintln!("cannot bind {addr}: {e}");
            std::process::exit(1);
        });
        println!("cinemad listening on http://{addr}{prefix}/ (development)");
        tokio::spawn(async move { axum::serve(listener, app).await });
    }

    let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("signal");
    tokio::select! {
        _ = tokio::signal::ctrl_c() => {}
        _ = term.recv() => {}
    }
    if let Some(path) = &socket {
        let _ = std::fs::remove_file(path);
    }
    println!("cinemad stopped");
}
