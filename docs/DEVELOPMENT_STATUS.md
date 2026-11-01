# WHOT Arena Development Status

**Audit date:** 2026-11-01  
**Scope:** Local repository source, tests, and deployment configuration. No Render, Vercel, or production database access was used.

## Executive summary

WHOT Arena is an existing full-stack game with a React/Vite web client, a Flutter client, and a FastAPI/SQLAlchemy backend. The backend implements the central WHOT rules and room protocol, while account, messaging, friendship, invitation, and player-stat APIs already exist. The app is a development release rather than a production-scalable service.

The highest-risk database defect was an initialization migration that unconditionally reset every existing account's Arena Coin balance to 10,000 the first time its migration marker was absent. Startup no longer performs that update. Startup schema upgrades are now recorded as numbered, additive migrations and compile date column types for the active database dialect. Tests cover preservation of existing balances, match statistics, and messages.

Active room snapshots are persisted in the configured SQL database and restored after a backend restart. Restored matches pause until all human players reconnect with their session credentials; snapshots preserve private hands without storing raw reconnect tokens. WebSocket connections and room coordination still remain process-local, so multiple backend instances cannot safely share rooms. Cross-instance multiplayer remains the primary production-readiness blocker. Virtual Naira stakes remain disabled in production until interrupted-match and refund behavior is validated end to end.

## Architecture verified

- **Web:** React 19, TypeScript, Vite, React Router, and custom CSS in `web/`. The routes cover landing, authentication, dashboard, room creation/joining, lobby/game, profile, history, leaderboard, settings, administration, and rules. WebSocket state is rendered per player; the server supplies the private hand.
- **Backend:** FastAPI route composition in `backend/app/main.py` and `accounts.py`; JWT/password handling in `auth.py`; SQLAlchemy models and database startup in `database.py`; authoritative rules in `game.py`.
- **Mobile:** Flutter app in `mobile/lib/main.dart`, with Android/iOS project scaffolding. Its current screen handles authentication, room connection, reconnect, lobby, and core play. Credentials are stored with `shared_preferences`, not platform secure storage.
- **Hosting config:** `render.yaml` configures one Uvicorn worker and PostgreSQL; `web/vercel.json` configures Vite output and SPA fallback; `compose.yaml` configures PostgreSQL, API, and static web containers. Configuration presence does not verify a live deployment.

## Implemented features

- Account registration/login, password hashing, JWT-protected profile/history, public leaderboard, and admin overview.
- Private room codes, public quick match, computer opponent, host start/rematch, two-to-four-player cap, server-side card dealing and move validation, per-player hand views, and reconnect tokens.
- Turn timers, disconnect pause/autopilot, room chat, voice-note uploads/retrieval, and browser live-voice signaling.
- Profile statistics, match history for newly recorded matches, Arena Coins, XP/levels, basic achievements, cosmetic selection, friendships/requests, blocks, message privacy, direct messages/read/delivery status, presence/typing, and match invitations.
- Responsive React screens, a Flutter client, synthesized browser game cues, background audio playback, and voice capture/playback UI.

## Gameplay rules currently implemented

The server uses a 54-card deck: 49 shaped cards across circle, triangle, cross, square, and star, plus five WHOT 20 cards. Two to four players receive five cards each. The opening discard is selected to avoid action cards.

Players match the top card by number or active shape; WHOT 20 is wild and requests a shape. The current house-rule defaults are:

- 1 grants another turn.
- 2 makes the next player draw two and lose their turn; 5 does the same with three.
- Pick penalties stack only on the same number when stacking is enabled.
- 8 skips the next player.
- 14 makes each opponent draw one; its player continues.
- WHOT 20 requests a shape.
- A player may draw one card and pass even when holding a playable card; the drawn card is not played immediately.
- A player who reaches one card must declare LAST CARD before the next game action or draw a two-card penalty. Bots declare automatically.
- Action cards cannot finish a hand; the player draws a replacement. Emptying a hand otherwise wins the round. If the market is exhausted, the lowest hand score wins (star cards count double and WHOT counts 20); the discard pile is not recycled.
- A match is best of three rounds: the first player to win two rounds is the match winner.
- A turn lasts 30 seconds; active-game disconnect grace is 30 seconds and lobby reconnect grace is 10 minutes.

