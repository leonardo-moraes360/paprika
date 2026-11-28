import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyRules,
  checkFrontendFile,
  checkStructure,
  checkUiFile,
  createsStoreAtModuleScope,
  diskEnvironment,
  frontendRules,
  networkRules,
  scan,
  sourceFiles,
  specifiers,
  uiRules,
  type Environment,
} from "@/test/architecture";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..");
const disk = diskEnvironment(srcDir);

const ids = (rules: Parameters<typeof applyRules>[1], source: string) => applyRules(scan(source), rules);

function virtual(files: Record<string, string>): Environment {
  const root = "/v/src";
  return { srcDir: root, read: (path) => files[path.replace(`${root}/`, "")] ?? null };
}

const frontendAt = (env: Environment, path: string, source: string, exceptions = {}) => checkFrontendFile(env, join(env.srcDir, path), source, exceptions);

describe("architecture: the real tree", () => {
  it("frontends obey the whitelist, the network rules and the visual rules", () => {
    const frontends = join(srcDir, "components", "frontends");
    expect(sourceFiles(frontends).length).toBeGreaterThan(10);
    const violations = sourceFiles(frontends).flatMap((file) => checkFrontendFile(disk, file, disk.read(file) as string));
    expect(violations).toEqual([]);
  });

  it("ui obeys its rules", () => {
    const violations = sourceFiles(join(srcDir, "components", "ui")).flatMap((file) => checkUiFile(disk, file, disk.read(file) as string));
    expect(violations).toEqual([]);
  });

  it("every frontend folder has an index.ts and its test", () => {
    expect(checkStructure(join(srcDir, "components", "frontends"))).toEqual([]);
  });
});

describe("architecture: scanner", () => {
  it("blanks comments and string contents in the code view and keeps strings in the text view", () => {
    const { code, text } = scan(`const a = "fetch(x)"; // fetch(y)\n/* fetch(z) */ const b = 'WebSocket';`);
    expect(code).not.toMatch(/fetch|WebSocket/);
    expect(text).toContain("fetch(x)");
    expect(text).not.toContain("fetch(y)");
    expect(text).not.toContain("fetch(z)");
  });

  it("reads code inside template expressions but not the template text", () => {
    const { code } = scan("const a = `fetch is ${fetch(u)} and ${`nested ${WebSocket}`}`;");
    expect(code.match(/fetch/g)).toHaveLength(1);
    expect(code).toContain("WebSocket");
  });

  it("extracts static, side-effect, re-export, dynamic and require specifiers", () => {
    const found = specifiers(
      scan(`import a from "a"; import { b } from 'b'; import "c"; export * from "d"; export { e } from "e";\nconst f = await import("f"); const g = await import(name); const h = require("h");\nimport type { T } from "i";\nimport {\n  j,\n  k,\n} from "j";`),
    ).map((entry) => entry.value);
    expect(found).toEqual(expect.arrayContaining(["a", "b", "c", "d", "e", "f", "<non-literal name>", "h", "i", "j"]));
  });

  it("ignores keywords that only appear inside string literals", () => {
    expect(specifiers(scan(`t("frontends.x.import");\nconst b = "c";`))).toEqual([]);
    expect(specifiers(scan(`const a = "import 'x'"; const b = "export y from 'z'"; const c = "require('w')"; const d = "import(v)";`))).toEqual([]);
    expect(specifiers(scan(`t("frontends.x.import");\nimport a from "real";`)).map((entry) => entry.value)).toEqual(["real"]);
  });

  it("ignores specifiers that only appear in comments", () => {
    expect(specifiers(scan(`// import x from "@tanstack/react-query"\nconst y = 1;`))).toEqual([]);
  });
});

