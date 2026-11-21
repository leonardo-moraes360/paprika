import { useEffect, useRef } from "react";

interface Props {
  value: string;
  label: string;
  className?: string;
  /** Recebe o nome já aparado e diferente do atual; um nome vazio não é enviado. */
  onCommit(name: string): void;
  onDone(): void;
}

/**
 * Campo de renomear no lugar: Enter ou sair do campo confirma, Esc cancela.
 * O Esc marca o cancelamento antes de desmontar, para o blur que vem depois não confirmar.
 */
export function InlineName({ value, label, className, onCommit, onDone }: Props) {
  const settled = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // S9379: `autoFocus` fires during render, before the row is in the DOM, and React 19 marks it
    // deprecated. Focusing the ref after mount is the same UX: the field takes focus, and the existing
    // onFocus handler selects the current name.
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
    <input
      ref={field}
      className={className}
      aria-label={label}
      defaultValue={value}
      maxLength={200}
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
