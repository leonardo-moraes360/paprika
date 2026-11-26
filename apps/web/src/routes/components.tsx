import { createFileRoute, lazyRouteComponent, notFound } from "@tanstack/react-router";

export const Route = createFileRoute("/components")({
  beforeLoad: () => {
    if (!(import.meta.env.DEV || import.meta.env.VITE_GALLERY === "1")) throw notFound();
  },
  component:
    import.meta.env.DEV || import.meta.env.VITE_GALLERY === "1"
      ? lazyRouteComponent(() => import("@/gallery/_gallery"), "Gallery")
      : () => null,
});
