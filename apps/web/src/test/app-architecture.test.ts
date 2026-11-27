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
  moduleScopeCreators,
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
    const files = [...["data", "adapters", "editor", "overview", "routes", "perf", "i18n", "lib"].flatMap(layerFiles), join(srcDir, "router.tsx")];
    const violations = files.flatMap((file) => checkAppFile(disk, file, read(file.slice(srcDir.length + 1)) as string));
    expect(violations).toEqual([]);
  });

  it("adapters are pure: @paprika/core, sibling adapters, pure lib and TYPES of data and the frontends", () => {
    const files = layerFiles("adapters");
    expect(files.length).toBeGreaterThan(0);
    const violations = files.flatMap((file) => checkAdapterFile(disk, file, disk.read(file) as string));
    expect(violations).toEqual([]);
  });

  it("every editor region exists, exports its component and is mounted inside its RegionProfiler", () => {
    const files = Object.fromEntries(Object.keys(editorRegions).map((name) => [name, read(`editor/regions/${name}`)]));
    expect(checkEditorRegions(files, read("editor/editor.tsx") as string)).toEqual([]);
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
    expect(checkEditorRegions({ ...ok, "team.tsx": "export function Other() { return null; }" }, mounted())).toEqual(["team.tsx: does not export Team"]);
    expect(checkEditorRegions(ok, mounted("layers.tsx"))).toEqual(['editor.tsx: Layers is not mounted inside <RegionProfiler id="layers">']);
    expect(checkEditorRegions(ok, mounted().replace('<RegionProfiler id="stage">\n  <Stage />\n</RegionProfiler>', "<Stage />"))).toEqual(['editor.tsx: Stage is not mounted inside <RegionProfiler id="stage">']);
  });

  it("does not count a mount that only appears in a comment", () => {
    expect(checkEditorRegions(ok, `${mounted("agents.tsx")}\n// <RegionProfiler id="agents"><Agents /></RegionProfiler>`)).toHaveLength(1);
  });
});
