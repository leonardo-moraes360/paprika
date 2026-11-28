import { describe, expect, it } from "vitest";
import type { Document } from "@paprika/core";
import { makeDocument } from "@/test/live-harness";
import { addPageOp, pageBases, resolvePageId, samePages, toPageEntries } from "./pages";

const doc = makeDocument(120, { pageCount: 3 });

describe("pages adapter", () => {
  it("resolves the chosen page while it exists, else the first one, else null", () => {
    expect(resolvePageId(doc, "page-1")).toBe("page-1");
    expect(resolvePageId(doc, "gone")).toBe("page-0");
    expect(resolvePageId(doc, "n3")).toBe("page-0");
    expect(resolvePageId(null, "page-1")).toBeNull();
    expect(resolvePageId({ ...doc, rootIds: ["n3"] } as Document, null)).toBeNull();
  });

  it("lists the pages with their names and whether they hold anything", () => {
    const bases = pageBases(doc);
    expect(bases.map((p) => [p.id, p.name, p.hasContent])).toEqual([["page-0", "Page 1", true], ["page-1", "Page 2", true], ["page-2", "Page 3", true]]);
    expect(samePages(bases, pageBases(doc))).toBe(true);
    expect(samePages(bases, bases.slice(1))).toBe(false);
  });

  it("gives the same entry object for the same page and agent count, and a new one when the count changes", () => {
    const bases = pageBases(doc);
    const a = toPageEntries(bases, new Map());
    const b = toPageEntries(bases, new Map());
    expect(b[0]).toBe(a[0]);
    const c = toPageEntries(bases, new Map([["page-0", 2]]));
    expect(c[0]).toMatchObject({ id: "page-0", agents: 2 });
    expect(c[1]).toBe(a[1]);
    expect(a[0]).not.toHaveProperty("agents");
  });

  it("the add_page op names the new page after the count, and a document without pages adopts its layers as Page 1", () => {
    expect(addPageOp(doc, "x", "en")).toEqual({ op: "add_page", id: "x", name: "Page 4" });
    expect(addPageOp(doc, "x", "pt-BR")).toEqual({ op: "add_page", id: "x", name: "Página 4" });
    const flat = { ...doc, rootIds: ["n3"] } as Document;
    expect(addPageOp(flat, "x", "en")).toEqual({ op: "add_page", id: "x", name: "Page 2", firstName: "Page 1" });
  });
});
