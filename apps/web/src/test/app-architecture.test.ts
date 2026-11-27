import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  appLayerOf,
  checkAdapterFile,
  checkAppFile,
  checkEditorRegions,
  createsAtModuleScope,
  diskEnvironment,
  editorRegions,
  isNetworkFree,
  moduleScopeCreators,
  mutableCollectionRule,
  mutableState,
  scan,
  sourceFiles,
  typedSpecifiers,
  type Environment,
} from "./architecture";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const disk = diskEnvironment(srcDir);

function virtual(files: Record<string, string> = {}): Environment {
  const root = "/v/src";
  return { srcDir: root, read: (path) => files[path.replace(`${root}/`, "")] ?? null };
}
const env = virtual();
const at = (path: string) => join(env.srcDir, path);
const app = (path: string, source: string) => checkAppFile(env, at(path), source);
const adapter = (source: string, path = "adapters/x.ts") => checkAdapterFile(env, at(path), source);

const read = (path: string) => disk.read(join(srcDir, path));

describe("architecture of the app layers: the real tree", () => {
  const layerFiles = (dir: string) => sourceFiles(join(srcDir, dir));

  it("only data/ talks to the network, and nothing in a layer builds a store, socket or client at import time", () => {
    // Every file of src/ outside data/, test/ and components/ (which has its own test), so a folder added later is checked too.
    const files = sourceFiles(srcDir).filter((file) => isNetworkFree(file.slice(srcDir.length + 1)));
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((file) => file.endsWith("router.tsx"))).toBe(true);
    const violations = files.flatMap((file) => checkAppFile(disk, file, read(file.slice(srcDir.length + 1)) as string));
    expect(violations).toEqual([]);
  });

  it("adapters are pure: @paprika/core, sibling adapters, pure lib and TYPES of data and the frontends", () => {
    const files = layerFiles("adapters");
    expect(files.length).toBeGreaterThan(0);
    // `adapters/doc-fonts.ts` keeps a `let last` that makes its result depend on the previous call (review finding A1, the
    // performance package replaces it): delete this exception together with that `let`.
    // `noActiveAgents` is an empty sentinel typed `ReadonlyMap`: nothing ever writes to it. Same for `noSelection` and `noTouched` in layer-rows.
    const exceptions = { "adapters/active-agents.ts": [mutableCollectionRule.id], "adapters/layer-rows.ts": [mutableCollectionRule.id] };
    const violations = files.flatMap((file) => checkAdapterFile(disk, file, disk.read(file) as string, exceptions));
    expect(violations).toEqual([]);
  });

  it("every editor region exists, exports its component and is mounted inside its RegionProfiler", () => {
    const files = Object.fromEntries(Object.keys(editorRegions).map((name) => [name, read(`editor/regions/${name}`)]));
    expect(checkEditorRegions(files, [read("editor/editor.tsx"), read("editor/regions/right-panel.tsx"), read("editor/regions/agents.tsx"), read("editor/regions/stage.tsx")].join("\n"))).toEqual([]);
  });

  it("data/ is where the socket and the fetch live (the rule is not vacuous)", () => {
    expect(scan(read("data/live/socket.ts") as string).code).toMatch(/WebSocket/);
    expect(scan(read("data/api.ts") as string).code).toMatch(/fetch\(/);
  });
});

describe("architecture of the app layers: layers", () => {
  it("names the layer of a path", () => {
    expect(appLayerOf("data/live/socket.ts")).toBe("data");
    expect(appLayerOf("editor/regions/header.tsx")).toBe("editor");
    expect(appLayerOf("components/ui/button.tsx")).toBeNull();
    expect(appLayerOf("router.tsx")).toBeNull();
  });
});

