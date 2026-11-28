import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderRegions, serve } from "@/test/collab-harness";
import { toneFor } from "@/adapters/agents";
import { toneDot } from "@/components/ui/agent-tone";
import { Notice } from "./notice";

const op = (actor: string, kind: string, workspaceId: string, detail = {}) => ({ type: "workspaceOp" as const, op: { at: 1, actor, op: kind, workspaceId, workspaceName: "Old project", detail } });

describe("Notice region", () => {
  it("shows what an agent did to a workspace, with the counts of a deletion, and goes to the overview", async () => {
    const view = await renderRegions({ regions: [["notice", <Notice key="n" />]], router: true });
    serve(view.rig, view.doc);
    expect(screen.queryByText("claude")).toBeNull();
    view.rig.push(op("agent:claude", "delete", "w-9", { nodes: 12, pages: 2, historyEntries: 40 }));
    const notice = await screen.findByText("claude");
    const card = notice.closest("[role=status]") as HTMLElement;
    expect(within(card).getByText(/deleted/i)).toBeInTheDocument();
    expect(within(card).getByText(/12/)).toBeInTheDocument();
    // The tone is the stable pick from the name, the same one the overview shows for this agent.
    expect(card.innerHTML).toContain(toneDot[toneFor("agent:claude", {})]);
    await userEvent.setup().click(within(card).getByRole("button", { name: /workspaces/i }));
    await waitFor(() => expect(view.rig.client.store.state.workspaceNotice).toBeNull());
    await waitFor(() => expect(screen.queryByText("claude")).toBeNull());
  });

  it("ignores what a person did, and the creation of a workspace, and can be dismissed", async () => {
    const view = await renderRegions({ regions: [["notice", <Notice key="n" />]], router: true });
    serve(view.rig, view.doc);
    view.rig.push(op("user", "delete", "w-9"), op("agent:claude", "create", "w-8"));
    expect(screen.queryByText("claude")).toBeNull();
    view.rig.push(op("agent:codex", "open", "w-7"));
    expect(await screen.findByText("codex")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: /dismiss/i }));
    await waitFor(() => expect(screen.queryByText("codex")).toBeNull());
  });
});
