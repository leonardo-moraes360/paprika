import { createContext, useContext, useSyncExternalStore } from "react";

export interface View {
  x: number;
  y: number;
  zoom: number;
}

export const SETTLE_MS = 140;

export const viewTransform = (v: View) => `translate(${v.x}px, ${v.y}px) scale(${v.zoom})`;

export const sameView = (a: View, b: View) => a.x === b.x && a.y === b.y && a.zoom === b.zoom;

export class ViewStore {
  private applied: View;
  private target: View;
  private world: HTMLElement | null = null;
  private frame = 0;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private settledTick = 0;
  private listeners = new Set<() => void>();
  private settleListeners = new Set<() => void>();
  private frameListeners = new Set<(v: View) => void>();

  constructor(initial: View) {
    this.applied = initial;
    this.target = initial;
  }

  get = (): View => this.applied;

  getTarget = (): View => this.target;

  getSettled = (): number => this.settledTick;

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  subscribeSettled = (l: () => void): (() => void) => {
    this.settleListeners.add(l);
    return () => this.settleListeners.delete(l);
  };

  onFrame = (l: (v: View) => void): (() => void) => {
    this.frameListeners.add(l);
    return () => this.frameListeners.delete(l);
  };

  attach = (world: HTMLElement | null) => {
    this.world = world;
    if (world) world.style.transform = viewTransform(this.applied);
  };

  set = (next: View | ((v: View) => View), immediate = false) => {
    const v = typeof next === "function" ? next(this.target) : next;
    if (sameView(v, this.target) && sameView(v, this.applied)) return;
    this.target = v;
    if (immediate) this.flush();
    else if (!this.frame) this.frame = requestAnimationFrame(this.flush);
  };

  flush = () => {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    const v = this.target;
    if (!sameView(v, this.applied)) {
      this.applied = v;
      if (this.world) this.world.style.transform = viewTransform(v);
      for (const l of this.frameListeners) l(v);
      for (const l of this.listeners) l();
    }
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settledTick++;
      for (const l of this.settleListeners) l();
    }, SETTLE_MS);
  };

  dispose = () => {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    clearTimeout(this.settleTimer);
  };
}

export const ViewStoreContext = createContext<ViewStore | null>(null);

export function useViewStore(): ViewStore {
  return pick(undefined, useContext(ViewStoreContext));
}

function pick(store: ViewStore | undefined, ctx: ViewStore | null): ViewStore {
  const s = store ?? ctx;
  if (!s) throw new Error("ViewStoreContext missing");
  return s;
}

export function useViewValue(store?: ViewStore): View {
  const s = pick(store, useContext(ViewStoreContext));
  return useSyncExternalStore(s.subscribe, s.get, s.get);
}

export function useViewSettled(store?: ViewStore): number {
  const s = pick(store, useContext(ViewStoreContext));
  return useSyncExternalStore(s.subscribeSettled, s.getSettled, s.getSettled);
}
