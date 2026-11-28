import { useRef, useState, type KeyboardEvent } from "react";
import { TextArea } from "@/components/ui/text-area";
import { TextField } from "@/components/ui/text-field";

export type CommitTextFieldProps = {
  label: string;
  value: string | undefined;
  onCommit: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  disabled?: boolean;
  hideLabel?: boolean;
  validate?: (raw: string) => boolean;
  invalidMessage?: string;
  className?: string;
};

export function CommitTextField({ label, value, onCommit, multiline = false, placeholder, disabled, hideLabel, validate, invalidMessage, className }: CommitTextFieldProps) {
  const baseline = value ?? "";
  const [draft, setDraft] = useState(baseline);
  const [seen, setSeen] = useState(baseline);
  const [invalid, setInvalid] = useState(false);
  const lastCommitted = useRef<string | null>(null);
  if (seen !== baseline) {
    setSeen(baseline);
    setDraft(baseline);
    setInvalid(false);
    lastCommitted.current = null;
  }

  const commit = (next: string) => {
    if (next === baseline || next === lastCommitted.current) return;
    if (validate && !validate(next)) {
      setDraft(baseline);
      setInvalid(true);
      return;
    }
    lastCommitted.current = next;
    onCommit(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !(multiline && event.shiftKey)) {
      event.preventDefault();
      commit(draft);
    } else if (event.key === "Escape") {
      setDraft(baseline);
      setInvalid(false);
    }
  };

  const shared = {
    label: hideLabel ? <span className="sr-only">{label}</span> : label,
    value: draft,
    placeholder,
    disabled,
    fieldClassName: className,
    error: invalid ? invalidMessage : undefined,
    onKeyDown,
    onBlur: () => commit(draft),
  };

  return multiline ? (
    <TextArea {...shared} rows={3} className="min-h-0" onChange={(event) => {
        setDraft(event.target.value);
        setInvalid(false);
      }}
    />
  ) : (
    <TextField
      {...shared}
      className="h-9"
      onChange={(event) => {
        setDraft(event.target.value);
        setInvalid(false);
      }}
    />
  );
}
