import type {
  DiceDefinition,
  DiceInstanceState,
  DiceOwnerId,
  MatchBattleState
} from '../types/game';
import { getRuntimeSkillMeta, resolveDamage } from './DiceSkills';
import { getCombatDistance } from './CombatRange';
import { secureChance, securePick } from '../utils/RandomManager';

export type { MatchBattleState };

function makeInstanceId(ownerId: DiceOwnerId, typeId: string, index: number) {
  return `${ownerId}-${typeId}-${index + 1}`;
}

export function createLoadoutInstances(
  ownerId: DiceOwnerId,
  definitions: DiceDefinition[]
): DiceInstanceState[] {
  return definitions.map((definition, index) => ({
    instanceId: makeInstanceId(ownerId, definition.typeId, index),
    typeId: definition.typeId,
    ownerId,
    zone: 'hand',
    maxHealth: definition.health,
    currentHealth: definition.health,
    isDestroyed: false,
    hasFinishedAttacking: true,
    attacksRemaining: 0
  }));
}

export function createMatchBattleState(
  playerDefinitions: DiceDefinition[],
  enemyDefinitions: DiceDefinition[]
): MatchBattleState {
  return {
    turn: 1,
    combatPhase: 'idle',
    reviveCounts: {},
    dice: [
      ...createLoadoutInstances('player', playerDefinitions),
      ...createLoadoutInstances('enemy', enemyDefinitions)
    ]
  };
}

const GRID_LIMIT = 5;
const OWNER_IDS: DiceOwnerId[] = ['player', 'enemy'];
const ZONES: DiceInstanceState['zone'][] = ['hand', 'board', 'eliminated'];

function isOwnerId(value: unknown): value is DiceOwnerId {
  return typeof value === 'string' && (OWNER_IDS as string[]).includes(value);
}

function isZone(value: unknown): value is DiceInstanceState['zone'] {
  return typeof value === 'string' && (ZONES as string[]).includes(value);
}

function sanitizeGridPosition(value: unknown): DiceInstanceState['gridPosition'] {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { row?: unknown; col?: unknown };
  const row = Math.floor(Number(candidate.row));
  const col = Math.floor(Number(candidate.col));
  if (!Number.isInteger(row) || !Number.isInteger(col)) return undefined;
  if (row < 0 || col < 0 || row >= GRID_LIMIT || col >= GRID_LIMIT) return undefined;
  return { row, col };
}

function sanitizeServerDie(value: unknown, knownInstanceIds: Set<string>): DiceInstanceState | null {
  if (!value || typeof value !== 'object') return null;
  const die = value as Partial<DiceInstanceState>;
  if (typeof die.instanceId !== 'string' || !knownInstanceIds.has(die.instanceId)) return null;
  if (typeof die.typeId !== 'string' || die.typeId.length === 0) return null;
  if (!isOwnerId(die.ownerId)) return null;
  if (!isZone(die.zone)) return null;
  if (die.zone === 'board' && sanitizeGridPosition(die.gridPosition) === undefined) return null;

  const maxHealth = Math.max(1, Math.floor(Number(die.maxHealth) || 0));
  const clampedHealth = Math.max(0, Math.min(maxHealth, Math.floor(Number(die.currentHealth) || 0)));
  const isDestroyed = die.isDestroyed === true || clampedHealth === 0;
  const currentHealth = isDestroyed ? 0 : clampedHealth;
  const zone = isDestroyed ? 'eliminated' : die.zone;
  const attacksRemaining = Math.max(0, Math.floor(Number(die.attacksRemaining) || 0));

  return {
    instanceId: die.instanceId,
    typeId: die.typeId as DiceInstanceState['typeId'],
    ownerId: die.ownerId,
    zone,
    maxHealth,
    currentHealth,
    isDestroyed,
    hasFinishedAttacking: die.hasFinishedAttacking === true || attacksRemaining === 0,
    attacksRemaining,
    gridPosition: zone === 'board' ? sanitizeGridPosition(die.gridPosition) : undefined
  };
}

export function sanitizeServerBattleState(value: unknown, current: MatchBattleState): MatchBattleState | null {
  if (!value || typeof value !== 'object') return null;
  const incoming = value as Partial<MatchBattleState>;
  if (!Array.isArray(incoming.dice)) return null;

  const knownInstanceIds = new Set(current.dice.map((die) => die.instanceId));
  const sanitized: DiceInstanceState[] = [];
  for (const entry of incoming.dice) {
    const die = sanitizeServerDie(entry, knownInstanceIds);
    if (!die) return null;
    sanitized.push(die);
  }
  if (sanitized.length !== current.dice.length) return null;

  const turn = Math.floor(Number(incoming.turn));
  if (!Number.isFinite(turn) || turn < 1) return null;

  const combatPhase: MatchBattleState['combatPhase'] =
    incoming.combatPhase === 'attacking' || incoming.combatPhase === 'resolved' ? incoming.combatPhase : 'idle';

  return {
    turn,
    combatPhase,
    dice: sanitized,
    reviveCounts: incoming.reviveCounts && typeof incoming.reviveCounts === 'object' ? { ...incoming.reviveCounts } : current.reviveCounts
  };
}

