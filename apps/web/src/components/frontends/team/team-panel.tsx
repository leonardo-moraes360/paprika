import { Bot, KeyRound, Link2, Share2, UserPlus, Users } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AppT } from "@/i18n/resources";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { MemberRow } from "@/components/ui/member-row";
import { NoticeCard } from "@/components/ui/notice-card";
import { Tag } from "@/components/ui/tag";
import { TextField } from "@/components/ui/text-field";
import { useAsyncAction, errorOrFallback } from "@/lib/use-async-action";
import { cn } from "@/lib/utils";
import { InviteDialog } from "./invite-dialog";
import { JoinDialog } from "./join-dialog";
import { KeysDialog } from "./keys-dialog";
import { LeaveTeamDialog, RemoveMemberDialog, RotateKeyDialog } from "./confirm-dialogs";
import { TeamRegion, initialTeamState } from "./store";
import { summarizeTeam } from "./team-model";
import type { TeamConnection, TeamMemberEntry, TeamProps, TeamStatus } from "./types";

type TeamPanelProps = TeamProps & { store?: ReturnType<typeof TeamRegion.useCreateRegionStore> };

export function Team({ store, ...props }: TeamPanelProps) {
  return (
    <TeamRegion.Provider store={store} initial={initialTeamState}>
      <TeamView {...props} />
    </TeamRegion.Provider>
  );
}

const chipTone: Record<TeamConnection, "select" | "green" | "yellow" | "neutral"> = {
  local: "select",
  direct: "green",
  relay: "yellow",
  connecting: "select",
  offline: "neutral",
};

function TeamView(props: TeamProps) {
  const { status, className, now, clock } = props;
  const { t } = useTranslation();
  const dialog = TeamRegion.useRegion((s) => s.dialog);
  const memberId = TeamRegion.useRegion((s) => s.memberId);
  const actions = TeamRegion.useRegionActions();
  const root = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);

  useLayoutEffect(() => {
    const open = dialog !== null;
    if (wasOpen.current && !open) {
      const active = document.activeElement;
      if (!active || active === document.body || !root.current?.contains(active)) root.current?.focus();
    }
    wasOpen.current = open;
  }, [dialog]);

  const team = status?.team ?? null;
  const rootProps = { ref: root, tabIndex: -1, "aria-label": t("frontends.team.title"), "data-testid": "team-panel", className: cn("flex flex-col gap-3.5 p-3.5 outline-none", className) } as const;

  if (!status) {
    return (
      <section {...rootProps}>
        <p className="m-0 text-sm text-muted">{t("frontends.team.connecting")}</p>
      </section>
    );
  }
  if (!team) {
    return (
      <section {...rootProps}>
        <NoTeam onCreateTeam={props.onCreateTeam} />
        {dialog === "join" ? <JoinDialog device={status.device} onInspectInvite={props.onInspectInvite} onJoin={props.onJoin} onClose={actions.close} now={now} clock={clock} /> : null}
      </section>
    );
  }

  const removing = team.members.find((member) => member.id === memberId);
  const you = team.members.find((member) => member.you);
  return (
    <section {...rootProps}>
      <Overview status={status} onShareWorkspace={props.onShareWorkspace} />
      {dialog === "invite" ? <InviteDialog team={team} onCreateInvite={props.onCreateInvite} onRevokeInvites={props.onRevokeInvites} onClose={actions.close} now={now} clock={clock} /> : null}
      {dialog === "join" ? <JoinDialog device={status.device} onInspectInvite={props.onInspectInvite} onJoin={props.onJoin} onClose={actions.close} now={now} clock={clock} /> : null}
      {dialog === "keys" ? (
        <KeysDialog
          team={team}
          rejected={status.rejected}
          lastRejectedReason={status.lastRejectedReason}
          onInvite={() => actions.open("invite")}
          onRemove={(id) => actions.open("remove", id)}
          onLeave={() => actions.open("leave")}
          onRotate={() => actions.open("rotate")}
          onClose={actions.close}
        />
      ) : null}
      {dialog === "remove" && removing ? <RemoveMemberDialog member={removing} onRemoveMember={props.onRemoveMember} onClose={actions.close} /> : null}
      {dialog === "leave" ? <LeaveTeamDialog onLeave={props.onLeave} onClose={actions.close} /> : null}
      {dialog === "rotate" ? <RotateKeyDialog fingerprint={you?.fingerprint ?? status.device.fingerprint} onRotateKey={props.onRotateKey} onClose={actions.close} /> : null}
    </section>
  );
}

