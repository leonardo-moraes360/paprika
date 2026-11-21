//! The sidecar's hub: one Iroh endpoint, one connection per team peer, and the commands the Go
//! server sends over stdio.

use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use anyhow::{Context, Result, anyhow, bail};
use iroh::{
    Endpoint, EndpointAddr, EndpointId, SecretKey,
    endpoint::{Connection, RecvStream, SendStream, presets},
    protocol::{AcceptError, ProtocolHandler, Router},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::mpsc;

use crate::proto::{self, ALPN_SYNC};

/// Messages between peers on the sync stream.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum PeerMsg {
    Hello {
        name: String,
        addr: EndpointAddr,
        peers: Vec<EndpointAddr>,
    },
    /// Ephemeral presence (agents' cursors, the person online); never stored.
    Presence { data: Value },
}

/// Events for the Go server (stdout).
pub type Out = mpsc::UnboundedSender<Value>;

#[derive(Debug, Clone)]
pub struct Config {
    pub data: PathBuf,
    pub name: String,
    /// Use Iroh's public relays and DNS address lookup (off in tests: loopback only).
    pub relay: bool,
    pub bind: Option<std::net::SocketAddr>,
}

struct Peer {
    name: String,
    conn: Connection,
    tx: mpsc::UnboundedSender<PeerMsg>,
    /// Who dialed: the connection dialed by the smaller id wins when both sides dial at once.
    dialer: EndpointId,
    since: Instant,
}

#[derive(Default)]
struct State {
    peers: HashMap<EndpointId, Peer>,
    allowed: HashSet<EndpointId>,
    addrs: HashMap<EndpointId, EndpointAddr>,
    names: HashMap<EndpointId, String>,
    presence: HashMap<EndpointId, Value>,
}

#[derive(Clone)]
pub struct Node(Arc<Inner>);

struct Inner {
    cfg: Config,
    key: SecretKey,
    router: Router,
    state: Mutex<State>,
    out: Out,
}

#[derive(Clone)]
struct SyncHandler(std::sync::Weak<Inner>);

impl std::fmt::Debug for SyncHandler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SyncHandler")
    }
}

impl ProtocolHandler for SyncHandler {
    async fn accept(&self, conn: Connection) -> Result<(), AcceptError> {
        let Some(inner) = self.0.upgrade() else {
            return Ok(());
        };
        let node = Node(inner);
        let remote = conn.remote_id();
        if !node.is_allowed(&remote) {
            // Not on the team: close before reading anything.
            conn.close(1u32.into(), b"not a team member");
            node.event(
                json!({"t": "rejected", "peer": remote.to_string(), "reason": "not a team member"}),
            );
            return Ok(());
        }
        let (send, recv) = conn.accept_bi().await?;
        node.run_peer(conn, send, recv, remote).await;
        Ok(())
    }
}

impl Node {
    pub async fn start(cfg: Config, out: Out) -> Result<Self> {
        std::fs::create_dir_all(&cfg.data)
            .with_context(|| format!("creating {}", cfg.data.display()))?;
        let key = crate::keys::load_or_create(&cfg.data)?;
        let mut b = if cfg.relay {
            Endpoint::builder(presets::N0)
        } else {
            Endpoint::builder(presets::Minimal)
                .relay_mode(iroh::RelayMode::Disabled)
                .clear_address_lookup()
        };
        b = b.secret_key(key.clone());
        if let Some(addr) = cfg.bind {
            b = b
                .clear_ip_transports()
                .bind_addr(addr)
                .map_err(|e| anyhow!("bind {addr}: {e}"))?;
        }
        let endpoint = b
            .bind()
            .await
            .map_err(|e| anyhow!("binding the Iroh endpoint: {e}"))?;
        let inner = Arc::new_cyclic(|weak: &std::sync::Weak<Inner>| {
            let router = Router::builder(endpoint)
                .accept(ALPN_SYNC, SyncHandler(weak.clone()))
                .spawn();
            Inner {
                cfg,
                key,
                router,
                state: Mutex::new(State::default()),
                out,
            }
        });
        let node = Node(inner);
        node.spawn_redial();
        node.spawn_status();
        Ok(node)
    }

    pub fn id(&self) -> EndpointId {
        self.0.key.public()
    }

    pub fn endpoint(&self) -> &Endpoint {
        self.0.router.endpoint()
    }

    pub fn addr(&self) -> EndpointAddr {
        self.endpoint().addr()
    }

    pub fn event(&self, v: Value) {
        let _ = self.0.out.send(v);
    }

    pub fn is_allowed(&self, id: &EndpointId) -> bool {
        self.0.state.lock().unwrap().allowed.contains(id)
    }

