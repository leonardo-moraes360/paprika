import { describe, expect, it } from "vitest";
import { dashedRing, dashedRingVars, ring, tinted } from "./stroke";

describe("strokes that hold their width on screen", () => {
  it("a ring is an inset shadow divided by the zoom, with the colour it is given", () => {
    expect(ring(1.5, "var(--color-select-brand)")).toEqual({ boxShadow: "inset 0 0 0 calc(1.5px / var(--view-zoom, 1)) var(--color-select-brand)" });
    expect(tinted("--color-select-brand", 70)).toBe("color-mix(in oklab, var(--color-select-brand) 70%, transparent)");
  });

  it("a dashed ring is four gradients, one per side, with the dashes and the width divided by the zoom", () => {
    const style = dashedRing(1, "var(--color-select-brand)");
    expect(String(style.backgroundImage).match(/repeating-linear-gradient/g)).toHaveLength(4);
    expect(style.backgroundImage).toContain("var(--color-select-brand) 0 calc(4px / var(--view-zoom, 1)), transparent calc(4px / var(--view-zoom, 1)) calc(7px / var(--view-zoom, 1))");
    expect(style.backgroundSize).toBe("100% calc(1px / var(--view-zoom, 1)), 100% calc(1px / var(--view-zoom, 1)), calc(1px / var(--view-zoom, 1)) 100%, calc(1px / var(--view-zoom, 1)) 100%");
    expect(style.backgroundRepeat).toBe("no-repeat");
    const vars = dashedRingVars(1, "var(--color-select-brand)") as Record<string, string>;
    expect(vars["--ring-image"]).toBe(style.backgroundImage);
    expect(vars["--ring-size"]).toBe(style.backgroundSize);
  });

  it("no overlay draws a border or an outline from a width divided by the zoom (the browser floors those to a CSS pixel, which the camera then multiplies)", () => {
    const sources = import.meta.glob(["./*.ts", "./*.tsx", "!./*.test.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThan(10);
    for (const [file, source] of Object.entries(sources)) {
      expect(source, file).not.toMatch(/border(Width)?\s*:[^\n]*view-zoom/);
      expect(source, file).not.toMatch(/outline(Width)?\s*:[^\n]*view-zoom/);
    }
  });
});
