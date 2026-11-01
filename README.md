# WHOT Arena — browser and mobile Nigerian WHOT

Responsive React/TypeScript browser client, Flutter mobile client, and FastAPI
WebSocket server. The browser's in-game phone includes a local two-player
snooker frame. WHOT supports **2–4 human players**, private room codes, display
nicknames for signed-in accounts, public quick match, server-side dealing/validation, special cards,
private hands, room-only voice notes, reconnect, registered-player match history, rematches, a
leaderboard, optional synthesized game cues, 10-minute lobby reconnection, 30-second disconnect autopilot, and 30-second turn timeout.

## Important scope
This is a development release, not a fully operated public service. Active room
snapshots are persisted to the configured database and restored after a backend
restart; active games pause until players reconnect. Live connections and room
coordination remain process-local, so the server must run as a **single process**.
Reconnect credentials are bearer secrets. Match history is
recorded for new matches played by registered users; earlier match rows cannot
be associated with participants. The UI uses CSS card faces and symbols. The
repository contains a background MP3 whose licensing/provenance needs review;
game cues are generated with the browser Web Audio API. Rate limiting, distributed
room state, observability, and production abuse controls still need work.

## Browser client

The React app lives in `web/`; it does not replace the Flutter project.

```bash
cd web
npm ci
cp .env.example .env.local
npm run dev
```

Open the Vite URL shown in the terminal (normally `http://localhost:5173`). Set
`VITE_API_URL` and `VITE_WS_URL` in `web/.env.local` if the backend is not on
the local default. These are public build-time endpoints, never secrets. For
deployment, see [docs/WEB_DEPLOYMENT.md](docs/WEB_DEPLOYMENT.md).

## 1. Generate platform scaffolding (Flutter SDK required)
From the repository root:
```bash
cd mobile
flutter create --platforms=android,ios,web --project-name whot_arena .
flutter pub get
flutter run -d chrome
```
`flutter create` fills in the standard Android/iOS/web runner folders that are
not included in this source distribution. Do not overwrite `lib/main.dart`.
On Ubuntu, Android/web testing works with the respective SDKs. Building iOS
requires a Mac with Xcode.

## 2. Run backend
From the repository root:
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
Health check: `http://localhost:8000/health`.
Run tests: `cd backend && .venv/bin/python -m pytest -q`

Local development uses SQLite by default. Set `DATABASE_URL` to a PostgreSQL URL
for persistent deployment and set a strong, private `JWT_SECRET`.

## Docker/PostgreSQL
Copy `.env.example` to `.env`, replace every development secret, then run:
```bash
docker compose up --build
```
The API will listen on port 8000. Keep a single backend worker until room state
and connection routing have been moved to Redis.

Account endpoints:
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/profile` (Bearer token required)
- `GET /api/history` (Bearer token required; new matches only)
- `GET /api/leaderboard`

Browser routes include landing, login, registration, dashboard, private room,
quick match, room-code joining, lobby, live game, player profile, history,
leaderboard, settings, and house rules.

## 3. Connect devices
In the Flutter home screen, set the server URL:
- Android emulator: `ws://10.0.2.2:8000/ws`
- Chrome on same machine: `ws://localhost:8000/ws`
- Physical phone on same Wi-Fi: `ws://YOUR_LAN_IP:8000/ws`
The phone must be able to reach your backend and firewall must permit port 8000.
For production, use `https://` and `wss://` with TLS and a hosted server.

## 4. Play
Register or sign in before creating, matchmaking, or joining a room.
Player 1: Create private room. Share the code. Players 2–4: Join.
Host starts with at least two players. Only your own cards are visible.
Tap a card to play it, or Draw Card & Pass. WHOT 20 prompts for a shape.

## House rules in this MVP
5 cards dealt to each player. Match the top card's shape or number;
WHOT 20 can be played anytime and requests a shape.
1: play again. 2: next player draws two and loses turn.
5: next player draws three and loses turn. 8: skip next player.
14: all other players draw one, then its player plays again. Pick Two only stacks on Pick Two, and Pick Three only stacks on Pick Three; a player without the matching card draws the accumulated total and loses their turn.

Players should declare LAST CARD after reaching one card. If they do not, an opponent can call it before the next game action to give them a two-card penalty; the penalty is not automatic. Computer players declare automatically and call missed declarations on their turn.
Players may draw one and pass even when holding a playable card; the draw ends their turn.
The first player to empty their hand wins immediately, except that 1, 2, 5, 8,
14, and 20 cannot finish a round; playing one last requires drawing a replacement.
If the market and recyclable discard pile are exhausted, the round ends on
points: face values count normally, Stars count double, and WHOT counts 20. The
lowest hand total wins.
These are configurable Nigerian WHOT house-rule choices; confirm them before
production. The standard 54-card deck uses 49 shaped cards plus five WHOT 20
cards. There are no 6 or 9 cards, and every shape's exact number set is defined
in `backend/app/game.py`; no licensed physical deck artwork is included.

During a live game, players can record voice notes up to 15 seconds. The browser
asks for microphone permission only when recording begins. Notes are delivered
only to players in that room, remain in memory while the room exists, and are
not persisted.

## Security/production limitations
Set `ENVIRONMENT=production`, a random `JWT_SECRET` of at least 32 characters,
and exact `CORS_ORIGINS` before deployment. Production rejects the development
secret and wildcard CORS. Keep TLS/WSS at the edge. The backend still requires
one worker because room coordination and active WebSocket connections are
process-local; multi-instance room sharing, rate limiting, reconnect token
expiry, and production observability are not included. See [docs/WEB_ARCHITECTURE.md](docs/WEB_ARCHITECTURE.md),
[docs/WEB_TESTING.md](docs/WEB_TESTING.md), and
[docs/WEB_DEPLOYMENT.md](docs/WEB_DEPLOYMENT.md).
