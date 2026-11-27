/**
 * The review messages of `@paprika/core` are English sentences with the numbers and names inside. The rule code is the
 * stable part: each rule has its own sentence in the language of the app, and its values are read back from the core's
 * sentence. A sentence this does not recognize is shown as the core wrote it.
 */
export type ReviewText = { key: string; values: Record<string, string> };

const axesKey = (axes: string) => (axes === "width and height" ? "both" : axes === "width" ? "width" : "height");

const parsers: Record<string, (message: string) => ReviewText | null> = {
  "unknown-mode": (m) => match(m, /^mode "(.*)" has no tokens/, ([mode]) => ({ key: "unknown-mode", values: { mode: mode! } })),
  "unknown-token": (m) => match(m, /^token "\$?(.*)" does not exist$/, ([token]) => ({ key: "unknown-token", values: { token: token! } })),
  "empty-text": () => ({ key: "empty-text", values: {} }),
  "small-text": (m) => match(m, /^font size (\S+)px \(< (\S+)px\)$/, ([size, min]) => ({ key: "small-text", values: { size: size!, min: min! } })),
  contrast: (m) => match(m, /^contrast ([\d.]+):1 below ([\d.]+):1 \(WCAG AA(, large text)?\)$/, ([ratio, min, large]) => ({ key: large ? "contrast-large" : "contrast", values: { ratio: ratio!, min: min! } })),
  "raw-color": (m) =>
    match(m, /^literal (color|fill|gradient stop) "(.*)"; prefer a token$/, ([kind, value]) => ({ key: kind === "color" ? "raw-color" : kind === "fill" ? "raw-fill" : "raw-stop", values: { value: value! } })),
  "invisible-path": () => ({ key: "invisible-path", values: {} }),
  "missing-alt": () => ({ key: "missing-alt", values: {} }),
  "empty-group": () => ({ key: "empty-group", values: {} }),
  "unnamed-frame": () => ({ key: "unnamed-frame", values: {} }),
  "hug-without-layout": (m) => match(m, /^(width and height|width|height) "hug" on a frame without layout/, ([axes]) => ({ key: `hug-without-layout-${axesKey(axes!)}`, values: {} })),
  overflow: (m) =>
    match(m, /^goes outside "(.*)" \((\S+)×(\S+)\)( and will be clipped)?$/, ([parent, width, height, clipped]) => ({ key: clipped ? "overflow-clipped" : "overflow", values: { parent: parent!, width: width!, height: height! } })),
  "hug-was-meant": (m) => match(m, /^default 100×100 (\S+) frame;/, ([mode]) => ({ key: "hug-was-meant", values: { mode: mode! } })),
  "layout-overflow": (m) =>
    match(m, /^(\S+) children leave "(.*)" \((\S+)×(\S+)\) on (width and height|width|height): (.*)$/, ([mode, name, width, height, axes, listed]) => ({
      key: `layout-overflow-${axesKey(axes!)}`,
      values: { mode: mode!, name: name!, width: width!, height: height!, listed: listed! },
    })),
  "detached-sibling": (m) => match(m, /^touches no sibling in "(.*)" \(nearest gap (\S+)px\)$/, ([parent, gap]) => ({ key: "detached-sibling", values: { parent: parent!, gap: gap! } })),
  "near-gap": (m) => match(m, /^(\S+)px from "(.*)" \(under 4px\)$/, ([gap, name]) => ({ key: "near-gap", values: { gap: gap!, name: name! } })),
  "fully-hidden": (m) => match(m, /^fully hidden behind opaque "(.*)"$/, ([name]) => ({ key: "fully-hidden", values: { name: name! } })),
  "overlapping-boards": (m) => match(m, /^overlaps "(.*)"; nearest free spot is (\S+),(\S+)$/, ([name, x, y]) => ({ key: "overlapping-boards", values: { name: name!, x: x!, y: y! } })),
  "covered-by-overlay": (m) => match(m, /^painted above opaque frame "(.*?)" which covers it;/, ([name]) => ({ key: "covered-by-overlay", values: { name: name! } })),
};

function match(message: string, pattern: RegExp, build: (groups: (string | undefined)[]) => ReviewText): ReviewText | null {
  const found = pattern.exec(message);
  return found ? build(found.slice(1)) : null;
}

/** The translatable form of an issue's sentence, or `null` when the rule or the sentence is not one this knows. */
export function reviewText(rule: string, message: string): ReviewText | null {
  return parsers[rule]?.(message) ?? null;
}

/** The rules that have a name of their own in the language of the app. */
export const reviewRules = Object.keys(parsers);
