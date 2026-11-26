export type BudgetKind = "exact" | "relative";

export interface Budget {
  id: string;
  scenario: string;
  label: string;
  unit: "bytes" | "count" | "ms" | "versions";
  kind: BudgetKind;
  limit: number;
  today: string;
  enforce: boolean;
  ticket: string;
}

export const BUDGETS: Record<string, Budget> = {
  wsBytesPerWrite: {
    id: "wsBytesPerWrite",
    scenario: "ws-bytes",
    label: "WS bytes per one-prop write",
    unit: "bytes",
    kind: "exact",
    limit: 2 * 1024,
    today: "608 B (one-prop write)",
    enforce: true,
    ticket: "PAP-A-057",
  },
  wsSnapshotsOnOpen: {
    id: "wsSnapshotsOnOpen",
    scenario: "ws-bytes",
    label: "doc snapshots on open",
    unit: "count",
    kind: "exact",
    limit: 1,
    today: "1",
    enforce: true,
    ticket: "PAP-A-057",
  },
  serverWriteMs: {
    id: "serverWriteMs",
    scenario: "server-write",
    label: "server time per one-prop write",
    unit: "ms",
    kind: "relative",
    limit: 50,
    today: "3 ms (plain node)",
    enforce: true,
    ticket: "PAP-A-060",
  },
  serverWriteMasterMs: {
    id: "serverWriteMasterMs",
    scenario: "server-write",
    label: "server time per one-prop write on a component master with 1,000 instances",
    unit: "ms",
    kind: "relative",
    limit: 50,
    today: "2.2 s",
    enforce: false,
    ticket: "PAP-A-060",
  },
  slowTabVersionLag: {
    id: "slowTabVersionLag",
    scenario: "slow-tab",
    label: "slow tab: versions behind after the last write",
    unit: "versions",
    kind: "exact",
    limit: 0,
    today: "4 of 485",
    enforce: false,
    ticket: "PAP-A-058",
  },
  tabWriteScriptMs: {
    id: "tabWriteScriptMs",
    scenario: "tab-incoming-write",
    label: "script time in the tab on one incoming write",
    unit: "ms",
    kind: "relative",
    limit: 50,
    today: "2.6 s",
    enforce: false,
    ticket: "PAP-A-061",
  },
  frameP95Ms: {
    id: "frameP95Ms",
    scenario: "pan-zoom",
    label: "p95 frame on wheel pan and zoom",
    unit: "ms",
    kind: "relative",
    limit: 20,
    today: "17 ms (was 33-83 ms)",
    enforce: true,
    ticket: "PAP-A-062",
  },
  panelResizeStepMs: {
    id: "panelResizeStepMs",
    scenario: "panel-resize",
    label: "panel resize step",
    unit: "ms",
    kind: "relative",
    limit: 20,
    today: "17 ms (was 750 ms)",
    enforce: true,
    ticket: "PAP-A-063",
  },
  agentNodeVisibleMs: {
    id: "agentNodeVisibleMs",
    scenario: "agent-build",
    label: "time until an agent-created 200-node frame is visible",
    unit: "ms",
    kind: "exact",
    limit: 1000,
    today: "up to 28.6 s",
    enforce: false,
    ticket: "PAP-A-064",
  },
};
