const PREFIX = "paprika.";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readPersisted(key: string): string | null {
  try {
    return storage()?.getItem(PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

export function writePersisted(key: string, value: string | null) {
  try {
    const store = storage();
    if (!store) return;
    if (value === null) store.removeItem(PREFIX + key);
    else store.setItem(PREFIX + key, value);
  } catch {
    return;
  }
}

export function readPersistedNumber(key: string): number | null {
  const raw = readPersisted(key);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function readPersistedBoolean(key: string): boolean | null {
  const raw = readPersisted(key);
  return raw === "1" ? true : raw === "0" ? false : null;
}

export function writePersistedBoolean(key: string, value: boolean) {
  writePersisted(key, value ? "1" : "0");
}
