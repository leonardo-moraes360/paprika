🇺🇸 English | [🇧🇷 Português](../../pt-BR/adr/0003-tailwind-css.md)

# ADR 0003: Tailwind CSS for the canvas app UI

- **Status:** Accepted, amended by ADR 0005
- **Date:** 2026-11-21 (amended 2026-11-22)
- **Amended by:** [ADR 0005: shadcn components on Paprika's closed theme](0005-shadcn-ui.md) — the constraints below stay; that ADR adds how a component library lives under them.
- **Code:** [`web-legacy/src/styles.css`](../../../web-legacy/src/styles.css) (theme), [`web-legacy/src/ui.ts`](../../../web-legacy/src/ui.ts) (shared class lists), [`web-legacy/vite.config.ts`](../../../web-legacy/vite.config.ts)

## Context

The app UI (`web-legacy`: workspace overview, top bar, toolbar, layer and page panels, inspector, resizable
panels, selection overlays, agent cursors) was styled by two hand-written stylesheets, `styles.css` (920 lines)
and `AgentCursors.css`, with global class names. The maintainer asked to replace that with Tailwind CSS at its
latest version, keeping the current look.

One constraint shapes the setup: the canvas paints the **user's document** with the inline styles from
`nodeStyle`, and that must look the same as the HTML export and `render_screenshot`, which run on plain browser
defaults (architecture decision 4). The app's CSS must not leak into the nodes under `.world`.

## Decision

1. **Tailwind CSS v4 (4.3.5) through `@tailwindcss/vite`.** No PostCSS or `tailwind.config.js`: the theme lives
   in CSS (`@theme`), next to the brand tokens it encodes.
2. **No Preflight.** `styles.css` imports only `tailwindcss/theme.css` and `tailwindcss/utilities.css`, plus the
   handful of base rules the app always had (root font and colors, `box-sizing: border-box`, form controls
   inheriting the font). Preflight would change browser defaults inside the canvas too (`line-height: 1.5` on
   `html`, `max-width: 100%` on images, `display: block` on SVG, zero margins on headings and lists), so a
   document would render differently in the canvas than in the export and the screenshot. Without it, the
   utilities sit on the same defaults the old stylesheet was written against.
3. **A closed theme.** `--color-*`, `--text-*`, `--radius-*` and `--breakpoint-*` are reset and redefined from
   the "Estúdio noturno" brand (docs/en-US/brand): `bg-panel`, `text-muted`, `border-line`, `bg-accent-soft`,
   `text-select`… Tailwind's default palette is not available, so a stray `bg-blue-500` does not compile. The
   root font size stays 13px, so `--spacing` is `4px` instead of `0.25rem` (the usual scale: `p-3` = 12px).
   The breakpoint `wide` (901px) replaces the old `max-width: 900px` query (`max-wide:hidden`). The theme is
   `static`, so SVG overlays and agent colors can read `var(--color-select)` and friends directly.
4. **Utilities in the components; shared lists in `ui.ts`.** Pieces that repeat (panel section, `h2`/`h3`,
   field, secondary buttons, the top bar) are exported class strings, composed with `cx()`. Per-item values
   (panel widths, a workspace tile's hue, an agent's color) stay as CSS variables or inline styles, read by
   arbitrary values such as `bg-(--agent)`.
5. **Test hooks stay as plain class names.** The E2E suite selects `.workspace-card.is-active`,
   `.layer.is-selected`, `.page.is-active`, `.agent-pill`, `.world`, `aside.left`… Those names are kept next to
   the utilities and carry no styles.

## Verification

18 screenshots of the same scripted session (overview desktop and mobile, card hover, canvas, selection,
multi-selection, layer hover, panel resizer hover and drag, active tool, agent drawing a diagram with cursor
and roster, review issues, inline rename, shape text editing, pages, new-workspace form, mobile canvas, the
bezier example) were taken before and after the change against the Go server: all 18 are pixel-identical. The
canvas E2E suite (`packages/e2e`) passes against the Go server.

## Consequences

- Styles live next to the markup; there is no global stylesheet to keep in sync with class names.
- The CSS bundle grew from 14.7 kB to 24.4 kB (5.6 kB gzip), mostly theme variables and `@property` rules.
- Hover styles are wrapped in `@media (hover: hover)` by Tailwind, so they no longer stick after a tap on touch
  screens (the only intended behavior change; desktop rendering is identical).
- Contributors use the theme names, not Tailwind's default palette or the old `--bg`/`--panel` variables.
