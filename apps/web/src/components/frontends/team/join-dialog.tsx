import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { NoticeCard } from "@/components/ui/notice-card";
import { TextField } from "@/components/ui/text-field";
import { errorText, useAsyncAction } from "@/lib/use-async-action";
import { useNow } from "@/lib/use-now";
import type { TeamActions, TeamClock, TeamInvitePreview, TeamStatus } from "./types";

type Inspection = { link: string; preview: TeamInvitePreview | null; error: string | null };

type JoinDialogProps = TeamClock & {
  device: TeamStatus["device"];
  onInspectInvite: TeamActions["onInspectInvite"];
  onJoin: TeamActions["onJoin"];
  onClose: () => void;
};

export function JoinDialog({ device, onInspectInvite, onJoin, onClose, now: nowProp, clock }: JoinDialogProps) {
  const { t, i18n } = useTranslation();
  const [link, setLink] = useState("");
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [done, setDone] = useState(false);
  const ticket = useRef(0);
  const join = useAsyncAction();
  const now = useNow(nowProp, clock);
  const trimmed = link.trim();

  useEffect(() => {
    const mine = ++ticket.current;
    if (!trimmed) return;
    onInspectInvite(trimmed).then(
      (preview) => {
        if (ticket.current === mine) setInspection({ link: trimmed, preview, error: null });
      },
      (error: unknown) => {
        if (ticket.current === mine) setInspection({ link: trimmed, preview: null, error: errorText(error) });
      },
    );
  }, [trimmed, onInspectInvite]);

  const current = inspection && inspection.link === trimmed && trimmed ? inspection : null;
  const preview = current?.preview ?? null;
  const valid = preview !== null && !preview.expired;
  const time = (at: number) => new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(at);
  const expiredFor = preview?.expired ? Math.max(1, Math.round((now - preview.expiresAt) / 60000)) : 0;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      pendingAnnouncement={t("common.working")}
      closeLabel={t("frontends.team.close")}
      title={t("frontends.team.joinTitle")}
      description={t("frontends.team.joinLead")}
      className="w-110"
      footer={
        <>
          <Button variant="secondary" pendingAnnouncement="" onClick={onClose}>
            {done ? t("frontends.team.closeButton") : t("frontends.team.cancel")}
          </Button>
          {done ? null : (
            <Button disabled={!valid} pendingAnnouncement={t("common.working")} onClick={() => join.run(async () => { await onJoin(trimmed); setDone(true); })}>
              {join.pending ? t("frontends.team.joining") : t("frontends.team.join")}
            </Button>
          )}
        </>
      }
    >
      <TextField
        autoFocus
        aria-label={t("frontends.team.linkLabel")}
        value={link}
        placeholder={t("frontends.team.joinPlaceholder")}
        className="h-9 font-mono text-sm"
        disabled={done}
        onChange={(event) => {
          setLink(event.target.value);
          join.clearError();
        }}
      />
      {preview && !preview.expired ? (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3" data-testid="invite-preview">
          <div className="flex items-center gap-2.5">
            <Avatar initials={preview.name.slice(0, 2).toUpperCase()} tone="agent-4" />
            <div className="flex min-w-0 flex-col">
              <strong className="truncate text-sm text-fg">{preview.name}</strong>
              <span className="text-xs text-muted">{t("frontends.team.validUntil", { time: time(preview.expiresAt) })}</span>
            </div>
          </div>
          <strong className="font-mono text-sm text-fg">{preview.fingerprint}</strong>
          <span className="text-xs text-muted">{t("frontends.team.yourKey", { name: device.name || t("frontends.team.thisDevice"), fingerprint: device.fingerprint })}</span>
        </div>
      ) : null}
      {preview?.expired ? (
        <NoticeCard variant="band" status="warning" title={t("frontends.team.inviteExpired", { count: expiredFor })} role="alert">
          {t("frontends.team.inviteExpiredBody")}
        </NoticeCard>
      ) : null}
      {current?.error ? (
        <NoticeCard variant="band" status="danger" title={t("frontends.team.invalidInvite")} role="alert">
          {current.error}
        </NoticeCard>
      ) : null}
      {join.error !== null ? (
        <NoticeCard variant="band" status="danger" title={t("frontends.team.joinFailed")} role="alert">
          {join.error}
        </NoticeCard>
      ) : null}
      {done ? (
        <p role="status" className="m-0 text-sm font-medium text-green-ink">
          {t("frontends.team.joined")}
        </p>
      ) : null}
    </Dialog>
  );
}