describe("architecture of the app layers: network", () => {
  it.each([
    ["editor/regions/layers.tsx", "const r = await fetch('/api/x')"],
    ["editor/use-thing.ts", "const ws = new WebSocket(url)"],
    ["overview/overview-container.tsx", "globalThis.fetch(u)"],
    ["routes/index.tsx", "new EventSource(u)"],
    ["adapters/layer-rows.ts", "new Worker('w.js')"],
    ["perf/perf-log.ts", "navigator.sendBeacon(u)"],
    ["lib/thing.ts", "const x = await api('/y')"],
    ["router.tsx", "fetch(u)"],
  ])("rejects network in %s", (path, source) => {
    expect(app(path, source).length).toBeGreaterThan(0);
  });

  it("lets data/ use it, and lets the layers mention it in comments and strings", () => {
    expect(app("data/api.ts", "await fetch(path)")).toEqual([]);
    expect(app("data/live/socket.ts", "function open() { return new WebSocket(url); }")).toEqual([]);
    expect(app("editor/editor.tsx", "// fetch(x) lives in data/\nconst label = 'fetch'")).toEqual([]);
    expect(app("editor/use-thing.ts", "const prefetch = 1; queryClient.prefetchQuery(q)")).toEqual([]);
  });

  it("names the rule that failed", () => {
    expect(app("editor/x.ts", "fetch(u)")).toEqual(["editor/x.ts: fetch"]);
  });
});

describe("architecture of the app layers: nothing is created at import time", () => {
  it.each([
    ["data/live/live-store.ts", "const store = createStore({ a: 1 });"],
    ["data/x.ts", "export const client = createLiveClient();"],
    ["editor/x.ts", "const log = createPerfLog();"],
    ["overview/x.ts", "const q = new QueryClient();"],
    ["routes/x.ts", "const s = new WebSocket(u);"],
    ["data/x.ts", "const s = new LiveSocket({});"],
    ["perf/x.ts", "export const store = new Store(1);"],
    ["adapters/x.ts", "const q = createQueryClient();"],
    ["editor/x.ts", "const w = new Worker('w.js');"],
  ])("rejects %s: %s", (path, source) => {
    expect(app(path, source)).toContain(`${path}: store, socket or client created at module scope`);
  });

  it.each([
    ["data/live/live-store.ts", "export function make() { return createStore({ a: 1 }); }"],
    ["data/x.ts", "export const make = () => createLiveClient();"],
    ["editor/x.tsx", "function Editor() { const [log] = useState(() => createPerfLog()); return null; }"],
    ["data/x.ts", "class A { start() { this.s = new LiveSocket({}); } }"],
    ["editor/x.ts", "const region = createRegion('x', () => ({}));"],
    ["editor/x.ts", "// createStore(1)\nconst a = 'new WebSocket(u)';"],
  ])("lets %s: %s through", (path, source) => {
    expect(app(path, source)).toEqual([]);
  });

  it("does not apply to tests, and does not apply outside the app layers", () => {
    expect(app("data/live/x.test.ts", "const rig = createLiveClient();")).toEqual([]);
    expect(app("lib/x.ts", "const q = createQueryClient();")).toEqual([]);
  });

  it("createsAtModuleScope sees a creation after a block or a statement at depth 0 and ignores nested ones", () => {
    const scanned = (s: string) => scan(s);
    expect(createsAtModuleScope(scanned("function f() {}\nconst c = createPerfLog();"), moduleScopeCreators)).toBe(true);
    expect(createsAtModuleScope(scanned("if (x) { const c = createPerfLog(); }"), moduleScopeCreators)).toBe(false);
  });
});

