use anyhow::{Result, bail};
use iroh::endpoint::{RecvStream, SendStream};
use serde::{Serialize, de::DeserializeOwned};

pub const ALPN_SYNC: &[u8] = b"paprika/sync/1";
pub const ALPN_JOIN: &[u8] = b"paprika/join/1";
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const FORMAT_VERSION: &str = "paprika/1";
const MAX_FRAME: usize = 64 << 20;

fn peer_label(peer_name: &str, peer_id_short: &str) -> String {
    if peer_name.is_empty() {
        peer_id_short.to_string()
    } else {
        format!("{peer_name} ({peer_id_short})")
    }
}

pub fn check_versions(
    local_app: &str,
    local_format: &str,
    peer_name: &str,
    peer_id_short: &str,
    peer_app: &str,
    peer_format: &str,
) -> Result<(), String> {
    let peer_label = peer_label(peer_name, peer_id_short);
    if peer_format.is_empty() {
        return Err(format!(
            "incompatible document format with peer {peer_label}: peer did not advertise a format version (local {local_format}). Both sides must run a Paprika build that exchanges format versions; upgrade the older instance, then reconnect."
        ));
    }
    if peer_format != local_format {
        return Err(format!(
            "incompatible document format with peer {peer_label}: local format {local_format}, peer format {peer_format} (local app {local_app}, peer app {}). Both sides must use the same document format. Upgrade or downgrade so formats match (`git pull` / rebuild, or the same Docker image), then reconnect.",
            if peer_app.is_empty() {
                "unknown"
            } else {
                peer_app
            }
        ));
    }
    Ok(())
}

pub fn app_version_warn(
    local_app: &str,
    peer_name: &str,
    peer_id_short: &str,
    peer_app: &str,
    format: &str,
) -> Option<String> {
    if peer_app.is_empty() || peer_app == local_app {
        return None;
    }
    let peer_label = peer_label(peer_name, peer_id_short);
    Some(format!(
        "peer {peer_label} runs paprika-sync {peer_app} (local {local_app}); document format matches ({format}). Sync continues; consider upgrading both instances to the same app version."
    ))
}

pub async fn write_frame<T: Serialize>(send: &mut SendStream, msg: &T) -> Result<()> {
    let body = serde_json::to_vec(msg)?;
    if body.len() > MAX_FRAME {
        bail!("frame too large: {} bytes", body.len());
    }
    send.write_all(&(body.len() as u32).to_be_bytes()).await?;
    send.write_all(&body).await?;
    Ok(())
}

pub async fn read_frame<T: DeserializeOwned>(recv: &mut RecvStream) -> Result<Option<T>> {
    let mut len = [0u8; 4];
    match recv.read_exact(&mut len).await {
        Ok(()) => {}
        Err(e) => {
            if matches!(e, iroh::endpoint::ReadExactError::FinishedEarly(0)) {
                return Ok(None);
            }
            return Err(e.into());
        }
    }
    let n = u32::from_be_bytes(len) as usize;
    if n > MAX_FRAME {
        bail!("frame too large: {n} bytes");
    }
    let mut body = vec![0u8; n];
    recv.read_exact(&mut body).await?;
    Ok(Some(serde_json::from_slice(&body)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matching_versions_ok() {
        assert!(check_versions("0.0.1", "paprika/1", "ana", "abcd", "0.0.1", "paprika/1").is_ok());
        assert!(app_version_warn("0.0.1", "ana", "abcd", "0.0.1", "paprika/1").is_none());
    }

    #[test]
    fn different_app_warns() {
        assert!(check_versions("0.0.1", "paprika/1", "ana", "abcd", "0.0.2", "paprika/1").is_ok());
        let w = app_version_warn("0.0.1", "ana", "abcd", "0.0.2", "paprika/1").unwrap();
        assert!(w.contains("0.0.2"));
        assert!(w.contains("Sync continues"));
    }

    #[test]
    fn different_format_refuses() {
        let e =
            check_versions("0.0.1", "paprika/1", "ana", "abcd", "0.0.1", "paprika/2").unwrap_err();
        assert!(e.contains("incompatible document format"));
        assert!(e.contains("paprika/2"));
    }

    #[test]
    fn missing_format_refuses() {
        let e = check_versions("0.0.1", "paprika/1", "", "abcd", "", "").unwrap_err();
        assert!(e.contains("did not advertise"));
    }
}
