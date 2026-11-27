import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import type { Page } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { callTool, closeSeededCanvas, connectAgent, dismissToasts, openSeededCanvas, revealLayer, webDist, type CanvasSession } from "./seededCanvas.js";

type Probe = { parentId?: string | null; children?: string[]; radius?: unknown; clip?: boolean; layout?: { mode: string; justify: string; align: string; padding: unknown; gap: unknown }; type: string; x: number; y: number; fill?: string };

describe.skipIf(!existsSync(webDist))("E2E: centralizar o conteúdo de uma forma (PAP-A-067)", { timeout: 40_000 }, () => {
  let session!: CanvasSession;
  let page: Page;
  let agent: Client;
  const clients: Client[] = [];

  const node = async (id: string): Promise<Probe> => {
    const r = (await agent.callTool({ name: "get_nodes", arguments: { ids: [id] } })) as { content: { text: string }[] };
    return JSON.parse(r.content[0]!.text)[0] as Probe;
  };
  const history = async () => {
    const r = (await agent.callTool({ name: "get_history", arguments: {} })) as { content: { text: string }[] };
    return JSON.parse(r.content[0]!.text) as { actor: string; label: string }[];
  };
  const select = async (id: string) => {
    await revealLayer(page, id);
    await page.locator(`[data-layer-id="${id}"]`).click();
    await page.getByRole("heading", { name: "Conteúdo", exact: true }).waitFor({ state: "visible" });
  };
  const horizontal = () => page.getByRole("radiogroup", { name: "Horizontal", exact: true });
  const vertical = () => page.getByRole("radiogroup", { name: "Vertical", exact: true });
  const centerButton = () => page.getByRole("button", { name: "Centralizar", exact: true });
  const summary = async () => (await page.getByText(/^\d+ filhos?, /).innerText()).trim();
  const centerOffset = (inner: string, outer: string) =>
    page.evaluate(
      ([i, o]) => {
        const a = document.querySelector<HTMLElement>(`[data-canvas-world] [data-paprika-id="${i}"]`)!.getBoundingClientRect();
        const b = document.querySelector<HTMLElement>(`[data-canvas-world] [data-paprika-id="${o}"]`)!.getBoundingClientRect();
        return { dx: a.left + a.width / 2 - (b.left + b.width / 2), dy: a.top + a.height / 2 - (b.top + b.height / 2) };
      },
      [inner, outer] as const,
    );

  beforeAll(async () => {
    session = await openSeededCanvas("paprika-center-content-");
    page = session.page;
    agent = await connectAgent(session.url, "e2e-center", clients);
    await callTool(agent, "create_nodes", {
      nodes: [
        {
          type: "frame",
          id: "btn",
          name: "Botão",
          x: 500,
          y: 520,
          width: 200,
          height: 80,
          fill: "#cc3322",
          children: [{ type: "text", id: "btn-label", text: "Começar", x: 16, y: 10, color: "#ffffff", fontSize: 20 }],
        },
        {
          type: "frame",
          id: "seal",
          name: "Selo",
          x: 500,
          y: 640,
          width: 120,
          height: 120,
          radius: 60,
          fill: "#fbbf24",
          children: [{ type: "path", id: "seal-icon", name: "Estrela", d: "M12 2L15 9L22 9L16 14L18 21L12 17L6 21L8 14L2 9L9 9Z", width: 24, height: 24, fill: "#111111", x: 10, y: 10 }],
        },
        { type: "rect", id: "plain", name: "Fundo do card", x: 720, y: 520, width: 120, height: 80, fill: "#3ea75d" },
        { type: "rect", id: "rbtn", name: "Botão rect", x: 900, y: 520, width: 200, height: 80, radius: 12, fill: "#7c3aed", stroke: { color: "#1e1b4b", width: 2 } },
        { type: "text", id: "rbtn-label", text: "Salvar", x: 930, y: 540, color: "#ffffff", fontSize: 20 },
        { type: "ellipse", id: "selo", name: "Selo círculo", x: 900, y: 640, width: 120, height: 120, fill: "#fbbf24" },
        { type: "path", id: "selo-icon", name: "Raio", d: "M12 2L15 9L22 9L16 14L18 21L12 17L6 21L8 14L2 9L9 9Z", width: 24, height: 24, fill: "#111111", x: 948, y: 688 },
        { type: "rect", id: "rkey", name: "Botão atalho", x: 1120, y: 520, width: 200, height: 80, fill: "#0f766e" },
        { type: "text", id: "rkey-label", text: "Atalho", x: 1140, y: 540, color: "#ffffff", fontSize: 20 },
        { type: "rect", id: "rmenu", name: "Botão menu", x: 500, y: 790, width: 200, height: 80, fill: "#b45309" },
        { type: "text", id: "rmenu-label", text: "Menu", x: 520, y: 810, color: "#ffffff", fontSize: 20 },
        { type: "rect", id: "rraw", name: "Botão cru", x: 1120, y: 760, width: 200, height: 80, fill: "#be123c", stroke: { color: "#000000", width: 4 } },
        { type: "text", id: "rraw-label", text: "Cru", x: 1140, y: 780, color: "#ffffff", fontSize: 20 },
        {
          type: "frame",
          id: "multi",
          name: "Dupla",
          x: 720,
          y: 640,
          width: 100,
          height: 100,
          fill: "#2563eb",
          children: [
            { type: "text", id: "multi-a", text: "Um", x: 4, y: 4 },
            { type: "text", id: "multi-b", text: "Dois", x: 60, y: 40 },
          ],
        },
      ],
    });
    await page.waitForSelector('[data-canvas-world] [data-paprika-id="btn"]');
  }, 60_000);

  afterAll(async () => {
    await closeSeededCanvas(session, clients);
  });

  it("A1: a seção Conteúdo aparece com o resumo, os grupos sem nada ativo e o botão com o atalho", async () => {
    await select("btn");
    await expect.poll(() => summary()).toBe("1 filho, posicionado à mão");
    await expect.poll(async () => (await horizontal().getByRole("radio", { checked: true }).count()) + (await vertical().getByRole("radio", { checked: true }).count())).toBe(0);
    await horizontal().waitFor({ state: "visible" });
    await vertical().waitFor({ state: "visible" });
    for (const name of ["Esquerda", "Centralizar na horizontal", "Direita"]) await horizontal().getByRole("radio", { name }).waitFor({ state: "visible" });
    for (const name of ["Topo", "Meio", "Base"]) await vertical().getByRole("radio", { name }).waitFor({ state: "visible" });
    await expect.poll(async () => (await centerButton().innerText()).trim()).toBe("Centralizar");
    await expect.poll(() => centerButton().locator("xpath=..").locator("kbd").allInnerTexts()).toEqual(["Alt", "C"]);
  });

  it("A2: Centralizar liga centro/meio, o texto vai ao centro e Ctrl+Z desfaz em um passo", async () => {
    const before = (await history()).length;
    await centerButton().click();
    await expect.poll(async () => (await node("btn")).layout).toMatchObject({ mode: "row", justify: "center", align: "center", padding: 0 });
    expect((await node("btn")).type).toBe("frame");
    expect((await node("btn")).fill).toBe("#cc3322");
    await expect.poll(() => horizontal().getByRole("radio", { name: "Centralizar na horizontal" }).isChecked()).toBe(true);
    await expect.poll(() => vertical().getByRole("radio", { name: "Meio" }).isChecked()).toBe(true);
    await expect.poll(() => summary()).toBe("1 filho, centralizado");
    await expect.poll(async () => Math.abs((await centerOffset("btn-label", "btn")).dx)).toBeLessThan(1.5);
    expect(Math.abs((await centerOffset("btn-label", "btn")).dy)).toBeLessThan(1.5);
    const after = await history();
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)).toMatchObject({ actor: "user", label: "centralizar conteúdo" });

    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await node("btn")).layout).toBeUndefined();
    await expect.poll(() => summary()).toBe("1 filho, posicionado à mão");
  });

  it("A2: trocar um grupo mantém o outro, no mesmo layout do painel Layout auto", async () => {
    await centerButton().click();
    await expect.poll(async () => (await node("btn")).layout?.justify).toBe("center");
    await horizontal().getByRole("radio", { name: "Esquerda" }).click();
    await expect.poll(async () => (await node("btn")).layout).toMatchObject({ mode: "row", justify: "start", align: "center" });
    await expect.poll(() => horizontal().getByRole("radio", { name: "Esquerda" }).isChecked()).toBe(true);
    await expect.poll(() => vertical().getByRole("radio", { name: "Meio" }).isChecked()).toBe(true);
    await expect.poll(() => summary()).toBe("1 filho, alinhado");
    await expect.poll(async () => Math.abs((await centerOffset("btn-label", "btn")).dx)).toBeGreaterThan(20);

    await vertical().getByRole("radio", { name: "Base" }).click();
    await expect.poll(async () => (await node("btn")).layout).toMatchObject({ justify: "start", align: "end" });

    await expect.poll(() => page.getByRole("combobox", { name: "Modo" }).innerText()).toBe("linha");
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await node("btn")).layout?.align).toBe("center");
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await node("btn")).layout).toMatchObject({ justify: "center", align: "center" });
  });

  it("os grupos andam pelo teclado, têm nomes e foco visível", async () => {
    await dismissToasts(page);
    const group = horizontal();
    await expect.poll(() => group.getByRole("radio", { name: "Centralizar na horizontal" }).isChecked()).toBe(true);
    await group.getByRole("radio", { name: "Centralizar na horizontal" }).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const ring = await page.evaluate(() => {
      const a = document.activeElement!;
      const css = getComputedStyle(a);
      return { name: a.getAttribute("aria-label"), visible: a.matches(":focus-visible"), style: css.outlineStyle, width: parseFloat(css.outlineWidth) };
    });
    expect(ring.visible).toBe(true);
    expect(["Esquerda", "Centralizar na horizontal", "Direita"]).toContain(ring.name);
    expect(ring.style).not.toBe("none");
    expect(ring.width).toBeGreaterThan(0);
    // Home/End não existem no padrão radio do ui-sdk (o antigo os tinha): as setas movem o foco e, no grupo, com laço (Esquerda <-> Direita)
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Esquerda");
    await page.keyboard.press("Space");
    await expect.poll(async () => (await node("btn")).layout?.justify).toBe("start");
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Direita");
    await page.keyboard.press("Space");
    await expect.poll(async () => (await node("btn")).layout?.justify).toBe("end");
    await centerButton().click();
    await expect.poll(async () => (await node("btn")).layout?.justify).toBe("center");
  });

  it("Alt+C no canvas alterna o conteúdo centralizado, um passo por vez", async () => {
    await page.getByTestId("viewport").click({ position: { x: 5, y: 5 } });
    await select("btn");
    await expect.poll(() => summary()).toContain("centralizado");
    const before = (await history()).length;
    await page.keyboard.press("Alt+c");
    await expect.poll(async () => (await node("btn")).layout).toBeUndefined();
    expect((await history()).length).toBe(before + 1);
    await expect.poll(() => summary()).toContain("posicionado à mão");
    await page.locator("body").press("Alt+c");
    await expect.poll(async () => (await node("btn")).layout).toMatchObject({ mode: "row", justify: "center", align: "center", padding: 0 });
    expect((await history()).length).toBe(before + 2);
    // o atalho C de uma ferramenta não pode ser disparado pelo Alt+C: a ferramenta ativa segue sendo Selecionar
    expect(await page.getByRole("button", { name: "Selecionar" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("A3: forma redonda com ícone usa o mesmo controle", async () => {
    await select("seal");
    await expect.poll(() => summary()).toBe("1 filho, posicionado à mão");
    await centerButton().click();
    await expect.poll(async () => (await node("seal")).layout).toMatchObject({ mode: "row", justify: "center", align: "center" });
    await expect.poll(() => summary()).toBe("1 filho, centralizado");
    await expect.poll(async () => Math.abs((await centerOffset("seal-icon", "seal")).dx)).toBeLessThan(1.5);
  });

  it("vários filhos: o resumo conta e eles alinham juntos", async () => {
    await select("multi");
    await expect.poll(() => summary()).toBe("2 filhos, posicionado à mão");
    await centerButton().click();
    await expect.poll(() => summary()).toBe("2 filhos, centralizado");
    const a = await centerOffset("multi-a", "multi");
    const b = await centerOffset("multi-b", "multi");
    expect(Math.abs((a.dy + b.dy) / 2)).toBeLessThan(2);
  });

  it("A4: forma sem filhos mostra só a dica, com os grupos desabilitados e sem o botão", async () => {
    await select("plain");
    await expect.poll(() => page.getByText("Adicione um texto ou ícone para alinhar.").count()).toBe(1);
    await expect.poll(() => centerButton().count()).toBe(0);
    await expect.poll(() => horizontal().getByRole("radio", { name: "Esquerda" }).isDisabled()).toBe(true);
    await expect.poll(() => vertical().getByRole("radio", { name: "Base" }).isDisabled()).toBe(true);
    const before = (await history()).length;
    await page.locator("body").press("Alt+c");
    expect((await history()).length).toBe(before);
    expect((await node("plain")).type).toBe("rect");
  });

  it("A5: o menu de contexto oferece Centralizar conteúdo com o atalho e desfaz num passo", async () => {
    await select("btn");
    await expect.poll(async () => (await node("btn")).layout?.justify).toBe("center");
    const box = await page.locator('[data-canvas-world] [data-paprika-id="btn"]').boundingBox();
    await page.mouse.click(box!.x + 3, box!.y + 3, { button: "right" });
    const item = page.getByTestId("center-content");
    await item.waitFor({ state: "visible" });
    await expect.poll(() => item.getAttribute("role")).toBe("menuitemcheckbox");
    await expect.poll(() => item.getAttribute("aria-checked")).toBe("true");
    await expect.poll(() => item.locator("kbd").allInnerTexts()).toEqual(["Alt", "C"]);
    const before = (await history()).length;
    await item.click();
    await expect.poll(async () => (await node("btn")).layout).toBeUndefined();
    expect((await history()).length).toBe(before + 1);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await node("btn")).layout?.justify).toBe("center");
  });

  it("B1: rect com texto por cima mostra a seção Conteúdo; Centralizar converte, adota e centraliza em um passo, e Ctrl+Z devolve o rect", async () => {
    const original = await node("rbtn");
    expect(original.type).toBe("rect");
    await select("rbtn");
    await expect.poll(() => summary()).toBe("1 filho, posicionado à mão");
    await expect.poll(() => horizontal().getByRole("radio", { name: "Esquerda" }).isDisabled()).toBe(false);
    const before = (await history()).length;
    await centerButton().click();
    await expect.poll(async () => (await node("rbtn")).type).toBe("frame");
    const frame = await node("rbtn");
    expect(frame).toMatchObject({ fill: "#7c3aed", radius: 12, children: ["rbtn-label"], layout: { mode: "row", justify: "center", align: "center", padding: 0 } });
    expect((await node("rbtn-label")).parentId).toBe("rbtn");
    await expect.poll(async () => Math.abs((await centerOffset("rbtn-label", "rbtn")).dx)).toBeLessThan(1.5);
    expect(Math.abs((await centerOffset("rbtn-label", "rbtn")).dy)).toBeLessThan(1.5);
    await expect.poll(() => summary()).toBe("1 filho, centralizado");
    const after = await history();
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)).toMatchObject({ actor: "user", label: "centralizar conteúdo" });

    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await node("rbtn")).type).toBe("rect");
    expect(await node("rbtn")).toEqual(original);
    expect((await node("rbtn-label")).parentId ?? null).toBe(null);
    await expect.poll(() => summary()).toBe("1 filho, posicionado à mão");
    await page.keyboard.press("Control+Shift+z");
    await expect.poll(async () => (await node("rbtn")).type).toBe("frame");
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await node("rbtn")).type).toBe("rect");
  });

  it("B2: elipse redonda com ícone: vira frame com radius metade do tamanho, o ícone vai ao centro e Ctrl+Z restaura a elipse", async () => {
    const original = await node("selo");
    await select("selo");
    await expect.poll(() => summary()).toBe("1 filho, posicionado à mão");
    await centerButton().click();
    await expect.poll(async () => (await node("selo")).type).toBe("frame");
    expect(await node("selo")).toMatchObject({ radius: 60, fill: "#fbbf24", children: ["selo-icon"], layout: { justify: "center", align: "center" } });
    await expect.poll(async () => Math.abs((await centerOffset("selo-icon", "selo")).dx)).toBeLessThan(1.5);
    expect(Math.abs((await centerOffset("selo-icon", "selo")).dy)).toBeLessThan(1.5);
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.querySelector<HTMLElement>('[data-canvas-world] [data-paprika-id="selo"]')!).borderRadius))
      .toBe("60px");
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await node("selo")).type).toBe("ellipse");
    expect(await node("selo")).toEqual(original);
  });

  it("B3: Alt+C numa forma com conteúdo converte e centraliza num passo, e Ctrl+Z restaura", async () => {
    const original = await node("rkey");
    await select("rkey");
    const before = (await history()).length;
    await page.locator("body").press("Alt+c");
    await expect.poll(async () => (await node("rkey")).type).toBe("frame");
    expect((await node("rkey")).layout).toMatchObject({ mode: "row", justify: "center", align: "center" });
    expect((await history()).length).toBe(before + 1);
    await expect.poll(async () => Math.abs((await centerOffset("rkey-label", "rkey")).dx)).toBeLessThan(1.5);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await node("rkey")).type).toBe("rect");
    expect(await node("rkey")).toEqual(original);
  });

  it("B4: o menu de contexto oferece Centralizar conteúdo para a forma com conteúdo e converte num passo", async () => {
    const original = await node("rmenu");
    await select("rmenu");
    await dismissToasts(page);
    const box = await page.locator('[data-canvas-world] [data-paprika-id="rmenu"]').boundingBox();
    await page.mouse.click(box!.x + 3, box!.y + 3, { button: "right" });
    const item = page.getByTestId("center-content");
    await item.waitFor({ state: "visible" });
    await expect.poll(() => item.getAttribute("aria-checked")).toBe("false");
    const before = (await history()).length;
    await item.click();
    await expect.poll(async () => (await node("rmenu")).type).toBe("frame");
    expect((await history()).length).toBe(before + 1);
    await expect.poll(async () => Math.abs((await centerOffset("rmenu-label", "rmenu")).dx)).toBeLessThan(1.5);
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await node("rmenu")).type).toBe("rect");
    expect(await node("rmenu")).toEqual(original);
  });

  it("B5: converter e adotar sozinho não move o conteúdo (traço dentro compensado)", async () => {
    const rect = async (id: string) => page.evaluate((i) => {
      const r = document.querySelector<HTMLElement>(`[data-canvas-world] [data-paprika-id="${i}"]`)!.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }, id);
    const before = await rect("rraw-label");
    const frameBefore = await rect("rraw");
    await callTool(agent, "apply_ops", { ops: [{ op: "convert_to_frame", id: "rraw", adopt: ["rraw-label"] }] });
    await expect.poll(async () => (await node("rraw")).type).toBe("frame");
    await page.waitForTimeout(150);
    const after = await rect("rraw-label");
    const frameAfter = await rect("rraw");
    expect(frameAfter).toEqual(frameBefore);
    expect(Math.abs(after.x - before.x)).toBeLessThan(0.6);
    expect(Math.abs(after.y - before.y)).toBeLessThan(0.6);
    await callTool(agent, "undo", {});
    await expect.poll(async () => (await node("rraw")).type).toBe("rect");
  });

  it("A5: o item some quando só há uma forma sem filhos", async () => {
    await select("plain");
    await page.keyboard.press("Escape");
    const box = await page.locator('[data-canvas-world] [data-paprika-id="plain"]').boundingBox();
    await page.mouse.click(box!.x + 3, box!.y + 3, { button: "right" });
    await page.getByRole("menu").waitFor({ state: "visible" });
    await expect.poll(() => page.getByTestId("center-content").count()).toBe(0);
  });
});
