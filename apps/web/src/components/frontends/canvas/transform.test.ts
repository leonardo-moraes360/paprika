import { describe, expect, it } from "vitest";
import { boxCorner, boxHitsRect, lockSize, quadHitsRect, resizeTurned, resizeUpright, turnedBy } from "./transform";

describe("resize of an upright node", () => {
  it("keeps the opposite corner: dragging se grows right and down, nw moves the origin", () => {
    expect(resizeUpright("se", 10, 20, 100, 50, 30, 10, null)).toEqual({ x: 10, y: 20, width: 130, height: 60 });
    expect(resizeUpright("nw", 10, 20, 100, 50, 30, 10, null)).toEqual({ x: 40, y: 30, width: 70, height: 40 });
  });
  it("never goes under 1 px: the dragged corner stops at the fixed one", () => {
    expect(resizeUpright("se", 0, 0, 100, 50, -500, -500, null)).toMatchObject({ width: 1, height: 1 });
    expect(resizeUpright("nw", 0, 0, 100, 50, 500, 500, null)).toEqual({ x: 99, y: 49, width: 1, height: 1 });
  });
  it("Shift keeps the proportion, led by the axis that moved more; Shift+Alt makes a square", () => {
    expect(resizeUpright("se", 0, 0, 100, 50, 100, 5, "ratio")).toMatchObject({ width: 200, height: 100 });
    expect(resizeUpright("se", 0, 0, 100, 50, 2, 50, "ratio")).toMatchObject({ width: 200, height: 100 });
    expect(resizeUpright("se", 0, 0, 100, 50, 40, 5, "square")).toMatchObject({ width: 140, height: 140 });
    // locked from the NW corner the fixed corner is SE
    expect(resizeUpright("nw", 0, 0, 100, 50, -100, 0, "ratio")).toEqual({ x: -100, y: -50, width: 200, height: 100 });
  });
});

describe("resize of a turned node", () => {
  it("keeps the opposite corner where it is on the screen", () => {
    const fixed = boxCorner(0, 0, 100, 50, 30, "nw");
    const pointer = boxCorner(0, 0, 100, 50, 30, "se");
    const next = resizeTurned("se", fixed, { x: pointer.x + 10, y: pointer.y }, 30, null, 2, 100, 50);
    const after = boxCorner(next.x, next.y, next.width, next.height, 30, "nw");
    expect(Math.abs(after.x - fixed.x)).toBeLessThan(1);
    expect(Math.abs(after.y - fixed.y)).toBeLessThan(1);
    expect(next.width).toBeGreaterThan(100);
  });
});

it("lock sizes", () => {
  expect(lockSize(null, 3, 4, 1, 1, 1)).toEqual({ width: 3, height: 4 });
  expect(lockSize("ratio", 30, 10, 20, 10, 2)).toEqual({ width: 30, height: 15 });
});

describe("rotation", () => {
  it("adds the angle the pointer went round, and Shift snaps to 15 degrees", () => {
    expect(turnedBy(10, 0, Math.PI / 2, false)).toBe(100);
    expect(turnedBy(0, 0, (22 * Math.PI) / 180, true)).toBe(15);
    expect(turnedBy(0, 0, (23 * Math.PI) / 180, true)).toBe(30);
    expect(turnedBy(0, 0, (12.3456 * Math.PI) / 180, false)).toBe(12.35);
  });
});

describe("marquee hit test", () => {
  const rect = { left: 0, top: 0, right: 10, bottom: 10 };
  it("an upright box: touching counts, apart does not", () => {
    expect(boxHitsRect({ x: 5, y: 5, width: 20, height: 20, rotation: 0 }, rect)).toBe(true);
    expect(boxHitsRect({ x: 11, y: 0, width: 20, height: 20, rotation: 0 }, rect)).toBe(false);
  });
  it("a turned box is its real outline: its bounding box corner alone does not hit", () => {
    // a long thin bar turned 45 degrees: its bounding box covers the origin corner, the bar does not.
    const bar = { x: 50 - 100, y: 50 - 2, width: 200, height: 4, rotation: 45 };
    expect(boxHitsRect(bar, { left: 80, top: 0, right: 90, bottom: 10 })).toBe(false);
    expect(boxHitsRect(bar, { left: 45, top: 45, right: 55, bottom: 55 })).toBe(true);
  });
  it("a rectangle inside a big quad and edges that cross hit", () => {
    const quad = [{ x: -50, y: 5 }, { x: 5, y: -50 }, { x: 60, y: 5 }, { x: 5, y: 60 }];
    expect(quadHitsRect(quad, rect)).toBe(true);
    expect(quadHitsRect([{ x: 20, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }, { x: 20, y: 30 }], rect)).toBe(false);
  });
});
