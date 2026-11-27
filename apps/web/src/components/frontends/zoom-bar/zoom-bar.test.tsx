import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Cpu, Monitor } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { ZoomBar, type ZoomBarProps, type ZoomRenderer } from "./index";

const renderers: ZoomRenderer[] = [
  { id: "wasm-gpu", label: "WASM · GPU", icon: <Cpu /> },
  { id: "wasm-cpu", label: "WASM · CPU", icon: <Cpu /> },
  { id: "dom", label: "DOM (SVG)", shortLabel: "DOM", icon: <Monitor /> },
];

function setup(props: Partial<ZoomBarProps> = {}) {
  const handlers = { onZoomOut: vi.fn(), onZoomIn: vi.fn(), onFit: vi.fn(), onRendererChange: vi.fn() };
  const view = render(<ZoomBar zoom={1} renderers={renderers} renderer="wasm-gpu" {...handlers} {...props} />);
  return { ...handlers, ...view };
}

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("ZoomBar", () => {
  it("shows the zoom as a percentage and the current renderer", () => {
    setup({ zoom: 1.256 });
    expect(screen.getByRole("toolbar", { name: "Zoom" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("126%");
    expect(screen.getByRole("button", { name: "Renderer: WASM · GPU" })).toHaveTextContent("WASM · GPU");
  });

  it("emits zoom out, zoom in and fit", async () => {
    const user = userEvent.setup();
    const { onZoomOut, onZoomIn, onFit } = setup();
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.click(screen.getByRole("button", { name: "Fit to screen" }));
    expect(onZoomOut).toHaveBeenCalledOnce();
    expect(onZoomIn).toHaveBeenCalledOnce();
    expect(onFit).toHaveBeenCalledOnce();
  });

  it("disables the zoom buttons at the limits", async () => {
    const user = userEvent.setup();
    const { onZoomOut, onZoomIn, rerender } = setup({ zoom: 0.1, minZoom: 0.1, maxZoom: 8 });
    expect(screen.getByRole("button", { name: "Zoom out" })).toHaveAttribute("aria-disabled", "true");
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(onZoomOut).not.toHaveBeenCalled();
    rerender(<ZoomBar zoom={8} minZoom={0.1} maxZoom={8} onZoomOut={onZoomOut} onZoomIn={onZoomIn} onFit={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Zoom in" })).toHaveAttribute("aria-disabled", "true");
  });

  it("lists the renderers with the current one checked and emits the choice", async () => {
    const user = userEvent.setup();
    const { onRendererChange } = setup();
    const trigger = screen.getByRole("button", { name: "Renderer: WASM · GPU" });
    await user.click(trigger);
    expect(await screen.findByRole("menuitemradio", { name: "WASM · GPU" })).toBeChecked();
    await user.click(screen.getByRole("menuitemradio", { name: "DOM (SVG)" }));
    expect(onRendererChange).toHaveBeenCalledWith("dom");
  });

  it("closes the menu when a mode is chosen, and the focus goes back to the button", async () => {
    const user = userEvent.setup();
    setup();
    const trigger = screen.getByRole("button", { name: "Renderer: WASM · GPU" });
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitemradio", { name: "DOM (SVG)" }));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    expect(await screen.findByRole("menu")).toBeInTheDocument();
  });

  it("does not emit when the current renderer is chosen again", async () => {
    const user = userEvent.setup();
    const { onRendererChange } = setup();
    await user.click(screen.getByRole("button", { name: "Renderer: WASM · GPU" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "WASM · GPU" }));
    expect(onRendererChange).not.toHaveBeenCalled();
  });

  it("explains why a renderer is unavailable and does not emit it", async () => {
    const user = userEvent.setup();
    const { onRendererChange } = setup({
      renderer: "wasm-cpu",
      renderers: [{ ...renderers[0], disabled: true, reason: "no WebGPU" } as ZoomRenderer, ...renderers.slice(1)],
    });
    await user.click(screen.getByRole("button", { name: "Renderer: WASM · CPU" }));
    const item = await screen.findByRole("menuitemradio", { name: "WASM · GPU (no WebGPU)" });
    expect(item).toHaveAttribute("aria-disabled", "true");
    await user.click(item);
    expect(onRendererChange).not.toHaveBeenCalled();
  });

  it("shows the short label of the renderer", () => {
    setup({ renderer: "dom" });
    expect(screen.getByRole("button", { name: "Renderer: DOM" })).toHaveTextContent("DOM");
  });

  it("shows the switching state and blocks new choices", async () => {
    const user = userEvent.setup();
    const { onRendererChange } = setup({ switching: true });
    const trigger = screen.getByRole("button", { name: "Renderer: Switching…" });
    expect(trigger).toHaveAttribute("aria-busy", "true");
    await user.click(trigger);
    await user.click(await screen.findByRole("menuitemradio", { name: "DOM (SVG)" }));
    expect(onRendererChange).not.toHaveBeenCalled();
  });

  it("hides the renderer menu when there is nothing to choose", () => {
    setup({ renderers: undefined, renderer: undefined });
    expect(screen.queryByRole("button", { name: /Renderer/ })).not.toBeInTheDocument();
  });

  it("renders in Portuguese", async () => {
    await i18n.changeLanguage("pt-BR");
    setup();
    expect(screen.getByRole("button", { name: "Aumentar zoom" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enquadrar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Renderizador: WASM · GPU" })).toBeInTheDocument();
  });

  it("opens the renderer menu upwards in a right-to-left page", async () => {
    const user = userEvent.setup();
    render(
      <div dir="rtl">
        <ZoomBar zoom={1} renderers={renderers} renderer="dom" onZoomOut={vi.fn()} onZoomIn={vi.fn()} onFit={vi.fn()} onRendererChange={vi.fn()} />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Renderer: DOM" }));
    expect(await screen.findByRole("menuitemradio", { name: "DOM (SVG)" })).toBeChecked();
  });
});
