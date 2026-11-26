import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { summarizeTeam, countdown, Team, TeamChip, type TeamMemberEntry, type TeamProps, type TeamStatus } from "./index";

const NOW = 1_700_000_000_000;

const members: TeamMemberEntry[] = [
  { id: "k1", name: "Leonardo", fingerprint: "a3f9…0c1e", founder: true, you: true, at: NOW - 14 * 86400000, connection: "local", agents: [{ id: "g1", name: "claude", tool: "update_nodes" }, { id: "g2", name: "codex" }] },
  { id: "k2", name: "Marina", fingerprint: "7f3k…92qa", founder: false, you: false, addedByName: "Leonardo", at: NOW - 6 * 86400000, connection: "direct", rttMs: 18, agents: [{ id: "g3", name: "cursor" }] },
];

const status = (overrides: Partial<TeamStatus> = {}): TeamStatus => ({
  team: { id: "A3F9B71C44D2", name: "North Studio", shortId: "a3·f9", voiceFingerprint: "7F3K · 92QA · LM0X", members, removed: [{ id: "k9", name: "Rafa", fingerprint: "c0de…7a11", at: NOW - 40 * 86400000, byName: "Leonardo", you: false }], canRemove: true, member: true },
  peers: { direct: 1, relay: 0, connecting: 0, offline: 0 },
  rejected: 0,
  device: { name: "laptop", fingerprint: "a3f9…0c1e" },
  workspace: { id: "a4dsy2qnvp", shared: true, envelopes: 128 },
  ...overrides,
});

function actions() {
  return {
    onCreateTeam: vi.fn(() => Promise.resolve()),
    onShareWorkspace: vi.fn(() => Promise.resolve()),
    onCreateInvite: vi.fn((ttl: number) => Promise.resolve({ link: `paprika://join/${ttl}`, expiresAt: NOW + ttl * 1000 })),
    onRevokeInvites: vi.fn(() => Promise.resolve()),
    onInspectInvite: vi.fn(() => Promise.resolve({ name: "Studio", fingerprint: "7F3K · 92QA", expiresAt: NOW + 600_000, expired: false })),
    onJoin: vi.fn(() => Promise.resolve()),
    onRemoveMember: vi.fn(() => Promise.resolve()),
    onLeave: vi.fn(() => Promise.resolve()),
    onRotateKey: vi.fn(() => Promise.resolve({ fingerprint: "9d2e…11aa" })),
  };
}

function setup(props: Partial<TeamProps> = {}) {
  const handlers = actions();
  const view = render(<Team status={status()} now={NOW} {...handlers} {...props} />);
  return { ...handlers, ...props, ...view } as ReturnType<typeof actions> & typeof view;
}

describe("summarizeTeam", () => {
  it("covers every state", () => {
    expect(summarizeTeam(null).key).toBe("local");
    expect(summarizeTeam(status({ team: null })).key).toBe("local");
    expect(summarizeTeam(status()).key).toBe("synced");
    expect(summarizeTeam(status({ peers: { direct: 0, relay: 1, connecting: 0, offline: 0 } })).key).toBe("relay");
    expect(summarizeTeam(status({ peers: { direct: 1, relay: 0, connecting: 1, offline: 0 } })).key).toBe("connecting");
    expect(summarizeTeam(status({ peers: { direct: 0, relay: 0, connecting: 0, offline: 2 } })).key).toBe("offline");
    expect(summarizeTeam(status({ peers: { direct: 0, relay: 0, connecting: 0, offline: 0 } })).key).toBe("alone");
    expect(summarizeTeam(status({ rejected: 2, lastRejectedReason: "bad" })).key).toBe("rejected");
  });
  it("formats the countdown", () => {
    expect(countdown(NOW + 3_552_000, NOW)).toEqual({ seconds: 3552, text: "59:12" });
    expect(countdown(NOW - 5, NOW).seconds).toBe(0);
  });
});

