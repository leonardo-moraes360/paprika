import { useEffect, useId, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import type { Document } from "@paprika/core";
import { ColorPicker } from "../ColorPicker";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { cn } from "../lib/cn";
import {
  allowsNumberFieldInput,
  commitNumeric,
  parseNumeric,
  rangeMessage,
  stepNumeric,
  type NumericRange,
} from "../numericInput";

export const fieldShell = (wide = false) =>
  cn(
    "grid min-w-0 items-center gap-1.5 rounded-md border border-transparent bg-ui-muted focus-within:border-ui-ring",
    "[&_[data-slot=label]]:whitespace-nowrap [&_[data-slot=label]]:font-normal",
    wide ? "grid-cols-1 p-1.5" : "grid-cols-[auto_1fr] px-1.5",
  );

const controlBare =
  "h-7 border-0 bg-transparent px-0 shadow-none focus-visible:border-0 focus-visible:outline-none focus-visible:outline-offset-0";

const stepBtn =
  "h-5 w-5 shrink-0 rounded-sm border-0 bg-transparent p-0 text-ui-foreground hover:bg-ui-secondary disabled:cursor-default disabled:opacity-40 [&_svg]:size-3";

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
  step?: number;
}

export function Field({ label, value, onCommit, type = "text", placeholder, title, min, max, integer, keywords, step }: FieldProps) {
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
  const steppers = type === "number" && !keywords?.length;
  const baseline = () => (value === undefined ? "" : String(value));
  const applyCommit = (result: ReturnType<typeof commitNumeric>) => {
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
  };
  const commit = () => {
    if (type === "number" && !keywords?.length) {
      applyCommit(commitNumeric(v, range));
      return;
    }
    pendingClampMsg.current = null;
    if (v === baseline() || v === lastCommitted.current) return;
    lastCommitted.current = v;
    onCommit(v);
  };
  const nudge = (direction: 1 | -1, shift: boolean) => {
    const current = parseNumeric(v) ?? parseNumeric(baseline());
    applyCommit(stepNumeric(current, direction, range, { shift, step }));
  };
  const currentNum = parseNumeric(v) ?? parseNumeric(baseline());
  const atMin = steppers && min !== undefined && currentNum !== undefined && currentNum <= min;
  const atMax = steppers && max !== undefined && currentNum !== undefined && currentNum >= max;
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
      if (steppers && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        nudge(e.key === "ArrowUp" ? 1 : -1, e.shiftKey);
        return;
      }
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
      <div
        className={cn(
          fieldShell(type === "textarea"),
          steppers && "grid-cols-[auto_1fr_auto]",
          error && "border-ui-destructive focus-within:border-ui-destructive [&_[data-slot=label]]:text-ui-destructive-text",
        )}
      >
        <Label>{label}</Label>
        {type === "textarea" ? (
          <Textarea rows={2} className={cn(controlBare, "min-h-0 resize-y px-0 py-0")} {...common} />
        ) : (
          <Input inputMode={type === "number" ? "decimal" : undefined} className={controlBare} {...common} />
        )}
        {steppers && (
          <div className="flex items-center gap-0.5" data-testid={`stepper-${label}`}>
            <Button
              type="button"
              variant="ghost"
              className={stepBtn}
              aria-label={`Diminuir ${label}`}
              title={`Diminuir ${label}`}
              disabled={atMin}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => nudge(-1, e.shiftKey)}
            >
              <Minus aria-hidden />
            </Button>
            <Button
              type="button"
              variant="ghost"
              className={stepBtn}
              aria-label={`Aumentar ${label}`}
              title={`Aumentar ${label}`}
              disabled={atMax}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => nudge(1, e.shiftKey)}
            >
              <Plus aria-hidden />
            </Button>
          </div>
        )}
      </div>
      {error && (
        <p id={msgId} role="status" aria-live="polite" className="m-0 text-2xs text-ui-destructive-text">
          {error}
        </p>
      )}
    </div>
  );
}

const MODE_BASE = "__base__";

export function ModeField({ doc, value, inherited, onCommit }: { doc: Document; value: string | undefined; inherited?: string; onCommit(v: string | null): void }) {
  const modes = Object.keys(doc.modes ?? {});
  if (value && !modes.includes(value)) modes.push(value);
  return (
    <div className={fieldShell()}>
      <Label>Modo de tema</Label>
      <Select value={value ?? MODE_BASE} onValueChange={(v) => onCommit(v === MODE_BASE ? null : v)}>
        <SelectTrigger aria-label="Modo de tema" className={cn(controlBare, "justify-between gap-1 px-0 [&>svg]:size-3")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={MODE_BASE}>{inherited ? `herdado (${inherited})` : "base"}</SelectItem>
          {modes.map((m) => (
            <SelectItem key={m} value={m}>
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function SelectField({
  label,
  value,
  onChange,
  options,
  testId,
}: {
  label: string;
  value: string;
  onChange(v: string): void;
  options: readonly { readonly value: string; readonly label: string }[];
  testId?: string;
}) {
  return (
    <div className={fieldShell()}>
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label} data-testid={testId} className={cn(controlBare, "justify-between gap-1 px-0 [&>svg]:size-3")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ColorField({ doc, label, value, mode, onCommit }: { doc: Document; label: string; value: string | undefined; mode?: string; onCommit(v: string | null): void }) {
  return (
    <div className="grid grid-cols-[28px_1fr] items-center gap-1.5">
      <ColorPicker doc={doc} label={label} value={value} mode={mode} onCommit={onCommit} />
      <Field label={label} value={value} placeholder="nenhuma" title="#hex, rgba() ou $token" onCommit={(v) => onCommit(v.trim() || null)} />
    </div>
  );
}

export const num = (v: string) => parseNumeric(v);
export const size = (v: string): number | string | undefined => (v === "hug" || v === "fill" ? v : num(v));
