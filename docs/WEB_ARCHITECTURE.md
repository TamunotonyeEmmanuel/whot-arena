# WHOT Arena Web Architecture

## Runtime shape

The browser app in `web/` is a React 19 + TypeScript SPA built by Vite, styled with Tailwind CSS and a small set of custom CSS rules, and routed with React Router. Lucide icons are used for action/navigation controls. The app is a separate client; it does not replace or compile the Flutter project.

The browser uses `VITE_API_URL` for HTTP and `VITE_WS_URL` for the WebSocket. The defaults target local FastAPI on port 8000. In production these values are embedded at frontend build time and must use the public HTTPS and WSS API origins. Live voice uses peer-to-peer WebRTC by default; optional TURN URLs and credentials can be supplied with `VITE_TURN_URL`, `VITE_TURN_USERNAME`, and `VITE_TURN_CREDENTIAL`. Since all `VITE_*` values are public in the built client, never use long-lived TURN credentials. TURN configuration is currently build-time only; automatic short-lived credential refresh needs a runtime credential endpoint and is not implemented.

The in-game phone also contains a standalone, local two-player snooker frame. Open the phone during an Arena session, tap **Snooker**, then use the aim and power controls to take shots. Snooker state is client-only and does not use the WHOT WebSocket or account match history.

## Browser routes

| Route | Purpose | Backend contract |
| --- | --- | --- |
| `/` | Landing and game entry | None |
| `/login`, `/register` | Account authentication | `POST /api/auth/login`, `POST /api/auth/register` |
| `/dashboard` | Player stats and game actions | `/api/profile` data when signed in |
| `/create` | Private room or quick match | WebSocket `create`, `quick_match` |
| `/join` | Join by six-character code | WebSocket `join` |
| `/lobby/:code` | Connected players and host start | WebSocket `state`, `start` |
| `/game/:code` | Private hand, table, turns, result/rematch | WebSocket `state`, `play`, `draw`, `rematch` |
| `/profile` | Account profile and win rate | Authenticated `GET /api/profile` |
| `/history` | Participant-specific match results | Authenticated `GET /api/history` |
| `/leaderboard` | Ranked players | `GET /api/leaderboard` |
| `/settings` | Browser-local display/audio preferences | Local storage only |
| `/help` | Current Arena house rules | None |

## Authority and privacy

`backend/app/game.py` remains the canonical rules engine. The client may visually mark a matching card as playable, but every `play`, `draw`, `start`, and `rematch` request is checked by the server. Client game state is a projection from server `state` events; there is no client-submitted winner or deck.

The server's existing draw rule allows a player to draw and pass on any turn, including when a legal card is held; the UI preserves that variant. A drawn card is not played immediately because the turn advances.

The server sends a separate `Room.view(player_id)` to each connected participant. A view includes only that participant's hand and opponent counts. Card faces, piles, and turn indicators are rendered from that projection. The WebSocket transport uses the same protocol as Flutter and checks browser `Origin` against `CORS_ORIGINS`; a valid account token is required to create, join, or quick-match. Guest display names are supported, but anonymous room access is not.

Live voice sends audio directly over WebRTC when possible. Only peers whose direct connection fails use the WebSocket audio fallback; fallback packets are sent only to explicitly selected, connected room members. TURN is recommended for restrictive networks; use provider-managed, short-lived credentials because client build-time variables are public. Voice notes use the room's existing authorized WebSocket session. Uploads are base64-encoded audio with an allowlisted media type and a 512 KB decoded limit. State broadcasts include sender, time, and size metadata only; a room member requests the audio by message ID, and the server returns it only on that member's socket. Recording is capped at 15 seconds in the browser. The room keeps up to 20 recent notes and 4 MB total in process memory. HTTPS is required in production for browser microphone access.

Bearer and reconnect credentials are held in `sessionStorage` for the current browser tab. Non-secret account display data and preferences use `localStorage`. Reconnect credentials remain bearer secrets; clear site data and sign out on shared devices.

## Backend persistence and current limits

Accounts, user statistics, match summaries, participant links, and active room snapshots are stored through SQLAlchemy. Startup bootstraps missing tables and applies the numbered, additive compatibility migrations recorded in `data_migrations`. Date columns compile through the active database dialect, and existing account balances are never rewritten by these schema migrations. After a restart, active rooms are restored from their latest snapshot and playing matches pause until all human players reconnect. Snapshots hash reconnect tokens before persistence. Live connections and room coordination remain in process memory, so the deployment must use one backend process/replica; multi-instance room sharing and routing require a shared system such as Redis and are not included here.

The `match_participants` table associates registered users with new matches. Old match summaries do not have participant data and therefore are not retroactively included in `/api/history`. The current migration runner is deliberately limited to additive, idempotent changes; complex transformations should move to a standard migration tool before introducing multi-process startup migrations.

Rematches are initiated by the host after a match and require all existing players to be connected. The backend redeals the existing player roster and resets match state; it does not create a new room or change the project's house rules.
