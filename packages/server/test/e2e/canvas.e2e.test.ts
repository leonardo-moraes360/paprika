import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { copyId, type Document } from "@paprika/core";
import { DocumentStore, closeBrowser, startHttpServer, type RunningServer } from "../../src/index.js";
import { goBin, impl, startServer, type ExternalServer } from "../external/harness.js";

const root = resolve(import.meta.dirname, "../../../..");
const webRoot = join(root, "apps/web/dist");
const shots = process.env.PAPRIKA_E2E_SHOTS;

// PAPRIKA_SERVER_BIN=<binário Go> roda o mesmo E2E contra o servidor Go (processo externo).
describe.skipIf(!existsSync(webRoot))(`E2E (${impl}): canvas + agente via MCP`, () => {
  let dir: string;
  let store: DocumentStore | undefined;
  let http: RunningServer | undefined;
  let external: ExternalServer | undefined;
  let url: string;
  /** Documento atual: em processo (TS) ou via GET /api/document (servidor externo). */
  const doc = async (): Promise<Document> => (external ? external.doc() : store!.doc);
  let browser: Browser;
  let page: Page;
  let agent: Client;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "paprika-e2e-"));
    const file = join(dir, "demo.paprika.json");
    await copyFile(join(root, "examples/demo.paprika.json"), file);
    if (goBin) {
      external = await startServer({ seed: file, webRoot });
      url = external.url;
    } else {
      store = await DocumentStore.open(file);
      http = await startHttpServer(store, { host: "127.0.0.1", port: 0, webRoot });
      url = http.url;
    }
    browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(url);
    await page.waitForSelector('[data-paprika-id="login"]');
    expect(errors).toEqual([]);
    agent = new Client({ name: "e2e-agent", version: "0" });
    await agent.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
  }, 60_000);

  afterAll(async () => {
    await agent?.close();
    await browser?.close();
    await http?.close();
    await closeBrowser();
    await store?.close();
    await external?.stop();
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
    await expect.poll(async () => (await doc()).nodes.plano?.x).not.toBe(460);
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
});
