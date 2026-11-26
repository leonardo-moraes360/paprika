import { createFileRoute } from "@tanstack/react-router";
import { Gallery } from "@/gallery/_gallery";

export const Route = createFileRoute("/components")({
  component: Gallery,
});
