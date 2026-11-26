import type { TeamStatus } from "./types";

export type SummaryTone = "ok" | "warn" | "off" | "bad";

export type TeamSummary =
  | { key: "local"; tone: SummaryTone }
  | { key: "rejected" | "alone" | "offline" | "connecting"; name: string; tone: SummaryTone }
  | { key: "relay" | "synced"; name: string; online: number; tone: SummaryTone };

export function summarizeTeam(status: TeamStatus | null): TeamSummary {
  const team = status?.team;
  if (!status || !team) return { key: "local", tone: "off" };
  const { direct, relay, connecting, offline } = status.peers;
  const online = direct + relay;
  const name = team.name;
  if (status.rejected > 0 && status.lastRejectedReason !== undefined) return { key: "rejected", name, tone: "bad" };
  if (online + connecting + offline === 0) return { key: "alone", name, tone: "off" };
  if (online === 0 && connecting === 0) return { key: "offline", name, tone: "off" };
  if (connecting > 0) return { key: "connecting", name, tone: "warn" };
  if (relay > 0) return { key: "relay", name, online: online + 1, tone: "warn" };
  return { key: "synced", name, online: online + 1, tone: "ok" };
}

export function countdown(expiresAt: number, now: number): { seconds: number; text: string } {
  const seconds = Math.max(0, Math.round((expiresAt - now) / 1000));
  return { seconds, text: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` };
}