export function beginCombatPhase(state: MatchBattleState, attacksPerDie = 1): MatchBattleState {
  return {
    ...state,
    combatPhase: 'attacking',
    dice: state.dice.map((die) => (
      die.zone === 'board' && !die.isDestroyed
        ? {
            ...die,
            hasFinishedAttacking: true,
            attacksRemaining: attacksPerDie
          }
        : die
    ))
  };
}

export function spendAttack(state: MatchBattleState, instanceId: string): MatchBattleState {
  return {
    ...state,
    dice: state.dice.map((die) => {
      if (die.instanceId !== instanceId || die.isDestroyed || die.zone !== 'board') {
        return die;
      }

      const attacksRemaining = Math.max(0, die.attacksRemaining - 1);
      return {
        ...die,
        attacksRemaining,
        hasFinishedAttacking: attacksRemaining === 0
      };
    })
  };
}

export function applyDamage(state: MatchBattleState, instanceId: string, damage: number): MatchBattleState {
  return {
    ...state,
    dice: state.dice.map((die) => {
      if (die.instanceId !== instanceId || die.isDestroyed) {
        return die;
      }

      const currentHealth = Math.max(0, die.currentHealth - damage);
      const isDestroyed = currentHealth === 0;

      return {
        ...die,
        currentHealth,
        isDestroyed,
        zone: isDestroyed ? 'eliminated' : die.zone,
        attacksRemaining: isDestroyed ? 0 : die.attacksRemaining,
        hasFinishedAttacking: isDestroyed ? true : die.hasFinishedAttacking,
        gridPosition: isDestroyed ? undefined : die.gridPosition
      };
    })
  };
}

export function placeDieOnBoard(
  state: MatchBattleState,
  instanceId: string,
  row: number,
  col: number
): MatchBattleState {
  return {
    ...state,
    dice: state.dice.map((die) => (
      die.instanceId === instanceId && !die.isDestroyed
        ? {
            ...die,
            zone: 'board',
            gridPosition: { row, col }
          }
        : die
    ))
  };
}

export function resolveCombatPhase(state: MatchBattleState): MatchBattleState {
  const allBoardDiceFinished = state.dice
    .filter((die) => die.zone === 'board' && !die.isDestroyed)
    .every((die) => die.hasFinishedAttacking);

  if (!allBoardDiceFinished) {
    return state;
  }

  return {
    ...state,
    combatPhase: 'resolved',
    dice: state.dice.map((die) => (
      die.zone === 'board' && !die.isDestroyed
        ? {
            ...die,
            zone: 'hand',
            gridPosition: undefined,
            attacksRemaining: 0
          }
        : die
    ))
  };
}

export function getAvailableHandDice(state: MatchBattleState, ownerId: DiceOwnerId): DiceInstanceState[] {
  return state.dice.filter((die) => (
    die.ownerId === ownerId &&
    die.zone === 'hand' &&
    !die.isDestroyed
  ));
}

export function getBoardDice(state: MatchBattleState, ownerId: DiceOwnerId): DiceInstanceState[] {
  return state.dice.filter((die) => (
    die.ownerId === ownerId &&
    die.zone === 'board' &&
    !die.isDestroyed
  ));
}

export function getLivingDiceCount(state: MatchBattleState, ownerId: DiceOwnerId): number {
  return state.dice.filter((die) => die.ownerId === ownerId && !die.isDestroyed).length;
}

function hasOtherLivingDie(state: MatchBattleState, ownerId: DiceOwnerId, instanceId: string): boolean {
  return state.dice.some((die) =>
    die.ownerId === ownerId &&
    die.instanceId !== instanceId &&
    !die.isDestroyed &&
    (die.zone === 'board' || die.zone === 'hand')
  );
}

export function endTurn(state: MatchBattleState): MatchBattleState {
  return {
    ...state,
    turn: state.turn + 1,
    combatPhase: 'idle'
  };
}

export function getNextAttacker(state: MatchBattleState, ownerId: DiceOwnerId): DiceInstanceState | undefined {
  const boardDice = state.dice
    .filter((die): die is DiceInstanceState & { gridPosition: { row: number; col: number } } =>
      die.ownerId === ownerId &&
      die.zone === 'board' &&
      !die.isDestroyed &&
      !die.hasFinishedAttacking &&
      die.attacksRemaining > 0 &&
      die.gridPosition !== undefined
    )
    .sort((a, b) => b.gridPosition.row - a.gridPosition.row);

  return boardDice[0];
}

