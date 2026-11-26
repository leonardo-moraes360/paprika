import { useState, type FormEvent } from "react";
import { TextField } from "@/components/ui/text-field";

export type NewEntryFieldProps = {
  label: string;
  placeholder: string;
  hint: string;
  invalidMessage: string;
  onSubmit: (raw: string) => boolean;
};

export function NewEntryField({ label, placeholder, hint, invalidMessage, onSubmit }: NewEntryFieldProps) {
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) return;
    if (onSubmit(draft)) {
      setDraft("");
      setInvalid(false);
    } else setInvalid(true);
  };
  return (
    <form onSubmit={submit}>
      <TextField
        label={label}
        description={hint}
        placeholder={placeholder}
        value={draft}
        error={invalid ? invalidMessage : undefined}
        className="h-9 border-dashed"
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
      />
    </form>
  );
}
