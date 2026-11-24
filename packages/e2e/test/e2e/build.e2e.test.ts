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
      const world = document.querySelector(".world");
      const log: { id: string | null; phase: string | null; bg: string }[] = [];
      (window as unknown as { __build: typeof log }).__build = log;
      if (!world) return;
      const mo = new MutationObserver((records) => {
        for (const rec of records) {
          const el = rec.target as HTMLElement;
          const phase = el.getAttribute?.("data-build");
          if (!phase) continue;
          log.push({ id: el.getAttribute("data-paprika-id"), phase, bg: getComputedStyle(el).backgroundColor });
        }
      });
      mo.observe(world, { attributes: true, subtree: true, attributeFilter: ["data-build"] });
    });
  }, 60_000);

  afterAll(async () => {
    await closeSeededCanvas(session, clients);
  });

  it("mostra o rótulo, o replay e o código sem segurar o documento", async () => {
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

    await expect.poll(async () => {
      const log = await page.evaluate(() => (window as unknown as { __build: { id: string | null; phase: string | null; bg: string }[] }).__build);
      const current = log.filter((row) => row.id === "build-a" && row.phase === "current");
      const waiting = log.some((row) => row.id === "build-c" && row.phase === "wait");
      if (!current.length || !waiting) return "pending";
      return current.some((row) => row.bg === "rgba(0, 0, 0, 0)" || row.bg === "transparent") ? "blank" : "solid";
    }).toBe("blank");

    const toggle = page.getByTestId("build-code-toggle");
    await expect.poll(() => toggle.getAttribute("aria-pressed")).toBe("false");
    await expect.poll(() => page.getByTestId("build-code").count()).toBe(0);
    await toggle.click();
    await expect.poll(() => page.getByTestId("build-code").innerText()).toContain("BuildLiveRow");
    await expect.poll(() => page.locator('[data-paprika-id="build-screen"]').count()).toBe(1);
  });

  it("com movimento reduzido o contorno não esvazia o preenchimento", async () => {
    await page.evaluate(() => {
      (window as unknown as { __build: unknown[] }).__build.length = 0;
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const writer = await connectAgent(session.url, "e2e-build-still", clients);
    await callTool(writer, "create_nodes", {
      parentId: "build-screen",
      nodes: [{ type: "rect", id: "build-d", x: 16, y: 140, width: 200, height: 28, fill: "#3b82f6" }],
    });
    await expect.poll(async () => {
      const log = await page.evaluate(() => (window as unknown as { __build: { id: string | null; phase: string | null; bg: string }[] }).__build);
      const current = log.find((row) => row.id === "build-d" && row.phase === "current");
      if (!current) return "pending";
      return current.bg === "rgba(0, 0, 0, 0)" || current.bg === "transparent" ? "blank" : "solid";
    }).toBe("solid");
  });
});
