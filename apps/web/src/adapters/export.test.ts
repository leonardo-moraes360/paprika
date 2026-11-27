import type { Document } from "@paprika/core";
import { describe, expect, it } from "vitest";
import { activePageId, codeRootId, exportCode, exportFileName, exportRootId, exportSize, hasExportSelection, selectedExportId } from "./export";

const doc = {
  id: "d",
  name: "Demo / doc",
  rootIds: ["p1", "p2"],
  tokens: {},
  nodes: {
    p1: { id: "p1", type: "page", name: "Cover", parentId: null, children: ["f1", "t1"] },
    p2: { id: "p2", type: "page", name: "Other", parentId: null, children: [] },
    f1: { id: "f1", type: "frame", name: "Card: Pro", parentId: "p1", x: 10, y: 20, width: 300, height: 200, children: [], rotation: 0, opacity: 1, visible: true, locked: false },
    t1: { id: "t1", type: "text", name: "Title", parentId: "p1", x: 0, y: 0, width: 80, height: 20, text: "Hi", rotation: 0, opacity: 1, visible: true, locked: false },
  },
} as unknown as Document;

const flat = { id: "d", name: "Flat", rootIds: ["f"], tokens: {}, nodes: { f: { id: "f", type: "frame", name: "F", parentId: null, x: 0, y: 0, width: 100, height: 50, children: [], rotation: 0, opacity: 1, visible: true, locked: false } } } as unknown as Document;

describe("which node and page", () => {
  it("takes the last selected node that is still there, and the page in view or the first page", () => {
    expect(selectedExportId(doc, ["gone", "t1", "f1"])).toBe("f1");
    expect(selectedExportId(doc, ["gone", "t1", "nope"])).toBe("t1");
    expect(selectedExportId(doc, [])).toBeNull();
    expect(hasExportSelection(doc, ["f1"])).toBe(true);
    expect(activePageId(doc, "p2")).toBe("p2");
    expect(activePageId(doc, "ghost")).toBe("p1");
    expect(activePageId(doc, null)).toBe("p1");
    expect(activePageId(flat, null)).toBeNull();
  });

  it("asks the server for the selection by default and for the page when the scope says page", () => {
    expect(exportRootId(doc, "selection", ["f1"], null)).toBe("f1");
    expect(exportRootId(doc, null, ["f1"], null)).toBe("f1");
    expect(exportRootId(doc, "page", ["f1"], "p2")).toBe("p2");
    expect(exportRootId(doc, "selection", [], null)).toBe("p1");
    expect(exportRootId(flat, "page", [], null)).toBeNull();
  });
});

describe("size and file name", () => {
  it("measures the node, the page, or the whole canvas, and never returns zero", () => {
    expect(exportSize(doc, "f1", null)).toEqual({ width: 300, height: 200 });
    expect(exportSize(doc, "p1", null).width).toBeGreaterThan(0);
    expect(exportSize(flat, null, null)).toEqual({ width: 100, height: 50 });
    expect(exportSize(doc, "ghost", null)).toEqual({ width: 1, height: 1 });
  });

  it("names the file after the node, else the document, without characters a file system refuses", () => {
    expect(exportFileName(doc, "f1")).toBe("Card- Pro");
    expect(exportFileName(doc, null)).toBe("Demo - doc");
    expect(exportFileName({ ...doc, name: "" } as Document, null)).toBe("paprika");
  });
});

describe("code", () => {
  it("takes the selected node, else the first frame of the page, never a page", () => {
    expect(codeRootId(doc, ["t1"], null)).toBe("t1");
    expect(codeRootId(doc, ["p1"], null)).toBe("f1");
    expect(codeRootId(doc, [], "p1")).toBe("f1");
    expect(codeRootId(doc, [], "p2")).toBeNull();
    expect(codeRootId(flat, [], null)).toBe("f");
  });

  it("is the React component of @paprika/core", () => {
    const code = exportCode(doc, "f1", false);
    expect(code).toContain("export function CardPro()");
    expect(exportCode(doc, "f1", true)).toContain("tokensCss");
  });
});
