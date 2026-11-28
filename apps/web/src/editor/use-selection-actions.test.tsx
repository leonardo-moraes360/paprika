import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { dismissToasts } from "@/lib/notify";
import { renderRegions, serve } from "@/test/collab-harness";
import { useSelectionActions } from "./use-selection-actions";

afterEach(async () => {
  dismissToasts();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});

let actions: ReturnType<typeof useSelectionActions> | null = null;
function Probe() {
  actions = useSelectionActions();
  return null;
}

async function setup() {
  const view = await renderRegions({ regions: [["probe", <Probe key="p" />]] });
  serve(view.rig, view.doc);
  view.socket.autoAck = true;
  return view;
}

describe("a refusal of the core when grouping", () => {
  it("is told in the language of the app, not with the core's English sentence", async () => {
    await setup();
    // A layer and the frame that holds it do not have the same parent.
    await act(async () => void (await actions!.group(["n2", "frame-0-0"])));
    expect(await screen.findByText("Only layers with the same parent can be grouped or wrapped.")).toBeInTheDocument();
    expect(screen.queryByText(/only nodes with the same parent/)).toBeNull();
  });

  it("in Brazilian Portuguese too", async () => {
    await i18n.changeLanguage("pt-BR");
    await setup();
    await act(async () => void (await actions!.group(["n2", "frame-0-0"])));
    expect(await screen.findByText("Só camadas com o mesmo pai podem ser agrupadas ou envolvidas.")).toBeInTheDocument();
  });
});
