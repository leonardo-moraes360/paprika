import { useState, type ComponentType } from "react";
import { ThemeSwitch } from "@/components/ui/theme-switch";
import { readThemePreference, setThemePreference, type ThemePreference } from "@/lib/theme";
import type { GalleryMeta } from "./_kit";

type SectionModule = {
  meta: GalleryMeta;
  default: ComponentType;
};

const modules = import.meta.glob<SectionModule>(["./*.tsx", "!./_*.tsx"], { eager: true });

const sections = Object.entries(modules)
  .map(([path, module]) => ({ path, Component: module.default, ...module.meta }))
  .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

const themeLabels = { label: "Theme", system: "System", light: "Light", dark: "Dark" };

export function Gallery() {
  const [theme, setTheme] = useState<ThemePreference>(readThemePreference);
  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-3">
          <h1 className="text-lg font-semibold tracking-tight">Components</h1>
          <nav aria-label="Sections" className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            {sections.map((s) => (
              <a key={s.path} href={`#${s.path.slice(2, -4)}`} className="rounded-sm hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select">
                {s.title}
              </a>
            ))}
          </nav>
          <ThemeSwitch
            value={theme}
            onValueChange={(next) => {
              setTheme(next);
              setThemePreference(next);
            }}
            labels={themeLabels}
          />
        </div>
      </header>
      <main className="mx-auto flex max-w-6xl flex-col gap-12 px-6 py-10">
        {sections.map(({ path, Component }) => (
          <Component key={path} />
        ))}
      </main>
    </div>
  );
}
