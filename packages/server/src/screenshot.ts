import { renderHTML, type Document } from "@paprika/core";

type Browser = { newPage(opts: object): Promise<Page>; close(): Promise<void> };
type Page = {
  setContent(html: string, opts: object): Promise<void>;
  screenshot(opts: object): Promise<Buffer>;
  close(): Promise<void>;
};

let browserPromise: Promise<Browser> | undefined;

async function getBrowser(): Promise<Browser> {
  browserPromise ??= (async () => {
    let pw: { chromium: { launch(opts: object): Promise<Browser> } };
    try {
      pw = (await import("playwright")) as unknown as typeof pw;
    } catch {
      throw new Error("screenshot indisponível: instale o pacote opcional 'playwright' e rode 'npx playwright install chromium'");
    }
    const executablePath = process.env.PAPRIKA_CHROMIUM || undefined;
    return pw.chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  })();
  try {
    return await browserPromise;
  } catch (e) {
    browserPromise = undefined;
    throw e;
  }
}

const MAX_SIDE = 4096;

/**
 * Renderiza o mesmo HTML do export (nodeStyle) num Chromium headless e devolve um PNG.
 * A escala é reduzida automaticamente para que nenhum lado passe de 4096px.
 */
export async function screenshot(doc: Document, opts: { rootId?: string; scale?: number } = {}): Promise<{
  png: Buffer;
  width: number;
  height: number;
}> {
  const { html, bounds } = renderHTML(doc, { rootId: opts.rootId, background: opts.rootId ? "transparent" : "#ffffff" });
  const width = Math.ceil(bounds.width);
  const height = Math.ceil(bounds.height);
  const requested = opts.scale ?? 1;
  const scale = Math.max(0.1, Math.min(requested, MAX_SIDE / width, MAX_SIDE / height));
  const browser = await getBrowser();
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  try {
    await page.setContent(html, { waitUntil: "load", timeout: 15_000 });
    const png = await page.screenshot({ type: "png", omitBackground: !!opts.rootId, timeout: 15_000 });
    return { png, width: Math.round(width * scale), height: Math.round(height * scale) };
  } finally {
    await page.close();
  }
}

export async function closeBrowser(): Promise<void> {
  const b = browserPromise;
  browserPromise = undefined;
  if (b) await (await b.catch(() => undefined))?.close();
}
