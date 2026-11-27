import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";

export type Scanned = { code: string; text: string };

export function scan(source: string): Scanned {
  let code = "";
  let text = "";
  type Context = { kind: "code" } | { kind: "template" } | { kind: "expression"; depth: number };
  const stack: Context[] = [{ kind: "code" }];
  const blank = (value: string) => value.replace(/[^\n]/g, " ");
  let i = 0;
  while (i < source.length) {
    const top = stack[stack.length - 1] as Context;
    const char = source[i] as string;
    const next = source[i + 1];
    if (top.kind === "template") {
      if (char === "\\") {
        text += source.slice(i, i + 2);
        code += blank(source.slice(i, i + 2));
        i += 2;
      } else if (char === "`") {
        stack.pop();
        text += char;
        code += char;
        i += 1;
      } else if (char === "$" && next === "{") {
        stack.push({ kind: "expression", depth: 0 });
        text += "${";
        code += "  ";
        i += 2;
      } else {
        text += char;
        code += char === "\n" ? "\n" : " ";
        i += 1;
      }
      continue;
    }
    if (char === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      text += blank(source.slice(i, stop));
      code += blank(source.slice(i, stop));
      i = stop;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      text += blank(source.slice(i, stop));
      code += blank(source.slice(i, stop));
      i = stop;
    } else if (char === '"' || char === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== char && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      const raw = source.slice(i, j + 1);
      text += raw;
      code += char + blank(raw.slice(1, -1)) + (raw.length > 1 ? char : "");
      i = j + 1;
    } else if (char === "`") {
      stack.push({ kind: "template" });
      text += char;
      code += char;
      i += 1;
    } else {
      if (top.kind === "expression") {
        if (char === "{") top.depth += 1;
        else if (char === "}") {
          if (top.depth === 0) {
            stack.pop();
            text += char;
            code += " ";
            i += 1;
            continue;
          }
          top.depth -= 1;
        }
      }
      text += char;
      code += char;
      i += 1;
    }
  }
  return { code, text };
}

export type Specifier = { value: string; dynamic: boolean };

