export const dialogBackdropClasses =
  "fixed inset-0 bg-overlay transition-opacity duration-200 motion-reduce:transition-none data-ending-style:opacity-0 data-starting-style:opacity-0";

export const dialogSurfaceClasses =
  "fixed inset-0 m-auto h-fit max-h-[calc(100dvh-2rem)] w-110 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-dialog border border-line bg-popover p-6 text-fg shadow-dialog transition-[opacity,scale] duration-200 motion-reduce:transition-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 forced-colors:border-2";

export const popupBase = "rounded-popup border border-line bg-popover text-fg shadow-popover outline-none";

export const popupSurface = `z-50 flex min-w-(--anchor-width) flex-col gap-0.5 p-2 ${popupBase}`;

export const popupItem =
  "flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-base text-fg outline-none select-none data-highlighted:bg-surface data-disabled:cursor-not-allowed data-disabled:text-muted forced-colors:data-highlighted:bg-[Highlight] forced-colors:data-highlighted:text-[HighlightText] forced-colors:data-disabled:text-[GrayText]";
