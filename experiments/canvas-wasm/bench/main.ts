import { canvasBounds, nodeStyle, parseDocument, pathAttrs, type Document, type Node } from "@paprika/core";
import init, { createRenderer, type Renderer } from "../../../apps/web/src/wasm/paprika_render.js";
import { flatten, layoutBoxes, STRIDE, type Box } from "./displayList.js";
import { syntheticDoc } from "./synthetic.js";
import demo from "../../../examples/demo.paprika.json";
import bezier from "../../../examples/bezier.paprika.json";

type Mode = "auto" | "webgpu" | "cpu" | "canvas2d" | "dom";
const W = 1280, H = 800;
const stage = document.getElementById("stage")!;
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;

interface Surface {
  backend: string;
  info: string;
  setDoc(doc: Document): void;
  draw(tx: number, ty: number, zoom: number): Promise<void> | void;
  /** Offscreen GPU only: copies the last frame into a visible 2d canvas. */
  snapshot?(): Promise<void>;
  dispose(): void;
}

function fitView(doc: Document) {
  const b = canvasBounds(doc);
  const zoom = Math.min(1, (W - 80) / b.width, (H - 80) / b.height);
  return { zoom, x: (W - b.width * zoom) / 2 - b.x * zoom, y: (H - b.height * zoom) / 2 - b.y * zoom };
}

async function wasmSurface(mode: "auto" | "webgpu" | "cpu"): Promise<Surface> {
  await init();
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  stage.append(canvas);
  const r: Renderer = await createRenderer(canvas, mode === "webgpu" ? "gpu" : mode);
  // `?offscreen=1`: render into vello's target without presenting to the canvas. Headless Chromium
  // without a GPU loses the WebGPU device on canvas presentation (plain JS WebGPU too), so CI and
  // this container time and check the GPU path offscreen and read pixels back.
  const offscreen = new URLSearchParams(location.search).has("offscreen") && r.backend === "webgpu";
  return {
    backend: r.backend,
    info: r.adapterInfo + (r.fallbackReason ? ` · fallback: ${r.fallbackReason}` : ""),
    setDoc(doc) { const f = flatten(doc); r.setScene(f.data, f.paths); },
    async draw(tx, ty, z) { if (offscreen) r.renderOffscreen(tx, ty, z); else r.render(tx, ty, z); await r.finish(); },
    async snapshot() {
      if (!offscreen) return;
      await r.readPixels();
      const px = r.takePixels();
      const out = document.createElement("canvas"); out.width = W; out.height = H;
      out.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(px), W, H), 0, 0);
      stage.append(out);
    },
    dispose() { r.free(); canvas.remove(); },
  };
}

