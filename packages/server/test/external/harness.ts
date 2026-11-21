// Black-box harness: runs a Paprika server as a separate process, so the same tests verify the
// TypeScript server (default) and the Go server (PAPRIKA_SERVER_BIN=path/to/paprika-go binary).
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Document } from "@paprika/core";

export const repoRoot = resolve(import.meta.dirname, "../../../..");
const tsCli = join(repoRoot, "packages/server/dist/cli.js");

/** Path of the Go binary under test, or undefined to test the TypeScript server. */
export const goBin = process.env.PAPRIKA_SERVER_BIN || undefined;
export const impl = goBin ? "go" : "ts";

export interface ExternalServer {
  url: string;
  dir: string;
  proc: ChildProcess;
  /** Current document, read over HTTP (works for both implementations). */
  doc(): Promise<Document>;
  version(): Promise<number>;
  stop(): Promise<void>;
  /** Command + args to run the MCP stdio server on the same storage. */
  stdioCommand(): { command: string; args: string[] };
}

/** Seeds storage from a `.paprika.json` (or starts empty) and runs `serve` on a random port. */
export async function startServer(opts: { seed?: string; webRoot?: string } = {}): Promise<ExternalServer> {
  const dir = await mkdtemp(join(tmpdir(), `paprika-${impl}-`));
  const file = join(dir, "doc.paprika.json");
  const db = join(dir, "doc.db");
  if (opts.seed) await copyFile(opts.seed, file);
  let args: string[];
  let command: string;
  if (goBin) {
    if (opts.seed) execFileSync(goBin, ["import", file, "--db", db], { stdio: "pipe" });
    command = goBin;
    args = ["serve", "--db", db, "--port", "0", ...(opts.webRoot ? ["--web", opts.webRoot] : [])];
  } else {
    command = process.execPath;
    args = [tsCli, "serve", "--file", file, "--port", "0"];
  }
  const env = { ...process.env, ...(opts.webRoot ? { PAPRIKA_WEB_ROOT: opts.webRoot } : {}) };
  const proc = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  const url = await new Promise<string>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`servidor não subiu:\n${log}`)), 15_000);
    proc.stderr!.on("data", (b: Buffer) => {
      log += b.toString();
      const m = /canvas: (http:\/\/[^\s]+)/.exec(log);
      if (m) {
        clearTimeout(timer);
        ok(m[1]!);
      }
    });
    proc.once("exit", (code) => {
      clearTimeout(timer);
      fail(new Error(`servidor saiu (${code}):\n${log}`));
    });
  });
  const getJSON = async () => (await (await fetch(`${url}/api/document`)).json()) as { doc: Document; version: number };
  return {
    url,
    dir,
    proc,
    doc: async () => (await getJSON()).doc,
    version: async () => (await getJSON()).version,
    stdioCommand: () =>
      goBin ? { command: goBin, args: ["mcp", "--db", db, "--no-ui"] } : { command: process.execPath, args: [tsCli, "mcp", "--file", file, "--no-ui"] },
    stop: async () => {
      if (proc.exitCode === null) {
        const exited = new Promise((ok) => proc.once("exit", ok));
        proc.kill("SIGTERM");
        await exited;
      }
      await rm(dir, { recursive: true, force: true });
    },
  };
}

export async function waitFor(cond: () => boolean | Promise<boolean>, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!(await cond())) {
    if (Date.now() - start > ms) throw new Error("timeout esperando condição");
    await new Promise((r) => setTimeout(r, 20));
  }
}
