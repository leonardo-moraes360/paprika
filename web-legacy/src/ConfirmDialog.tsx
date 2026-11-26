import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./components/ui/alert-dialog";
import { buttonVariants } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { useT } from "./i18n";
import { cn } from "./lib/cn";

interface Props {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  pending?: boolean;
  typeToConfirm?: string;
  confirmClassName?: string;
  onConfirm(): void | Promise<void>;
  children?: ReactNode;
}

export function ConfirmDialog({ open, onOpenChange, ...rest }: Props) {
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (opener.current?.isConnected) opener.current.focus();
    };
  }, [open]);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <ConfirmBody {...rest} />
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConfirmBody({ title, description, confirmLabel, pendingLabel, pending, typeToConfirm, confirmClassName, onConfirm, children }: Omit<Props, "open" | "onOpenChange">) {
  const m = useT();
  const [typed, setTyped] = useState("");
  const inputId = useId();
  const ready = !pending && (typeToConfirm === undefined || typed === typeToConfirm);
  const confirm = () => {
    if (ready) void onConfirm();
  };
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      {children}
      {typeToConfirm !== undefined && (
        <div className="grid gap-1.5">
          <Label htmlFor={inputId}>
            {m.typeToConfirmBefore}
            <strong className="font-bold text-ui-foreground">{typeToConfirm}</strong>
            {m.typeToConfirmAfter}
          </Label>
          <Input
            id={inputId}
            className="confirm-name"
            autoComplete="off"
            spellCheck={false}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              confirm();
            }}
          />
        </div>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel>{m.cancel}</AlertDialogCancel>
        <AlertDialogAction
          className={cn(buttonVariants({ variant: "destructive", size: "sm" }), "confirm-action", confirmClassName)}
          disabled={!ready}
          onClick={(e) => {
            e.preventDefault();
            confirm();
          }}
        >
          <Trash2 aria-hidden />
          {pending && pendingLabel ? pendingLabel : confirmLabel}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}
