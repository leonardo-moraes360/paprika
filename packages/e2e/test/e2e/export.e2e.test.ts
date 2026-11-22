import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { compile } from "tailwindcss";
import { applyOps, createDocument, parseDocument, renderHTML, renderTailwindHTML, TAILWIND_CDN, type Document, type Op } from "@paprika/core";

const root = resolve(import.meta.dirname, "../../../..");
const tailwindDir = resolve(import.meta.dirname, "../../node_modules/tailwindcss");
const theme = readFileSync(join(tailwindDir, "theme.css"), "utf8");
const preflight = readFileSync(join(tailwindDir, "preflight.css"), "utf8");

const board = (name: string) => parseDocument(JSON.parse(readFileSync(join(root, name), "utf8")));

const themed = (): Document => {
  const ops: Op[] = [
    { op: "set_tokens", tokens: { bg: "#ffffff", fg: "#1e2336", "brand.main": "#c43d27", accent: "$brand.main", size: 16 } },
    { op: "set_tokens", mode: "dark", tokens: { bg: "#14161f", fg: "#f2f2f2", size: 18 } },
    ...(["light", "dark"] as const).map((m, i): Op => ({
      op: "create",
      node: {
        type: "frame", id: `t-${m}`, name: `Tema ${m}`, x: i * 340, width: 320, height: 160, fill: "$bg", ...(m === "dark" ? { mode: "dark" } : {}),
        layout: { mode: "column", gap: 8, padding: 16 },
        stroke: { color: "$accent", width: 1 }, shadow: { x: 0, y: 2, blur: 4, spread: 0, color: "rgba(0,0,0,.5)" },
        children: [
          { type: "text", id: `t-${m}-title`, text: "Olá", color: "$fg", fontSize: "$size", width: "fill", height: "hug" },
          { type: "rect", id: `t-${m}-bar`, width: "fill", height: 4, fill: "$accent", radius: 2 },
        ],
      },
    } as Op)),
  ];
  return applyOps(createDocument("Tema", "tema"), ops).doc;
};

const boards: [string, () => Document][] = [
  ["demo", () => board("examples/demo.paprika.json")],
  ["bezier", () => board("examples/bezier.paprika.json")],
  ["brand", () => board("examples/brand/brand.paprika.json")],
  ["themed", themed],
];

function classesOf(html: string): string[] {
  const all = [...html.matchAll(/ class="([^"]*)"/g)].flatMap((m) => m[1]!.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").split(/\s+/));
  return [...new Set(all.filter(Boolean))];
}

async function utilitiesFor(classes: string[]): Promise<string> {
  const compiler = await compile(`${theme}\n${preflight}\n@tailwind utilities;`);
  return compiler.build(classes);
}

async function diffRatio(page: Page, a: Buffer, b: Buffer, tol = 8): Promise<number> {
  return page.evaluate(
    async ([a64, b64, t]) => {
      const load = async (s: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${s}`;
        await img.decode();
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const x = c.getContext("2d")!;
        x.drawImage(img, 0, 0);
        return { data: x.getImageData(0, 0, c.width, c.height).data, w: img.width, h: img.height };
      };
      const [pa, pb] = await Promise.all([load(a64 as string), load(b64 as string)]);
      if (pa.w !== pb.w || pa.h !== pb.h) return 1;
      let bad = 0;
      for (let i = 0; i < pa.data.length; i += 4) {
        if (Math.max(Math.abs(pa.data[i]! - pb.data[i]!), Math.abs(pa.data[i + 1]! - pb.data[i + 1]!), Math.abs(pa.data[i + 2]! - pb.data[i + 2]!)) > (t as number)) bad++;
      }
      return bad / (pa.data.length / 4);
    },
    [a.toString("base64"), b.toString("base64"), tol] as const,
  );
}

describe("E2E: export tailwind vs html", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
  });

  const shoot = async (html: string, bounds: { width: number; height: number }) => {
    await page.setViewportSize({ width: Math.ceil(bounds.width), height: Math.ceil(bounds.height) });
    await page.setContent(html, { waitUntil: "load" });
    return page.screenshot();
  };

  for (const vars of [false, true]) {
    for (const [name, make] of boards) {
      it(`${name}${vars ? " (cssVariables)" : ""}: the Tailwind page matches the HTML page within 1%`, async () => {
        const doc = make();
        const reference = renderHTML(doc, { cssVariables: vars });
        const tailwind = renderTailwindHTML(doc, { cssVariables: vars });
        expect(tailwind.html).toContain(TAILWIND_CDN);
        const classes = classesOf(tailwind.html);
        const css = await utilitiesFor(classes);
        const ungenerated = await page.evaluate(([list, sheet]) => (list as string[]).filter((c) => !(sheet as string).includes(`.${CSS.escape(c)}`)), [classes, css] as const);
        expect(ungenerated).toEqual([]);
        const html = tailwind.html.replace(/<script src="[^"]*"><\/script\s*>/, `<style>${css}</style>`);
        const a = await shoot(reference.html, reference.bounds);
        const b = await shoot(html, tailwind.bounds);
        expect(await diffRatio(page, a, b)).toBeLessThan(0.01);
      }, 30_000);
    }
  }
});
