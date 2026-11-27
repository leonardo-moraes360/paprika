import type { Op } from "@paprika/core";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { everyKindDocument, stubLayout, testDefaults } from "@/test/canvas-fixtures";
import { Canvas, createCanvasFeed } from "./index";
import { selectOffsets } from "./rich-text";

/** The four states of the link field in the text bar: empty, focused with an address, invalid, and on a link already applied. */
let restore: () => void;
beforeEach(() => {
  restore = stubLayout();
});
afterEach(() => restore());

function open(id: string) {
  const feed = createCanvasFeed({ doc: everyKindDocument(), pageId: "page", selection: [], tool: "select" });
  const onApply = vi.fn((_ops: Op[], _label: string) => Promise.resolve(true));
  const view = render(<Canvas feed={feed} defaults={testDefaults} onSelect={() => {}} onApply={onApply} />);
  fireEvent.doubleClick(view.getByTestId("canvas-world").querySelector(`[data-paprika-id="${id}"]`) as HTMLElement);
  const surface = view.getByRole("textbox", { name: "Text" });
  const field = () => view.getByRole("textbox", { name: "Link address" }) as HTMLInputElement;
  const select = (a: number, b: number) =>
    act(() => {
      selectOffsets(surface, a, b);
      document.dispatchEvent(new Event("selectionchange"));
    });
  return { ...view, surface, field, select };
}

describe("link field of the text bar", () => {
  it("empty: shows the hint, no error, and Apply link is disabled until there is an address", () => {
    const t = open("plain");
    expect(t.field().value).toBe("");
    expect(t.field().placeholder).toBe("https://… or /path");
    expect(t.field()).not.toHaveAttribute("aria-invalid");
    expect(t.queryByRole("alert")).toBeNull();
    expect(t.getByRole("button", { name: "Apply link" })).toHaveAttribute("aria-disabled", "true");
    expect(t.queryByRole("button", { name: "Remove link" })).toBeNull();
    fireEvent.change(t.field(), { target: { value: "/docs" } });
    expect(t.getByRole("button", { name: "Apply link" })).not.toHaveAttribute("aria-disabled", "true");
  });

  it("with an address: Enter applies it to the selection, by keyboard alone", () => {
    const t = open("plain");
    t.select(0, 4);
    fireEvent.change(t.field(), { target: { value: "https://paprika.dev/docs" } });
    fireEvent.keyDown(t.field(), { key: "Enter" });
    const a = t.surface.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://paprika.dev/docs");
    expect(a?.textContent).toBe("Just");
    expect(t.queryByRole("alert")).toBeNull();
  });

  it("invalid: marks the field, shows the message, and ties it to the field by aria-describedby", () => {
    const t = open("plain");
    t.select(0, 4);
    fireEvent.change(t.field(), { target: { value: "paprika ponto dev" } });
    fireEvent.click(t.getByRole("button", { name: "Apply link" }));
    expect(t.surface.querySelector("a")).toBeNull();
    expect(t.field()).toHaveAttribute("aria-invalid", "true");
    const message = t.getByRole("alert");
    expect(message).toHaveTextContent("Use http(s), mailto, / or #");
    expect(t.field().getAttribute("aria-describedby")).toBe(message.id);
    fireEvent.change(t.field(), { target: { value: "mailto:a@b.dev" } });
    expect(t.queryByRole("alert")).toBeNull();
    expect(t.field()).not.toHaveAttribute("aria-invalid");
  });

  it("on a link: shows its address, and Remove link takes the href off the whole link from a bare caret", () => {
    const t = open("title");
    expect(t.surface.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
    t.select(14, 14);
    expect(t.field().value).toBe("https://example.com");
    t.select(0, 0);
    t.select(14, 14);
    fireEvent.click(t.getByRole("button", { name: "Remove link" }));
    expect(t.surface.querySelector("a")).toBeNull();
    expect(t.surface.textContent).toBe("Hello brave world");
  });

  it("off a link: no Remove link button", () => {
    const t = open("title");
    t.select(2, 2);
    expect(t.queryByRole("button", { name: "Remove link" })).toBeNull();
  });
});
