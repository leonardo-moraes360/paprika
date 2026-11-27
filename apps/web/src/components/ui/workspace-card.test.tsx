import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceCard } from "./workspace-card";

function setup() {
  const onRename = vi.fn();
  const onRenameCancel = vi.fn();
  const view = (renaming: boolean) => (
    <WorkspaceCard name="Alpha" meta="1 item" preview={null} renameLabel="Rename" renaming={renaming} onRename={onRename} onRenameCancel={onRenameCancel} />
  );
  return { onRename, onRenameCancel, view };
}

describe("WorkspaceCard rename", () => {
  it("calls onRename once when Enter is followed by blur", () => {
    const { onRename, view } = setup();
    render(view(true));
    const input = screen.getByRole("textbox", { name: "Rename" });
    fireEvent.change(input, { target: { value: "Beta" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith("Beta");
  });

  it("does not commit on blur after Escape", () => {
    const { onRename, onRenameCancel, view } = setup();
    render(view(true));
    const input = screen.getByRole("textbox", { name: "Rename" });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.blur(input);
    expect(onRenameCancel).toHaveBeenCalledTimes(1);
    expect(onRename).not.toHaveBeenCalled();
  });

  it("allows a new rename after renaming starts again", () => {
    const { onRename, view } = setup();
    const { rerender } = render(view(true));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Rename" }), { key: "Enter" });
    rerender(view(false));
    rerender(view(true));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Rename" }), { key: "Enter" });
    expect(onRename).toHaveBeenCalledTimes(2);
  });
});

describe("WorkspaceCard frame", () => {
  it("draws the state frame as an overlay above the preview (the preview must not cover the green border of the active card)", () => {
    const { container } = render(<WorkspaceCard name="Alpha" meta={<b>1 item</b>} preview={<i data-testid="preview" />} active renameLabel="Rename" />);
    const card = container.firstElementChild as HTMLElement;
    expect(card).toHaveAttribute("data-active");
    expect(card.className).toContain("after:z-20");
    expect(card.className).toContain("data-active:after:shadow-[inset_0_0_0_1px_var(--color-green)]");
    // no inset ring on the card itself: it would be painted under the preview
    expect(card.className).not.toMatch(/ring-inset/);
    expect(screen.getByText("1 item").tagName).toBe("B");
  });

  it("sets the title at 14 px (text-base)", () => {
    render(<WorkspaceCard name="Alpha" meta="1 item" preview={null} renameLabel="Rename" />);
    expect(screen.getByRole("button", { name: "Alpha" })).toHaveClass("text-base", "font-semibold");
  });
});
