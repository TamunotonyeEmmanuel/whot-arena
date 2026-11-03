# WHOT Arena Web Deployment

## Deploy to Vercel and Render

This repository is prepared for a Vercel static frontend and free Render API/database resources. Free Render is a demo tier, not suitable for production: the API sleeps after 15 minutes without inbound traffic (including WebSocket traffic), wake-up may take about a minute, and the free PostgreSQL database expires after 30 days with a 14-day recovery window before deletion. Free databases also have no backups and a 1 GB limit. The backend persists active-room snapshots in the configured database and restores games after a restart, pausing active matches until players reconnect. Room coordination and WebSocket connections remain process-local, so the API must remain a single instance.

1. In Render, create a Blueprint from this repository and select `render.yaml`. The Blueprint provisions a free PostgreSQL database and one free API instance. Set the prompted `CORS_ORIGINS` value to the exact production Vercel origin, `https://whot-arena.vercel.app` (no trailing slash), and set `GOOGLE_CLIENT_ID` to the Google OAuth Web client ID (or leave it blank until Google sign-in is configured). Keep `ENVIRONMENT=production`; the Blueprint generates `JWT_SECRET` and uses the database's internal connection string. Wait for `/health` to pass and note the API URL, normally `https://whot-arena-api.onrender.com`.
2. In Vercel, import the same repository and set the project Root Directory to `web`. The included `web/vercel.json` builds the Vite app and rewrites client routes to `index.html`.
3. Before deploying on Vercel, set these Production environment variables using the actual Render API hostname:

	```dotenv
	VITE_API_URL=https://whot-arena-api.onrender.com
	VITE_WS_URL=wss://whot-arena-api.onrender.com/ws
	VITE_GOOGLE_CLIENT_ID=<Google OAuth Web client ID>
	```

	Create a Google OAuth 2.0 **Web application** client in Google Cloud Console. Add the production frontend origin (for example `https://whot-arena.vercel.app`) and local development origin (`http://localhost:5173`) to its authorized JavaScript origins. Set the same client ID as the private Render backend environment variable `GOOGLE_CLIENT_ID`. The client ID is public; do not configure a client secret for this sign-in flow.
4. Deploy the Vercel project. If its production domain differs from the origin entered in Render, update Render's `CORS_ORIGINS` and Google's authorized JavaScript origins to the exact assigned domain and redeploy/restart the API.
5. Verify the Vercel site can register/login, create/join a room in two browsers, record/play a voice note, and reconnect. Use the `wss://` endpoint; microphone capture requires HTTPS. Expect the first request after idle to wait for the Render service to wake.

Vercel Preview deployments have distinct origins. They are intentionally not wildcard-allowed; add an exact preview origin to Render `CORS_ORIGINS` only when needed. Never place `JWT_SECRET`, database credentials, or Render secrets in Vercel variables; `VITE_*` values are public and embedded in the browser bundle.

The agent environment has no logged-in Vercel/Render account, so it cannot create cloud resources or publish a public URL on your behalf. The manifests and steps below are ready for deployment from your provider dashboards or CLI.

## Required configuration

Copy `.env.example` to `.env` and set private production values outside source control:

```dotenv
ENVIRONMENT=production
JWT_SECRET=<at-least-32-random-characters>
POSTGRES_PASSWORD=<unique-database-password>
DATABASE_URL=postgresql+psycopg://whot:<url-encoded-password>@postgres:5432/whot_arena
ACCESS_TOKEN_MINUTES=1440
ADMIN_EMAILS=admin@example.com
GOOGLE_CLIENT_ID=<Google OAuth Web client ID>
CORS_ORIGINS=https://play.example.com
VITE_API_URL=https://api.example.com
VITE_WS_URL=wss://api.example.com/ws
VITE_GOOGLE_CLIENT_ID=<same Google OAuth Web client ID>
```

Generate a secret with a password manager or a cryptographically secure local generator. Do not commit `.env`, secrets, or production tokens. Production startup rejects the development JWT fallback/short secrets and wildcard CORS. Ensure `CORS_ORIGINS` is a comma-separated list of exact frontend origins, including scheme and port where relevant.

Accounts whose email is listed in `ADMIN_EMAILS` can use `/admin` to search and edit player usernames/emails, fund or debit Virtual Naira, review wallet-adjustment history, delete accounts, and update the default game rules. Wallet changes require a reason and are audited. Account deletion disables login, anonymizes account details, and retains historical match records. Administrator accounts are protected from account changes. Updated game defaults apply to new tables and quick matches; players can override the supported rules for solo and private tables before creating them.

## Docker Compose deployment

The repository Compose stack includes PostgreSQL, the single-process FastAPI service, and an Nginx-served static web build. The Vite API/WebSocket URLs and Google client ID are build arguments, so changing them requires rebuilding the frontend image.

```bash
docker compose --env-file .env up --build -d
docker compose --env-file .env ps
```

The web container listens on port 80 internally and is published as port 8080 by default. Put a TLS reverse proxy or managed load balancer in front of it and the API. Point the public site to the frontend and route `/api/*`, `/health`, and `/ws` to the backend. The WebSocket proxy must preserve the `Upgrade` and `Connection` headers and allow long-lived upgraded connections. Use HTTPS/WSS externally; do not expose credentials over plain HTTP.

For a separate static frontend host, build from `web/` with production `VITE_API_URL` and `VITE_WS_URL`, then publish `web/dist`. Configure SPA fallback to `index.html`. Set backend `CORS_ORIGINS` to the static site's exact HTTPS origin.

Voice recording requires microphone permission and a secure browser context; use HTTPS in production (localhost is treated as secure for development). Preserve WebSocket upgrades and allow frames of at least 1 MB so a 512 KB note plus base64 and JSON framing can pass safely.

## Backend and database operations

The backend container is deliberately configured for one worker. Do not increase Uvicorn workers or run multiple replicas: active WebSocket connections and room coordination are held in memory. Configure persistent PostgreSQL storage, backups, TLS for database connections where supported, monitoring, and log collection. `/health` checks database readiness; `/health/live` is the process liveness check.

Startup creates missing tables and runs the numbered, additive schema compatibility migrations in `data_migrations`; the migrations preserve existing user balances and statistics and compile date types for the active database dialect. The runner is intentionally limited to safe additive upgrades; use a standard migration tool for complex transformations and run migrations as a controlled deployment step before enabling multiple backend instances. Back up the database before upgrades; prior match rows cannot gain historical participant associations. `/health` checks the database and is the Render readiness endpoint; `/health/live` only checks process liveness. Production startup requires PostgreSQL and explicit exact HTTPS `CORS_ORIGINS`. Active room snapshots are restored after process restart and playing matches wait for human reconnection; Virtual Naira stakes remain disabled in production pending end-to-end interrupted-match/refund validation. For production scaling, first move rooms, player connections/presence, reconnect state, and broadcasts to a shared system, then add load/abuse controls. Do not scale the current in-memory backend horizontally.

## Verification

Before publishing:

```bash
cd backend && .venv/bin/python -m pytest -q
cd ../web && npm ci && npm test && npm run build
```

Check `GET /health`, register and log in through the public origin, create/join a room from separate clients, complete a match, read `/api/history` with the account token, reconnect during a round, and rematch. Confirm browser WebSocket frames do not contain another player's hand. The project includes configuration and build artifacts for deployment, but does not provision a public domain, TLS certificate, cloud database, or hosting account; the operator must supply those services.
