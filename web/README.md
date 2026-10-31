# Nook web

The Nook web client is a React + TypeScript + Vite app backed by the real Nook API.

## Run locally

From this directory:

```bash
npm install
npm run dev
```

The development server runs at `http://localhost:5173` and expects the backend API at
`http://localhost:3000`. Start the backend from the repository root with its normal
environment/database setup before opening the web client.

## Checks

```bash
npm run typecheck
npm run build
```

To point the client at another API origin, set `VITE_API_BASE_URL` to the API base,
including `/api`, before running Vite.

Authentication tokens are stored in browser `localStorage` under `nook.auth.token`.
The client uses the REST contract in `../docs/openapi.yaml`, including the backend's
real pagination, processing, correction, category, collection, and suggestion routes.
