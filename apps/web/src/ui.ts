/**
 * Tailwind class lists still shared by panels that have not fully migrated (Layers, Pages, Team).
 * Inspector fields/sections/actions (PAP-B-032) use `components/ui/` + `cn` instead. ADR 0005.
 */

/** Joins class names, skipping falsy ones: `cx("a", on && "b")`. */
export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

export const ui = {
  section: "flex flex-col gap-1 p-2",
  h2: "mx-0 mt-0 mb-1 text-xs font-bold uppercase tracking-[0.06em] text-muted [&_code]:normal-case [&_code]:tracking-normal",
  h3: "mx-0 mt-4 mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted",
  muted: "text-muted",
  grid: "grid gap-1",
  grid2: "grid grid-cols-2 gap-1",
  /** Small icon button (Lucide icons: plus, x…). */
  iconBtn: "inline-flex cursor-pointer items-center justify-center rounded-[3px] border-0 bg-transparent px-1 py-0.5 text-md leading-none text-muted hover:bg-panel-2 hover:text-fg",
  /** Merge over `iconBtn` or a secondary button (with `cn`) for the ones that delete or remove: the danger ink at rest and on hover. */
  dangerBtn: "text-ui-destructive-text hover:text-ui-destructive-text",
  actions:
    "mx-0 my-2 flex gap-1.5 [&_button]:cursor-pointer [&_button]:rounded-sm [&_button]:border [&_button]:border-line [&_button]:bg-panel-2 [&_button]:px-2.5 [&_button]:py-1 [&_button]:text-fg [&_button:hover]:border-select",
  renameInput: "min-w-0 rounded-[3px] border border-select bg-panel px-1 py-0 text-fg outline-none",
  activityList: "m-0 grid list-none gap-1 p-0",
  activityRow: "grid min-w-0 grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md bg-panel-2 px-1.5 py-1 text-xs text-fg",
  activityBatch: "outline outline-1 outline-select",
  activityDot: "size-2 shrink-0 rounded-full",
  activityActor: "max-w-[4.5rem] truncate font-semibold text-fg",
  activityLabel: "min-w-0 truncate text-muted",
  activityTime: "shrink-0 text-muted tabular-nums",
  activityMarker: "flex items-center gap-1.5 py-0.5 text-xs font-semibold text-select",
  activityMarkerLine: "h-px min-w-2 flex-1 bg-select",
  colorSwatch:
    "size-7 shrink-0 cursor-pointer rounded-md border border-line bg-transparent p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select",
  colorPopover: "border-line bg-panel-2 text-fg shadow-float",
  colorSv:
    "relative h-[140px] w-full cursor-crosshair touch-none rounded-md border border-line outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select",
  colorSlider:
    "relative h-3 w-full cursor-pointer touch-none rounded-full border border-line outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select",
  colorAlpha: "bg-[length:8px_8px]",
  colorCursor:
    "pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-night bg-white",
  colorThumb:
    "pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-tag",
  colorChannel:
    "grid gap-0.5 text-2xs text-muted [&_input]:h-7 [&_input]:rounded-md [&_input]:border [&_input]:border-line [&_input]:bg-panel [&_input]:px-1.5 [&_input]:text-sm [&_input]:text-fg [&_input]:outline-none [&_input:focus-visible]:border-select",
  colorToken:
    "flex w-12 cursor-pointer flex-col items-center gap-1 border-0 bg-transparent p-0 text-2xs text-muted outline-none hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select",
  colorTokenSwatch: "size-[22px] rounded-md border border-line",
  colorRecent:
    "size-5 cursor-pointer rounded-md border border-line p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select",
  link: "cursor-pointer border-0 bg-transparent p-0 text-select underline",
};

/** Top bar shared by the overview (canvas shell uses the same tokens inline — PAP-B-033). */
export const bar = {
  topbar: "flex items-center justify-between gap-4 border-b border-line bg-panel px-3",
  brand: "flex min-w-0 items-center gap-2",
  logo: "inline-block size-[22px] flex-none",
  status: "flex items-center gap-2 whitespace-nowrap",
  statusText: "text-muted max-wide:hidden",
  dot: (on: boolean) => cx("size-2 rounded-full", on ? "bg-leaf" : "bg-accent"),
};
