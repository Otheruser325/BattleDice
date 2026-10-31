# Server Combat Presentation Design

## Goal

Make server-authoritative PvP combat *feel* like the local PvE combat without moving combat authority to the browser.

The combat engine resolves a turn synchronously and deterministically. The presentation layer turns its semantic events into a short, ordered replay that the client can render with the same visual language it already uses for PvE: turn banners, dice attack sounds, floating damage numbers, critical hits, healing pulses, status feedback, defeat effects, and 350–500 ms beats.

The server remains the only source of boards, HP, pips, statuses, turn limits, and outcomes. A beat is a rendering hint, never an instruction that can change state.

## Current gap

The engine already emits `CombatEvent` records with useful metadata:

```ts
interface CombatEvent {
  kind: 'round' | 'attack' | 'damage' | 'heal' | 'shield' | 'status' | 'defeat' | 'revive' | 'skill' | 'summon' | 'info';
  text: string;
  ownerId?: 'player' | 'enemy';
  sourceId?: string;
  targetId?: string;
  amount?: number;
  critical?: boolean;
}
```

`ArenaRoom` currently sends only `events: string[]`, so the client can write log lines but cannot synchronize visuals with the server's state changes. Local PvE instead drives `showDamageText`, attack SFX, projectiles, banners, and `delayCombatPaced(350–500)` directly from its engine.

## Design principles

1. **Resolve once, replay after.** Do not put sleeps or timers in the combat engine. Resolution stays deterministic and returns immediately. Presentation is derived from the finished event list.
2. **Viewer-relative beats.** Each player receives the same canonical sequence mirrored to their own side. The existing board state uses `toClientState(..., selfOwner)`; beats must use the same mirroring rule.
3. **Semantic effects, not client commands.** The server says `projectile`, `impact`, `heal`, or `defeat`; the client chooses which Phaser tween, texture, and `AudioManager` key implements it. The server never sends a function name, texture key, or audio key.
4. **Text is a fallback, state is canonical.** Every beat has the existing human-readable `text` for logs and accessibility. The final `state`, `pips`, `result`, and `deadlineAt` remain the authority even if a client drops or skips a beat.
5. **Bounded work.** Cap beats per turn and cap replay time. A client that is late must catch up rather than fall further behind the server deadline.

## Wire contract

Add a `presentation` object to the resolved turn event. Keep `events: string[]` for compatibility during migration.

```ts
type ViewerSide = 'self' | 'opponent';

interface BeatEntity {
  side: ViewerSide;
  instanceId: string;
  typeId: string;
  title: string;
  accent: string;                 // sanitized #rrggbb from the catalog, or the default accent
  gridPosition?: { row: number; col: number }; // already mirrored for this viewer
}

interface EntitySnapshot {
  instanceId: string;
  hp: number;
  maxHp: number;
  shield: number;
  zone: 'hand' | 'board' | 'eliminated';
  isDestroyed: boolean;
}

interface CombatBeat {
  id: string;                     // stable: `${turn}:${sequence}`
  sequence: number;               // 1-based within this turn
  kind: CombatEvent['kind'];
  motion:
    | 'none'
    | 'strike'
    | 'projectile'
    | 'impact'
    | 'heal'
    | 'shield'
    | 'status'
    | 'defeat'
    | 'revive'
    | 'summon';
  text: string;
  actor: BeatEntity | null;
  target: BeatEntity | null;
  amount?: number;
  absorbed?: number;
  critical?: boolean;
  accent: string;
  durationMs: number;             // suggested replay duration, usually 300–500
  before?: EntitySnapshot;
  after?: EntitySnapshot;
}

interface CombatPresentation {
  version: 1;
  matchId: string;
  turn: number;
  beats: CombatBeat[];
  totalDurationMs: number;
}
```

`presentation` is additive. Older clients continue to read `events`. New clients use `beats` when `version === 1`, and fall back to the log for unknown versions.

### Why snapshots

The final state may already show a die at zero HP or in `eliminated`, so replaying damage against only the final state loses the intermediate health bar and defeat moment. Each damage, heal, shield, revive, and defeat beat carries the target's before/after values captured while the engine resolves. That lets the client animate the same transitions the PvE engine produces.

`before`/`after` are presentation snapshots, not a second authoritative state. If a client's local state diverges, the client must reconcile to the final `state` after replay.

## Event projection

`ArenaRoom` should build the presentation from the canonical `CombatEvent[]` after `resolveCombat`:

1. Assign `sequence` in event order.
2. Resolve `sourceId`/`targetId` against the pre-resolution and post-resolution dice maps so eliminated dice still produce entities.
3. Fill `title` and `accent` from the catalog definitions, including transformed definitions.
4. Capture `before`/`after` snapshots for events that change HP, shield, zone, or destruction.
5. Map canonical `ownerId` to `self`/`opponent` for the recipient and mirror `gridPosition.col` for the opponent.
6. Coalesce and order only for presentation:
   - A `damage` followed by an `attack` for the same source/target becomes `strike` (motion) followed by `impact` (damage number).
   - Keep the original `text` unchanged.
   - Do not drop `defeat`, `revive`, `summon`, `round`, or result beats.
7. Cap the list (for example 120 beats) and stop adding non-critical beats after the cap. The final state and result are never truncated.

The engine should eventually emit attack/damage pairs in presentation order, but the projection layer is enough for the first version and avoids changing combat math.

## Client mapping

The client's `CombatPresentationPlayer` consumes beats with a queue. It must not request a new turn until the queue is drained or the server deadline requires catch-up.

