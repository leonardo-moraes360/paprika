import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import type { Page } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { callTool, closeSeededCanvas, connectAgent, openSeededCanvas, webDist, type CanvasSession } from "./seededCanvas.js";

describe.skipIf(!existsSync(webDist))("E2E: construção ao vivo", () => {
  let session!: CanvasSession;
  let page: Page;
  const clients: Client[] = [];

  beforeAll(async () => {
    session = await openSeededCanvas("paprika-build-");
    page = session.page;
    await page.evaluate(() => {
      const world = document.querySelector('[data-testid="canvas-world"]');
      const log: { id: string | null; phase: string | null; bg: string; opacity: string }[] = [];
      (window as unknown as { __build: typeof log }).__build = log;
      if (!world) return;
      const mo = new MutationObserver((records) => {
        for (const rec of records) {
          const el = rec.target as HTMLElement;
          const phase = el.getAttribute?.("data-build");
          if (!phase) continue;
          const cs = getComputedStyle(el);
          log.push({ id: el.getAttribute("data-paprika-id"), phase, bg: cs.backgroundColor, opacity: cs.opacity });
        }
      });
      mo.observe(world, { attributes: true, subtree: true, attributeFilter: ["data-build"] });
    });
  }, 60_000);

  afterAll(async () => {
    await closeSeededCanvas(session, clients);
  });

  type Row = { id: string | null; phase: string | null; bg: string; opacity: string };
  const rows = () => page.evaluate(() => (window as unknown as { __build: Row[] }).__build);

  it("mostra o rótulo, o contorno e o código sem esconder nenhum nó", async () => {
    const writer = await connectAgent(session.url, "e2e-build", clients);
    await callTool(writer, "create_nodes", {
      nodes: [
        {
          type: "frame",
          id: "build-screen",
          name: "Build live",
          x: 900,
          y: 40,
          width: 240,
          height: 280,
          fill: "#ffffff",
          children: [
            { type: "rect", id: "build-a", x: 16, y: 16, width: 200, height: 28, fill: "#3b82f6" },
            { type: "text", id: "build-b", text: "BuildLiveRow", x: 16, y: 56, width: 200, height: 24, fontSize: 14, color: "#141827" },
            { type: "rect", id: "build-c", x: 16, y: 96, width: 200, height: 28, fill: "#10b981" },
          ],
        },
      ],
    });

    await expect.poll(() => page.locator('[data-paprika-id="build-c"]').count()).toBe(1);
    const label = page.getByTestId("agent-working");
    await expect.poll(() => label.count()).toBeGreaterThan(0);
    await expect.poll(() => label.first().innerText()).toMatch(/trabalhando/);

    const solid = async (id: string) =>
      page.locator(`[data-paprika-id="${id}"]`).evaluate((el) => {
        const cs = getComputedStyle(el);
        return { opacity: cs.opacity, bg: cs.backgroundColor };
      });
    expect(await solid("build-c")).toEqual({ opacity: "1", bg: "rgb(16, 185, 129)" });
    expect(await solid("build-a")).toEqual({ opacity: "1", bg: "rgb(59, 130, 246)" });
    await expect.poll(async () => (await rows()).some((row) => row.id === "build-a" && row.phase === "current")).toBe(true);
    await expect.poll(() => page.locator("[data-build]").count()).toBe(0);
    const seen = await rows();
    expect(seen.map((row) => row.phase)).not.toContain("wait");
    expect(seen.map((row) => row.phase)).not.toContain("shown");
    expect(seen.filter((row) => row.id === "build-a" || row.id === "build-c").every((row) => row.opacity === "1" && row.bg !== "rgba(0, 0, 0, 0)" && row.bg !== "transparent")).toBe(true);
  });

  // PAP-E2E: o app novo não tem o botão "código" do replay (BuildCode do antigo mostrava o exportReact do frame em construção)
  it.fails("o botão de código mostra o JSX do frame que o agente constrói", async () => {
    const toggle = page.getByTestId("build-code-toggle");
    await expect.poll(() => toggle.getAttribute("aria-pressed"), { timeout: 3000 }).toBe("false");
    await expect.poll(() => page.getByTestId("build-code").count()).toBe(0);
    await toggle.click({ timeout: 3000 });
    await expect.poll(() => page.getByTestId("build-code").innerText()).toContain("BuildLiveRow");
    await expect.poll(() => page.locator('[data-paprika-id="build-screen"]').count()).toBe(1);
  });

  it("com movimento reduzido não há contorno nem passeio, só o estado final", async () => {
    await page.evaluate(() => {
      (window as unknown as { __build: unknown[] }).__build.length = 0;
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const writer = await connectAgent(session.url, "e2e-build-still", clients);
    await callTool(writer, "create_nodes", {
      parentId: "build-screen",
      nodes: [{ type: "rect", id: "build-d", x: 16, y: 140, width: 200, height: 28, fill: "#3b82f6" }],
    });
    await expect.poll(() => page.locator('[data-paprika-id="build-d"]').count()).toBe(1);
    await expect
      .poll(() => page.locator('[data-paprika-id="build-d"]').evaluate((el) => getComputedStyle(el).backgroundColor))
      .toBe("rgb(59, 130, 246)");
    await page.waitForTimeout(600);
    expect(await rows()).toEqual([]);
    expect(await page.locator("[data-build]").count()).toBe(0);
  });
});
