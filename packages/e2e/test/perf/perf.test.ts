import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { chromium, type Browser, type Page } from "playwright";
import { startServer, repoRoot, type ExternalServer } from "../harness.js";
import { pinLocale } from "../e2e/locale.js";
import { BUDGETS } from "./budgets.js";
import { evaluate, table, writeReport, type Result } from "./report.js";
import { buildWorstCase, type WorstCase } from "./synthetic.js";
import { instrument, longTasks, cdpDelta, mcp, measureFrames, median } from "./helpers.js";

const webDist = join(repoRoot, "apps/web/dist");
const hasWeb = existsSync(webDist);
const log = (m: string) => {
  if (process.env.PAPRIKA_PERF_VERBOSE) console.error(`[perf ${new Date().toISOString().slice(11, 23)}] ${m}`);
};
const results: Result[] = [];
const notes: Record<string, unknown> = {};

const record = (id: keyof typeof BUDGETS, measured: number, baseline?: number | null) => {
  const r = evaluate(BUDGETS[id]!, measured, baseline);
  results.push(r);
  return r;
};

const docFrames = (ws: WebSocket, into: { sizes: number[]; version: number }) =>
  ws.on("message", (data) => {
    const s = data.toString();
    if (!s.startsWith('{"type":"doc"')) return;
    into.sizes.push(s.length);
    const m = /"version":(\d+)/.exec(s.slice(-400)) ?? /"version":(\d+)/.exec(s);
    if (m) into.version = Number(m[1]);
  });

const settle = async (frames: { sizes: number[] }, quietMs = 1500, maxMs = 30_000) => {
  const start = Date.now();
  let n = -1;
  while (n !== frames.sizes.length && Date.now() - start < maxMs) {
    n = frames.sizes.length;
    await new Promise((r) => setTimeout(r, quietMs));
  }
};

