import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { downloadBlob } from "./download";
import { ExportDialog, imageFileName, type ExportDialogProps, type ExportRequest } from "./index";

const imageFormats: ExportDialogProps["imageFormats"] = [
  { value: "png", label: "PNG", transparent: true },
  { value: "jpeg", label: "JPEG" },
  { value: "svg", label: "SVG", vector: true },
];

function setup(props: Partial<ExportDialogProps> = {}) {
  const onRequestExport = vi.fn<(request: ExportRequest) => Promise<Blob | string>>((request) =>
    Promise.resolve(request.kind === "code" ? `// ${request.format} tokens=${request.tokens}` : new Blob(["data"], { type: "image/png" })),
  );
  const onOpenChange = vi.fn();
  const view = render(
    <ExportDialog
      open
      onOpenChange={onOpenChange}
      onRequestExport={onRequestExport}
      fileName="Home"
      imageFormats={imageFormats}
      size={{ width: 520, height: 340 }}
      scopes={[
        { value: "selection", label: "Selection · Home" },
        { value: "page", label: "Page" },
      ]}
      {...props}
    />,
  );
  return { onRequestExport, onOpenChange, ...view };
}

function stubDownload() {
  const createObjectURL = vi.fn(() => "blob:fake");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ href: this.href, download: this.download });
  });
  const clicked: { href: string; download: string }[] = [];
  return { createObjectURL, revokeObjectURL, click, clicked };
}

const emptyFailures: [string, () => unknown][] = [["an empty message", () => new Error("")], ["no error value", () => undefined]];

