import type { PinEntry, PinFilter } from "./types";

export function pinCounts(pins: readonly PinEntry[]) {
  const resolved = pins.filter((pin) => pin.status === "resolved").length;
  return { open: pins.length - resolved, resolved, all: pins.length };
}

export function filterPins(pins: readonly PinEntry[], filter: PinFilter): PinEntry[] {
  if (filter === "all") return [...pins];
  return pins.filter((pin) => (filter === "resolved") === (pin.status === "resolved"));
}
