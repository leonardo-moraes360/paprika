import { describe, expect, it } from "vitest";
import { headerTeam, secondsToMs, toInvitePreview, toTeamInvite, toTeamStatus, voiceFingerprint } from "./team";

/** A status as `crates/sync/src/node.rs` builds it (the sidecar is not available in this environment: this shape is copied from the code and `docs/en-US/team-sync.md`). */
const raw = (over: Record<string, unknown> = {}) => ({
  id: "ME000000AAAA",
  name: "laptop",
  fingerprint: "A3F9·B71C·44D2·0C1E",
  app: "0.1.0",
  format: "paprika/1",
  team: {
    id: "a3f9b71c44d2e5f6",
    name: "North Studio",
    members: [
      { key: "KEY-ME", name: "Leonardo", fingerprint: "A3F9·B71C·44D2·0C1E", addedBy: "KEY-ME", addedByName: null, at: 1_700_000_000, founder: true, you: true, agents: ["claude"] },
      { key: "KEY-MARINA", name: "Marina", fingerprint: "7F3K·92QA·0000·1111", addedBy: "KEY-ME", addedByName: "Leonardo", at: 1_700_100_000, founder: false, you: false, agents: ["cursor"], rotated: true },
      { key: "KEY-JOE", name: "Joe", fingerprint: "AAAA·BBBB·CCCC·DDDD", addedBy: "KEY-ME", addedByName: "Leonardo", at: 1_700_200_000, founder: false, you: false, agents: [] },
    ],
    removed: [{ key: "KEY-RAFA", name: "Rafa", fingerprint: "C0DE·0000·7A11·1234", at: 1_690_000_000, by: "KEY-ME", byName: "Leonardo", you: false }],
    invites: [{ expires: 1_800_000_000 }],
    member: true,
    canRemove: true,
  },
  peers: [
    { id: "KEY-MARINA", name: "Marina", state: "direct", rttMs: 18, connectedFor: 10 },
    { id: "KEY-JOE", name: "Joe", state: "relay", rttMs: 90 },
    { id: "KEY-X", name: "X", state: "connecting" },
    { id: "KEY-Y", name: "Y", state: "offline" },
  ],
  docs: [{ id: "doc-1", envelopes: 42, authors: 2 }],
  rejected: 0,
  lastRejected: null,
  ...over,
});

