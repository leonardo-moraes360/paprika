//! The team file (allowlist of member keys) and invites (ADR 0004, docs/team-sync.md).

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use anyhow::{Context, Result, anyhow, bail};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD as B64URL};
use iroh::{EndpointAddr, PublicKey, SecretKey};
use serde::{Deserialize, Serialize};

use crate::keys;

pub fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberEntry {
    pub key: String,
    pub name: String,
    pub added_by: String,
    pub at: u64,
    pub sig: String,
}

/// workspace → author key → highest sequence number still accepted from a key that left.
pub type Upto = BTreeMap<String, BTreeMap<String, u64>>;

/// The founder (or a key it rotated to) takes a member out of the team. Envelopes of that
/// member (and of its agents) are still accepted up to `upto`, so a newcomer can replay the
/// history; anything later is refused.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Removal {
    pub key: String,
    pub by: String,
    pub at: u64,
    #[serde(default)]
    pub upto: Upto,
    pub sig: String,
}

/// A member replaces its key: signed by the old and by the new key. The new key inherits the
/// name and the rights; the old one is retired (accepted up to `upto`, like a removal).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rotation {
    pub old: String,
    pub new: String,
    pub at: u64,
    #[serde(default)]
    pub upto: Upto,
    pub sig_old: String,
    pub sig_new: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TeamFile {
    pub id: String,
    pub name: String,
    pub founder: String,
    pub nonce: String,
    pub members: Vec<MemberEntry>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub removals: Vec<Removal>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rotations: Vec<Rotation>,
}

/// Why a key that once was a member no longer is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Left {
    Removed(Removal),
    Rotated(Rotation),
}

impl Left {
    pub fn at(&self) -> u64 {
        match self {
            Left::Removed(r) => r.at,
            Left::Rotated(r) => r.at,
        }
    }
    pub fn upto(&self) -> &Upto {
        match self {
            Left::Removed(r) => &r.upto,
            Left::Rotated(r) => &r.upto,
        }
    }
}

/// Every key the team file vouches for, split into who is a member now and who left.
#[derive(Debug, Clone, Default)]
pub struct Roster {
    /// Current members.
    pub members: HashMap<PublicKey, MemberEntry>,
    /// Keys that were members and left (removed, or replaced by a new key).
    pub left: HashMap<PublicKey, (MemberEntry, Left)>,
    /// The founder key and the keys it rotated to, oldest first; the last one is the founder now.
    pub founders: Vec<PublicKey>,
}

impl Roster {
    pub fn founder(&self) -> Option<&PublicKey> {
        self.founders.last()
    }

    /// Whether an envelope of `member` (authored by `author`, number `seq`) is still accepted.
    pub fn accepts(&self, member: &PublicKey, doc: &str, author: &str, seq: u64) -> bool {
        if self.members.contains_key(member) {
            return true;
        }
        self.left.get(member).is_some_and(|(_, l)| {
            l.upto()
                .get(doc)
                .and_then(|a| a.get(author))
                .is_some_and(|max| seq <= *max)
        })
    }
}

fn team_id(founder: &str, nonce: &str) -> String {
    hex::encode(&keys::sha256(&[b"paprika-team/1", founder.as_bytes(), nonce.as_bytes()])[..16])
}

fn member_bytes(team: &str, key: &str, name: &str, added_by: &str, at: u64) -> Vec<u8> {
    [
        b"paprika-member/1".as_slice(),
        team.as_bytes(),
        key.as_bytes(),
        name.as_bytes(),
        added_by.as_bytes(),
        at.to_string().as_bytes(),
    ]
    .join(&b'\n')
}

fn upto_json(upto: &Upto) -> Vec<u8> {
    // BTreeMap: keys are sorted, so the JSON is canonical.
    serde_json::to_vec(upto).unwrap_or_default()
}

fn removal_bytes(team: &str, key: &str, by: &str, at: u64, upto: &Upto) -> Vec<u8> {
    [
        b"paprika-remove/1".as_slice(),
        team.as_bytes(),
        key.as_bytes(),
        by.as_bytes(),
        at.to_string().as_bytes(),
        &upto_json(upto),
    ]
    .join(&b'\n')
}