describe("TeamChip", () => {
  it("shows the summary and reports the click", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<TeamChip status={status()} onClick={onClick} />);
    await user.click(screen.getByRole("button", { name: "North Studio · 2 online · synced" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
  it("says it is local without a team", () => {
    render(<TeamChip status={null} onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Only on this device" })).toBeInTheDocument();
  });
});

describe("Team panel", () => {
  it("shows the connecting state without status", () => {
    setup({ status: null });
    expect(screen.getByText("Connecting to the team service…")).toBeInTheDocument();
  });

  it("shows name, summary, sync, people and their agents", () => {
    setup();
    expect(screen.getByRole("heading", { name: "North Studio" })).toBeInTheDocument();
    expect(screen.getByText("Team a3·f9 · 2 people · 3 agents")).toBeInTheDocument();
    const sync = screen.getByTestId("team-sync");
    expect(within(sync).getByText("Synced")).toBeInTheDocument();
    expect(within(sync).getByText("1 direct · 0 via relay")).toBeInTheDocument();
    expect(within(sync).getByText("workspace a4dsy2qnvp · 128 envelopes")).toBeInTheDocument();
    const people = screen.getAllByRole("listitem");
    expect(within(people[0] as HTMLElement).getByText("Leonardo (you)")).toBeInTheDocument();
    expect(within(people[0] as HTMLElement).getByText("this device · founder")).toBeInTheDocument();
    expect(within(people[0] as HTMLElement).getByText("update_nodes")).toBeInTheDocument();
    expect(within(people[1] as HTMLElement).getByText("QUIC direct · 18 ms")).toBeInTheDocument();
    expect(screen.getByText("Only the founder can remove people.")).toBeInTheDocument();
    expect(screen.getByTestId("team-removed-count")).toHaveTextContent("1 removed: Rafa");
  });

  it("offers to share the workspace when it is not shared", async () => {
    const user = userEvent.setup();
    const { onShareWorkspace } = setup({ status: status({ workspace: { id: "w1", shared: false, envelopes: 0 } }) });
    expect(screen.getByText("Workspace not shared")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Share this workspace" }));
    expect(onShareWorkspace).toHaveBeenCalledOnce();
  });

  it("hides the remove button for people who cannot remove", () => {
    setup({ status: status({ team: { ...(status().team as NonNullable<TeamStatus["team"]>), canRemove: false } }) });
    expect(screen.queryByRole("button", { name: "Remove Marina" })).not.toBeInTheDocument();
  });

  it("warns the person that was removed and hides the invite", () => {
    setup({ status: status({ team: { ...(status().team as NonNullable<TeamStatus["team"]>), member: false } }) });
    expect(screen.getByText("You are no longer in this team")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invite" })).not.toBeInTheDocument();
  });

  it("creates a team from the empty state", async () => {
    const user = userEvent.setup();
    const { onCreateTeam } = setup({ status: status({ team: null }) });
    const create = screen.getByRole("button", { name: "Create team" });
    expect(create).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Studio");
    await user.click(create);
    expect(onCreateTeam).toHaveBeenCalledWith("Studio");
  });

  it("shows the error when creating the team fails", async () => {
    const user = userEvent.setup();
    setup({ status: status({ team: null }), onCreateTeam: vi.fn(() => Promise.reject(new Error("name taken"))) });
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Studio");
    await user.click(screen.getByRole("button", { name: "Create team" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not complete: name taken");
  });
});

describe("invite dialog", () => {
  it("creates one invite per opening, draws the QR and counts down", async () => {
    const user = userEvent.setup();
    const { onCreateInvite } = setup();
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await screen.findByRole("img", { name: "Invite QR code" });
    expect(onCreateInvite).toHaveBeenCalledTimes(1);
    expect(onCreateInvite).toHaveBeenCalledWith(3600);
    expect(screen.getByRole("textbox", { name: "Invite link" })).toHaveValue("paprika://join/3600");
    expect(screen.getByText(/60:00 left · single use/)).toBeInTheDocument();
    expect(screen.getByText("7F3K · 92QA · LM0X")).toBeInTheDocument();
  });

  it("asks for a new invite when the validity changes and ignores a stale answer", async () => {
    const user = userEvent.setup();
    const resolvers: Array<(v: { link: string; expiresAt: number }) => void> = [];
    const onCreateInvite = vi.fn(() => new Promise<{ link: string; expiresAt: number }>((resolve) => resolvers.push(resolve)));
    setup({ onCreateInvite });
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await user.click(screen.getByRole("radio", { name: "24 h" }));
    expect(onCreateInvite).toHaveBeenLastCalledWith(86400);
    await act(async () => {
      resolvers[1]?.({ link: "paprika://join/new", expiresAt: NOW + 86_400_000 });
      resolvers[0]?.({ link: "paprika://join/old", expiresAt: NOW + 3_600_000 });
    });
    expect(screen.getByRole("textbox", { name: "Invite link" })).toHaveValue("paprika://join/new");
  });

  it("shows the error when the invite cannot be created", async () => {
    const user = userEvent.setup();
    setup({ onCreateInvite: vi.fn(() => Promise.reject(new Error("no sidecar"))) });
    await user.click(screen.getByRole("button", { name: "Invite" }));
    expect(await screen.findByText("no sidecar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeDisabled();
  });

  it("copies with the clipboard", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    setup();
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await screen.findByRole("img", { name: "Invite QR code" });
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith("paprika://join/3600");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });

  it("falls back to selecting the field when the clipboard is missing", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    document.execCommand = vi.fn(() => false);
    setup();
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await screen.findByRole("img", { name: "Invite QR code" });
    await user.click(screen.getByRole("button", { name: "Copy invite link" }));
    expect(await screen.findByRole("status")).toHaveTextContent("press Ctrl+C");
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  it("revokes the links, closes and returns the focus to the panel", async () => {
    const user = userEvent.setup();
    const { onRevokeInvites } = setup();
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await screen.findByRole("img", { name: "Invite QR code" });
    await user.click(screen.getByRole("button", { name: "Revoke links" }));
    expect(onRevokeInvites).toHaveBeenCalledOnce();
    await act(async () => {});
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite" })).toBeInTheDocument();
  });

  it("shows expiry and disables copying once the deadline passed", async () => {
    const user = userEvent.setup();
    const onCreateInvite = vi.fn(() => Promise.resolve({ link: "paprika://join/x", expiresAt: NOW - 1000 }));
    setup({ onCreateInvite });
    await user.click(screen.getByRole("button", { name: "Invite" }));
    expect(await screen.findByText(/has expired/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeDisabled();
  });
});

describe("join dialog", () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: "Join with an invite" }));
  };

  it("inspects the pasted link, shows who invites and joins", async () => {
    const user = userEvent.setup();
    const { onInspectInvite, onJoin } = setup({ status: status({ team: null }) });
    await open(user);
    const field = screen.getByRole("textbox", { name: "Invite link" });
    expect(field).toHaveFocus();
    expect(screen.getByRole("button", { name: "Join" })).toBeDisabled();
    await user.click(field);
    await user.paste("paprika://join/abc");
    expect(await screen.findByTestId("invite-preview")).toHaveTextContent("Studio");
    expect(onInspectInvite).toHaveBeenLastCalledWith("paprika://join/abc");
    expect(screen.getByText(/Your key: laptop · a3f9…0c1e/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Join" }));
    expect(onJoin).toHaveBeenCalledWith("paprika://join/abc");
    expect(await screen.findByText(/You joined the team/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Close" }).length).toBeGreaterThan(0);
  });

  it("explains an expired invite and keeps Join disabled", async () => {
    const user = userEvent.setup();
    setup({ status: status({ team: null }), onInspectInvite: vi.fn(() => Promise.resolve({ name: "Studio", fingerprint: "x", expiresAt: NOW - 12 * 60_000, expired: true })) });
    await open(user);
    await user.click(screen.getByRole("textbox", { name: "Invite link" }));
    await user.paste("paprika://join/old");
    expect(await screen.findByText("Invite expired 12 min ago")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join" })).toBeDisabled();
  });

  it("shows the error of an invalid invite and of a failed join", async () => {
    const user = userEvent.setup();
    setup({ status: status({ team: null }), onInspectInvite: vi.fn(() => Promise.reject(new Error("bad signature"))) });
    await open(user);
    await user.click(screen.getByRole("textbox", { name: "Invite link" }));
    await user.paste("nope");
    expect(await screen.findByText("bad signature")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join" })).toBeDisabled();
  });

  it("shows the error when joining fails and keeps the dialog", async () => {
    const user = userEvent.setup();
    setup({ status: status({ team: null }), onJoin: vi.fn(() => Promise.reject(new Error("offline"))) });
    await open(user);
    await user.click(screen.getByRole("textbox", { name: "Invite link" }));
    await user.paste("paprika://join/abc");
    await screen.findByTestId("invite-preview");
    await user.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByText("Could not join")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("cancels with Escape", async () => {
    const user = userEvent.setup();
    setup({ status: status({ team: null }) });
    await open(user);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("keys dialog and confirmations", () => {
  const openKeys = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: "Team keys" }));
    return screen.getByRole("dialog");
  };

  it("lists people, their agents and removed keys", async () => {
    const user = userEvent.setup();
    setup();
    const dialog = await openKeys(user);
    const table = within(dialog).getByRole("table", { name: "Team keys" });
    expect(within(table).getAllByRole("row")).toHaveLength(1 + 2 + 3 + 1);
    expect(within(table).getByText("ed25519 7f3k…92qa")).toBeInTheDocument();
    expect(within(table).getAllByText("derived from the key of Leonardo")).toHaveLength(2);
    expect(within(table).getByText("removed by Leonardo")).toBeInTheDocument();
    expect(within(table).getByText("Leonardo (invite)")).toBeInTheDocument();
    expect(within(dialog).getByText("Approval of changes by role (reviewer, editor) comes as a layer over these keys.")).toBeInTheDocument();
  });

  it("shows the rejected operations", async () => {
    const user = userEvent.setup();
    setup({ status: status({ rejected: 2, lastRejectedReason: "bad signature" }) });
    const dialog = await openKeys(user);
    expect(within(dialog).getByText("2 operations or connections rejected")).toBeInTheDocument();
  });

  it("confirms the removal, returns to the keys and reports the member", async () => {
    const user = userEvent.setup();
    const { onRemoveMember } = setup();
    const keys = await openKeys(user);
    await user.click(within(keys).getByRole("button", { name: "Remove Marina" }));
    const alert = screen.getByRole("alertdialog");
    expect(alert).toHaveTextContent("Remove Marina from the team?");
    await user.click(within(alert).getAllByRole("button").at(-1) as HTMLElement);
    expect(onRemoveMember).toHaveBeenCalledWith("k2");
    expect(await screen.findByRole("table", { name: "Team keys" })).toBeInTheDocument();
  });

  it("keeps the confirmation open with the error when the removal fails", async () => {
    const user = userEvent.setup();
    setup({ onRemoveMember: vi.fn(() => Promise.reject(new Error("not founder"))) });
    await user.click(screen.getByRole("button", { name: "Remove Marina" }));
    await user.click(within(screen.getByRole("alertdialog")).getAllByRole("button").at(-1) as HTMLElement);
    expect(await screen.findByRole("alert")).toHaveTextContent("not founder");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("moves the focus to the panel when the removed row's button disappears", async () => {
    const user = userEvent.setup();
    const handlers = actions();
    const { rerender } = render(<Team status={status()} now={NOW} {...handlers} />);
    await user.click(screen.getByRole("button", { name: "Remove Marina" }));
    const dialog = screen.getByRole("alertdialog");
    const confirm = within(dialog).getAllByRole("button").at(-1) as HTMLElement;
    await user.click(confirm);
    const team = status();
    rerender(<Team status={{ ...team, team: { ...(team.team as NonNullable<TeamStatus["team"]>), members: members.slice(0, 1) } }} now={NOW} {...handlers} />);
    await act(async () => {});
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByTestId("team-panel").contains(document.activeElement)).toBe(true);
  });

  it("rotates the key and shows the new one", async () => {
    const user = userEvent.setup();
    const { onRotateKey } = setup();
    await openKeys(user);
    await user.click(screen.getByRole("button", { name: "Generate new key" }));
    expect(screen.getByText(/Current key: ed25519 a3f9…0c1e/)).toBeInTheDocument();
    const rotate = screen.getAllByRole("button", { name: "Generate new key" }).at(-1) as HTMLElement;
    await user.click(rotate);
    expect(onRotateKey).toHaveBeenCalledOnce();
    expect(await screen.findByText("New key: ed25519 9d2e…11aa")).toBeInTheDocument();
    expect(screen.getByText(/Old key: ed25519 a3f9…0c1e/)).toBeInTheDocument();
  });

  it("lets a non founder leave", async () => {
    const user = userEvent.setup();
    const team = status().team as NonNullable<TeamStatus["team"]>;
    const mine = [{ ...(members[1] as TeamMemberEntry), you: true }, { ...(members[0] as TeamMemberEntry), you: false }];
    const { onLeave } = setup({ status: status({ team: { ...team, members: mine, canRemove: false } }) });
    await user.click(screen.getByRole("button", { name: "Leave the team" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Leave the team?");
    const confirm = within(screen.getByRole("alertdialog")).getAllByRole("button").at(-1) as HTMLElement;
    await user.click(confirm);
    expect(onLeave).toHaveBeenCalledOnce();
  });
});

describe("Team elsewhere", () => {
  it("never writes to storage", async () => {
    const user = userEvent.setup();
    const set = vi.spyOn(Storage.prototype, "setItem");
    setup();
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await screen.findByRole("img", { name: "Invite QR code" });
    expect(set).not.toHaveBeenCalled();
  });

  it("renders in pt-BR", async () => {
    await i18n.changeLanguage("pt-BR");
    try {
      setup();
      expect(screen.getByText("Time a3·f9 · 2 pessoas · 3 agentes")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Chaves do time" })).toBeInTheDocument();
      expect(screen.getByText("Só quem fundou o time remove pessoas.")).toBeInTheDocument();
      expect(screen.getByText("Leonardo (você)")).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("renders on the server", () => {
    const handlers = actions();
    expect(renderToString(<Team status={status()} now={NOW} {...handlers} />)).toContain("North Studio");
  });
});
