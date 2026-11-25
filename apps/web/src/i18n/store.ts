import { catalogs, type Messages } from "./messages";
import { resolveLocale, writeStoredLocale, type Locale } from "./locales";

type Listener = () => void;
const listeners = new Set<Listener>();
let currentLocale: Locale = resolveLocale();

function emit() {
  for (const l of listeners) l();
}

export function getLocale(): Locale {
  return currentLocale;
}

export function getMessages(): Messages {
  return catalogs[currentLocale];
}

export function t(): Messages {
  return catalogs[currentLocale];
}

export function setLocale(next: Locale): void {
  if (next === currentLocale) return;
  currentLocale = next;
  writeStoredLocale(next);
  if (typeof document !== "undefined") document.documentElement.lang = next;
  emit();
}

export function subscribeLocale(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (typeof document !== "undefined") {
  document.documentElement.lang = currentLocale;
}
