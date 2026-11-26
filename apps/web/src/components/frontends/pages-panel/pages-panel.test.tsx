import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PagesPanel, type PageEntry, type PagesPanelProps } from "./index";

const pages: PageEntry[] = [
  { id: "p1", name: "Cover", agents: 2 },
  { id: "p2", name: "Editor", hasContent: true },
  { id: "p3", name: "Archive" },
];

function setup(props: Partial<PagesPanelProps> = {}) {
  const handlers = { onOpen: vi.fn(), onCreate: vi.fn(), onRename: vi.fn(), onDelete: vi.fn() };
  const view = render(<PagesPanel pages={pages} activePageId="p1" {...handlers} {...props} />);
  return { ...handlers, ...view };
}

const row = (name: string) => screen.getByRole("button", { name }).closest("[role=listitem]") as HTMLElement;
const renameInput = () => screen.getByRole("textbox", { name: "Page name" });

describe("PagesPanel", () => {
  it("lists the pages under a Pages heading and marks the active one", () => {
    setup();
    expect(screen.getByRole("heading", { level: 2, name: "Pages" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Cover" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Editor" })).not.toHaveAttribute("aria-current");
  });

  it("shows the agents active on a page", () => {
    setup({ pages: [{ id: "p1", name: "Cover", agents: 1 }, { id: "p2", name: "Editor", agents: 3 }, { id: "p3", name: "Archive" }] });
    expect(screen.getByRole("img", { name: "1 active agent on this page" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "3 active agents on this page" })).toBeInTheDocument();
    expect(within(row("Archive")).queryByRole("img")).not.toBeInTheDocument();
  });

  it("opens a page when it is clicked", async () => {
    const user = userEvent.setup();
    const { onOpen } = setup();
    await user.click(screen.getByRole("button", { name: "Archive" }));
    expect(onOpen).toHaveBeenCalledWith("p3");
  });

  it("asks to create a page with the plus button", async () => {
    const user = userEvent.setup();
    const { onCreate } = setup();
    await user.click(screen.getByRole("button", { name: "New page" }));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it("renames on double click and confirms with Enter", async () => {
    const user = userEvent.setup();
    const { onRename } = setup();
    await user.dblClick(screen.getByRole("button", { name: "Editor" }));
    expect(renameInput()).toHaveFocus();
    expect(renameInput()).toHaveValue("Editor");
    await user.keyboard("{Control>}a{/Control}Workspace{Enter}");
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith("p2", "Workspace");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editor" })).toBeInTheDocument();
  });

  it("starts the rename with F2 on the focused page", async () => {
    const user = userEvent.setup();
    const { onRename } = setup();
    screen.getByRole("button", { name: "Archive" }).focus();
    await user.keyboard("{F2}");
    expect(renameInput()).toHaveValue("Archive");
    await user.keyboard("{End} 2{Enter}");
    expect(onRename).toHaveBeenCalledWith("p3", "Archive 2");
  });

  it("cancels the rename with Escape without emitting anything", async () => {
    const user = userEvent.setup();
    const { onRename } = setup();
    await user.dblClick(screen.getByRole("button", { name: "Editor" }));
    await user.keyboard("Other{Escape}");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(onRename).not.toHaveBeenCalled();
  });

  it("commits the rename when the field loses focus", async () => {
    const user = userEvent.setup();
    const { onRename } = setup();
    await user.dblClick(screen.getByRole("button", { name: "Editor" }));
    await user.keyboard("{Control>}a{/Control}Blurred");
    await user.click(document.body);
    expect(onRename).toHaveBeenCalledOnce();
    expect(onRename).toHaveBeenCalledWith("p2", "Blurred");
  });

  it("does not emit a rename for an empty or unchanged name", async () => {
    const user = userEvent.setup();
    const { onRename } = setup();
    await user.dblClick(screen.getByRole("button", { name: "Editor" }));
    await user.keyboard("{Enter}");
    await user.dblClick(screen.getByRole("button", { name: "Editor" }));
    await user.keyboard("{Control>}a{/Control}   {Enter}");
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("trims the new name", async () => {
    const user = userEvent.setup();
    const { onRename } = setup();
    await user.dblClick(screen.getByRole("button", { name: "Editor" }));
    await user.keyboard("{Control>}a{/Control}  Spaced  {Enter}");
    expect(onRename).toHaveBeenCalledWith("p2", "Spaced");
  });

  it("deletes a page without content right away", async () => {
    const user = userEvent.setup();
    const { onDelete } = setup();
    await user.click(screen.getByRole("button", { name: "Delete page Archive" }));
    expect(onDelete).toHaveBeenCalledWith("p3");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("asks for confirmation before deleting a page with content", async () => {
    const user = userEvent.setup();
    const { onDelete } = setup();
    await user.click(screen.getByRole("button", { name: "Delete page Editor" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveAccessibleName("Delete page “Editor”?");
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onDelete).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Delete page Editor" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete page" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("p2");
  });

  it("does not offer deleting the only page", () => {
    setup({ pages: [{ id: "p1", name: "Cover" }] });
    expect(screen.queryByRole("button", { name: /Delete page/ })).not.toBeInTheDocument();
  });

  it("shows an empty message and still allows creating a page", async () => {
    const user = userEvent.setup();
    const { onCreate } = setup({ pages: [], activePageId: null });
    expect(screen.getByText("No pages yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New page" }));
    expect(onCreate).toHaveBeenCalledOnce();
  });

  it("keeps the renaming page of each instance apart", async () => {
    const user = userEvent.setup();
    render(
      <>
        <section aria-label="a">
          <PagesPanel pages={pages} onOpen={vi.fn()} onCreate={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} />
        </section>
        <section aria-label="b">
          <PagesPanel pages={pages} onOpen={vi.fn()} onCreate={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} />
        </section>
      </>,
    );
    await user.dblClick(within(screen.getByRole("region", { name: "a" })).getByRole("button", { name: "Editor" }));
    expect(within(screen.getByRole("region", { name: "a" })).getByRole("textbox")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "b" })).queryByRole("textbox")).not.toBeInTheDocument();
  });
});
