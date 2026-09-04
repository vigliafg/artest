# Preview run instructions

## Reproduce artifacts

- No environment files or package dependencies are required.
- Ensure Node.js 18+ is available.
- For AI analysis, copy `.env.example` to `.env.local` and fill in `OPENROUTER_API_KEY`. The server loads `.env.local` / `.env` automatically. Never commit the key.

## Run the server

From the project root, run the server on the default port:

```bash
node server.mjs
```

The preview URL is `http://127.0.0.1:8000`.

## art-creator (app sorella · authoring contenuti)

Server separato, zero dipendenze, richiede Node ≥ 22.5 (modulo nativo `node:sqlite`).

```bash
cd art-creator
node server.mjs            # http://127.0.0.1:8100  (porta: ART_CREATOR_PORT)
```

La chiave `OPENROUTER_API_KEY` arriva da `.env.local`/`.env` alla radice del repo (loader condiviso con artest). Il DB SQLite si crea da solo in `art-creator/data/art-creator.db`; le immagini caricate finiscono in `art-creator/uploads/`.
