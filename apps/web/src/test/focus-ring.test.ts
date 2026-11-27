import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { focusRing } from "@/lib/utils";
import { sourceFiles } from "./architecture";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Tailwind 4: `outline-none` sets `--tw-outline-style: none` and `focus-visible:outline-2` only sets the width, so a control with both
 * has a ring of style `none` (invisible) unless `outline-solid` is in the same class set. A class set is one string literal; a set that
 * spreads `focusRing` is fine because the constant carries `outline-solid` (checked below).
 */
function brokenFocusRings(source: string): string[] {
  const sets = source.match(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g) ?? [];
  return sets.filter((set) => /(?:^|[\s"'`])outline-none(?=[\s"'`])/.test(set) && /focus-visible:-?outline-(?:\d|\[)/.test(set) && !/focus-visible:outline-solid/.test(set));
}

describe("focus rings with outline-none", () => {
  it("the shared focusRing brings the outline style back", () => {
    expect(focusRing).toContain("focus-visible:outline-solid");
  });

  it("no file of src/ has outline-none plus a focus-visible outline width without outline-solid in the same class set", () => {
    const broken = sourceFiles(srcDir)
      .filter((file) => /\.(tsx?|css)$/.test(file) && !/\.test\./.test(file))
      .flatMap((file) => brokenFocusRings(readFileSync(file, "utf8")).map((set) => `${relative(srcDir, file)}: ${set.slice(0, 90)}`));
    expect(broken).toEqual([]);
  });

  it("the check sees the defect and accepts the fix", () => {
    expect(brokenFocusRings('const a = "outline-none focus-visible:outline-2 focus-visible:outline-select"')).toHaveLength(1);
    expect(brokenFocusRings("const a = `x outline-none focus-visible:outline-2 focus-visible:outline-solid`")).toEqual([]);
    expect(brokenFocusRings('const a = "focus-visible:outline-2 focus-visible:outline-select"')).toEqual([]);
    expect(brokenFocusRings('const a = "outline-none focus-visible:outline-select"')).toEqual([]);
  });
});
