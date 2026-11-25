use std::{
    collections::{BTreeSet, HashMap},
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail};
use iroh::{PublicKey, SecretKey};
use serde_json::Value;

use crate::{
    crdt::{Change, Crdt},
    envelope::{Cert, Envelope},
    keys,
};

pub struct SharedDoc {
    pub crdt: Crdt,
    pub envs: Vec<Envelope>,
    pub have: HashMap<String, BTreeSet<u64>>,
}

impl SharedDoc {
    fn new() -> Self {
        SharedDoc {
            crdt: Crdt::new(),
            envs: Vec::new(),
            have: HashMap::new(),
        }
    }

    pub fn summary(&self) -> HashMap<String, u64> {
        self.have
            .iter()
            .filter_map(|(a, s)| s.last().map(|m| (a.clone(), *m)))
            .collect()
    }

    fn next_seq(&self, author: &str) -> u64 {
        self.have
            .get(author)
            .and_then(|s| s.last())
            .map_or(1, |m| m + 1)
    }
}

pub struct DocStore {
    dir: PathBuf,
    pub docs: HashMap<String, SharedDoc>,
}

pub fn check_doc_id(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        bail!("invalid workspace id {id:?}");
    }
    Ok(())
}

pub fn state_changes(state: &Value) -> Vec<Change> {
    let mut out = Vec::new();
    let nodes = state["nodes"].as_object().cloned().unwrap_or_default();
    fn walk(
        ids: &[Value],
        parent: Option<&str>,
        nodes: &serde_json::Map<String, Value>,
        out: &mut Vec<Change>,
    ) {
        for id in ids.iter().filter_map(Value::as_str) {
            let Some(n) = nodes.get(id).and_then(Value::as_object) else {
                continue;
            };
            let mut fields = n.clone();
            fields.remove("children");
            fields.remove("parentId");
            fields.remove("id");
            out.push(Change::Create {
                id: id.to_string(),
                parent: parent.map(str::to_string),
                fields,
            });
            if let Some(kids) = n.get("children").and_then(Value::as_array) {
                walk(kids, Some(id), nodes, out);
            }
        }
    }
    walk(
        state["rootIds"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[]),
        None,
        &nodes,
        &mut out,
    );
    if let Some(t) = state["tokens"].as_object()
        && !t.is_empty()
    {
        out.push(Change::Tokens {
            mode: String::new(),
            set: t.clone(),
        });
    }
    if let Some(modes) = state["modes"].as_object() {
        for (m, t) in modes {
            if let Some(t) = t.as_object() {
                out.push(Change::Tokens {
                    mode: m.clone(),
                    set: t.clone(),
                });
            }
        }
    }
    if let Some(name) = state["name"].as_str() {
        out.push(Change::Name {
            value: name.to_string(),
        });
    }
    if let Some(pins) = state["pins"].as_object() {
        for (id, v) in pins {
            if !v.is_null() {
                out.push(Change::Pin {
                    id: id.clone(),
                    value: v.clone(),
                });
            }
        }
    }
    if let Some(replies) = state["replies"].as_object() {
        for (id, v) in replies {
            if !v.is_null() {
                out.push(Change::Reply {
                    id: id.clone(),
                    value: v.clone(),
                });
            }
        }
    }
    out
}

#[derive(Debug, PartialEq, Eq)]
pub enum Accepted {
    New,
    Known,
}

impl DocStore {
    pub fn open(data: &Path) -> Result<Self> {
        let dir = data.join("docs");
        fs::create_dir_all(&dir)?;
        let mut docs = HashMap::new();
        for entry in fs::read_dir(&dir)? {
            let path = entry?.path();
            if path.extension().and_then(|e| e.to_str()) != Some("log") {
                continue;
            }
            let id = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_string();
            if check_doc_id(&id).is_err() {
                continue;
            }
            let mut doc = SharedDoc::new();
            let text =
                fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
            for line in text.lines().filter(|l| !l.trim().is_empty()) {
                let Ok(env) = serde_json::from_str::<Envelope>(line) else {
                    continue;
                };
                if let Ok((blob, _)) = env.verify() {
                    let _ = doc.crdt.import(&blob);
                    doc.have
                        .entry(env.author.clone())
                        .or_default()
                        .insert(env.seq);
                    doc.envs.push(env);
                }
            }
            docs.insert(id, doc);
        }
        Ok(DocStore { dir, docs })
    }

