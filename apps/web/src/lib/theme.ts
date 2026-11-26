export type ThemePreference = "system" | "light" | "dark";

export const themePreferences: readonly ThemePreference[] = ["system", "light", "dark"];

export const themeStorageKey = "paprika-theme";

function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(themeStorageKey);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function applyThemePreference(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
}

export function writeThemePreference(preference: ThemePreference) {
  try {
    if (preference === "system") window.localStorage.removeItem(themeStorageKey);
    else window.localStorage.setItem(themeStorageKey, preference);
  } catch {
    return;
  }
}

export function setThemePreference(preference: ThemePreference) {
  writeThemePreference(preference);
  applyThemePreference(preference);
}

export const themeInitScript = `try{var t=localStorage.getItem(${JSON.stringify(themeStorageKey)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
