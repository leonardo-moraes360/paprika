import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Circle, Diamond, MousePointer2, Shapes, Square, Type } from "lucide-react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { readPersisted } from "@/lib/persist";
import { Toolbar, type ToolbarProps, type ToolbarTool } from "./index";

const tools: ToolbarTool[] = [
  { id: "select", label: "Select", icon: <MousePointer2 />, hotkey: "V" },
  { id: "rect", label: "Rectangle", icon: <Square />, hotkey: "R" },
  { id: "ellipse", label: "Ellipse", icon: <Circle />, hotkey: "O" },
  { id: "text", label: "Text", icon: <Type />, hotkey: "T" },
  {
    id: "shapes",
    label: "Diagram shapes",
    icon: <Shapes />,
    hotkey: "D",
    separatorBefore: true,
    options: [
      { id: "box", label: "Box", icon: <Square /> },
      { id: "decision", label: "Decision", icon: <Diamond /> },
    ],
  },
];

function setup(props: Partial<ToolbarProps> = {}) {
  const handlers = { onValueChange: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onHistory: vi.fn(), onImport: vi.fn(), onExport: vi.fn(), onDockChange: vi.fn() };
  const view = render(
    <div className="relative" data-testid="stage">
      <Toolbar tools={tools} value="select" {...handlers} {...props} />
    </div>,
  );
  return { ...handlers, ...view };
}

