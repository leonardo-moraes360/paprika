import { applyOps, createDocument, type Document, type Op } from "@paprika/core";

/**
 * A document with one of every kind of node, built by the core (so each node is what the server would hold): a page with
 * a clipping frame in column auto-layout (a rotated rect, a hidden rect, text with runs, an image, a path, a group), a
 * shape with text, a connector with a label, and an instance of a component.
 */
export function everyKindDocument(): Document {
  const ops: Op[] = [
    { op: "add_page", id: "page", name: "Page" } as unknown as Op,
    {
      op: "create",
      parentId: "page",
      node: { type: "frame", id: "home", name: "Home", x: 100, y: 80, width: 400, height: 300, fill: "#ffffff", clip: true, layout: { mode: "column", gap: 8, padding: 12, align: "start", justify: "start" } },
    },
    { op: "create", parentId: "home", node: { type: "rect", id: "turned", name: "Turned", x: 0, y: 0, width: 60, height: 30, fill: "#c43d27", rotation: 15 } },
    { op: "create", parentId: "home", node: { type: "rect", id: "ghost", name: "Ghost", x: 0, y: 0, width: 20, height: 20, fill: "#000000", visible: false } },
    {
      op: "create",
      parentId: "home",
      node: { type: "text", id: "title", name: "Title", text: "Hello brave world", fontSize: 20, runs: [{ start: 6, end: 11, fontWeight: 700, color: "#ff0000" }, { start: 12, end: 17, href: "https://example.com" }] },
    },
    { op: "create", parentId: "home", node: { type: "text", id: "plain", name: "Plain", text: "Just text" } },
    { op: "create", parentId: "home", node: { type: "image", id: "pic", name: "Pic", x: 0, y: 0, width: 40, height: 40, src: "https://example.com/a.png", alt: "A picture" } },
    { op: "create", parentId: "home", node: { type: "path", id: "squiggle", name: "Squiggle", x: 0, y: 0, width: 50, height: 50, d: "M0 0 L50 50", stroke: { color: "#222222", width: 2 } } },
    { op: "create", parentId: "home", node: { type: "group", id: "pair", name: "Pair", x: 0, y: 0, children: [] } },
    { op: "create", parentId: "pair", node: { type: "ellipse", id: "dot", name: "Dot", x: 0, y: 0, width: 10, height: 10, fill: "#00aa00" } },
    { op: "create", parentId: "page", node: { type: "shape", id: "box", name: "Box", x: 600, y: 80, text: "Decision", shape: "diamond" } },
    { op: "create", parentId: "page", node: { type: "shape", id: "end", name: "End", x: 600, y: 300, text: "End" } },
    { op: "create", parentId: "page", node: { type: "connector", id: "arrow", from: { nodeId: "box" }, to: { nodeId: "end" }, label: "yes" } },
    { op: "create", parentId: "page", node: { type: "frame", id: "btn", name: "Button", x: 100, y: 500, width: 120, height: 40, fill: "#c43d27", component: true } },
    { op: "create", parentId: "page", node: { type: "frame", id: "btn-copy", name: "Button copy", x: 300, y: 500, instanceOf: "btn" } },
  ];
  return applyOps(createDocument("Fixture", "doc-1"), ops).doc;
}

/** Page and node ids of `everyKindDocument`. */
export const PAGE = "page";

/**
 * jsdom has no layout. This gives the elements a size from their own inline style (a node) or from `viewport` (the canvas
 * viewport), and places a node on screen through the world's `transform`, so the code that measures the DOM gets what a browser would.
 */
export function stubLayout(viewport = { width: 1000, height: 800 }) {
  const original = HTMLElement.prototype.getBoundingClientRect;
  const px = (value: string) => Number.parseFloat(value) || 0;
  const rect = (left: number, top: number, width: number, height: number): DOMRect => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.dataset.testid === "viewport") return rect(0, 0, viewport.width, viewport.height);
    if (this.dataset.paprikaId !== undefined) {
      const world = this.closest<HTMLElement>("[data-canvas-world]");
      const m = /translate\(([-\d.e]+)px(?:,\s*([-\d.e]+)px)?\)\s*scale\(([-\d.e]+)\)/.exec(world?.style.transform ?? "");
      const [tx, ty, zoom] = m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3])] : [0, 0, 1];
      // Absolute offsets up to the world (good enough for nodes placed with left/top).
      let x = 0;
      let y = 0;
      for (let el: HTMLElement | null = this; el && el !== world; el = el.parentElement) {
        x += px(el.style.left);
        y += px(el.style.top);
      }
      return rect(tx + x * zoom, ty + y * zoom, px(this.style.width) * zoom, px(this.style.height) * zoom);
    }
    return original.call(this);
  };
  return () => {
    HTMLElement.prototype.getBoundingClientRect = original;
  };
}
