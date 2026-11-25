import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { pinLocale } from "./locale.js";
import { startServer, type ExternalServer } from "../harness.js";

const root = resolve(import.meta.dirname, "../../../..");
const webRoot = join(root, "apps/web/dist");
const SECTION = "inspector-section-position";

type Sample = { t: number; sectionH: number; siblingY: number; bodyH: number };

function trace(samples: Sample[], i: number): string {
  const s = samples[i]!;
  return `#${i} section=${s.sectionH.toFixed(1)} siblingY=${s.siblingY.toFixed(1)} body=${s.bodyH.toFixed(1)}`;
}

function assertNoBackwardJump(samples: Sample[], direction: "close" | "open") {
  expect(samples.length).toBeGreaterThan(2);
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const cap = direction === "open" ? last : first;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]!;
    const cur = samples[i]!;
    const dH = cur.sectionH - prev.sectionH;
    const dY = cur.siblingY - prev.siblingY;
    if (direction === "close") {
      expect(dH, trace(samples, i)).toBeLessThanOrEqual(0.75);
      expect(dY, trace(samples, i)).toBeLessThanOrEqual(0.75);
    } else {
      expect(dH, trace(samples, i)).toBeGreaterThanOrEqual(-0.75);
      expect(dY, trace(samples, i)).toBeGreaterThanOrEqual(-0.75);
    }
    expect(cur.sectionH, trace(samples, i)).toBeLessThanOrEqual(cap.sectionH + 0.75);
    expect(cur.bodyH, trace(samples, i)).toBeLessThanOrEqual(cap.bodyH + 0.75);
  }
  if (direction === "close") expect(last.sectionH).toBeLessThan(first.sectionH - 8);
  else expect(last.sectionH).toBeGreaterThan(first.sectionH + 8);
}

async function arm(page: Page) {
  await page.evaluate((testId) => {
    const section = document.querySelector(`[data-testid="${testId}"]`);
    if (!section || !section.parentElement || !section.nextElementSibling) throw new Error("missing section");
    const parent = section.parentElement;
    const next = section.nextElementSibling;
    const samples: Sample[] = [];
    let stop = false;
    const take = () => {
      const parentTop = parent.getBoundingClientRect().top;
      const box = section.getBoundingClientRect();
      const sib = next.getBoundingClientRect();
      const body = section.querySelector("[data-slot='collapsible-content']");
      const bodyBox = body ? body.getBoundingClientRect() : null;
      samples.push({
        t: performance.now(),
        sectionH: box.height,
        siblingY: sib.top - parentTop,
        bodyH: bodyBox ? bodyBox.height : 0,
      });
      if (!stop) requestAnimationFrame(take);
    };
    requestAnimationFrame(take);
    (window as unknown as { __collapse: { samples: Sample[]; stop: () => Sample[] } }).__collapse = {
      samples,
      stop: () => {
        stop = true;
        return samples;
      },
    };
  }, SECTION);
}

async function stop(page: Page): Promise<Sample[]> {
  return page.evaluate(() => (window as unknown as { __collapse: { stop: () => Sample[] } }).__collapse.stop());
}

async function toggle(page: Page, direction: "close" | "open") {
  const section = page.getByTestId(SECTION);
  await section.scrollIntoViewIfNeeded();
  const trigger = section.getByRole("button").first();
  await expect.poll(() => trigger.getAttribute("aria-expanded")).toBe(direction === "close" ? "true" : "false");
  await arm(page);
  await trigger.click();
  await expect.poll(() => trigger.getAttribute("aria-expanded")).toBe(direction === "close" ? "false" : "true");
  await page.waitForTimeout(450);
  return stop(page);
}

describe.skipIf(!existsSync(webRoot))("E2E: colapso das seções do inspector", () => {
  let external: ExternalServer | undefined;
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    external = await startServer({ seed: join(root, "packages/e2e/fixtures/demo.paprika.json"), webRoot });
    browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await pinLocale(page, "pt-BR");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(external.url);
    await page.locator(".workspace-card.is-active").click();
    await page.waitForSelector('[data-paprika-id="login"]');
    await page.locator('[data-layer-id="login"]').click();
    await page.getByTestId(SECTION).waitFor();
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    await external?.stop();
  });

  it("fechar e abrir desliza sem voltar e sem passar da altura final", async () => {
    const closing = await toggle(page, "close");
    const closeHeights = new Set(closing.map((s) => Math.round(s.sectionH)));
    expect(closeHeights.size, [...closeHeights].join(",")).toBeGreaterThanOrEqual(3);
    assertNoBackwardJump(closing, "close");

    const opening = await toggle(page, "open");
    const openHeights = new Set(opening.map((s) => Math.round(s.sectionH)));
    expect(openHeights.size).toBeGreaterThanOrEqual(3);
    assertNoBackwardJump(opening, "open");
  }, 20_000);

  it("movimento reduzido fecha sem animação e sem salto", async () => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => localStorage.removeItem("paprika.inspector.sections.v1"));
    await page.reload();
    await page.waitForSelector('[data-paprika-id="login"]');
    await page.locator('[data-layer-id="login"]').click();
    await page.getByTestId(SECTION).waitFor();

    const closing = await toggle(page, "close");
    assertNoBackwardJump(closing, "close");
    const first = closing[0]!;
    const last = closing[closing.length - 1]!;
    const moved = closing.filter((s) => s.sectionH < first.sectionH - 1 && s.sectionH > last.sectionH + 1);
    expect(moved.length).toBeLessThanOrEqual(1);
    const left = Math.max(0, closing.findIndex((s) => Math.abs(s.sectionH - first.sectionH) > 1));
    const arrived = closing.findIndex((s, i) => i >= left && Math.abs(s.sectionH - last.sectionH) <= 1);
    expect(arrived).toBeGreaterThanOrEqual(0);
    expect(closing[arrived]!.t - closing[left]!.t).toBeLessThan(80);
  }, 20_000);
});
