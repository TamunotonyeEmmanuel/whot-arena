# WHOT Arena Web Migration Audit

## Scope and baseline

This audit covers the repository at the start of the browser migration. The existing backend test suite was run before changes: **16 passed**. The Flutter source is preserved as the mobile client; the web application is a separate client of the existing FastAPI service.

## Existing architecture

### Flutter client

`mobile/lib/main.dart` contains the complete Flutter application in one stateful screen. It stores the display name, server URL, access token, player ID, room code, and reconnect token in `shared_preferences`; uses HTTP for account/profile/leaderboard requests; and uses `web_socket_channel` for rooms and live games. The client handles sign-in and registration dialogs, private-room creation, quick match, joining, reconnect, lobby, card selection, drawing, and the winner display.

`mobile/pubspec.yaml` shows a small dependency set: Flutter Material, `http`, `shared_preferences`, and `web_socket_channel`. No game-specific image, animation, or sound assets are declared. The only image assets found are standard Flutter web/app icons. The visual card face is currently drawn from text and symbols in code.

### Python backend

`backend/app/main.py` owns FastAPI startup, account route registration, in-memory rooms/connections, WebSocket messages, the timeout/disconnection monitor, per-player state broadcasts, and match-stat recording. `backend/app/game.py` owns the authoritative card model, rules, turn progression, game actions, and privacy-filtered state view. `backend/app/accounts.py`, `auth.py`, `schemas.py`, and `database.py` implement account HTTP routes, JWT/password handling, request/response validation, and SQLAlchemy persistence.

The persistence layer stores users and completed match summaries in SQLite by default, with PostgreSQL supported via `DATABASE_URL`. Room state, connections, hands, deck, and reconnect credentials are process-local Python memory. The Docker image runs one Uvicorn worker, which is required for the current room model.

## Existing game rules

The game uses shapes `circle`, `triangle`, `cross`, `square`, and `star`; the first four contain 1–13 and `star` contains 1–5, 7, and 8. Five WHOT 20 cards are added. Two to four players receive five cards each, and the opening discard is selected to avoid action cards. A player may match the top number or the active/requested shape; WHOT 20 is wild and requires a valid shape.

The established house rules in `backend/app/game.py` are: 1 grants another turn; 2 makes the next player draw two and lose a turn; 5 makes the next player draw three and lose a turn; 8 skips the next player; 14 makes every opponent draw one; 20 selects the requested shape. Action penalties do not stack. Penalty draws end the target's turn. A player wins immediately by emptying their hand. A 45-second turn timeout and a 30-second reconnect grace period are configured in `main.py`.

The current backend accepts a one-card draw on any active turn, even if the player has a playable card; drawing passes the turn, so the drawn card cannot be played immediately. The web UI preserves this existing behavior.

These are project-specific house rules, not a claim that every Nigerian WHOT variant follows them. The supported configurable values are currently limited to the `HouseRules` fields; penalty stacking is explicitly disabled. Rule variants such as draw-until-playable, whether a drawn card can be played immediately, action-card finishing, and alternate special-card effects need product confirmation before changing the backend rules.

## Existing HTTP and WebSocket contracts

HTTP routes:

- `GET /health`: process health and in-memory room count.
- `POST /api/auth/register`: create an account and return an access token and user.
- `POST /api/auth/login`: validate credentials and return an access token and user.
- `GET /api/profile`: authenticated player's public account statistics.
- `GET /api/leaderboard`: top users by wins, capped to 100.

WebSocket route: `/ws`. The first client message is one of `create`, `quick_match`, `join`, or `reconnect`. Subsequent messages are `start`, `play` (`card_id`, and `shape` for WHOT), or `draw`. Server messages are `session`, player-specific `state`, and `error`. Every player receives their own view; it contains their hand and only opponent card counts, not opponent hands or reconnect credentials. The backend validates host actions, turn ownership, card membership/legality, and WHOT shape choice.

There is no room-list endpoint, match-history endpoint, user preference API, rematch action, or explicit leave action. Match results store the winner, room code, player count, and completion time, but do not store all participants; an authenticated per-player history cannot be correctly reconstructed from that schema.

## Reuse versus rewrite

### Reuse

- Keep `backend/app/game.py` as the sole authority for card dealing, legality, actions, turns, and wins. The browser must render server state and submit intents only.
- Keep the FastAPI account routes, JWT format, profile shape, leaderboard shape, and WebSocket message names to avoid breaking Flutter.
- Keep the Flutter project and its existing Android/iOS/web scaffolding intact. Its HTTP and WebSocket flows are useful contract examples.
- Reuse the backend tests as rules and protocol regression tests. Continue using the textual card symbols until original artwork is supplied; no licensed deck art is present in the repository.

### Rewrite for browser

- Build a new React + TypeScript + Vite client under `web/`, with React Router for distinct product routes and responsive layouts for small touch screens through desktop.
- Replace Flutter widget/dialog navigation with browser routes and accessible form/control patterns. The browser client should store the bearer token and reconnect credentials with care, provide configuration via environment variables, and handle socket closure/reconnection explicitly.
- Implement web-only lobby/table visuals and animations with CSS and lightweight React components; no Flutter widgets or runtime can be reused in the web build.

### Backend additions or explicit deferrals

- Rematch and durable participant-specific history require server protocol/schema changes. These are not safe to fake in a client; history should remain unavailable until participant records and migration strategy are added. Rematch likewise needs an authoritative server action and clear behavior for disconnected players.
- Multi-instance deployment requires shared room state and connection routing (for example Redis); the current in-memory model is single-process only.
- Production readiness requires a non-default JWT secret, explicit production CORS origins, TLS/WSS at the edge, WebSocket origin/rate/size controls, and operational monitoring. Current guest play remains unauthenticated by design; account-bound play can be selected by sending a valid access token.

## Risks found

- CORS currently defaults to `*`, and the repository's compose defaults contain development credentials. These are unsafe production defaults.
- JWT has a development fallback secret. Deployment must set a long random secret and fail closed when production configuration is missing.
- Active room snapshots are persisted and restored after a backend restart, but live WebSocket connections and room coordination remain process-local; multiple workers or replicas are not safe.
- Reconnect tokens are long-lived bearer secrets returned at session creation and have no expiry; they rotate on successful reconnection and are omitted from room views.
- The socket accepts guest connections, and there is no rate limiting, heartbeat policy, or comprehensive abuse protection.
- HTTP match history cannot be associated with all participants using the current `MatchResult` model.
- WebSocket `ValueError` responses are handled, but other unexpected exceptions and persistence failures need monitoring and careful production error handling.

## Migration verification

At audit time the backend suite passed: 16 tests, with one upstream Starlette/httpx deprecation warning. The migration should add browser production-build and browser interaction coverage without weakening the existing backend privacy, rules, authentication, and reconnect tests. See `WEB_ARCHITECTURE.md`, `WEB_TESTING.md`, and `WEB_DEPLOYMENT.md` for the resulting implementation and operational guidance.