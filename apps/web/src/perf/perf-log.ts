/** In-memory register of React Profiler commits per region. Made per use, never a module singleton. */

export type PerfPhase = "mount" | "update" | "nested-update";

export type PerfEntry = { id: string; phase: PerfPhase; actualDuration: number; baseDuration: number; commitTime: number };

export type RegionStats = {
  id: string;
  /** Every commit that rendered something inside the region (mounts included). */
  commits: number;
  mounts: number;
  updates: number;
  actualDuration: number;
  maxActualDuration: number;
  lastActualDuration: number;
};

export type PerfLog = {
  record: (id: string, phase: PerfPhase, actualDuration: number, baseDuration: number, startTime: number, commitTime: number) => void;
  /** Commits of one region so far (0 when it never rendered). */
  commits: (id: string) => number;
  stats: () => Record<string, RegionStats>;
  entries: () => readonly PerfEntry[];
  /** Forget everything counted so far (call after the first render to measure only what follows). */
  reset: () => void;
};

export const MAX_ENTRIES = 5000;

export function createPerfLog(): PerfLog {
  let regions = new Map<string, RegionStats>();
  let entries: PerfEntry[] = [];
  return {
    record: (id, phase, actualDuration, baseDuration, _startTime, commitTime) => {
      let stats = regions.get(id);
      if (!stats) {
        stats = { id, commits: 0, mounts: 0, updates: 0, actualDuration: 0, maxActualDuration: 0, lastActualDuration: 0 };
        regions.set(id, stats);
      }
      stats.commits += 1;
      if (phase === "mount") stats.mounts += 1;
      else stats.updates += 1;
      stats.actualDuration += actualDuration;
      stats.maxActualDuration = Math.max(stats.maxActualDuration, actualDuration);
      stats.lastActualDuration = actualDuration;
      entries.push({ id, phase, actualDuration, baseDuration, commitTime });
      if (entries.length > MAX_ENTRIES) entries = entries.slice(entries.length - MAX_ENTRIES);
    },
    commits: (id) => regions.get(id)?.commits ?? 0,
    stats: () => Object.fromEntries([...regions].map(([id, stats]) => [id, { ...stats }])),
    entries: () => entries,
    reset: () => {
      regions = new Map();
      entries = [];
    },
  };
}

export type PaprikaPerf = Pick<PerfLog, "stats" | "entries" | "reset" | "commits">;

declare global {
  interface Window {
    __paprikaPerf?: PaprikaPerf;
  }
}

/** On only with `?perf=1`, and only in `vite dev` or tests: production builds never profile (React disables the Profiler there anyway). */
export function perfRequested(search: string = typeof location === "undefined" ? "" : location.search, mode: { dev: boolean; test: boolean } = { dev: import.meta.env.DEV, test: import.meta.env.MODE === "test" }) {
  return (mode.dev || mode.test) && new URLSearchParams(search).get("perf") === "1";
}