describe("architecture: network rules", () => {
  const caught: [string, string][] = [
    ["fetch", "await fetch('/api')"],
    ["fetch", "const f = fetch; f(u)"],
    ["fetch", "fetch.call(null, u)"],
    ["fetch", "Reflect.apply(fetch, null, [u])"],
    ["fetch", "globalThis.fetch(u)"],
    ["fetch", "window.fetch ( u )"],
    ["fetch", "self.fetch(u)"],
    ["bracket fetch", "globalThis['fetch'](u)"],
    ["XMLHttpRequest", "new XMLHttpRequest()"],
    ["XMLHttpRequest", "new window.XMLHttpRequest()"],
    ["WebSocket", "new WebSocket(u)"],
    ["WebSocket", "const W = WebSocket; new W(u)"],
    ["EventSource", "new EventSource(u)"],
    ["WebTransport", "new WebTransport(u)"],
    ["RTCPeerConnection", "new RTCPeerConnection()"],
    ["Worker", "new Worker('https://x/w.js')"],
    ["Worker", "new SharedWorker(u)"],
    ["service worker", "navigator.serviceWorker.register(u)"],
    ["importScripts", "importScripts(u)"],
    ["sendBeacon", "navigator.sendBeacon(u)"],
    ["script element", "document.createElement('script')"],
    ["api(", "const r = await api(path)"],
  ];

  it.each(caught)("catches %s in %s", (id, source) => {
    expect(ids(networkRules, source)).toContain(id);
  });

  const allowed = [
    "type WebSocketState = 'open' | 'closed'",
    "const onFetchMore = () => undefined",
    "loader.fetch(id)",
    "prefetch(url)",
    "const label = 'fetch the data'",
    "// fetch(url)",
    "const w = new WorkerPool()",
    "props.onSendBeaconDone()",
    "const apiKey = 'x'",
    "helpers.api(x)",
    "navigator.language",
    "document.createElement('div')",
  ];

  it.each(allowed)("lets %s through", (source) => {
    expect(ids(networkRules, source)).toEqual([]);
  });
});

describe("architecture: frontend rules", () => {
  const caught: [string, string][] = [
    ["localStorage", "localStorage.getItem('a')"],
    ["localStorage", "window.localStorage.setItem('a', 'b')"],
    ["localStorage", "sessionStorage.clear()"],
    ["localStorage", "indexedDB.open('x')"],
    ["document.cookie", "document.cookie = 'a=b'"],
    ["location", "location.href = '/x'"],
    ["location", "window.location.assign('/x')"],
    ["location", "const url = document.location"],
    ["location", "location = '/x'"],
    ["location", "location.reload()"],
    ["history navigation", "history.pushState({}, '', '/x')"],
    ["window.open", "window.open(url)"],
    ["hex color", "const c = '#fff'"],
    ["hex color", "className=\"bg-[#1c91a1] p-2\""],
    ["hex color", "style={{ color: '#12345678' }}"],
    ["dark:", "className=\"bg-white dark:bg-black\""],
    ["dark:", "className=\"hover:dark:bg-black\""],
  ];

  it.each(caught)("catches %s in %s", (id, source) => {
    expect(ids(frontendRules, source)).toContain(id);
  });

  const allowed = [
    "const href = '#section'",
    "const anchor = 'a[href^=\"#\"]'",
    "// uses localStorage",
    "const handleLocation = (location: Place) => location.name",
    "const id = 'abc#12'",
    "window.matchMedia('(prefers-color-scheme: dark)')",
    "className=\"bg-bg text-fg forced-colors:bg-[CanvasText]\"",
    "const mode = 'dark'",
    "props.history.length",
    "const open = true",
  ];

  it.each(allowed)("lets %s through", (source) => {
    expect(ids(frontendRules, source)).toEqual([]);
  });

  it("applies the dark and storage rules to ui, where a hex value may be data", () => {
    expect(ids(uiRules, "const c = '#abc'")).toEqual([]);
    expect(ids(uiRules, "className=\"dark:bg-black\"")).toEqual(["dark:"]);
    expect(ids(uiRules, "localStorage.getItem('x')")).toEqual(["localStorage"]);
    expect(ids(uiRules, "className=\"bg-panel\"")).toEqual([]);
  });
});

