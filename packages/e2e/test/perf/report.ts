import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Budget } from "./budgets.js";

export type Status = "ok" | "known-failing" | "fail";

export interface Result {
  id: string;
  scenario: string;
  label: string;
  unit: Budget["unit"];
  kind: Budget["kind"];
  measured: number;
  baseline: number | null;
  effective: number;
  limit: number;
  today: string;
  enforce: boolean;
  ticket: string;
  status: Status;
}

export function evaluate(budget: Budget, measured: number, baseline?: number | null): Result {
  const base = budget.kind === "relative" ? (baseline ?? 0) : 0;
  const effective = Math.max(0, measured - base);
  const exceeded = effective > budget.limit;
  const status: Status = !exceeded ? "ok" : budget.enforce ? "fail" : "known-failing";
  return {
    id: budget.id,
    scenario: budget.scenario,
    label: budget.label,
    unit: budget.unit,
    kind: budget.kind,
    measured,
    baseline: budget.kind === "relative" ? (baseline ?? null) : null,
    effective,
    limit: budget.limit,
    today: budget.today,
    enforce: budget.enforce,
    ticket: budget.ticket,
    status,
  };
}

const fmt = (n: number, unit: Budget["unit"]) => {
  if (unit === "bytes") return n >= 1e6 ? `${(n / 1e6).toFixed(2)} MB` : `${n} B`;
  if (unit === "ms") return `${Math.round(n)} ms`;
  return String(n);
};

export function table(results: Result[]): string {
  const rows = results.map((r) => {
    const measured = r.kind === "relative" && r.baseline !== null ? `${fmt(r.effective, r.unit)} (${fmt(r.measured, r.unit)} - ${fmt(r.baseline, r.unit)})` : fmt(r.measured, r.unit);
    const status = r.status === "known-failing" ? `known-failing (${r.ticket})` : r.status;
    return [r.scenario, r.label, measured, `<= ${fmt(r.limit, r.unit)}`, status];
  });
  const head = ["scenario", "budget", "measured", "limit", "status"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join(" | ");
  return [line(head), widths.map((w) => "-".repeat(w)).join("-|-"), ...rows.map(line)].join("\n");
}

export function reportPath(): string {
  return process.env.PAPRIKA_PERF_REPORT || join(mkdtempSync(join(tmpdir(), "paprika-perf-report-")), "report.json");
}

export function writeReport(results: Result[], extra: Record<string, unknown> = {}): string {
  const path = reportPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ generatedAt: new Date().toISOString(), ...extra, results }, null, 2));
  return path;
}
