import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select"

type ClassName<S> = string | ((state: S) => string | undefined) | undefined

export function slot<S>(base: string, className: ClassName<S>) {
  return (state: S) => cn(base, typeof className === "function" ? className(state) : className)
}
