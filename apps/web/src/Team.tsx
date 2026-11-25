import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Copy, KeyRound, Link2, Share2, UserPlus, Users } from "lucide-react";
import { encode } from "uqr";
import type { AgentPresence } from "./agents";
import { ConfirmDialog } from "./ConfirmDialog";
import { cx, ui } from "./ui";
import { cn } from "./lib/cn";
import { buttonVariants } from "./components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Hint } from "./components/ui/tooltip";

export interface TeamMember {
  key: string;
  name: string;
  fingerprint: string;
  addedBy: string;
  addedByName?: string | null;
  at: number;
  founder: boolean;
  you: boolean;
  agents: string[];
  rotated?: boolean;
}
export interface RemovedMember {
  key: string;
  name: string;
  fingerprint: string;
  at: number;
  by: string;
  byName?: string | null;
  you: boolean;
}
export interface TeamPeer {
  id: string;
  name: string;
  state: "direct" | "relay" | "connecting" | "offline";
  rttMs?: number | null;
  app?: string;
  format?: string;
}
export interface TeamStatus {
  id: string;
  name: string;
  fingerprint: string;
  app?: string;
  format?: string;
  team: {
    id: string;
    name: string;
    members: TeamMember[];
    removed?: RemovedMember[];
    invites: { expires: number }[];
    member?: boolean;
    canRemove?: boolean;
  } | null;
  peers: TeamPeer[];
  docs: { id: string; envelopes: number; authors: number }[];
  rejected: number;
  lastRejected?: { reason?: string; peer?: string } | null;
}

async function api<T = unknown>(path: string, method = "GET", body?: object): Promise<T> {
  const res = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export function teamFingerprint(id: string) {
  return (id.toUpperCase().match(/.{1,4}/g) ?? []).slice(0, 4).join(" · ");
}

type Tone = "ok" | "warn" | "busy" | "off" | "bad";
const TONE_DOT: Record<Tone, string> = { ok: "bg-leaf", warn: "bg-warn", busy: "bg-select", off: "bg-ui-muted-foreground", bad: "bg-accent" };

export function teamSummary(st: TeamStatus | null): { label: string; tone: Tone } {
  if (!st?.team) return { label: "Só neste dispositivo", tone: "off" };
  const name = st.team.name;
  if (st.lastRejected && st.rejected > 0) return { label: `${name} · chave rejeitada`, tone: "bad" };
  const others = st.peers;
  const online = others.filter((p) => p.state === "direct" || p.state === "relay");
  if (others.length === 0) return { label: `${name} · só você`, tone: "off" };
  if (online.length === 0) return { label: `${name} · offline`, tone: "off" };
  if (others.some((p) => p.state === "connecting")) return { label: `${name} · conectando…`, tone: "warn" };
  if (online.some((p) => p.state === "relay")) return { label: `${name} · ${online.length + 1} online · via relay`, tone: "warn" };
  return { label: `${name} · ${online.length + 1} online · sincronizado`, tone: "ok" };
}

export function TeamChip({ status, onClick }: { status: TeamStatus | null; onClick(): void }) {
  const s = teamSummary(status);
  return (
    <Hint label="Time: pessoas, agentes e sincronização" side="bottom">
      <button
        className="team-chip inline-flex max-w-[320px] cursor-pointer items-center gap-2 rounded-full border border-ui-input bg-ui-secondary px-2.5 py-0.75 text-ui-foreground hover:border-select"
        onClick={onClick}
      >
        <span className={cx("size-2 shrink-0 rounded-full", TONE_DOT[s.tone])} />
        <span className="truncate text-xs font-semibold">{s.label}</span>
      </button>
    </Hint>
  );
}

const STATE_LABEL: Record<TeamPeer["state"], [string, Tone]> = {
  direct: ["direto", "ok"],
  relay: ["relay", "warn"],
  connecting: ["conectando", "busy"],
  offline: ["offline", "off"],
};

function Chip({ label, tone }: { label: string; tone: Tone }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ui-background px-2 py-0.5 text-xs font-semibold text-ui-muted-foreground">
      <span className={cx("size-1.5 rounded-full", TONE_DOT[tone])} />
      {label}
    </span>
  );
}