| Beat | Motion | Client presentation | Existing hook |
| --- | --- | --- | --- |
| `round` | none | `TURN n` banner, round chime | `playTurnBanner`, `AUDIO_KEYS.uiRound` |
| `attack` | strike/projectile | Die lunges or projectile travels from actor to target; attack SFX | `playAttackSfx`, projectile tweens |
| `damage` | impact | Floating number, target flash/shake | `showDamageText`; normal `#ffdf7a`, critical `#ff3333`, armor-shred `#ff4fd8` |
| `heal` | heal | Green number and pulse/beam | `showDamageText('#6abf69')`, `AnimationManager.animateHealingPulse` |
| `shield` | shield | Blue shield ring and value | `AnimationManager.animateBatteryCharge` or shield tween |
| `status` | status | Status chip/pulse and log line | `AnimationManager.animateElementalSkill` by damage type |
| `defeat` | defeat | Fade/shatter, death sound | `AUDIO_KEYS.diceDie`, existing defeat tween |
| `revive` | revive | Skull/rune pulse, restored HP | `AnimationManager.animateSkullRevive` |
| `summon` | summon | Entry flash at the summoned position | `AnimationManager.animateTransform` |
| `skill` | status | Elemental accent pulse or beam | `AnimationManager.animateElementalSkill` |
| `info` | none | Log only | `writeCombatLog` |

The existing palette and pacing are the reference:

- normal damage `#ffdf7a`, critical `#ff3333`, armor shred `#ff4fd8`, heal `#6abf69`;
- basic attacks use `diceAttack01/02/03`, skills use `skillTrigger`, defeat uses `diceDie`;
- ordinary beats 350–500 ms, multi-hit or status beats roughly 120–300 ms;
- when the server deadline is close, run the same queue with a 2× pacing multiplier, matching `getCombatPacingMultiplier`.

`accent` is display data and must be validated as a six-digit hex color before Phaser uses it. Do not pass arbitrary strings into shader or texture APIs.

## Mirroring

Canonical engine side | Viewer side 0 | Viewer side 1
--- | --- | ---
`player` | `self` | `opponent`
`enemy` | `opponent` | `self`

For the viewer whose `selfOwner` is `enemy`:

```ts
side = canonicalOwner === selfOwner ? 'self' : 'opponent';
col = GRID_SIZE - 1 - canonicalCol; // same horizontal mirror used by toClientState
```

Beat entity positions and the final state must use the same mirror. Otherwise an attack visually starts on the wrong side of the board.

## Replay and deadline rules

- The server never waits for animation. It sends the resolved state and presentation together.
- `totalDurationMs` is a hint, not a deadline extension.
- The client may start replay immediately, then accelerate if `deadlineAt - Date.now()` is shorter than the remaining queue.
- On tab hide or reconnect, skip to the final state rather than replaying stale beats.
- If a beat references an unknown instance, render its text and continue. Never throw away the final state.
- The server result and `deadlineAt` win over anything the replay is showing.

## Example

```json
{
  "version": 1,
  "matchId": "m_...",
  "turn": 4,
  "beats": [
    {
      "id": "4:1",
      "sequence": 1,
      "kind": "round",
      "motion": "none",
      "text": "Round 4 begins.",
      "actor": null,
      "target": null,
      "accent": "#ffcf7a",
      "durationMs": 500
    },
    {
      "id": "4:2",
      "sequence": 2,
      "kind": "attack",
      "motion": "projectile",
      "text": "Emberling attacks Frostguard for 12 damage.",
      "actor": { "side": "self", "instanceId": "a-1", "typeId": "Fire", "title": "Emberling", "accent": "#ff7a35", "gridPosition": { "row": 2, "col": 1 } },
      "target": { "side": "opponent", "instanceId": "b-1", "typeId": "Ice", "title": "Frostguard", "accent": "#6fb7ff", "gridPosition": { "row": 2, "col": 3 } },
      "amount": 12,
      "accent": "#ff7a35",
      "durationMs": 350
    },
    {
      "id": "4:3",
      "sequence": 3,
      "kind": "damage",
      "motion": "impact",
      "text": "Frostguard takes 12 damage.",
      "actor": null,
      "target": { "side": "opponent", "instanceId": "b-1", "typeId": "Ice", "title": "Frostguard", "accent": "#6fb7ff", "gridPosition": { "row": 2, "col": 3 } },
      "amount": 12,
      "before": { "instanceId": "b-1", "hp": 30, "maxHp": 30, "shield": 0, "zone": "board", "isDestroyed": false },
      "after": { "instanceId": "b-1", "hp": 18, "maxHp": 30, "shield": 0, "zone": "board", "isDestroyed": false },
      "accent": "#6fb7ff",
      "durationMs": 350
    }
  ],
  "totalDurationMs": 1200
}
```

## Rollout plan

1. Add the `CombatPresentation`/`CombatBeat` types and a pure projection function in `server/src/combat/presentation.ts`.
2. Include `presentation` in `TurnEvent` while keeping `events: string[]`.
3. Add the client replay queue behind a feature flag; default to the text log until visual parity is verified.
4. Move attack/damage ordering and multi-hit grouping into the engine/projection tests.
5. Keep deterministic combat tests unchanged; add snapshot, mirroring, stable-ID, and replay-drain tests.

## Out of scope

- Moving any combat math, RNG, or status resolution into the browser.
- Server-side animation timers or per-beat WebSocket messages.
- Sending Phaser/audio asset keys from the server.
- Using presentation snapshots as an alternate authority.
