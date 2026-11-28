import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { Agents, splitAgents, type AgentEntry, type AgentsProps } from "./index";

const NOW = 1_000_000;

const agents: AgentEntry[] = [
  { id: "a1", name: "Claude", tool: "update_nodes", tone: "agent-1", activity: "writing", lastActiveAt: NOW - 2_000, pageId: "p1", pageName: "Cover" },
  { id: "a2", name: "Codex", tool: "get_nodes", tone: "agent-2", activity: "reading", lastActiveAt: NOW - 10_000, pageId: "p1", pageName: "Cover" },
  { id: "a3", name: "Gemini", tool: "get_nodes", tone: "agent-4", activity: "reading", lastActiveAt: NOW - 120_000, pageName: "Cover" },
];

function setup(props: Partial<AgentsProps> = {}) {
  const handlers = { onFocusAgent: vi.fn(), onOpenPage: vi.fn() };
  const view = render(<Agents agents={agents} now={NOW} defaultOpen {...handlers} {...props} />);
  return { ...handlers, ...view };
}

describe("Agents", () => {
  it("counts only the agents active in the last 15 seconds", () => {
    setup({ defaultOpen: false });
    expect(screen.getByRole("button", { name: /2 active/ })).toBeInTheDocument();
  });

  it("shows only the empty pill without agents", () => {
    setup({ agents: [] });
    expect(screen.getByText("No agents")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("lists active and idle agents in their own sections", () => {
    setup();
    expect(screen.getByRole("region", { name: "Active" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Idle" })).toBeInTheDocument();
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Active", "Idle"]);
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.getAttribute("data-agent"))).toEqual(["a1", "a2", "a3"]);
    expect(within(items[2] as HTMLElement).getByText("2 min ago")).toBeInTheDocument();
  });

  it("puts writing agents before reading ones, then the most recent", () => {
    const list: AgentEntry[] = [
      { ...(agents[1] as AgentEntry), id: "r1", lastActiveAt: NOW - 1_000 },
      { ...(agents[0] as AgentEntry), id: "w1", lastActiveAt: NOW - 9_000 },
      { ...(agents[0] as AgentEntry), id: "w2", lastActiveAt: NOW - 3_000 },
    ];
    expect(splitAgents(list, NOW, 15_000).active.map((a) => a.id)).toEqual(["w2", "w1", "r1"]);
  });

  it("focuses the agent when its row is pressed", async () => {
    const user = userEvent.setup();
    const { onFocusAgent } = setup();
    await user.click(screen.getByRole("button", { name: /^Codex/ }));
    expect(onFocusAgent).toHaveBeenCalledWith("a2");
  });

  it("opens the page of an agent that has one", async () => {
    const user = userEvent.setup();
    const { onOpenPage } = setup();
    await user.click(screen.getByRole("button", { name: "Open the page of Claude" }));
    expect(onOpenPage).toHaveBeenCalledWith("p1", "a1");
    expect(screen.queryByRole("button", { name: "Open the page of Gemini" })).not.toBeInTheDocument();
  });

  it("re-evaluates activity when the injected clock advances", () => {
    let now = NOW;
    const { rerender } = setup({ now: undefined, clock: () => now, defaultOpen: false });
    expect(screen.getByRole("button", { name: /2 active/ })).toBeInTheDocument();
    now = NOW + 60_000;
    rerender(<Agents agents={agents} clock={() => now} now={now} onFocusAgent={vi.fn()} />);
    expect(screen.getByRole("button", { name: /0 active/ })).toBeInTheDocument();
  });

  it("opens from the trigger and reports the change", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    setup({ defaultOpen: false, onOpenChange });
    await user.click(screen.getByRole("button", { name: /2 active/ }));
    expect(onOpenChange).toHaveBeenCalledWith(true, expect.anything());
    expect(screen.getByText("Agents in the workspace")).toBeInTheDocument();
  });

  it("renders in pt-BR", async () => {
    await i18n.changeLanguage("pt-BR");
    try {
      setup();
      expect(screen.getByText("Agentes no workspace")).toBeInTheDocument();
      expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Ativos", "Ociosos"]);
      expect(screen.getByText("há 2 min")).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("renders on the server", () => {
    expect(renderToString(<Agents agents={agents} now={NOW} onFocusAgent={vi.fn()} />)).toContain("2 active");
  });
});
