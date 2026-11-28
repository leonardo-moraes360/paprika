import type { AgentTone } from "@/components/ui/agent-tone";

export type TeamConnection = "local" | "direct" | "relay" | "connecting" | "offline";

export type TeamAgentEntry = { id: string; name: string; tool?: string };

export type TeamMemberEntry = {
  id: string;
  name: string;
  fingerprint: string;
  publicKey?: string;
  founder: boolean;
  you: boolean;
  rotated?: boolean;
  addedByName?: string | null;
  at: number;
  connection: TeamConnection;
  rttMs?: number | null;
  tone?: AgentTone;
  agents: readonly TeamAgentEntry[];
};

export type TeamRemovedEntry = {
  id: string;
  name: string;
  fingerprint: string;
  publicKey?: string;
  at: number;
  byName?: string | null;
  you: boolean;
};

export type TeamInfo = {
  id: string;
  name: string;
  shortId: string;
  voiceFingerprint: string;
  members: readonly TeamMemberEntry[];
  removed: readonly TeamRemovedEntry[];
  canRemove: boolean;
  member: boolean;
};

export type TeamStatus = {
  team: TeamInfo | null;
  peers: { direct: number; relay: number; connecting: number; offline: number };
  rejected: number;
  lastRejectedReason?: string | null;
  device: { name: string; fingerprint: string };
  workspace?: { id: string; shared: boolean; envelopes: number };
};

export type TeamInvite = { link: string; expiresAt: number };

export type TeamInvitePreview = {
  name: string;
  fingerprint: string;
  expiresAt: number;
  expired: boolean;
};

export type TeamActions = {
  onCreateTeam: (name: string) => Promise<unknown>;
  onShareWorkspace?: () => Promise<unknown>;
  onCreateInvite: (ttlSecs: number) => Promise<TeamInvite>;
  onRevokeInvites: () => Promise<unknown>;
  onInspectInvite: (link: string) => Promise<TeamInvitePreview>;
  onJoin: (link: string) => Promise<unknown>;
  onRemoveMember: (memberId: string) => Promise<unknown>;
  onLeave: () => Promise<unknown>;
  onRotateKey: () => Promise<{ fingerprint: string } | void>;
};

export type TeamClock = { now?: number; clock?: () => number };

export type TeamProps = TeamActions &
  TeamClock & {
    status: TeamStatus | null;
    className?: string;
  };

export type TeamChipProps = {
  status: TeamStatus | null;
  onClick: () => void;
  className?: string;
};
