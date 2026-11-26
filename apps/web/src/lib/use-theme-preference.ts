import { useSyncExternalStore } from "react";
import { readThemePreference, setThemePreference, subscribeThemePreference, type ThemePreference } from "./theme";

const serverSnapshot = (): ThemePreference => "system";

export function useThemePreference() {
  const preference = useSyncExternalStore(subscribeThemePreference, readThemePreference, serverSnapshot);
  return [preference, setThemePreference] as const;
}