describe("architecture of the app layers: holes found by probe (T1)", () => {
  const scoped = (path: string, source: string) => app(path, source).filter((message) => message.includes("module scope"));

  it.each([
    ["an object literal", "export const holder = { log: createPerfLog() };"],
    ["a nested object literal", "export const holder = { a: { b: [createLiveClient()] } };"],
    ["an arrow called at once", "export const client = (() => createLiveClient())();"],
    ["an arrow with a body called at once", "export const client = (() => { return createLiveClient(); })();"],
    ["an async arrow called at once", "export const client = (async () => { await 1; return createLiveClient(); })();"],
    ["a function expression called at once", "export const client = (function () { return createLiveClient(); })();"],
    ["a function expression called inside the parens", "export const client = (function () { return createLiveClient(); }());"],
    ["a creator after an arrow in the same object", "export const x = { f: () => 1, g: createPerfLog() };"],
    ["a line after an arrow without a semicolon", "const f = () => 1\nconst x = createPerfLog()"],
  ])("sees a creator at import time inside %s", (_name, source) => {
    expect(scoped("editor/x.ts", source)).toEqual(["editor/x.ts: store, socket or client created at module scope"]);
  });

  it.each([
    ["an arrow in an object", "export const x = { build: () => createLiveClient() };"],
    ["a method in an object", "export default { setup() { return createPerfLog(); } };"],
    ["a function with a body in an object", "export const x = { build: function () { return createLiveClient(); } };"],
    ["a lazy initializer", "function C() { const [log] = useState(() => createPerfLog()); return log; }"],
    ["an arrow passed to a call", "const make = memo(() => createLiveClient());"],
    ["an arrow that is only defined", "const make = (() => createLiveClient());"],
    ["a class method", "class A { make() { return createPerfLog(); } }"],
    ["a function declaration", "function make() { return { log: createPerfLog() }; }"],
  ])("does not flag a creator that waits for a call: %s", (_name, source) => {
    expect(scoped("editor/x.tsx", source)).toEqual([]);
  });

  it.each([
    ["a bracket access with a cast", 'navigator["sendBeacon" as never](u);'],
    ["a bracket access to WebSocket", 'const s = new globalThis["WebSocket"](u);'],
    ["a bracket access to XMLHttpRequest", "const x = new window['XMLHttpRequest']();"],
    ["a bracket access to EventSource", "const e = new self[`EventSource`](u);"],
    ["an image loaded from the API", 'const img = new Image(); img.src = "/api/workspaces";'],
    ["an API path in a template", "const url = `/api/workspaces/${id}`;"],
    ["the API root in a string", 'const base = "/api";'],
  ])("sees the network through %s", (_name, source) => {
    expect(app("editor/regions/x.tsx", source).length).toBeGreaterThan(0);
  });

  it("names the API-path rule, leaves data/, tests and comments alone, and does not mistake other paths for it", () => {
    expect(app("overview/x.ts", 'const url = "/api/pins";')).toEqual(["overview/x.ts: api path"]);
    expect(app("data/queries/x.ts", 'const url = "/api/pins";')).toEqual([]);
    expect(app("editor/x.test.tsx", 'expect(url).toBe("/api/pins");')).toEqual([]);
    expect(app("editor/x.ts", "// GET /api/pins\nconst a = 1;")).toEqual([]);
    expect(app("editor/x.ts", 'const a = "/apiary"; const b = "/ws-info"; const c = "x/api"; const d = "/fonts/inter.css";')).toEqual([]);
  });

  it.each([
    ["an interpolated base", "const url = `${base}/api/x`;"],
    ["an absolute URL", 'const url = "http://host/api";'],
    ["an absolute URL with a path", 'const url = "https://a.b/api/c";'],
    ["the socket route", 'const url = "/ws";'],
    ["the MCP route", "const url = `/mcp`;"],
    ["an interpolated socket route", "const url = `${proto}://${host}/ws`;"],
  ])("sees an API route written as %s", (_name, source) => {
    expect(app("editor/x.ts", source)).toEqual(["editor/x.ts: api path"]);
  });

  it("checks every folder under src/ except data/, test/ and components/, including one added later", () => {
    for (const path of ["hooks/use-thing.ts", "services/client.ts", "router.tsx", "adapters/x.ts", "lib/x.ts", "perf/x.ts", "editor/x.ts", "overview/x.ts", "routes/x.tsx", "i18n/x.ts"]) {
      expect(isNetworkFree(path), path).toBe(true);
      expect(app(path, "const r = fetch(u);"), path).toEqual([`${path}: fetch`]);
    }
    for (const path of ["data/api.ts", "test/live-harness.tsx", "components/frontends/x/x.tsx"]) expect(isNetworkFree(path), path).toBe(false);
  });

  it.each([
    ["a timer", "const id = setInterval(tick, 1000);"],
    ["a window listener", "window.addEventListener('resize', f);"],
    ["a bare listener", "document.addEventListener('keydown', f);"],
    ["an abort controller", "export const abort = new AbortController();"],
    ["a broadcast channel", "const channel = new BroadcastChannel('x');"],
    ["an observer", "const o = new ResizeObserver(f);"],
  ])("sees %s created at import time", (_name, source) => {
    expect(app("editor/x.ts", source)).toEqual(["editor/x.ts: store, socket or client created at module scope"]);
    expect(app("editor/x.ts", `export function start() { ${source} }`)).toEqual([]);
  });

  it("an adapter cannot keep an empty Map or Set at module scope (a cache), but a constant table and a WeakMap are fine", () => {
    for (const source of ["const cache = new Map();", "const seen = new Set<string>();", "export const memo = new Map<string, number[]>();", "export const empty = { nodes: new Map(), pages: new Map() };"]) {
      expect(adapter(source), source).toEqual([`adapters/x.ts: ${mutableCollectionRule.id}`]);
    }
    expect(adapter('const tools = new Set(["a", "b"]); const memo = new WeakMap<object, string>();')).toEqual([]);
    expect(adapter("export function f() { const seen = new Map(); return seen; }\nconst g = () => new Set();")).toEqual([]);
    expect(adapter("const cache = new Map();", "adapters/x.test.ts")).toEqual([]);
  });

  const lib = (files: Record<string, string>, source: string, path = "adapters/x.ts") => {
    const e = virtual(files);
    return checkAdapterFile(e, join(e.srcDir, path), source);
  };

  it("an adapter takes only the pure lib modules: not persist, use-* or the ones that touch the browser", () => {
    for (const name of ["persist", "use-persisted-state", "use-now", "use-async-action", "copy-text"]) {
      const files = { [`lib/${name}.ts`]: "export const x = 1;" };
      expect(lib(files, `import { x } from "@/lib/${name}";`).join(), name).toContain(`lib module not allowed (@/lib/${name})`);
    }
    expect(lib({ "lib/numeric-input.ts": "export const x = 1;" }, 'import { x } from "@/lib/numeric-input";')).toEqual([]);
  });

  it("an adapter, and the pure lib it follows, cannot reach for storage", () => {
    expect(lib({}, "const v = localStorage.getItem('a');")).toContain("adapters/x.ts: localStorage");
    expect(lib({}, "const v = globalThis.sessionStorage;")).toContain("adapters/x.ts: localStorage");
    expect(lib({ "lib/history-model.ts": "export const x = window.localStorage.getItem('a');" }, 'import { x } from "@/lib/history-model";').join()).toContain("localStorage");
  });

  it("an adapter has no mutable module state: `let` and `var` at the top level, but not in a function", () => {
    expect(lib({}, "let counter = 0;\nexport const next = () => ++counter;")).toContain("adapters/x.ts: mutable module state (let)");
    expect(lib({}, "export let last = [];")).toContain("adapters/x.ts: mutable module state (let)");
    expect(lib({}, "var memo = null;")).toContain("adapters/x.ts: mutable module state (let)");
    expect(lib({}, "export function f() { let a = 0; for (let i = 0; i < 3; i += 1) a += i; return a; }\nconst b = [1].map((x) => { let y = x; return y; });")).toEqual([]);
    expect(lib({}, "let counter = 0;", "adapters/x.test.ts")).toEqual([]);
  });

  it("an adapter cannot use any React hook or context", () => {
    for (const hook of ["useContext(C)", "useSyncExternalStore(a, b)", "useLayoutEffect(f)", "useReducer(r, 0)", "use(promise)"]) {
      expect(lib({}, `const x = ${hook};`).join(), hook).toContain("React hook or context");
    }
    expect(lib({}, "const x = reuse(1); const y = obj.use(2); const z = used(3);")).toEqual([]);
  });
});

