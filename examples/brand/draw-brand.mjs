// Draws 5 Paprika icon + theme proposals over MCP (JSON-RPC over HTTP), with increasing icon complexity.
// Usage: PAPRIKA_MCP=http://127.0.0.1:4777/mcp node examples/brand/draw-brand.mjs
const URL_ = process.env.PAPRIKA_MCP ?? "http://127.0.0.1:4777/mcp";
let rpcId = 0;
async function call(name, args) {
  const res = await fetch(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "user-agent": "brand-agent/1" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
  });
  const json = await res.json();
  const r = json.result;
  if (!r || r.isError) throw new Error(`${name}: ${JSON.stringify(json.error ?? r?.content)}`);
  return r.content.map((c) => c.text ?? "").join("\n");
}

// ---------- primitivas (coordenadas na unidade 200 do ícone, multiplicadas por s) ----------
const k = (s) => (v) => Math.round(v * s * 100) / 100;
const shape = (type, s, x, y, w, h, fill, extra = {}) => {
  const f = k(s);
  return { type, x: f(x), y: f(y), width: f(w), height: f(h), fill, ...extra, ...(extra.radius ? { radius: f(extra.radius) } : {}) };
};
const E = (s, x, y, w, h, fill, extra) => shape("ellipse", s, x, y, w, h, fill, extra);
const R = (s, x, y, w, h, fill, extra) => shape("rect", s, x, y, w, h, fill, extra);

// ---------- 5 ícones, complexidade crescente ----------
const icons = {
  // 1: círculo + cabinho (3 formas)
  dot: (s) => [
    E(s, 44, 46, 112, 136, "$brand", { name: "Fruto" }),
    R(s, 93, 20, 14, 38, "$stem", { radius: 7, name: "Cabo" }),
  ],
  // 2: vagem alongada inclinada + cálice (5 formas)
  pod: (s) => [
    E(s, 62, 30, 76, 160, "$brand", { rotation: -28, name: "Vagem" }),
    E(s, 58, 30, 40, 26, "$stem", { rotation: -28, name: "Cálice" }),
    R(s, 68, 4, 10, 32, "$stem", { radius: 5, rotation: -28, name: "Cabo" }),
  ],
  // 3: pimentão de 3 lóbulos + cabo + folha (6 formas)
  bell: (s) => [
    E(s, 28, 50, 78, 124, "$brand", { name: "Lóbulo esq." }),
    E(s, 94, 50, 78, 124, "$brand", { name: "Lóbulo dir." }),
    E(s, 60, 44, 80, 136, "$brand", { name: "Lóbulo central" }),
    R(s, 94, 18, 12, 38, "$stem", { radius: 6, name: "Cabo" }),
    E(s, 102, 20, 46, 20, "$leaf", { rotation: -22, name: "Folha" }),
  ],
  // 4: lóbulos com volume (sombra/luz), brilho, cálice, folha com nervura (11 formas)
  shaded: (s) => [
    E(s, 26, 52, 80, 126, "$brand.dark", { name: "Lóbulo esq. (sombra)" }),
    E(s, 94, 52, 80, 126, "$brand.dark", { name: "Lóbulo dir. (sombra)" }),
    E(s, 58, 44, 84, 138, "$brand", { name: "Lóbulo central" }),
    E(s, 36, 60, 56, 104, "$brand", { name: "Lóbulo esq." }),
    E(s, 70, 66, 16, 62, "$shine", { rotation: 12, name: "Brilho" }),
    E(s, 74, 136, 8, 14, "$shine", { name: "Brilho 2" }),
    E(s, 74, 40, 52, 20, "$stem.dark", { name: "Cálice" }),
    R(s, 94, 14, 12, 36, "$stem", { radius: 6, name: "Cabo" }),
    E(s, 104, 14, 52, 22, "$leaf", { rotation: -24, name: "Folha" }),
    R(s, 110, 23, 36, 3, "$stem.dark", { rotation: -24, name: "Nervura" }),
  ],
  // 5: pimentão sombreado + caixa de seleção com alças + cursor + pó de páprica (≈20 formas)
  studio: (s) => [
    ...icons.shaded(s * 0.8).map((n) => ({ ...n, x: n.x + k(s)(18), y: n.y + k(s)(10) })),
    R(s, 26, 18, 148, 156, "transparent", { stroke: { color: "$accent", width: Math.max(1, Math.round(2 * s)) }, name: "Seleção" }),
    ...[[22, 14], [170, 14], [22, 170], [170, 170]].map(([x, y], i) => R(s, x, y, 8, 8, "#ffffff", { stroke: { color: "$accent", width: Math.max(1, Math.round(1.5 * s)) }, name: `Alça ${i + 1}` })),
    R(s, 158, 132, 6, 34, "$accent", { radius: 3, name: "Faísca vertical" }),
    R(s, 144, 146, 34, 6, "$accent", { radius: 3, name: "Faísca horizontal" }),
    R(s, 155, 143, 12, 12, "$accent", { rotation: 45, radius: 2, name: "Faísca centro" }),
    ...[[30, 182, 10], [44, 186, 7], [56, 181, 9], [70, 187, 6], [120, 186, 7], [132, 181, 9]].map(([x, y, d], i) =>
      E(s, x, y, d, d, i % 2 ? "$brand" : "$brand.dark", { name: `Pó ${i + 1}` }),
    ),
  ],
};

