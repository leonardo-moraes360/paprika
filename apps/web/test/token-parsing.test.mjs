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
const { parseModeTokenAssignment, parseTokenAssignment, tokenValue } = await server.ssrLoadModule("/src/Inspector.tsx");
after(() => server.close());

const OLD_TOKEN = /^\s*\$?([\w.-]+)\s*[=:]\s*(.+)$/;
const OLD_MODE = /^\s*([A-Za-z0-9_-]{1,40})\s*:\s*\$?([\w.-]+)\s*[=:]\s*(.+)$/;
const oldToken = (text) => {
  const m = OLD_TOKEN.exec(text);
  return m ? { name: m[1], value: m[2].trim() } : null;
};
const oldMode = (text) => {
  const m = OLD_MODE.exec(text);
  return m ? { mode: m[1], name: m[2], value: m[3].trim() } : null;
};

const TOKEN_CASES = [
  "brand = #e8553d",
  "$brand=#e8553d",
  "text.sm: 14",
  "text-sm = 14",
  "  brand   =   #fff  ",
  "brand=",
  "brand= ",
  "brand =  ",
  "brand:",
  "brand",
  "brand = ",
  "a b = c",
  "-x = 1",
  ".x = 1",
  "x.y-z = 1",
  "x = y = z",
  "x=:y",
  "=",
  ":",
  " = ",
  "",
  "   ",
  "# = x",
  "dark: bg = #14161f",
  "1000 = big",
  "über = no",
  "brand =- x",
  "brand := x",
];

const MODE_CASES = [
  "dark: bg = #14161f",
  "dark:bg=#14161f",
  "dark: $bg = 1",
  "dark: bg: 1",
  "dark bg = 1",
  "dark:=bg=1",
  "darknessxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx: bg = 1",
  "darknessxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx: bg = 1",
  "dark: a".repeat(4),
  "dark: ",
  "dark:",
  "dark",
  ": bg = 1",
  ...TOKEN_CASES,
];

describe("the token parsers answer what the old patterns answered", () => {
  it("plain assignments", () => {
    assert.deepEqual(parseTokenAssignment("brand = #e8553d"), { name: "brand", value: "#e8553d" });
    assert.deepEqual(parseTokenAssignment("$text.sm: 14"), { name: "text.sm", value: "14" });
    assert.deepEqual(parseModeTokenAssignment("dark: bg = #14161f"), { mode: "dark", name: "bg", value: "#14161f" });
    assert.deepEqual(parseTokenAssignment("brand =  "), oldToken("brand =  "));
  });

  it("rejects what the old patterns rejected", () => {
    for (const text of ["brand", "brand=", "=", ":", "   ", "a b = c", "# = x", "über = no"]) {
      assert.equal(parseTokenAssignment(text), null, text);
    }
    for (const text of ["dark", "dark:", "dark bg = 1", ": bg = 1"]) {
      assert.equal(parseModeTokenAssignment(text), null, text);
    }
  });

  it("is equivalent to the old token pattern on every case", () => {
    for (const text of TOKEN_CASES) {
      assert.deepEqual(parseTokenAssignment(text), oldToken(text), `token: ${JSON.stringify(text)}`);
    }
  });

  it("is equivalent to the old mode pattern on every case", () => {
    for (const text of MODE_CASES) {
      assert.deepEqual(parseModeTokenAssignment(text), oldMode(text), `mode: ${JSON.stringify(text)}`);
    }
  });
});

describe("typed and collected assignments", () => {
  it("keeps a type word that is the name", () => {
    assert.deepEqual(parseTokenAssignment("color = #fff"), { name: "color", value: "#fff" });
    assert.equal(parseTokenAssignment("a b = c"), null);
  });

  it("reads type, collection, or both", () => {
    assert.deepEqual(parseTokenAssignment("color ink = #111111"), { name: "ink", value: "#111111", type: "color" });
    assert.deepEqual(parseTokenAssignment("brand/ink = #111111"), { name: "ink", value: "#111111", collection: "brand" });
    assert.deepEqual(parseTokenAssignment("brand/fontWeight peso = 600"), { name: "peso", value: "600", type: "fontWeight", collection: "brand" });
  });
});

describe("long adversarial input stays linear", () => {
  it("a 200 kB line is parsed in one pass, same answer as the old pattern", () => {
    const inputs = [
      "a".repeat(200_000),
      `${"a".repeat(200_000)} =`,
      `${" ".repeat(200_000)}=`,
      `brand ${"=".repeat(100_000)}`,
      `brand${" ".repeat(200_000)}`,
      `${"brand.".repeat(50_000)} x`,
      `${" ".repeat(100_000)}brand = #fff${" ".repeat(100_000)}`,
    ];
    for (const text of inputs) {
      const started = performance.now();
      const got = parseTokenAssignment(text);
      const seconds = (performance.now() - started) / 1000;
      assert.deepEqual(got, oldToken(text), `token parse of ${text.slice(0, 24)}…`);
      assert.ok(seconds < 0.05, `parseTokenAssignment took ${seconds.toFixed(3)}s on ${text.length} chars`);
    }
    for (const text of [`dark: ${"b".repeat(200_000)} x`, `${"dark: ".repeat(50_000)}bg`, "d".repeat(200_000)]) {
      const started = performance.now();
      const got = parseModeTokenAssignment(text);
      const seconds = (performance.now() - started) / 1000;
      assert.deepEqual(got, oldMode(text), `mode parse of ${text.slice(0, 24)}…`);
      assert.ok(seconds < 0.05, `parseModeTokenAssignment took ${seconds.toFixed(3)}s on ${text.length} chars`);
    }
  });
});

describe("tokenValue", () => {
  it("keeps numbers as numbers and text as text", () => {
    assert.equal(tokenValue("14"), 14);
    assert.equal(tokenValue("1e3"), 1000);
    assert.equal(tokenValue("-2.5"), -2.5);
    assert.equal(tokenValue("#e8553d"), "#e8553d");
    assert.equal(tokenValue("NaN"), "NaN");
    assert.equal(tokenValue("0x10"), 16);
  });

  it("matches the old `isNaN(Number(x)) ? x : Number(x)` on every case", () => {
    const values = ["14", "", " ", "1e3", "#fff", "NaN", "Infinity", "0x10", "12px", "0", "-0", "1,5"];
    for (const v of values) {
      assert.equal(tokenValue(v), isNaN(Number(v)) ? v : Number(v), JSON.stringify(v));
    }
  });
});
