# Battle Dice Server

Node.js multiplayer API for Battle Dice, built on `@rivalis/core`.

The server owns matchmaking, private lobbies, player sessions, and the authoritative match lifecycle. It does not serve the Vite client. Server-generated boards, pips, combat resolution, HP/status state, and the 30-second placement deadline are canonical; clients render the returned state and only submit their own board.

Guest identity is a signed, `HttpOnly` cookie containing a stable pseudonymous player ID and server-owned display name. Tickets are bound to that identity; join payloads no longer carry a client-chosen name. The cookie is not an account and does not authenticate a person.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /healthz` | Fly/health-check endpoint |
| `POST /api/multiplayer/identity` | Creates or renames the signed guest identity; sets the `bd_guest` cookie |
| `GET /api/rivalis-ticket` | Issues a signed ticket bound to an existing guest identity; `401` without one |
| `WS /ws` | Rivalis WebSocket endpoint; ticket is sent as `Sec-WebSocket-Protocol` |

The identity and ticket endpoints are rate-limited by client IP and accept only exact configured origins. Ticket issuance requires the signed guest cookie; it does not create a new identity. Tickets are single-use at WebSocket authentication, and the client requests a fresh ticket before every reconnect. WebSocket connections are origin-checked at the HTTP upgrade, frame-capped, heartbeat-checked, and rate-limited per actor by Rivalis.

## Local setup

```bash
cd server
cp .env.example .env
npm ci
npm run dev
```

Set a real local `TICKET_SECRET` in `server/.env`:

```bash
openssl rand -base64 48
```

Do not commit `server/.env` or reuse a production secret locally.

The default development origins are:

```text
http://127.0.0.1:5173
http://localhost:5173
```

Point the client's `.env.local` at the local API:

```env
VITE_RIVALIS_WS_URL=ws://127.0.0.1:8080/ws
VITE_RIVALIS_TICKET_ENDPOINT=http://127.0.0.1:8080/api/rivalis-ticket
VITE_RIVALIS_IDENTITY_ENDPOINT=http://127.0.0.1:8080/api/multiplayer/identity
VITE_RIVALIS_RECONNECT_MAX=4
```

Run the client separately from the repository root:

```bash
npm run dev
```

The page and API are cross-origin but should use the same hostname, such as `127.0.0.1` for the page and API (ports may differ). The development cookie is `SameSite=Lax`, so opening the page on `localhost` while the API is on `127.0.0.1` would be cross-site and the browser would not send the identity cookie. Use the same hostname for both.

The identity response requires credentialed CORS, and the client sends both identity and ticket requests with `credentials: 'include'`. In production, use HTTPS and a same-origin reverse proxy where possible; the production cookie is `SameSite=None; Secure` to support a separate API origin.

## Fly.io

The included `Dockerfile` and `fly.toml` deploy only this API; the game remains a separate static deployment.

1. Create or select the Fly app and update `app` and `primary_region` in `fly.toml`.
2. Set `ALLOWED_ORIGINS` to the exact deployed game origin, for example `https://battle-dice.example`.
3. Create the secret. Never put it in `fly.toml` or the repository:

```bash
cd server
fly secrets set TICKET_SECRET="$(openssl rand -base64 48)"
fly deploy
```

The health check is `GET /healthz`. Fly terminates TLS, so the public WebSocket URL is `wss://<app>.fly.dev/ws` (or a custom domain).

Set these client build variables for the deployed client:

```env
VITE_RIVALIS_WS_URL=wss://<api-host>/ws
VITE_RIVALIS_TICKET_ENDPOINT=https://<api-host>/api/rivalis-ticket
VITE_RIVALIS_IDENTITY_ENDPOINT=https://<api-host>/api/multiplayer/identity
```

`ALLOWED_ORIGINS` must include the exact scheme, host, and port of the page that opens the WebSocket. Origins are not wildcarded.

