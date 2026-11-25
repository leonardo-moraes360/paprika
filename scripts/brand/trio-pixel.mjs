export const rrect = (x, y, w, h, r) =>
  `M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;
export const circle = (cx, cy, r) =>
  `M${cx - r} ${cy} A${r} ${r} 0 1 0 ${cx + r} ${cy} A${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;

export const THEMES = {
  light: {
    bg: "#FBF4E6", tile: "#FFFFFF", tileStroke: "#EADFC9", ink: "#2A1A14", muted: "#7A5F52",
    vermelho: "#E23B2E", amarelo: "#F4B41A", verde: "#2E8B4A", verdeEscuro: "#1F5E33", brilho: "#FF9A7C",
    selecao: "#1FA3B5", alca: "#FFFFFF",
  },
  dark: {
    bg: "#141827", tile: "#1E2336", tileStroke: "#2C3350", ink: "#EEF0F7", muted: "#9AA3BF",
    vermelho: "#EE4A35", amarelo: "#FFC233", verde: "#3FA75B", verdeEscuro: "#4F9A5A", brilho: "#FF9A7C",
    selecao: "#4CC7D8", alca: "#1E2336",
  },
};

const GRID = { cell: 13, gap: 2.5, ox: (100 - (5 * 13 + 4 * 2.5)) / 2, oy: 9 };

export function gridSymbol({ map, fills, radius, selection, selectionColor, handleFill = "#FFFFFF" }) {
  const { cell, gap, ox, oy } = GRID;
  const byFill = new Map();
  map.forEach((row, ry) =>
    [...row].forEach((ch, rx) => {
      if (ch === ".") return;
      const x = ox + rx * (cell + gap), y = oy + ry * (cell + gap);
      const d = rrect(x, y, cell, cell, radius(rx, ry));
      byFill.set(fills[ch], [...(byFill.get(fills[ch]) ?? []), d]);
    }),
  );
  const out = [...byFill].map(([fill, ds]) => ({ d: ds.join(" "), fill }));
  if (!selection) return out;
  const fx = ox - 4, fy = oy + cell + gap - 4, fw = 5 * cell + 4 * gap + 8, fh = 5 * cell + 4 * gap + 8;
  out.push({ d: rrect(fx, fy, fw, fh, 0), stroke: selectionColor, sw: 1.6 });
  const handles = [[fx, fy], [fx + fw, fy], [fx, fy + fh], [fx + fw, fy + fh]].map(([hx, hy]) => rrect(hx - 3, hy - 3, 6, 6, 1));
  out.push({ d: handles.join(" "), fill: handleFill, stroke: selectionColor, sw: 1.4 });
  return out;
}

export function symbolLayers(c, { selection = true } = {}) {
  return gridSymbol({
    map: ["..g..", "yrrrv", "yhrrv", "yrrrv", "yrrrv", "y.r.v"],
    fills: { g: c.verdeEscuro, y: c.amarelo, r: c.vermelho, h: c.brilho, v: c.verde },
    radius: (rx, ry) => ((ry === 1 && (rx === 0 || rx === 4)) || ry === 5 ? 6.5 : 3.5),
    selection,
    selectionColor: c.selecao,
    handleFill: c.alca ?? "#FFFFFF",
  });
}

export function wordmarkPath({ sw = 28, tracking = 26 } = {}) {
  const r = 50, gap = tracking + sw;
  let x = 0;
  const p = [];
  p.push(`M${x} 0 L${x} 150`, circle(x + r, r, r)); x += 2 * r + gap;
  p.push(circle(x + r, r, r), `M${x + 2 * r} 0 L${x + 2 * r} 100`); x += 2 * r + gap;
  p.push(`M${x} 0 L${x} 150`, circle(x + r, r, r)); x += 2 * r + gap;
  p.push(`M${x} 100 L${x} 0 M${x} 55 Q${x} 0 ${x + 55} 0`); x += 55 + gap * 0.8;
  p.push(`M${x} 0 L${x} 100`); const dot = [x, -38]; x += gap;
  p.push(`M${x} -50 L${x} 100 M${x + 70} 0 L${x} 62 M${x + 22} 42 L${x + 72} 100`); x += 72 + gap;
  p.push(circle(x + r, r, r), `M${x + 2 * r} 0 L${x + 2 * r} 100`); x += 2 * r;
  return { d: p.join(" "), dot, w: x };
}

export function wordmark({ sw = 24, tracking = 30, dotLift = 8 } = {}) {
  const { d, dot: [dx, dy0], w } = wordmarkPath({ sw, tracking });
  const dy = dy0 - dotLift;
  const ds = sw * 1.25 * 1.2;
  const dot = rrect(dx - ds / 2, dy - ds / 2, ds, ds, ds / 3);
  const pad = sw / 2 + 4;
  return { stroke: d, dot, viewBox: [-pad, -50 - pad, w + 2 * pad, 200 + 2 * pad], sw };
}
