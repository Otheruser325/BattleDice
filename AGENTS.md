# AGENTS.md

Repository-specific guidance for Battle Dice. See `.agents/skills/` for the full code style and testing skills.

## Comment policy

Code comments are reserved for **major** code changes only — for example a new system, a non-obvious invariant, a Phaser 3 workaround, or a deliberate trade-off that is not evident from the code.

Do **not** add comments for minor changes such as a simple bugfix, a small tweak, a rename, or a value/flag change. Self-documenting names and structure are the default; when in doubt, leave the comment out. This is a standing instruction from the maintainer and applies to every future session.

## Talent skill descriptions

- A talent records all of its metadata on the single `talents[].modifiers` object. There is no separate `talents[].skills` array and no `modifiers.skillModifiers`: the per-skill overlay lives at `talents[].modifiers.skills` (an array of `DiceSkillDefinition`-shaped entries, matched to base skills by index). Keeping stats on one object avoids ambiguous metadata updates.
- `DiceSkillDefinition.descriptionLocked` marks a skill whose authored description must be shown verbatim; class scaling and dynamic recomputation skip it.
- `applyDiceTalent` bakes recomputed descriptions onto the skills so both the DiceScene card and the info-panel/modal paths show the same text.
- `talents[].comingSoon` marks a single talent as a work-in-progress. Coming-soon talents are excluded from `getAcquirableTalentIndices` (so shops and chests never offer them), cannot be equipped, and report the `coming-soon` reason in `getUnobtainableTalentReason`.

## Multi-projectile attacks

- `spendBasicAttack` returns the projectile count for the attack (from `basicAttacksPerAttackByInstance`, i.e. `1 + attackCountIncrease`). The basic-attack branch in `runCombatLoop` loops that many times so each projectile re-applies damage with `source: attacker`. On-damaged effects (Armor Dice's Heavy Plating), passive hooks, and defeat hooks therefore resolve once per projectile, not once per attack action.
- Keep `source: attacker` on every projectile's `applyDamageWithRevive` call. Omitting it makes on-damaged effects fall back to treating the victim as its own attacker.

## Stat multiplier hardening

- Use `resolveStatMultiplier`, `resolveStatValue`, `scaleStatValue`, and `applyStatModifiers` from `src/systems/ClassProgression.ts` for any attack/health math driven by definition or talent metadata. They coerce `NaN`/`Infinity` to safe defaults so malformed special stats (especially on transformed dice) cannot drop through.