fn rotation_bytes(team: &str, old: &str, new: &str, at: u64, upto: &Upto) -> Vec<u8> {
    [
        b"paprika-rotate/1".as_slice(),
        team.as_bytes(),
        old.as_bytes(),
        new.as_bytes(),
        at.to_string().as_bytes(),
        &upto_json(upto),
    ]
    .join(&b'\n')
}

impl Removal {
    fn verifies(&self, team: &str) -> bool {
        keys::parse_public(&self.by).is_ok_and(|by| {
            keys::verify(
                &by,
                &removal_bytes(team, &self.key, &self.by, self.at, &self.upto),
                &self.sig,
            )
            .is_ok()
        }) && keys::parse_public(&self.key).is_ok()
    }
}

impl Rotation {
    fn verifies(&self, team: &str) -> bool {
        let bytes = rotation_bytes(team, &self.old, &self.new, self.at, &self.upto);
        let (Ok(old), Ok(new)) = (keys::parse_public(&self.old), keys::parse_public(&self.new))
        else {
            return false;
        };
        old != new
            && keys::verify(&old, &bytes, &self.sig_old).is_ok()
            && keys::verify(&new, &bytes, &self.sig_new).is_ok()
    }
}

impl TeamFile {
    /// A new team whose founder (and first member) is `founder`.
    pub fn create(founder: &SecretKey, team_name: &str, member_name: &str) -> Self {
        let f = founder.public().to_string();
        let nonce = hex::encode(keys::random32());
        let id = team_id(&f, &nonce);
        let mut t = TeamFile {
            id,
            name: team_name.to_string(),
            founder: f,
            nonce,
            members: vec![],
            removals: vec![],
            rotations: vec![],
        };
        let entry = t.sign_entry(founder, &founder.public(), member_name);
        t.members.push(entry);
        t
    }

    fn sign_entry(&self, by: &SecretKey, key: &PublicKey, name: &str) -> MemberEntry {
        let (k, b, at) = (key.to_string(), by.public().to_string(), now());
        let sig = hex::encode(
            by.sign(&member_bytes(&self.id, &k, name, &b, at))
                .to_bytes(),
        );
        MemberEntry {
            key: k,
            name: name.to_string(),
            added_by: b,
            at,
            sig,
        }
    }

    /// The id must come from the founder key and the nonce: nobody else can claim a team.
    pub fn check_id(&self) -> Result<()> {
        if team_id(&self.founder, &self.nonce) != self.id {
            bail!("team id does not match its founder");
        }
        Ok(())
    }

    /// Current members: entries that chain back to the founder through valid signatures, minus
    /// the keys that were removed or rotated away.
    pub fn members(&self) -> HashMap<PublicKey, MemberEntry> {
        self.roster().members
    }

