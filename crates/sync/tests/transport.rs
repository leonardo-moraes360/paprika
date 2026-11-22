//! Two sidecars on loopback, no relay: they connect over QUIC and relay presence.

use std::time::Duration;

use paprika_sync::node::{Config, Node};
use paprika_sync::proto::{APP_VERSION, FORMAT_VERSION};
use serde_json::{Value, json};
use tokio::sync::mpsc;

async fn start(dir: &std::path::Path, name: &str) -> (Node, mpsc::UnboundedReceiver<Value>) {
    let (tx, rx) = mpsc::unbounded_channel();
    (
        Node::start(Config::test(dir.to_path_buf(), name), tx)
            .await
            .unwrap(),
        rx,
    )
}

async fn start_with(
    dir: &std::path::Path,
    name: &str,
    app: &str,
    format: &str,
) -> (Node, mpsc::UnboundedReceiver<Value>) {
    let (tx, rx) = mpsc::unbounded_channel();
    let mut cfg = Config::test(dir.to_path_buf(), name);
    cfg.app = app.into();
    cfg.format = format.into();
    (Node::start(cfg, tx).await.unwrap(), rx)
}

async fn wait_for(rx: &mut mpsc::UnboundedReceiver<Value>, pred: impl Fn(&Value) -> bool) -> Value {
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            let v = rx.recv().await.expect("events closed");
            if pred(&v) {
                return v;
            }
        }
    })
    .await
    .expect("timed out waiting for event")
}

#[tokio::test]
async fn two_peers_connect_and_share_presence() {
    let (da, db) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (a, mut ea) = start(da.path(), "ana").await;
    let (b, mut eb) = start(db.path(), "bruno").await;
    // Each side allows the other; only A dials.
    b.command(&json!({"t": "peer.add", "addr": a.addr()}))
        .await
        .unwrap();
    a.command(&json!({"t": "peer.add", "addr": b.addr()}))
        .await
        .unwrap();
    wait_for(&mut ea, |v| v["t"] == "peer" && v["state"] == "connected").await;
    wait_for(&mut eb, |v| v["t"] == "peer" && v["state"] == "connected").await;

    let st = wait_for(&mut ea, |v| {
        v["t"] == "status"
            && v["status"]["peers"][0]["state"] == "direct"
            && v["status"]["peers"][0]["format"] == FORMAT_VERSION
    })
    .await;
    assert_eq!(st["status"]["peers"][0]["name"], "bruno");
    assert_eq!(st["status"]["peers"][0]["id"], b.id().to_string());
    assert_eq!(st["status"]["peers"][0]["app"], APP_VERSION);
    assert_eq!(st["status"]["app"], APP_VERSION);
    assert_eq!(st["status"]["format"], FORMAT_VERSION);

    a.command(&json!({"t": "presence", "data": {"agent": "claude-code", "tool": "update_nodes"}}))
        .await
        .unwrap();
    let p = wait_for(&mut eb, |v| v["t"] == "presence").await;
    assert_eq!(p["peer"], a.id().to_string());
    assert_eq!(p["data"]["agent"], "claude-code");
}

#[tokio::test]
async fn incompatible_format_is_refused_on_both_sides() {
    let (da, db) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (a, mut ea) = start_with(da.path(), "ana", APP_VERSION, FORMAT_VERSION).await;
    let (b, mut eb) = start_with(db.path(), "bruno", APP_VERSION, "paprika/0").await;
    b.command(&json!({"t": "peer.add", "addr": a.addr()}))
        .await
        .unwrap();
    a.command(&json!({"t": "peer.add", "addr": b.addr()}))
        .await
        .unwrap();
    let ra = wait_for(&mut ea, |v| {
        v["t"] == "rejected"
            && v["reason"]
                .as_str()
                .is_some_and(|r| r.contains("incompatible document format"))
    })
    .await;
    let rb = wait_for(&mut eb, |v| {
        v["t"] == "rejected"
            && v["reason"]
                .as_str()
                .is_some_and(|r| r.contains("incompatible document format"))
    })
    .await;
    assert!(ra["reason"].as_str().unwrap().contains("paprika/0"));
    assert!(rb["reason"].as_str().unwrap().contains(FORMAT_VERSION));
    assert!(
        ra["reason"].as_str().unwrap().contains("Upgrade")
            || ra["reason"].as_str().unwrap().contains("upgrade")
    );
    tokio::time::sleep(Duration::from_millis(200)).await;
    let a_status = a.status();
    let b_status = b.status();
    let a_peers = a_status["peers"].as_array().unwrap();
    let b_peers = b_status["peers"].as_array().unwrap();
    assert!(
        a_peers
            .iter()
            .all(|p| p["state"] != "direct" && p["state"] != "relay")
    );
    assert!(
        b_peers
            .iter()
            .all(|p| p["state"] != "direct" && p["state"] != "relay")
    );
}

#[tokio::test]
async fn different_app_version_syncs_with_warning() {
    let (da, db) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (a, mut ea) = start_with(da.path(), "ana", "0.0.1", FORMAT_VERSION).await;
    let (b, mut eb) = start_with(db.path(), "bruno", "9.9.9", FORMAT_VERSION).await;
    b.command(&json!({"t": "peer.add", "addr": a.addr()}))
        .await
        .unwrap();
    a.command(&json!({"t": "peer.add", "addr": b.addr()}))
        .await
        .unwrap();
    wait_for(&mut ea, |v| v["t"] == "peer" && v["state"] == "connected").await;
    wait_for(&mut eb, |v| v["t"] == "peer" && v["state"] == "connected").await;
    let wa = wait_for(&mut ea, |v| {
        v["t"] == "log"
            && v["level"] == "warn"
            && v["msg"]
                .as_str()
                .is_some_and(|m| m.contains("9.9.9") && m.contains("Sync continues"))
    })
    .await;
    let _wb = wait_for(&mut eb, |v| {
        v["t"] == "log"
            && v["level"] == "warn"
            && v["msg"]
                .as_str()
                .is_some_and(|m| m.contains("0.0.1") && m.contains("Sync continues"))
    })
    .await;
    assert!(wa["msg"].as_str().unwrap().contains(FORMAT_VERSION));
    let st = wait_for(&mut ea, |v| {
        v["t"] == "status"
            && v["status"]["peers"][0]["state"] == "direct"
            && v["status"]["peers"][0]["app"] == "9.9.9"
    })
    .await;
    assert_eq!(st["status"]["peers"][0]["format"], FORMAT_VERSION);
    a.command(&json!({"t": "presence", "data": {"agent": "claude-code", "tool": "update_nodes"}}))
        .await
        .unwrap();
    let p = wait_for(&mut eb, |v| v["t"] == "presence").await;
    assert_eq!(p["data"]["agent"], "claude-code");
}

#[tokio::test]
async fn strangers_are_refused() {
    let (da, db) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (a, mut ea) = start(da.path(), "ana").await;
    let (b, _eb) = start(db.path(), "eve").await;
    // B allows A, but A never allowed B: A closes the connection before any sync.
    let _ = b.command(&json!({"t": "peer.add", "addr": a.addr()})).await;
    let r = wait_for(&mut ea, |v| v["t"] == "rejected").await;
    assert_eq!(r["peer"], b.id().to_string());
    assert_eq!(a.status()["peers"].as_array().unwrap().len(), 0);
}
