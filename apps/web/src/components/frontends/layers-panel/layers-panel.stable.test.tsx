import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";
import { LayersPanel, type LayerRowData } from "./index";

// Counts how many times the panel builds the tree's data (`buildItems` is the cost: 5 000 new objects for the tree).
const built = vi.hoisted(() => ({ calls: 0 }));
vi.mock("./tree-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tree-data")>();
  return {
    ...actual,
    buildItems: (rows: Parameters<typeof actual.buildItems>[0]) => {
      built.calls += 1;
      return actual.buildItems(rows);
    },
  };
});

const base = { visible: true, locked: false, selected: false, hasChildren: false, level: 0 } as const;
const rows = (patch: (row: LayerRowData) => LayerRowData = (row) => row): LayerRowData[] =>
  (
    [
      { ...base, id: "home", name: "Home", kind: "frame", hasChildren: true },
      { ...base, id: "title", name: "Title", kind: "text", level: 1 },
      { ...base, id: "logo", name: "Logo", kind: "image", level: 1 },
      { ...base, id: "about", name: "About", kind: "frame" },
    ] as LayerRowData[]
  ).map(patch);

const handlers = { onSelect: vi.fn(), onRename: vi.fn(), onMove: vi.fn(), onToggleVisible: vi.fn(), onToggleLocked: vi.fn() };

describe("LayersPanel tree data", () => {
  it("is built again only when ids, names or levels change, not for selection, visibility or lock", () => {
    built.calls = 0;
    const view = render(<LayersPanel rows={rows()} {...handlers} storageKey={undefined} />);
    expect(built.calls).toBe(1);
    // A click on a layer: a new array of rows where only `selected` differs.
    view.rerender(<LayersPanel rows={rows((row) => ({ ...row, selected: row.id === "title" }))} {...handlers} />);
    expect(built.calls).toBe(1);
    expect(screen.getByRole("treeitem", { name: /Title/ })).toHaveAttribute("aria-selected", "true");
    view.rerender(<LayersPanel rows={rows((row) => ({ ...row, selected: row.id === "logo", visible: row.id !== "about", locked: row.id === "title" }))} {...handlers} />);
    expect(built.calls).toBe(1);
    expect(screen.getByRole("treeitem", { name: /Logo/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("treeitem", { name: /Title/ })).toHaveAttribute("aria-selected", "false");
    // A rename is a different tree, and so is a move.
    view.rerender(<LayersPanel rows={rows((row) => (row.id === "title" ? { ...row, name: "Heading" } : row))} {...handlers} />);
    expect(built.calls).toBe(2);
    expect(screen.getByRole("treeitem", { name: /Heading/ })).toBeInTheDocument();
    view.rerender(<LayersPanel rows={rows((row) => (row.id === "logo" ? { ...row, level: 0 } : row))} {...handlers} />);
    expect(built.calls).toBe(3);
    view.unmount();
  });
});
