import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "@/i18n";
import appCss from "@/styles.css?url";
import { ClientOnly, HeadContent, Link, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";

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
        <Outlet />
      </ClientOnly>
    </RootDocument>
  );
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-start justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t("notFound.title")}</h1>
      <Link to="/" className="underline underline-offset-4">
        {t("notFound.home")}
      </Link>
    </main>
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
