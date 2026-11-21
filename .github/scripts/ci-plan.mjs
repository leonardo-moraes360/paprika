#!/usr/bin/env node
// Decides which CI jobs a pull request needs, from the files it changes.
//
// Usage: node .github/scripts/ci-plan.mjs <base-sha> [head-ref]
//   CI_FULL=1  forces every job (set by the `ci:full` label).
//
// Writes `key=value` lines to $GITHUB_OUTPUT (or stdout when run locally) and a summary table to
// $GITHUB_STEP_SUMMARY. Run it locally to see what CI would do for your branch:
//   node .github/scripts/ci-plan.mjs origin/main HEAD
//
// Only the I/O lives here: the git diff, the environment and the two GitHub files. The rules are
// in ci-plan-lib.mjs, which the tests in .github/scripts/test/ describe.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { planFor, planLines, planSummary } from "./ci-plan-lib.mjs";

const [base, head = "HEAD"] = process.argv.slice(2);
if (!base) {
  console.error("usage: ci-plan.mjs <base-sha> [head-ref]");
  process.exit(2);
}

const files = execFileSync("git", ["diff", "--name-only", base, head], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const plan = planFor(files, { ciFull: process.env.CI_FULL === "1" });

const lines = planLines(plan);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
else process.stdout.write(lines);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, planSummary(plan, files));
}
