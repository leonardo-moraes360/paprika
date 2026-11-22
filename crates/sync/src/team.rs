//! The team file (allowlist of member keys) and invites (ADR 0004, docs/team-sync.md).

use std::{
    collections::HashMap,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TeamFile {
    pub id: String,
    pub name: String,
    pub founder: String,
    pub nonce: String,
    pub members: Vec<MemberEntry>,
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

    /// Members whose entry chains back to the founder through valid signatures.
    pub fn members(&self) -> HashMap<PublicKey, MemberEntry> {
        let mut valid: HashMap<PublicKey, MemberEntry> = HashMap::new();
        if self.check_id().is_err() {
            return valid;
        }
        let Ok(founder) = keys::parse_public(&self.founder) else {
            return valid;
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
                let signer_ok = if by == founder {
                    e.key == self.founder || valid.contains_key(&founder)
                } else {
                    valid.contains_key(&by)
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
            if valid.len() == before {
                return valid;
            }
        }
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

    /// Union of the valid entries of both files (same team). Returns whether anything was added.
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
        if changed {
            // Keep only entries that validate, so a forged entry never sticks.
            let valid = self.members();
            self.members.retain(|e| {
                keys::parse_public(&e.key)
                    .ok()
                    .and_then(|k| valid.get(&k))
                    .is_some_and(|v| v == e)
            });
        }
        Ok(changed)
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
