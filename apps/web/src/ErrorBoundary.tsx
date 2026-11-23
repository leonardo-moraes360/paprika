import { Component, type CSSProperties, type ReactNode } from "react";
import { Button } from "./components/ui/button";
import { getLocale, t } from "./i18n";
import { cn } from "./lib/cn";
import { bar } from "./ui";
import { liveStore } from "./useDocument";

const recoveryCopy = {
  en: {
    title: "The canvas stopped",
    body: "The toolbar and panels stay. Reload fetches the document again.",
    reload: "Reload",
  },
  "pt-BR": {
    title: "O canvas parou",
    body: "A toolbar e os painéis continuam. Recarregar busca o documento de novo.",
    reload: "Recarregar",
  },
} as const;

const shell =
  "grid h-full grid-cols-[var(--left-w,240px)_minmax(0,1fr)_var(--right-w,280px)] grid-rows-[44px_1fr] [grid-template-areas:'top_top_top'_'left_center_right'] max-wide:grid-cols-1 max-wide:grid-rows-[44px_1fr_220px] max-wide:[grid-template-areas:'top'_'center'_'right']";
const heading = "mx-0 mt-0 mb-1 text-xs font-bold uppercase tracking-[0.06em] text-ui-muted-foreground";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  render() {
    if (!this.state.error) return this.props.children;
    const m = t();
    const copy = recoveryCopy[getLocale()];
    const name = liveStore.getState().doc?.name ?? "";
    const detail = (this.state.error.message || this.state.error.name).slice(0, 400);
    return (
      <div className={shell} style={{ "--left-w": "240px", "--right-w": "280px" } as CSSProperties}>
        <header className={cn(bar.topbar, "border-ui-border bg-ui-card [grid-area:top]")}>
          <div className={bar.brand}>
            <a className="flex items-center gap-2 rounded-md text-inherit no-underline" href="/" aria-label={m.allWorkspaces}>
              <img className={bar.logo} src="/icon.svg" alt="" />
              <strong>Paprika</strong>
            </a>
            <span className="text-ui-border" aria-hidden>
              /
            </span>
            <h1 className="doc-name m-0 truncate text-ui-muted-foreground [font:inherit]">{name}</h1>
          </div>
        </header>
        <aside aria-label={m.pagesAndLayers} className="overflow-auto border-r border-ui-border bg-ui-card [grid-area:left] max-wide:hidden">
          <div className="border-b border-ui-border p-2">
            <h2 className={heading}>{m.pages}</h2>
          </div>
          <div className="p-2">
            <h2 className={heading}>{m.layers}</h2>
          </div>
        </aside>
        <main className="relative overflow-hidden [grid-area:center]">
          <nav
            aria-label={m.tools}
            data-toolbar-dock="top"
            className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 gap-0.5 rounded-xl border border-ui-border bg-ui-card p-1 shadow-float"
          >
            {[m.toolSelect, m.toolRect, m.toolText].map((label) => (
              <span key={label} className="px-2 py-1 text-xs font-semibold text-ui-muted-foreground">
                {label}
              </span>
            ))}
          </nav>
          <div
            role="alert"
            data-testid="canvas-error"
            className="absolute top-1/2 left-1/2 w-[min(420px,calc(100%-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-ui-border bg-ui-card p-5 shadow-float"
          >
            <h2 className="m-0 text-md font-bold text-ui-foreground">{copy.title}</h2>
            <p className="mt-2 mb-3 text-sm text-ui-muted-foreground">{copy.body}</p>
            <p className="m-0 rounded-md bg-ui-muted px-2 py-1.5 font-mono text-xs break-words text-ui-muted-foreground">{detail}</p>
            <Button type="button" className="mt-3" data-testid="canvas-error-reload" onClick={() => location.reload()}>
              {copy.reload}
            </Button>
          </div>
        </main>
        <aside aria-label={m.properties} className="overflow-auto border-l border-ui-border bg-ui-card [grid-area:right] max-wide:border-t max-wide:border-l-0">
          <div className="p-3">
            <h2 className={heading}>{m.inspectorTab}</h2>
            <p className="m-0 text-sm text-ui-muted-foreground">{m.noSelection}</p>
          </div>
        </aside>
      </div>
    );
  }
}
