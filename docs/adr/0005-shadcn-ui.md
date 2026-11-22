🇺🇸 English | [🇧🇷 Português](../pt-BR/adr/0005-shadcn-ui.md)

# ADR 0005: shadcn components on Paprika's closed theme

- **Status:** Accepted
- **Date:** 2026-11-22
- **Amends:** [ADR 0003: Tailwind CSS for the canvas app UI](0003-tailwind-css.md) (the constraints stay; this ADR adds how a component library lives under them)
- **Code:** [`apps/web/src/components/ui/`](../../apps/web/src/components/ui) (primitives), [`apps/web/src/styles.css`](../../apps/web/src/styles.css) (semantic aliases), [`apps/web/src/lib/cn.ts`](../../apps/web/src/lib/cn.ts), [`apps/web/components.json`](../../apps/web/components.json), gallery on `/ui` ([`apps/web/src/UiGallery.tsx`](../../apps/web/src/UiGallery.tsx))
- **Board:** [`docs/assets/boards/PAP-B-030`](../assets/boards/PAP-B-030) (drawn in Paprika before any dependency was installed)

## Context

The backlog row "Migrate the UI to shadcn components" was pulled forward from batch 4 to batch 3 (requested 2026-11-22). Nine UI tickets were already in the queue, and one ticket that migrated everything would have collided with all of them, so the migration is split into five: PAP-B-030 (this one: the foundation), then PAP-B-031 (overview and dialogs), PAP-B-032 (inspector), PAP-B-033 (shell, toolbar, layers, pages) and PAP-B-034 (team panel and agent roster). Tickets already in flight keep using `src/ui.ts`; they move onto the primitives after 030 lands.

Two things about ADR 0003 make this a decision and not a package install:

1. **No Preflight.** shadcn's components are written against Preflight, which resets margins, sets `border: 0 solid` on everything, makes `button` backgrounds transparent and `svg` blocks. Paprika cannot have it: the document under `.world` must render on browser defaults, exactly like the HTML export and `render_screenshot`.
2. **A closed theme.** The brand names in `styles.css` are already taken with Paprika's meaning: `text-muted` is a *text* color (#a6acc4) and `bg-accent` is the brand red. shadcn uses `muted` for a *surface* and `accent` for a hover surface. Overriding those names would repaint the whole app.

## Decision

