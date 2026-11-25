🇺🇸 English | [🇧🇷 Português](SECURITY.pt-BR.md)

# Security policy

## Supported versions

Paprika is pre-1.0 (`0.x`). Only the latest commit on `main` receives security fixes; there are no maintained release branches yet.

| Version | Supported |
|---|---|
| `main` | ✅ |
| anything older | ❌ |

## Reporting a vulnerability

**Please do not open a public issue, discussion or pull request for a security problem.**

Report it privately through GitHub's **Private Vulnerability Reporting**:

1. Go to the repository's [Security tab](https://github.com/leonardo-moraes360/paprika/security).
2. Click **Report a vulnerability** (or open [a new advisory draft](https://github.com/leonardo-moraes360/paprika/security/advisories/new) directly).
3. Fill in the form. The report is visible only to you and the maintainer.

A useful report includes:

- the affected component (`server-go`, `packages/e2e`, `packages/core`, `apps/web`, `crates/…`) and commit;
- how Paprika was started (command, flags such as `--host`, stdio or HTTP MCP);
- steps to reproduce or a proof of concept;
- the impact you expect (what an attacker gains, and from where: same machine, LAN, a web page open in the browser, a malicious document, an MCP client).

## What to expect

This is a personal open-source project maintained on a best-effort basis. The goals are:

- an acknowledgement within **7 days**;
- an initial assessment (accepted, needs more info, or out of scope) within **14 days**;
- a fix, or a documented mitigation, as soon as practical for accepted issues, coordinated with you before anything is published.

Once fixed, the issue is disclosed through a GitHub Security Advisory. You will be credited unless you prefer otherwise.

## Threat model and scope

Paprika is a **local** tool. The design assumptions are:

- The server binds to `127.0.0.1` by default and validates the `Host` and `Origin` headers to block DNS rebinding and CSRF from pages open in the browser.
- There is **no authentication**. Anyone who can reach the port can read and edit the document.
- MCP clients (agents) are trusted to edit the document, but their input is still validated (zod schemas in TypeScript, the equivalent checks in Go) and every write is an atomic transaction.
- Screenshots run a headless Chromium that fetches `https://` images referenced by the document.

**In scope**, for example:

- bypassing the Host/Origin checks, or reaching the server from a web page or another origin;
- a crafted `.paprika.json` document, MCP call or WebSocket message that leads to code execution, file access outside the document/database, script injection in the canvas or in exported HTML/TSX, or a crash that corrupts data;
- path traversal or arbitrary file writes in the CLI, `import`/`export` or the store;
- SSRF or local file reads through the screenshot pipeline beyond the documented `https://` image fetch;
- SQL injection or data corruption in the Go server's SQLite storage.

**Out of scope**:

- anything that requires running with `--host 0.0.0.0` (or another non-loopback address) on an untrusted network: this is documented as unsafe;
- an attacker who already controls your user account, the MCP client configuration or the files on disk;
- denial of service through huge documents sent by a trusted local client;
- vulnerabilities in third-party dependencies with no demonstrated impact on Paprika: please report those upstream.

## Safe harbor

Good-faith research that follows this policy, stays on your own machine and data, and gives a reasonable time to fix before disclosure will not be pursued or reported by the maintainer.