describe("architecture of the app layers: adapters", () => {
  it("accepts @paprika/core, sibling adapters and type imports of data and the frontends", () => {
    const source = [
      'import { isRootFrame, type Node } from "@paprika/core";',
      'import type { ServerWorkspace } from "@/data/queries/workspaces";',
      'import type { DeltaMessage } from "@/data/live/protocol";',
      'import type { WorkspaceEntry } from "@/components/frontends/overview";',
      'import { toRow } from "./layer-rows";',
      'import { groupSteps } from "@/lib/history-model";',
      "export const x = 1;",
    ].join("\n");
    const withLib = virtual({ "lib/history-model.ts": "export const groupSteps = 1;" });
    expect(checkAdapterFile(withLib, join(withLib.srcDir, "adapters/x.ts"), source)).toEqual([]);
  });

  it.each([
    ['import { useMemo } from "react";', "package react"],
    ['import { useSelector } from "@tanstack/react-store";', "package @tanstack/react-store"],
    ['import { useQuery } from "@tanstack/react-query";', "package @tanstack/react-query"],
    ['import i18n from "i18next";', "package i18next"],
    ['import { Button } from "@/components/ui/button";', "import @/components/ui/button"],
    ['import { useLive } from "@/data/live";', "import @/data/live"],
    ['import { api } from "@/data/api";', "import @/data/api"],
    ['import { notify } from "@/lib/notify";', "import @/lib/notify"],
    ['import { EditorRegion } from "@/editor/editor-store";', "import @/editor/editor-store"],
    ['import { x } from "../routes/index";', "import ../routes/index"],
  ])("rejects %s", (source, message) => {
    expect(adapter(source).join("\n")).toContain(message);
  });

  it("requires `import type` for data and frontends (a value import would pull React and the network in)", () => {
    expect(adapter('import { applyDelta } from "@/data/live/protocol";').join("\n")).toContain("value import from @/data/live/protocol");
    expect(adapter('import { type DeltaMessage } from "@/data/live/protocol";').join("\n")).toContain("value import");
    expect(adapter('import { Overview } from "@/components/frontends/overview";').join("\n")).toContain("value import");
    expect(adapter('export type { ServerWorkspace } from "@/data/queries/workspaces";')).toEqual([]);
  });

  it("rejects network, hooks, contexts and stores inside an adapter", () => {
    expect(adapter("const r = fetch(u)")).toContain("adapters/x.ts: fetch");
    expect(adapter("const [a] = useState(0)").join()).toContain("React hook or context");
    expect(adapter("const c = createContext(null)").join()).toContain("React hook or context");
    expect(adapter("const s = createStore({})").join()).toContain("store created at module scope");
  });

  it("follows pure lib modules and rejects a lib module that reaches the network", () => {
    const withLib = virtual({ "lib/history-model.ts": "export const x = fetch('/a');" });
    expect(checkAdapterFile(withLib, join(withLib.srcDir, "adapters/h.ts"), 'import { x } from "@/lib/history-model";').join()).toContain("fetch");
  });

  it("lets an adapter test use the test packages and the test helpers", () => {
    const source = ['import { describe, it, expect } from "vitest";', 'import { makeDocument } from "@/test/live-harness";', 'import { toRow } from "./layer-rows";', 'import type { ServerWorkspace } from "@/data/queries/workspaces";'].join("\n");
    expect(adapter(source, "adapters/layer-rows.test.ts")).toEqual([]);
    expect(adapter('import { describe } from "vitest";')).toContain("adapters/x.ts: package vitest");
  });

  it("typedSpecifiers tells type-only statements from value ones", () => {
    const found = typedSpecifiers(scan('import type { A } from "a";\nimport { B } from "b";\nimport { type C } from "c";\nexport type { D } from "d";\nconst e = await import("e");'));
    expect(found.map((s) => [s.value, s.typeOnly])).toEqual([
      ["a", true],
      ["b", false],
      ["c", false],
      ["d", true],
      ["e", false],
    ]);
  });
});

