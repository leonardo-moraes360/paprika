import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SidePanel, type SidePanelProps } from "./index";

function setup(props: Partial<SidePanelProps> = {}) {
  return render(
    <SidePanel side="left" name="layers" {...props}>
      <p>content</p>
    </SidePanel>,
  );
}

const separator = () => screen.getByRole("separator");
const handle = () => screen.getByRole("button", { name: /layers panel/ });
const stored = (key: string) => window.localStorage.getItem(`paprika.${key}`);

describe("SidePanel", () => {
  it("renders the content in a named region with the design widths", () => {
    setup();
    expect(screen.getByRole("complementary", { name: "layers panel" })).toHaveTextContent("content");
    expect(separator()).toHaveAttribute("aria-valuenow", "248");
    expect(separator()).toHaveAttribute("aria-valuemin", "200");
    expect(separator()).toHaveAttribute("aria-valuemax", "480");
    expect(separator()).toHaveAttribute("aria-orientation", "vertical");
    expect(separator()).toHaveAccessibleName("Resize layers panel");
    expect(separator()).toHaveAttribute("aria-controls", screen.getByRole("complementary").id);
  });

  it("uses the right side defaults and limits", () => {
    setup({ side: "right", name: "properties" });
    expect(separator()).toHaveAttribute("aria-valuenow", "320");
    expect(separator()).toHaveAttribute("aria-valuemin", "240");
    expect(separator()).toHaveAttribute("aria-valuemax", "480");
  });

  it("moves with the arrows, Shift, Home and End on the left side", async () => {
    const user = userEvent.setup();
    const onWidthChange = vi.fn();
    setup({ onWidthChange });
    separator().focus();
    await user.keyboard("{ArrowRight}");
    expect(separator()).toHaveAttribute("aria-valuenow", "264");
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(separator()).toHaveAttribute("aria-valuenow", "232");
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(separator()).toHaveAttribute("aria-valuenow", "296");
    await user.keyboard("{Home}");
    expect(separator()).toHaveAttribute("aria-valuenow", "200");
    await user.keyboard("{ArrowLeft}");
    expect(separator()).toHaveAttribute("aria-valuenow", "200");
    await user.keyboard("{End}");
    expect(separator()).toHaveAttribute("aria-valuenow", "480");
    expect(onWidthChange).toHaveBeenLastCalledWith(480);
  });

  it("grows to the left with ArrowLeft on the right side", async () => {
    const user = userEvent.setup();
    setup({ side: "right", name: "properties" });
    separator().focus();
    await user.keyboard("{ArrowLeft}");
    expect(separator()).toHaveAttribute("aria-valuenow", "336");
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(separator()).toHaveAttribute("aria-valuenow", "304");
  });

  it("ignores other keys", async () => {
    const user = userEvent.setup();
    const onWidthChange = vi.fn();
    setup({ onWidthChange });
    separator().focus();
    await user.keyboard("{ArrowUp}a");
    expect(onWidthChange).not.toHaveBeenCalled();
  });

  it("collapses with Enter on the separator and hands focus to the handle", async () => {
    const user = userEvent.setup();
    const onCollapsedChange = vi.fn();
    setup({ onCollapsedChange });
    separator().focus();
    await user.keyboard("{Enter}");
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
    expect(handle()).toHaveAttribute("aria-expanded", "false");
    expect(handle()).toHaveAccessibleName("Show layers panel");
    await vi.waitFor(() => expect(handle()).toHaveFocus());
  });

  it("collapses and expands with the handle and hides the content while collapsed", async () => {
    const user = userEvent.setup();
    const onCollapsedChange = vi.fn();
    const { container } = setup({ onCollapsedChange });
    expect(handle()).toHaveAttribute("aria-expanded", "true");
    expect(handle()).toHaveAccessibleName("Hide layers panel");
    expect(handle()).toHaveAttribute("aria-controls", container.querySelector("aside")!.id);
    await user.click(handle());
    expect(container.querySelector("aside")).toHaveAttribute("inert");
    await user.click(handle());
    expect(container.querySelector("aside")).not.toHaveAttribute("inert");
    expect(separator()).toHaveAttribute("aria-valuenow", "248");
    expect(onCollapsedChange.mock.calls).toEqual([[true], [false]]);
  });

  it("resizes by dragging the separator and clamps to the limits", () => {
    const onWidthChange = vi.fn();
    setup({ onWidthChange });
    fireEvent.pointerDown(separator(), { clientX: 248, pointerId: 1, button: 0 });
    fireEvent.pointerMove(separator(), { clientX: 300, pointerId: 1 });
    expect(separator()).toHaveAttribute("aria-valuenow", "300");
    fireEvent.pointerMove(separator(), { clientX: 900, pointerId: 1 });
    expect(separator()).toHaveAttribute("aria-valuenow", "480");
    fireEvent.pointerMove(separator(), { clientX: 230, pointerId: 1 });
    expect(separator()).toHaveAttribute("aria-valuenow", "230");
    fireEvent.pointerUp(separator(), { clientX: 230, pointerId: 1 });
    fireEvent.pointerMove(separator(), { clientX: 400, pointerId: 1 });
    expect(separator()).toHaveAttribute("aria-valuenow", "230");
    expect(onWidthChange).toHaveBeenLastCalledWith(230);
  });

  it("inverts the drag direction on the right side", () => {
    setup({ side: "right", name: "properties" });
    fireEvent.pointerDown(separator(), { clientX: 500, pointerId: 1, button: 0 });
    fireEvent.pointerMove(separator(), { clientX: 450, pointerId: 1 });
    expect(separator()).toHaveAttribute("aria-valuenow", "370");
    fireEvent.pointerUp(separator(), { clientX: 450, pointerId: 1 });
  });

  it("ignores a drag started with another button", () => {
    setup();
    fireEvent.pointerDown(separator(), { clientX: 248, pointerId: 1, button: 2 });
    fireEvent.pointerMove(separator(), { clientX: 300, pointerId: 1 });
    expect(separator()).toHaveAttribute("aria-valuenow", "248");
  });

  it("collapses when dragged well below the minimum and keeps the previous width", async () => {
    const user = userEvent.setup();
    const onCollapsedChange = vi.fn();
    setup({ onCollapsedChange });
    fireEvent.pointerDown(separator(), { clientX: 248, pointerId: 1, button: 0 });
    fireEvent.pointerMove(separator(), { clientX: 100, pointerId: 1 });
    expect(separator()).toHaveAttribute("aria-valuenow", "200");
    fireEvent.pointerUp(separator(), { clientX: 100, pointerId: 1 });
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    expect(handle()).toHaveAttribute("aria-expanded", "false");
    await user.click(handle());
    expect(separator()).toHaveAttribute("aria-valuenow", "248");
  });

  it("does not collapse for a drag just under the minimum", () => {
    const onCollapsedChange = vi.fn();
    setup({ onCollapsedChange });
    fireEvent.pointerDown(separator(), { clientX: 248, pointerId: 1, button: 0 });
    fireEvent.pointerMove(separator(), { clientX: 190, pointerId: 1 });
    fireEvent.pointerUp(separator(), { clientX: 190, pointerId: 1 });
    expect(onCollapsedChange).not.toHaveBeenCalled();
    expect(separator()).toHaveAttribute("aria-valuenow", "200");
  });

  it("goes back to the initial width on double click", async () => {
    const user = userEvent.setup();
    setup({ initialWidth: 260 });
    separator().focus();
    await user.keyboard("{End}");
    await user.dblClick(separator());
    expect(separator()).toHaveAttribute("aria-valuenow", "260");
  });

  it("honors the limits given by props", async () => {
    const user = userEvent.setup();
    setup({ minWidth: 100, maxWidth: 150, initialWidth: 400 });
    expect(separator()).toHaveAttribute("aria-valuenow", "150");
    separator().focus();
    await user.keyboard("{Home}");
    expect(separator()).toHaveAttribute("aria-valuenow", "100");
  });

  it("persists width and collapsed under the storage key and restores them", async () => {
    const user = userEvent.setup();
    const first = setup({ storageKey: "test.layers" });
    separator().focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(stored("test.layers")).toBe("280");
    await user.click(handle());
    expect(stored("test.layers.collapsed")).toBe("1");
    first.unmount();

    setup({ storageKey: "test.layers" });
    expect(handle()).toHaveAttribute("aria-expanded", "false");
    await user.click(handle());
    expect(separator()).toHaveAttribute("aria-valuenow", "280");
    expect(stored("test.layers.collapsed")).toBe("0");
  });

  it("persists a drag only when it ends", () => {
    setup({ storageKey: "test.drag" });
    fireEvent.pointerDown(separator(), { clientX: 248, pointerId: 1, button: 0 });
    fireEvent.pointerMove(separator(), { clientX: 320, pointerId: 1 });
    expect(stored("test.drag")).toBeNull();
    fireEvent.pointerUp(separator(), { clientX: 320, pointerId: 1 });
    expect(stored("test.drag")).toBe("320");
  });

  it("clamps and survives a bad stored value", () => {
    window.localStorage.setItem("paprika.test.big", "9999");
    window.localStorage.setItem("paprika.test.bad", "wide");
    const first = setup({ storageKey: "test.big" });
    expect(separator()).toHaveAttribute("aria-valuenow", "480");
    first.unmount();
    setup({ storageKey: "test.bad" });
    expect(separator()).toHaveAttribute("aria-valuenow", "248");
  });

  it("works when storage is blocked", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    setup({ storageKey: "test.blocked" });
    separator().focus();
    await user.keyboard("{ArrowRight}");
    expect(separator()).toHaveAttribute("aria-valuenow", "264");
    spy.mockRestore();
  });

  it("does not persist what the owner controls", async () => {
    const user = userEvent.setup();
    setup({ storageKey: "test.controlled", width: 300, collapsed: false });
    separator().focus();
    await user.keyboard("{ArrowRight}");
    await user.click(handle());
    expect(stored("test.controlled")).toBeNull();
    expect(stored("test.controlled.collapsed")).toBeNull();
  });

  it("follows controlled width and collapsed and reports the requests", async () => {
    const user = userEvent.setup();
    const onWidthChange = vi.fn();
    const onCollapsedChange = vi.fn();
    const view = setup({ width: 300, collapsed: false, onWidthChange, onCollapsedChange });
    expect(separator()).toHaveAttribute("aria-valuenow", "300");
    separator().focus();
    await user.keyboard("{ArrowRight}");
    expect(onWidthChange).toHaveBeenCalledWith(316);
    expect(separator()).toHaveAttribute("aria-valuenow", "300");
    await user.click(handle());
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
    expect(handle()).toHaveAttribute("aria-expanded", "true");
    view.rerender(
      <SidePanel side="left" name="layers" width={350} collapsed onWidthChange={onWidthChange} onCollapsedChange={onCollapsedChange}>
        <p>content</p>
      </SidePanel>,
    );
    expect(handle()).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  it("keeps the state of each instance apart", async () => {
    const user = userEvent.setup();
    render(
      <>
        <SidePanel side="left" name="one">
          <p>a</p>
        </SidePanel>
        <SidePanel side="right" name="two">
          <p>b</p>
        </SidePanel>
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Hide one panel" }));
    expect(screen.getByRole("button", { name: "Show one panel" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Hide two panel" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("separator")).toHaveLength(1);
  });
});
