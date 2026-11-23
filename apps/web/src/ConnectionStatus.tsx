/**
 * Connection state for screen readers: the dot is color only and the text next to it is hidden on narrow
 * screens. A polite live region announces only the changes (connected ↔ disconnected), not every version.
 *
 * This is the proof surface of the shadcn migration (PAP-B-030): it renders through the
 * `StatusLiveRegion` primitive (components/ui/status.tsx), `cn()` and the `ui-*` theme tokens, and the
 * DOM and the text stay exactly as they were.
 */
import { StatusLiveRegion } from "./components/ui/status";
import { useT } from "./i18n";

export function ConnectionStatus({ connected }: { connected: boolean }) {
  const m = useT();
  return <StatusLiveRegion tone={connected ? "ok" : "alert"}>{connected ? m.connected : m.disconnected}</StatusLiveRegion>;
}
