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
  { id: "script element", view: "text", pattern: /createElement\(\s*(["'`])script\1/ },
  { id: "api(", view: "code", pattern: word("api(?=\\s*\\()") },
];

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

/** True when `pattern` matches in code that runs at import time (outside any function, arrow or braces of a block). */
export function createsAtModuleScope({ code }: Scanned, pattern: RegExp) {
  let depth = 0;
  let statementStart = 0;
  const hits = new Set<number>();
  for (const match of code.matchAll(pattern)) hits.add(match.index);
  for (let i = 0; i < code.length; i += 1) {
    const char = code[i];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth = Math.max(0, depth - 1);
      if (depth === 0) statementStart = i + 1;
    } else if (char === ";" && depth === 0) statementStart = i + 1;
    if (hits.has(i) && depth === 0 && !/=>|\bfunction\b/.test(code.slice(statementStart, i))) return true;
  }
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
const libPackages = [/^react$/, /^clsx$/, /^tailwind-merge$/];

const isTest = (path: string) => /\.test\.tsx?$/.test(path);

export type TestException = Record<string, string[]>;

function networkViolations(scanned: Scanned, path: string, exceptions: TestException) {
  const skip = exceptions[path] ?? [];
  return applyRules(scanned, networkRules).filter((id) => !skip.includes(id));
}

function libViolations(env: Environment, file: string, trail: string[], seen: Set<string>, exceptions: TestException): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const source = env.read(file);
  if (source === null) return [`${trail.join(" -> ")}: missing module`];
  const scanned = scan(source);
  const here = [...trail];
  const out = networkViolations(scanned, file, exceptions).map((id) => `${here.join(" -> ")}: ${id}`);
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
    out.push(...libViolations(env, next, [...here, target.path], seen, exceptions));
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

const networkFreeDirs = ["adapters", "editor", "overview", "routes", "perf", "i18n", "lib"];

export const moduleScopeCreators =
  /(?<![\w$.])(?:createStore\s*[(<]|createLiveClient\s*\(|createPerfLog\s*\(|createQueryClient\s*\(|new\s+(?:Store|QueryClient|LiveSocket|WebSocket|Worker|SharedWorker|EventSource|XMLHttpRequest)\b)/g;

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

const adapterPackages = [/^@paprika\/core$/];
const adapterTypeOnlyPaths = [/^data\/live\/protocol$/, /^data\/queries\/[\w-]+$/, /^components\/frontends\/[\w-]+(?:\/[\w.-]+)?$/];

export function checkAdapterFile(env: Environment, file: string, source: string, exceptions: TestException = {}): string[] {
  const scanned = scan(source);
  const display = posixRelative(env.srcDir, file);
  const out: string[] = networkViolations(scanned, display, exceptions).map((id) => `${display}: ${id}`);
  if (!isTest(file)) {
    if (createsStoreAtModuleScope(scanned)) out.push(`${display}: store created at module scope`);
    if (/(?<![\w$.])(?:useState|useEffect|useMemo|useRef|useCallback|useSelector|createContext)\s*[(<]/.test(scanned.code)) out.push(`${display}: React hook or context in an adapter`);
  }
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
    if (path.startsWith("lib/") && allowedLib.has(path.slice(4))) {
      out.push(...libViolations(env, resolveModule(env, join(env.srcDir, path)), [display, path], seen, exceptions));
      continue;
    }
    out.push(`${display}: import ${spec.value}`);
  }
  return out;
}

/** Network rule for the layers that must go through `data/`, and the import-time creation rule for the layers that hold state. */
export function checkAppFile(env: Environment, file: string, source: string, exceptions: TestException = {}): string[] {
  const display = posixRelative(env.srcDir, file);
  const top = display.split("/")[0] as string;
  const scanned = scan(source);
  const out: string[] = [];
  if (networkFreeDirs.includes(top) || display === "router.tsx") out.push(...networkViolations(scanned, display, exceptions).map((id) => `${display}: ${id}`));
  if (appLayerOf(display) !== null && !isTest(file) && createsAtModuleScope(scanned, moduleScopeCreators)) out.push(`${display}: store, socket or client created at module scope`);
  return out;
}

/** Files of `src/editor/regions` and the component each exports, as `editor.tsx` mounts them (see the plan, batches 2 to 4). */
export const editorRegions: Record<string, string> = {
  "header.tsx": "Header",
  "pages.tsx": "Pages",
  "layers.tsx": "Layers",
  "stage.tsx": "Stage",
  "properties.tsx": "Properties",
  "activity.tsx": "Activity",
  "history.tsx": "History",
  "pins.tsx": "Pins",
  "agents.tsx": "Agents",
  "team.tsx": "Team",
  "notice.tsx": "Notice",
  "export.tsx": "Export",
  "import.tsx": "Import",
};

/** Every region file exists, exports its component, and `editor.tsx` mounts it inside `<RegionProfiler id="...">`. */
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