const tool = (name: string) => screen.getByRole("button", { name });
const root = () => screen.getByRole("toolbar", { name: "Tools" }).parentElement as HTMLElement;

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("Toolbar", () => {
  it("renders the tools as toggle buttons and marks the active one", () => {
    setup({ value: "rect" });
    expect(screen.getByRole("toolbar", { name: "Tools" })).toHaveAttribute("aria-orientation", "horizontal");
    expect(tool("Rectangle")).toHaveAttribute("aria-pressed", "true");
    expect(tool("Select")).toHaveAttribute("aria-pressed", "false");
    expect(tool("Move toolbar")).toBeInTheDocument();
    expect(tool("More actions")).toBeInTheDocument();
  });

  it("emits the chosen tool", async () => {
    const user = userEvent.setup();
    const { onValueChange } = setup();
    await user.click(tool("Ellipse"));
    expect(onValueChange).toHaveBeenCalledWith("ellipse");
  });

  it("does not emit when the active tool is pressed again", async () => {
    const user = userEvent.setup();
    const { onValueChange } = setup();
    await user.click(tool("Select"));
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("picks a tool with its key while focus is inside the toolbar", async () => {
    const user = userEvent.setup();
    const { onValueChange } = setup();
    tool("Select").focus();
    await user.keyboard("t");
    expect(onValueChange).toHaveBeenCalledWith("text");
  });

  it("does not listen to keys outside its element", async () => {
    const user = userEvent.setup();
    const { onValueChange, onUndo } = setup();
    await user.click(document.body);
    await user.keyboard("t");
    await user.keyboard("{Control>}z{/Control}");
    expect(onValueChange).not.toHaveBeenCalled();
    expect(onUndo).not.toHaveBeenCalled();
  });

  it("listens on the owner's element when it passes a shortcut target", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    function Owner() {
      const area = useRef<HTMLDivElement>(null);
      return (
        <div ref={area} tabIndex={0} data-testid="area">
          <Toolbar tools={tools} value="select" onValueChange={onValueChange} shortcutTarget={area} />
        </div>
      );
    }
    render(<Owner />);
    screen.getByTestId("area").focus();
    await user.keyboard("o");
    expect(onValueChange).toHaveBeenCalledWith("ellipse");
  });

  it("listens on the element the toolbar is docked in when the owner passes no target", async () => {
    const user = userEvent.setup();
    const { onValueChange } = setup();
    const stage = screen.getByTestId("stage");
    stage.tabIndex = 0;
    stage.focus();
    await user.keyboard("t");
    expect(onValueChange).toHaveBeenCalledWith("text");
  });

  it("leaves the browser shortcuts alone for the actions the owner did not wire", () => {
    const { onHistory } = setup({ onImport: undefined, onExport: undefined, onUndo: undefined });
    tool("Select").focus();
    const press = (key: string) => {
      const event = new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true });
      tool("Select").dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(press("o")).toBe(false);
    expect(press("e")).toBe(false);
    expect(press("z")).toBe(false);
    expect(press("h")).toBe(true);
    expect(onHistory).toHaveBeenCalledOnce();
  });

  it("opens the position menu from the grip with Enter and moves the dock from the keyboard", async () => {
    const user = userEvent.setup();
    const { onDockChange } = setup();
    tool("Move toolbar").focus();
    await user.keyboard("{Enter}");
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("Toolbar position")).toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitemradio", { name: "Left" }));
    expect(onDockChange).toHaveBeenCalledWith("left");
  });

  it("does not open the position menu when the grip is clicked with the mouse", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(tool("Move toolbar"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("turns the keys off with shortcuts=false", async () => {
    const user = userEvent.setup();
    const { onValueChange } = setup({ shortcuts: false });
    tool("Select").focus();
    await user.keyboard("t");
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("opens the shapes submenu, emits the option and closes it", async () => {
    const user = userEvent.setup();
    const { onValueChange } = setup();
    await user.click(tool("Diagram shapes"));
    const group = await screen.findByRole("dialog", { name: "Diagram shapes" });
    await user.click(within(group).getByRole("button", { name: "Decision" }));
    expect(onValueChange).toHaveBeenCalledWith("decision");
    expect(screen.queryByRole("dialog", { name: "Diagram shapes" })).not.toBeInTheDocument();
    expect(tool("Diagram shapes")).toHaveFocus();
  });

  it("shows the shapes button as active and remembers the last shape for its key", async () => {
    const user = userEvent.setup();
    const { onValueChange, rerender } = setup({ value: "decision" });
    expect(tool("Diagram shapes")).toHaveAttribute("data-active");
    tool("Select").focus();
    await user.keyboard("d");
    expect(onValueChange).toHaveBeenLastCalledWith("box");
    await user.click(tool("Diagram shapes"));
    await user.click(await screen.findByRole("button", { name: "Decision" }));
    expect(onValueChange).toHaveBeenLastCalledWith("decision");
    rerender(
      <div className="relative" data-testid="stage">
        <Toolbar tools={tools} value="select" onValueChange={onValueChange} />
      </div>,
    );
    tool("Select").focus();
    await user.keyboard("d");
    expect(onValueChange).toHaveBeenLastCalledWith("decision");
  });

  it("undoes and redoes from the more menu and disables them when unavailable", async () => {
    const user = userEvent.setup();
    const { onUndo, onRedo, onHistory } = setup({ canRedo: false });
    await user.click(tool("More actions"));
    expect(await screen.findByRole("menuitem", { name: "Redo" })).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("menuitem", { name: "Undo" }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(tool("More actions")).toHaveFocus();
    await user.click(tool("More actions"));
    await user.click(await screen.findByRole("menuitem", { name: "Redo" }));
    expect(onRedo).not.toHaveBeenCalled();
    await user.click(screen.getByRole("menuitem", { name: "History" }));
    expect(onHistory).toHaveBeenCalledOnce();
  });

  it("imports and exports from the more menu", async () => {
    const user = userEvent.setup();
    const { onImport, onExport } = setup();
    await user.click(tool("More actions"));
    await user.click(await screen.findByRole("menuitem", { name: "Import…" }));
    await user.click(tool("More actions"));
    await user.click(await screen.findByRole("menuitem", { name: "Export…" }));
    expect(onImport).toHaveBeenCalledOnce();
    expect(onExport).toHaveBeenCalledOnce();
  });

  it("undoes with the keyboard inside the toolbar", async () => {
    const user = userEvent.setup();
    const { onUndo, onRedo } = setup();
    tool("Select").focus();
    await user.keyboard("{Control>}z{/Control}");
    await user.keyboard("{Control>}y{/Control}");
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onRedo).toHaveBeenCalledOnce();
  });

  it("ignores the undo and redo keys when there is nothing to undo or redo", async () => {
    const user = userEvent.setup();
    const { onUndo, onRedo } = setup({ canUndo: false, canRedo: false });
    tool("Select").focus();
    await user.keyboard("{Control>}z{/Control}");
    await user.keyboard("{Control>}y{/Control}");
    expect(onUndo).not.toHaveBeenCalled();
    expect(onRedo).not.toHaveBeenCalled();
  });

  it("docks from the menu, persists the choice and turns vertical", async () => {
    const user = userEvent.setup();
    const { onDockChange } = setup({ storageKey: "test.toolbar.dock" });
    expect(root()).toHaveAttribute("data-dock", "top");
    await user.click(tool("More actions"));
    await user.click(await screen.findByRole("menuitemradio", { name: "Left" }));
    expect(onDockChange).toHaveBeenCalledWith("left");
    expect(root()).toHaveAttribute("data-dock", "left");
    expect(screen.getByRole("toolbar", { name: "Tools" })).toHaveAttribute("aria-orientation", "vertical");
    expect(readPersisted("test.toolbar.dock")).toBe("left");
  });

  it("starts from the persisted dock", () => {
    window.localStorage.setItem("paprika.test.toolbar.dock", "right");
    setup({ storageKey: "test.toolbar.dock" });
    expect(root()).toHaveAttribute("data-dock", "right");
  });

  it("ignores a persisted dock that is not valid", () => {
    window.localStorage.setItem("paprika.test.toolbar.dock", "middle");
    setup({ storageKey: "test.toolbar.dock", defaultDock: "bottom" });
    expect(root()).toHaveAttribute("data-dock", "bottom");
  });

  it("follows a controlled dock and neither persists nor changes by itself", async () => {
    const user = userEvent.setup();
    const { onDockChange } = setup({ dock: "bottom", storageKey: "test.toolbar.dock" });
    await user.click(tool("More actions"));
    await user.click(await screen.findByRole("menuitemradio", { name: "Right" }));
    expect(onDockChange).toHaveBeenCalledWith("right");
    expect(root()).toHaveAttribute("data-dock", "bottom");
    expect(readPersisted("test.toolbar.dock")).toBeNull();
  });

  describe("dragging the grip", () => {
    const stage = () => screen.getByTestId("stage");
    const mockStage = () =>
      vi.spyOn(stage(), "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, x: 0, y: 0, toJSON: () => ({}) });

    async function drag(to: { x: number; y: number }, finish: "up" | "escape" = "up") {
      const grip = tool("Move toolbar");
      grip.setPointerCapture = vi.fn();
      grip.releasePointerCapture = vi.fn();
      fireEvent.pointerDown(grip, { pointerId: 1, isPrimary: true, button: 0, clientX: 500, clientY: 20, pointerType: "mouse" });
      await act(async () => {
        fireEvent.pointerMove(grip, { pointerId: 1, isPrimary: true, clientX: to.x, clientY: to.y, pointerType: "mouse", buttons: 1 });
        await new Promise((resolve) => setTimeout(resolve, 40));
      });
      const during = { transform: root().style.transform, snap: (root().previousElementSibling as HTMLElement).dataset.snap };
      if (finish === "escape") fireEvent.keyDown(document, { key: "Escape" });
      else fireEvent.pointerUp(grip, { pointerId: 1, isPrimary: true, clientX: to.x, clientY: to.y, pointerType: "mouse" });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      return during;
    }

    it("follows the pointer without emitting and docks to the nearest edge on release", async () => {
      const { onDockChange } = setup();
      mockStage();
      const during = await drag({ x: 30, y: 300 });
      expect(during.transform).toBe("translate(-470px, 280px)");
      expect(during.snap).toBe("left");
      expect(onDockChange).toHaveBeenCalledTimes(1);
      expect(onDockChange).toHaveBeenCalledWith("left");
      expect(root().style.transform).toBe("");
      expect(root()).toHaveAttribute("data-dock", "left");
      expect(tool("Move toolbar")).toBeInTheDocument();
    });

    it("docks on the right edge and on the bottom edge", async () => {
      const { onDockChange } = setup();
      mockStage();
      await drag({ x: 980, y: 300 });
      expect(onDockChange).toHaveBeenLastCalledWith("right");
      await drag({ x: 500, y: 590 });
      expect(onDockChange).toHaveBeenLastCalledWith("bottom");
    });

    it("puts the toolbar back with Escape", async () => {
      const { onDockChange } = setup();
      mockStage();
      await drag({ x: 30, y: 300 }, "escape");
      expect(onDockChange).not.toHaveBeenCalled();
      expect(root().style.transform).toBe("");
      expect(root()).toHaveAttribute("data-dock", "top");
    });

    it("does not emit when released on the current edge", async () => {
      const { onDockChange } = setup();
      mockStage();
      await drag({ x: 520, y: 8 });
      expect(onDockChange).not.toHaveBeenCalled();
    });
  });

  it("renders in Portuguese", async () => {
    await i18n.changeLanguage("pt-BR");
    const user = userEvent.setup();
    setup();
    expect(screen.getByRole("toolbar", { name: "Ferramentas" })).toBeInTheDocument();
    await user.click(tool("Mais ações"));
    expect(await screen.findByRole("menuitem", { name: "Desfazer" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "Esquerda" })).toBeInTheDocument();
  });

  it("keeps physical docks in a right-to-left page", () => {
    render(
      <div dir="rtl" className="relative">
        <Toolbar tools={tools} value="select" onValueChange={vi.fn()} dock="left" />
      </div>,
    );
    expect(root()).toHaveAttribute("data-dock", "left");
    expect(root().className).toContain("left-4");
  });
});
