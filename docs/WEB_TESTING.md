# WHOT Arena Web Testing

## Commands

Run the backend tests from `backend/`:

```bash
cd backend
.venv/bin/python -m pytest -q
```

Run browser-client tests and the production TypeScript/Vite build from `web/`:

```bash
cd web
npm ci
npm test
npm run build
```

The test suites use the existing backend's FastAPI/pytest and WebSocket tests, plus Vitest, jsdom, and Testing Library for the browser client.

## Covered behavior

- Account registration/login validation, authenticated profile, leaderboard, and participant-specific history authorization.
- Room creation/joining, host start authorization, room capacity, quick match, private hands, disconnect/reconnect, and wrong reconnect credentials.
- Active game recovery after terminating and restarting a backend process against the same database, including preserved private hands, pause-until-reconnected behavior, and reconnect-token validation.
- Deal size, turn order, draw, legal-card enforcement, WHOT shape validation, Pick Two, Pick Three, Hold On, skip, General Market, immediate win, and host-only rematch reset.
- Untrusted browser WebSocket origins are closed with policy code 1008.
- Room voice upload rejects unsupported media, empty/oversized clips, lobby sends, and rapid repeats; state contains metadata only, while room members retrieve audio through their own socket.
- Browser landing-to-rules navigation and accessible WHOT card activation.
- Production TypeScript compilation and Vite bundling.

## Current gaps and manual checks

The frontend test environment is jsdom; it does not model real browser layout, low-end Android performance, or device-specific touch behavior. A live browser smoke test during this migration checked 390 px, 768 px, and 1440 px widths with no horizontal overflow; created a private room, joined it from a second browser tab at phone width, started a match, and played a legal card with synchronized hand/turn state. Before release, repeat on real mobile browsers, complete a round, reconnect a player, and rematch. Verify no opponent hand values appear in WebSocket state payloads.

The frontend tests currently do not mock the HTTP/WebSocket server end-to-end or capture a physical microphone in jsdom. Backend protocol tests cover room upload/retrieval independently. Manually verify microphone permission, a 15-second auto-stop, playback on a second room member's browser, and error handling when permission is denied. Add full browser-driven multiplayer tests when a stable CI browser runner and test server lifecycle are configured.

Most recent local verification (2026-11-01): backend, frontend, and Flutter results are recorded in `docs/DEVELOPMENT_STATUS.md` for the latest source changes. jsdom logs that HTML media playback is not implemented while the audio component attempts autoplay. These checks do not verify a live PostgreSQL server or deployment.