export function specifiers(scanned: Scanned): Specifier[] {
  const found: Specifier[] = [];
  const { text, code } = scanned;
  // `code` has the same length as `text` with string contents blanked: a keyword that is only
  // text inside a string literal (e.g. "frontends.x.import") is not at that index in `code`.
  const isCode = (match: RegExpMatchArray) => {
    const word = /^\w+/.exec(match[0])?.[0] ?? "";
    return code.slice(match.index, (match.index as number) + word.length) === word;
  };
  for (const match of text.matchAll(/\b(?:import|export)\b[^;'"`]*?\bfrom\s*(["'`])([^"'`]*)\1/g)) if (isCode(match)) found.push({ value: match[2] as string, dynamic: false });
  for (const match of text.matchAll(/\bimport\s*(["'`])([^"'`]*)\1/g)) if (isCode(match)) found.push({ value: match[2] as string, dynamic: false });
  for (const match of text.matchAll(/\bimport\s*\(\s*([^)]*?)\s*\)/g)) {
    if (!isCode(match)) continue;
    const literal = /^(["'`])([^"'`$]*)\1$/.exec(match[1] as string);
    found.push(literal ? { value: literal[2] as string, dynamic: true } : { value: `<non-literal ${match[1]}>`, dynamic: true });
  }
  for (const match of text.matchAll(/\brequire\s*\(\s*(["'`])([^"'`]*)\1\s*\)/g)) if (isCode(match)) found.push({ value: match[2] as string, dynamic: true });
  return found;
}

type View = "code" | "text";
export type Rule = { id: string; view: View; pattern: RegExp };

const word = (name: string) => new RegExp(`(?<![\\w$.])${name}(?![\\w$])`);
const globalWord = (name: string) =>
  new RegExp(`(?<![\\w$.])${name}(?![\\w$])|(?<![\\w$])(?:globalThis|window|self|global)\\s*\\.\\s*${name}(?![\\w$])`);

export const networkRules: Rule[] = [
  { id: "fetch", view: "code", pattern: globalWord("fetch") },
  { id: "bracket fetch", view: "text", pattern: /\[\s*(["'`])fetch\1\s*\]/ },
  { id: "XMLHttpRequest", view: "code", pattern: globalWord("XMLHttpRequest") },
  { id: "WebSocket", view: "code", pattern: globalWord("WebSocket") },
  { id: "EventSource", view: "code", pattern: globalWord("EventSource") },
  { id: "WebTransport", view: "code", pattern: globalWord("WebTransport") },
  { id: "RTCPeerConnection", view: "code", pattern: globalWord("RTCPeerConnection") },
  { id: "Worker", view: "code", pattern: /(?<![\w$.])new\s+(?:(?:globalThis|window|self)\s*\.\s*)?(?:Shared)?Worker(?![\w$])/ },
  { id: "service worker", view: "code", pattern: /(?<![\w$])navigator\s*\.\s*serviceWorker(?![\w$])/ },
  { id: "importScripts", view: "code", pattern: word("importScripts") },
  { id: "sendBeacon", view: "code", pattern: /(?<![\w$])sendBeacon(?![\w$])/ },
  // A bracket access names the API in a string, so the code view (strings blanked) misses it: `navigator["sendBeacon" as never](u)`.
  { id: "bracket network API", view: "text", pattern: /\[\s*(["'`])(?:sendBeacon|WebSocket|XMLHttpRequest|EventSource|WebTransport|RTCPeerConnection|Worker|SharedWorker|importScripts)\1/ },
  { id: "script element", view: "text", pattern: /createElement\(\s*(["'`])script\1/ },
  { id: "api(", view: "code", pattern: word("api(?=\\s*\\()") },
];

/**
 * A path under `/api` written in a string (an image `src`, an `<a href>`, a `new Image()` that loads it) is a request made
 * outside `data/`, whatever the element. It does not apply to tests, which name the URLs their fake server answers.
 */
const apiPath: Rule = {
  id: "api path",
  view: "text",
  // The string starts with the path (`"/api/x"`), or with an origin or an interpolation before it (`"http://host/api"`, `${base}/api/x`). The socket's `/ws` and the MCP endpoint `/mcp` are the other
  // routes the server answers: `/fonts` is left out because a stylesheet link to it (`routes/__root.tsx`) is a static asset, not a request the app makes.
  pattern: /(["'`])(?:[^"'`\n]*?(?:\}|:\/\/[^/"'`\s]*))?\/(?:api|ws|mcp)(?![\w-])/i,
};

const hexColor: Rule = {
  id: "hex color",
  view: "text",
  pattern: /(?<=[\s"'`(\[:,=])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![\w-])/,
};

const darkVariant: Rule = { id: "dark:", view: "text", pattern: /(?<![\w-])dark:[\w[!-]/ };

const storageAccess: Rule = { id: "localStorage", view: "code", pattern: globalWord("(?:localStorage|sessionStorage|indexedDB)") };

export const frontendRules: Rule[] = [
  storageAccess,
  { id: "document.cookie", view: "code", pattern: /(?<![\w$])document\s*\.\s*cookie(?![\w$])/ },
  { id: "location", view: "code", pattern: /(?<![\w$.])location\s*(?:\.\s*(?:href|assign|replace|reload|hash|search|pathname|origin|host|hostname|port|protocol)(?![\w$])|=(?!=))|(?<![\w$])(?:window|globalThis|document)\s*\.\s*location(?![\w$])/ },
  { id: "history navigation", view: "code", pattern: /(?<![\w$])history\s*\.\s*(?:pushState|replaceState)(?![\w$])/ },
  { id: "window.open", view: "code", pattern: /(?<![\w$])(?:window|globalThis)\s*\.\s*open\s*\(/ },
  hexColor,
  darkVariant,
];

export const uiRules: Rule[] = [storageAccess, darkVariant];

export function applyRules(scanned: Scanned, rules: Rule[]) {
  return rules.filter((rule) => rule.pattern.test(scanned[rule.view])).map((rule) => rule.id);
}

export function createsStoreAtModuleScope(scanned: Scanned) {
  return createsAtModuleScope(scanned, /(?<![\w$.])(?:createStore\s*[(<]|new\s+Store\b)/g);
}

type Range = [start: number, end: number];

type Frame = { kind: "paren" | "bracket" | "object" | "body" | "arrow"; open: number; fnStart: number };

const isWordChar = (char: string | undefined) => char !== undefined && /[\w$]/.test(char);

/** What the code does at import time, from one pass over the brackets of the `code` view of a file. */
function walk(code: string): { deferred: Range[]; depthAt: Uint16Array } {
  const deferred: Range[] = [];
  const depthAt = new Uint16Array(code.length + 1);
  const stack: Frame[] = [];
  const skipBack = (from: number) => {
    let i = from;
    while (i >= 0 && /\s/.test(code[i] as string)) i -= 1;
    return i;
  };
  const skipForward = (from: number) => {
    let i = from;
    while (i < code.length && /\s/.test(code[i] as string)) i += 1;
    return i;
  };
  /** Where the function that ends at `=>` begins: its parameter list or single parameter, and a leading `async`. */
  const arrowStart = (arrow: number) => {
    let i = skipBack(arrow - 1);
    if (code[i] === ")") {
      let depth = 0;
      for (; i >= 0; i -= 1) {
        if (code[i] === ")") depth += 1;
        else if (code[i] === "(" && (depth -= 1) === 0) break;
      }
    } else while (i >= 0 && isWordChar(code[i])) i -= 1;
    let start = i < 0 ? 0 : code[i] === "(" ? i : i + 1;
    const before = skipBack(start - 1);
    if (before >= 4 && code.slice(before - 4, before + 1) === "async" && !isWordChar(code[before - 5])) start = before - 4;
    return start;
  };
  /** A function expression that is called where it stands: `(…)()`, `(function () {…}())` or `function () {…}()`. */
  const calledAtOnce = (frame: Frame, end: number, parent: Frame | undefined) => {
    const after = skipForward(end);
    if (code[after] === "(") return true;
    if (code[after] !== ")") return false;
    const wrapped = parent?.kind === "paren" && parent.open === skipBack(frame.fnStart - 1);
    return wrapped && code[skipForward(after + 1)] === "(";
  };
  const close = (frame: Frame, end: number) => {
    // An arrow's body ends where it is closed; a `{}` function body ends at the brace, an object literal runs at once.
    if (frame.kind !== "body" && frame.kind !== "arrow") return;
    if (!calledAtOnce(frame, end, stack[stack.length - 1])) deferred.push([frame.open, end]);
  };
  const endArrows = (end: number, includeBoundary: boolean) => {
    while (stack.length > 0 && (stack[stack.length - 1] as Frame).kind === "arrow") {
      const frame = stack.pop() as Frame;
      close(frame, includeBoundary ? end + 1 : end);
    }
  };
  let nextBody: number | null = null;
  let functionKeyword = -1;
  let functionDepth = 0;
  for (let i = 0; i < code.length; i += 1) {
    depthAt[i] = stack.length;
    const char = code[i] as string;
    if (char === "=" && code[i + 1] === ">") {
      const start = arrowStart(i);
      const first = skipForward(i + 2);
      if (code[first] === "{") nextBody = start;
      else stack.push({ kind: "arrow", open: i + 2, fnStart: start });
      i += 1;
    } else if (char === "f" && code.startsWith("function", i) && !isWordChar(code[i - 1]) && !isWordChar(code[i + 8])) {
      functionKeyword = i;
      functionDepth = stack.length;
      const before = skipBack(i - 1);
      if (before >= 4 && code.slice(before - 4, before + 1) === "async" && !isWordChar(code[before - 5])) functionKeyword = before - 4;
    } else if (char === "{") {
      const before = skipBack(i - 1);
      const head = code.slice(Math.max(0, i - 200), i);
      const word = /([\w$]+)\s*$/.exec(head)?.[1];
      if (nextBody !== null) {
        stack.push({ kind: "body", open: i, fnStart: nextBody });
        nextBody = null;
      } else if (code[before] === ")" || /\)\s*:\s*[^{}();=]*$/.test(head) || (functionKeyword >= 0 && stack.length === functionDepth)) {
        stack.push({ kind: "body", open: i, fnStart: functionKeyword >= 0 ? functionKeyword : -1 });
        functionKeyword = -1;
      } else if ((word && /^(?:else|try|finally|do|static)$/.test(word)) || /\bclass\b[^{;=()]*$/.test(head)) stack.push({ kind: "body", open: i, fnStart: -1 });
      else stack.push({ kind: "object", open: i, fnStart: -1 });
    } else if (char === "(") stack.push({ kind: "paren", open: i, fnStart: -1 });
    else if (char === "[") stack.push({ kind: "bracket", open: i, fnStart: -1 });
    else if (char === ")" || char === "]" || char === "}") {
      endArrows(i, false);
      const frame = stack.pop();
      if (frame) close(frame, i + 1);
    } else if (char === "," || char === ";") endArrows(i, false);
    else if (char === "\n") {
      // An arrow with no braces ends at the end of its line when the next line starts a new statement (ASI).
      const top = stack[stack.length - 1];
      if (top?.kind === "arrow" && code.slice(top.open, i).trim() !== "" && /[A-Za-z_$@]/.test(code[skipForward(i)] ?? "") && !/^(?:instanceof|in|of|as|satisfies)\b/.test(code.slice(skipForward(i), skipForward(i) + 12))) endArrows(i, false);
    }
  }
  depthAt[code.length] = stack.length;
  for (const frame of stack.splice(0)) if (frame.kind === "arrow" || frame.kind === "body") deferred.push([frame.open, code.length]);
  return { deferred, depthAt };
}

/** True when `pattern` matches in code that runs at import time: outside any function body, class, block or arrow, whatever object or array literal it sits in; a function that is called where it stands counts too. */
export function createsAtModuleScope({ code }: Scanned, pattern: RegExp) {
  const { deferred } = walk(code);
  for (const match of code.matchAll(pattern)) {
    const at = match.index as number;
    // The name of a function being declared (`function createPerfLog() {`) is not a call.
    if (/\bfunction\s*\*?\s*$/.test(code.slice(Math.max(0, at - 20), at))) continue;
    if (!deferred.some(([start, end]) => at >= start && at < end)) return true;
  }
  return false;
}

/** The `let` and `var` declarations at the top level of a file: state that outlives a call and depends on the previous one. */
export function mutableModuleState({ code }: Scanned): boolean {
  const { depthAt } = walk(code);
  for (const match of code.matchAll(/(?<![\w$.])(?:let|var)\s+[\w${[]/g)) if (depthAt[match.index as number] === 0) return true;
  return false;
}

export type Environment = {
  srcDir: string;
  read: (absolutePath: string) => string | null;
};

export function diskEnvironment(srcDir: string): Environment {
  return {
    srcDir,
    read: (absolutePath) => (existsSync(absolutePath) && statSync(absolutePath).isFile() ? readFileSync(absolutePath, "utf8") : null),
  };
}

export type Resolved = { kind: "package"; name: string } | { kind: "src"; path: string };

export function resolveSpecifier(env: Environment, from: string, value: string): Resolved {
  if (value.startsWith("@/")) return { kind: "src", path: value.slice(2) };
  if (value.startsWith(".")) {
    const absolute = resolve(dirname(from), value);
    return { kind: "src", path: relative(env.srcDir, absolute).split(sep).join("/") };
  }
  return { kind: "package", name: value };
}

const frontendPackages = [
  /^react$/,
  /^react-i18next$/,
  /^@tanstack\/(?:react-store|store|react-virtual|virtual-core|react-hotkeys|hotkeys)$/,
  /^uqr$/,
  /^lucide-react$/,
  /^@ui-sdk\/(?:react|core)\/(?!internal\/|web\.css$)[\w./-]+$/,
  /^@ui-sdk\/core$/,
  /^@paprika\/core$/,
];

const testPackages = [/^@testing-library\/(?:react|user-event|dom|jest-dom)$/, /^vitest$/, /^react-dom(?:\/server|\/test-utils)?$/, /^react\/jsx-runtime$/];

const allowedLib = new Set(["utils", "persist", "use-persisted-state", "numeric-input", "token-parsing", "use-now", "use-async-action", "copy-text", "relative-time", "history-model", "issue-url"]);
/** The lib modules an adapter may follow: only the ones that are pure (no storage, no timers, no clipboard, no hooks). */
const adapterLib = new Set(["utils", "numeric-input", "token-parsing", "relative-time", "history-model", "issue-url"]);
const libPackages = [/^react$/, /^clsx$/, /^tailwind-merge$/];

const isTest = (path: string) => /\.test\.tsx?$/.test(path);

export type TestException = Record<string, string[]>;

function networkViolations(scanned: Scanned, path: string, exceptions: TestException) {
  const skip = exceptions[path] ?? [];
  const rules = isTest(path) ? networkRules : [...networkRules, apiPath];
  return applyRules(scanned, rules).filter((id) => !skip.includes(id));
}

function libViolations(env: Environment, file: string, trail: string[], seen: Set<string>, exceptions: TestException, extraRules: Rule[] = []): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const source = env.read(file);
  if (source === null) return [`${trail.join(" -> ")}: missing module`];
  const scanned = scan(source);
  const here = [...trail];
  const out = [...networkViolations(scanned, file, exceptions), ...applyRules(scanned, extraRules)].map((id) => `${here.join(" -> ")}: ${id}`);
  for (const spec of specifiers(scanned)) {
    if (spec.value.startsWith("<non-literal")) {
      out.push(`${here.join(" -> ")}: dynamic import with a computed specifier`);
      continue;
    }
    const target = resolveSpecifier(env, file, spec.value);
    if (target.kind === "package") {
      if (!libPackages.some((pattern) => pattern.test(target.name))) out.push(`${here.join(" -> ")}: package ${target.name}`);
      continue;
    }
    if (!target.path.startsWith("lib/")) {
      out.push(`${here.join(" -> ")}: import ${spec.value}`);
      continue;
    }
    const next = resolveModule(env, join(env.srcDir, target.path));
    out.push(...libViolations(env, next, [...here, target.path], seen, exceptions, extraRules));
  }
  return out;
}

function resolveModule(env: Environment, base: string) {
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (env.read(candidate) !== null) return candidate;
  }
  return base;
}

export function checkFrontendFile(env: Environment, file: string, source: string, exceptions: TestException = {}): string[] {
  const scanned = scan(source);
  const test = isTest(file);
  const display = posixRelative(env.srcDir, file);
  const out: string[] = networkViolations(scanned, display, exceptions).map((id) => `${display}: ${id}`);
  if (!test) {
    out.push(...applyRules(scanned, frontendRules).map((id) => `${display}: ${id}`));
    if (createsStoreAtModuleScope(scanned)) out.push(`${display}: store created at module scope`);
  }
  const frontendsRoot = join(env.srcDir, "components", "frontends");
  const own = relative(frontendsRoot, file).split(sep)[0] as string;
  const seen = new Set<string>();
  for (const spec of specifiers(scanned)) {
    if (spec.value.startsWith("<non-literal")) {
      out.push(`${display}: dynamic import with a computed specifier`);
      continue;
    }
    const target = resolveSpecifier(env, file, spec.value);
    if (target.kind === "package") {
      const allowed = frontendPackages.some((pattern) => pattern.test(target.name)) || (test && testPackages.some((pattern) => pattern.test(target.name)));
      if (!allowed) out.push(`${display}: package ${target.name}`);
      continue;
    }
    const path = target.path;
    if (path.startsWith("components/ui/")) continue;
    if (path.startsWith("components/frontends/")) {
      const folder = path.split("/")[2];
      if (folder === "_shared" || folder === own) continue;
      out.push(`${display}: import between frontends (${spec.value})`);
      continue;
    }
    if (path === "i18n" || path === "i18n/resources" || (test && path.startsWith("i18n/"))) continue;
    if (test && path.startsWith("test/")) continue;
    if (path.startsWith("lib/")) {
      const name = path.slice(4);
      if (allowedLib.has(name)) {
        out.push(...libViolations(env, resolveModule(env, join(env.srcDir, path)), [display, path], seen, exceptions));
        continue;
      }
      out.push(`${display}: lib module not allowed (${spec.value})`);
      continue;
    }
    out.push(`${display}: import ${spec.value}`);
  }
  return out;
}

const uiForbiddenPaths = [/^components\/frontends(?:\/|$)/, /^i18n(?:\/|$)/, /^lib\/(?:persist|use-persisted-state)$/, /^router$/, /^routes(?:\/|$)/, /^lib\/(?:api|notify)$/];
const uiForbiddenPackages = [
  /^(?:i18next|react-i18next|i18next-browser-languagedetector)$/,
  /^@tanstack\/(?:react-router|router-core|react-start)$/,
  /^@tanstack\/(?:react-store|store)$/,
  /^@tanstack\/(?:react-query|query-core|react-db|db)$/,
  /(?:^|\/)web\.css$/,
];

export function checkUiFile(env: Environment, file: string, source: string): string[] {
  const scanned = scan(source);
  const display = posixRelative(env.srcDir, file);
  const out = [...networkViolations(scanned, display, {}), ...applyRules(scanned, uiRules)].map((id) => `${display}: ${id}`);
  for (const spec of specifiers(scanned)) {
    if (spec.value.startsWith("<non-literal")) {
      out.push(`${display}: dynamic import with a computed specifier`);
      continue;
    }
    const target = resolveSpecifier(env, file, spec.value);
    if (target.kind === "package" && uiForbiddenPackages.some((pattern) => pattern.test(target.name))) out.push(`${display}: package ${target.name}`);
    if (target.kind === "src" && uiForbiddenPaths.some((pattern) => pattern.test(target.path))) out.push(`${display}: import ${spec.value}`);
  }
  return out;
}

export function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

export function checkStructure(frontendsDir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(frontendsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      out.push(`${entry.name}: loose file in frontends`);
      continue;
    }
    const files = readdirSync(join(frontendsDir, entry.name));
    if (!files.includes("index.ts")) out.push(`${entry.name}: missing index.ts`);
    if (entry.name === "_shared") {
      if (!files.some((file) => file.endsWith(".test.tsx") || file.endsWith(".test.ts"))) out.push(`${entry.name}: missing test`);
    } else if (!files.includes(`${entry.name}.test.tsx`)) out.push(`${entry.name}: missing ${entry.name}.test.tsx`);
  }
  return out;
}

export function posixRelative(from: string, to: string) {
  return posix.normalize(relative(from, to).split(sep).join("/"));
}

/**
 * Layers of the app outside `components/`. `data/` is the only one that talks to the network. The rest:
 * - `adapters/` is pure (no React, no stores, no network): `@paprika/core`, sibling adapters, pure `lib/*`, and TYPES
 *   (`import type`) of `data/live/protocol`, `data/queries/*` and the frontends.
 * - `editor/`, `overview/`, `routes/`, `perf/`, `lib/`, `i18n/` and `router.tsx` never touch the network (they go through `data/`).
 * - nothing in `data/`, `adapters/`, `editor/`, `overview/`, `routes/`, `perf/` makes a store, a socket or a client at import time.
 */
export const appLayers = ["data", "adapters", "editor", "overview", "routes", "perf"] as const;
export type AppLayer = (typeof appLayers)[number];

/**
 * Where the network rules do NOT apply: `data/` is the layer that talks to the server, `test/` is the shared test harness (its fake socket and
 * server) and `components/` has its own test (`components/architecture.test.ts`). Everything else under `src/` is checked, so a folder that is
 * added later (`hooks/`, `services/`) is covered without anyone remembering to list it.
 */
const networkAllowedTop = new Set(["data", "test", "components"]);
export const isNetworkFree = (display: string) => !networkAllowedTop.has(display.split("/")[0] as string);

export const moduleScopeCreators =
  /(?<![\w$.])(?:createStore\s*[(<]|createLiveClient\s*\(|createPerfLog\s*\(|createQueryClient\s*\(|setInterval\s*\(|(?:window\s*\.\s*|document\s*\.\s*|globalThis\s*\.\s*)?addEventListener\s*\(|new\s+(?:Store|QueryClient|LiveSocket|WebSocket|Worker|SharedWorker|EventSource|XMLHttpRequest|AbortController|BroadcastChannel|MutationObserver|ResizeObserver|IntersectionObserver)\b)/g;

export function appLayerOf(path: string): AppLayer | null {
  const top = path.split("/")[0] as string;
  return (appLayers as readonly string[]).includes(top) ? (top as AppLayer) : null;
}

type TypedSpecifier = Specifier & { typeOnly: boolean };

/** Like `specifiers`, and tells `import type` / `export type ... from` (a whole-statement type import) from a value import. */
export function typedSpecifiers(scanned: Scanned): TypedSpecifier[] {
  const { text, code } = scanned;
  const out: TypedSpecifier[] = [];
  for (const match of text.matchAll(/\b(?:import|export)\b([^;'"`]*?)\bfrom\s*(["'`])([^"'`]*)\2/g)) {
    const word = /^\w+/.exec(match[0])?.[0] ?? "";
    if (code.slice(match.index, (match.index as number) + word.length) !== word) continue;
    out.push({ value: match[3] as string, dynamic: false, typeOnly: /^\s*type\b/.test(match[1] as string) });
  }
  const typed = new Set(out.map((entry) => entry.value));
  for (const entry of specifiers(scanned)) if (!typed.has(entry.value) || entry.dynamic) out.push({ ...entry, typeOnly: false });
  return out;
}

/** Rule id of the adapter check for a `let` or `var` at the top level (an exception names it, with the finding that removes it). */
export const mutableState = { id: "mutable module state (let)" };
export const mutableCollectionRule = { id: "Map or Set at module scope" };
/** An EMPTY `Map` or `Set` is a cache waiting to be filled; one made from its contents (`new Set(["a", "b"])`) is a constant lookup table and is fine. */
const mutableCollection = /(?<![\w$.])new\s+(?:Map|Set)\s*(?:<[^()]*?>)?\s*\(\s*\)/g;

const adapterPackages = [/^@paprika\/core$/];
const adapterTypeOnlyPaths = [/^data\/live\/protocol$/, /^data\/queries\/[\w-]+$/, /^components\/frontends\/[\w-]+(?:\/[\w.-]+)?$/];

export function checkAdapterFile(env: Environment, file: string, source: string, exceptions: TestException = {}): string[] {
  const scanned = scan(source);
  const display = posixRelative(env.srcDir, file);
  const out: string[] = networkViolations(scanned, display, exceptions).map((id) => `${display}: ${id}`);
  if (!isTest(file)) {
    if (createsStoreAtModuleScope(scanned)) out.push(`${display}: store created at module scope`);
    if (/(?<![\w$.])(?:use[A-Z]\w*|use|createContext)\s*[(<]/.test(scanned.code)) out.push(`${display}: React hook or context in an adapter`);
    if (!(exceptions[display] ?? []).includes(mutableState.id) && mutableModuleState(scanned)) out.push(`${display}: ${mutableState.id}`);
    // A `Map` or `Set` made at import time is a cache that outlives a call and makes the result depend on the previous one. A `WeakMap` keyed by the input object is the one memo allowed (its entries go with the input).
    if (!(exceptions[display] ?? []).includes(mutableCollectionRule.id) && createsAtModuleScope(scanned, mutableCollection)) out.push(`${display}: ${mutableCollectionRule.id}`);
  }
  out.push(...applyRules(scanned, [storageAccess]).map((id) => `${display}: ${id}`));
  const seen = new Set<string>();
  for (const spec of typedSpecifiers(scanned)) {
    if (spec.value.startsWith("<non-literal")) {
      out.push(`${display}: dynamic import with a computed specifier`);
      continue;
    }
    const target = resolveSpecifier(env, file, spec.value);
    if (target.kind === "package") {
      const testOk = isTest(file) && (testPackages.some((p) => p.test(target.name)) || /^@\/test\//.test(target.name));
      if (!adapterPackages.some((pattern) => pattern.test(target.name)) && !testOk) out.push(`${display}: package ${target.name}`);
      continue;
    }
    const path = target.path;
    if (path.startsWith("adapters/") || (isTest(file) && path.startsWith("test/"))) continue;
    if (adapterTypeOnlyPaths.some((pattern) => pattern.test(path))) {
      if (!spec.typeOnly && !isTest(file)) out.push(`${display}: value import from ${spec.value} (use import type)`);
      continue;
    }
    if (path.startsWith("lib/") && adapterLib.has(path.slice(4))) {
      out.push(...libViolations(env, resolveModule(env, join(env.srcDir, path)), [display, path], seen, exceptions, [storageAccess]));
      continue;
    }
    if (path.startsWith("lib/") && allowedLib.has(path.slice(4))) {
      out.push(`${display}: lib module not allowed (${spec.value})`);
      continue;
    }
    out.push(`${display}: import ${spec.value}`);
  }
  return out;
}

/** Network rule for the layers that must go through `data/`, and the import-time creation rule for the layers that hold state. */
export function checkAppFile(env: Environment, file: string, source: string, exceptions: TestException = {}): string[] {
  const display = posixRelative(env.srcDir, file);
  const scanned = scan(source);
  const out: string[] = [];
  if (isNetworkFree(display)) out.push(...networkViolations(scanned, display, exceptions).map((id) => `${display}: ${id}`));
  if (appLayerOf(display) !== null && !isTest(file) && createsAtModuleScope(scanned, moduleScopeCreators)) out.push(`${display}: store, socket or client created at module scope`);
  return out;
}

/** Files of `src/editor/regions` and the component each exports, as `editor.tsx` mounts them (see the plan, batches 2 to 4). */
export const editorRegions: Record<string, string> = {
  "header.tsx": "Header",
  "pages.tsx": "Pages",
  "layers.tsx": "Layers",
  "stage.tsx": "Stage",
  "canvas.tsx": "CanvasRegion",
  "properties.tsx": "Properties",
  "activity.tsx": "Activity",
  "history.tsx": "History",
  "pins.tsx": "Pins",
  "agents.tsx": "AgentsRoster",
  "team.tsx": "TeamPanel",
  "notice.tsx": "Notice",
  "export.tsx": "Export",
  "import.tsx": "Import",
};

/** Every region file exists, exports its component, and the editor (`editor.tsx`, plus `right-panel.tsx` for properties, activity and the team tab, `agents.tsx` for the roster the header hosts and `stage.tsx` for the canvas it hosts) mounts it inside `<RegionProfiler id="...">`. */
export function checkEditorRegions(files: Record<string, string | null>, editorSource: string): string[] {
  const out: string[] = [];
  const editor = scan(editorSource).text;
  for (const [file, component] of Object.entries(editorRegions)) {
    const source = files[file];
    if (source == null) {
      out.push(`${file}: missing region file`);
      continue;
    }
    if (!new RegExp(`export\\s+(?:function|const)\\s+${component}\\b`).test(scan(source).code)) out.push(`${file}: does not export ${component}`);
    const id = file.replace(/\.tsx$/, "");
    if (!new RegExp(`<RegionProfiler\\s+id="${id}"\\s*>\\s*<${component}\\b`).test(editor)) out.push(`editor.tsx: ${component} is not mounted inside <RegionProfiler id="${id}">`);
  }
  return out;
}
