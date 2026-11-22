//! Instance identity: one ed25519 key per instance (Iroh endpoint id and team member key),
//! plus keys derived from it for each local agent.

use std::{fs, io::Write, path::Path};

use anyhow::{Context, Result, bail};
use iroh::{PublicKey, SecretKey};
use sha2::{Digest, Sha256};

/// Loads `<dir>/key` (32 raw bytes) or creates it with mode 0600.
pub fn load_or_create(dir: &Path) -> Result<SecretKey> {
    let path = dir.join("key");
    if path.exists() {
        let bytes = fs::read(&path).with_context(|| format!("reading {}", path.display()))?;
        let arr: [u8; 32] = bytes
            .as_slice()
            .try_into()
            .map_err(|_| anyhow::anyhow!("{} must hold 32 bytes", path.display()))?;
        return Ok(SecretKey::from_bytes(&arr));
    }
    fs::create_dir_all(dir)?;
    let key = SecretKey::from_bytes(&random32());
    let mut opts = fs::OpenOptions::new();
    opts.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts
        .open(&path)
        .with_context(|| format!("creating {}", path.display()))?;
    f.write_all(&key.to_bytes())?;
    Ok(key)
}

pub fn random32() -> [u8; 32] {
    let mut b = [0u8; 32];
    getrandom::fill(&mut b).expect("system randomness");
    b
}

pub fn sha256(parts: &[&[u8]]) -> [u8; 32] {
    let mut h = Sha256::new();
    for p in parts {
        h.update((p.len() as u64).to_be_bytes());
        h.update(p);
    }
    h.finalize().into()
}

/// The key a local agent signs with: derived from the member key and the agent's name, so it is
/// stable across restarts and never stored.
pub fn agent_key(member: &SecretKey, name: &str) -> SecretKey {
    SecretKey::from_bytes(&sha256(&[
        b"paprika-agent/1",
        &member.to_bytes(),
        name.as_bytes(),
    ]))
}

/// Loro peer id of an author: the first 8 bytes of the public key. Each author writes from one
/// place only (agents' keys are derived per instance), so counters never collide.
pub fn peer_id(author: &PublicKey) -> u64 {
    let b = author.as_bytes();
    // u64::MAX is reserved by Loro.
    u64::from_be_bytes(b[..8].try_into().unwrap()).min(u64::MAX - 1)
}

pub fn parse_public(s: &str) -> Result<PublicKey> {
    s.parse::<PublicKey>()
        .map_err(|e| anyhow::anyhow!("invalid public key {s:?}: {e}"))
}

pub fn sig_from_hex(s: &str) -> Result<iroh::Signature> {
    let bytes = hex::decode(s).context("signature is not hex")?;
    let arr: [u8; 64] = bytes
        .as_slice()
        .try_into()
        .map_err(|_| anyhow::anyhow!("signature must be 64 bytes"))?;
    Ok(iroh::Signature::from_bytes(&arr))
}

pub fn verify(key: &PublicKey, msg: &[u8], sig_hex: &str) -> Result<()> {
    let sig = sig_from_hex(sig_hex)?;
    if key.verify(msg, &sig).is_err() {
        bail!("bad signature by {}", key.fmt_short());
    }
    Ok(())
}

/// Short human fingerprint: 4 groups of 4 hex digits.
pub fn fingerprint(key: &PublicKey) -> String {
    let h = hex::encode_upper(&key.as_bytes()[..8]);
    format!("{}·{}·{}·{}", &h[0..4], &h[4..8], &h[8..12], &h[12..16])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_file_is_stable_and_private() {
        let dir = tempfile::tempdir().unwrap();
        let a = load_or_create(dir.path()).unwrap();
        let b = load_or_create(dir.path()).unwrap();
        assert_eq!(a.public(), b.public());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(dir.path().join("key"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[test]
    fn agent_keys_are_derived_and_distinct() {
        let m = SecretKey::from_bytes(&[7; 32]);
        assert_eq!(
            agent_key(&m, "codex").public(),
            agent_key(&m, "codex").public()
        );
        assert_ne!(
            agent_key(&m, "codex").public(),
            agent_key(&m, "claude-code").public()
        );
        assert_ne!(agent_key(&m, "codex").public(), m.public());
    }

    #[test]
    fn signatures_roundtrip() {
        let k = SecretKey::from_bytes(&[3; 32]);
        let sig = hex::encode(k.sign(b"hi").to_bytes());
        verify(&k.public(), b"hi", &sig).unwrap();
        assert!(verify(&k.public(), b"ho", &sig).is_err());
    }
}
