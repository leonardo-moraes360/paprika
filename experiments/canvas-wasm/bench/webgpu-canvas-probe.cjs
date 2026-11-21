// Shows that a *plain JS* WebGPU canvas loses its device on presentation in headless Chromium
// without a GPU: the limitation is the environment, not wgpu/vello.
const { chromium } = require("playwright");
(async () => {
  for (const opts of [{ args: ["--enable-unsafe-webgpu"] }, { channel: "chromium", args: ["--enable-unsafe-webgpu"] }]) {
  const b = await chromium.launch(opts);
  const p = await b.newPage();
  await p.goto("http://localhost:5199/");
  const r = await p.evaluate(async () => {
    const a = await navigator.gpu.requestAdapter(); const d = await a.requestDevice();
    let lost = "alive"; d.lost.then((i) => (lost = i.reason + ": " + i.message));
    const c = document.createElement("canvas"); c.width = 64; c.height = 64; document.body.append(c);
    const ctx = c.getContext("webgpu");
    ctx.configure({ device: d, format: "rgba8unorm", alphaMode: "opaque" });
    const e = d.createCommandEncoder();
    e.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [1, 0, 0, 1] }] }).end();
    d.queue.submit([e.finish()]);
    await d.queue.onSubmittedWorkDone();
    await new Promise((res) => setTimeout(res, 300));
    return lost;
  });
  console.log(opts.channel ?? "headless-shell", "=>", r);
  await b.close(); }
})();
