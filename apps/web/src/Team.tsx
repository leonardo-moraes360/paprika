import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Copy, KeyRound, Link2, Share2, UserPlus, Users, X } from "lucide-react";
import { encode } from "uqr";
import type { AgentPresence } from "./agents";
import { cx, ui } from "./ui";

/** Team sync status from the server (`/api/team`, `{type: "team"}` on /ws). See docs/team-sync.md. */
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
}
export interface TeamPeer {
  id: string;
  name: string;
  state: "direct" | "relay" | "connecting" | "offline";
  rttMs?: number | null;
}
export interface TeamStatus {
  id: string;
  name: string;
  fingerprint: string;
  team: { id: string; name: string; members: TeamMember[]; invites: { expires: number }[] } | null;
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

/** "7F3A91C2…" → "7F3A · 91C2 · E04A · 2B9E" (read aloud to check an invite). */
export function teamFingerprint(id: string) {
  return (id.toUpperCase().match(/.{1,4}/g) ?? []).slice(0, 4).join(" · ");
}

type Tone = "ok" | "warn" | "busy" | "off" | "bad";
const TONE_DOT: Record<Tone, string> = { ok: "bg-leaf", warn: "bg-warn", busy: "bg-select", off: "bg-muted", bad: "bg-accent" };

/** The worst state across peers, as one line for the top bar. */
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
    <button
      className="team-chip inline-flex max-w-[320px] cursor-pointer items-center gap-2 rounded-full border border-line bg-panel-2 px-2.5 py-0.75 text-fg hover:border-select"
      onClick={onClick}
      title="Time: pessoas, agentes e sincronização"
    >
      <span className={cx("size-2 shrink-0 rounded-full", TONE_DOT[s.tone])} />
      <span className="truncate text-xs font-semibold">{s.label}</span>
    </button>
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
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-night px-2 py-0.5 text-xs font-semibold text-muted">
      <span className={cx("size-1.5 rounded-full", TONE_DOT[tone])} />
      {label}
    </span>
  );
}

const btn = (primary = false) =>
  cx(
    "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold",
    primary ? "border-accent bg-accent text-white hover:opacity-90" : "border-line bg-panel-2 text-fg hover:border-select",
  );

function Avatar({ name, you }: { name: string; you?: boolean }) {
  return (
    <span className={cx("inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white", you ? "bg-accent" : "bg-label")}>
      {(name || "?").slice(0, 1).toUpperCase()}
    </span>
  );
}

