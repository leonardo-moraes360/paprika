import { useEffect, useRef, type ReactNode } from "react";
import { Info, Undo2, X } from "lucide-react";
import { useT } from "../../i18n";
import { cn } from "../../lib/cn";
import { dismissToast, TOAST_MS, useToast, type ToastItem } from "../../lib/toast";
import { Button } from "./button";

export function KeyHint({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-sm border border-ui-border px-1.5 py-px font-sans text-2xs font-semibold text-ui-muted-foreground">{children}</kbd>
  );
}

export interface ToastViewProps {
  message: string;
  tone?: "undo" | "info";
  action?: { label: string; onAction: () => void };
  hint?: string[];
  closeLabel: string;
  onClose: () => void;
  className?: string;
}

export function ToastView({ message, tone = "info", action, hint, closeLabel, onClose, className }: ToastViewProps) {
  const Icon = tone === "undo" ? Undo2 : Info;
  return (
    <div
      data-slot="toast"
      className={cn(
        "pointer-events-auto grid grid-cols-[auto_1fr_auto] items-start gap-x-3 gap-y-2 rounded-lg border border-ui-border bg-ui-popover p-3 text-ui-popover-foreground shadow-float",
        "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2",
        className,
      )}
    >
      <Icon className="mt-0.5 size-5 shrink-0" strokeWidth={1.75} aria-hidden />
      <p className="toast-message m-0 text-md leading-snug">{message}</p>
      <Button className="-mt-1 -mr-1 size-6 border-0" variant="ghost" size="icon" aria-label={closeLabel} onClick={onClose}>
        <X aria-hidden />
      </Button>
      {action && (
        <div className="col-start-2 col-end-4 flex items-center gap-2">
          <Button className="toast-action" variant="outline" size="sm" onClick={action.onAction}>
            {action.label}
          </Button>
          {hint?.map((k) => <KeyHint key={k}>{k}</KeyHint>)}
        </div>
      )}
    </div>
  );
}

function Timed({ item }: { item: ToastItem }) {
  const m = useT();
  const paused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const arm = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => dismissToast(item.id), TOAST_MS);
  };
  useEffect(() => {
    paused.current = false;
    arm();
    return () => clearTimeout(timer.current);
  }, [item.id]);
  const pause = () => {
    paused.current = true;
    clearTimeout(timer.current);
  };
  const resume = (e: { currentTarget: Element; relatedTarget: EventTarget | null }) => {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    paused.current = false;
    arm();
  };
  return (
    <div data-testid="toast" onMouseEnter={pause} onMouseLeave={resume} onFocus={pause} onBlur={resume}>
      <ToastView
        message={item.message}
        tone={item.tone}
        hint={item.hint}
        closeLabel={m.toastDismiss}
        action={
          item.action
            ? {
                label: item.action.label,
                onAction: () => {
                  const run = item.action!.run;
                  dismissToast(item.id);
                  run();
                },
              }
            : undefined
        }
        onClose={() => dismissToast(item.id)}
      />
    </div>
  );
}

export function ToastHost({ className }: { className?: string }) {
  const item = useToast();
  return (
    <div role="status" aria-live="polite" className={cn("pointer-events-none absolute bottom-4 left-1/2 z-40 w-[min(440px,calc(100%-2rem))] -translate-x-1/2", className)}>
      {item && <Timed key={item.id} item={item} />}
    </div>
  );
}
