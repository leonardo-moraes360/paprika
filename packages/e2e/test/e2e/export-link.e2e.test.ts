import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { applyOps, createDocument, renderHTML, type Document, type Op } from "@paprika/core";

const text = (id: string, extra: Record<string, unknown> = {}) => ({
  type: "text",
  id,
  text: "Olá mundo link",
  x: 20,
  y: 20,
  width: 160,
  height: 24,
  fontSize: 18,
  ...extra,
});
const run = { start: 0, end: 3, href: "/inner" };

function build(root: Record<string, unknown>): Document {
  const op = { op: "create", node: { x: 0, y: 0, width: 300, height: 200, ...root } } as Op;
  return applyOps(createDocument("t", "d"), [op]).doc;
}

const card = (children: Record<string, unknown>[]) => ({ type: "frame", id: "a", href: "/card", fill: "#eeeeee", children });

const cases: Record<string, Record<string, unknown>> = {
  plain: card([text("t", { runs: [run] })]),
  opacityMiddle: card([{ type: "frame", id: "m", x: 10, y: 10, width: 250, height: 150, opacity: 0.5, children: [text("t", { runs: [run] })] }]),
  rotatedMiddle: card([{ type: "frame", id: "m", x: 10, y: 10, width: 250, height: 150, rotation: 1, children: [text("t", { runs: [run] })] }]),
  filteredGroupMiddle: card([
    { type: "group", id: "g", opacity: 0.8, children: [{ type: "frame", id: "m", x: 10, y: 10, width: 250, height: 150, filter: { blur: 1 }, children: [text("t", { runs: [run] })] }] },
  ]),
  innerFrameLink: card([
    { type: "frame", id: "m", x: 10, y: 10, width: 250, height: 150, opacity: 0.5, children: [{ type: "frame", id: "b", href: "/inner", x: 20, y: 20, width: 100, height: 60, fill: "#ff0000" }] },
  ]),
  nestedCardMiddle: card([
    { type: "frame", id: "m", x: 10, y: 10, width: 250, height: 150, opacity: 0.5, children: [{ type: "frame", id: "b", href: "/inner", x: 20, y: 20, width: 200, height: 80, fill: "#ff0000", children: [text("u", { x: 4, y: 4, runs: [{ start: 0, end: 3, href: "/deep" }] })] }] },
  ]),
};

const probe = (page: Page) =>
  page.evaluate(() => {
    const hitAt = (el: Element, dx: number) => {
      const b = el.getBoundingClientRect();
      const hit = document.elementFromPoint(b.x + Math.min(dx, b.width / 2), b.y + b.height / 2);
      return !!hit && (hit === el || el.contains(hit));
    };
    const inner = document.querySelector('a[href="/inner"]');
    const deep = document.querySelector('a[href="/deep"]');
    const cardAnchor = document.querySelector('a[href="/card"]');
    const rest = document.elementFromPoint(295, 195);
    return {
      inner: inner ? hitAt(inner, 5) : null,
      deep: deep ? hitAt(deep, 3) : null,
      cardEverywhere: !!cardAnchor && !!rest && (rest === cardAnchor || cardAnchor.contains(rest)),
    };
  });

describe("E2E: clickable card links in the HTML export", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
    page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  for (const [name, root] of Object.entries(cases)) {
    it(`${name}: the inner link is hit by the mouse and the rest of the card still opens the card`, async () => {
      await page.setContent(renderHTML(build(root)).html, { waitUntil: "load" });
      const r = await probe(page);
      if (name === "nestedCardMiddle") expect(r.deep).toBe(true);
      else expect(r.inner).toBe(true);
      expect(r.cardEverywhere).toBe(true);
    });
  }

  it("clicking the inner link navigates to the inner href, the card area to the card href", async () => {
    await page.route("**/*", (route) => route.fulfill({ status: 200, contentType: "text/html", body: route.request().url().includes("/inner") ? "inner" : route.request().url().includes("/card") ? "card" : renderHTML(build(cases.opacityMiddle!)).html }));
    await page.goto("http://paprika.test/start");
    const b = await page.locator('a[href="/inner"]').boundingBox();
    await page.mouse.click(b!.x + 4, b!.y + b!.height / 2);
    await page.waitForURL("**/inner");
    await page.goto("http://paprika.test/start");
    await page.mouse.click(295, 195);
    await page.waitForURL("**/card");
    await page.unroute("**/*");
  });

  it("the focus ring of the overlay link is drawn inside the clipped card", async () => {
    await page.setContent(`<body style="margin:30px">${renderHTML(build(cases.plain!)).html}</body>`);
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const a = document.activeElement!;
      const b = a.getBoundingClientRect();
      const cs = getComputedStyle(a);
      return { href: a.getAttribute("href"), overflow: getComputedStyle(a.parentElement!).overflow, offset: cs.outlineOffset, box: { x: b.x, y: b.y, w: b.width, h: b.height } };
    });
    expect(focused.href).toBe("/card");
    expect(focused.overflow).toBe("hidden");
    expect(Number.parseFloat(focused.offset)).toBeLessThan(0);
    const { x, y, w, h } = focused.box;
    const shot = await page.screenshot({ clip: { x, y, width: w, height: h } });
    const painted = await page.evaluate(
      async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext("2d")!;
        g.drawImage(img, 0, 0);
        const px = (i: number, j: number) => Array.from(g.getImageData(i, j, 1, 1).data.slice(0, 3));
        const mid = Math.floor(img.width / 2);
        return [px(mid, 0), px(mid, 1), px(mid, 2), px(mid, img.height - 1), px(mid, img.height - 2)];
      },
      shot.toString("base64"),
    );
    const differsFromFill = painted.filter((p) => p.some((v) => Math.abs(v - 238) > 12));
    expect(differsFromFill.length).toBeGreaterThan(0);
  });

  it("a hidden inner link does not turn the card into an overlay", async () => {
    const hidden = card([text("t", { visible: false, runs: [run] })]);
    const html = renderHTML(build(hidden)).html;
    await page.setContent(html, { waitUntil: "load" });
    const r = await page.evaluate(() => ({
      anchors: document.querySelectorAll("a").length,
      overlay: !!document.querySelector('a[href="/card"][aria-label]'),
      cardIsAnchor: document.querySelector('a[href="/card"]')?.getAttribute("data-paprika-id") === "a",
    }));
    expect(r).toEqual({ anchors: 1, overlay: false, cardIsAnchor: true });
  });
});
