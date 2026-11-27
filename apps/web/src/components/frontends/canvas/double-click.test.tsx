import type { Op } from "@paprika/core";
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { everyKindDocument, stubLayout, testDefaults } from "@/test/canvas-fixtures";
import { Canvas, createCanvasFeed } from "./index";

/**
 * ONE list answers a double click (`gestures/double-click.ts`): edit the points of a path that is already selected, else open
 * the editor of a text, a diagram shape or an arrow, else select the node under the pointer itself. Each case below asserts the
 * whole outcome, so a double click that did two things would fail it: what is selected, which editor is open, what was sent.
 */
let restore: () => void;
beforeEach(() => {
  restore = stubLayout();
  (SVGElement.prototype as unknown as { getScreenCTM: () => unknown }).getScreenCTM = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
});
afterEach(() => {
  restore();
  delete (SVGElement.prototype as unknown as Record<string, unknown>).getScreenCTM;
});

function mount(selection: string[] = [], tool: "select" | "rect" = "select") {
  const feed = createCanvasFeed({ doc: everyKindDocument(), pageId: "page", selection, tool });
  const onSelect = vi.fn((ids: readonly string[]) => feed.update({ selection: ids }));
  const onApply = vi.fn((_ops: Op[], _label: string) => Promise.resolve(true));
  const view = render(<Canvas feed={feed} defaults={testDefaults} onSelect={onSelect} onApply={onApply} />);
  const world = view.getByTestId("canvas-world");
  const node = (id: string) => world.querySelector<HTMLElement>(`[data-paprika-id="${id}"]`) as HTMLElement;
  /** Which of the things a double click can open is on screen now. */
  const open = () => ({
    pathEdit: view.container.querySelector('[data-testid="path-edit"]') !== null,
    textEditor: view.queryByTestId("text-editor") !== null,
    shapeEditor: view.queryByTestId("shape-text-editor") !== null,
    labelEditor: view.queryByTestId("connector-label-editor") !== null,
    frameName: view.queryByRole("textbox", { name: "Frame name" }) !== null,
  });
  return { ...view, feed, onSelect, onApply, node, open };
}
const nothingOpen = { pathEdit: false, textEditor: false, shapeEditor: false, labelEditor: false, frameName: false };

describe("a double click does one thing", () => {
  it("on a selected path: edits its points, and selects nothing and sends nothing", () => {
    const m = mount(["squiggle"]);
    fireEvent.doubleClick(m.node("squiggle"));
    expect(m.open()).toEqual({ ...nothingOpen, pathEdit: true });
    expect(m.onSelect).not.toHaveBeenCalled();
    expect(m.onApply).not.toHaveBeenCalled();
  });

  it("on a path that is not selected: selects it, and does not enter the edit mode", () => {
    const m = mount();
    fireEvent.doubleClick(m.node("squiggle"));
    expect(m.open()).toEqual(nothingOpen);
    expect(m.onSelect).toHaveBeenCalledTimes(1);
    expect(m.onSelect).toHaveBeenCalledWith(["squiggle"]);
    // the second double click, now that it is selected, enters
    fireEvent.doubleClick(m.node("squiggle"));
    expect(m.open()).toEqual({ ...nothingOpen, pathEdit: true });
    expect(m.onSelect).toHaveBeenCalledTimes(1);
  });

  it("on a text: opens its editor and nothing else", () => {
    const m = mount(["plain"]);
    fireEvent.doubleClick(m.node("plain"));
    expect(m.open()).toEqual({ ...nothingOpen, textEditor: true });
    expect(m.onSelect).toHaveBeenCalledTimes(1);
    expect(m.onSelect).toHaveBeenCalledWith(["plain"]);
    expect(m.onApply).not.toHaveBeenCalled();
  });

  it("on a diagram shape: opens the text of the shape and nothing else", () => {
    const m = mount();
    fireEvent.doubleClick(m.node("box"));
    expect(m.open()).toEqual({ ...nothingOpen, shapeEditor: true });
    expect(m.onSelect).toHaveBeenCalledTimes(1);
    expect(m.onSelect).toHaveBeenCalledWith(["box"]);
  });

  it("on an arrow: opens its label and nothing else", () => {
    const m = mount();
    fireEvent.doubleClick(m.node("arrow"));
    expect(m.open()).toEqual({ ...nothingOpen, labelEditor: true });
  });

  it("on the label of a frame: renames the frame, and the double click does not reach the viewport", () => {
    const m = mount();
    fireEvent.doubleClick(m.container.querySelector('[data-frame-label="home"]') as HTMLElement);
    expect(m.open()).toEqual({ ...nothingOpen, frameName: true });
    expect(m.onSelect).not.toHaveBeenCalled();
  });

  it("on a child of a group: only selects that child (no editor, no path edit)", () => {
    const m = mount(["pair"]);
    fireEvent.doubleClick(m.node("dot"));
    expect(m.open()).toEqual(nothingOpen);
    expect(m.onSelect).toHaveBeenCalledTimes(1);
    expect(m.onSelect).toHaveBeenCalledWith(["dot"]);
  });

  it("on a text inside an unselected frame: opens the editor (a text is a click target there)", () => {
    const m = mount();
    fireEvent.doubleClick(m.node("title"));
    expect(m.open()).toEqual({ ...nothingOpen, textEditor: true });
  });

  it("on the empty page: does nothing", () => {
    const m = mount(["plain"]);
    fireEvent.doubleClick(m.getByTestId("viewport"));
    expect(m.open()).toEqual(nothingOpen);
    expect(m.onSelect).not.toHaveBeenCalled();
  });

  it("with a creation tool armed: does nothing", () => {
    const m = mount([], "rect");
    fireEvent.doubleClick(m.node("box"));
    fireEvent.doubleClick(m.node("squiggle"));
    expect(m.open()).toEqual(nothingOpen);
    expect(m.onSelect).not.toHaveBeenCalled();
  });

  it("in the edit mode of a path, on the path outside a point: stays in the mode and does not select or send", () => {
    const m = mount(["squiggle"]);
    fireEvent.doubleClick(m.node("squiggle"));
    m.onSelect.mockClear();
    fireEvent.doubleClick(m.node("squiggle"));
    expect(m.open()).toEqual({ ...nothingOpen, pathEdit: true });
    expect(m.onSelect).not.toHaveBeenCalled();
    expect(m.onApply).not.toHaveBeenCalled();
  });
});
