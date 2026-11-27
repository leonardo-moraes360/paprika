import { useRouterState } from "@tanstack/react-router";
import { Notifications } from "@/components/notifications";

/** Toasts sit 16 px above the window's edge; over the editor they sit 16 px above the zoom bar (12 px from the edge + 42 px high), so none covers it. */
export const TOASTS_OVERVIEW = "mb-4";
export const TOASTS_EDITOR = "mb-18.5";

/** The toast region of the app: lifted above the zoom bar while a workspace is open. */
export function RoutedNotifications() {
  const inEditor = useRouterState({ select: (state) => state.matches.some((match) => match.routeId === "/w/$workspaceId") });
  return <Notifications className={inEditor ? TOASTS_EDITOR : TOASTS_OVERVIEW} />;
}
