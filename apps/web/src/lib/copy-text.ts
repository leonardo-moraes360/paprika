export async function copyText(text: string, fallbackTarget?: HTMLInputElement | null): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // falls through to the selection fallback
  }
  if (typeof document === "undefined") return false;
  const field = fallbackTarget ?? Object.assign(document.createElement("textarea"), { value: text });
  if (!fallbackTarget) document.body.append(field);
  try {
    field.focus();
    field.select();
    return typeof document.execCommand === "function" && document.execCommand("copy");
  } catch {
    return false;
  } finally {
    if (!fallbackTarget) field.remove();
  }
}