// ---------- temas ----------
const themes = [
  { key: "dot", title: "1 · Ponto", theme: "Páprica pura", desc: "Mínimo: um fruto e um cabo. Funciona em 16px.",
    tokens: { bg: "#fbf6f0", surface: "#ffffff", ink: "#2a1a14", muted: "#6e5a50", brand: "#d9411e", "brand.dark": "#a8301a", stem: "#3f7d3a", "stem.dark": "#2c5a29", leaf: "#5c9e46", shine: "#f08a6a", accent: "#2a1a14", line: "#ead9cb" } },
  { key: "pod", title: "2 · Vagem", theme: "Defumada", desc: "Pimentón ahumado: fundo carvão, vermelho tostado.",
    tokens: { bg: "#1d1715", surface: "#2a211e", ink: "#f6ece4", muted: "#bfae9f", brand: "#c8432b", "brand.dark": "#8e2b1d", stem: "#6f8f3c", "stem.dark": "#4c6529", leaf: "#8fb052", shine: "#e88a6c", accent: "#e8b04a", line: "#3d322d" } },
  { key: "bell", title: "3 · Pimentão", theme: "Mercado húngaro", desc: "Creme, vermelho e verde de feira; acolhedor.",
    tokens: { bg: "#f7efe1", surface: "#fffaf1", ink: "#2b2118", muted: "#6d5d4c", brand: "#c9361f", "brand.dark": "#962615", stem: "#2f6b3a", "stem.dark": "#214d29", leaf: "#4f9a4a", shine: "#ee8c70", accent: "#2f6b3a", line: "#e6d6bd" } },
  { key: "shaded", title: "4 · Volume", theme: "Pôr do sol", desc: "Luz e sombra chapadas; mais presença como app.",
    tokens: { bg: "#fff1e6", surface: "#ffffff", ink: "#2d1408", muted: "#6f4b38", brand: "#e2502a", "brand.dark": "#b23a1c", stem: "#3e7f3b", "stem.dark": "#2a5a28", leaf: "#6aab4c", shine: "#ffb08f", accent: "#7a2e14", line: "#f3d6c2" } },
  { key: "studio", title: "5 · Estúdio", theme: "Estúdio noturno", desc: "Páprica selecionada por um agente (faísca = IA): ferramenta + ingrediente.",
    tokens: { bg: "#141827", surface: "#1e2336", ink: "#eef0f7", muted: "#a6acc4", brand: "#e04a2b", "brand.dark": "#a93220", stem: "#4f9a5a", "stem.dark": "#336b3d", leaf: "#7cc46a", shine: "#ff9a7c", accent: "#4cc7d8", line: "#2c3350" } },
];

// Tokens por proposta: prefixados (p1.brand…), e o ícone usa $pN.xxx.
const prefixed = (n, obj) => Object.fromEntries(Object.entries(obj).map(([key, v]) => [`p${n}.${key}`, v]));
const retarget = (n, nodes) =>
  nodes.map((node) => {
    const out = { ...node };
    for (const f of ["fill"]) if (typeof out[f] === "string" && out[f].startsWith("$")) out[f] = `$p${n}.${out[f].slice(1)}`;
    if (out.stroke?.color?.startsWith("$")) out.stroke = { ...out.stroke, color: `$p${n}.${out.stroke.color.slice(1)}` };
    return out;
  });

