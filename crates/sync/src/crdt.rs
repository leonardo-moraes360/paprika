//! One shared workspace as a Loro document (ADR 0004).
//!
//! - `nodes` (`LoroTree`): one tree node per Paprika node. Parent = `parentId`, sibling order =
//!   `children` / `rootIds` (fractional index). The tree node's metadata map holds the Paprika
//!   node's stored fields, each as a JSON string under its own key (last writer wins per field).
//! - `doc` (`LoroMap`): `name`.
//! - `tokens` (`LoroMap`): token → JSON value. `modes` (`LoroMap`): `"<mode>\u{0}<token>"` → JSON
//!   value, flat so two peers adding the same mode at once never race on a nested container.
//! - `pins` (`LoroMap`): pin id → JSON header (last writer wins). `replies` (`LoroMap`): reply id →
//!   JSON. Pins are not canvas nodes.

use std::collections::{HashMap, HashSet};

use anyhow::{Context, Result, anyhow, bail};
use loro::{ExportMode, LoroDoc, LoroMap, LoroTree, LoroValue, TreeID, ValueOrContainer};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

/// One entry of a change set sent by the Go server after a local commit.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "k", rename_all = "snake_case")]
pub enum Change {
    Delete {
        id: String,
    },
    Create {
        id: String,
        parent: Option<String>,
        fields: Map<String, Value>,
    },
    Move {
        id: String,
        parent: Option<String>,
    },
    Set {
        id: String,
        fields: Map<String, Value>,
    },
    Order {
        parent: Option<String>,
        children: Vec<String>,
    },
    Tokens {
        #[serde(default)]
        mode: String,
        set: Map<String, Value>,
    },
    Name {
        value: String,
    },
    /// Pin header. A null `value` removes the pin from the shared map.
    Pin {
        id: String,
        value: Value,
    },
    /// One reply. A null `value` removes it. Replies are their own keys so two peers can both add one.
    Reply {
        id: String,
        value: Value,
    },
}

pub struct Crdt {
    pub doc: LoroDoc,
}

const MODE_SEP: char = '\u{0}';

impl Default for Crdt {
    fn default() -> Self {
        Self::new()
    }
}

impl Crdt {
    pub fn new() -> Self {
        let doc = LoroDoc::new();
        doc.get_tree("nodes").enable_fractional_index(0);
        Crdt { doc }
    }

    fn tree(&self) -> LoroTree {
        self.doc.get_tree("nodes")
    }

    /// Paprika id → tree node, for the live tree (deleted subtrees are not reachable from roots).
    /// When two peers created the same id concurrently, the first in tree order wins (the same
    /// rule `materialize` uses, so every peer agrees).
    fn index(&self) -> HashMap<String, TreeID> {
        let tree = self.tree();
        let mut out = HashMap::new();
        let mut stack: Vec<TreeID> = tree.roots();
        stack.reverse();
        while let Some(t) = stack.pop() {
            if let Some(id) = self.meta_id(&tree, t) {
                out.entry(id).or_insert(t);
            }
            if let Some(mut kids) = tree.children(t) {
                kids.reverse();
                stack.extend(kids);
            }
        }
        out
    }

    fn meta_id(&self, tree: &LoroTree, t: TreeID) -> Option<String> {
        let meta = tree.get_meta(t).ok()?;
        let raw = map_string(&meta, "id")?;
        serde_json::from_str::<String>(&raw).ok()
    }

