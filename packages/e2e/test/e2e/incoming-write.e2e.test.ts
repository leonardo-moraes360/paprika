import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { startServer, type ExternalServer } from "../harness.js";
import { webDist } from "./seededCanvas.js";
import { pinLocale } from "./locale.js";
import { mcp } from "../perf/helpers.js";
import { buildWorstCase, type WorstCase, type WorstCaseOptions } from "../perf/synthetic.js";

interface Probe {
  renders: number;
  lint: { posts: number; resets: number; patchedNodes: number };
}

describe.skipIf(!existsSync(webDist))("E2E: incoming write cost does not scale with the document", { timeout: 240_000 }, () => {
  let dir: string;
  let browser: Browser;
  const servers: ExternalServer[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "paprika-incoming-"));
    browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
  });

  afterAll(async () => {
    await browser?.close();
    for (const s of servers) await s.stop();
    await rm(dir, { recursive: true, force: true });
  });

  const probe = (page: Page) =>
    page.evaluate(
      () =>
        ({
          renders: (document.querySelector(".world") as unknown as { __paprikaNodeRenders: number }).__paprikaNodeRenders,
          lint: (window as unknown as { __paprikaLint: Probe["lint"] }).__paprikaLint,
        }) satisfies Probe,
    );

  const plainText = (worst: WorstCase) =>
    worst.textIds.find((id) => {
      for (let n = worst.doc.nodes[id] as Record<string, unknown> | undefined; n; n = worst.doc.nodes[n.parentId as string] as Record<string, unknown> | undefined) if (n.component) return false;
      return true;
    })!;

  const run = async (opts: WorstCaseOptions, name: string) => {
    const worst = buildWorstCase({ ...opts, id: name });
    const file = join(dir, `${name}.paprika.json`);
    await writeFile(file, JSON.stringify(worst.doc));
    const srv = await startServer({ seed: file, webRoot: webDist });
    servers.push(srv);
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await pinLocale(page, "pt-BR");
    await page.goto(`${srv.url}/w/${worst.doc.id}`);
    await page.waitForSelector(".world [data-paprika-id]", { timeout: 120_000 });
    await page.waitForTimeout(2500);
    await page.waitForFunction(() => (window as unknown as { __paprikaLint?: { posts: number } }).__paprikaLint!.posts > 0);
    const id = plainText(worst);
    await mcp(srv.url, "update_nodes", { updates: [{ id, props: { opacity: 0.9 } }] });
    await page.waitForFunction(() => (window as unknown as { __paprikaLint: { patchedNodes: number } }).__paprikaLint.patchedNodes > 0 || (window as unknown as { __paprikaLint: { resets: number } }).__paprikaLint.resets > 1, undefined, { timeout: 30_000 });
    await page.waitForTimeout(2500);
    const before = await probe(page);
    await mcp(srv.url, "update_nodes", { updates: [{ id, props: { opacity: 0.7 } }] });
    await page.waitForFunction((n) => (window as unknown as { __paprikaLint: { patchedNodes: number } }).__paprikaLint.patchedNodes > n, before.lint.patchedNodes, { timeout: 30_000 });
    await page.waitForTimeout(1500);
    const after = await probe(page);
    const nodes = Object.keys(worst.doc.nodes).length;
    return { page, srv, id, nodes, renders: after.renders - before.renders, patched: after.lint.patchedNodes - before.lint.patchedNodes, resets: after.lint.resets - before.lint.resets };
  };

  it("renders a constant number of canvas nodes and ships one node to the lint worker, on a small and a large document", async () => {
    const small = await run({ pages: 2, totalNodes: 400, heavyNodes: 200, instances: 10 }, "incsmall01");
    const large = await run({ pages: 5, totalNodes: 9000, heavyNodes: 3500, instances: 300 }, "inclarge01");
    expect(large.nodes).toBeGreaterThan(8000);
    expect(small.patched).toBe(1);
    expect(large.patched).toBe(1);
    expect(small.resets).toBe(0);
    expect(large.resets).toBe(0);
    expect(small.renders).toBeLessThanOrEqual(8);
    expect(large.renders).toBeLessThanOrEqual(small.renders + 1);
    await small.page.close();
    await large.page.close();
  });

  it("still reports the review issues, now computed off the main thread", async () => {
    const run1 = await run({ pages: 2, totalNodes: 400, heavyNodes: 200, instances: 10 }, "incissue01");
    await mcp(run1.srv.url, "update_nodes", { updates: [{ id: run1.id, props: { fontSize: 6 } }] });
    const section = run1.page.locator('[data-testid="inspector-section-review"]');
    await expect.poll(async () => (await section.innerText()).replace(/\D+/g, ""), { timeout: 15_000 }).toMatch(/^[1-9]\d*$/);
    await run1.page.close();
  });
});
