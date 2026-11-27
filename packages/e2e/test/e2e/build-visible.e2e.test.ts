import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import type { Page } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { callTool, closeSeededCanvas, connectAgent, openSeededCanvas, webDist, type CanvasSession } from "./seededCanvas.js";

const FILLS = ["#e11d48", "#2563eb", "#16a34a", "#d97706"];
const RGB = ["rgb(225, 29, 72)", "rgb(37, 99, 235)", "rgb(22, 163, 74)", "rgb(217, 119, 6)"];

function frame(prefix: string, x: number, y: number, count: number) {
  const kids = Array.from({ length: count - 1 }, (_, i) =>
    i % 10 === 9
      ? { type: "text", id: `${prefix}-${i}`, text: `T${i}`, width: 40, height: 20, fontSize: 12, color: "#e11d48" }
      : { type: "rect", id: `${prefix}-${i}`, width: 20, height: 20, fill: FILLS[i % FILLS.length] },
  );
  return {
    type: "frame",
    id: prefix,
    name: prefix,
    x,
    y,
    width: 640,
    height: 360,
    fill: "#ffffff",
    layout: { mode: "row", wrap: true, gap: 4, padding: 8 },
    children: kids,
  };
}

type Probe = { missing: number; hidden: number; unstyled: number };

async function probe(page: Page, prefix: string, count: number): Promise<Probe> {
  return page.evaluate(
    ([p, n, rgb]) => {
      let missing = 0;
      let hidden = 0;
      let unstyled = 0;
      const ids = [p as string, ...Array.from({ length: (n as number) - 1 }, (_, i) => `${p}-${i}`)];
      ids.forEach((id, k) => {
        const el = document.querySelector<HTMLElement>(`[data-testid="canvas-world"] [data-paprika-id="${id}"]`);
        if (!el) {
          missing++;
          return;
        }
        const cs = getComputedStyle(el);
        if (cs.opacity !== "1" || cs.visibility === "hidden") hidden++;
        if (k === 0) {
          if (cs.backgroundColor !== "rgb(255, 255, 255)") unstyled++;
          return;
        }
        const i = k - 1;
        if (i % 10 === 9) {
          if (cs.color !== "rgb(225, 29, 72)") unstyled++;
        } else if (cs.backgroundColor !== (rgb as string[])[i % 4]) unstyled++;
      });
      return { missing, hidden, unstyled };
    },
    [prefix, count, RGB] as const,
  );
}

const allVisible = (p: Probe) => p.missing === 0 && p.hidden === 0 && p.unstyled === 0;

