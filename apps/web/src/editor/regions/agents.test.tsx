import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderRegions, serve } from "@/test/collab-harness";
import { AgentsRoster, useAgentsHeader } from "./agents";

const presence = (agent: string, actor: string, tool: string, nodes: string[] = [], idle = 0) => ({ type: "presence" as const, agent, actor, tool, nodes, idle });

function HeaderProbe() {
  const { agents, renderAgents } = useAgentsHeader();
  return <div data-testid="header-agents">{agents > 0 ? renderAgents() : "none"}</div>;
}

describe("Agents region", () => {
  it("shows nothing until an agent is present, then the roster trigger with the active count", async () => {
    const view = await renderRegions({ regions: [["header", <HeaderProbe key="h" />]] });
    serve(view.rig, view.doc);
    expect(screen.getByTestId("header-agents")).toHaveTextContent("none");
    view.rig.push(presence("s:1", "agent:claude", "update_nodes", ["n3"]), presence("s:2", "agent:codex", "get_nodes"));
    expect(await screen.findByRole("button", { name: /2 active/i })).toBeInTheDocument();
  });

  it("lists the agents by name (numbered when one client has two sessions), activity from the tool, and the page", async () => {
    const view = await renderRegions({ regions: [["agents", <AgentsRoster key="a" />]], initial: { dialogs: { history: false, pins: false, export: false, import: false, agents: true } } });
    serve(view.rig, view.doc);
    view.rig.push(presence("s:1", "agent:claude", "update_nodes", ["n3"]), presence("s:2", "agent:claude", "get_nodes", ["n4"]), presence("s:3", "agent:codex", "lint_design", []));
    const roster = await screen.findByRole("dialog");
    expect(within(roster).getByText("claude")).toBeInTheDocument();
    expect(within(roster).getByText("claude 2")).toBeInTheDocument();
    expect(within(roster).getByText("codex")).toBeInTheDocument();
    expect(within(roster).getAllByText("Page 1").length).toBe(2);
    // The tone belongs to the client: both claude sessions share it, codex has another.
    const tones = view.handle.current!.state.agentTones;
    expect(Object.keys(tones)).toEqual(["agent:claude", "agent:codex"]);
    expect(tones["agent:claude"]).not.toBe(tones["agent:codex"]);
  });

  it("'focus' goes to the agent's page and selects the nodes it touches that exist", async () => {
    const view = await renderRegions({ regions: [["agents", <AgentsRoster key="a" />]], initial: { dialogs: { history: false, pins: false, export: false, import: false, agents: true }, pageId: "other", selection: ["n9"] } });
    serve(view.rig, view.doc);
    view.rig.push(presence("s:1", "agent:claude", "update_nodes", ["gone", "n3", "n4"]));
    const roster = await screen.findByRole("dialog");
    await userEvent.setup().click(within(roster).getAllByRole("button", { name: /claude/i })[0]!);
    expect(view.handle.current!.state.pageId).toBe("page-0");
    expect(view.handle.current!.state.selection).toEqual(["n3", "n4"]);
  });

  it("is hosted by the header through useAgentsHeader: the count only decides room, the roster brings its own trigger", async () => {
    const view = await renderRegions({ regions: [["header", <HeaderProbe key="h" />]] });
    serve(view.rig, view.doc);
    expect(screen.getByTestId("header-agents")).toHaveTextContent("none");
    view.rig.push(presence("s:1", "agent:claude", "update_nodes"));
    expect(await screen.findByRole("button", { name: /1 active/i })).toBeInTheDocument();
  });
});
