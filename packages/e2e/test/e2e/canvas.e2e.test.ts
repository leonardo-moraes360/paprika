import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Browser, type Page } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { connectorMidpoint, copyId, type Document, type FrameNode } from "@paprika/core";
import { closeSeededCanvas, connectAgent, openSeededCanvas, revealLayer, type CanvasSession } from "./seededCanvas.js";
import { pinLocale } from "./locale.js";
import { type ExternalServer } from "../harness.js";

const shots = process.env.PAPRIKA_E2E_SHOTS;

describe("E2E: canvas + agente via MCP", () => {
  let session: CanvasSession | undefined;
  const clients: Client[] = [];
  let external: ExternalServer | undefined;
  let url: string;
  const doc = async (): Promise<Document> => external!.doc();
  let browser: Browser;
  let page: Page;
  let agent: Client;

  beforeAll(async () => {
    session = await openSeededCanvas("paprika-e2e-canvas-");
    ({ external, url, browser, page } = session);
    page.setDefaultTimeout(8_000);
    expect(new URL(page.url()).pathname).toBe(`/w/${(await doc()).id}`);
    agent = await connectAgent(url, "e2e-agent", clients);
  }, 60_000);

  afterAll(async () => {
    await closeSeededCanvas(session, clients);
  });

  const viewport = () => page.locator('[data-testid="viewport"]');
  const world = () => page.locator('[data-testid="canvas-world"]');
  const layer = (id: string) => page.locator(`[data-layer-id="${id}"]`);
  const selectedIds = () => page.locator('[data-layer-id][aria-selected="true"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-layer-id")));
  const clickEmpty = () => viewport().click({ position: { x: 5, y: 5 } });
  const openSection = async (name: string) => {
    const trigger = page.getByRole("button", { name, exact: true });
    if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  };
  const openPageById = async (id: string) => pageButton((await doc()).nodes[id]!.name!).click();
  const layersMenu = async (name: string) => {
    await page.getByRole("button", { name: "Mais ações de camadas" }).click();
    await page.getByRole("menuitem", { name }).click();
  };
  const pagesList = () => page.getByRole("list", { name: "Páginas", exact: true });
  const pageButton = (name: string) => pagesList().getByRole("button", { name, exact: true });
  const activePageName = () => pagesList().locator("[data-active]").innerText();
  const agentsDialog = () => page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Agentes no workspace" }) });
  const openAgents = async () => {
    if ((await agentsDialog().count()) === 0) await page.getByRole("button", { name: /ativos?$/ }).click();
    return agentsDialog();
  };
  const closeAgents = async () => {
    if ((await agentsDialog().count()) > 0) await page.keyboard.press("Escape");
    await expect.poll(() => agentsDialog().count()).toBe(0);
  };
  const agentRow = async (name: string) => (await openAgents()).locator("li[data-agent]").filter({ has: page.getByText(name, { exact: true }) });
  const menuAction = async (name: string) => {
    await page.getByRole("button", { name: "Mais ações", exact: true }).click();
    await page.getByRole("menuitem", { name }).click();
  };

  it("a aba aberta informa o renderizador DOM no outline", async () => {
    const outline = (await agent.callTool({ name: "get_document_outline", arguments: { depth: 0 } })) as { content: { text: string }[] };
    expect(outline.content[0]!.text.split("\n").find((l) => l.startsWith("renderer:"))).toBe("renderer: dom");
  });

  it("renderiza o documento com camadas e frames", async () => {
    await expect(page.locator('[data-layer-id="login"]').textContent()).resolves.toContain("Login · mobile");
    await expect(page.locator('[data-paprika-id="login"]').innerText()).resolves.toContain("Bem-vindo de volta");
    await expect(page.getByRole("heading", { name: "Workspace", exact: true }).count()).resolves.toBe(1);
    if (shots) await page.screenshot({ path: join(shots, "01-carregado.png") });
  });

  it("toolbar flutua centralizada no topo do canvas", async () => {
    const vp = (await page.locator('[data-testid="viewport"]').boundingBox())!;
    const bar = (await page.getByRole("toolbar", { name: "Ferramentas" }).boundingBox())!;
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
    const box = page.locator('[data-agent-box="rodape"]');
    await expect.poll(() => box.evaluate((e) => getComputedStyle(e).display)).toBe("block");
    await expect.poll(() => page.getByTestId("agent-frame-state").first().innerText()).toContain("e2e-agent");
    if (shots) await page.screenshot({ path: join(shots, "02-agente-editou.png") });
  });

  it("atividade: escrita MCP mostra o nome do agente e undo move o marcador", async () => {
    await clickEmpty();
    const trigger = page.getByRole("button", { name: "Atividade", exact: true });
    if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
    await agent.callTool({
      name: "create_nodes",
      arguments: {
        nodes: [{ type: "rect", id: "act025", x: 20, y: 20, width: 12, height: 12, fill: "#3b82f6" }],
        label: "retângulo atividade",
      },
    });
    const list = page.getByRole("list", { name: "Atividade", exact: true });
    const rows = list.locator("li:not([aria-label])");
    const row = rows.filter({ hasText: "e2e-agent" }).first();
    await expect.poll(() => row.innerText()).toMatch(/retângulo atividade/);
    const marker = list.locator('li[aria-label="agora"]');
    const indexOf = (el: Element) => [...el.parentElement!.children].indexOf(el);
    const before = await marker.evaluate(indexOf);
    expect(before).toBe(0);
    await layer("login").click();
    await clickEmpty();
    const plano = (await page.locator('[data-paprika-id="plano"]').boundingBox())!;
    await page.mouse.click(plano.x + 8, plano.y + 8);
    await page.keyboard.press("ArrowRight");
    await clickEmpty();
    await expect.poll(() => rows.first().innerText()).toMatch(/mover/);
    await menuAction("Desfazer");
    await expect.poll(() => marker.evaluate(indexOf)).toBeGreaterThan(before);
    await expect.poll(() => rows.first().innerText()).toMatch(/desfazer:/);
    await agent.callTool({ name: "delete_nodes", arguments: { ids: ["act025"] } });
    await agent.callTool({
      name: "create_nodes",
      arguments: {
        parentId: "plano",
        nodes: [{ type: "rect", id: "act025-keep", x: 0, y: 0, width: 4, height: 4 }],
      },
    });
  });

  it("presença: cada agente tem cursor, seleção e cor próprios; o cursor desliza até os nós em que ele age", async () => {
    const cursor = page.locator('[data-testid="agent-cursor"]');
    await expect.poll(() => cursor.count()).toBe(1);
    const plano = (await page.locator('[data-paprika-id="plano"]').boundingBox())!;
    const inside = (b: { x: number; y: number }, r: { x: number; y: number; width: number; height: number }) =>
      b.x >= r.x && b.x <= r.x + r.width && b.y >= r.y && b.y <= r.y + r.height;
    const tip = async (i: number) => (await cursor.nth(i).locator('svg[viewBox="0 0 18 22"]').boundingBox())!;
    await expect.poll(async () => inside(await tip(0), plano)).toBe(true);

    const other = new Client({ name: "e2e-leitor", version: "0" });
    await other.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
    try {
      await other.callTool({ name: "get_nodes", arguments: { ids: ["login"] } });
      await expect.poll(() => cursor.count()).toBe(2);
      await page.getByRole("button", { name: /ativos?$/ }).click();
      const roster = page.getByRole("dialog").locator("li[data-agent]");
      await expect.poll(() => roster.allInnerTexts().then((rows) => rows.map((r) => r.replace(/\s+/g, " ")))).toEqual([expect.stringMatching(/^e2e-agent .*create_nodes/), expect.stringMatching(/^e2e-leitor .*get_nodes/)]);
      await expect.poll(() => roster.evaluateAll((els) => els.map((e) => e.getAttribute("data-activity")))).toEqual(["writing", "reading"]);
      const colors = await cursor.evaluateAll((els) => els.map((e) => getComputedStyle(e.querySelector('svg[viewBox="0 0 18 22"] path')!).fill));
      expect(new Set(colors).size).toBe(2);
      const login = (await page.locator('[data-paprika-id="login"]').boundingBox())!;
      await expect.poll(async () => inside(await tip(1), login)).toBe(true);

      await agent.callTool({ name: "update_nodes", arguments: { updates: [{ id: "login", props: { notes: "revisado" } }] } });
      await expect.poll(async () => inside(await tip(0), login), { timeout: 3000 }).toBe(true);
      await expect.poll(() => roster.first().innerText()).toContain("update_nodes");
      if (shots) await page.screenshot({ path: join(shots, "02b-agentes-presentes.png") });
      await page.keyboard.press("Escape");
    } finally {
      await other.close();
    }
  });

  // PAP-E2E: dois agentes com o mesmo nome dividem o tom (o tom é por nome do ator, não por sessão); o app antigo dava uma cor por sessão
  it.fails("presença: dois agentes com o mesmo nome têm cursores de cores diferentes", async () => {
    const twin = new Client({ name: "e2e-agent", version: "0" });
    await twin.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`)));
    try {
      await agent.callTool({ name: "get_nodes", arguments: { ids: ["login"] } });
      await twin.callTool({ name: "get_nodes", arguments: { ids: ["plano"] } });
      await page.getByRole("button", { name: /ativos?$/ }).click();
      const rows = page.getByRole("dialog").locator("li[data-agent]").filter({ hasText: /^e2e-agent( \d+)?\s*get_nodes/ });
      await expect.poll(() => rows.count()).toBe(2);
      const ids = await rows.evaluateAll((els) => els.map((e) => e.getAttribute("data-agent")!));
      const fills = await Promise.all(
        ids.map((id) => page.locator(`[data-testid="agent-cursor"][data-agent="${id}"] svg[viewBox="0 0 18 22"] path`).evaluate((el) => getComputedStyle(el).fill)),
      );
      expect(new Set(fills).size).toBe(2);
    } finally {
      await page.keyboard.press("Escape");
      await twin.close();
    }
  });

  it("humano arrasta um frame e o agente lê a nova posição", async () => {
    const frame = page.locator('[data-paprika-id="plano"]');
    const box = (await frame.boundingBox())!;
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
    const pickOnCanvas = async (id: string) => {
      const b = (await page.locator(`[data-paprika-id="${id}"]`).boundingBox())!;
      await page.mouse.click(b.x + 8, b.y + 8);
      await expect.poll(selectedIds).toEqual([id]);
    };
    const order = page.getByRole("button", { name: "Ordem", exact: true });

    await pickOnCanvas("login");
    await page.keyboard.press("PageUp");
    await expect.poll(roots).toEqual(["plano", "login"]);
    await page.keyboard.press("Control+z");
    await expect.poll(roots).toEqual(["login", "plano"]);

    await pickOnCanvas("login");
    if ((await order.getAttribute("aria-expanded")) !== "true") await order.click();
    await page.getByRole("button", { name: "Trazer para frente" }).click();
    await expect.poll(roots).toEqual(["plano", "login"]);
    await page.keyboard.press("Control+z");
    await expect.poll(roots).toEqual(["login", "plano"]);

    await pickOnCanvas("login");
    await page.keyboard.press("Control+PageDown");
    await expect.poll(roots).toEqual(["login", "plano"]);

    const nameInput = page.getByLabel("Nome", { exact: true });
    await nameInput.click();
    await page.keyboard.press("PageUp");
    await expect.poll(roots).toEqual(["login", "plano"]);
    await expect.poll(async () => (await doc()).nodes.login?.name).toBe("Login · mobile");
  });

  it("inspector: Opacidade (em %) recusa letras, cola inválida e limita ao intervalo 0–100", async () => {
    await page.locator('[data-layer-id="plano"]').click();
    const opacity = page.getByLabel("Opacidade", { exact: true });
    const notice = page.getByRole("alert").filter({ hasText: "Use um número entre 0 e 100." });
    await expect.poll(() => opacity.inputValue()).toBe("100");

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
    await expect.poll(() => notice.count()).toBeGreaterThan(0);
    await expect.poll(async () => ((await doc()).nodes.plano as FrameNode | undefined)?.opacity).toBe(1);

    await opacity.click({ clickCount: 3 });
    await opacity.pressSequentially("50");
    await opacity.press("Enter");
    await expect.poll(async () => ((await doc()).nodes.plano as FrameNode | undefined)?.opacity).toBe(0.5);
    await expect.poll(() => opacity.inputValue()).toBe("50");

    await opacity.click({ clickCount: 3 });
    await opacity.pressSequentially("200");
    await opacity.press("Enter");
    await expect.poll(async () => ((await doc()).nodes.plano as FrameNode | undefined)?.opacity).toBe(1);
    await expect.poll(() => opacity.inputValue()).toBe("100");
    await expect.poll(() => notice.count()).toBeGreaterThan(0);
  });

  it("inspector: steppers ± em Opacidade (1 %, Shift×10) existem nos campos numéricos e não nos de token", async () => {
    await page.locator('[data-layer-id="plano"]').click();
    const opacity = page.getByLabel("Opacidade", { exact: true });
    const value = async () => ((await doc()).nodes.plano as FrameNode | undefined)?.opacity;
    // O painel mostra mudanças do documento no máximo a cada 100 ms: espera o campo assentar entre um passo e o próximo.
    const settled = async (text: string) => {
      await expect.poll(() => opacity.inputValue()).toBe(text);
      await page.waitForTimeout(150);
    };
    await opacity.click({ clickCount: 3 });
    await opacity.pressSequentially("50");
    await opacity.press("Enter");
    await expect.poll(value).toBe(0.5);
    await settled("50");

    const up = page.getByLabel("Aumentar Opacidade", { exact: true });
    await up.click();
    await expect.poll(value).toBe(0.51);
    await settled("51");

    await opacity.click();
    await page.keyboard.press("ArrowDown");
    await expect.poll(value).toBe(0.5);
    await settled("50");

    await page.keyboard.press("Shift+ArrowUp");
    await expect.poll(value).toBe(0.6);
    await settled("60");
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Shift+ArrowUp");
      await settled(String(Math.min(100, 70 + i * 10)));
    }
    await expect.poll(value).toBe(1);
    await expect.poll(() => up.isDisabled()).toBe(true);

    await expect.poll(() => page.getByLabel("Aumentar Largura", { exact: true }).count()).toBe(1);
    await expect.poll(() => page.getByLabel("Aumentar Preenchimento", { exact: false }).count()).toBe(0);
    await expect.poll(() => page.getByLabel("Aumentar $brand", { exact: false }).count()).toBe(0);
  });

  // PAP-E2E: três setas seguidas no campo numérico dão 2 passos (o painel só relê o documento a cada 100 ms) e o campo pode ficar com o valor velho
  it.fails("inspector: três setas seguidas no campo de Opacidade dão três passos e o campo mostra o valor do documento", async () => {
    await page.locator('[data-layer-id="plano"]').click();
    const opacity = page.getByLabel("Opacidade", { exact: true });
    await opacity.click({ clickCount: 3 });
    await opacity.pressSequentially("50");
    await opacity.press("Enter");
    await expect.poll(() => opacity.inputValue()).toBe("50");
    await page.waitForTimeout(300);
    for (const key of ["ArrowUp", "ArrowUp", "ArrowUp"]) await page.keyboard.press(key);
    await expect.poll(async () => ((await doc()).nodes.plano as FrameNode | undefined)?.opacity).toBe(0.53);
    await page.waitForTimeout(1500);
    expect(await opacity.inputValue()).toBe("53");
  });

  it("inspector: color picker grava $token, hex, rgba e devolve o foco no Esc", async () => {
    const POLL = { timeout: 10_000 };
    await page.locator('[data-layer-id="plano"]').click();
    const fillTrigger = page.getByRole("button", { name: /^Preenchimento (?!e traço)/ });
    await expect.poll(() => fillTrigger.count(), POLL).toBe(1);
    await fillTrigger.click();
    const picker = page.locator('[role="dialog"][aria-label="Seletor de cor de Preenchimento"]');
    await expect.poll(() => picker.count(), POLL).toBe(1);
    const fillOf = async () => ((await doc()).nodes.plano as FrameNode | undefined)?.fill;

    const value = picker.getByLabel("Valor", { exact: true });
    await value.fill("$brand");
    await value.press("Enter");
    await expect.poll(fillOf, POLL).toBe("$brand");
    await expect.poll(() => value.inputValue(), POLL).toBe("$brand");

    const hex = picker.getByLabel("Valor hexadecimal");
    await hex.click({ clickCount: 3 });
    await hex.fill("#112233");
    await hex.press("Enter");
    await expect.poll(fillOf, POLL).toBe("#112233");

    await picker.getByRole("slider", { name: "Alfa" }).focus();
    for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowLeft");
    await expect.poll(async () => String((await fillOf()) ?? ""), POLL).toMatch(/^(rgba\(|#[0-9a-f]{8}$)/i);

    await page.keyboard.press("Escape");
    await expect.poll(() => picker.count(), POLL).toBe(0);
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-haspopup") ?? ""), POLL).toBe("dialog");
    await expect.poll(() => fillTrigger.evaluate((el) => el === document.activeElement), POLL).toBe(true);

    await fillTrigger.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => picker.count(), POLL).toBe(1);
    const before = await fillOf();
    await picker.getByRole("slider", { name: "Saturação e brilho" }).focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowUp");
    await expect.poll(fillOf, POLL).not.toBe(before);
    await page.keyboard.press("Escape");
    await expect.poll(() => picker.count(), POLL).toBe(0);

    await page.evaluate(() => {
      class Stub {
        open() {
          return Promise.resolve({ sRGBHex: "#abcdef" });
        }
      }
      Object.defineProperty(window, "EyeDropper", { value: Stub, configurable: true });
    });
    await fillTrigger.click();
    await picker.getByRole("button", { name: "Capturar uma cor da tela" }).click();
    await expect.poll(fillOf, POLL).toBe("#abcdef");
    await page.keyboard.press("Escape");
    await expect.poll(() => picker.count(), POLL).toBe(0);

    await page.evaluate(() => {
      delete (window as unknown as { EyeDropper?: unknown }).EyeDropper;
    });
    await fillTrigger.click();
    await picker.getByRole("button", { name: "Capturar uma cor da tela" }).click();
    await expect.poll(() => page.locator('[data-testid="viewport"][data-sampling]').count(), POLL).toBe(1);
    await page.keyboard.press("Escape");
    await expect.poll(() => page.locator('[data-testid="viewport"][data-sampling]').count(), POLL).toBe(0);
  }, 25_000);

  it("inspector: FontPicker troca a família e aceita fonte digitada", async () => {
    const POLL = { timeout: 10_000 };
    await page.locator('[data-layer-id="8succ2i53s"]').click();
    const family = async () => {
      const n = (await doc()).nodes["8succ2i53s"];
      return n?.type === "text" ? n.fontFamily : undefined;
    };

    const input = page.getByRole("combobox", { name: "Fonte", exact: true });
    await expect.poll(() => input.count(), POLL).toBe(1);
    await page.getByRole("button", { name: "Mostrar fontes" }).click();
    const list = page.getByRole("listbox");
    await expect.poll(() => list.count(), POLL).toBe(1);
    await list.getByRole("option", { name: "Georgia" }).click();
    await expect.poll(family, POLL).toBe("Georgia, serif");
    await expect.poll(() => input.inputValue(), POLL).toMatch(/Georgia/);

    await input.click();
    await input.fill("Comic Sans MS");
    await input.press("Enter");
    await expect.poll(family, POLL).toBe("Comic Sans MS");

    await page.getByRole("button", { name: "Mostrar fontes" }).click();
    await expect.poll(() => page.getByRole("button", { name: "Usar fontes do sistema…" }).count(), POLL).toBe(1);
    await page.keyboard.press("Escape");
    await expect.poll(() => list.count(), POLL).toBe(0);
  });

  it("ferramenta de retângulo desenha dentro do frame sob o cursor", async () => {
    await page.keyboard.press("Escape");
    const before = Object.keys((await doc()).nodes).length;
    await page.getByRole("button", { name: "Retângulo" }).click();
    const vp = (await page.locator('[data-testid="viewport"]').boundingBox())!;
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
    expect(await ghost.evaluate((el) => el.closest('[aria-hidden="true"]') !== null)).toBe(true);
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

  it("roda do mouse: Shift+roda move só o X do mundo, roda simples só o Y", async () => {
    await page.keyboard.press("Escape");
    const vp = (await page.locator('[data-testid="viewport"]').boundingBox())!;
    const translate = async () => {
      const t = (await world().getAttribute("style"))!.match(/translate\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px/)!;
      return { x: Number(t[1]), y: Number(t[2]) };
    };
    await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2);
    const a = await translate();
    await page.keyboard.down("Shift");
    await page.mouse.wheel(0, 120);
    await page.keyboard.up("Shift");
    await expect.poll(async () => (await translate()).x).toBeCloseTo(a.x - 120, 0);
    expect((await translate()).y).toBeCloseTo(a.y, 0);
    const b = await translate();
    await page.mouse.wheel(0, 90);
    await expect.poll(async () => (await translate()).y).toBeCloseTo(b.y - 90, 0);
    expect((await translate()).x).toBeCloseTo(b.x, 0);
    await page.mouse.wheel(0, -90);
    await page.keyboard.down("Shift");
    await page.mouse.wheel(0, -120);
    await page.keyboard.up("Shift");
    await expect.poll(async () => (await translate()).x).toBeCloseTo(a.x, 0);
    await expect.poll(async () => (await translate()).y).toBeCloseTo(a.y, 0);
  });

  for (const key of ["Space", "Enter"]) {
    // PAP-E2E: segurar Enter não vira mão aberta no app novo (só Space move o board); o antigo aceitava as duas teclas
    (key === "Enter" ? it.fails : it)(`segurar ${key} sobre o board vira mão aberta; arrastando, mão fechada que move o board`, async () => {
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await clickEmpty();
      const vp = page.locator('[data-testid="viewport"]');
      const board = world();
      const box = (await vp.boundingBox())!;
      const cursorAt = (x: number, y: number) =>
        page.evaluate(([x, y]) => getComputedStyle(document.elementFromPoint(x!, y!)!).cursor, [x, y]);
      const card = (await page.locator('[data-paprika-id="login"]').boundingBox())!;
      const px = card.x + 40;
      const py = card.y + 40;
      await page.mouse.move(px, py);
      await expect.poll(() => cursorAt(px, py)).not.toBe("grab");
      const before = await board.getAttribute("style");

      await page.keyboard.down(key);
      await expect.poll(() => cursorAt(px, py)).toBe("grab");
      await page.mouse.down();
      await page.mouse.move(px + 80, py + 50, { steps: 6 });
      await expect.poll(() => cursorAt(px + 80, py + 50)).toBe("grabbing");
      await page.mouse.up();
      await expect.poll(() => cursorAt(px + 80, py + 50)).toBe("grab");
      await page.keyboard.up(key);
      await expect.poll(() => cursorAt(px + 80, py + 50)).not.toMatch(/grab/);

      expect(await board.getAttribute("style")).not.toBe(before);
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
    await page.mouse.move(b.x + 40, b.y + 40, { steps: 5 });
    await page.mouse.up();
    await page.mouse.click(c.x, c.y);
    await expect.poll(() => page.locator('[data-testid="pen-overlay"]').count()).toBe(1);
    if (shots) await page.screenshot({ path: join(shots, "05-caneta-desenhando.png") });
    await page.mouse.click(a.x, a.y);

    const findPath = async () => Object.values((await doc()).nodes).find((n) => n.type === "path" && n.name === "Vetor 1");
    await expect.poll(findPath).toBeTruthy();
    const path = (await findPath())!;
    if (path.type !== "path") throw new Error("esperava path");
    expect(path.d).toMatch(/^M[\d.]+ [\d.]+ C/);
    expect(path.d).toContain(" C");
    expect(path.d.endsWith("Z")).toBe(true);
    expect(path.fill).toBeTruthy();
    expect(path.parentId).toBeNull();
    await expect.poll(() => page.locator(`svg[data-paprika-id="${path.id}"] path`).getAttribute("d")).toBe(path.d);
    const drawn = (await page.locator(`svg[data-paprika-id="${path.id}"]`).boundingBox())!;
    expect(drawn.x).toBeLessThanOrEqual(a.x + 1);
    expect(drawn.x + drawn.width).toBeGreaterThanOrEqual(b.x - 1);
    expect(drawn.y + drawn.height).toBeGreaterThanOrEqual(c.y - 1);
    expect(await page.locator('[data-testid="pen-overlay"]').count()).toBe(0);
    await expect.poll(() => page.getByRole("button", { name: "Selecionar" }).getAttribute("aria-pressed")).toBe("true");
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
    expect(await page.locator('[data-testid="viewport"]').getAttribute("data-pan")).toBeNull();
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

  it("stroke style e position: tracejado dentro e sólido fora no canvas", async () => {
    await agent.callTool({
      name: "update_nodes",
      arguments: {
        updates: [
          { id: "login", props: { stroke: { color: "#1e2336", width: 2, style: "dashed", position: "inside" } } },
          { id: "plano", props: { stroke: { color: "#c43d27", width: 4, style: "solid", position: "outside" } } },
        ],
      },
    });
    await expect.poll(async () => (await doc()).nodes.login).toMatchObject({
      stroke: { style: "dashed", position: "inside", width: 2 },
    });
    await expect.poll(async () => (await doc()).nodes.plano).toMatchObject({
      stroke: { style: "solid", position: "outside", width: 4 },
    });
    const login = page.locator('[data-paprika-id="login"]');
    const plano = page.locator('[data-paprika-id="plano"]');
    await expect.poll(() => login.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("dashed");
    await expect.poll(() => plano.evaluate((el) => [getComputedStyle(el).outlineStyle, getComputedStyle(el).outlineOffset])).toEqual(["solid", "0px"]);
    await page.locator('[data-layer-id="login"]').click();
    await expect.poll(() => page.getByTestId("selection").getAttribute("data-count")).toBe("1");
    const appearance = page.getByRole("button", { name: "Preenchimento e traço" });
    if ((await appearance.getAttribute("aria-expanded")) !== "true") await appearance.click();
    await expect.poll(() => page.getByRole("combobox", { name: "Estilo da borda" }).innerText()).toMatch(/tracejado/);
    await expect.poll(() => page.getByRole("combobox", { name: "Posição da borda" }).innerText()).toMatch(/dentro/);
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
    await page.locator('[data-layer-id="plano"]').click({ modifiers: ["ControlOrMeta"] });
    await expect.poll(() => page.getByTestId("selection").getAttribute("data-count")).toBe("2");
    await expect(page.getByTestId("multi-panel").textContent()).resolves.toContain("2");

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
    const picked = selectedIds;
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

    await page.locator('[data-testid="viewport"]').click({ position: { x: 5, y: 5 } });
    const card = (await page.locator('[data-paprika-id="plano"]').boundingBox())!;
    await page.mouse.click(card.x + 6, card.y + 6);
    await expect.poll(() => selectedIds().then((ids) => ids[0])).toBe(g);
    await page.mouse.dblclick(card.x + 6, card.y + 6);
    await expect.poll(() => selectedIds().then((ids) => ids[0])).toBe("plano");

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
    expect((after.nodes.plano as { x: number }).x).toBeGreaterThan((before.nodes.plano as { x: number }).x + gx + 20);
  });

  it("hierarquia: Enter desce, Tab cicla irmãos, Ctrl+clique entra no grupo e o clique direito lista as camadas", async () => {
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Selecionar" }).click();
    const marca = (await page.locator('[data-paprika-id="r0980ga944"]').boundingBox())!;
    await page.mouse.click(marca.x + 8, marca.y + 8);
    await expect.poll(() => selectedIds().then((ids) => ids[0])).toBe("r0980ga944");
    await page.keyboard.press("Escape");
    await expect.poll(() => selectedIds().then((ids) => ids[0])).toBe("login");
    await page.keyboard.press("Enter");
    const picked = selectedIds;
    const kids = ((await doc()).nodes.login as { children: string[] }).children;
    await expect.poll(picked).toEqual(kids);

    await page.keyboard.press("Escape");
    await page.mouse.click(marca.x + 8, marca.y + 8);
    await expect.poll(() => selectedIds().then((ids) => ids[0])).toBe(kids[0]);
    await page.keyboard.press("Tab");
    await expect.poll(() => selectedIds().then((ids) => ids[0])).toBe(kids[1]);
    await page.keyboard.press("Shift+Tab");
    await expect.poll(() => selectedIds().then((ids) => ids[0])).toBe(kids[0]);

    await page.locator('[data-layer-id="login"]').click();
    await page.locator('[data-layer-id="plano"]').click({ modifiers: ["ControlOrMeta"] });
    await page.keyboard.press("Control+g");
    const groupId = async () => Object.values((await doc()).nodes).find((n) => n.type === "group")?.id;
    await expect.poll(groupId).toBeTruthy();
    const g = (await groupId())!;
    await page.locator('[data-testid="viewport"]').click({ position: { x: 5, y: 5 } });
    const card = (await page.locator('[data-paprika-id="plano"]').boundingBox())!;
    await page.keyboard.down("Control");
    await page.mouse.click(card.x + 16, card.y + 16);
    await page.keyboard.up("Control");
    await expect.poll(() => selectedIds().then((ids) => ids[0])).not.toBe(g);
    const deepId = (await selectedIds().then((ids) => ids[0]))!;
    expect(deepId).toBeTruthy();

    await page.mouse.click(card.x + 16, card.y + 16, { button: "right" });
    const menu = page.getByRole("menu", { name: "Camadas sob o cursor" });
    await menu.waitFor();
    await expect(menu.locator(`[data-layer-id="${deepId}"]`).count()).resolves.toBe(1);
    await expect(menu.locator(`[data-layer-id="${g}"]`).count()).resolves.toBe(1);
    await menu.locator(`[data-layer-id="${g}"]`).click();
    await expect.poll(() => selectedIds().then((ids) => ids[0])).toBe(g);
    await expect.poll(() => menu.count()).toBe(0);

    await page.keyboard.press("Enter");
    await expect.poll(picked).toEqual(expect.arrayContaining(["login", "plano"]));
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+Shift+g");
    await expect.poll(async () => (await doc()).nodes[g]).toBeUndefined();
  });

  it("páginas: o + leva o conteúdo para a Página 1, cria a 2 e o agente desenha nela", async () => {
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Nova página" }).click();
    await expect.poll(async () => (await doc()).rootIds.length).toBe(2);
    const d = await doc();
    const [p1, p2] = d.rootIds as [string, string];
    expect(d.nodes[p1]).toMatchObject({ type: "page", name: "Página 1" });
    expect(d.nodes.login?.parentId).toBe(p1);
    await expect.poll(() => page.locator('[data-paprika-id="login"]').count()).toBe(0);
    await expect.poll(activePageName).toContain("Página 2");

    await agent.callTool({
      name: "create_nodes",
      arguments: { parentId: p2, nodes: [{ type: "frame", id: "tela2", name: "Tela 2", width: 320, height: 200, fill: "#ffffff" }] },
    });
    await expect.poll(() => page.locator('[data-paprika-id="tela2"]').count()).toBe(1);
    await page.getByRole("button", { name: "Retângulo" }).click();
    const vp = (await page.locator('[data-testid="viewport"]').boundingBox())!;
    await page.mouse.move(vp.x + 30, vp.y + vp.height - 120);
    await page.mouse.down();
    await page.mouse.move(vp.x + 90, vp.y + vp.height - 70, { steps: 4 });
    await page.mouse.up();
    const inPage2 = async () => {
      const now = await doc();
      return Object.values(now.nodes).filter((n) => n.type === "rect" && (n.parentId === p2 || n.parentId === "tela2")).length;
    };
    await expect.poll(inPage2).toBe(1);
    if (shots) await page.screenshot({ path: join(shots, "08-pagina-2.png") });

    await pageButton("Página 1").click();
    await expect.poll(() => page.locator('[data-paprika-id="login"]').count()).toBe(1);
    await expect.poll(() => page.locator('[data-paprika-id="tela2"]').count()).toBe(0);

    const first = await agentRow("e2e-agent");
    await expect.poll(() => first.innerText()).toMatch(/Página 2/);
    if (shots) await page.screenshot({ path: join(shots, "08b-agente-em-outra-pagina.png") });
    await first.getByRole("button", { name: "Abrir a página de e2e-agent" }).click();
    await expect.poll(() => page.locator('[data-paprika-id="tela2"]').count()).toBe(1);
    await expect.poll(activePageName).toContain("Página 2");
    const centerOff = async (id: string) => {
      const vp = (await page.locator('[data-testid="viewport"]').boundingBox())!;
      const b = (await page.locator(`[data-paprika-id="${id}"]`).boundingBox())!;
      return Math.max(Math.abs(b.x + b.width / 2 - (vp.x + vp.width / 2)), Math.abs(b.y + b.height / 2 - (vp.y + vp.height / 2)));
    };
    await closeAgents();
    await (await agentRow("e2e-agent")).getByRole("button", { name: "Ir até e2e-agent" }).click();
    await closeAgents();
    await expect.poll(() => centerOff("tela2")).toBeLessThan(2);
    await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2);
    await page.mouse.wheel(400, 300);
    await expect.poll(() => centerOff("tela2")).toBeGreaterThan(100);
    await (await agentRow("e2e-agent")).getByRole("button", { name: "Ir até e2e-agent" }).click();
    await closeAgents();
    await expect.poll(() => centerOff("tela2")).toBeLessThan(2);
    if (shots) await page.screenshot({ path: join(shots, "08c-foco-no-agente.png") });

    await pageButton("Página 1").click();
    await expect.poll(() => page.locator('[data-paprika-id="login"]').count()).toBe(1);
  });

  it("componentes: tornar componente, nova instância, mudança propaga, override na cópia, desanexar", async () => {
    await page.keyboard.press("Escape");
    await page.locator('[data-layer-id="plano"]').click();
    await openSection("Componente");
    await page.getByRole("button", { name: "Tornar componente" }).click();
    await expect.poll(async () => ((await doc()).nodes.plano as { component?: boolean }).component).toBe(true);
    await page.getByRole("button", { name: "Nova instância" }).click();
    const instId = async () => Object.values((await doc()).nodes).find((n) => (n as { instanceOf?: string }).instanceOf === "plano")?.id;
    await expect.poll(instId).toBeTruthy();
    const inst = (await instId())!;
    const pro = copyId(inst, "74oxmaizym");
    await expect.poll(() => page.locator(`[data-paprika-id="${pro}"]`).textContent()).toBe("Pro");
    await expect(page.getByTestId("instance-panel").textContent()).resolves.toContain("instância de");

    await agent.callTool({ name: "update_nodes", arguments: { updates: [{ id: "74oxmaizym", props: { text: "Plus" } }] } });
    await expect.poll(() => page.locator(`[data-paprika-id="${pro}"]`).textContent()).toBe("Plus");

    await page.locator(`[data-layer-id="${pro}"]`).click();
    await expect(page.getByTestId("copy-panel").textContent()).resolves.toContain("cópia dentro da instância");
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
  it("colar SVG e HTML vira nós; o botão exporta SVG via layout do core", async () => {
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
    await menuAction("Exportar…");
    const dialog = page.getByRole("dialog", { name: "Exportar" });
    await dialog.getByRole("radio", { name: "SVG" }).click();
    const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Exportar", exact: true }).click()]);
    expect(download.suggestedFilename()).toBe("Seta.svg");
    const file = await download.path();
    const svg = await readFile(file!, "utf8");
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="40" height="40"/);
    expect(svg).toContain('d="M0 0 L40 20 L0 40 Z"');
  }, 30_000);
  it("colar PNG no frame selecionado cria um nó image com data URI", async () => {
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Selecionar" }).click();
    await page.locator('[data-layer-id="login"]').click();
    const at = await page.evaluate(() => {
      const vp = document.querySelector('[data-testid="viewport"]')!.getBoundingClientRect();
      const frame = document.querySelector('[data-paprika-id="login"]')!.getBoundingClientRect();
      const zoom = new DOMMatrix(getComputedStyle(document.querySelector('[data-testid="canvas-world"]')!).transform).a || 1;
      const cx = vp.left + vp.width / 2;
      const cy = vp.top + vp.height / 2;
      return { x: Math.round((cx - frame.left) / zoom), y: Math.round((cy - frame.top) / zoom) };
    });
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8BQz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC";
    await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], "pixel.png", { type: "image/png" }));
      window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }, png);
    const image = async () =>
      Object.values((await doc()).nodes).find((n) => n.type === "image" && typeof n.src === "string" && n.src.startsWith("data:image/png")) as
        | { src: string; parentId?: string; x: number; y: number; layoutPositioning?: string }
        | undefined;
    await expect.poll(async () => (await image())?.parentId).toBe("login");
    const pasted = (await image())!;
    expect(pasted.src).toContain(png);
    expect(pasted.layoutPositioning).toBe("absolute");
    expect(pasted.x).toBe(at.x);
    expect(pasted.y).toBe(at.y);
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

    const a1 = await center('[data-path-anchor="0:1"]');
    await page.mouse.move(a1.x, a1.y);
    await page.mouse.down();
    await page.mouse.move(a1.x + 30, a1.y, { steps: 6 });
    await page.mouse.up();
    await expect.poll(pathD).not.toBe("M0 0 L60 0 L60 60");
    const moved = (await doc()).nodes.pontos as { d: string; width: number };
    expect(moved.d).toMatch(/^M0 0 L\d+(\.\d+)? 0 L60 60$/);
    expect(moved.width).toBeGreaterThan(60);

    const a0 = await center('[data-path-anchor="0:0"]');
    const b1 = await center('[data-path-anchor="0:1"]');
    await page.mouse.dblclick((a0.x + b1.x) / 2, (a0.y + b1.y) / 2);
    await expect.poll(async () => (await pathD())?.split("L").length).toBe(4);
    await expect(page.locator("[data-path-anchor][data-selected]").getAttribute("data-path-anchor")).resolves.toBe("0:1");
    await expect.poll(() => page.locator("[data-path-anchor]").count()).toBe(4);
    // o Delete lê o documento do navegador, que ainda não tinha a inserção ~30 ms depois dela (corrida só alcançável por script)
    await page.waitForTimeout(150);
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await pathD())?.split("L").length).toBe(3);
    await expect.poll(async () => !!(await doc()).nodes.pontos).toBe(true);

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

    await revealLayer(page, "tema0");
    await page.locator('[data-layer-id="tema0"]').click();
    await openSection("Modo de tema");
    await page.getByRole("combobox", { name: "Modo de tema" }).click();
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
    await revealLayer(page, "tema0t");
    const layerName = layer("tema0t");
    await layerName.dblclick();
    const layerInput = page.getByLabel("Nome da camada");
    await layerInput.fill("Amostra clara");
    await layerInput.press("Enter");
    await expect.poll(() => name("tema0t")).toBe("Amostra clara");
    await expect.poll(() => layerInput.count()).toBe(0);
    const hist = (await agent.callTool({ name: "get_history", arguments: {} })) as { content: { text: string }[] };
    expect(JSON.parse(hist.content[0]!.text).at(-1)).toMatchObject({ actor: "user", label: "renomear camada" });

    await revealLayer(page, "tema0t");
    await layer("tema0t").dblclick();
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
    await expect.poll(() => layer("login").textContent()).toContain("Login revisado");

    await page.locator('[data-testid="viewport"]').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("Control+z");
    await expect.poll(() => name("login")).toBe("Login · mobile");
  });

  it("overview: volta aos workspaces, cria um, abre no canvas e não segue o agente quando ele troca", async () => {
    const demo = (await doc()).id;
    await page.getByRole("navigation", { name: "Caminho do documento" }).getByRole("link", { name: "Workspaces" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    const demoCard = page.locator(`[data-workspace-id="${demo}"]`);
    await expect.poll(() => demoCard.textContent()).toMatch(/ativo.*Demo.*nós/);
    if (shots) await page.screenshot({ path: join(shots, "20-overview.png") });

    await page.getByRole("button", { name: "Novo workspace" }).click();
    await page.getByLabel("Nome do workspace").fill("Rascunho do agente");
    await page.getByRole("button", { name: "Criar" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toMatch(/^\/w\//);
    await expect.poll(async () => (await doc()).name).toBe("Rascunho do agente");
    await expect.poll(() => page.locator('[aria-current="page"]').first().textContent()).toBe("Rascunho do agente");
    const draft = (await doc()).id;
    expect(new URL(page.url()).pathname).toBe(`/w/${draft}`);
    expect(await page.locator("[data-layer-id]").count()).toBe(0);

    await agent.callTool({ name: "create_nodes", arguments: { nodes: [{ type: "frame", id: "rasc", name: "Rascunho", width: 200, height: 120, fill: "#ffffff" }] } });
    await page.waitForSelector('[data-paprika-id="rasc"]');
    await agent.callTool({ name: "open_workspace", arguments: { id: demo } });
    await expect.poll(async () => (await doc()).id).toBe(demo);
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/w/${draft}`);
    expect(await page.locator('[data-paprika-id="rasc"]').count()).toBe(1);
    expect(await page.locator('[data-paprika-id="login"]').count()).toBe(0);

    await page.goBack();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    await expect.poll(() => page.locator(`[data-workspace-id="${draft}"]`).textContent()).toMatch(/Rascunho do agente.*1 nó/);
    await page.locator(`[data-workspace-id="${draft}"]`).click();
    await page.waitForSelector('[data-paprika-id="rasc"]');
    await page.goto(`${url}/w/nao-existe`);
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    await expect.poll(() => page.getByRole("alert").allTextContents().then((all) => all.join(" "))).toContain("Este workspace não existe ou foi excluído");
    await agent.callTool({ name: "open_workspace", arguments: { id: demo } });
  });

  it("overview: card sem salto no hover, um clique abre, menu/F2 renomeia (Enter/Esc) e excluir pede confirmação", async () => {
    const POLL = { timeout: 10_000 };
    const { id: demo, name: demoName } = await doc();
    const api = async () => (await (await fetch(`${url}/api/workspaces`)).json()) as { active: string; workspaces: { id: string; name: string }[] };
    const created = await fetch(`${url}/api/workspaces`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Para apagar" }) });
    const extra = ((await created.json()) as { workspace: { id: string } }).workspace.id;
    await page.goto(url);
    const card = page.locator(`[data-workspace-id="${extra}"]`);
    await expect.poll(() => card.textContent(), POLL).toContain("Para apagar");
    const cardMenu = (id: string, action: string) => async () => {
      await page.locator(`[data-workspace-id="${id}"]`).getByRole("button", { name: "Mais ações" }).click();
      await page.getByRole("menuitem", { name: action }).click();
    };

    const top = async () => (await card.boundingBox())!.y;
    const restY = await top();
    await card.hover();
    await page.waitForTimeout(200);
    expect(await top()).toBe(restY);
    await card.getByRole("button", { name: "Mais ações" }).hover();
    await page.waitForTimeout(200);
    expect(await top()).toBe(restY);
    if (shots) await page.screenshot({ path: join(shots, "21-overview-hover.png") });

    await cardMenu(extra, "Renomear")();
    const field = page.getByLabel("Novo nome do workspace");
    await field.click();
    await field.fill("Não vale");
    await field.press("Escape");
    await expect.poll(() => card.textContent(), POLL).toContain("Para apagar");
    expect(new URL(page.url()).pathname).toBe("/");
    await card.getByRole("button", { name: "Para apagar" }).focus();
    await page.keyboard.press("F2");
    await field.fill("Renomeado");
    if (shots) await page.screenshot({ path: join(shots, "22-overview-renomear.png") });
    await field.press("Enter");
    await expect.poll(() => card.textContent(), POLL).toContain("Renomeado");
    expect((await api()).workspaces.find((w) => w.id === extra)?.name).toBe("Renomeado");

    await cardMenu(demo, "Renomear")();
    await field.fill("Demo (renomeado)");
    await field.press("Enter");
    await expect.poll(async () => (await doc()).name, POLL).toBe("Demo (renomeado)");

    await cardMenu(extra, "Excluir")();
    const dialog = page.getByRole("alertdialog");
    await expect.poll(() => dialog.textContent()).toContain("Excluir “Renomeado”?");
    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect.poll(() => dialog.isVisible()).toBe(false);
    expect((await api()).workspaces.some((w) => w.id === extra)).toBe(true);
    await card.getByRole("button", { name: "Renomeado" }).focus();
    await page.keyboard.press("Delete");
    await expect.poll(() => dialog.isVisible()).toBe(true);
    await dialog.getByLabel(/Digite/).fill("Renomeado");
    await dialog.getByRole("button", { name: "Excluir workspace" }).click();
    await expect.poll(() => card.count(), POLL).toBe(0);
    expect((await api()).workspaces.some((w) => w.id === extra)).toBe(false);

    const tmp = ((await agent.callTool({ name: "create_workspace", arguments: { name: "Ativo temporário" } })) as unknown as { structuredContent: { workspace: { id: string } } })
      .structuredContent.workspace.id;
    await agent.callTool({ name: "open_workspace", arguments: { id: tmp } });
    const tmpCard = page.locator(`[data-workspace-id="${tmp}"]`);
    await expect.poll(() => tmpCard.textContent(), POLL).toContain("ativo");
    await cardMenu(tmp, "Excluir")();
    await expect.poll(() => dialog.textContent()).toContain("Excluir “Ativo temporário”?");
    if (shots) await page.screenshot({ path: join(shots, "23-overview-excluir-ativo.png") });
    await dialog.getByLabel(/Digite/).fill("Ativo temporário");
    await dialog.getByRole("button", { name: "Excluir workspace" }).click();
    await expect.poll(() => tmpCard.count(), POLL).toBe(0);
    await expect.poll(async () => (await api()).active, POLL).not.toBe(tmp);
    await expect.poll(() => page.locator("[data-workspace-id] [data-active]").count(), POLL).toBe(1);

    const next = (await api()).active;
    const made = await fetch(`${url}/api/workspaces`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Destino do clique" }) });
    const otherId = ((await made.json()) as { workspace: { id: string } }).workspace.id;
    await page.reload();
    await page.locator(`[data-workspace-id="${otherId}"]`).click();
    await expect.poll(() => new URL(page.url()).pathname, POLL).toBe(`/w/${otherId}`);
    await expect.poll(async () => (await api()).active, POLL).toBe(otherId);
    await page.goBack();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    await page.locator(`[data-workspace-id="${next}"] [data-card-open]`).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => new URL(page.url()).pathname, POLL).toBe(`/w/${next}`);
    await expect.poll(async () => (await api()).active, POLL).toBe(next);
    await fetch(`${url}/api/workspaces/${otherId}`, { method: "DELETE" });

    await agent.callTool({ name: "open_workspace", arguments: { id: demo } });
    await agent.callTool({ name: "rename_workspace", arguments: { id: demo, name: demoName } });
    await expect.poll(async () => (await doc()).name, POLL).toBe(demoName);
  });

  it("overview: arquivar esconde o card e Arquivados restaura sem apagar", async () => {
    const POLL = { timeout: 10_000 };
    const { id: demo } = await doc();
    const created = await fetch(`${url}/api/workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Para arquivar" }),
    });
    const extra = ((await created.json()) as { workspace: { id: string } }).workspace.id;
    await page.goto(url);
    const card = page.locator(`[data-workspace-id="${extra}"]`);
    await expect.poll(() => card.count(), POLL).toBe(1);
    const cardMenu = async (action: string) => {
      await card.getByRole("button", { name: "Mais ações" }).click();
      await page.getByRole("menuitem", { name: action }).click();
    };
    await cardMenu("Arquivar");
    await expect.poll(() => card.count(), POLL).toBe(0);
    const listed = (await (await fetch(`${url}/api/workspaces`)).json()) as { workspaces: { id: string }[] };
    expect(listed.workspaces.some((w) => w.id === extra)).toBe(false);
    const kept = (await (await fetch(`${url}/api/workspaces?archived=1`)).json()) as { workspaces: { id: string; name: string }[] };
    expect(kept.workspaces.find((w) => w.id === extra)?.name).toBe("Para arquivar");

    const sidebar = page.getByRole("complementary", { name: "Menu de workspaces" });
    await sidebar.getByRole("button", { name: "Arquivados" }).click();
    await expect.poll(() => page.getByRole("heading", { level: 1 }).textContent(), POLL).toBe("Arquivados");
    await expect.poll(() => card.count(), POLL).toBe(1);
    await cardMenu("Restaurar");
    await expect.poll(() => card.count(), POLL).toBe(0);
    await sidebar.getByRole("button", { name: /^Workspaces/ }).click();
    await expect.poll(() => card.count(), POLL).toBe(1);

    await cardMenu("Arquivar");
    await sidebar.getByRole("button", { name: "Arquivados" }).click();
    await card.click();
    await expect.poll(() => new URL(page.url()).pathname, POLL).toBe(`/w/${extra}`);
    await expect.poll(async () => {
      const after = (await (await fetch(`${url}/api/workspaces`)).json()) as { active: string; workspaces: { id: string }[] };
      return after.active === extra && after.workspaces.some((w) => w.id === extra);
    }, POLL).toBe(true);

    await agent.callTool({ name: "open_workspace", arguments: { id: demo } });
    await fetch(`${url}/api/workspaces/${extra}`, { method: "DELETE" });
  });

  it("páginas: a Nova página leva o conteúdo solto para a Página 1, o duplo clique renomeia e desfazer volta num passo", async () => {
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
    await expect.poll(() => page.getByText("Nenhuma página ainda.").count(), POLL).toBe(1);

    await page.getByRole("button", { name: "Nova página" }).click();
    await expect.poll(async () => (await pageNodes()).length, POLL).toBe(2);
    const d = await doc();
    const [pageId] = d.rootIds as [string, string];
    expect(d.rootIds).toHaveLength(2);
    expect(d.nodes[pageId]).toMatchObject({ type: "page", name: "Página 1" });
    expect(d.nodes.capa?.parentId).toBe(pageId);

    await pageButton("Página 1").dblclick();
    const input = page.getByLabel("Nome da página");
    expect(await input.inputValue()).toBe("Página 1");
    await input.fill("Abertura");
    await input.press("Enter");
    await expect.poll(async () => (await doc()).nodes[pageId]?.name, POLL).toBe("Abertura");
    await pageButton("Abertura").click();
    await expect.poll(() => page.locator('[data-paprika-id="capa"]').count(), POLL).toBe(1);

    await clickEmpty();
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await doc()).nodes[pageId]?.name, POLL).toBe("Página 1");
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await pageNodes()).length, POLL).toBe(0);
    expect((await doc()).nodes.capa?.parentId).toBeNull();
    expect((await doc()).rootIds).toEqual(["capa"]);

    await agent.callTool({ name: "open_workspace", arguments: { id: demo } });
    await fetch(`${url}/api/workspaces/${solo}`, { method: "DELETE" });
  });

  it("overview: capa por arquivo (trocar e remover) e por screenshot do agente; sem capa fica a miniatura", async () => {
    const POLL = { timeout: 10_000 };
    const { id: demo, name: demoName } = await doc();
    const list = async () => (await (await fetch(`${url}/api/workspaces`)).json()) as { workspaces: { id: string; name: string; cover: string | null }[] };
    await page.goto(url);
    const demoCard = page.locator(`[data-workspace-id="${demo}"]`);
    await expect.poll(() => demoCard.textContent(), POLL).toContain(demoName);
    expect(await demoCard.locator("img").count()).toBe(0);

    const png = Buffer.from(await (await fetch(`${url}/api/screenshot?root=login`)).arrayBuffer());
    await demoCard.getByRole("button", { name: "Mais ações" }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("menuitem", { name: "Adicionar capa" }).click();
    await (await chooser).setFiles({ name: "capa.png", mimeType: "image/png", buffer: png });
    const img = demoCard.locator("img");
    await expect.poll(() => img.getAttribute("src"), POLL).toMatch(/\/cover\?v=\d+$/);
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), POLL).toBe(true);

    const draft = (await list()).workspaces.find((w) => w.name === "Rascunho do agente");
    expect(draft).toBeDefined();
    const shot = await agent.callTool({ name: "set_workspace_cover", arguments: { id: draft!.id, rootId: "rasc" } });
    expect(shot.isError).toBeFalsy();
    await page.reload();
    await expect.poll(() => page.locator(`[data-workspace-id="${draft!.id}"] img`).count(), POLL).toBe(1);
    if (shots) {
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(shots, "24-overview-capas.png") });
    }

    await demoCard.getByRole("button", { name: "Mais ações" }).click();
    await page.getByRole("menuitem", { name: "Remover capa" }).click();
    await expect.poll(() => img.count(), POLL).toBe(0);
    await expect.poll(() => demoCard.textContent(), POLL).toContain(demoName);
    await agent.callTool({ name: "set_workspace_cover", arguments: { id: draft!.id, clear: true } });
  }, 30_000);

  it("overview: cria um projeto e move o card para ele", async () => {
    const POLL = { timeout: 10_000 };
    const { id: demo } = await doc();
    await page.goto(url);
    const sidebar = page.getByRole("complementary", { name: "Menu de workspaces" });
    await sidebar.getByRole("button", { name: "Novo projeto" }).click();
    const name = sidebar.getByRole("textbox", { name: "Nome do novo projeto" });
    await name.fill("Marca");
    await name.press("Enter");
    const project = sidebar.getByRole("navigation", { name: "Projetos" }).getByRole("button", { name: /Marca/ });
    await expect.poll(() => project.count(), POLL).toBe(1);
    await project.click();
    await expect.poll(() => page.getByText("Nenhum workspace neste projeto.").count(), POLL).toBe(1);
    await sidebar.getByRole("button", { name: /^Workspaces/ }).click();

    const card = page.locator(`[data-workspace-id="${demo}"]`);
    await expect.poll(() => card.count(), POLL).toBe(1);
    await card.getByRole("button", { name: "Mais ações" }).click();
    await page.getByRole("menuitemradio", { name: "Marca" }).click();
    await expect
      .poll(async () => ((await (await fetch(`${url}/api/workspaces`)).json()) as { workspaces: { id: string; folderId?: string }[] }).workspaces.find((w) => w.id === demo)?.folderId || "", POLL)
      .not.toBe("");
    await project.click();
    await expect.poll(() => page.getByText("Nenhum workspace neste projeto.").count(), POLL).toBe(0);
    await expect.poll(() => card.count(), POLL).toBe(1);
  });

  it("aviso: quando um agente apaga o workspace ativo ou troca de workspace, o canvas diz quem fez, o que foi perdido e leva à overview", async () => {
    const POLL = { timeout: 10_000 };
    const { id: demo, name: demoName } = await doc();
    const structured = (r: unknown) => (r as { structuredContent: Record<string, any> }).structuredContent;
    await page.goto(`${url}/w/${demo}`);
    await page.waitForSelector('[data-paprika-id="login"]');
    const notice = page.getByRole("status").filter({ hasText: /(abriu|apagou|renomeou) o workspace/ });
    const focusInside = () => notice.evaluate((el) => el.contains(document.activeElement)).catch(() => false);
    expect(await notice.count()).toBe(0);

    const tmp = structured(await agent.callTool({ name: "create_workspace", arguments: { name: "Aviso temporário" } })).workspace.id as string;
    await agent.callTool({ name: "open_workspace", arguments: { id: tmp } });
    await expect.poll(() => notice.textContent(), POLL).toContain("e2e-agent abriu o workspace “Aviso temporário”");
    expect(new URL(page.url()).pathname).toBe(`/w/${demo}`);
    expect(await notice.textContent()).not.toMatch(/\d+ nós?/);
    expect(await focusInside()).toBe(false);

    await agent.callTool({
      name: "create_nodes",
      arguments: { nodes: [{ type: "frame", id: "a1", width: 100, height: 60 }, { type: "frame", id: "a2", width: 100, height: 60 }] },
    });
    await page.goto(`${url}/w/${tmp}`);
    await page.waitForSelector('[data-paprika-id="a2"]');

    const ask = structured(await agent.callTool({ name: "delete_workspace", arguments: { id: tmp } }));
    expect(ask.needsConfirmation).toBe(true);
    await agent.callTool({ name: "delete_workspace", arguments: { id: tmp, confirmToken: ask.confirmToken } });
    await expect.poll(() => notice.textContent(), POLL).toContain("e2e-agent apagou o workspace “Aviso temporário”");
    await expect.poll(() => notice.textContent(), POLL).toMatch(/2 nós.*2 frames/);
    // o app já sai do workspace apagado para a overview (o aviso não precisa mais do botão "Ver workspaces")
    await expect.poll(() => new URL(page.url()).pathname, POLL).toBe("/");
    expect(await focusInside()).toBe(false);
    if (shots) await page.screenshot({ path: join(shots, "25-aviso-apagou.png") });

    await page.getByRole("button", { name: "Dispensar aviso" }).click();
    await expect.poll(() => notice.count()).toBe(0);
    await expect.poll(() => page.locator("[data-workspace-id] [data-active]").count(), POLL).toBe(1);

    await page.goto(`${url}/w/${demo}`);
    await page.waitForSelector('[data-paprika-id="login"]');
    await agent.callTool({ name: "rename_workspace", arguments: { id: demo, name: "Demo do agente" } });
    await expect.poll(() => notice.textContent(), POLL).toContain("e2e-agent renomeou o workspace para “Demo do agente”");
    await page.getByRole("button", { name: "Dispensar aviso" }).click();
    await expect.poll(() => notice.count()).toBe(0);
    await agent.callTool({ name: "rename_workspace", arguments: { id: demo, name: demoName } });
    await expect.poll(async () => (await doc()).name, POLL).toBe(demoName);
  }, 30_000);

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
    expect(gets).toBeLessThan(ids.length / 2);
  });

  it("painéis laterais redimensionam por arraste e teclado, entre min e max, e o duplo clique recolhe e restaura", async () => {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    p.setDefaultTimeout(8_000);
    await pinLocale(p, "pt-BR");
    try {
      await p.goto(`${url}/w/${(await doc()).id}`);
      await p.waitForSelector('[data-paprika-id="login"]');
      const width = (sel: string) => p.locator(sel).evaluate((el) => Math.round(el.getBoundingClientRect().width));
      const left = p.getByRole("separator", { name: "Redimensionar painel de camadas" });
      const right = p.getByRole("separator", { name: "Redimensionar painel de propriedades" });
      const leftPanel = 'aside[aria-label="Painel de camadas"]';
      const rightPanel = 'aside[aria-label="Painel de propriedades"]';
      expect(await width(leftPanel)).toBe(248);
      expect(await width(rightPanel)).toBe(320);

      const dragBy = async (handle: typeof left, dx: number) => {
        const b = (await handle.boundingBox())!;
        await p.mouse.move(b.x + b.width / 2, b.y + 200);
        await p.mouse.down();
        await p.mouse.move(b.x + b.width / 2 + dx / 2, b.y + 200);
        await p.mouse.move(b.x + b.width / 2 + dx, b.y + 200);
        await p.mouse.up();
      };
      await dragBy(left, 100);
      await expect.poll(() => width(leftPanel)).toBe(348);
      await dragBy(left, 1000);
      await expect.poll(() => width(leftPanel)).toBe(480);
      await dragBy(left, -290);
      await expect.poll(() => width(leftPanel)).toBe(200);

      await dragBy(right, -60);
      await expect.poll(() => width(rightPanel)).toBe(380);
      await right.focus();
      // no separador do painel direito, Home leva ao máximo (480) e a seta para a direita encolhe um passo (1 % do grupo)
      await p.keyboard.press("Home");
      await expect.poll(() => width(rightPanel)).toBe(480);
      await p.keyboard.press("ArrowRight");
      await expect.poll(() => width(rightPanel)).toBeGreaterThan(455);
      await expect.poll(() => width(rightPanel)).toBeLessThan(480);

      // o duplo clique no separador recolhe o painel e outro duplo clique devolve a largura que ele tinha (o antigo voltava ao padrão)
      await expect.poll(() => width(leftPanel)).toBe(200);
      for (const expected of [0, 200]) {
        const b = (await left.boundingBox())!;
        await p.mouse.dblclick(b.x + b.width / 2, b.y + 200);
        await expect.poll(() => width(leftPanel)).toBe(expected);
      }
    } finally {
      await p.close();
    }
  });

  it("painéis laterais: a largura persiste ao recarregar", async () => {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    p.setDefaultTimeout(8_000);
    await pinLocale(p, "pt-BR");
    try {
      await p.goto(`${url}/w/${(await doc()).id}`);
      await p.waitForSelector('[data-paprika-id="login"]');
      const width = (sel: string) => p.locator(sel).evaluate((el) => Math.round(el.getBoundingClientRect().width));
      const left = p.getByRole("separator", { name: "Redimensionar painel de camadas" });
      const b = (await left.boundingBox())!;
      await p.mouse.move(b.x + b.width / 2, b.y + 200);
      await p.mouse.down();
      await p.mouse.move(b.x + b.width / 2 + 50, b.y + 200);
      await p.mouse.move(b.x + b.width / 2 + 100, b.y + 200);
      await p.mouse.up();
      await expect.poll(() => width('aside[aria-label="Painel de camadas"]')).toBe(348);
      await p.reload();
      await p.waitForSelector('[data-paprika-id="login"]');
      expect(await width('aside[aria-label="Painel de camadas"]')).toBe(348);
    } finally {
      await p.close();
    }
  });

  it("diagramas: caixa e losango com texto no lugar, seta que prende e segue a forma, apagar leva a seta e o agente desenha com draw_diagram", async () => {
    const POLL = { timeout: 10_000 };
    await page.goto(`${url}/w/${(await doc()).id}`);
    await page.waitForSelector('[data-testid="viewport"]');
    const pages = async () => Object.values((await doc()).nodes).filter((n) => n.type === "page").map((n) => n.id);
    const pagesBefore = await pages();
    await page.getByRole("button", { name: "Nova página" }).click();
    await expect.poll(async () => (await pages()).length, POLL).toBe(pagesBefore.length ? pagesBefore.length + 1 : 2);
    const pageId = (await doc()).rootIds.at(-1)!;
    await expect.poll(activePageName, POLL).toContain((await doc()).nodes[pageId]!.name);
    const vp = (await page.locator('[data-testid="viewport"]').boundingBox())!;
    const shapes = async () => Object.values((await doc()).nodes).filter((n) => n.type === "shape" && n.parentId === pageId);

    await page.keyboard.press("s");
    await page.mouse.click(vp.x + 200, vp.y + 200);
    await expect.poll(async () => (await shapes()).length, POLL).toBe(1);
    await page.getByTestId("shape-text-editor").waitFor();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Início");
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await shapes())[0], POLL).toMatchObject({ shape: "rect", text: "Início", width: 160, height: 80 });
    const first = (await shapes())[0]!.id;

    await page.getByRole("button", { name: "Formas de diagrama" }).click();
    await page.getByRole("button", { name: "Decisão (losango)" }).click();
    await page.mouse.click(vp.x + 520, vp.y + 200);
    await expect.poll(async () => (await shapes()).length, POLL).toBe(2);
    await page.getByTestId("shape-text-editor").waitFor();
    await page.keyboard.type("Ok?");
    await page.getByTestId("shape-text-editor").blur();
    await expect.poll(async () => (await shapes()).find((n) => n.id !== first), POLL).toMatchObject({ shape: "diamond", text: "Ok?" });
    const second = (await shapes()).find((n) => n.id !== first)!.id;
    await expect.poll(() => page.locator(`[data-paprika-id="${second}"]`).innerText(), POLL).toBe("Ok?");

    await page.keyboard.press("g");
    await page.mouse.click(vp.x + 200, vp.y + 420);
    await expect.poll(async () => (await shapes()).length, POLL).toBe(3);
    await page.getByTestId("shape-text-editor").waitFor();
    await page.keyboard.type("Go");
    await page.keyboard.press("Escape");
    const third = (await shapes()).find((n) => n.id !== first && n.id !== second)!.id;
    await expect.poll(async () => (await doc()).nodes[third], POLL).toMatchObject({ shape: "triangle", text: "Go", width: 160, height: 140 });
    await page.locator(`[data-paprika-id="${third}"]`).click();
    await page.getByRole("combobox", { name: "Tipo de forma" }).click();
    await page.getByRole("option", { name: "losango (decisão)" }).click();
    await expect.poll(async () => (await doc()).nodes[third], POLL).toMatchObject({ shape: "diamond" });
    await page.getByRole("combobox", { name: "Tipo de forma" }).click();
    await page.getByRole("option", { name: "triângulo" }).click();
    await expect.poll(async () => (await doc()).nodes[third], POLL).toMatchObject({ shape: "triangle" });
    await page.locator('[data-testid="viewport"]').click({ position: { x: 5, y: 5 } });

    await page.keyboard.press("c");
    await page.mouse.click(vp.x + 520, vp.y + 420);
    await page.getByTestId("shape-text-editor").waitFor();
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await shapes()).some((n) => n.type === "shape" && n.shape === "cylinder"), POLL).toBe(true);

    const box = async (id: string) => (await page.locator(`[data-paprika-id="${id}"]`).boundingBox())!;
    const a = await box(first);
    const b = await box(second);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Seta (prende nas formas)" }).click();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
    await expect.poll(() => page.getByTestId("link-draft").count(), POLL).toBe(1);
    await page.mouse.up();
    const connector = async () => Object.values((await doc()).nodes).find((n) => n.type === "connector" && n.parentId === pageId);
    await expect.poll(connector, POLL).toMatchObject({ from: { nodeId: first }, to: { nodeId: second }, route: "elbow" });
    const arrow = (await connector())!;
    const d0 = (arrow as { d: string }).d;
    await expect.poll(() => page.getByTestId("connector-to-handle").count(), POLL).toBe(1);
    const toHandle = (await page.getByTestId("connector-to-handle").boundingBox())!;
    await page.mouse.move(toHandle.x + toHandle.width / 2, toHandle.y + toHandle.height / 2);
    await page.mouse.down();
    await page.mouse.move(vp.x + 360, vp.y + 90, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => {
      const node = await connector();
      const end = node && node.type === "connector" ? node.to : undefined;
      return !!end && !("nodeId" in end) && typeof end.x === "number";
    }, POLL).toBe(true);
    const loose = (await page.getByTestId("connector-to-handle").boundingBox())!;
    const back = await box(second);
    await page.mouse.move(loose.x + loose.width / 2, loose.y + loose.height / 2);
    await page.mouse.down();
    await page.mouse.move(back.x + back.width / 2, back.y + back.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => {
      const node = await connector();
      return node && node.type === "connector" ? node.to : undefined;
    }, POLL).toMatchObject({ nodeId: second });

    await page.mouse.move(b.x + b.width / 2, b.y + 10);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + 160, { steps: 6 });
    await expect.poll(() => page.locator(`[data-paprika-id="${arrow.id}"] path:not([data-connector-hit])`).getAttribute("d"), POLL).not.toBe(d0);
    await page.mouse.up();
    await expect.poll(async () => ((await connector()) as { d: string } | undefined)?.d, POLL).not.toBe(d0);
    const hit = (await page.locator(`[data-paprika-id="${arrow.id}"] path[data-connector-hit]`).boundingBox())!;
    expect(hit.width).toBeGreaterThan(0);
    if (shots) await page.screenshot({ path: join(shots, "16-diagrama-desenhado.png") });

    const a2 = await box(first);
    await page.mouse.dblclick(a2.x + a2.width / 2, a2.y + a2.height / 2);
    await page.getByTestId("shape-text-editor").waitFor();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Começo");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect.poll(async () => (await doc()).nodes[first], POLL).toMatchObject({ text: "Começo" });

    await page.locator(`[data-paprika-id="${first}"]`).click();
    await page.keyboard.press("Delete");
    await expect.poll(async () => (await doc()).nodes[arrow.id], POLL).toBeUndefined();
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => (await doc()).nodes[arrow.id]?.type, POLL).toBe("connector");

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
    await layer("fx-ok-to-fx-note").first().click();
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
    const parentId = (await doc()).rootIds.at(-1)!;
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

    const shape = (await page.locator('[data-paprika-id="lbl-a"]').boundingBox())!;
    await page.mouse.dblclick(shape.x + shape.width / 2, shape.y + shape.height / 2);
    await page.getByTestId("shape-text-editor").waitFor();
    expect(await editor.count()).toBe(0);
    await page.keyboard.press("Escape");
  }, 60_000);

  it("seleção mostra quatro alças e arrastar o canto NW mantém o SE fixo", async () => {
    const POLL = { timeout: 10_000 };
    await page.keyboard.press("Escape");
    const parentId = (await doc()).rootIds.at(-1)!;
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
    await expect.poll(() => page.locator("[data-handle]").count(), POLL).toBe(4);
    const before = (await doc()).nodes[id] as { x: number; y: number; width: number; height: number };
    const seBefore = { x: before.x + before.width, y: before.y + before.height };
    const handle = (await page.locator('[data-handle="nw"]').boundingBox())!;
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

  it("auto layout: alças de gap e padding, um desfazer por arraste", async () => {
    const POLL = { timeout: 10_000 };
    await page.keyboard.press("Escape");
    const parentId = (await doc()).rootIds.at(-1)!;
    const created = await agent.callTool({
      name: "create_nodes",
      arguments: {
        parentId,
        label: "frame com espaço",
        nodes: [
          {
            type: "frame",
            id: "space-frame",
            name: "Space",
            x: 40,
            y: 720,
            width: 280,
            height: 140,
            fill: "#ffffff",
            layout: { mode: "row", gap: 8, padding: 12, align: "start", justify: "start" },
          },
          { type: "rect", id: "space-free", name: "Free", x: 360, y: 720, width: 80, height: 50, fill: "#d9d4cf" },
        ],
      },
    });
    expect(created.isError).toBeFalsy();
    const kids = await agent.callTool({
      name: "create_nodes",
      arguments: {
        parentId: "space-frame",
        label: "filhos do frame",
        nodes: [
          { type: "rect", id: "space-a", width: 80, height: 60, fill: "#d9d4cf" },
          { type: "rect", id: "space-b", width: 80, height: 60, fill: "#c43d27" },
        ],
      },
    });
    expect(kids.isError).toBeFalsy();
    await expect.poll(async () => (await doc()).nodes["space-b"]?.type, POLL).toBe("rect");
    await page.getByRole("button", { name: "Enquadrar" }).click();
    await page.locator('[data-layer-id="space-free"]').click();
    await expect.poll(() => page.locator("[data-spacing]").count(), POLL).toBe(0);
    await page.locator('[data-layer-id="space-frame"]').click();
    await expect.poll(() => page.locator("[data-spacing]").count(), POLL).toBe(5);

    const layoutOf = async () => ((await doc()).nodes["space-frame"] as FrameNode).layout!;
    expect((await layoutOf()).gap).toBe(8);
    const gap = page.locator('[data-spacing="gap-0"]');
    const box = (await gap.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 48, cy, { steps: 6 });
    expect((await layoutOf()).gap).toBe(8);
    await page.mouse.up();
    await expect.poll(async () => (await layoutOf()).gap as number, POLL).toBeGreaterThan(8);
    const dragged = (await layoutOf()).gap;
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => (await layoutOf()).gap, POLL).toBe(8);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect.poll(async () => (await layoutOf()).gap, POLL).toBe(dragged);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => (await layoutOf()).gap, POLL).toBe(8);

    const top = page.locator('[data-spacing="padding-top"]');
    const tb = (await top.boundingBox())!;
    const tx = tb.x + tb.width / 2;
    const ty = tb.y + tb.height / 2;
    await page.mouse.move(tx, ty);
    await page.mouse.down();
    await page.mouse.move(tx, ty + 30, { steps: 5 });
    expect((await layoutOf()).padding).toBe(12);
    await page.mouse.up();
    await expect
      .poll(async () => {
        const p = (await layoutOf()).padding;
        return Array.isArray(p) && (p[0] as number) > 12 && p[1] === 12 && p[2] === 12 && p[3] === 12;
      }, POLL)
      .toBe(true);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(async () => (await layoutOf()).padding, POLL).toBe(12);

    await page.keyboard.down("Alt");
    const left = page.locator('[data-spacing="padding-left"]');
    const lb = (await left.boundingBox())!;
    const lx = lb.x + lb.width / 2;
    const ly = lb.y + lb.height / 2;
    await page.mouse.move(lx, ly);
    await page.mouse.down();
    await page.mouse.move(lx + 24, ly, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect
      .poll(async () => {
        const p = (await layoutOf()).padding;
        return typeof p === "number" && p > 12;
      }, POLL)
      .toBe(true);
  }, 40_000);

  it("seleção rotacionada: alças nos cantos da caixa e o marquee ignora o canto vazio", async () => {
    const POLL = { timeout: 10_000 };
    await page.keyboard.press("Escape");
    const parentId = (await doc()).rootIds.at(-1)!;
    const id = "spin-hit";
    const created = await agent.callTool({
      name: "create_nodes",
      arguments: {
        parentId,
        label: "retângulo rotacionado",
        nodes: [{ type: "rect", id, name: "Spin", x: 700, y: 40, width: 220, height: 48, rotation: 32, fill: "#d9d4cf" }],
      },
    });
    expect(created.isError).toBeFalsy();
    await expect.poll(async () => (await doc()).nodes[id]?.type, POLL).toBe("rect");
    await page.getByRole("button", { name: "Enquadrar" }).click();
    const host = page.locator(`[data-paprika-id="${id}"]`);
    const box = (await host.boundingBox())!;
    const empty = { x: box.x + Math.max(2, box.width * 0.015), y: box.y + Math.max(2, box.height * 0.015) };
    await page.mouse.click(empty.x, empty.y);
    await expect.poll(() => page.locator(`[data-layer-id="${id}"].is-selected`).count(), POLL).toBe(0);
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.down();
    await page.mouse.move(empty.x + Math.max(4, box.width * 0.02), empty.y + Math.max(4, box.height * 0.02), { steps: 4 });
    await page.mouse.up();
    await expect.poll(() => page.locator(`[data-layer-id="${id}"].is-selected`).count(), POLL).toBe(0);
    await host.click();
    const sel = page.getByTestId("selection");
    await expect.poll(() => page.locator("[data-handle]").count(), POLL).toBe(4);
    await expect.poll(() => page.locator("[data-rotate-handle]").count(), POLL).toBe(1);
    const nw = (await page.locator('[data-handle="nw"]').boundingBox())!;
    const nwCenter = { x: nw.x + nw.width / 2, y: nw.y + nw.height / 2 };
    // o canto NW do retângulo girado, na tela: centro da caixa (o eixo alinhado dele) mais o canto girado pelo zoom do mundo
    const zoom = await world().evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a || 1);
    const node = (await doc()).nodes[id] as { width: number; height: number; rotation: number };
    const rad = (node.rotation * Math.PI) / 180;
    const half = { x: (-node.width / 2) * zoom, y: (-node.height / 2) * zoom };
    const quad = {
      x: box.x + box.width / 2 + half.x * Math.cos(rad) - half.y * Math.sin(rad),
      y: box.y + box.height / 2 + half.x * Math.sin(rad) + half.y * Math.cos(rad),
    };
    expect(Math.hypot(nwCenter.x - quad.x, nwCenter.y - quad.y)).toBeLessThan(6);
    expect(Math.hypot(quad.x - box.x, quad.y - box.y)).toBeGreaterThan(4);
    const before = (await doc()).nodes[id] as { x: number; y: number; width: number; height: number; rotation: number };
    const corner = (n: typeof before, which: "nw" | "se") => {
      const w = n.width;
      const h = n.height;
      const cx = n.x + w / 2;
      const cy = n.y + h / 2;
      const rad = (n.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const dx = (which === "nw" ? -w : w) / 2;
      const dy = (which === "nw" ? -h : h) / 2;
      return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
    };
    const nwBefore = corner(before, "nw");
    const se = (await page.locator('[data-handle="se"]').boundingBox())!;
    await page.mouse.move(se.x + se.width / 2, se.y + se.height / 2);
    await page.mouse.down();
    await page.mouse.move(se.x + se.width / 2 + 36, se.y + se.height / 2 + 24, { steps: 6 });
    await page.mouse.up();
    await expect
      .poll(async () => {
        const n = (await doc()).nodes[id] as { width: number; height: number };
        return n.width !== before.width || n.height !== before.height;
      }, POLL)
      .toBe(true);
    const after = (await doc()).nodes[id] as typeof before;
    const nwAfter = corner(after, "nw");
    expect(Math.abs(nwAfter.x - nwBefore.x)).toBeLessThan(2);
    expect(Math.abs(nwAfter.y - nwBefore.y)).toBeLessThan(2);
    expect(after.rotation).toBe(before.rotation);
  }, 30_000);

  it("seta: inspector troca rota cotovelo/arredondado/curva e a alça da curva grava control", async () => {
    const POLL = { timeout: 10_000 };
    await page.keyboard.press("Escape");
    const parentId = (await doc()).rootIds.at(-1)!;
    const made = await agent.callTool({
      name: "create_nodes",
      arguments: {
        parentId,
        nodes: [
          { type: "shape", id: "rt-a", text: "A", x: 40, y: 40, width: 100, height: 60 },
          { type: "shape", id: "rt-b", text: "B", x: 280, y: 160, width: 100, height: 60 },
          { type: "connector", id: "rt-c", from: { nodeId: "rt-a", side: "right" }, to: { nodeId: "rt-b", side: "left" }, route: "elbow" },
        ],
      },
    });
    expect(made.isError).toBeFalsy();
    await page.getByRole("button", { name: "Enquadrar" }).click();
    await layer("rt-c").first().click();
    const route = page.getByRole("combobox", { name: "Rota" });
    await route.click();
    await page.getByRole("option", { name: "arredondado" }).click();
    await expect.poll(async () => (await doc()).nodes["rt-c"], POLL).toMatchObject({ route: "rounded" });
    await page.getByLabel("Raio", { exact: true }).fill("16");
    await page.getByLabel("Raio", { exact: true }).press("Enter");
    await expect.poll(async () => ((await doc()).nodes["rt-c"] as { radius: number }).radius, POLL).toBe(16);
    await expect.poll(async () => ((await doc()).nodes["rt-c"] as { d: string }).d.includes("A"), POLL).toBe(true);
    await route.click();
    await page.getByRole("option", { name: "curva" }).click();
    await expect.poll(async () => (await doc()).nodes["rt-c"], POLL).toMatchObject({ route: "curve" });
    await expect.poll(() => page.getByTestId("connector-curve-handle").count(), POLL).toBe(1);
    const handle = (await page.getByTestId("connector-curve-handle").boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + 40, handle.y - 50, { steps: 6 });
    await page.mouse.up();
    await expect.poll(async () => {
      const c = (await doc()).nodes["rt-c"] as { control?: { x: number; y: number }; d: string };
      return !!c.control && c.d.includes("C");
    }, POLL).toBe(true);
  }, 30_000);

  it("inspector liga e desliga o raio de cada canto", async () => {
    const POLL = { timeout: 10_000 };
    const id = "rc070";
    const parentId = (await doc()).rootIds.at(-1)!;
    const created = await agent.callTool({
      name: "create_nodes",
      arguments: { parentId, nodes: [{ type: "rect", id, x: 48, y: 48, width: 140, height: 80, fill: "#c8401f", radius: 8 }] },
    });
    expect(created.isError, JSON.stringify(created.content)).toBeFalsy();
    await page.locator(`[data-paprika-id="${id}"]`).click();
    await openSection("Preenchimento e traço");
    await expect.poll(() => page.getByRole("button", { name: "Desligar cantos" }).getAttribute("aria-pressed"), POLL).toBe("false");
    await page.getByRole("button", { name: "Desligar cantos" }).click();
    await expect.poll(async () => (await doc()).nodes[id], POLL).toMatchObject({ radius: [8, 8, 8, 8] });
    await expect.poll(() => page.getByRole("button", { name: "Ligar cantos" }).getAttribute("aria-pressed"), POLL).toBe("true");
    const tl = page.getByLabel("Raio do canto superior esquerdo", { exact: true });
    await tl.fill("24");
    await tl.press("Enter");
    await expect.poll(async () => ((await doc()).nodes[id] as { radius: number[] }).radius[0], POLL).toBe(24);
    await expect.poll(() => page.locator(`[data-paprika-id="${id}"]`).evaluate((el) => getComputedStyle(el).borderTopLeftRadius), POLL).toBe("24px");
    await expect.poll(() => page.locator(`[data-paprika-id="${id}"]`).evaluate((el) => getComputedStyle(el).borderBottomRightRadius), POLL).toBe("8px");
    await page.getByRole("button", { name: "Ligar cantos" }).click();
    await expect.poll(async () => (await doc()).nodes[id], POLL).toMatchObject({ radius: 24 });
  });

  it("filho absoluto ignora o fluxo e o inspector alterna", async () => {
    const POLL = { timeout: 10_000 };
    const pageId = (await doc()).rootIds.at(-1)!;
    const made = await agent.callTool({
      name: "create_nodes",
      arguments: {
        ...(pageId ? { parentId: pageId } : {}),
        place: "none",
        nodes: [{
          type: "frame", id: "abs-row", name: "Abs row", x: 1400, y: 40, width: 220, height: 80, fill: "#ffffff",
          layout: { mode: "row", gap: 8, padding: 0, align: "start" },
          children: [
            { type: "rect", id: "abs-a", name: "A", width: 40, height: 20, fill: "#111111" },
            { type: "rect", id: "abs-pin", name: "Pin", width: 16, height: 16, x: 160, y: 4, fill: "#c43d27", layoutPositioning: "absolute" },
            { type: "rect", id: "abs-b", name: "B", width: 30, height: 20, fill: "#222222" },
          ],
        }],
      },
    });
    expect(made.isError, JSON.stringify(made.content)).toBeFalsy();
    await page.getByRole("button", { name: "Enquadrar" }).click();
    await layer("abs-row").click();
    expect(await page.getByRole("switch", { name: "Ignorar layout" }).count()).toBe(0);
    await layer("abs-a").click();
    const flowSwitch = page.getByRole("switch", { name: "Ignorar layout" });
    await expect.poll(() => flowSwitch.getAttribute("aria-checked"), POLL).toBe("false");
    await layer("abs-pin").click();
    const sw = page.getByRole("switch", { name: "Ignorar layout" });
    await expect.poll(() => sw.getAttribute("aria-checked"), POLL).toBe("true");
    const pin = page.locator('[data-paprika-id="abs-pin"]');
    await expect.poll(() => pin.evaluate((el) => getComputedStyle(el).position), POLL).toBe("absolute");
    const ax = (await page.locator('[data-paprika-id="abs-a"]').boundingBox())!;
    const bx = (await page.locator('[data-paprika-id="abs-b"]').boundingBox())!;
    const px = (await pin.boundingBox())!;
    expect(bx.x).toBeGreaterThan(ax.x + ax.width - 2);
    expect(px.x).toBeGreaterThan(bx.x + bx.width - 2);
    await sw.click();
    await expect.poll(async () => (await doc()).nodes["abs-pin"], POLL).not.toMatchObject({ layoutPositioning: "absolute" });
    await expect.poll(() => pin.evaluate((el) => getComputedStyle(el).position), POLL).toBe("relative");
    await sw.click();
    await expect.poll(async () => (await doc()).nodes["abs-pin"], POLL).toMatchObject({ layoutPositioning: "absolute" });
    await expect.poll(() => pin.evaluate((el) => getComputedStyle(el).position), POLL).toBe("absolute");
    await agent.callTool({ name: "delete_nodes", arguments: { ids: ["abs-row"] } });
  }, 30_000);

  it("alinha, envolve com Ctrl+Alt+G, mostra todos e destrava todos", async () => {
    const POLL = { timeout: 10_000 };
    const madePage = await agent.callTool({ name: "create_page", arguments: { id: "pAlign", name: "Alinhar" } });
    expect(madePage.isError, JSON.stringify(madePage.content)).toBeFalsy();
    await openPageById("pAlign");
    const made = await agent.callTool({
      name: "create_nodes",
      arguments: {
        parentId: "pAlign",
        place: "none",
        nodes: [
          { type: "rect", id: "alA", name: "AlA", x: 40, y: 20, width: 40, height: 20, fill: "#c43d27" },
          { type: "rect", id: "alB", name: "AlB", x: 140, y: 80, width: 30, height: 30, fill: "#1e2336" },
        ],
      },
    });
    expect(made.isError, JSON.stringify(made.content)).toBeFalsy();
    const rowA = page.locator('[data-layer-id="alA"]');
    await rowA.click();
    await page.locator('[data-layer-id="alB"]').click({ modifiers: ["ControlOrMeta"] });
    await expect.poll(() => page.getByTestId("selection").getAttribute("data-count"), POLL).toBe("2");
    await page.getByRole("button", { name: "Alinhar à esquerda" }).click();
    await expect.poll(async () => (await doc()).nodes.alB, POLL).toMatchObject({ x: 40 });
    // os atalhos que agem na seleção só valem com o foco na página, no palco, na árvore de camadas ou na barra: volta o foco à árvore
    await rowA.focus();
    await page.keyboard.press("Control+Alt+g");
    await expect.poll(async () => (await doc()).nodes.alA?.parentId, POLL).not.toBe("pAlign");
    const frameId = (await doc()).nodes.alA!.parentId!;
    expect((await doc()).nodes[frameId]).toMatchObject({ type: "frame" });
    await menuAction("Desfazer");
    await expect.poll(async () => (await doc()).nodes.alA?.parentId, POLL).toBe("pAlign");
    const flag = async (id: string, key: "locked" | "visible") => {
      const n = (await doc()).nodes[id];
      return n && n.type !== "page" ? n[key] : undefined;
    };
    await rowA.hover();
    await rowA.getByRole("button", { name: "Travar AlA" }).click();
    await expect.poll(() => flag("alA", "locked"), POLL).toBe(true);
    await layersMenu("Destravar todas as camadas travadas");
    await expect.poll(() => flag("alA", "locked"), POLL).toBe(false);
    await page.locator('[data-layer-id="alB"]').getByRole("button", { name: "Ocultar AlB" }).click();
    await expect.poll(() => flag("alB", "visible"), POLL).toBe(false);
    await layersMenu("Mostrar todas as camadas ocultas");
    await expect.poll(() => flag("alB", "visible"), POLL).toBe(true);
    await agent.callTool({ name: "delete_nodes", arguments: { ids: ["pAlign"] } });
  }, 30_000);

  it("constraints no inspector seguem o filho fora do fluxo", async () => {
    const POLL = { timeout: 10_000 };
    const pageId = "p084";
    const created = await agent.callTool({
      name: "create_page",
      arguments: { id: pageId, name: "Constraints" },
    });
    expect(created.isError, JSON.stringify(created.content)).toBeFalsy();
    await openPageById(pageId);
    const flowChild = { type: "rect", id: "c084-flow", name: "Flow", width: 30, height: 20, fill: "#111111" };
    const pinChild = {
      type: "rect", id: "c084-pin", name: "Pin", x: 140, y: 20, width: 40, height: 24, fill: "#c8401f",
      layoutPositioning: "absolute", constraints: { horizontal: "right", vertical: "top" },
    };
    const frame = {
      type: "frame", id: "c084", name: "Constraints", x: 1680, y: 40, width: 200, height: 80, fill: "#ffffff",
      layout: { mode: "row", gap: 8, padding: 0 },
      children: [flowChild, pinChild],
    };
    const made = await agent.callTool({
      name: "create_nodes",
      arguments: { parentId: pageId, place: "none", nodes: [frame] },
    });
    expect(made.isError, JSON.stringify(made.content)).toBeFalsy();
    await layer("c084-flow").click();
    await expect.poll(() => page.getByRole("radiogroup", { name: "Restrição horizontal" }).count(), POLL).toBe(0);
    await layer("c084-pin").click();
    const horizontal = page.getByRole("radiogroup", { name: "Restrição horizontal" });
    await openSection("Restrições");
    await expect.poll(() => horizontal.getByRole("radio", { name: "Direita" }).getAttribute("aria-checked"), POLL).toBe("true");
    await horizontal.getByRole("radio", { name: "Esquerda" }).click();
    await expect.poll(async () => (await doc()).nodes["c084-pin"], POLL).not.toHaveProperty("constraints");
    await horizontal.getByRole("radio", { name: "Direita" }).click();
    await expect.poll(async () => (await doc()).nodes["c084-pin"], POLL).toMatchObject({ constraints: { horizontal: "right", vertical: "top" } });
    await agent.callTool({ name: "update_nodes", arguments: { updates: [{ id: "c084", props: { width: 300 } }] } });
    await expect.poll(async () => (await doc()).nodes["c084-pin"], POLL).toMatchObject({ x: 240, y: 20, width: 40 });
    await agent.callTool({ name: "delete_nodes", arguments: { ids: ["p084"] } });

  }, 30_000);

  it("inspector da raiz grava o link e o menu converte o rect em caminho", async () => {
    const d = await doc();
    const pageId = d.rootIds.find((id) => d.nodes[id]?.type === "page") ?? null;
    if (pageId) await openPageById(pageId);
    const made = await agent.callTool({
      name: "create_nodes",
      arguments: {
        ...(pageId ? { parentId: pageId } : {}),
        place: "none",
        nodes: [{
          type: "frame", id: "b087", name: "Web", x: 980, y: 40, width: 280, height: 160, fill: "#ffffff",
          children: [{ type: "rect", id: "b087r", x: 16, y: 16, width: 72, height: 36, fill: "#112233", radius: 4 }],
        }],
      },
    });
    expect(made.isError, JSON.stringify(made.content)).toBeFalsy();
    await revealLayer(page, "b087");
    await layer("b087").click();
    await openSection("Web");
    const link = page.locator('[data-slot="collapsible-panel"]').filter({ has: page.getByLabel("Largura mínima", { exact: true }) }).getByLabel("Link", { exact: true });
    await expect.poll(() => link.count()).toBe(1);
    await expect.poll(() => page.getByLabel("Largura mínima", { exact: true }).count()).toBe(1);
    await link.fill("https://example.com");
    await link.press("Enter");
    await expect.poll(async () => (await doc()).nodes.b087).toMatchObject({ href: "https://example.com" });
    await page.locator('[data-paprika-id="b087r"]').click({ button: "right" });
    await page.getByTestId("convert-to-path").click();
    await expect.poll(async () => (await doc()).nodes.b087r?.type).toBe("path");
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await doc()).nodes.b087r?.type).toBe("rect");
  });
});
