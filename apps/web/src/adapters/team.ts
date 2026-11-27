import type { TeamAgentEntry, TeamConnection, TeamInfo, TeamInvite, TeamInvitePreview, TeamMemberEntry, TeamStatus } from "@/components/frontends/team";
import type { RawTeamStatus } from "@/data/live/protocol";
import { agentLabel, type AgentPresence } from "./agents";

/**
 * Status of the sidecar (`status` in `crates/sync/src/node.rs`, relayed by `server/internal/team`) to the frontend's
 * `TeamStatus`. The sidecar counts time in Unix SECONDS and the frontend in milliseconds: every instant is converted here.
 */

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec => (value && typeof value === "object" ? (value as Rec) : {});
const list = (value: unknown): Rec[] => (Array.isArray(value) ? value.map(rec) : []);
const text = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);
const num = (value: unknown, fallback = 0): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

export const secondsToMs = (seconds: number) => Math.round(seconds * 1000);

/** `a3f9b71c44d2…` to `A3F9 · B71C · 44D2` (the groups the people compare by voice). */
export function voiceFingerprint(id: string): string {
  return (id.toUpperCase().match(/.{1,4}/g) ?? []).slice(0, 4).join(" · ");
}

const connections = new Set<TeamConnection>(["direct", "relay", "connecting", "offline"]);
const connectionOf = (state: unknown): TeamConnection => (connections.has(state as TeamConnection) ? (state as TeamConnection) : "offline");

export type TeamAdapterInput = {
  /** Document in view: `workspace.shared` says whether the team already syncs it. */
  docId: string;
  /** Presence of the agents of this editor: the ones of this device are listed under "you", the ones of a peer under that person. */
  agents?: readonly AgentPresence[];
};

function agentsOf(member: Rec, you: boolean, name: string, presence: readonly AgentPresence[]): TeamAgentEntry[] {
  const out: TeamAgentEntry[] = [];
  const add = (agentName: string, tool?: string) => {
    const existing = out.find((entry) => entry.name === agentName);
    if (existing) {
      if (tool && !existing.tool) out[out.indexOf(existing)] = { ...existing, tool };
      return;
    }
    out.push({ id: `${text(member.key)}/${agentName}`, name: agentName, ...(tool ? { tool } : {}) });
  };
  for (const agent of presence) {
    const remote = agent.agent.startsWith("peer:");
    if (you ? !remote : remote && agent.actor.endsWith(` @ ${name}`)) add(agentLabel(agent.actor).replace(/ @ .*$/, ""), agent.tool);
  }
  for (const agentName of Array.isArray(member.agents) ? member.agents : []) if (typeof agentName === "string") add(agentName);
  return out;
}

function toInfo(team: Rec, peers: readonly Rec[], presence: readonly AgentPresence[]): TeamInfo {
  const id = text(team.id);
  const groups = voiceFingerprint(id).split(" · ");
  const members: TeamMemberEntry[] = list(team.members).map((member) => {
    const key = text(member.key);
    const you = member.you === true;
    const name = text(member.name, key.slice(0, 8));
    const peer = peers.find((candidate) => text(candidate.id) === key);
    const rtt = peer?.rttMs;
    return {
      id: key,
      name,
      fingerprint: text(member.fingerprint),
      publicKey: key,
      founder: member.founder === true,
      you,
      ...(member.rotated === true ? { rotated: true } : {}),
      addedByName: typeof member.addedByName === "string" ? member.addedByName : null,
      at: secondsToMs(num(member.at)),
      connection: you ? "local" : connectionOf(peer?.state),
      rttMs: typeof rtt === "number" ? rtt : null,
      agents: agentsOf(member, you, name, presence),
    };
  });
  return {
    id,
    name: text(team.name),
    shortId: groups.slice(0, 2).join("·"),
    voiceFingerprint: voiceFingerprint(id),
    members,
    removed: list(team.removed).map((removed) => ({
      id: text(removed.key),
      name: text(removed.name),
      fingerprint: text(removed.fingerprint),
      publicKey: text(removed.key),
      at: secondsToMs(num(removed.at)),
      byName: typeof removed.byName === "string" ? removed.byName : null,
      you: removed.you === true,
    })),
    canRemove: team.canRemove === true,
    member: team.member !== false,
  };
}

/** `null` while the status is unknown or the server has no team mode (nothing is shown then); a status without a team still shows "create or join". */
export function toTeamStatus(raw: RawTeamStatus | null | undefined, input: TeamAdapterInput): TeamStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const peers = list(raw.peers);
  const count = (state: TeamConnection) => peers.filter((peer) => connectionOf(peer.state) === state).length;
  const rejected = num(raw.rejected);
  const last = raw.lastRejected && typeof raw.lastRejected === "object" ? rec(raw.lastRejected) : null;
  const shared = list(raw.docs).find((doc) => text(doc.id) === input.docId);
  const team = raw.team && typeof raw.team === "object" ? toInfo(rec(raw.team), peers, input.agents ?? []) : null;
  return {
    team,
    peers: { direct: count("direct"), relay: count("relay"), connecting: count("connecting"), offline: count("offline") },
    rejected,
    ...(rejected > 0 && last ? { lastRejectedReason: typeof last.reason === "string" ? last.reason : null } : {}),
    device: { name: text(raw.name), fingerprint: text(raw.fingerprint) },
    workspace: { id: input.docId, shared: shared !== undefined, envelopes: shared ? num(shared.envelopes) : 0 },
  };
}

export const toTeamInvite = (reply: { link: string; expiresAt: number }): TeamInvite => ({ link: reply.link, expiresAt: secondsToMs(reply.expiresAt) });

export const toInvitePreview = (reply: { name: string; fingerprint: string; expiresAt: number; expired: boolean }): TeamInvitePreview => ({
  name: reply.name,
  fingerprint: reply.fingerprint,
  expiresAt: secondsToMs(reply.expiresAt),
  expired: reply.expired,
});

/** What the header chip shows: the team's name and how many people are online (peers connected, plus you). */
export function headerTeam(status: TeamStatus | null): { name: string; online: number } | null {
  if (!status?.team) return null;
  return { name: status.team.name, online: status.peers.direct + status.peers.relay + 1 };
}
