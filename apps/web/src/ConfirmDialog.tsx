/**
 * Confirmação de uma ação que o Ctrl+Z não traz de volta (ADR 0005): composição sobre o AlertDialog do
 * primitivo. O verbo fica no título e na ação — nunca "OK" —, Cancelar vem primeiro, e a ação usa a
 * variante destrutiva (lavanda do acento + texto `accent.ink`), que é a linguagem de aviso do app.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
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

export function ConfirmDialog({
  title,
  description,
  detail,
  error,
  actionLabel,
  actionIcon,
  cancelLabel = "Cancelar",
  hideAction = false,
  confirmWith = null,
  busy = false,
  onConfirm,
  onClose,
  className,
}: {
  title: string;
  description: string;
  /** Linhas a mais entre a descrição e os botões (o que muda de ativo, quantos nós se perdem…). */
  detail?: ReactNode;
  error?: string | null;
  actionLabel: string;
  actionIcon?: ReactNode;
  /** A ação já terminou? O botão do meio vira saída (Fechar), não cancelamento. */
  cancelLabel?: string;
  /** A ação já aconteceu: sobra só a saída. */
  hideAction?: boolean;
  /** Apagamento sem volta: a ação só libera quando a pessoa escreve o nome exatamente como está. */
  confirmWith?: string | null;
  busy?: boolean;
  onConfirm(): void;
  onClose(): void;
  className?: string;
}) {
  // Radix prende o foco e devolve ao gatilho enquanto o diálogo está montado; quem fecha estes diálogos é o
  // estado do pai, que os desmonta, então o retorno do foco (WCAG 2.4.3) é garantido aqui.
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (opener.current?.isConnected) opener.current.focus();
    };
  }, []);
  const [typed, setTyped] = useState("");
  const ready = confirmWith === null || typed.trim() === confirmWith;
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className={className}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {detail}
        {error ? <p data-slot="confirm-error" className="m-0 text-xs text-ui-destructive-text">{error}</p> : null}
        {confirmWith !== null && (
          <div className="grid gap-1.5">
            <Label htmlFor="confirm-name">Digite o nome para liberar: {confirmWith}</Label>
            <Input id="confirm-name" data-slot="confirm-name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel data-slot="alert-dialog-cancel" disabled={busy}>
            {cancelLabel}
          </AlertDialogCancel>
          {!hideAction && (
          <AlertDialogAction
            variant="destructive"
            disabled={busy || !ready}
            onClick={(e) => {
              // O Radix fecharia sozinho; a confirmação é assíncrona e o diálogo continua aberto enquanto
              // a ação trabalha, mostrando o erro se ela falhar.
              e.preventDefault();
              onConfirm();
            }}
          >
            {actionIcon}
            {actionLabel}
          </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
