import { render, screen } from "@testing-library/react";
import { createDocument } from "@paprika/core";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";
import type { ActivityEntry } from "../types";
import { initialPropertiesPanelState } from "../store";
import { PropertiesPanelProvider } from "../index";
import { DocumentPanel, type DocumentPanelProps } from "./document-panel";

// Counts the renders of the three sections that do not show the activity.
const renders = vi.hoisted(() => ({ tokens: 0, modes: 0, review: 0 }));
vi.mock("../sections/tokens-section", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sections/tokens-section")>();
  return { ...actual, TokensSection: (props: Parameters<typeof actual.TokensSection>[0]) => (renders.tokens++, actual.TokensSection(props)) };
});
vi.mock("../sections/modes-section", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sections/modes-section")>();
  return { ...actual, ModesSection: (props: Parameters<typeof actual.ModesSection>[0]) => (renders.modes++, actual.ModesSection(props)) };
});
vi.mock("../sections/review-section", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sections/review-section")>();
  return { ...actual, ReviewSection: (props: Parameters<typeof actual.ReviewSection>[0]) => (renders.review++, actual.ReviewSection(props)) };
});

const panel = (props: DocumentPanelProps) => (
  <PropertiesPanelProvider initial={() => initialPropertiesPanelState()}>
    <DocumentPanel {...props} />
  </PropertiesPanelProvider>
);

const entry = (id: string, label: string): ActivityEntry => ({ id, author: "claude", label, time: "now" });

describe("DocumentPanel", () => {
  it("a new activity entry re-renders the activity and not the tokens, modes or review sections", () => {
    const doc = createDocument("Studio", "doc1");
    const onApply = vi.fn();
    const onSelect = vi.fn();
    const view = render(panel({ doc, activity: [entry("a", "first move")], onApply, onSelect }));
    const mounted = { ...renders };
    view.rerender(panel({ doc, activity: [entry("b", "second move"), entry("a", "first move")], onApply, onSelect }));
    expect(screen.getByText("second move")).toBeInTheDocument();
    expect(renders).toEqual(mounted);
    // What they do show still renders them.
    view.rerender(panel({ doc: { ...doc, tokens: { gap: 8 } }, activity: [], onApply, onSelect }));
    expect(renders.tokens).toBeGreaterThan(mounted.tokens);
    view.unmount();
  });
});
