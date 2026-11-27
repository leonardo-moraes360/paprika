import type { PinAuthor, PinEntry, PinReplyEntry, PinTarget } from "@/components/frontends/pins";
import type { ServerPin } from "@/data/queries/pins";
import { agentLabel, toneFor, type AgentTones } from "./agents";

export type { AgentTones };

const authorOf = (actor: string, tones: AgentTones): PinAuthor => (actor === "user" ? { name: "user", you: true } : { name: agentLabel(actor), tone: toneFor(actor, tones) });

export function pinTarget(pin: ServerPin): PinTarget {
  if (pin.nodeId) return pin.nodeMissing ? { kind: "missing" } : { kind: "node", name: pin.nodeName || pin.nodeId };
  return { kind: "area", width: pin.region.width, height: pin.region.height };
}

function repliesOf(pin: ServerPin, tones: AgentTones): PinReplyEntry[] {
  if (pin.replies && pin.replies.length > 0) return pin.replies.map((reply) => ({ id: reply.id, author: authorOf(reply.author, tones), text: reply.text, createdAt: reply.createdAt }));
  // A pin answered through the single `reply` field (older agents): shown as one message from whoever closed or claimed it.
  if (pin.reply) return [{ id: `${pin.id}:reply`, author: authorOf(pin.resolvedBy || pin.claimedBy || "user", tones), text: pin.reply, createdAt: pin.updatedAt }];
  return [];
}

const cache = new WeakMap<ServerPin, { key: string; entry: PinEntry }>();

/** Server pin to panel entry; the same pin with the same tones gives the same object (a refetch of unchanged pins re-renders no row). */
export function toPinEntry(pin: ServerPin, tones: AgentTones): PinEntry {
  const key = [pin.author, pin.claimedBy ?? "", ...(pin.replies?.map((reply) => reply.author) ?? []), pin.resolvedBy ?? ""].map((actor) => (actor ? (tones[actor] ?? "") : "")).join("|");
  const hit = cache.get(pin);
  if (hit && hit.key === key) return hit.entry;
  const entry: PinEntry = {
    id: pin.id,
    number: pin.n,
    status: pin.status,
    text: pin.text,
    author: authorOf(pin.author, tones),
    createdAt: pin.createdAt,
    target: pinTarget(pin),
    ...(pin.claimedBy ? { claimedBy: { name: agentLabel(pin.claimedBy), tone: toneFor(pin.claimedBy, tones) } } : {}),
    replies: repliesOf(pin, tones),
  };
  cache.set(pin, { key, entry });
  return entry;
}

export const toPinEntries = (pins: readonly ServerPin[], tones: AgentTones): PinEntry[] => pins.map((pin) => toPinEntry(pin, tones));

/** Actors (`agent:<name>`) that appear in the pins, so the container can give them a tone. */
export function pinActors(pins: readonly ServerPin[]): string[] {
  const out = new Set<string>();
  for (const pin of pins) {
    for (const actor of [pin.author, pin.claimedBy, pin.resolvedBy, ...(pin.replies?.map((reply) => reply.author) ?? [])]) if (actor && actor !== "user") out.add(actor);
  }
  return [...out];
}