    /// Who the team file vouches for (docs/team-sync.md, "Removing a member, rotating a key"):
    /// 1. the founder chain: the founder key, then each key it rotated to;
    /// 2. removals signed by a founder-chain key, of a key outside that chain;
    /// 3. rotations signed by both keys, the first one per old key winning, unless the old key
    ///    was removed before it;
    /// 4. entries only count when their signer had not left before their `at` (same second counts).
    pub fn roster(&self) -> Roster {
        let mut r = Roster::default();
        if self.check_id().is_err() {
            return r;
        }
        let Ok(founder) = keys::parse_public(&self.founder) else {
            return r;
        };
        let mut rots: Vec<&Rotation> = self
            .rotations
            .iter()
            .filter(|x| x.verifies(&self.id))
            .collect();
        rots.sort_by(|a, b| (a.at, &a.new).cmp(&(b.at, &b.new)));
        // 1. Founder chain.
        r.founders.push(founder);
        loop {
            let cur = r.founders.last().unwrap().to_string();
            let Some(next) = rots
                .iter()
                .find(|x| x.old == cur)
                .and_then(|x| keys::parse_public(&x.new).ok())
            else {
                break;
            };
            if r.founders.contains(&next) {
                break;
            }
            r.founders.push(next);
        }
        let chain: HashSet<String> = r.founders.iter().map(|k| k.to_string()).collect();
        // 2. Removals: the earliest valid one per key.
        let mut removed: HashMap<String, &Removal> = HashMap::new();
        for x in &self.removals {
            if chain.contains(&x.key) || !x.verifies(&self.id) {
                continue;
            }
            let founder_remove = chain.contains(&x.by);
            let self_leave = x.by == x.key;
            if !founder_remove && !self_leave {
                continue;
            }
            match removed.get(&x.key) {
                Some(prev) if prev.at <= x.at => {}
                _ => {
                    removed.insert(x.key.clone(), x);
                }
            }
        }
        // 3. Rotations: the first per old key, unless it was removed at or before it.
        let mut rotated: HashMap<String, &Rotation> = HashMap::new();
        for x in &rots {
            if rotated.contains_key(&x.old) || removed.get(&x.old).is_some_and(|d| d.at <= x.at) {
                continue;
            }
            rotated.insert(x.old.clone(), x);
        }
        let ended = |k: &str| -> Option<u64> {
            let a = removed.get(k).map(|x| x.at);
            let b = rotated.get(k).map(|x| x.at);
            match (a, b) {
                (Some(a), Some(b)) => Some(a.min(b)),
                (a, b) => a.or(b),
            }
        };
        // 4. Fixed point over entries and rotations.
        let mut valid: HashMap<PublicKey, MemberEntry> = HashMap::new();
        let active_at = |valid: &HashMap<PublicKey, MemberEntry>, k: &PublicKey, at: u64| {
            valid.contains_key(k) && ended(&k.to_string()).is_none_or(|end| at <= end)
        };
        loop {
            let before = valid.len();
            for e in &self.members {
                let (Ok(key), Ok(by)) =
                    (keys::parse_public(&e.key), keys::parse_public(&e.added_by))
                else {
                    continue;
                };
                if valid.contains_key(&key) {
                    continue;
                }
                let signer_ok = if by == founder && e.key == self.founder {
                    true
                } else {
                    active_at(&valid, &by, e.at)
                };
                if signer_ok
                    && keys::verify(
                        &by,
                        &member_bytes(&self.id, &e.key, &e.name, &e.added_by, e.at),
                        &e.sig,
                    )
                    .is_ok()
                {
                    valid.insert(key, e.clone());
                }
            }
            for x in rotated.values() {
                let (Ok(old), Ok(new)) = (keys::parse_public(&x.old), keys::parse_public(&x.new))
                else {
                    continue;
                };
                if valid.contains_key(&new) {
                    continue;
                }
                if let Some(prev) = valid.get(&old).cloned()
                    && removed.get(&x.old).is_none_or(|d| x.at < d.at)
                {
                    valid.insert(
                        new,
                        MemberEntry {
                            key: x.new.clone(),
                            name: prev.name.clone(),
                            added_by: x.old.clone(),
                            at: x.at,
                            sig: x.sig_old.clone(),
                        },
                    );
                }
            }
            if valid.len() == before {
                break;
            }
        }
        for (k, e) in valid {
            let ks = k.to_string();
            let left = match (removed.get(&ks), rotated.get(&ks)) {
                (Some(d), Some(x)) if x.at < d.at => Some(Left::Rotated((*x).clone())),
                (Some(d), _) => Some(Left::Removed((*d).clone())),
                (None, Some(x)) => Some(Left::Rotated((*x).clone())),
                (None, None) => None,
            };
            match left {
                Some(l) => {
                    r.left.insert(k, (e, l));
                }
                None => {
                    r.members.insert(k, e);
                }
            }
        }
        r
    }

    pub fn is_member(&self, key: &PublicKey) -> bool {
        self.members().contains_key(key)
    }

    /// Adds `key` as a member, signed by `by` (who must be a member).
    pub fn add(&mut self, by: &SecretKey, key: &PublicKey, name: &str) -> Result<MemberEntry> {
        if !self.is_member(&by.public()) {
            bail!("only a member can add members");
        }
        if let Some(e) = self.members().get(key) {
            return Ok(e.clone());
        }
        let entry = self.sign_entry(by, key, name);
        self.members.push(entry.clone());
        Ok(entry)
    }

