import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { repoRoot, startServer } from "./test/harness.js";

const out = process.argv[2];
const dir = await mkdtemp(join(tmpdir(), "b022-"));
const file = join(dir, "demo.paprika.json");
await copyFile(join(repoRoot, "packages/e2e/fixtures/demo.paprika.json"), file);
const server = await startServer({ seed: file, webRoot: join(repoRoot, "apps/web/dist") });
const browser = await chromium.launch(process.env.PAPRIKA_CHROMIUM ? { executablePath: process.env.PAPRIKA_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(server.url);
await page.locator(".workspace-card.is-active").click();
await page.waitForSelector('[data-paprika-id="login"]');
await page.locator('[data-layer-id="8succ2i53s"]').click();
await page.waitForSelector('[data-testid="inspector-section-position"]');
await page.waitForTimeout(300);
const m = await page.evaluate(() => {
  const panel = document.querySelector("#right-tabpanel");
  const aside = document.querySelector("aside.right");
  return {
    panel: panel.getBoundingClientRect().height,
    panelScroll: panel.scrollHeight,
    scroll: aside.scrollHeight,
    client: aside.clientHeight,
  };
});
console.log(JSON.stringify(m));
await page.screenshot({ path: join(out, "app.png") });
await page.locator("aside.right").screenshot({ path: join(out, "inspector.png") });
await browser.close();
await server.stop();
