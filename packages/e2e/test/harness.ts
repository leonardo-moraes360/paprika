import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Document } from "@paprika/core";

export const repoRoot = resolve(import.meta.dirname, "../../..");

export const serverBin = resolve(process.env.PAPRIKA_SERVER_BIN || join(repoRoot, "server/bin/paprika"));
if (!existsSync(serverBin)) throw new Error(`servidor Go não encontrado em ${serverBin}: rode \`pnpm go:build\``);

// As suítes ainda dirigem o app antigo; o servidor serve o novo por padrão, então a raiz antiga é fixada aqui.
const legacyWebRoot = join(repoRoot, "web-legacy/dist");

let warnedNoLegacy = false;

// Sem o build do app antigo a suíte de API ainda roda, mas o servidor cairia no app novo sem ninguém ver: avisa alto, uma vez.
function defaultWebRoot(): string | undefined {
  if (existsSync(join(legacyWebRoot, "index.html"))) return legacyWebRoot;
  if (!warnedNoLegacy) {
    warnedNoLegacy = true;
    console.warn(`[e2e] app antigo não construído em ${legacyWebRoot} (rode \`pnpm --filter @paprika/web-legacy build\`): as suítes de navegador vão encontrar o app novo, não o antigo`);
  }
  return undefined;
}

export interface ExternalServer {
  url: string;
  dir: string;
  proc: ChildProcess;
  doc(): Promise<Document>;
  version(): Promise<number>;
  stop(): Promise<void>;
  stdioCommand(): { command: string; args: string[] };
}

export async function startServer(opts: { seed?: string; webRoot?: string } = {}): Promise<ExternalServer> {
  const dir = await mkdtemp(join(tmpdir(), "paprika-e2e-"));
  const file = join(dir, "doc.paprika.json");
  const db = join(dir, "doc.db");
  if (opts.seed) {
    await copyFile(opts.seed, file);
    execFileSync(serverBin, ["import", file, "--db", db], { stdio: "pipe" });
  }
  const web = opts.webRoot ?? defaultWebRoot();
  const args = ["serve", "--db", db, "--port", "0", ...(web ? ["--web", web] : [])];
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
