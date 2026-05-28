---
name: testing-battle-dice
description: Test Battle Dice UI flows locally with deterministic browser state. Use when verifying login rewards, Shop offers, Arena flows, or other Phaser UI changes.
---

# Battle Dice Testing

## Devin Secrets Needed
- `RIVALIS_ENDPOINT`: Needed only for live Rivalis matchmaking/lobby testing.
- `RIVALIS_TICKET`: Needed only for live Rivalis matchmaking/lobby testing.

Local UI checks for login rewards, Shop offers, dice loadout, and offline Arena flows do not require secrets.

## Local app startup
1. From the repo root, run `npm run dev`.
2. Open the Vite local URL shown in the terminal, usually `http://127.0.0.1:5173/` or the next available port.
3. Prefer local testing over Vercel preview when deterministic browser `localStorage` setup is needed.

## Deterministic browser state setup
- Battle Dice stores profile state in `localStorage['player:profile']`.
- Shop state is stored in `localStorage['shop:state']`.
- Use browser-side setup before recording to seed deterministic state, then perform actual assertions through the UI.
- After seeding state, reload the page and navigate by clicking the visible bottom tabs.

## Login reward checks
- The 7-day login UI is reached from the Arena tab via the `7-DAY LOGIN` tile.
- To verify malformed-order repair, seed `player:profile.loginReward.claimedDays` with a non-contiguous history such as `[5,6]` and a `startDate` at least 6 days ago. The modal should repair to `Claimed: 0/7 days • Next claim: Day 1` and show `Fixed malformed claim order` only for the repaired state.
- To verify fresh-state behavior, seed a profile without `loginReward`. The modal should show `Claimed: 0/7 days • Next claim: Day 1` and should not show `Fixed malformed claim order`.
- To verify same-day gating, claim Day 1 and confirm the status changes to `Next unlock: Day 2 tomorrow`; additional same-day clicks should not advance to Day 2.

## Shop freebie checks
- Generated daily freebies are normally dice-copy offers and should show a rarity suffix in the card header, e.g. `★ DAILY FREEBIE — UNCOMMON`.
- Be careful when trying to seed non-dice/currency freebies: `generateOrGetShopOffers()` may regenerate stored state unless it matches current Shop generation rules. Treat currency-freebie header behavior as source-covered unless a reachable runtime path exists in the current build.

## Reporting
- Record GUI testing and annotate key checks.
- Save screenshots for each pass/fail state and include them in a markdown test report.
- If runtime testing cannot reach a branch, mark it as untested rather than passing it from source inspection alone.
