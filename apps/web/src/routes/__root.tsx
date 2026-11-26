import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "@/i18n";
import { useHydrated } from "@/lib/use-hydrated";
import appCss from "@/styles.css?url";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Paprika" },
    ],
    links: [{ rel: "stylesheet", href: appCss }, { rel: "icon", type: "image/svg+xml", href: "/icon.svg" }],
  }),
  component: RootComponent,
});

function RootComponent() {
  const { i18n } = useTranslation();
  const hydrated = useHydrated();
  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? "en";
  }, [i18n.resolvedLanguage]);
  return (
    <RootDocument>
      {hydrated ? <Outlet /> : null}
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
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
