import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./api";
import { App } from "./App";
import { ErrorBoundary } from "./ErrorBoundary";
import { TooltipProvider } from "./components/ui/tooltip";
import { LocaleProvider, t } from "./i18n";
import { parseRoute } from "./route";
import "./styles.css";

const UiGallery = lazy(() => import("./UiGallery").then((m) => ({ default: m.UiGallery })));

const route = parseRoute(location.pathname);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LocaleProvider>
        <TooltipProvider delayDuration={400}>
          {route.view === "gallery" ? (
            <Suspense fallback={<p className="p-3 text-muted">{t().galleryLoading}</p>}>
              <UiGallery />
            </Suspense>
          ) : (
            <ErrorBoundary>
              <App />
            </ErrorBoundary>
          )}
        </TooltipProvider>
      </LocaleProvider>
    </QueryClientProvider>
  </StrictMode>,
);
