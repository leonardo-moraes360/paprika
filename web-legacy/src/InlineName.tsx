import { useEffect, useRef } from "react";
import { Input } from "./components/ui/input";
import { cn } from "./lib/cn";

interface Props {
  value: string;
  label: string;
  className?: string;
  maxLength?: number;
  onCommit(name: string): void;
  onDone(): void;
}

export function InlineName({ value, label, className, maxLength = 200, onCommit, onDone }: Props) {
  const settled = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    field.current?.focus();
  }, []);
  const finish = (name: string | null) => {
    if (settled.current) return;
    settled.current = true;
    const v = name?.trim();
    if (v && v !== value) onCommit(v);
    onDone();
  };
  return (
    <Input
      ref={field}
      className={cn("h-auto rounded-[3px] border-select bg-ui-card px-1 py-0 text-ui-foreground focus-visible:border-ui-ring", className)}
      aria-label={label}
      defaultValue={value}
      maxLength={maxLength}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => finish(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value);
        else if (e.key === "Escape") finish(null);
      }}
    />
  );
}
