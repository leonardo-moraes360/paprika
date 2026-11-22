/**
 * Connection state for screen readers: the dot is color only and the text next to it is hidden on narrow
 * screens. A polite live region announces only the changes (connected ↔ disconnected), not every version.
 */
export function ConnectionStatus({ connected }: { connected: boolean }) {
  return (
    <span className="sr-only" role="status">
      {connected ? "Conectado ao servidor" : "Desconectado do servidor"}
    </span>
  );
}
