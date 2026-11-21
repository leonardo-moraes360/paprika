import { MEASURE_SCRIPT, exportSVG, renderHTML, type Document, type Measure } from "@paprika/core";

type Browser = { newPage(opts: object): Promise<Page>; close(): Promise<void> };
type Page = {
  setContent(html: string, opts: object): Promise<void>;
  evaluate(script: string): Promise<unknown>;
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
  // Um nó sai com fundo transparente; uma página (ou o canvas) usa o fundo dela, ou branco.
  const node = opts.rootId && doc.nodes[opts.rootId]?.type !== "page";
  const { html, bounds } = renderHTML(doc, { rootId: opts.rootId, background: node ? "transparent" : undefined });
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

/**
 * Exporta SVG com o layout resolvido pelo navegador: renderiza o mesmo HTML do export, mede
 * caixas e linhas de texto com MEASURE_SCRIPT e monta o SVG no core.
 */
export async function svgExport(doc: Document, rootId?: string): Promise<{ svg: string; width: number; height: number; warnings: string[] }> {
  const node = rootId && doc.nodes[rootId]?.type !== "page";
  const { html, bounds } = renderHTML(doc, { rootId, background: node ? "transparent" : undefined });
  const browser = await getBrowser();
  const page = await browser.newPage({ viewport: { width: Math.max(1, Math.ceil(bounds.width)), height: Math.max(1, Math.ceil(bounds.height)) } });
  try {
    await page.setContent(html, { waitUntil: "load", timeout: 15_000 });
    const measure = (await page.evaluate(MEASURE_SCRIPT)) as Measure;
    return exportSVG(doc, { rootId, measure });
  } finally {
    await page.close();
  }
}

export async function closeBrowser(): Promise<void> {
  const b = browserPromise;
  browserPromise = undefined;
  if (b) await (await b.catch(() => undefined))?.close();
}
