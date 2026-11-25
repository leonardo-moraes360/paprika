import { useEffect, useState } from "react";

export type Route = { view: "overview" } | { view: "canvas"; id: string } | { view: "gallery" };

export function parseRoute(pathname: string): Route {
  if (pathname === "/ui" || pathname === "/ui/") return { view: "gallery" };
  const m = /^\/w\/([^/]+)\/?$/.exec(pathname);
  if (!m) return { view: "overview" };
  try {
    return { view: "canvas", id: decodeURIComponent(m[1]!) };
  } catch {
    return { view: "overview" };
  }
}

export const workspacePath = (id: string) => `/w/${encodeURIComponent(id)}`;

const EVENT = "paprika:navigate";

export function navigate(path: string, opts: { replace?: boolean } = {}): void {
  const url = path + location.search;
  if (url === location.pathname + location.search) return;
  if (opts.replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  window.dispatchEvent(new Event(EVENT));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.pathname));
  useEffect(() => {
    const update = () => setRoute(parseRoute(location.pathname));
    window.addEventListener("popstate", update);
    window.addEventListener(EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(EVENT, update);
    };
  }, []);
  return route;
}
