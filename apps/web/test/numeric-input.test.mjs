import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const appRoot = fileURLToPath(new URL("..", import.meta.url));
const server = await createServer({
  root: appRoot,
  configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
  server: { middlewareMode: true },
  logLevel: "warn",
});
const {
  allowsNumberFieldInput,
  commitNumeric,
  defaultNumericStep,
  isNumericTyping,
  parseNumeric,
  rangeMessage,
  stepAmount,
  stepNumeric,
} = await server.ssrLoadModule("/src/numericInput.ts");
after(() => server.close());

describe("isNumericTyping", () => {
  it("allows intermediate sign and one decimal separator", () => {
    for (const raw of ["", "-", ".", ",", "-.", "-,", "0", "0,", "0,5", "0.5", "12", "-3", "-3,14", "1."]) {
      assert.equal(isNumericTyping(raw), true, raw);
    }
  });

  it("rejects letters and a second separator", () => {
    for (const raw of ["a", "1a", "1aaaaa", "0,5,0", "1.2.3", "1,,", "e10", " "]) {
      assert.equal(isNumericTyping(raw), false, raw);
    }
  });
});

describe("allowsNumberFieldInput", () => {
  it("keeps hug/fill prefixes for size fields", () => {
    assert.equal(allowsNumberFieldInput("h", ["hug", "fill"]), true);
    assert.equal(allowsNumberFieldInput("hu", ["hug", "fill"]), true);
    assert.equal(allowsNumberFieldInput("hug", ["hug", "fill"]), true);
    assert.equal(allowsNumberFieldInput("fill", ["hug", "fill"]), true);
    assert.equal(allowsNumberFieldInput("abc", ["hug", "fill"]), false);
  });
});

describe("parseNumeric", () => {
  it("parses comma as decimal and refuses non-numbers", () => {
    assert.equal(parseNumeric("0,5"), 0.5);
    assert.equal(parseNumeric("2"), 2);
    assert.equal(parseNumeric("-3,25"), -3.25);
    assert.equal(parseNumeric("1aaaaa"), undefined);
    assert.equal(parseNumeric("abc"), undefined);
    assert.equal(parseNumeric("-"), undefined);
    assert.equal(parseNumeric(""), undefined);
  });
});

describe("commitNumeric", () => {
  it("clamps opacity into 0..1 and mentions the range", () => {
    const high = commitNumeric("2", { min: 0, max: 1 });
    assert.equal(high.ok, true);
    assert.equal(high.value, 1);
    assert.equal(high.clamped, true);
    assert.equal(high.message, "Use um número entre 0 e 1.");

    const low = commitNumeric("-1", { min: 0, max: 1 });
    assert.equal(low.ok, true);
    assert.equal(low.value, 0);
    assert.equal(low.clamped, true);

    const ok = commitNumeric("0,5", { min: 0, max: 1 });
    assert.deepEqual(ok, { ok: true, value: 0.5, text: "0.5", clamped: false });
  });

  it("clamps fontWeight into 100..900 as integer", () => {
    const got = commitNumeric("50", { min: 100, max: 900, integer: true });
    assert.equal(got.ok, true);
    assert.equal(got.value, 100);
    assert.equal(got.clamped, true);
  });

  it("refuses unparsable input with a range message", () => {
    const got = commitNumeric("abc", { min: 0, max: 1 });
    assert.deepEqual(got, { ok: false, message: rangeMessage({ min: 0, max: 1 }) });
  });
});

describe("defaultNumericStep / stepNumeric", () => {
  it("uses 0.05 for opacity, 100 for weight, else 1", () => {
    assert.equal(defaultNumericStep({ min: 0, max: 1 }), 0.05);
    assert.equal(defaultNumericStep({ min: 100, max: 900, integer: true }), 100);
    assert.equal(defaultNumericStep({ min: 0 }), 1);
    assert.equal(stepAmount({ min: 0, max: 1 }, true), 0.5);
    assert.equal(stepAmount({ min: 100, max: 900, integer: true }, true), 1000);
  });

  it("steps opacity by 0.05 and clamps to 0..1", () => {
    const up = stepNumeric(0.5, 1, { min: 0, max: 1 });
    assert.equal(up.ok, true);
    assert.equal(up.value, 0.55);
    assert.equal(up.clamped, false);

    const shift = stepNumeric(0.5, 1, { min: 0, max: 1 }, { shift: true });
    assert.equal(shift.ok, true);
    assert.equal(shift.value, 1);
    assert.equal(shift.clamped, false);

    const over = stepNumeric(0.8, 1, { min: 0, max: 1 }, { shift: true });
    assert.equal(over.ok, true);
    assert.equal(over.value, 1);
    assert.equal(over.clamped, true);

    const down = stepNumeric(0.02, -1, { min: 0, max: 1 });
    assert.equal(down.ok, true);
    assert.equal(down.value, 0);
    assert.equal(down.clamped, true);
  });

  it("steps fontWeight by 100 as integer", () => {
    const up = stepNumeric(400, 1, { min: 100, max: 900, integer: true });
    assert.equal(up.ok, true);
    assert.equal(up.value, 500);

    const low = stepNumeric(100, -1, { min: 100, max: 900, integer: true });
    assert.equal(low.ok, true);
    assert.equal(low.value, 100);
    assert.equal(low.clamped, true);
  });

  it("steps position-like fields by 1 (Shift×10)", () => {
    const up = stepNumeric(10, 1, {});
    assert.equal(up.ok, true);
    assert.equal(up.value, 11);
    const shift = stepNumeric(10, -1, {}, { shift: true });
    assert.equal(shift.ok, true);
    assert.equal(shift.value, 0);
  });
});
