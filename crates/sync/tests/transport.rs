//! Two sidecars on loopback, no relay: they connect over QUIC and relay presence.

use std::time::Duration;

use paprika_sync::node::{Config, Node};
use serde_json::{Value, json};
use tokio::sync::mpsc;

async fn start(dir: &std::path::Path, name: &str) -> (Node, mpsc::UnboundedReceiver<Value>) {
    let (tx, rx) = mpsc::unbounded_channel();
    let cfg = Config {
        data: dir.to_path_buf(),
        name: name.into(),
        relay: false,
        bind: Some("127.0.0.1:0".parse().unwrap()),
    };
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
        v["t"] == "status" && v["status"]["peers"][0]["state"] == "direct"
    })
    .await;
    assert_eq!(st["status"]["peers"][0]["name"], "bruno");
    assert_eq!(st["status"]["peers"][0]["id"], b.id().to_string());

    a.command(&json!({"t": "presence", "data": {"agent": "claude-code", "tool": "update_nodes"}}))
        .await
        .unwrap();
    let p = wait_for(&mut eb, |v| v["t"] == "presence").await;
    assert_eq!(p["peer"], a.id().to_string());
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