    pub fn allow(&self, addr: EndpointAddr) {
        let mut st = self.0.state.lock().unwrap();
        if addr.id == self.id() {
            return;
        }
        st.allowed.insert(addr.id);
        let entry = st
            .addrs
            .entry(addr.id)
            .or_insert_with(|| EndpointAddr::new(addr.id));
        entry.addrs.extend(addr.addrs);
    }

    pub async fn shutdown(&self) {
        let _ = self.0.router.shutdown().await;
    }

    /// Dials a peer on the sync ALPN (no-op when already connected).
    pub async fn connect(&self, id: EndpointId) -> Result<()> {
        if id == self.id() || self.0.state.lock().unwrap().peers.contains_key(&id) {
            return Ok(());
        }
        if !self.is_allowed(&id) {
            bail!("{} is not a team member", id.fmt_short());
        }
        let addr = self
            .0
            .state
            .lock()
            .unwrap()
            .addrs
            .get(&id)
            .cloned()
            .unwrap_or_else(|| EndpointAddr::new(id));
        let conn = self
            .endpoint()
            .connect(addr, ALPN_SYNC)
            .await
            .map_err(|e| anyhow!("connecting to {}: {e}", id.fmt_short()))?;
        let (send, recv) = conn.open_bi().await?;
        let node = self.clone();
        tokio::spawn(async move { node.run_peer(conn, send, recv, node.id()).await });
        Ok(())
    }

