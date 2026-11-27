import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Tailwind 4: `outline-none` zeroes `--tw-outline-style` and `outline-2` only sets the width, so a ring on a control that also has `outline-none` needs `outline-solid` back. */
export const focusRing = "focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-select"

type ClassName<S> = string | ((state: S) => string | undefined) | undefined

export function slot<S>(base: string, className: ClassName<S>) {
  return (state: S) => cn(base, typeof className === "function" ? className(state) : className)
}
