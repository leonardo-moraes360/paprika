import { useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { ImageOff, ImagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { errorText } from "./api";
import { InlineName } from "./InlineName";
import { bar, cx, ui } from "./ui";
import { useWorkspaceMutations, useWorkspaces, useWorkspacesFollow, type Workspace } from "./workspaces";

/** Same limit as the server; bigger images are scaled down in the browser first. */
const MAX_COVER_BYTES = 2 * 1024 * 1024;
const COVER_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** The image as the server takes it: as is when small enough, else scaled to 960px wide as WebP. */
async function coverBody(file: File): Promise<Blob> {
  if (file.size <= MAX_COVER_BYTES && COVER_TYPES.includes(file.type)) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 960 / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/webp", 0.85));
  if (!blob) throw new Error("não foi possível converter a imagem");
  return blob;
}

const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

/** "agora", "há 5 minutos", "ontem"… */
export function relativeTime(at: number, now = Date.now()): string {
  const s = Math.round((at - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return "agora";
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 30 * 86_400) return rtf.format(Math.round(s / 86_400), "day");
  return new Date(at).toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" });
}

/** Hue of the card's tile, stable per workspace (around the brand's warm and cool accents). */
function hue(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return [12, 24, 188, 200, 130, 340][h % 6]!;
}

/** The tile's letter and glow follow the workspace hue. */
const tile = (h: number): CSSProperties => ({
  color: `hsl(${h} 70% 78%)`,
  background: `radial-gradient(circle at 30% 20%, hsl(${h} 60% 40% / 0.55), transparent 60%), linear-gradient(160deg, var(--color-panel-2), var(--color-night))`,
});

const button = (primary: boolean) =>
  cx(
    "cursor-pointer rounded-lg border px-3.5 py-1.75 disabled:cursor-default disabled:opacity-60",
    primary ? "border-accent bg-accent font-semibold text-white" : "border-line bg-panel",
  );

interface Props {
  connected: boolean;
  /** Id of the active workspace (from the live connection); a change refreshes the list. */
  activeId: string | null;
  version: number;
  onOpen: (id: string) => void;
}

/** Home page: the workspaces of this server; opening one goes to its canvas. */
export function Overview({ connected, activeId, version, onOpen }: Props) {
  const list = useWorkspaces();
  useWorkspacesFollow(activeId, version);
  const mutations = useWorkspaceMutations();
  const workspaces = list.data ?? null;
  /** Error of the last mutation; a later success clears it. */
  const [failure, setFailure] = useState<string | null>(null);
  const error = failure ?? (list.error ? `Não foi possível listar os workspaces: ${errorText(list.error)}` : null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  /** One click opens a card; the pencil button or F2 renames it. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Workspace | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  /** Workspace whose cover the file picker is choosing. */
  const coverFor = useRef<string | null>(null);

  /** Runs a mutation; its error goes to the banner with what was being done. */
  const attempt = async <T,>(what: string, run: () => Promise<T>): Promise<T | undefined> => {
    try {
      const out = await run();
      setFailure(null);
      return out;
    } catch (err) {
      setFailure(`Não foi possível ${what}: ${errorText(err)}`);
      return undefined;
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const w = await attempt("criar o workspace", () => mutations.create.mutateAsync(name.trim()));
    if (!w) return;
    setName("");
    setCreating(false);
    onOpen(w.id);
  };

  const count = workspaces?.length ?? 0;

  const rename = (w: Workspace, next: string) => attempt("renomear o workspace", () => mutations.rename.mutateAsync({ id: w.id, name: next }));

  const setCover = (id: string, file: File | null) =>
    attempt(`${file ? "trocar" : "remover"} a capa`, async () => mutations.cover.mutateAsync({ id, body: file ? await coverBody(file) : null }));

  const pickCover = (id: string) => {
    coverFor.current = id;
    coverInput.current?.click();
  };

  const askDelete = (w: Workspace) => {
    setDeleting(w);
    dialog.current?.showModal();
  };

  const confirmDelete = async () => {
    const w = deleting;
    dialog.current?.close();
    if (!w) return;
    await attempt("excluir o workspace", () => mutations.remove.mutateAsync(w.id));
  };

  const onCardKey = (e: KeyboardEvent, w: Workspace) => {
    if (e.key === "Enter" || e.key === " ") onOpen(w.id);
    else if (e.key === "F2") setRenaming(w.id);
    else if ((e.key === "Delete" || e.key === "Backspace") && count > 1) askDelete(w);
    else return;
    e.preventDefault();
  };

  /** Where the canvas and the agents go when the active workspace is deleted (the list is most recent first). */
  const successor = deleting?.active ? workspaces?.find((w) => w.id !== deleting.id) : undefined;
  return (
    <div className="grid h-full grid-rows-[44px_1fr]">
      <header className={bar.topbar}>
        <div className={bar.brand}>
          <img className={bar.logo} src="/icon.svg" alt="" />
          <strong>Paprika</strong>
        </div>
        <div className={bar.status}>
          <span className={bar.dot(connected)} />
          <span className={bar.statusText}>{connected ? "MCP em /mcp" : "desconectado"}</span>
        </div>
      </header>
      <main className="min-h-0 overflow-auto px-6 pt-8 pb-12 *:mx-auto *:max-w-[1080px]">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="mx-0 mt-0 mb-1.5 text-xl font-[650]">Workspaces</h1>
            <p className="m-0 text-muted">
              {workspaces ? `${count} ${count === 1 ? "workspace" : "workspaces"} neste servidor.` : "Carregando…"} O ativo é o que os agentes
              enxergam pelo MCP. Clique para abrir; F2 ou o lápis renomeia.
            </p>
          </div>
          {creating ? (
            <form className="flex gap-2" onSubmit={create}>
              <input
                className="w-60 max-w-[50vw] rounded-lg border border-line bg-panel-2 px-2.5 py-1.75 focus:outline-2 focus:-outline-offset-1 focus:outline-select"
                autoFocus
                aria-label="Nome do workspace"
                placeholder="Nome do workspace"
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
              />
              <button type="submit" className={button(true)} disabled={mutations.create.isPending}>
                Criar
              </button>
              <button type="button" className={button(false)} onClick={() => setCreating(false)}>
                Cancelar
              </button>
            </form>
          ) : (
            <button className={button(true)} onClick={() => setCreating(true)}>
              <Plus className="-ml-0.5 align-[-3px]" size={15} aria-hidden /> Novo workspace
            </button>
          )}
        </div>
        {error && (
          <div className="mb-4 rounded-lg bg-accent-soft px-3 py-2.5 text-accent-ink" role="alert">
            {error}
          </div>
        )}
        <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4 p-0" aria-label="Workspaces">
          {workspaces?.map((w) => (
            <li key={w.id} className="group relative">
              <div
                role="button"
                tabIndex={0}
                aria-label={`Abrir workspace ${w.name}`}
                className={cx(
                  // "workspace-card" and "is-active" stay as hooks for the E2E suite.
                  // No lift on hover: moving onto the action buttons (outside the card) dropped it back, a visible flick.
                  // The hover color follows the <li>, so it holds while the pointer is on those buttons.
                  // The edge is an inset outline, not a border: outlines paint over the children, so the cover cannot
                  // eat the rounded corners. The focus ring is a box-shadow, which overflow-hidden does not clip.
                  "workspace-card relative flex w-full cursor-pointer flex-col overflow-hidden rounded-xl border-0 bg-panel p-0 text-left",
                  "outline-1 -outline-offset-1 outline-solid transition-[outline-color] duration-120",
                  "focus-visible:shadow-[0_0_0_2px_var(--color-night),0_0_0_4px_var(--color-select)]",
                  w.active ? "is-active outline-accent" : "outline-line group-hover:outline-muted",
                )}
                onClick={() => renaming !== w.id && onOpen(w.id)}
                onKeyDown={(e) => e.target === e.currentTarget && onCardKey(e, w)}
                onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
                onDrop={(e) => {
                  const file = e.dataTransfer.files[0];
                  if (!file?.type.startsWith("image/")) return;
                  e.preventDefault();
                  void setCover(w.id, file);
                }}
                data-workspace-id={w.id}
              >
                <span className="workspace-tile grid h-32 place-items-center overflow-hidden border-b border-line text-tile font-bold" style={tile(hue(w.id))} aria-hidden>
                  {w.cover ? (
                    // "workspace-tile" and "workspace-cover" are hooks for the E2E suite.
                    <img className="workspace-cover size-full object-cover object-top" src={w.cover} alt="" draggable={false} />
                  ) : (
                    (w.name.trim()[0] ?? "?").toUpperCase()
                  )}
                </span>
                <span className="grid min-w-0 gap-1 px-3.5 pt-3 pb-3.5">
                  {renaming === w.id ? (
                    <InlineName
                      className={cx(ui.renameInput, "-mx-1.75 -my-0.75 px-1.5 py-0.5 text-md font-semibold")}
                      label="Novo nome do workspace"
                      value={w.name}
                      maxLength={120}
                      onCommit={(next) => void rename(w, next)}
                      onDone={() => setRenaming(null)}
                    />
                  ) : (
                    <span className="workspace-name truncate text-md font-semibold">{w.name}</span>
                  )}
                  <span className="text-muted">
                    {w.nodes} {w.nodes === 1 ? "nó" : "nós"} · {relativeTime(w.updatedAt)}
                  </span>
                </span>
                {w.active && (
                  <span className="absolute top-2.5 right-2.5 rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white" title="Aberto no servidor: os agentes MCP leem e escrevem neste">
                    ativo
                  </span>
                )}
              </div>
              {renaming !== w.id && (
                <span className="absolute right-2.5 bottom-3 flex gap-0.5 rounded-md bg-panel opacity-0 transition-opacity duration-120 group-hover:opacity-100 group-focus-within:opacity-100">
                  <button type="button" className={cx(ui.iconBtn, "px-1.5 py-1 text-lg")} aria-label={`Renomear ${w.name}`} title="Renomear (F2)" onClick={() => setRenaming(w.id)}>
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    className={cx(ui.iconBtn, "px-1.5 py-1 text-lg")}
                    aria-label={`${w.cover ? "Trocar" : "Adicionar"} capa de ${w.name}`}
                    title={`${w.cover ? "Trocar" : "Adicionar"} capa (ou arraste uma imagem para o card)`}
                    onClick={() => pickCover(w.id)}
                  >
                    <ImagePlus size={16} />
                  </button>
                  {w.cover && (
                    <button type="button" className={cx(ui.iconBtn, "px-1.5 py-1 text-lg")} aria-label={`Remover capa de ${w.name}`} title="Remover capa" onClick={() => void setCover(w.id, null)}>
                      <ImageOff size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    className={cx(ui.iconBtn, "px-1.5 py-1 text-lg disabled:cursor-default disabled:opacity-60")}
                    aria-label={`Excluir ${w.name}`}
                    title={count > 1 ? "Excluir (Delete)" : "O único workspace não pode ser excluído"}
                    disabled={count <= 1}
                    onClick={() => askDelete(w)}
                  >
                    <Trash2 size={16} />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
        <input
          ref={coverInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          aria-label="Imagem de capa"
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (file && coverFor.current) void setCover(coverFor.current, file);
          }}
        />
        <dialog
          ref={dialog}
          className="m-auto max-w-[420px] rounded-xl border border-line bg-panel px-5.5 py-5 text-fg backdrop:bg-night/70"
          aria-labelledby="delete-title"
          // The close event is queued: when the dialog is reopened right after closing (Cancel, then Delete),
          // the old event arrives while it is open again and must not empty it.
          onClose={(e) => !e.currentTarget.open && setDeleting(null)}
        >
          {deleting && (
            <form method="dialog" onSubmit={(e) => e.preventDefault()}>
              <h2 id="delete-title" className="mx-0 mt-0 mb-2 text-lg">
                Excluir “{deleting.name}”?
              </h2>
              <p className="mx-0 mt-0 mb-2.5 text-muted">
                {deleting.nodes} {deleting.nodes === 1 ? "nó" : "nós"} e o histórico de desfazer serão apagados. Essa ação não pode ser desfeita.
              </p>
              {deleting.active && successor && (
                <p className="mx-0 mt-0 mb-2.5 text-muted">Este é o workspace ativo: o canvas e os agentes MCP passam para “{successor.name}”.</p>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" className={button(false)} onClick={() => dialog.current?.close()}>
                  Cancelar
                </button>
                <button type="button" className={button(true)} onClick={() => void confirmDelete()}>
                  Excluir
                </button>
              </div>
            </form>
          )}
        </dialog>
      </main>
    </div>
  );
}
