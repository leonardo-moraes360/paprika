#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { accessSync, appendFileSync, constants } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { planFor, planLines, planSummary } from "./ci-plan-lib.mjs";

const [base, head = "HEAD"] = process.argv.slice(2);
if (!base) {
  console.error("usage: ci-plan.mjs <base-sha> [head-ref]");
  process.exit(2);
}

function resolveGit() {
  const searched = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of searched) {
    const candidate = join(isAbsolute(dir) ? dir : resolve(process.cwd(), dir), "git");
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
    }
  }
  throw new Error(`git not found on PATH (${searched.join(delimiter) || "empty PATH"})`);
}

let git;
try {
  git = resolveGit();
} catch (error) {
  console.error(`ci-plan: ${error.message}`);
  process.exit(3);
}

const files = execFileSync(git, ["diff", "--name-only", base, head], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const plan = planFor(files, { ciFull: process.env.CI_FULL === "1" });

const lines = planLines(plan);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines);
else process.stdout.write(lines);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, planSummary(plan, files));
}
