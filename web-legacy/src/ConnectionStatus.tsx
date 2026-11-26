import { StatusLiveRegion } from "./components/ui/status";
import { useT } from "./i18n";

export function ConnectionStatus({ connected }: { connected: boolean }) {
  const m = useT();
  return <StatusLiveRegion tone={connected ? "ok" : "alert"}>{connected ? m.connected : m.disconnected}</StatusLiveRegion>;
}
