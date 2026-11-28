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
  if (raw === null || !/^-?\d+(\.\d+)?$/.test(raw.trim())) return null;
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

export function readPersistedJson<T>(key: string, validate: (value: unknown) => value is T): T | null {
  const raw = readPersisted(key);
  return raw === null ? null : jsonCodec(validate).parse(raw);
}

export function writePersistedJson(key: string, value: unknown) {
  writePersisted(key, JSON.stringify(value));
}

export type PersistedCodec<T> = {
  parse: (raw: string) => T | null;
  serialize: (value: T) => string;
};

export const booleanCodec: PersistedCodec<boolean> = {
  parse: (raw) => (raw === "1" ? true : raw === "0" ? false : null),
  serialize: (value) => (value ? "1" : "0"),
};

export const numberCodec: PersistedCodec<number> = {
  parse: (raw) => (/^-?\d+(\.\d+)?$/.test(raw.trim()) ? Number(raw) : null),
  serialize: String,
};

export function jsonCodec<T>(validate: (value: unknown) => value is T): PersistedCodec<T> {
  return {
    parse: (raw) => {
      try {
        const value: unknown = JSON.parse(raw);
        return validate(value) ? value : null;
      } catch {
        return null;
      }
    },
    serialize: (value) => JSON.stringify(value),
  };
}
