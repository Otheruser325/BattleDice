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
| `VITE_RIVALIS_RECONNECT_MAX` | app runtime | Positive integer reconnect attempts before giving up (default `4`). |
| `VITE_BASE_PATH` | build config | Sub-path the app is served from, e.g. `/BattleDice/`. Overridden by `REPO_FIX`. |
| `REPO_FIX` | build config | Explicit base path override; takes precedence over `VITE_BASE_PATH` and `GITHUB_REPOSITORY`. |
| `GITHUB_REPOSITORY` | build config | `owner/repo`; the repo name is used as the base path when nothing else is set. |
| `BATTLE_DICE_BUILD_MODE` | launcher bundle | Overrides the bundle `MODE`; set to `development` for a dev playtest bundle. |
| `BATTLE_DICE_SOURCEMAP` | launcher bundle | Set to `1` to emit `main.js.map` for the production launcher bundle. |

Rivalis tickets are sent as the WebSocket subprotocol (`Sec-WebSocket-Protocol`), not as a URL query parameter. The Rivalis server must accept the ticket there.

`VITE_ENABLE_DEV_MENU` and `VITE_DEBUG_LOGS` are the only dev-only flags. They are refused by
production builds (`npm run build`, `npm run bundle:playtest`, `npm run preview:launcher`). To use
them locally, run `npm run dev` or `npm run dev:launcher`, which build in development mode.

## Packaging safety

Launcher playtest artifacts are generated at the repository root for compatibility with the launcher shell, but they are ignored by Git and npm package dry-runs so local playtesting does not accidentally duplicate large generated assets in a package.
