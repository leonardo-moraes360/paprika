use std::time::Duration;

use paprika_sync::node::{Config, Node};
use serde_json::Value;
use tokio::sync::mpsc;

pub async fn start(dir: &std::path::Path, name: &str) -> (Node, mpsc::UnboundedReceiver<Value>) {
    let (tx, rx) = mpsc::unbounded_channel();
    (
        Node::start(Config::test(dir.to_path_buf(), name), tx)
            .await
            .unwrap(),
        rx,
    )
}

pub async fn start_with(
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

pub async fn wait_for(
    rx: &mut mpsc::UnboundedReceiver<Value>,
    pred: impl Fn(&Value) -> bool,
) -> Value {
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
