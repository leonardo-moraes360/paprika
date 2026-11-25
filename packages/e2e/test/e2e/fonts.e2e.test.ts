import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { callTool, closeSeededCanvas, connectAgent, openSeededCanvas, webDist, type CanvasSession } from "./seededCanvas.js";

const built = existsSync(webDist);

describe.skipIf(!built)("canvas fonts", () => {
  let session: CanvasSession;
  const clients: Client[] = [];

  beforeAll(async () => {
    session = await openSeededCanvas("paprika-fonts-");
  }, 60_000);

  afterAll(async () => {
    await closeSeededCanvas(session, clients);
  });

  it("gives a bare family a generic fallback and loads the embedded Inter", async () => {
    const writer = await connectAgent(session.url, "e2e-fonts", clients);
    await callTool(writer, "create_nodes", {
      nodes: [
        {
          type: "frame",
          id: "font-card",
          x: 900,
          y: 40,
          width: 240,
          height: 80,
          fill: "#ffffff",
          children: [
            { type: "text", id: "font-inter", text: "Inter text", x: 16, y: 16, width: 200, height: 24, fontFamily: "Inter", fontSize: 16, color: "#141827" },
            { type: "text", id: "font-semi", text: "Semi text", x: 16, y: 44, width: 200, height: 24, fontFamily: "Inter", fontSize: 16, fontWeight: 600, color: "#141827" },
          ],
        },
      ],
    });
    const { page } = session;
    await page.waitForSelector('[data-paprika-id="font-inter"]');
    const family = await page.evaluate(() => getComputedStyle(document.querySelector('[data-paprika-id="font-inter"]')!).fontFamily);
    expect(family).toMatch(/Inter/);
    expect(family).toMatch(/(^|,\s*)(sans-serif|serif|monospace)\s*$/);

    const loaded = await page.evaluate(async () => {
      await Promise.all([document.fonts.load("400 16px Inter"), document.fonts.load("600 16px Inter")]);
      return [...document.fonts].filter((f) => f.family.replace(/"/g, "") === "Inter" && f.status === "loaded").map((f) => f.weight);
    });
    expect(loaded.length).toBeGreaterThanOrEqual(2);
    expect(await page.evaluate(() => document.fonts.check("600 16px Inter"))).toBe(true);
  });
});
