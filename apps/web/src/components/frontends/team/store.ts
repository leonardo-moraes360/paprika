import { createRegion } from "../_shared";

export type TeamDialog = "invite" | "join" | "keys" | "remove" | "leave" | "rotate";

export type TeamRegionState = {
  dialog: TeamDialog | null;
  returnTo: "keys" | null;
  memberId: string | null;
};

export type TeamRegionActions = {
  open: (dialog: TeamDialog, memberId?: string) => void;
  close: () => void;
};

export const initialTeamState: TeamRegionState = { dialog: null, returnTo: null, memberId: null };

export const TeamRegion = createRegion<TeamRegionState, TeamRegionActions>("Team", ({ setState }) => ({
  open: (dialog, memberId) =>
    setState((s) => ({ dialog, memberId: memberId ?? null, returnTo: s.dialog === "keys" && dialog !== "invite" && dialog !== "join" ? "keys" : null })),
  close: () => setState((s) => ({ dialog: s.returnTo, returnTo: null, memberId: null })),
}));
