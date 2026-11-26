function skipSpaces(text: string): string {
  return text.replace(/^[ \t]+/, "");
}

function takeRun(text: string, run: RegExp): [string, string] {
  const m = run.exec(text);
  const taken = m ? m[0] : "";
  return [taken, text.slice(taken.length)];
}

const TOKEN_TYPES = new Set(["color", "length", "fontFamily", "fontWeight", "fontSize", "lineHeight", "letterSpacing"]);

export interface TokenAssignment {
  name: string;
  value: string;
  type?: string;
  collection?: string;
}

function readTokenName(text: string): { name: string; rest: string } | null {
  let rest = skipSpaces(text);
  if (rest.startsWith("$")) rest = rest.slice(1);
  const [name, after] = takeRun(rest, /^[\w.-]+/);
  if (!name) return null;
  return { name, rest: after };
}

export function parseTokenAssignment(text: string): TokenAssignment | null {
  const head = readTokenName(text);
  if (!head) return null;
  let name = head.name;
  let rest = head.rest;
  let collection: string | undefined;
  let type: string | undefined;
  if (rest[0] === "/") {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(head.name)) return null;
    collection = head.name;
    const next = readTokenName(rest.slice(1));
    if (!next) return null;
    name = next.name;
    rest = next.rest;
  }
  const afterType = skipSpaces(rest);
  if (TOKEN_TYPES.has(name) && afterType[0] && afterType[0] !== "=" && afterType[0] !== ":") {
    const typed = readTokenName(afterType);
    if (typed && (skipSpaces(typed.rest)[0] === "=" || skipSpaces(typed.rest)[0] === ":")) {
      type = name;
      name = typed.name;
      rest = typed.rest;
    }
  }
  rest = skipSpaces(rest);
  if (rest[0] !== "=" && rest[0] !== ":") return null;
  const raw = rest.slice(1);
  if (raw.length === 0) return null;
  const value = raw.trim();
  const out: TokenAssignment = { name, value };
  if (type) out.type = type;
  if (collection) out.collection = collection;
  return out;
}

export function parseModeTokenAssignment(text: string): ({ mode: string } & TokenAssignment) | null {
  let rest = skipSpaces(text);
  const [mode, afterMode] = takeRun(rest, /^[A-Za-z0-9_-]+/);
  if (!mode || mode.length > 40) return null;
  rest = skipSpaces(afterMode);
  if (rest[0] !== ":") return null;
  const token = parseTokenAssignment(rest.slice(1));
  if (!token) return null;
  return { mode, ...token };
}

export function tokenValue(raw: string): string | number {
  const n = Number(raw);
  return Number.isNaN(n) ? raw : n;
}
