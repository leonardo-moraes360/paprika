//! `paprika-sync`: the team sync sidecar of the Paprika server (ADR 0004).
//!
//! The Go server starts it and talks to it with newline-delimited JSON:
//! commands on stdin (`{"id": 1, "t": "status"}`), replies and events on stdout
//! (`{"t": "reply", "id": 1, "ok": true, "result": …}`, `{"t": "status", …}`).
//! It exits when stdin closes.

use std::path::PathBuf;

use anyhow::{Result, bail};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use paprika_sync::node::{Config, Node};
use paprika_sync::proto::{APP_VERSION, FORMAT_VERSION};

fn usage() -> &'static str {
    "usage: paprika-sync --data DIR [--name NAME] [--no-relay] [--bind ADDR] [--app SEMVER] [--format paprika/N]"
}

fn parse_args() -> Result<Config> {
    let mut data: Option<PathBuf> = None;
    let mut name = String::new();
    let mut relay = true;
    let mut bind = None;
    let mut app = APP_VERSION.to_string();
    let mut format = FORMAT_VERSION.to_string();
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--data" => data = args.next().map(PathBuf::from),
            "--name" => name = args.next().unwrap_or_default(),
            "--no-relay" => relay = false,
            "--bind" => bind = Some(args.next().unwrap_or_default().parse()?),
            "--app" => app = args.next().unwrap_or_default(),
            "--format" => format = args.next().unwrap_or_default(),
            "--version" => {
                println!("paprika-sync {}", env!("CARGO_PKG_VERSION"));
                std::process::exit(0);
            }
            "-h" | "--help" => {
                println!("{}", usage());
                std::process::exit(0);
            }
            other => bail!("unknown argument {other:?}\n{}", usage()),
        }
    }
    let Some(data) = data else {
        bail!("{}", usage())
    };
    Ok(Config {
        data,
        name,
        relay,
        bind,
        app,
        format,
    })
}

#[tokio::main]
async fn main() -> Result<()> {
    let cfg = parse_args()?;
    let (out_tx, mut out_rx) = tokio::sync::mpsc::unbounded_channel::<Value>();
    let writer = tokio::spawn(async move {
        let mut stdout = tokio::io::stdout();
        while let Some(v) = out_rx.recv().await {
            if v.is_null() {
                break; // end marker sent by main after shutdown: everything before it is written
            }
            let mut line = serde_json::to_vec(&v).unwrap_or_default();
            line.push(b'\n');
            if stdout.write_all(&line).await.is_err() || stdout.flush().await.is_err() {
                break;
            }
        }
    });
    let node = Node::start(cfg, out_tx.clone()).await?;
    let _ = out_tx.send(json!({"t": "ready", "id": node.id().to_string(), "addr": node.addr()}));
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let cmd: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                let _ = out_tx.send(json!({"t": "reply", "id": null, "ok": false, "error": format!("invalid JSON: {e}")}));
                continue;
            }
        };
        let node = node.clone();
        let out = out_tx.clone();
        tokio::spawn(async move {
            let id = cmd.get("id").cloned().unwrap_or(Value::Null);
            let reply = match node.command(&cmd).await {
                Ok(result) => json!({"t": "reply", "id": id, "ok": true, "result": result}),
                Err(e) => json!({"t": "reply", "id": id, "ok": false, "error": format!("{e:#}")}),
            };
            let _ = out.send(reply);
        });
    }
    node.shutdown().await;
    // The node and its tasks still hold senders, so the channel never closes on its own:
    // queue an end marker behind the last event instead of waiting for every sender to drop.
    let _ = out_tx.send(Value::Null);
    let _ = writer.await;
    Ok(())
}
