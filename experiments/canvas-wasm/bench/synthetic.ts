// Synthetic documents: N shapes spread over frames of 100 nodes (rects, ellipses, rounded,
// strokes, rotation, translucency), all absolutely positioned.
import { FORMAT, type Document, type Node } from "@paprika/core";

export function syntheticDoc(count: number): Document {
  const nodes: Record<string, Node> = {};
  const rootIds: string[] = [];
  const perFrame = 100;
  const frames = Math.ceil(count / perFrame);
  const cols = Math.ceil(Math.sqrt(frames));
  let rnd = 42;
  const rand = () => ((rnd = (rnd * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const palette = ["#e4572e", "#29335c", "#f3a712", "#a8c686", "#669bbc", "#7b2d26", "#ffffff"];
  for (let f = 0; f < frames; f++) {
    const fid = `f${f}`;
    const children: string[] = [];
    const n = Math.min(perFrame, count - f * perFrame);
    for (let i = 0; i < n; i++) {
      const id = `n${f}_${i}`;
      const ellipse = i % 3 === 0;
      children.push(id);
      if (i % 8 === 4) {
        // A closed cubic blob (what the bezier pen produces), with a centered stroke.
        const k = 6 + rand() * 6;
        nodes[id] = {
          id, name: "", parentId: fid, type: "path",
          x: (i % 10) * 40, y: Math.floor(i / 10) * 40, width: 36, height: 36,
          rotation: 0, opacity: 1, visible: true, locked: false, radius: 0,
          d: `M18 2 C${30 + k} 2 34 ${14 - k} 34 18 C34 ${30 + k} ${22 + k} 34 18 34 C6 34 2 ${26 - k} 2 18 C2 6 ${10 - k} 2 18 2 Z`,
          fillRule: "nonzero", strokeCap: "round", strokeJoin: "round",
          fill: palette[(i + 3) % palette.length], stroke: { color: "#111111", width: 1.5 },
        } as Node;
        continue;
      }
      nodes[id] = {
        id, name: "", parentId: fid, type: ellipse ? "ellipse" : "rect",
        x: (i % 10) * 40 + rand() * 8, y: Math.floor(i / 10) * 40 + rand() * 8,
        width: 16 + rand() * 30, height: 16 + rand() * 30,
        rotation: i % 7 === 0 ? rand() * 90 : 0, opacity: i % 5 === 0 ? 0.6 : 1,
        visible: true, locked: false, radius: ellipse ? 0 : (i % 4) * 4,
        fill: palette[i % palette.length],
        stroke: i % 6 === 0 ? { color: "#111111", width: 2 } : undefined,
      } as Node;
    }
    nodes[fid] = {
      id: fid, name: `Board ${f}`, parentId: null, type: "frame",
      x: (f % cols) * 460, y: Math.floor(f / cols) * 460, width: 420, height: 420,
      rotation: 0, opacity: 1, visible: true, locked: false, radius: 12, fill: "#fafafa",
      clip: true, children,
    } as Node;
    rootIds.push(fid);
  }
  return { format: FORMAT, id: `synthetic-${count}`, name: `${count} shapes`, tokens: {}, rootIds, nodes };
}
