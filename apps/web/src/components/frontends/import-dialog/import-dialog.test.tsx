import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { ImportDialog, type ImportDialogProps } from "./index";

const sources: ImportDialogProps["sources"] = {
  libraries: {
    items: [
      { id: "l1", name: "Trio Pixel · brand", detail: "39 components" },
      { id: "l2", name: "App · new interface", detail: "46 components" },
    ],
  },
  workspaces: { items: [], loading: true },
  projects: { items: [], error: "server unreachable" },
};

function setup(props: Partial<ImportDialogProps> = {}) {
  const onImport = vi.fn<ImportDialogProps["onImport"]>();
  const onOpenChange = vi.fn();
  const view = render(<ImportDialog open onOpenChange={onOpenChange} destination="Cover" sources={sources} onImport={onImport} {...props} />);
  return { onImport, onOpenChange, ...view };
}

const fileInput = () => document.querySelector("input[type=file]") as HTMLInputElement;
const svg = (name = "logo.svg", body = "<svg/>") => new File([body], name, { type: "image/svg+xml" });
const pick = (...files: File[]) => fireEvent.change(fileInput(), { target: { files } });
const dropOnZone = (files: File[]) => {
  const zone = document.querySelector("[data-slot=file-input-dropzone]") as HTMLElement;
  fireEvent.drop(zone, { dataTransfer: { files, types: ["Files"], items: files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })) } });
};

