import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";
import { NumericField } from "./numeric-field";

describe("NumericField", () => {
  it("steps three synchronous ArrowUp presses from the last value it emitted, while the owner has not echoed any", () => {
    const onCommit = vi.fn();
    render(<NumericField label="Opacity" value={50} onCommit={onCommit} min={0} max={100} />);
    const input = screen.getByRole("textbox", { name: "Opacity" });
    for (let i = 0; i < 3; i++) fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(onCommit.mock.calls.map(([value]) => value)).toEqual([51, 52, 53]);
  });

  it("keeps stepping from the last emitted value when an earlier one echoes, and from the document once the last one has", () => {
    const onCommit = vi.fn();
    const field = (value: number) => <NumericField label="Opacity" value={value} onCommit={onCommit} min={0} max={100} />;
    const view = render(field(50));
    const input = screen.getByRole("textbox", { name: "Opacity" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    view.rerender(field(51));
    fireEvent.keyDown(input, { key: "ArrowUp" });
    view.rerender(field(52));
    view.rerender(field(53));
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(onCommit.mock.calls.map(([value]) => value)).toEqual([51, 52, 53, 52]);
  });
});
