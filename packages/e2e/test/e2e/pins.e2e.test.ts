import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { repoRoot, startServer, waitFor, type ExternalServer } from "../harness.js";
import { pinLocale } from "./locale.js";

const webRoot = join(repoRoot, "apps/web/dist");
const NODE = '[data-paprika-id="plano"]';

type Pin = { id: string; n: number; nodeId?: string; region: { x: number; y: number; width: number; height: number }; text: string; status: string; reply?: string };

/**
 * "Apontar para a IA": the human points at a node or an area with the pin tool (I) and writes what an
 * agent should do; the agent reads the pin over MCP, claims it and resolves it, and the canvas follows.
 */
describe.skipIf(!existsSync(webRoot))("E2E: apontamentos para a IA", () => {
  let server: ExternalServer;
  let browser: Browser;
  let page: Page;
  let session = "";

  const pins = async () => ((await (await fetch(`${server.url}/api/pins?status=all`)).json()) as { pins: Pin[] }).pins;
  const mcp = async (method: string, params: unknown) => {
    const res = await fetch(`${server.url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(session ? { "mcp-session-id": session } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    session = res.headers.get("mcp-session-id") ?? session;
    return (await res.json()) as { result: { structuredContent?: Record<string, unknown>; isError?: boolean } };
  };
  const tool = async (name: string, args: Record<string, unknown>) => (await mcp("tools/call", { name, arguments: args })).result;

  beforeAll(async () => {
    server = await startServer({ seed: join(repoRoot, "packages/e2e/fixtures/demo.paprika.json"), webRoot });
    await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "pin-agent", version: "1" } });
    browser = await chromium.launch({ executablePath: process.env.PAPRIKA_CHROMIUM || undefined });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await pinLocale(page, "pt-BR");
    const { active } = (await (await fetch(`${server.url}/api/workspaces`)).json()) as { active: string };
    await page.goto(`${server.url}/w/${encodeURIComponent(active)}`);
    await page.waitForSelector(NODE);
    await page.waitForTimeout(300);
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await server?.stop();
  });

  it("clique num elemento cria um apontamento preso a ele", async () => {
    const box = (await page.locator(NODE).boundingBox())!;
    await page.keyboard.press("i");
    await page.mouse.click(box.x + box.width / 2, box.y + 8);
    const composer = page.getByTestId("pin-composer");
    await composer.waitFor();
    await expect(composer.textContent()).resolves.toContain("Alvo");
    await page.keyboard.type("Deixe este plano com cantos de 16px");
    await page.keyboard.press("Control+Enter");
    await page.getByTestId("pin-badge").waitFor();
    const [pin] = await pins();
    expect(pin).toMatchObject({ n: 1, nodeId: "plano", text: "Deixe este plano com cantos de 16px", status: "open" });
    // The tool goes back to select after sending.
    await expect(page.getByTestId("pin-capture").count()).resolves.toBe(0);
  }, 20_000);

  it("arrastar marca uma área; Esc cancela sem salvar", async () => {
    const vp = (await page.getByTestId("viewport").boundingBox())!;
    const drag = async () => {
      await page.keyboard.press("i");
      await page.mouse.move(vp.x + 60, vp.y + 600);
      await page.mouse.down();
      await page.mouse.move(vp.x + 160, vp.y + 650, { steps: 6 });
      await page.mouse.move(vp.x + 260, vp.y + 700, { steps: 6 });
      await page.getByTestId("pin-drag").waitFor();
      await page.mouse.up();
      await page.getByTestId("pin-composer").waitFor();
    };
    await drag();
    await page.keyboard.type("descartado");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("pin-composer").count()).resolves.toBe(0);
    expect(await pins()).toHaveLength(1);

    await drag();
    await page.keyboard.type("Troque esta área por uma ilustração");
    await page.getByTestId("pin-send").click();
    await waitFor(async () => (await pins()).length === 2);
    const area = (await pins()).find((p) => p.n === 2)!;
    expect(area.nodeId).toBeUndefined();
    expect(area.region.width).toBeGreaterThan(150);
    expect(area.region.height).toBeGreaterThan(80);
    await page.locator('[data-pin="2"]').waitFor({ state: "attached" });
  }, 20_000);

  it("o agente lista, pega e resolve; o canvas acompanha", async () => {
    const listed = await tool("list_pins", {});
    expect((listed.structuredContent!.pins as Pin[]).map((p) => p.n)).toEqual([1, 2]);
    const [first, second] = listed.structuredContent!.pins as Pin[];

    await tool("claim_pin", { id: second!.id });
    await page.locator('[data-pin="2"][data-pin-status="claimed"]').waitFor({ state: "attached" });

    const done = await tool("resolve_pin", { id: first!.id, reply: "Cantos em 16px" });
    expect(done.isError).toBeFalsy();
    // A resolved pin leaves the canvas, and stays in the panel.
    await page.locator('[data-pin="1"]').waitFor({ state: "detached" });
    await page.keyboard.press("Shift+I");
    const panel = page.getByTestId("pins-panel");
    await panel.waitFor();
    await panel.getByRole("button", { name: /Resolvidos 1/ }).click();
    await expect(panel.textContent()).resolves.toContain("Cantos em 16px");

    // The human reopens it: back on the canvas, open again.
    await panel.getByRole("button", { name: "Reabrir" }).click();
    await page.locator('[data-pin="1"][data-pin-status="open"]').waitFor({ state: "attached" });
    expect((await pins()).find((p) => p.n === 1)?.status).toBe("open");
  }, 20_000);
});
