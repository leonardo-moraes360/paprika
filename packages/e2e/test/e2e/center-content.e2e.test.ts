import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import type { Page } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { callTool, closeSeededCanvas, connectAgent, openSeededCanvas, revealLayer, webDist, type CanvasSession } from "./seededCanvas.js";

type Probe = { layout?: { mode: string; justify: string; align: string; padding: unknown; gap: unknown }; type: string; x: number; y: number; fill?: string };

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
    await page.locator('[data-testid="inspector-section-position"]').waitFor({ state: "visible" });
  };
  const centerOffset = (inner: string, outer: string) =>
    page.evaluate(
      ([i, o]) => {
        const a = document.querySelector<HTMLElement>(`.world [data-paprika-id="${i}"]`)!.getBoundingClientRect();
        const b = document.querySelector<HTMLElement>(`.world [data-paprika-id="${o}"]`)!.getBoundingClientRect();
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
    await page.waitForSelector('.world [data-paprika-id="btn"]');
  }, 60_000);

  afterAll(async () => {
    await closeSeededCanvas(session, clients);
  });

  it("A1: a seção Conteúdo aparece com o resumo, os grupos sem nada ativo e o botão com o atalho", async () => {
    await select("btn");
    const section = page.getByTestId("content-section");
    await section.waitFor({ state: "visible" });
    await expect.poll(async () => (await page.getByTestId("content-summary").innerText()).trim()).toBe("1 filho: texto “Começar”, posição manual (16, 10)");
    await expect.poll(() => section.getByRole("radio", { checked: true }).count()).toBe(0);
    await section.getByRole("radiogroup", { name: "Horizontal" }).waitFor({ state: "visible" });
    await section.getByRole("radiogroup", { name: "Vertical" }).waitFor({ state: "visible" });
    for (const name of ["Esquerda", "Centro", "Direita", "Topo", "Meio", "Base"]) await section.getByRole("radio", { name }).waitFor({ state: "visible" });
    await expect.poll(async () => (await page.getByTestId("content-center").innerText()).trim()).toBe("Centralizar");
    await expect.poll(() => section.getByTestId("key-hint").locator("kbd").allInnerTexts()).toEqual(["Alt", "C"]);
  });

  it("A2: Centralizar liga centro/meio, o texto vai ao centro e Ctrl+Z desfaz em um passo", async () => {
    const before = (await history()).length;
    await page.getByTestId("content-center").click();
    await expect.poll(async () => (await node("btn")).layout).toMatchObject({ mode: "row", justify: "center", align: "center", padding: 0 });
    expect((await node("btn")).type).toBe("frame");
    expect((await node("btn")).fill).toBe("#cc3322");
    const section = page.getByTestId("content-section");
    await expect.poll(() => section.getByRole("radio", { name: "Centro" }).isChecked()).toBe(true);
    await expect.poll(() => section.getByRole("radio", { name: "Meio" }).isChecked()).toBe(true);
    await expect.poll(async () => (await page.getByTestId("content-summary").innerText()).trim()).toBe("1 filho: texto “Começar”, centralizado");
    await expect.poll(async () => Math.abs((await centerOffset("btn-label", "btn")).dx)).toBeLessThan(1.5);
    expect(Math.abs((await centerOffset("btn-label", "btn")).dy)).toBeLessThan(1.5);
    const after = await history();
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)).toMatchObject({ actor: "user", label: "centralizar conteúdo" });

    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await node("btn")).layout).toBeUndefined();
    await expect.poll(async () => (await page.getByTestId("content-summary").innerText()).trim()).toBe("1 filho: texto “Começar”, posição manual (16, 10)");
  });

  it("A2: trocar um grupo mantém o outro, no mesmo layout do painel Layout auto", async () => {
    await page.getByTestId("content-center").click();
    await expect.poll(async () => (await node("btn")).layout?.justify).toBe("center");
    await page.getByTestId("content-horizontal").getByRole("radio", { name: "Esquerda" }).click();
    await expect.poll(async () => (await node("btn")).layout).toMatchObject({ mode: "row", justify: "start", align: "center" });
    const section = page.getByTestId("content-section");
    await expect.poll(() => section.getByRole("radio", { name: "Esquerda" }).isChecked()).toBe(true);
    await expect.poll(() => section.getByRole("radio", { name: "Meio" }).isChecked()).toBe(true);
    await expect.poll(async () => (await page.getByTestId("content-summary").innerText()).trim()).toBe("1 filho: texto “Começar”, alinhado");
    await expect.poll(async () => Math.abs((await centerOffset("btn-label", "btn")).dx)).toBeGreaterThan(20);

    await page.getByTestId("content-vertical").getByRole("radio", { name: "Base" }).click();
    await expect.poll(async () => (await node("btn")).layout).toMatchObject({ justify: "start", align: "end" });

    await page.getByTestId("inspector-section-frame-layout").getByRole("button").first().click();
    await expect.poll(() => page.getByTestId("inspector-section-frame-layout").getByRole("combobox", { name: "Modo" }).innerText()).toBe("linha");
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await node("btn")).layout?.align).toBe("center");
    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await node("btn")).layout).toMatchObject({ justify: "center", align: "center" });
  });

  it("os grupos andam pelo teclado, têm nomes e foco visível", async () => {
    const horizontal = page.getByTestId("content-horizontal");
    await horizontal.getByRole("radio", { name: "Centro" }).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const ring = await page.evaluate(() => {
      const a = document.activeElement!;
      const css = getComputedStyle(a);
      return { name: a.getAttribute("aria-label"), visible: a.matches(":focus-visible"), style: css.outlineStyle, width: parseFloat(css.outlineWidth) };
    });
    expect(ring.visible).toBe(true);
    expect(["Esquerda", "Centro", "Direita"]).toContain(ring.name);
    expect(ring.style).not.toBe("none");
    expect(ring.width).toBeGreaterThan(0);
    await page.keyboard.press("Home");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Esquerda");
    await page.keyboard.press("Space");
    await expect.poll(async () => (await node("btn")).layout?.justify).toBe("start");
    await page.keyboard.press("End");
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Direita");
    await page.keyboard.press("Space");
    await expect.poll(async () => (await node("btn")).layout?.justify).toBe("end");
    await page.getByTestId("content-center").click();
    await expect.poll(async () => (await node("btn")).layout?.justify).toBe("center");
  });

  it("Alt+C no canvas alterna o conteúdo centralizado, um passo por vez", async () => {
    await page.getByTestId("viewport").click({ position: { x: 5, y: 5 } });
    await select("btn");
    await expect.poll(async () => (await page.getByTestId("content-summary").innerText()).trim()).toContain("centralizado");
    const before = (await history()).length;
    await page.keyboard.press("Alt+c");
    await expect.poll(async () => (await node("btn")).layout).toBeUndefined();
    expect((await history()).length).toBe(before + 1);
    await expect.poll(async () => (await page.getByTestId("content-summary").innerText()).trim()).toContain("posição manual");
    await page.locator("body").press("Alt+c");
    await expect.poll(async () => (await node("btn")).layout).toMatchObject({ mode: "row", justify: "center", align: "center", padding: 0 });
    expect((await history()).length).toBe(before + 2);
    expect(await page.getByRole("button", { name: "Cilindro" }).getAttribute("aria-pressed")).not.toBe("true");
  });

  it("A3: forma redonda com ícone usa o mesmo controle", async () => {
    await select("seal");
    await expect.poll(async () => (await page.getByTestId("content-summary").innerText()).trim()).toBe("1 filho: ícone “Estrela”, posição manual (10, 10)");
    await page.getByTestId("content-center").click();
    await expect.poll(async () => (await node("seal")).layout).toMatchObject({ mode: "row", justify: "center", align: "center" });
    await expect.poll(async () => (await page.getByTestId("content-summary").innerText()).trim()).toBe("1 filho: ícone “Estrela”, centralizado");
    await expect.poll(async () => Math.abs((await centerOffset("seal-icon", "seal")).dx)).toBeLessThan(1.5);
  });

  it("vários filhos: o resumo conta e eles alinham juntos", async () => {
    await select("multi");
    await expect.poll(async () => (await page.getByTestId("content-summary").innerText()).trim()).toBe("2 filhos: 2 textos, posição manual");
    await page.getByTestId("content-center").click();
    await expect.poll(async () => (await page.getByTestId("content-summary").innerText()).trim()).toBe("2 filhos: 2 textos, centralizado");
    const a = await centerOffset("multi-a", "multi");
    const b = await centerOffset("multi-b", "multi");
    expect(Math.abs((a.dy + b.dy) / 2)).toBeLessThan(2);
  });

  it("A4: forma sem filhos mostra só a dica, com os grupos desabilitados e sem o botão", async () => {
    await select("plain");
    await expect.poll(async () => (await page.getByTestId("content-empty").innerText()).trim()).toBe("Adicione um texto ou ícone para alinhar");
    await expect.poll(() => page.getByTestId("content-center").count()).toBe(0);
    await expect.poll(() => page.getByTestId("content-horizontal").getByRole("radio", { name: "Esquerda" }).isDisabled()).toBe(true);
    await expect.poll(() => page.getByTestId("content-vertical").getByRole("radio", { name: "Base" }).isDisabled()).toBe(true);
    const before = (await history()).length;
    await page.locator("body").press("Alt+c");
    expect((await history()).length).toBe(before);
    expect((await node("plain")).type).toBe("rect");
  });

  it("A5: o menu de contexto oferece Centralizar conteúdo com o atalho e desfaz num passo", async () => {
    await select("btn");
    await expect.poll(async () => (await node("btn")).layout?.justify).toBe("center");
    const box = await page.locator('.world [data-paprika-id="btn"]').boundingBox();
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

  it("A5: o item some quando só há uma forma sem filhos", async () => {
    await select("plain");
    await page.keyboard.press("Escape");
    const box = await page.locator('.world [data-paprika-id="plain"]').boundingBox();
    await page.mouse.click(box!.x + 3, box!.y + 3, { button: "right" });
    await page.getByTestId("layer-menu").waitFor({ state: "visible" });
    await expect.poll(() => page.getByTestId("center-content").count()).toBe(0);
  });
});
