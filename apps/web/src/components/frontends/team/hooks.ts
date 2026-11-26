import { TeamRegion, initialTeamState } from "./store";

export const useCreateTeamStore = () => TeamRegion.useCreateRegionStore(initialTeamState);
export const useTeamStore = TeamRegion.useRegionStore;
export const useTeamDialog = () => ({ dialog: TeamRegion.useRegion((s) => s.dialog), ...TeamRegion.useRegionActions() });
