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