/** QR code of a link, as SVG squares (the same link the text field shows). */
export function Qr({ text, size = 168 }: { text: string; size?: number }) {
  const data = useMemo(() => encode(text, { ecc: "L", border: 2 }).data, [text]);
  const n = data.length;
  return (
    <svg className="team-qr rounded-md bg-white" width={size} height={size} viewBox={`0 0 ${n} ${n}`} role="img" aria-label="QR code do convite" shapeRendering="crispEdges">
      {data.flatMap((row, y) => row.map((on, x) => (on ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#141827" /> : null)))}
    </svg>
  );
}

/** Tabbable elements inside a dialog, in order (for the focus trap). */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Modal({ title, onClose, children, width = 560 }: { title: string; onClose(): void; children: React.ReactNode; width?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // Capture: the canvas shortcuts listen on window too and must not see Escape while a dialog is open.
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [onClose]);
  useEffect(() => {
    // Focus moves into the dialog (unless a field already took it, e.g. autoFocus) and goes back
    // to whatever opened it when the dialog closes (WCAG 2.4.3).
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!box.current?.contains(document.activeElement)) box.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  // Tab and Shift+Tab stay inside the dialog while it is open.
  const trap = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab" || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const at = document.activeElement;
    if (e.shiftKey && (at === first || at === box.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div className="team-modal fixed inset-0 z-50 flex items-center justify-center bg-night/70" onPointerDown={onClose}>
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="grid max-h-[90vh] max-w-[calc(100vw-32px)] gap-4 overflow-auto rounded-xl border border-line bg-panel p-6 shadow-float outline-none"
        style={{ width }}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={trap}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="m-0 text-lg font-bold">
            {title}
          </h2>
          <button className={ui.iconBtn} onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
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
    <Modal title={`Convidar para ${status.team?.name ?? "o time"}`} onClose={onClose} width={640}>
      <p className="m-0 text-sm text-muted">Quem abrir o link entra no time com a própria chave. O link vale uma vez e expira.</p>
      {error && <p className="m-0 rounded-md border border-accent bg-toast p-2 text-sm text-accent-pale">{error}</p>}
      <div className="flex flex-wrap items-start gap-5">
        {invite ? <Qr text={invite.link} /> : <div className="size-[168px] rounded-md bg-panel-2" />}
        <div className="grid min-w-[260px] flex-1 gap-3">
          <label className={ui.field(true)}>
            <span>Link de convite</span>
            <input className="invite-link font-mono text-xs" readOnly value={invite?.link ?? "gerando…"} onFocus={(e) => e.target.select()} />
          </label>
          <div className="grid gap-1.5">
            <span className="text-xs text-muted">Expira em</span>
            <div className="grid grid-cols-4 gap-0.5 rounded-md bg-night p-0.5" role="radiogroup" aria-label="Validade do convite">
              {TTLS.map(([label, secs]) => (
                <button
                  key={secs}
                  role="radio"
                  aria-checked={ttl === secs}
                  className={cx("cursor-pointer rounded-sm border-0 py-1 text-xs", ttl === secs ? "bg-panel-2 font-semibold text-fg" : "bg-transparent text-muted")}
                  onClick={() => setTtl(secs)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {invite && (
            <p className="m-0 flex items-center gap-2 text-xs text-muted">
              <span className="size-2 rounded-full bg-warn" />
              expira às {clock(invite.expiresAt)} · faltam {mmss} · uso único
            </p>
          )}
          <div className="grid gap-1 rounded-md bg-night p-2.5">
            <span className="text-xs text-muted">Confira por voz com quem entra:</span>
            <strong className="font-mono text-md text-accent-ink">{teamFingerprint(status.team?.id ?? "")}</strong>
          </div>
        </div>
      </div>
      <div className="flex justify-end gap-2">
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
      </div>
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
    <Modal title="Entrar em um time" onClose={onClose} width={520}>
      <p className="m-0 text-sm text-muted">Cole o link ou leia o QR de quem convidou.</p>
      <label className={ui.field(true)}>
        <span>Link de convite</span>
        <input className="join-link font-mono text-xs" value={link} placeholder="paprika://join/…" onChange={(e) => setLink(e.target.value)} autoFocus />
      </label>
      {preview && !preview.expired && (
        <div className="team-preview grid gap-2 rounded-lg border border-line bg-night p-3">
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
        <div className="grid gap-1 rounded-lg border border-accent bg-toast p-3">
          <strong className="text-sm text-accent-pale">Convite expirado há {expiredFor} min</strong>
          <span className="text-xs text-accent-ink">Peça um novo link. Nada foi alterado no seu Paprika.</span>
        </div>
      )}
      {error && (
        <div className="grid gap-1 rounded-lg border border-accent bg-toast p-3">
          <strong className="text-sm text-accent-pale">Não deu para entrar</strong>
          <span className="join-error text-xs text-accent-ink">{error}</span>
        </div>
      )}
      {done && <p className="m-0 text-sm text-leaf">Você entrou no time. Os workspaces compartilhados aparecem na página inicial.</p>}
      <div className="flex justify-end gap-2">
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
      </div>
    </Modal>
  );
}

export function KeysDialog({ status, onClose, onInvite }: { status: TeamStatus; onClose(): void; onInvite(): void }) {
  const members = status.team?.members ?? [];
  const peerState = (key: string) => status.peers.find((p) => p.id === key)?.state ?? "offline";
  const date = (unix: number) => new Date(unix * 1000).toLocaleDateString([], { day: "2-digit", month: "short" });
  return (
    <Modal title="Chaves do time" onClose={onClose} width={860}>
      <p className="m-0 text-sm text-muted">Só operações assinadas por estas chaves entram nos workspaces do time.</p>
      <table className="team-keys w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            {["Quem", "Tipo", "Chave pública", "Delegada por", "Desde", "Estado"].map((h) => (
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
                <td className="border-b border-line px-2 py-2 font-mono text-xs text-accent-ink" title={m.key}>ed25519 {m.fingerprint}</td>
                <td className="border-b border-line px-2 py-2 text-muted">{m.founder ? "fundador(a)" : `${m.addedByName ?? "?"} (convite)`}</td>
                <td className="border-b border-line px-2 py-2 text-muted">{date(m.at)}</td>
                <td className="border-b border-line px-2 py-2"><Chip label={st} tone={st === "ativa" ? "ok" : "off"} /></td>
              </tr>,
              ...m.agents.map((a) => (
                <tr key={`${m.key}/${a}`}>
                  <td className="border-b border-line px-2 py-2 font-semibold">{a} @ {m.name}</td>
                  <td className="border-b border-line px-2 py-2 text-muted">agente</td>
                  <td className="border-b border-line px-2 py-2 font-mono text-xs text-muted">derivada da chave de {m.name}</td>
                  <td className="border-b border-line px-2 py-2 text-muted">{m.name}</td>
                  <td className="border-b border-line px-2 py-2 text-muted">—</td>
                  <td className="border-b border-line px-2 py-2"><Chip label="ativa" tone="ok" /></td>
                </tr>
              )),
            ];
          })}
        </tbody>
      </table>
      {status.rejected > 0 && (
        <div className="grid gap-1 rounded-lg border border-accent bg-toast p-3">
          <strong className="text-sm text-accent-pale">{status.rejected} operação(ões) ou conexão(ões) rejeitada(s)</strong>
          <span className="text-xs text-accent-ink">{status.lastRejected?.reason ?? ""}. Nada foi aplicado.</span>
        </div>
      )}
      <p className="m-0 flex items-center gap-2 text-xs text-muted">
        <span className="rounded-full bg-panel-2 px-2 py-0.5">em breve</span>
        Aprovação de mudanças por papel (revisor, editor) entra como camada sobre estas chaves.
      </p>
      <div className="flex justify-end">
        <button className={btn(true)} onClick={onInvite}>
          <UserPlus size={14} /> Convidar
        </button>
      </div>
    </Modal>
  );
}

/** Right-panel tab: who is on the team, how each one is reached, and the sync state. */
export function TeamPanel({ status, agents, docId, onInvite, onJoin, onKeys }: { status: TeamStatus | null; agents: AgentPresence[]; docId: string; onInvite(): void; onJoin(): void; onKeys(): void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (!status) return <section className={ui.section}><p className={ui.muted}>Conectando ao sidecar do time…</p></section>;
  if (!status.team) {
    return (
      <section className={cx(ui.section, "team-panel grid gap-3")}>
        <h2 className={ui.h2}>Time</h2>
        <p className="m-0 text-sm text-muted">Este Paprika ainda não está em um time. Crie um e convide as pessoas, ou entre com um link de convite.</p>
        <label className={ui.field()}>
          <span>Nome</span>
          <input value={name} placeholder="Estúdio Norte" onChange={(e) => setName(e.target.value)} />
        </label>
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
          const sub = m.you ? "este dispositivo" : peer?.state === "direct" ? `QUIC direto${peer.rttMs != null ? ` · ${peer.rttMs} ms` : ""}` : peer?.state === "relay" ? `via relay${peer.rttMs != null ? ` · ${peer.rttMs} ms` : ""}` : "offline";
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
                <Chip label={label} tone={tone} />
              </div>
              {(m.you ? localAgents : remoteAgents(m.name)).map(agentLine)}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={cx(btn(true), "team-invite")} onClick={onInvite}>
          <UserPlus size={14} /> Convidar
        </button>
        <button className={btn()} onClick={onKeys}>
          <KeyRound size={14} /> Chaves do time
        </button>
      </div>
    </section>
  );
}
