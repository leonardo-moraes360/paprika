import { useHotkey } from "@tanstack/react-hotkeys";
import type { RefObject } from "react";

export function usePinHotkeys(scope: RefObject<HTMLElement | null>, handlers: { submit?: () => void; cancel?: () => void }) {
  const options = { target: scope, ignoreInputs: false, preventDefault: true } as const;
  useHotkey("Mod+Enter", () => handlers.submit?.(), { ...options, enabled: !!handlers.submit });
  useHotkey("Escape", () => handlers.cancel?.(), { ...options, enabled: !!handlers.cancel });
}
