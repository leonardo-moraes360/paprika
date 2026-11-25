const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function newId(size = 10): string {
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}
