import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

type Rule = { name: string; pattern: RegExp };

const specifier = (names: string) => new RegExp(`["'\`](?:${names})(?:/[^"'\`]*)?["'\`]`);

const frontendRules: Rule[] = [
  { name: "fetch(", pattern: /(?<![\w$])fetch\s*\(/ },
  { name: "XMLHttpRequest", pattern: /XMLHttpRequest/ },
  { name: "WebSocket", pattern: /WebSocket/ },
  { name: "EventSource", pattern: /EventSource/ },
  { name: "sendBeacon", pattern: /sendBeacon/ },
  { name: "TanStack Query", pattern: specifier("@tanstack/react-query|@tanstack/query-core") },
  { name: "TanStack DB", pattern: specifier("@tanstack/react-db|@tanstack/db") },
  { name: "TanStack Router or Start", pattern: specifier("@tanstack/react-router|@tanstack/router-core|@tanstack/react-start") },
  { name: "web-legacy", pattern: /["'`][^"'`]*web-legacy[^"'`]*["'`]/ },
];

const uiRules: Rule[] = [
  { name: "frontends", pattern: /["'`][^"'`]*\/frontends(?:\/[^"'`]*)?["'`]/ },
  { name: "i18n", pattern: specifier("i18next|react-i18next|i18next-browser-languagedetector|@/i18n") },
  { name: "router", pattern: specifier("@tanstack/react-router|@tanstack/router-core|@tanstack/react-start") },
  { name: "store", pattern: specifier("@tanstack/react-store|@tanstack/store") },
  { name: "query", pattern: specifier("@tanstack/react-query|@tanstack/query-core|@tanstack/react-db|@tanstack/db") },
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function violations(files: string[], rules: Rule[]) {
  return files.flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return rules.filter((rule) => rule.pattern.test(text)).map((rule) => `${relative(here, file)}: ${rule.name}`);
  });
}

function matches(rules: Rule[], text: string) {
  return rules.filter((rule) => rule.pattern.test(text)).map((rule) => rule.name);
}

describe("architecture: components/frontends", () => {
  it("has no network access, data layers, router or web-legacy imports", () => {
    expect(violations(sources(join(here, "frontends")), frontendRules)).toEqual([]);
  });

  it("the rules catch what they are meant to catch", () => {
    expect(matches(frontendRules, "await fetch('/api')")).toEqual(["fetch("]);
    expect(matches(frontendRules, "window.fetch ( url )")).toEqual(["fetch("]);
    expect(matches(frontendRules, "prefetch(url)")).toEqual([]);
    expect(matches(frontendRules, "new XMLHttpRequest()")).toEqual(["XMLHttpRequest"]);
    expect(matches(frontendRules, "new WebSocket(u)")).toEqual(["WebSocket"]);
    expect(matches(frontendRules, "new EventSource(u)")).toEqual(["EventSource"]);
    expect(matches(frontendRules, "navigator.sendBeacon(u)")).toEqual(["sendBeacon"]);
    expect(matches(frontendRules, `import { useQuery } from "@tanstack/react-query"`)).toEqual(["TanStack Query"]);
    expect(matches(frontendRules, `const m = await import('@tanstack/react-db')`)).toEqual(["TanStack DB"]);
    expect(matches(frontendRules, `import { Link } from "@tanstack/react-router"`)).toEqual(["TanStack Router or Start"]);
    expect(matches(frontendRules, `import { x } from "../../../../web-legacy/src/api"`)).toEqual(["web-legacy"]);
    expect(matches(frontendRules, `import { createStore } from "@tanstack/react-store"`)).toEqual([]);
    expect(matches(frontendRules, `import { useVirtualizer } from "@tanstack/react-virtual"`)).toEqual([]);
  });
});

describe("architecture: components/ui", () => {
  it("does not depend on frontends, i18n, router, store or query", () => {
    expect(violations(sources(join(here, "ui")), uiRules)).toEqual([]);
  });

  it("the rules catch what they are meant to catch", () => {
    expect(matches(uiRules, `import { X } from "@/components/frontends/side-panel"`)).toEqual(["frontends"]);
    expect(matches(uiRules, `import { X } from "../frontends/_shared"`)).toEqual(["frontends"]);
    expect(matches(uiRules, `import { useTranslation } from "react-i18next"`)).toEqual(["i18n"]);
    expect(matches(uiRules, `import i18n from "@/i18n"`)).toEqual(["i18n"]);
    expect(matches(uiRules, `import { useRouter } from "@tanstack/react-router"`)).toEqual(["router"]);
    expect(matches(uiRules, `import { useSelector } from "@tanstack/react-store"`)).toEqual(["store"]);
    expect(matches(uiRules, `import { useQuery } from "@tanstack/react-query"`)).toEqual(["query"]);
    expect(matches(uiRules, `import { cn } from "@/lib/utils"`)).toEqual([]);
  });
});
