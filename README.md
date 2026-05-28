# Battle Dice Autoroller

Turn-based strategy autochess with dice vs. dice combat!

## Multiplayer configuration

Arena matchmaking and friend lobbies use the Rivalis WebSocket client. Configure these Vite variables in the deployment environment to enable live multiplayer and disable the local lobby preview fallback:

```bash
VITE_RIVALIS_WS_URL=wss://your-rivalis-server.example/ws
VITE_RIVALIS_TICKET=your-rivalis-ticket
VITE_RIVALIS_TICKET_SOURCE=protocol
VITE_RIVALIS_RECONNECT_MAX=4
```

Queued matchmaking always sends Classic mode, 10 turns, Random Mode off, and the player's current loadout. Friend lobbies support Create/Join by 6-character code plus the creator's lobby settings.
