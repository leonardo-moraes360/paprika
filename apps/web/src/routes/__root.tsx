import { useEffect, type ReactNode } from "react";
import { Notifications } from "@/components/notifications";
import { LiveProvider } from "@/data/live";
import { PerfProvider } from "@/perf";
import { useTranslation } from "react-i18next";
import "@/i18n";
import { themeInitScript } from "@/lib/theme";
import appCss from "@/styles.css?url";
import type { QueryClient } from "@tanstack/react-query";
import { ClientOnly, HeadContent, Link, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Paprika" },
    ],
    scripts: [{ children: themeInitScript }],
    links: [{ rel: "stylesheet", href: appCss }, { rel: "stylesheet", href: "/fonts/inter.css" }, { rel: "icon", type: "image/svg+xml", href: "/icon.svg" }],
  }),
  component: RootComponent,
  notFoundComponent: NotFound,
});

function RootComponent() {
  const { i18n } = useTranslation();
  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? "en";
  }, [i18n.resolvedLanguage]);
  return (
    <RootDocument>
      <ClientOnly fallback={null}>
        <PerfProvider>
          <LiveProvider>
            <Outlet />
            <Notifications />
          </LiveProvider>
        </PerfProvider>
      </ClientOnly>
    </RootDocument>
  );
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-start justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t("notFound.title")}</h1>
      <Link to="/" className="underline underline-offset-4 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-select">
        {t("notFound.home")}
      </Link>
    </main>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
