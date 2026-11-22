//! Workspaces converge between sidecars on loopback, and envelopes keep their author's signature
//! when a third peer relays them.

use std::time::Duration;

use paprika_sync::node::{Config, Node};
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

async fn link(a: &Node, b: &Node) {
    a.command(&json!({"t": "peer.add", "addr": b.addr()}))
        .await
        .unwrap();
    b.command(&json!({"t": "peer.add", "addr": a.addr()}))
        .await
        .unwrap();
}

fn state() -> Value {
    json!({"name": "Checkout", "rootIds": ["f"], "tokens": {"accent": "#e04a2b"}, "modes": {},
           "nodes": {"f": {"type": "frame", "name": "F", "width": 200, "height": 100, "children": ["t"], "parentId": null},
                     "t": {"type": "text", "name": "T", "text": "Oi", "parentId": "f"}}})
}

#[tokio::test]
async fn shared_workspace_converges_both_ways() {
    let (da, db) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (a, _ea) = start(da.path(), "ana").await;
    let (b, mut eb) = start(db.path(), "bruno").await;
    link(&a, &b).await;
    a.command(&json!({"t": "share", "doc": "w1", "author": "user", "state": state()}))
        .await
        .unwrap();
    let r = wait_for(&mut eb, |v| v["t"] == "remote").await;
    assert_eq!(r["doc"], "w1");
    assert_eq!(r["state"]["nodes"]["t"]["text"], "Oi");
    assert_eq!(r["state"]["nodes"]["f"]["children"], json!(["t"]));
    assert_eq!(r["by"], json!(["ana"]));

    // An agent on B edits; A gets it, labelled with the agent and its person.
    let (_a2, mut ea) = (a.clone(), _ea);
    b.command(&json!({"t": "local", "doc": "w1", "author": "agent:codex", "changes": [{"k": "set", "id": "t", "fields": {"text": "Olá"}}]})).await.unwrap();
    let r = wait_for(&mut ea, |v| v["t"] == "remote").await;
    assert_eq!(r["state"]["nodes"]["t"]["text"], "Olá");
    assert_eq!(r["by"], json!(["codex @ bruno"]));
    let sa = a
        .command(&json!({"t": "state", "doc": "w1"}))
        .await
        .unwrap();
    let sb = b
        .command(&json!({"t": "state", "doc": "w1"}))
        .await
        .unwrap();
    assert_eq!(sa, sb);
}

#[tokio::test]
async fn a_peer_that_was_away_catches_up_through_another() {
    let (da, db, dc) = (
        tempfile::tempdir().unwrap(),
        tempfile::tempdir().unwrap(),
        tempfile::tempdir().unwrap(),
    );
    let (a, _ea) = start(da.path(), "ana").await;
    let (b, mut eb) = start(db.path(), "bruno").await;
    link(&a, &b).await;
    a.command(&json!({"t": "share", "doc": "w1", "author": "user", "state": state()}))
        .await
        .unwrap();
    a.command(&json!({"t": "local", "doc": "w1", "author": "user", "changes": [{"k": "set", "id": "f", "fields": {"fill": "#fff"}}]})).await.unwrap();
    wait_for(&mut eb, |v| {
        v["t"] == "remote" && v["state"]["nodes"]["f"]["fill"] == "#fff"
    })
    .await;
    let want = a
        .command(&json!({"t": "state", "doc": "w1"}))
        .await
        .unwrap();
    a.shutdown().await;

    // C knows A's key (a member) but only reaches B; B relays A's envelopes as A signed them.
    let (c, mut ec) = start(dc.path(), "carla").await;
    c.command(&json!({"t": "peer.add", "addr": {"id": a.id(), "addrs": []}}))
        .await
        .ok();
    link(&b, &c).await;
    let r = wait_for(&mut ec, |v| {
        v["t"] == "remote" && v["state"]["nodes"]["f"]["fill"] == "#fff"
    })
    .await;
    assert_eq!(r["state"], want);
    assert_eq!(c.status()["rejected"], 0);
}
