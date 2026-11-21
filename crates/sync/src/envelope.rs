//! Signed envelopes: one local transaction (a Loro update) signed by its author (ADR 0004).

use anyhow::{Context, Result, bail};
use base64::{Engine, engine::general_purpose::STANDARD as B64};
use iroh::{PublicKey, SecretKey};
use serde::{Deserialize, Serialize};

use crate::{crdt, keys};

/// Delegation from a member to one of the agents it runs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Cert {
    pub member: String,
    pub agent: String,
    pub name: String,
    pub sig: String,
}

impl Cert {
    fn bytes(member: &str, agent: &str, name: &str) -> Vec<u8> {
        [
            b"paprika-cert/1".as_slice(),
            member.as_bytes(),
            agent.as_bytes(),
            name.as_bytes(),
        ]
        .join(&b'\n')
    }

    pub fn issue(member: &SecretKey, agent: &PublicKey, name: &str) -> Self {
        let (m, a) = (member.public().to_string(), agent.to_string());
        let sig = hex::encode(member.sign(&Self::bytes(&m, &a, name)).to_bytes());
        Cert {
            member: m,
            agent: a,
            name: name.to_string(),
            sig,
        }
    }

    /// Checks the member's signature over the delegation; returns the member key.
    pub fn verify(&self) -> Result<PublicKey> {
        let member = keys::parse_public(&self.member)?;
        keys::verify(
            &member,
            &Self::bytes(&self.member, &self.agent, &self.name),
            &self.sig,
        )
        .context("agent certificate")?;
        Ok(member)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Envelope {
    pub doc: String,
    pub author: String,
    pub seq: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cert: Option<Cert>,
    pub blob: String,
    pub sig: String,
}

fn signing_bytes(doc: &str, author: &str, seq: u64, blob: &[u8]) -> Vec<u8> {
    let digest = hex::encode(keys::sha256(&[blob]));
    [
        b"paprika-env/1".as_slice(),
        doc.as_bytes(),
        author.as_bytes(),
        seq.to_string().as_bytes(),
        digest.as_bytes(),
    ]
    .join(&b'\n')
}

impl Envelope {
    pub fn sign(doc: &str, author: &SecretKey, seq: u64, blob: &[u8], cert: Option<Cert>) -> Self {
        let a = author.public().to_string();
        let sig = hex::encode(author.sign(&signing_bytes(doc, &a, seq, blob)).to_bytes());
        Envelope {
            doc: doc.to_string(),
            author: a,
            seq,
            cert,
            blob: B64.encode(blob),
            sig,
        }
    }

    pub fn author_key(&self) -> Result<PublicKey> {
        keys::parse_public(&self.author)
    }

    /// Checks the author's signature, the agent certificate if any, and that the update only
    /// carries changes under the author's own Loro peer id. Returns the update bytes and the
    /// member responsible for it (the author itself, or the member that delegated the agent).
    pub fn verify(&self) -> Result<(Vec<u8>, PublicKey)> {
        let author = self.author_key()?;
        let blob = B64.decode(&self.blob).context("blob is not base64")?;
        keys::verify(
            &author,
            &signing_bytes(&self.doc, &self.author, self.seq, &blob),
            &self.sig,
        )
        .context("envelope")?;
        let member = match &self.cert {
            None => author,
            Some(c) => {
                if c.agent != self.author {
                    bail!("certificate is for {}, not for the author", c.agent);
                }
                c.verify()?
            }
        };
        let peers = crdt::blob_peers(&blob)?;
        if peers != [keys::peer_id(&author)] {
            bail!("update carries changes from peers {peers:?}, not only from its author");
        }
        Ok((blob, member))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crdt::{Change, Crdt};

    fn blob_by(key: &SecretKey) -> Vec<u8> {
        let c = Crdt::new();
        c.apply_local(
            keys::peer_id(&key.public()),
            &[Change::Name { value: "x".into() }],
        )
        .unwrap()
        .unwrap()
    }

    #[test]
    fn member_envelope_verifies() {
        let k = SecretKey::from_bytes(&[1; 32]);
        let env = Envelope::sign("d", &k, 1, &blob_by(&k), None);
        let (_, member) = env.verify().unwrap();
        assert_eq!(member, k.public());
    }

    #[test]
    fn tampering_is_detected() {
        let k = SecretKey::from_bytes(&[1; 32]);
        let mut env = Envelope::sign("d", &k, 1, &blob_by(&k), None);
        env.seq = 2;
        assert!(env.verify().is_err());
    }

    #[test]
    fn cannot_sign_someone_elses_changes() {
        let (mallory, ana) = (
            SecretKey::from_bytes(&[9; 32]),
            SecretKey::from_bytes(&[1; 32]),
        );
        // Mallory signs a valid envelope, but the update was made under Ana's peer id.
        let env = Envelope::sign("d", &mallory, 1, &blob_by(&ana), None);
        assert!(
            env.verify()
                .unwrap_err()
                .to_string()
                .contains("not only from its author")
        );
    }

    #[test]
    fn agent_envelope_carries_its_members_delegation() {
        let member = SecretKey::from_bytes(&[1; 32]);
        let agent = keys::agent_key(&member, "codex");
        let cert = Cert::issue(&member, &agent.public(), "codex");
        let env = Envelope::sign("d", &agent, 1, &blob_by(&agent), Some(cert.clone()));
        assert_eq!(env.verify().unwrap().1, member.public());
        // A certificate for another agent does not cover this author.
        let other = keys::agent_key(&member, "gemini");
        let env = Envelope::sign("d", &other, 1, &blob_by(&other), Some(cert));
        assert!(env.verify().is_err());
    }
}
