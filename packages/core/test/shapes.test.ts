import { describe, expect, it } from "vitest";
import { parsePath, pathBounds, roundPathCorners, shapePath } from "../src/index.js";

const bounds = (d: string) => pathBounds(parsePath(d));

describe("roundPathCorners", () => {
  it("rounds a square with one global radius", () => {
    const d = roundPathCorners("M0 0 L100 0 L100 100 L0 100 Z", { radius: 10 });
    expect(d).toBe("M10 0 L90 0 A10 10 0 0 1 100 10 L100 90 A10 10 0 0 1 90 100 L10 100 A10 10 0 0 1 0 90 L0 10 A10 10 0 0 1 10 0 Z");
    expect(bounds(d)).toMatchObject({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("clamps to half the shorter adjacent edge", () => {
    const d = roundPathCorners("M0 0 L20 0 L20 100 L0 100 Z", { radius: 50 });
    expect(d).toContain("A10 10 0 0 1");
    expect(bounds(d).width).toBeCloseTo(20, 1);
  });

  it("per-vertex radii override the global one; 0 keeps a corner sharp", () => {
    const d = roundPathCorners("M0 0 L100 0 L100 100 L0 100 Z", { radii: [0, 20, null, 0], radius: 10 });
    expect(d.startsWith("M0 0 L80 0 A20 20")).toBe(true);
    expect(d).toContain("A10 10");
  });

  it("leaves open polyline ends sharp and refuses curves", () => {
    expect(roundPathCorners("M0 0 L50 0 L50 50", { radius: 10 })).toBe("M0 0 L40 0 A10 10 0 0 1 50 10 L50 50");
    expect(() => roundPathCorners("M0 0 C10 0 10 10 0 10", { radius: 5 })).toThrow(/straight edges/);
  });

  it("does not round collinear vertices and drops a repeated closing point", () => {
    expect(roundPathCorners("M0 0 L10 0 L20 0 L20 20 L0 0 Z", { radius: 4 })).toContain("L10 0");
  });
});

describe("shapePath", () => {
  it("star: box starts at 0,0 and the center is reported", () => {
    const s = shapePath("star", { points: 5, radius: 50 });
    const b = bounds(s.d);
    expect(b.x).toBeCloseTo(0, 1);
    expect(b.y).toBeCloseTo(0, 1);
    expect(s.center.y).toBeCloseTo(50, 1);
    expect(s.width).toBeCloseTo(95.11, 1);
  });

  it("rounded polygon stays inside the circumscribed circle", () => {
    const s = shapePath("polygon", { sides: 6, radius: 40, cornerRadius: 6 });
    expect(s.d).toContain("A");
    expect(s.width).toBeLessThan(80);
  });

  it("ring: two circles, evenodd", () => {
    const s = shapePath("ring", { radius: 50, thickness: 10 });
    expect(s).toMatchObject({ width: 100, height: 100, fillRule: "evenodd", center: { x: 50, y: 50 } });
    expect(s.d.match(/M/g)).toHaveLength(2);
  });

  it("arc and sector", () => {
    const q = shapePath("arc", { radius: 50, thickness: 10, startAngle: 0, endAngle: 90 });
    expect(q.width).toBeCloseTo(50, 1);
    expect(q.height).toBeCloseTo(50, 1);
    expect(q.center.x).toBeCloseTo(0, 1);
    const capped = shapePath("arc", { radius: 50, thickness: 10, startAngle: 0, endAngle: 90, roundCaps: true });
    expect(capped.d.match(/A5 5/g)).toHaveLength(2);
    const w = shapePath("sector", { radius: 50, startAngle: 270, endAngle: 90 });
    expect(w.width).toBeCloseTo(100, 1);
    expect(w.height).toBeCloseTo(50, 1);
  });

  it("rejects bad parameters with actionable messages", () => {
    expect(() => shapePath("star", { radius: 10 })).toThrow(/points is required/);
    expect(() => shapePath("ring", { radius: 10, thickness: 10 })).toThrow(/hole radius/);
    expect(() => shapePath("ring", { radius: 10, thickness: 2, innerRadius: 5 })).toThrow(/not both/);
    expect(() => shapePath("sector", { radius: 10, cornerRadius: 2, startAngle: 0, endAngle: 90 })).toThrow(/cornerRadius/);
    expect(() => shapePath("arc", { radius: 10, thickness: 2, startAngle: 5, endAngle: 5 })).toThrow(/empty/);
  });
});
