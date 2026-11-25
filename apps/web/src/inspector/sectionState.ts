const STORAGE_KEY = "paprika.inspector.sections.v1";

function readMap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
  }
}

export function sectionOpen(id: string, defaultOpen: boolean): boolean {
  const map = readMap();
  return id in map ? map[id]! : defaultOpen;
}

export function setSectionOpen(id: string, open: boolean) {
  const map = readMap();
  map[id] = open;
  writeMap(map);
}