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
  /** Inline rename field (layers, pages, frame labels). */
  renameInput: "min-w-0 rounded-[3px] border border-select bg-panel px-1 py-0 text-fg outline-none",
};

/** Top bar shared by the overview and the canvas. */
export const bar = {
  topbar: "flex items-center justify-between gap-4 border-b border-line bg-panel px-3",
  brand: "flex min-w-0 items-center gap-2",
  logo: "inline-block size-[22px] flex-none",
  status: "flex items-center gap-2 whitespace-nowrap",
  /** Status text next to the dot: hidden on narrow screens. */
  statusText: "text-muted max-wide:hidden",
  dot: (on: boolean) => cx("size-2 rounded-full", on ? "bg-leaf" : "bg-accent"),
};
