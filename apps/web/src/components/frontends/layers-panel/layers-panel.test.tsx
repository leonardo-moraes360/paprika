import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { LayerRow, LayerTree } from "@/components/ui/layer-row";
import { LayersPanel, type LayerRowData, type LayersPanelProps } from "./index";

const base = { visible: true, locked: false, selected: false, hasChildren: false, level: 0 } as const;

const rows: LayerRowData[] = [
  { ...base, id: "home", name: "Home", kind: "frame", hasChildren: true, selected: true },
  { ...base, id: "nav", name: "Navigation", kind: "frame", level: 1, hasChildren: true },
  { ...base, id: "logo", name: "Logo", kind: "image", level: 2 },
  { ...base, id: "title", name: "Title", kind: "text", level: 1 },
  { ...base, id: "caption", name: "Caption", kind: "text", level: 1, visible: false },
  { ...base, id: "footer", name: "Footer", kind: "frame", level: 1, locked: true },
  { ...base, id: "about", name: "About", kind: "frame" },
];

function Owner(props: Omit<LayersPanelProps, "rows"> & { rows: readonly LayerRowData[] }) {
  const [selected, setSelected] = useState<string[]>(props.rows.filter((row) => row.selected).map((row) => row.id));
  return (
    <LayersPanel
      {...props}
      rows={props.rows.map((row) => ({ ...row, selected: selected.includes(row.id) }))}
      onSelect={(ids, mode) => {
        setSelected(ids);
        props.onSelect(ids, mode);
      }}
    />
  );
}

function setup(props: Partial<LayersPanelProps> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onRename: vi.fn(),
    onMove: vi.fn(),
    onToggleVisible: vi.fn(),
    onToggleLocked: vi.fn(),
  };
  const view = render(<Owner rows={rows} {...handlers} {...props} />);
  return { ...handlers, ...view };
}

