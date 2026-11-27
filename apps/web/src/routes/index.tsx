import { createFileRoute } from "@tanstack/react-router";
import { OverviewContainer } from "@/overview/overview-container";

export const Route = createFileRoute("/")({
  component: OverviewContainer,
});