These are configurable house-rule choices, not a claim that every Nigerian WHOT table uses the same variant. Runtime room creation does not currently expose a user-facing rules editor.

## API and protocol inventory

HTTP endpoints include:

- `GET /health`, `GET /api/admin/overview`
- `POST /api/auth/register`, `POST /api/auth/login`
- `GET /api/profile`, `PUT /api/profile/cosmetics`, `PUT /api/profile/message-privacy`
- `GET /api/history`, `GET /api/leaderboard`
- `GET /api/players/search`, `GET /api/players/{username}/presence`, `GET /api/players/{username}/card`
- `GET /api/friends`, `POST /api/friends/{username}`, `POST /api/friends/{username}/accept`, `DELETE /api/friends/{username}`
- `POST /api/blocks/{username}`, `DELETE /api/blocks/{username}`
- `GET /api/messages`, `POST /api/messages`, `POST /api/messages/read/{username}`, `POST /api/messages/typing`
- `GET /api/match-invitations`, `POST /api/match-invitations`, `POST /api/match-invitations/{id}/{decision}`

`/ws` handles room create/join/quick-match/reconnect, start/play/draw/rematch/leave, pause, last-card declaration, table chat/voice, and audio signaling. Room creation, joining, and matchmaking require an account token. Reconnect uses the session bearer token.

## Partially implemented or missing

- **Production multiplayer:** room snapshots survive process restarts in the application database, but live connections, coordination, and broadcasts remain process-local. There is no shared Redis/pub-sub layer or cross-instance routing; use a single backend instance.
- **Interrupted matches:** active rooms restore from their last persisted snapshot and pause for player reconnection. Recovery is verified with a real backend process-restart test using SQLite; PostgreSQL restart recovery and failure-injection around every state transition are not verified. Virtual Naira stakes remain disabled in production pending end-to-end interrupted-match/refund validation.
- **Migrations:** current startup handles only numbered, additive compatibility changes. It is not a general migration framework and has no downgrade path or controlled deployment migration command.
- **Economy:** account balances, match stakes/rewards, XP, and achievements exist, but there is no durable coin transaction ledger, transaction-history API, or virtual-item purchase flow. Current unlocks are level-derived.
- **Social UI:** backend APIs cover several social operations; a complete standalone, polished social-management experience and end-to-end delivery behavior still need verification.
- **Presence and messaging:** presence is inferred from recent HTTP activity, not a durable online-session registry. Direct messages are persisted, but the client/server realtime delivery path and delivery/read behavior need broader integration tests.
- **Security controls:** no rate limiting or login abuse controls; reconnect tokens have no expiry, though they rotate on successful reconnect; browser bearer credentials are accessible to same-origin JavaScript; Flutter uses general preferences for credentials. `/health` now checks database readiness, but rate limiting and token expiry remain open.
- **Mobile readiness:** the Flutter client is a compact single-screen implementation and has not been validated on physical Android/iOS devices. Safe credential storage, reconnect behavior under mobile network changes, and low-end device performance remain open.
- **Audio/assets:** browser cues are synthesized; a background MP3 exists. Its licensing/provenance was not verified. Do not treat its presence as proof of usage rights.
- **UI architecture:** the web application is concentrated in a large `main.tsx`; the Flutter app is concentrated in one screen. Functional coverage is ahead of automated visual/accessibility and device-level QA.
- **Deployment:** free-tier Render resources have availability, persistence, and expiry limitations documented in `docs/WEB_DEPLOYMENT.md`. Production URLs, CORS values, secrets, database connectivity, backups, logs, TLS, and real deployment health were not verified.

## Critical findings and changes in this audit

