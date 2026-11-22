//! Wire format between peers: length-prefixed JSON frames on one bidirectional QUIC stream.

use anyhow::{Result, bail};
use iroh::endpoint::{RecvStream, SendStream};
use serde::{Serialize, de::DeserializeOwned};

pub const ALPN_SYNC: &[u8] = b"paprika/sync/1";
pub const ALPN_JOIN: &[u8] = b"paprika/join/1";
const MAX_FRAME: usize = 64 << 20;

pub async fn write_frame<T: Serialize>(send: &mut SendStream, msg: &T) -> Result<()> {
    let body = serde_json::to_vec(msg)?;
    if body.len() > MAX_FRAME {
        bail!("frame too large: {} bytes", body.len());
    }
    send.write_all(&(body.len() as u32).to_be_bytes()).await?;
    send.write_all(&body).await?;
    Ok(())
}

/// Reads one frame; `None` when the peer finished the stream.
pub async fn read_frame<T: DeserializeOwned>(recv: &mut RecvStream) -> Result<Option<T>> {
    let mut len = [0u8; 4];
    match recv.read_exact(&mut len).await {
        Ok(()) => {}
        Err(e) => {
            // A clean finish before a new frame is the end of the conversation.
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