describe("architecture: store at module scope", () => {
  it.each([
    "const store = createStore({ a: 1 });",
    "export const store = createStore<State>({ a: 1 });",
    "const store = new Store({ a: 1 });",
    "import { x } from 'y';\n\nconst a = 1;\nconst store = createStore(a, actions)\n",
  ])("flags %s", (source) => {
    expect(createsStoreAtModuleScope(scan(source))).toBe(true);
  });

  it.each([
    "export function make() { return createStore({ a: 1 }); }",
    "export const make = () => createStore({ a: 1 });",
    "const make = function () { return new Store(1); };",
    "function Provider() { const [s] = useState(() => createStore(1)); return s; }",
    "const note = 'createStore(1)';",
    "const store = useCreateStore({ a: 1 });",
  ])("lets %s through", (source) => {
    expect(createsStoreAtModuleScope(scan(source))).toBe(false);
  });
});

describe("architecture: imports of a frontend", () => {
  const env = virtual({
    "lib/utils.ts": `import { clsx } from "clsx";\nimport { twMerge } from "tailwind-merge";\nexport const cn = () => clsx(twMerge());`,
    "lib/persist.ts": `export const read = () => null;`,
    "lib/use-persisted-state.ts": `import { useState } from "react";\nimport { read } from "./persist";\nexport const x = useState(read);`,
    "lib/api.ts": `import { useQuery } from "@tanstack/react-query";\nexport const api = (p: string) => fetch(p);`,
    "lib/bad-reexport.ts": `export * from "./api";`,
    "lib/theme.ts": `export const t = 1;`,
    "lib/clean.ts": `import { helper } from "./helper";\nexport const c = helper;`,
    "lib/helper.ts": `export const helper = () => new WebSocket("wss://x");`,
  });

  const check = (source: string, path = "components/frontends/demo/demo.tsx", exceptions = {}) => frontendAt(env, path, source, exceptions);

  it.each([
    `import { useState } from "react";`,
    `import { useTranslation } from "react-i18next";`,
    `import { useSelector } from "@tanstack/react-store";`,
    `import { useVirtualizer } from "@tanstack/react-virtual";`,
    `import { Layers } from "lucide-react";`,
    `import { Resizable } from "@ui-sdk/react/resizable";`,
    `import type { Document } from "@paprika/core";`,
    `import { Button } from "@/components/ui/button";`,
    `import { Button } from "../../ui/button";`,
    `import { cn } from "@/lib/utils";`,
    `import { read } from "@/lib/persist";`,
    `import { x } from "@/lib/use-persisted-state";`,
    `import { createRegion } from "../_shared";`,
    `import { createRegion } from "@/components/frontends/_shared";`,
    `import { Row } from "./row";`,
    `import { Row } from "@/components/frontends/demo/row";`,
    `import i18n from "@/i18n";`,
    `import { languages } from "@/i18n/resources";`,
    `import { bindDrag } from "@ui-sdk/core";`,
    `import { Resizable } from "@ui-sdk/core/resizable";`,
    `import type { AppT } from "@/i18n/resources";`,
    `t("frontends.x.import");\nconst b = "c";`,
  ])("accepts %s", (source) => {
    expect(check(source)).toEqual([]);
  });

  it.each([
    [`import { useQuery } from "@tanstack/react-query";`, "package @tanstack/react-query"],
    [`import { useLiveQuery } from "@tanstack/react-db";`, "package @tanstack/react-db"],
    [`import { Link } from "@tanstack/react-router";`, "package @tanstack/react-router"],
    [`import { createServerFn } from "@tanstack/react-start";`, "package @tanstack/react-start"],
    [`import axios from "axios";`, "package axios"],
    [`import "@ui-sdk/core/web.css";`, "package @ui-sdk/core/web.css"],
    [`import { api } from "@/lib/api";`, "lib module not allowed (@/lib/api)"],
    [`import { t } from "@/lib/theme";`, "lib module not allowed (@/lib/theme)"],
    [`import { router } from "@/router";`, "import @/router"],
    [`import { Route } from "@/routes/index";`, "import @/routes/index"],
    [`import x from "../../../../apps/site/src/api";`, "import ../../../../apps/site/src/api"],
    [`import { Other } from "../other";`, "import between frontends (../other)"],
    [`import { Other } from "@/components/frontends/other";`, "import between frontends (@/components/frontends/other)"],
    [`import { Other } from "../other/other";`, "import between frontends (../other/other)"],
    [`const m = await import("@tanstack/react-query");`, "package @tanstack/react-query"],
    [`import { x } from "@ui-sdk/core/internal/x";`, "package @ui-sdk/core/internal/x"],
    [`import { x } from "@ui-sdk/react/internal/x";`, "package @ui-sdk/react/internal/x"],
    [`import i18n from "i18next";\ni18n.changeLanguage("en");`, "package i18next"],
    [`import type { TFunction } from "i18next";`, "package i18next"],
    [`const m = await import(name);`, "dynamic import with a computed specifier"],
    [`const m = await import("./" + name);`, "dynamic import with a computed specifier"],
  ])("rejects %s", (source, reason) => {
    expect(check(source).map((line) => line.split(": ").slice(1).join(": "))).toContain(reason);
  });

  it("follows the allowed lib modules transitively and reports the chain", () => {
    const withApi = virtual({
      "lib/utils.ts": `import { api } from "./api";\nexport const cn = api;`,
      "lib/api.ts": `import { useQuery } from "@tanstack/react-query";\nexport const api = () => fetch("/x");`,
    });
    const found = frontendAt(withApi, "components/frontends/demo/demo.tsx", `import { cn } from "@/lib/utils";`);
    expect(found).toEqual(
      expect.arrayContaining([
        "components/frontends/demo/demo.tsx -> lib/utils -> lib/api: package @tanstack/react-query",
        "components/frontends/demo/demo.tsx -> lib/utils -> lib/api: fetch",
      ]),
    );
  });

  it("follows a lib module that only re-exports a bad one", () => {
    const reexport = virtual({
      "lib/persist.ts": `export * from "./api";`,
      "lib/api.ts": `export const api = () => new EventSource("/x");`,
    });
    expect(frontendAt(reexport, "components/frontends/demo/demo.tsx", `import { read } from "@/lib/persist";`)).toEqual([
      "components/frontends/demo/demo.tsx -> lib/persist -> lib/api: EventSource",
    ]);
  });

  it("does not loop on circular lib imports", () => {
    const circular = virtual({
      "lib/utils.ts": `import { a } from "./persist";\nexport const cn = a;`,
      "lib/persist.ts": `import { cn } from "./utils";\nexport const a = cn;`,
    });
    expect(frontendAt(circular, "components/frontends/demo/demo.tsx", `import { cn } from "@/lib/utils";`)).toEqual([]);
  });

  it("applies the network rules to the file itself", () => {
    expect(check(`const r = await fetch("/x");`)).toEqual(["components/frontends/demo/demo.tsx: fetch"]);
  });

  it("applies the visual and storage rules to non-test files only", () => {
    const source = `const c = "#fff"; localStorage.getItem("a");`;
    expect(check(source)).toEqual(["components/frontends/demo/demo.tsx: localStorage", "components/frontends/demo/demo.tsx: hex color"]);
    expect(check(source, "components/frontends/demo/demo.test.tsx")).toEqual([]);
  });

  it("rejects a store created at module scope in a frontend", () => {
    expect(check(`import { createStore } from "@tanstack/react-store";\nconst s = createStore(1);`)).toEqual([
      "components/frontends/demo/demo.tsx: store created at module scope",
    ]);
  });

  it("lets tests use testing libraries but not network calls, except by an explicit exception", () => {
    const testPath = "components/frontends/demo/demo.test.tsx";
    expect(check(`import { render } from "@testing-library/react";\nimport { vi } from "vitest";`, testPath)).toEqual([]);
    expect(check(`import { render } from "@testing-library/react";\nvi.stubGlobal("fetch", 1); await fetch("/x");`, testPath)).toEqual([`${testPath}: fetch`]);
    expect(check(`await fetch("/x");`, testPath, { [testPath]: ["fetch"] })).toEqual([]);
    expect(check(`import { x } from "@testing-library/react";`)).toEqual(["components/frontends/demo/demo.tsx: package @testing-library/react"]);
  });
});

