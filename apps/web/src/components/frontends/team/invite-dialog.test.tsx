import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { InviteDialog } from "./invite-dialog";
import type { TeamInfo } from "./types";

const NOW = 1_700_000_000_000;
const team: TeamInfo = { id: "A3F9B71C44D2", name: "North Studio", shortId: "a3·f9", voiceFingerprint: "7F3K · 92QA", members: [], removed: [], canRemove: true, member: true };

describe("InviteDialog", () => {
  it("retries a failed invite with the same validity", async () => {
    const user = userEvent.setup();
    const onCreateInvite = vi
      .fn<(ttl: number) => Promise<{ link: string; expiresAt: number }>>()
      .mockRejectedValueOnce(new Error("no sidecar"))
      .mockResolvedValueOnce({ link: "paprika://join/ok", expiresAt: NOW + 3_600_000 });
    render(<InviteDialog team={team} now={NOW} onCreateInvite={onCreateInvite} onRevokeInvites={vi.fn(() => Promise.resolve())} onClose={vi.fn()} />);
    expect(await screen.findByText("no sidecar")).toBeInTheDocument();
    expect(onCreateInvite).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onCreateInvite).toHaveBeenCalledTimes(2);
    expect(onCreateInvite).toHaveBeenLastCalledWith(3600);
    expect(await screen.findByDisplayValue("paprika://join/ok")).toBeInTheDocument();
    expect(screen.queryByText("no sidecar")).not.toBeInTheDocument();
  });
});
