# Battle Dice — Repository Guide

Phaser 3 + TypeScript browser game (`battle-dice-autoroller`). Client-only: economy
(diamonds, dice tokens, chips, unlocks, achievements, daily rewards, bossfight progress)
lives in `localStorage` plus the Phaser `registry`. There is no server authority for
single-player, so storage integrity is tamper-*evidence*, not a trust boundary.

## Build / verify

- `npm run build` — full pipeline (bundles playtest, runs Vite, cleans launcher assets).
- `npx tsc -p tsconfig.app.json --noEmit` — typecheck.
- `npm audit` — dependency advisories (see note below).
- Dev server: `npm run dev`. Playtest bundle: `npm run bundle:playtest`.

## Security invariants (do not regress)

These were established by a runtime security audit and are load-bearing.

1. **Signed storage envelopes only.** Economy-critical keys
   (`dice:tokens`, `shop:diamonds`, `dice:progress`, `shop:state`, `arena:bossfightProgress`)
   are read/written through `src/utils/SecureStorage.ts`. The `bd2` envelope is signed with
   HMAC-SHA256 keyed by a per-install random secret (`loadInstallSecret`). Never reintroduce
   a shipped/constant salt or a non-keyed checksum; the old `bd1` FNV-1a format is rejected
   on sight, and unsigned plain JSON is dropped, never promoted to a signed save.
2. **Unreadable progress is preserved, not overwritten.** `SecureStorage` copies any
   present-but-unreadable bytes (legacy `bd1` envelope, plain JSON, failed signature) to
   `<key>:recovery` before the slot is dropped or overwritten, for every integrity key.
   Healthy saves must round-trip without loss (no overcorrection).
3. **Dev menu is hard-gated.** `DEV_MENU_AVAILABLE` (`src/utils/BuildFlags.ts`) is
   `requested && BUILD_ENV.PROD !== true`; `DevScene.create()` self-stops when unavailable,
   `main.ts` registers it only when enabled, and `vite.config.ts` refuses to ship a
   non-development build with dev-only flags set. The Dev menu grants unlimited currency
   and dice copies — keep it unreachable in production bundles.
4. **Multiplayer input is sanitized.** `ArenaMultiplayerClient` scheme-validates the
   Rivalis endpoint (`ws://`/`wss://`) and fetches the ticket same-origin; server state is
   passed through `sanitizeServerBattleState` (known instance IDs, turn validation, length
   checks) before use.
5. **No dangerous sinks.** No `eval` / `new Function` / DOM HTML sinks / `postMessage`
   handlers. A strict CSP is set in `index.html`; keep it that way.

## Dependency note

`npm audit` reports low/moderate advisories in dev-only transitive deps pulled in by
`vite-plugin-node-polyfills` (`elliptic`, `crypto-browserify`, `pbkdf2`, `create-ecdh`,
`node-stdlib-browser`). These are **not** present in the shipped client bundle. Prefer
moving polyfill-only deps to `devDependencies`/`overrides` rather than ignoring silently.

## Code style

- No redundant comments; see `.agents/skills/no-comments.md` and
  `.agents/skills/game-dev-best-practices.md`.
- Only comment genuinely non-obvious invariants, workarounds, or Phaser quirks.
