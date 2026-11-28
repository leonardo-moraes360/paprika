import { Crosshair, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { PinBadge, PinBubble, PinReply } from "@/components/ui/pin-bubble";
import { PinStatusChip } from "@/components/ui/pin-status-chip";
import { TextField } from "@/components/ui/text-field";
import { Tooltip } from "@/components/ui/tooltip";
import { relativeParts } from "@/lib/relative-time";
import { useAsyncAction } from "@/lib/use-async-action";
import { useNow } from "@/lib/use-now";
import { targetLabel } from "./pin-target";
import type { PinAuthor, PinCardProps } from "./types";
import { usePinHotkeys } from "./use-pin-hotkeys";

function PinCardBody({ pin, now: nowProp, clock, onReply, onSetStatus, onDelete, onShow, onClose, maxLength = 2000, className }: PinCardProps) {
  const { t } = useTranslation();
  const now = useNow(nowProp, clock);
  const [draft, setDraft] = useState("");
  const reply = useAsyncAction();
  const status = useAsyncAction();
  const remove = useAsyncAction();
  const scope = useRef<HTMLDivElement>(null);
  const busy = reply.pending || status.pending || remove.pending;
  const failure = reply.error ?? status.error ?? remove.error;
  const error = failure === null ? null : failure.trim() ? failure : t("frontends.pins.unknownError");
  const ago = (at: number) => {
    const parts = relativeParts(at, now, 30);
    return t(`frontends.pins.ago.${parts.unit}`, { count: parts.count });
  };
  const name = (author: PinAuthor) => (author.you ? t("frontends.pins.you") : author.name);

  const sendReply = async () => {
    const text = draft.trim();
    if (!text) return;
    if (await reply.run(() => onReply(text))) setDraft("");
  };
  usePinHotkeys(scope, {
    submit: draft.trim() ? () => void sendReply() : undefined,
    cancel: draft ? () => setDraft("") : onClose,
  });

  const resolved = pin.status === "resolved";
  return (
    <PinBubble className={className} data-testid="pin-card">
      <div ref={scope} className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <PinBadge number={pin.number} status={pin.status} tone={pin.claimedBy?.tone} />
          <span className="truncate text-sm font-semibold text-fg">{name(pin.author)}</span>
          <span className="shrink-0 text-sm text-muted">{ago(pin.createdAt)}</span>
          <span className="flex-1" />
          {onClose ? (
            <IconButton size="xs" aria-label={t("frontends.pins.close")} onClick={onClose}>
              <X aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
        <p className="m-0 text-base leading-[1.45] break-words whitespace-pre-wrap text-fg">{pin.text}</p>
        <div className="flex flex-wrap items-center gap-2">
          <PinStatusChip status={pin.status} tone={pin.claimedBy?.tone}>
            {pin.status === "open" ? t("frontends.pins.statusOpen") : pin.status === "resolved" ? t("frontends.pins.statusResolved") : (pin.claimedBy?.name ?? t("frontends.pins.statusClaimed"))}
          </PinStatusChip>
          <span className="inline-flex items-center gap-1 text-sm text-muted">
            <Crosshair aria-hidden="true" className="size-3.5" />
            {targetLabel(t, pin.target)}
          </span>
        </div>
        {pin.status === "claimed" && pin.claimedBy ? (
          <p className="m-0 flex items-center gap-2 rounded-lg bg-surface px-2.5 py-2 text-sm text-fg">
            <span aria-hidden="true" className="size-2 rounded-full bg-current" />
            {t("frontends.pins.working", { name: pin.claimedBy.name })}
          </p>
        ) : null}
        {pin.replies.length > 0 ? (
          <div className="flex flex-col gap-2.5" role="list" aria-label={t("frontends.pins.thread")}>
            {pin.replies.map((entry) => (
              <PinReply key={entry.id} role="listitem" tone={entry.author.you ? "you" : (entry.author.tone ?? "agent-1")} author={name(entry.author)} time={ago(entry.createdAt)}>
                {entry.text}
              </PinReply>
            ))}
          </div>
        ) : null}
        <TextField
          aria-label={t("frontends.pins.replyPlaceholder")}
          placeholder={t("frontends.pins.replyPlaceholder")}
          value={draft}
          maxLength={maxLength}
          readOnly={reply.pending}
          aria-busy={reply.pending || undefined}
          className="h-9 text-sm"
          onChange={(event) => {
            setDraft(event.target.value);
            reply.clearError();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void sendReply();
            }
          }}
        />
        <div className="flex items-center gap-1.5">
          <Button variant="secondary" size="sm" className="h-7.5 data-disabled:border-line data-disabled:text-muted data-disabled:opacity-100" disabled={!draft.trim() || (busy && !reply.pending)} aria-busy={reply.pending || undefined} pendingAnnouncement={t("common.working")} onClick={sendReply}>
            {t("frontends.pins.reply")}
          </Button>
          {onShow ? (
            <Tooltip content={t("frontends.pins.show")}>
              <IconButton size="md" bordered aria-label={t("frontends.pins.show")} onClick={onShow} className="size-7.5 text-fg">
                <Crosshair aria-hidden="true" />
              </IconButton>
            </Tooltip>
          ) : null}
          <span className="flex-1" />
          <Tooltip content={t("frontends.pins.delete")}>
            <IconButton
              size="md"
              aria-label={t("frontends.pins.delete")}
              disabled={busy && !remove.pending}
              focusableWhenDisabled
              pendingAnnouncement={t("common.working")}
              className="size-7.5 text-red-ink"
              onClick={() => remove.run(onDelete)}
            >
              <Trash2 aria-hidden="true" />
            </IconButton>
          </Tooltip>
        </div>
        <Button
          variant={resolved ? "secondary" : "primary"}
          className="h-8 self-start"
          disabled={busy && !status.pending}
          pendingAnnouncement={t("common.working")}
          onClick={() => status.run(() => onSetStatus(resolved ? "open" : "resolved"))}
        >
          {resolved ? t("frontends.pins.reopen") : t("frontends.pins.resolve")}
        </Button>
        {error !== null ? (
          <p role="alert" className="m-0 text-sm font-medium text-red-ink">
            {t("frontends.pins.failed", { message: error })}
          </p>
        ) : null}
      </div>
    </PinBubble>
  );
}

export function PinCard(props: PinCardProps) {
  return <PinCardBody key={props.pin.id} {...props} />;
}
