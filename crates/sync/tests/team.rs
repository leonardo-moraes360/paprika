mod common;

use std::time::Duration;

use common::{start, wait_for};
use paprika_sync::node::Node;
use serde_json::{Value, json};

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

    let err = c
        .command(&json!({"t": "join", "link": link}))
        .await
        .unwrap_err();
    assert!(err.to_string().contains("already used"), "{err}");
    wait_for(&mut ea, |v| v["t"] == "rejected").await;

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

    a.command(&json!({"t": "share", "doc": "w1", "author": "user", "state": {"name": "W", "rootIds": [], "nodes": {}}})).await.unwrap();
    let r = wait_for(&mut ec, |v| v["t"] == "remote" && v["doc"] == "w1").await;
    assert_eq!(r["state"]["name"], "W");

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

async fn invite(by: &Node, who: &Node) {
    let link = by
        .command(&json!({"t": "invite.create", "ttlSecs": 600}))
        .await
        .unwrap()["link"]
        .as_str()
        .unwrap()
        .to_string();
    who.command(&json!({"t": "join", "link": link}))
        .await
        .unwrap();
}

async fn until(what: &str, cond: impl Fn() -> bool) {
    for _ in 0..200 {
        if cond() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("timed out: {what}");
}

fn text(n: &Node) -> Value {
    tokio::task::block_in_place(|| {
        tokio::runtime::Handle::current()
            .block_on(n.command(&json!({"t": "state", "doc": "w1"})))
            .map(|s| s["nodes"]["t"]["text"].clone())
            .unwrap_or(Value::Null)
    })
}

fn set_text(v: &str) -> Value {
    json!({"t": "local", "doc": "w1", "author": "user", "changes": [{"k": "set", "id": "t", "fields": {"text": v}}]})
}

fn doc() -> Value {
    json!({"name": "W", "rootIds": ["t"], "nodes": {"t": {"type": "text", "name": "T", "text": "Oi", "parentId": null}}})
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_founder_removes_a_member() {
    let dirs: Vec<_> = (0..4).map(|_| tempfile::tempdir().unwrap()).collect();
    let (a, _ea) = start(dirs[0].path(), "Ana").await;
    let (b, _eb) = start(dirs[1].path(), "Bruno").await;
    let (c, _ec) = start(dirs[2].path(), "Carla").await;
    a.command(&json!({"t": "team.create", "name": "T"}))
        .await
        .unwrap();
    invite(&a, &b).await;
    invite(&a, &c).await;
    a.command(&json!({"t": "share", "doc": "w1", "author": "user", "state": doc()}))
        .await
        .unwrap();
    until("C has the workspace", || text(&c) == "Oi").await;
    b.command(&set_text("de Bruno")).await.unwrap();
    until("A and C get Bruno's edit", || {
        text(&a) == "de Bruno" && text(&c) == "de Bruno"
    })
    .await;

    let err = c
        .command(&json!({"t": "member.remove", "key": b.id().to_string()}))
        .await
        .unwrap_err();
    assert!(err.to_string().contains("only the founder"), "{err}");
    a.command(&json!({"t": "member.remove", "key": b.id().to_string()}))
        .await
        .unwrap();
    assert_eq!(members(&a), vec!["Ana", "Carla"]);
    until("C learns Bruno left", || {
        members(&c) == vec!["Ana", "Carla"]
    })
    .await;
    until("B knows it was removed", || {
        b.status()["team"]["member"] == false
    })
    .await;
    let removed = &a.status()["team"]["removed"];
    assert_eq!(removed[0]["name"], "Bruno");
    assert_eq!(a.status()["team"]["canRemove"], true);
    assert_eq!(c.status()["team"]["canRemove"], false);

    b.command(&set_text("depois")).await.unwrap();
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert_eq!(text(&a), "de Bruno");
    assert_eq!(text(&c), "de Bruno");

    let (d, _ed) = start(dirs[3].path(), "Davi").await;
    invite(&a, &d).await;
    until("D replays the history", || text(&d) == "de Bruno").await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_member_rotates_its_key_and_keeps_syncing() {
    let (da, dc) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let (a, _ea) = start(da.path(), "Ana").await;
    let (c, mut ec) = start(dc.path(), "Carla").await;
    a.command(&json!({"t": "team.create", "name": "T"}))
        .await
        .unwrap();
    invite(&a, &c).await;
    a.command(&json!({"t": "share", "doc": "w1", "author": "user", "state": doc()}))
        .await
        .unwrap();
    until("C has the workspace", || text(&c) == "Oi").await;
    wait_for(&mut ec, |v| v["t"] == "peer" && v["state"] == "connected").await;
    c.command(&set_text("chave velha")).await.unwrap();
    until("A gets it", || text(&a) == "chave velha").await;

    let old = c.id();
    let r = c.command(&json!({"t": "key.rotate"})).await.unwrap();
    assert_eq!(r["restart"], true);
    until("A sees the new key", || {
        a.status()["team"]["members"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["key"] == r["new"] && m["name"] == "Carla" && m["rotated"] == true)
    })
    .await;
    c.shutdown().await;
    drop(c);
    let (c, _ec) = start(dc.path(), "Carla").await;
    assert_ne!(c.id(), old);
    assert_eq!(c.id().to_string(), r["new"]);
    assert_eq!(
        text(&c),
        "chave velha",
        "the log signed by the old key still loads"
    );
    c.command(&set_text("chave nova")).await.unwrap();
    until("A gets the edit signed by the new key", || {
        text(&a) == "chave nova"
    })
    .await;
    assert_eq!(members(&a), vec!["Ana", "Carla"]);
}