describe("architecture: ui", () => {
  const env = virtual({});
  const check = (source: string) => checkUiFile(env, join(env.srcDir, "components/ui/demo.tsx"), source).map((line) => line.split(": ").slice(1).join(": "));

  it.each([
    [`import { X } from "@/components/frontends/pages-panel";`, "import @/components/frontends/pages-panel"],
    [`import { X } from "../frontends/_shared";`, "import ../frontends/_shared"],
    [`import { useTranslation } from "react-i18next";`, "package react-i18next"],
    [`import i18n from "@/i18n";`, "import @/i18n"],
    [`import { useRouter } from "@tanstack/react-router";`, "package @tanstack/react-router"],
    [`import { useSelector } from "@tanstack/react-store";`, "package @tanstack/react-store"],
    [`import { useQuery } from "@tanstack/react-query";`, "package @tanstack/react-query"],
    [`import { readPersisted } from "@/lib/persist";`, "import @/lib/persist"],
    [`import { readPersisted } from "../../lib/persist";`, "import ../../lib/persist"],
    [`import { usePersistedState } from "@/lib/use-persisted-state";`, "import @/lib/use-persisted-state"],
    [`import "@ui-sdk/core/web.css";`, "package @ui-sdk/core/web.css"],
    [`await fetch("/x");`, "fetch"],
    [`localStorage.getItem("x");`, "localStorage"],
  ])("rejects %s", (source, reason) => {
    expect(check(source)).toContain(reason);
  });

  it.each([`import { cn } from "@/lib/utils";`, `import { Button } from "./button";`, `import { Tooltip } from "@ui-sdk/react/tooltip";`, `import { Layers } from "lucide-react";`])(
    "accepts %s",
    (source) => {
      expect(check(source)).toEqual([]);
    },
  );
});