const item = (name: string) => screen.getByRole("treeitem", { name });

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("LayersPanel", () => {
  describe("a click on the only selected layer", () => {
    const uiSdkWarnings = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter((call) => String(call[0]).includes("[ui-sdk]"));

    /** The library checks a second after the click that the value moved. The test takes that timer (it never fires by itself) and hands it back to run. */
    const clickHome = async () => {
      const user = userEvent.setup();
      const real = globalThis.setTimeout;
      const checks: (() => void)[] = [];
      const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void, ms?: number, ...args: unknown[]) => {
        if (ms === 1000) {
          checks.push(callback);
          return 0;
        }
        return real(callback, ms, ...args);
      }) as typeof setTimeout);
      await user.click(within(item("Home")).getByText("Home"));
      spy.mockRestore();
      return checks;
    };

    it("tells the tree the change did not happen when the owner answers false: the library has nothing to complain about", async () => {
      const onSelect = vi.fn(() => false);
      render(<LayersPanel rows={rows} onSelect={onSelect} onRename={vi.fn()} onMove={vi.fn()} onToggleVisible={vi.fn()} onToggleLocked={vi.fn()} />);
      const checks = await clickHome();
      expect(onSelect).toHaveBeenCalledWith([], "replace");
      expect(item("Home")).toHaveAttribute("aria-selected", "true");
      expect(checks).toEqual([]);
    });

    it("an owner that answers nothing and keeps the value does get the library's warning (what the answer is for)", async () => {
      render(<LayersPanel rows={rows} onSelect={vi.fn()} onRename={vi.fn()} onMove={vi.fn()} onToggleVisible={vi.fn()} onToggleLocked={vi.fn()} />);
      const checks = await clickHome();
      expect(checks).toHaveLength(1);
      expect(() => checks[0]?.()).toThrow(/\[ui-sdk\].*stayed/);
    });
  });

  it("renders the tree under a Layers heading with levels and the selection", () => {
    setup();
    expect(screen.getByRole("heading", { level: 2, name: "Layers" })).toBeInTheDocument();
    const tree = screen.getByRole("tree", { name: "Layer tree" });
    expect(within(tree).getAllByRole("treeitem")).toHaveLength(7);
    expect(item("Home")).toHaveAttribute("aria-selected", "true");
    expect(item("Navigation")).toHaveAttribute("aria-selected", "false");
    expect(item("Logo")).toHaveAttribute("aria-level", "3");
    expect(item("About")).toHaveAttribute("aria-level", "1");
  });

  it("lays the rows out every 30 px (28 tall and a 2 px gap), as in the design", () => {
    setup();
    const tree = screen.getByRole("tree", { name: "Layer tree" });
    const items = within(tree).getAllByRole("treeitem");
    expect(items.map((el) => el.style.top)).toEqual(items.map((_, index) => `${index * 30}px`));
    expect(items.every((el) => el.style.height === "28px")).toBe(true);
    expect(tree.style.height).toBe(`${items.length * 30}px`);
    // 14 px free on the right for the scroll bar.
    expect(tree.parentElement).toHaveClass("pe-3.5");
  });

  it("shows the empty message when there are no layers", () => {
    setup({ rows: [] });
    expect(screen.getByText("Empty. Draw a frame (F) or ask an agent through MCP.")).toBeInTheDocument();
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
  });

  it("selects with a click, toggles with Ctrl and extends with Shift", async () => {
    const user = userEvent.setup();
    const { onSelect } = setup({ rows: rows.map((row) => ({ ...row, selected: false })) });
    await user.click(within(item("Title")).getByText("Title"));
    expect(onSelect).toHaveBeenLastCalledWith(["title"], "replace");
    await user.keyboard("{Control>}");
    await user.click(within(item("About")).getByText("About"));
    await user.keyboard("{/Control}");
    expect(onSelect).toHaveBeenLastCalledWith(["title", "about"], "toggle");
    await user.keyboard("{Shift>}");
    await user.click(within(item("Footer")).getByText("Footer"));
    await user.keyboard("{/Shift}");
    expect(onSelect).toHaveBeenLastCalledWith(expect.arrayContaining(["about", "footer"]), "extend");
  });

  it("selects with the keyboard", async () => {
    const user = userEvent.setup();
    const { onSelect } = setup();
    item("Home").focus();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenLastCalledWith(["nav"], "replace");
  });

  it("collapses and expands a branch and reports the collapsed ids", async () => {
    const user = userEvent.setup();
    const onCollapsedChange = vi.fn();
    setup({ onCollapsedChange });
    const nav = item("Navigation");
    expect(nav).toHaveAttribute("aria-expanded", "true");
    nav.focus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.queryByRole("treeitem", { name: "Logo" })).not.toBeInTheDocument();
    expect(onCollapsedChange).toHaveBeenLastCalledWith(["nav"]);
    expect(item("Navigation")).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("treeitem", { name: "Logo" })).toBeInTheDocument();
    expect(onCollapsedChange).toHaveBeenLastCalledWith([]);
  });

  it("starts with the owner's collapsed branches and follows a controlled value", () => {
    const { rerender, ...rest } = setup({ collapsedIds: ["nav"] });
    expect(screen.queryByRole("treeitem", { name: "Logo" })).not.toBeInTheDocument();
    rerender(<Owner rows={rows} {...rest} collapsedIds={[]} />);
    expect(screen.getByRole("treeitem", { name: "Logo" })).toBeInTheDocument();
  });

  it("renames with F2 and Enter, then gives focus back to the layer", async () => {
    const user = userEvent.setup();
    const { onRename } = setup();
    item("Title").focus();
    await user.keyboard("{F2}");
    const input = screen.getByRole("textbox", { name: "Layer name" });
    expect(input).toHaveFocus();
    expect(input).toHaveValue("Title");
    await user.keyboard("{Control>}a{/Control}Heading{Enter}");
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith("title", "Heading");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(item("Title")).toHaveFocus();
  });

  it("renames on double click and cancels with Escape without emitting", async () => {
    const user = userEvent.setup();
    const { onRename } = setup();
    await user.dblClick(within(item("Title")).getByText("Title"));
    await user.keyboard("Other{Escape}");
    expect(onRename).not.toHaveBeenCalled();
    expect(item("Title")).toHaveFocus();
  });

  it("does not rename a layer the owner marked as read only", async () => {
    const user = userEvent.setup();
    setup({ rows: rows.map((row) => (row.id === "title" ? { ...row, renamable: false } : row)) });
    item("Title").focus();
    await user.keyboard("{F2}");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("moves the focused layer with Alt+arrows and emits the same intent as the drag", async () => {
    const user = userEvent.setup();
    const { onMove } = setup({ rows: rows.map((row) => ({ ...row, selected: false })) });
    item("Title").focus();
    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(onMove).toHaveBeenLastCalledWith({ ids: ["title"], targetId: "nav", position: "before" });
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(onMove).toHaveBeenLastCalledWith({ ids: ["title"], targetId: "caption", position: "after" });
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(onMove).toHaveBeenLastCalledWith({ ids: ["title"], targetId: "nav", position: "inside" });
    await user.keyboard("{Alt>}{ArrowLeft}{/Alt}");
    expect(onMove).toHaveBeenLastCalledWith({ ids: ["title"], targetId: "home", position: "after" });
    expect(item("Title")).toHaveFocus();
  });

  it("does nothing for an Alt+arrow that goes nowhere and keeps the focus on the layer", async () => {
    const user = userEvent.setup();
    const { onMove, onSelect } = setup({ rows: rows.map((row) => ({ ...row, selected: false })) });
    item("Home").focus();
    await user.keyboard("{Alt>}{ArrowUp}{ArrowLeft}{/Alt}");
    expect(onMove).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(item("Home")).toHaveFocus();
  });

  it("moves the whole selection with Alt+arrows", async () => {
    const user = userEvent.setup();
    const { onMove } = setup({ rows: rows.map((row) => ({ ...row, selected: row.id === "title" || row.id === "caption" })) });
    item("Title").focus();
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(onMove).toHaveBeenLastCalledWith({ ids: ["title", "caption"], targetId: "footer", position: "after" });
  });

  it("applies Ctrl+Shift+H and Ctrl+Shift+L to the whole selection", async () => {
    const user = userEvent.setup();
    const { onToggleVisible, onToggleLocked } = setup({ rows: rows.map((row) => ({ ...row, selected: row.id === "title" || row.id === "caption" })) });
    item("Title").focus();
    await user.keyboard("{Control>}{Shift>}h{/Shift}{/Control}");
    expect(onToggleVisible).toHaveBeenCalledOnce();
    expect(onToggleVisible).toHaveBeenCalledWith(["title", "caption"], true);
    await user.keyboard("{Control>}{Shift>}l{/Shift}{/Control}");
    expect(onToggleLocked).toHaveBeenCalledOnce();
    expect(onToggleLocked).toHaveBeenCalledWith(["title", "caption"], true);
  });

  it("applies the shortcut to the focused layer alone when it is outside the selection", async () => {
    const user = userEvent.setup();
    const { onToggleVisible } = setup({ rows: rows.map((row) => ({ ...row, selected: row.id === "title" })) });
    item("About").focus();
    await user.keyboard("{Control>}{Shift>}h{/Shift}{/Control}");
    expect(onToggleVisible).toHaveBeenCalledExactlyOnceWith(["about"], false);
  });

  it("keeps a lock column on rows without a lock button so the eye lines up", () => {
    setup({ rows: rows.map((row) => (row.id === "title" ? { ...row, lockable: false } : row)) });
    const eye = (name: string) => screen.getByRole("button", { name }).parentElement as HTMLElement;
    expect(eye("Hide Title").children).toHaveLength(eye("Hide Caption").children.length);
  });

  it("toggles visibility and lock from the row buttons", async () => {
    const user = userEvent.setup();
    const { onToggleVisible, onToggleLocked } = setup();
    await user.click(screen.getByRole("button", { name: "Hide Title" }));
    expect(onToggleVisible).toHaveBeenCalledWith(["title"], false);
    await user.click(screen.getByRole("button", { name: "Hide Caption" }));
    expect(onToggleVisible).toHaveBeenLastCalledWith(["caption"], true);
    await user.click(screen.getByRole("button", { name: "Lock Footer" }));
    expect(onToggleLocked).toHaveBeenCalledWith(["footer"], false);
  });

  it("omits the lock button for layers that cannot be locked", () => {
    setup({ rows: rows.map((row) => (row.id === "title" ? { ...row, lockable: false } : row)) });
    expect(screen.queryByRole("button", { name: "Lock Title" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lock Caption" })).toBeInTheDocument();
  });

  it("labels the agent that touched a layer", () => {
    setup({ rows: rows.map((row) => (row.id === "title" ? { ...row, agent: { name: "claude", tone: "agent-1" as const } } : row)) });
    expect(screen.getByRole("img", { name: "Last touched by claude" })).toBeInTheDocument();
  });

  it("opens the context menu on right click, selecting the layer first, and emits visibility", async () => {
    const user = userEvent.setup();
    const { onSelect, onToggleVisible } = setup();
    await user.pointer({ keys: "[MouseRight]", target: within(item("Title")).getByText("Title") });
    expect(onSelect).toHaveBeenLastCalledWith(["title"], "replace");
    const menu = await screen.findByRole("menu", { name: "Layer actions" });
    expect(within(menu).getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Lock" })).toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: "Hide" }));
    expect(onToggleVisible).toHaveBeenCalledWith(["title"], false);
  });

  it("applies the context menu to the whole selection when the layer is already selected", async () => {
    const user = userEvent.setup();
    const { onToggleLocked } = setup({ rows: rows.map((row) => ({ ...row, selected: row.id === "title" || row.id === "about" })) });
    await user.pointer({ keys: "[MouseRight]", target: within(item("Title")).getByText("Title") });
    const menu = await screen.findByRole("menu", { name: "Layer actions" });
    expect(within(menu).queryByRole("menuitem", { name: "Rename" })).not.toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: "Lock" }));
    expect(onToggleLocked).toHaveBeenCalledWith(["title", "about"], true);
  });

  it("starts a rename from the context menu and focuses the field", async () => {
    const user = userEvent.setup();
    setup();
    await user.pointer({ keys: "[MouseRight]", target: within(item("Title")).getByText("Title") });
    await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
    expect(await screen.findByRole("textbox", { name: "Layer name" })).toHaveFocus();
  });

  it("opens the context menu from the keyboard", async () => {
    const user = userEvent.setup();
    setup();
    item("Title").focus();
    await user.keyboard("{Shift>}{F10}{/Shift}");
    expect(await screen.findByRole("menu", { name: "Layer actions" })).toBeInTheDocument();
  });

  it("lists the owner's extra actions and emits them with the ids", async () => {
    const user = userEvent.setup();
    const onContextAction = vi.fn();
    const contextActions = vi.fn(() => [
      { id: "center", label: "Center content", checked: true, separatorBefore: true },
      { id: "convert", label: "Convert to path" },
    ]);
    setup({ onContextAction, contextActions });
    await user.pointer({ keys: "[MouseRight]", target: within(item("Title")).getByText("Title") });
    const menu = await screen.findByRole("menu", { name: "Layer actions" });
    expect(contextActions).toHaveBeenCalledWith(["title"]);
    expect(within(menu).getByRole("menuitemcheckbox", { name: "Center content" })).toBeChecked();
    await user.click(within(menu).getByRole("menuitem", { name: "Convert to path" }));
    expect(onContextAction).toHaveBeenCalledWith("convert", ["title"]);
  });

  it("reveals every hidden or locked layer from the section menu", async () => {
    const user = userEvent.setup();
    const onRevealAll = vi.fn();
    setup({ onRevealAll });
    await user.click(screen.getByRole("button", { name: "More layer actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Show all hidden layers" }));
    expect(onRevealAll).toHaveBeenLastCalledWith("hidden");
    await user.click(screen.getByRole("button", { name: "More layer actions" }));
    await user.click(await screen.findByRole("menuitem", { name: "Unlock all locked layers" }));
    expect(onRevealAll).toHaveBeenLastCalledWith("locked");
  });

  it("disables the reveal actions when nothing is hidden or locked", async () => {
    const user = userEvent.setup();
    setup({ rows: rows.map((row) => ({ ...row, visible: true, locked: false })), onRevealAll: vi.fn() });
    await user.click(screen.getByRole("button", { name: "More layer actions" }));
    expect(await screen.findByRole("menuitem", { name: "Show all hidden layers" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menuitem", { name: "Unlock all locked layers" })).toHaveAttribute("aria-disabled", "true");
  });

  it("collapses the whole section and remembers it under the storage key", async () => {
    const user = userEvent.setup();
    const { unmount } = setup({ storageKey: "test.layers.open" });
    await user.click(screen.getByRole("button", { name: "Layers" }));
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
    unmount();
    setup({ storageKey: "test.layers.open" });
    expect(screen.queryByRole("tree")).not.toBeInTheDocument();
  });

  it("renders only the rows near the viewport when the list is long and moves focus through it", async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(280);
    const many: LayerRowData[] = Array.from({ length: 600 }, (_, index) => ({ ...base, id: `n${index}`, name: `Layer ${index}`, kind: "rect" as const }));
    setup({ rows: many });
    const rendered = screen.getAllByRole("treeitem");
    expect(rendered.length).toBeGreaterThan(0);
    expect(rendered.length).toBeLessThan(40);
    expect(screen.getByRole("treeitem", { name: "Layer 0" })).toHaveAttribute("aria-setsize", "600");
    const first = screen.getByRole("treeitem", { name: "Layer 0" });
    first.focus();
    expect(first).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("treeitem", { name: "Layer 1" })).toHaveFocus();
  });

  it("renders in Portuguese", async () => {
    await i18n.changeLanguage("pt-BR");
    setup({ rows: rows.map((row) => (row.id === "title" ? { ...row, agent: { name: "claude", tone: "agent-2" as const } } : row)) });
    expect(screen.getByRole("heading", { level: 2, name: "Camadas" })).toBeInTheDocument();
    expect(screen.getByRole("tree", { name: "Árvore de camadas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ocultar Title" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Última alteração de claude" })).toBeInTheDocument();
  });

  it("indents and keeps the controls on the logical sides in a right-to-left page", async () => {
    const user = userEvent.setup();
    const { onToggleVisible } = (() => {
      const handlers = { onSelect: vi.fn(), onRename: vi.fn(), onMove: vi.fn(), onToggleVisible: vi.fn(), onToggleLocked: vi.fn() };
      render(
        <div dir="rtl">
          <LayersPanel rows={rows} {...handlers} />
        </div>,
      );
      return handlers;
    })();
    expect(item("Logo")).toHaveAttribute("aria-level", "3");
    await user.click(screen.getByRole("button", { name: "Hide Title" }));
    expect(onToggleVisible).toHaveBeenCalledWith(["title"], false);
  });

  describe("drag and drop", () => {
    const pointAt = (el: Element) => {
      Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => el.firstElementChild });
      Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: () => [el.firstElementChild] });
    };
    afterEach(() => {
      Reflect.deleteProperty(document, "elementFromPoint");
      Reflect.deleteProperty(document, "elementsFromPoint");
    });
    const frame = (rowEl: Element, index: number) => {
      const top = index * 28;
      vi.spyOn(rowEl, "getBoundingClientRect").mockReturnValue({ top, bottom: top + 28, left: 0, right: 200, width: 200, height: 28, x: 0, y: top, toJSON: () => ({}) });
    };

    async function drag(from: string, to: string, fraction: number, finish: "up" | "escape" = "up") {
      const source = item(from);
      const target = item(to);
      const all = screen.getAllByRole("treeitem");
      all.forEach((el, index) => frame(el, index));
      const targetBox = target.getBoundingClientRect();
      const y = targetBox.top + targetBox.height * fraction;
      source.setPointerCapture = vi.fn();
      source.releasePointerCapture = vi.fn();
      pointAt(target);
      const label = within(source).getByText(from);
      fireEvent.pointerDown(label, { pointerId: 1, isPrimary: true, button: 0, clientX: 40, clientY: 10, pointerType: "mouse" });
      await act(async () => {
        fireEvent.pointerMove(source, { pointerId: 1, isPrimary: true, clientX: 60, clientY: y, pointerType: "mouse", buttons: 1 });
        await new Promise((resolve) => setTimeout(resolve, 40));
      });
      expect(document.querySelector('[data-slot="drag-overlay"], [data-mode]:not([data-mode="none"])')).not.toBeNull();
      if (finish === "escape") fireEvent.keyDown(document, { key: "Escape" });
      else fireEvent.pointerUp(source, { pointerId: 1, isPrimary: true, clientX: 60, clientY: y, pointerType: "mouse" });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }

    it("moves a layer before, after or inside another and emits the intent", async () => {
      const { onMove } = setup({ rows: rows.map((row) => ({ ...row, selected: false })) });
      await drag("Title", "About", 0.1);
      expect(onMove).toHaveBeenLastCalledWith({ ids: ["title"], targetId: "about", position: "before" });
      await drag("Title", "About", 0.9);
      expect(onMove).toHaveBeenLastCalledWith({ ids: ["title"], targetId: "about", position: "after" });
      await drag("Title", "Footer", 0.5);
      expect(onMove).toHaveBeenLastCalledWith({ ids: ["title"], targetId: "footer", position: "inside" });
    });

    it("drops nothing when the owner removed the target during the drag", async () => {
      const unselected = rows.map((row) => ({ ...row, selected: false }));
      const { onMove, rerender, onSelect, onRename, onToggleVisible, onToggleLocked } = setup({ rows: unselected });
      const source = item("Title");
      screen.getAllByRole("treeitem").forEach((el, index) => frame(el, index));
      source.setPointerCapture = vi.fn();
      source.releasePointerCapture = vi.fn();
      pointAt(item("About"));
      const y = item("About").getBoundingClientRect().top + 25;
      fireEvent.pointerDown(within(source).getByText("Title"), { pointerId: 1, isPrimary: true, button: 0, clientX: 40, clientY: 10, pointerType: "mouse" });
      await act(async () => {
        fireEvent.pointerMove(source, { pointerId: 1, isPrimary: true, clientX: 60, clientY: y, pointerType: "mouse", buttons: 1 });
        await new Promise((resolve) => setTimeout(resolve, 40));
      });
      rerender(<Owner rows={unselected.filter((row) => row.id !== "about")} {...{ onMove, onSelect, onRename, onToggleVisible, onToggleLocked }} />);
      fireEvent.pointerUp(source, { pointerId: 1, isPrimary: true, clientX: 60, clientY: y, pointerType: "mouse" });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(onMove).not.toHaveBeenCalled();
    });

    it("moves the whole selection when a selected layer is dragged", async () => {
      const { onMove } = setup({ rows: rows.map((row) => ({ ...row, selected: row.id === "title" || row.id === "caption" })) });
      await drag("Title", "About", 0.9);
      expect(onMove).toHaveBeenCalledWith({ ids: ["title", "caption"], targetId: "about", position: "after" });
    });

    it("does not drop a layer into itself or its descendants", async () => {
      const { onMove } = setup({ rows: rows.map((row) => ({ ...row, selected: false })) });
      const source = item("Navigation");
      const target = item("Logo");
      screen.getAllByRole("treeitem").forEach((el, index) => frame(el, index));
      source.setPointerCapture = vi.fn();
      pointAt(target);
      fireEvent.pointerDown(within(source).getByText("Navigation"), { pointerId: 1, isPrimary: true, button: 0, clientX: 40, clientY: 10 });
      await act(async () => {
        fireEvent.pointerMove(source, { pointerId: 1, isPrimary: true, clientX: 60, clientY: 70, buttons: 1 });
        await new Promise((resolve) => setTimeout(resolve, 40));
        fireEvent.pointerUp(source, { pointerId: 1, isPrimary: true, clientX: 60, clientY: 70 });
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(onMove).not.toHaveBeenCalled();
    });

    it("cancels with Escape without emitting", async () => {
      const { onMove } = setup({ rows: rows.map((row) => ({ ...row, selected: false })) });
      await drag("Title", "About", 0.9, "escape");
      expect(onMove).not.toHaveBeenCalled();
    });

    it("does not drag a layer the owner marked as fixed", async () => {
      const { onMove } = setup({ rows: rows.map((row) => ({ ...row, selected: false, draggable: row.id === "title" ? false : undefined })) });
      const source = item("Title");
      fireEvent.pointerDown(within(source).getByText("Title"), { pointerId: 1, isPrimary: true, button: 0, clientX: 40, clientY: 10 });
      fireEvent.pointerMove(source, { pointerId: 1, isPrimary: true, clientX: 60, clientY: 90 });
      fireEvent.pointerUp(source, { pointerId: 1, isPrimary: true, clientX: 60, clientY: 90 });
      expect(onMove).not.toHaveBeenCalled();
    });
  });
});

describe("LayerRow rename contract", () => {
  function row(onRename: (name: string) => void, onRenameCancel: () => void) {
    return render(
      <LayerTree aria-label="t" items={[{ value: "a", label: "A" }]}>
        <LayerRow value="a" name="A" icon={null} renaming hideLabel="hide" lockLabel="lock" renameLabel="name" onRename={onRename} onRenameCancel={onRenameCancel} />
      </LayerTree>,
    );
  }

  it("calls onRename once even when Enter is followed by the blur", () => {
    const onRename = vi.fn();
    row(onRename, vi.fn());
    const input = screen.getByRole("textbox", { name: "name" });
    fireEvent.change(input, { target: { value: "B" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledExactlyOnceWith("B");
  });

  it("does not commit on the blur that follows Escape", () => {
    const onRename = vi.fn();
    const onRenameCancel = vi.fn();
    row(onRename, onRenameCancel);
    const input = screen.getByRole("textbox", { name: "name" });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(onRenameCancel).toHaveBeenCalledOnce();
    expect(onRename).not.toHaveBeenCalled();
  });
});
