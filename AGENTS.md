# AGENTS.md

Repository-specific guidance for Battle Dice. See `.agents/skills/` for the full code style and testing skills.

## Comment policy

Code comments are reserved for **major** code changes only — for example a new system, a non-obvious invariant, a Phaser 3 workaround, or a deliberate trade-off that is not evident from the code.

Do **not** add comments for minor changes such as a simple bugfix, a small tweak, a rename, or a value/flag change. Self-documenting names and structure are the default; when in doubt, leave the comment out. This is a standing instruction from the maintainer and applies to every future session.

## Talent skill descriptions

- A talent records all of its metadata on the single `talents[].modifiers` object. There is no separate `talents[].skills` array and no `modifiers.skillModifiers`: the per-skill overlay lives at `talents[].modifiers.skills` (an array of `DiceSkillDefinition`-shaped entries, matched to base skills by index). Keeping stats on one object avoids ambiguous metadata updates.
- `DiceSkillDefinition.descriptionLocked` marks a skill whose authored description must be shown verbatim; class scaling and dynamic recomputation skip it.
- `applyDiceTalent` bakes recomputed descriptions onto the skills so both the DiceScene card and the info-panel/modal paths show the same text.
- A talent removes a base skill only through the per-skill overlay form (`talents[].modifiers.skills[i].disableSkill`). The former talent-root `talents[].disableSkill` (boolean / index / index array) was removed so a talent cannot disable arbitrary skills it does not explicitly overlay. The overlay form is what Time's Temporal Delusion uses to retire Temporal Acceleration.
- `talents[].comingSoon` marks a single talent as a work-in-progress. Coming-soon talents are excluded from `getAcquirableTalentIndices` (so shops and chests never offer them), cannot be equipped, and report the `coming-soon` reason in `getUnobtainableTalentReason`.

## Talent acquisition and loadout randomisation

- Talents are obtained only through shop offers and Diamond/Master chests. The talents popup in DiceScene equips owned talents and reports unowned ones as `UNOWNED`; it never grants a talent. Do not reintroduce a popup purchase path with `grantTalent`/`setDiceTokens`.
- `getOwnedTalentIndices` lists the owned, non-coming-soon talents for a die. Randomise loadout/class-up uses it so a random loadout equips a random owned talent regardless of the die's stored equipped talent. The chosen index is stamped into `instanceTalentIndices` so `getCombatBaseDefinition` and the in-battle info panel resolve the same talent for that instance instead of re-reading the profile's equipped index.

## Combat log defeat entries

- A die's destruction is reported by one dedicated `writeDefeatLog` entry (`"<owner>'s <die> was defeated!"`), emitted from `applyDamageDefeatHooks` only after the die is confirmed still destroyed (so a revive does not log a defeat). Individual damage entries must not append `DESTROYED`/`(defeated)` labels.

## Multi-projectile attacks