describe("architecture of the app layers: editor regions", () => {
  const ok = Object.fromEntries(Object.entries(editorRegions).map(([file, name]) => [file, `export function ${name}() { return null; }`]));
  const mounted = (skip?: string) =>
    Object.entries(editorRegions)
      .filter(([file]) => file !== skip)
      .map(([file, name]) => `<RegionProfiler id="${file.replace(".tsx", "")}">\n  <${name} />\n</RegionProfiler>`)
      .join("\n");

  it("passes when every file exists, exports its component and is mounted in its profiler", () => {
    expect(checkEditorRegions(ok, mounted())).toEqual([]);
    expect(checkEditorRegions({ ...ok, "export.tsx": "export const Export = () => null;" }, mounted())).toEqual([]);
  });

  it("fails on a missing file, a missing export and a region mounted without its profiler", () => {
    expect(checkEditorRegions({ ...ok, "pins.tsx": null }, mounted())).toEqual(["pins.tsx: missing region file"]);
    expect(checkEditorRegions({ ...ok, "team.tsx": "export function Other() { return null; }" }, mounted())).toEqual(["team.tsx: does not export TeamPanel"]);
    expect(checkEditorRegions(ok, mounted("layers.tsx"))).toEqual(['editor.tsx: Layers is not mounted inside <RegionProfiler id="layers">']);
    expect(checkEditorRegions(ok, mounted().replace('<RegionProfiler id="stage">\n  <Stage />\n</RegionProfiler>', "<Stage />"))).toEqual(['editor.tsx: Stage is not mounted inside <RegionProfiler id="stage">']);
  });

  it("does not count a mount that only appears in a comment", () => {
    expect(checkEditorRegions(ok, `${mounted("agents.tsx")}\n// <RegionProfiler id="agents"><Agents /></RegionProfiler>`)).toHaveLength(1);
  });
});