    async fn run_peer(
        &self,
        conn: Connection,
        mut send: SendStream,
        mut recv: RecvStream,
        dialer: EndpointId,
    ) {
        let remote = conn.remote_id();
        let (tx, mut rx) = mpsc::unbounded_channel::<PeerMsg>();
        // Keep exactly one connection per peer: the one dialed by the smaller id.
        {
            let mut st = self.0.state.lock().unwrap();
            if let Some(old) = st.peers.get(&remote) {
                let preferred = std::cmp::min(self.id(), remote);
                if old.dialer == preferred || dialer != preferred {
                    drop(st);
                    conn.close(0u32.into(), b"duplicate");
                    return;
                }
                old.conn.close(0u32.into(), b"duplicate");
            }
            let name = st.names.get(&remote).cloned().unwrap_or_default();
            st.peers.insert(
                remote,
                Peer {
                    name,
                    conn: conn.clone(),
                    tx: tx.clone(),
                    dialer,
                    since: Instant::now(),
                },
            );
        }
        let _ = tx.send(self.hello());
        for msg in self.on_connect(remote) {
            let _ = tx.send(msg);
        }
        self.event(json!({"t": "peer", "peer": remote.to_string(), "state": "connected"}));
        let writer = tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if proto::write_frame(&mut send, &msg).await.is_err() {
                    break;
                }
            }
            let _ = send.finish();
        });
        loop {
            match proto::read_frame::<PeerMsg>(&mut recv).await {
                Ok(Some(msg)) => {
                    if let Err(e) = self.on_msg(remote, msg) {
                        self.event(json!({"t": "log", "level": "warn", "msg": format!("from {}: {e:#}", remote.fmt_short())}));
                    }
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
        writer.abort();
        let mut st = self.0.state.lock().unwrap();
        if st
            .peers
            .get(&remote)
            .is_some_and(|p| p.conn.stable_id() == conn.stable_id())
        {
            st.peers.remove(&remote);
            st.presence.remove(&remote);
            drop(st);
            self.event(json!({"t": "peer", "peer": remote.to_string(), "state": "disconnected"}));
        }
    }

    fn hello(&self) -> PeerMsg {
        let st = self.0.state.lock().unwrap();
        let peers = st
            .allowed
            .iter()
            .filter_map(|id| st.addrs.get(id).cloned())
            .collect();
        PeerMsg::Hello {
            name: self.0.cfg.name.clone(),
            addr: self.addr(),
            peers,
        }
    }

    /// Extra messages right after the hello (extended by the sync layer).
    fn on_connect(&self, _remote: EndpointId) -> Vec<PeerMsg> {
        let st = self.0.state.lock().unwrap();
        // Last presence of each local agent, so a peer that just connected sees them at once.
        st.presence
            .get(&self.id())
            .map(|p| vec![PeerMsg::Presence { data: p.clone() }])
            .unwrap_or_default()
    }

    fn on_msg(&self, from: EndpointId, msg: PeerMsg) -> Result<()> {
        match msg {
            PeerMsg::Hello { name, addr, peers } => {
                let mut st = self.0.state.lock().unwrap();
                st.names.insert(from, name.clone());
                if let Some(p) = st.peers.get_mut(&from) {
                    p.name = name;
                }
                st.addrs
                    .entry(from)
                    .or_insert_with(|| EndpointAddr::new(from))
                    .addrs
                    .extend(addr.addrs);
                // Learn addresses of other members (only members: the allowlist decides who counts).
                for a in peers {
                    if st.allowed.contains(&a.id) && a.id != self.id() {
                        st.addrs
                            .entry(a.id)
                            .or_insert_with(|| EndpointAddr::new(a.id))
                            .addrs
                            .extend(a.addrs);
                    }
                }
            }
            PeerMsg::Presence { data } => {
                let name = {
                    let mut st = self.0.state.lock().unwrap();
                    st.presence.insert(from, data.clone());
                    st.names.get(&from).cloned().unwrap_or_default()
                };
                self.event(
                    json!({"t": "presence", "peer": from.to_string(), "name": name, "data": data}),
                );
            }
        }
        Ok(())
    }

    pub fn broadcast(&self, msg: PeerMsg, except: Option<EndpointId>) {
        let st = self.0.state.lock().unwrap();
        for (id, p) in &st.peers {
            if Some(*id) != except {
                let _ = p.tx.send(msg.clone());
            }
        }
    }

    fn spawn_redial(&self) {
        let weak = Arc::downgrade(&self.0);
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(3));
            loop {
                tick.tick().await;
                let Some(inner) = weak.upgrade() else { return };
                let node = Node(inner);
                let missing: Vec<EndpointId> = {
                    let st = node.0.state.lock().unwrap();
                    st.allowed
                        .iter()
                        .filter(|id| !st.peers.contains_key(*id))
                        .copied()
                        .collect()
                };
                for id in missing {
                    let n = node.clone();
                    tokio::spawn(async move {
                        let _ = tokio::time::timeout(Duration::from_secs(10), n.connect(id)).await;
                    });
                }
            }
        });
    }

    fn spawn_status(&self) {
        let weak = Arc::downgrade(&self.0);
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(2));
            let mut last = Value::Null;
            loop {
                tick.tick().await;
                let Some(inner) = weak.upgrade() else { return };
                let node = Node(inner);
                let status = node.status();
                if status != last {
                    node.event(json!({"t": "status", "status": status.clone()}));
                    last = status;
                }
            }
        });
    }

    /// Who is on the team and how each one is reached right now.
    pub fn status(&self) -> Value {
        let st = self.0.state.lock().unwrap();
        let mut peers: Vec<Value> = st
            .allowed
            .iter()
            .map(|id| {
                let name = st.names.get(id).cloned().unwrap_or_default();
                match st.peers.get(id) {
                    Some(p) => {
                        let (path, rtt) = path_of(&p.conn);
                        json!({"id": id.to_string(), "name": if p.name.is_empty() { name } else { p.name.clone() },
                               "state": path, "rttMs": rtt, "connectedFor": p.since.elapsed().as_secs(),
                               "presence": st.presence.get(id)})
                    }
                    None => json!({"id": id.to_string(), "name": name, "state": "offline"}),
                }
            })
            .collect();
        peers.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
        json!({"id": self.id().to_string(), "name": self.0.cfg.name, "fingerprint": crate::keys::fingerprint(&self.id()), "peers": peers})
    }

    /// Handles one command from the Go server.
    pub async fn command(&self, cmd: &Value) -> Result<Value> {
        let t = cmd["t"].as_str().unwrap_or_default();
        match t {
            "status" => Ok(self.status()),
            "addr" => Ok(serde_json::to_value(self.addr())?),
            "peer.add" => {
                let addr: EndpointAddr =
                    serde_json::from_value(cmd["addr"].clone()).context("addr")?;
                let id = addr.id;
                self.allow(addr);
                let _ = tokio::time::timeout(Duration::from_secs(10), self.connect(id)).await;
                Ok(json!({"id": id.to_string()}))
            }
            "presence" => {
                let data = cmd["data"].clone();
                self.0
                    .state
                    .lock()
                    .unwrap()
                    .presence
                    .insert(self.id(), data.clone());
                self.broadcast(PeerMsg::Presence { data }, None);
                Ok(Value::Null)
            }
            _ => bail!("unknown command {t:?}"),
        }
    }
}

/// "direct" or "relay" by the selected path, and its round trip in ms.
fn path_of(conn: &Connection) -> (&'static str, Option<u64>) {
    let paths = conn.paths();
    for p in paths.iter() {
        if p.is_selected() {
            let kind = if p.is_relay() { "relay" } else { "direct" };
            return (kind, Some(p.rtt().as_millis() as u64));
        }
    }
    ("connecting", None)
}
