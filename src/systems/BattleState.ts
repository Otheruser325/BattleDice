import type {
  DiceDefinition,
  DiceInstanceState,
  DiceOwnerId,
  MatchBattleState
} from '../types/game';

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
    hasFinishedAttacking: false,
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
    dice: [
      ...createLoadoutInstances('player', playerDefinitions),
      ...createLoadoutInstances('enemy', enemyDefinitions)
    ]
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
            hasFinishedAttacking: false,
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

  const sameColumnTargets = enemyDice.filter((die) => die.gridPosition.col === attacker.gridPosition!.col);
  if (sameColumnTargets.length > 0) {
    return sameColumnTargets.sort((a, b) => a.gridPosition.row - b.gridPosition.row)[0];
  }

  const adjacentColumns = [attacker.gridPosition!.col - 1, attacker.gridPosition!.col + 1].filter((c) => c >= 0 && c < 5);
  const adjacentTargets = enemyDice.filter((die) => adjacentColumns.includes(die.gridPosition.col));
  if (adjacentTargets.length > 0) {
    return adjacentTargets.sort((a, b) => a.gridPosition.row - b.gridPosition.row)[0];
  }

  return enemyDice.sort((a, b) => a.gridPosition.row - b.gridPosition.row)[0];
}

export function executeAttack(
  state: MatchBattleState,
  attackerId: string,
  targetId: string,
  definitions: Map<string, DiceDefinition>
): { newState: MatchBattleState; damage: number; targetDestroyed: boolean } {
  const attacker = state.dice.find((die) => die.instanceId === attackerId);
  const target = state.dice.find((die) => die.instanceId === targetId);

  if (!attacker || !target) {
    return { newState: state, damage: 0, targetDestroyed: false };
  }

  const attackerDef = definitions.get(attacker.typeId);
  const damage = attackerDef?.attack ?? 10;

  let newState = spendAttack(state, attackerId);
  newState = applyDamage(newState, targetId, damage);

  let updatedTarget = newState.dice.find((die) => die.instanceId === targetId);
  if (updatedTarget?.isDestroyed && updatedTarget.typeId === 'Skull' && Math.random() < 0.5) {
    newState = {
      ...newState,
      dice: newState.dice.map((die) => (
        die.instanceId === targetId
          ? {
              ...die,
              isDestroyed: false,
              zone: 'board',
              currentHealth: Math.max(1, Math.floor(die.maxHealth * 0.5))
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
