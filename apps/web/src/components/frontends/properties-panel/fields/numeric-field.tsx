import { Input } from "@ui-sdk/react/input";
import { Minus, Plus } from "lucide-react";
import { useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { fieldBoxWrapper } from "@/components/ui/field-box";
import { InlineNotice } from "@/components/ui/inline-notice";
import {
  allowsNumberFieldInput,
  commitNumeric,
  parseNumeric,
  rangeIssue,
  stepNumeric,
  type NumericCommit,
  type NumericIssue,
  type NumericRange,
} from "@/lib/numeric-input";
import { cn, focusRing } from "@/lib/utils";

export type NumericFieldProps = NumericRange & {
  label: string;
  prefix?: string;
  unit?: string;
  value: number | string | undefined;
  onCommit: (value: number | string) => void;
  onClear?: () => void;
  step?: number;
  keywords?: readonly string[];
  disabled?: boolean;
  className?: string;
};

const stepClasses = `flex h-4 w-6 shrink-0 cursor-pointer items-center justify-center rounded-xs text-fg transition-colors motion-reduce:transition-none hover:bg-surface disabled:cursor-not-allowed disabled:text-field [&_svg]:size-3 [&_svg]:stroke-2 ${focusRing}`;

export function NumericField({ label, prefix, unit, value, onCommit, onClear, min, max, integer, step, keywords, disabled, className }: NumericFieldProps) {
  const { t } = useTranslation();
  const messageId = useId();
  const baseline = value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(baseline);
  const [seen, setSeen] = useState(baseline);
  const [issue, setIssue] = useState<NumericIssue | null>(null);
  const keepIssue = useRef<NumericIssue | null>(null);
  const range: NumericRange = { min, max, integer };

  if (seen !== baseline) {
    setSeen(baseline);
    setDraft(baseline);
    setIssue(keepIssue.current);
    keepIssue.current = null;
  }

  const finish = (result: NumericCommit) => {
    if (!result.ok) {
      keepIssue.current = null;
      setDraft(baseline);
      setIssue(result.issue);
      return;
    }
    keepIssue.current = result.clamped ? (result.issue ?? null) : null;
    setIssue(keepIssue.current);
    if (result.text === baseline) {
      setDraft(result.text);
      return;
    }
    // The owner decides what the value is: until it re-renders with a new value, show the one it has.
    setDraft(baseline);
    onCommit(result.value);
  };

  const commit = () => {
    const typed = draft.trim().toLowerCase();
    if (typed === "" && onClear) {
      keepIssue.current = null;
      setIssue(null);
      if (baseline !== "") {
        setDraft(baseline);
        onClear();
      }
      return;
    }
    if (keywords?.includes(typed)) {
      keepIssue.current = null;
      setIssue(null);
      setDraft(baseline);
      if (typed !== baseline) onCommit(typed);
      return;
    }
    finish(commitNumeric(draft, range));
  };

  const nudge = (direction: 1 | -1, shift: boolean) => {
    const current = parseNumeric(draft) ?? parseNumeric(baseline);
    finish(stepNumeric(current, direction, range, { shift, step }));
  };

  const current = parseNumeric(draft) ?? parseNumeric(baseline);
  const atMin = min !== undefined && current !== undefined && current <= min;
  const atMax = max !== undefined && current !== undefined && current >= max;

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      nudge(event.key === "ArrowUp" ? 1 : -1, event.shiftKey);
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      keepIssue.current = null;
      setDraft(baseline);
      setIssue(null);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    if (allowsNumberFieldInput(event.clipboardData.getData("text"), keywords)) return;
    event.preventDefault();
    setIssue(rangeIssue(range));
  };

  const message = issue
    ? issue.kind === "between"
      ? t("frontends.propertiesPanel.numeric.between", { min: issue.min, max: issue.max })
      : issue.kind === "min"
        ? t("frontends.propertiesPanel.numeric.min", { min: issue.min })
        : issue.kind === "max"
          ? t("frontends.propertiesPanel.numeric.max", { max: issue.max })
          : t("frontends.propertiesPanel.numeric.number")
    : null;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <div className={cn("flex h-9 w-full items-center gap-1.5 pe-1.5 ps-2.5", fieldBoxWrapper, issue && "border-[1.5px] border-red-ink", disabled && "opacity-60")}>
        {prefix ? (
          <span aria-hidden="true" className="w-3 shrink-0 text-sm font-semibold text-muted">
            {prefix}
          </span>
        ) : null}
        <Input
          aria-label={label}
          aria-invalid={issue ? true : undefined}
          aria-describedby={issue ? messageId : undefined}
          inputMode="decimal"
          disabled={disabled}
          value={draft}
          onChange={(event) => {
            const next = event.target.value;
            if (!allowsNumberFieldInput(next, keywords)) return;
            setDraft(next);
            keepIssue.current = null;
            if (issue) setIssue(null);
          }}
          onPaste={onPaste}
          onBlur={commit}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-base tabular-nums text-inherit outline-none"
        />
        {unit ? (
          <span aria-hidden="true" className="shrink-0 text-sm text-muted">
            {unit}
          </span>
        ) : null}
        <div className="flex shrink-0 flex-col items-center justify-center gap-0.5">
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled || atMax}
            aria-label={t("frontends.propertiesPanel.numeric.increase", { field: label })}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => nudge(1, event.shiftKey)}
            className={stepClasses}
          >
            <Plus aria-hidden="true" />
          </button>
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled || atMin}
            aria-label={t("frontends.propertiesPanel.numeric.decrease", { field: label })}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => nudge(-1, event.shiftKey)}
            className={stepClasses}
          >
            <Minus aria-hidden="true" />
          </button>
        </div>
      </div>
      {message ? (
        <InlineNotice id={messageId} tone="error">
          {message}
        </InlineNotice>
      ) : null}
    </div>
  );
}
