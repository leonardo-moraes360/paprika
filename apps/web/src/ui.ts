/**
 * Tailwind class lists still shared by panels that have not migrated (Inspector, Team, Overview
 * rename). Shell/toolbar/layers/pages (PAP-B-033) use `components/ui/` + `cn` instead. ADR 0005.
 */

/** Joins class names, skipping falsy ones: `cx("a", on && "b")`. */
export const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

const control = "[&_:is(input,select,textarea)]:w-full [&_:is(input,select,textarea)]:min-w-0 [&_:is(input,select,textarea)]:border-0 [&_:is(input,select,textarea)]:outline-none";

export const ui = {
  section: "flex flex-col gap-1 p-2",
  h2: "mx-0 mt-0 mb-1 text-xs font-bold uppercase tracking-[0.06em] text-muted [&_code]:normal-case [&_code]:tracking-normal",
  h3: "mx-0 mt-4 mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted",
  inspectorSection: "min-w-0 border-t border-line pt-1 first:border-t-0 first:pt-0",
  inspectorSectionTrigger:
    "flex h-6 w-full min-w-0 cursor-pointer items-center gap-1 rounded-sm border-0 bg-transparent px-0.5 text-xs font-semibold text-muted outline-none hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select",
  inspectorSectionBody: "grid gap-1 pb-1",
  muted: "text-muted",
  grid: "grid gap-1",
  grid2: "grid grid-cols-2 gap-1",
  field: (wide = false) =>
    cx(
      "grid min-w-0 items-center gap-1.5 rounded-md border border-transparent bg-panel-2 focus-within:border-accent",
      "[&>span]:whitespace-nowrap [&>span]:text-xs [&>span]:text-muted",
      control,
      "[&_:is(input,textarea)]:bg-transparent [&_select]:bg-panel-2 [&_:is(input,select)]:h-7 [&_textarea]:resize-y",
      wide ? "grid-cols-1 p-1.5" : "grid-cols-[auto_1fr] px-1.5",
    ),
  actions:
    "mx-0 my-2 flex gap-1.5 [&_button]:cursor-pointer [&_button]:rounded-sm [&_button]:border [&_button]:border-line [&_button]:bg-panel-2 [&_button]:px-2.5 [&_button]:py-1 [&_button]:text-fg [&_button:hover]:border-select",
  link: "cursor-pointer border-0 bg-transparent p-0 text-select underline",
  dangerBtn: "text-ui-destructive-text hover:text-ui-destructive-text",
  renameInput: "min-w-0 rounded-[3px] border border-select bg-panel px-1 py-0 text-fg outline-none",
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