function NoTeam({ onCreateTeam }: Pick<TeamProps, "onCreateTeam">) {
  const { t } = useTranslation();
  const actions = TeamRegion.useRegionActions();
  const [name, setName] = useState("");
  const create = useAsyncAction();
  return (
    <>
      <h2 className="m-0 text-base font-bold text-fg">{t("frontends.team.title")}</h2>
      <p className="m-0 text-sm leading-[1.45] text-muted">{t("frontends.team.noTeam")}</p>
      <TextField
        label={t("frontends.team.nameLabel")}
        value={name}
        placeholder={t("frontends.team.namePlaceholder")}
        className="h-9 text-sm"
        onChange={(event) => {
          setName(event.target.value);
          create.clearError();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && name.trim()) void create.run(() => onCreateTeam(name.trim()));
        }}
      />
      {create.error !== null ? (
        <p role="alert" className="m-0 text-sm font-medium text-red-ink">
          {t("frontends.team.failed", { message: errorOrFallback(create.error, t("frontends.team.unknownError")) })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="md" className="h-8" disabled={!name.trim()} pendingAnnouncement={t("common.working")} onClick={() => create.run(() => onCreateTeam(name.trim()))}>
          <Users aria-hidden="true" />
          {t("frontends.team.create")}
        </Button>
        <Button variant="secondary" className="h-8" pendingAnnouncement="" onClick={() => actions.open("join")}>
          <Link2 aria-hidden="true" />
          {t("frontends.team.joinWithInvite")}
        </Button>
      </div>
    </>
  );
}

function subtitle(t: AppT, member: TeamMemberEntry) {
  const rtt = member.rttMs ?? null;
  const where =
    member.connection === "local"
      ? t("frontends.team.thisDeviceLower")
      : member.connection === "direct"
        ? rtt === null
          ? t("frontends.team.quic")
          : t("frontends.team.quicRtt", { rtt })
        : member.connection === "relay"
          ? rtt === null
            ? t("frontends.team.viaRelay")
            : t("frontends.team.viaRelayRtt", { rtt })
          : t(`frontends.team.state.${member.connection === "connecting" ? "connecting" : "offline"}`);
  return member.founder ? t("frontends.team.withFounder", { where }) : where;
}

function Overview({ status, onShareWorkspace }: Pick<TeamProps, "onShareWorkspace"> & { status: TeamStatus }) {
  const { t } = useTranslation();
  const actions = TeamRegion.useRegionActions();
  const team = status.team as NonNullable<TeamStatus["team"]>;
  const share = useAsyncAction();
  const summary = summarizeTeam(status);
  const agentCount = team.members.reduce((n, member) => n + member.agents.length, 0);
  const shared = status.workspace?.shared ?? false;
  const online = status.peers.direct + status.peers.relay;
  const syncLabel = !shared ? t("frontends.team.syncNotShared") : online > 0 ? t("frontends.team.syncSynced") : t("frontends.team.syncLocalNow");

  return (
    <>
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 text-base font-bold text-fg">{team.name}</h2>
        <p className="m-0 text-xs text-muted">{t("frontends.team.summary", { id: team.shortId, count: team.members.length, agents: agentCount })}</p>
      </div>
      {!team.member ? (
        <NoticeCard variant="band" status="danger" title={t("frontends.team.removedYouTitle")}>
          {t("frontends.team.removedYouBody")}
        </NoticeCard>
      ) : null}
      <section aria-label={t("frontends.team.syncTitle")} className="flex flex-col gap-2 rounded-lg bg-surface p-3" data-testid="team-sync">
        <div className="flex items-center gap-2">
          <h3 className="m-0 flex-1 text-sm font-semibold text-fg">{t("frontends.team.syncTitle")}</h3>
          <Tag tone={summary.tone === "ok" ? "green" : summary.tone === "bad" ? "red" : summary.tone === "warn" ? "yellow" : "neutral"}>{syncLabel}</Tag>
        </div>
        <p className="m-0 text-xs text-muted">{t("frontends.team.routes", { direct: status.peers.direct, relay: status.peers.relay })}</p>
        {shared && status.workspace ? <p className="m-0 text-xs text-muted">{t("frontends.team.envelopes", { id: status.workspace.id, count: status.workspace.envelopes })}</p> : null}
        {!shared && onShareWorkspace && status.workspace ? (
          <Button size="sm" className="h-7 self-start" pendingAnnouncement={t("common.working")} onClick={() => share.run(onShareWorkspace)}>
            <Share2 aria-hidden="true" />
            {t("frontends.team.share")}
          </Button>
        ) : null}
        {share.error !== null ? (
          <p role="alert" className="m-0 text-xs font-medium text-red-ink">
            {t("frontends.team.failed", { message: errorOrFallback(share.error, t("frontends.team.unknownError")) })}
          </p>
        ) : null}
      </section>
      <section aria-labelledby="team-people" className="flex flex-col">
        <h3 id="team-people" className="mb-1 text-xs font-bold tracking-[0.8px] text-muted uppercase">
          {t("frontends.team.people")}
        </h3>
        <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
          {team.members.map((member) => (
            <li key={member.id}>
              <MemberRow
                data-member={member.id}
                avatar={<Avatar initials={member.name.slice(0, 2).toUpperCase()} tone={member.tone ?? (member.you ? "select-pill" : "agent-4")} />}
                name={member.you ? t("frontends.team.nameYou", { name: member.name }) : member.name}
                subtitle={subtitle(t, member)}
                status={<Tag tone={chipTone[member.connection]}>{t(`frontends.team.state.${member.connection}`)}</Tag>}
                actions={
                  member.you && !member.founder && team.member ? (
                    <Button variant="destructive" size="sm" className="h-6.5 text-xs" pendingAnnouncement="" onClick={() => actions.open("leave")}>
                      {t("frontends.team.leave")}
                    </Button>
                  ) : team.canRemove && !member.you && !member.founder ? (
                    <Button variant="destructive" size="sm" className="h-6.5 text-xs" pendingAnnouncement="" aria-label={t("frontends.team.removeMember", { name: member.name })} onClick={() => actions.open("remove", member.id)}>
                      {t("frontends.team.remove")}
                    </Button>
                  ) : undefined
                }
              >
                {member.agents.map((agent) => (
                  <div key={agent.id} className="flex items-center gap-2 text-xs">
                    <Bot aria-hidden="true" className="size-3.5 shrink-0 text-muted" />
                    <span className="flex-1 truncate text-fg">{agent.name}</span>
                    <span className="text-muted">{agent.tool ?? t("frontends.team.kindAgent")}</span>
                  </div>
                ))}
              </MemberRow>
            </li>
          ))}
        </ul>
      </section>
      {team.canRemove && team.members.length > 1 ? <p className="m-0 text-xs text-muted">{t("frontends.team.founderOnly")}</p> : null}
      {team.removed.length > 0 ? (
        <p className="m-0 text-xs text-muted" data-testid="team-removed-count">
          {t("frontends.team.removedCount", { count: team.removed.length, names: team.removed.map((removed) => removed.name).join(", ") })}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" className="h-8" pendingAnnouncement="" onClick={() => actions.open("keys")}>
          <KeyRound aria-hidden="true" />
          {t("frontends.team.keys")}
        </Button>
        {team.member ? (
          <Button className="h-8" pendingAnnouncement="" onClick={() => actions.open("invite")}>
            <UserPlus aria-hidden="true" />
            {t("frontends.team.invite")}
          </Button>
        ) : null}
      </div>
    </>
  );
}
