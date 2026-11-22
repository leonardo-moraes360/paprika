import { useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { ImageOff, ImagePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { errorText } from "./api";
import { ConfirmDialog } from "./ConfirmDialog";
import { ConnectionStatus } from "./ConnectionStatus";
import { InlineName } from "./InlineName";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Hint } from "./components/ui/tooltip";
import { LanguageSwitcher, untitledFor, useLocale, useT } from "./i18n";
import { cn } from "./lib/cn";
import { bar, cx, ui } from "./ui";
import { useWorkspaceMutations, useWorkspaces, useWorkspacesFollow, type Workspace } from "./workspaces";

/** Same limit as the server; bigger images are scaled down in the browser first. */
const MAX_COVER_BYTES = 2 * 1024 * 1024;
const COVER_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** The image as the server takes it: as is when small enough, else scaled to 960px wide as WebP. */
async function coverBody(file: File, failMsg: string): Promise<Blob> {
  if (file.size <= MAX_COVER_BYTES && COVER_TYPES.includes(file.type)) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 960 / bitmap.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/webp", 0.85));
  if (!blob) throw new Error(failMsg);
  return blob;
}

/** "now", "5 minutes ago", "yesterday"… */
export function relativeTime(at: number, locale: string, nowLabel: string, now = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const s = Math.round((at - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return nowLabel;
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86_400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 30 * 86_400) return rtf.format(Math.round(s / 86_400), "day");
  return new Date(at).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
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

const iconAction = "h-auto px-1.5 py-1";

interface Props {
  connected: boolean;
  /** Id of the active workspace (from the live connection); a change refreshes the list. */
  activeId: string | null;
  version: number;
  onOpen: (id: string) => void;
}

/** Home page: the workspaces of this server; opening one goes to its canvas. */
export function Overview({ connected, activeId, version, onOpen }: Props) {
  const m = useT();
  const { locale } = useLocale();
  const list = useWorkspaces();
  useWorkspacesFollow(activeId, version);
  const mutations = useWorkspaceMutations();
  const workspaces = list.data ?? null;
  /** Error of the last mutation; a later success clears it. */
  const [failure, setFailure] = useState<string | null>(null);
  const error = failure ?? (list.error ? m.listWorkspacesFail(errorText(list.error)) : null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  /** One click opens a card; the pencil button or F2 renames it. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Workspace | null>(null);
  const [confirming, setConfirming] = useState(false);
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
      setFailure(m.mutationFail(what, errorText(err)));
      return undefined;
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim() || untitledFor();
    const w = await attempt(m.whatCreateWorkspace, () => mutations.create.mutateAsync(trimmed));
    if (!w) return;
    setName("");
    setCreating(false);
    onOpen(w.id);
  };

  const count = workspaces?.length ?? 0;

  const rename = (w: Workspace, next: string) => attempt(m.whatRenameWorkspace, () => mutations.rename.mutateAsync({ id: w.id, name: next }));

  const setCover = (id: string, file: File | null) =>
    attempt(file ? m.whatChangeCover : m.whatRemoveCover, async () =>
      mutations.cover.mutateAsync({ id, body: file ? await coverBody(file, m.coverConvertFail) : null }),
    );

  const pickCover = (id: string) => {
    coverFor.current = id;
    coverInput.current?.click();
  };

  const askDelete = (w: Workspace) => {
    setDeleting(w);
    setConfirming(true);
  };

  const confirmDelete = async () => {
    const w = deleting;
    setConfirming(false);
    if (!w) return;
    await attempt(m.whatDeleteWorkspace, () => mutations.remove.mutateAsync(w.id));
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
  const countLabel = workspaces ? m.overviewCount(count) : m.loading;
  return (
    <div className="grid h-full grid-rows-[44px_1fr]">
      <header className={bar.topbar}>
        <div className={bar.brand}>
          <img className={bar.logo} src="/icon.svg" alt="" />
          <strong>Paprika</strong>
        </div>
        <div className={bar.status}>
          <LanguageSwitcher />
          <span className={bar.dot(connected)} aria-hidden />
          <span className={bar.statusText}>{connected ? m.mcpOn : m.disconnectedShort}</span>
          <ConnectionStatus connected={connected} />
        </div>
      </header>
      <main className="min-h-0 overflow-auto px-6 pt-8 pb-12 *:mx-auto *:max-w-[1080px]">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="mx-0 mt-0 mb-1.5 text-xl font-[650]">{m.overviewHeading}</h1>
            <p className="m-0 text-muted">{m.overviewLead(countLabel)}</p>
          </div>
          {creating ? (
            <form className="flex items-center gap-2" onSubmit={create}>
              <Input
                className="w-60 max-w-[50vw]"
                autoFocus
                aria-label={m.workspaceName}
                placeholder={m.workspaceName}
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
              />
              <Button type="submit" disabled={mutations.create.isPending}>
                {m.createWorkspace}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setCreating(false)}>
                {m.cancel}
              </Button>
            </form>
          ) : (
            <Button onClick={() => setCreating(true)}>
              <Plus className="-ml-0.5" size={15} aria-hidden /> {m.newWorkspace}
            </Button>
          )}
        </div>
        {error && (
          <div className="mb-4 rounded-lg bg-accent-soft px-3 py-2.5 text-accent-ink" role="alert">
            {error}
          </div>
        )}
        <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4 p-0" aria-label={m.overviewHeading}>
          {workspaces?.map((w) => (
            <li key={w.id} className="group relative">
              <Card
                role="button"
                tabIndex={0}
                aria-label={m.overviewOpenAria(w.name)}
                className={cn(
                  // "workspace-card" and "is-active" stay as hooks for the E2E suite.
                  "workspace-card relative w-full cursor-pointer gap-0 overflow-hidden border-0 p-0 text-left",
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
                <span className="workspace-tile grid h-32 place-items-center overflow-hidden border-b border-ui-border text-tile font-bold" style={tile(hue(w.id))} aria-hidden>
                  {w.cover ? (
                    <img className="workspace-cover size-full object-cover object-top" src={w.cover} alt="" draggable={false} />
                  ) : (
                    (w.name.trim()[0] ?? "?").toUpperCase()
                  )}
                </span>
                <CardContent className="grid min-w-0 gap-1 px-3.5 pt-3 pb-3.5">
                  {renaming === w.id ? (
                    <InlineName
                      className={cx(ui.renameInput, "-mx-1.75 -my-0.75 px-1.5 py-0.5 text-md font-semibold")}
                      label={m.workspaceNameNew}
                      value={w.name}
                      maxLength={120}
                      onCommit={(next) => void rename(w, next)}
                      onDone={() => setRenaming(null)}
                    />
                  ) : (
                    <span className="workspace-name truncate text-md font-semibold">{w.name}</span>
                  )}
                  <span className="text-ui-muted-foreground">
                    {w.nodes} {w.nodes === 1 ? m.nodeSingular : m.nodePlural} · {relativeTime(w.updatedAt, locale, m.relativeNow)}
                  </span>
                </CardContent>
                {w.active && (
                  <Hint label={m.overviewActiveHint}>
                    <span className="absolute top-2.5 right-2.5 rounded-full bg-ui-primary px-2 py-0.5 text-xs font-semibold text-ui-primary-foreground" tabIndex={0}>
                      {m.overviewActive}
                    </span>
                  </Hint>
                )}
              </Card>
              {renaming !== w.id && (
                <span className="absolute right-2.5 bottom-3 flex gap-0.5 rounded-md bg-ui-card opacity-0 transition-opacity duration-120 group-hover:opacity-100 group-focus-within:opacity-100">
                  <Hint label={m.overviewRenameHint}>
                    <Button type="button" variant="ghost" className={iconAction} aria-label={m.overviewRenameAria(w.name)} onClick={() => setRenaming(w.id)}>
                      <Pencil size={16} />
                    </Button>
                  </Hint>
                  <Hint label={m.overviewCoverHint(!!w.cover)}>
                    <Button
                      type="button"
                      variant="ghost"
                      className={iconAction}
                      aria-label={m.overviewCoverAria(w.cover ? m.changeCover : m.overviewAddCover, w.name)}
                      onClick={() => pickCover(w.id)}
                    >
                      <ImagePlus size={16} />
                    </Button>
                  </Hint>
                  {w.cover && (
                    <Hint label={m.overviewCoverAria(m.removeCover, w.name)}>
                      <Button
                        type="button"
                        variant="ghost"
                        className={iconAction}
                        aria-label={m.overviewCoverAria(m.removeCover, w.name)}
                        onClick={() => void setCover(w.id, null)}
                      >
                        <ImageOff size={16} />
                      </Button>
                    </Hint>
                  )}
                  <Hint label={count > 1 ? m.deleteWorkspace : m.deleteWorkspaceBlocked}>
                    {count <= 1 ? (
                      <span className="inline-flex" tabIndex={0}>
                        <Button
                          type="button"
                          variant="ghost"
                          className={cn(iconAction, "text-ui-destructive-text hover:text-ui-destructive-text")}
                          aria-label={m.overviewDeleteAria(w.name)}
                          disabled
                          onClick={() => askDelete(w)}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </span>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        className={cn(iconAction, "text-ui-destructive-text hover:text-ui-destructive-text")}
                        aria-label={m.overviewDeleteAria(w.name)}
                        onClick={() => askDelete(w)}
                      >
                        <Trash2 size={16} />
                      </Button>
                    )}
                  </Hint>
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
          aria-label={m.coverImage}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (file && coverFor.current) void setCover(coverFor.current, file);
          }}
        />
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={m.deleteWorkspaceTitle(deleting?.name ?? "")}
          description={
            deleting &&
            m.deleteWorkspaceBody(`${deleting.nodes} ${deleting.nodes === 1 ? m.nodeSingular : m.nodePlural}`)
          }
          confirmLabel={m.deleteWorkspaceConfirm}
          typeToConfirm={deleting?.name}
          onConfirm={confirmDelete}
        >
          {deleting?.active && successor && (
            <p className="m-0 text-xs text-ui-muted-foreground">{m.overviewActiveSuccessor(successor.name)}</p>
          )}
        </ConfirmDialog>
      </main>
    </div>
  );
}
