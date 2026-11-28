import { useCallback, useState } from "react";
import { readPersisted, writePersisted, type PersistedCodec } from "./persist";

export function usePersistedState<T>(key: string | undefined, initial: T, codec: PersistedCodec<T>) {
  const [value, setValue] = useState<T>(() => {
    if (key === undefined) return initial;
    const raw = readPersisted(key);
    const parsed = raw === null ? null : codec.parse(raw);
    return parsed === null ? initial : parsed;
  });
  const update = useCallback(
    (next: T) => {
      setValue(next);
      if (key !== undefined) writePersisted(key, codec.serialize(next));
    },
    [key, codec],
  );
  return [value, update] as const;
}
