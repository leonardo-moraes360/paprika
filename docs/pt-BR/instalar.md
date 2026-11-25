[🇺🇸 English](../en-US/install.md) | 🇧🇷 Português

# Instalar com Docker

O Paprika roda no seu computador. O jeito mais rápido é o Docker: uma imagem só traz o servidor, o canvas e o renderizador, então não é preciso instalar mais nada.

## O que você precisa

- [Docker](https://docs.docker.com/get-docker/) com o Docker Compose (o Docker Desktop já traz os dois).
- Git, para baixar o código.

## Suba o Paprika

```bash
git clone https://github.com/leonardo-moraes360/paprika.git
cd paprika
docker compose up -d --build
```

O primeiro build leva alguns minutos. Quando terminar, abra **http://localhost:4777** no navegador. Você vai ver os seus workspaces; dê dois cliques num deles para abrir o canvas.

## Parar e subir de novo

```bash
docker compose down   # parar
docker compose up -d  # subir de novo
```

Os seus designs ficam num volume do Docker, então sobrevivem a reinícios e atualizações.

## Bom saber

- Mantenha a porta **4777**. O servidor só aceita essa porta, como proteção contra outros sites falando com ele.
- O Paprika não tem login e só escuta na sua própria máquina. Não o exponha numa rede em que você não confia.
- Screenshots e export em SVG usam um Chrome headless, que a imagem já traz.

## Próximos passos

- [Conecte o seu agente](conectar-agente.md) para ele desenhar no canvas.
- Backups, importação e exportação, modo time e outras portas: [Docker](docker.md).
- Prefere não usar Docker? [Rode a partir do código-fonte](desenvolvimento.md#rodar-sem-docker).
