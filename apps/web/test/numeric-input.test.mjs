// Run: node --test apps/web/test/numeric-input.test.mjs
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
  isNumericTyping,
  parseNumeric,
  rangeMessage,
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
