export const fieldBoxSelf =
  "rounded-md border border-field bg-field-bg text-fg transition-colors motion-reduce:transition-none placeholder:text-muted focus-visible:border-[1.5px] focus-visible:border-select focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select aria-invalid:border-[1.5px] aria-invalid:border-red-ink aria-invalid:outline-2 aria-invalid:outline-offset-2 aria-invalid:outline-red-ink data-disabled:cursor-not-allowed data-disabled:border-line data-disabled:bg-surface data-disabled:text-muted forced-colors:focus-visible:border-2 forced-colors:focus-visible:border-[Highlight] forced-colors:aria-invalid:border-2 forced-colors:aria-invalid:border-[Mark] forced-colors:data-disabled:border-[GrayText] forced-colors:data-disabled:text-[GrayText]";

export const fieldBoxWrapper =
  "rounded-md border border-field bg-field-bg text-fg transition-colors motion-reduce:transition-none focus-visible:border-[1.5px] focus-visible:border-select focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select has-[input:focus-visible]:border-[1.5px] has-[input:focus-visible]:border-select has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-select has-[textarea:focus-visible]:border-[1.5px] has-[textarea:focus-visible]:border-select has-[textarea:focus-visible]:outline-2 has-[textarea:focus-visible]:outline-offset-2 has-[textarea:focus-visible]:outline-select has-[[aria-invalid=true]]:border-[1.5px] has-[[aria-invalid=true]]:border-red-ink has-[[aria-invalid=true]]:outline-2 has-[[aria-invalid=true]]:outline-offset-2 has-[[aria-invalid=true]]:outline-red-ink has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:border-line has-[[data-disabled]]:bg-surface has-[[data-disabled]]:text-muted forced-colors:focus-visible:border-2 forced-colors:focus-visible:border-[Highlight] forced-colors:has-[input:focus-visible]:border-2 forced-colors:has-[input:focus-visible]:border-[Highlight] forced-colors:has-[textarea:focus-visible]:border-2 forced-colors:has-[textarea:focus-visible]:border-[Highlight] forced-colors:has-[[aria-invalid=true]]:border-2 forced-colors:has-[[aria-invalid=true]]:border-[Mark] forced-colors:has-[[data-disabled]]:border-[GrayText] forced-colors:has-[[data-disabled]]:text-[GrayText]";

export const bareInput =
  "min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-base text-inherit outline-none placeholder:text-muted data-disabled:cursor-not-allowed";

export const popupSurface =
  "z-50 flex min-w-(--anchor-width) flex-col gap-0.5 rounded-lg border border-line bg-popover p-2 text-fg shadow-popover outline-none";

export const popupItem =
  "flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-base text-fg outline-none select-none data-highlighted:bg-surface data-disabled:cursor-not-allowed data-disabled:text-muted forced-colors:data-highlighted:bg-[Highlight] forced-colors:data-highlighted:text-[HighlightText] forced-colors:data-disabled:text-[GrayText]";

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type BoxDataProps = { [K in `data-${string}`]?: string };
