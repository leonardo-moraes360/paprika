import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { relativeParts, type RelativeParts } from "@/lib/relative-time";

/** One clock for the rows that are on screen together: a single interval (1 s) while someone listens, whose reading all of them share. */
export type RelativeClock = { subscribe: (listener: () => void) => () => void; now: () => number };

/** Made by the owner of a list (per instance, never at module scope). The interval runs only while a row listens. */
export function createRelativeClock(tickMs = 1000): RelativeClock {
  let now = Date.now();
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    subscribe: (listener) => {
      if (listeners.size === 0) {
        now = Date.now();
        timer = setInterval(() => {
          now = Date.now();
          for (const each of [...listeners]) each();
        }, tickMs);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          clearInterval(timer);
          timer = undefined;
        }
      };
    },
    now: () => {
      // While nobody listens the reading is refreshed on demand, but not twice within a render (a snapshot read twice must agree).
      if (listeners.size === 0 && Date.now() - now >= 250) now = Date.now();
      return now;
    },
  };
}

const ClockContext = createContext<RelativeClock | null>(null);

/** The clock the rows below read: every row ticks in the same task, so a second that changes twenty rows is one commit, not twenty. */
export function RelativeClockProvider({ clock, children }: { clock: RelativeClock; children: ReactNode }) {
  return <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>;
}

const key = (parts: RelativeParts) => `${parts.unit}:${parts.count}`;

/**
 * "5 s", "2 min": a leaf, so the tick re-renders this span and nothing around it. The snapshot it reads is the text's
 * own key (unit and count), so a tick that does not change this row's text renders nothing (an old entry changes once a
 * minute). Without a provider the row has a clock of its own.
 */
export function RelativeTime({ at }: { at: number }) {
  const { t } = useTranslation();
  const shared = useContext(ClockContext);
  const [own] = useState(() => (shared ? null : createRelativeClock()));
  const clock = shared ?? (own as RelativeClock);
  const text = useSyncExternalStore(clock.subscribe, () => key(relativeParts(at, clock.now())));
  const [unit, count] = text.split(":") as [RelativeParts["unit"], string];
  return <time dateTime={new Date(at).toISOString()}>{t(`app.properties.ago.${unit}`, { count: Number(count) })}</time>;
}