    /// Union of the valid entries, removals and rotations of both files (same team). Returns
    /// whether anything was added.
    pub fn merge(&mut self, other: &TeamFile) -> Result<bool> {
        if other.id != self.id {
            bail!("another team ({})", other.id);
        }
        other.check_id()?;
        let mut changed = false;
        for e in &other.members {
            if !self.members.contains(e) {
                self.members.push(e.clone());
                changed = true;
            }
        }
        for x in &other.removals {
            if !self.removals.contains(x) && x.verifies(&self.id) {
                self.removals.push(x.clone());
                changed = true;
            }
        }
        for x in &other.rotations {
            if !self.rotations.contains(x) && x.verifies(&self.id) {
                self.rotations.push(x.clone());
                changed = true;
            }
        }
        if changed {
            // Keep only entries that validate (members now or keys that left), so a forged entry
            // never sticks while the history of who added whom stays.
            let r = self.roster();
            self.members.retain(|e| {
                keys::parse_public(&e.key).ok().is_some_and(|k| {
                    r.members.get(&k).or_else(|| r.left.get(&k).map(|(m, _)| m)) == Some(e)
                })
            });
        }
        Ok(changed)
    }

    /// Takes `key` out of the team, signed by `by` (the founder, or the key it rotated to).
    pub fn remove(&mut self, by: &SecretKey, key: &PublicKey, upto: Upto) -> Result<Removal> {
        let r = self.roster();
        if r.founder() != Some(&by.public()) {
            bail!("only the founder removes members");
        }
        if r.founders.contains(key) {
            bail!("the founder cannot be removed");
        }
        if !r.members.contains_key(key) {
            bail!("{} is not a member", key.fmt_short());
        }
        let (k, b, at) = (key.to_string(), by.public().to_string(), now());
        let sig = hex::encode(
            by.sign(&removal_bytes(&self.id, &k, &b, at, &upto))
                .to_bytes(),
        );
        let x = Removal {
            key: k,
            by: b,
            at,
            upto,
            sig,
        };
        self.removals.push(x.clone());
        Ok(x)
    }

    /// The member signs their own removal. The founder chain cannot leave this way.
    pub fn leave(&mut self, me: &SecretKey, upto: Upto) -> Result<Removal> {
        let r = self.roster();
        let key = me.public();
        if r.founders.contains(&key) {
            bail!("the founder cannot leave the team");
        }
        if !r.members.contains_key(&key) {
            bail!("this instance is not a member of the team");
        }
        let (k, at) = (key.to_string(), now());
        let sig = hex::encode(
            me.sign(&removal_bytes(&self.id, &k, &k, at, &upto))
                .to_bytes(),
        );
        let x = Removal {
            key: k.clone(),
            by: k,
            at,
            upto,
            sig,
        };
        self.removals.push(x.clone());
        if self.is_member(&key) {
            self.removals.pop();
            bail!("the leave did not validate");
        }
        Ok(x)
    }

    /// Replaces the member key `old` by `new` (signed by both).
    pub fn rotate(&mut self, old: &SecretKey, new: &SecretKey, upto: Upto) -> Result<Rotation> {
        if !self.is_member(&old.public()) {
            bail!("only a member can rotate its key");
        }
        let (o, n, at) = (old.public().to_string(), new.public().to_string(), now());
        let bytes = rotation_bytes(&self.id, &o, &n, at, &upto);
        let x = Rotation {
            old: o,
            new: n,
            at,
            upto,
            sig_old: hex::encode(old.sign(&bytes).to_bytes()),
            sig_new: hex::encode(new.sign(&bytes).to_bytes()),
        };
        self.rotations.push(x.clone());
        if !self.is_member(&new.public()) {
            self.rotations.pop();
            bail!("the rotation did not validate");
        }
        Ok(x)
    }

    pub fn load(data: &Path) -> Result<Option<Self>> {
        let p = data.join("team.json");
        if !p.exists() {
            return Ok(None);
        }
        let t: TeamFile = serde_json::from_slice(&fs::read(&p)?)
            .with_context(|| format!("reading {}", p.display()))?;
        t.check_id()?;
        Ok(Some(t))
    }

    pub fn save(&self, data: &Path) -> Result<()> {
        write_atomic(&data.join("team.json"), &serde_json::to_vec_pretty(self)?)
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)?;
    Ok(())
}

