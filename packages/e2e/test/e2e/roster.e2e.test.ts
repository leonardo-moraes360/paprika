import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import type { Page } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { callTool, closeSeededCanvas, connectAgent, openSeededCanvas, webDist, type CanvasSession } from "./seededCanvas.js";

type Box = { x: number; y: number; width: number; height: number };

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

describe.skipIf(!existsSync(webDist))("E2E: roster condensado", () => {
  let session!: CanvasSession;
  let page: Page;
  const clients: Client[] = [];

  beforeAll(async () => {
    session = await openSeededCanvas("paprika-roster-");
    page = session.page;
  }, 60_000);

  afterAll(async () => {
    await closeSeededCanvas(session, clients);
  });

  it("agrupa sessões numa pílula, separa ativos e não cobre toolbar nem painéis", async () => {
    const writer = await connectAgent(session.url, "e2e-agent", clients);
    const reader = await connectAgent(session.url, "e2e-agent", clients);
    const outline = await connectAgent(session.url, "e2e-agent", clients);
    const other = await connectAgent(session.url, "outro", clients);
    await callTool(writer, "create_nodes", { parentId: "plano", nodes: [{ type: "rect", id: "roster-a", x: 8, y: 8, width: 24, height: 16, fill: "#3b82f6" }] });
    await callTool(reader, "get_nodes", { ids: ["login"] });
    await callTool(outline, "get_document_outline", {});
    await callTool(other, "update_nodes", { updates: [{ id: "login", props: { notes: "roster" } }] });

    // The roster is the header's pill ("4 ativos") that opens a popover; each agent session is its own row ("e2e-agent", "e2e-agent 2"...).
    const toggle = page.getByRole("banner").getByRole("button", { name: /agentes? ativos?/ });
    await expect.poll(() => toggle.innerText()).toMatch(/^4 ativos$/);
    await expect.poll(() => page.getByTestId("agent-frame-state").first().getAttribute("data-activity")).toBe("writing");

    const box = async (locator: ReturnType<Page["locator"]>) => (await locator.boundingBox())!;
    const header = await box(page.getByRole("banner"));
    const pill = await box(toggle);
    const viewport = await box(page.getByTestId("viewport"));
    const toolbar = await box(page.getByRole("toolbar", { name: "Ferramentas" }));
    const layers = await box(page.getByRole("complementary", { name: "Painel de camadas" }));
    const props = await box(page.getByRole("complementary", { name: "Painel de propriedades" }));
    expect(overlaps(pill, toolbar)).toBe(false);
    expect(overlaps(pill, layers)).toBe(false);
    expect(overlaps(pill, props)).toBe(false);
    expect(overlaps(pill, viewport)).toBe(false);
    expect(pill.x).toBeGreaterThanOrEqual(header.x - 1);
    expect(pill.y).toBeGreaterThanOrEqual(header.y - 1);
    expect(pill.x + pill.width).toBeLessThanOrEqual(header.x + header.width + 1);
    expect(pill.y + pill.height).toBeLessThanOrEqual(header.y + header.height + 1);

    await toggle.click();
    const roster = page.getByRole("dialog", { name: /agentes ativos/ });
    const items = roster.locator("li");
    await expect.poll(() => items.count()).toBe(4);
    await expect.poll(() => items.filter({ hasText: "e2e-agent" }).count()).toBe(3);
    await expect.poll(() => roster.locator("[data-activity=writing]").count()).toBeGreaterThan(0);
    await expect.poll(() => roster.locator("[data-activity=reading]").count()).toBeGreaterThan(0);
    await expect.poll(() => roster.getByText("create_nodes").count()).toBeGreaterThan(0);
    await expect.poll(() => roster.getByText("get_nodes").count()).toBeGreaterThan(0);
    await expect.poll(() => roster.getByRole("heading", { name: "Ativos" }).count()).toBe(1);
    await expect.poll(() => roster.getByRole("heading", { name: "Ociosos" }).count()).toBe(0);

    const focus = roster.getByRole("button", { name: /Ir até outro$/ });
    await expect.poll(() => focus.isEnabled()).toBe(true);
    await focus.click();
    const centerOff = async () => {
      const vp = (await page.getByTestId("viewport").boundingBox())!;
      const node = (await page.locator('[data-paprika-id="login"]').boundingBox())!;
      return Math.max(Math.abs(node.x + node.width / 2 - (vp.x + vp.width / 2)), Math.abs(node.y + node.height / 2 - (vp.y + vp.height / 2)));
    };
    await expect.poll(centerOff).toBeLessThan(2);
    await page.keyboard.press("Escape");

    await page.evaluate(() => localStorage.setItem("paprika.toolbar.dock", "right"));
    await page.reload();
    await page.waitForSelector('[data-paprika-id="login"]');
    await page.getByRole("button", { name: "Esconder painel de propriedades" }).click();
    await callTool(writer, "get_nodes", { ids: ["login"] });
    await expect.poll(() => page.locator("[data-dock]").getAttribute("data-dock")).toBe("right");
    await expect.poll(() => page.getByRole("banner").getByRole("button", { name: /agentes? ativos?/ }).innerText()).toMatch(/ativo/);
    const docked = await box(page.getByRole("toolbar", { name: "Ferramentas" }));
    const again = await box(page.getByRole("banner").getByRole("button", { name: /agentes? ativos?/ }));
    const toggleBox = await box(page.getByRole("button", { name: "Mostrar painel de propriedades" }));
    expect(overlaps(again, docked)).toBe(false);
    expect(overlaps(again, toggleBox)).toBe(false);

    await page.getByRole("button", { name: "Nova página" }).click();
    await expect.poll(async () => (await session.external.doc()).rootIds.length).toBe(2);
    const doc = await session.external.doc();
    const p2 = doc.rootIds[1] as string;
    await callTool(writer, "create_nodes", { parentId: p2, nodes: [{ type: "frame", id: "roster-p2", name: "Na página 2", width: 120, height: 80, fill: "#ffffff" }] });
    const pageRow = (id: string) => page.getByRole("listitem").filter({ has: page.getByRole("button", { name: (doc.nodes[id] as { name: string }).name, exact: true }) });
    await expect.poll(() => pageRow(p2).getByRole("img", { name: /agente ativo nesta página/ }).count()).toBe(1);
  }, 60_000);
});
