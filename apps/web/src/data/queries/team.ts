import { api, jsonRequest } from "../api";

/**
 * Every `/api/team*` route of `server/internal/team/team.go`. They exist only with `paprika serve --team`; the status
 * itself arrives over the socket (`LiveState.team`), these are the commands. A command that changes the team makes
 * the sidecar push a new status, so nothing is refetched here.
 */
export type TeamInviteReply = { link: string; expiresAt: number };
export type TeamInspectReply = { team?: string; name: string; inviter?: string; fingerprint: string; expiresAt: number; expired: boolean };

export type TeamCommands = {
  createTeam: (name: string) => Promise<unknown>;
  share: (docId: string) => Promise<unknown>;
  createInvite: (ttlSecs: number) => Promise<TeamInviteReply>;
  revokeInvites: () => Promise<unknown>;
  inspectInvite: (link: string) => Promise<TeamInspectReply>;
  join: (link: string) => Promise<unknown>;
  removeMember: (key: string) => Promise<unknown>;
  leave: () => Promise<unknown>;
  rotateKey: () => Promise<{ fingerprint: string }>;
};

export const teamCommands: TeamCommands = {
  createTeam: (name) => api("/api/team", jsonRequest("POST", { name })),
  share: (doc) => api("/api/team/share", jsonRequest("POST", { doc })),
  createInvite: (ttlSecs) => api("/api/team/invites", jsonRequest("POST", { ttlSecs })),
  revokeInvites: () => api("/api/team/invites", jsonRequest("DELETE")),
  inspectInvite: (link) => api("/api/team/invites/inspect", jsonRequest("POST", { link })),
  join: (link) => api("/api/team/join", jsonRequest("POST", { link })),
  removeMember: (key) => api(`/api/team/members/${encodeURIComponent(key)}`, jsonRequest("DELETE")),
  leave: () => api("/api/team/leave", jsonRequest("POST")),
  rotateKey: () => api("/api/team/rotate", jsonRequest("POST")),
};
