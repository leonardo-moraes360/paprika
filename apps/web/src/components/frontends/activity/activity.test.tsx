import { render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import i18n from "@/i18n";
import { Activity, batchFlags, markerIndex, type ActivityEntry } from "./index";

const NOW = 9_000_000;
const claude = { name: "claude", tone: "agent-1" } as const;
const codex = { name: "codex", tone: "agent-2" } as const;
const you = { name: "you", you: true } as const;

const entries: ActivityEntry[] = [
  { id: "1", actor: claude, label: "update_nodes · Title", at: NOW - 1_000 },
  { id: "2", actor: claude, label: "create_nodes · Button", at: NOW - 12_000 },
  { id: "3", actor: you, label: "undid · move", at: NOW - 60_000, step: true },
  { id: "4", actor: codex, label: "lint_design", at: NOW - 180_000 },
  { id: "5", actor: you, label: "rename page", at: NOW - 8 * 60_000 },
];

describe("activity model", () => {
  it("places the marker after the leading undo and redo entries", () => {
    expect(markerIndex(entries)).toBe(0);
    expect(markerIndex([{ ...(entries[2] as ActivityEntry) }, ...entries.slice(0, 2)])).toBe(1);
    expect(markerIndex(entries.map((e) => ({ ...e, step: true })))).toBe(5);
  });
  it("flags consecutive entries of the same actor as a batch", () => {
    expect(batchFlags(entries)).toEqual([true, true, false, false, false]);
    expect(batchFlags([])).toEqual([]);
  });
});

describe("Activity", () => {
  it("lists the entries with actor, label and relative time and the marker first", () => {
    render(<Activity entries={entries} now={NOW} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveAttribute("data-testid", "activity-marker");
    const rows = screen.getAllByTestId("activity-row");
    expect(rows).toHaveLength(5);
    expect(within(rows[0] as HTMLElement).getByText("claude")).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText("now")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("12s")).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText("you")).toBeInTheDocument();
    expect(within(rows[4] as HTMLElement).getByText("8 min")).toBeInTheDocument();
    expect(rows[0]).toHaveAttribute("data-batch");
    expect(rows[2]).toHaveAttribute("data-undone");
    expect(rows[3]).not.toHaveAttribute("data-batch");
  });

  it("puts the marker between the undone entries and the rest", () => {
    render(<Activity entries={[entries[2] as ActivityEntry, entries[3] as ActivityEntry]} now={NOW} />);
    const kinds = screen.getAllByRole("listitem").map((el) => el.getAttribute("data-testid"));
    expect(kinds).toEqual(["activity-row", "activity-marker", "activity-row"]);
  });

  it("limits the entries shown", () => {
    render(<Activity entries={entries} now={NOW} limit={2} />);
    expect(screen.getAllByTestId("activity-row")).toHaveLength(2);
  });

  it("shows an empty message", () => {
    render(<Activity entries={[]} now={NOW} />);
    expect(screen.getByText("No edits yet.")).toBeInTheDocument();
  });

  it("updates the relative time with the injected clock", () => {
    const { rerender } = render(<Activity entries={entries} clock={() => NOW} />);
    expect(screen.getAllByText("now").length).toBeGreaterThan(0);
    rerender(<Activity entries={entries} clock={() => NOW + 120_000} now={NOW + 120_000} />);
    expect(within(screen.getAllByTestId("activity-row")[0] as HTMLElement).getByText("2 min")).toBeInTheDocument();
  });

  it("renders in pt-BR", async () => {
    await i18n.changeLanguage("pt-BR");
    try {
      render(<Activity entries={entries} now={NOW} />);
      expect(screen.getByText("agora", { selector: "li > span" })).toBeInTheDocument();
      expect(screen.getAllByText("você")).toHaveLength(2);
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("renders on the server", () => {
    expect(renderToString(<Activity entries={entries} now={NOW} />)).toContain("update_nodes");
  });
});