/// What the inviter keeps about an invite: never the secret itself.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Invite {
    pub hash: String,
    pub expires: u64,
    pub used: bool,
}

pub struct Invites {
    pub list: Vec<Invite>,
}

fn secret_hash(secret: &[u8]) -> String {
    hex::encode(keys::sha256(&[b"paprika-invite/1", secret]))
}

impl Invites {
    pub fn load(data: &Path) -> Self {
        let list = fs::read(data.join("invites.json"))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default();
        Invites { list }
    }

    pub fn save(&self, data: &Path) -> Result<()> {
        write_atomic(
            &data.join("invites.json"),
            &serde_json::to_vec_pretty(&self.list)?,
        )
    }

    /// Creates a single-use invite; returns the secret (goes in the link) and its expiry.
    pub fn create(&mut self, ttl_secs: u64) -> (Vec<u8>, u64) {
        let secret = keys::random32().to_vec();
        let expires = now() + ttl_secs.clamp(60, 30 * 24 * 3600);
        self.list.retain(|i| !i.used && i.expires > now());
        self.list.push(Invite {
            hash: secret_hash(&secret),
            expires,
            used: false,
        });
        (secret, expires)
    }

    /// Spends an invite: valid, not expired, not used.
    pub fn redeem(&mut self, secret: &[u8]) -> Result<()> {
        let h = secret_hash(secret);
        let Some(inv) = self.list.iter_mut().find(|i| i.hash == h) else {
            bail!("invite revoked or unknown")
        };
        if inv.used {
            bail!("invite already used");
        }
        if inv.expires < now() {
            bail!("invite expired");
        }
        inv.used = true;
        Ok(())
    }

    pub fn revoke_all(&mut self) -> usize {
        let n = self.list.iter().filter(|i| !i.used).count();
        self.list.clear();
        n
    }

    pub fn active(&self) -> Vec<&Invite> {
        self.list
            .iter()
            .filter(|i| !i.used && i.expires >= now())
            .collect()
    }
}

/// `paprika://join/<team>?n=<name>&a=<address>&s=<secret>&e=<expiry>`; n, a and s are base64url.
#[derive(Debug, Clone)]
pub struct InviteLink {
    pub team: String,
    pub name: String,
    pub addr: EndpointAddr,
    pub secret: Vec<u8>,
    pub expires: u64,
}

impl InviteLink {
    pub fn encode(&self) -> String {
        let addr = serde_json::to_vec(&self.addr).unwrap_or_default();
        format!(
            "paprika://join/{}?n={}&a={}&s={}&e={}",
            self.team,
            B64URL.encode(self.name.as_bytes()),
            B64URL.encode(addr),
            B64URL.encode(&self.secret),
            self.expires
        )
    }