    /// Applies one local transaction as one Loro commit made by `peer`, and returns the update
    /// (only this commit's changes) to put in an envelope. `None` when nothing changed.
    pub fn apply_local(&self, peer: u64, changes: &[Change]) -> Result<Option<Vec<u8>>> {
        let before = self.doc.oplog_vv();
        self.doc
            .set_peer_id(peer)
            .map_err(|e| anyhow!("set_peer_id: {e}"))?;
        let tree = self.tree();
        let mut idx = self.index();
        let lookup = |idx: &HashMap<String, TreeID>, id: &str| {
            idx.get(id)
                .copied()
                .ok_or_else(|| anyhow!("node {id:?} is not in the shared document"))
        };
        let parent_of =
            |idx: &HashMap<String, TreeID>, p: &Option<String>| -> Result<Option<TreeID>> {
                match p {
                    None => Ok(None),
                    Some(p) => Ok(Some(lookup(idx, p)?)),
                }
            };
        for ch in changes {
            match ch {
                Change::Delete { id } => {
                    if let Some(t) = idx.remove(id) {
                        tree.delete(t).map_err(|e| anyhow!("delete {id}: {e}"))?;
                    }
                }
                Change::Create { id, parent, fields } => {
                    let p = parent_of(&idx, parent)?;
                    let t = tree.create(p).map_err(|e| anyhow!("create {id}: {e}"))?;
                    let meta = tree.get_meta(t).map_err(|e| anyhow!("{e}"))?;
                    meta.insert("id", Value::String(id.clone()).to_string())
                        .map_err(|e| anyhow!("{e}"))?;
                    for (k, v) in fields {
                        if k == "id" || k == "parentId" || k == "children" || v.is_null() {
                            continue;
                        }
                        meta.insert(k, v.to_string()).map_err(|e| anyhow!("{e}"))?;
                    }
                    idx.insert(id.clone(), t);
                }
                Change::Move { id, parent } => {
                    let t = lookup(&idx, id)?;
                    let p = parent_of(&idx, parent)?;
                    tree.mov(t, p).map_err(|e| anyhow!("move {id}: {e}"))?;
                }
                Change::Set { id, fields } => {
                    let t = lookup(&idx, id)?;
                    let meta = tree.get_meta(t).map_err(|e| anyhow!("{e}"))?;
                    for (k, v) in fields {
                        if k == "id" || k == "parentId" || k == "children" {
                            continue;
                        }
                        if v.is_null() {
                            meta.delete(k).map_err(|e| anyhow!("{e}"))?;
                        } else {
                            meta.insert(k, v.to_string()).map_err(|e| anyhow!("{e}"))?;
                        }
                    }
                }
                Change::Order { parent, children } => {
                    let p = parent_of(&idx, parent)?;
                    for (i, id) in children.iter().enumerate() {
                        let Some(&t) = idx.get(id) else { continue };
                        let cur = tree.children(p).unwrap_or_default();
                        if cur.get(i) != Some(&t) {
                            let to = i.min(cur.len().saturating_sub(usize::from(cur.contains(&t))));
                            tree.mov_to(t, p, to)
                                .map_err(|e| anyhow!("order {id}: {e}"))?;
                        }
                    }
                }
                Change::Tokens { mode, set } => {
                    let (map, prefix) = if mode.is_empty() {
                        (self.doc.get_map("tokens"), String::new())
                    } else {
                        (self.doc.get_map("modes"), format!("{mode}{MODE_SEP}"))
                    };
                    for (k, v) in set {
                        let key = format!("{prefix}{k}");
                        if v.is_null() {
                            map.delete(&key).map_err(|e| anyhow!("{e}"))?;
                        } else {
                            map.insert(&key, v.to_string())
                                .map_err(|e| anyhow!("{e}"))?;
                        }
                    }
                }
                Change::Name { value } => {
                    self.doc
                        .get_map("doc")
                        .insert("name", value.as_str())
                        .map_err(|e| anyhow!("{e}"))?;
                }
                Change::Pin { id, value } => {
                    write_json_map(&self.doc.get_map("pins"), &id, &value)?
                }
                Change::Reply { id, value } => {
                    write_json_map(&self.doc.get_map("replies"), &id, &value)?
                }
            }
        }
        self.doc.commit();
        if self.doc.oplog_vv() == before {
            return Ok(None);
        }
        let blob = self
            .doc
            .export(ExportMode::updates(&before))
            .map_err(|e| anyhow!("export: {e}"))?;
        Ok(Some(blob))
    }

    /// Imports an update from a peer (Loro keeps it pending until its dependencies arrive).
    pub fn import(&self, blob: &[u8]) -> Result<()> {
        self.doc.import(blob).map_err(|e| anyhow!("import: {e}"))?;
        Ok(())
    }

    /// The workspace as the Go server needs it: `{name, rootIds, nodes, tokens, modes}`.
    pub fn materialize(&self) -> Value {
        let tree = self.tree();
        let mut nodes = Map::new();
        let mut seen = HashSet::new();
        let roots = self.walk(&tree, None, None, &mut nodes, &mut seen);
        let mut tokens = Map::new();
        for (k, v) in map_entries(&self.doc.get_map("tokens")) {
            tokens.insert(k, v);
        }
        let mut modes: Map<String, Value> = Map::new();
        for (k, v) in map_entries(&self.doc.get_map("modes")) {
            if let Some((mode, tok)) = k.split_once(MODE_SEP) {
                let m = modes
                    .entry(mode.to_string())
                    .or_insert_with(|| Value::Object(Map::new()));
                m.as_object_mut().unwrap().insert(tok.to_string(), v);
            }
        }
        let name = map_raw_str(&self.doc.get_map("doc"), "name").unwrap_or_default();
        let pins = json_map(&self.doc.get_map("pins"));
        let replies = json_map(&self.doc.get_map("replies"));
        json!({"name": name, "rootIds": roots, "nodes": nodes, "tokens": tokens, "modes": modes, "pins": pins, "replies": replies})
    }