- `spendBasicAttack` returns the projectile count for the attack (from `basicAttacksPerAttackByInstance`, i.e. `1 + attackCountIncrease`). The basic-attack branch in `runCombatLoop` loops that many times so each projectile re-applies damage with `source: attacker`. On-damaged effects (Armor Dice's Heavy Plating), passive hooks, and defeat hooks therefore resolve once per projectile, not once per attack action.
- Keep `source: attacker` on every projectile's `applyDamageWithRevive` call. Omitting it makes on-damaged effects fall back to treating the victim as its own attacker.
- The Druidic Essence heal branch (`healOnAttack`) must mirror the damage branch: call `spendBasicAttack` once, loop `applyBasicHeal` per projectile, and accumulate `basicAttackHitCount` so the combat log appends "N times" for multi-projectile heals. Do not replace this with a single `applyBasicHeal` plus `spendAttack`.
- `applyBasicHeal` must accumulate the actual amount `healDie` reports (crit-doubled, capped at missing health) rather than recomputing `baseAmount * targetCount`; the latter drops the critical double from both the returned total and the log line. `healDie` owns the critical roll, so callers report `healResult.healed` and `healResult.critical`.
- The basic-attack heal log is generic (`"<owner> <die> heals <target> for N health!"`), matching the damage line's shape. Do not hardcode a skill name (the old `uses Druidic Essence` text assumed Druid and misreported every other `healOnAttack` source).
- The info popup separates the two effects: `attackCountIncrease` (via `basicAttacksPerAttackByInstance`) is shown as its own `Projectile Count +/-` line and is excluded from the `Attack Count` total, because the stored `count` is `1 + attackCountIncrease` (Wind's Gale Tempo reads as "Projectile Count +1", not an attack count). Do not fold the projectile delta back into the attack-count sum.

## Skill mana metadata

- A skill's mana cost is authored on the skill root (`skills[].manaNeeded`), alongside `type`/`title`/`description`, not inside `modifiers`. `modifiers` carries only behaviour flags and stats, so keeping `manaNeeded` there made the mana cost look like a modifier and hid it from the skill-shaped view. `DiceSkillModifier` no longer declares `manaNeeded`; the overlay/transform merge no longer has to lift it out of `modifiers`.
- `DiceSkillRuntimeMeta.manaNeeded` reports the selected Active skill's cost (0 when no Active skill is selected). The old `activeManaNeeded`/`activeAllyExtraAttacks` names were removed; `allyExtraAttacks` is die-wide and `grantAttacksToAlly` is the single-ally grant.

## Skill overlay and transform rows

- Talent overlays (`talents[].modifiers.skills`) and transform rows (`transformStats[].skills`) share one convention: an empty object `{}` at an index means "leave this base skill unmodified", an entry that declares `type` is a full replacement, and an entry without `type` overlays onto the base skill (root fields shallow-merged, `modifiers` deep-merged). This is what lets Light's talent and Transcendence's transform target one skill without restating the rest. `mergeSkillsByIndex` and `mergeSkillOverlayByIndex` both skip empty entries.

## Attack grants

- `allyExtraAttacks` is a die-wide CombatStart aura: `collectCombatStartAuras` folds it into the pip/attack-count bonus for every other friendly die. `grantAttacksToAlly` is a one-ally grant: it must not also feed the aura collection, or the recipient receives the bonus twice. `executeCombatStartSkillEffects` sets `result.grantAttacksToAlly` and the ArenaScene CombatStart branch resolves one recipient.
- `selectAllyAttackRecipient` targets a random other ally by default and is distance-independent; it only uses a specific mode when the granting skill sets `skillTargeting`. Resolution order is the explicit caller mode, then the granting skill's `skillTargeting`, then `Random`. Never default to the die's `targetingMode` — that made "random ally" buffs follow the caster's own attack targeting.
- `foeExtraAttacks` (die-wide aura) and `grantAttacksToFoe` (one-foe grant) mirror the ally fields as a downside for the caster's own side. `foeExtraAttacks` folds into `computeCombatStartFoeBonus`, which adds the opposing side's CombatStart aura to this die's pip/attack count at combat start; `grantAttacksToFoe` resolves one opposing recipient through `grantFoeAttacks`/`selectFoeAttackRecipient` (same resolution order as the ally variant, but candidates are the opposing side).
- `applyAllyExtraAttacks`/`applyFoeExtraAttacks` resolve both fields for every non-CombatStart trigger (OnDamaged, OnKill, OnDeath, OnTransformed, Passive, Active, CombatEnd) so any of them can hand out attacks. The ally helper still routes its total onto `bonusAttacks` + `grantAttacksToAlly`; the foe helper sets only `grantAttacksToFoe`, so a foe-only skill does not add attacks to the caster. CombatStart uses `applyCombatStartGrants` instead because its auras are collected die-wide rather than granted to one recipient.

## Healing criticals

- `healDie` owns the critical roll (`applyCriticalHealing`) and returns the actual healed amount (crit-doubled, clamped to missing health). Every heal path should route through it so a critical doubles the heal; a caller that recomputes the base amount silently loses the double. The Fountain of Love combat-end heal applies `applyCriticalHealing` directly because it writes health in a bulk map, and must keep using `critHeal.amount`.

## attackCountIncrease resolution

- `attackCountIncrease` is a die-wide attack multiplier. `getRuntimeSkillMeta` resolves it as the maximum positive value across every skill modifier that can drive an attack (Active, Passive, OnDamaged, ...), not just the selected Active skill or `skills[0]`. A talent may relocate the property onto a different skill, and Wind's Mighty Wind raises it above Gale Tempo's base value.
- Non-finite or non-positive `attackCountIncrease` values are ignored, so a malformed value falls back to `0` (one projectile) instead of producing `NaN` projectile counts.
- `skillRangeThreshold` gates **every** modifier the skill carries, not just `attackCountIncrease`. `isRangeThresholdSatisfied` treats it as "the target must be within `effectiveRange - threshold`", and `gateMetaByRangeThreshold` strips the gated fields (`attackCountIncrease`, `criticalChanceIncrease`, `criticalDamageIncrease`, and the four attack-grant fields) when out of range. Resolve the gate from the triggering skill's meta (`getRuntimeSkillMetaForTrigger`) so a whole-die lookup cannot leak an in-range bonus — Leon's Furious Claw only grants its 25% crit within 2 tiles of the target.

## Chain targeting

- `chainTargets` counts the **total** chain victims, including the first link. `getChainJumpTargetsForArena` converts it with `maxExtraJumps = max(0, limit - 1)`; `-1` (`CHAIN_NO_TARGET_CAP`) means unlimited. Getting this wrong makes a `chainTargets: 1` skill hit two victims.
- `findChainJumpTargetForArena` prefers foes sharing the primary target's row, and only widens to column/diagonal neighbours when the row has none. Candidates are bounded by Chebyshev distance (`chainRange`) on the same board side and exclude already-hit dice.

## Shield durations

- `shieldDurationTurnsByInstance` holds the remaining turns for a duration shield; `shieldHpByInstance` holds the absorb pool. A shield with a duration survives combat start so Shield Dice's 2-turn Bulwark covers the current and the following turn; `expireUntimedShields` clears only duration-less shields (Armor's on-damaged plating) at combat start. `applyTimedSkillDecay` owns expiry for the timed ones.
- The in-combat info panel appends the remaining turns to the shield line so players can see how long the shield lasts.

## Stat multiplier hardening

- Use `resolveStatMultiplier`, `resolveStatValue`, `scaleStatValue`, and `applyStatModifiers` from `src/systems/ClassProgression.ts` for any attack/health math driven by definition or talent metadata. They coerce `NaN`/`Infinity` to safe defaults so malformed special stats (especially on transformed dice) cannot drop through.
