import { useCallback, useMemo, useRef } from "react";
import { Team as TeamFrontend } from "@/components/frontends/team";
import { headerTeam, toInvitePreview, toTeamInvite, toTeamStatus } from "@/adapters/team";
import { useLive, type LiveState } from "@/data/live";
import { teamCommands } from "@/data/queries/team";
import { useEditorActions } from "../editor-store";

const sameChip = (a: { name: string; online: number } | null, b: { name: string; online: number } | null) => a === b || (a !== null && b !== null && a.name === b.name && a.online === b.online);

/** For `header.tsx`: `team` and `onTeamClick` of `EditorHeader`. `team` is `null` without team mode, so nothing shows; the click picks the team tab of the right panel. */
export function useTeamHeader() {
  const { setRightTab } = useEditorActions();
  // The chip shows the name and the online count: a status that changes neither (a heartbeat, a doc list) does not re-render the header.
  // The selector runs on every store update (every delta): the chip is made again only when the raw status is another object.
  const last = useRef<{ raw: LiveState["team"]; chip: ReturnType<typeof headerTeam> } | null>(null);
  const select = useCallback((s: LiveState) => {
    const cached = last.current;
    if (cached && cached.raw === s.team) return cached.chip;
    const chip = headerTeam(toTeamStatus(s.team, { docId: "" }));
    last.current = { raw: s.team, chip };
    return chip;
  }, []);
  const team = useLive(select, sameChip);
  const onTeamClick = useCallback(() => setRightTab("team"), [setRightTab]);
  return { team, onTeamClick };
}

/**
 * The team panel with its commands wired (`/api/team*`). It reads the presence of the agents, so mount it only while
 * it is on screen (the right panel mounts it only while the team tab is picked).
 */
export function TeamPanel({ className }: { className?: string }) {
  const raw = useLive((s) => s.team);
  const docId = useLive((s) => s.doc?.id ?? "");
  const agents = useLive((s) => s.agents);
  const status = useMemo(() => toTeamStatus(raw, { docId, agents }), [raw, docId, agents]);
  const onShareWorkspace = useCallback(() => teamCommands.share(docId), [docId]);
  const onCreateTeam = useCallback((name: string) => teamCommands.createTeam(name), []);
  const onCreateInvite = useCallback((ttlSecs: number) => teamCommands.createInvite(ttlSecs).then(toTeamInvite), []);
  const onRevokeInvites = useCallback(() => teamCommands.revokeInvites(), []);
  const onInspectInvite = useCallback((link: string) => teamCommands.inspectInvite(link).then(toInvitePreview), []);
  const onJoin = useCallback((link: string) => teamCommands.join(link), []);
  const onRemoveMember = useCallback((key: string) => teamCommands.removeMember(key), []);
  const onLeave = useCallback(() => teamCommands.leave(), []);
  const onRotateKey = useCallback(() => teamCommands.rotateKey(), []);
  return (
    <TeamFrontend
      status={status}
      className={className}
      onShareWorkspace={onShareWorkspace}
      onCreateTeam={onCreateTeam}
      onCreateInvite={onCreateInvite}
      onRevokeInvites={onRevokeInvites}
      onInspectInvite={onInspectInvite}
      onJoin={onJoin}
      onRemoveMember={onRemoveMember}
      onLeave={onLeave}
      onRotateKey={onRotateKey}
    />
  );
}
