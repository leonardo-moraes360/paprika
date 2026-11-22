import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./api";
import { App } from "./App";
import { parseRoute } from "./route";
import "./styles.css";

/**
 * `/ui` monta a galeria de primitivas (superfície interna de QA, ADR 0005); o resto é o app. A galeria é
 * carregada sob demanda: sem isso, os primitivos Radix entrariam no chunk inicial do canvas antes de
 * PAP-B-031…034 migrarem cada tela.
 */
const UiGallery = lazy(() => import("./UiGallery").then((m) => ({ default: m.UiGallery })));

const route = parseRoute(location.pathname);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {route.view === "gallery" ? (
        <Suspense fallback={<p className="p-3 text-muted">Galeria…</p>}>
          <UiGallery />
        </Suspense>
      ) : (
        <App />
      )}
    </QueryClientProvider>
  </StrictMode>,
);
