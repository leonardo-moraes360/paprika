import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as adapter from "@/adapters/team";
import { renderRegions, serve } from "@/test/collab-harness";
import { deltaMessage } from "@/test/live-harness";
import { useTeamHeader } from "./team";

afterEach(() => vi.restoreAllMocks());

function Chip() {
  const { team } = useTeamHeader();
  return <span>{team ? `team:${team.name}:${team.online}` : "no team"}</span>;
}

describe("team header chip", () => {
  it("derives the chip from the team status only when that status changes, not on every delta of the document", async () => {
    const spy = vi.spyOn(adapter, "toTeamStatus");
    const view = await renderRegions({ regions: [["chip", <Chip key="c" />]] });
    serve(view.rig, view.doc);
    expect(screen.getByText("no team")).toBeInTheDocument();
    const calls = spy.mock.calls.length;
    for (let version = 2; version < 12; version += 1) {
      act(() => view.rig.push(deltaMessage(view.doc, version, { ops: [] } as never)));
    }
    expect(spy.mock.calls.length).toBe(calls);
    act(() => view.rig.push({ type: "team", status: { team: { name: "Acme" }, peers: {} } } as never));
    expect(await screen.findByText(/^team:Acme/)).toBeInTheDocument();
    expect(spy.mock.calls.length).toBeGreaterThan(calls);
  });
});