describe("architecture: folder structure", () => {
  function tree(files: Record<string, string[]>) {
    const root = mkdtempSync(join(tmpdir(), "frontends-"));
    for (const [folder, names] of Object.entries(files)) {
      mkdirSync(join(root, folder), { recursive: true });
      for (const name of names) writeFileSync(join(root, folder, name), "");
    }
    return root;
  }

  it("accepts a folder with an index and its test, and _shared with any test", () => {
    const root = tree({ demo: ["index.ts", "demo.test.tsx", "demo.tsx"], _shared: ["index.ts", "region.test.tsx"] });
    try {
      expect(checkStructure(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true });
    }
  });

  it("flags a missing index.ts, a missing test, a misnamed test and loose files", () => {
    const root = tree({ noindex: ["noindex.test.tsx"], notest: ["index.ts"], misnamed: ["index.ts", "other.test.tsx"], _shared: ["index.ts"] });
    writeFileSync(join(root, "loose.ts"), "");
    try {
      expect(checkStructure(root).sort()).toEqual(
        [
          "_shared: missing test",
          "loose.ts: loose file in frontends",
          "misnamed: missing misnamed.test.tsx",
          "noindex: missing index.ts",
          "notest: missing notest.test.tsx",
        ].sort(),
      );
    } finally {
      rmSync(root, { recursive: true });
    }
  });
});