function canvas2dSurface(): Surface {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  stage.append(canvas);
  const ctx = canvas.getContext("2d")!;
  let data: Float32Array = new Float32Array();
  let paths: { p: Path2D; vb: number[]; evenodd: boolean; cap: CanvasLineCap; join: CanvasLineJoin }[] = [];
  const rgba = (r: number, g: number, b: number, a: number) => `rgba(${r * 255},${g * 255},${b * 255},${a})`;
  return {
    backend: "canvas2d", info: "browser Canvas2D (JS loop over the same display list)",
    setDoc(doc) {
      const f = flatten(doc);
      data = f.data;
      paths = f.paths ? f.paths.split("\n").map((line) => {
        const [head, d] = line.split("|") as [string, string];
        const h = head.split(" ");
        return { p: new Path2D(d), vb: h.slice(0, 4).map(Number), evenodd: h[4] === "evenodd", cap: h[5] as CanvasLineCap, join: h[6] as CanvasLineJoin };
      }) : [];
    },
    draw(tx, ty, z) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#ededf0"; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < data.length; i += STRIDE) {
        const k = data[i]!;
        if (k === 3) { ctx.restore(); continue; }
        const [x, y, w, h, rad, rot, op] = [data[i + 1]!, data[i + 2]!, data[i + 3]!, data[i + 4]!, data[i + 5]!, data[i + 6]!, data[i + 7]!];
        ctx.setTransform(z, 0, 0, z, tx, ty);
        ctx.translate(x + w / 2, y + h / 2); if (rot) ctx.rotate((rot * Math.PI) / 180); ctx.translate(-w / 2, -h / 2);
        if (k === 4) {
          const pd = paths[rad]!;
          const [vx, vy, vw, vh] = pd.vb as [number, number, number, number];
          if (vw > 0 && vh > 0) { const sc = Math.min(w / vw, h / vh); ctx.translate((w - vw * sc) / 2 - vx * sc, (h - vh * sc) / 2 - vy * sc); ctx.scale(sc, sc); }
          if (data[i + 11]! > 0) { ctx.fillStyle = rgba(data[i + 8]!, data[i + 9]!, data[i + 10]!, data[i + 11]!); ctx.fill(pd.p, pd.evenodd ? "evenodd" : "nonzero"); }
          if (data[i + 12]! > 0) { ctx.lineWidth = data[i + 12]!; ctx.lineCap = pd.cap; ctx.lineJoin = pd.join; ctx.strokeStyle = rgba(data[i + 13]!, data[i + 14]!, data[i + 15]!, data[i + 16]! * op); ctx.stroke(pd.p); }
          continue;
        }
        const p = new Path2D();
        if (k === 1) p.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); else p.roundRect(0, 0, w, h, Math.min(rad, w / 2, h / 2));
        if (data[i + 11]! > 0) { ctx.fillStyle = rgba(data[i + 8]!, data[i + 9]!, data[i + 10]!, data[i + 11]! * op); ctx.fill(p); }
        const sw = data[i + 12]!;
        if (sw > 0) { ctx.lineWidth = sw; ctx.strokeStyle = rgba(data[i + 13]!, data[i + 14]!, data[i + 15]!, data[i + 16]! * op); ctx.stroke(p); }
        if (k === 2) { ctx.save(); ctx.clip(p); }
      }
    },
    dispose() { canvas.remove(); },
  };
}

// What the app does today: one element per node styled by `nodeStyle`, pan/zoom via a CSS transform.
function domSurface(): Surface {
  const world = document.createElement("div");
  world.style.cssText = "position:absolute;left:0;top:0;transform-origin:0 0;will-change:transform";
  stage.append(world);
  const SVG = "http://www.w3.org/2000/svg";
  const build = (doc: Document, n: Node): HTMLElement | SVGElement => {
    const el = n.type === "path" ? document.createElementNS(SVG, "svg") : document.createElement("div");
    Object.assign(el.style, nodeStyle(doc, n) as Record<string, string>);
    if (n.type === "path") {
      const a = pathAttrs(doc, n);
      if (a.svg.viewBox) { el.setAttribute("viewBox", a.svg.viewBox); el.setAttribute("preserveAspectRatio", a.svg.preserveAspectRatio!); }
      const p = document.createElementNS(SVG, "path");
      p.setAttribute("d", a.path.d); p.setAttribute("fill", a.path.fill); p.setAttribute("fill-rule", a.path.fillRule);
      p.setAttribute("stroke-linecap", a.path.strokeLinecap); p.setAttribute("stroke-linejoin", a.path.strokeLinejoin);
      if (a.path.stroke) { p.setAttribute("stroke", a.path.stroke); p.setAttribute("stroke-width", String(a.path.strokeWidth)); }
      el.append(p);
    }
    el.dataset.paprikaId = n.id;
    if (n.type === "text") el.textContent = n.text;
    if (n.type === "frame") for (const c of n.children) { const k = doc.nodes[c]; if (k) el.append(build(doc, k)); }
    return el;
  };
  return {
    backend: "dom", info: "HTML/CSS via nodeStyle (current canvas), CSS transform for the view",
    setDoc(doc) { world.replaceChildren(...doc.rootIds.map((id) => build(doc, doc.nodes[id]!))); },
    draw(tx, ty, z) { world.style.transform = `translate(${tx}px,${ty}px) scale(${z})`; },
    dispose() { world.remove(); },
  };
}

async function surface(mode: Mode): Promise<Surface> {
  if (mode === "dom") return domSurface();
  if (mode === "canvas2d") return canvas2dSurface();
  return wasmSurface(mode);
}

const raf = () => new Promise<number>((r) => requestAnimationFrame(r));
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  return { mean: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2), p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2) };
};

