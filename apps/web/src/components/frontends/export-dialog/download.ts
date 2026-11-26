export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function asBlob(value: Blob | string, type: string): Blob {
  return value instanceof Blob ? value : new Blob([value], { type });
}

export async function asText(value: Blob | string): Promise<string> {
  return typeof value === "string" ? value : value.text();
}

const extensions: Record<string, string> = { jpeg: "jpg" };

export function imageExtension(format: string): string {
  return extensions[format] ?? format;
}

export function imageFileName(base: string, format: string, scale: number, scaled: boolean): string {
  return `${base}${scaled && scale !== 1 ? `@${scale}x` : ""}.${imageExtension(format)}`;
}

export function scaledSize(size: { width: number; height: number }, scale: number) {
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
}

export function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === "string" && error ? error : String(error);
}
