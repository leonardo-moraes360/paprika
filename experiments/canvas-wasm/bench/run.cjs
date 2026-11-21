// Headless runner: node run.cjs [docs] [modes] [--gpu-flags] — prints JSON lines and saves stills.
// Needs `vite --config experiments/canvas-wasm/bench/vite.config.mjs` running on :5199.
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const [docs = "demo,1000,10000", modes = "auto,cpu,canvas2d,dom"] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const gpu = process.argv.includes("--gpu-flags");
const stills = process.argv.includes("--stills");
const frames = Number(process.env.FRAMES ?? 120);
const outDir = path.join(__dirname, "results");
fs.mkdirSync(outDir, { recursive: true });
(async () => {
  const browser = await chromium.launch({ args: gpu ? ["--enable-unsafe-webgpu"] : [] });
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  page.on("console", (m) => m.type() === "error" && console.error("[page]", m.text()));
  page.on("pageerror", (e) => console.error("[pageerror]", e.message));
  await page.goto(`http://localhost:5199/${gpu ? "?offscreen=1" : ""}`);
  await page.waitForFunction(() => "runBench" in window);
  for (const doc of docs.split(",")) for (const mode of modes.split(",")) {
    if (stills) {
      const r = await page.evaluate(([d, m]) => window.still(d, m), [doc, mode]);
      const file = path.join(outDir, `still-${doc}-${mode}-${r.backend}.png`);
      await page.locator("#stage").screenshot({ path: file });
      console.log(JSON.stringify({ still: path.basename(file), ...r }));
      continue;
    }
    try {
      const r = await page.evaluate(([d, m, f]) => window.runBench(d, m, f), [doc, mode, frames]);
      console.log(JSON.stringify({ gpuFlags: gpu, ...r }));
    } catch (e) {
      console.log(JSON.stringify({ gpuFlags: gpu, doc, mode, error: String(e.message ?? e).split("\n")[0] }));
    }
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