| Finding | Status |
|---|---|
| Startup could overwrite every existing Arena Coin balance with 10,000 | Fixed: removed the balance-update migration from startup; schema migrations only add missing columns. A regression test verifies existing balance/stat/message preservation. |
| A backend restart interrupted active games | Fixed for the single-process deployment model: room snapshots are persisted in the configured SQL database; playing games restore paused and resume only after all human players reconnect. A real-process restart regression test verifies private hands and reconnect credentials. |
| Manual datetime DDL did not consistently follow the active SQL dialect | Fixed: migration column types compile through the selected SQLAlchemy dialect; a PostgreSQL type compilation test guards against SQLite `DATETIME` DDL. No live PostgreSQL server was available for integration testing. |
| WebSocket tests sent unauthenticated room-creation/join requests despite the account-token requirement | Fixed: protocol tests now register test users and provide valid tokens; a negative test confirms anonymous room creation is rejected. |
| Default admin access was tied to a hard-coded email when `ADMIN_EMAILS` was unset | Fixed: there is no default admin allowlist; operators must explicitly configure `ADMIN_EMAILS`. |
| CORS rejected browser `PUT` and `DELETE` requests used by profile/social APIs | Fixed: allowed the existing mutation methods and added browser preflight regression tests. |
| Concurrent/duplicate match completion could repeat stats and coin payouts | Fixed for match results: each match has a durable unique idempotency key and result, statistics, and payout are committed atomically. |
| Concurrent stake debits could overspend a balance; failed lobby/rematch validation could leave a stake charged | Fixed: stake deductions are conditional atomic SQL updates, all player deductions roll back together, and disconnected rooms cannot lock stakes. Stakes are disabled in production until interrupted-match recovery is durable. |
| Health check reported ready while the database was unavailable | Fixed: `/health` is database readiness; `/health/live` is process liveness. Production now fails startup without PostgreSQL and explicit exact HTTPS CORS origins. |
| `HouseRules.penalty_stacking` was reported/configurable in the model but ignored during move validation | Fixed: disabling stacking now prevents a matching penalty card from blocking the pending draw; covered by a gameplay test. |
| Test suite used the default SQLite file and could persist test users there | Fixed for future runs: `backend/tests/conftest.py` supplies a disposable SQLite database for tests. Earlier baseline runs used the local default database before this isolation was added. |

Earlier baseline tests ran against the existing local `backend/whot_arena.db`. A read-only aggregate check after that run found 119 users, all with `@example.com` addresses, and the previous starting-balance migration marker. No account contents were inspected and no rows were deleted. The database's state before testing cannot be established from the available evidence; restore or cleanup should only be done with an explicit decision and a verified backup.

## Verification

Before fixes:

- Backend: 42 passed, 8 failed; all eight WebSocket failures were due to tests omitting the now-required account token.
- Web: 3 tests passed and the production TypeScript/Vite build succeeded. jsdom emitted unimplemented media-play warnings during audio setup.
- Flutter: baseline test and static analysis were run from `mobile/`; details are recorded below after the implementation pass.

After the production-readiness changes:

- Backend: **65 passed**, including a real backend process-restart and reconnect test. Remaining output includes upstream Starlette/httpx and Python SQLite datetime-adapter deprecation warnings.
- Web: **3 passed**; TypeScript check and Vite production build succeeded. jsdom reports that media playback is not implemented while the audio component attempts autoplay.
- Flutter: **1 passed**; `flutter analyze` reported no issues. The Flutter command warned that native Linux build dependencies are not installed; no Linux build was requested or performed.
- PostgreSQL: migration DDL type compilation was checked, but no PostgreSQL service was available; live connectivity/migration behavior remains unverified.
- Production: no cloud resources, production data, or deployment settings were accessed or changed.

## Recommended priorities

1. Move room coordination, player connections, timers, and broadcasts to a shared production-safe multiplayer design; add multi-instance tests before scaling. Room snapshot restart recovery currently works only with the existing single-process architecture.
2. Adopt a standard migration/deployment workflow with reviewed migrations, backups, and a tested upgrade path from the supported SQLite/PostgreSQL schemas.
3. Add abuse controls, reconnect credential lifecycle, stronger token storage, explicit database readiness, and operational logs/metrics.
4. Add a transactional virtual-currency ledger and idempotent reward/purchase operations; define the permitted economy rules before exposing more coin flows.
5. Add end-to-end tests for messaging, friends/blocks/privacy, invitations, WebSocket authorization, and complete match rewards/statistics.
6. Validate mobile touch/reconnect/secure-storage behavior and browser UI/accessibility/audio on real devices; verify audio asset usage rights.
7. Verify Vercel/Render environment, TLS/WSS, PostgreSQL connectivity, backups, and health checks in a non-production staging deployment before seeking production approval.
