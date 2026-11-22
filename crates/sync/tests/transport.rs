//! Two sidecars on loopback, no relay: they connect over QUIC and relay presence.

mod common;

use std::time::Duration;

use common::{connect_peers, start, start_with, wait_for};
use paprika_sync::proto::{APP_VERSION, FORMAT_VERSION};
use serde_json::json;

#[tokio::test]
async fn two_peers_connect_and_share_presence() {
    let (da, db) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (a, mut ea) = start(da.path(), "ana").await;
    let (b, mut eb) = start(db.path(), "bruno").await;
    connect_peers(&a, &b).await;
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
    connect_peers(&a, &b).await;
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
    for st in [a.status(), b.status()] {
        assert!(
            st["peers"]
                .as_array()
                .unwrap()
                .iter()
                .all(|p| p["state"] != "direct" && p["state"] != "relay")
        );
    }
}

#[tokio::test]
async fn different_app_version_syncs_with_warning() {
    let (da, db) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (a, mut ea) = start_with(da.path(), "ana", "0.0.1", FORMAT_VERSION).await;
    let (b, mut eb) = start_with(db.path(), "bruno", "9.9.9", FORMAT_VERSION).await;
    connect_peers(&a, &b).await;
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
    let _ = b.command(&json!({"t": "peer.add", "addr": a.addr()})).await;
    let r = wait_for(&mut ea, |v| v["t"] == "rejected").await;
    assert_eq!(r["peer"], b.id().to_string());
    assert_eq!(a.status()["peers"].as_array().unwrap().len(), 0);
}
