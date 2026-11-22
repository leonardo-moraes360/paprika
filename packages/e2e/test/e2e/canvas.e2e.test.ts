import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { connectorMidpoint, copyId, type Document, type FrameNode } from "@paprika/core";
import { startServer, type ExternalServer } from "../harness.js";

const root = resolve(import.meta.dirname, "../../../..");
const webRoot = join(root, "apps/web/dist");
const shots = process.env.PAPRIKA_E2E_SHOTS;

// Roda contra o servidor Go como processo externo (server-go/bin/paprika ou PAPRIKA_SERVER_BIN).
describe.skipIf(!existsSync(webRoot))("E2E: canvas + agente via MCP", () => {
  let dir: string;
  let external: ExternalServer | undefined;
  let url: string;
  /** Documento atual, via GET /api/document. */
  const doc = async (): Promise<Document> => external!.doc();
  let browser: Browser;
  let page: Page;
  let agent: Client;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "paprika-e2e-"));
    const file = join(dir, "demo.paprika.json");
    await copyFile(join(root, "examples/demo.paprika.json"), file);
    external = await startServer({ seed: file, webRoot });
    url = external.url;
    browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    // `/` is the workspace overview: the demo is the only (active) workspace; one click opens its canvas.
    await page.goto(url);
    await page.locator(".workspace-card.is-active").click();
    await page.waitForSelector('[data-paprika-id="login"]');
    expect(new URL(page.url()).pathname).toBe(`/w/${(await doc()).id}`);
    expect(errors).toEqual([]);
    agent = new Client({ name: "e2e-agent", version: "0" });
    await agent.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
  }, 60_000);

  afterAll(async () => {
    await agent?.close();
    await browser?.close();
    await external?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it("renderiza o documento com camadas e frames", async () => {
    await expect(page.locator('[data-layer-id="login"]').textContent()).resolves.toContain("Login · mobile");
    await expect(page.locator('[data-paprika-id="login"]').innerText()).resolves.toContain("Bem-vindo de volta");
    // The inspector calls the document a workspace (same word as the overview).
    await expect(page.getByRole("heading", { name: "Workspace", exact: true }).count()).resolves.toBe(1);
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

  it("presença: cada agente tem cursor, seleção e cor próprios; o cursor desliza até os nós em que ele age", async () => {
    // The previous test left the agent's cursor on the new footer, inside "plano".
    const cursor = page.locator('[data-testid="agent-cursor"]');
    await expect.poll(() => cursor.count()).toBe(1);
    const plano = (await page.locator('[data-paprika-id="plano"]').boundingBox())!;
    const inside = (b: { x: number; y: number }, r: { x: number; y: number; width: number; height: number }) =>
      b.x >= r.x && b.x <= r.x + r.width && b.y >= r.y && b.y <= r.y + r.height;
    const tip = async (i: number) => (await cursor.nth(i).locator(".agent-cursor svg").boundingBox())!;
    expect(inside(await tip(0), plano)).toBe(true);

    // A second session with the same client name is another agent: own name and color.
    const other = new Client({ name: "e2e-agent", version: "0" });
    await other.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
    try {
      await other.callTool({ name: "get_nodes", arguments: { ids: ["login"] } });
      await expect.poll(() => cursor.count()).toBe(2);
      const roster = page.getByTestId("agent-roster").locator("li");
      await expect.poll(() => roster.allInnerTexts()).toEqual([expect.stringMatching(/^e2e-agent\s*criando/), expect.stringMatching(/^e2e-agent 2\s*lendo/)]);
      const colors = await cursor.evaluateAll((els) => els.map((e) => getComputedStyle(e).getPropertyValue("--agent")));
      expect(new Set(colors).size).toBe(2);
      const login = (await page.locator('[data-paprika-id="login"]').boundingBox())!;
      await expect.poll(async () => inside(await tip(1), login)).toBe(true);

      // The first agent moves to "login" too: its cursor glides there (CSS transition).
      await agent.callTool({ name: "update_nodes", arguments: { updates: [{ id: "login", props: { notes: "revisado" } }] } });
      await expect.poll(async () => inside(await tip(0), login), { timeout: 3000 }).toBe(true);
      await expect.poll(() => roster.first().innerText()).toContain("editando");
      if (shots) await page.screenshot({ path: join(shots, "02b-agentes-presentes.png") });
    } finally {
      await other.close();
    }
  });

  it("humano arrasta um frame e o agente lê a nova posição", async () => {
    const frame = page.locator('[data-paprika-id="plano"]');
    const box = (await frame.boundingBox())!;
    // Arrasta pelo canto superior esquerdo (padding do card, fora dos filhos).
    await page.mouse.move(box.x + 6, box.y + 6);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, box.y + 46, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => ((await doc()).nodes.plano as FrameNode | undefined)?.x).not.toBe(460);
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
    await expect.poll(async () => (await doc()).nodes.plano?.name).toBe("Card · plano Pro (revisado)");
    await page.locator('[data-testid="viewport"]').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await doc()).nodes.plano?.name).toBe("Card · plano Pro");
  });

  it("ordem Z: Page Up/Down e botões Ordem; Ctrl+Z desfaz; ignora input", async () => {
    const roots = () => doc().then((d) => d.rootIds);
    await expect.poll(roots).toEqual(["login", "plano"]);

    await page.locator('[data-layer-id="login"]').click();
    await page.locator('[data-testid="viewport"]').click({ position: { x: 5, y: 5 } });
    await page.locator('[data-layer-id="login"]').click();
    await page.keyboard.press("PageUp");
    await expect.poll(roots).toEqual(["plano", "login"]);
    await page.keyboard.press("Control+z");
    await expect.poll(roots).toEqual(["login", "plano"]);

    await page.locator('[data-layer-id="login"]').click();
    await page.getByTestId("arrange-front").click();
    await expect.poll(roots).toEqual(["plano", "login"]);
    await page.keyboard.press("Control+z");
    await expect.poll(roots).toEqual(["login", "plano"]);

    await page.locator('[data-layer-id="login"]').click();
    await page.keyboard.press("Control+PageDown");
    await expect.poll(roots).toEqual(["login", "plano"]);

    const nameInput = page.getByLabel("Nome", { exact: true });
    await nameInput.click();
    await page.keyboard.press("PageUp");
    await expect.poll(roots).toEqual(["login", "plano"]);
    await expect.poll(async () => (await doc()).nodes.login?.name).toBe("Login · mobile");
  });

  it("inspector: Opacidade recusa letras, cola inválida e limita ao intervalo 0–1", async () => {
    await page.locator('[data-layer-id="plano"]').click();
    const opacity = page.getByLabel("Opacidade", { exact: true });
    await expect.poll(() => opacity.inputValue()).toBe("1");

    await opacity.click({ clickCount: 3 });
    await page.keyboard.press("Backspace");
    await opacity.pressSequentially("1aaaaa");
    await expect.poll(() => opacity.inputValue()).toBe("1");

    await opacity.evaluate((el) => {
      const dt = new DataTransfer();
      dt.setData("text", "abc");
      el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await expect.poll(() => opacity.inputValue()).toBe("1");
    await expect.poll(() => page.getByRole("status").filter({ hasText: "Use um número entre 0 e 1." }).count()).toBeGreaterThan(0);
    await expect.poll(async () => ((await doc()).nodes.plano as FrameNode | undefined)?.opacity).toBe(1);

    await opacity.click({ clickCount: 3 });
    await opacity.pressSequentially("0,5");
    await opacity.press("Enter");
    await expect.poll(async () => ((await doc()).nodes.plano as FrameNode | undefined)?.opacity).toBe(0.5);
    await expect.poll(() => opacity.inputValue()).toBe("0.5");

    await opacity.click({ clickCount: 3 });
    await opacity.pressSequentially("2");
    await opacity.press("Enter");
    await expect.poll(async () => ((await doc()).nodes.plano as FrameNode | undefined)?.opacity).toBe(1);
    await expect.poll(() => opacity.inputValue()).toBe("1");
    await expect.poll(() => page.getByRole("status").filter({ hasText: "Use um número entre 0 e 1." }).count()).toBeGreaterThan(0);
  });

  it("ferramenta de retângulo desenha dentro do frame sob o cursor", async () => {
    await page.keyboard.press("Escape");
    const before = Object.keys((await doc()).nodes).length;
    await page.getByRole("button", { name: "Retângulo" }).click();
    const vp = (await page.locator('[data-testid="viewport"]').boundingBox())!;
    // Área vazia do canvas: canto inferior esquerdo do viewport.
    await page.mouse.move(vp.x + 30, vp.y + vp.height - 120);
    await page.mouse.down();
    await page.mouse.move(vp.x + 130, vp.y + vp.height - 60, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Object.keys((await doc()).nodes).length).toBe(before + 1);
    const rect = Object.values((await doc()).nodes).find((n) => n.type === "rect" && n.parentId === null);
    expect(rect).toBeDefined();
    await expect.poll(() => page.getByTestId("selection").count()).toBe(1);
    if (shots) await page.screenshot({ path: join(shots, "03-retangulo-desenhado.png") });
  });

  it("fantasma do elemento enquanto arrasta a ferramenta: estilo do nó, aria-hidden, sem escrita até soltar", async () => {
    await page.keyboard.press("Escape");
    const before = Object.keys((await doc()).nodes).length;
    await page.getByRole("button", { name: "Retângulo", exact: true }).click();
    const vp = (await page.locator('[data-testid="viewport"]').boundingBox())!;
    const x0 = vp.x + 40;
    const y0 = vp.y + vp.height - 200;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + 140, y0 + 90, { steps: 8 });
    const ghost = page.getByTestId("draft-ghost");
    await expect.poll(() => ghost.count()).toBe(1);
    expect(await ghost.getAttribute("aria-hidden")).toBe("true");
    expect(await ghost.getAttribute("data-ghost-tool")).toBe("rect");
    await expect.poll(async () => Object.keys((await doc()).nodes).length).toBe(before);
    const pe = await ghost.evaluate((el) => getComputedStyle(el).pointerEvents);
    expect(pe).toBe("none");
    await page.mouse.up();
    await expect.poll(() => ghost.count()).toBe(0);
    await expect.poll(async () => Object.keys((await doc()).nodes).length).toBe(before + 1);
    const rects = Object.values((await doc()).nodes).filter((n) => n.type === "rect" && n.parentId === null);
    expect(rects.length).toBeGreaterThanOrEqual(1);
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

  it("caneta: clicar e arrastar cria bezier; clicar no 1º vértice fecha a forma onde foi desenhada", async () => {
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Caneta (bezier)" }).click();
    const card = (await page.locator('[data-paprika-id="login"]').boundingBox())!;
    const a = { x: card.x + 60, y: card.y + 120 };
    const b = { x: card.x + 200, y: card.y + 120 };
    const c = { x: card.x + 130, y: card.y + 220 };
    await page.mouse.click(a.x, a.y);
    await page.mouse.move(b.x, b.y);
    await page.mouse.down();
    await page.mouse.move(b.x + 40, b.y + 40, { steps: 5 }); // puxa as alças
    await page.mouse.up();
    await page.mouse.click(c.x, c.y);
    await expect.poll(() => page.locator('[data-testid="pen-overlay"]').count()).toBe(1);
    if (shots) await page.screenshot({ path: join(shots, "05-caneta-desenhando.png") });
    await page.mouse.click(a.x, a.y); // fecha

    // "login" tem layout em coluna: o vetor vai para o canvas, para não ser empurrado pelo fluxo.
    const findPath = async () => Object.values((await doc()).nodes).find((n) => n.type === "path" && n.name === "Vetor 1");
    await expect.poll(findPath).toBeTruthy();
    const path = (await findPath())!;
    if (path.type !== "path") throw new Error("esperava path");
    expect(path.d).toMatch(/^M[\d.]+ [\d.]+ C/); // origem do nó = canto da caixa do desenho
    expect(path.d).toContain(" C");
    expect(path.d.endsWith("Z")).toBe(true);
    expect(path.fill).toBeTruthy();
    expect(path.parentId).toBeNull();
    await expect.poll(() => page.locator(`svg[data-paprika-id="${path.id}"] path`).getAttribute("d")).toBe(path.d);
    // A forma aparece onde os cliques foram feitos (a caixa cobre os 3 vértices).
    const drawn = (await page.locator(`svg[data-paprika-id="${path.id}"]`).boundingBox())!;
    expect(drawn.x).toBeLessThanOrEqual(a.x + 1);
    expect(drawn.x + drawn.width).toBeGreaterThanOrEqual(b.x - 1);
    expect(drawn.y + drawn.height).toBeGreaterThanOrEqual(c.y - 1);
    expect(await page.locator('[data-testid="pen-overlay"]').count()).toBe(0);
    expect(await page.getByRole("button", { name: "Selecionar" }).getAttribute("class")).toMatch(/is-active/);
    if (shots) await page.screenshot({ path: join(shots, "06-caneta-forma.png") });
  });

  it("caneta: Enter termina um traço aberto (sem acionar o pan)", async () => {
    await page.keyboard.press("Escape");
    const count = async () => Object.values((await doc()).nodes).filter((n) => n.type === "path").length;
    const before = await count();
    await page.keyboard.press("p");
    const vp = (await page.locator('[data-testid="viewport"]').boundingBox())!;
    await page.mouse.click(vp.x + 40, vp.y + vp.height - 200);
    await page.mouse.click(vp.x + 140, vp.y + vp.height - 160);
    await page.keyboard.press("Enter");
    await expect.poll(count).toBe(before + 1);
    const created = Object.values((await doc()).nodes).filter((n) => n.type === "path").at(-1)!;
    expect(created.parentId).toBeNull();
    if (created.type === "path") expect(created.d.endsWith("Z")).toBe(false);
    expect(await page.locator('[data-testid="viewport"]').getAttribute("class")).not.toMatch(/is-pan/);
  });

  it("path criado pelo agente aparece no canvas como SVG", async () => {
    await agent.callTool({
      name: "create_nodes",
      arguments: {
        parentId: "login",
        nodes: [{ type: "path", id: "agentWave", x: 40, y: 300, d: "M0 20 C 40 -20 80 60 120 20", stroke: { color: "#c43d27", width: 3 } }],
      },
    });
    const el = page.locator('svg[data-paprika-id="agentWave"]');
    await expect.poll(() => el.count()).toBe(1);
    const box = (await el.boundingBox())!;
    expect(Math.round(box.width)).toBeGreaterThan(100);
    expect(await el.locator("path").getAttribute("stroke")).toBe("#c43d27");
  });

  it("screenshot pelo MCP usa o mesmo motor do canvas", async () => {
    const r = (await agent.callTool({ name: "render_screenshot", arguments: { rootId: "login" } })) as {
      content: { type: string; data?: string }[];
    };
    const img = r.content.find((c) => c.type === "image");
    const png = Buffer.from(img!.data!, "base64");
    expect(png.readUInt32BE(16)).toBe(390);
    expect(png.readUInt32BE(20)).toBe(760);
  });

  it("seleção múltipla: shift-clique e marquee; Ctrl+G agrupa, clique pega o grupo, duplo clique entra, Ctrl+Shift+G desfaz", async () => {
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Selecionar" }).click();
    await page.locator('[data-layer-id="login"]').click();
    await page.locator('[data-layer-id="plano"]').click({ modifiers: ["Shift"] });
    await expect.poll(() => page.getByTestId("selection").getAttribute("data-count")).toBe("2");
    await expect(page.getByTestId("multi-selection").textContent()).resolves.toContain("2 nós selecionados");

    // Marquee no vazio, cobrindo os dois cards.
    await page.locator('[data-testid="viewport"]').click({ position: { x: 5, y: 5 } });
    await expect.poll(() => page.getByTestId("selection").count()).toBe(0);
    const a = (await page.locator('[data-paprika-id="login"]').boundingBox())!;
    const b = (await page.locator('[data-paprika-id="plano"]').boundingBox())!;
    const vp0 = (await page.locator('[data-testid="viewport"]').boundingBox())!;
    await page.mouse.move(vp0.x + 5, vp0.y + 5);
    await page.mouse.down();
    await page.mouse.move(Math.max(a.x, b.x) + 30, Math.max(a.y, b.y) + 30, { steps: 6 });
    await expect.poll(() => page.getByTestId("marquee").count()).toBe(1);
    await page.mouse.up();
    const picked = () => page.locator(".layer.is-selected").evaluateAll((els) => els.map((e) => e.getAttribute("data-layer-id")));
    await expect.poll(picked).toEqual(expect.arrayContaining(["login", "plano"]));

    await page.keyboard.press("Control+g");
    const groupId = async () => Object.values((await doc()).nodes).find((n) => n.type === "group")?.id;
    await expect.poll(groupId).toBeTruthy();
    const g = (await groupId())!;
    const d = await doc();
    expect(d.nodes.login?.parentId).toBe(g);
    expect(d.nodes.plano?.parentId).toBe(g);
    await expect(page.locator('[data-layer-id="' + g + '"]').textContent()).resolves.toContain("Grupo 1");
    if (shots) await page.screenshot({ path: join(shots, "07-grupo.png") });

    // Um clique num filho seleciona o grupo; o duplo clique entra no nó exato.
    await page.locator('[data-testid="viewport"]').click({ position: { x: 5, y: 5 } });
    const card = (await page.locator('[data-paprika-id="plano"]').boundingBox())!;
    await page.mouse.click(card.x + 6, card.y + 6);
    await expect.poll(() => page.locator(".layer.is-selected").getAttribute("data-layer-id")).toBe(g);
    await page.mouse.dblclick(card.x + 6, card.y + 6);
    await expect.poll(() => page.locator(".layer.is-selected").getAttribute("data-layer-id")).toBe("plano");

    // Arrastar o grupo move os dois cards juntos (uma entrada de histórico).
    await page.locator('[data-layer-id="' + g + '"]').click();
    const before = await doc();
    const gx = (before.nodes[g] as { x: number }).x;
    await page.mouse.move(card.x + 6, card.y + 6);
    await page.mouse.down();
    await page.mouse.move(card.x + 56, card.y + 6, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => ((await doc()).nodes[g] as { x: number }).x).toBeGreaterThan(gx + 20);

    await page.keyboard.press("Control+Shift+g");
    await expect.poll(async () => (await doc()).nodes[g]).toBeUndefined();
    const after = await doc();
    expect(after.nodes.plano?.parentId).toBeNull();
    // Volta ao canvas na mesma posição em que o grupo a deixou: a antiga (relativa) + a nova origem.
    expect((after.nodes.plano as { x: number }).x).toBeGreaterThan((before.nodes.plano as { x: number }).x + gx + 20);
  });

  it("páginas: o + leva o conteúdo para a Página 1, cria a 2 e o agente desenha nela", async () => {
    await page.keyboard.press("Escape");
    await page.getByTestId("add-page").click();
    await expect.poll(async () => (await doc()).rootIds.length).toBe(2);
    const d = await doc();
    const [p1, p2] = d.rootIds as [string, string];
    expect(d.nodes[p1]).toMatchObject({ type: "page", name: "Página 1" });
    expect(d.nodes.login?.parentId).toBe(p1);
    // A página nova abre vazia.
    await expect.poll(() => page.locator('[data-paprika-id="login"]').count()).toBe(0);
    await expect(page.locator(".page.is-active").textContent()).resolves.toContain("Página 2");

    await agent.callTool({
      name: "create_nodes",
      arguments: { parentId: p2, nodes: [{ type: "frame", id: "tela2", name: "Tela 2", width: 320, height: 200, fill: "#ffffff" }] },
    });
    await expect.poll(() => page.locator('[data-paprika-id="tela2"]').count()).toBe(1);
    // Desenhar no canvas da página 2 cria o nó dentro dela.
    await page.getByRole("button", { name: "Retângulo" }).click();
    const vp = (await page.locator('[data-testid="viewport"]').boundingBox())!;
    await page.mouse.move(vp.x + 30, vp.y + vp.height - 120);
    await page.mouse.down();
    await page.mouse.move(vp.x + 90, vp.y + vp.height - 70, { steps: 4 });
    await page.mouse.up();
    // O retângulo cai na página 2 (direto nela ou dentro da Tela 2, conforme o ponto).
    const inPage2 = async () => {
      const now = await doc();
      return Object.values(now.nodes).filter((n) => n.type === "rect" && (n.parentId === p2 || n.parentId === "tela2")).length;
    };
    await expect.poll(inPage2).toBe(1);
    if (shots) await page.screenshot({ path: join(shots, "08-pagina-2.png") });

    await page.locator(`[data-page-id="${p1}"]`).click();
    await expect.poll(() => page.locator('[data-paprika-id="login"]').count()).toBe(1);
    await expect.poll(() => page.locator('[data-paprika-id="tela2"]').count()).toBe(0);

    // The agent's last nodes are on page 2: the roster names that page, and clicking the agent opens
    // it with the agent's cursor (on "tela2") centered in the viewport.
    // (The second agent from the presence test may still be listed, on page 1.)
    const first = page.getByTestId("agent-roster").locator("li").first();
    const where = first.getByTestId("agent-page");
    await expect.poll(() => first.innerText()).toMatch(/^e2e-agent\s*em Página 2$/);
    if (shots) await page.screenshot({ path: join(shots, "08b-agente-em-outra-pagina.png") });
    await first.getByTestId("agent-focus").click();
    await expect.poll(() => page.locator('[data-paprika-id="tela2"]').count()).toBe(1);
    await expect(page.locator(".page.is-active").textContent()).resolves.toContain("Página 2");
    await expect.poll(() => where.count()).toBe(0);
    await expect.poll(() => first.innerText()).toMatch(/^e2e-agent\s*criando$/);
    const centerOff = async (id: string) => {
      const vp = (await page.locator('[data-testid="viewport"]').boundingBox())!;
      const b = (await page.locator(`[data-paprika-id="${id}"]`).boundingBox())!;
      return Math.max(Math.abs(b.x + b.width / 2 - (vp.x + vp.width / 2)), Math.abs(b.y + b.height / 2 - (vp.y + vp.height / 2)));
    };
    await expect.poll(() => centerOff("tela2")).toBeLessThan(2);
    // Same page: pan away, then clicking the agent brings its cursor back to the center.
    await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2);
    await page.mouse.wheel(400, 300);
    await expect.poll(() => centerOff("tela2")).toBeGreaterThan(100);
    await first.getByTestId("agent-focus").click();
    await expect.poll(() => centerOff("tela2")).toBeLessThan(2);
    if (shots) await page.screenshot({ path: join(shots, "08c-foco-no-agente.png") });

    await page.locator(`[data-page-id="${p1}"]`).click();
    await expect.poll(() => page.locator('[data-paprika-id="login"]').count()).toBe(1);
  });
  it("componentes: tornar componente, nova instância, mudança propaga, override na cópia, desanexar", async () => {
    await page.keyboard.press("Escape");
    await page.locator('[data-layer-id="plano"]').click();
    await page.getByRole("button", { name: "Tornar componente" }).click();
    await expect.poll(async () => ((await doc()).nodes.plano as { component?: boolean }).component).toBe(true);
    await page.getByRole("button", { name: "Nova instância" }).click();
    const instId = async () => Object.values((await doc()).nodes).find((n) => (n as { instanceOf?: string }).instanceOf === "plano")?.id;
    await expect.poll(instId).toBeTruthy();
    const inst = (await instId())!;
    const pro = copyId(inst, "74oxmaizym");
    await expect.poll(() => page.locator(`[data-paprika-id="${pro}"]`).textContent()).toBe("Pro");
    await expect(page.getByTestId("instance-panel").textContent()).resolves.toContain("de ");

    // O agente muda o componente; a cópia no canvas acompanha.
    await agent.callTool({ name: "update_nodes", arguments: { updates: [{ id: "74oxmaizym", props: { text: "Plus" } }] } });
    await expect.poll(() => page.locator(`[data-paprika-id="${pro}"]`).textContent()).toBe("Plus");

    // Editar a cópia grava um override só nesta instância.
    await page.locator(`[data-layer-id="${pro}"]`).click();
    await expect(page.getByTestId("copy-panel").textContent()).resolves.toContain("cópia de");
    await page.getByLabel("Conteúdo").fill("Equipe");
    await page.getByLabel("Conteúdo").blur();
    await expect.poll(async () => ((await doc()).nodes[inst] as { overrides?: unknown }).overrides).toEqual({ "74oxmaizym": { text: "Equipe" } });
    await expect.poll(() => page.locator(`[data-paprika-id="${pro}"]`).textContent()).toBe("Equipe");
    await expect.poll(() => page.locator('[data-paprika-id="74oxmaizym"]').textContent()).toBe("Plus");
    if (shots) await page.screenshot({ path: join(shots, "09-instancia.png") });

    await page.locator(`[data-layer-id="${inst}"]`).click();
    await page.getByRole("button", { name: "Desanexar" }).click();
    await expect.poll(async () => ((await doc()).nodes[inst] as { instanceOf?: string }).instanceOf).toBeUndefined();
    expect(((await doc()).nodes[pro] as { text: string; sourceId?: string })).toMatchObject({ text: "Equipe" });
  });
  it("colar SVG e HTML vira nós; o botão exporta SVG medido no navegador", async () => {
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Selecionar" }).click();
    const paste = (type: string, data: string) =>
      page.evaluate(
        ([t, d]) => {
          const dt = new DataTransfer();
          dt.setData(t!, d!);
          window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
        },
        [type, data],
      );
    const before = Object.keys((await doc()).nodes).length;
    await paste("text/plain", '<svg viewBox="0 0 10 10" width="40" height="40"><title>Seta</title><path d="M0 0 L10 5 L0 10 Z" fill="#c43d27"/></svg>');
    const byName = async (name: string) => Object.values((await doc()).nodes).find((n) => n.name === name);
    await expect.poll(async () => (await byName("Seta"))?.type).toBe("path");
    const seta = (await byName("Seta"))!;
    await expect.poll(() => page.locator(`[data-paprika-id="${seta.id}"]`).count()).toBe(1);
    await expect.poll(() => page.getByTestId("selection").count()).toBe(1);

    await paste("text/html", '<meta charset="utf-8"><div style="display:flex; gap:8px; padding:8px; background:#fff"><span>Colado</span><span>do navegador</span></div>');
    await expect.poll(async () => Object.keys((await doc()).nodes).length).toBe(before + 4);
    const colado = Object.values((await doc()).nodes).find((n) => n.type === "text" && n.text === "Colado")!;
    await expect.poll(() => page.locator(`[data-paprika-id="${colado.id}"]`).textContent()).toBe("Colado");

    await page.locator(`[data-layer-id="${seta.id}"]`).click();
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exportar SVG" }).click()]);
    expect(download.suggestedFilename()).toBe("Seta.svg");
    const file = await download.path();
    const svg = await readFile(file!, "utf8");
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="40" height="40"/);
    expect(svg).toContain('d="M0 0 L40 20 L0 40 Z"');
  }, 30_000);
  it("edição ponto a ponto: duplo clique entra, arrasta âncora, insere, remove, alterna suave, Esc sai", async () => {
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Selecionar" }).click();
    await agent.callTool({
      name: "create_nodes",
      arguments: { parentId: "login", nodes: [{ type: "path", id: "pontos", x: 40, y: 420, d: "M0 0 L60 0 L60 60", stroke: { color: "#1e2336", width: 2 } }] },
    });
    const svg = page.locator('svg[data-paprika-id="pontos"]');
    await expect.poll(() => svg.count()).toBe(1);
    const pathD = async () => ((await doc()).nodes.pontos as { d: string } | undefined)?.d;
    const center = async (sel: string) => {
      const b = (await page.locator(sel).boundingBox())!;
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    await page.locator('[data-layer-id="pontos"]').click();
    const box = (await svg.boundingBox())!;
    await page.mouse.dblclick(box.x + box.width * 0.75, box.y + box.height * 0.25);
    await expect.poll(() => page.getByTestId("path-edit").count()).toBe(1);
    await expect(page.locator("[data-path-anchor]").count()).resolves.toBe(3);

    // Arrastar a âncora do canto para a direita alarga o vetor; a caixa acompanha.
    const a1 = await center('[data-path-anchor="0:1"]');
    await page.mouse.move(a1.x, a1.y);
    await page.mouse.down();
    await page.mouse.move(a1.x + 30, a1.y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(pathD).not.toBe("M0 0 L60 0 L60 60");
    const moved = (await doc()).nodes.pontos as { d: string; width: number };
    expect(moved.d).toMatch(/^M0 0 L\d+(\.\d+)? 0 L60 60$/);
    expect(moved.width).toBeGreaterThan(60);

    // Duplo clique no contorno insere um ponto; Delete remove o selecionado.
    const a0 = await center('[data-path-anchor="0:0"]');
    const b1 = await center('[data-path-anchor="0:1"]');
    await page.mouse.dblclick((a0.x + b1.x) / 2, (a0.y + b1.y) / 2);
    await expect.poll(async () => (await pathD())?.split("L").length).toBe(4);
    await expect(page.locator("[data-path-anchor][data-selected]").getAttribute("data-path-anchor")).resolves.toBe("0:1");
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await pathD())?.split("L").length).toBe(3);
    await expect.poll(async () => !!(await doc()).nodes.pontos).toBe(true);

    // Duplo clique numa âncora vira ponto suave (cúbicas).
    await page.mouse.dblclick(...Object.values(await center('[data-path-anchor="0:1"]')) as [number, number]);
    await expect.poll(pathD).toContain("C");
    if (shots) await page.screenshot({ path: join(shots, "10-pontos-do-vetor.png") });

    await page.keyboard.press("Escape");
    await expect.poll(() => page.getByTestId("path-edit").count()).toBe(0);
    await expect(page.getByTestId("selection").count()).resolves.toBe(1);
    const hist = (await agent.callTool({ name: "get_history", arguments: {} })) as { content: { text: string }[] };
    expect(JSON.parse(hist.content[0]!.text).slice(-4).map((h: { label: string }) => h.label)).toEqual(["mover ponto", "inserir ponto", "remover ponto", "alternar canto/suave"]);
  }, 30_000);
  it("modos de tema: o agente define o modo escuro, o canvas pinta cada frame no seu modo e o inspector troca", async () => {
    await page.keyboard.press("Escape");
    await agent.callTool({ name: "set_tokens", arguments: { tokens: { tela: "#fafafa", tinta: "#1e2336" } } });
    await agent.callTool({ name: "set_tokens", arguments: { mode: "escuro", tokens: { tela: "#14161f", tinta: "#f2f2f2" } } });
    await agent.callTool({
      name: "create_nodes",
      arguments: {
        parentId: (await doc()).nodes.login!.parentId,
        nodes: [0, 1].map((i) => ({
          type: "frame", id: `tema${i}`, name: `Tema ${i}`, x: 2000 + i * 200, y: 0, width: 160, height: 80, fill: "$tela", ...(i ? { mode: "escuro" } : {}),
          children: [{ type: "text", id: `tema${i}t`, text: "Aa", color: "$tinta", x: 8, y: 8 }],
        })),
      },
    });
    const bg = (id: string) => page.locator(`[data-paprika-id="${id}"]`).evaluate((el) => getComputedStyle(el).backgroundColor);
    const fg = (id: string) => page.locator(`[data-paprika-id="${id}"]`).evaluate((el) => getComputedStyle(el).color);
    await expect.poll(() => bg("tema0")).toBe("rgb(250, 250, 250)");
    await expect.poll(() => bg("tema1")).toBe("rgb(20, 22, 31)");
    await expect.poll(() => fg("tema1t")).toBe("rgb(242, 242, 242)");

    await page.locator('[data-layer-id="tema0"]').click();
    await page.getByLabel("Modo de tema").click();
    await page.getByRole("option", { name: "escuro", exact: true }).click();
    await expect.poll(() => bg("tema0")).toBe("rgb(20, 22, 31)");
    await expect.poll(async () => ((await doc()).nodes.tema0 as { mode?: string }).mode).toBe("escuro");

    const r = (await agent.callTool({ name: "export_code", arguments: { rootId: "tema1", format: "html", cssVariables: true } })) as { content: { text: string }[] };
    expect(r.content[0]!.text).toContain('[data-paprika-mode="escuro"]{--tela:#14161f;--tinta:#f2f2f2}');
    expect(r.content[0]!.text).toContain("background:var(--tela)");
    const outline = (await agent.callTool({ name: "get_document_outline", arguments: { depth: 0 } })) as { content: { text: string }[] };
    expect(outline.content[0]!.text).toContain("modes: escuro($tela=#14161f $tinta=#f2f2f2)");
  });

  it("renomear no lugar: duplo clique na camada ou no título do frame, Enter confirma, Esc cancela, Ctrl+Z desfaz", async () => {
    await page.keyboard.press("Escape");
    const name = async (id: string) => (await doc()).nodes[id]?.name;
    const layerName = page.locator('[data-layer-id="tema0t"] .layer-name');
    await layerName.dblclick();
    const layerInput = page.getByLabel("Nome da camada");
    await layerInput.fill("Amostra clara");
    await layerInput.press("Enter");
    await expect.poll(() => name("tema0t")).toBe("Amostra clara");
    await expect.poll(() => layerInput.count()).toBe(0);
    const hist = (await agent.callTool({ name: "get_history", arguments: {} })) as { content: { text: string }[] };
    expect(JSON.parse(hist.content[0]!.text).at(-1)).toMatchObject({ actor: "user", label: "renomear camada" });

    // Esc cancela sem gravar (nem pelo blur que segue a desmontagem do campo).
    await page.locator('[data-layer-id="tema0t"] .layer-name').dblclick();
    await page.getByLabel("Nome da camada").fill("Descartado");
    await page.getByLabel("Nome da camada").press("Escape");
    await expect.poll(() => page.getByLabel("Nome da camada").count()).toBe(0);
    expect(await name("tema0t")).toBe("Amostra clara");

    const label = page.locator('[data-frame-label="login"]');
    await label.dblclick();
    const frameInput = page.getByLabel("Nome do frame");
    expect(await frameInput.inputValue()).toBe("Login · mobile");
    await frameInput.fill("Login revisado");
    await frameInput.press("Enter");
    await expect.poll(() => name("login")).toBe("Login revisado");
    await expect.poll(() => label.textContent()).toBe("Login revisado");
    await expect.poll(() => page.locator('[data-layer-id="login"] .layer-name').textContent()).toBe("Login revisado");

    await page.locator('[data-testid="viewport"]').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect.poll(() => name("login")).toBe("Login · mobile");
  });

  it("overview: volta aos workspaces, cria um, abre no canvas e segue o agente quando ele troca", async () => {
    const demo = (await doc()).id;
    await page.getByRole("link", { name: "Paprika" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    const demoCard = page.locator(`[data-workspace-id="${demo}"]`);
    await expect.poll(() => demoCard.textContent()).toMatch(/Demo.*nós.*ativo/);
    if (shots) await page.screenshot({ path: join(shots, "20-overview.png") });

    await page.getByRole("button", { name: "Novo workspace" }).click();
    await page.getByLabel("Nome do workspace").fill("Rascunho do agente");
    await page.getByRole("button", { name: "Criar" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/w\//);
    await expect.poll(async () => (await doc()).name).toBe("Rascunho do agente");
    await expect.poll(() => page.locator(".doc-name").textContent()).toBe("Rascunho do agente");
    const draft = (await doc()).id;
    expect(new URL(page.url()).pathname).toBe(`/w/${draft}`);
    expect(await page.locator("[data-layer-id]").count()).toBe(0);

    // The agent draws in the open workspace, then switches back to the demo: the canvas follows.
    await agent.callTool({ name: "create_nodes", arguments: { nodes: [{ type: "frame", id: "rasc", name: "Rascunho", width: 200, height: 120, fill: "#ffffff" }] } });
    await page.waitForSelector('[data-paprika-id="rasc"]');
    await agent.callTool({ name: "open_workspace", arguments: { id: demo } });
    await page.waitForSelector('[data-paprika-id="login"]');
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/w/${demo}`);

    // Following the agent replaced the URL, so Back goes to the overview; the draft is listed there.
    await page.goBack();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    await expect.poll(() => page.locator(`[data-workspace-id="${draft}"]`).textContent()).toMatch(/Rascunho do agente1 nó/);
    await page.locator(`[data-workspace-id="${draft}"]`).click();
    await page.waitForSelector('[data-paprika-id="rasc"]');
    await page.goto(`${url}/w/nao-existe`);
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    await expect.poll(() => page.getByRole("alert").textContent()).toContain("nao-existe");
    // Leave the demo active for any later test.
    await agent.callTool({ name: "open_workspace", arguments: { id: demo } });
  });

  it("overview: card sem salto no hover, um clique abre, lápis/F2 renomeia (Enter/Esc) e excluir pede confirmação", async () => {
    const POLL = { timeout: 10_000 };
    const { id: demo, name: demoName } = await doc();
    const api = async () => (await (await fetch(`${url}/api/workspaces`)).json()) as { active: string; workspaces: { id: string; name: string }[] };
    const created = await fetch(`${url}/api/workspaces`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Para apagar" }) });
    const extra = ((await created.json()) as { workspace: { id: string } }).workspace.id;
    await page.goto(url);
    const card = page.locator(`[data-workspace-id="${extra}"]`);
    await expect.poll(() => card.textContent(), POLL).toContain("Para apagar");

    // Hover does not move the card, not even when the pointer goes on to its action buttons
    // (they sit outside the card), and the hover border holds there.
    const top = async () => (await card.boundingBox())!.y;
    const border = () => card.evaluate((el) => getComputedStyle(el).outlineColor);
    const rest = { y: await top(), border: await border() };
    await card.hover();
    await page.waitForTimeout(200); // past the border transition
    const hovered = await border();
    expect(hovered).not.toBe(rest.border);
    expect(await top()).toBe(rest.y);
    await page.getByRole("button", { name: "Excluir Para apagar" }).hover();
    await page.waitForTimeout(200);
    expect(await top()).toBe(rest.y);
    expect(await border()).toBe(hovered);
    if (shots) await page.screenshot({ path: join(shots, "21-overview-hover.png") });

    // The card's edge is an inset outline, painted over the tile and the cover, so they cannot cut its rounded corners.
    expect(await card.evaluate((el) => [getComputedStyle(el).outlineStyle, getComputedStyle(el).outlineOffset, getComputedStyle(el).borderTopWidth])).toEqual(["solid", "-1px", "0px"]);

    // The pencil renames without opening: Esc cancels, Enter commits; clicks in the field stay on the overview.
    await page.getByRole("button", { name: "Renomear Para apagar" }).click();
    const field = page.getByLabel("Novo nome do workspace");
    await field.click();
    await field.fill("Não vale");
    await field.press("Escape");
    await expect.poll(() => card.locator(".workspace-name").textContent()).toBe("Para apagar");
    expect(new URL(page.url()).pathname).toBe("/");
    await card.focus();
    await page.keyboard.press("F2");
    await field.fill("Renomeado");
    if (shots) await page.screenshot({ path: join(shots, "22-overview-renomear.png") });
    await field.press("Enter");
    await expect.poll(() => card.locator(".workspace-name").textContent(), POLL).toBe("Renomeado");
    expect((await api()).workspaces.find((w) => w.id === extra)?.name).toBe("Renomeado");

    // Renaming the active workspace is a document write: the agents see the new name.
    await page.getByRole("button", { name: `Renomear ${demoName}` }).click();
    await field.fill("Demo (renomeado)");
    await field.press("Enter");
    await expect.poll(async () => (await doc()).name, POLL).toBe("Demo (renomeado)");

    // Delete asks first: Cancel keeps it, Excluir removes it.
    await page.getByRole("button", { name: "Excluir Renomeado" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect.poll(() => dialog.textContent()).toContain("Excluir “Renomeado”?");
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect.poll(() => dialog.isVisible()).toBe(false);
    expect((await api()).workspaces.some((w) => w.id === extra)).toBe(true);
    await card.focus();
    await page.keyboard.press("Delete");
    await expect.poll(() => dialog.isVisible()).toBe(true);
    await dialog.getByLabel(/Digite/).fill("Renomeado");
    await dialog.getByRole("button", { name: "Excluir workspace" }).click();
    await expect.poll(() => card.count(), POLL).toBe(0);
    expect((await api()).workspaces.some((w) => w.id === extra)).toBe(false);

    // Deleting the active workspace moves the canvas and the agents to the most recent other one.
    const tmp = ((await agent.callTool({ name: "create_workspace", arguments: { name: "Ativo temporário" } })) as unknown as { structuredContent: { workspace: { id: string } } })
      .structuredContent.workspace.id;
    await agent.callTool({ name: "open_workspace", arguments: { id: tmp } });
    const tmpCard = page.locator(`[data-workspace-id="${tmp}"]`);
    await expect.poll(() => tmpCard.textContent(), POLL).toContain("ativo");
    await page.getByRole("button", { name: "Excluir Ativo temporário" }).click();
    await expect.poll(() => dialog.textContent()).toContain("o canvas e os agentes MCP passam para");
    if (shots) await page.screenshot({ path: join(shots, "23-overview-excluir-ativo.png") });
    await dialog.getByLabel(/Digite/).fill("Ativo temporário");
    await dialog.getByRole("button", { name: "Excluir workspace" }).click();
    await expect.poll(() => tmpCard.count(), POLL).toBe(0);
    await expect.poll(async () => (await api()).active, POLL).not.toBe(tmp);
    await expect.poll(() => page.locator(".workspace-card.is-active").count(), POLL).toBe(1);

    // One click opens a workspace that is not the active one; from the keyboard, Enter (or Space) opens it.
    const next = (await api()).active;
    const made = await fetch(`${url}/api/workspaces`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Destino do clique" }) });
    const otherId = ((await made.json()) as { workspace: { id: string } }).workspace.id;
    await page.reload();
    await page.locator(`[data-workspace-id="${otherId}"]`).click();
    await expect.poll(() => new URL(page.url()).pathname, POLL).toBe(`/w/${otherId}`);
    await expect.poll(async () => (await api()).active, POLL).toBe(otherId);
    await page.goBack();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    await page.locator(`[data-workspace-id="${next}"]`).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => new URL(page.url()).pathname, POLL).toBe(`/w/${next}`);
    await expect.poll(async () => (await api()).active, POLL).toBe(next);
    await fetch(`${url}/api/workspaces/${otherId}`, { method: "DELETE" });

    // Back to the original state for later tests.
    await agent.callTool({ name: "open_workspace", arguments: { id: demo } });
    await agent.callTool({ name: "rename_workspace", arguments: { id: demo, name: demoName } });
    await expect.poll(async () => (await doc()).name, POLL).toBe(demoName);
  });

  it("páginas: renomear a Página 1 implícita cria a página com o nome, leva o conteúdo e desfaz num passo", async () => {
    const POLL = { timeout: 10_000 };
    const demo = (await doc()).id;
    const created = await fetch(`${url}/api/workspaces`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Só uma página" }) });
    const solo = ((await created.json()) as { workspace: { id: string } }).workspace.id;
    await agent.callTool({ name: "open_workspace", arguments: { id: solo } });
    await agent.callTool({ name: "create_nodes", arguments: { nodes: [{ type: "frame", id: "capa", name: "Capa", width: 200, height: 120, fill: "#ffffff" }] } });
    await page.goto(`${url}/w/${solo}`);
    await page.waitForSelector('[data-paprika-id="capa"]');
    const pageNodes = async () => Object.values((await doc()).nodes).filter((n) => n.type === "page");
    expect(await pageNodes()).toHaveLength(0);

    const row = page.getByRole("list", { name: "Páginas" }).locator("li");
    await row.dblclick();
    const input = page.getByLabel("Nome da página");
    expect(await input.inputValue()).toBe("Página 1");
    await input.fill("Abertura");
    await input.press("Enter");

    await expect.poll(async () => (await pageNodes()).length, POLL).toBe(1);
    const d = await doc();
    const [pageId] = d.rootIds as [string];
    expect(d.rootIds).toHaveLength(1);
    expect(d.nodes[pageId]).toMatchObject({ type: "page", name: "Abertura" });
    expect(d.nodes.capa?.parentId).toBe(pageId);
    await expect.poll(() => page.locator(".page.is-active").textContent(), POLL).toContain("Abertura");
    await expect.poll(() => page.locator('[data-paprika-id="capa"]').count(), POLL).toBe(1);

    await page.locator('[data-testid="viewport"]').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await pageNodes()).length, POLL).toBe(0);
    expect((await doc()).nodes.capa?.parentId).toBeNull();
    expect((await doc()).rootIds).toEqual(["capa"]);

    await agent.callTool({ name: "open_workspace", arguments: { id: demo } });
    await fetch(`${url}/api/workspaces/${solo}`, { method: "DELETE" });
  });

  it("overview: capa por arquivo (trocar e remover) e por screenshot do agente; sem capa fica a letra", async () => {
    const POLL = { timeout: 10_000 };
    const { id: demo, name: demoName } = await doc();
    const list = async () => (await (await fetch(`${url}/api/workspaces`)).json()) as { workspaces: { id: string; name: string; cover: string | null }[] };
    await page.goto(url);
    const demoCard = page.locator(`[data-workspace-id="${demo}"]`);
    await expect.poll(() => demoCard.locator(".workspace-tile").textContent(), POLL).toBe(demoName.trim()[0]!.toUpperCase());

    // The human picks an image file for the card.
    const png = Buffer.from(await (await fetch(`${url}/api/screenshot?root=login`)).arrayBuffer());
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: `Adicionar capa de ${demoName}` }).click();
    await (await chooser).setFiles({ name: "capa.png", mimeType: "image/png", buffer: png });
    const img = demoCard.locator("img.workspace-cover");
    await expect.poll(() => img.getAttribute("src"), POLL).toMatch(/\/cover\?v=\d+$/);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), POLL).toBe(true);

    // An agent sets another workspace's cover from one of its frames (it does not need to be active).
    const draft = (await list()).workspaces.find((w) => w.name === "Rascunho do agente");
    expect(draft).toBeDefined();
    const shot = await agent.callTool({ name: "set_workspace_cover", arguments: { id: draft!.id, rootId: "rasc" } });
    expect(shot.isError).toBeFalsy();
    await page.reload();
    await expect.poll(() => page.locator(`[data-workspace-id="${draft!.id}"] img.workspace-cover`).count(), POLL).toBe(1);
    if (shots) {
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(shots, "24-overview-capas.png") });
    }

    // Removing the cover brings the letter back.
    await page.getByRole("button", { name: `Remover capa de ${demoName}` }).click();
    await expect.poll(() => img.count(), POLL).toBe(0);
    await expect.poll(() => demoCard.locator(".workspace-tile").textContent(), POLL).toBe(demoName.trim()[0]!.toUpperCase());
    await agent.callTool({ name: "set_workspace_cover", arguments: { id: draft!.id, clear: true } });
   }, 30_000);

  it("aviso: quando um agente apaga o workspace ativo ou troca de workspace, o canvas diz quem fez, o que foi perdido e leva à overview", async () => {
    const POLL = { timeout: 10_000 };
    const { id: demo, name: demoName } = await doc();
    const structured = (r: unknown) => (r as { structuredContent: Record<string, any> }).structuredContent;
    await page.goto(`${url}/w/${demo}`);
    await page.waitForSelector('[data-paprika-id="login"]');
    const notice = page.locator(".workspace-notice");
    expect(await notice.count()).toBe(0);

    const tmp = structured(await agent.callTool({ name: "create_workspace", arguments: { name: "Aviso temporário" } })).workspace.id as string;
    await agent.callTool({ name: "open_workspace", arguments: { id: tmp } });
    await expect.poll(() => notice.textContent(), POLL).toContain("e2e-agent abriu o workspace “Aviso temporário”");
    await expect.poll(() => new URL(page.url()).pathname, POLL).toBe(`/w/${tmp}`);
    expect(await notice.locator(".workspace-notice-summary").count()).toBe(0);

    // The notice is a polite live region and never takes focus.
    expect(await page.locator(".workspace-notice[role='status']").count()).toBe(1);
    expect(await page.evaluate(() => document.activeElement?.closest(".workspace-notice") ?? null)).toBeNull();

    await agent.callTool({
      name: "create_nodes",
      arguments: { nodes: [{ type: "frame", id: "a1", width: 100, height: 60 }, { type: "frame", id: "a2", width: 100, height: 60 }] },
    });
    await page.waitForSelector('[data-paprika-id="a2"]');

    // Two steps: the summary and the token, then the delete.
    const ask = structured(await agent.callTool({ name: "delete_workspace", arguments: { id: tmp } }));
    expect(ask.needsConfirmation).toBe(true);
    await agent.callTool({ name: "delete_workspace", arguments: { id: tmp, confirmToken: ask.confirmToken } });
    await expect.poll(() => notice.textContent(), POLL).toContain("e2e-agent apagou o workspace “Aviso temporário”");
    await expect.poll(() => notice.locator(".workspace-notice-summary").textContent(), POLL).toMatch(/2 nós.*2 frames/);
    await expect.poll(() => new URL(page.url()).pathname, POLL).not.toBe(`/w/${tmp}`);
    expect(await page.evaluate(() => document.activeElement?.closest(".workspace-notice") ?? null)).toBeNull();
    if (shots) await page.screenshot({ path: join(shots, "25-aviso-apagou.png") });

    await notice.getByRole("button", { name: "Ver workspaces" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    await expect.poll(() => notice.count()).toBe(0);
    await expect.poll(() => page.locator(".workspace-card.is-active").count(), POLL).toBe(1);

    // A rename of the open workspace by an agent shows who did it; the dismiss button closes it.
    await page.goto(`${url}/w/${demo}`);
    await page.waitForSelector('[data-paprika-id="login"]');
    await agent.callTool({ name: "rename_workspace", arguments: { id: demo, name: "Demo do agente" } });
    await expect.poll(() => notice.textContent(), POLL).toContain("e2e-agent renomeou o workspace para “Demo do agente”");
    await notice.getByRole("button", { name: "Dispensar aviso" }).click();
    await expect.poll(() => notice.count()).toBe(0);
    await agent.callTool({ name: "rename_workspace", arguments: { id: demo, name: demoName } });
    await expect.poll(async () => (await doc()).name, POLL).toBe(demoName);
  });

  it("overview: uma rajada de escritas do agente não vira um GET da lista por versão, e o último valor aparece", async () => {
    const POLL = { timeout: 10_000 };
    const { id: demo } = await doc();
    const nodesOf = async () =>
      ((await (await fetch(`${url}/api/workspaces`)).json()) as { workspaces: { id: string; nodes: number }[] }).workspaces.find((w) => w.id === demo)!.nodes;
    await page.goto(url);
    const card = page.locator(`[data-workspace-id="${demo}"]`);
    await expect.poll(() => card.textContent(), POLL).toContain("ativo");
    let gets = 0;
    const onRequest = (r: { method(): string; url(): string }) => {
      if (r.method() === "GET" && new URL(r.url()).pathname === "/api/workspaces") gets++;
    };
    page.on("request", onRequest);
    const ids = Array.from({ length: 20 }, (_, i) => `rajada${i}`);
    try {
      for (const id of ids) await agent.callTool({ name: "create_nodes", arguments: { nodes: [{ type: "rect", id, x: 0, y: 0, width: 8, height: 8 }] } });
      const total = await nodesOf();
      await expect.poll(() => card.textContent(), POLL).toContain(`${total} nós`);
    } finally {
      page.off("request", onRequest);
      await agent.callTool({ name: "delete_nodes", arguments: { ids } });
    }
    // One write per version used to refetch once per version (20 here); the follow is throttled.
    expect(gets).toBeLessThan(ids.length / 2);
  });

  it("painéis laterais redimensionam por arraste e teclado, entre min e max, e a largura persiste", async () => {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await p.goto(`${url}/w/${(await doc()).id}`);
      await p.waitForSelector('[data-paprika-id="login"]');
      const width = (sel: string) => p.locator(sel).evaluate((el) => Math.round(el.getBoundingClientRect().width));
      const left = p.getByRole("separator", { name: "Largura do painel de camadas" });
      const right = p.getByRole("separator", { name: "Largura do painel de propriedades" });
      expect(await width("aside.left")).toBe(240);
      expect(await width("aside.right")).toBe(280);

      const dragBy = async (handle: typeof left, dx: number) => {
        const b = (await handle.boundingBox())!;
        await p.mouse.move(b.x + b.width / 2, b.y + 200);
        await p.mouse.down();
        await p.mouse.move(b.x + b.width / 2 + dx / 2, b.y + 200);
        await p.mouse.move(b.x + b.width / 2 + dx, b.y + 200);
        await p.mouse.up();
      };
      await dragBy(left, 100);
      expect(await width("aside.left")).toBe(340);
      await dragBy(left, 1000); // trava no máximo
      expect(await width("aside.left")).toBe(480);
      await dragBy(left, -290); // trava no mínimo
      expect(await width("aside.left")).toBe(200);

      await dragBy(right, -60); // à direita, arrastar para a esquerda alarga
      expect(await width("aside.right")).toBe(340);
      await right.focus();
      await p.keyboard.press("End");
      expect(await right.getAttribute("aria-valuenow")).toBe("480");
      await p.keyboard.press("ArrowRight");
      expect(await width("aside.right")).toBe(464);

      await p.reload();
      await p.waitForSelector('[data-paprika-id="login"]');
      expect(await width("aside.left")).toBe(200);
      expect(await width("aside.right")).toBe(464);

      await left.dblclick(); // volta ao padrão
      expect(await width("aside.left")).toBe(240);
      expect(await p.evaluate(() => localStorage.getItem("paprika.panel.left"))).toBe("240");
    } finally {
      await p.close();
    }
  });

  it("diagramas: caixa e losango com texto no lugar, seta que prende e segue a forma, apagar leva a seta e o agente desenha com draw_diagram", async () => {
    // CI runners are slower than the 1 s default of expect.poll for a round trip through the server.
    const POLL = { timeout: 10_000 };
    // Abre o canvas do workspace ativo (um teste anterior pode ter deixado a página na visão geral).
    await page.goto(`${url}/w/${(await doc()).id}`);
    await page.waitForSelector('[data-testid="viewport"]');
    // Página nova, vazia: espaço livre para desenhar.
    const pages = async () => Object.values((await doc()).nodes).filter((n) => n.type === "page").map((n) => n.id);
    const pagesBefore = await pages();
    await page.getByTestId("add-page").click();
    // Sem páginas ainda, o + cria a Página 1 (com o conteúdo) e a nova; a nova é a última e abre ativa.
    await expect.poll(async () => (await pages()).length, POLL).toBe(pagesBefore.length ? pagesBefore.length + 1 : 2);
    const pageId = (await doc()).rootIds.at(-1)!;
    await expect.poll(() => page.locator(".page.is-active").getAttribute("data-page-id"), POLL).toBe(pageId);
    const vp = (await page.locator('[data-testid="viewport"]').boundingBox())!;
    const shapes = async () => Object.values((await doc()).nodes).filter((n) => n.type === "shape" && n.parentId === pageId);

    // Caixa: um clique cria no tamanho padrão e já abre o texto para editar.
    await page.keyboard.press("s");
    await page.mouse.click(vp.x + 200, vp.y + 200);
    await expect.poll(async () => (await shapes()).length, POLL).toBe(1);
    await page.getByTestId("shape-text-editor").waitFor();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Início");
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await shapes())[0], POLL).toMatchObject({ shape: "rect", text: "Início", width: 160, height: 80 });
    const first = (await shapes())[0]!.id;

    // Losango pelo botão da barra.
    await page.getByRole("button", { name: "Decisão (losango)" }).click();
    await page.mouse.click(vp.x + 520, vp.y + 200);
    await expect.poll(async () => (await shapes()).length, POLL).toBe(2);
    await page.getByTestId("shape-text-editor").waitFor();
    await page.keyboard.type("Ok?");
    await page.getByTestId("shape-text-editor").blur();
    await expect.poll(async () => (await shapes()).find((n) => n.id !== first), POLL).toMatchObject({ shape: "diamond", text: "Ok?" });
    const second = (await shapes()).find((n) => n.id !== first)!.id;
    await expect.poll(() => page.locator(`[data-paprika-id="${second}"]`).innerText(), POLL).toBe("Ok?");

    // Seta: arrastar de uma forma até a outra; as duas pontas ficam presas.
    const box = async (id: string) => (await page.locator(`[data-paprika-id="${id}"]`).boundingBox())!;
    const a = await box(first);
    const b = await box(second);
    await page.keyboard.press("a");
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
    await expect.poll(() => page.getByTestId("link-draft").count(), POLL).toBe(1);
    await page.mouse.up();
    const connector = async () => Object.values((await doc()).nodes).find((n) => n.type === "connector" && n.parentId === pageId);
    await expect.poll(connector, POLL).toMatchObject({ from: { nodeId: first }, to: { nodeId: second }, route: "elbow" });
    const arrow = (await connector())!;
    const d0 = (arrow as { d: string }).d;

    // Arrastar a forma: a seta acompanha ainda durante o arraste e depois no documento.
    await page.mouse.move(b.x + b.width / 2, b.y + 10);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + 160, { steps: 6 });
    await expect.poll(() => page.locator(`[data-paprika-id="${arrow.id}"] path:not([data-connector-hit])`).getAttribute("d"), POLL).not.toBe(d0);
    await page.mouse.up();
    await expect.poll(async () => ((await connector()) as { d: string } | undefined)?.d, POLL).not.toBe(d0);
    // Seta não redimensiona nem é arrastada: clicar seleciona sem alça.
    const hit = (await page.locator(`[data-paprika-id="${arrow.id}"] path[data-connector-hit]`).boundingBox())!;
    expect(hit.width).toBeGreaterThan(0);
    if (shots) await page.screenshot({ path: join(shots, "16-diagrama-desenhado.png") });

    // Duplo clique na forma edita o texto.
    const a2 = await box(first);
    await page.mouse.dblclick(a2.x + a2.width / 2, a2.y + a2.height / 2);
    await page.getByTestId("shape-text-editor").waitFor();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Começo");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect.poll(async () => (await doc()).nodes[first], POLL).toMatchObject({ text: "Começo" });

    // Apagar a forma leva a seta junto; Ctrl+Z devolve as duas.
    await page.locator(`[data-paprika-id="${first}"]`).click();
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await doc()).nodes[arrow.id], POLL).toBeUndefined();
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => (await doc()).nodes[arrow.id]?.type, POLL).toBe("connector");

    // O agente desenha um fluxograma ao lado, com layout automático.
    const res = await agent.callTool({
      name: "draw_diagram",
      arguments: {
        parentId: pageId,
        nodes: [
          { id: "fx-start", text: "Pedido", shape: "ellipse" },
          { id: "fx-ok", text: "Pago?", shape: "diamond" },
          { id: "fx-ship", text: "Enviar" },
          { id: "fx-note", text: "Lembrar de avisar o cliente", shape: "note" },
        ],
        edges: [{ from: "fx-start", to: "fx-ok" }, { from: "fx-ok", to: "fx-ship", label: "sim" }, { from: "fx-ok", to: "fx-note", dashed: true, label: "não" }],
      },
    });
    expect(res.isError).toBeFalsy();
    await expect.poll(() => page.locator('[data-paprika-id="fx-ok-to-fx-ship"] path').count(), POLL).toBe(2);
    await expect.poll(() => page.locator('[data-paprika-id="fx-ok-to-fx-ship"] [data-connector-label]').textContent(), POLL).toBe("sim");
    // The inspector edits the label: select the arrow in the layers and type a new one.
    await page.locator('[data-layer-id="fx-ok-to-fx-note"] .layer-name').first().click();
    const labelField = page.getByTestId("connector-panel").getByLabel("Rótulo");
    await labelField.fill("talvez");
    await labelField.press("Enter");
    await expect.poll(async () => ((await doc()).nodes["fx-ok-to-fx-note"] as { label?: string }).label, POLL).toBe("talvez");
    await expect.poll(() => page.locator('[data-paprika-id="fx-ok-to-fx-note"] [data-connector-label]').textContent(), POLL).toBe("talvez");
    await page.getByRole("button", { name: "Enquadrar" }).click();
    if (shots) await page.screenshot({ path: join(shots, "17-diagrama-agente.png") });
  }, 30_000);

  it("seta: duplo clique no meio da rota adiciona, edita e remove o rótulo (reta e cotovelo, dentro de um frame), Esc cancela e Ctrl+Z desfaz", async () => {
    const POLL = { timeout: 10_000 };
    await page.keyboard.press("Escape");
    const parentId = (await page.locator(".page.is-active").getAttribute("data-page-id")) ?? (await doc()).rootIds.at(-1)!;
    const frame = await agent.callTool({
      name: "create_nodes",
      arguments: { parentId, nodes: [{ type: "frame", id: "lbl-frame", name: "Rótulos", x: 1400, y: 40, width: 640, height: 360, fill: "#ffffff" }] },
    });
    expect(frame.isError).toBeFalsy();
    const drawn = await agent.callTool({
      name: "draw_diagram",
      arguments: {
        parentId: "lbl-frame",
        direction: "right",
        nodes: [
          { id: "lbl-a", text: "Início", x: 20, y: 150, width: 140, height: 60 },
          { id: "lbl-b", text: "Fim", x: 460, y: 30, width: 140, height: 60 },
          { id: "lbl-c", text: "Erro", x: 460, y: 270, width: 140, height: 60 },
        ],
        edges: [{ from: "lbl-a", to: "lbl-b", route: "straight" }, { from: "lbl-a", to: "lbl-c" }],
      },
    });
    expect(drawn.isError).toBeFalsy();
    await expect.poll(() => page.locator('[data-paprika-id="lbl-a-to-lbl-b"] path').count(), POLL).toBe(2);
    await page.getByRole("button", { name: "Enquadrar" }).click();
    const connector = async (id: string) => (await doc()).nodes[id] as unknown as { id: string; d: string; label?: string; parentId: string };
    await expect.poll(() => page.locator('[data-paprika-id="lbl-a-to-lbl-b"] path').count(), POLL).toBe(2);
    expect((await connector("lbl-a-to-lbl-b")).parentId).toBe("lbl-frame");
    const editor = page.getByTestId("connector-label-editor");
    const dblclickMiddle = async (id: string) => {
      const at = connectorMidpoint((await connector(id)).d)!;
      const p = await page.locator(`[data-paprika-id="${id}"] path[data-connector-hit]`).evaluate((el, pt) => {
        const m = (el as SVGPathElement).getScreenCTM()!;
        return { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f };
      }, at);
      await page.mouse.dblclick(p.x, p.y);
      await page.waitForTimeout(400);
    };
    const labelOf = async (id: string) => (await connector(id)).label;
    const history = async () => {
      const hist = (await agent.callTool({ name: "get_history", arguments: {} })) as { content: { text: string }[] };
      return JSON.parse(hist.content[0]!.text).at(-1);
    };

    for (const id of ["lbl-a-to-lbl-b", "lbl-a-to-lbl-c"]) {
      await dblclickMiddle(id);
      await editor.waitFor();
      await expect.poll(() => editor.inputValue(), POLL).toBe("");
      await page.keyboard.type("sim");
      await page.keyboard.press("Enter");
      await expect.poll(() => labelOf(id), POLL).toBe("sim");
      await expect.poll(() => page.locator(`[data-paprika-id="${id}"] [data-connector-label]`).textContent(), POLL).toBe("sim");
      await expect.poll(() => editor.count(), POLL).toBe(0);
      expect(await history()).toMatchObject({ actor: "user", label: "editar rótulo" });
      if (shots && id === "lbl-a-to-lbl-b") await page.screenshot({ path: join(shots, "18-seta-com-rotulo.png") });

      await dblclickMiddle(id);
      await editor.waitFor();
      await expect.poll(() => editor.inputValue(), POLL).toBe("sim");
      if (shots && id === "lbl-a-to-lbl-b") await page.screenshot({ path: join(shots, "19-seta-editando-rotulo.png") });
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("talvez");
      await page.keyboard.press("Enter");
      await expect.poll(() => labelOf(id), POLL).toBe("talvez");

      await dblclickMiddle(id);
      await editor.waitFor();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("outro");
      await page.keyboard.press("Escape");
      await expect.poll(() => editor.count(), POLL).toBe(0);
      expect(await labelOf(id)).toBe("talvez");

      await dblclickMiddle(id);
      await editor.waitFor();
      await editor.fill("");
      await page.keyboard.press("Enter");
      await expect.poll(async () => "label" in (await connector(id)), POLL).toBe(false);
      await expect.poll(() => page.locator(`[data-paprika-id="${id}"] [data-connector-label]`).count(), POLL).toBe(0);

      await page.keyboard.press("ControlOrMeta+z");
      await expect.poll(() => labelOf(id), POLL).toBe("talvez");
    }

    // Duplo clique numa forma continua editando o texto da forma.
    const shape = (await page.locator('[data-paprika-id="lbl-a"]').boundingBox())!;
    await page.mouse.dblclick(shape.x + shape.width / 2, shape.y + shape.height / 2);
    await page.getByTestId("shape-text-editor").waitFor();
    expect(await editor.count()).toBe(0);
    await page.keyboard.press("Escape");
  }, 60_000);

  it("seleção mostra quatro alças e arrastar o canto NW mantém o SE fixo", async () => {
    const POLL = { timeout: 10_000 };
    await page.keyboard.press("Escape");
    const pageId = page.locator(".page.is-active");
    const parentId = (await pageId.getAttribute("data-page-id")) ?? (await doc()).rootIds.at(-1)!;
    const id = "resize-four-corners";
    const created = await agent.callTool({
      name: "create_nodes",
      arguments: {
        parentId,
        label: "retângulo para redimensionar",
        nodes: [{ type: "rect", id, name: "Resize me", x: 40, y: 40, width: 160, height: 100, fill: "#d9d4cf" }],
      },
    });
    expect(created.isError).toBeFalsy();
    await expect.poll(async () => (await doc()).nodes[id]?.type, POLL).toBe("rect");
    await page.getByRole("button", { name: "Enquadrar" }).click();
    await page.locator(`[data-paprika-id="${id}"]`).click();
    const sel = page.getByTestId("selection");
    await expect.poll(() => sel.locator("[data-resize]").count(), POLL).toBe(4);
    const before = (await doc()).nodes[id] as { x: number; y: number; width: number; height: number };
    const seBefore = { x: before.x + before.width, y: before.y + before.height };
    const handle = (await sel.locator('[data-resize="nw"]').boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 - 30, handle.y + handle.height / 2 - 20, { steps: 6 });
    await page.mouse.up();
    await expect
      .poll(async () => {
        const n = (await doc()).nodes[id] as { x: number; y: number; width: number; height: number };
        return n.width > before.width && n.height > before.height;
      }, POLL)
      .toBe(true);
    const after = (await doc()).nodes[id] as { x: number; y: number; width: number; height: number };
    expect(after.x + after.width).toBeCloseTo(seBefore.x, 0);
    expect(after.y + after.height).toBeCloseTo(seBefore.y, 0);
    expect(after.x).toBeLessThan(before.x);
    expect(after.y).toBeLessThan(before.y);
  }, 30_000);
});
