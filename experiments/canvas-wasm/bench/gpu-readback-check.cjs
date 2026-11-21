// Checks the WebGPU (vello) path pixel by pixel in headless Chromium: renders offscreen and reads
// the target texture back (a WebGPU canvas cannot be presented/read without a real GPU here).
// Usage: node gpu-readback-check.cjs   (with the bench Vite server on :5199)
const { chromium } = require("playwright");
const path = require("node:path");
const pkg = "/@fs" + path.resolve(__dirname, "../../../apps/web/src/wasm/paprika_render.js");
(async () => {
  const b = await chromium.launch({ args: ["--enable-unsafe-webgpu"] });
  const p = await b.newPage();
  p.on("console", (m) => m.type() === "error" && console.error("[page]", m.text()));
  await p.goto("http://localhost:5199/");
  const r = await p.evaluate(async (pkg) => {
    const mod = await import(pkg);
    await mod.default();
    const c = document.createElement("canvas"); c.width = 64; c.height = 64; document.body.append(c);
    const r = await mod.createRenderer(c, "gpu");
    // red 24x24 rect at (8,8), blue 20x20 ellipse at (40,0), then a viewBox path (evenodd hole).
    const S = 25, rows = [
      [0, 8, 8, 24, 24, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0],
      [1, 40, 0, 20, 20, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0],
      [4, 0, 40, 40, 20, 0, 0, 1, 0, 0.5, 0, 1, 0, 0, 0, 0],
    ];
    const data = new Float32Array(rows.length * S); rows.forEach((row, i) => data.set(row, i * S));
    r.setScene(data, "0 0 10 10 evenodd round round|M0 0H10V10H0Z M3 3H7V7H3Z");
    r.renderOffscreen(0, 0, 1); await r.finish(); await r.readPixels();
    const px = r.takePixels();
    const at = (x, y) => Array.from(px.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)).join(",");
    return { backend: r.backend, rect: at(20, 20), ellipse: at(50, 10), corner: at(41, 1), pathFill: at(12, 42), pathHole: at(20, 50), bg: at(60, 60) };
  }, pkg);
  await b.close();
  const want = { backend: "webgpu", rect: "255,0,0,255", ellipse: "0,0,255,255", pathFill: "0,128,0,255", pathHole: "237,237,240,255", bg: "237,237,240,255", corner: "237,237,240,255" };
  const bad = Object.entries(want).filter(([k, v]) => r[k] !== v);
  console.log(JSON.stringify(r));
  if (bad.length) { console.error("FAIL", bad.map(([k, v]) => `${k}: got ${r[k]} want ${v}`).join("; ")); process.exit(1); }
  console.log("PASS: vello WebGPU output matches expected pixels");
})();
