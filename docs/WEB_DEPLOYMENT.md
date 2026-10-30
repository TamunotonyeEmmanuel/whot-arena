# WHOT Arena Web Deployment

## Deploy to Vercel and Render

This repository is prepared for a Vercel static frontend and free Render API/database resources. Free Render is a demo tier, not suitable for production: the API sleeps after 15 minutes without inbound traffic (including WebSocket traffic), wake-up may take about a minute, and the free PostgreSQL database expires after 30 days with a 14-day recovery window before deletion. Free databases also have no backups and a 1 GB limit. Active rooms and voice notes are in process memory, so rooms disappear on sleep/restart and the API must remain a single instance.

1. In Render, create a Blueprint from this repository and select `render.yaml`. The Blueprint provisions a free PostgreSQL database and one free API instance. Set the prompted `CORS_ORIGINS` value to the exact production Vercel origin, `https://whot-arena.vercel.app` (no trailing slash). Keep `ENVIRONMENT=production`; the Blueprint generates `JWT_SECRET` and uses the database's internal connection string. Wait for `/health` to pass and note the API URL, normally `https://whot-arena-api.onrender.com`.
2. In Vercel, import the same repository and set the project Root Directory to `web`. The included `web/vercel.json` builds the Vite app and rewrites client routes to `index.html`.
3. Before deploying on Vercel, set these Production environment variables using the actual Render API hostname:

	```dotenv
	VITE_API_URL=https://whot-arena-api.onrender.com
	VITE_WS_URL=wss://whot-arena-api.onrender.com/ws
	```

4. Deploy the Vercel project. If its production domain differs from the origin entered in Render, update Render's `CORS_ORIGINS` to the exact assigned domain and redeploy/restart the API.
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
CORS_ORIGINS=https://play.example.com
VITE_API_URL=https://api.example.com
VITE_WS_URL=wss://api.example.com/ws
```

Generate a secret with a password manager or a cryptographically secure local generator. Do not commit `.env`, secrets, or production tokens. Production startup rejects the development JWT fallback/short secrets and wildcard CORS. Ensure `CORS_ORIGINS` is a comma-separated list of exact frontend origins, including scheme and port where relevant.

## Docker Compose deployment

The repository Compose stack includes PostgreSQL, the single-process FastAPI service, and an Nginx-served static web build. The Vite API/WebSocket URLs are build arguments, so changing them requires rebuilding the frontend image.

```bash
docker compose --env-file .env up --build -d
docker compose --env-file .env ps
```

The web container listens on port 80 internally and is published as port 8080 by default. Put a TLS reverse proxy or managed load balancer in front of it and the API. Point the public site to the frontend and route `/api/*`, `/health`, and `/ws` to the backend. The WebSocket proxy must preserve the `Upgrade` and `Connection` headers and allow long-lived upgraded connections. Use HTTPS/WSS externally; do not expose credentials over plain HTTP.

For a separate static frontend host, build from `web/` with production `VITE_API_URL` and `VITE_WS_URL`, then publish `web/dist`. Configure SPA fallback to `index.html`. Set backend `CORS_ORIGINS` to the static site's exact HTTPS origin.

Voice recording requires microphone permission and a secure browser context; use HTTPS in production (localhost is treated as secure for development). Preserve WebSocket upgrades and allow frames of at least 1 MB at the proxy/backend so a 512 KB clip plus base64/JSON framing fits. Audio clips are transient room memory, not durable user data.

## Backend and database operations

The backend container is deliberately configured for one worker. Do not increase Uvicorn workers or run multiple replicas: room/session state is held in memory. Configure persistent PostgreSQL storage, backups, TLS for database connections where supported, monitoring, log collection, and a health check against `/health`. Database startup uses SQLAlchemy `create_all`: it creates missing tables, including the new `match_participants` table, but is not a versioned migration system. Back up the database before upgrades; prior match rows cannot gain historical participant associations.

For production scaling, first move rooms, player connections/presence, reconnect state, and broadcasts to a shared system, then add a versioned migration tool such as Alembic and load/abuse controls. Do not scale the current in-memory backend horizontally.

## Verification

Before publishing:

```bash
cd backend && .venv/bin/python -m pytest -q
cd ../web && npm ci && npm test && npm run build
```

Check `GET /health`, register and log in through the public origin, create/join a room from separate clients, complete a match, read `/api/history` with the account token, reconnect during a round, and rematch. Confirm browser WebSocket frames do not contain another player's hand. The project includes configuration and build artifacts for deployment, but does not provision a public domain, TLS certificate, cloud database, or hosting account; the operator must supply those services.