const text = (t, extra) => ({ type: "text", text: t, width: "fill", height: "hug", ...extra });

function proposal(n, t, y) {
  const tk = (name) => `$p${n}.${name}`;
  const tile = (size, radius) => ({
    type: "frame", name: `Ícone ${size}px`, width: size, height: size, fill: tk("surface"), radius, clip: true,
    stroke: { color: tk("line"), width: 1 },
    children: retarget(n, icons[t.key](size / 200)),
  });
  const swatch = (name) => ({
    type: "frame", name: `Cor ${name}`, width: 92, height: "hug", fill: "transparent", clip: false, layout: { mode: "column", gap: 6 },
    children: [
      { type: "rect", name: "Amostra", width: 92, height: 44, fill: tk(name), radius: 8, stroke: { color: tk("line"), width: 1 } },
      text(name, { fontSize: 12, fontWeight: 600, color: tk("ink") }),
      text(t.tokens[name], { fontSize: 12, color: tk("muted"), fontFamily: "ui-monospace, Menlo, monospace" }),
    ],
  });
  return {
    type: "frame", id: `proposta-${n}`, name: `Proposta ${t.title}`, x: 0, y, width: 1120, height: 400, fill: tk("bg"), radius: 24,
    layout: { mode: "row", gap: 40, padding: 40, align: "center" },
    notes: `Ícone nível ${n} de 5. Tema "${t.theme}". Formas só com elipses/retângulos (flat).`,
    children: [
      tile(240, 56),
      {
        type: "frame", name: "Escalas", width: "hug", height: "hug", fill: "transparent", clip: false, layout: { mode: "column", gap: 20, align: "center" },
        children: [tile(96, 24), tile(48, 12), tile(24, 6)],
      },
      {
        type: "frame", name: "Tema", width: "fill", height: "hug", fill: "transparent", clip: false, layout: { mode: "column", gap: 14 },
        children: [
          text(t.title, { name: "Título", fontSize: 32, fontWeight: 800, color: tk("ink"), lineHeight: 1.1 }),
          text(`Tema: ${t.theme}`, { name: "Tema", fontSize: 18, fontWeight: 600, color: tk("ink") }),
          text(t.desc, { name: "Descrição", fontSize: 15, color: tk("muted") }),
          { type: "frame", name: "Paleta", width: "fill", height: "hug", fill: "transparent", clip: false, layout: { mode: "row", gap: 12, wrap: true },
            children: ["brand", "brand.dark", "stem", "accent", "bg", "ink"].map(swatch) },
          { type: "frame", name: "Amostra de UI", width: "fill", height: "hug", fill: "transparent", clip: false, layout: { mode: "row", gap: 12, align: "center" },
            children: [
              { type: "frame", name: "Botão primário", width: "hug", height: 40, fill: tk("brand.dark"), radius: 10, layout: { mode: "row", padding: [0, 18, 0, 18], align: "center" },
                children: [text("Abrir no Paprika", { width: "hug", color: "#ffffff", fontWeight: 600, fontSize: 14 })] },
              { type: "frame", name: "Botão secundário", width: "hug", height: 40, fill: "transparent", radius: 10, stroke: { color: tk("line"), width: 1 },
                layout: { mode: "row", padding: [0, 18, 0, 18], align: "center" },
                children: [text("Conectar MCP", { width: "hug", color: tk("ink"), fontWeight: 600, fontSize: 14 })] },
            ] },
        ],
      },
    ],
  };
}

await call("apply_ops", { ops: [{ op: "rename_document", name: "Paprika · propostas de marca" }], label: "nomear documento" });
let tokens = {};
themes.forEach((t, i) => Object.assign(tokens, prefixed(i + 1, t.tokens)));
await call("set_tokens", { tokens, label: "tokens das 5 propostas" });
for (const [i, t] of themes.entries()) {
  await call("create_nodes", { nodes: [proposal(i + 1, t, i * 460)], label: `proposta ${t.title}` });
  process.stdout.write(`ok proposta ${i + 1}\n`);
}
console.log(await call("lint_design", {}));