The current room state is in memory. Run one Fly machine only; horizontal scaling would split matchmaking and lobby state across independent processes. Add shared room placement or Rivalis fleet coordination before scaling out.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `8080` | HTTP/WebSocket port |
| `HOST` | `0.0.0.0` | Container bind address |
| `NODE_ENV` | `development` | `production` requires the next two values |
| `ALLOWED_ORIGINS` | local Vite origins | Required in production; comma-separated exact origins |
| `TICKET_SECRET` | ephemeral in development | Required in production; at least 32 bytes |
| `TICKET_TTL_SECONDS` | `7200` | 60-86400 seconds |
| `TICKET_REQUESTS_PER_MINUTE` | `30` | Per client IP |
| `GUEST_IDENTITY_TTL_SECONDS` | `2592000` | 1 hour-365 days; guest cookie lifetime |
| `IDENTITY_REQUESTS_PER_MINUTE` | `20` | Per client IP |
| `TRUST_PROXY` | `0` | Set to `1` only behind a trusted proxy such as Fly |
| `MAX_ACTORS` | `512` | Global Rivalis room capacity |
| `MAX_QUEUE` | `200` | Matchmaking queue cap |
| `MAX_LOBBIES` | `100` | Private lobby cap |
| `MAX_MATCHES` | `100` | Active match cap |
| `QUEUE_TTL_SECONDS` | `300` | Stale queue cleanup |
| `LOBBY_TTL_SECONDS` | `900` | Stale lobby cleanup |
| `MATCH_TTL_SECONDS` | `1800` | Stale match cleanup |
| `RECONNECT_GRACE_SECONDS` | `45` | How long a disconnected session and match wait for a fresh-ticket reconnect (5-300) |
| `ACTION_LIMIT` | `12` | Lobby/matchmaking actions per window |
| `ACTION_WINDOW_SECONDS` | `60` | Action rate-limit window |

## Protocol notes

Client join messages are validated for mode, action, ruleset, turn limit, exactly five unique loadout dice, and a six-character lobby code from the client alphabet. They do not carry a display name or player ID. The server takes both from the signed ticket, whose values came from the signed guest cookie.

Turn messages are parsed and checked for turn number, instance/type identity, board bounds, duplicate positions, ownership, and loadout membership. Only the acting player's own dice are accepted. When both players ready up, or when the 30-second timer expires, the server auto-places any remaining dice and resolves combat deterministically.

A disconnected player keeps its session, lobby, and match for `RECONNECT_GRACE_SECONDS`; the client fetches a fresh ticket and resumes with `sendResume` instead of rejoining the queue. The match deadline is extended during the window, and the match ends only after the grace period expires. The `matched` event includes the server battle setup (`match`), and subsequent `arena:turn:state` events carry the canonical state, pips, combat log, result, and next placement deadline. Server combat now resolves the same major skill hooks as local PvE: combat-start mana, pip auras, heal-on-attack, multi-projectile and boosted attacks, on-damaged, on-death, on-kill, on-transformed, combat-end, shields, statuses, summons, and active splash/chain/heatwave effects. The client still only renders server state. During placement the viewer receives only its own dice and pips; the opponent's board is withheld until combat resolves. The server keeps a bounded per-match combat record, includes it in the match setup, and restores it on reconnect. The client starts PvP battles only from that setup; PvE combat remains local. The planned structured combat beat format is in [`COMBAT_AESTHETICS.md`](COMBAT_AESTHETICS.md).

Lobby codes are generated server-side with `crypto.randomInt` and are never accepted from a create request. Lobby joins are rate-limited per client IP in addition to the per-player action limit. A newer authenticated connection for the same ticket replaces the older actor while preserving lobby/match state.

## Verification

```bash
cd server
npm test
```

The test suite covers guest identity signing/expiry/tampering/cookies, ticket binding/expiry/tampering/canonical encoding/single-use consumption, the protocol validators, deterministic combat, auto-placement, placement redaction, rejected-board rollback, skill-hook parity, and turn-limit completion. For deployment verification, run `curl` against `/healthz`, then exercise the identity cookie before `/api/rivalis-ticket` (a ticket request without the cookie must return `401`).
