import { Crosshair, Link2, Image as ImageIcon, Paperclip, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AttachedReference } from "@/components/ui/attached-reference";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";
import { PinBadge, PinBubble } from "@/components/ui/pin-bubble";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { TextArea } from "@/components/ui/text-area";
import { useAsyncAction } from "@/lib/use-async-action";
import { targetLabel } from "./pin-target";
import type { NewPinFormProps } from "./types";
import { usePinHotkeys } from "./use-pin-hotkeys";

const ANY = "__any__";

export function NewPinForm({
  number,
  target,
  recipients = [],
  references = [],
  onSubmit,
  onCancel,
  onAttachReference,
  onRemoveReference,
  submitShortcut,
  maxLength = 500,
  defaultAttachRegion = true,
  className,
}: NewPinFormProps) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [recipient, setRecipient] = useState(ANY);
  const [attachRegion, setAttachRegion] = useState(defaultAttachRegion);
  const action = useAsyncAction();
  const scope = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const options = [{ value: ANY, label: t("frontends.pins.anyAgent") }, ...recipients];
  
  const submit = () => {
    const body = text.trim();
    if (!body || action.pending) return undefined;
    return action.run(() => onSubmit({ text: body, recipient: recipient === ANY ? null : recipient, attachRegion }));
  };
  usePinHotkeys(scope, { submit: () => void submit(), cancel: onCancel });

  return (
    <PinBubble role="group" aria-labelledby={titleId} className={className ?? "w-90"} data-testid="new-pin-form">
      <div ref={scope} className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <PinBadge number={number} />
          <h2 id={titleId} className="min-w-0 flex-1 text-sm font-bold text-fg">
            {t("frontends.pins.newTitle")}
          </h2>
          <IconButton size="xs" aria-label={t("frontends.pins.close")} onClick={onCancel}>
            <X aria-hidden="true" />
          </IconButton>
        </div>
        <div className="flex items-center gap-2">
          <Pill icon={<Crosshair />} className="min-w-0 max-w-full">
            <span className="truncate">{t("frontends.pins.target", { target: targetLabel(t, target) })}</span>
          </Pill>
          <span className="text-xs text-muted">{t("frontends.pins.changeTarget")}</span>
        </div>
        <TextArea
          autoFocus
          aria-label={t("frontends.pins.placeholder")}
          placeholder={t("frontends.pins.placeholder")}
          value={text}
          maxLength={maxLength}
          counter={`${text.length}/${maxLength}`}
          readOnly={action.pending}
          aria-busy={action.pending || undefined}
          onChange={(event) => {
            setText(event.target.value);
            action.clearError();
          }}
        />
        <Checkbox checked={attachRegion} onCheckedChange={(next) => setAttachRegion(next === true)} label={t("frontends.pins.attachRegion")} />
        {onAttachReference || references.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm font-semibold text-muted">{t("frontends.pins.references")}</span>
              {onAttachReference ? (
                <Button variant="secondary" size="sm" className="h-7 px-2.5 text-sm" onClick={onAttachReference}>
                  <Paperclip aria-hidden="true" />
                  {t("frontends.pins.attach")}
                </Button>
              ) : null}
            </div>
            {references.map((reference) => (
              <AttachedReference
                key={reference.id}
                icon={reference.kind === "image" ? <ImageIcon aria-hidden="true" /> : <Link2 aria-hidden="true" />}
                name={reference.name}
                detail={reference.detail ?? ""}
                removeLabel={t("frontends.pins.removeReference", { name: reference.name })}
                onRemove={onRemoveReference ? () => onRemoveReference(reference.id) : undefined}
              />
            ))}
          </div>
        ) : null}
        {recipients.length > 0 ? (
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm font-semibold text-muted">{t("frontends.pins.to")}</span>
            <Select aria-label={t("frontends.pins.to")} options={options} value={recipient} onValueChange={(next) => setRecipient(next ?? ANY)} className="w-55" fieldClassName="w-55" />
          </div>
        ) : null}
        <div className="flex items-center gap-1.5 border-t border-line pt-3">
          {submitShortcut?.map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
          <span className="flex-1" />
          <Button variant="secondary" size="sm" className="h-7.5" onClick={onCancel}>
            {t("frontends.pins.cancel")}
          </Button>
          <Button size="sm" className="h-7.5" disabled={!text.trim()} aria-busy={action.pending || undefined} pendingAnnouncement={t("common.working")} onClick={submit}>
            {t("frontends.pins.send")}
          </Button>
        </div>
        {action.error !== null ? (
          <p role="alert" className="m-0 text-sm font-medium text-red-ink">
            {t("frontends.pins.failed", { message: action.error })}
          </p>
        ) : null}
      </div>
    </PinBubble>
  );
}
