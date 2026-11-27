import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveRig } from "@/test/live-harness";
import { fakeHttp, jsonResponse, renderRegions, serve } from "@/test/collab-harness";
import { Team, useTeamHeader } from "./team";

afterEach(() => vi.unstubAllGlobals());

/** A sidecar status, as the `team` frame carries it (simulated: `--team` does not start in this environment because `paprika-sync` is not installed). */
const status = (over: Record<string, unknown> = {}) => ({
  id: "ME",
  name: "laptop",
  fingerprint: "A3F9·B71C·44D2·0C1E",
  team: {
    id: "a3f9b71c44d2e5f6",
    name: "North Studio",
    members: [
      { key: "K1", name: "Leonardo", fingerprint: "A3F9·B71C", addedBy: "K1", addedByName: null, at: 1_700_000_000, founder: true, you: true, agents: [] },
      { key: "K2", name: "Marina", fingerprint: "7F3K·92QA", addedBy: "K1", addedByName: "Leonardo", at: 1_700_100_000, founder: false, you: false, agents: ["cursor"] },
    ],
    removed: [],
    invites: [],
    member: true,
    canRemove: true,
  },
  peers: [{ id: "K2", name: "Marina", state: "direct", rttMs: 18 }],
  docs: [],
  rejected: 0,
  lastRejected: null,
  ...over,
});

function Header() {
  const { team, onTeamClick } = useTeamHeader();
  return <button onClick={onTeamClick}>{team ? `team:${team.name}:${team.online}` : "no-team"}</button>;
}

const flag = { dialogs: { history: false, pins: false, export: false, import: false, agents: false, team: true } };

describe("Team region", () => {
  it("shows nothing without team mode (the server answers HTML, so the live state is null)", async () => {
    const view = await renderRegions({ regions: [["team", <Team key="t" />], ["header", <Header key="h" />]], initial: flag });
    serve(view.rig, view.doc);
    expect(screen.queryByTestId("team-chip-slot")).toBeNull();
    expect(screen.queryByTestId("team-slot")).toBeNull();
    expect(screen.getByText("no-team")).toBeInTheDocument();
  });

  it("shows the chip and the header pill once the sidecar status arrives over the socket", async () => {
    const view = await renderRegions({ regions: [["team", <Team key="t" />], ["header", <Header key="h" />]] });
    serve(view.rig, view.doc);
    view.rig.push({ type: "team", status: status() });
    const chip = await screen.findByTestId("team-chip-slot");
    expect(within(chip).getByText("North Studio · 2 online · synced")).toBeInTheDocument();
    expect(screen.getByText("team:North Studio:2")).toBeInTheDocument();
  });

  it("opens the panel with the members, the connection of each and the agents, and the sync state of this workspace", async () => {
    const calls = fakeHttp({ "POST /api/team/share": () => jsonResponse({ doc: "doc-1" }) });
    const view = await renderRegions({ regions: [["team", <Team key="t" />]], initial: flag });
    serve(view.rig, view.doc);
    view.rig.push({ type: "team", status: status() });
    const panel = await screen.findByTestId("team-panel");
    expect(within(panel).getByRole("heading", { name: "North Studio" })).toBeInTheDocument();
    expect(within(panel).getByText("Leonardo (you)")).toBeInTheDocument();
    expect(within(panel).getByText("Marina")).toBeInTheDocument();
    expect(within(panel).getByText("cursor")).toBeInTheDocument();
    const sync = within(panel).getByTestId("team-sync");
    expect(within(sync).getByText("Workspace not shared")).toBeInTheDocument();
    await userEvent.setup().click(within(sync).getByRole("button", { name: /share/i }));
    await waitFor(() => expect(calls.find((call) => call.url === "/api/team/share")?.body).toEqual({ doc: "doc-1" }));
  });

  it("creates a team from the no-team state with the name typed", async () => {
    const calls = fakeHttp({ "POST /api/team": () => jsonResponse({}) });
    const view = await renderRegions({ regions: [["team", <Team key="t" />]], initial: flag });
    serve(view.rig, view.doc);
    view.rig.push({ type: "team", status: status({ team: null }) });
    const panel = await screen.findByTestId("team-panel");
    const user = userEvent.setup();
    await user.type(within(panel).getByRole("textbox"), "Studio X");
    await user.click(within(panel).getByRole("button", { name: /create team/i }));
    await waitFor(() => expect(calls.find((c) => c.url === "/api/team")?.body).toEqual({ name: "Studio X" }));
  });

  it("shows the error the server gives to a command, and converts the invite's seconds", async () => {
    const calls = fakeHttp({ "POST /api/team": () => jsonResponse({ error: "name taken" }, 400), "POST /api/team/invites": () => jsonResponse({ link: "paprika://join/abc", expiresAt: Math.floor(Date.now() / 1000) + 3600 }) });
    const view = await renderRegions({ regions: [["team", <Team key="t" />]], initial: flag });
    serve(view.rig, view.doc);
    view.rig.push({ type: "team", status: status({ team: null }) });
    let panel = await screen.findByTestId("team-panel");
    const user = userEvent.setup();
    await user.type(within(panel).getByRole("textbox"), "Dup");
    await user.click(within(panel).getByRole("button", { name: /create team/i }));
    expect(await within(panel).findByRole("alert")).toHaveTextContent("name taken");
    act(() => view.rig.push({ type: "team", status: status() }));
    panel = await screen.findByTestId("team-panel");
    await user.click(await within(panel).findByRole("button", { name: /invite/i }));
    expect(await screen.findByDisplayValue("paprika://join/abc")).toBeInTheDocument();
    expect(calls.find((c) => c.url === "/api/team/invites")?.body).toEqual({ ttlSecs: 3600 });
    expect(await screen.findByText(/\b(59|60):\d\d/)).toBeInTheDocument();
  });

  it("the live client asks /api/team for the first status and keeps null when the answer is not JSON", async () => {
    const rig = createLiveRig({ fetchTeam: () => Promise.resolve(null) });
    const view = await renderRegions({ rig, regions: [["team", <Team key="t" />]] });
    serve(view.rig, view.doc);
    expect(view.rig.client.store.state.team).toBeNull();
    expect(screen.queryByTestId("team-chip-slot")).toBeNull();
  });
});
