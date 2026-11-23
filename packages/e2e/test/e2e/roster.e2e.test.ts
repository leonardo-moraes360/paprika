import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { pinLocale } from "./locale.js";
import { startServer, type ExternalServer } from "../harness.js";

const root = resolve(import.meta.dirname, "../../../..");
const webRoot = join(root, "apps/web/dist");

type Box = { x: number; y: number; width: number; height: number };

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;

describe.skipIf(!existsSync(webRoot))("E2E: roster condensado", () => {
  let dir: string;
  let external: ExternalServer | undefined;
  let url: string;
  let browser: Browser;
  let page: Page;
  const clients: Client[] = [];

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "paprika-roster-"));
    const file = join(dir, "demo.paprika.json");
    await copyFile(join(root, "examples/demo.paprika.json"), file);
    external = await startServer({ seed: file, webRoot });
    url = external.url;
    browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await pinLocale(page, "pt-BR");
    await page.goto(url);
    await page.locator(".workspace-card.is-active").click();
    await page.waitForSelector('[data-paprika-id="login"]');
  }, 60_000);

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.close().catch(() => undefined)));
    await browser?.close();
    await external?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  async function connect(name: string) {
    const client = new Client({ name, version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
    clients.push(client);
    return client;
  }

  async function call(client: Client, name: string, args: Record<string, unknown>) {
    const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text?: string }[] };
    if (result.isError) throw new Error(result.content.map((part) => part.text ?? "").join("\n"));
    return result;
  }

  it("agrupa sessões numa pílula, separa ativos e não cobre toolbar nem painéis", async () => {
    const writer = await connect("e2e-agent");
    const reader = await connect("e2e-agent");
    const outline = await connect("e2e-agent");
    const other = await connect("outro");
    await call(writer, "create_nodes", { parentId: "plano", nodes: [{ type: "rect", id: "roster-a", x: 8, y: 8, width: 24, height: 16, fill: "#3b82f6" }] });
    await call(reader, "get_nodes", { ids: ["login"] });
    await call(outline, "get_document_outline", {});
    await call(other, "update_nodes", { updates: [{ id: "login", props: { notes: "roster" } }] });

    const toggle = page.getByTestId("agent-roster-toggle");
    await expect.poll(() => toggle.innerText()).toMatch(/^4 ativos$/);
    const items = page.getByTestId("agent-roster").locator("li");
    await expect.poll(() => items.count()).toBe(4);
    await expect.poll(() => page.getByTestId("agent-frame-state").first().getAttribute("data-activity")).toBe("writing");

    const box = async (locator: ReturnType<Page["locator"]>) => (await locator.boundingBox())!;
    const roster = await box(page.getByTestId("agent-roster"));
    const viewport = await box(page.getByTestId("viewport"));
    const toolbar = await box(page.getByRole("navigation", { name: "Ferramentas" }));
    const layers = await box(page.getByRole("complementary", { name: "Páginas e camadas" }));
    const props = await box(page.getByRole("complementary", { name: "Propriedades" }));
    expect(overlaps(roster, toolbar)).toBe(false);
    expect(overlaps(roster, layers)).toBe(false);
    expect(overlaps(roster, props)).toBe(false);
    expect(roster.x).toBeGreaterThanOrEqual(viewport.x - 1);
    expect(roster.y).toBeGreaterThanOrEqual(viewport.y - 1);
    expect(roster.x + roster.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1);
    expect(roster.y + roster.height).toBeLessThanOrEqual(viewport.y + viewport.height + 1);
    expect(roster.y).toBeGreaterThan(toolbar.y + toolbar.height - 1);

    await toggle.click();
    const client = page.getByTestId("agent-client").filter({ hasText: "e2e-agent ×3" });
    await expect.poll(() => client.count()).toBeGreaterThan(0);
    await expect.poll(() => page.locator("[data-activity=writing]").count()).toBeGreaterThan(0);
    await expect.poll(() => page.locator("[data-activity=reading]").count()).toBeGreaterThan(0);
    await expect.poll(() => page.getByText("Escrevendo", { exact: true }).count()).toBeGreaterThan(0);
    await expect.poll(() => page.getByText("Lendo", { exact: true }).count()).toBeGreaterThan(0);
    await expect.poll(() => page.getByRole("heading", { name: "Ociosos" }).count()).toBe(0);

    const focus = page.getByTestId("agent-focus").filter({ hasText: /^outro/ }).first();
    await expect.poll(() => focus.isEnabled()).toBe(true);
    await focus.click();
    const centerOff = async () => {
      const vp = (await page.getByTestId("viewport").boundingBox())!;
      const node = (await page.locator('[data-paprika-id="login"]').boundingBox())!;
      return Math.max(Math.abs(node.x + node.width / 2 - (vp.x + vp.width / 2)), Math.abs(node.y + node.height / 2 - (vp.y + vp.height / 2)));
    };
    await expect.poll(centerOff).toBeLessThan(2);

    await page.evaluate(() => {
      localStorage.setItem("paprika.toolbar.dock", "right");
      localStorage.setItem("paprika.panel.right.collapsed", "1");
    });
    await page.reload();
    await page.waitForSelector('[data-paprika-id="login"]');
    await call(writer, "get_nodes", { ids: ["login"] });
    await expect.poll(() => page.getByRole("navigation", { name: "Ferramentas" }).getAttribute("data-toolbar-dock")).toBe("right");
    await expect.poll(() => page.getByTestId("agent-roster-toggle").innerText()).toMatch(/ativo/);
    const docked = await box(page.getByRole("navigation", { name: "Ferramentas" }));
    const again = await box(page.getByTestId("agent-roster"));
    const toggleBox = await box(page.getByRole("button", { name: "Mostrar painel de propriedades" }));
    expect(overlaps(again, docked)).toBe(false);
    expect(overlaps(again, toggleBox)).toBe(false);
    expect(again.x + again.width).toBeLessThanOrEqual(docked.x + 1);

    await page.getByTestId("add-page").click();
    await expect.poll(async () => (await external!.doc()).rootIds.length).toBe(2);
    const doc = await external!.doc();
    const [p1, p2] = doc.rootIds as [string, string];
    await call(writer, "create_nodes", { parentId: p2, nodes: [{ type: "frame", id: "roster-p2", name: "Na página 2", width: 120, height: 80, fill: "#ffffff" }] });
    await page.locator(`[data-page-id="${p1}"]`).click();
    await expect.poll(() => page.locator(`[data-page-id="${p2}"]`).getByTestId("agent-page-dot").count()).toBe(1);
  }, 60_000);
});
