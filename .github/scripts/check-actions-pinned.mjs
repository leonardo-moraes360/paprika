#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_ROOTS = [".github/workflows", ".github/actions"];
export const SHA_LENGTH = 40;

const LEADING_WHITESPACE = /^[ \t]+/;
const LIST_DASH = /^-[ \t]+/;
const USES_KEY = "uses:";

export function usesValue(line) {
  const start = line.replace(LEADING_WHITESPACE, "");
  const key = LIST_DASH.test(start) ? start.replace(LIST_DASH, "") : start;
  if (!key.startsWith(USES_KEY)) return null;
  return key.slice(USES_KEY.length).replace(LEADING_WHITESPACE, "");
}

const VERSION_COMMENT = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

export function kindOf(value) {
  const target = value.replace(/^["']|["']$/g, "").trim();
  if (!target) return "empty";
  if (target.startsWith("./")) return "local";
  if (target.startsWith("docker://")) return "container";
  return "third-party";
}

export function violation(value, comment) {
  const kind = kindOf(value);
  if (kind === "local" || kind === "container") return null;
  const target = value.replace(/^["']|["']$/g, "").trim();
  if (kind === "empty") return "empty uses:";

  const at = target.lastIndexOf("@");
  if (at <= 0) return `no commit pin (uses: ${target})`;
  const repo = target.slice(0, at);
  const ref = target.slice(at + 1);

  if (!/^[0-9a-f]+$/.test(ref)) return `not pinned to a commit SHA (uses: ${repo}@${ref})`;
  if (ref.length !== SHA_LENGTH) return `short SHA: pin the full ${SHA_LENGTH} characters (uses: ${repo}@${ref})`;
  if (comment === null) return `SHA pin without the version comment (uses: ${repo}@${ref})`;
  const reference = comment.split(/\s+/)[0];
  if (!reference || !VERSION_COMMENT.test(reference) || reference === ref) {
    return `unusable version comment "# ${comment}"`;
  }
  return null;
}

export function scanFile(path) {
  const lines = readFileSync(path, "utf8").split("\n");
  const problems = [];
  let checked = 0;
  let pinned = 0;
  let local = 0;
  let container = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/^[ \t]*#/.test(line)) continue;
    const raw = usesValue(line);
    if (raw === null) continue;
    checked++;
    const hash = raw.indexOf("#");
    const value = (hash === -1 ? raw : raw.slice(0, hash)).trim();
    const comment = hash === -1 ? null : raw.slice(hash + 1).trim();
    const kind = kindOf(value);
    if (kind === "local") local++;
    else if (kind === "container") container++;
    const reason = violation(value, comment);
    if (reason) problems.push({ line: index + 1, reason });
    else if (kind === "third-party") pinned++;
  }
  return { checked, pinned, local, container, problems };
}

export function collectFiles(paths) {
  const files = [];
  for (const path of paths) {
    if (!existsSync(path)) throw new Error(`no such file or directory: ${path}`);
    if (statSync(path).isDirectory()) files.push(...walkYaml(path));
    else if (/\.ya?ml$/.test(path)) files.push(path);
  }
  return [...new Set(files)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function walkYaml(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkYaml(full));
    else if (entry.isFile() && /\.ya?ml$/.test(entry.name)) found.push(full);
  }
  return found;
}

export function checkPaths(paths) {
  const files = collectFiles(paths);
  const problems = [];
  const totals = { checked: 0, pinned: 0, local: 0, container: 0 };
  for (const file of files) {
    const found = scanFile(file);
    for (const key of Object.keys(totals)) totals[key] += found[key];
    for (const problem of found.problems) problems.push({ file, ...problem });
  }
  return { files, ...totals, problems };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const paths = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_ROOTS;
  let result;
  try {
    result = checkPaths(paths);
  } catch (error) {
    console.error(`check-actions-pinned: ${error.message}`);
    process.exit(2);
  }
  if (result.problems.length) {
    for (const problem of result.problems) {
      console.error(`${relative(process.cwd(), problem.file)}:${problem.line}: ${problem.reason}`);
    }
    console.error(`${result.problems.length} unpinned action reference(s) in ${result.files.length} file(s) checked`);
    process.exit(1);
  }
  console.log(
    `${result.pinned} pinned action uses in ${result.files.length} file(s) checked` +
      ` (${result.local} local action(s), ${result.container} container image(s), all other references pinned)`,
  );
}
