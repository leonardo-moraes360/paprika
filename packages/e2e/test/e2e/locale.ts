import type { Page } from "playwright";

/** Pin the canvas language before the first navigation (localStorage `paprika.locale`). */
export async function pinLocale(page: Page, locale: "en" | "pt-BR"): Promise<void> {
  await page.addInitScript((lang) => {
    try {
      localStorage.setItem("paprika.locale", lang);
    } catch {
      /* ignore */
    }
  }, locale);
}
