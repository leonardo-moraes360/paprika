import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const crate = dirname(fileURLToPath(import.meta.url));
// The artifact goes to both apps: each imports it from its own `src/wasm/` (gitignored).
const outs = ["web-legacy", "apps/web"].map((app) => join(crate, "../..", app, "src/wasm"));
const want = readFileSync(join(crate, "Cargo.toml"), "utf8").match(/wasm-bindgen = "=([\d.]+)"/)?.[1];
const require = process.env.PAPRIKA_REQUIRE_WASM === "1";

function tool(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

const missing = [];
if (!tool("cargo", ["--version"])) missing.push("cargo (https://rustup.rs)");
const targets = tool("rustup", ["target", "list", "--installed"]);
if (targets !== null && !targets.split("\n").includes("wasm32-unknown-unknown")) missing.push("rustup target add wasm32-unknown-unknown");
const bindgen = tool("wasm-bindgen", ["--version"]);
if (!bindgen || !bindgen.includes(want)) missing.push(`cargo install wasm-bindgen-cli --version ${want}${bindgen ? ` (found ${bindgen})` : ""}`);
if (missing.length) {
  const msg = `[render-wasm] skipped, missing: ${missing.join("; ")}. The canvas keeps the DOM renderer.`;
  if (require) {
    console.error(msg);
    process.exit(1);
  }
  console.warn(msg);
  process.exit(0);
}

const run = (cmd, args) => execFileSync(cmd, args, { cwd: crate, stdio: "inherit" });
run("cargo", ["build", "--release", "--target", "wasm32-unknown-unknown"]);
const wasm = join(crate, "target/wasm32-unknown-unknown/release/paprika_render.wasm");
for (const out of outs) {
  mkdirSync(out, { recursive: true });
  run("wasm-bindgen", ["--target", "web", "--out-dir", out, wasm]);
}
console.log(`[render-wasm] built -> ${outs.join(", ")}`);
