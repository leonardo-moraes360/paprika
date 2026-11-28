import { createContext, Profiler, useContext, useEffect, useState, type ReactNode } from "react";
import { createPerfLog, perfRequested, type PerfLog } from "./perf-log";

const PerfContext = createContext<PerfLog | null>(null);
/** The region whose `RegionProfiler` is the nearest ancestor (so a nested region tells the log whose commits it also appears in). */
const ParentRegion = createContext<string | undefined>(undefined);

export type PerfProviderProps = {
  /** An explicit register (tests, harness): profiling is on, `window.__paprikaPerf` stays off. */
  log?: PerfLog;
  /** Overrides the `?perf=1` check. */
  enabled?: boolean;
  children: ReactNode;
};

/** Turns profiling on for everything below it and, with `?perf=1`, exposes the register as `window.__paprikaPerf`. */
export function PerfProvider({ log, enabled, children }: PerfProviderProps) {
  const [requested] = useState(() => enabled ?? perfRequested());
  const [own] = useState(() => (!log && requested ? createPerfLog() : null));
  const active = log ?? own;
  useEffect(() => {
    if (!own || typeof window === "undefined") return;
    window.__paprikaPerf = { stats: own.stats, entries: own.entries, reset: own.reset, commits: own.commits };
    return () => {
      delete window.__paprikaPerf;
    };
  }, [own]);
  return <PerfContext value={active}>{children}</PerfContext>;
}

export const usePerfLog = () => useContext(PerfContext);

/** Wraps one region. Without a register it renders `children` and nothing else (no `<Profiler>` in the tree). */
export function RegionProfiler({ id, children }: { id: string; children: ReactNode }) {
  const log = useContext(PerfContext);
  const within = useContext(ParentRegion);
  if (!log) return children;
  return (
    <Profiler id={id} onRender={(_id, phase, actual, base, start, commit) => log.record(id, phase, actual, base, start, commit, within)}>
      <ParentRegion value={id}>{children}</ParentRegion>
    </Profiler>
  );
}