describe.skipIf(!existsSync(webDist))("E2E: o que o agente cria aparece de uma vez", () => {
  let session!: CanvasSession;
  let page: Page;
  const clients: Client[] = [];

  beforeAll(async () => {
    session = await openSeededCanvas("paprika-build-visible-");
    page = session.page;
    await page.evaluate(() => {
      const w = window as unknown as { __walk: { id: string; at: number }[] };
      w.__walk = [];
      const world = document.querySelector('[data-testid="canvas-world"]');
      if (!world) return;
      new MutationObserver((records) => {
        for (const rec of records) {
          const el = rec.target as HTMLElement;
          if (el.getAttribute?.("data-build") === "current") w.__walk.push({ id: el.getAttribute("data-paprika-id") ?? "", at: performance.now() });
        }
      }).observe(world, { attributes: true, subtree: true, attributeFilter: ["data-build"] });
    });
  }, 60_000);

  afterAll(async () => {
    await closeSeededCanvas(session, clients);
  });

  const walk = () => page.evaluate(() => (window as unknown as { __walk: { id: string; at: number }[] }).__walk);
  const clearWalk = () => page.evaluate(() => ((window as unknown as { __walk: unknown[] }).__walk.length = 0));

  it("200 nós ficam visíveis e com o estilo final em 1 s, e o contorno termina em cerca de 2 s", async () => {
    await clearWalk();
    const writer = await connectAgent(session.url, "e2e-visible-a", clients);
    await callTool(writer, "create_nodes", { nodes: [frame("vis", 1200, 0, 200)] });
    const t0 = Date.now();
    await expect
      .poll(() => probe(page, "vis", 200), { interval: 25, timeout: 5000 })
      .toSatisfy(allVisible);
    const visibleMs = Date.now() - t0;
    expect(visibleMs).toBeLessThan(1000);
    expect(await probe(page, "vis", 200)).toEqual({ missing: 0, hidden: 0, unstyled: 0 });

    await expect.poll(async () => (await walk()).length, { timeout: 3000 }).toBeGreaterThan(5);
    const sawWait = await page.evaluate(() => document.querySelectorAll('[data-build="wait"],[data-build="shown"]').length);
    expect(sawWait).toBe(0);
    await expect.poll(() => page.locator("[data-build]").count(), { interval: 50, timeout: 4000 }).toBe(0);
    const doneMs = Date.now() - t0;
    expect(doneMs).toBeLessThan(2600);
    const steps = await walk();
    expect(steps.length).toBeGreaterThanOrEqual(25);
    expect(steps.length).toBeLessThanOrEqual(60);
    expect(steps[0]!.id.startsWith("vis")).toBe(true);
  });

  it("com movimento reduzido não há passeio, só o estado final", async () => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await clearWalk();
    const writer = await connectAgent(session.url, "e2e-visible-still", clients);
    await callTool(writer, "create_nodes", { nodes: [frame("still", 1200, 400, 200)] });
    const t0 = Date.now();
    await expect.poll(() => probe(page, "still", 200), { interval: 25, timeout: 5000 }).toSatisfy(allVisible);
    expect(Date.now() - t0).toBeLessThan(1000);
    await page.waitForTimeout(800);
    expect(await walk()).toEqual([]);
    expect(await page.locator("[data-build]").count()).toBe(0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
  });

  it("dois agentes escrevendo ao mesmo tempo não atrasam os nós um do outro nem o passeio", async () => {
    await clearWalk();
    const a = await connectAgent(session.url, "e2e-visible-b1", clients);
    const b = await connectAgent(session.url, "e2e-visible-b2", clients);
    const done: Record<string, number> = {};
    await Promise.all([
      callTool(a, "create_nodes", { nodes: [frame("dua", 1900, 0, 200)] }),
      callTool(b, "create_nodes", { nodes: [frame("dub", 1900, 400, 200)] }),
    ]);
    const t0 = Date.now();
    await Promise.all(
      (["dua", "dub"] as const).map(async (p) => {
        await expect.poll(() => probe(page, p, 200), { interval: 25, timeout: 5000 }).toSatisfy(allVisible);
        done[p] = Date.now() - t0;
      }),
    );
    expect(done.dua).toBeLessThan(1000);
    expect(done.dub).toBeLessThan(1000);
    await expect.poll(async () => new Set((await walk()).map((s) => s.id.slice(0, 3))).size, { timeout: 3000 }).toBe(2);
    const steps = await walk();
    const firstA = steps.find((s) => s.id.startsWith("dua"))!.at;
    const firstB = steps.find((s) => s.id.startsWith("dub"))!.at;
    expect(Math.abs(firstA - firstB)).toBeLessThan(500);
    await expect.poll(() => page.locator("[data-build]").count(), { interval: 50, timeout: 4000 }).toBe(0);
    expect(Date.now() - t0).toBeLessThan(2800);
  });

  it("uma escrita nova não espera atrás do passeio da anterior", async () => {
    await clearWalk();
    const a = await connectAgent(session.url, "e2e-visible-c1", clients);
    const b = await connectAgent(session.url, "e2e-visible-c2", clients);
    await callTool(a, "create_nodes", { nodes: [frame("qua", 1200, 800, 200)] });
    await expect.poll(async () => (await walk()).length, { timeout: 3000 }).toBeGreaterThan(3);
    await callTool(b, "create_nodes", { nodes: [frame("qub", 1900, 800, 20)] });
    const t1 = Date.now();
    await expect.poll(() => probe(page, "qub", 20), { interval: 25, timeout: 3000 }).toSatisfy(allVisible);
    expect(Date.now() - t1).toBeLessThan(1000);
    await expect.poll(async () => (await walk()).some((s) => s.id.startsWith("qub")), { timeout: 1500 }).toBe(true);
    await expect.poll(() => page.locator("[data-build]").count(), { interval: 50, timeout: 4000 }).toBe(0);
    expect(Date.now() - t1).toBeLessThan(2600);
  });
});
