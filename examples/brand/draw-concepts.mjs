// Draws the brand concept boards (A–D, and E/F = the chosen "Trio Pixel" light/dark) over MCP HTTP, in a NEW workspace.
// Never calls open_workspace (the active workspace is left alone): every call carries workspaceId.
// Usage: PAPRIKA_MCP=http://127.0.0.1:4777/mcp node examples/brand/draw-concepts.mjs [--shots DIR]  (APPEND_WS=<id> ONLY=E,F to add boards)
// Screenshots use render_screenshot: export_image took 6–23 s per board here (docs/agent-feedback.md #181).
import { connectBoard, saveShots, textOf } from "../../scripts/design-board.mjs";
import { circle, gridSymbol, rrect, symbolLayers, wordmarkPath } from "./trio-pixel.mjs";

const WS_NAME = process.env.WS_NAME ?? "Marca · conceitos (nov/2026)";
const shotsIdx = process.argv.indexOf("--shots");
const SHOTS = shotsIdx > 0 ? process.argv[shotsIdx + 1] : null;

// MCP client shared with the scripts/draw-pap-b-*.mjs boards (SDK from packages/e2e).
const { call: callTool } = await connectBoard("paprika-brand-concepts");
async function call(name, args) {
  const r = await callTool(name, args);
  if (r.structuredContent) return r.structuredContent;
  const text = textOf(r);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------- geometria ----------
const ellipse = (cx, cy, rx, ry) =>
  `M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;

// Cada símbolo: lista de camadas num quadro 100×100.
// {d, fill?, stroke?, sw?, cap?, op?}
const SYMBOLS = {
  // A · Trio: três lobos (amarelo, verde, vermelho) = as três pimentas da foto.
  trio: (c) => [
    { d: ellipse(33, 61, 19, 29), fill: c.amarelo },
    { d: ellipse(67, 61, 19, 29), fill: c.verde },
    { d: ellipse(50, 63, 21, 32), fill: c.vermelho, stroke: c.tile, sw: 3.5 },
    { d: ellipse(43, 55, 3.6, 10), fill: "#FFFFFF", op: 0.55 },
    { d: "M32 31 Q50 21 68 31 Q50 38 32 31 Z", fill: c.verdeEscuro },
    { d: "M50 30 L50 15 Q51 8 59 7", stroke: c.verdeEscuro, sw: 6, cap: "round" },
  ],
  // B · Pixel: pimentão em grade 5×6 (canvas = pixels) com a seleção do editor.
  pixel: (c) =>
    gridSymbol({
      map: ["..g..", "rrrrr", "rhrrd", "rrrrd", "rrrrd", ".r.d."],
      fills: { g: c.verde, r: c.vermelho, h: c.brilho, d: c.vermelhoEscuro },
      radius: (rx, ry) => ((ry === 1 || ry === 4) && (rx === 0 || rx === 4)) || ry === 5 ? 6 : 3,
      selection: !c.semSelecao,
      selectionColor: c.selecao,
    }),
  // E/F · Trio Pixel (A + B), the chosen brand: geometry shared with the SVG files.
  trixel: (c) => symbolLayers(c, { selection: !c.semSelecao }),
  // C · Cursor: a vagem da páprica vira o ponteiro do agente; a ponta é o clique.
  cursor: (c) => [
    { d: "M14 12 C20 40 30 66 46 80 C56 88 72 87 80 77 C88 67 85 53 74 44 C56 30 36 18 14 12 Z", fill: c.vermelho },
    { d: "M24 26 C30 46 38 60 50 70", stroke: c.brilho, sw: 4, cap: "round" },
    { d: "M64 86 Q86 84 87 61", stroke: c.verde, sw: 8, cap: "round" },
    { d: "M82 80 Q90 88 96 86", stroke: c.verde, sw: 6, cap: "round" },
    { d: "M74 6 Q76 14 84 16 Q76 18 74 26 Q72 18 64 16 Q72 14 74 6 Z", fill: c.faisca },
  ],
  // D · Traço: contorno à mão com nervuras e tracejado; o cabo é uma alça de bézier.
  traco: (c) => [
    { d: "M30 32 C18 34 15 52 19 68 C23 84 34 91 42 86 C46 92 54 92 58 86 C66 91 77 84 81 68 C85 52 82 34 70 32 C62 28 56 33 50 30 C44 33 38 28 30 32 Z", fill: c.tile, stroke: c.vermelho, sw: 3.2, cap: "round" },
    { d: "M42 35 C37 54 37 72 42 86 M58 35 C63 54 63 72 58 86", stroke: c.vermelho, sw: 2.4, cap: "round" },
    { d: "M27 46 L27 51 M25 58 L25 64 M27 71 L28 75 M34 42 L34 46 M50 42 L50 46 M50 53 L50 58 M50 66 L50 70 M67 42 L67 46 M73 50 L73 56 M74 63 L73 68", stroke: c.vermelho, sw: 1.6, cap: "round" },
    { d: "M28 92 L36 88 M40 94 L52 92 M58 93 L70 89", stroke: c.grafite, sw: 1.4, cap: "round", op: 0.7 },
    { d: "M50 30 L50 15", stroke: c.verde, sw: 3.2, cap: "round" },
    { d: "M50 15 L66 8", stroke: c.verde, sw: 1.4, cap: "round" },
    { d: rrect(46.5, 11.5, 7, 7, 1), fill: c.tile, stroke: c.verde, sw: 1.8 },
    { d: circle(66, 8, 3.2), fill: c.verde },
  ],
};

// Junta camadas consecutivas com a mesma pintura num path só (menos nós no documento).
function mergeLayers(layers) {
  const out = [];
  for (const l of layers) {
    const prev = out[out.length - 1];
    const key = (x) => JSON.stringify([x.fill, x.stroke, x.sw, x.cap, x.op]);
    if (prev && key(prev) === key(l)) prev.d += " " + l.d;
    else out.push({ ...l });
  }
  return out;
}

// group não aceita rotation: a rotação vai para cada camada (todas têm a mesma caixa, então giram juntas).
function symbolNodes(kind, c, x, y, size, name, extra = {}) {
  const { rotation, ...rest } = extra;
  return {
    type: "group",
    name,
    x,
    y,
    ...rest,
    children: mergeLayers(SYMBOLS[kind](c)).map((l, i) => {
      const n = { type: "path", name: `${name} · ${i + 1}`, x: 0, y: 0, width: size, height: size, viewBox: [0, 0, 100, 100], d: l.d };
      if (rotation) n.rotation = rotation;
      if (l.fill) n.fill = l.fill;
      if (l.stroke) n.stroke = { color: l.stroke, width: l.sw ?? 2 };
      if (l.cap) n.strokeCap = l.cap;
      if (l.stroke) n.strokeJoin = "round";
      if (l.op != null) n.opacity = l.op;
      return n;
    }),
  };
}

// ---------- letreiro: traços de examples/brand/trio-pixel.mjs ----------
function wordmark(sw, tracking) {
  const { d, dot, w } = wordmarkPath({ sw, tracking });
  return { d, dots: [dot], w, top: -50, bottom: 150 };
}

// Letreiro como nós: um path com o traço + pingo do i (variante por direção).
function wordmarkNodes(c, cfg, x, y, height, name) {
  const { sw, tracking, color, dot } = cfg;
  const wm = wordmark(sw, tracking);
  const pad = sw / 2 + 2;
  const vb = [-pad, wm.top - pad, wm.w + 2 * pad, wm.bottom - wm.top + 2 * pad];
  const scale = height / vb[3];
  const width = vb[2] * scale;
  const children = [
    { type: "path", name: `${name} · traço`, x: 0, y: 0, width, height, viewBox: vb, d: wm.d, stroke: { color, width: sw }, strokeCap: "round", strokeJoin: "round" },
  ];
  const [dx, dy] = wm.dots[0];
  const ds = sw * 1.25;
  let dotD, dotFill = dot.color, dotStroke;
  if (dot.kind === "circle") dotD = circle(dx, dy, ds * 0.62);
  if (dot.kind === "square") dotD = rrect(dx - ds * 0.6, dy - ds * 0.6, ds * 1.2, ds * 1.2, ds * 0.18);
  if (dot.kind === "spark") dotD = `M${dx} ${dy - 30} Q${dx + 4} ${dy - 4} ${dx + 30} ${dy} Q${dx + 4} ${dy + 4} ${dx} ${dy + 30} Q${dx - 4} ${dy + 4} ${dx - 30} ${dy} Q${dx - 4} ${dy - 4} ${dx} ${dy - 30} Z`;
  if (dot.kind === "handle") {
    dotD = rrect(dx - 11, dy - 11, 22, 22, 3);
    dotFill = cfg.bg;
    dotStroke = { color: dot.color, width: sw * 0.75 };
  }
  const dn = { type: "path", name: `${name} · pingo`, x: 0, y: 0, width, height, viewBox: vb, d: dotD, fill: dotFill };
  if (dotStroke) dn.stroke = dotStroke;
  children.push(dn);
  if (dot.kind === "handle") {
    children.push({ type: "path", name: `${name} · alça`, x: 0, y: 0, width, height, viewBox: vb, d: `M${dx + 11} ${dy - 6} L${dx + 58} ${dy - 30}`, stroke: { color: dot.color, width: sw * 0.45 }, strokeCap: "round" });
    children.push({ type: "path", name: `${name} · nó`, x: 0, y: 0, width, height, viewBox: vb, d: circle(dx + 62, dy - 32, 9), fill: dot.color });
  }
  return { node: { type: "group", name, x, y, children }, width };
}

// ---------- direções ----------
const DIRECTIONS = [
  {
    key: "trio",
    num: "A",
    title: "Trio",
    tagline: "Vermelho, amarelo e verde: as três pimentas da foto num só símbolo. Feira, cor, alegria.",
    why: "Símbolo de 3 lobos sobrepostos, com o recorte branco dos ícones chapados. Letreiro grosso e redondo, pingo do i amarelo.",
    c: { bg: "#FBF4E6", tile: "#FFFFFF", ink: "#2A1A14", muted: "#7A5F52", vermelho: "#E23B2E", amarelo: "#F4B41A", verde: "#2E8B4A", verdeEscuro: "#1F5E33", strip: "#F3E6CC" },
    palette: [["vermelho", "#E23B2E"], ["amarelo", "#F4B41A"], ["verde", "#2E8B4A"], ["verde.escuro", "#1F5E33"], ["creme", "#FBF4E6"], ["tinta", "#2A1A14"]],
    wm: { sw: 30, tracking: 26, colorKey: "ink", dot: { kind: "circle", colorKey: "amarelo" } },
    pattern: "grid",
  },
  {
    key: "pixel",
    num: "B",
    title: "Pixel",
    tagline: "Evolução do tema Estúdio: o pimentão montado em grade, como o canvas vê, já selecionado.",
    why: "Grade 5×6 com o vão entre os lobos embaixo; moldura e alças de seleção em ciano. Pingo do i quadrado, como uma alça.",
    c: { bg: "#141827", tile: "#1E2336", ink: "#EEF0F7", muted: "#9AA3BF", vermelho: "#E04A2B", vermelhoEscuro: "#A93220", brilho: "#FF9A7C", verde: "#4F9A5A", selecao: "#4CC7D8", strip: "#1A1F31" },
    palette: [["páprica", "#E04A2B"], ["páprica.escura", "#A93220"], ["brilho", "#FF9A7C"], ["cabo", "#4F9A5A"], ["seleção", "#4CC7D8"], ["noite", "#141827"]],
    wm: { sw: 24, tracking: 24, colorKey: "ink", dot: { kind: "square", colorKey: "selecao" } },
    pattern: "pixel",
  },
  {
    key: "cursor",
    num: "C",
    title: "Cursor",
    tagline: "A vagem da páprica é o ponteiro do agente: a ponta clica, a faísca é a IA trabalhando.",
    why: "Fala direto do produto (agentes desenhando). Letreiro médio; pingo do i em páprica. Padrão: ponteiros seguindo uma curva de bézier.",
    c: { bg: "#FFFFFF", tile: "#FFF3EE", ink: "#1B1D22", muted: "#6B6F7A", vermelho: "#E8442E", brilho: "#FF9F86", verde: "#3FA35B", faisca: "#FFC53D", strip: "#FFF3EE" },
    palette: [["páprica", "#E8442E"], ["defumada", "#8E2B1D"], ["cabo", "#3FA35B"], ["faísca", "#FFC53D"], ["papel", "#FFFFFF"], ["carvão", "#1B1D22"]],
    wm: { sw: 22, tracking: 24, colorKey: "ink", dot: { kind: "circle", colorKey: "vermelho" } },
    pattern: "cursor",
  },
  {
    key: "traco",
    num: "D",
    title: "Traço",
    tagline: "Caderno de rascunho: contorno à mão, tracejado de textura e o cabo como alça de bézier.",
    why: "Mais autoral e editorial; ótimo para site e ilustrações. Letreiro fino; o pingo do i é um nó de bézier com alça.",
    c: { bg: "#F6F0E4", tile: "#FFFDF7", ink: "#222222", grafite: "#222222", muted: "#6E665A", vermelho: "#D9362B", amarelo: "#E8A317", verde: "#4B7A2A", strip: "#EFE5D2" },
    palette: [["vermelho", "#D9362B"], ["amarelo", "#E8A317"], ["verde", "#4B7A2A"], ["papel", "#F6F0E4"], ["papel.claro", "#FFFDF7"], ["grafite", "#222222"]],
    wm: { sw: 9, tracking: 30, colorKey: "ink", dot: { kind: "handle", colorKey: "verde" } },
    pattern: "traco",
  },
];

DIRECTIONS.push(
  {
    key: "trixel",
    num: "E",
    title: "Trio Pixel · claro",
    tagline: "A + B: o pimentão em grade do Pixel com as três cores do Trio. Feira e ferramenta no mesmo símbolo.",
    why: "Colunas amarela, vermelha e verde; embaixo, três lobos. No padrão as cores ficam sempre na mesma ordem; a seleção ciano marca 1 peça a cada 7. Pingo do i quadrado e amarelo.",
    c: { bg: "#FBF4E6", tile: "#FFFFFF", ink: "#2A1A14", muted: "#7A5F52", vermelho: "#E23B2E", amarelo: "#F4B41A", verde: "#2E8B4A", verdeEscuro: "#1F5E33", brilho: "#FF9A7C", selecao: "#1FA3B5", strip: "#F3E6CC" },
    palette: [["vermelho", "#E23B2E"], ["amarelo", "#F4B41A"], ["verde", "#2E8B4A"], ["seleção", "#1FA3B5"], ["creme", "#FBF4E6"], ["tinta", "#2A1A14"]],
    wm: { sw: 28, tracking: 26, colorKey: "ink", dot: { kind: "square", colorKey: "amarelo" } },
    pattern: "trixel",
  },
  {
    key: "trixel",
    num: "F",
    title: "Trio Pixel · escuro",
    tagline: "A mesma mistura no fundo noturno do Estúdio: é como o ícone aparece no app e no dock.",
    why: "Cores do Trio um pouco mais claras para o fundo escuro; ciano do Estúdio como seleção. Pingo do i quadrado e amarelo.",
    c: { bg: "#141827", tile: "#1E2336", ink: "#EEF0F7", muted: "#9AA3BF", vermelho: "#EE4A35", amarelo: "#FFC233", verde: "#3FA75B", verdeEscuro: "#4F9A5A", brilho: "#FF9A7C", selecao: "#4CC7D8", alca: "#1E2336", strip: "#1A1F31" },
    palette: [["vermelho", "#EE4A35"], ["amarelo", "#FFC233"], ["verde", "#3FA75B"], ["seleção", "#4CC7D8"], ["noite", "#141827"], ["névoa", "#EEF0F7"]],
    wm: { sw: 28, tracking: 26, colorKey: "ink", dot: { kind: "square", colorKey: "amarelo" } },
    pattern: "trixel",
  },
);

const W = 1440, H = 960, P = 64;
const text = (name, t, x, y, size, color, weight = 400, extra = {}) => ({ type: "text", name, text: t, x, y, fontSize: size, fontWeight: weight, color, fontFamily: "Inter", ...extra });

function patternNodes(dir, w, h) {
  const c = dir.c;
  const out = [];
  if (dir.pattern === "grid") {
    const s = 64, step = 92;
    let i = 0;
    for (let row = 0; row * step < h + step; row++)
      for (let col = -1; col * step < w + step; col++) {
        const x = col * step + (row % 2 ? step / 2 : 0) + 8, y = row * step + 14;
        const roles = [c, { ...c, vermelho: c.amarelo, amarelo: c.vermelho }, { ...c, vermelho: c.verde, verde: c.vermelho }][(row + col + 3) % 3];
        out.push(symbolNodes("trio", { ...roles, tile: c.strip }, x, y, s, `trio ${++i}`));
      }
  } else if (dir.pattern === "pixel") {
    const s = 72, step = 84;
    let i = 0;
    const variants = [{ ...c, semSelecao: true }, { ...c, vermelho: "#2B3150", vermelhoEscuro: "#232842", brilho: "#3A4166", verde: "#2B3150", selecao: "#1A1F31", semSelecao: true }];
    for (let row = 0; row * step < h + step; row++)
      for (let col = 0; col * step < w + step; col++) {
        const v = (row + col) % 3 === 0 ? 0 : 1;
        out.push(symbolNodes("pixel", variants[v], col * step - 6, row * step + 6, s, `pixel ${++i}`));
      }
  } else if (dir.pattern === "trixel") {
    // cores sempre na mesma ordem (identidade); o ritmo vem do vão e da seleção em 1 a cada 7
    const s = 76, step = 116;
    let i = 0;
    for (let row = 0; row * 108 < h + 40; row++)
      for (let col = -1; col * step < w + step; col++) {
        i++;
        const sel = i % 7 === 3 ? {} : { semSelecao: true };
        out.push(symbolNodes("trixel", { ...c, ...sel }, col * step + (row % 2 ? step / 2 : 0) + 20, row * 108 + 14, s, `trixel ${i}`));
      }
  } else if (dir.pattern === "cursor") {
    // curva de bézier com nós e ponteiros pousados nela
    for (let k = 0; k < 3; k++) {
      const y0 = 70 + k * 100;
      const pts = [];
      let d = `M-40 ${y0}`;
      for (let x = -40; x < w + 160; x += 160) {
        const up = (x / 160) % 2 === 0;
        d += ` C${x + 50} ${y0 + (up ? -60 : 60)} ${x + 110} ${y0 + (up ? -60 : 60)} ${x + 160} ${y0}`;
        pts.push([x + 160, y0]);
      }
      out.push({ type: "path", name: `curva ${k + 1}`, x: 0, y: 0, d, stroke: { color: ["#F2C9BE", c.verde, "#F2C9BE"][k], width: 3 }, strokeCap: "round" });
      pts.forEach(([px, py], j) => {
        if ((j + k) % 2 === 0) out.push(symbolNodes("cursor", c, px - 12, py - 14, 64, `cursor ${k}-${j}`, { rotation: [8, -10, 4][k] }));
        else out.push({ type: "rect", name: `nó ${k}-${j}`, x: px - 6, y: py - 6, width: 12, height: 12, fill: "#FFFFFF", stroke: { color: c.vermelho, width: 2 }, radius: 2 });
      });
    }
  } else if (dir.pattern === "traco") {
    const s = 76, step = 120;
    let i = 0;
    const rot = [-12, 8, -4, 14, -9, 5];
    const tints = [c, { ...c, vermelho: c.amarelo }, { ...c, vermelho: c.verde, verde: c.vermelho }];
    for (let row = 0; row * 100 < h + 60; row++)
      for (let col = -1; col * step < w + step; col++) {
        i++;
        const x = col * step + (row % 2 ? 60 : 0) + 10, y = row * 100 + 8;
        out.push(symbolNodes("traco", { ...tints[i % 3], tile: c.strip }, x, y, s, `traço ${i}`, { rotation: rot[i % rot.length] }));
      }
  }
  return out;
}

function board(dir, x, y) {
  const c = dir.c;
  const wmCfg = { ...dir.wm, color: c[dir.wm.colorKey], bg: c.bg, dot: { ...dir.wm.dot, color: c[dir.wm.dot.colorKey] } };
  const children = [];
  children.push(text("Número", `Direção ${dir.num}`, P, P, 16, c.muted, 600, { letterSpacing: 1 }));
  children.push(text("Título", dir.title, P, P + 24, 48, c.ink, 800));
  children.push(text("Conceito", dir.tagline, P, P + 92, 18, c.ink, 400, { width: 620, lineHeight: 1.45 }));

  // ícone de app + tamanhos pequenos
  const iy = 250;
  children.push({ type: "frame", name: "Ícone 256", x: P, y: iy, width: 256, height: 256, radius: 60, fill: c.tile, clip: true, stroke: { color: c.ink, width: 1 }, outline: undefined,
    children: [symbolNodes(dir.key, c, 28, 28, 200, "símbolo")] });
  [[96, 22], [48, 11], [24, 6]].forEach(([s, r], i) => {
    const sx = P + 290 + [0, 112, 176][i], sy = iy + 256 - s;
    children.push({ type: "frame", name: `Ícone ${s}`, x: sx, y: sy, width: s, height: s, radius: r, fill: c.tile, clip: true, stroke: { color: c.ink, width: 1 },
      children: [symbolNodes(dir.key, c, s * 0.1, s * 0.1, s * 0.8, `símbolo ${s}`)] });
  });
  children.push(text("Tamanhos", "256 · 96 · 48 · 24 px", P + 290, iy + 2, 14, c.muted, 500));

  // letreiro + lockup
  const lx = 760;
  children.push(text("Rótulo letreiro", "Letreiro + símbolo", lx, P, 14, c.muted, 600, { letterSpacing: 0.5 }));
  children.push(symbolNodes(dir.key, c, lx - 6, P + 34, 128, "lockup · símbolo"));
  const wm = wordmarkNodes(c, wmCfg, lx + 132, P + 56, 96, "lockup · letreiro");
  children.push(wm.node);
  children.push(text("Por quê", dir.why, lx, P + 196, 16, c.muted, 400, { width: 600, lineHeight: 1.45 }));

  // paleta
  const py = iy + 34;
  children.push(text("Rótulo paleta", "Paleta", lx, py + 60, 14, c.muted, 600, { letterSpacing: 0.5 }));
  dir.palette.forEach(([nm, hex], i) => {
    const sx = lx + i * 104;
    children.push({ type: "rect", name: `cor ${nm}`, x: sx, y: py + 88, width: 92, height: 64, radius: 12, fill: hex, stroke: { color: c.ink, width: 1 } });
    children.push(text(`nome ${nm}`, nm, sx, py + 160, 13, c.ink, 600));
    children.push(text(`hex ${nm}`, hex, sx, py + 180, 12, c.muted, 400, { fontFamily: "monospace" }));
  });

  // padrão
  const sy = 560, sh = H - sy - P;
  children.push(text("Rótulo padrão", "Padrão", P, sy - 30, 14, c.muted, 600, { letterSpacing: 0.5 }));
  children.push({ type: "frame", name: "Padrão", x: P, y: sy, width: W - 2 * P, height: sh, radius: 24, fill: c.strip, clip: true, children: patternNodes(dir, W - 2 * P, sh) });

  return { type: "frame", name: `${dir.num} · ${dir.title}`, x, y, width: W, height: H, fill: c.bg, radius: 32, clip: true, children };
}

function clean(o) {
  if (Array.isArray(o)) return o.map(clean);
  if (o && typeof o === "object") {
    const r = {};
    for (const [k, v] of Object.entries(o)) if (v !== undefined) r[k] = clean(v);
    return r;
  }
  return o;
}

// ---------- execução ----------
const before = await call("list_workspaces", {});
const activeBefore = before.active ?? before?.workspaces?.find?.((w) => w.active)?.id;
// APPEND_WS=<id> desenha no workspace existente; ONLY=E,F filtra as direções.
const ws = process.env.APPEND_WS ? { id: process.env.APPEND_WS } : await call("create_workspace", { name: WS_NAME });
const wsId = ws.id ?? ws.workspace?.id;
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
if (!wsId) throw new Error(`create_workspace sem id: ${JSON.stringify(ws)}`);
console.log("workspace", wsId, "ativo antes:", activeBefore);

const ids = [];
for (const [i, dir] of DIRECTIONS.entries()) {
  if (only && !only.includes(dir.num)) continue;
  const node = clean(board(dir, (i % 2) * (W + 120), Math.floor(i / 2) * (H + 120)));
  const r = await call("create_nodes", { workspaceId: wsId, nodes: [node], place: "none", label: `Marca · direção ${dir.num}`, batch: "marca-conceitos" });
  const id = r.roots?.[0]?.id ?? r.ids?.[0];
  ids.push([dir, id]);
  console.log(dir.num, id, r.warnings ? JSON.stringify(r.warnings).slice(0, 300) : "");
}

for (const [dir, id] of ids) {
  const lint = await call("lint_design", { workspaceId: wsId, rootId: id, groups: true, minSeverity: "warning" });
  console.log("lint", dir.num, JSON.stringify(lint).slice(0, 600));
}

if (SHOTS) await saveShots(callTool, wsId, SHOTS, ids.map(([dir, id]) => [id, `direcao-${dir.num}-${dir.key}.png`]));

const after = await call("list_workspaces", {});
const activeAfter = after.active ?? after?.workspaces?.find?.((w) => w.active)?.id;
console.log("ativo depois:", activeAfter, activeAfter === activeBefore ? "(inalterado)" : "(MUDOU!)");
console.log("workspace:", wsId);
