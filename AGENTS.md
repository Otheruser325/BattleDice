# AGENTS.md

Repository-specific guidance for Battle Dice. See `.agents/skills/` for the full code style and testing skills.

## Comment policy

Code comments are reserved for **major** code changes only — for example a new system, a non-obvious invariant, a Phaser 3 workaround, or a deliberate trade-off that is not evident from the code.

Do **not** add comments for minor changes such as a simple bugfix, a small tweak, a rename, or a value/flag change. Self-documenting names and structure are the default; when in doubt, leave the comment out. This is a standing instruction from the maintainer and applies to every future session.

## Talent skill descriptions

- A talent records all of its metadata on the single `talents[].modifiers` object. There is no separate `talents[].skills` array and no `modifiers.skillModifiers`: the per-skill overlay lives at `talents[].modifiers.skills` (an array of `DiceSkillDefinition`-shaped entries, matched to base skills by index). Keeping stats on one object avoids ambiguous metadata updates.
- `DiceSkillDefinition.descriptionLocked` marks a skill whose authored description must be shown verbatim; class scaling and dynamic recomputation skip it.
- `applyDiceTalent` bakes recomputed descriptions onto the skills so both the DiceScene card and the info-panel/modal paths show the same text.
- A talent can remove a base skill either at the talent root (`talents[].disableSkill`, a boolean / index / index array) or per skill inside the overlay (`talents[].modifiers.skills[i].disableSkill`). Both are resolved in `applyDiceTalent` and dropped from the final skill list. The overlay form is what Time's Temporal Delusion uses to retire Temporal Acceleration.
- `talents[].comingSoon` marks a single talent as a work-in-progress. Coming-soon talents are excluded from `getAcquirableTalentIndices` (so shops and chests never offer them), cannot be equipped, and report the `coming-soon` reason in `getUnobtainableTalentReason`.

## Multi-projectile attacks

- `spendBasicAttack` returns the projectile count for the attack (from `basicAttacksPerAttackByInstance`, i.e. `1 + attackCountIncrease`). The basic-attack branch in `runCombatLoop` loops that many times so each projectile re-applies damage with `source: attacker`. On-damaged effects (Armor Dice's Heavy Plating), passive hooks, and defeat hooks therefore resolve once per projectile, not once per attack action.
- Keep `source: attacker` on every projectile's `applyDamageWithRevive` call. Omitting it makes on-damaged effects fall back to treating the victim as its own attacker.
- The Druidic Essence heal branch (`healOnAttack`) must mirror the damage branch: call `spendBasicAttack` once, loop `applyBasicHeal` per projectile, and accumulate `basicAttackHitCount` so the combat log appends "N times" for multi-projectile heals. Do not replace this with a single `applyBasicHeal` plus `spendAttack`.

## attackCountIncrease resolution

- `attackCountIncrease` is a die-wide attack multiplier. `getRuntimeSkillMeta` resolves it as the maximum positive value across every skill modifier that can drive an attack (Active, Passive, OnDamaged, ...), not just the selected Active skill or `skills[0]`. A talent may relocate the property onto a different skill, and Wind's Mighty Wind raises it above Gale Tempo's base value.
- Non-finite or non-positive `attackCountIncrease` values are ignored, so a malformed value falls back to `0` (one projectile) instead of producing `NaN` projectile counts.

## Chain targeting

- `chainTargets` counts the **total** chain victims, including the first link. `getChainJumpTargetsForArena` converts it with `maxExtraJumps = max(0, limit - 1)`; `-1` (`CHAIN_NO_TARGET_CAP`) means unlimited. Getting this wrong makes a `chainTargets: 1` skill hit two victims.
- `findChainJumpTargetForArena` prefers foes sharing the primary target's row, and only widens to column/diagonal neighbours when the row has none. Candidates are bounded by Chebyshev distance (`chainRange`) on the same board side and exclude already-hit dice.

## Shield durations

- `shieldDurationTurnsByInstance` holds the remaining turns for a duration shield; `shieldHpByInstance` holds the absorb pool. A shield with a duration survives combat start so Shield Dice's 2-turn Bulwark covers the current and the following turn; `expireUntimedShields` clears only duration-less shields (Armor's on-damaged plating) at combat start. `applyTimedSkillDecay` owns expiry for the timed ones.
- The in-combat info panel appends the remaining turns to the shield line so players can see how long the shield lasts.

## Stat multiplier hardening

- Use `resolveStatMultiplier`, `resolveStatValue`, `scaleStatValue`, and `applyStatModifiers` from `src/systems/ClassProgression.ts` for any attack/health math driven by definition or talent metadata. They coerce `NaN`/`Infinity` to safe defaults so malformed special stats (especially on transformed dice) cannot drop through.
