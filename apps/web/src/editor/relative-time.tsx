import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { relativeParts } from "@/lib/relative-time";

/**
 * "5 s", "2 min": a leaf with its own clock, so the tick re-renders this span and nothing around it. It reads the
 * clock once while rendering and ticks only afterwards (no state set on mount, so a new row costs no extra commit);
 * an old entry ticks every 30 s, a recent one every second.
 */
export function RelativeTime({ at }: { at: number }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now);
  const old = now - at >= 60_000;
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), old ? 30_000 : 1000);
    return () => clearInterval(id);
  }, [old]);
  const parts = relativeParts(at, now);
  return <time dateTime={new Date(at).toISOString()}>{t(`app.properties.ago.${parts.unit}`, { count: parts.count })}</time>;
}