    fn append(&self, env: &Envelope) -> Result<()> {
        let path = self.dir.join(format!("{}.log", env.doc));
        let mut f = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)?;
        let mut line = serde_json::to_vec(env)?;
        line.push(b'\n');
        f.write_all(&line)?;
        Ok(())
    }

    pub fn is_shared(&self, doc: &str) -> bool {
        self.docs.contains_key(doc)
    }

    pub fn local(
        &mut self,
        doc: &str,
        author: &SecretKey,
        cert: Option<Cert>,
        changes: &[Change],
    ) -> Result<Option<Envelope>> {
        check_doc_id(doc)?;
        let shared = self
            .docs
            .get(doc)
            .with_context(|| format!("workspace {doc} is not shared with the team"))?;
        let a = author.public().to_string();
        let seq = shared.next_seq(&a);
        let Some(blob) = shared
            .crdt
            .apply_local(keys::peer_id(&author.public()), changes)?
        else {
            return Ok(None);
        };
        let env = Envelope::sign(doc, author, seq, &blob, cert);
        self.append(&env)?;
        let shared = self.docs.get_mut(doc).unwrap();
        shared.have.entry(a).or_default().insert(seq);
        shared.envs.push(env.clone());
        Ok(Some(env))
    }

    pub fn share(
        &mut self,
        doc: &str,
        author: &SecretKey,
        cert: Option<Cert>,
        state: &Value,
    ) -> Result<Envelope> {
        check_doc_id(doc)?;
        if self.docs.contains_key(doc) {
            bail!("workspace {doc} is already shared");
        }
        self.docs.insert(doc.to_string(), SharedDoc::new());
        match self.local(doc, author, cert, &state_changes(state)) {
            Ok(Some(env)) => Ok(env),
            Ok(None) => {
                self.docs.remove(doc);
                bail!("nothing to share")
            }
            Err(e) => {
                self.docs.remove(doc);
                Err(e)
            }
        }
    }

    pub fn accept(
        &mut self,
        env: &Envelope,
        allowed: impl Fn(&PublicKey, &Envelope) -> bool,
    ) -> Result<Accepted> {
        check_doc_id(&env.doc)?;
        if self
            .docs
            .get(&env.doc)
            .and_then(|d| d.have.get(&env.author))
            .is_some_and(|s| s.contains(&env.seq))
        {
            return Ok(Accepted::Known);
        }
        let (blob, member) = env.verify()?;
        if !allowed(&member, env) {
            bail!("{} is not a team member", member.fmt_short());
        }
        let shared = self
            .docs
            .entry(env.doc.clone())
            .or_insert_with(SharedDoc::new);
        shared.crdt.import(&blob)?;
        shared
            .have
            .entry(env.author.clone())
            .or_default()
            .insert(env.seq);
        shared.envs.push(env.clone());
        self.append(env)?;
        Ok(Accepted::New)
    }

    pub fn missing_for(&self, have: &HashMap<String, HashMap<String, u64>>) -> Vec<Envelope> {
        let mut out = Vec::new();
        for (id, doc) in &self.docs {
            let theirs = have.get(id);
            for env in &doc.envs {
                let max = theirs
                    .and_then(|t| t.get(&env.author))
                    .copied()
                    .unwrap_or(0);
                if env.seq > max {
                    out.push(env.clone());
                }
            }
        }
        out
    }

    pub fn cut_for(&self, member: &str) -> crate::team::Upto {
        let mut out = crate::team::Upto::new();
        for (id, doc) in &self.docs {
            for env in &doc.envs {
                let m = env
                    .cert
                    .as_ref()
                    .map_or(env.author.as_str(), |c| c.member.as_str());
                if m == member {
                    let max = out
                        .entry(id.clone())
                        .or_default()
                        .entry(env.author.clone())
                        .or_insert(0);
                    *max = (*max).max(env.seq);
                }
            }
        }
        out
    }

    pub fn summary(&self) -> HashMap<String, HashMap<String, u64>> {
        self.docs
            .iter()
            .map(|(id, d)| (id.clone(), d.summary()))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn share_local_reload_and_catch_up() {
        let dir = tempfile::tempdir().unwrap();
        let ana = SecretKey::from_bytes(&[1; 32]);
        let mut s = DocStore::open(dir.path()).unwrap();
        let state = json!({"name": "D", "rootIds": ["f"], "nodes": {"f": {"type": "frame", "name": "F", "children": ["r"], "parentId": null},
                           "r": {"type": "rect", "name": "R", "parentId": "f"}}, "tokens": {"a": 1}, "modes": {}});
        s.share("d1", &ana, None, &state).unwrap();
        s.local(
            "d1",
            &ana,
            None,
            &[Change::Set {
                id: "r".into(),
                fields: serde_json::from_value(json!({"fill": "#fff"})).unwrap(),
            }],
        )
        .unwrap();
        let m = s.docs["d1"].crdt.materialize();
        assert_eq!(m["nodes"]["f"]["children"], json!(["r"]));
        assert_eq!(m["nodes"]["r"]["fill"], json!("#fff"));

        let s2 = DocStore::open(dir.path()).unwrap();
        assert_eq!(s2.docs["d1"].crdt.materialize(), m);

        let mut have = HashMap::new();
        assert_eq!(s2.missing_for(&have).len(), 2);
        have.insert(
            "d1".to_string(),
            HashMap::from([(ana.public().to_string(), 1)]),
        );
        assert_eq!(
            s2.missing_for(&have)
                .iter()
                .map(|e| e.seq)
                .collect::<Vec<_>>(),
            vec![2]
        );

        let dir2 = tempfile::tempdir().unwrap();
        let mut other = DocStore::open(dir2.path()).unwrap();
        for env in s2.missing_for(&HashMap::new()) {
            assert_eq!(other.accept(&env, |_, _| true).unwrap(), Accepted::New);
            assert_eq!(other.accept(&env, |_, _| true).unwrap(), Accepted::Known);
        }
        assert_eq!(other.docs["d1"].crdt.materialize(), m);
    }

    #[test]
    fn strangers_envelopes_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let eve = SecretKey::from_bytes(&[6; 32]);
        let mut a = DocStore::open(dir.path()).unwrap();
        let env = a
            .share(
                "d",
                &eve,
                None,
                &json!({"name": "x", "rootIds": [], "nodes": {}}),
            )
            .unwrap();
        let dir2 = tempfile::tempdir().unwrap();
        let mut b = DocStore::open(dir2.path()).unwrap();
        assert!(b.accept(&env, |_, _| false).is_err());
        assert!(!b.is_shared("d"));
    }
}
