import { expect } from "vitest";
import type { Page } from "playwright";

/**
 * Closes every toast by its close button ("Fechar notificação"). `dismissToasts` of `seededCanvas.ts` clicks the first button
 * of the toast, which is its ACTION ("Ver histórico", "Refazer") when it has one: it opens the history or redoes a step.
 */
export async function closeToasts(page: Page) {
  const toasts = page.locator('[data-slot="toast"]');
  for (let i = 0; i < 10 && (await toasts.count()) > 0; i++) {
    await toasts.first().getByRole("button", { name: "Fechar notificação" }).click({ timeout: 2000 }).catch(() => undefined);
    await page.waitForTimeout(100);
  }
  await expect.poll(() => toasts.count()).toBe(0);
}
