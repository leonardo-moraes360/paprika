import { describe, expect, it } from "vitest";
import { parseColor } from "../src/lint.js";

describe("color parsing on adversarial input", () => {
  const fast = (input: string) => {
    const t0 = performance.now();
    parseColor(input);
    return performance.now() - t0;
  };

  it("stays linear on long runs of digits and spaces", () => {
    const zeros = "0".repeat(50_000);
    const spaces = " ".repeat(50_000);
    expect(fast(`oklch(${zeros}x 0 0)`)).toBeLessThan(200);
    expect(fast(`color(srgb${spaces}`)).toBeLessThan(200);
    expect(fast(`color-mix(in srgb,${spaces}`)).toBeLessThan(200);
  });

  it("keeps accepting the same colors", () => {
    expect(parseColor("oklch(0.5 0.1 120)")).toBeDefined();
    expect(parseColor("oklch(.5 .1 120)")).toBeDefined();
    expect(parseColor("oklch(-0.5 0 0)")).toBeDefined();
    expect(parseColor("oklch(1. 0 0)")).toBeUndefined();
    expect(parseColor("color(display-p3 1 0 0)")).toBeDefined();
    expect(parseColor("color(srgb   0.2 0.4 0.6 / 0.5)")).toBeDefined();
    expect(parseColor("color(srgb)")).toBeUndefined();
    expect(parseColor("color-mix(in srgb, red 30%, blue)")).toBeDefined();
    expect(parseColor("color-mix(in  oklch ,   red,blue)")).toBeDefined();
  });
});
