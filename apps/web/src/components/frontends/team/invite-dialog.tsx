import { Copy } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { encode } from "uqr";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { NoticeCard } from "@/components/ui/notice-card";
import { QrCode } from "@/components/ui/qr-code";
import { SegmentedControl, SegmentedControlItem } from "@/components/ui/segmented-control";
import { TextField } from "@/components/ui/text-field";
import { Tooltip } from "@/components/ui/tooltip";
import { useAsyncAction, errorText } from "@/lib/use-async-action";
import { useNow } from "@/lib/use-now";
import { copyText } from "@/lib/copy-text";
import { countdown } from "./team-model";
import type { TeamActions, TeamClock, TeamInfo, TeamInvite } from "./types";

const ttls = [
  { secs: 900, key: "ttl15m" },
  { secs: 3600, key: "ttl1h" },
  { secs: 86400, key: "ttl24h" },
  { secs: 604800, key: "ttl7d" },
] as const;

type InviteDialogProps = TeamClock & {
  team: TeamInfo;
  onCreateInvite: TeamActions["onCreateInvite"];
  onRevokeInvites: TeamActions["onRevokeInvites"];
  onClose: () => void;
};

export function InviteDialog({ team, onCreateInvite, onRevokeInvites, onClose, now: nowProp, clock }: InviteDialogProps) {
  const { t, i18n } = useTranslation();
  const [ttl, setTtl] = useState(3600);
  const [invite, setInvite] = useState<TeamInvite | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const requested = useRef<number | null>(null);
  const ticket = useRef(0);
  const linkField = useRef<HTMLInputElement>(null);
  const revoke = useAsyncAction();
  const now = useNow(nowProp, clock);

  useEffect(() => {
    if (requested.current === ttl) return;
    requested.current = ttl;
    const mine = ++ticket.current;
    setInvite(null);
    setCreateError(null);
    setCopied(null);
    onCreateInvite(ttl).then(
      (result) => {
        if (ticket.current === mine) setInvite(result);
      },
      (error: unknown) => {
        if (ticket.current === mine) setCreateError(errorText(error));
      },
    );
  }, [ttl, onCreateInvite]);

  useEffect(() => {
    if (copied === null) return;
    const id = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(id);
  }, [copied]);

  const modules = useMemo(() => (invite ? encode(invite.link, { ecc: "L", border: 2 }).data : null), [invite]);
  const left = invite ? countdown(invite.expiresAt, now) : null;
  const expired = left !== null && left.seconds === 0;
  const clockTime = invite ? new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(invite.expiresAt) : "";

  const copy = async () => {
    if (!invite) return;
    setCopied((await copyText(invite.link, linkField.current)) ? "yes" : "no");
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      pendingAnnouncement={t("common.working")}
      closeLabel={t("frontends.team.close")}
      title={t("frontends.team.inviteTitle", { name: team.name })}
      description={t("frontends.team.inviteLead")}
      className="w-150"
      footer={
        <>
          <Button variant="destructive" className="me-auto" pendingAnnouncement={t("common.working")} onClick={() => revoke.run(() => onRevokeInvites().then(onClose))}>
            {t("frontends.team.revoke")}
          </Button>
          <Button variant="secondary" pendingAnnouncement="" onClick={onClose}>
            {t("frontends.team.closeButton")}
          </Button>
          <Button disabled={!invite || expired} pendingAnnouncement="" onClick={copy}>
            <Copy aria-hidden="true" />
            {copied === "yes" ? t("frontends.team.copied") : t("frontends.team.copyLink")}
          </Button>
        </>
      }
    >
      {createError !== null ? (
        <NoticeCard variant="band" status="danger" title={t("frontends.team.inviteFailed")} role="alert">
          {createError}
        </NoticeCard>
      ) : null}
      <div className="flex items-start gap-5">
        {modules ? <QrCode modules={modules} label={t("frontends.team.qrLabel")} size={152} /> : <div aria-hidden="true" className="size-38 shrink-0 rounded-lg bg-surface" />}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-end gap-1.5">
            <TextField
              ref={linkField}
              readOnly
              label={t("frontends.team.linkLabel")}
              value={invite?.link ?? ""}
              placeholder={t("frontends.team.generating")}
              className="h-8 font-mono text-sm"
              fieldClassName="flex-1"
              onFocus={(event) => event.currentTarget.select()}
            />
            <Tooltip content={t("frontends.team.copyField")}>
              <IconButton size="md" bordered aria-label={t("frontends.team.copyField")} disabled={!invite || expired} focusableWhenDisabled onClick={copy} className="text-fg">
                <Copy aria-hidden="true" />
              </IconButton>
            </Tooltip>
          </div>
          <div className="flex flex-col gap-1.5">
            <span id="invite-ttl-label" className="text-xs font-semibold text-label">
              {t("frontends.team.expiresIn")}
            </span>
            <SegmentedControl aria-labelledby="invite-ttl-label" value={String(ttl)} onValueChange={(value) => value && setTtl(Number(value))}>
              {ttls.map((option) => (
                <SegmentedControlItem key={option.secs} value={String(option.secs)}>
                  {t(`frontends.team.${option.key}`)}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          </div>
          {invite && left ? (
            <p className="m-0 text-xs text-muted" aria-live="off">
              {expired ? t("frontends.team.expired") : t("frontends.team.deadline", { time: clockTime, left: left.text })}
            </p>
          ) : null}
          {copied === "no" ? (
            <p role="status" className="m-0 text-xs text-muted">
              {t("frontends.team.copyManual")}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2.5">
        <span className="text-sm text-muted">{t("frontends.team.voice")}</span>
        <span className="font-mono text-sm font-bold text-fg">{team.voiceFingerprint}</span>
      </div>
      {revoke.error !== null ? (
        <p role="alert" className="m-0 text-sm font-medium text-red-ink">
          {t("frontends.team.failed", { message: revoke.error })}
        </p>
      ) : null}
    </Dialog>
  );
}
