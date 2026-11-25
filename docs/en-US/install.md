🇺🇸 English | [🇧🇷 Português](../pt-BR/instalar.md)

# Install with Docker

Paprika runs on your own computer. The quickest way is Docker: one image holds the server, the canvas and the renderer, so nothing else has to be installed.

## What you need

- [Docker](https://docs.docker.com/get-docker/) with Docker Compose (Docker Desktop includes both).
- Git, to download the code.

## Start Paprika

```bash
git clone https://github.com/leonardo-moraes360/paprika.git
cd paprika
docker compose up -d --build
```

The first build takes a few minutes. When it finishes, open **http://localhost:4777** in your browser. You'll see your workspaces; double-click one to open its canvas.

## Stop and start again

```bash
docker compose down   # stop
docker compose up -d  # start again
```

Your designs are kept in a Docker volume, so they survive restarts and upgrades.

## Good to know

- Keep the port at **4777**. The server only accepts that port, as a protection against other websites talking to it.
- Paprika has no login and listens only on your own machine. Don't expose it to a network you don't trust.
- Screenshots and SVG export use a headless Chrome, which the image already includes.

## Next steps

- [Connect your agent](connect-agent.md) so it can draw on the canvas.
- Backups, import and export, team mode and other ports: [Docker](docker.md).
- Prefer not to use Docker? [Run from source](development.md#run-from-source).
