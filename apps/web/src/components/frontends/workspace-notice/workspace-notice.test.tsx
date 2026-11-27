import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { summarizeCounts, WorkspaceNotice, type WorkspaceNoticeEntry, type WorkspaceNoticeProps } from "./index";

const deleted: WorkspaceNoticeEntry = {
  id: "n1",
  actor: { name: "claude", tone: "agent-1" },
  op: "delete",
  workspaceName: "Flow drafts",
  counts: { nodes: 86, pages: 2, frames: 4, images: 0, historyEntries: 1 },
};

function setup(props: Partial<WorkspaceNoticeProps> = {}) {
  const handlers = { onDismiss: vi.fn(), onViewWorkspaces: vi.fn() };
  const view = render(<WorkspaceNotice notice={deleted} {...handlers} {...props} />);
  return { ...handlers, ...view };
}

describe("WorkspaceNotice", () => {
  it("shows who did what and the summary of a deletion", () => {
    setup();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("claude deleted the workspace “Flow drafts”");
    expect(status).toHaveTextContent("86 nodes · 2 pages · 4 frames · 1 edit in history");
  });

  it("describes opening and renaming without a summary", () => {
    const { rerender, onDismiss, onViewWorkspaces } = setup({ notice: { ...deleted, op: "open" } });
    expect(screen.getByRole("status")).toHaveTextContent("claude opened the workspace “Flow drafts”");
    expect(screen.getByRole("status")).not.toHaveTextContent("nodes");
    rerender(<WorkspaceNotice notice={{ ...deleted, op: "rename" }} onDismiss={onDismiss} onViewWorkspaces={onViewWorkspaces} />);
    expect(screen.getByRole("status")).toHaveTextContent("renamed the workspace to “Flow drafts”");
  });

  it("dismisses and opens the workspaces", async () => {
    const user = userEvent.setup();
    const { onDismiss, onViewWorkspaces } = setup();
    await user.click(screen.getByRole("button", { name: "View workspaces" }));
    expect(onViewWorkspaces).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Dismiss notice" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("returns the focus to where it was before the notice when it is dismissed", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <>
        <button>editor</button>
        <WorkspaceNotice notice={null} onDismiss={vi.fn()} onViewWorkspaces={vi.fn()} />
      </>,
    );
    screen.getByRole("button", { name: "editor" }).focus();
    rerender(
      <>
        <button>editor</button>
        <WorkspaceNotice notice={deleted} onDismiss={() => rerender(<><button>editor</button><WorkspaceNotice notice={null} onDismiss={vi.fn()} onViewWorkspaces={vi.fn()} /></>)} onViewWorkspaces={vi.fn()} />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Dismiss notice" }));
    expect(screen.getByRole("button", { name: "editor" })).toHaveFocus();
  });

  it("has no button to the workspaces where the list is already on screen (no handler)", () => {
    render(<WorkspaceNotice notice={deleted} onDismiss={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /workspaces/i })).toBeNull();
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
  });

  it("renders nothing visible without a notice but keeps the live region", () => {
    const { container } = setup({ notice: null });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(container.querySelector("[aria-live=polite]")).toBeInTheDocument();
  });

  it("is a fixed card pinned with logical properties", () => {
    const { container } = setup();
    const region = container.querySelector("[aria-live=polite]") as HTMLElement;
    expect(region).toHaveClass("fixed", "end-4", "bottom-4");
    expect(region.className).not.toMatch(/(^|\s)(right|left)-/);
  });

  it("summarizes only positive counts", () => {
    expect(summarizeCounts({ nodes: 0, pages: 3 }, (key, count) => `${key}:${count}`)).toBe("pages:3");
    expect(summarizeCounts(undefined, () => "x")).toBe("");
  });

  it("renders in pt-BR with plurals", async () => {
    await i18n.changeLanguage("pt-BR");
    try {
      setup({ notice: { ...deleted, counts: { nodes: 1, pages: 2 } } });
      expect(screen.getByRole("status")).toHaveTextContent("claude apagou o workspace “Flow drafts”");
      expect(screen.getByRole("status")).toHaveTextContent("1 nó · 2 páginas");
      expect(screen.getByRole("button", { name: "Ver workspaces" })).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("renders on the server", () => {
    expect(renderToString(<WorkspaceNotice notice={deleted} onDismiss={vi.fn()} onViewWorkspaces={vi.fn()} />)).toContain("Flow drafts");
  });
});
