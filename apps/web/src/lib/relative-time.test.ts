import { describe, expect, it } from "vitest";
import { relativeParts } from "./relative-time";

describe("relativeParts", () => {
  const now = 1_000_000_000;
  it("reports now below the threshold", () => {
    expect(relativeParts(now - 4_000, now)).toEqual({ unit: "now", count: 0 });
    expect(relativeParts(now + 9_000, now)).toEqual({ unit: "now", count: 0 });
  });
  it("walks seconds, minutes, hours and days", () => {
    expect(relativeParts(now - 5_000, now)).toEqual({ unit: "seconds", count: 5 });
    expect(relativeParts(now - 59_999, now)).toEqual({ unit: "seconds", count: 59 });
    expect(relativeParts(now - 60_000, now)).toEqual({ unit: "minutes", count: 1 });
    expect(relativeParts(now - 3_600_000, now)).toEqual({ unit: "hours", count: 1 });
    expect(relativeParts(now - 86_400_000 * 3, now)).toEqual({ unit: "days", count: 3 });
  });
  it("accepts another threshold", () => {
    expect(relativeParts(now - 10_000, now, 30)).toEqual({ unit: "now", count: 0 });
  });
});
