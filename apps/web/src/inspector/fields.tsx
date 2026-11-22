import { useEffect, useId, useRef, useState } from "react";
import type { Document } from "@paprika/core";
import { resolveValue } from "@paprika/core";
import { allowsNumberFieldInput, commitNumeric, parseNumeric, rangeMessage, type NumericRange } from "../numericInput";
import { cx, ui } from "../ui";

interface FieldProps {
  label: string;
  value: string | number | undefined;
  onCommit(v: string): void;
  type?: "text" | "number" | "textarea";
  placeholder?: string;
  title?: string;
  min?: number;
  max?: number;
  integer?: boolean;
  keywords?: readonly string[];
}

export function Field({ label, value, onCommit, type = "text", placeholder, title, min, max, integer, keywords }: FieldProps) {
  const [v, setV] = useState(value === undefined ? "" : String(value));
  const [error, setError] = useState<string | null>(null);
  const msgId = useId();
  const lastCommitted = useRef<string | null>(null);
  const pendingClampMsg = useRef<string | null>(null);
  const skipBlurCommit = useRef(false);
  useEffect(() => {
    setV(value === undefined ? "" : String(value));
    lastCommitted.current = null;
    if (pendingClampMsg.current) {
      setError(pendingClampMsg.current);
      pendingClampMsg.current = null;
      return;
    }
    setError(null);
  }, [value]);
  const range: NumericRange = { min, max, integer };
  const baseline = () => (value === undefined ? "" : String(value));
  const commit = () => {
    if (type === "number" && !keywords?.length) {
      const result = commitNumeric(v, range);
      if (!result.ok) {
        pendingClampMsg.current = null;
        setV(baseline());
        setError(result.message);
        return;
      }
      if (result.clamped) {
        const msg = result.message ?? rangeMessage(range);
        setError(msg);
        pendingClampMsg.current = msg;
      } else {
        pendingClampMsg.current = null;
        setError(null);
      }
      if (result.text === baseline() || result.text === lastCommitted.current) {
        setV(result.text);
        return;
      }
      lastCommitted.current = result.text;
      setV(result.text);
      onCommit(result.text);
      return;
    }
    pendingClampMsg.current = null;
    if (v === baseline() || v === lastCommitted.current) return;
    lastCommitted.current = v;
    onCommit(v);
  };
  const common = {
    value: v,
    placeholder,
    title,
    "aria-label": label,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? msgId : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = e.target.value;
      if (type === "number" && !allowsNumberFieldInput(next, keywords)) return;
      setV(next);
      pendingClampMsg.current = null;
      if (error) setError(null);
    },
    onPaste:
      type === "number"
        ? (e: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            const text = e.clipboardData.getData("text");
            if (!allowsNumberFieldInput(text, keywords)) {
              e.preventDefault();
              pendingClampMsg.current = null;
              setError(rangeMessage(range));
              setV(baseline());
            }
          }
        : undefined,
    onBlur: () => {
      if (skipBlurCommit.current) {
        skipBlurCommit.current = false;
        return;
      }
      commit();
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !(type === "textarea" && e.shiftKey)) {
        e.preventDefault();
        skipBlurCommit.current = true;
        commit();
        (e.target as HTMLElement).blur();
      }
      if (e.key === "Escape") {
        pendingClampMsg.current = null;
        skipBlurCommit.current = true;
        setV(baseline());
        setError(null);
        (e.target as HTMLElement).blur();
      }
    },
  };
  return (
    <div className="grid min-w-0 gap-0.5">
      <label
        className={cx(
          ui.field(type === "textarea"),
          error && "border-ui-destructive focus-within:border-ui-destructive [&_span]:text-ui-destructive-text",
        )}
      >
        <span>{label}</span>
        {type === "textarea" ? <textarea rows={2} {...common} /> : <input inputMode={type === "number" ? "decimal" : undefined} {...common} />}
      </label>
      {error && (
        <p id={msgId} role="status" aria-live="polite" className="m-0 text-2xs text-ui-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}

export function ModeField({ doc, value, inherited, onCommit }: { doc: Document; value: string | undefined; inherited?: string; onCommit(v: string | null): void }) {
  const modes = Object.keys(doc.modes ?? {});
  if (value && !modes.includes(value)) modes.push(value);
  return (
    <label className={ui.field()}>
      <span>Modo de tema</span>
      <select aria-label="Modo de tema" value={value ?? ""} onChange={(e) => onCommit(e.target.value || null)}>
        <option value="">{inherited ? `herdado (${inherited})` : "base"}</option>
        {modes.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ColorField({ doc, label, value, mode, onCommit }: { doc: Document; label: string; value: string | undefined; mode?: string; onCommit(v: string | null): void }) {
  const resolved = value ? String(resolveValue(doc, value, mode)) : "";
  const hex = /^#[0-9a-f]{6}$/i.test(resolved) ? resolved : "#000000";
  return (
    <div className="grid grid-cols-[28px_1fr] items-center gap-1.5">
      <input className="size-7 rounded-md border border-line bg-transparent p-0" type="color" aria-label={`${label} (seletor)`} value={hex} onChange={(e) => onCommit(e.target.value)} />
      <Field label={label} value={value} placeholder="nenhuma" title="#hex, rgba() ou $token" onCommit={(v) => onCommit(v.trim() || null)} />
    </div>
  );
}

export const num = (v: string) => parseNumeric(v);
export const size = (v: string): number | string | undefined => (v === "hug" || v === "fill" ? v : num(v));