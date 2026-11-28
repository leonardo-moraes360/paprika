import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceRoute } from "@/editor/workspace-route";

export const Route = createFileRoute("/w/$workspaceId")({
  component: Workspace,
});

function Workspace() {
  const { workspaceId } = Route.useParams();
  return <WorkspaceRoute id={workspaceId} />;
}
