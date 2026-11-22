/**
 * Confirmação de uma ação que o Ctrl+Z não traz de volta (ADR 0005): composição sobre o AlertDialog do
 * primitivo. O verbo fica no título e na ação — nunca "OK" —, Cancelar vem primeiro, e a ação usa a
 * variante destrutiva (lavanda do acento + texto `accent.ink`), que é a linguagem de aviso do app.
 */
import { useEffect, useRef, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";

export function ConfirmDialog({
  title,
  description,
  detail,
  error,
  actionLabel,
  actionIcon,
  cancelLabel = "Cancelar",
  hideAction = false,
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
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className={className}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {detail}
        {error ? <p data-slot="confirm-error" className="m-0 text-xs text-ui-destructive-text">{error}</p> : null}
        <AlertDialogFooter>
          <AlertDialogCancel data-slot="alert-dialog-cancel" disabled={busy}>
            {cancelLabel}
          </AlertDialogCancel>
          {!hideAction && (
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
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
