import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DocumentStore, closeBrowser, startHttpServer, type RunningServer } from "../../src/index.js";

const root = resolve(import.meta.dirname, "../../../..");
const webRoot = join(root, "apps/web/dist");
const shots = process.env.PAPRIKA_E2E_SHOTS;

describe.skipIf(!existsSync(webRoot))("E2E: canvas + agente via MCP", () => {
  let dir: string;
  let store: DocumentStore;
  let http: RunningServer;
  let browser: Browser;
  let page: Page;
  let agent: Client;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "paprika-e2e-"));
    const file = join(dir, "demo.paprika.json");
    await copyFile(join(root, "examples/demo.paprika.json"), file);
    store = await DocumentStore.open(file);
    http = await startHttpServer(store, { host: "127.0.0.1", port: 0, webRoot });
    browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(http.url);
    await page.waitForSelector('[data-paprika-id="login"]');
    expect(errors).toEqual([]);
    agent = new Client({ name: "e2e-agent", version: "0" });
    await agent.connect(new StreamableHTTPClientTransport(new URL(`${http.url}/mcp`)));
  }, 60_000);

  afterAll(async () => {
    await agent?.close();
    await browser?.close();
    await http?.close();
    await closeBrowser();
    await store?.close();
    await rm(dir, { recursive: true, force: true });
  });

  it("renderiza o documento com camadas e frames", async () => {
    await expect(page.locator('[data-layer-id="login"]').textContent()).resolves.toContain("Login · mobile");
    await expect(page.locator('[data-paprika-id="login"]').innerText()).resolves.toContain("Bem-vindo de volta");
    if (shots) await page.screenshot({ path: join(shots, "01-carregado.png") });
  });

  it("toolbar flutua centralizada no topo do canvas", async () => {
    const vp = (await page.locator('[data-testid="viewport"]').boundingBox())!;
    const bar = (await page.getByRole("navigation", { name: "Ferramentas" }).boundingBox())!;
    expect(bar.y).toBeGreaterThan(vp.y);
    expect(bar.y + bar.height).toBeLessThan(vp.y + 80);
    expect(Math.abs(bar.x + bar.width / 2 - (vp.x + vp.width / 2))).toBeLessThan(2);
    await page.getByRole("button", { name: "Selecionar" }).click();
    await expect.poll(() => page.getByTestId("selection").count()).toBe(0);
  });

  it("edição do agente via MCP aparece ao vivo e é destacada", async () => {
    await agent.callTool({
      name: "create_nodes",
      arguments: {
        parentId: "plano",
        label: "adicionar nota de rodapé",
        nodes: [{ type: "text", id: "rodape", text: "Cancele quando quiser.", color: "$muted", fontSize: 13, width: "fill", height: "hug" }],
      },
    });
    const el = page.locator('[data-paprika-id="rodape"]');
    await el.waitFor();
    await expect(el.getAttribute("class")).resolves.toContain("agent-flash");
    await expect(page.locator(".agent-pill").textContent()).resolves.toContain("adicionar nota de rodapé");
    if (shots) await page.screenshot({ path: join(shots, "02-agente-editou.png") });
  });

  it("humano arrasta um frame e o agente lê a nova posição", async () => {
    const frame = page.locator('[data-paprika-id="plano"]');
    const box = (await frame.boundingBox())!;
    // Arrasta pelo canto superior esquerdo (padding do card, fora dos filhos).
    await page.mouse.move(box.x + 6, box.y + 6);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + 46, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => store.doc.nodes.plano?.x).not.toBe(460);
    const r = (await agent.callTool({ name: "get_nodes", arguments: { ids: ["plano"] } })) as { content: { text: string }[] };
    const plano = JSON.parse(r.content[0]!.text)[0];
    expect(plano.x).toBeGreaterThan(460);
    expect(plano.y).toBeGreaterThan(0);
    const hist = (await agent.callTool({ name: "get_history", arguments: {} })) as { content: { text: string }[] };
    expect(JSON.parse(hist.content[0]!.text).at(-1)).toMatchObject({ actor: "user", label: "mover" });
  });

  it("inspector altera propriedades e Ctrl+Z desfaz", async () => {
    await page.locator('[data-layer-id="plano"]').click();
    const nameInput = page.getByLabel("Nome", { exact: true });
    await nameInput.fill("Card · plano Pro (revisado)");
    await nameInput.press("Enter");
    await expect.poll(() => store.doc.nodes.plano?.name).toBe("Card · plano Pro (revisado)");
    await page.locator('[data-testid="viewport"]').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect.poll(() => store.doc.nodes.plano?.name).toBe("Card · plano Pro");
  });

  it("ferramenta de retângulo desenha dentro do frame sob o cursor", async () => {
    await page.keyboard.press("Escape");
    const before = Object.keys(store.doc.nodes).length;
    await page.getByRole("button", { name: "Retângulo" }).click();
    const vp = (await page.locator('[data-testid="viewport"]').boundingBox())!;
    // Área vazia do canvas: canto inferior esquerdo do viewport.
    await page.mouse.move(vp.x + 30, vp.y + vp.height - 120);
    await page.mouse.down();
    await page.mouse.move(vp.x + 130, vp.y + vp.height - 60, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => Object.keys(store.doc.nodes).length).toBe(before + 1);
    const rect = Object.values(store.doc.nodes).find((n) => n.type === "rect" && n.parentId === null);
    expect(rect).toBeDefined();
    await expect.poll(() => page.getByTestId("selection").count()).toBe(1);
    if (shots) await page.screenshot({ path: join(shots, "03-retangulo-desenhado.png") });
  });

  for (const key of ["Space", "Enter"]) {
    it(`segurar ${key} sobre o board vira mão aberta; arrastando, mão fechada que move o board`, async () => {
      await page.keyboard.press("Escape");
      const vp = page.locator('[data-testid="viewport"]');
      const world = page.locator(".world");
      const box = (await vp.boundingBox())!;
      const cursorAt = (x: number, y: number) =>
        page.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x!, y!)!).cursor, [x, y]);
      // Sobre um nó do design (não só o fundo), para provar que vale no board inteiro.
      const card = (await page.locator('[data-paprika-id="login"]').boundingBox())!;
      const px = card.x + 40;
      const py = card.y + 40;
      await page.mouse.move(px, py);
      await expect.poll(() => cursorAt(px, py)).not.toBe("grab");
      const before = await world.getAttribute("style");

      await page.keyboard.down(key);
      await expect.poll(() => cursorAt(px, py)).toBe("grab");
      await page.mouse.down();
      await page.mouse.move(px + 80, py + 50, { steps: 6 });
      await expect.poll(() => cursorAt(px + 80, py + 50)).toBe("grabbing");
      await page.mouse.up();
      await expect.poll(() => cursorAt(px + 80, py + 50)).toBe("grab");
      await page.keyboard.up(key);
      await expect.poll(() => cursorAt(px + 80, py + 50)).not.toMatch(/grab/);

      expect(await world.getAttribute("style")).not.toBe(before);
      expect(box.width).toBeGreaterThan(0);
      if (shots && key === "Space") await page.screenshot({ path: join(shots, "04-pan.png") });
    });
  }

  it("screenshot pelo MCP usa o mesmo motor do canvas", async () => {
    const r = (await agent.callTool({ name: "render_screenshot", arguments: { rootId: "login" } })) as {
      content: { type: string; data?: string }[];
    };
    const img = r.content.find((c) => c.type === "image");
    const png = Buffer.from(img!.data!, "base64");
    expect(png.readUInt32BE(16)).toBe(390);
    expect(png.readUInt32BE(20)).toBe(760);
  });
});
