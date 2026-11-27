import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { filterWorkspaces, Overview, relativeTime, type OverviewProps, type WorkspaceEntry } from "./index";

const NOW = Date.UTC(2026, 10, 26, 12, 0, 0);

const workspaces: WorkspaceEntry[] = [
  { id: "w1", name: "App redesign", nodes: 1204, updatedAt: NOW - 10_000, active: true, projectId: "p1" },
  { id: "w2", name: "Site and docs", nodes: 1, updatedAt: NOW - 48 * 60_000, projectId: "p1" },
  { id: "w3", name: "Flow drafts", nodes: 86, updatedAt: NOW - 86_400_000, cover: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" },
  { id: "w4", name: "Old brand", nodes: 412, updatedAt: NOW - 40 * 86_400_000, archived: true },
];
const projects = [
  { id: "p1", name: "North studio" },
  { id: "p2", name: "Personal" },
];

function handlers() {
  return {
    onOpen: vi.fn(),
    onCreate: vi.fn<OverviewProps["onCreate"]>(),
    onRename: vi.fn<OverviewProps["onRename"]>(),
    onDelete: vi.fn<OverviewProps["onDelete"]>(),
    onArchive: vi.fn<OverviewProps["onArchive"]>(),
    onRestore: vi.fn<OverviewProps["onRestore"]>(),
    onChangeCover: vi.fn<OverviewProps["onChangeCover"]>(),
    onMoveToProject: vi.fn<OverviewProps["onMoveToProject"]>(),
  };
}

function setup(props: Partial<OverviewProps> = {}) {
  const h = handlers();
  const view = render(<Overview workspaces={workspaces} projects={projects} now={NOW} {...h} {...props} />);
  return { ...h, ...view };
}

const card = (id: string) => document.querySelector(`li[data-workspace-id="${id}"]`) as HTMLElement;
const openButton = (name: string) => screen.getByRole("button", { name });
const openMenu = async (user: ReturnType<typeof userEvent.setup>, id: string) => {
  await user.click(within(card(id)).getByRole("button", { name: "More actions" }));
};

const emptyFailures: [string, () => unknown][] = [["an empty message", () => new Error("")], ["no error value", () => undefined]];

describe("Overview", () => {
  it("lists the active workspaces with name, meta and the active badge, and hides archived ones", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1, name: "Workspaces" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").filter((item) => item.hasAttribute("data-workspace-id"))).toHaveLength(3);
    expect(screen.queryByText("Old brand", { selector: "button" })).not.toBeInTheDocument();
    expect(within(card("w1")).getByText("1,204 nodes · now")).toBeInTheDocument();
    expect(within(card("w2")).getByText(/^1 node · /)).toBeInTheDocument();
    expect(within(card("w1")).getByText("active")).toBeInTheDocument();
    expect(within(card("w3")).queryByText("active")).not.toBeInTheDocument();
    expect(screen.getByText(/^3 workspaces\./)).toBeInTheDocument();
  });

  it("uses the cover image, a custom preview or the initial", () => {
    setup({ renderPreview: (w) => (w.id === "w2" ? <svg data-testid="live" /> : null) });
    expect(card("w3").querySelector("img")).toHaveAttribute("src", expect.stringContaining("data:image/gif"));
    expect(within(card("w2")).getByTestId("live")).toBeInTheDocument();
    expect(within(card("w1")).getByText("A")).toBeInTheDocument();
  });

  it("opens a workspace with a click, Enter and Space", async () => {
    const user = userEvent.setup();
    const { onOpen } = setup();
    await user.click(openButton("Site and docs"));
    expect(onOpen).toHaveBeenLastCalledWith("w2");
    openButton("Flow drafts").focus();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenLastCalledWith("w3");
    await user.keyboard(" ");
    expect(onOpen).toHaveBeenCalledTimes(3);
  });

  it("opens from the card menu", async () => {
    const user = userEvent.setup();
    const { onOpen } = setup();
    await openMenu(user, "w2");
    await user.click(screen.getByRole("menuitem", { name: /^Open/ }));
    expect(onOpen).toHaveBeenCalledWith("w2");
  });

  describe("create", () => {
    it("opens the inline form, creates with the typed name and returns focus to the button", async () => {
      const user = userEvent.setup();
      const { onCreate } = setup();
      await user.click(screen.getByRole("button", { name: "New workspace" }));
      const input = screen.getByRole("textbox", { name: "Workspace name" });
      expect(input).toHaveFocus();
      await user.keyboard("Brand book{Enter}");
      expect(onCreate).toHaveBeenCalledWith("Brand book");
      await waitFor(() => expect(screen.queryByRole("textbox", { name: "Workspace name" })).not.toBeInTheDocument());
      expect(screen.getByRole("button", { name: "New workspace" })).toHaveFocus();
    });

    it("falls back to the untitled name when blank", async () => {
      const user = userEvent.setup();
      const { onCreate } = setup();
      await user.click(screen.getByRole("button", { name: "New workspace" }));
      await user.click(screen.getByRole("button", { name: "Create" }));
      expect(onCreate).toHaveBeenCalledWith("Untitled workspace");
    });

    it("cancels with Escape and with the button without calling the owner", async () => {
      const user = userEvent.setup();
      const { onCreate } = setup();
      await user.click(screen.getByRole("button", { name: "New workspace" }));
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("textbox", { name: "Workspace name" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "New workspace" })).toHaveFocus();
      await user.click(screen.getByRole("button", { name: "New workspace" }));
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onCreate).not.toHaveBeenCalled();
    });

    it("keeps the form pending while the promise runs and shows the failure when it rejects", async () => {
      const user = userEvent.setup();
      let reject: (reason: Error) => void = () => {};
      const onCreate = vi.fn(() => new Promise<void>((_, r) => (reject = r)));
      setup({ onCreate });
      await user.click(screen.getByRole("button", { name: "New workspace" }));
      await user.keyboard("x{Enter}");
      expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
      await user.keyboard("{Enter}");
      expect(onCreate).toHaveBeenCalledTimes(1);
      await act(async () => reject(new Error("server is down")));
      expect(screen.getByRole("alert")).toHaveTextContent("Could not create the workspace: server is down");
      expect(screen.getByRole("textbox", { name: "Workspace name" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Create" })).toBeEnabled();
    });
  });

  describe("rename", () => {
    it("renames with F2 on the focused card and returns focus", async () => {
      const user = userEvent.setup();
      const { onRename } = setup();
      openButton("Site and docs").focus();
      await user.keyboard("{F2}");
      const input = screen.getByRole("textbox", { name: "New workspace name" });
      expect(input).toHaveFocus();
      expect(input).toHaveValue("Site and docs");
      await user.keyboard("{Control>}a{/Control}Landing{Enter}");
      expect(onRename).toHaveBeenCalledTimes(1);
      expect(onRename).toHaveBeenCalledWith("w2", "Landing");
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
      expect(openButton("Site and docs")).toHaveFocus();
    });

    it("committing the name with Enter does not also open the workspace", async () => {
      const user = userEvent.setup();
      const { onRename, onOpen } = setup();
      openButton("Site and docs").focus();
      await user.keyboard("{F2}");
      await user.keyboard("{Control>}a{/Control}Landing{Enter}");
      expect(onRename).toHaveBeenCalledWith("w2", "Landing");
      expect(onOpen).not.toHaveBeenCalled();
    });

    it("renames from the menu and cancels with Escape", async () => {
      const user = userEvent.setup();
      const { onRename } = setup();
      await openMenu(user, "w3");
      await user.click(screen.getByRole("menuitem", { name: /^Rename/ }));
      expect(screen.getByRole("textbox", { name: "New workspace name" })).toHaveFocus();
      await user.keyboard("zzz{Escape}");
      expect(onRename).not.toHaveBeenCalled();
      expect(openButton("Flow drafts")).toHaveFocus();
    });

    it("does not call the owner for an unchanged or blank name and reports a failure", async () => {
      const user = userEvent.setup();
      const onRename = vi.fn(() => Promise.reject(new Error("name taken")));
      setup({ onRename });
      openButton("Flow drafts").focus();
      await user.keyboard("{F2}{Enter}");
      expect(onRename).not.toHaveBeenCalled();
      await user.keyboard("{F2}{Control>}a{/Control}Other{Enter}");
      expect(onRename).toHaveBeenCalledWith("w3", "Other");
      expect(await screen.findByRole("alert")).toHaveTextContent("Could not rename the workspace: name taken");
    });

    it.each(emptyFailures)("shows the generic text when the failure has %s", async (_, make) => {
      const user = userEvent.setup();
      setup({ onRename: vi.fn(() => Promise.reject(make())) });
      openButton("Flow drafts").focus();
      await user.keyboard("{F2}{Control>}a{/Control}Other{Enter}");
      expect(await screen.findByRole("alert")).toHaveTextContent("Could not rename the workspace: Unknown error");
    });
  });

  describe("delete", () => {
    it("asks for the typed name, enables the button only when it matches and calls the owner", async () => {
      const user = userEvent.setup();
      const { onDelete } = setup();
      await openMenu(user, "w2");
      await user.click(screen.getByRole("menuitem", { name: /^Delete/ }));
      const dialog = screen.getByRole("alertdialog", { name: "Delete “Site and docs”?" });
      expect(within(dialog).getByText("1 node and the undo history will be erased. This cannot be undone.")).toBeInTheDocument();
      const confirm = within(dialog).getByRole("button", { name: "Delete workspace" });
      expect(confirm).toBeDisabled();
      expect(within(dialog).getByRole("textbox")).toHaveFocus();
      await user.type(within(dialog).getByRole("textbox", { name: "Type “Site and docs” to confirm" }), "Site and doc");
      expect(confirm).toBeDisabled();
      await user.type(within(dialog).getByRole("textbox"), "s");
      expect(confirm).toBeEnabled();
      await user.click(confirm);
      expect(onDelete).toHaveBeenCalledWith("w2");
    });

    it("asks with the Delete key and Cancel does nothing and returns focus to the card", async () => {
      const user = userEvent.setup();
      const { onDelete } = setup();
      openButton("Flow drafts").focus();
      await user.keyboard("{Delete}");
      const dialog = screen.getByRole("alertdialog");
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(onDelete).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      expect(openButton("Flow drafts")).toHaveFocus();
    });

    it("skips the typed name when the prop says so", async () => {
      const user = userEvent.setup();
      const { onDelete } = setup({ confirmDeleteByName: false });
      openButton("Flow drafts").focus();
      await user.keyboard("{Delete}");
      expect(within(screen.getByRole("alertdialog")).queryByRole("textbox")).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Delete workspace" }));
      expect(onDelete).toHaveBeenCalledWith("w3");
    });

    it("moves focus to the neighbour when the workspace goes away", async () => {
      const user = userEvent.setup();
      function Owner() {
        const [list, setList] = useState(workspaces);
        return <Overview workspaces={list} projects={projects} now={NOW} {...handlers()} confirmDeleteByName={false} onDelete={(id) => setList((l) => l.filter((w) => w.id !== id))} />;
      }
      render(<Owner />);
      openButton("Site and docs").focus();
      await user.keyboard("{Delete}");
      await user.click(screen.getByRole("button", { name: "Delete workspace" }));
      await waitFor(() => expect(screen.queryByText("Site and docs")).not.toBeInTheDocument());
      await waitFor(() => expect(openButton("Flow drafts")).toHaveFocus());
    });

    it("focuses the new workspace button when the last card is deleted and reports failures", async () => {
      const user = userEvent.setup();
      const onDelete = vi.fn(() => Promise.reject(new Error("locked")));
      setup({ confirmDeleteByName: false, onDelete });
      openButton("Flow drafts").focus();
      await user.keyboard("{Delete}");
      await user.click(screen.getByRole("button", { name: "Delete workspace" }));
      expect(await screen.findByText("Could not delete the workspace: locked")).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    });

    it("blocks delete and archive when the entry says so", async () => {
      const user = userEvent.setup();
      const { onDelete } = setup({ workspaces: [{ ...workspaces[0]!, canDelete: false, canArchive: false }] });
      openButton("App redesign").focus();
      await user.keyboard("{Delete}");
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      await openMenu(user, "w1");
      expect(screen.getByRole("menuitem", { name: /^Delete/ })).toHaveAttribute("aria-disabled", "true");
      expect(screen.getByRole("menuitem", { name: "Archive" })).toHaveAttribute("aria-disabled", "true");
      expect(onDelete).not.toHaveBeenCalled();
    });
  });

  describe("menu actions", () => {
    it("archives and restores", async () => {
      const user = userEvent.setup();
      const { onArchive, onRestore } = setup({ view: { kind: "workspaces" } });
      await openMenu(user, "w2");
      await user.click(screen.getByRole("menuitem", { name: "Archive" }));
      expect(onArchive).toHaveBeenCalledWith("w2");
      cleanupAll();
      const second = setup({ view: { kind: "archived" } });
      expect(within(card("w4")).getByText("archived")).toBeInTheDocument();
      await openMenu(user, "w4");
      await user.click(screen.getByRole("menuitem", { name: "Restore" }));
      expect(second.onRestore).toHaveBeenCalledWith("w4");
      expect(onRestore).not.toHaveBeenCalled();
    });

    it("moves to a project and back to none", async () => {
      const user = userEvent.setup();
      const { onMoveToProject } = setup();
      await openMenu(user, "w2");
      expect(screen.getByRole("menuitemradio", { name: "North studio" })).toBeChecked();
      await user.click(screen.getByRole("menuitemradio", { name: "Personal" }));
      expect(onMoveToProject).toHaveBeenLastCalledWith("w2", "p2");
      if (!screen.queryByRole("menu")) await openMenu(user, "w2");
      await user.click(screen.getByRole("menuitemradio", { name: "No project" }));
      expect(onMoveToProject).toHaveBeenLastCalledWith("w2", null);
    });

    it("changes the cover through the file picker, removes it and accepts a dropped image", async () => {
      const user = userEvent.setup();
      const { onChangeCover } = setup();
      const click = vi.spyOn(HTMLInputElement.prototype, "click");
      await openMenu(user, "w1");
      await user.click(screen.getByRole("menuitem", { name: "Add cover" }));
      expect(click).toHaveBeenCalled();
      const file = new File(["x"], "cover.png", { type: "image/png" });
      fireEvent.change(screen.getByLabelText("Cover image", { selector: "input" }), { target: { files: [file] } });
      expect(onChangeCover).toHaveBeenLastCalledWith("w1", file);

      await openMenu(user, "w3");
      await user.click(screen.getByRole("menuitem", { name: "Remove cover" }));
      expect(onChangeCover).toHaveBeenLastCalledWith("w3", null);

      const dropped = new File(["y"], "drop.webp", { type: "image/webp" });
      fireEvent.dragOver(card("w2"), { dataTransfer: { types: ["Files"], files: [dropped] } });
      expect(within(card("w2")).getByText("Drop to use as cover")).toBeInTheDocument();
      fireEvent.drop(card("w2"), { dataTransfer: { types: ["Files"], files: [dropped] } });
      expect(onChangeCover).toHaveBeenLastCalledWith("w2", dropped);
      expect(within(card("w2")).queryByText("Drop to use as cover")).not.toBeInTheDocument();
      const text = new File(["z"], "a.txt", { type: "text/plain" });
      fireEvent.drop(card("w2"), { dataTransfer: { types: ["Files"], files: [text] } });
      expect(onChangeCover).toHaveBeenCalledTimes(3);
    });
  });

  describe("states", () => {
    it("shows a skeleton while loading and no empty state", () => {
      setup({ workspaces: [], loading: true });
      expect(screen.getByRole("status", { name: "Loading workspaces" })).toBeInTheDocument();
      expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
      expect(screen.queryByText("No workspaces yet. Create the first.")).not.toBeInTheDocument();
    });

    it.each([["an empty string", ""], ["blank text", "  "]])("shows the generic list error when the owner passes %s", (_, error) => {
      setup({ workspaces: [], error });
      expect(screen.getByRole("alert")).toHaveTextContent("Could not list the workspaces: Unknown error");
    });

    it("shows the list error with try again", async () => {
      const user = userEvent.setup();
      const onRetry = vi.fn();
      setup({ workspaces: [], error: "no connection to the server", onRetry });
      expect(screen.getByRole("alert")).toHaveTextContent("Could not list the workspaces: no connection to the server");
      await user.click(screen.getByRole("button", { name: "Try again" }));
      expect(onRetry).toHaveBeenCalledOnce();
    });

    it("keeps the cards visible next to a list error", () => {
      setup({ error: "stale" });
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(openButton("App redesign")).toBeInTheDocument();
    });

    it("shows the first-use empty state and its button opens the form", async () => {
      const user = userEvent.setup();
      setup({ workspaces: [] });
      expect(screen.getByText("No workspaces yet. Create the first.")).toBeInTheDocument();
      expect(document.querySelector("svg[data-kind=first-use]")).toBeInTheDocument();
      await user.click(screen.getAllByRole("button", { name: "New workspace" })[1]!);
      expect(screen.getByRole("textbox", { name: "Workspace name" })).toHaveFocus();
    });

    it("shows the archived empty state", async () => {
      const user = userEvent.setup();
      setup({ workspaces: workspaces.slice(0, 2) });
      await user.click(screen.getByRole("button", { name: /^Archived/ }));
      expect(screen.getByRole("heading", { level: 1, name: "Archived" })).toBeInTheDocument();
      // The in-line strip of the design, not the first-use illustration.
      expect(screen.getByRole("status")).toHaveTextContent("No archived workspaces.");
      expect(document.querySelector("svg[data-kind=first-use]")).not.toBeInTheDocument();
      expect(screen.queryByText(/F2 renames/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^0 /)).not.toBeInTheDocument();
    });

    it("offers no support line (no count, no click/F2 hint) when the list is empty or has no results", async () => {
      const user = userEvent.setup();
      setup({ workspaces: [] });
      expect(screen.queryByText(/F2 renames/)).not.toBeInTheDocument();
      expect(screen.queryByText(/^0 /)).not.toBeInTheDocument();
      cleanup();
      setup();
      expect(screen.getByText(/F2 renames/)).toBeInTheDocument();
      await user.type(screen.getByRole("searchbox", { name: "Search workspaces" }), "zzz");
      expect(screen.queryByText(/F2 renames/)).not.toBeInTheDocument();
    });

    it("has a plain \"New workspace\" button (no icon) and a secondary Cancel in the form", async () => {
      const user = userEvent.setup();
      setup();
      const button = screen.getByRole("button", { name: "New workspace" });
      expect(button.querySelector("svg.lucide-plus")).toBeNull();
      await user.click(button);
      expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("border");
    });

    it("keeps the card menu free of icons", async () => {
      const user = userEvent.setup();
      setup();
      await openMenu(user, "w1");
      const menu = await screen.findByRole("menu");
      expect(within(menu).getAllByRole("menuitem").length).toBeGreaterThan(3);
      for (const item of within(menu).getAllByRole("menuitem")) expect(item.querySelector("svg")).toBeNull();
    });

    it("filters by the search field and shows no results", async () => {
      const user = userEvent.setup();
      setup();
      await user.type(screen.getByRole("searchbox", { name: "Search workspaces" }), "SITE");
      expect(screen.getAllByRole("listitem").filter((item) => item.hasAttribute("data-workspace-id"))).toHaveLength(1);
      expect(screen.getByText(/^1 workspace\./)).toBeInTheDocument();
      await user.type(screen.getByRole("searchbox"), "zzz");
      expect(screen.getByText("No workspaces match your search.")).toBeInTheDocument();
      expect(document.querySelector("svg[data-kind=no-results]")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Clear search" }));
      expect(screen.getAllByRole("listitem").filter((item) => item.hasAttribute("data-workspace-id"))).toHaveLength(3);
    });

    it("focuses the search with Mod+K", async () => {
      const user = userEvent.setup();
      setup();
      openButton("App redesign").focus();
      await user.keyboard("{Control>}k{/Control}");
      expect(screen.getByRole("searchbox", { name: "Search workspaces" })).toHaveFocus();
    });
  });

  describe("navigation", () => {
    it("emits onViewChange and follows the controlled view", async () => {
      const user = userEvent.setup();
      const onViewChange = vi.fn();
      const view = setup({ view: { kind: "workspaces" }, onViewChange });
      await user.click(screen.getByRole("button", { name: /^Archived/ }));
      expect(onViewChange).toHaveBeenCalledWith({ kind: "archived" });
      expect(screen.getByRole("heading", { level: 1, name: "Workspaces" })).toBeInTheDocument();
      view.rerender(<Overview workspaces={workspaces} projects={projects} now={NOW} {...handlers()} view={{ kind: "archived" }} />);
      expect(screen.getByRole("heading", { level: 1, name: "Archived" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^Archived/ })).toHaveAttribute("aria-current", "page");
    });

    it("selects a project, shows its breadcrumb and nested workspaces, and opens one", async () => {
      const user = userEvent.setup();
      const { onOpen } = setup();
      await user.click(screen.getByRole("button", { name: /^North studio/ }));
      expect(screen.getByRole("heading", { level: 1, name: "North studio" })).toBeInTheDocument();
      expect(screen.getAllByRole("listitem").filter((item) => item.hasAttribute("data-workspace-id"))).toHaveLength(2);
      const nested = within(screen.getByRole("navigation", { name: "Projects" }));
      await user.click(nested.getByRole("button", { name: "App redesign" }));
      expect(onOpen).toHaveBeenCalledWith("w1");
      await user.click(within(screen.getByRole("navigation", { name: "Path" })).getByRole("button", { name: "Projects" }));
      expect(screen.getByRole("heading", { level: 1, name: "Workspaces" })).toBeInTheDocument();
    });

    it("shows community as coming soon and fires import, profile and new project", async () => {
      const user = userEvent.setup();
      const onOpenImport = vi.fn();
      const onOpenProfile = vi.fn();
      const onCreateProject = vi.fn();
      setup({ onOpenImport, onOpenProfile, onCreateProject, profile: { name: "Leo", detail: "North studio", initials: "LM" } });
      expect(screen.getByRole("button", { name: /Explore/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: /Federations/ })).toBeDisabled();
      await user.click(screen.getByRole("button", { name: "Import…" }));
      await user.click(screen.getByRole("button", { name: "Open profile menu" }));
      await user.click(screen.getByRole("button", { name: "New project" }));
      expect(onOpenImport).toHaveBeenCalledOnce();
      expect(onOpenProfile).toHaveBeenCalledOnce();
      expect(onCreateProject).toHaveBeenCalledOnce();
      expect(screen.getByText("Leo")).toBeInTheDocument();
    });
  });

  it("translates to pt-BR", async () => {
    await i18n.changeLanguage("pt-BR");
    try {
      const user = userEvent.setup();
      setup();
      expect(screen.getByRole("heading", { level: 1, name: "Workspaces" })).toBeInTheDocument();
      expect(screen.getByText(/^3 workspaces\. O ativo/)).toBeInTheDocument();
      expect(within(card("w1")).getByText("1.204 nós · agora")).toBeInTheDocument();
      expect(within(card("w1")).getByText("ativo")).toBeInTheDocument();
      expect(within(card("w2")).getByText(/^1 nó · há 48 minutos$/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Novo workspace" })).toBeInTheDocument();
      await user.click(within(card("w1")).getByRole("button", { name: "Mais ações" }));
      expect(screen.getByRole("menuitem", { name: /^Renomear/ })).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("uses logical properties so it mirrors in rtl", () => {
    render(
      <div dir="rtl">
        <Overview workspaces={workspaces} now={NOW} {...handlers()} />
      </div>,
    );
    const aside = screen.getByRole("complementary", { name: "Workspace menu" });
    expect(aside.className).toContain("border-e");
    expect(aside.className).not.toMatch(/border-[rl]\b/);
  });

  it("labels the heading with a unique id per instance and shows the platform search shortcut", () => {
    render(
      <>
        <Overview workspaces={workspaces} now={NOW} {...handlers()} />
        <Overview workspaces={workspaces} now={NOW} {...handlers()} />
      </>,
    );
    const ids = screen.getAllByRole("heading", { level: 1 }).map((h) => h.id);
    expect(ids[0]).not.toBe("");
    expect(new Set(ids).size).toBe(2);
    const mains = screen.getAllByRole("main");
    expect(mains.map((m) => m.getAttribute("aria-labelledby"))).toEqual(ids);
    expect(screen.getAllByText(/^Ctrl\+K$|^⌘K$/).length).toBeGreaterThan(0);
  });

  it("refreshes the relative time while it stays mounted", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(NOW);
      const list: WorkspaceEntry[] = [{ id: "a", name: "Live", nodes: 2, updatedAt: NOW }];
      render(<Overview workspaces={list} {...handlers()} />);
      expect(screen.getByText("2 nodes · now")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(5 * 60_000);
      });
      expect(screen.getByText("2 nodes · 5 minutes ago")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not steal focus later when onDelete resolved but the workspace stayed", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn(() => Promise.resolve());
    const view = render(<Overview workspaces={workspaces} now={NOW} {...handlers()} confirmDeleteByName={false} onDelete={onDelete} />);
    openButton("Site and docs").focus();
    await user.keyboard("{Delete}");
    await user.click(screen.getByRole("button", { name: "Delete workspace" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const search = screen.getByRole("searchbox", { name: "Search workspaces" });
    search.focus();
    view.rerender(<Overview workspaces={workspaces.filter((w) => w.id !== "w2")} now={NOW} {...handlers()} confirmDeleteByName={false} onDelete={onDelete} />);
    expect(search).toHaveFocus();
  });

  it("renders on the server", () => {
    expect(renderToString(<Overview workspaces={workspaces} now={NOW} {...handlers()} />)).toContain("Workspaces");
  });
});

function cleanupAll() {
  document.body.innerHTML = "";
}

describe("model", () => {
  it("filters by view and query", () => {
    expect(filterWorkspaces(workspaces, { kind: "workspaces" }, "").map((w) => w.id)).toEqual(["w1", "w2", "w3"]);
    expect(filterWorkspaces(workspaces, { kind: "archived" }, "").map((w) => w.id)).toEqual(["w4"]);
    expect(filterWorkspaces(workspaces, { kind: "project", id: "p1" }, "").map((w) => w.id)).toEqual(["w1", "w2"]);
    expect(filterWorkspaces(workspaces, { kind: "workspaces" }, "  APP ").map((w) => w.id)).toEqual(["w1"]);
  });

  it("formats relative times", () => {
    expect(relativeTime(NOW - 10_000, "en", "now", NOW)).toBe("now");
    expect(relativeTime(NOW - 3 * 60_000, "en", "now", NOW)).toBe("3 minutes ago");
    expect(relativeTime(NOW - 2 * 3600_000, "en", "now", NOW)).toBe("2 hours ago");
    expect(relativeTime(NOW - 86_400_000, "en", "now", NOW)).toBe("yesterday");
    expect(relativeTime(NOW - 40 * 86_400_000, "en", "now", NOW)).toMatch(/2026/);
  });
});
