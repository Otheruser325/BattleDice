# Multiplayer Security Audit

Scope: the Battle Dice browser client's Rivalis path, the new `server/` API, ticket flow, matchmaking/lobby lifecycle, and turn-sync boundary.

## Implemented controls

- Guest identities and tickets are HMAC-SHA256 signed, audience-bound, expiring, and validated with `timingSafeEqual`. Base64url payloads and signatures must be canonical, so a modified final base64url character cannot decode to the original bytes. The guest cookie is `HttpOnly`, `Path=/api`, `SameSite=Lax` in development, and `SameSite=None; Secure` in production.
- Tickets bind both the stable guest player ID and the server-owned display name, so clients cannot choose another player's name or identity in a join payload.
- Production requires a `TICKET_SECRET` of at least 32 bytes and explicit `ALLOWED_ORIGINS`.
- Browser clients send the ticket through `Sec-WebSocket-Protocol`; the server uses Rivalis `ticketSource: 'protocol'`. Tickets are consumed exactly once at WebSocket authentication. The client requests a fresh ticket before every reconnect attempt, so a captured or replayed ticket cannot open a second WebSocket.
- The WebSocket transport rejects disallowed origins at the HTTP upgrade and repeats the check in Rivalis. It has a 16 KiB inbound frame cap, heartbeat monitoring, backpressure limits, and a per-actor token bucket.
- Ticket issuance requires an existing signed guest identity and is rate-limited by client IP; Fly's trusted proxy header is used only when `TRUST_PROXY=1`. A ticket request without the cookie returns `401` and does not mint an identity.
- Join payloads are bounded and validated: ruleset, turn limit, exactly five unique dice type IDs, and a six-character lobby code from the client alphabet. They carry no player name or player ID.
- Lobby creation/join and matchmaking have per-player action limits, queue/lobby/match caps, and TTL cleanup.
- The server derives identity from the signed ticket, whose claims come from the signed guest cookie. Join payloads cannot set or override the name or player ID.
- Lobby codes are generated server-side with `crypto.randomInt`; client-supplied create codes are ignored. Join failures use a generic unavailable response and joins are rate-limited per client IP.
- Turn payloads are checked for turn sequence, instance/type identity, board bounds, duplicate positions, ownership, and loadout membership. Only the acting player's own dice are accepted. Board submissions are validated in full and applied only after every die passes, so a rejected board cannot leave partial canonical state.
- Placement snapshots omit the opponent's dice and pips, and omit their class/talent maps, until combat resolves. A ready player's board is not disclosed to the opponent during placement.
- A disconnected player keeps its session and match for a bounded reconnect grace period. The client obtains a fresh ticket before reconnecting; if no reconnect arrives, the server ends the match with a server-derived result and expiry sends a draw rather than leaving the client without a terminal event. The bounded server-side match record is restored on reconnect.
- Duplicate live sessions replace the older actor (`session_replaced`) while preserving lobby/match state; queued profiles are rebound to the new actor.
- HTTP responses set `nosniff`, a restrictive CSP, no-store caching for identity/ticket responses, and exact-origin CORS. Credentials are enabled only for configured origins; no wildcard CORS is used.
- Ticket values are never logged by application code. Rivalis logs ticket fingerprints, not raw tickets.
- The API is pinned to `@rivalis/core@6.0.0` to match the client's `@rivalis/browser@6.0.0`.

## Residual findings

### Medium: combat engine parity

The server runs the deterministic combat engine and the client renders its state, but the two implementations do not yet cover every visual/status detail. The server is authoritative; any client-only approximation must never change HP, attacks, rewards, or the match result. Keep engine changes covered by `server/test/combat.test.mjs`.

### Medium: pseudonymous guest tickets, no account authentication or revocation

Anyone who can reach the identity endpoint can mint a guest identity, and the ticket endpoint will issue a ticket for any valid guest cookie. The guest identity gives that browser a stable player ID and server-owned name, but it is pseudonymous: clearing cookies creates a new identity, and a stolen guest cookie can still mint fresh tickets. Tickets themselves are now single-use and the client rotates them on reconnect, which closes replay of an already-used ticket, but a stolen unused ticket is still a bearer credential until its first use or expiry.

Mitigations are rate limits, exact-origin checks, short ticket TTLs, signed claims, one-time consumption, canonical encoding checks, and secret rotation. If accounts, bans, purchases, or persistent progression become multiplayer-relevant, add authenticated ticket issuance, per-identity revocation, and a server-side identity store.

### Medium: single-process in-memory state

Queues, lobbies, and matches live in one Node process. Running more than one Fly machine would strand players in different instances and split matchmaking. Keep the API at one machine until room placement is centralized.

### Medium: lobby-code enumeration

The six-character alphabet has a large but finite space. Codes are generated server-side, create requests cannot choose a code, joins use a generic unavailable response, and both player actions and client-IP joins are rate-limited. An attacker can still mint multiple guest identities and tickets; add a keyed invite or proof-of-work if lobby scanning appears.

### Medium: duplicate sessions and reconnect

A reconnect uses a freshly issued ticket and replaces the older actor while preserving lobby/match state. The server keeps the session for `RECONNECT_GRACE_SECONDS`, extends the match deadline, and removes abandoned sessions afterward. The old socket is kicked asynchronously; a reconnect during a match preserves the server board and deadline. Replaying the old ticket is rejected because tickets are consumed once. Authenticated accounts and explicit revocation remain future work.

### Low: client-side board presentation

The client submits only its own dice and renders server-confirmed state. During placement it does not receive the opponent's dice, pips, class levels, or talents. Local PvE still uses the client engine; it must never be reused as a PvP authority. The server validates instance IDs, type IDs, ownership, turn, and board placement rather than trusting a claimed battle snapshot.

### Low: display names

Names are capped at 24 printable code points and control characters are rejected by the identity endpoint and ticket service. The name is stored in the signed guest cookie and ticket, not accepted from join payloads. The client renders names through Phaser text, not HTML, so this is not an HTML-injection path. Bidi/format characters other than ASCII controls are still accepted; restrict further if names are shown outside the game.

### Low: client build configuration

`VITE_RIVALIS_*` values are public build-time configuration; no secret is exposed. Production should use `wss://` and `https://`. The server relies on Fly or another reverse proxy for TLS.

## Re-audit checklist before public release

- Keep server-authoritative battle resolution, transactional board validation, and the client's server-confirmed PvP start path covered by tests.
- Verify placement snapshots never include opponent dice, pips, class levels, or talents, and that reconnect restores the server match record.
- Recheck combat-engine parity for every new die, skill, or status effect.
- Add authenticated identity/revocation if multiplayer progression or purchases matter.
- Verify guest-cookie issuance, credentialed CORS, name renaming, ticket-name binding, and the `401` ticket-without-cookie response on the deployed HTTPS origin.
- Load-test ticket issuance, lobby attempts, and WebSocket fan-out.
- Verify exact production origins and CSP after the final client build.
- Confirm Fly remains at one machine or move room state to shared coordination.
- Review dependency advisories and keep the Rivalis browser/core majors aligned.
