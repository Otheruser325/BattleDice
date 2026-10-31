# Battle Dice Autoroller

Turn-based strategy autochess with dice vs. dice combat!

## Local development

- `npm run dev` starts the normal Vite source app (dev menu and debug logs on).
- `npm run dev:launcher` builds the Phaser Launcher-style `main.js` bundle in development mode, syncs `assets/` and `gamedata/`, and starts Vite for local playtesting. Open `http://127.0.0.1:5173/playtest.html` to exercise the generated bundle instead of the source entrypoint.
- `npm run dev:clean` removes generated launcher playtest files after local testing.

## Environment flags

Vite loads `.env`, `.env.local`, `.env.<mode>`, and `.env.<mode>.local`, plus any `VITE_*`
variable already exported in the shell (shell wins). Boolean values accept `1`/`true`/`yes`/`on`
and `0`/`false`/`no`/`off`.

| Variable | Accepted by | Effect |
| --- | --- | --- |
| `VITE_ENABLE_DEV_MENU` | app runtime | Force the Dev menu on/off. Defaults to on for development builds. Guarded against shipping. |
| `VITE_DEBUG_LOGS` | app runtime | Force console debug logging on/off. Defaults to on for development builds. Guarded against shipping. |
| `VITE_RIVALIS_WS_URL` | app runtime | Rivalis multiplayer websocket endpoint (`ws://` or `wss://`). |
| `VITE_RIVALIS_TICKET_ENDPOINT` | app runtime | Endpoint used to fetch a Rivalis matchmaking ticket. |
| `VITE_RIVALIS_IDENTITY_ENDPOINT` | app runtime | Optional guest identity endpoint; derived from the ticket endpoint when omitted. |
| `VITE_RIVALIS_RECONNECT_MAX` | app runtime | Positive integer immediate reconnect attempts before the client falls back to slower fresh-ticket retries (default `4`). |
| `VITE_BASE_PATH` | build config | Sub-path the app is served from, e.g. `/BattleDice/`. Overridden by `REPO_FIX`. |
| `REPO_FIX` | build config | Explicit base path override; takes precedence over `VITE_BASE_PATH` and `GITHUB_REPOSITORY`. |
| `GITHUB_REPOSITORY` | build config | `owner/repo`; the repo name is used as the base path when nothing else is set. |
| `BATTLE_DICE_BUILD_MODE` | launcher bundle | Overrides the bundle `MODE`; set to `development` for a dev playtest bundle. |
| `BATTLE_DICE_SOURCEMAP` | launcher bundle | Set to `1` to emit `main.js.map` for the production launcher bundle. |

Rivalis tickets are sent as the WebSocket subprotocol (`Sec-WebSocket-Protocol`), not as a URL query parameter. The Rivalis server must accept the ticket there.

Multiplayer identity uses a signed `HttpOnly` guest cookie. The client syncs its profile name to `/api/multiplayer/identity` before fetching a ticket; ticket claims and the socket's player identity come from the server, not the join payload. The ticket endpoint requires an existing guest identity and returns `401` instead of minting an anonymous one. Tickets are single-use at WebSocket authentication, and the client fetches a fresh one for each reconnect.

`VITE_ENABLE_DEV_MENU` and `VITE_DEBUG_LOGS` are the only dev-only flags. They are refused by
production builds (`npm run build`, `npm run bundle:playtest`, `npm run preview:launcher`). To use
them locally, run `npm run dev` or `npm run dev:launcher`, which build in development mode.

## Multiplayer API

The deployable Rivalis API lives in [`server/`](server/README.md). It provides the signed ticket endpoint, origin-checked WebSocket transport, matchmaking, private lobbies, and server-side session handling. It is intentionally separate from the static Vite client and can be deployed with the included `server/Dockerfile` and `server/fly.toml`.

```bash
npm run server:dev
npm run server:build
npm run server:test
```

The server requires its own dependencies and environment:

```bash
cd server
cp .env.example .env
npm ci
```

Then configure the client:

```env
VITE_RIVALIS_WS_URL=ws://127.0.0.1:8080/ws
VITE_RIVALIS_TICKET_ENDPOINT=http://127.0.0.1:8080/api/rivalis-ticket
VITE_RIVALIS_IDENTITY_ENDPOINT=http://127.0.0.1:8080/api/multiplayer/identity
```

The server runs authoritative PvP combat: both players place dice, ready up (or are auto-placed at the 30-second deadline), and receive server-resolved state, results, and a per-match combat record. Opponent boards and pips stay hidden during placement and are revealed only when combat resolves; reconnecting restores the match and its record from the server. Lobby codes are server-generated and joins are IP-limited. Local combat remains the PvE path. Guest identity is pseudonymous and stable for the cookie lifetime, but it is not full account authentication. See [`server/SECURITY.md`](server/SECURITY.md) for the audit and deployment limits.

Use the same hostname for the page and API (ports may differ). The development identity cookie is `SameSite=Lax`; mixing `localhost` and `127.0.0.1` makes it cross-site and prevents the cookie from being sent.

## Packaging safety

Launcher playtest artifacts are generated at the repository root for compatibility with the launcher shell, but they are ignored by Git and npm package dry-runs so local playtesting does not accidentally duplicate large generated assets in a package.
