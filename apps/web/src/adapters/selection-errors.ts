/**
 * `groupOps`, `wrapOps` and `ungroupOps` of `@paprika/core` refuse with an English sentence. The ones they can write are
 * mapped to a key under `app.shell.selectionErrors.*` (with what the sentence quotes as values) so the toast speaks the
 * language of the app; anything else comes out as `other`, with the core's text as the `detail`.
 */
export type SelectionErrorKey = "nothingToGroup" | "nothingToUngroup" | "missing" | "page" | "connector" | "instanceCopy" | "sameParent" | "flowLayout" | "notGroup" | "other";
export type SelectionErrorNote = { key: SelectionErrorKey; values: Record<string, string> };

const NOTES: readonly [RegExp, SelectionErrorKey, (match: RegExpMatchArray) => Record<string, string>][] = [
  [/^pass at least (?:one id|\d+ ids) to (?:group|wrap)$/, "nothingToGroup", () => ({})],
  [/^pass at least one group id$/, "nothingToUngroup", () => ({})],
  [/^nodes do not exist: (.*)$/, "missing", () => ({})],
  [/^node "(.*)" does not exist$/, "missing", () => ({})],
  [/^"(.*)" is a page(?:; pages cannot be grouped)?$/, "page", () => ({})],
  [/^"(.*)" is a connector; its position follows its ends$/, "connector", () => ({})],
  [/^"(.*)" is a copy inside the instance "(.*)"; edit the instance instead$/, "instanceCopy", () => ({})],
  [/^only nodes with the same parent can be (?:grouped|aligned|distributed|wrapped) /, "sameParent", () => ({})],
  [/^"(.*)" has layout (\w+): its children follow the flow and cannot be grouped/, "flowLayout", (m) => ({ layout: m[2]! })],
  [/^node "(.*)" is (\w+), not a group$/, "notGroup", () => ({})],
];

export function selectionErrorNote(text: string): SelectionErrorNote {
  for (const [pattern, key, values] of NOTES) {
    const match = text.match(pattern);
    if (match) return { key, values: values(match) };
  }
  return { key: "other", values: { detail: text } };
}