    fn walk(
        &self,
        tree: &LoroTree,
        parent: Option<TreeID>,
        parent_id: Option<&str>,
        out: &mut Map<String, Value>,
        seen: &mut HashSet<String>,
    ) -> Vec<Value> {
        let mut ids = Vec::new();
        for t in tree.children(parent).unwrap_or_default() {
            let Ok(meta) = tree.get_meta(t) else { continue };
            let mut fields = Map::new();
            for (k, v) in map_entries(&meta) {
                fields.insert(k, v);
            }
            let Some(Value::String(id)) = fields.get("id").cloned() else {
                continue;
            };
            if !seen.insert(id.clone()) {
                continue; // concurrent duplicate id: the first one in tree order wins
            }
            fields.insert(
                "parentId".into(),
                parent_id.map_or(Value::Null, |p| Value::String(p.into())),
            );
            let ty = fields
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if matches!(ty.as_str(), "frame" | "group" | "page") {
                let kids = self.walk(tree, Some(t), Some(&id), out, seen);
                fields.insert("children".into(), Value::Array(kids));
            }
            out.insert(id.clone(), Value::Object(fields));
            ids.push(Value::String(id));
        }
        ids
    }

    /// Full state, to persist next to the envelope log (faster restarts) or seed a test.
    pub fn snapshot(&self) -> Result<Vec<u8>> {
        self.doc.export(ExportMode::Snapshot).context("snapshot")
    }
}

fn write_json_map(map: &LoroMap, key: &str, value: &Value) -> Result<()> {
    if value.is_null() {
        map.delete(key).ok();
        return Ok(());
    }
    map.insert(key, value.to_string())
        .map_err(|e| anyhow!("{e}"))?;
    Ok(())
}

fn json_map(map: &LoroMap) -> Map<String, Value> {
    let mut out = Map::new();
    for (k, v) in map_entries(map) {
        out.insert(k, v);
    }
    out
}

fn map_string(map: &LoroMap, key: &str) -> Option<String> {
    match map.get(key)? {
        ValueOrContainer::Value(LoroValue::String(s)) => Some(s.to_string()),
        _ => None,
    }
}

fn map_raw_str(map: &LoroMap, key: &str) -> Option<String> {
    map_string(map, key)
}

