type Loose = Record<string, unknown>;

export interface WorstCase {
  doc: { format: "paprika/1"; id: string; name: string; tokens: Record<string, string | number>; rootIds: string[]; nodes: Record<string, Loose> };
  heavyPageId: string;
  heavyNodes: number;
  textIds: string[];
  nodeCount: number;
  instanceCount: number;
}

export interface WorstCaseOptions {
  id?: string;
  pages?: number;
  totalNodes?: number;
  heavyNodes?: number;
  instances?: number;
}

const ICON = "M2 12 L12 2 L22 12 L12 22 Z M7 12 L12 7 L17 12 L12 17 Z";

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildWorstCase(opts: WorstCaseOptions = {}): WorstCase {
  const pages = opts.pages ?? 7;
  const totalNodes = opts.totalNodes ?? 15_000;
  const heavyNodes = opts.heavyNodes ?? 3_500;
  const instanceTarget = opts.instances ?? 1_000;
  const rand = rng(20261125);
  const nodes: Record<string, Loose> = {};
  const textIds: string[] = [];
  let seq = 0;
  let instanceCount = 0;
  const nid = (p: string) => `${p}${(seq++).toString(36)}`;

  const add = (n: Loose) => {
    nodes[n.id as string] = n;
    return n;
  };
  const link = (parent: Loose, child: Loose) => {
    child.parentId = parent.id;
    (parent.children as string[]).push(child.id as string);
    return child;
  };
  const frame = (name: string, extra: Loose) =>
    add({ id: nid("f"), type: "frame", name, parentId: null, x: 0, y: 0, width: "hug", height: "hug", children: [], clip: false, ...extra });
  const text = (value: string, extra: Loose = {}) => {
    const n = add({ id: nid("t"), type: "text", name: "label", parentId: null, text: value, fontSize: 14, color: "#1d1a1f", width: "hug", height: "hug", ...extra });
    textIds.push(n.id as string);
    return n;
  };
  const rect = (w: number, h: number, fill: string) => add({ id: nid("r"), type: "rect", name: "swatch", parentId: null, width: w, height: h, fill, radius: 4 });
  const ellipse = (d: number, fill: string) => add({ id: nid("e"), type: "ellipse", name: "dot", parentId: null, width: d, height: d, fill });
  const path = (color: string) =>
    add({ id: nid("p"), type: "path", name: "icon", parentId: null, width: 24, height: 24, d: ICON, viewBox: [0, 0, 24, 24], stroke: { color, width: 2 }, fill: "#ffffff" });

  const palette = ["#c43d27", "#2563eb", "#059669", "#7c3aed", "#d97706", "#0891b2"];
  const pick = () => palette[Math.floor(rand() * palette.length)]!;

  const component = frame("Chip", {
    component: true,
    x: 0,
    y: 0,
    fill: "#ffffff",
    radius: 8,
    stroke: { color: "#e6e0da", width: 1 },
    layout: { mode: "row", gap: 6, padding: [4, 8], align: "center" },
  });
  link(component, ellipse(8, "#c43d27"));
  link(component, text("Chip", { fontSize: 12 }));
  link(component, path("#6b6470"));

  let counted = 0;
  const count = (n: number) => (counted += n);

  const instance = () => {
    instanceCount++;
    count(1);
    return add({ id: nid("i"), type: "frame", name: "Chip", parentId: null, instanceOf: component.id, width: "hug", height: "hug", children: [] });
  };

  const row = (withInstance: boolean) => {
    const r = frame("row", {
      fill: "#ffffff",
      radius: 6,
      stroke: { color: "#e6e0da", width: 1 },
      layout: { mode: "row", gap: 8, padding: [6, 10], align: "center" },
    });
    link(r, rect(16, 16, pick()));
    link(r, text(`Item ${seq} lorem ipsum dolor sit amet`));
    count(3);
    if (withInstance) link(r, instance());
    return r;
  };

  const card = (withInstances: number) => {
    const c = frame("card", {
      width: 320,
      fill: "#fbf8f4",
      radius: 12,
      stroke: { color: pick(), width: 2, position: "inside" },
      layout: { mode: "column", gap: 10, padding: 16 },
    });
    const header = link(c, frame("header", { layout: { mode: "row", gap: 8, align: "center" } }));
    link(header, ellipse(20, pick()));
    link(header, text(`Card ${seq}`, { fontSize: 18, fontWeight: 600 }));
    link(header, path(pick()));
    count(5);
    const body = link(c, frame("body", { layout: { mode: "column", gap: 6 } }));
    count(1);
    for (let i = 0; i < 6; i++) link(body, row(i < withInstances));
    link(c, text("Footer note with a longer sentence to wrap inside the card width", { fontSize: 12, color: "#6b6470", width: "fill" }));
    count(1);
    return c;
  };

  const rootIds: string[] = [];
  const perPage = [heavyNodes];
  const rest = Math.max(0, totalNodes - heavyNodes - 40);
  for (let i = 1; i < pages; i++) perPage.push(Math.round(rest / (pages - 1)));
  const instancesPerPage = perPage.map((n) => Math.round((instanceTarget * n) / perPage.reduce((a, b) => a + b, 0)));
  let heavyPageId = "";

  for (let p = 0; p < pages; p++) {
    const pg = add({ id: nid("pg"), type: "page", name: p === 0 ? "Heavy" : `Page ${p + 1}`, parentId: null, children: [] });
    rootIds.push(pg.id as string);
    if (p === 0) heavyPageId = pg.id as string;
    const startCount = counted;
    let remainingInstances = p === pages - 1 ? instanceTarget - instanceCount : Math.min(instancesPerPage[p]!, instanceTarget - instanceCount);
    let i = 0;
    if (p === 1) {
      link(pg, component);
      component.x = -400;
      component.y = 0;
      count(4);
    }
    while (counted - startCount < perPage[p]!) {
      const withInst = Math.min(6, remainingInstances);
      remainingInstances -= withInst;
      const c = link(pg, card(withInst));
      c.x = (i % 10) * 380;
      c.y = Math.floor(i / 10) * 700;
      i++;
    }
  }

  const doc = { format: "paprika/1" as const, id: opts.id ?? "perfworst1", name: "Perf worst case", tokens: {}, rootIds, nodes };
  return { doc, heavyPageId, heavyNodes: perPage[0]!, textIds, nodeCount: Object.keys(nodes).length, instanceCount };
}
