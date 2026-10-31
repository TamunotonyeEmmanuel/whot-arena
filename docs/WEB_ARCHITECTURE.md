# WHOT Arena Web Architecture

## Runtime shape

The browser app in `web/` is a React 19 + TypeScript SPA built by Vite, styled with Tailwind CSS and a small set of custom CSS rules, and routed with React Router. Lucide icons are used for action/navigation controls. The app is a separate client; it does not replace or compile the Flutter project.

The browser uses `VITE_API_URL` for HTTP and `VITE_WS_URL` for the WebSocket. The defaults target local FastAPI on port 8000. In production these values are embedded at frontend build time and must use the public HTTPS and WSS API origins. No credentials or private keys belong in Vite environment variables.

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

The server sends a separate `Room.view(player_id)` to each connected participant. A view includes only that participant's hand and opponent counts. Card faces, piles, and turn indicators are rendered from that projection. The WebSocket transport uses the same protocol as Flutter and checks browser `Origin` against `CORS_ORIGINS`; bearer tokens are sent in the first JSON message for account-bound rooms. Guest play remains supported.

Live table voice uses peer-to-peer WebRTC audio. The existing authorized room WebSocket relays SDP and ICE negotiation messages only to the addressed player; audio does not pass through or persist on the game server. The browser requests microphone permission on table entry and exposes mute/unmute after access is granted. HTTPS is required in production. The current public STUN configuration is suitable for development, but reliable production connectivity across restrictive mobile and corporate networks requires a configured TURN service.

Bearer and reconnect credentials are held in `sessionStorage` for the current browser tab. Non-secret account display data and preferences use `localStorage`. Reconnect credentials remain bearer secrets; clear site data and sign out on shared devices.

## Backend persistence and current limits

Accounts, user statistics, match summaries, and participant links are stored through SQLAlchemy. Rooms and active connections remain in process memory. The deployment must use one backend process/replica; process restart loses active rooms. Horizontal scaling requires shared room state and connection routing, typically via Redis, and is not included here.

The new `match_participants` table associates registered users with new matches. Startup calls `Base.metadata.create_all`, which creates the table in existing databases without modifying existing tables. Old match summaries do not have participant data and therefore are not retroactively included in `/api/history`. A formal Alembic migration workflow is not part of this repository yet.

Rematches are initiated by the host after a match and require all existing players to be connected. The backend redeals the existing player roster and resets match state; it does not create a new room or change the project's house rules.
