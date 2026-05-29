# Battle Dice Autoroller

Turn-based strategy autochess with dice vs. dice combat!

## Multiplayer configuration

Arena matchmaking and friend lobbies use the Rivalis WebSocket client. Configure these Vite variables in local `.env` files or in the deployment environment to enable live multiplayer and disable the local lobby preview fallback:

```bash
VITE_RIVALIS_WS_URL=wss://your-rivalis-server.example/ws
VITE_RIVALIS_TICKET=your-rivalis-ticket
VITE_RIVALIS_TICKET_SOURCE=protocol
VITE_RIVALIS_RECONNECT_MAX=4
```

A template is available in `.env.example`; copy it to `.env.local` for local development and replace the placeholder endpoint and ticket with the values from your Rivalis server.

For GitHub Pages deployments, set these repository configuration values before running the deploy workflow:

- Repository variable `VITE_RIVALIS_WS_URL`: the `ws://` or `wss://` Rivalis endpoint.
- Repository secret `VITE_RIVALIS_TICKET`: the client ticket passed to Rivalis. Prefer short-lived or otherwise public-safe tickets because Vite embeds `VITE_*` values into the browser bundle.
- Repository variable `VITE_RIVALIS_TICKET_SOURCE`: `protocol` when the server accepts `Sec-WebSocket-Protocol` tickets; `query` only for local/back-compat servers.
- Repository variable `VITE_RIVALIS_RECONNECT_MAX`: reconnect attempt count, defaulting to `4` when omitted.

Queued matchmaking always sends Classic mode, 10 turns, Random Mode off, and the player's current loadout. Friend lobbies support Create/Join by 6-character code plus the creator's lobby settings.
