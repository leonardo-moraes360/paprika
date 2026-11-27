import { UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { KeyTable, KeyTableCell, KeyTableRow } from "@/components/ui/key-table";
import { NoticeCard } from "@/components/ui/notice-card";
import { Tag } from "@/components/ui/tag";
import type { TeamConnection, TeamInfo, TeamStatus } from "./types";

type KeysDialogProps = {
  team: TeamInfo;
  rejected: number;
  lastRejectedReason?: string | null;
  onInvite: () => void;
  onRemove: (memberId: string) => void;
  onLeave: () => void;
  onRotate: () => void;
  onClose: () => void;
};

export function KeysDialog({ team, rejected, lastRejectedReason, onInvite, onRemove, onLeave, onRotate, onClose }: KeysDialogProps) {
  const { t, i18n } = useTranslation();
  const date = (at: number) => new Intl.DateTimeFormat(i18n.language, { day: "2-digit", month: "short" }).format(at);
  const headers = [
    t("frontends.team.colWho"),
    t("frontends.team.colKind"),
    t("frontends.team.colKey"),
    t("frontends.team.colDelegated"),
    t("frontends.team.colSince"),
    t("frontends.team.colState"),
    t("frontends.team.colActions"),
  ];
  const stateOf = (connection: TeamConnection, you: boolean) => (you || connection !== "offline" ? "active" : "offline");

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      pendingAnnouncement={t("common.working")}
      closeLabel={t("frontends.team.close")}
      title={t("frontends.team.keysTitle")}
      description={t("frontends.team.keysLead")}
      className="w-240"
      footer={
        team.member ? (
          <Button pendingAnnouncement="" onClick={onInvite}>
            <UserPlus aria-hidden="true" />
            {t("frontends.team.invite")}
          </Button>
        ) : null
      }
    >
      {!team.member ? (
        <NoticeCard variant="band" status="danger" title={t("frontends.team.removedYouTitle")}>
          {t("frontends.team.removedYouBody")}
        </NoticeCard>
      ) : null}
      <KeyTable headers={headers} aria-label={t("frontends.team.keysTitle")}>
        {team.members.flatMap((member) => {
          const state = stateOf(member.connection, member.you);
          return [
            <KeyTableRow key={member.id}>
              <KeyTableCell strong>{member.you ? t("frontends.team.nameYou", { name: member.name }) : member.name}</KeyTableCell>
              <KeyTableCell muted>{t("frontends.team.kindPerson")}</KeyTableCell>
              <KeyTableCell mono title={member.publicKey}>
                ed25519 {member.fingerprint}
              </KeyTableCell>
              <KeyTableCell muted>
                {member.rotated ? t("frontends.team.delegatedRotated") : member.founder ? t("frontends.team.founder") : t("frontends.team.delegatedInvite", { name: member.addedByName ?? "?" })}
              </KeyTableCell>
              <KeyTableCell muted>{date(member.at)}</KeyTableCell>
              <KeyTableCell>
                <Tag tone={state === "active" ? "green" : "neutral"}>{t(`frontends.team.state.${state}`)}</Tag>
              </KeyTableCell>
              <KeyTableCell>
                <span className="flex flex-wrap justify-end gap-1.5">
                  {member.you && team.member ? (
                    <>
                      {!member.founder ? (
                        <Button variant="destructive" size="sm" pendingAnnouncement="" onClick={onLeave}>
                          {t("frontends.team.leave")}
                        </Button>
                      ) : null}
                      <Button variant="secondary" size="sm" pendingAnnouncement="" onClick={onRotate}>
                        {t("frontends.team.rotateConfirm")}
                      </Button>
                    </>
                  ) : null}
                  {!member.you && !member.founder && team.canRemove ? (
                    <Button variant="destructive" size="sm" pendingAnnouncement="" aria-label={t("frontends.team.removeMember", { name: member.name })} onClick={() => onRemove(member.id)}>
                      {t("frontends.team.remove")}
                    </Button>
                  ) : null}
                </span>
              </KeyTableCell>
            </KeyTableRow>,
            ...member.agents.map((agent) => (
              <KeyTableRow key={`${member.id}/${agent.id}`}>
                <KeyTableCell strong>{t("frontends.team.agentAt", { agent: agent.name, name: member.name })}</KeyTableCell>
                <KeyTableCell muted>{t("frontends.team.kindAgent")}</KeyTableCell>
                <KeyTableCell mono muted>
                  {t("frontends.team.derivedFrom", { name: member.name })}
                </KeyTableCell>
                <KeyTableCell muted>{member.name}</KeyTableCell>
                <KeyTableCell muted>—</KeyTableCell>
                <KeyTableCell>
                  <Tag tone="green">{t("frontends.team.state.active")}</Tag>
                </KeyTableCell>
                <KeyTableCell />
              </KeyTableRow>
            )),
          ];
        })}
        {team.removed.map((removed) => (
          <KeyTableRow key={`removed/${removed.id}`} data-removed="">
            <KeyTableCell strong>{removed.you ? t("frontends.team.nameYou", { name: removed.name }) : removed.name}</KeyTableCell>
            <KeyTableCell muted>{t("frontends.team.kindPerson")}</KeyTableCell>
            <KeyTableCell mono title={removed.publicKey}>
              ed25519 {removed.fingerprint}
            </KeyTableCell>
            <KeyTableCell muted>{t("frontends.team.removedBy", { name: removed.byName ?? "?" })}</KeyTableCell>
            <KeyTableCell muted>{date(removed.at)}</KeyTableCell>
            <KeyTableCell>
              <Tag tone="red">{t("frontends.team.state.removed")}</Tag>
            </KeyTableCell>
            <KeyTableCell />
          </KeyTableRow>
        ))}
      </KeyTable>
      {rejected > 0 ? (
        <NoticeCard variant="band" status="danger" title={t("frontends.team.rejected", { count: rejected })} role="status">
          {t("frontends.team.rejectedBody", { reason: lastRejectedReason ?? "" })}
        </NoticeCard>
      ) : null}
      <p className="m-0 flex items-center gap-2 text-sm text-muted">
        <Tag tone="yellow">{t("frontends.team.soon")}</Tag>
        {t("frontends.team.rolesNote")}
      </p>
    </Dialog>
  );
}

export type { TeamStatus };
