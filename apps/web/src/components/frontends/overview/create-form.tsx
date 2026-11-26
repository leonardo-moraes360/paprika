import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";

export type CreateFormProps = {
  onSubmit: (name: string) => Promise<unknown>;
  onCancel: () => void;
};

export function CreateForm({ onSubmit, onCancel }: CreateFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    await onSubmit(name.trim() || t("frontends.overview.untitled"));
    setPending(false);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") onCancel();
  };

  return (
    <form className="flex items-center gap-2" onSubmit={submit} onKeyDown={onKeyDown}>
      <TextField
        autoFocus
        aria-label={t("frontends.overview.workspaceName")}
        placeholder={t("frontends.overview.workspaceName")}
        value={name}
        onValueChange={setName}
        maxLength={120}
        autoComplete="off"
        className="h-9 w-60 max-w-[50vw]"
      />
      <Button type="submit" pendingAnnouncement={t("common.working")} data-pending={pending ? "" : undefined} disabled={pending}>
        {t("frontends.overview.create")}
      </Button>
      <Button type="button" variant="ghost" onClick={onCancel}>
        {t("frontends.overview.cancel")}
      </Button>
    </form>
  );
}