const btn = (primary = false) =>
  cn(buttonVariants({ size: "sm", variant: primary ? "default" : "secondary" }), "[&_svg]:size-3.5 hover:border-select");

function Avatar({ name, you }: { name: string; you?: boolean }) {
  return (
    <span className={cx("inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white", you ? "bg-accent-strong" : "bg-label")}>
      {(name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Qr({ text, size = 168 }: { text: string; size?: number }) {
  const data = useMemo(() => encode(text, { ecc: "L", border: 2 }).data, [text]);
  const n = data.length;
  return (
    <svg className="team-qr rounded-md bg-white" width={size} height={size} viewBox={`0 0 ${n} ${n}`} role="img" aria-label="QR code do convite" shapeRendering="crispEdges">
      {data.flatMap((row, y) => row.map((on, x) => (on ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#141827" /> : null)))}
    </svg>
  );
}

function Modal({ title, description, onClose, className, children }: { title: string; description: string; onClose(): void; className?: string; children: ReactNode }) {
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (opener.current?.isConnected) opener.current.focus();
    };
  }, []);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn("max-h-[90vh] overflow-auto", className)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className={ui.grid}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function ErrorNote({ text, className }: { text: string; className?: string }) {
  return <p className={cn("m-0 rounded-md border border-accent bg-toast p-2 text-sm text-accent-pale", className)}>{text}</p>;
}

function ToastBand({ title, body, titleClass, bodyClass }: { title: string; body: ReactNode; titleClass?: string; bodyClass?: string }) {
  return (
    <div className="grid gap-1 rounded-lg border border-accent bg-toast p-3">
      <strong className={cn("text-sm text-accent-pale", titleClass)}>{title}</strong>
      <span className={cn("text-xs text-accent-ink", bodyClass)}>{body}</span>
    </div>
  );
}

const TTLS: [string, number][] = [
  ["15 min", 900],
  ["1 h", 3600],
  ["24 h", 86400],
  ["7 dias", 604800],
];

function clock(unix: number) {
  return new Date(unix * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function InviteDialog({ status, onClose }: { status: TeamStatus; onClose(): void }) {
  const [ttl, setTtl] = useState(3600);
  const [invite, setInvite] = useState<{ link: string; expiresAt: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    let alive = true;
    setInvite(null);
    api<{ link: string; expiresAt: number }>("/api/team/invites", "POST", { ttlSecs: ttl })
      .then((r) => alive && setInvite(r))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [ttl]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);
  const left = invite ? Math.max(0, Math.round(invite.expiresAt - now)) : 0;
  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  return (
    <Modal
      title={`Convidar para ${status.team?.name ?? "o time"}`}
      description="Quem abrir o link entra no time com a própria chave. O link vale uma vez e expira."
      onClose={onClose}
      className="max-w-[640px]"
    >
      {error && <ErrorNote text={error} />}
      <div className="flex flex-wrap items-start gap-5">
        {invite ? <Qr text={invite.link} /> : <div className="size-[168px] rounded-md bg-panel-2" />}
        <div className="grid min-w-[260px] flex-1 gap-3">
          <Field id="invite-link" label="Link de convite">
            <Input id="invite-link" className="invite-link font-mono text-xs" readOnly value={invite?.link ?? "gerando…"} onFocus={(e) => e.target.select()} />
          </Field>
          <div className="grid gap-1.5">
            <span className="text-xs text-ui-muted-foreground">Expira em</span>
            <div className="grid grid-cols-4 gap-0.5 rounded-md bg-ui-background p-0.5" role="radiogroup" aria-label="Validade do convite">
              {TTLS.map(([label, secs]) => (
                <button
                  key={secs}
                  role="radio"
                  aria-checked={ttl === secs}
                  className={cn("cursor-pointer rounded-sm border-0 py-1 text-xs", ttl === secs ? "bg-ui-card font-semibold text-ui-foreground" : "bg-transparent text-ui-muted-foreground")}
                  onClick={() => setTtl(secs)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {invite && (
            <p className="m-0 flex items-center gap-2 text-xs text-ui-muted-foreground">
              <span className="size-2 rounded-full bg-warn" />
              expira às {clock(invite.expiresAt)} · faltam {mmss} · uso único
            </p>
          )}
          <div className="grid gap-1 rounded-md bg-ui-background p-2.5">
            <span className="text-xs text-ui-muted-foreground">Confira por voz com quem entra:</span>
            <strong className="font-mono text-md text-accent-ink">{teamFingerprint(status.team?.id ?? "")}</strong>
          </div>
        </div>
      </div>
      <DialogFooter>
        <button
          className={btn()}
          onClick={() =>
            api("/api/team/invites", "DELETE")
              .then(onClose)
              .catch((e) => setError(String(e.message ?? e)))
          }
        >
          Revogar links
        </button>
        <button
          className={btn(true)}
          disabled={!invite}
          onClick={() => {
            if (!invite) return;
            void navigator.clipboard?.writeText(invite.link);
            setCopied(true);
          }}
        >
          <Copy size={14} /> {copied ? "Copiado" : "Copiar link"}
        </button>
      </DialogFooter>
    </Modal>
  );
}

interface Preview {
  team: string;
  name: string;
  inviter: string;
  fingerprint: string;
  expiresAt: number;
  expired: boolean;
}

export function JoinDialog({ status, onClose }: { status: TeamStatus | null; onClose(): void }) {
  const [link, setLink] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    setPreview(null);
    setError(null);
    if (!link.trim()) return;
    let alive = true;
    api<Preview>("/api/team/invites/inspect", "POST", { link })
      .then((p) => alive && setPreview(p))
      .catch((e) => alive && setError(String(e.message ?? e)));
    return () => {
      alive = false;
    };
  }, [link]);
  const expiredFor = preview?.expired ? Math.max(1, Math.round((Date.now() / 1000 - preview.expiresAt) / 60)) : 0;
  return (
    <Modal title="Entrar em um time" description="Cole o link ou leia o QR de quem convidou." onClose={onClose} className="max-w-[520px]">
      <Field id="join-link" label="Link de convite">
        <Input id="join-link" className="join-link font-mono text-xs" value={link} placeholder="paprika://join/…" onChange={(e) => setLink(e.target.value)} autoFocus />
      </Field>
      {preview && !preview.expired && (
        <div className="team-preview grid gap-2 rounded-lg border border-ui-border bg-ui-background p-3">
          <div className="flex items-center gap-2.5">
            <Avatar name={preview.name} />
            <div className="grid">
              <strong className="text-sm">{preview.name}</strong>
              <span className="text-xs text-muted">convite válido até {clock(preview.expiresAt)}</span>
            </div>
          </div>
          <strong className="font-mono text-md text-accent-ink">{preview.fingerprint}</strong>
          {status && (
            <span className="text-xs text-muted">
              Sua chave: {status.name || "este dispositivo"} · {status.fingerprint} (criada neste dispositivo)
            </span>
          )}
        </div>
      )}
      {preview?.expired && (
        <ToastBand title={`Convite expirado há ${expiredFor} min`} body="Peça um novo link. Nada foi alterado no seu Paprika." />
      )}
      {error && (
        <ToastBand title="Não deu para entrar" body={error} bodyClass="join-error" />
      )}
      {done && <p className="m-0 text-sm text-leaf">Você entrou no time. Os workspaces compartilhados aparecem na página inicial.</p>}
      <DialogFooter>
        <button className={btn()} onClick={onClose}>
          {done ? "Fechar" : "Cancelar"}
        </button>
        {!done && (
          <button
            className={btn(true)}
            disabled={!preview || preview.expired || busy}
            onClick={() => {
              setBusy(true);
              api("/api/team/join", "POST", { link })
                .then(() => setDone(true))
                .catch((e) => setError(String(e.message ?? e)))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? "Conectando…" : "Entrar"}
          </button>
        )}
      </DialogFooter>
    </Modal>
  );
}

function LeaveTeamDialog({ onClose }: { onClose(): void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title="Sair do time?"
      description="Esta instância deixa de sincronizar. O que já foi mudado continua nos workspaces dos outros; mudanças novas daqui não entram mais. Para voltar, peça um convite novo."
      confirmLabel="Sair do time"
      pendingLabel="Saindo…"
      pending={busy}
      confirmClassName="team-leave-confirm"
      onConfirm={() => {
        setBusy(true);
        api("/api/team/leave", "POST")
          .then(onClose)
          .catch((e) => setError(String(e.message ?? e)))
          .finally(() => setBusy(false));
      }}
    >
      {error && <ErrorNote text={error} className="team-leave-error" />}
    </ConfirmDialog>
  );
}

export function RemoveMemberDialog({ member, onClose }: { member: TeamMember; onClose(): void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title={`Remover ${member.name} do time?`}
      description={`A chave de ${member.name} (ed25519 ${member.fingerprint}) e as dos agentes dela deixam de sincronizar. O que já foi mudado continua nos workspaces; mudanças novas assinadas por essa chave são recusadas.`}
      confirmLabel={`Remover ${member.name}`}
      pendingLabel="Removendo…"
      pending={busy}
      confirmClassName="team-remove-confirm"
      onConfirm={() => {
        setBusy(true);
        api(`/api/team/members/${encodeURIComponent(member.key)}`, "DELETE")
          .then(onClose)
          .catch((e) => setError(String(e.message ?? e)))
          .finally(() => setBusy(false));
      }}
    >
      <p className="m-0 text-xs text-ui-muted-foreground">Para voltar, a pessoa precisa de um convite novo.</p>
      {error && <ErrorNote text={error} className="team-remove-error" />}
    </ConfirmDialog>
  );
}

export function RotateKeyDialog({ status, onClose }: { status: TeamStatus; onClose(): void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [before] = useState(status.fingerprint);
  return (
    <Modal
      title="Gerar nova chave?"
      description="Use se esta máquina ou a chave vazou. A chave nova assina a troca junto com a antiga e o time passa a aceitar só a nova. O sidecar reinicia e os convites ativos são revogados."
      onClose={onClose}
      className="max-w-[520px]"
    >
      <p className="m-0 text-xs text-ui-muted-foreground">{done ? "Chave antiga" : "Chave atual"}: ed25519 {before}. Alguém do time precisa estar online para receber a troca.</p>
      {error && <ErrorNote text={error} className="team-rotate-error" />}
      {done && <p className="m-0 text-sm text-leaf">Chave nova: ed25519 {done}</p>}
      <DialogFooter>
        <button className={btn()} onClick={onClose}>
          {done ? "Fechar" : "Cancelar"}
        </button>
        {!done && (
          <button
            className={cx(btn(true), "team-rotate-confirm")}
            disabled={busy}
            onClick={() => {
              setBusy(true);
              api<{ fingerprint: string }>("/api/team/rotate", "POST")
                .then((r) => setDone(r.fingerprint))
                .catch((e) => setError(String(e.message ?? e)))
                .finally(() => setBusy(false));
            }}
          >
            <KeyRound size={14} /> {busy ? "Trocando…" : "Gerar nova chave"}
          </button>
        )}
      </DialogFooter>
    </Modal>
  );
}

function RemovedNotice({ team }: { team: NonNullable<TeamStatus["team"]> }) {
  if (team.member !== false) return null;
  return (
    <div className="team-removed-you">
      <ToastBand title="Você não está mais neste time" body="Suas mudanças ficam só neste dispositivo. Para voltar, peça um convite novo." />
    </div>
  );
}

export function KeysDialog({ status, onClose, onInvite }: { status: TeamStatus; onClose(): void; onInvite(): void }) {
  const members = status.team?.members ?? [];
  const removed = status.team?.removed ?? [];
  const canRemove = !!status.team?.canRemove;
  const inside = status.team?.member !== false;
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  if (removing) return <RemoveMemberDialog member={removing} onClose={() => setRemoving(null)} />;
  if (leaving) return <LeaveTeamDialog onClose={() => setLeaving(false)} />;
  if (rotating) return <RotateKeyDialog status={status} onClose={() => setRotating(false)} />;
  const peerState = (key: string) => status.peers.find((p) => p.id === key)?.state ?? "offline";
  const date = (unix: number) => new Date(unix * 1000).toLocaleDateString([], { day: "2-digit", month: "short" });
  return (
    <Modal title="Chaves do time" description="Só operações assinadas por estas chaves entram nos workspaces do time." onClose={onClose} className="max-w-[860px]">
      {status.team && <RemovedNotice team={status.team} />}
      <table className="team-keys w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            {["Quem", "Tipo", "Chave pública", "Delegada por", "Desde", "Estado", ""].map((h) => (
              <th key={h} className="border-b border-line px-2 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.flatMap((m) => {
            const st = m.you ? "ativa" : peerState(m.key) === "offline" ? "offline" : "ativa";
            return [
              <tr key={m.key}>
                <td className="border-b border-line px-2 py-2 font-semibold">{m.name}{m.you ? " (você)" : ""}</td>
                <td className="border-b border-line px-2 py-2 text-muted">pessoa</td>
                <td className="border-b border-line px-2 py-2 font-mono text-xs text-accent-ink">
                  <Hint label={m.key}>
                    <span tabIndex={0}>ed25519 {m.fingerprint}</span>
                  </Hint>
                </td>
                <td className="border-b border-line px-2 py-2 text-muted">{m.rotated ? "troca de chave" : m.founder ? "fundador(a)" : `${m.addedByName ?? "?"} (convite)`}</td>
                <td className="border-b border-line px-2 py-2 text-muted">{date(m.at)}</td>
                <td className="border-b border-line px-2 py-2"><Chip label={st} tone={st === "ativa" ? "ok" : "off"} /></td>
                <td className="border-b border-line px-2 py-2 text-right">
                  {m.you && inside && (
                    <span className="inline-flex flex-wrap justify-end gap-1.5">
                      {!m.founder && (
                        <button className={cn(btn(), ui.dangerBtn, "team-leave whitespace-nowrap")} onClick={() => setLeaving(true)}>
                          Sair do time
                        </button>
                      )}
                      <button className={cx(btn(), "team-rotate whitespace-nowrap")} onClick={() => setRotating(true)}>
                        Gerar nova chave
                      </button>
                    </span>
                  )}
                  {!m.you && !m.founder && canRemove && (
                    <button className={cn(btn(), ui.dangerBtn, "team-remove")} onClick={() => setRemoving(m)} aria-label={`Remover ${m.name}`}>
                      Remover
                    </button>
                  )}
                </td>
              </tr>,
              ...m.agents.map((a) => (
                <tr key={`${m.key}/${a}`}>
                  <td className="border-b border-line px-2 py-2 font-semibold">{a} @ {m.name}</td>
                  <td className="border-b border-line px-2 py-2 text-muted">agente</td>
                  <td className="border-b border-line px-2 py-2 font-mono text-xs text-muted">derivada da chave de {m.name}</td>
                  <td className="border-b border-line px-2 py-2 text-muted">{m.name}</td>
                  <td className="border-b border-line px-2 py-2 text-muted">—</td>
                  <td className="border-b border-line px-2 py-2"><Chip label="ativa" tone="ok" /></td>
                  <td className="border-b border-line px-2 py-2" />
                </tr>
              )),
            ];
          })}
          {removed.map((m) => (
            <tr key={`removed/${m.key}`} className="team-removed text-muted">
              <td className="border-b border-line px-2 py-2 font-semibold">{m.name}{m.you ? " (você)" : ""}</td>
              <td className="border-b border-line px-2 py-2">pessoa</td>
              <td className="border-b border-line px-2 py-2 font-mono text-xs">
                <Hint label={m.key}>
                  <span tabIndex={0}>ed25519 {m.fingerprint}</span>
                </Hint>
              </td>
              <td className="border-b border-line px-2 py-2">removida por {m.byName ?? "?"}</td>
              <td className="border-b border-line px-2 py-2">{date(m.at)}</td>
              <td className="border-b border-line px-2 py-2"><Chip label="removida" tone="bad" /></td>
              <td className="border-b border-line px-2 py-2" />
            </tr>
          ))}
        </tbody>
      </table>
      {status.rejected > 0 && (
        <ToastBand title={`${status.rejected} operação(ões) ou conexão(ões) rejeitada(s)`} body={`${status.lastRejected?.reason ?? ""}. Nada foi aplicado.`} />
      )}
      <p className="m-0 flex items-center gap-2 text-xs text-muted">
        <span className="rounded-full bg-panel-2 px-2 py-0.5">em breve</span>
        Aprovação de mudanças por papel (revisor, editor) entra como camada sobre estas chaves.
      </p>
      {inside && (
        <DialogFooter>
          <button className={btn(true)} onClick={onInvite}>
            <UserPlus size={14} /> Convidar
          </button>
        </DialogFooter>
      )}
    </Modal>
  );
}

export function TeamPanel({ status, agents, docId, onInvite, onJoin, onKeys }: { status: TeamStatus | null; agents: AgentPresence[]; docId: string; onInvite(): void; onJoin(): void; onKeys(): void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TeamMember | null>(null);
  const [leaving, setLeaving] = useState(false);
  if (!status) return <section className={ui.section}><p className={ui.muted}>Conectando ao sidecar do time…</p></section>;
  if (!status.team) {
    return (
      <section className={cx(ui.section, "team-panel grid gap-3")}>
        <h2 className={ui.h2}>Time</h2>
        <p className="m-0 text-sm text-muted">Este Paprika ainda não está em um time. Crie um e convide as pessoas, ou entre com um link de convite.</p>
        <Field id="team-name" label="Nome">
          <Input id="team-name" value={name} placeholder="Estúdio Norte" onChange={(e) => setName(e.target.value)} />
        </Field>
        {error && <p className="m-0 text-xs text-accent-ink">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            className={btn(true)}
            disabled={!name.trim()}
            onClick={() => api("/api/team", "POST", { name: name.trim() }).catch((e) => setError(String(e.message ?? e)))}
          >
            <Users size={14} /> Criar time
          </button>
          <button className={btn()} onClick={onJoin}>
            <Link2 size={14} /> Entrar com convite
          </button>
        </div>
      </section>
    );
  }
  const team = status.team;
  const shared = status.docs.some((d) => d.id === docId);
  const online = status.peers.filter((p) => p.state === "direct" || p.state === "relay");
  const remoteAgents = (person: string) => agents.filter((a) => a.agent.startsWith("peer:") && a.actor.endsWith(` @ ${person}`));
  const localAgents = agents.filter((a) => !a.agent.startsWith("peer:"));
  const agentName = (a: AgentPresence) => a.actor.replace(/^agent:/, "").replace(/ @ .*$/, "");
  const agentLine = (a: AgentPresence) => (
    <div key={a.agent} className="flex items-center gap-2 pl-8 text-xs">
      <span className="size-4 shrink-0 rounded-full" style={{ background: a.color }} />
      <strong>{agentName(a)}</strong>
      <span className="truncate text-muted">{a.tool}</span>
    </div>
  );
  const s = teamSummary(status);
  return (
    <section className={cx(ui.section, "team-panel grid gap-4")}>
      <div className="grid gap-0.5">
        <strong className="text-md">{team.name}</strong>
        <span className="text-xs text-muted">
          Time {teamFingerprint(team.id).split(" · ").slice(0, 2).join("·")} · {team.members.length} pessoa(s) · {team.members.reduce((n, m) => n + m.agents.length, 0)} agente(s)
        </span>
      </div>
      <RemovedNotice team={team} />
      <div className="grid gap-2">
        <h3 className={ui.h3}>Conexão e sync</h3>
        <div className="team-sync grid gap-1.5 rounded-lg border border-line bg-night p-3 text-xs">
          <span className="flex items-center gap-2">
            <span className={cx("size-2 rounded-full", TONE_DOT[s.tone])} />
            <strong className="text-sm">{shared ? (online.length ? "Sincronizado" : "Só neste dispositivo agora") : "Workspace não compartilhado"}</strong>
          </span>
          <span className="text-muted">
            {status.peers.filter((p) => p.state === "direct").length} direta(s) · {status.peers.filter((p) => p.state === "relay").length} via relay
          </span>
          {shared && <span className="font-mono text-muted">workspace {docId} · {status.docs.find((d) => d.id === docId)?.envelopes ?? 0} envelopes</span>}
          {!shared && (
            <button className={cx(btn(true), "team-share mt-1 justify-self-start")} onClick={() => api("/api/team/share", "POST", { doc: docId }).catch((e) => setError(String(e.message ?? e)))}>
              <Share2 size={14} /> Compartilhar este workspace
            </button>
          )}
          {error && <span className="text-accent-ink">{error}</span>}
        </div>
      </div>
      <div className="grid gap-3">
        <h3 className={ui.h3}>Pessoas e agentes</h3>
        {team.members.map((m) => {
          const peer = status.peers.find((p) => p.id === m.key);
          const [label, tone] = m.you ? (["local", "off"] as [string, Tone]) : STATE_LABEL[peer?.state ?? "offline"];
          const where = m.you ? "este dispositivo" : peer?.state === "direct" ? `QUIC direto${peer.rttMs != null ? ` · ${peer.rttMs} ms` : ""}` : peer?.state === "relay" ? `via relay${peer.rttMs != null ? ` · ${peer.rttMs} ms` : ""}` : "offline";
          const sub = m.founder ? `${where} · fundador(a)` : where;
          return (
            <div key={m.key} className="team-person grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={m.name} you={m.you} />
                  <div className="grid min-w-0">
                    <strong className="truncate text-sm">{m.name}{m.you ? " (você)" : ""}</strong>
                    <span className="truncate text-xs text-muted">{sub}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Chip label={label} tone={tone} />
                  {m.you && !m.founder && team.member !== false && (
                    <button className={cn(btn(), ui.dangerBtn, "team-leave px-2")} onClick={() => setLeaving(true)}>
                      Sair do time
                    </button>
                  )}
                  {team.canRemove && !m.you && !m.founder && (
                    <button className={cn(btn(), ui.dangerBtn, "team-remove px-2")} onClick={() => setRemoving(m)} aria-label={`Remover ${m.name}`}>
                      Remover
                    </button>
                  )}
                </div>
              </div>
              {(m.you ? localAgents : remoteAgents(m.name)).map(agentLine)}
            </div>
          );
        })}
        {team.canRemove && team.members.length > 1 && <p className="m-0 text-xs text-muted">Só quem fundou o time remove pessoas.</p>}
        {(team.removed?.length ?? 0) > 0 && (
          <p className="team-removed-count m-0 text-xs text-muted">
            {team.removed!.length} removida(s): {team.removed!.map((r) => r.name).join(", ")}. Veja em Chaves do time.
          </p>
        )}
      </div>
      {removing && <RemoveMemberDialog member={removing} onClose={() => setRemoving(null)} />}
      {leaving && <LeaveTeamDialog onClose={() => setLeaving(false)} />}
      <div className="flex flex-wrap gap-2">
        {team.member !== false && (
          <button className={cx(btn(true), "team-invite")} onClick={onInvite}>
            <UserPlus size={14} /> Convidar
          </button>
        )}
        <button className={btn()} onClick={onKeys}>
          <KeyRound size={14} /> Chaves do time
        </button>
      </div>
    </section>
  );
}
