import type { CanvasDefaults } from "@/components/frontends/canvas";

/**
 * What the nodes the canvas creates carry that the document would not choose by itself, as the old canvas wrote them: a white
 * frame, a warm grey rectangle and ellipse, a dark ink for the diagram shapes and for a pen stroke, near black for a text. These
 * are DOCUMENT data (colours written into the file, the same in a dark or a light interface), so they are the container's, in one
 * place; the canvas frontend takes them by prop and has none of its own.
 */
export const canvasDefaults: CanvasDefaults = {
  vector: { stroke: "#1e2336", fill: "#d9d4cf" },
  frame: { fill: "#ffffff" },
  rect: { fill: "#d9d4cf" },
  ellipse: { fill: "#d9d4cf" },
  text: { content: "Texto", color: "#111111", fontFamily: "Inter, system-ui, sans-serif", fontSize: 16, fontWeight: 400, lineHeight: 1.4, letterSpacing: 0, textAlign: "left" },
  shape: { color: "#1e2336", fontFamily: "Inter, system-ui, sans-serif", fontSize: 16, fontWeight: 500, lineHeight: 1.3 },
};
