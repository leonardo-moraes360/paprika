/**
 * The header's team chip from the raw sidecar status (`GET /api/team`, pushed as `team` over `/ws`): the team's name
 * and how many are online (the peers that are connected, directly or by relay, plus you). `null` when there is no
 * sidecar (`null`), no status yet (`undefined`) or this device has not joined a team: the chip then does not exist.
 * Returned as a string so a `useLive` selector can compare it with `Object.is`.
 */
export function teamChipKey(status: Record<string, unknown> | null | undefined): string | null {
  const team = status?.team;
  if (!team || typeof team !== "object") return null;
  const name = (team as { name?: unknown }).name;
  if (typeof name !== "string" || !name) return null;
  const peers = Array.isArray(status?.peers) ? (status?.peers as { state?: unknown }[]) : [];
  const online = peers.filter((peer) => peer?.state === "direct" || peer?.state === "relay").length + 1;
  return `${online}\u0000${name}`;
}

export function parseTeamChip(key: string | null): { name: string; online: number } | null {
  if (key === null) return null;
  const at = key.indexOf("\u0000");
  return { online: Number(key.slice(0, at)), name: key.slice(at + 1) };
}
