import { useCallback, useMemo } from "react";
import { Team as TeamFrontend, TeamChip } from "@/components/frontends/team";
import { headerTeam, toInvitePreview, toTeamInvite, toTeamStatus } from "@/adapters/team";
import { popupBase } from "@/components/ui/overlay-surface";
import { useLive } from "@/data/live";
import { teamCommands } from "@/data/queries/team";
import { cn } from "@/lib/utils";
import { useEditor, useEditorActions } from "../editor-store";

/**
 * Set to `true` when `header.tsx` shows the team through `useTeamHeader` (its own pill, as in the design): this region
 * then renders no chip. Until then a `TeamChip` floats under the header so the panel can be opened.
 */
export const teamInHeader = false;

/** For `header.tsx`: `team` and `onTeamClick` of `EditorHeader`. `team` is `null` without team mode, so nothing shows. */
export function useTeamHeader() {
  const raw = useLive((s) => s.team);
  const docId = useLive((s) => s.doc?.id ?? "");
  const { toggleDialog } = useEditorActions();
  const team = useMemo(() => headerTeam(toTeamStatus(raw, { docId })), [raw, docId]);
  const onTeamClick = useCallback(() => toggleDialog("team"), [toggleDialog]);
  return { team, onTeamClick };
}

/**
 * The team panel with its commands wired (`/api/team*`). It reads the presence of the agents, so mount it only while
 * it is on screen (this region does; the right panel's team tab may use it too).
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

function Chip() {
  const raw = useLive((s) => s.team);
  const docId = useLive((s) => s.doc?.id ?? "");
  const { toggleDialog } = useEditorActions();
  const status = useMemo(() => toTeamStatus(raw, { docId }), [raw, docId]);
  const onClick = useCallback(() => toggleDialog("team"), [toggleDialog]);
  return <TeamChip status={status} onClick={onClick} />;
}

/** Region slot (`editor.tsx`): nothing without team mode; otherwise the chip (until the header hosts it) and the panel while `dialogs.team` is on. */
export function Team() {
  const hasTeam = useLive((s) => s.team != null);
  const open = useEditor((s) => s.dialogs.team);
  if (!hasTeam) return null;
  return (
    <>
      {teamInHeader ? null : (
        <div className="fixed end-3 top-24 z-30" data-testid="team-chip-slot">
          <Chip />
        </div>
      )}
      {open ? (
        <div className={cn("fixed end-3 z-30 max-h-[calc(100dvh-9rem)] w-80 max-w-[calc(100vw-1.5rem)] overflow-y-auto", popupBase, teamInHeader ? "top-14" : "top-34")} data-testid="team-slot">
          <TeamPanel />
        </div>
      ) : null}
    </>
  );
}
