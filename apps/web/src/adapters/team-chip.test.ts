import { describe, expect, it } from "vitest";
import { parseTeamChip, teamChipKey } from "./team-chip";

describe("team chip", () => {
  it("is absent without a sidecar, without status or without a joined team", () => {
    expect(teamChipKey(null)).toBeNull();
    expect(teamChipKey(undefined)).toBeNull();
    expect(teamChipKey({ team: null, peers: [] })).toBeNull();
    expect(parseTeamChip(null)).toBeNull();
  });

  it("counts you and the peers connected directly or by relay", () => {
    const key = teamChipKey({ team: { name: "Estúdio Norte" }, peers: [{ state: "direct" }, { state: "relay" }, { state: "connecting" }, { state: "offline" }] });
    expect(parseTeamChip(key)).toEqual({ name: "Estúdio Norte", online: 3 });
    expect(teamChipKey({ team: { name: "T" }, peers: [] })).toBe(teamChipKey({ team: { name: "T" } }));
  });
});
