import type { Page } from "playwright";

export async function pinLocale(page: Page, locale: "en" | "pt-BR"): Promise<void> {
  await page.addInitScript((lang) => {
    try {
      localStorage.setItem("paprika.locale", lang);
    } catch {
    }
  }, locale);
}