    pub fn parse(link: &str) -> Result<Self> {
        let rest = link
            .trim()
            .strip_prefix("paprika://join/")
            .ok_or_else(|| anyhow!("not a Paprika invite link (paprika://join/…)"))?;
        let (team, query) = rest
            .split_once('?')
            .ok_or_else(|| anyhow!("invite link without parameters"))?;
        let mut params: HashMap<&str, &str> = HashMap::new();
        for kv in query.split('&') {
            if let Some((k, v)) = kv.split_once('=') {
                params.insert(k, v);
            }
        }
        let get = |k: &str| {
            params
                .get(k)
                .copied()
                .ok_or_else(|| anyhow!("invite link without {k}"))
        };
        let dec = |k: &str| -> Result<Vec<u8>> {
            B64URL
                .decode(get(k)?)
                .with_context(|| format!("invite link: bad {k}"))
        };
        if team.len() != 32 || !team.chars().all(|c| c.is_ascii_hexdigit()) {
            bail!("invite link: bad team id");
        }
        Ok(InviteLink {
            team: team.to_string(),
            name: String::from_utf8(dec("n")?).context("invite link: bad name")?,
            addr: serde_json::from_slice(&dec("a")?).context("invite link: bad address")?,
            secret: dec("s")?,
            expires: get("e")?.parse().context("invite link: bad expiry")?,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(b: u8) -> SecretKey {
        SecretKey::from_bytes(&[b; 32])
    }

    #[test]
    fn membership_chains_to_the_founder() {
        let (ana, bruno, carla, eve) = (key(1), key(2), key(3), key(9));
        let mut t = TeamFile::create(&ana, "Estúdio", "Ana");
        t.add(&ana, &bruno.public(), "Bruno").unwrap();
        t.add(&bruno, &carla.public(), "Carla").unwrap();
        assert!(t.is_member(&carla.public()));
        assert!(
            t.add(&eve, &eve.public(), "Eve").is_err(),
            "a stranger cannot add itself"
        );

        // A forged entry (Eve signs "added by Ana") does not validate and does not survive a merge.
        let mut forged = t.clone();
        forged.members.push(MemberEntry {
            key: eve.public().to_string(),
            name: "Eve".into(),
            added_by: ana.public().to_string(),
            at: 1,
            sig: hex::encode(eve.sign(b"x").to_bytes()),
        });
        assert!(!forged.is_member(&eve.public()));
        let mut merged = t.clone();
        merged.merge(&forged).unwrap();
        assert!(
            !merged
                .members
                .iter()
                .any(|e| e.key == eve.public().to_string())
        );
    }

    fn upto(doc: &str, author: &SecretKey, seq: u64) -> Upto {
        BTreeMap::from([(
            doc.to_string(),
            BTreeMap::from([(author.public().to_string(), seq)]),
        )])
    }

    #[test]
    fn the_founder_removes_a_member() {
        let (ana, bruno, carla) = (key(1), key(2), key(3));
        let mut t = TeamFile::create(&ana, "Estúdio", "Ana");
        t.add(&ana, &bruno.public(), "Bruno").unwrap();
        t.add(&ana, &carla.public(), "Carla").unwrap();
        assert_eq!(
            t.remove(&bruno, &carla.public(), Upto::new())
                .unwrap_err()
                .to_string(),
            "only the founder removes members"
        );
        assert!(t.remove(&ana, &ana.public(), Upto::new()).is_err());
        t.remove(&ana, &bruno.public(), upto("d", &bruno, 3))
            .unwrap();
        let r = t.roster();
        assert!(!r.members.contains_key(&bruno.public()));
        assert!(r.members.contains_key(&carla.public()));
        assert!(matches!(r.left[&bruno.public()].1, Left::Removed(_)));
        // Up to seq 3 in "d" still counts (history); later, or in another workspace, does not.
        let b = bruno.public().to_string();
        assert!(r.accepts(&bruno.public(), "d", &b, 3));
        assert!(!r.accepts(&bruno.public(), "d", &b, 4));
        assert!(!r.accepts(&bruno.public(), "e", &b, 1));
        // A removed member cannot add anyone any more.
        assert!(t.add(&bruno, &key(4).public(), "Dani").is_err());

        // The removal spreads by merge; a forged one (signed by Carla) does not.
        let mut other = TeamFile {
            removals: vec![],
            ..t.clone()
        };
        assert!(other.is_member(&bruno.public()));
        other.merge(&t).unwrap();
        assert!(!other.is_member(&bruno.public()));
        let mut forged = t.clone();
        forged.removals.push(Removal {
            key: carla.public().to_string(),
            by: ana.public().to_string(),
            at: now(),
            upto: Upto::new(),
            sig: hex::encode(carla.sign(b"x").to_bytes()),
        });
        other.merge(&forged).unwrap();
        assert!(other.is_member(&carla.public()));
        assert_eq!(other.removals.len(), 1);
    }

    #[test]
    fn a_member_leaves_on_their_own() {
        let (ana, bruno) = (key(1), key(2));
        let mut t = TeamFile::create(&ana, "Estúdio", "Ana");
        t.add(&ana, &bruno.public(), "Bruno").unwrap();
        assert!(t.leave(&ana, Upto::new()).unwrap_err().to_string().contains("founder"));
        let mut other = t.clone();
        t.leave(&bruno, upto("d", &bruno, 2)).unwrap();
        assert!(!t.is_member(&bruno.public()));
        assert!(t.is_member(&ana.public()));
        other.merge(&t).unwrap();
        assert!(!other.is_member(&bruno.public()));
    }

    #[test]
    fn a_member_rotates_its_key() {
        let (ana, bruno, bruno2, eve) = (key(1), key(2), key(5), key(9));
        let mut t = TeamFile::create(&ana, "Estúdio", "Ana");
        t.add(&ana, &bruno.public(), "Bruno").unwrap();
        assert!(
            t.rotate(&eve, &key(8), Upto::new()).is_err(),
            "a stranger cannot rotate"
        );
        t.rotate(&bruno, &bruno2, upto("d", &bruno, 7)).unwrap();
        let r = t.roster();
        assert_eq!(r.members[&bruno2.public()].name, "Bruno");
        assert!(!r.members.contains_key(&bruno.public()));
        assert!(r.accepts(&bruno.public(), "d", &bruno.public().to_string(), 7));
        assert!(!r.accepts(&bruno.public(), "d", &bruno.public().to_string(), 8));
        // The new key carries the rights; the old one does not.
        t.add(&bruno2, &key(3).public(), "Carla").unwrap();
        assert!(t.add(&bruno, &key(4).public(), "Dani").is_err());
        // A rotation signed only by the old key does not count.
        let mut half = t.clone();
        let mut bad = t.rotations[0].clone();
        bad.new = eve.public().to_string();
        half.rotations = vec![bad];
        assert!(!half.is_member(&eve.public()));
    }

    #[test]
    fn the_founder_rotates_and_keeps_founding() {
        let (ana, ana2, bruno) = (key(1), key(6), key(2));
        let mut t = TeamFile::create(&ana, "Estúdio", "Ana");
        t.add(&ana, &bruno.public(), "Bruno").unwrap();
        t.rotate(&ana, &ana2, Upto::new()).unwrap();
        let r = t.roster();
        assert_eq!(r.founder(), Some(&ana2.public()));
        assert!(
            t.remove(&ana, &bruno.public(), Upto::new()).is_err(),
            "the old key is retired"
        );
        t.remove(&ana2, &bruno.public(), Upto::new()).unwrap();
        assert!(!t.is_member(&bruno.public()));
        assert!(t.remove(&ana2, &ana2.public(), Upto::new()).is_err());
        // The file still loads from JSON written before removals and rotations existed.
        let mut old = serde_json::to_value(TeamFile::create(&ana, "E", "Ana")).unwrap();
        old.as_object_mut().unwrap().remove("removals");
        let back: TeamFile = serde_json::from_value(old).unwrap();
        assert!(back.removals.is_empty() && back.is_member(&ana.public()));
    }

    #[test]
    fn nobody_else_can_claim_a_team_id() {
        let (ana, eve) = (key(1), key(9));
        let t = TeamFile::create(&ana, "Estúdio", "Ana");
        let mut fake = TeamFile::create(&eve, "Estúdio", "Eve");
        fake.id = t.id.clone();
        assert!(fake.check_id().is_err());
        assert!(fake.members().is_empty());
    }

    #[test]
    fn invites_are_single_use_and_expire() {
        let mut inv = Invites { list: vec![] };
        let (secret, _) = inv.create(3600);
        inv.redeem(&secret).unwrap();
        assert_eq!(
            inv.redeem(&secret).unwrap_err().to_string(),
            "invite already used"
        );
        let (old, _) = inv.create(3600);
        inv.list.last_mut().unwrap().expires = now() - 1;
        assert_eq!(inv.redeem(&old).unwrap_err().to_string(), "invite expired");
        let (revoked, _) = inv.create(3600);
        inv.revoke_all();
        assert_eq!(
            inv.redeem(&revoked).unwrap_err().to_string(),
            "invite revoked or unknown"
        );
    }

    #[test]
    fn link_roundtrip() {
        let k = key(1);
        let l = InviteLink {
            team: "0123456789abcdef0123456789abcdef".into(),
            name: "Estúdio Norte".into(),
            addr: EndpointAddr::new(k.public()),
            secret: vec![7; 32],
            expires: 123,
        };
        let p = InviteLink::parse(&l.encode()).unwrap();
        assert_eq!(
            (p.team, p.name, p.addr, p.secret, p.expires),
            (l.team, l.name, l.addr, l.secret, l.expires)
        );
        assert!(InviteLink::parse("https://example.com").is_err());
    }
}