describe("ExportDialog image", () => {
  it("shows the image panel with the file name, dimensions and tabs", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Export" });
    expect(within(dialog).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Image", "Code"]);
    expect(within(dialog).getByText("Home.png")).toBeInTheDocument();
    expect(within(dialog).getByText("520 × 340")).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "W" })).toHaveValue("520");
    expect(within(dialog).getByRole("checkbox", { name: "Transparent background" })).not.toBeChecked();
  });

  it("exports with the chosen scale and downloads the blob under the scaled file name", async () => {
    const user = userEvent.setup();
    const { createObjectURL, clicked } = stubDownload();
    const { onRequestExport } = setup();
    await user.click(screen.getByRole("radio", { name: "2x" }));
    expect(screen.getByText("Home@2x.png")).toBeInTheDocument();
    expect(screen.getByText("1040 × 680")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Transparent background" }));
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(onRequestExport).toHaveBeenCalledWith({ kind: "image", format: "png", scale: 2, scope: "selection", width: 1040, height: 680, transparent: true });
    await waitFor(() => expect(clicked).toEqual([{ href: "blob:fake", download: "Home@2x.png" }]));
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  });

  it("changes the scope and the format and hides scale and transparency for vector formats", async () => {
    const user = userEvent.setup();
    const { clicked } = stubDownload();
    const onRequestExport = vi.fn(() => Promise.resolve("<svg/>"));
    setup({ onRequestExport });
    await user.click(screen.getByRole("combobox", { name: "What" }));
    await user.click(screen.getByRole("option", { name: "Page" }));
    await user.click(screen.getByRole("radio", { name: "JPEG" }));
    expect(screen.queryByRole("checkbox", { name: "Transparent background" })).not.toBeInTheDocument();
    expect(screen.getByText("Home.jpg")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "SVG" }));
    expect(screen.getByText("Vector formats keep their shapes at any size.")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "2x" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(onRequestExport).toHaveBeenCalledWith({ kind: "image", format: "svg", scale: 1, scope: "page", width: null, height: null, transparent: false });
    await waitFor(() => expect(clicked[0]?.download).toBe("Home.svg"));
  });

  it("switches the scale to free when the width is edited and keeps the proportion", async () => {
    const user = userEvent.setup();
    stubDownload();
    const { onRequestExport } = setup();
    const width = screen.getByRole("textbox", { name: "W" });
    await user.click(width);
    await user.keyboard("{Control>}a{/Control}1040{Enter}");
    expect(screen.getByText("1040 × 680")).toBeInTheDocument();
    expect(screen.getAllByRole("radio", { name: /x$/ }).some((radio) => radio.getAttribute("aria-checked") === "true")).toBe(false);
    expect(screen.getByText("Home.png")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(onRequestExport).toHaveBeenCalledWith(expect.objectContaining({ scale: 2, width: 1040, height: 680 }));
  });

  it("lets the height move alone when proportions are not kept", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("checkbox", { name: "Keep proportions" }));
    const height = screen.getByRole("textbox", { name: "H" });
    await user.click(height);
    await user.keyboard("{Control>}a{/Control}100{Enter}");
    expect(screen.getByText("520 × 100")).toBeInTheDocument();
  });

  it("goes back to a preset scale from a free size", async () => {
    const user = userEvent.setup();
    setup();
    const width = screen.getByRole("textbox", { name: "W" });
    await user.click(width);
    await user.keyboard("{Control>}a{/Control}333{Enter}");
    await user.click(screen.getByRole("radio", { name: "3x" }));
    expect(screen.getByText("1560 × 1020")).toBeInTheDocument();
  });

  it("shows the failure when the owner rejects and keeps the dialog open", async () => {
    const user = userEvent.setup();
    const { clicked } = stubDownload();
    const { onOpenChange } = setup({ onRequestExport: vi.fn(() => Promise.reject(new Error("renderer busy"))) });
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not export: renderer busy");
    expect(clicked).toEqual([]);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it.each(emptyFailures)("shows the generic text when the export fails with %s", async (_, make) => {
    const user = userEvent.setup();
    setup({ onRequestExport: vi.fn(() => Promise.reject(make())) });
    await user.click(screen.getByRole("button", { name: "Export" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not export: Unknown error");
  });

  it("builds file names", () => {
    expect(imageFileName("A", "jpeg", 1, true)).toBe("A.jpg");
    expect(imageFileName("A", "png", 3, true)).toBe("A@3x.png");
    expect(imageFileName("A", "png", 3, false)).toBe("A.png");
  });
});

describe("ExportDialog code", () => {
  it("requests the code when the tab opens and when format or tokens change", async () => {
    const user = userEvent.setup();
    const { onRequestExport } = setup();
    expect(onRequestExport).not.toHaveBeenCalled();
    await user.click(screen.getByRole("tab", { name: "Code" }));
    expect(onRequestExport).toHaveBeenLastCalledWith({ kind: "code", format: "react", tokens: true });
    expect(await screen.findByText("// react tokens=true")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Use design tokens" }));
    expect(onRequestExport).toHaveBeenLastCalledWith({ kind: "code", format: "react", tokens: false });
    expect(await screen.findByText("// react tokens=false")).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Format" }));
    await user.click(screen.getByRole("option", { name: "HTML" }));
    expect(await screen.findByText("// html tokens=false")).toBeInTheDocument();
  });

  it("shows a generating placeholder while the owner works and ignores a stale answer", async () => {
    const user = userEvent.setup();
    const resolvers: ((value: string) => void)[] = [];
    const onRequestExport = vi.fn(() => new Promise<string>((resolve) => resolvers.push(resolve)));
    setup({ onRequestExport, defaultMode: "code" });
    expect(screen.getByText("Generating…")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Use design tokens" }));
    const calls = resolvers.length;
    await act(async () => resolvers[calls - 2]?.("old"));
    expect(screen.queryByText("old")).not.toBeInTheDocument();
    await act(async () => resolvers[calls - 1]?.("fresh"));
    expect(screen.getByText("fresh")).toBeInTheDocument();
  });

  it("copies the code to the clipboard and announces it", async () => {
    const user = userEvent.setup();
    setup({ defaultMode: "code" });
    await screen.findByText("// react tokens=true");
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("// react tokens=true");
    expect(await screen.findByRole("status")).toHaveTextContent("Code copied to the clipboard.");
  });

  it("reports a copy that is not possible", async () => {
    const user = userEvent.setup();
    setup({ defaultMode: "code" });
    await screen.findByText("// react tokens=true");
    vi.stubGlobal("navigator", { clipboard: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not copy the code.");
    void user;
  });

  it("downloads the code with the format extension", async () => {
    const user = userEvent.setup();
    const { clicked } = stubDownload();
    setup({ defaultMode: "code" });
    await screen.findByText("// react tokens=true");
    await user.click(screen.getByRole("button", { name: "Download .tsx" }));
    expect(clicked).toEqual([{ href: "blob:fake", download: "Home.tsx" }]);
  });

  it("does nothing on copy or download before the code arrives", async () => {
    const user = userEvent.setup();
    const { clicked } = stubDownload();
    setup({ defaultMode: "code", onRequestExport: vi.fn(() => new Promise<string>(() => {})) });
    await user.click(screen.getByRole("button", { name: "Download .tsx" }));
    expect(clicked).toEqual([]);
  });

  it("shows the generation failure with try again", async () => {
    const user = userEvent.setup();
    let failing = true;
    const onRequestExport = vi.fn(() => (failing ? Promise.reject(new Error("no selection")) : Promise.resolve("ok code")));
    setup({ defaultMode: "code", onRequestExport });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not generate the code: no selection");
    failing = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("ok code")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows only one panel without tabs when there is a single mode", () => {
    setup({ modes: ["code"], defaultMode: "code" });
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Format" })).toBeInTheDocument();
  });

  it("follows a controlled mode and reports changes", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    setup({ mode: "image", onModeChange });
    await user.click(screen.getByRole("tab", { name: "Code" }));
    expect(onModeChange).toHaveBeenCalledWith("code");
    expect(screen.getByRole("tab", { name: "Image" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("ExportDialog general", () => {
  it("closes with Escape and the close button", async () => {
    const user = userEvent.setup();
    const { onOpenChange } = setup();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false, expect.anything());
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it("translates to pt-BR", async () => {
    await i18n.changeLanguage("pt-BR");
    try {
      setup();
      expect(screen.getByRole("dialog", { name: "Exportar" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Código" })).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: "Manter proporção" })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "L" })).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("renders in rtl", () => {
    render(
      <div dir="rtl">
        <ExportDialog open onOpenChange={vi.fn()} onRequestExport={vi.fn()} fileName="Home" />
      </div>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders closed on the server and does not request anything", () => {
    const onRequestExport = vi.fn();
    expect(renderToString(<ExportDialog open={false} onOpenChange={vi.fn()} onRequestExport={onRequestExport} fileName="Home" />)).not.toContain("Export");
    expect(onRequestExport).not.toHaveBeenCalled();
  });
});

describe("ExportDialog requests and downloads", () => {
  it("does not repeat the code request when the language changes or under StrictMode", async () => {
    const onRequestExport = vi.fn((request: ExportRequest) => Promise.resolve(request.kind === "code" ? "// code" : new Blob(["x"])));
    render(
      <StrictMode>
        <ExportDialog open onOpenChange={() => {}} onRequestExport={onRequestExport} fileName="Home" defaultMode="code" />
      </StrictMode>,
    );
    await screen.findByText("// code");
    await act(async () => {
      await i18n.changeLanguage("pt-BR");
    });
    try {
      expect(onRequestExport).toHaveBeenCalledTimes(1);
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("does not download an image that finished after the dialog closed", async () => {
    const user = userEvent.setup();
    const { clicked } = stubDownload();
    let finish: (blob: Blob) => void = () => {};
    const onRequestExport = vi.fn(() => new Promise<Blob>((resolve) => (finish = resolve)));
    const view = render(<ExportDialog open onOpenChange={() => {}} onRequestExport={onRequestExport} fileName="Home" imageFormats={imageFormats} />);
    await user.click(screen.getByRole("button", { name: /^Export/ }));
    view.rerender(<ExportDialog open={false} onOpenChange={() => {}} onRequestExport={onRequestExport} fileName="Home" imageFormats={imageFormats} />);
    await act(async () => finish(new Blob(["late"])));
    expect(clicked).toEqual([]);
  });

  it("revokes the object url only after a delay", () => {
    vi.useFakeTimers();
    try {
      const { revokeObjectURL } = stubDownload();
      downloadBlob(new Blob(["x"]), "a.txt");
      vi.advanceTimersByTime(10);
      expect(revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
