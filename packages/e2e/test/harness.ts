// Black-box harness: runs the Go Paprika server as a separate process, reached only through MCP
// (HTTP and stdio), the WebSocket and the HTTP API. Build it first with `pnpm go:build`;
// PAPRIKA_SERVER_BIN points at another binary.
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Document } from "@paprika/core";

export const repoRoot = resolve(import.meta.dirname, "../../..");

/** Path of the server binary under test. */
export const serverBin = resolve(process.env.PAPRIKA_SERVER_BIN || join(repoRoot, "server/bin/paprika"));
if (!existsSync(serverBin)) throw new Error(`servidor Go não encontrado em ${serverBin}: rode \`pnpm go:build\``);

export interface ExternalServer {
  url: string;
  dir: string;
  proc: ChildProcess;
  /** Current document, read over HTTP. */
  doc(): Promise<Document>;
  version(): Promise<number>;
  stop(): Promise<void>;
  /** Command + args to run the MCP stdio server on the same storage. */
  stdioCommand(): { command: string; args: string[] };
}

/** Seeds storage from a `.paprika.json` (or starts empty) and runs `serve` on a random port. */
export async function startServer(opts: { seed?: string; webRoot?: string } = {}): Promise<ExternalServer> {
  const dir = await mkdtemp(join(tmpdir(), "paprika-e2e-"));
  const file = join(dir, "doc.paprika.json");
  const db = join(dir, "doc.db");
  if (opts.seed) {
    await copyFile(opts.seed, file);
    execFileSync(serverBin, ["import", file, "--db", db], { stdio: "pipe" });
  }
  const args = ["serve", "--db", db, "--port", "0", ...(opts.webRoot ? ["--web", opts.webRoot] : [])];
  const proc = spawn(serverBin, args, { stdio: ["ignore", "pipe", "pipe"] });
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
    stdioCommand: () => ({ command: serverBin, args: ["mcp", "--db", db, "--no-ui"] }),
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
