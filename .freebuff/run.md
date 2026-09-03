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