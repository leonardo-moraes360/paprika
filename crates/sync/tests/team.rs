//! Teams: create, invite, join, single use, expiry, and members added by other members.

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

fn members(n: &Node) -> Vec<String> {
    let mut v: Vec<String> = n.status()["team"]["members"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["name"].as_str().unwrap().to_string())
        .collect();
    v.sort();
    v
}

#[tokio::test]
async fn invite_join_and_sync() {
    let (da, db, dc) = (
        tempfile::tempdir().unwrap(),
        tempfile::tempdir().unwrap(),
        tempfile::tempdir().unwrap(),
    );
    let (a, mut ea) = start(da.path(), "Ana").await;
    let (b, mut eb) = start(db.path(), "Bruno").await;
    let (c, mut ec) = start(dc.path(), "Carla").await;

    a.command(&json!({"t": "team.create", "name": "Estúdio Norte"}))
        .await
        .unwrap();
    let inv = a
        .command(&json!({"t": "invite.create", "ttlSecs": 600}))
        .await
        .unwrap();
    let link = inv["link"].as_str().unwrap().to_string();
    let peek = b
        .command(&json!({"t": "invite.inspect", "link": link}))
        .await
        .unwrap();
    assert_eq!(peek["name"], "Estúdio Norte");
    assert_eq!(peek["expired"], false);

    b.command(&json!({"t": "join", "link": link}))
        .await
        .unwrap();
    wait_for(&mut ea, |v| v["t"] == "joined" && v["name"] == "Bruno").await;
    assert_eq!(members(&a), vec!["Ana", "Bruno"]);
    assert_eq!(members(&b), vec!["Ana", "Bruno"]);
    wait_for(&mut eb, |v| v["t"] == "peer" && v["state"] == "connected").await;

    // Single use: Carla cannot reuse Bruno's link.
    let err = c
        .command(&json!({"t": "join", "link": link}))
        .await
        .unwrap_err();
    assert!(err.to_string().contains("already used"), "{err}");
    wait_for(&mut ea, |v| v["t"] == "rejected").await;

    // Bruno (a member, not the founder) invites Carla; Ana learns about her through the team file.
    let link2 = b
        .command(&json!({"t": "invite.create", "ttlSecs": 600}))
        .await
        .unwrap()["link"]
        .as_str()
        .unwrap()
        .to_string();
    c.command(&json!({"t": "join", "link": link2}))
        .await
        .unwrap();
    for _ in 0..100 {
        if members(&a).len() == 3 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert_eq!(members(&a), vec!["Ana", "Bruno", "Carla"]);

    // Ana shares a workspace; Carla (who never got Ana's invite) receives it.
    a.command(&json!({"t": "share", "doc": "w1", "author": "user", "state": {"name": "W", "rootIds": [], "nodes": {}}})).await.unwrap();
    let r = wait_for(&mut ec, |v| v["t"] == "remote" && v["doc"] == "w1").await;
    assert_eq!(r["state"]["name"], "W");

    // Revoked invites are refused.
    let link3 = a
        .command(&json!({"t": "invite.create", "ttlSecs": 600}))
        .await
        .unwrap()["link"]
        .as_str()
        .unwrap()
        .to_string();
    a.command(&json!({"t": "invite.revoke"})).await.unwrap();
    let (dd, _) = (tempfile::tempdir().unwrap(), ());
    let (d, _ed) = start(dd.path(), "Davi").await;
    let err = d
        .command(&json!({"t": "join", "link": link3}))
        .await
        .unwrap_err();
    assert!(err.to_string().contains("revoked"), "{err}");
}

#[tokio::test]
async fn expired_links_are_refused_before_dialing() {
    let (da, db) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (a, _ea) = start(da.path(), "Ana").await;
    let (b, _eb) = start(db.path(), "Bruno").await;
    a.command(&json!({"t": "team.create", "name": "T"}))
        .await
        .unwrap();
    let link = a
        .command(&json!({"t": "invite.create", "ttlSecs": 600}))
        .await
        .unwrap()["link"]
        .as_str()
        .unwrap()
        .to_string();
    // Same link with a past expiry: the joiner refuses it; tampering would not pass the inviter anyway.
    let (head, _) = link.rsplit_once("&e=").unwrap();
    let err = b
        .command(&json!({"t": "join", "link": format!("{head}&e=1")}))
        .await
        .unwrap_err();
    assert_eq!(err.to_string(), "invite expired");
}

#[tokio::test]
async fn non_members_cannot_sync_with_a_team() {
    let (da, de) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (a, mut ea) = start(da.path(), "Ana").await;
    let (e, _ee) = start(de.path(), "Eve").await;
    a.command(&json!({"t": "team.create", "name": "T"}))
        .await
        .unwrap();
    let _ = e.command(&json!({"t": "peer.add", "addr": a.addr()})).await;
    let r = wait_for(&mut ea, |v| v["t"] == "rejected").await;
    assert_eq!(r["reason"], "not a team member");
}
