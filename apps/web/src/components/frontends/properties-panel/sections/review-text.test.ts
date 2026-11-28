import { describe, expect, it } from "vitest";
import { reviewText } from "./review-text";

describe("reviewText", () => {
  it("reads the values back from the sentences of the core, by rule code", () => {
    expect(reviewText("overlapping-boards", 'overlaps "Sobre"; nearest free spot is 700,-140')).toEqual({ key: "overlapping-boards", values: { name: "Sobre", x: "700", y: "-140" } });
    expect(reviewText("contrast", "contrast 2.10:1 below 4.5:1 (WCAG AA)")).toEqual({ key: "contrast", values: { ratio: "2.10", min: "4.5" } });
    expect(reviewText("contrast", "contrast 2.10:1 below 3:1 (WCAG AA, large text)")?.key).toBe("contrast-large");
    expect(reviewText("small-text", "font size 9px (< 12px)")?.values).toEqual({ size: "9", min: "12" });
    expect(reviewText("overflow", 'goes outside "Home" (520×340) and will be clipped')).toEqual({ key: "overflow-clipped", values: { parent: "Home", width: "520", height: "340" } });
    expect(reviewText("layout-overflow", 'column children leave "Card" (100×100) on width and height: A, B +2')?.key).toBe("layout-overflow-both");
    expect(reviewText("empty-text", "empty text")?.key).toBe("empty-text");
    expect(reviewText("raw-color", 'literal fill "#fff"; prefer a token')).toEqual({ key: "raw-fill", values: { value: "#fff" } });
  });

  it("leaves a rule or a sentence it does not know as the core wrote it", () => {
    expect(reviewText("new-rule", "something")).toBeNull();
    expect(reviewText("overflow", "a sentence the core changed")).toBeNull();
  });
});
