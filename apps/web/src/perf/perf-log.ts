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
  /** `within` names the region this one sits inside: the outer region's commits that only that inner one caused are not counted for it. */
  record: (id: string, phase: PerfPhase, actualDuration: number, baseDuration: number, startTime: number, commitTime: number, within?: string) => void;
  /** Commits of one region so far (0 when it never rendered). */
  commits: (id: string) => number;
  stats: () => Record<string, RegionStats>;
  entries: () => readonly PerfEntry[];
  /** Forget everything counted so far (call after the first render to measure only what follows). */
  reset: () => void;
};

export const MAX_ENTRIES = 5000;

/**
 * A `Profiler` reports every commit of its subtree, so a region that sits inside another (the roster inside the header)
 * makes the outer one report the inner one's commits. When all of an outer commit's time is the inner regions' (what is
 * left is the bookkeeping of components that bailed out), the commit is the inner region's alone and is not the outer's.
 */
export const NESTED_ONLY_MS = 0.05;

export function createPerfLog(): PerfLog {
  let regions = new Map<string, RegionStats>();
  // A ring: once full, each record overwrites the oldest entry (no copy of the 5 000 entries per commit).
  const inner = new Map<string, { commitTime: number; duration: number }>();
  let ring: PerfEntry[] = [];
  let next = 0;
  return {
    record: (id, phase, actualDuration, baseDuration, _startTime, commitTime, within) => {
      if (within) {
        const held = inner.get(within);
        inner.set(within, held && held.commitTime === commitTime ? { commitTime, duration: held.duration + actualDuration } : { commitTime, duration: actualDuration });
      }
      const held = inner.get(id);
      if (held && held.commitTime === commitTime && actualDuration - held.duration < NESTED_ONLY_MS) return;
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
      const entry = { id, phase, actualDuration, baseDuration, commitTime };
      if (ring.length < MAX_ENTRIES) ring.push(entry);
      else ring[next] = entry;
      next = (next + 1) % MAX_ENTRIES;
    },
    commits: (id) => regions.get(id)?.commits ?? 0,
    stats: () => Object.fromEntries([...regions].map(([id, stats]) => [id, { ...stats }])),
    entries: () => (ring.length < MAX_ENTRIES ? ring.slice() : [...ring.slice(next), ...ring.slice(0, next)]),
    reset: () => {
      regions = new Map();
      inner.clear();
      ring = [];
      next = 0;
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
