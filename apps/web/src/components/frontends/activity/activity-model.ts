import type { ActivityEntry } from "./types";

export function markerIndex(entries: readonly ActivityEntry[]): number {
  let i = 0;
  while (i < entries.length && entries[i]?.step) i++;
  return i;
}

export function batchFlags(entries: readonly ActivityEntry[]): boolean[] {
  const flags = entries.map(() => false);
  let i = 0;
  while (i < entries.length) {
    const first = entries[i] as ActivityEntry;
    if (first.step) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < entries.length && !entries[j]?.step && entries[j]?.actor.name === first.actor.name && entries[j]?.actor.you === first.actor.you) j++;
    if (j - i >= 2) for (let k = i; k < j; k++) flags[k] = true;
    i = Math.max(j, i + 1);
  }
  return flags;
}
