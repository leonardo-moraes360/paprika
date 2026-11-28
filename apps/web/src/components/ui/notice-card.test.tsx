import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NoticeCard } from "./notice-card";

describe("NoticeCard", () => {
  it("the neutral band is the in-progress strip: no alarm icon, its leading element and its trailing text", () => {
    const { container } = render(
      <NoticeCard variant="band" status="neutral" leading={<i data-testid="ring" />} title="Opening workspace…" actions={<span>Connecting…</span>} />,
    );
    expect(screen.getByTestId("ring")).toBeInTheDocument();
    expect(screen.getByText("Connecting…")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
    expect(container.firstElementChild).toHaveClass("border-line", "bg-bg");
  });

  it("a neutral band with a body shows no status icon either", () => {
    const { container } = render(
      <NoticeCard variant="band" status="neutral" title="Title">
        Body
      </NoticeCard>,
    );
    expect(container.querySelector("[data-status]")).toBeNull();
  });
});