describe("toTeamStatus", () => {
  it("is null while unknown or without team mode", () => {
    expect(toTeamStatus(undefined, { docId: "doc-1" })).toBeNull();
    expect(toTeamStatus(null, { docId: "doc-1" })).toBeNull();
  });

  it("counts the peers by route and gives the device and the document's sync state", () => {
    const status = toTeamStatus(raw(), { docId: "doc-1" })!;
    expect(status.peers).toEqual({ direct: 1, relay: 1, connecting: 1, offline: 1 });
    expect(status.device).toEqual({ name: "laptop", fingerprint: "A3F9·B71C·44D2·0C1E" });
    expect(status.workspace).toEqual({ id: "doc-1", shared: true, envelopes: 42 });
    expect(toTeamStatus(raw(), { docId: "other" })!.workspace).toEqual({ id: "other", shared: false, envelopes: 0 });
    expect(status.rejected).toBe(0);
    expect(status).not.toHaveProperty("lastRejectedReason");
  });

  it("maps the members: you are local, the others take the route of their peer, instants go from seconds to milliseconds", () => {
    const team = toTeamStatus(raw(), { docId: "doc-1" })!.team!;
    expect(team.name).toBe("North Studio");
    expect(team.shortId).toBe("A3F9·B71C");
    expect(team.voiceFingerprint).toBe("A3F9 · B71C · 44D2 · E5F6");
    expect(team.canRemove).toBe(true);
    expect(team.member).toBe(true);
    const [you, marina, joe] = team.members;
    expect(you).toMatchObject({ id: "KEY-ME", publicKey: "KEY-ME", you: true, founder: true, connection: "local", at: 1_700_000_000_000, addedByName: null });
    expect(marina).toMatchObject({ connection: "direct", rttMs: 18, rotated: true, addedByName: "Leonardo", fingerprint: "7F3K·92QA·0000·1111" });
    expect(joe).toMatchObject({ connection: "relay", rttMs: 90 });
    expect(joe).not.toHaveProperty("rotated");
    expect(team.removed).toEqual([{ id: "KEY-RAFA", name: "Rafa", fingerprint: "C0DE·0000·7A11·1234", publicKey: "KEY-RAFA", at: 1_690_000_000_000, byName: "Leonardo", you: false }]);
  });

  it("lists a member's agents from the sidecar, and the ones present now with their tool (yours by device, a peer's by the name after @)", () => {
    const agents = [
      { agent: "s:1", actor: "agent:claude", tool: "update_nodes", nodes: [], at: 1 },
      { agent: "peer:abcdef12:s:9", actor: "agent:cursor @ Marina", tool: "get_nodes", nodes: [], at: 1 },
      { agent: "peer:abcdef12:s:8", actor: "agent:gemini @ Joe", tool: "get_nodes", nodes: [], at: 1 },
    ];
    const [you, marina, joe] = toTeamStatus(raw(), { docId: "doc-1", agents })!.team!.members;
    expect(you!.agents.map((agent) => [agent.name, agent.tool])).toEqual([["claude", "update_nodes"]]);
    expect(marina!.agents.map((agent) => [agent.name, agent.tool])).toEqual([["cursor", "get_nodes"]]);
    expect(joe!.agents.map((agent) => agent.name)).toEqual(["gemini"]);
  });

  it("shows create-or-join (team null) when the sidecar has no team, and tells a removed member", () => {
    expect(toTeamStatus(raw({ team: null }), { docId: "d" })!.team).toBeNull();
    const removed = raw();
    (removed.team as { member: boolean }).member = false;
    expect(toTeamStatus(removed, { docId: "d" })!.team!.member).toBe(false);
  });

  it("carries the reason of a rejected connection", () => {
    const status = toTeamStatus(raw({ rejected: 2, lastRejected: { reason: "not a member", peer: "KEY-Z" } }), { docId: "d" })!;
    expect(status.rejected).toBe(2);
    expect(status.lastRejectedReason).toBe("not a member");
    expect(toTeamStatus(raw({ rejected: 1, lastRejected: {} }), { docId: "d" })!.lastRejectedReason).toBeNull();
    expect(toTeamStatus(raw({ rejected: 0, lastRejected: { reason: "old" } }), { docId: "d" })).not.toHaveProperty("lastRejectedReason");
  });

  it("survives a malformed status", () => {
    const status = toTeamStatus({ peers: "no", team: { members: [{}] } } as never, { docId: "d" })!;
    expect(status.peers).toEqual({ direct: 0, relay: 0, connecting: 0, offline: 0 });
    expect(status.team!.members).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("converts seconds to milliseconds on the invites too", () => {
    expect(secondsToMs(1.5)).toBe(1500);
    expect(toTeamInvite({ link: "paprika://join/x", expiresAt: 100 })).toEqual({ link: "paprika://join/x", expiresAt: 100_000 });
    expect(toInvitePreview({ name: "N", fingerprint: "F", expiresAt: 5, expired: true })).toEqual({ name: "N", fingerprint: "F", expiresAt: 5000, expired: true });
  });

  it("groups the id for the voice check", () => {
    expect(voiceFingerprint("7f3k92qalm0x1234")).toBe("7F3K · 92QA · LM0X · 1234");
    expect(voiceFingerprint("")).toBe("");
  });

  it("shows the header pill only with a team, counting you among the people online", () => {
    expect(headerTeam(null)).toBeNull();
    expect(headerTeam(toTeamStatus(raw({ team: null }), { docId: "d" }))).toBeNull();
    expect(headerTeam(toTeamStatus(raw(), { docId: "d" }))).toEqual({ name: "North Studio", online: 3 });
  });
});