describe("perf: worst-case document", () => {
  let tmp: string;
  let worst: WorstCase;
  let heavy: ExternalServer;
  let small: ExternalServer;
  let browser: Browser | undefined;
  let heavyTextId: string;
  let smallTextId: string;

  beforeAll(async () => {
    tmp = await mkdtemp(join(tmpdir(), "paprika-perf-"));
    worst = buildWorstCase();
    const heavyFile = join(tmp, "worst.paprika.json");
    await writeFile(heavyFile, JSON.stringify(worst.doc));
    const smallFile = join(tmp, "small.paprika.json");
    await copyFile(join(repoRoot, "packages/e2e/fixtures/demo.paprika.json"), smallFile);
    heavy = await startServer({ seed: heavyFile, webRoot: hasWeb ? webDist : undefined });
    small = await startServer({ seed: smallFile, webRoot: hasWeb ? webDist : undefined });
    heavyTextId = worst.textIds[0]!;
    const smallDoc = await small.doc();
    smallTextId = Object.values(smallDoc.nodes).find((n) => n.type === "text")!.id;
    notes.nodes = Object.keys(worst.doc.nodes).length;
    notes.instances = worst.instanceCount;
    notes.heavyPageNodes = worst.heavyNodes;
    if (hasWeb) browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await heavy?.stop();
    await small?.stop();
    await rm(tmp, { recursive: true, force: true });
    const path = writeReport(results, notes);
    console.log(`\n${table(results)}\n\nreport: ${path}\n`);
  });

  const assertWithinBudgets = (rs: Result[]) => {
    const failed = rs.filter((r) => r.status === "fail");
    expect(failed.map((r) => `${r.id}: ${r.effective} > ${r.limit} (${r.ticket})`)).toEqual([]);
  };

  it("generates about 15k nodes and 1,000 instances", () => {
    expect(Object.keys(worst.doc.nodes).length).toBeGreaterThan(14_000);
    expect(worst.instanceCount).toBe(1000);
    expect(worst.heavyNodes).toBeGreaterThan(3_400);
  });

  it("ws-bytes: one-prop write sends little and open sends one snapshot", async () => {
    const frames = { sizes: [] as number[], version: 0 };
    const ws = new WebSocket(`${heavy.url.replace("http", "ws")}/ws`, { maxPayload: 256 * 1024 * 1024 });
    docFrames(ws, frames);
    await new Promise((ok, fail) => {
      ws.once("open", ok);
      ws.once("error", fail);
    });
    await settle(frames);
    const onOpen = frames.sizes.length;
    frames.sizes.length = 0;
    await mcp(heavy.url, "update_nodes", { updates: [{ id: heavyTextId, props: { opacity: 0.5 } }] });
    await settle(frames);
    const bytes = frames.sizes.reduce((a, b) => a + b, 0);
    ws.close();
    notes.wsFramesPerWrite = frames.sizes.length;
    notes.wsSnapshotsOnOpenRaw = onOpen;
    assertWithinBudgets([record("wsBytesPerWrite", bytes)]);
  }, 120_000);

  it("server-write: a one-prop update costs the same as on a small document", async () => {
    const time = async (srv: ExternalServer, id: string) => {
      const ms: number[] = [];
      for (let i = 0; i < 6; i++) ms.push((await mcp(srv.url, "update_nodes", { updates: [{ id, props: { opacity: 0.4 + i / 20 } }] })).ms);
      return median(ms.slice(1));
    };
    const small_ = await time(small, smallTextId);
    const heavy_ = await time(heavy, heavyTextId);
    assertWithinBudgets([record("serverWriteMs", heavy_, small_)]);
  }, 180_000);

  it("slow-tab: a slow consumer ends on the latest version", async () => {
    const dir = await mkdtemp(join(tmpdir(), "paprika-perf-slow-"));
    const rnd = () => Array.from({ length: 4000 }, () => Math.floor(Math.random() * 36).toString(36)).join("");
    const nodes: Record<string, unknown> = { pg: { id: "pg", type: "page", name: "Fat", parentId: null, children: [] as string[] } };
    for (let i = 0; i < 250; i++) {
      const id = `n${i}`;
      nodes[id] = { id, type: "rect", name: id, parentId: "pg", x: i * 10, y: 0, width: 8, height: 8, notes: rnd() };
      (nodes.pg as { children: string[] }).children.push(id);
    }
    const file = join(dir, "fat.paprika.json");
    await writeFile(file, JSON.stringify({ format: "paprika/1", id: "perffat001", name: "Fat", tokens: {}, rootIds: ["pg"], nodes }));
    const fat = await startServer({ seed: file });
    try {
      const frames = { sizes: [] as number[], version: 0 };
      const ws = new WebSocket(`${fat.url.replace("http", "ws")}/ws`, { maxPayload: 256 * 1024 * 1024 });
      docFrames(ws, frames);
      await new Promise((ok, fail) => {
        ws.once("open", ok);
        ws.once("error", fail);
      });
      await settle(frames, 500);
      (ws as unknown as { _socket: { pause(): void; resume(): void } })._socket.pause();
      const writes = 150;
      await Promise.all(
        Array.from({ length: 5 }, async (_, a) => {
          for (let i = 0; i < writes / 5; i++) await mcp(fat.url, "update_nodes", { updates: [{ id: `n${(a * 30 + i) % 250}`, props: { opacity: 0.5 + (i % 5) / 10 } }] }, `agent-${a}`);
        }),
      );
      const final = await fat.version();
      (ws as unknown as { _socket: { resume(): void } })._socket.resume();
      await settle(frames, 1500, 60_000);
      ws.close();
      notes.slowTab = { finalVersion: final, lastVersionSeen: frames.version, framesReceived: frames.sizes.length };
      assertWithinBudgets([record("slowTabVersionLag", final - frames.version)]);
    } finally {
      await fat.stop();
      await rm(dir, { recursive: true, force: true });
    }
  }, 240_000);

  describe.skipIf(!hasWeb)("browser", () => {
    const incoming = new WeakMap<Page, { snapshots: number }>();

    const open = async (srv: ExternalServer, docId: string): Promise<Page> => {
      const page = await browser!.newPage({ viewport: { width: 1600, height: 1000 } });
      const seen = { snapshots: 0 };
      incoming.set(page, seen);
      page.on("websocket", (sock) =>
        sock.on("framereceived", (f) => {
          if (String(f.payload).startsWith('{"type":"doc"')) seen.snapshots++;
        }),
      );
      await instrument(page);
      await pinLocale(page, "pt-BR");
      await page.goto(`${srv.url}/w/${docId}`);
      await page.waitForSelector(".world [data-paprika-id]", { timeout: 120_000 });
      await page.waitForTimeout(2500);
      return page;
    };

    const wheel = async (page: Page, steps: number, dy: number, withCtrl: boolean) => {
      if (withCtrl) await page.keyboard.down("Control");
      for (let i = 0; i < steps; i++) {
        await page.mouse.wheel(0, i < steps / 2 ? dy : -dy);
        await page.waitForTimeout(16);
      }
      if (withCtrl) await page.keyboard.up("Control");
    };

    const resizeSteps = async (page: Page) => {
      const sep = page.locator('[role="separator"]').first();
      if (!(await sep.count())) return null;
      const b = (await sep.boundingBox())!;
      const x = b.x + b.width / 2;
      const y = b.y + 200;
      const raf2 = () => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
      await page.mouse.move(x, y);
      await page.mouse.down();
      const ms: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t = performance.now();
        await page.mouse.move(x + (i + 1) * 6, y);
        await raf2();
        ms.push(performance.now() - t);
      }
      await page.mouse.up();
      return median(ms);
    };

    const canvasMetrics = async (page: Page, srv: ExternalServer, textId: string) => {
      const vp = (await page.locator(".viewport").boundingBox())!;
      await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2);
      log("pan");
      const pan = await measureFrames(page, () => wheel(page, 60, 40, false));
      log("zoom");
      const zoom = await measureFrames(page, () => wheel(page, 40, 30, true));
      log("resize");
      const resize = await resizeSteps(page);
      log("write");
      let cost: Awaited<ReturnType<typeof cdpDelta>> | undefined;
      const write = await longTasks(page, async () => {
        cost = await cdpDelta(page, async () => {
          const seen = incoming.get(page)!;
          const before = seen.snapshots;
          await mcp(srv.url, "update_nodes", { updates: [{ id: textId, props: { opacity: 0.9 } }] });
          const start = Date.now();
          while (seen.snapshots === before && Date.now() - start < 60_000) await page.waitForTimeout(50);
          await page.waitForTimeout(2500);
        });
      });
      return { writeCost: cost, frameP95: Math.max(pan.p95, zoom.p95), pan, zoom, resize, longestTask: write.maxMs, longTaskCount: write.count };
    };

    let heavyPage: Page;
    let heavyMetrics: Awaited<ReturnType<typeof canvasMetrics>>;
    let smallMetrics: Awaited<ReturnType<typeof canvasMetrics>>;

    it("tab: p95 frame, panel resize step and script time on one incoming write", async () => {
      log("open small");
      const smallPage = await open(small, (await small.doc()).id);
      smallMetrics = await canvasMetrics(smallPage, small, smallTextId);
      await smallPage.close();
      log("open heavy");
      heavyPage = await open(heavy, worst.doc.id);
      const opened = incoming.get(heavyPage)!.snapshots;
      notes.heavyDom = await heavyPage.evaluate(() => ({ nodes: document.querySelectorAll(".world [data-paprika-id]").length, all: document.querySelectorAll("*").length }));
      heavyMetrics = await canvasMetrics(heavyPage, heavy, heavyTextId);
      notes.browser = { small: smallMetrics, heavy: heavyMetrics };
      const rs = [record("wsSnapshotsOnOpen", opened), record("frameP95Ms", heavyMetrics.frameP95, smallMetrics.frameP95), record("tabWriteScriptMs", heavyMetrics.writeCost!.scriptMs, smallMetrics.writeCost!.scriptMs)];
      if (heavyMetrics.resize !== null && smallMetrics.resize !== null) rs.push(record("panelResizeStepMs", heavyMetrics.resize, smallMetrics.resize));
      assertWithinBudgets(rs);
    }, 420_000);

    it("agent-build: a 200-node frame created by an agent is fully visible", async () => {
      const kids = Array.from({ length: 199 }, (_, i) => ({ type: "rect", id: `perfb-${i}`, name: `r${i}`, width: 20, height: 20, fill: "#e11d48" }));
      const t = Date.now();
      await mcp(heavy.url, "create_nodes", {
        parentId: worst.heavyPageId,
        nodes: [{ type: "frame", id: "perfb", name: "perf", x: 0, y: -900, width: 600, height: 400, fill: "#ffffff", layout: { mode: "row", wrap: true, gap: 4, padding: 8 }, children: kids }],
      });
      await heavyPage.waitForFunction(
        () => {
          const all = ["perfb", ...Array.from({ length: 199 }, (_, i) => `perfb-${i}`)];
          return all.every((id) => {
            const el = document.querySelector(`.world [data-paprika-id="${id}"]`) as HTMLElement | null;
            return el !== null && el.getAttribute("data-build") !== "wait" && getComputedStyle(el).opacity !== "0";
          });
        },
        null,
        { timeout: 120_000, polling: "raf" },
      );
      const visibleMs = Date.now() - t;
      await mcp(heavy.url, "delete_nodes", { ids: ["perfb"] });
      await heavyPage.close();
      assertWithinBudgets([record("agentNodeVisibleMs", visibleMs)]);
    }, 240_000);
  });
});