1. **Copy the code, keep the theme.** Components are copied into `apps/web/src/components/ui/` (shadcn's open-code model, style `new-york`, MIT). Nothing renders through a component library at runtime beyond Radix primitives: no `node_modules` component, no build-time registry. Each copied file says where it came from, and `apps/web/components.json` records the source style for the ones still to come.
2. **Semantic names, namespaced `ui-`.** The shadcn names — `background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring` — are defined in the `@theme static` block of `styles.css` as `--color-ui-*`, each pointing at an existing brand token:

   | shadcn name | Paprika variable | dark (Estúdio noturno) | light mirror (`.ui-light`) |
   |---|---|---|---|
   | background / foreground | `--color-ui-background` / `-foreground` | `night` #141827 / `fg` #eef0f7 | #f2f3f8 / #141827 |
   | card / card-foreground | `--color-ui-card` / `-foreground` | `panel` #1e2336 / `fg` | #ffffff / #141827 |
   | popover / popover-foreground | `--color-ui-popover` / `-foreground` | `panel-2` #272d45 / `fg` | #ffffff / #141827 |
   | primary / -foreground / -hover | `--color-ui-primary*` | `accent-strong` #c8401f / white / `accent-dark` #a93220 | same |
   | secondary / -foreground / -hover | `--color-ui-secondary*` | `panel-2` / `fg` / #313a5c | `canvas` #e7e9f0 / #141827 / #d9deea |
   | muted / muted-foreground | `--color-ui-muted*` | `panel-2` / `muted` #a6acc4 | `canvas` / #5d6478 |
   | accent / accent-foreground | `--color-ui-accent*` | `panel-2` / `fg` | `canvas` / #141827 |
   | destructive / -foreground / -hover | `--color-ui-destructive*` | `danger` #cc2f50 / white / `danger-dark` #a31d3d — its own hue, not the accent, see *Danger color* | same fill and hover; the text token becomes #a8173a |
   | destructive as text | `--color-ui-destructive-text` | `danger-ink` #ff9fb2 (7.01:1 on `panel-2`) | #a8173a (7.37:1 on white) |
   | border / input | `--color-ui-border` / `-input` | `line` #2c3350 | #d3d7e3 / #c6cbd9 |
   | ring (focus) / link | `--color-ui-ring` / `-link` | `select` #4cc7d8 | #0b7183 |
   | overlay behind dialogs | `--color-ui-overlay` | rgb(9 12 22 / .66) | rgb(20 24 39 / .42) |

   The `ui-` prefix is what keeps ADR 0003 intact: `text-muted` and `bg-accent` go on meaning what they meant, and a primitive never reads them. One token has no upstream equivalent: **red as text needs its own token**. The fill red #c8401f carries white text at 4.99:1, but written as text on `panel-2` it is only 2.72:1, so menu items, validation messages and the alert icon read `--color-ui-destructive-text` (7.97:1 dark, 6.28:1 light).
3. **What the primitives take from Preflight is written into the primitives, not into a global rule.** The base layer of `styles.css` keeps exactly the rules ADR 0003 listed. Nothing global was added for shadcn, because a global `button { background: transparent }` or `* { border-color: … }` would repaint today's panels and reach into the canvas. Instead every primitive names its own background, border color and, where upstream relies on Preflight's reset, its own `m-0`: `DialogTitle`, `DialogDescription`, `AlertDialogTitle` and the others are `h2`/`p`, and without Preflight they carry the UA margins.
4. **Focus is an outline, not a ring.** The app already signals focus with `focus-visible:outline-2 focus-visible:outline-offset-2`. The primitives use the same, with `outline-ui-ring`. The ring utilities exist in the theme (`--color-ui-ring`) for the future, but the copied components were changed: in the night theme a 1px ring inside a red button is invisible, and Paprika's own controls already use the outline.
5. **Density is Paprika's, not shadcn's.** Root font 13px, `--spacing: 4px` (ADR 0003), so `Button` sizes are 24/28/32/36px (`xs/sm/default/lg`, plus `icon`) and fields are 28px tall — the numbers drawn on the board, and the sizes the current panels use. Upstream's `h-9` default would make the inspector a third taller. The `sm:`/`md:` responsive tweaks in the upstream files were dropped: the closed theme has one breakpoint (`wide`, 901px), and an unknown variant produces a class that compiles to nothing.
6. **Dark is the shipped theme; light is a token scope.** `.ui-light` redefines only the `--color-ui-*` variables, so a light panel can sit next to a dark one and the future "Theme modes (light/dark/compact)" backlog row has one place to grow from. The app itself does not switch themes in this ticket. Radix renders overlays in a portal on `<body>`, so the gallery passes the scope class onto the content element (`<DialogContent className="ui-light">`) — the theme travels with the portal.
7. **Animations come from `tw-animate-css`.** Importing it adds the enter/exit utilities (`animate-in`, `animate-out`, `fade-in-0`, `slide-in-from-top-2`, `animate-collapsible-down`) used by dialog, popover, menu, tooltip, select and collapsible, which also covers part of the backlog row "Better on-screen animations with tailwind-animate". Version 1.4.0 ships no reduced-motion guard, so `styles.css` adds one, scoped `:not(.world, .world *)` like the scrollbar rules: under `prefers-reduced-motion: reduce` the animation still runs at 0.01ms so Radix, which unmounts on `animationend`, still closes.
8. **`cn()` is `clsx` + `tailwind-merge` configured for the closed theme** (`src/lib/cn.ts`): `text-2xs/xs/sm/md/lg/xl/tile` are declared as font sizes so `text-md` is not read as a color, and `shadow-float`/`shadow-tag` as shadows so they replace upstream's `shadow-md`/`shadow-lg` instead of sitting next to them.
9. **Dependencies, pinned and licensed** (`apps/web/package.json`, exact versions, no range): `radix-ui` 1.8.1 (MIT, one package, imported as namespaces: `import { Dialog as DialogPrimitive } from "radix-ui"`), `class-variance-authority` 0.7.1 (Apache-2.0), `clsx` 2.1.1 (MIT), `tailwind-merge` 3.7.1 (MIT) as runtime dependencies, and `tw-animate-css` 1.4.0 (MIT) as a devDependency next to `tailwindcss`, since it is CSS consumed at build time. Nothing else was added.
10. **`components.json` records the layout, without a `@/` alias.** The repo imports with relative paths, and adding TS `paths` plus a Vite alias was not in this ticket. Consequence: `npx shadcn add <name>` will generate `@/lib/utils` imports that do not resolve here, so a future add is a manual copy with the same two rewrites we did by hand — `@/…` → relative, and the color names → `ui-*`.
11. **The proof surface is `ConnectionStatus`, and the gallery is the comparison tool.** Only `apps/web/src/ConnectionStatus.tsx` migrates in this ticket: it renders through `components/ui/status.tsx` (`StatusLiveRegion`, `statusDotVariants`) with `cn()` and the `ui-*` tokens, with the same DOM and the same text, so the existing accessibility assertion on the live region keeps covering it. The visible dot in the top bar stays where it is because `App.tsx` belongs to PAP-B-033; `statusDotVariants` is where it will land. `/ui` renders every primitive in both scopes, unlinked from the app and lazy-loaded, so the app chunk does not pay for the primitives before their screens migrate.

## What was changed relative to upstream

| upstream (new-york, 2026-11) | here | why |
|---|---|---|
| `bg-primary`, `text-muted-foreground`, `border-input` | `bg-ui-primary`, … | the brand names of ADR 0003 are taken with another meaning |
| `focus-visible:ring-1 ring-ring` | `focus-visible:outline-2 outline-offset-2 outline-ui-ring` | matches the app's existing focus; a 1px ring is invisible on a filled control |
| `h-9` controls, `px-4` | 28px fields, 24/28/32/36px buttons | density of the 13px root / 4px spacing scale, as drawn on the board |
| `bg-black/80` dialog scrim | `bg-ui-overlay` | the night brand, and the same value the board carries |
| `shadow-md`/`shadow-lg` | `shadow-float` | the theme defines two shadows; the board uses the floating one |
| `text-destructive` for red text | `text-ui-destructive-text` | 2.72:1 as text on the night surfaces, 7.97:1 with the ink |
| `AlertDialogAction` is always the primary button | `ConfirmDialog` swaps in the destructive classes through `className` | a delete confirmation must not look like the app's main call to action |
| `sm:`/`md:` variants | removed | the closed theme has one breakpoint (`wide`) |
| `React.forwardRef` + `displayName` | function components, `ref` as a prop (React 19), `data-slot` | the current upstream style; `data-slot` is also what the E2E suite selects |
| `import { X } from "@radix-ui/react-x"` | `import { X as XPrimitive } from "radix-ui"` | one MIT package instead of thirteen |
| `Close` label in the dialog | "Fechar", `aria-label` on the button | the app UI is pt-BR, and an icon-only control keeps its accessible name |

### Danger color and the confirmation pattern (PAP-B-026)

Paprika's accent is red, so the primitive's default mapping — `destructive` = `accent-strong` — made the delete
button and the main call to action **the same button**. The answer, drawn first and merged in PR #95, is a hue of
its own: the brand token `--color-danger` #cc2f50, `--color-danger-dark` #a31d3d for the hover and
`--color-danger-ink` #ff9fb2 as text (#a8173a in `.ui-light`), which the `--color-ui-destructive*` aliases point
at. Danger stays a filled red button; what separates it from the primary is the hue, not the treatment.

Measured by the accessibility suite, in both theme scopes: white on the fill is **5.13:1** at rest and
**7.50:1** on hover; written as text, the ink is 7.01:1 on the night surfaces and 7.37:1 on white. The test also
asserts the danger fill is not the primary's color.

The other candidate, drawn on the same sheet before #95 and rejected, borrowed the app's existing warning
language: the accent as a translucent wash with `accent-ink` as the text. It lost on both counts — a wash of the
accent reads as a quiet primary rather than as danger, and in the light scope its hover alpha had to be capped at
14% to keep the text above 4.5:1. With a hue of its own the button can stay filled and the hover can get
*darker*, which is what a danger action is expected to do.

Two rules say what receives the treatment:

1. **Danger marks what Ctrl+Z cannot bring back.** Deleting a workspace and removing a member from a team carry
   it. Deleting a node, a page or a selection is undoable and stays neutral — painting every delete red would
   make red mean nothing. Rotating an instance key and revoking invite links are irreversible too but were left
   alone: the ticket scoped `Team.tsx` to the remove-member button.
2. **An irreversible action gets a confirmation with the verb in it** — and a workspace delete also asks for the
   workspace's name typed. `ConfirmDialog` (`apps/web/src/ConfirmDialog.tsx`) composes the AlertDialog primitive:
   verb in the title, what is lost in the description, `Cancelar` first, the destructive action last, and the
   error inside the dialog, because the page banner sits behind the scrim. Radix opens an AlertDialog with the
   focus on **cancel**, which is the safe default.

Still missing, and tracked in the backlog: the canvas toast naming what an agent deleted or which workspace an
agent switched to. It reads the summary `delete_workspace` returns, which is PAP-B-015 (PR #97); the notice
itself has no ticket yet.

## Verification

- `pnpm check` (build with the WASM renderer, typecheck, fixtures, TS and Go tests, API and E2E suites against the Go server).
- `packages/e2e/test/e2e/a11y.e2e.test.ts`, PAP-B-026: the workspace-delete confirmation is asserted as an `alertdialog` whose buttons come in the order `Cancelar` then `Excluir`, whose action carries the destructive classes, whose focus starts inside it and returns to the trigger on Esc, and whose Esc leaves the workspace on the list; the destructive button is measured at 4.5:1 or better in both theme scopes, at rest and on hover (the wash is translucent, so the test composes it over the panel behind it before measuring).
- `packages/e2e/test/e2e/canvas.e2e.test.ts`: the overview flow reads that confirmation by role `alertdialog` instead of `dialog`, and types the workspace name where it previously clicked straight through; the assertions themselves (Cancel keeps it, Excluir removes it, deleting the active workspace moves the canvas and the agents) are unchanged.
- `packages/e2e/test/e2e/a11y.e2e.test.ts`, new block "galeria de primitivas (/ui)": the dialog traps focus and eight Tab presses stay inside, Esc returns focus to the trigger; the alert dialog opens with focus inside and its `ui-light` scope travels with the portal; the tooltip opens from the keyboard, not only on hover; the menu opens with Enter, names its items (`menuitem`, including the destructive one), moves with arrows and closes with Esc; the primary button passes 4.5:1 in both theme scopes; and under `prefers-reduced-motion: reduce` the chrome animations are neutralized while a node inside `.world` keeps `transition-duration: 0s` and the `.world` container keeps `line-height: normal`.
- Isolation of the canvas: the canvas E2E suite and the WASM suite (which compares the DOM renderer with the Rust one, pixel by pixel) are unchanged and pass. On top of that, the same canvas page (`/w/<id>` over the Go server, 1440×900, Chromium) was screenshotted on `origin/main` and on this branch: **0 of 1.296.000 pixels differ**. Nothing in this ticket touches the DOM under `.world` — every new rule is either a utility class on a primitive or a `:not(.world, .world *)` scope.
- Bundle, `vite build` on `origin/main` and on this branch: CSS 29.02 kB → 45.94 kB (6.59 kB → 9.12 kB gzip); the app entry JS 554.31 kB → 585.85 kB (170.30 kB → 181.03 kB gzip), which is `cn()` plus the migrated `ConnectionStatus`; the primitives and Radix sit in the lazy gallery chunk, 179.69 kB (52.46 kB gzip), loaded only on `/ui`. They move into the app chunk as PAP-B-031…034 migrate each screen.
- Board before code: five frames on the `Interfaces` page of the Paprika workspace (controls and overlays, light and dark, plus the token map), drawn over MCP at `127.0.0.1:4777` before `pnpm add` ran, with `lint_design` at 0 errors, exported to [`docs/assets/boards/PAP-B-030`](../assets/boards/PAP-B-030).

## Consequences

- The theme stays closed and Preflight stays out; the primitives carry their own resets.
- Two names coexist for a while: `ui.ts` (until PAP-B-031…034 delete each unused entry) and `components/ui/`. `AGENTS.md` says which one new UI code uses. PAP-B-033 freed `ui.iconBtn` and moved the shell, toolbar (`ToggleGroup`+`Tooltip`), layers, pages, `InlineName`, `PanelResizer` and the top-bar status dot onto the primitives; Inspector (PAP-B-032) still reads `ui.ts`.
- PAP-B-051: HTML `title` attributes in `apps/web` are gone; use `Hint` (or `Tooltip`+`TooltipTrigger`+`TooltipContent`) from `components/ui/tooltip.tsx`. `TooltipProvider` lives once in `main.tsx`. Icon-only buttons keep `aria-label`; wrap a disabled control in a focusable `span` when it still needs a tip.
- A light theme now exists at the token level only; the app does not offer it yet.
- `tw-animate-css` is the animation source, so the "tailwind-animate" backlog row is partly covered; the row stays open until the app's own animations use it.
- Adding a component later is a copy plus two mechanical rewrites (paths and color names), because there is no `@/` alias; that is recorded here rather than paid for with a new config surface.