export function findAttackTarget(
  state: MatchBattleState,
  attacker: DiceInstanceState,
  definitions: Map<string, DiceDefinition>
): DiceInstanceState | undefined {
  const enemyId = attacker.ownerId === 'player' ? 'enemy' : 'player';

  const enemyDice = state.dice
    .filter((die): die is DiceInstanceState & { gridPosition: { row: number; col: number } } =>
      die.ownerId === enemyId &&
      die.zone === 'board' &&
      !die.isDestroyed &&
      die.gridPosition !== undefined
    );

  if (enemyDice.length === 0) return undefined;

  const attackerDef = definitions.get(attacker.typeId);
  if (!attackerDef) return undefined;

  if (!attacker.gridPosition) return undefined;
  const mode = getRuntimeSkillMeta(attackerDef).targetingMode ?? 'Nearest';

  const reachable = enemyDice
    .map((die) => ({ die, distance: getCombatDistance(attacker, die) }))
    .filter(({ distance }) => distance <= Math.max(1, attackerDef.range));

  if (reachable.length === 0) return undefined;

  const sortedByDistance = [...reachable].sort((a, b) => a.distance - b.distance || a.die.gridPosition.row - b.die.gridPosition.row || a.die.gridPosition.col - b.die.gridPosition.col);
  if (mode === 'Nearest') return sortedByDistance[0]?.die;
  if (mode === 'Furthest') return sortedByDistance[sortedByDistance.length - 1]?.die;

  if (mode === 'Strongest') {
    return [...reachable]
      .sort((a, b) => b.die.currentHealth - a.die.currentHealth || b.die.maxHealth - a.die.maxHealth || a.distance - b.distance)[0]?.die;
  }
  if (mode === 'Weakest') {
    return [...reachable]
      .sort((a, b) => a.die.currentHealth - b.die.currentHealth || a.die.maxHealth - b.die.maxHealth || a.distance - b.distance)[0]?.die;
  }
  if (mode === 'Random') return securePick(reachable)?.die;
  return sortedByDistance[0]?.die;
}

export function executeAttack(
  state: MatchBattleState,
  attackerId: string,
  targetId: string,
  definitions: Map<string, DiceDefinition>,
  definitionOverrides?: { attacker?: DiceDefinition; target?: DiceDefinition }
): { newState: MatchBattleState; damage: number; targetDestroyed: boolean } {
  const attacker = state.dice.find((die) => die.instanceId === attackerId);
  const target = state.dice.find((die) => die.instanceId === targetId);

  if (!attacker || !target) {
    return { newState: state, damage: 0, targetDestroyed: false };
  }

  const damage = resolveDamage(
    attacker,
    target,
    definitions,
    definitionOverrides?.attacker
  );
  const targetPosition = target.gridPosition;

  let newState = spendAttack(state, attackerId);
  newState = applyDamage(newState, targetId, damage);

  let updatedTarget = newState.dice.find((die) => die.instanceId === targetId);
  const targetDefinition = definitionOverrides?.target ?? definitions.get(target.typeId);
  const runtimeMeta = targetDefinition ? getRuntimeSkillMeta(targetDefinition) : undefined;
  const previousRevives = state.reviveCounts?.[targetId] ?? 0;
  const reviveChance = runtimeMeta?.reviveChance === undefined
    ? undefined
    : Math.max(0, Math.min(1, runtimeMeta.reviveChance * Math.pow(runtimeMeta.reviveChanceRate ?? 1, previousRevives)));
  const hasOtherLiving = hasOtherLivingDie(state, target.ownerId, targetId);
  const canRevive = Boolean(
    reviveChance !== undefined
    && (runtimeMeta?.maxRevives === undefined || previousRevives < runtimeMeta.maxRevives)
    && (!runtimeMeta.dontReviveWhenLastOneStanding || hasOtherLiving)
  );
  if (updatedTarget?.isDestroyed && canRevive && secureChance(reviveChance!)) {
    newState = {
      ...newState,
      reviveCounts: { ...state.reviveCounts, [targetId]: previousRevives + 1 },
      dice: newState.dice.map((die) => (
        die.instanceId === targetId
          ? {
              ...die,
              isDestroyed: false,
              zone: 'board',
              currentHealth: die.maxHealth,
              attacksRemaining: target.attacksRemaining,
              hasFinishedAttacking: target.hasFinishedAttacking,
              gridPosition: targetPosition
            }
          : die
      ))
    };
    updatedTarget = newState.dice.find((die) => die.instanceId === targetId);
  }

  return {
    newState,
    damage,
    targetDestroyed: updatedTarget?.isDestroyed ?? false
  };
}
