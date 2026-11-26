import type { CanvasErrorInfo } from "./types";

const maxStackLines = 6;
const maxLength = 1200;

export function toErrorInfo(error: unknown, componentStack?: string | null): CanvasErrorInfo {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack, componentStack: componentStack ?? undefined };
  }
  return { name: "Error", message: String(error), componentStack: componentStack ?? undefined };
}

export function describeError(error: CanvasErrorInfo): string {
  const head = `${error.name}: ${error.message}`;
  const frames = (error.stack ?? "")
    .split("\n")
    .filter((line) => /^\s+at\s/.test(line))
    .slice(0, maxStackLines);
  return [head, ...frames].join("\n").slice(0, maxLength);
}