/// Entries of a map whose values are JSON strings, decoded; keys sorted for determinism.
fn map_entries(map: &LoroMap) -> Vec<(String, Value)> {
    let mut out = Vec::new();
    if let LoroValue::Map(m) = map.get_value() {
        for (k, v) in m.iter() {
            if let LoroValue::String(s) = v
                && let Ok(val) = serde_json::from_str::<Value>(s)
            {
                out.push((k.to_string(), val));
            }
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

/// Which peers an update carries changes from (checked against the envelope's author).
pub fn blob_peers(blob: &[u8]) -> Result<Vec<u64>> {
    let meta = LoroDoc::decode_import_blob_meta(blob, true)
        .map_err(|e| anyhow!("not a Loro update: {e}"))?;
    let mut peers: Vec<u64> = meta.partial_end_vv.keys().copied().collect();
    peers.sort_unstable();
    peers.dedup();
    if peers.is_empty() {
        bail!("empty update");
    }
    Ok(peers)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ch(v: Value) -> Vec<Change> {
        serde_json::from_value(v).unwrap()
    }

    fn sync(a: &Crdt, b: &Crdt) {
        b.import(&a.doc.export(ExportMode::all_updates()).unwrap())
            .unwrap();
        a.import(&b.doc.export(ExportMode::all_updates()).unwrap())
            .unwrap();
    }

    #[test]
    fn create_set_order_and_materialize() {
        let c = Crdt::new();
        c.apply_local(1, &ch(json!([
            {"k": "create", "id": "f", "parent": null, "fields": {"type": "frame", "name": "F", "width": 100}},
            {"k": "create", "id": "a", "parent": "f", "fields": {"type": "rect", "name": "A"}},
            {"k": "create", "id": "b", "parent": "f", "fields": {"type": "rect", "name": "B"}},
            {"k": "order", "parent": "f", "children": ["b", "a"]},
            {"k": "tokens", "set": {"accent": "#e04a2b"}},
            {"k": "tokens", "mode": "dark", "set": {"accent": "#000"}},
            {"k": "name", "value": "Doc"}
        ]))).unwrap().unwrap();
        let s = c.materialize();
        assert_eq!(s["rootIds"], json!(["f"]));
        assert_eq!(s["nodes"]["f"]["children"], json!(["b", "a"]));
        assert_eq!(s["nodes"]["a"]["parentId"], json!("f"));
        assert_eq!(s["nodes"]["f"]["width"], json!(100));
        assert_eq!(s["tokens"]["accent"], json!("#e04a2b"));
        assert_eq!(s["modes"]["dark"]["accent"], json!("#000"));
        assert_eq!(s["name"], json!("Doc"));

        c.apply_local(1, &ch(json!([{"k": "set", "id": "a", "fields": {"name": "A2", "fill": "#fff"}}, {"k": "set", "id": "a", "fields": {"fill": null}}]))).unwrap();
        let s = c.materialize();
        assert_eq!(s["nodes"]["a"]["name"], json!("A2"));
        assert!(s["nodes"]["a"].get("fill").is_none());
        assert!(
            c.apply_local(1, &[]).unwrap().is_none(),
            "no change, no update"
        );
    }

    #[test]
    fn concurrent_field_edits_merge_and_converge() {
        let a = Crdt::new();
        a.apply_local(1, &ch(json!([{"k": "create", "id": "r", "parent": null, "fields": {"type": "rect", "name": "R"}}]))).unwrap();
        let b = Crdt::new();
        sync(&a, &b);
        a.apply_local(
            1,
            &ch(json!([{"k": "set", "id": "r", "fields": {"fill": "#f00"}}])),
        )
        .unwrap();
        b.apply_local(
            2,
            &ch(json!([{"k": "set", "id": "r", "fields": {"name": "Renamed"}}])),
        )
        .unwrap();
        sync(&a, &b);
        assert_eq!(a.materialize(), b.materialize());
        assert_eq!(a.materialize()["nodes"]["r"]["fill"], json!("#f00"));
        assert_eq!(a.materialize()["nodes"]["r"]["name"], json!("Renamed"));
    }

    #[test]
    fn concurrent_moves_never_make_cycles() {
        let a = Crdt::new();
        a.apply_local(
            1,
            &ch(json!([
                {"k": "create", "id": "x", "parent": null, "fields": {"type": "frame"}},
                {"k": "create", "id": "y", "parent": null, "fields": {"type": "frame"}}
            ])),
        )
        .unwrap();
        let b = Crdt::new();
        sync(&a, &b);
        a.apply_local(1, &ch(json!([{"k": "move", "id": "x", "parent": "y"}])))
            .unwrap();
        b.apply_local(2, &ch(json!([{"k": "move", "id": "y", "parent": "x"}])))
            .unwrap();
        sync(&a, &b);
        let s = a.materialize();
        assert_eq!(s, b.materialize());
        // Exactly one of them stays at the top, holding the other.
        assert_eq!(s["rootIds"].as_array().unwrap().len(), 1);
        assert_eq!(s["nodes"].as_object().unwrap().len(), 2);
    }

    #[test]
    fn delete_vs_edit_converges_on_delete() {
        let a = Crdt::new();
        a.apply_local(
            1,
            &ch(json!([{"k": "create", "id": "r", "parent": null, "fields": {"type": "rect"}}])),
        )
        .unwrap();
        let b = Crdt::new();
        sync(&a, &b);
        a.apply_local(1, &ch(json!([{"k": "delete", "id": "r"}])))
            .unwrap();
        b.apply_local(
            2,
            &ch(json!([{"k": "set", "id": "r", "fields": {"fill": "#000"}}])),
        )
        .unwrap();
        sync(&a, &b);
        assert_eq!(a.materialize(), b.materialize());
        assert!(a.materialize()["nodes"].as_object().unwrap().is_empty());
    }

    #[test]
    fn blob_names_its_peer() {
        let c = Crdt::new();
        let blob = c
            .apply_local(42, &ch(json!([{"k": "name", "value": "x"}])))
            .unwrap()
            .unwrap();
        assert_eq!(blob_peers(&blob).unwrap(), vec![42]);
    }

    #[test]
    fn pin_replies_from_two_peers_both_survive() {
        let a = Crdt::new();
        a.apply_local(
            1,
            &ch(json!([
                {"k": "name", "value": "D"},
                {"k": "pin", "id": "p1", "value": {"text": "maior", "status": "open"}}
            ])),
        )
        .unwrap();
        let b = Crdt::new();
        sync(&a, &b);
        a.apply_local(
            1,
            &ch(json!([{"k": "reply", "id": "r1", "value": {"pinId": "p1", "text": "feito"}}])),
        )
        .unwrap();
        b.apply_local(
            2,
            &ch(json!([{"k": "reply", "id": "r2", "value": {"pinId": "p1", "text": "e o peso?"}}])),
        )
        .unwrap();
        sync(&a, &b);
        let s = a.materialize();
        assert_eq!(s, b.materialize());
        assert_eq!(s["pins"]["p1"]["text"], json!("maior"));
        assert_eq!(s["replies"]["r1"]["text"], json!("feito"));
        assert_eq!(s["replies"]["r2"]["text"], json!("e o peso?"));
    }
}
