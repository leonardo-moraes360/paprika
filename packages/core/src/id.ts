const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Id curto (10 chars base36, ~51 bits). Usa WebCrypto, disponível no Node 22 e no navegador. */
export function newId(size = 10): string {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}