/** Zoom 0.25→2→0.25 while panning: forces a full re-raster every frame in every mode. */
async function zoomScenario(s: Surface, doc: Document, frames: number) {
  const v = fitView(doc);
  const work: number[] = [], frame: number[] = [];
  let last = await raf();
  for (let i = 0; i < frames; i++) {
    const t = i / frames;
    const z = v.zoom * (0.6 + 1.8 * Math.sin(Math.PI * t));
    const t0 = performance.now();
    await s.draw(v.x - 200 * Math.sin(2 * Math.PI * t), v.y, z);
    work.push(performance.now() - t0);
    const now = await raf();
    frame.push(now - last); last = now;
  }
  return { work: stats(work), frame: stats(frame), fps: +(1000 / stats(frame).mean).toFixed(1) };
}

/** One node changes color every frame (an agent streaming edits). */
async function editScenario(s: Surface, start: Document, frames: number, mode: Mode) {
  let doc = start;
  const v = fitView(doc);
  const target = Object.values(doc.nodes).find((n) => n.type === "rect" || n.type === "ellipse");
  if (!target) return null; // e.g. the bezier example: paths only
  const el = () => stage.querySelector<HTMLElement>(`[data-paprika-id="${target.id}"]`);
  // Non-path target so the DOM update is a plain `background` change.
  const work: number[] = [];
  for (let i = 0; i < frames; i++) {
    const fill = i % 2 ? "#e4572e" : "#29335c";
    const t0 = performance.now();
    if (mode === "dom") {
      el()!.style.background = fill;
      // `draw` is synchronous for the canvas2d/DOM paths and async for the others, so the
      // rejection handler goes through Promise.resolve. Not awaiting it is deliberate: awaiting
      // the draw would move the cost into the number this loop measures.
      void Promise.resolve(s.draw(v.x, v.y, v.zoom)).catch((e: unknown) => console.error("[bench] draw:", e));
    }
    // Immutable update of a local copy, like the client receiving a new document over WS.
    // (applyOps runs on the server; its structuredClone would dominate the timing here.)
    else { doc = { ...doc, nodes: { ...doc.nodes, [target.id]: { ...target, fill } as Node } }; s.setDoc(doc); await s.draw(v.x, v.y, v.zoom); }
    work.push(performance.now() - t0);
    await raf();
  }
  return { work: stats(work) };
}

async function loadDoc(name: string): Promise<Document> {
  // parseDocument applies schema defaults (`visible`, `opacity`…), as the server does on load.
  if (name === "demo" || name === "bezier") return parseDocument(structuredClone(name === "demo" ? demo : bezier));
  return syntheticDoc(Number(name));
}

export async function runBench(docName: string, mode: Mode, frames = 120) {
  stage.replaceChildren();
  const doc = await loadDoc(docName);
  const t0 = performance.now();
  const s = await surface(mode);
  const tInit = performance.now() - t0;
  const t1 = performance.now();
  s.setDoc(doc);
  const v = fitView(doc);
  await s.draw(v.x, v.y, v.zoom);
  await raf();
  const tFirst = performance.now() - t1;
  const zoom = await zoomScenario(s, doc, frames);
  const edit = await editScenario(s, doc, Math.min(60, frames), mode);
  const flat = mode === "dom" ? null : flatten(doc);
  const result = {
    doc: docName, nodes: Object.keys(doc.nodes).length, mode, backend: s.backend, info: s.info,
    initMs: +tInit.toFixed(1), firstFrameMs: +tFirst.toFixed(1), zoom, edit,
    skipped: flat?.skipped,
  };
  s.dispose();
  return result;
}

/** Renders one still frame (fitted) and leaves it on screen, for visual comparison. */
export async function still(docName: string, mode: Mode) {
  stage.replaceChildren();
  const doc = await loadDoc(docName);
  const s = await surface(mode);
  s.setDoc(doc);
  const v = fitView(doc);
  await s.draw(v.x, v.y, v.zoom);
  await s.snapshot?.();
  await raf();
  return { backend: s.backend, info: s.info };
}

Object.assign(window, { runBench, still, layoutBoxes });
$("run").onclick = async () => {
  $("status").textContent = "running…";
  const r = await runBench($("doc").value, $("mode").value as Mode);
  document.getElementById("out")!.textContent = JSON.stringify(r, null, 2);
  $("status").textContent = "";
};
export type { Box };