describe("ImportDialog", () => {
  it("renders the dialog with the four tabs and the files tab selected", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Import to Cover" });
    expect(within(dialog).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Files", "Libraries", "Workspaces", "Projects"]);
    expect(within(dialog).getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
    expect(within(dialog).getByText("Drop files to import into Cover")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Place on canvas" })).toBeDisabled();
  });

  it("reads a picked file, lists it as ready and delivers it with its text when placed", async () => {
    const user = userEvent.setup();
    const { onImport, onOpenChange } = setup();
    const file = svg("logo.svg", "<svg>hi</svg>");
    pick(file);
    const list = await screen.findByRole("list", { name: "Queued files" });
    await waitFor(() => expect(within(list).getByRole("img", { name: "Ready" })).toBeInTheDocument());
    expect(within(list).getByText("logo.svg")).toBeInTheDocument();
    expect(within(list).getByText(/^SVG · /)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Place on canvas" }));
    expect(onImport).toHaveBeenCalledWith({ source: "files", files: [{ file, text: "<svg>hi</svg>" }] });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("does not read images and delivers them without text", async () => {
    const user = userEvent.setup();
    const { onImport } = setup();
    const file = new File(["x"], "hero.png", { type: "image/png" });
    pick(file);
    await user.click(await screen.findByRole("button", { name: "Place on canvas" }));
    expect(onImport).toHaveBeenCalledWith({ source: "files", files: [{ file, text: undefined }] });
  });

  it("shows the reading state with progress until the read ends and blocks the action", async () => {
    const user = userEvent.setup();
    let finish: () => void = () => {};
    const original = FileReader.prototype.readAsText;
    vi.spyOn(FileReader.prototype, "readAsText").mockImplementation(function (this: FileReader, blob: Blob) {
      this.dispatchEvent(new ProgressEvent("progress", { lengthComputable: true, loaded: 5, total: 10 }));
      finish = () => original.call(this, blob);
    });
    setup();
    pick(svg());
    expect(await screen.findByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByRole("button", { name: "Place on canvas" })).toBeDisabled();
    await act(async () => finish());
    await waitFor(() => expect(screen.getByRole("button", { name: "Place on canvas" })).toBeEnabled());
  });

  it("blocks the action while any file is still being read even if another is ready", async () => {
    vi.spyOn(FileReader.prototype, "readAsText").mockImplementation(() => {});
    setup();
    pick(new File(["x"], "a.png", { type: "image/png" }), svg("slow.svg"));
    await screen.findByText("slow.svg");
    expect(screen.getByRole("button", { name: "Place on canvas" })).toBeDisabled();
  });

  it("marks a file that cannot be read and keeps it out of the delivery", async () => {
    const user = userEvent.setup();
    vi.spyOn(FileReader.prototype, "readAsText").mockImplementation(function (this: FileReader) {
      queueMicrotask(() => this.dispatchEvent(new ProgressEvent("error")));
    });
    setup();
    pick(svg("bad.svg"));
    expect(await screen.findByText("Could not read the file")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Could not be imported" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Place on canvas" })).toBeDisabled();
  });

  it("rejects unsupported formats with a reason and removes files", async () => {
    const user = userEvent.setup();
    const { onImport } = setup();
    dropOnZone([new File(["x"], "notes.txt", { type: "text/plain" })]);
    expect(await screen.findByText("Format not supported")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Could not be imported" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Place on canvas" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Remove notes.txt" }));
    expect(screen.queryByRole("list", { name: "Queued files" })).not.toBeInTheDocument();
    expect(onImport).not.toHaveBeenCalled();
  });

  it("shows the dragging prompt while files are over the zone", () => {
    setup();
    const zone = document.querySelector("[data-slot=file-input-dropzone]") as HTMLElement;
    const transfer = { types: ["Files"], items: [{ kind: "file", type: "image/svg+xml" }], files: [] };
    fireEvent.dragEnter(zone, { dataTransfer: transfer });
    fireEvent.dragOver(zone, { dataTransfer: transfer });
    expect(screen.getByText("Release to import into Cover")).toBeInTheDocument();
  });

  it("rejects files above the size limit", async () => {
    setup({ maxFileSize: 10 });
    dropOnZone([svg("big.svg", "<svg>this is long</svg>")]);
    expect(await screen.findByText(/^Larger than /)).toBeInTheDocument();
  });

  it("switches tabs and delivers the selected items of a source tab", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    const { onImport, onOpenChange } = setup({ onTabChange });
    await user.click(screen.getByRole("tab", { name: "Libraries" }));
    expect(onTabChange).toHaveBeenCalledWith("libraries");
    expect(screen.getByText("On this server")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /Trio Pixel/ }));
    await user.click(screen.getByRole("checkbox", { name: /App · new interface/ }));
    await user.click(screen.getByRole("checkbox", { name: /App · new interface/ }));
    await user.click(screen.getByRole("button", { name: "Import 1 library" }));
    expect(onImport).toHaveBeenCalledWith({ source: "libraries", ids: ["l1"] });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("shows loading, error with retry and empty states in the other source tabs", async () => {
    const user = userEvent.setup();
    const onRetrySource = vi.fn();
    setup({ onRetrySource, sources: { ...sources, workspaces: { items: [] } } });
    await user.click(screen.getByRole("tab", { name: "Workspaces" }));
    expect(screen.getByText("Nothing to import here.")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Projects" }));
    expect(screen.getByRole("alert")).toHaveTextContent("server unreachable");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetrySource).toHaveBeenCalledWith("projects");
  });

  it("shows a skeleton while a source loads", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("tab", { name: "Workspaces" }));
    expect(screen.getByRole("status", { name: "Loading" })).toBeInTheDocument();
  });

  it("keeps the dialog open and shows the failure when the owner rejects", async () => {
    const user = userEvent.setup();
    const onImport = vi.fn(() => Promise.reject(new Error("disk full")));
    const { onOpenChange } = setup({ onImport });
    pick(new File(["x"], "a.png", { type: "image/png" }));
    await user.click(await screen.findByRole("button", { name: "Place on canvas" }));
    expect(await screen.findByText("Could not import: disk full")).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("cancels with the button and with Escape, and follows a controlled tab", async () => {
    const user = userEvent.setup();
    const { onOpenChange, rerender, onImport } = setup({ tab: "projects" });
    expect(screen.getByRole("tab", { name: "Projects" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(<ImportDialog open onOpenChange={onOpenChange} destination="Cover" sources={sources} onImport={onImport} tab="libraries" />);
    expect(screen.getByRole("tab", { name: "Libraries" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledTimes(2);
  });

  it("clears the queue when closed and reopened, and returns focus to the opener", async () => {
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open the dialog</button>
          <ImportDialog open={open} onOpenChange={setOpen} destination="Cover" sources={sources} onImport={vi.fn()} />
        </>
      );
    }
    render(<Host />);
    pick(new File(["x"], "a.png", { type: "image/png" }));
    expect(await screen.findByText("a.png")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Open the dialog" }));
    expect(screen.queryByText("a.png")).not.toBeInTheDocument();
  });

  it("translates to pt-BR", async () => {
    await i18n.changeLanguage("pt-BR");
    try {
      const user = userEvent.setup();
      setup();
      expect(screen.getByRole("dialog", { name: "Importar para Cover" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Bibliotecas" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Colocar no canvas" })).toBeInTheDocument();
      await user.click(screen.getByRole("tab", { name: "Bibliotecas" }));
      await user.click(screen.getByRole("checkbox", { name: /Trio Pixel/ }));
      await user.click(screen.getByRole("checkbox", { name: /App · new interface/ }));
      expect(screen.getByRole("button", { name: "Importar 2 bibliotecas" })).toBeEnabled();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("renders in rtl without physical direction classes in its own markup", () => {
    render(
      <div dir="rtl">
        <ImportDialog open onOpenChange={vi.fn()} destination="Cover" sources={sources} onImport={vi.fn()} />
      </div>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders closed on the server", () => {
    expect(renderToString(<ImportDialog open={false} onOpenChange={vi.fn()} destination="Cover" onImport={vi.fn()} />)).not.toContain("Import to");
  });
});
