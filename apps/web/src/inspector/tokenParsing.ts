function skipSpaces(text: string): string {
  return text.replace(/^[ \t]+/, "");
}

function takeRun(text: string, run: RegExp): [string, string] {
  const m = run.exec(text);
  const taken = m ? m[0] : "";
  return [taken, text.slice(taken.length)];
}

export function parseTokenAssignment(text: string): { name: string; value: string } | null {
  let rest = skipSpaces(text);
  if (rest.startsWith("$")) rest = rest.slice(1);
  const [name, afterName] = takeRun(rest, /^[\w.-]+/);
  if (!name) return null;
  rest = skipSpaces(afterName);
  if (rest[0] !== "=" && rest[0] !== ":") return null;
  const value = rest.slice(1);
  return value ? { name, value: value.trim() } : null;
}

export function parseModeTokenAssignment(text: string): { mode: string; name: string; value: string } | null {
  let rest = skipSpaces(text);
  const [mode, afterMode] = takeRun(rest, /^[A-Za-z0-9_-]+/);
  if (!mode || mode.length > 40) return null;
  rest = skipSpaces(afterMode);
  if (rest[0] !== ":") return null;
  rest = skipSpaces(rest.slice(1));
  if (rest.startsWith("$")) rest = rest.slice(1);
  const [name, afterName] = takeRun(rest, /^[\w.-]+/);
  if (!name) return null;
  rest = skipSpaces(afterName);
  if (rest[0] !== "=" && rest[0] !== ":") return null;
  const value = rest.slice(1);
  return value ? { mode, name, value: value.trim() } : null;
}

export function tokenValue(raw: string): string | number {
  const n = Number(raw);
  return Number.isNaN(n) ? raw : n;
}