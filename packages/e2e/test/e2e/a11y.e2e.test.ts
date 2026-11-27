import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import type { Browser, Page } from "playwright";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { pinLocale } from "./locale.js";
import { closeSeededCanvas, connectAgent, openSeededCanvas, webDist, type CanvasSession } from "./seededCanvas.js";
import { closeToasts } from "./support-e3.js";

/** `rgb()`/`rgba()` (0 to 255) and `color(srgb r g b)` (0 to 1): the two spellings `getComputedStyle` gives for the app's colours. */
function contrastRatio(fg: string, bg: string) {
  const channel = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  const lum = (s: string) => {
    const unit = s.startsWith("color(") ? 255 : 1;
    const [r, g, b] = (s.replace(/^[a-z]+\(/, "").match(/[\d.]+/g) ?? []).slice(0, 3).map((v) => Number(v) * unit);
    return 0.2126 * channel(r ?? 0) + 0.7152 * channel(g ?? 0) + 0.0722 * channel(b ?? 0);
  };
  const [hi, lo] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/** The colour of an element's text and the first opaque background at or above it (what the person actually sees under the text). */
const textColours = (el: Element): [string, string] => {
  const fg = getComputedStyle(el).color;
  let node: Element | null = el;
  while (node) {
    const bg = getComputedStyle(node).backgroundColor;
    if (!/^rgba\(.*, 0\)$|^transparent$|^color\(srgb [\d. ]+\/ 0\)$/.test(bg)) return [fg, bg];
    node = node.parentElement;
  }
  return [fg, "rgb(255, 255, 255)"];
};

describe.skipIf(!existsSync(webDist))("E2E: acessibilidade do editor pelo teclado", () => {
  let session!: CanvasSession;
  let page: Page;
  let browser: Browser;
  const external = () => session.external;
  const clients: Client[] = [];

  beforeAll(async () => {
    session = await openSeededCanvas("paprika-a11y-");
    page = session.page;
    browser = session.browser;
  }, 60_000);

  afterAll(async () => {
    await closeSeededCanvas(session, clients);
  });

  // The colours transition on a theme switch: measure only once the transitions are over.
  const setTheme = async (target: Page, name: "Claro" | "Escuro") => {
    await target.getByRole("radio", { name }).click();
    await target.waitForFunction(() => document.getAnimations().every((a) => a.playState === "finished" || !(a instanceof CSSTransition)));
  };

  const tabTo = async (match: (el: Element) => boolean, max = 200) => {
    const trail: string[] = [];
    for (let i = 0; i < max; i++) {
      await page.keyboard.press("Tab");
      const hit = await page.evaluate((src) => new Function("el", `return (${src})(el)`)(document.activeElement), match.toString());
      if (hit) return;
      if (i < 40) trail.push(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName ?? ""));
    }
    throw new Error(`element not reached with Tab: ${trail.join(" > ")}`);
  };

  it("Enter e Espaço ativam um botão focado pelo teclado (o pan do canvas não os engole)", async () => {
    await page.locator("body").focus();
    // The toolbar is one tab stop (roving focus): Tab reaches it, the arrows walk its buttons.
    await tabTo((el) => el.closest("[role=toolbar]")?.getAttribute("aria-label") === "Ferramentas");
    const walk = async (label: string, key: "ArrowRight" | "ArrowLeft") => {
      for (let i = 0; i < 12; i++) {
        if ((await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === label) return;
        await page.keyboard.press(key);
      }
      throw new Error(`${label} not reached with ${key}`);
    };
    await walk("Retângulo", "ArrowRight");
    await page.keyboard.press("Enter");
    await expect.poll(() => page.getByRole("button", { name: "Retângulo" }).getAttribute("aria-pressed")).toBe("true");
    await walk("Frame", "ArrowLeft");
    await page.keyboard.press(" ");
    await expect.poll(() => page.getByRole("button", { name: "Frame" }).getAttribute("aria-pressed")).toBe("true");
    await page.keyboard.press("Escape");
  });

  it("o botão de ocultar camada aparece quando a linha tem o foco e Ctrl+Shift+H o aciona", async () => {
    const row = page.locator('[data-layer-id="login"]');
    await row.focus();
    const eye = row.getByRole("button", { name: /^Ocultar / });
    await expect.poll(() => eye.isVisible()).toBe(true);
    await expect(eye.getAttribute("aria-keyshortcuts")).resolves.toMatch(/Control\+Shift\+H/);
    await page.keyboard.press("Control+Shift+H");
    await expect.poll(() => eye.getAttribute("aria-pressed")).toBe("true");
    await page.keyboard.press("Control+Shift+H");
    await expect.poll(() => eye.getAttribute("aria-pressed")).toBe("false");
    await expect(page.getByRole("treeitem", { name: "Login · mobile", exact: true }).count()).resolves.toBe(1);
  });

  it("F2 renomeia a camada focada", async () => {
    const row = page.locator('[data-layer-id="login"]');
    await row.focus();
    await page.keyboard.press("F2");
    const field = page.getByRole("textbox", { name: "Nome da camada" });
    await expect.poll(() => field.count()).toBe(1);
    await page.keyboard.press("Escape");
    await expect.poll(() => field.count()).toBe(0);
  });

  it("páginas abrem pelo teclado e a ativa é anunciada", async () => {
    const rows = page.getByRole("list", { name: "Páginas" }).getByRole("listitem");
    // The demo has loose roots: the first page created wraps them into "Page 1", so there are two rows afterwards.
    await page.getByRole("button", { name: "Nova página" }).click();
    await expect.poll(() => rows.count()).toBe(2);
    const first = rows.first().getByRole("button").first();
    await first.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => first.getAttribute("aria-current")).toBe("page");
    await page.keyboard.press("Tab");
    const del = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? "");
    expect(del).toMatch(/^Excluir página /);
    await expect(page.evaluate(() => getComputedStyle(document.activeElement!).display)).resolves.not.toBe("none");
    await page.keyboard.press("Control+z");
  });

  it("a seção Conteúdo do painel tem grupos nomeados, a dica de atalho e o foco visível (4.1.2, 2.4.7)", async () => {
    await page.locator('[data-layer-id="login"]').click({ position: { x: 70, y: 14 } });
    const section = page.locator('[data-slot="collapsible"]').filter({ has: page.getByRole("heading", { name: "Conteúdo", level: 3 }) });
    await section.waitFor({ state: "visible" });
    await expect(section.getByRole("radiogroup", { name: "Horizontal" }).count()).resolves.toBe(1);
    await expect(section.getByRole("radiogroup", { name: "Vertical" }).count()).resolves.toBe(1);
    await expect(section.getByRole("radio").count()).resolves.toBe(6);
    await expect(section.getByRole("button", { name: "Centralizar" }).count()).resolves.toBe(1);
    await expect(section.locator("kbd").allInnerTexts()).resolves.toEqual(["Alt", "C"]);
    const hint = await section.locator("kbd").first().evaluate(textColours);
    expect(contrastRatio(hint[0], hint[1])).toBeGreaterThanOrEqual(4.5);
    await section.getByRole("button", { name: "Centralizar" }).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    const ring = await page.evaluate(() => {
      const a = document.activeElement!;
      const cs = getComputedStyle(a);
      return { inGroup: !!a.closest("[role=radiogroup]"), visible: a.matches(":focus-visible"), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
    });
    expect(ring).toMatchObject({ inGroup: true, visible: true });
    expect(ring.style).not.toBe("none");
    await page.keyboard.press("Escape");
  });

  it("asides têm nomes e a página tem um h1 com o nome do workspace", async () => {
    await expect(page.getByRole("complementary", { name: "Painel de camadas" }).count()).resolves.toBe(1);
    await expect(page.getByRole("complementary", { name: "Propriedades", exact: true }).count()).resolves.toBe(1);
    await expect(page.getByRole("heading", { level: 1 }).textContent()).resolves.toBe("Demo Paprika");
    await expect(page.getByRole("banner").getByRole("navigation", { name: "Caminho do documento" }).textContent()).resolves.toContain("Demo Paprika");
    await expect(page.getByRole("status").filter({ hasText: "MCP em /mcp" }).count()).resolves.toBe(1);
  });

  it("tooltips do chrome abrem no foco, fecham no Esc e os ícones mantêm aria-label (1.4.13, 4.1.2)", async () => {
    // Tooltips open for keyboard focus, so the buttons are reached the way a keyboard user does: Tab to the toolbar, the arrows inside it.
    await page.keyboard.press("Escape");
    // A key press first, so the browser is in keyboard modality when focus lands on the button.
    const reach = async (toolbar: string, label: string) => {
      await page.keyboard.press("Shift");
      await page.getByRole("toolbar", { name: toolbar }).getByRole("button", { name: label, exact: true }).focus();
    };
    const rect = page.getByRole("button", { name: "Retângulo" });
    await expect(rect.getAttribute("aria-label")).resolves.toBe("Retângulo");
    await expect(rect.getAttribute("title")).resolves.toBeNull();
    await reach("Ferramentas", "Retângulo");
    const rectTip = page.getByRole("tooltip", { name: /Retângulo/ });
    await rectTip.waitFor({ state: "visible", timeout: 3_000 });
    await expect(rectTip.textContent()).resolves.toMatch(/Retângulo/);
    await page.keyboard.press("Escape");
    await expect.poll(() => rectTip.count()).toBe(0);
  });

  // Both agent tests need the same eight agents; whichever runs first connects them.
  let agentsConnected = 0;
  const ensureAgents = async () => {
    for (; agentsConnected < 8; agentsConnected++) {
      const c = await connectAgent(session.url, `a11y-agent-${agentsConnected}`, clients);
      await c.callTool({ name: "get_nodes", arguments: { ids: ["login"] } });
    }
  };

  it("texto sobre o acento e sobre as cores de agente passa de 4,5:1 (1.4.3)", async () => {
    await ensureAgents();
    const cursors = page.getByTestId("agent-cursor");
    await expect.poll(() => cursors.count(), { timeout: 10_000 }).toBe(8);
    const swatch = await page.evaluate((src) => {
      const colours = new Function("el", `return (${src})(el)`) as (el: Element) => [string, string];
      const tags = [...document.querySelectorAll('[data-testid="agent-frame-state"] > span')];
      return { tags: tags.map(colours), tool: colours(document.querySelector('[role=toolbar][aria-label=Ferramentas] [aria-pressed=true]')!) };
    }, textColours.toString());
    expect(swatch.tags).toHaveLength(8);
    for (const [fg, bg] of swatch.tags) expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(swatch.tool[0], swatch.tool[1])).toBeGreaterThanOrEqual(4.5);
  });

  it("o roster de agentes é focável, tem nome e passa de 4,5:1 (2.4.7, 1.4.3)", async () => {
    await ensureAgents();
    const trigger = page.getByRole("banner").getByRole("button", { name: /agentes? ativos?/ });
    await expect.poll(() => trigger.isVisible(), { timeout: 10_000 }).toBe(true);
    await trigger.click();
    const roster = page.getByRole("dialog", { name: /agentes ativos/ });
    const rows = roster.getByRole("button", { name: /Ir até/ });
    await expect.poll(() => rows.count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(8);
    // A key press first, so the browser is in keyboard modality and the programmatic focus below matches :focus-visible.
    await page.keyboard.press("Shift");
    const seen = await rows.evaluateAll((els, src) => {
      const colours = new Function("el", `return (${src})(el)`) as (el: Element) => [string, string];
      return els.map((el) => {
        (el as HTMLElement).focus();
        const name = el.querySelector("span.font-semibold")!;
        return {
          focused: document.activeElement === el,
          ring: getComputedStyle(el).outlineStyle !== "none" && el.matches(":focus-visible"),
          name: colours(name),
          tool: colours(el.querySelectorAll("span.text-xs")[0]!),
          dot: getComputedStyle(el.querySelector("span.rounded-full")!).backgroundColor,
          nativeTitle: el.getAttribute("title"),
        };
      });
    }, textColours.toString());
    await page.keyboard.press("Escape");
    expect(seen.length).toBeGreaterThanOrEqual(8);
    for (const r of seen) {
      expect(r.nativeTitle).toBeNull();
      expect(r.focused).toBe(true);
      expect(contrastRatio(r.name[0], r.name[1])).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(r.tool[0], r.tool[1])).toBeGreaterThanOrEqual(4.5);
    }
    expect(seen.some((r) => r.ring)).toBe(true);
    expect(new Set(seen.map((r) => r.dot)).size).toBeGreaterThanOrEqual(4);
  }, 30_000);

  it("o painel Histórico e o toast de desfazer têm nomes, papéis e contraste (4.1.2, 1.4.3)", async () => {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.move(2, 2);
    await expect.poll(() => page.locator("[data-slot=tooltip-content]:not([data-closed])").count(), { timeout: 5_000 }).toBe(0);
    // Make sure there is at least one step to list, whatever ran before.
    await page.locator('[data-layer-id="login"]').focus();
    // One step only: the Ctrl+Z further down undoes it, leaving the layer as it was.
    await page.keyboard.press("Control+Shift+H");
    await closeToasts(page);
    await page.keyboard.press("Control+h");
    const panel = page.getByRole("region", { name: "Histórico" });
    await expect.poll(() => panel.count()).toBe(1);
    await expect.poll(() => panel.getByRole("radiogroup", { name: "Filtrar histórico" }).count()).toBe(1);
    await expect.poll(() => panel.getByRole("radio", { name: "Só meus" }).count()).toBe(1);
    await expect.poll(() => panel.getByRole("button", { name: "Fechar histórico" }).count()).toBe(1);
    await expect.poll(() => panel.locator("[data-step-id]").count()).toBeGreaterThan(0);
    const names = await panel.locator("[data-step-id]").evaluateAll((els) => els.map((el) => [el.querySelector("button")?.getAttribute("aria-label"), el.querySelector("[aria-haspopup]")?.getAttribute("aria-label")]));
    for (const [row, menu] of names) {
      expect(row).toBeTruthy();
      expect(menu).toMatch(/^Ações do passo /);
    }
    await panel.focus();
    await page.keyboard.press("Escape");
    await expect.poll(() => panel.count()).toBe(0);
    await page.locator("body").focus();
    await page.keyboard.press("Control+z");
    const toast = page.locator('[data-slot="toast"][data-front]');
    await expect.poll(() => toast.count()).toBe(1);
    await expect.poll(() => page.getByRole("status").filter({ hasText: /Nada seu para desfazer|Desfeito|Nada para desfazer/ }).count()).toBeGreaterThan(0);
    await expect.poll(() => toast.getByRole("button", { name: "Fechar notificação" }).count()).toBe(1);
    const colours = await toast.locator('[data-slot="toast-title"]').evaluate((el, src) => (new Function("el", `return (${src})(el)`) as (el: Element) => [string, string])(el), textColours.toString());
    expect(contrastRatio(colours[0], colours[1])).toBeGreaterThanOrEqual(4.5);
    await closeToasts(page);
  }, 30_000);

  // The old app had a primitives gallery at /ui; the new one has none (the primitives are the design system's and live in the real
  // screens), so these checks run on the same primitives where they are used.
  describe("primitivas nas telas reais", () => {
    it("o alternador de ícones tem nome, foco visível e contraste nos dois temas (4.1.2, 2.4.7, 1.4.11)", async () => {
      await page.locator('[data-layer-id="login"]').click({ position: { x: 70, y: 14 } });
      const group = page.getByRole("radiogroup", { name: "Horizontal" });
      await group.waitFor();
      await expect(group.getByRole("radio").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? el.textContent))).resolves.toEqual(["Esquerda", "Centralizar na horizontal", "Direita"]);
      for (const theme of ["Escuro", "Claro"] as const) {
        await setTheme(page, theme);
        const active = group.getByRole("radio", { name: "Esquerda" });
        await expect(active.getAttribute("aria-checked")).resolves.toBe("true");
        const colors = await active.evaluate((el, src) => (new Function("el", `return (${src})(el)`) as (el: Element) => [string, string])(el), textColours.toString());
        expect(contrastRatio(colors[0], colors[1]), theme).toBeGreaterThanOrEqual(3);
        const idle = await group.getByRole("radio", { name: "Direita" }).evaluate((el, src) => (new Function("el", `return (${src})(el)`) as (el: Element) => [string, string])(el), textColours.toString());
        expect(contrastRatio(idle[0], idle[1]), theme).toBeGreaterThanOrEqual(3);
        const hint = await page.locator("kbd").first().evaluate((el, src) => (new Function("el", `return (${src})(el)`) as (el: Element) => [string, string])(el), textColours.toString());
        expect(contrastRatio(hint[0], hint[1]), theme).toBeGreaterThanOrEqual(4.5);
      }
      await group.getByRole("radio").first().focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      const ring = await page.evaluate(() => {
        const a = document.activeElement!;
        const cs = getComputedStyle(a);
        return { visible: a.matches(":focus-visible"), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
      });
      expect(ring.visible).toBe(true);
      expect(ring.style).not.toBe("none");
      expect(ring.width).toBeGreaterThan(0);
      await setTheme(page, "Escuro");
    });

    it("o menu de camadas abre pelo teclado, nomeia os itens e fecha no Esc (4.1.2)", async () => {
      await page.getByRole("button", { name: "Mais ações de camadas" }).focus();
      await page.keyboard.press("Enter");
      await page.getByRole("menu").waitFor();
      await expect(page.getByRole("menuitem", { name: /^Mostrar todas as camadas ocultas/ }).count()).resolves.toBe(1);
      await expect(page.getByRole("menuitem", { name: /^Destravar todas/ }).count()).resolves.toBe(1);
      await page.keyboard.press("ArrowDown");
      const nav = await page.evaluate(() => {
        const el = document.activeElement;
        return { role: el?.getAttribute("role") ?? "", inMenu: el?.closest("[role=menu]") !== null };
      });
      expect(nav.inMenu).toBe(true);
      expect(nav.role).toMatch(/^menuitem/);
      await page.keyboard.press("Escape");
      await expect.poll(() => page.getByRole("menu").count()).toBe(0);
      await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Mais ações de camadas");
    });

    it("o diálogo de exportar prende o foco, o Tab não escapa e o Esc o fecha (2.1.2)", async () => {
      await page.getByRole("button", { name: "Mais ações", exact: true }).click();
      await page.getByRole("menuitem", { name: /Exportar/ }).click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      const inside = () => page.evaluate(() => document.activeElement?.closest("[role=dialog]") != null);
      await expect.poll(inside).toBe(true);
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press("Tab");
        await expect(inside()).resolves.toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect.poll(() => dialog.count()).toBe(0);
    });

    it("o botão primário e o de perigo passam de 4,5:1 nos dois temas, no repouso e no hover, e não têm a mesma cor (1.4.3)", async () => {
      const ov = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await pinLocale(ov, "pt-BR");
      const made = await fetch(`${external().url}/api/workspaces`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Perigo" }),
      });
      const id = ((await made.json()) as { workspace: { id: string } }).workspace.id;
      await ov.goto(external().url);
      await ov.locator(`[data-workspace-id="${id}"]`).waitFor();
      const colours = (el: Element) => {
        const cs = getComputedStyle(el);
        return [cs.color, cs.backgroundColor] as [string, string];
      };
      const primary = ov.getByRole("button", { name: "Novo workspace" });
      // The dialog is modal (the theme switch behind it is inert), so each theme opens and closes its own.
      const openDanger = async () => {
        await ov.locator(`[data-workspace-id="${id}"]`).getByRole("button", { name: "Mais ações" }).click();
        await ov.getByRole("menuitem", { name: "Excluir" }).click();
        const dialog = ov.getByRole("alertdialog");
        await dialog.waitFor();
        const danger = dialog.getByRole("button", { name: "Excluir workspace" });
        const field = dialog.getByLabel(/Digite/);
        if (await field.count()) await field.fill("Perigo");
        await expect.poll(() => danger.isEnabled()).toBe(true);
        return { dialog, danger };
      };
      for (const theme of ["Escuro", "Claro"] as const) {
        await setTheme(ov, theme);
        const [pfg, pbg] = await primary.evaluate(colours);
        expect(contrastRatio(pfg, pbg), `primário ${theme}`).toBeGreaterThanOrEqual(4.5);
        const { danger } = await openDanger();
        let restBg = "";
        for (const state of ["rest", "hover"] as const) {
          if (state === "hover") await danger.hover();
          else await ov.mouse.move(5, 5);
          await ov.waitForTimeout(300);
          const [fg, bg] = await danger.evaluate((el) => {
            const cs = getComputedStyle(el);
            const probe = document.createElement("div");
            probe.style.background = cs.backgroundColor;
            return [cs.color, cs.backgroundColor === "rgba(0, 0, 0, 0)" ? getComputedStyle(el.closest("[role=alertdialog]")!).backgroundColor : cs.backgroundColor] as [string, string];
          });
          expect(contrastRatio(fg, bg), `perigo ${theme} ${state}`).toBeGreaterThanOrEqual(4.5);
          if (state === "rest") restBg = `${fg}/${bg}`;
        }
        expect(restBg).not.toBe(`${pfg}/${pbg}`);
        await ov.keyboard.press("Escape");
        await ov.getByRole("alertdialog").waitFor({ state: "detached" });
      }
      await ov.close();
    }, 30_000);

    it("a regra de movimento reduzido vale para o chrome e não entra no documento (ADR 0003)", async () => {
      const rm = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
      await pinLocale(rm, "pt-BR");
      // The seeded workspace, not the "active" one: the tests above create others, which may have taken over.
      await rm.goto(page.url());
      await rm.waitForSelector('[data-paprika-id="login"]', { timeout: 10_000 }).catch(async (e) => {
        throw new Error(`${e.message} @ ${rm.url()} :: ${(await rm.evaluate(() => document.body.innerText).catch(() => "?")).slice(0, 300)}`);
      });
      const probe = await rm.evaluate(() => {
        const chrome = document.querySelector("[role=toolbar][aria-label=Ferramentas] button");
        const world = document.querySelector("[data-canvas-world] [data-paprika-id]");
        if (!chrome || !world) return null;
        return {
          // Tailwind's `motion-reduce:transition-none` sets the property to none and leaves the duration alone: no property, no transition.
          chrome: getComputedStyle(chrome).transitionProperty === "none" ? "0s" : getComputedStyle(chrome).transitionDuration,
          world: getComputedStyle(world).transitionProperty === "none" ? "0s" : getComputedStyle(world).transitionDuration,
          worldLineHeight: getComputedStyle(document.querySelector("[data-canvas-world]")!).lineHeight,
        };
      });
      await rm.close();
      expect(probe).not.toBeNull();
      expect(probe!.chrome).toBe("0s");
      expect(probe!.world).toBe("0s");
      expect(probe!.worldLineHeight).toBe("normal");
    }, 30_000);
  });

  describe("confirmação de exclusão do overview (PAP-B-026)", () => {
    let ov: Page;
    let extra: string;

    beforeAll(async () => {
      ov = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await pinLocale(ov, "pt-BR");
      const made = await fetch(`${external().url}/api/workspaces`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Para confirmar" }),
      });
      extra = ((await made.json()) as { workspace: { id: string } }).workspace.id;
      await ov.goto(external().url);
      await ov.locator(`[data-workspace-id="${extra}"]`).waitFor();
    }, 30_000);

    afterAll(async () => {
      await ov?.close();
    });

    const exists = async () => {
      const list = (await (await fetch(`${external().url}/api/workspaces`)).json()) as { workspaces: { id: string }[] };
      return list.workspaces.some((w) => w.id === extra);
    };

    // The old confirmation put the focus on Cancel; the new one asks for the name, so it opens on the field (the safe control) and Cancel is one Tab away.
    const openDelete = async () => {
      const more = ov.locator(`[data-workspace-id="${extra}"]`).getByRole("button", { name: "Mais ações" });
      await more.click();
      await ov.getByRole("menuitem", { name: "Excluir" }).click();
      const dialog = ov.getByRole("alertdialog");
      await dialog.waitFor();
      return { more, dialog };
    };

    it("abre com o foco no campo do nome (nunca no botão de excluir), o Esc cancela e devolve o foco à origem", async () => {
      const { more, dialog } = await openDelete();
      const field = dialog.getByLabel(/Digite/);
      await expect.poll(() => field.evaluate((el) => el === document.activeElement)).toBe(true);
      await expect.poll(() => dialog.getByRole("button", { name: "Excluir workspace" }).isDisabled()).toBe(true);
      await expect.poll(() => ov.locator("[data-slot=tooltip-content]:not([data-closed])").count()).toBe(0);
      await ov.keyboard.press("Tab");
      await expect.poll(() => dialog.getByRole("button", { name: "Cancelar" }).evaluate((el) => el === document.activeElement)).toBe(true);
      await ov.keyboard.press("Escape");
      await expect.poll(() => dialog.count()).toBe(0);
      await expect.poll(() => ov.evaluate(() => document.activeElement?.closest("[data-workspace-id]") != null || document.activeElement?.tagName === "BODY")).toBe(true);
      expect(await exists()).toBe(true);
      void more;
    }, 15_000);

    it("excluir pede o nome digitado: só o nome exato libera o botão, que passa de 4,5:1", async () => {
      const { dialog } = await openDelete();
      const confirm = dialog.getByRole("button", { name: "Excluir workspace" });
      await expect.poll(() => confirm.isDisabled()).toBe(true);
      const field = dialog.getByLabel(/Digite/);
      await field.fill("para confirmar");
      await expect.poll(() => confirm.isDisabled()).toBe(true);
      await field.fill("Para confirmar");
      await expect.poll(() => confirm.isEnabled()).toBe(true);
      const [fg, bg] = await confirm.evaluate((el) => {
        const cs = getComputedStyle(el);
        return [cs.color, cs.backgroundColor === "rgba(0, 0, 0, 0)" ? getComputedStyle(el.closest("[role=alertdialog]")!).backgroundColor : cs.backgroundColor] as [string, string];
      });
      expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
      await confirm.click();
      await expect.poll(exists, { timeout: 10_000 }).toBe(false);
    }, 15_000);
  });
});
