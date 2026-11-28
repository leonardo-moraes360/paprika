export type RelativeUnit = "now" | "seconds" | "minutes" | "hours" | "days";

export type RelativeParts = { unit: RelativeUnit; count: number };

export function relativeParts(at: number, now: number, nowBelowSeconds = 5): RelativeParts {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < nowBelowSeconds) return { unit: "now", count: 0 };
  if (seconds < 60) return { unit: "seconds", count: seconds };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { unit: "minutes", count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hours", count: hours };
  return { unit: "days", count: Math.floor(hours / 24) };
}
