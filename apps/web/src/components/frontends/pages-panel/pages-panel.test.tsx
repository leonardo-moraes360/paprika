import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { PagesPanel, type PageEntry, type PagesPanelProps } from "./index";

const renders = vi.hoisted(() => new Map<string, number>());

vi.mock("@/components/ui/page-item", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/page-item")>();
  return {
    ...actual,
    PageItem: (props: Parameters<typeof actual.PageItem>[0]) => {
      renders.set(props.name, (renders.get(props.name) ?? 0) + 1);
      return <actual.PageItem {...props} />;
    },
  };
});

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
  it("keeps 14 px free on the right of the list for the scroll bar, with the 2 px gap between rows", () => {
    setup();
    const list = screen.getByRole("list", { name: "Pages" });
    expect(list).toHaveClass("pe-3.5", "gap-0.5");
  });

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

  it("re-renders only the rows whose renaming flag changes", async () => {
    const user = userEvent.setup();
    setup();
    renders.clear();
    await user.dblClick(screen.getByRole("button", { name: "Editor" }));
    expect(renders.get("Editor")).toBeGreaterThan(0);
    expect(renders.get("Cover") ?? 0).toBe(0);
    expect(renders.get("Archive") ?? 0).toBe(0);
  });

  describe("focus", () => {
    function Owner({ initial = pages, ...rest }: { initial?: PageEntry[] } & Partial<PagesPanelProps>) {
      const [list, setList] = useState(initial);
      return (
        <PagesPanel
          pages={list}
          activePageId="p1"
          onOpen={vi.fn()}
          onCreate={vi.fn()}
          onRename={(id, name) => setList((current) => current.map((page) => (page.id === id ? { ...page, name } : page)))}
          onDelete={(id) => setList((current) => current.filter((page) => page.id !== id))}
          {...rest}
        />
      );
    }

    it("returns to the page button after confirming a rename with Enter", async () => {
      const user = userEvent.setup();
      render(<Owner />);
      await user.dblClick(screen.getByRole("button", { name: "Editor" }));
      await user.keyboard("{Control>}a{/Control}Workspace{Enter}");
      expect(screen.getByRole("button", { name: "Workspace" })).toHaveFocus();
    });

    it("returns to the page button after cancelling a rename with Escape", async () => {
      const user = userEvent.setup();
      render(<Owner />);
      screen.getByRole("button", { name: "Archive" }).focus();
      await user.keyboard("{F2}x{Escape}");
      expect(screen.getByRole("button", { name: "Archive" })).toHaveFocus();
    });

    it("does not take the focus back when the rename ends by clicking elsewhere", async () => {
      const user = userEvent.setup();
      render(
        <>
          <Owner />
          <button>elsewhere</button>
        </>,
      );
      await user.dblClick(screen.getByRole("button", { name: "Editor" }));
      await user.click(screen.getByRole("button", { name: "elsewhere" }));
      expect(screen.getByRole("button", { name: "elsewhere" })).toHaveFocus();
    });

    it("moves to the next page after deleting one right away", async () => {
      const user = userEvent.setup();
      render(<Owner />);
      await user.click(screen.getByRole("button", { name: "Delete page Archive" }));
      expect(screen.getByRole("button", { name: "Editor" })).toHaveFocus();
    });

    it("moves to the neighbour after confirming the deletion in the dialog", async () => {
      const user = userEvent.setup();
      render(<Owner />);
      await user.click(screen.getByRole("button", { name: "Delete page Editor" }));
      await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete page" }));
      await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
      expect(screen.getByRole("button", { name: "Archive" })).toHaveFocus();
    });

    it("goes to the new page button when the list ends up empty", async () => {
      const user = userEvent.setup();
      const handlers = { onOpen: vi.fn(), onCreate: vi.fn(), onRename: vi.fn(), onDelete: vi.fn() };
      const two = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
      const { rerender } = render(<PagesPanel pages={two} {...handlers} />);
      await user.click(screen.getByRole("button", { name: "Delete page B" }));
      rerender(<PagesPanel pages={[]} {...handlers} />);
      expect(screen.getByRole("button", { name: "New page" })).toHaveFocus();
    });

    it("leaves the focus alone when the owner does not remove the page", async () => {
      const user = userEvent.setup();
      const { onDelete } = setup();
      await user.click(screen.getByRole("button", { name: "Delete page Archive" }));
      expect(onDelete).toHaveBeenCalledWith("p3");
      expect(screen.getByRole("button", { name: "Delete page Archive" })).toHaveFocus();
    });
  });

  describe("section", () => {
    const sectionButton = () => screen.getByRole("button", { name: "Pages" });

    it("collapses and expands the list from the header, keeping the new page button", async () => {
      const user = userEvent.setup();
      setup();
      expect(sectionButton()).toHaveAttribute("aria-expanded", "true");
      await user.click(sectionButton());
      expect(sectionButton()).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("button", { name: "Cover" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "New page" })).toBeInTheDocument();
      await user.click(sectionButton());
      expect(screen.getByRole("button", { name: "Cover" })).toBeInTheDocument();
    });

    it("starts closed with defaultOpen false and reports changes", async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      setup({ defaultOpen: false, onOpenChange });
      expect(sectionButton()).toHaveAttribute("aria-expanded", "false");
      await user.click(sectionButton());
      expect(onOpenChange).toHaveBeenCalledWith(true);
    });

    it("persists the choice under its storage key and restores it", async () => {
      const user = userEvent.setup();
      const { unmount } = setup({ storageKey: "pages.open" });
      await user.click(sectionButton());
      expect(window.localStorage.getItem("paprika.pages.open")).toBe("0");
      unmount();
      setup({ storageKey: "pages.open" });
      expect(sectionButton()).toHaveAttribute("aria-expanded", "false");
    });

    it("follows the owner and never persists when controlled", async () => {
      const user = userEvent.setup();
      const onOpenChange = vi.fn();
      setup({ open: true, storageKey: "pages.open", onOpenChange });
      await user.click(sectionButton());
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(sectionButton()).toHaveAttribute("aria-expanded", "true");
      expect(window.localStorage.getItem("paprika.pages.open")).toBeNull();
    });
  });

  it("drops a rename whose page disappeared", async () => {
    const user = userEvent.setup();
    const { rerender } = setup();
    await user.dblClick(screen.getByRole("button", { name: "Editor" }));
    expect(renameInput()).toBeInTheDocument();
    rerender(<PagesPanel pages={pages.filter((page) => page.id !== "p2")} onOpen={vi.fn()} onCreate={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} />);
    rerender(<PagesPanel pages={pages} onOpen={vi.fn()} onCreate={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("renders in pt-BR with the plural of agents", async () => {
    await i18n.changeLanguage("pt-BR");
    try {
      setup({ pages: [{ id: "p1", name: "Capa", agents: 1 }, { id: "p2", name: "Editor", agents: 3 }] });
      expect(screen.getByRole("heading", { level: 2, name: "Páginas" })).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "1 agente ativo nesta página" })).toBeInTheDocument();
      expect(screen.getByRole("img", { name: "3 agentes ativos nesta página" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Nova página" })).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("mirrors the layout in right-to-left with logical classes", () => {
    render(
      <div dir="rtl">
        <PagesPanel pages={pages} activePageId="p1" onOpen={vi.fn()} onCreate={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} />
      </div>,
    );
    const list = screen.getByRole("list");
    expect(list).toHaveClass("ps-2", "pe-3.5");
    expect(list.className).not.toMatch(/(^|\s)(pl|pr)-/);
    expect(screen.getByRole("button", { name: "Cover" }).closest("[role=listitem]")).toHaveClass("ps-3", "pe-2");
  });

  it("renders on the server", () => {
    const html = renderToString(<PagesPanel pages={pages} onOpen={vi.fn()} onCreate={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} />);
    expect(html).toContain("Cover");
  });
});
