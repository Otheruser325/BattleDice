import Phaser from 'phaser';
import { canReceiveUsefulCopies, getActiveLoadoutSlot, getAllDiceDefinitions, getDiceDefinitions, getDiceProgress, getDiceTokens, getDiamonds, getExclusiveDiceDefinitions, getOwnedTalentIndices, getRangeLabel, getRemainingUsefulCopies, grantDiceCopies, LOADOUT_SLOT_COUNT, RARITY_TEXT_COLORS, setActiveLoadoutSlot, setDiceTokens, setDiamonds } from '../data/dice';
import {
  createMatchBattleState,
  getAvailableHandDice,
  placeDieOnBoard,
  getBoardDice,
  getLivingDiceCount,
  getTerminalBattleOwner,
  executeAttack,
  applyDamage,
  spendAttack,
  resolveCombatPhase,
  endTurn,
  sanitizeServerBattleState,
  type MatchBattleState
} from '../systems/BattleState';
import { DebugManager } from '../utils/DebugManager';
import { AlertManager } from '../utils/AlertManager';
import { PALETTE, getLayout } from '../ui/theme';
import type { DiceTypeId, DiceInstanceState, DiceDefinition, DiceTargetingMode, DicePoolInstance, DiceSkillType } from '../types/game';
import { buildSkillIndex } from '../data/SkillLoader';
import { CHAIN_NO_TARGET_CAP, getChainTargetLimit, getRuntimeSkillMeta, getRuntimeSkillMetaForTrigger, getValidSkillDefinitions, getStatusEffectDuration, getStatusEffectDurationFromModifiers, getSkillLockClass, getPipMappedRate, resolvePipScaledDamage, resolveScopeShotDamage, addScopeStack, gateMetaByRangeThreshold, isRangeThresholdSatisfied, getNuclearAreaDimensions } from '../systems/DiceSkills';
import { clampDamageReduction, combineDamageReduction, CombatSkillOrchestrator, formatCombatSkillLabel, formatCombatSkillTypeLabel, formatActiveSkillActionLabel, formatCombatHealingActionLabel, formatRicochetAggregationLabel, formatCombatAmount, executeOnDamagedSkillEffects, executeOnDeathSkillEffects, executeOnKillSkillEffects, executeOnTransformedSkillEffects, executeCombatStartSkillEffects, executeCombatEndSkillEffects, executePassiveSkillEffects, executeActiveSkillEffects, executeRevengeSkillEffects, resolvePlagueSpawn, resolveReviveStats, resolveHealingFeedback, applySkillDamageModifiers, getCombatStartManaEffect, getCombatStartTauntEffect, getInfiltratorSkillEffect, chooseInfiltratorPlacement, canSkillStrikeFirst, getBasicAttackProjectileCount, getExecutionRhythmBoost, collectCombatStartAuras, computeCombatStartBonus, computeCombatStartFoeBonus, resolveCombatEndHealAmount, resolveMaxHealthGainCurrentHealth, type CombatFlowContext, type CombatFlowPhase } from '../systems/CombatSkills';
import { getClassMultiplier, getBossClassMultiplier, applyClassProgression, applyStatModifiers, applyTransformStats, getClassScaledSkillDescription, resolvePoolDamage, resolveStatMultiplier, resolveStatValue, type SkillDescriptionContext } from '../systems/ClassProgression';
import { getPoolDefinition, getPoolDefinitions } from '../data/pools';
import { getCoveredEnemyColumns, getFootprintAdjustedRange, isWithinGridRadius } from '../systems/CombatRange';
import { SCENE_KEYS } from './sceneKeys';
import { CasinoProgressStore } from '../systems/CasinoProgressStore';
import { AUDIO_KEYS, AudioManager } from '../utils/AudioManager';
import { AnimationManager } from '../utils/AnimationManager';
import { canOfferDiceCards, getDiceCardInfo, getDiceCardRarityRoll, getDiceCardRuntimeContribution, normalizeDiceCardCarryover, resolveDiceCardMaxHealth, rollDiceCards, type DiceCard } from '../systems/DiceCards';
import { DUNGEON_IGNITION_DURATION, applyDungeonCardStats, resolveIgnitionDamage, canShuffleDungeonCards, createDungeonCardState, ensureDungeonScopeMarks, getDungeonCardDamageMultiplier, getDungeonCardEffects, getDungeonCardKey, getDungeonCardKillsRequired, getDungeonCardPresentation, getDungeonCardShuffleCost, getDungeonCardStackCount, isDungeonCardUniqueDraw, normalizeDungeonCardState, pickDungeonCard, registerDungeonCardKills, removeDungeonCardHealth, resolveDungeonCardHealthAdjustment, resolveDungeonCarryoverAttack, resolveDungeonCarryoverHealth, rollDungeonCardChoices, type DungeonCard, type DungeonCardEffects, type DungeonCardState } from '../systems/DungeonCards';
import { ProfileStore } from '../systems/ProfileStore';
import { CalendarStore, LOGIN_REWARD_DAYS, LOGIN_REWARD_TOTAL_DAYS } from '../systems/CalendarStore';
import { TransformState } from '../systems/TransformState';
import { AchievementStore } from '../systems/AchievementStore';
import { BOSSFIGHT_BOSSES, BOSSFIGHT_BOSS_METADATA, claimBossfightReward, completeBossfightLevel, getBossfightHighestUnlockedLevel, getBossfightMenuState, getBossfightProgress, getBossfightRewards, getBossMusicKey, saveBossfightMenuState, type BossfightBossType } from '../systems/BossStore';
import { ArenaMultiplayerClient, type ArenaMultiplayerCombatEvent, type ArenaMultiplayerMatchSetup } from '../systems/ArenaMultiplayerClient';
import { MultiplayerStore, normalizeLobbyCode } from '../systems/MultiplayerStore';
import { SingleplayerStore, type BotDifficulty } from '../systems/SingleplayerStore';
import { formatSkillInfo, getDiceAlternateFormLabel, getDiceModalDisplayDefinition, getNextDiceFormIndex } from './DiceScene';
import { applyDiceTalent, areTalentsSuppressedForChallenge } from '../systems/DiceTalents';
import { getEquippedTalentIndex } from '../data/dice';
import { isSkillListComingSoon } from '../systems/SkillOverlay';
import { formatCompact, formatPercent } from '../utils/FormatManager';
import { secureChance, securePick, secureRandom, secureRandomBetween } from '../utils/RandomManager';
import { DUNGEON_DAILY_TICKETS, DUNGEON_MAX_WAVES, DUNGEON_REWARD_WAVES, canGrantDungeonCopyAmount, canUseDungeonCards, getDungeonDifficulty, getDungeonEliteDieSides, getDungeonEliteSkillMultiplier, getDungeonEnemyCriticalChance, getDungeonModifier, getDungeonMusicEffects, getDungeonNextWaveTurn, getDungeonStageReward, getDungeonSpeedMultiplier, getDungeonWaveSpec, normalizeDungeonCopyAmount, createDungeonSeededRng, pickDungeonCopyTypeId, pickDungeonEnemyTypeIds, rollDungeonSeededInt, resolveDungeonCarryoverInstanceIds, resolveDungeonWaveLoadout, type DungeonBossMinionType, type DungeonBossRole, type DungeonBossType, type DungeonCarryover, type DungeonCarryoverDie, type DungeonCarryoverEnemyDie, type DungeonCarryoverStatuses, type DungeonConfigSnapshot, type DungeonLoadoutEntry, type DungeonModifier, type DungeonRewardPart, type DungeonStageReward } from '../systems/DungeonEvent';
import { STATUS_EFFECT_VISUALS, StatusEffectStore, type StatusEffectApplication, type StatusEffectHooks, type StatusEffectTick } from '../systems/StatusEffects';
import { getDungeonIntroForWave } from '../systems/DungeonIntros';
import { getDungeonQuitRewardWave, getDungeonResultTransition } from '../systems/DungeonRunFlow';
import { getHardDailyEnemyClassLevel } from '../systems/DailyChallenges';
import { CHALLENGE_RANDOM_MODIFIERS, canChallengeBeMarkedFailed, getChallengeClaimKey, getChallengeEnemyConfig, getChallengeRandomModifier, getChallengeReward, getChallengeStartConfig, getChallengeStatus, getChallengeStatusLabel, getChallengeUIConfig, getDailyChallengeKey, getDailyLoadoutMode, getDailySeededIndex, getDailySeededRange, getDailyTopProfileDice, getDailyUsesRandomClassUps, hasChallengeRewardClaimed, isHardDaily, markChallengeRewardClaimed, setChallengeStatus, type ChallengeKey, type ChallengeMode } from '../systems/ChallengeStore';
import { applyDungeonCardSpendRefund, beginDungeonCardSpend, clearDungeonCardSpend, clearDungeonRun, consumeDungeonTicket, discardDungeonRunCache, getDungeonCardSpend, getDungeonDevState, getDungeonEventWindowForScene, getDungeonProgress, getDungeonRun, markDungeonCardSpendDebited, recordDungeonBestWave, saveDungeonRun } from '../systems/DungeonStore';
import { COMBAT_TIME_LIMIT_MS, getCombatTimeSpeedMultiplier, scaleAnimationDuration } from '../systems/CombatPacing';
import { formatTurnWaveLabel, getDicePreviewScrollMetrics } from '../systems/ArenaHud';


type MatchResultStage = 'victory' | 'defeat' | 'draw';
type RandomModeModifier = DungeonModifier;
interface TranscendenceBeamPattern {
  rowStep: number;
  colStep: number;
}

interface GamePhase {
  stage: 'lobby' | 'placement' | 'combat' | 'resolved' | MatchResultStage;
}

interface DiceStatusPreviewView {
  content: Phaser.GameObjects.Container;
  mask: Phaser.GameObjects.Graphics;
  left: number;
  top: number;
  width: number;
  viewportTop: number;
  viewportHeight: number;
  rowHeight: number;
  maxScroll: number;
  scrollOffset: number;
}

interface TranscendenceBeamLine {
  target: DiceInstanceState;
  pattern: TranscendenceBeamPattern;
}

const GRID_SIZE = 5;
const TILE_SIZE = 64;
const TILE_GAP = 8;
const MATCH_TOKEN_REWARDS: Record<MatchResultStage, number> = { victory: 500, defeat: 50, draw: 200 };

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return Math.abs(count) === 1 ? singular : plural;
}

function countNoun(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatCompact(count)} ${countLabel(count, singular, plural)}`;
}
const SWEATY_MATCH_MS = 10 * 60 * 1000;
const DUNGEON_OPEN_MODAL_KEY = 'arena:dungeonOpenModal';
const DICE_RARITY_RANK: Record<string, number> = { Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4, Mythic: 5 };

export class ArenaScene extends Phaser.Scene {
  static readonly KEY = SCENE_KEYS.Arena;
  private readonly debug = DebugManager.attachScene(ArenaScene.KEY);
  private readonly combatOrchestrator = new CombatSkillOrchestrator(this.debug);

  private gameState!: MatchBattleState;
  private definitions!: Map<DiceTypeId, DiceDefinition>;
  private skillIndex: ReturnType<typeof buildSkillIndex> = new Map();
  private gamePhase: GamePhase = { stage: 'lobby' };

  private uiContainer!: Phaser.GameObjects.Container;
  private gameContainer!: Phaser.GameObjects.Container;
  private backButton!: Phaser.GameObjects.Text;
  private exitPromptOpen = false;
  private exitPromptElements: Phaser.GameObjects.GameObject[] = [];
  private turnText!: Phaser.GameObjects.Text;
  private playerGridContainer!: Phaser.GameObjects.Container;
  private enemyGridContainer!: Phaser.GameObjects.Container;
  private enemyFogOverlay!: Phaser.GameObjects.Rectangle;
  private enemyFogText!: Phaser.GameObjects.Text;
  private playerStatusPanel!: Phaser.GameObjects.Container;
  private enemyStatusPanel!: Phaser.GameObjects.Container;
  private dicePreviewViews: Partial<Record<'player' | 'enemy', DiceStatusPreviewView>> = {};
  private dicePreviewWheelHandler: ((pointer: Phaser.Input.Pointer, gameObjects: Phaser.GameObjects.GameObject[], dx: number, dy: number) => void) | null = null;
  private combatLog!: Phaser.GameObjects.Text;
  private combatLogPanel!: Phaser.GameObjects.Rectangle;
  private combatLogHistory: string[] = [];
  private combatLogMatchId: number = 0;
  private combatLogHistoryClearedForMatchId: number = -1;
  private displayNameReplacements: Array<{ pattern: RegExp; replacement: string }> = [];
  private nativeCombatLogSetText?: (value: string | string[]) => Phaser.GameObjects.Text;
  private combatHistoryButton!: Phaser.GameObjects.Text;
  private combatActionDetails: string[] = [];
  private startCombatButton!: Phaser.GameObjects.Rectangle;
  private handContainer!: Phaser.GameObjects.Container;
  private handDice: Map<string, Phaser.GameObjects.Container> = new Map();
  private placedDiceCount = 0;
  private gridDropZones: Phaser.GameObjects.Rectangle[] = [];
  private dicePips: Map<string, number> = new Map();
  private enemyDicePips: Map<string, number> = new Map();
  private enemyClassLevels: Map<string, number> = new Map();
  private manaByInstance: Map<string, number> = new Map();
  private manaFilledTurnBySlot: Map<string, number> = new Map();
  private playerManaChargedAccrued = 0;
  private activeManaByInstance: Map<string, Map<string, number>> = new Map();
  private shieldHpByInstance: Map<string, number> = new Map();
  private shieldDamageTextByInstance: Map<string, number> = new Map();
  private shieldDurationTurnsByInstance: Map<string, number> = new Map();
  private readonly statusEffects = new StatusEffectStore();
  private attackCapacityByInstance: Map<string, number> = new Map();
  private extraAttackTurnsByInstance: Map<string, { extra: number; turns: number }> = new Map();
  private attackMultiplierTurnsByInstance: Map<string, { multiplier: number; turns: number }> = new Map();
  private basicAttacksPerAttackByInstance: Map<string, { count: number; turns: number }> = new Map();
  private combatAttackCountDeltaByInstance: Map<string, number> = new Map();
  private combatAttackCountPositiveDeltaByInstance: Map<string, number> = new Map();
  private combatAttackCountNegativeDeltaByInstance: Map<string, number> = new Map();
  private grantedAttackCountByInstance: Map<string, number> = new Map();
  private attackCountEffectSeenByInstance: Map<string, { positive: boolean; negative: boolean }> = new Map();
  private attackCountFeedbackByInstance: Map<string, {
    gain?: { amount: number; text: string };
    loss?: { amount: number; text: string };
  }> = new Map();
  private manaPausedTurnsByInstance: Map<string, number> = new Map();
  private combanityAttackMultiplierByInstance: Map<string, { multiplier: number; turns: number }> = new Map();
  private combanityBonusByOwner: Record<'player' | 'enemy', { multiplier: number; reduction: number; label: string }> = {
    player: { multiplier: 1, reduction: 0, label: 'Classic' },
    enemy: { multiplier: 1, reduction: 0, label: 'Classic' }
  };
  private damageReductionByInstance: Map<string, number> = new Map();
  private criticalDamageTextByInstance: Set<string> = new Set();
  private readonly transforms = new TransformState({
    getDefinitionForInstance: (die) => this.getDefinitionForInstance(die),
    getBaseDefinitionForInstance: (die) => this.getBaseDefinitionForInstance(die),
    getCombatBaseDefinition: (die) => this.getCombatBaseDefinition(die),
    getClassLevel: (instanceId) => this.instanceClassLevels.get(instanceId) ?? 1,
    applyDungeonCardDefinitionForOwner: (definition, ownerId, classLevel) => this.applyDungeonCardDefinitionForOwner(definition, ownerId, classLevel),
    getDiceCardMaxHealthForDefinition: (definition, ownerId) => this.getDiceCardMaxHealthForDefinition(definition, ownerId),
    getTransformDurationBonus: (die) => this.getDungeonCardEffectsForDie(die)?.transformDurationBonus ?? 0,
    getDie: (instanceId) => this.gameState.dice.find((die) => die.instanceId === instanceId),
    updateDie: (instanceId, update) => {
      this.gameState = {
        ...this.gameState,
        dice: this.gameState.dice.map((die) => die.instanceId === instanceId ? update(die) : die)
      };
      return this.gameState.dice.find((die) => die.instanceId === instanceId);
    },
    setDefinitionOverride: (instanceId, definition) => this.instanceDefinitionOverrides.set(instanceId, definition),
    resetActiveMana: (instanceId) => this.resetActiveMana(instanceId),
    writeCombatLog: (message) => this.writeCombatLog(message),
    applyOnTransformedSkillEffects: (die) => { void this.applyOnTransformedSkillEffects(die); },
    animateTransformEffect: (die) => this.animateTransformEffect(die),
    getCombatDieName: (die) => this.getCombatDieName(die)
  });
  private rollAllButton!: Phaser.GameObjects.Rectangle;
  private rollAllButtonLabel!: Phaser.GameObjects.Text;
  private rollHelperText!: Phaser.GameObjects.Text;
  private diceRolled = false;
  private currentHandOrder: string[] = [];
  private poolsByTile: Map<string, DicePoolInstance> = new Map();
  private deathAlliesDefeatedCount: Map<string, number> = new Map();
  private reviveCountByInstance: Map<string, number> = new Map();
  private basicAttackDamageBonusByInstance: Map<string, number> = new Map();
  private instanceDefinitionOverrides: Map<string, DiceDefinition> = new Map();
  private nuclearUsedByInstance: Set<string> = new Set();
  private instanceClassLevels: Map<string, number> = new Map();
  private instanceTalentIndices: Map<string, number | null> = new Map();
  private enemyLoadoutRevealed = false;
  private sessionStartedAtMs = 0;
  private matchStartedAtMs = 0;
  private infiltratedBoardSideByInstance: Map<string, 'player' | 'enemy'> = new Map();
  private chainedByInstance: Map<string, string> = new Map();
  private hitDuringAttackAction: Set<string> = new Set();
  private persistentLockSourceIds: Set<string> = new Set();
  private lockTurnsByInstance: Map<string, number> = new Map();
  private lockUnlockEffectByInstance: Map<string, { effect: StatusEffectApplication['effect']; duration: number; delta?: number }> = new Map();
  private gridLockTurnsByOwner: Record<'player' | 'enemy', Map<string, number>> = { player: new Map(), enemy: new Map() };
  private gridLockOverlays: Phaser.GameObjects.GameObject[] = [];
  private pendingHandDisorientation: Array<{ sourceInstanceId: string; turns: number }> = [];
  private retainedLockPositions: Map<string, { row: number; col: number }> = new Map();
  private retainedLockedDice: Set<string> = new Set();
  private rangeHighlightObjects: Phaser.GameObjects.GameObject[] = [];
  private highlightedRangeInstanceId: string | null = null;
  private soulDiceSoulsConjured: Map<string, number> = new Map();
  private scopeStacksByInstance: Map<string, number> = new Map();
  private growthDeltaByInstance: Map<string, number> = new Map();
  private defeatEventIdByInstance: Map<string, number> = new Map();
  private processedDefeatEventIds: Set<number> = new Set();
  private nextDefeatEventId = 0;
  private modalContainer: Phaser.GameObjects.Container | null = null;
  private modalEscHandler: (() => void) | null = null;
  private modalWheelHandler: ((pointer: Phaser.Input.Pointer, gameObjects: Phaser.GameObjects.GameObject[], dx: number, dy: number) => void) | null = null;
  private historyModalView: {
    content: Phaser.GameObjects.Container;
    footer: Phaser.GameObjects.Text;
    jumpButton: Phaser.GameObjects.Text;
    mask: Phaser.GameObjects.Rectangle;
    contentTop: number;
    viewportHeight: number;
    viewportWidth: number;
    maxScroll: number;
    scrollOffset: number;
    pendingBelowFold: number;
    wasNearBottom: boolean;
    rootContainer: Phaser.GameObjects.Container;
  } | null = null;
  private dieInfoPopup: Phaser.GameObjects.Container | null = null;
  private dieInfoPopupTimer: Phaser.Time.TimerEvent | null = null;
  private dieInfoPopupInstanceId: string | null = null;
  private readonly singleplayer = new SingleplayerStore();
  private activeChallenge: ChallengeKey = null;
  private dailyHard = false;
  private turnLimit: number = -1;
  private activeRandomModifier: RandomModeModifier | null = null;
  private activeDailyKey = '';
  private combatTimeRemainingMs = COMBAT_TIME_LIMIT_MS;
  private combatCountdownTriggered = false;
  private combatTimerText: Phaser.GameObjects.Text | null = null;
  private berserkTriggeredInstances: Set<string> = new Set();
  private activeDiceCardKeys: Set<string> = new Set();
  private activeDiceCards: DiceCard[] = [];
  private multiplayerDiceCardKey: string | null = null;
  private multiplayerDiceCardOfferSignature = '';
  private multiplayerDiceCardDraftOpen = false;
  private diceTypeUpgradeBonus: Map<string, number> = new Map();
  private spotlightByInstance: Map<string, { mult: number; reduction: number }> = new Map();
  private diceCardInfoContainer?: Phaser.GameObjects.Container;
  private manaPotionGainByOwner: Record<'player' | 'enemy', number> = { player: 0, enemy: 0 };
  private fountainHealRateByOwner: Record<'player' | 'enemy', number> = { player: 0, enemy: 0 };
  private giantHunterRateByOwner: Record<'player' | 'enemy', number> = { player: 0, enemy: 0 };
  private activeDiceCardKeysByOwner: Record<'player' | 'enemy', Set<string>> = { player: new Set(), enemy: new Set() };
  private oddInvestmentByOwner: Record<'player' | 'enemy', { damage: number; reduction: number }> = { player: { damage: 0, reduction: 0 }, enemy: { damage: 0, reduction: 0 } };
  private evenInvestmentByOwner: Record<'player' | 'enemy', { damage: number; reduction: number }> = { player: { damage: 0, reduction: 0 }, enemy: { damage: 0, reduction: 0 } };
  private fireSupportByOwner: Record<'player' | 'enemy', number> = { player: 0, enemy: 0 };
  private vanguardReductionByOwner: Record<'player' | 'enemy', number> = { player: 0, enemy: 0 };
  private centrelineDamageByOwner: Record<'player' | 'enemy', number> = { player: 0, enemy: 0 };
  private straightFaceRateByOwner: Record<'player' | 'enemy', number> = { player: 0, enemy: 0 };
  private royalObedienceRateByOwner: Record<'player' | 'enemy', number> = { player: 0, enemy: 0 };
  private crowdAttackByOwner: Record<'player' | 'enemy', { damage: number; reduction: number }> = { player: { damage: 0, reduction: 0 }, enemy: { damage: 0, reduction: 0 } };
  private assassinBoostAttacksByInstance: Map<string, number> = new Map();
  private specialSkillAttackDepth = 0;
  private diceCardPicksUsed = 0;
  private readonly multiplayerClient = new ArenaMultiplayerClient();
  private readonly multiplayer = new MultiplayerStore(this.multiplayerClient);
  private playerDisplayName = 'Player';
  private enemyDisplayName = 'Opponent';
  private deuciferBossPending = false;
  private deuciferBossSummoned = false;
  private summonedByInstance: Map<string, string> = new Map();
  private bossfightLevel = 1;
  private bossfightCurrentBoss: BossfightBossType = 'Magician';
  private bossfightMenuBoss: BossfightBossType = 'Magician';
  private bossfightMenuLevel = 1;
  private bossfightMenuLevels: Record<BossfightBossType, number> = { Magician: 1, Leon: 1, Basilisk: 1, Silence: 1 };
  private bossfightBossDefeatedThisTurn = false;
  private bossfightPendingReward: { boss: BossfightBossType; level: number } | null = null;
  private dungeonWave = 1;
  private dungeonBoss: DungeonBossType | null = null;
  private dungeonBossRole: DungeonBossRole | null = null;
  private dungeonBossMinionType: DungeonBossMinionType | null = null;
  private dungeonEnemyClasses: number[] = [];
  private dungeonEventKey = '';
  private dungeonModifier: DungeonModifier = 'Classic';
  private dungeonRunActive = false;
  private dungeonResultContainer: Phaser.GameObjects.Container | null = null;
  private dungeonConfigSnapshot: DungeonConfigSnapshot | null = null;
  private dungeonCarryover: DungeonCarryover | null = null;
  private dungeonEnemyCarryover: DungeonCarryoverEnemyDie[] | null = null;
  private dungeonLoadoutSnapshot: DungeonLoadoutEntry[] | null = null;
  private dungeonCardState: DungeonCardState = createDungeonCardState();
  private dungeonScopeMarkers: Phaser.GameObjects.GameObject[] = [];
  private dungeonCardOrbitObjects: Phaser.GameObjects.Container[] = [];
  private dungeonSaveWarningShown = false;
  private dungeonVictoryPending = false;
  private readonly escapeKeyHandler = () => this.toggleExitPrompt();
  private readonly combatLogKeyHandler = () => this.openCombatLogHistoryModal();
  private healingWaitByInstance: Set<string> = new Set();
  private healingRetryReadyByInstance: Set<string> = new Set();
  private avoidChanceIgnoredTargetByInstance: Map<string, string> = new Map();
  private reverseUsesByInstance: Map<string, number> = new Map();
  private reverseLastUsedTurnByInstance: Map<string, number> = new Map();
  private reverseCooldownUntilTurnByInstance: Map<string, number> = new Map();
  private multiplayerCountdownEvent: Phaser.Time.TimerEvent | null = null;
  private multiplayerTimerText: Phaser.GameObjects.Text | null = null;
  private multiplayerLobbyCodeText: Phaser.GameObjects.Text | null = null;
  private activePostCombatDragProxy: Phaser.GameObjects.Container | null = null;

  private get configDifficulty(): BotDifficulty {
    return this.singleplayer.difficulty;
  }

  private set configDifficulty(value: BotDifficulty) {
    this.singleplayer.difficulty = value;
  }

  private get configUseLevelling(): boolean {
    return this.singleplayer.useLevelling;
  }

  private set configUseLevelling(value: boolean) {
    this.singleplayer.useLevelling = value;
  }

  private get configRandomMode(): boolean {
    return this.singleplayer.randomMode;
  }

  private set configRandomMode(value: boolean) {
    this.singleplayer.randomMode = value;
  }

  private get randomModeActive(): boolean {
    return this.isMultiplayerMatch ? Boolean(this.multiplayerMatch?.rules.randomMode) : this.configRandomMode;
  }

  private get configRandomizeLoadoutAndClassUps(): boolean {
    return this.singleplayer.randomizeLoadoutAndClassUps;
  }

  private set configRandomizeLoadoutAndClassUps(value: boolean) {
    this.singleplayer.randomizeLoadoutAndClassUps = value;
  }

  private get configTurnCount(): number {
    return this.singleplayer.turnCount;
  }

  private set configTurnCount(value: number) {
    this.singleplayer.turnCount = value;
  }

  private get multiplayerMatch(): ArenaMultiplayerMatchSetup | null {
    return this.multiplayer.match;
  }

  private get isMultiplayerMatch(): boolean {
    return this.multiplayer.isActive;
  }

  private get multiplayerReady(): boolean {
    return this.multiplayer.ready;
  }

  private set multiplayerReady(value: boolean) {
    this.multiplayer.setReady(value);
  }

  private get multiplayerSubmitting(): boolean {
    return this.multiplayer.submitting;
  }

  private set multiplayerSubmitting(value: boolean) {
    this.multiplayer.setSubmitting(value);
  }

  private get multiplayerDeadlineAt(): number {
    return this.multiplayer.deadlineAt;
  }

  private set multiplayerDeadlineAt(value: number) {
    this.multiplayer.setDeadline(value);
  }

  constructor() {
    super(ArenaScene.KEY);
  }

  private resetRuntimeState() {
    this.gamePhase = { stage: 'lobby' };
    this.exitPromptOpen = false;
    this.exitPromptElements = [];
    this.releaseDicePreviewWheelHandler();
    this.destroyDicePreviewViews();
    this.handContainer?.destroy(true);
    this.handDice.clear();
    this.placedDiceCount = 0;
    this.gridDropZones = [];
    this.dicePips.clear();
    this.enemyDicePips.clear();
    this.enemyClassLevels.clear();
    this.manaByInstance.clear();
    this.manaFilledTurnBySlot.clear();
    this.activeManaByInstance.clear();
    this.shieldHpByInstance.clear();
    this.shieldDamageTextByInstance.clear();
    this.shieldDurationTurnsByInstance.clear();
    this.statusEffects.clear();
    this.extraAttackTurnsByInstance.clear();
    this.attackMultiplierTurnsByInstance.clear();
    this.basicAttacksPerAttackByInstance.clear();
    this.combatAttackCountDeltaByInstance.clear();
    this.combatAttackCountPositiveDeltaByInstance.clear();
    this.combatAttackCountNegativeDeltaByInstance.clear();
    this.grantedAttackCountByInstance.clear();
    this.attackCountEffectSeenByInstance.clear();
    this.attackCountFeedbackByInstance.clear();
    this.nuclearUsedByInstance.clear();
    this.manaPausedTurnsByInstance.clear();
    this.combanityAttackMultiplierByInstance.clear();
    this.combanityBonusByOwner = {
      player: { multiplier: 1, reduction: 0, label: 'Classic' },
      enemy: { multiplier: 1, reduction: 0, label: 'Classic' }
    };
    this.damageReductionByInstance.clear();
    this.diceRolled = false;
    this.currentHandOrder = [];
    this.activeRandomModifier = null;
    this.transforms.reset();
    this.poolsByTile.clear();
    this.deuciferBossPending = false;
    this.deuciferBossSummoned = false;
    this.summonedByInstance.clear();
    this.bossfightLevel = 1;
    this.bossfightCurrentBoss = 'Magician';
    const bossfightMenu = getBossfightMenuState(this);
    this.bossfightMenuBoss = bossfightMenu.boss;
    this.bossfightMenuLevel = bossfightMenu.level;
    this.bossfightMenuLevels = bossfightMenu.levels;
    this.bossfightBossDefeatedThisTurn = false;
    this.bossfightPendingReward = null;
    this.dungeonWave = 1;
    this.dungeonBoss = null;
    this.dungeonBossRole = null;
    this.dungeonBossMinionType = null;
    this.dungeonEnemyClasses = [];
    this.dungeonEventKey = '';
    this.dungeonModifier = 'Classic';
    this.dungeonRunActive = false;
    this.dungeonSaveWarningShown = false;
    this.dungeonVictoryPending = false;
    this.dungeonResultContainer?.destroy(true);
    this.dungeonResultContainer = null;
    this.dungeonScopeMarkers.forEach((marker) => marker.destroy());
    this.dungeonScopeMarkers = [];
    this.dungeonCardOrbitObjects.forEach((orbit) => {
      this.tweens.killTweensOf(orbit);
      orbit.destroy();
    });
    this.dungeonCardOrbitObjects = [];
    this.healingWaitByInstance.clear();
    this.healingRetryReadyByInstance.clear();
    this.avoidChanceIgnoredTargetByInstance.clear();
    this.reverseUsesByInstance.clear();
    this.reverseLastUsedTurnByInstance.clear();
    this.reverseCooldownUntilTurnByInstance.clear();
    this.multiplayer.resetSession();
    this.multiplayerCountdownEvent?.remove(false);
    this.multiplayerCountdownEvent = null;
    this.multiplayerTimerText?.destroy();
    this.multiplayerTimerText = null;
    this.combatTimerText?.destroy();
    this.combatTimerText = null;
    this.multiplayerLobbyCodeText = null;
    this.activePostCombatDragProxy?.destroy();
    this.activePostCombatDragProxy = null;
    this.deathAlliesDefeatedCount.clear();
    this.reviveCountByInstance.clear();
    this.basicAttackDamageBonusByInstance.clear();
    this.soulDiceSoulsConjured.clear();
    this.scopeStacksByInstance.clear();
    this.growthDeltaByInstance.clear();
    this.defeatEventIdByInstance.clear();
    this.processedDefeatEventIds.clear();
    this.nextDefeatEventId = 0;
    this.instanceDefinitionOverrides.clear();
    this.instanceClassLevels.clear();
    this.instanceTalentIndices.clear();
    this.clearModeModal();
    this.turnLimit = -1;
    this.activeChallenge = null;
    this.enemyLoadoutRevealed = false;
    this.clearRangeHighlights();
    this.berserkTriggeredInstances.clear();
    this.activeDiceCardKeys.clear();
    this.activeDiceCards = [];
    this.activeDiceCardKeysByOwner.player.clear();
    this.activeDiceCardKeysByOwner.enemy.clear();
    this.multiplayerDiceCardKey = null;
    this.multiplayerDiceCardOfferSignature = '';
    this.multiplayerDiceCardDraftOpen = false;
    this.resetDiceCardRuntimeEffects();
    this.assassinBoostAttacksByInstance.clear();
    this.specialSkillAttackDepth = 0;
    this.combatOrchestrator.clear();
    this.infiltratedBoardSideByInstance.clear();
    this.chainedByInstance.clear();
    this.hitDuringAttackAction.clear();
    this.persistentLockSourceIds.clear();
    this.lockTurnsByInstance.clear();
    this.lockUnlockEffectByInstance.clear();
    this.gridLockTurnsByOwner.player.clear();
    this.gridLockTurnsByOwner.enemy.clear();
    this.gridLockOverlays = [];
    this.pendingHandDisorientation = [];
    this.retainedLockPositions.clear();
    this.retainedLockedDice.clear();
    this.diceCardPicksUsed = 0;
    this.enemyDisplayName = 'Opponent';
  }

  create() {
    this.resetRuntimeState();
    this.multiplayer.setHandlers({
      onMatch: (match) => this.handleMultiplayerMatch(match),
      onCombat: (event) => this.handleMultiplayerCombat(event)
    });
    this.sessionStartedAtMs = Date.now();
    const layout = getLayout(this);
    this.playerDisplayName = ProfileStore.get(this).username || 'Player';

    this.definitions = new Map([
      ...getAllDiceDefinitions(this),
      ...getExclusiveDiceDefinitions(this)
    ].filter((die): die is DiceDefinition => Boolean(die)).map((die) => [
      die.typeId,
      { ...die, skills: getValidSkillDefinitions(die) }
    ]));
    this.skillIndex = buildSkillIndex([...this.definitions.values()]);
    this.refreshDisplayNameReplacements();

    AudioManager.playMusic(this, AUDIO_KEYS.menuMusic);
    this.createBackground(layout);
    this.createLobbyUI();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      const elapsed = Math.max(0, Date.now() - this.sessionStartedAtMs);
      const charged = this.playerManaChargedAccrued;
      this.playerManaChargedAccrued = 0;
      const next = AchievementStore.mutate(this, (state) => ({ ...state, playtimeMs: state.playtimeMs + elapsed, manaCharged: state.manaCharged + charged }));
      if (next.manaCharged >= 100) AchievementStore.unlock(this, 'magical_cycle');
      if (next.playtimeMs >= 3_600_000) AchievementStore.unlock(this, 'sweatin_it');
      if (next.playtimeMs >= 43_200_000) AchievementStore.unlock(this, 'cant_keep_up');
      if (next.playtimeMs >= 86_400_000) AchievementStore.unlock(this, 'diceaholic');
      this.tweens.killAll();
      this.multiplayerCountdownEvent?.remove(false);
      this.multiplayerCountdownEvent = null;
      AudioManager.resetMusicEffects(this);
      this.time.removeAllEvents();
      this.input.keyboard?.off('keydown-ESC', this.escapeKeyHandler);
      this.input.keyboard?.off('keydown-L', this.combatLogKeyHandler);
      this.releaseDicePreviewWheelHandler();
      this.destroyDicePreviewViews();
      this.multiplayer.disconnect();
      this.combatTimerText?.destroy();
      this.combatTimerText = null;
      this.multiplayerTimerText?.destroy();
      this.multiplayerTimerText = null;
    });

    this.debug.log('Arena scene created', { phase: this.gamePhase.stage, skillCount: this.skillIndex.size });
  }

  private createBackground(layout: ReturnType<typeof getLayout>) {
    const { width, height } = this.scale;

    this.add.rectangle(width / 2, height / 2, width, height, 0x0a1925, 1);

    const arenaX = width / 2;
    const arenaY = height / 2;
    const arenaWidth = layout.content.width;
    const arenaHeight = layout.content.height;

    this.add.rectangle(arenaX, arenaY, arenaWidth, arenaHeight, 0x12293a, 0.95)
      .setStrokeStyle(2, 0x335770);
  }

  private createLobbyUI() {
    const { width, height } = this.scale;
    const centerX = width / 2;
    const centerY = height / 2;
    const eventTileY = getLayout(this).content.y + 59;

    this.uiContainer = this.add.container(0, 0);

    const wipBadge = this.add.rectangle(centerX + 180, centerY - 120, 60, 28, 0xff6b6b, 0.9);
    this.add.text(centerX + 180, centerY - 120, 'WIP', {
      fontFamily: 'Orbitron',
      fontSize: '14px',
      color: '#ffffff'
    }).setOrigin(0.5);

    const title = this.add.text(centerX, centerY - 80, 'BATTLE ARENA', {
      fontFamily: 'Orbitron',
      fontSize: '36px',
      color: PALETTE.accent
    }).setOrigin(0.5);

    const profile = ProfileStore.get(this);
    const playerHeader = this.add.text(centerX, centerY - 152, `${profile.username || 'Player'}  •  🏆 ${profile.trophies}`, {
      fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.text, backgroundColor: '#173247', padding: { left: 12, right: 12, top: 7, bottom: 7 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    playerHeader.on('pointerdown', () => AlertManager.toast(this, { type: 'warning', message: 'Trophy Road is heavily WIP.' }));

    const subtitle = this.add.text(centerX, centerY - 40, 'Random Combat Mode', {
      fontFamily: 'Orbitron',
      fontSize: '16px',
      color: PALETTE.textMuted
    }).setOrigin(0.5);

    const playButton = this.add.rectangle(centerX, centerY + 40, 160, 48, 0x2ecc71, 0.9)
      .setInteractive({ useHandCursor: true });
    this.add.text(centerX, centerY + 40, 'PLAY!', {
      fontFamily: 'Orbitron',
      fontSize: '20px',
      color: '#ffffff'
    }).setOrigin(0.5);

    playButton.on('pointerover', () => playButton.setFillStyle(0x27ae60, 1));
    playButton.on('pointerout', () => playButton.setFillStyle(0x2ecc71, 0.9));
    playButton.on('pointerdown', () => this.openModeSelectModal());

    const loginRewardComplete = CalendarStore.isComplete(this);
    const loginBtnX = width - 108;
    const loginBtnY = eventTileY;
    const loginRewardBtn = this.add.rectangle(loginBtnX, loginBtnY, 118, 118, loginRewardComplete ? 0x3e4f5c : 0xf4b860, 0.96)
      .setStrokeStyle(2, loginRewardComplete ? 0x8ea1b2 : 0xffffff);
    const loginRewardLabel = this.add.text(loginBtnX, loginBtnY - 18, '7-DAY\nLOGIN', {
      fontFamily: 'Orbitron',
      fontSize: '14px',
      color: loginRewardComplete ? '#c8d2da' : '#111111',
      align: 'center'
    }).setOrigin(0.5);
    const loginRewardSub = this.add.text(loginBtnX, loginBtnY + 24, loginRewardComplete ? 'COMPLETE' : 'REWARDS', {
      fontFamily: 'Orbitron',
      fontSize: '11px',
      color: loginRewardComplete ? '#c8d2da' : '#111111'
    }).setOrigin(0.5);
    if (!loginRewardComplete) {
      loginRewardBtn.setInteractive({ useHandCursor: true });
      loginRewardBtn.on('pointerover', () => loginRewardBtn.setAlpha(1));
      loginRewardBtn.on('pointerout', () => loginRewardBtn.setAlpha(0.96));
      loginRewardBtn.on('pointerdown', () => this.openLoginRewardModal());
    }

    const dungeonEvent = getDungeonEventWindowForScene(this);
    const dungeonProgress = getDungeonProgress(this);
    const savedDungeonRun = getDungeonRun(this);
    const dungeonVisible = dungeonEvent.active || Boolean(savedDungeonRun);
    const dungeonTickets = dungeonEvent.active ? dungeonProgress.ticketsRemaining : 0;
    const dungeonObjects: Phaser.GameObjects.GameObject[] = [];
    if (dungeonVisible) {
      const dungeonLive = Boolean(savedDungeonRun) || (dungeonEvent.active && dungeonTickets > 0);
      const dungeonBtn = this.add.rectangle(108, eventTileY, 118, 118, dungeonLive ? 0xc96b3a : 0x3e4f5c, 0.96)
        .setStrokeStyle(2, dungeonLive ? 0xffd7a3 : 0x8ea1b2)
        .setInteractive({ useHandCursor: true });
      const dungeonLabel = this.add.text(108, eventTileY - 18, 'DUNGEONS', {
        fontFamily: 'Orbitron',
        fontSize: '14px',
        color: dungeonLive ? '#fff7e8' : '#c8d2da',
        align: 'center'
      }).setOrigin(0.5);
      const dungeonSub = this.add.text(108, eventTileY + 24, savedDungeonRun ? `WAVE ${savedDungeonRun.wave}/${DUNGEON_MAX_WAVES}` : `${dungeonTickets}/${DUNGEON_DAILY_TICKETS} TICKETS`, {
        fontFamily: 'Orbitron',
        fontSize: '10px',
        color: dungeonLive ? '#ffe3b8' : '#c8d2da'
      }).setOrigin(0.5);
      dungeonBtn.on('pointerover', () => dungeonBtn.setAlpha(1));
      dungeonBtn.on('pointerout', () => dungeonBtn.setAlpha(0.96));
      dungeonBtn.on('pointerdown', () => this.openDungeonsModal());
      dungeonObjects.push(dungeonBtn, dungeonLabel, dungeonSub);
    }

    const lineupObjects = this.buildLobbyLineupPreview(centerX, centerY + 98);

    const rules = this.add.text(centerX, centerY + 192, [
      'Win: Defeat all enemy dice',
      'Lose: All your dice are defeated',
      '',
      '5x5 Grid • Turn-based Combat'
    ].join('\n'), {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.textMuted,
      align: 'center'
    }).setOrigin(0.5);

    this.uiContainer.add([wipBadge, playerHeader, title, subtitle, playButton, ...lineupObjects, ...dungeonObjects, rules, loginRewardBtn, loginRewardLabel, loginRewardSub]);

    if (this.registry.get(DUNGEON_OPEN_MODAL_KEY) === true) {
      this.registry.remove(DUNGEON_OPEN_MODAL_KEY);
      this.time.delayedCall(0, () => this.openDungeonsModal());
    }
  }

  private buildLobbyLineupPreview(centerX: number, startY: number): Phaser.GameObjects.GameObject[] {
    const objects: Phaser.GameObjects.GameObject[] = [];
    const activeDeckSlot = getActiveLoadoutSlot(this);
    const definitions = getDiceDefinitions(this);

    for (let i = 0; i < LOADOUT_SLOT_COUNT; i++) {
      const x = centerX - 54 + i * 42;
      const deckBtn = this.add.rectangle(x, startY - 22, 32, 28, 0x173247, 0.96)
        .setStrokeStyle(2, i === activeDeckSlot ? 0xf4b860 : 0x406987)
        .setInteractive({ useHandCursor: true });
      const deckText = this.add.text(x, startY - 22, `${i + 1}`, {
        fontFamily: 'Orbitron', fontSize: '12px', color: i === activeDeckSlot ? '#ffd84d' : PALETTE.text
      }).setOrigin(0.5);
      deckBtn.on('pointerdown', () => {
        setActiveLoadoutSlot(this, i);
        this.scene.restart();
      });
      objects.push(deckBtn, deckText);
    }

    definitions.forEach((definition, index) => {
      const x = centerX - 132 + index * 66;
      objects.push(...this.buildLoadoutDiceCard(definition, x, startY + 22));
    });

    return objects;
  }

  private buildLoadoutDiceCard(definition: DiceDefinition, x: number, y: number, onClose?: () => void): Phaser.GameObjects.GameObject[] {
    const progress = getDiceProgress(this, definition.typeId);
    const accent = Phaser.Display.Color.HexStringToColor(definition.accent).color;
    const card = this.add.rectangle(x, y, 54, 46, 0x173247, 0.96)
      .setStrokeStyle(2, accent)
      .setInteractive({ useHandCursor: true });
    const label = this.add.text(x, y - 10, definition.typeId.slice(0, 4).toUpperCase(), {
      fontFamily: 'Orbitron', fontSize: '10px', color: definition.accent
    }).setOrigin(0.5);
    const rarityColor = RARITY_TEXT_COLORS[definition.rarity] ?? PALETTE.text;
    const rarityFill = Phaser.Display.Color.HexStringToColor(rarityColor).color;
    const classCircle = this.add.circle(x + 17, y + 11, 11, rarityFill, 0.95)
      .setStrokeStyle(1, 0xffffff, 0.55);
    const classText = this.add.text(x + 17, y + 11, `${progress.classLevel}`, {
      fontFamily: 'Orbitron',
      fontSize: '9px',
      color: definition.rarity === 'Common' || definition.rarity === 'Legendary' ? '#111111' : '#ffffff'
    }).setOrigin(0.5);
    card.on('pointerdown', () => this.openArenaDiceStatsModal(definition.typeId, 0, onClose));
    return [card, label, classCircle, classText];
  }

  private openArenaDiceStatsModal(typeId: DiceTypeId, formIndex = 0, returnTo?: () => void) {
    this.clearModeModal();
    const definition = getAllDiceDefinitions(this).find((die) => die.typeId === typeId);
    if (!definition) return;
    const progress = getDiceProgress(this, typeId);
    const talentIndex = areTalentsSuppressedForChallenge(this.activeChallenge)
      ? null
      : getEquippedTalentIndex(this, definition, progress.classLevel);
    const talentDefinition = applyDiceTalent(definition, talentIndex, progress.classLevel);
    const scaled = getDiceModalDisplayDefinition(talentDefinition, progress.classLevel, formIndex);
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const overlay = this.add.rectangle(cx, cy, width, height, 0x000000, 0.55).setInteractive();
    const panel = this.add.rectangle(cx, cy, 540, 340, 0x163246, 0.96).setStrokeStyle(2, 0x4f7ea1);
    const title = this.add.text(cx, cy - 140, `${scaled.title} • CLASS ${progress.classLevel}/15`, { fontFamily: 'Orbitron', fontSize: '20px', color: scaled.accent }).setOrigin(0.5);
    const stats = this.add.text(cx, cy - 106, `ATK ${formatCompact(scaled.attack)}  |  HP ${formatCompact(scaled.health)}  |  RANGE ${scaled.range} (${getRangeLabel(scaled.range)})`, { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.text, align: 'center' }).setOrigin(0.5);
    const rarityColor = RARITY_TEXT_COLORS[scaled.rarity] ?? PALETTE.text;
    const rarityLabel = this.add.text(cx - 140, cy - 84, 'RARITY', { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.text, align: 'right' }).setOrigin(1, 0.5);
    const rarityStats = this.add.text(cx - 126, cy - 84, scaled.rarity.toUpperCase(), { fontFamily: 'Orbitron', fontSize: '12px', color: rarityColor, align: 'left' }).setOrigin(0, 0.5);
    const targetStats = this.add.text(cx + 12, cy - 84, `TARGET ${scaled.targetingMode.toUpperCase()}  |  COPIES ${formatCompact(progress.copies)}`, { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.text, align: 'left' }).setOrigin(0, 0.5);
    const skillViewportWidth = 470;
    const skillViewportHeight = 132;
    const skillViewportTop = cy - 70;
    const skillContainer = this.add.container(cx, skillViewportTop);
    const skill = this.add.text(0, 0, formatSkillInfo(scaled, false, 1, formIndex > 0 ? formIndex - 1 : undefined, definition, progress.classLevel, this), {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.textMuted,
      align: 'center',
      wordWrap: { width: 440 }
    }).setOrigin(0.5, 0);
    skillContainer.add(skill);
    const skillMaskShape = this.add.rectangle(cx - skillViewportWidth / 2, skillViewportTop, skillViewportWidth, skillViewportHeight, 0xffffff, 0)
      .setOrigin(0, 0)
      .setVisible(false);
    skillContainer.setMask(skillMaskShape.createGeometryMask());
    const maxSkillScroll = Math.max(0, skill.height - skillViewportHeight);
    const skillScrollHint = this.add.text(cx, skillViewportTop + skillViewportHeight + 4, maxSkillScroll > 0 ? 'Scroll for more skill info' : '', {
      fontFamily: 'Orbitron',
      fontSize: '10px',
      color: PALETTE.textMuted
    }).setOrigin(0.5);
    let skillScrollOffset = 0;
    this.modalWheelHandler = (pointer: Phaser.Input.Pointer, _gameObjects: Phaser.GameObjects.GameObject[], _dx: number, dy: number) => {
      const withinX = pointer.worldX >= cx - skillViewportWidth / 2 && pointer.worldX <= cx + skillViewportWidth / 2;
      const withinY = pointer.worldY >= skillViewportTop && pointer.worldY <= skillViewportTop + skillViewportHeight;
      if (!withinX || !withinY || maxSkillScroll <= 0) return;
      skillScrollOffset = Phaser.Math.Clamp(skillScrollOffset - dy * 0.35, -maxSkillScroll, 0);
      skillContainer.y = skillViewportTop + skillScrollOffset;
    };
    this.input.on('wheel', this.modalWheelHandler);
    const alternateLabel = getDiceAlternateFormLabel(definition, formIndex);
    const altBtn = this.add.text(cx, cy + 120, alternateLabel ?? '', {
      fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.accentSoft,
      backgroundColor: '#224b66', padding: { left: 8, right: 8, top: 4, bottom: 4 }
    }).setOrigin(0.5);
    if (alternateLabel) {
      altBtn.setInteractive({ useHandCursor: true });
      altBtn.on('pointerdown', () => this.openArenaDiceStatsModal(typeId, getNextDiceFormIndex(definition, formIndex), returnTo));
    } else {
      altBtn.setVisible(false);
    }
    const closeStats = () => {
      this.clearModeModal();
      returnTo?.();
    };
    const closeBtn = this.add.text(cx, cy + 146, 'CLOSE', {
      fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.textMuted,
      backgroundColor: '#173247', align: 'center', padding: { left: 8, right: 8, top: 4, bottom: 4 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerdown', closeStats);

    this.modalContainer = this.add.container(0, 0, [
      overlay,
      panel,
      title,
      stats,
      rarityLabel,
      rarityStats,
      targetStats,
      skillContainer,
      skillMaskShape,
      skillScrollHint,
      altBtn,
      closeBtn
    ]).setDepth(250);
    overlay.on('pointerdown', closeStats);
    this.setModalEsc(closeStats);
  }

  // ── MATCH MODE MODAL ────────────────────────────────────────────────────────

  private clearModeModal() {
    this.clearModalEsc();
    if (this.modalWheelHandler) {
      this.input.off('wheel', this.modalWheelHandler);
      this.modalWheelHandler = null;
    }
    this.historyModalView = null;
    if (this.modalContainer) {
      this.modalContainer.destroy(true);
      this.modalContainer = null;
    }
    this.multiplayerLobbyCodeText = null;
  }

  private setModalEsc(handler: () => void) {
    this.clearModalEsc();
    this.modalEscHandler = handler;
    this.input.keyboard?.on('keydown-ESC', handler);
  }

  private clearModalEsc() {
    if (this.modalEscHandler) {
      this.input.keyboard?.off('keydown-ESC', this.modalEscHandler);
      this.modalEscHandler = null;
    }
  }

  private openModeSelectModal() {
    this.clearModeModal();
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const elements: Phaser.GameObjects.GameObject[] = [];

    elements.push(
      this.add.rectangle(cx, cy, width, height, 0x000000, 0.6).setInteractive(),
      this.add.rectangle(cx, cy, 740, 330, 0x102434, 0.98).setStrokeStyle(2, 0x335770),
      this.add.text(cx, cy - 136, 'CHOOSE YOUR MODE', {
        fontFamily: 'Orbitron', fontSize: '22px', color: PALETTE.accent
      }).setOrigin(0.5)
    );

    const modes: { key: 'matchmaking' | 'singleplayer' | 'multiplayer'; label: string; desc: string }[] = [
      { key: 'matchmaking',  label: 'MATCHMAKING',  desc: 'Queue for fixed 10-turn PvP.\nClassic with current loadouts.' },
      { key: 'singleplayer', label: 'SINGLEPLAYER', desc: 'Battle a bot opponent.\nFully configurable.' },
      { key: 'multiplayer',  label: 'MULTIPLAYER',  desc: 'Join or create friend sessions.\nShare a 6-digit lobby code.' }
    ];

    const cardW = 196;
    const cardH = 158;
    const spacing = 222;
    const startX = cx - spacing;

    modes.forEach((mode, i) => {
      const mx = startX + i * spacing;
      const my = cy - 4;
      const card = this.add.rectangle(mx, my, cardW, cardH, 0x19374d, 0.95)
        .setStrokeStyle(1, 0x335770).setInteractive({ useHandCursor: true });
      const labelText = this.add.text(mx, my - 40, mode.label, {
        fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.text
      }).setOrigin(0.5);
      const descText = this.add.text(mx, my + 14, mode.desc, {
        fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.textMuted,
        align: 'center', wordWrap: { width: 172 }
      }).setOrigin(0.5);

      card.on('pointerover', () => card.setFillStyle(0x233d52, 0.98));
      card.on('pointerout',  () => card.setFillStyle(0x19374d, 0.95));
      card.on('pointerdown', () => {
        if (mode.key === 'matchmaking')  this.openMatchmakingModal();
        else if (mode.key === 'singleplayer') this.openSingleplayerModal();
        else this.openMultiplayerModal();
      });
      elements.push(card, labelText, descText);
    });

    const backBtn = this.add.text(cx, cy + 134, '← BACK', {
      fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.accentSoft,
      backgroundColor: '#173247', padding: { left: 14, right: 14, top: 7, bottom: 7 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backBtn.on('pointerdown', () => this.clearModeModal());
    elements.push(backBtn);

    this.modalContainer = this.add.container(0, 0, elements).setDepth(250);
    this.setModalEsc(() => this.clearModeModal());
  }

  private openMatchmakingModal() {
    this.clearModeModal();
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const elements: Phaser.GameObjects.GameObject[] = [];

    elements.push(
      this.add.rectangle(cx, cy, width, height, 0x000000, 0.6).setInteractive(),
      this.add.rectangle(cx, cy, 600, 300, 0x102434, 0.98).setStrokeStyle(2, 0x335770),
      this.add.text(cx, cy - 112, 'MATCHMAKING', {
        fontFamily: 'Orbitron', fontSize: '22px', color: PALETTE.accent
      }).setOrigin(0.5),
      this.add.text(cx, cy - 60, 'Pure PvP — fixed 10 turns, Classic, baseline loadouts.', {
        fontFamily: 'Orbitron', fontSize: '14px', color: PALETTE.text
      }).setOrigin(0.5),
      this.add.text(cx, cy - 22, 'Automatically finds a real opponent in the matchmaking queue.\nMatchmaking always uses Classic mode and fixed baseline stats.', {
        fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.textMuted,
        align: 'center', wordWrap: { width: 540 }
      }).setOrigin(0.5)
    );

    const backBtn = this.add.text(cx - 90, cy + 104, '← BACK', {
      fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.accentSoft,
      backgroundColor: '#173247', padding: { left: 12, right: 12, top: 7, bottom: 7 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backBtn.on('pointerdown', () => {
      this.multiplayer.cancelMatchmaking();
      this.openModeSelectModal();
    });
    elements.push(backBtn);

    const queueBtn = this.add.text(cx + 90, cy + 104, 'ENTER QUEUE →', {
      fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.text,
      backgroundColor: '#2d6f99', padding: { left: 12, right: 12, top: 7, bottom: 7 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    queueBtn.on('pointerdown', () => {
      void this.queueArenaMultiplayer({ mode: 'matchmaking' });
    });
    elements.push(queueBtn);

    this.modalContainer = this.add.container(0, 0, elements).setDepth(250);
    this.setModalEsc(() => {
      this.multiplayer.cancelMatchmaking();
      this.openModeSelectModal();
    });
  }

  private openSingleplayerModal() {
    this.activeChallenge = null;
    this.clearModeModal();
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const elements: Phaser.GameObjects.GameObject[] = [];

    elements.push(
      this.add.rectangle(cx, cy, width, height, 0x000000, 0.6).setInteractive(),
      this.add.rectangle(cx, cy, 700, 320, 0x102434, 0.98).setStrokeStyle(2, 0x335770),
      this.add.text(cx, cy - 128, 'SINGLEPLAYER', {
        fontFamily: 'Orbitron', fontSize: '22px', color: PALETTE.accent
      }).setOrigin(0.5),
      this.add.text(cx, cy - 98, 'Choose a solo battle surface.', {
        fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.textMuted
      }).setOrigin(0.5)
    );

    const createOption = (x: number, y: number, title: string, subtitle: string, color: number, onClick: () => void) => {
      const card = this.add.rectangle(x, y, 190, 114, color, 0.9)
        .setStrokeStyle(1, 0x8fd5ff)
        .setInteractive({ useHandCursor: true });
      const titleText = this.add.text(x, y - 34, title.toUpperCase(), {
        fontFamily: 'Orbitron', fontSize: '13px', color: '#ffffff'
      }).setOrigin(0.5);
      const descText = this.add.text(x, y - 10, subtitle, {
        fontFamily: 'Orbitron', fontSize: '10px', color: '#e6f4ff',
        align: 'center', wordWrap: { width: 160 }
      }).setOrigin(0.5, 0);
      card.on('pointerover', () => card.setAlpha(1));
      card.on('pointerout', () => card.setAlpha(0.9));
      card.on('pointerdown', onClick);
      elements.push(card, titleText, descText);
    };

    createOption(cx - 220, cy + 2, 'Versus Bot', 'Setup and play against a realtime computer opponent.', 0x2271b3, () => {
      this.openSingleplayerConfigModal();
    });
    createOption(cx, cy + 2, 'Bossfight', 'Fight all-powerful bosses that everyone fears the most in Diceville.', 0x6f5bb5, () => {
      this.activeChallenge = 'bossfight';
      this.activeDailyKey = '';
      this.openBossfightModal();
    });
    createOption(cx + 220, cy + 2, 'Challenges', 'Challenge yourself in dailies or handcrafted battles to earn big rewards.', 0x5d6770, () => this.openChallengesModal());

    const backBtn = this.add.text(cx, cy + 126, '← BACK', {
      fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.accentSoft,
      backgroundColor: '#173247', padding: { left: 12, right: 12, top: 7, bottom: 7 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backBtn.on('pointerdown', () => this.openModeSelectModal());
    elements.push(backBtn);

    this.modalContainer = this.add.container(0, 0, elements).setDepth(250);
    this.setModalEsc(() => this.openModeSelectModal());
  }


  private openBossfightModal() {
    this.clearModeModal();
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const elements: Phaser.GameObjects.GameObject[] = [];
    const progress = getBossfightProgress(this);
    const unlockedLevel = progress.unlockedLevels[this.bossfightMenuBoss];
    this.bossfightMenuLevel = Phaser.Math.Clamp(this.bossfightMenuLevels[this.bossfightMenuBoss], 1, unlockedLevel);
    this.bossfightMenuLevels[this.bossfightMenuBoss] = this.bossfightMenuLevel;
    const reward = getBossfightRewards(this.bossfightMenuLevel);
    const isMaxSelected = this.bossfightMenuLevel >= unlockedLevel;

    elements.push(
      this.add.rectangle(cx, cy, width, height, 0x000000, 0.6).setInteractive(),
      this.add.rectangle(cx, cy, 720, 390, 0x102434, 0.98).setStrokeStyle(2, 0x6f5bb5),
      this.add.text(cx, cy - 158, 'BOSSFIGHT', { fontFamily: 'Orbitron', fontSize: '22px', color: PALETTE.accent }).setOrigin(0.5),
      this.add.text(cx, cy - 130, 'Choose a Mythic boss and highest unlocked level.', { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.textMuted }).setOrigin(0.5)
    );

    const makeBossButton = (boss: BossfightBossType, x: number) => {
      const selected = this.bossfightMenuBoss === boss;
      const button = this.add.rectangle(x, cy - 76, 160, 82, selected ? 0x2d4e72 : 0x173247, 0.96)
        .setStrokeStyle(2, Phaser.Display.Color.HexStringToColor(BOSSFIGHT_BOSS_METADATA[boss].color).color)
        .setInteractive({ useHandCursor: true });
      const title = this.add.text(x, cy - 94, BOSSFIGHT_BOSS_METADATA[boss].label, { fontFamily: 'Orbitron', fontSize: '16px', color: BOSSFIGHT_BOSS_METADATA[boss].color }).setOrigin(0.5);
      const sub = this.add.text(x, cy - 66, `Unlocked Lv.${progress.unlockedLevels[boss]}`, { fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.textMuted }).setOrigin(0.5);
      button.on('pointerdown', () => {
        this.bossfightMenuBoss = boss;
        this.bossfightMenuLevel = Phaser.Math.Clamp(
          this.bossfightMenuLevels[boss],
          1,
          getBossfightHighestUnlockedLevel(this, boss)
        );
        this.bossfightMenuLevels[boss] = this.bossfightMenuLevel;
        saveBossfightMenuState(this.bossfightMenuBoss, this.bossfightMenuLevel, undefined, this.bossfightMenuLevels);
        this.openBossfightModal();
      });
      elements.push(button, title, sub);
    };
    const bossButtonGap = 180;
    const bossButtonStartX = cx - ((BOSSFIGHT_BOSSES.length - 1) * bossButtonGap) / 2;
    BOSSFIGHT_BOSSES.forEach((boss, index) => {
      makeBossButton(boss, bossButtonStartX + index * bossButtonGap);
    });

    const levelText = this.add.text(cx, cy + 18, `${this.bossfightMenuBoss} Lv.${this.bossfightMenuLevel}`, {
      fontFamily: 'Orbitron', fontSize: '28px', color: BOSSFIGHT_BOSS_METADATA[this.bossfightMenuBoss].color
    }).setOrigin(0.5);
    const leftEnabled = this.bossfightMenuLevel > 1;
    const rightEnabled = this.bossfightMenuLevel < unlockedLevel;
    const left = this.add.text(cx - 148, cy + 18, '◀', { fontFamily: 'Orbitron', fontSize: '28px', color: leftEnabled ? PALETTE.accentSoft : '#4d6170' }).setOrigin(0.5).setInteractive({ useHandCursor: leftEnabled });
    const right = this.add.text(cx + 148, cy + 18, '▶', { fontFamily: 'Orbitron', fontSize: '28px', color: rightEnabled ? PALETTE.accentSoft : '#4d6170' }).setOrigin(0.5).setInteractive({ useHandCursor: rightEnabled });
    if (leftEnabled) left.on('pointerdown', () => {
      this.bossfightMenuLevel -= 1;
      this.bossfightMenuLevels[this.bossfightMenuBoss] = this.bossfightMenuLevel;
      saveBossfightMenuState(this.bossfightMenuBoss, this.bossfightMenuLevel, undefined, this.bossfightMenuLevels);
      this.openBossfightModal();
    });
    if (rightEnabled) right.on('pointerdown', () => {
      this.bossfightMenuLevel += 1;
      this.bossfightMenuLevels[this.bossfightMenuBoss] = this.bossfightMenuLevel;
      saveBossfightMenuState(this.bossfightMenuBoss, this.bossfightMenuLevel, undefined, this.bossfightMenuLevels);
      this.openBossfightModal();
    });
    elements.push(levelText, left, right);

    elements.push(
      this.add.text(cx, cy + 64, `Reward: ${formatCompact(reward.tokens)} Dice Tokens + ${formatCompact(reward.chips)} Casino Chips`, { fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.text }).setOrigin(0.5),
      this.add.text(cx, cy + 88, isMaxSelected ? 'Defeat this level to unlock the next level.' : 'Replay unlocked levels for practice; rewards are first-clear only.', {
        fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.textMuted
      }).setOrigin(0.5)
    );

    const startBtn = this.add.rectangle(cx, cy + 134, 180, 44, 0x2ecc71, 0.92).setInteractive({ useHandCursor: true });
    const startText = this.add.text(cx, cy + 134, 'START BOSSFIGHT', { fontFamily: 'Orbitron', fontSize: '13px', color: '#071018' }).setOrigin(0.5);
    startBtn.on('pointerdown', () => this.startBossfight(this.bossfightMenuBoss, this.bossfightMenuLevel));
    const back = this.add.text(cx, cy + 178, '← BACK', { fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.accentSoft, backgroundColor: '#173247', padding: { left: 12, right: 12, top: 7, bottom: 7 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => this.openSingleplayerModal());
    elements.push(startBtn, startText, back);

    this.modalContainer = this.add.container(0, 0, elements).setDepth(250);
    this.setModalEsc(() => this.openSingleplayerModal());
  }

  private startBossfight(boss: BossfightBossType, level: number) {
    this.activeChallenge = 'bossfight';
    this.activeDailyKey = '';
    this.bossfightCurrentBoss = boss;
    this.bossfightLevel = Phaser.Math.Clamp(Math.floor(level), 1, getBossfightHighestUnlockedLevel(this, boss));
    this.bossfightMenuBoss = boss;
    this.bossfightMenuLevel = this.bossfightLevel;
    this.bossfightMenuLevels[boss] = this.bossfightLevel;
    saveBossfightMenuState(this.bossfightMenuBoss, this.bossfightMenuLevel, undefined, this.bossfightMenuLevels);
    this.bossfightBossDefeatedThisTurn = false;
    this.bossfightPendingReward = null;
    this.configRandomMode = false;
    this.configDifficulty = 'Nightmare';
    this.configUseLevelling = true;
    this.turnLimit = -1;
    this.enemyDisplayName = `${boss} Lv.${this.bossfightLevel}`;
    this.clearModeModal();
    this.startGame();
  }

  private openChallengesModal() {
    this.clearModeModal();
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const dateKey = getDailyChallengeKey();
    this.activeDailyKey = dateKey;
    this.dailyHard = isHardDaily(dateKey);
    const makeBtn = (x: number, y: number, label: string, sub: string, onClick: () => void) => {
      const r = this.add.rectangle(x, y, 300, 150, 0x173247, 0.96).setStrokeStyle(2, 0x406987).setInteractive({ useHandCursor: true });
      const t = this.add.text(x, y - 28, label, { fontFamily: 'Orbitron', fontSize: '16px', color: PALETTE.accent }).setOrigin(0.5);
      const d = this.add.text(x, y - 2, sub, { fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.textMuted, align: 'center', wordWrap: { width: 268 } }).setOrigin(0.5, 0);
      r.on('pointerdown', onClick);
      return [r, t, d];
    };
    const makeCard = (x: number, id: ChallengeMode) => {
      const config = getChallengeUIConfig(id, this.dailyHard, this.activeDailyKey);
      const reward = `Reward: ${config.rewardLabel}`;
      const status = getChallengeStatusLabel(getChallengeStatus(this, id, this.activeDailyKey));
      return makeBtn(x, cy, config.title, `Status: ${status}\n${config.summary}\n${reward}`, () => this.startChallenge(id));
    };
    const daily = makeCard(cx - 320, 'daily');
    const dopamine = makeCard(cx, 'dopamine');
    const deuc = makeCard(cx + 320, 'deucifer');
    const back = this.add.text(cx, cy + 136, '← BACK', { fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.accentSoft, backgroundColor: '#173247', padding: { left: 12, right: 12, top: 7, bottom: 7 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => this.openSingleplayerModal());
    this.modalContainer = this.add.container(0, 0, [
      this.add.rectangle(cx, cy, width, height, 0x000000, 0.6).setInteractive(),
      this.add.rectangle(cx, cy, 1120, 390, 0x102434, 0.98).setStrokeStyle(2, 0x335770),
      this.add.text(cx, cy - 145, 'CHALLENGES', { fontFamily: 'Orbitron', fontSize: '22px', color: PALETTE.accent }).setOrigin(0.5),
      ...daily, ...dopamine, ...deuc, back
    ]).setDepth(250);
    this.setModalEsc(() => this.openSingleplayerModal());
  }

  private startChallenge(challenge: ChallengeMode) {
    const config = getChallengeStartConfig(challenge, this.dailyHard, this.activeDailyKey);
    this.activeChallenge = challenge;
    if (challenge !== 'daily') this.activeDailyKey = '';
    if (getChallengeStatus(this, challenge, this.activeDailyKey) !== 'completed') {
      setChallengeStatus(this, challenge, 'started', this.activeDailyKey);
    }
    this.configRandomMode = config.randomMode;
    this.configRandomizeLoadoutAndClassUps = config.randomizeLoadoutAndClassUps;
    this.configDifficulty = config.difficulty;
    this.configUseLevelling = true;
    this.turnLimit = config.turnLimit;
    this.activeRandomModifier = config.activeRandomModifier ?? null;
    this.clearModeModal();
    this.startGame();
  }

  private markChallengeFailed(challenge: ChallengeMode) {
    if (getChallengeStatus(this, challenge, this.activeDailyKey) === 'completed') return;
    if (canChallengeBeMarkedFailed(this, challenge, this.activeDailyKey)) {
      setChallengeStatus(this, challenge, 'failed', this.activeDailyKey);
    }
  }

  private hasStrikeFirstSkill(definition: DiceDefinition | undefined, die?: DiceInstanceState): boolean {
    if (!definition) return false;
    const classLevel = die ? this.instanceClassLevels.get(die.instanceId) ?? 1 : 1;
    if (die && getInfiltratorSkillEffect(definition, classLevel) && !this.infiltratedBoardSideByInstance.has(die.instanceId)) return false;
    return canSkillStrikeFirst(definition, classLevel);
  }

  private openLoginRewardModal() {
    const { reward, claimed, unlockedDay, nextClaimableDay, nextUnlockDay, alreadyClaimedToday, isComplete, isMalformed } = CalendarStore.getProgress(this);
    
    this.clearModeModal();
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    
    const overlay = this.add.rectangle(cx, cy, width, height, 0x000000, 0.7).setInteractive().setDepth(250);
    const panel = this.add.rectangle(cx, cy, 580, 420, 0x102434, 0.98).setStrokeStyle(2, 0xf4b860).setDepth(251);
    const title = this.add.text(cx, cy - 170, '7-DAY LOGIN REWARDS', { fontFamily: 'Orbitron', fontSize: '20px', color: '#f4b860' }).setOrigin(0.5).setDepth(252);
    
    const rewards = LOGIN_REWARD_DAYS;
    
    const mediumBtnWidth = 140;
    const mediumBtnHeight = 70;
    const gapX = 20;
    const gapY = 15;
    const startX = cx - (mediumBtnWidth * 1.5 + gapX / 2);
    const startY = cy - 80;
    
    for (let i = 0; i < 6; i++) {
      const r = rewards[i];
      const row = Math.floor(i / 3);
      const col = i % 3;
      const x = startX + col * (mediumBtnWidth + gapX);
      const y = startY + row * (mediumBtnHeight + gapY);
      const isClaimed = claimed.has(r.day);
      const isUnlocked = r.day <= unlockedDay;
      const isClaimable = nextClaimableDay === r.day;
      
      const btn = this.add.rectangle(x, y, mediumBtnWidth, mediumBtnHeight, isClaimed ? 0x2c3e50 : r.color, 0.9)
        .setStrokeStyle(2, isClaimed ? 0x7f8c8d : 0xffffff)
        .setDepth(252);
      
      const dayText = this.add.text(x, y - 18, `DAY ${r.day}`, { fontFamily: 'Orbitron', fontSize: '11px', color: (isClaimed || !isUnlocked) ? '#7f8c8d' : '#ffffff' }).setOrigin(0.5).setDepth(253);
      const rewardText = this.add.text(x, y + 8, r.label, { fontFamily: 'Orbitron', fontSize: '10px', color: (isClaimed || !isUnlocked) ? '#7f8c8d' : '#ffffff', align: 'center' }).setOrigin(0.5).setDepth(253);
      if (isClaimed) this.add.text(x + (mediumBtnWidth / 2) - 12, y - (mediumBtnHeight / 2) + 10, '✓', { fontFamily: 'Orbitron', fontSize: '16px', color: '#7dff9f' }).setOrigin(0.5).setDepth(254);
      
      if (!isClaimed && !isComplete && isClaimable) {
        const claimHitArea = this.add.rectangle(x, y, mediumBtnWidth, mediumBtnHeight, 0x000000, 0.001)
          .setDepth(254)
          .setInteractive({ useHandCursor: true });
        claimHitArea.on('pointerover', () => { if (!isClaimed) btn.setFillStyle(r.color, 1); });
        claimHitArea.on('pointerout', () => { if (!isClaimed) btn.setFillStyle(r.color, 0.9); });
        claimHitArea.on('pointerdown', () => this.claimDailyReward(r.day));
      }
    }
    
    const day7 = rewards[6];
    const day7Width = 300;
    const day7Height = 60;
    const day7X = cx;
    const day7Y = cy + 110;
    const isDay7Claimed = claimed.has(7);
    
    const day7Btn = this.add.rectangle(day7X, day7Y, day7Width, day7Height, isDay7Claimed ? 0x2c3e50 : day7.color, 0.9)
      .setStrokeStyle(2, isDay7Claimed ? 0x7f8c8d : 0xffffff)
      .setDepth(252);
    const day7Text = this.add.text(day7X, day7Y - 8, `DAY 7 - ${day7.label}`, { fontFamily: 'Orbitron', fontSize: '13px', color: isDay7Claimed ? '#7f8c8d' : '#000000' }).setOrigin(0.5).setDepth(253);
    
    if (isDay7Claimed) this.add.text(day7X + (day7Width / 2) - 14, day7Y - (day7Height / 2) + 12, '✓', { fontFamily: 'Orbitron', fontSize: '18px', color: '#7dff9f' }).setOrigin(0.5).setDepth(254);
    if (!isDay7Claimed && !isComplete && nextClaimableDay === 7) {
      const day7HitArea = this.add.rectangle(day7X, day7Y, day7Width, day7Height, 0x000000, 0.001)
        .setDepth(254)
        .setInteractive({ useHandCursor: true });
      day7HitArea.on('pointerover', () => { if (!isDay7Claimed) day7Btn.setFillStyle(day7.color, 1); });
      day7HitArea.on('pointerout', () => { if (!isDay7Claimed) day7Btn.setFillStyle(day7.color, 0.9); });
      day7HitArea.on('pointerdown', () => this.claimDailyReward(7));
    }
    
    const day7Legendary = reward.day7LegendaryTitle ? ` • Day 7: ${reward.day7LegendaryTitle}` : '';
    const statusDetail = nextClaimableDay
      ? `Next claim: Day ${nextClaimableDay}`
      : alreadyClaimedToday
        ? `Next unlock: Day ${nextUnlockDay} tomorrow`
        : `Next unlock: Day ${nextUnlockDay}`;
    const statusText = isComplete 
      ? `🎉 7-DAY CALENDAR COMPLETE!${day7Legendary}` 
      : `${isMalformed ? 'Fixed malformed claim order • ' : ''}Claimed: ${claimed.size}/${LOGIN_REWARD_TOTAL_DAYS} days • ${statusDetail}`;
    const status = this.add.text(cx, cy + 160, statusText, { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.textMuted }).setOrigin(0.5).setDepth(253);
    
    const closeBtn = this.add.text(cx, cy + 195, 'CLOSE', { fontFamily: 'Orbitron', fontSize: '13px', color: '#ffffff', backgroundColor: '#173247', padding: { left: 12, right: 12, top: 7, bottom: 7 } })
      .setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(254);
    closeBtn.on('pointerdown', () => {
      [overlay, panel, title, ...this.children.getAll()].forEach(node => {
        const depth = 'depth' in node && typeof node.depth === 'number' ? node.depth : -1;
        if (depth >= 250 && depth <= 254) node.destroy();
      });
      this.modalContainer = null;
    });
    
    this.modalContainer = this.add.container(0, 0, [overlay, panel, title, day7Btn, day7Text, status, closeBtn]).setDepth(250);
    this.setModalEsc(() => {
      [overlay, panel, title, ...this.children.getAll()].forEach(node => {
        const depth = 'depth' in node && typeof node.depth === 'number' ? node.depth : -1;
        if (depth >= 250 && depth <= 254) node.destroy();
      });
      this.modalContainer = null;
    });
  }
  
  private claimDailyReward(day: number) {
    const result = CalendarStore.claim(this, day);
    if (result.status === 'claimed') {
      AlertManager.toast(this, { type: 'success', message: `Claimed Day ${day}: ${result.message}` });
      this.openLoginRewardModal();
      return;
    }
    result.messages.forEach((message) => AlertManager.toast(this, { type: 'warning', message }));
  }

  private formatDungeonDate(timestamp: number): string {
    const weekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const date = new Date(timestamp);
    return `${weekdays[date.getUTCDay()] ?? 'TUE'} ${date.toISOString().slice(5, 10)}`;
  }

  private restoreDungeonConfig() {
    const snapshot = this.dungeonConfigSnapshot;
    if (!snapshot) return;
    this.configRandomMode = snapshot.randomMode;
    this.configRandomizeLoadoutAndClassUps = snapshot.randomizeLoadout;
    this.configUseLevelling = snapshot.useLevelling;
    this.dungeonConfigSnapshot = null;
  }

  private persistDungeonRun(wave: number, carryover: DungeonCarryover | null = this.dungeonCarryover): boolean {
    if (!this.dungeonConfigSnapshot || !this.dungeonEventKey) return false;
    const saved = saveDungeonRun(this, {
      eventKey: this.dungeonEventKey,
      wave: Math.max(1, Math.min(DUNGEON_MAX_WAVES, Math.floor(wave))),
      carryover,
      config: this.dungeonConfigSnapshot,
      loadout: this.dungeonLoadoutSnapshot ?? undefined,
      savedAt: Date.now()
    });
    if (!saved && !this.dungeonSaveWarningShown) {
      this.dungeonSaveWarningShown = true;
      AlertManager.toast(this, { type: 'warning', message: 'Dungeon progress could not be saved. Keep this tab open to avoid losing the run.' });
    }
    return saved;
  }

  private persistDungeonRunProgress(
    cardState: DungeonCardState = this.dungeonCardState,
    completedTurn = Math.max(1, this.gameState.turn - 1),
    resumeTurn?: number
  ): boolean {
    return this.persistDungeonRun(this.dungeonWave, this.buildDungeonCarryover(cardState, { turn: completedTurn, resumeTurn }));
  }

  private persistDungeonCardState(cardState: DungeonCardState = this.dungeonCardState): boolean {
    const currentTurn = Math.max(1, Math.floor(this.gameState.turn));
    return this.persistDungeonRunProgress(cardState, Math.max(1, currentTurn - 1), currentTurn);
  }

  private persistDungeonTurnSnapshot(completedTurn: number): boolean {
    return this.persistDungeonRunProgress(undefined, completedTurn);
  }

  private getDungeonCopyDefinition(
    eventKey: string,
    wave: number,
    rarity?: DiceDefinition['rarity'],
    variant = 0
  ): DiceDefinition | undefined {
    const eligible = getAllDiceDefinitions(this)
      .filter((definition) => rarity === undefined || definition.rarity === rarity);
    const typeId = pickDungeonCopyTypeId(eventKey, wave, eligible.map((definition) => definition.typeId), variant);
    return typeId ? eligible.find((definition) => definition.typeId === typeId) : undefined;
  }

  private formatDungeonRewardAmount(amount: number): string {
    const finite = Number.isFinite(amount) ? amount : 0;
    const rounded = Number.isInteger(finite) ? finite : Math.round(finite * 1000) / 1000;
    return formatCompact(rounded);
  }

  private canReceiveDungeonCopy(definition: DiceDefinition, amount: number): boolean {
    const progress = getDiceProgress(this, definition.typeId);
    return canGrantDungeonCopyAmount(amount, getRemainingUsefulCopies(this, definition.typeId), progress.unlocked);
  }

  private formatDungeonCopyReward(
    part: DungeonRewardPart,
    copyDefinition: DiceDefinition | undefined,
    canGrant = copyDefinition ? this.canReceiveDungeonCopy(copyDefinition, part.amount) : false
  ): string {
    const amount = normalizeDungeonCopyAmount(part.amount);
    if (!copyDefinition || !canGrant) {
      return `${this.formatDungeonRewardAmount(Math.max(2, Math.ceil(amount)))} Diamonds (copy pool full)`;
    }
    const copyName = copyDefinition.title.replace(/\s+Dice$/i, '');
    const progress = getDiceProgress(this, copyDefinition.typeId);
    if (!progress.unlocked) {
      const copies = Math.max(0, amount - 1);
      if (copies <= 0) return `Unlocks ${copyName}`;
      return `Unlocks ${copyName} + ${this.formatDungeonRewardAmount(copies)} ${part.rarity ?? ''} ${copies === 1 ? 'Copy' : 'Copies'}`
        .replace(/\s+/g, ' ')
        .trim();
    }
    return `${this.formatDungeonRewardAmount(amount)} ${part.rarity ?? ''} ${copyName} ${amount === 1 ? 'Copy' : 'Copies'}`
      .replace(/\s+/g, ' ')
      .trim();
  }

  private getDungeonRewardText(reward: DungeonStageReward, eventKey = this.dungeonEventKey): string {
    return reward.parts.map((part, index) => {
      if (part.kind === 'tokens') return `${this.formatDungeonRewardAmount(part.amount)} Tokens`;
      if (part.kind === 'chips') return `${this.formatDungeonRewardAmount(part.amount)} Casino Chips`;
      if (part.kind === 'diamonds') return `${this.formatDungeonRewardAmount(part.amount)} Diamonds`;
      return this.formatDungeonCopyReward(
        part,
        this.getDungeonCopyDefinition(eventKey, reward.wave, part.rarity, index)
      );
    }).join(' + ');
  }

  private grantDungeonRewardForWave(wave: number | null): string {
    if (wave === null) return '';
    const reward = getDungeonStageReward(this.dungeonEventKey, wave);
    return reward.parts.length > 0 ? this.grantDungeonReward(reward) : '';
  }

  private grantDungeonReward(reward: DungeonStageReward): string {
    let tokens = 0;
    let chips = 0;
    let diamonds = 0;
    const rewardTextParts = reward.parts.map((part, index) => {
      if (part.kind === 'tokens') {
        tokens += part.amount;
        return `${this.formatDungeonRewardAmount(part.amount)} Tokens`;
      }
      if (part.kind === 'chips') {
        chips += part.amount;
        return `${this.formatDungeonRewardAmount(part.amount)} Casino Chips`;
      }
      if (part.kind === 'diamonds') {
        diamonds += part.amount;
        return `${this.formatDungeonRewardAmount(part.amount)} Diamonds`;
      }
      const copyDefinition = this.getDungeonCopyDefinition(this.dungeonEventKey, reward.wave, part.rarity, index);
      const copyAmount = normalizeDungeonCopyAmount(part.amount);
      const canGrant = Boolean(copyDefinition && this.canReceiveDungeonCopy(copyDefinition, copyAmount));
      const rewardText = this.formatDungeonCopyReward(part, copyDefinition, canGrant);
      if (copyDefinition && canGrant) grantDiceCopies(this, copyDefinition.typeId, copyAmount);
      else diamonds += Math.max(2, Math.ceil(copyAmount));
      return rewardText;
    });
    if (tokens > 0) setDiceTokens(this, getDiceTokens(this) + tokens);
    if (chips > 0) CasinoProgressStore.mutate(this, (progress) => ({ ...progress, chips: progress.chips + chips }));
    if (diamonds > 0) setDiamonds(this, getDiamonds(this) + diamonds);
    return rewardTextParts.join(' + ');
  }

  private getDungeonMusicKey(): string {
    if (this.dungeonBoss) return getBossMusicKey(this.dungeonBoss, AUDIO_KEYS);
    if (this.dungeonBossMinionType) return getBossMusicKey(this.dungeonBossMinionType, AUDIO_KEYS);
    return AUDIO_KEYS.arenaMusic;
  }

  private startDungeonWave(wave: number, options: { resuming?: boolean; ticketPurchase?: boolean } = {}) {
    this.dungeonEnemyCarryover = null;
    if (wave <= 1) {
      this.dungeonSaveWarningShown = false;
      if (options.resuming === true) {
        this.dungeonCardState = this.dungeonCarryover?.dungeonCards
          ? normalizeDungeonCardState(this.dungeonCarryover.dungeonCards)
          : createDungeonCardState();
      } else {
        this.dungeonCarryover = null;
        this.dungeonEnemyCarryover = null;
        this.dungeonCardState = createDungeonCardState();
      }
    } else if (this.dungeonCarryover?.dungeonCards) {
      this.dungeonCardState = normalizeDungeonCardState(this.dungeonCarryover.dungeonCards);
    }
    const spec = getDungeonWaveSpec(wave, this.dungeonEventKey);
    this.dungeonWave = spec.wave;
    this.settleDungeonCardSpendRefund(this.dungeonCarryover);
    this.dungeonCardState = ensureDungeonScopeMarks(this.dungeonCardState, this.getDungeonScopeMarkRng());
    this.dungeonBoss = spec.boss;
    this.dungeonBossRole = spec.bossRole;
    this.dungeonBossMinionType = spec.bossMinionType;
    this.dungeonEnemyClasses = [...spec.enemyClasses];
    this.dungeonModifier = getDungeonModifier(this.dungeonEventKey);
    this.dungeonRunActive = true;
    this.activeChallenge = 'dungeon';
    this.activeDailyKey = '';
    this.configRandomMode = true;
    this.configRandomizeLoadoutAndClassUps = false;
    this.configUseLevelling = true;
    this.dungeonLoadoutSnapshot = resolveDungeonWaveLoadout({
      wave,
      resuming: options.resuming === true,
      currentLoadout: wave <= 1 && !options.resuming ? this.captureDungeonLoadoutSnapshot() : [],
      savedLoadout: this.dungeonLoadoutSnapshot
    });
    this.turnLimit = -1;
    this.enemyDisplayName = 'Dungeon Keeper';
    if (options.ticketPurchase === true) {
      if (!this.persistDungeonRun(spec.wave)) {
        clearDungeonRun(this);
        this.dungeonRunActive = false;
        this.dungeonLoadoutSnapshot = null;
        this.restoreDungeonConfig();
        AlertManager.toast(this, { type: 'warning', message: 'Dungeon run could not be saved. No ticket was spent.' });
        this.openDungeonsModal();
        return;
      }
      if (consumeDungeonTicket(this) === null) {
        clearDungeonRun(this);
        this.dungeonRunActive = false;
        this.dungeonLoadoutSnapshot = null;
        this.restoreDungeonConfig();
        AlertManager.toast(this, { type: 'warning', message: 'Dungeon ticket could not be used. No ticket was spent.' });
        this.openDungeonsModal();
        return;
      }
    } else {
      this.persistDungeonRun(spec.wave);
    }
    this.clearModeModal();
    this.startGame();
  }

  private async playDungeonIntroIfNeeded() {
    if (this.activeChallenge !== 'dungeon') return;
    const intro = getDungeonIntroForWave(this.dungeonWave);
    if (!intro) return;
    AudioManager.setMusicMuted(this, true);
    try {
      AudioManager.playSfx(this, intro.sfxKey, { volume: 0.7 });
      await AnimationManager.animateDungeonIntro(this, intro);
    } finally {
      AudioManager.setMusicMuted(this, false);
    }
  }

  private captureDungeonCarryover() {
    this.dungeonCarryover = this.buildDungeonCarryover(undefined, { includeEnemyBoard: false });
  }

  private buildDungeonCarryover(
    cardState: DungeonCardState = this.dungeonCardState,
    options: { includeEnemyBoard?: boolean; turn?: number; resumeTurn?: number } = {}
  ): DungeonCarryover | null {
    const dice = this.gameState.dice
      .filter((die) => die.ownerId === 'player')
      .map((die) => {
        const transformIndex = this.transforms.getIndex(die.instanceId);
        const permanentTransform = this.transforms.isPermanent(die.instanceId);
        const wasTransformed = transformIndex !== undefined;
        const baseDefinition = wasTransformed ? this.getCombatBaseDefinition(die) : undefined;
        const definition = permanentTransform
          ? this.getDefinitionForInstance(die)
          : wasTransformed && baseDefinition
            ? this.applyDungeonCardDefinitionForOwner(baseDefinition, die.ownerId, this.instanceClassLevels.get(die.instanceId) ?? 1)
            : this.getDefinitionForInstance(die);
        const effectiveMaxHealth = permanentTransform
          ? die.maxHealth
          : wasTransformed && definition
            ? this.getDiceCardMaxHealthForDefinition(definition, die.ownerId)
            : die.maxHealth;
        const destroyed = die.isDestroyed || die.currentHealth <= 0;
        const effectiveCurrentHealth = destroyed
          ? 0
          : wasTransformed && die.maxHealth > 0
            ? Math.min(effectiveMaxHealth, Math.max(1, Math.round((die.currentHealth / die.maxHealth) * effectiveMaxHealth)))
            : die.currentHealth;
        const soulCount = Math.max(
          this.soulDiceSoulsConjured.get(die.instanceId) ?? 0,
          this.deathAlliesDefeatedCount.get(die.instanceId) ?? 0
        );
        const scopeStacks = this.scopeStacksByInstance.get(die.instanceId) ?? 0;
        const reviveCount = this.reviveCountByInstance.get(die.instanceId)
          ?? this.gameState.reviveCounts?.[die.instanceId]
          ?? 0;
        return {
          instanceId: die.instanceId,
          currentHealth: effectiveCurrentHealth,
          maxHealth: effectiveMaxHealth,
          isDestroyed: destroyed,
          mana: this.manaByInstance.get(die.instanceId) ?? 0,
          activeMana: [...(this.activeManaByInstance.get(die.instanceId) ?? new Map<string, number>()).entries()],
          statuses: this.captureDungeonStatuses(die.instanceId),
          attackCountEffectSeen: this.captureDungeonAttackCountEffectSeen(die.instanceId),
          attackCountBuff: (() => {
            const buff = this.extraAttackTurnsByInstance.get(die.instanceId);
            return buff && buff.extra > 0 && buff.turns > 0 ? { ...buff } : undefined;
          })(),
          projectileCountBuff: (() => {
            const buff = this.basicAttacksPerAttackByInstance.get(die.instanceId);
            return buff && buff.count > 1 && buff.turns > 0 ? { ...buff } : undefined;
          })(),
          manaPausedTurns: this.manaPausedTurnsByInstance.get(die.instanceId),
          typeId: die.typeId,
          classLevel: this.instanceClassLevels.get(die.instanceId) ?? 1,
          talentIndex: this.getInstanceTalentIndex(die),
          growthDelta: this.growthDeltaByInstance.get(die.instanceId) ?? 0,
          basicAttackDamage: this.basicAttackDamageBonusByInstance.get(die.instanceId) ?? 0,
          reviveCount,
          soulCount,
          scopeStacks,
          attack: definition?.attack,
          transformIndex: permanentTransform ? transformIndex : undefined,
          summonedByInstanceId: this.summonedByInstance.get(die.instanceId)
        };
      });
    const enemyDice = options.includeEnemyBoard === false ? [] : this.captureDungeonEnemyDice();
    return dice.length > 0
      ? {
        turn: Math.max(1, Math.floor(options.turn ?? this.gameState.turn)),
        ...(options.resumeTurn !== undefined ? { resumeTurn: Math.max(1, Math.floor(options.resumeTurn)) } : {}),
        dice,
        ...(enemyDice.length > 0 ? { enemyDice } : {}),
        diceCards: [...this.activeDiceCards],
        diceCardPicksUsed: this.diceCardPicksUsed,
        dungeonCards: normalizeDungeonCardState(cardState)
      }
      : null;
  }

  private captureDungeonEnemyDice(): DungeonCarryoverEnemyDie[] {
    return this.gameState.dice
      .filter((die) => die.ownerId === 'enemy')
      .map((die) => {
        const destroyed = die.isDestroyed || die.currentHealth <= 0;
        const definition = this.getDefinitionForInstance(die);
        const attackCountBuff = this.extraAttackTurnsByInstance.get(die.instanceId);
        const projectileCountBuff = this.basicAttacksPerAttackByInstance.get(die.instanceId);
        const reviveCount = this.reviveCountByInstance.get(die.instanceId)
          ?? this.gameState.reviveCounts?.[die.instanceId]
          ?? 0;
        return {
          instanceId: die.instanceId,
          typeId: die.typeId,
          classLevel: this.instanceClassLevels.get(die.instanceId) ?? 1,
          currentHealth: destroyed ? 0 : die.currentHealth,
          maxHealth: die.maxHealth,
          isDestroyed: destroyed,
          zone: destroyed ? 'eliminated' as const : die.zone,
          gridPosition: !destroyed && die.gridPosition ? { ...die.gridPosition } : undefined,
          attack: definition?.attack,
          statuses: this.captureDungeonStatuses(die.instanceId),
          mana: this.manaByInstance.get(die.instanceId) ?? 0,
          activeMana: [...(this.activeManaByInstance.get(die.instanceId) ?? new Map<string, number>()).entries()],
          attackCountEffectSeen: this.captureDungeonAttackCountEffectSeen(die.instanceId),
          attackCountBuff: attackCountBuff && attackCountBuff.extra > 0 && attackCountBuff.turns > 0 ? { ...attackCountBuff } : undefined,
          projectileCountBuff: projectileCountBuff && projectileCountBuff.count > 1 && projectileCountBuff.turns > 0 ? { ...projectileCountBuff } : undefined,
          manaPausedTurns: this.manaPausedTurnsByInstance.get(die.instanceId),
          reviveCount
        };
      });
  }

  private captureDungeonAttackCountEffectSeen(
    instanceId: string
  ): DungeonCarryoverDie['attackCountEffectSeen'] {
    const seen = this.attackCountEffectSeenByInstance.get(instanceId);
    if (!seen || (!seen.positive && !seen.negative)) return undefined;
    return {
      ...(seen.positive ? { positive: true } : {}),
      ...(seen.negative ? { negative: true } : {})
    };
  }

  private captureDungeonStatuses(instanceId: string): DungeonCarryoverStatuses {
    const statuses = this.statusEffects.capture(instanceId);
    const shieldHp = this.shieldHpByInstance.get(instanceId) ?? 0;
    const shieldTurns = this.shieldDurationTurnsByInstance.get(instanceId);
    return {
      ...statuses,
      shield: shieldHp > 0 && shieldTurns !== undefined && shieldTurns > 0 ? { hp: shieldHp, turns: shieldTurns } : undefined
    };
  }

  private applyDungeonCarryover() {
    if (this.activeChallenge !== 'dungeon' || !this.dungeonCarryover) return;
    const carryover = this.dungeonCarryover;
    this.dungeonEnemyCarryover = carryover.enemyDice ?? null;
    const restoredCardState = normalizeDungeonCardState(carryover.dungeonCards);
    this.dungeonCardState = ensureDungeonScopeMarks(restoredCardState, this.getDungeonScopeMarkRng(restoredCardState));
    this.dungeonCarryover = null;
    const allowedSavedIds = resolveDungeonCarryoverInstanceIds(
      carryover,
      this.gameState.dice
        .filter((die) => die.ownerId === 'player')
        .map((die) => ({ instanceId: die.instanceId, typeId: die.typeId })),
      this.dungeonModifier
    );
    const savedById = new Map(
      carryover.dice
        .filter((entry) => allowedSavedIds.has(entry.instanceId))
        .map((entry) => [entry.instanceId, entry] as const)
    );
    const restoredPermanentTransforms = new Set<string>();
    const resolveCarryoverBase = (saved: DungeonCarryoverDie): DiceDefinition | undefined => {
      if (!saved.typeId) return undefined;
      const cached = this.definitions.get(saved.typeId as DiceTypeId)
        ?? (this.cache.json.get(`dice:${saved.typeId}`) as DiceDefinition | undefined);
      if (!cached) return undefined;
      if (!this.definitions.has(cached.typeId)) this.definitions.set(cached.typeId, cached);
      return cached;
    };
    const restoreDungeonRuntimeState = (instanceId: string, saved: DungeonCarryoverDie) => {
      this.transforms.clearInstance(instanceId);
      if (saved.transformIndex !== undefined && restoredPermanentTransforms.has(instanceId)) {
        this.transforms.setIndex(instanceId, saved.transformIndex);
      }
      if (saved.summonedByInstanceId && allowedSavedIds.has(saved.summonedByInstanceId)) {
        this.summonedByInstance.set(instanceId, saved.summonedByInstanceId);
      } else {
        this.summonedByInstance.delete(instanceId);
      }
      const reviveCount = Number.isFinite(Number(saved.reviveCount))
        ? Math.max(0, Math.floor(Number(saved.reviveCount)))
        : 0;
      if (reviveCount > 0) {
        this.reviveCountByInstance.set(instanceId, reviveCount);
        this.gameState = {
          ...this.gameState,
          reviveCounts: { ...(this.gameState.reviveCounts ?? {}), [instanceId]: reviveCount }
        };
      } else {
        this.reviveCountByInstance.delete(instanceId);
      }
      const soulCount = Number.isFinite(Number(saved.soulCount))
        ? Math.max(0, Math.floor(Number(saved.soulCount)))
        : 0;
      if (soulCount > 0) {
        this.soulDiceSoulsConjured.set(instanceId, soulCount);
        this.deathAlliesDefeatedCount.set(instanceId, soulCount);
      }
      const scopeStacks = Number.isFinite(Number(saved.scopeStacks))
        ? Math.max(0, Math.floor(Number(saved.scopeStacks)))
        : 0;
      if (scopeStacks > 0) this.scopeStacksByInstance.set(instanceId, scopeStacks);
      else this.scopeStacksByInstance.delete(instanceId);
      const attackCountEffectSeen = saved.attackCountEffectSeen;
      if (attackCountEffectSeen?.positive || attackCountEffectSeen?.negative) {
        this.attackCountEffectSeenByInstance.set(instanceId, {
          positive: attackCountEffectSeen.positive === true,
          negative: attackCountEffectSeen.negative === true
        });
      } else {
        this.attackCountEffectSeenByInstance.delete(instanceId);
      }
    };
    const restoreDungeonTimedBuffs = (instanceId: string, saved: DungeonCarryoverDie) => {
      if (saved.isDestroyed) return;
      const attackCountBuff = saved.attackCountBuff;
      if (attackCountBuff && attackCountBuff.extra > 0 && attackCountBuff.turns > 0) {
        this.extraAttackTurnsByInstance.set(instanceId, {
          extra: Math.max(1, Math.floor(attackCountBuff.extra)),
          turns: Math.max(1, Math.floor(attackCountBuff.turns))
        });
      }
      const projectileCountBuff = saved.projectileCountBuff;
      if (projectileCountBuff && projectileCountBuff.count > 1 && projectileCountBuff.turns > 0) {
        this.basicAttacksPerAttackByInstance.set(instanceId, {
          count: Math.max(2, Math.floor(projectileCountBuff.count)),
          turns: Math.max(1, Math.floor(projectileCountBuff.turns))
        });
      }
      if (saved.manaPausedTurns !== undefined && saved.manaPausedTurns > 0) {
        this.manaPausedTurnsByInstance.set(instanceId, Math.max(1, Math.floor(saved.manaPausedTurns)));
      }
    };
    const getRestoredCardEffects = (typeId: string): DungeonCardEffects | undefined =>
      getDungeonCardEffects(this.dungeonCardState, typeId);
    const buildExpectedCarryoverDefinition = (
      base: DiceDefinition,
      classLevel: number,
      saved: DungeonCarryoverDie
    ): DiceDefinition => {
      let definition = this.applyClassProgress(applyDiceTalent(base, null, classLevel), classLevel);
      if (saved.transformIndex !== undefined && definition.transformStats?.[saved.transformIndex]) {
        definition = applyTransformStats(definition, saved.transformIndex);
        restoredPermanentTransforms.add(saved.instanceId);
      }
      return definition;
    };
    const normalizeCarryoverStats = (saved: DungeonCarryoverDie, expectedDefinition: DiceDefinition) => {
      const cardEffects = getRestoredCardEffects(expectedDefinition.typeId);
      const healthBonusRate = cardEffects?.healthBonusRate ?? 0;
      const health = resolveDungeonCarryoverHealth({
        savedMaxHealth: Number(saved.maxHealth),
        savedCurrentHealth: Number(saved.currentHealth),
        isDestroyed: saved.isDestroyed,
        expectedUncardedHealth: expectedDefinition.health,
        healthBonusRate
      });
      const attack = resolveDungeonCarryoverAttack({
        savedAttack: Number.isFinite(Number(saved.attack)) ? Number(saved.attack) : undefined,
        expectedUncardedAttack: expectedDefinition.attack,
        attackBonusRate: cardEffects?.attackBonusRate ?? 0
      });
      return {
        definition: {
          ...expectedDefinition,
          ...(attack !== undefined ? { attack } : {}),
          health: Math.max(1, Math.floor(health.maxHealth / (1 + healthBonusRate)))
        },
        maxHealth: health.maxHealth,
        currentHealth: health.currentHealth
      };
    };
    const restoredStatsById = new Map<string, {
      definition: DiceDefinition;
      classLevel: number;
      maxHealth: number;
      currentHealth: number;
    }>();
    carryover.dice.forEach((saved) => {
      if (!allowedSavedIds.has(saved.instanceId)) return;
      const initialDie = this.gameState.dice.find((die) => die.ownerId === 'player' && die.instanceId === saved.instanceId);
      const base = resolveCarryoverBase(saved) ?? (initialDie ? this.getBaseDefinitionForInstance(initialDie) : undefined);
      if (!base) return;
      const savedClassLevel = Math.max(1, Math.floor(saved.classLevel ?? 1));
      const initialClassLevel = initialDie ? this.instanceClassLevels.get(initialDie.instanceId) ?? 1 : 1;
      const classLevel = Math.max(savedClassLevel, initialClassLevel);
      const expectedDefinition = buildExpectedCarryoverDefinition(base, classLevel, saved);
      const stats = normalizeCarryoverStats(saved, expectedDefinition);
      restoredStatsById.set(saved.instanceId, { ...stats, classLevel });
    });

    carryover.dice
      .filter((saved) => allowedSavedIds.has(saved.instanceId))
      .filter((saved) => !this.gameState.dice.some((die) => die.ownerId === 'player' && die.instanceId === saved.instanceId))
      .forEach((saved) => {
        const base = resolveCarryoverBase(saved);
        const restored = restoredStatsById.get(saved.instanceId);
        if (!base || !restored) return;
        const destroyed = saved.isDestroyed || restored.currentHealth <= 0;
        this.gameState = {
          ...this.gameState,
          dice: [...this.gameState.dice, {
            instanceId: saved.instanceId,
            typeId: base.typeId,
            ownerId: 'player',
            zone: destroyed ? 'eliminated' as const : 'hand' as const,
            maxHealth: restored.maxHealth,
            currentHealth: destroyed ? 0 : restored.currentHealth,
            isDestroyed: destroyed,
            hasFinishedAttacking: true,
            attacksRemaining: 0,
            gridPosition: undefined
          }]
        };
        this.instanceDefinitionOverrides.set(saved.instanceId, restored.definition);
        this.instanceClassLevels.set(saved.instanceId, restored.classLevel);
        this.instanceTalentIndices.set(saved.instanceId, null);
        restoreDungeonRuntimeState(saved.instanceId, saved);
        restoreDungeonTimedBuffs(saved.instanceId, saved);
      });

    carryover.dice.forEach((saved) => {
      if (!allowedSavedIds.has(saved.instanceId)) return;
      const die = this.gameState.dice.find((candidate) => candidate.ownerId === 'player' && candidate.instanceId === saved.instanceId);
      if (!die) return;
      this.instanceTalentIndices.set(die.instanceId, null);
      const restored = restoredStatsById.get(saved.instanceId);
      if (!restored) return;
      this.instanceDefinitionOverrides.set(die.instanceId, restored.definition);
      this.instanceClassLevels.set(die.instanceId, restored.classLevel);
      this.gameState = {
        ...this.gameState,
        dice: this.gameState.dice.map((candidate) => candidate.instanceId === die.instanceId
          ? {
            ...candidate,
            maxHealth: restored.maxHealth,
            currentHealth: restored.currentHealth
          }
          : candidate)
      };
      restoreDungeonRuntimeState(saved.instanceId, saved);
      restoreDungeonTimedBuffs(saved.instanceId, saved);
    });

    normalizeDiceCardCarryover(carryover.diceCards).forEach((card) => this.applyDiceCard(card, 'player', false));
    this.diceCardPicksUsed = Math.max(0, Math.floor(carryover.diceCardPicksUsed ?? 0));

    this.gameState = {
      ...this.gameState,
      turn: carryover.resumeTurn ?? getDungeonNextWaveTurn(carryover.turn),
      dice: this.gameState.dice.map((die) => {
        if (die.ownerId !== 'player') return die;
        const saved = savedById.get(die.instanceId);
        const restored = restoredStatsById.get(die.instanceId);
        if (!saved || !restored) return die;
        if (saved.isDestroyed || restored.currentHealth <= 0) {
          return {
            ...die,
            maxHealth: restored.maxHealth,
            currentHealth: 0,
            isDestroyed: true,
            zone: 'eliminated' as const,
            gridPosition: undefined,
            attacksRemaining: 0,
            hasFinishedAttacking: true
          };
        }
        return {
          ...die,
          maxHealth: restored.maxHealth,
          currentHealth: restored.currentHealth,
          isDestroyed: false,
          zone: 'hand' as const,
          gridPosition: undefined,
          attacksRemaining: 0,
          hasFinishedAttacking: true
        };
      })
    };

    carryover.dice.forEach((saved) => {
      const die = this.gameState.dice.find((candidate) =>
        candidate.instanceId === saved.instanceId && candidate.ownerId === 'player'
      );
      if (!die) return;
      if (!die.isDestroyed) {
        const slots = this.getActiveManaSlots(die);
        const restored = new Map<string, number>();
        saved.activeMana.forEach(([key, value]) => {
          const slot = slots.find((candidate) => candidate.key === key);
          if (slot) restored.set(key, Phaser.Math.Clamp(value, 0, slot.manaNeeded));
        });
        if (restored.size > 0) this.activeManaByInstance.set(die.instanceId, restored);
        const cap = slots.reduce((max, slot) => Math.max(max, slot.manaNeeded), 0);
        const restoredMana = restored.size > 0 ? Math.max(...restored.values()) : 0;
        const mana = cap > 0 ? Math.min(cap, Math.max(saved.mana, restoredMana)) : saved.mana;
        if (mana > 0) this.manaByInstance.set(die.instanceId, mana);
        this.applyDungeonStatuses(die.instanceId, saved.statuses);
      }
      const growthDelta = saved.growthDelta ?? 0;
      if (growthDelta !== 0) this.growthDeltaByInstance.set(die.instanceId, growthDelta);
      const basicAttackDamage = saved.basicAttackDamage ?? 0;
      if (basicAttackDamage > 0) this.basicAttackDamageBonusByInstance.set(die.instanceId, basicAttackDamage);
    });
  }

  private applyDungeonEnemyCarryover() {
    const savedEnemies = this.dungeonEnemyCarryover;
    this.dungeonEnemyCarryover = null;
    if (this.activeChallenge !== 'dungeon' || !savedEnemies?.length) return;
    const savedById = new Map(savedEnemies.map((saved) => [saved.instanceId, saved] as const));
    this.gameState = {
      ...this.gameState,
      dice: this.gameState.dice.map((die) => {
        if (die.ownerId !== 'enemy') return die;
        const saved = savedById.get(die.instanceId);
        if (!saved || saved.typeId !== die.typeId) return die;
        const destroyed = saved.isDestroyed || saved.currentHealth <= 0;
        const maxHealth = Math.max(1, Math.floor(saved.maxHealth));
        const currentHealth = destroyed ? 0 : Math.max(1, Math.min(maxHealth, Math.floor(saved.currentHealth)));
        const gridPosition = destroyed || !saved.gridPosition ? undefined : { ...saved.gridPosition };
        return {
          ...die,
          maxHealth,
          currentHealth,
          isDestroyed: destroyed,
          zone: destroyed ? 'eliminated' as const : gridPosition ? 'board' as const : 'hand' as const,
          gridPosition,
          attacksRemaining: 0,
          hasFinishedAttacking: true
        };
      })
    };
    savedEnemies.forEach((saved) => {
      const die = this.gameState.dice.find((candidate) =>
        candidate.ownerId === 'enemy' && candidate.instanceId === saved.instanceId
      );
      if (!die || die.typeId !== saved.typeId) return;
      const savedClassLevel = Math.max(
        1,
        Math.floor(saved.classLevel ?? this.instanceClassLevels.get(die.instanceId) ?? 1)
      );
      this.instanceClassLevels.set(die.instanceId, savedClassLevel);
      this.enemyClassLevels.set(`${die.typeId}:${die.instanceId}`, savedClassLevel);
      const definition = this.instanceDefinitionOverrides.get(die.instanceId);
      if (definition) {
        this.instanceDefinitionOverrides.set(die.instanceId, {
          ...definition,
          health: Math.max(1, Math.floor(saved.maxHealth)),
          ...(saved.attack !== undefined ? { attack: saved.attack } : {})
        });
      }
      if (saved.attackCountEffectSeen?.positive || saved.attackCountEffectSeen?.negative) {
        this.attackCountEffectSeenByInstance.set(die.instanceId, {
          positive: saved.attackCountEffectSeen.positive === true,
          negative: saved.attackCountEffectSeen.negative === true
        });
      } else {
        this.attackCountEffectSeenByInstance.delete(die.instanceId);
      }
      if (saved.statuses) this.applyDungeonStatuses(die.instanceId, saved.statuses);
      if (saved.mana !== undefined && saved.mana > 0) this.manaByInstance.set(die.instanceId, saved.mana);
      if (saved.activeMana?.length) {
        const slots = this.getActiveManaSlots(die);
        const restored = new Map<string, number>();
        saved.activeMana.forEach(([key, value]) => {
          const slot = slots.find((candidate) => candidate.key === key);
          if (slot) restored.set(key, Phaser.Math.Clamp(value, 0, slot.manaNeeded));
        });
        if (restored.size > 0) this.activeManaByInstance.set(die.instanceId, restored);
      }
      if (!saved.isDestroyed) {
        if (saved.attackCountBuff) this.extraAttackTurnsByInstance.set(die.instanceId, { ...saved.attackCountBuff });
        if (saved.projectileCountBuff) this.basicAttacksPerAttackByInstance.set(die.instanceId, { ...saved.projectileCountBuff });
        if (saved.manaPausedTurns !== undefined && saved.manaPausedTurns > 0) this.manaPausedTurnsByInstance.set(die.instanceId, saved.manaPausedTurns);
      }
      if (saved.reviveCount !== undefined && saved.reviveCount > 0) {
        this.reviveCountByInstance.set(die.instanceId, saved.reviveCount);
        this.gameState = {
          ...this.gameState,
          reviveCounts: { ...(this.gameState.reviveCounts ?? {}), [die.instanceId]: saved.reviveCount }
        };
      }
    });
  }

  private applyDungeonStatuses(instanceId: string, statuses: DungeonCarryoverStatuses) {
    this.statusEffects.restore(instanceId, statuses);
    if (statuses.shield && statuses.shield.hp > 0 && statuses.shield.turns > 0) {
      this.shieldHpByInstance.set(instanceId, statuses.shield.hp);
      this.shieldDurationTurnsByInstance.set(instanceId, statuses.shield.turns);
    } else {
      this.shieldHpByInstance.delete(instanceId);
      this.shieldDurationTurnsByInstance.delete(instanceId);
    }
  }

  private openDungeonsModal() {
    this.clearModeModal();
    const savedRun = getDungeonRun(this);
    const event = getDungeonEventWindowForScene(this);
    const progress = getDungeonProgress(this);
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const tickets = Math.max(0, progress.ticketsRemaining);
    const canStart = !savedRun && event.active && tickets > 0;
    const previewKey = savedRun?.eventKey ?? (event.eventKey || new Date(event.nextStartsAt).toISOString().slice(0, 10));
    const previewModifier = this.getRandomModeDisplayName(getDungeonModifier(previewKey));
    const elements: Phaser.GameObjects.GameObject[] = [];
    const subtitle = savedRun
      ? `RUN IN PROGRESS • WAVE ${savedRun.wave}/${DUNGEON_MAX_WAVES} • RESUME FREE`
      : event.active
        ? `LIMITED EVENT • ${event.label} • ${tickets}/${DUNGEON_DAILY_TICKETS} TICKETS TODAY`
        : `LIMITED EVENT • NEXT WINDOW ${this.formatDungeonDate(event.nextStartsAt)}`;

    const overlay = this.add.rectangle(cx, cy, width, height, 0x000000, 0.68).setInteractive();
    elements.push(
      overlay,
      this.add.rectangle(cx, cy, 900, 560, 0x102434, 0.99).setStrokeStyle(2, 0x9b5f3a),
      this.add.text(cx, cy - 246, 'DUNGEONS', { fontFamily: 'Orbitron', fontSize: '26px', color: '#f4b860' }).setOrigin(0.5),
      this.add.text(cx, cy - 214, subtitle, { fontFamily: 'Orbitron', fontSize: '12px', color: event.active || savedRun ? '#ffd7a3' : PALETTE.textMuted }).setOrigin(0.5),
      this.add.text(cx - 380, cy - 182, 'YOUR LOADOUT', { fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.accentSoft }).setOrigin(0, 0.5)
    );

    const loadout = getDiceDefinitions(this);
    loadout.forEach((definition, index) => {
      const x = cx - 380 + 33 + index * 76;
      elements.push(...this.buildLoadoutDiceCard(definition, x, cy - 116, () => this.openDungeonsModal()));
    });

    elements.push(
      this.add.text(cx - 380, cy - 48, [
        'BATTLE THE DUNGEON KEEPER',
        `Modifier: ${previewModifier} (applies to your dice only)`,
        '5 dice • Class levels enabled • Talents disabled',
        'Survive as many of the 50 waves as you can.',
        '',
        'Waves 1–9 follow the fixed class curve.',
        'Every 10th wave is a random boss at 50% wave level.',
        'Enemy dice and minions cap at C15. Bosses do not.',
        'One ticket starts a run. A defeat ends the run.'
      ].join('\n'), {
        fontFamily: 'Orbitron',
        fontSize: '11px',
        color: PALETTE.text,
        lineSpacing: 4,
        wordWrap: { width: 400 }
      }).setOrigin(0, 0),
      this.add.rectangle(cx + 245, cy - 96, 330, 176, 0x173247, 0.96).setStrokeStyle(1, 0x406987),
      this.add.text(cx + 96, cy - 172, [
        savedRun ? `RUN: WAVE ${savedRun.wave}/${DUNGEON_MAX_WAVES}` : `EVENT: ${event.active ? 'LIVE' : 'CLOSED'}`,
        `TICKETS: ${tickets}/${DUNGEON_DAILY_TICKETS}`,
        `PERSONAL BEST: WAVE ${progress.bestWave}/${DUNGEON_MAX_WAVES}`,
        `MODIFIER: ${previewModifier.toUpperCase()}`,
        'OPPONENT: DUNGEON KEEPER',
        `NEXT EVENT: ${this.formatDungeonDate(event.nextStartsAt)}`,
        'RUN COST: 1 TICKET'
      ].join('\n'), {
        fontFamily: 'Orbitron',
        fontSize: '11px',
        color: PALETTE.text,
        lineSpacing: 5
      }).setOrigin(0, 0),
      this.add.rectangle(cx + 245, cy + 76, 330, 168, 0x173247, 0.96).setStrokeStyle(1, 0x406987),
      this.add.text(cx + 96, cy + 2, [
        'STAGE REWARD PREVIEW',
        ...DUNGEON_REWARD_WAVES.map((wave) => `W${wave}: ${this.getDungeonRewardText(getDungeonStageReward(previewKey, wave), previewKey)}`)
      ].join('\n'), {
        fontFamily: 'Orbitron',
        fontSize: '9px',
        color: PALETTE.textMuted,
        lineSpacing: 2,
        wordWrap: { width: 300 }
      }).setOrigin(0, 0)
    );

    const startEnabled = Boolean(savedRun) || canStart;
    const startButton = this.add.rectangle(cx + 245, cy + 230, 280, 46, startEnabled ? 0x2ecc71 : 0x3e4f5c, 0.95)
      .setStrokeStyle(2, startEnabled ? 0xffffff : 0x8ea1b2);
    const startLabel = this.add.text(cx + 245, cy + 230, savedRun ? `RESUME WAVE ${savedRun.wave}` : !event.active ? 'EVENT CLOSED' : tickets > 0 ? 'ENTER DUNGEONS' : 'NO TICKETS LEFT', {
      fontFamily: 'Orbitron',
      fontSize: '14px',
      color: startEnabled ? '#071018' : '#c8d2da'
    }).setOrigin(0.5);
    if (startEnabled) {
      startButton.setInteractive({ useHandCursor: true });
      startButton.on('pointerover', () => startButton.setAlpha(1));
      startButton.on('pointerout', () => startButton.setAlpha(0.95));
      startButton.on('pointerdown', () => {
        const activeRun = getDungeonRun(this);
        if (activeRun) {
          this.dungeonConfigSnapshot = activeRun.config;
          this.dungeonEventKey = activeRun.eventKey;
          this.dungeonWave = activeRun.wave;
          this.dungeonCarryover = activeRun.carryover;
          this.dungeonLoadoutSnapshot = activeRun.loadout ?? null;
          this.startDungeonWave(activeRun.wave, { resuming: true });
          return;
        }
        const latestEvent = getDungeonEventWindowForScene(this);
        if (!latestEvent.active) {
          AlertManager.toast(this, { type: 'warning', message: 'The Dungeon event has closed.' });
          this.openDungeonsModal();
          return;
        }
        if (!this.dungeonConfigSnapshot) {
          this.dungeonConfigSnapshot = {
            randomMode: this.configRandomMode,
            randomizeLoadout: this.configRandomizeLoadoutAndClassUps,
            useLevelling: this.configUseLevelling
          };
        }
        this.dungeonEventKey = latestEvent.eventKey;
        this.startDungeonWave(1, { ticketPurchase: true });
      });
    }

    const back = this.add.text(cx - 330, cy + 230, '← BACK', {
      fontFamily: 'Orbitron',
      fontSize: '13px',
      color: PALETTE.accentSoft,
      backgroundColor: '#173247',
      padding: { left: 12, right: 12, top: 7, bottom: 7 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => this.clearModeModal());
    elements.push(startButton, startLabel, back);

    overlay.on('pointerdown', () => this.clearModeModal());
    this.modalContainer = this.add.container(0, 0, elements).setDepth(250);
    this.setModalEsc(() => this.clearModeModal());
  }

  private openSingleplayerConfigModal() {
    this.activeChallenge = null;
    this.turnLimit = this.configTurnCount;
    this.clearModeModal();
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const elements: Phaser.GameObjects.GameObject[] = [];

    const randomizeClassLabel = this.add.text(cx - 265, cy + 112, 'Randomise Loadout / Class UP', {
      fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.textMuted
    }).setOrigin(0, 0.5);

    elements.push(
      this.add.rectangle(cx, cy, width, height, 0x000000, 0.6).setInteractive(),
      this.add.rectangle(cx, cy, 640, 480, 0x102434, 0.98).setStrokeStyle(2, 0x335770),
      this.add.text(cx, cy - 200, 'SINGLEPLAYER', {
        fontFamily: 'Orbitron', fontSize: '22px', color: PALETTE.accent
      }).setOrigin(0.5),
      this.add.text(cx - 265, cy - 120, 'Difficulty', {
        fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.textMuted
      }).setOrigin(0, 0.5),
      this.add.text(cx - 265, cy - 62, 'Use Levelling', {
        fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.textMuted
      }).setOrigin(0, 0.5),
      this.add.text(cx - 265, cy - 4, 'Turn Count', {
        fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.textMuted
      }).setOrigin(0, 0.5),
      this.add.text(cx - 265, cy + 54, 'Random Mode', {
        fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.textMuted
      }).setOrigin(0, 0.5),
      randomizeClassLabel
    );

    const rowContainer = this.add.container(0, 0);
    elements.push(rowContainer);


    const difficultyMeta: { label: string; value: BotDifficulty; reward: string }[] = [
      { label: 'BABY', value: 'Baby', reward: '+500T / +20C' },
      { label: 'EASY', value: 'Easy', reward: '+1000T / +40C' },
      { label: 'MEDIUM', value: 'Medium', reward: '+2000T / +60C' },
      { label: 'HARD', value: 'Hard', reward: '+5000T / +80C' },
      { label: 'NIGHTMARE', value: 'Nightmare', reward: '+10000T / +100C' }
    ];
    const rewardHint = this.add.text(cx + 72, cy - 156, '', {
      fontFamily: 'Orbitron', fontSize: '10px', color: '#f4cf8a', align: 'center', wordWrap: { width: 520 }
    }).setOrigin(0.5);
    elements.push(rewardHint);
    const refreshDifficultyHint = () => {
      const selected = difficultyMeta.find((item) => item.value === this.configDifficulty) ?? difficultyMeta[0];
      const claimed = this.singleplayer.hasClaimedBotFirstWin(this, selected.value);
      const firstWinStatus = claimed
        ? 'CLAIMED'
        : this.singleplayer.isFirstWinEligible()
          ? 'UNCLAIMED'
          : 'DISABLED IN RANDOM MODES';
      rewardHint.setText(`Selected: ${selected.label}  •  First-win reward ${selected.reward} (${firstWinStatus})`);
    };

    this.makeSelectRow(
      difficultyMeta.map((item) => ({ label: item.label, value: item.value })),
      () => this.configDifficulty, (v) => {
        this.configDifficulty = v;
        refreshDifficultyHint();
      },
      cx + 72, cy - 120, rowContainer
    );
    refreshDifficultyHint();
    this.makeSelectRow(
      [{ label: 'ON', value: true }, { label: 'OFF', value: false }],
      () => this.configUseLevelling, (v) => { this.configUseLevelling = v; },
      cx - 12, cy - 62, rowContainer
    );
    this.makeSelectRow(
      [{ label: '3', value: 3 }, { label: '5', value: 5 }, { label: '7', value: 7 }, { label: '10', value: 10 }, { label: '∞', value: -1 }],
      () => this.configTurnCount, (v) => { this.configTurnCount = v; },
      cx + 84, cy - 4, rowContainer
    );
    this.makeSelectRow(
      [{ label: 'ON', value: true }, { label: 'OFF', value: false }],
      () => this.configRandomMode, (v) => { this.configRandomMode = v; refreshDifficultyHint(); },
      cx - 12, cy + 54, rowContainer
    );
    this.makeSelectRow(
      [{ label: 'ON', value: true }, { label: 'OFF', value: false }],
      () => this.configRandomizeLoadoutAndClassUps, (v) => { this.configRandomizeLoadoutAndClassUps = v; refreshDifficultyHint(); },
      cx + 96, cy + 112, rowContainer
    );

    const noteText = this.add.text(cx, cy + 160, 'Difficulty sets bot class range, loadout, and placement.\nRandomise Loadout/Class UP rerolls both sides; Random Mode adds a random game modifier.', {
      fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.textMuted, align: 'center', lineSpacing: 3, wordWrap: { width: 570 }
    }).setOrigin(0.5);
    elements.push(noteText);

    const backButton = this.add.rectangle(cx - 90, cy + 208, 150, 38, 0x173247, 0.95)
      .setStrokeStyle(1, 0x406987).setInteractive({ useHandCursor: true });
    const backLabel = this.add.text(cx - 90, cy + 208, '← BACK', {
      fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.accentSoft
    }).setOrigin(0.5);
    backButton.on('pointerover', () => backButton.setFillStyle(0x233d52, 0.95));
    backButton.on('pointerout', () => backButton.setFillStyle(0x173247, 0.95));
    backButton.on('pointerdown', () => this.openSingleplayerModal());
    elements.push(backButton, backLabel);

    const startButton = this.add.rectangle(cx + 90, cy + 208, 150, 38, 0x2ecc71, 0.95)
      .setStrokeStyle(1, 0xffffff).setInteractive({ useHandCursor: true });
    const startLabel = this.add.text(cx + 90, cy + 208, 'START →', {
      fontFamily: 'Orbitron', fontSize: '13px', color: '#000000'
    }).setOrigin(0.5);
    startButton.on('pointerover', () => startButton.setFillStyle(0x45d98a, 1));
    startButton.on('pointerout', () => startButton.setFillStyle(0x2ecc71, 0.95));
    startButton.on('pointerdown', () => {
      this.activeChallenge = null;
      this.activeDailyKey = '';
      this.turnLimit = this.configTurnCount;
      this.clearModeModal();
      this.startGame();
    });
    elements.push(startButton, startLabel);

    this.modalContainer = this.add.container(0, 0, elements).setDepth(250);
    this.setModalEsc(() => this.openSingleplayerModal());
  }

  private openMultiplayerModal() {
    this.clearModeModal();
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const elements: Phaser.GameObjects.GameObject[] = [];

    elements.push(
      this.add.rectangle(cx, cy, width, height, 0x000000, 0.6).setInteractive(),
      this.add.rectangle(cx, cy, 660, 320, 0x102434, 0.98).setStrokeStyle(2, 0x335770),
      this.add.text(cx, cy - 128, 'MULTIPLAYER SESSIONS', {
        fontFamily: 'Orbitron', fontSize: '22px', color: PALETTE.accent
      }).setOrigin(0.5),
      this.add.text(cx, cy - 92, 'Join a friend by code, or create a lobby with configurable rules.', {
        fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.textMuted
      }).setOrigin(0.5)
    );

    const makeSessionCard = (x: number, title: string, subtitle: string, color: number, onClick: () => void) => {
      const card = this.add.rectangle(x, cy + 12, 220, 122, color, 0.94)
        .setStrokeStyle(2, 0x8fd5ff)
        .setInteractive({ useHandCursor: true });
      const titleText = this.add.text(x, cy - 22, title, {
        fontFamily: 'Orbitron', fontSize: '17px', color: '#ffffff'
      }).setOrigin(0.5);
      const subText = this.add.text(x, cy + 10, subtitle, {
        fontFamily: 'Orbitron', fontSize: '10px', color: '#e6f4ff', align: 'center', wordWrap: { width: 190 }
      }).setOrigin(0.5, 0);
      card.on('pointerover', () => card.setAlpha(1));
      card.on('pointerout', () => card.setAlpha(0.94));
      card.on('pointerdown', onClick);
      elements.push(card, titleText, subText);
    };

    makeSessionCard(cx - 140, 'JOIN', 'Enter a 6-digit lobby code from a friend.', 0x2d6f99, () => this.openMultiplayerJoinModal());
    makeSessionCard(cx + 140, 'CREATE', 'Configure a friend lobby and share your generated code.', 0x2d9968, () => this.openMultiplayerCreateModal());

    const backButton = this.add.rectangle(cx, cy + 128, 150, 38, 0x173247, 0.95)
      .setStrokeStyle(1, 0x406987).setInteractive({ useHandCursor: true });
    const backLabel = this.add.text(cx, cy + 128, '← BACK', {
      fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.accentSoft
    }).setOrigin(0.5);
    backButton.on('pointerover', () => backButton.setFillStyle(0x233d52, 0.95));
    backButton.on('pointerout', () => backButton.setFillStyle(0x173247, 0.95));
    backButton.on('pointerdown', () => this.openModeSelectModal());
    elements.push(backButton, backLabel);

    this.modalContainer = this.add.container(0, 0, elements).setDepth(250);
    this.setModalEsc(() => this.openModeSelectModal());
  }

  private openMultiplayerJoinModal() {
    const throttle = this.multiplayer.canAttemptLobbyJoin();
    if (!throttle.allowed) {
      AlertManager.toast(this, {
        type: 'warning',
        message: `Too many invalid lobby codes. Try again in ${Math.ceil(throttle.remainingMs / 1000)}s.`
      });
      return;
    }
    const rawCode = window.prompt('Enter 6-digit lobby code', '');
    if (rawCode === null) return;
    const lobbyCode = normalizeLobbyCode(rawCode);
    if (!lobbyCode) {
      this.multiplayer.registerFailedLobbyJoin();
      AlertManager.toast(this, { type: 'warning', message: 'Enter a valid 6-character lobby code.' });
      return;
    }
    void this.queueArenaMultiplayer({ mode: 'multiplayer', lobbyAction: 'join', lobbyCode });
  }

  private openMultiplayerCreateModal() {
    this.clearModeModal();
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const elements: Phaser.GameObjects.GameObject[] = [];

    elements.push(
      this.add.rectangle(cx, cy, width, height, 0x000000, 0.6).setInteractive(),
      this.add.rectangle(cx, cy, 660, 430, 0x102434, 0.98).setStrokeStyle(2, 0x335770),
      this.add.text(cx, cy - 190, 'CREATE LOBBY', {
        fontFamily: 'Orbitron', fontSize: '22px', color: PALETTE.accent
      }).setOrigin(0.5),
      this.add.text(cx - 265, cy - 120, 'Turn Count', {
        fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.textMuted
      }).setOrigin(0, 0.5),
      this.add.text(cx - 265, cy - 60, 'Random Mode', {
        fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.textMuted
      }).setOrigin(0, 0.5),
      this.add.text(cx - 265, cy + 0, 'Randomise Loadout / Class UP', {
        fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.textMuted
      }).setOrigin(0, 0.5)
    );

    const rowContainer = this.add.container(0, 0);
    elements.push(rowContainer);
    this.makeSelectRow(
      [{ label: '3', value: 3 }, { label: '5', value: 5 }, { label: '7', value: 7 }, { label: '10', value: 10 }, { label: '∞', value: -1 }],
      () => this.configTurnCount, (v) => { this.configTurnCount = v; },
      cx + 84, cy - 120, rowContainer
    );
    this.makeSelectRow(
      [{ label: 'ON', value: true }, { label: 'OFF', value: false }],
      () => this.configRandomMode, (v) => { this.configRandomMode = v; },
      cx - 12, cy - 60, rowContainer
    );
    this.makeSelectRow(
      [{ label: 'ON', value: true }, { label: 'OFF', value: false }],
      () => this.configRandomizeLoadoutAndClassUps, (v) => { this.configRandomizeLoadoutAndClassUps = v; },
      cx + 96, cy + 0, rowContainer
    );

    const noteText = this.add.text(cx, cy + 58, 'Lobby configuration takes into account on both clients.\nRandomise Loadout/Class UP rerolls both sides; Random Mode adds a random game modifier.', {
      fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.textMuted, align: 'center', lineSpacing: 3
    }).setOrigin(0.5);
    elements.push(noteText);

    const backButton = this.add.rectangle(cx - 90, cy + 183, 150, 38, 0x173247, 0.95)
      .setStrokeStyle(1, 0x406987).setInteractive({ useHandCursor: true });
    const backLabel = this.add.text(cx - 90, cy + 183, '← BACK', {
      fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.accentSoft
    }).setOrigin(0.5);
    backButton.on('pointerover', () => backButton.setFillStyle(0x233d52, 0.95));
    backButton.on('pointerout', () => backButton.setFillStyle(0x173247, 0.95));
    backButton.on('pointerdown', () => this.openMultiplayerModal());
    elements.push(backButton, backLabel);

    const createButton = this.add.rectangle(cx + 90, cy + 183, 150, 38, 0x2ecc71, 0.95)
      .setStrokeStyle(1, 0xffffff).setInteractive({ useHandCursor: true });
    const createLabel = this.add.text(cx + 90, cy + 183, 'CREATE →', {
      fontFamily: 'Orbitron', fontSize: '13px', color: '#000000'
    }).setOrigin(0.5);
    createButton.on('pointerover', () => createButton.setFillStyle(0x45d98a, 1));
    createButton.on('pointerout', () => createButton.setFillStyle(0x2ecc71, 0.95));
    createButton.on('pointerdown', () => {
      if (!this.multiplayer.configured) {
        AlertManager.toast(this, { type: 'warning', message: this.multiplayer.status.message });
        return;
      }
      this.openMultiplayerLobbyWaitModal();
      void this.queueArenaMultiplayer({ mode: 'multiplayer', lobbyAction: 'create' });
    });
    elements.push(createButton, createLabel);

    this.modalContainer = this.add.container(0, 0, elements).setDepth(250);
    this.setModalEsc(() => this.openMultiplayerModal());
  }

  private openMultiplayerLobbyWaitModal(lobbyCode = '') {
    this.clearModeModal();
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const codeText = this.add.text(cx, cy - 50, lobbyCode || 'CREATING...', {
      fontFamily: 'Orbitron', fontSize: '44px', color: '#f4b860'
    }).setOrigin(0.5);
    this.multiplayerLobbyCodeText = codeText;
    const leaveBtn = this.add.text(cx, cy + 116, 'LEAVE LOBBY', {
      fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.accentSoft,
      backgroundColor: '#173247', padding: { left: 16, right: 16, top: 7, bottom: 7 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    leaveBtn.on('pointerdown', () => {
      this.multiplayer.leaveSession();
      this.openMultiplayerModal();
    });
    this.modalContainer = this.add.container(0, 0, [
      this.add.rectangle(cx, cy, width, height, 0x000000, 0.6).setInteractive(),
      this.add.rectangle(cx, cy, 620, 330, 0x102434, 0.98).setStrokeStyle(2, 0x335770),
      this.add.text(cx, cy - 120, 'LOBBY READY', { fontFamily: 'Orbitron', fontSize: '22px', color: PALETTE.accent }).setOrigin(0.5),
      codeText,
      this.add.text(cx, cy + 12, 'Share this server-generated code with your friend.\nWaiting for Rivalis to match the lobby...', {
        fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.textMuted, align: 'center'
      }).setOrigin(0.5),
      leaveBtn
    ]).setDepth(250);
    this.setModalEsc(() => {
      this.multiplayer.leaveSession();
      this.openMultiplayerModal();
    });
  }

  private updateMultiplayerLobbyCode(lobbyCode: string) {
    this.multiplayer.updateLobbyCode(lobbyCode);
    if (this.multiplayerLobbyCodeText?.active) {
      this.multiplayerLobbyCodeText.setText(lobbyCode);
    }
  }

  private async queueArenaMultiplayer(options: { mode: 'matchmaking' | 'multiplayer'; lobbyAction?: 'create' | 'join'; lobbyCode?: string }): Promise<void> {
    const profile = ProfileStore.get(this);
    this.playerDisplayName = profile.username || 'Player';
    this.enemyDisplayName = options.mode === 'matchmaking' ? 'Rivalis Opponent' : 'Friend';
    this.turnLimit = options.mode === 'matchmaking' ? 10 : this.configTurnCount;
    this.activeChallenge = null;
    this.activeDailyKey = '';
    const loadout = getDiceDefinitions(this).map((definition) => ({
      typeId: definition.typeId,
      classLevel: 1,
      talentIndex: null
    }));
    if (!this.multiplayer.configured) {
      AlertManager.toast(this, { type: 'warning', message: this.multiplayer.status.message });
      return;
    }
    const useLobbyRandomisers = options.mode === 'multiplayer';
    const request = {
      mode: options.mode,
      ...(options.mode === 'multiplayer'
        ? options.lobbyAction === 'join' && options.lobbyCode
          ? { lobbyAction: 'join' as const, lobbyCode: options.lobbyCode }
          : { lobbyAction: 'create' as const }
        : {}),
      ruleset: 'classic' as const,
      rules: {
        useLevelling: useLobbyRandomisers && this.configRandomizeLoadoutAndClassUps,
        turnLimit: this.turnLimit,
        randomMode: useLobbyRandomisers && this.configRandomMode,
        randomizeLoadout: useLobbyRandomisers && this.configRandomizeLoadoutAndClassUps
      },
      loadout
    };
    try {
      const status = await this.multiplayer.queue(request, this.playerDisplayName, (next) => {
        AlertManager.toast(this, {
          type: next.state === 'failed' || next.state === 'disabled' ? 'warning' : 'success',
          message: next.message
        });
        if (next.state === 'lobby' && next.lobbyCode) {
          this.updateMultiplayerLobbyCode(next.lobbyCode);
        }
        if (next.state === 'failed' || next.state === 'disabled') {
          this.closeMultiplayerLobbyWaitOnFailure(options);
        }
      });
      if (status.state === 'failed' || status.state === 'disabled') {
        this.closeMultiplayerLobbyWaitOnFailure(options);
      }
    } catch (error) {
      this.closeMultiplayerLobbyWaitOnFailure(options);
      AlertManager.toast(this, {
        type: 'warning',
        message: error instanceof Error ? error.message : 'Unable to create the multiplayer lobby.'
      });
    }
  }

  private closeMultiplayerLobbyWaitOnFailure(options: { mode: 'matchmaking' | 'multiplayer'; lobbyAction?: 'create' | 'join' }) {
    if (options.mode !== 'multiplayer' || options.lobbyAction !== 'create') return;
    if (!this.multiplayerLobbyCodeText?.active) return;
    this.openMultiplayerCreateModal();
  }

  private makeSelectRow<T extends string | number | boolean>(
    options: { label: string; value: T }[],
    getter: () => T,
    setter: (v: T) => void,
    cx: number,
    cy: number,
    container: Phaser.GameObjects.Container
  ): Phaser.GameObjects.Container {
    const rowGroup = this.add.container(0, 0);
    container.add(rowGroup);
    if (options.length === 0) return rowGroup;
    const availableWidth = Math.max(280, this.scale.width - 120);
    const gap = options.length > 4 ? 6 : 8;
    const idealBtnW = options.length > 4 ? 82 : 72;
    const btnW = Math.max(56, Math.min(idealBtnW, Math.floor((availableWidth - (options.length - 1) * gap) / options.length)));
    const totalW = options.length * btnW + (options.length - 1) * gap;
    const startX = cx - totalW / 2 + btnW / 2;

    const buttons: { rect: Phaser.GameObjects.Rectangle; text: Phaser.GameObjects.Text; value: T }[] = [];

    const refresh = () => {
      const selected = getter();
      buttons.forEach(({ rect, text, value }) => {
        const active = value === selected;
        rect.setFillStyle(active ? 0xf4b860 : 0x173247, active ? 1 : 0.85);
        rect.setStrokeStyle(1, active ? 0xf4b860 : 0x3f627c);
        text.setColor(active ? '#0b1520' : '#99b2c3');
      });
    };

    options.forEach((opt, i) => {
      const x = startX + i * (btnW + gap);
      const rect = this.add.rectangle(x, cy, btnW, 28, 0x173247, 0.85)
        .setStrokeStyle(1, 0x3f627c).setInteractive({ useHandCursor: true });
      const text = this.add.text(x, cy, opt.label, {
        fontFamily: 'Orbitron', fontSize: btnW <= 60 ? '10px' : '12px', color: '#99b2c3'
      }).setOrigin(0.5);
      rect.on('pointerdown', () => { setter(opt.value); refresh(); });
      rect.on('pointerover', () => { if (getter() !== opt.value) rect.setFillStyle(0x233d52, 0.9); });
      rect.on('pointerout', () => refresh());
      buttons.push({ rect, text, value: opt.value });
      rowGroup.add([rect, text]);
    });

    refresh();
    return rowGroup;
  }

  // ── GAME START ───────────────────────────────────────────────────────────────

  private startGame() {
    const multiplayerSetup = this.multiplayerMatch;
    const selectedTurnLimit = this.turnLimit;
    const selectedChallenge = this.activeChallenge;
    const selectedDailyKey = this.activeDailyKey;
    const selectedDailyHard = this.dailyHard;
    const selectedEnemyDisplayName = this.enemyDisplayName;
    const selectedPlayerDisplayName = this.playerDisplayName;
    const selectedBossfightBoss = this.bossfightCurrentBoss;
    const selectedBossfightLevel = this.bossfightLevel;
    const selectedDungeonWave = this.dungeonWave;
    const selectedDungeonBoss = this.dungeonBoss;
    const selectedDungeonBossRole = this.dungeonBossRole;
    const selectedDungeonBossMinionType = this.dungeonBossMinionType;
    const selectedDungeonEnemyClasses = [...this.dungeonEnemyClasses];
    const selectedDungeonEventKey = this.dungeonEventKey;
    const selectedDungeonModifier = this.dungeonModifier;
    const selectedDungeonRunActive = this.dungeonRunActive;

    this.resetRuntimeState();
    if (multiplayerSetup) this.multiplayer.beginMatch(multiplayerSetup);

    this.turnLimit = selectedChallenge === 'dungeon' ? -1 : selectedTurnLimit === -1 ? this.configTurnCount : selectedTurnLimit;
    this.activeChallenge = selectedChallenge;
    this.activeDailyKey = selectedDailyKey;
    this.dailyHard = selectedDailyHard;
    this.enemyDisplayName = selectedEnemyDisplayName;
    this.playerDisplayName = selectedPlayerDisplayName;
    this.bossfightCurrentBoss = selectedBossfightBoss;
    this.bossfightLevel = selectedBossfightLevel;
    this.dungeonWave = selectedDungeonWave;
    this.dungeonBoss = selectedDungeonBoss;
    this.dungeonBossRole = selectedDungeonBossRole;
    this.dungeonBossMinionType = selectedDungeonBossMinionType;
    this.dungeonEnemyClasses = selectedDungeonEnemyClasses;
    this.dungeonEventKey = selectedDungeonEventKey;
    this.dungeonModifier = selectedDungeonModifier;
    this.dungeonRunActive = selectedDungeonRunActive;
    this.combatLogMatchId += 1;
    this.gamePhase = { stage: 'placement' };
    this.matchStartedAtMs = Date.now();
    if (this.uiContainer?.active) {
      const loading = this.add.rectangle(this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height, 0x050d14, 0.95).setDepth(500);
      const loadingLabel = this.add.text(this.scale.width / 2, this.scale.height / 2, 'BATTLE DICE\nCaching arena...', { fontFamily: 'Orbitron', fontSize: '24px', color: PALETTE.text, align: 'center' }).setOrigin(0.5).setDepth(501);
      this.tweens.add({
        targets: this.uiContainer,
        alpha: 0,
        y: -40,
        duration: 320,
        ease: 'Cubic.easeIn',
        onComplete: () => {
          this.scene.sleep(SCENE_KEYS.Menu);
          this.uiContainer.destroy();
          this.createGameUI();
          if (this.multiplayerMatch) this.initializeMultiplayerBattle(this.multiplayerMatch);
          else void this.initializeBattle();
          this.time.delayedCall(550, () => {
            loading.destroy();
            loadingLabel.destroy();
          });
        }
      });
      return;
    }

    this.gameContainer?.destroy(true);
    this.createGameUI();
    if (this.multiplayerMatch) this.initializeMultiplayerBattle(this.multiplayerMatch);
    else void this.initializeBattle();
  }

  private createGameUI() {
    const { width, height } = this.scale;

    this.gameContainer = this.add.container(0, 0);
    this.backButton = this.add.text(24, 20, '← BACK / QUIT', {
      fontFamily: 'Orbitron',
      fontSize: '14px',
      color: PALETTE.accentSoft,
      backgroundColor: '#173247',
      padding: { left: 10, right: 10, top: 6, bottom: 6 }
    }).setInteractive({ useHandCursor: true });
    this.backButton.on('pointerdown', () => this.toggleExitPrompt());
    this.input.keyboard?.off('keydown-ESC', this.escapeKeyHandler);
    this.input.keyboard?.on('keydown-ESC', this.escapeKeyHandler);
    this.combatHistoryButton = this.add.text(width - 24, 20, 'LOG HISTORY [L]', {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.accentSoft,
      backgroundColor: '#173247',
      padding: { left: 10, right: 10, top: 6, bottom: 6 }
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    this.combatHistoryButton.on('pointerdown', () => this.openCombatLogHistoryModal());
    this.input.keyboard?.off('keydown-L', this.combatLogKeyHandler);
    this.input.keyboard?.on('keydown-L', this.combatLogKeyHandler);

    this.turnText = this.add.text(width / 2, 60, 'TURN 1', {
      fontFamily: 'Orbitron',
      fontSize: '28px',
      color: PALETTE.accent
    }).setOrigin(0.5).setVisible(false);
    this.updateTurnLabel();
    this.destroyDicePreviewViews();
    this.releaseDicePreviewWheelHandler();
    this.dicePreviewWheelHandler = (pointer, _gameObjects, _dx, dy) => this.handleDicePreviewWheel(pointer, dy);
    this.input.on('wheel', this.dicePreviewWheelHandler);

    const arenaY = height / 2 - 50;
    const boardWidth = GRID_SIZE * (TILE_SIZE + TILE_GAP) - TILE_GAP;
    const gap = 36;
    const boardScale = Math.min(1, (width - 64) / (boardWidth * 2 + gap));
    const scaledBoardWidth = boardWidth * boardScale;
    const playerX = width / 2 - gap / 2 - scaledBoardWidth;
    const enemyX = width / 2 + gap / 2;
    const gridY = arenaY - scaledBoardWidth / 2;

    this.playerGridContainer = this.createGrid(playerX, gridY, 'YOUR GRID', true);
    this.enemyGridContainer = this.createGrid(enemyX, gridY, 'ENEMY GRID', false);
    this.playerGridContainer.setScale(boardScale);
    this.enemyGridContainer.setScale(boardScale);
    this.playerStatusPanel = this.add.container(Math.max(80, playerX * 0.5), gridY + 8);
    this.enemyStatusPanel = this.add.container(width - 220, gridY + 8);

    this.gameContainer.add([this.turnText, this.playerGridContainer, this.enemyGridContainer, this.backButton, this.combatHistoryButton, this.playerStatusPanel, this.enemyStatusPanel]);
  }

  private updateTurnLabel() {
    if (!this.turnText) return;
    this.turnText.setText(formatTurnWaveLabel(
      this.gameState?.turn ?? 1,
      this.turnLimit,
      this.activeChallenge === 'dungeon' ? this.dungeonWave : undefined,
      this.activeChallenge === 'dungeon' ? DUNGEON_MAX_WAVES : undefined
    ));
  }

  private createGrid(x: number, y: number, title: string, isPlayer: boolean): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);
    const boardWidth = GRID_SIZE * (TILE_SIZE + TILE_GAP) - TILE_GAP;
    const boardHeight = GRID_SIZE * (TILE_SIZE + TILE_GAP) - TILE_GAP;

    container.add(this.add.text(boardWidth / 2, -30, title, {
      fontFamily: 'Orbitron',
      fontSize: '18px',
      color: isPlayer ? PALETTE.ice : PALETTE.danger
    }).setOrigin(0.5));

    container.add(this.add.rectangle(boardWidth / 2, boardHeight / 2, boardWidth + 16, boardHeight + 16, 0x102434, 0.96)
      .setStrokeStyle(2, isPlayer ? 0x406987 : 0x6b4c4c));

    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const tileX = col * (TILE_SIZE + TILE_GAP);
        const tileY = row * (TILE_SIZE + TILE_GAP);
        container.add(this.add.rectangle(tileX + TILE_SIZE / 2, tileY + TILE_SIZE / 2, TILE_SIZE, TILE_SIZE, 0x183447, 0.98)
          .setStrokeStyle(1, 0x42657f));
      }
    }

    if (!isPlayer) {
      this.enemyFogOverlay = this.add.rectangle(boardWidth / 2, boardHeight / 2, boardWidth + 16, boardHeight + 16, 0x0a1925, 0.92)
        .setStrokeStyle(2, 0x6b4c4c);
      container.add(this.enemyFogOverlay);

      this.enemyFogText = this.add.text(boardWidth / 2, boardHeight / 2, 'HIDDEN', {
        fontFamily: 'Orbitron',
        fontSize: '16px',
        color: PALETTE.danger
      }).setOrigin(0.5);
      container.add(this.enemyFogText);
    }

    return container;
  }

  private rollEnemyClassLevel(): number {
    const [minClass, maxClass] = this.singleplayer.getClassRange();
    return Phaser.Math.Between(minClass, maxClass);
  }

  private async initializeBattle() {
    const allDefinitions = getAllDiceDefinitions(this).map((definition) => ({
      ...definition,
      skills: getValidSkillDefinitions(definition)
    }));
    const shouldRandomizeLoadoutAndClassUps = this.singleplayer.shouldRandomizeLoadoutAndClassUps();
    const dailyLoadoutMode = this.activeChallenge === 'daily' ? getDailyLoadoutMode(this.activeDailyKey) : null;
    const dailyRandomClassUps = this.activeChallenge === 'daily' && getDailyUsesRandomClassUps(this.activeDailyKey);
    const dailyMirrorLoadout = dailyLoadoutMode === 'mirror' ? this.pickDailySeededLoadout(allDefinitions, 'mirror') : null;
    const dungeonLoadoutEntries = this.activeChallenge === 'dungeon' && this.dungeonLoadoutSnapshot?.length
      ? this.dungeonLoadoutSnapshot.flatMap((entry) => {
        const definition = this.definitions.get(entry.typeId as DiceTypeId)
          ?? allDefinitions.find((candidate) => candidate.typeId === entry.typeId);
        return definition ? [{ entry, definition }] : [];
      })
      : null;
    const activeDungeonLoadout = dungeonLoadoutEntries?.length ? dungeonLoadoutEntries : null;
    const playerLoadoutDefinitions = dailyMirrorLoadout
      ?? (dailyLoadoutMode === 'random-vs-random'
        ? this.pickDailySeededLoadout(allDefinitions, 'player')
        : shouldRandomizeLoadoutAndClassUps && this.activeChallenge !== 'daily'
        ? this.pickRandomLoadout(allDefinitions, false)
        : activeDungeonLoadout
        ? activeDungeonLoadout.map(({ definition }) => ({
          ...definition,
          skills: getValidSkillDefinitions(definition)
        }))
        : getDiceDefinitions(this).map((definition) => ({
          ...definition,
          skills: getValidSkillDefinitions(definition)
        })));

    const effectiveLevel = (raw: number) => this.configUseLevelling ? raw : 1;

    const playerClassLevelsByInstanceId = new Map<string, number>();
    const enemyClassLevelsByInstanceId = new Map<string, number>();
    const hardDaily = this.activeChallenge === 'daily' && this.dailyHard;
    const playerMaxClass = hardDaily ? 10 : 15;
    const playerClassLevelsBySlot: number[] = [];
    const playerTalentBySlot: Array<number | null> = [];
    const enemyClassLevelsBySlot: number[] = [];
    const playerDefs = playerLoadoutDefinitions
      .map((definition, index) => {
        const snapshotEntry = activeDungeonLoadout?.[index]?.entry;
        const classLevel = snapshotEntry
          ? snapshotEntry.classLevel
          : this.activeChallenge === 'daily' && this.configUseLevelling
          ? (dailyRandomClassUps
            ? getDailySeededRange(this.activeDailyKey, `daily-player-class-${index}-${definition.typeId}`, 1, playerMaxClass)
            : effectiveLevel(getDiceProgress(this, definition.typeId).classLevel))
          : shouldRandomizeLoadoutAndClassUps && this.configUseLevelling
          ? Phaser.Math.Between(1, 15)
          : effectiveLevel(getDiceProgress(this, definition.typeId).classLevel);
        const talentIndex = areTalentsSuppressedForChallenge(this.activeChallenge)
          ? null
          : snapshotEntry
          ? snapshotEntry.talentIndex
          : this.resolveLoadoutTalentIndex(definition, classLevel);
        playerClassLevelsBySlot[index] = classLevel;
        playerTalentBySlot[index] = talentIndex;
        return this.applyClassProgress(
          applyDiceTalent(definition, talentIndex, classLevel),
          classLevel
        );
      });

    const playerClassBySlot = [...playerClassLevelsBySlot];
    const hardDailyEnemyDice = hardDaily
      ? getDailyTopProfileDice(this, allDefinitions, 5)
        .flatMap((entry) => {
          const definition = allDefinitions.find((candidate) => candidate.typeId === entry.typeId);
          return definition ? [{ definition, classLevel: entry.classLevel }] : [];
        })
      : [];
    const challengeEnemyConfig = this.activeChallenge === 'deucifer' || this.activeChallenge === 'dopamine'
      ? getChallengeEnemyConfig(this.activeChallenge)
      : undefined;
    const enemyRawDefs = this.activeChallenge === 'bossfight'
      ? [this.bossfightCurrentBoss]
        .map((typeId) => this.definitions.get(typeId))
        .filter((d): d is DiceDefinition => Boolean(d))
      : challengeEnemyConfig
      ? challengeEnemyConfig.typeIds
        .map((typeId) => this.definitions.get(typeId) ?? allDefinitions.find((d) => d.typeId === typeId))
        .filter((d): d is DiceDefinition => Boolean(d))
      : this.activeChallenge === 'dungeon'
      ? this.pickDungeonEnemyDefs(allDefinitions)
      : hardDailyEnemyDice.length > 0
      ? hardDailyEnemyDice.map((entry) => entry.definition)
      : dailyMirrorLoadout
      ? dailyMirrorLoadout
      : dailyLoadoutMode
      ? this.pickDailySeededLoadout(allDefinitions, 'enemy')
      : this.pickRandomLoadout(allDefinitions, true);
    const enemyDefs = enemyRawDefs.map((definition, index) => {
      const classLevel = this.activeChallenge === 'bossfight'
        ? this.bossfightLevel
        : challengeEnemyConfig
        ? challengeEnemyConfig.classLevel
        : this.activeChallenge === 'dungeon'
        ? (this.dungeonEnemyClasses[index] ?? 1)
        : this.activeChallenge === 'daily' && this.configUseLevelling
        ? (hardDaily && hardDailyEnemyDice.length > 0
          ? getHardDailyEnemyClassLevel(hardDailyEnemyDice[index]?.classLevel ?? 1)
          : dailyMirrorLoadout
          ? (playerClassBySlot[index % Math.max(1, playerClassBySlot.length)] ?? 1)
          : dailyRandomClassUps
          ? getDailySeededRange(this.activeDailyKey, `daily-enemy-class-${index}-${definition.typeId}`, 1, 15)
          : effectiveLevel(getDiceProgress(this, definition.typeId).classLevel))
        : shouldRandomizeLoadoutAndClassUps && this.configUseLevelling
        ? Phaser.Math.Between(1, 15)
        : effectiveLevel(this.rollEnemyClassLevel());
      this.enemyClassLevels.set(`${definition.typeId}:${index}`, classLevel);
      enemyClassLevelsBySlot[index] = classLevel;
      const dungeonBossSlot = this.activeChallenge === 'dungeon' && this.dungeonBoss !== null && index === 0;
      const dungeonMiniBossSlot = this.activeChallenge === 'dungeon'
        && this.dungeonBossRole === 'mini'
        && this.dungeonBossMinionType !== null
        && index === 0;
      let scaled = this.applyClassProgress(definition, classLevel, { uncapped: dungeonMiniBossSlot });
      if (dungeonBossSlot) scaled = { ...scaled, footprint: this.dungeonBossRole === 'major' ? 3 : 2 };
      if (dungeonMiniBossSlot) scaled = { ...scaled, footprint: 2 };
      return scaled;
    });

    this.gameState = createMatchBattleState(playerDefs, enemyDefs);
    this.gameState.dice.forEach((die, index) => {
      const slotIndex = die.ownerId === 'player' ? index : index - playerDefs.length;
      const classLevel = die.ownerId === 'player'
        ? (playerClassLevelsBySlot[slotIndex] ?? 1)
        : (enemyClassLevelsBySlot[slotIndex] ?? 1);
      (die.ownerId === 'player' ? playerClassLevelsByInstanceId : enemyClassLevelsByInstanceId).set(die.instanceId, classLevel);
    });
    if (this.configRandomMode) {
      this.activeRandomModifier = this.activeChallenge === 'dungeon'
        ? this.dungeonModifier
        : getChallengeRandomModifier(this.activeChallenge, this.activeDailyKey)
        ?? (CHALLENGE_RANDOM_MODIFIERS[Phaser.Math.Between(0, CHALLENGE_RANDOM_MODIFIERS.length - 1)] ?? 'Classic');
      if (this.activeRandomModifier === 'Duality') {
        this.gameState = {
          ...this.gameState,
          dice: this.gameState.dice.flatMap((die) => {
            if (die.ownerId !== 'player' && die.ownerId !== 'enemy') return [die];
            if (this.activeChallenge === 'dungeon' && die.ownerId !== 'player') return [die];
            const copy = { ...die, instanceId: `${die.instanceId}:dual`, zone: 'hand' as const, gridPosition: undefined };
            return [die, copy];
          })
        };
      }
    }

    this.instanceDefinitionOverrides.clear();
    this.gameState.dice.forEach((die) => {
      const sourceId = die.instanceId.split(':')[0];
      const sourceParts = sourceId.split('-');
      const sourceIndex = Number(sourceParts[sourceParts.length - 1]) - 1;
      const scaledDef = die.ownerId === 'player'
        ? playerDefs[sourceIndex]
        : enemyDefs[sourceIndex];
      const classLevel = die.ownerId === 'player'
        ? (playerClassLevelsBySlot[sourceIndex] ?? 1)
        : (enemyClassLevelsBySlot[sourceIndex] ?? 1);
      if (scaledDef) {
        this.instanceDefinitionOverrides.set(die.instanceId, scaledDef);
        this.instanceClassLevels.set(die.instanceId, classLevel);
        if (die.ownerId === 'player') {
          const talentIndex = playerTalentBySlot[sourceIndex];
          this.instanceTalentIndices.set(die.instanceId, areTalentsSuppressedForChallenge(this.activeChallenge) ? null : talentIndex ?? null);
        }
      }
    });

    this.applyDungeonCarryover();
    this.generateEnemyPositions();
    if (this.activeChallenge === 'dungeon') this.applyDungeonEnemyCarryover();

    if (this.activeChallenge === 'dungeon') {
      await this.maybeRunDiceCardDraft(false);
    }

    if (this.activeChallenge === 'deucifer') {
      this.enemyDisplayName = 'Deucifer';
      AudioManager.playMusic(this, getBossMusicKey('Deucifer', AUDIO_KEYS));
    } else if (this.activeChallenge === 'bossfight') {
      this.enemyDisplayName = `${this.bossfightCurrentBoss} Lv.${this.bossfightLevel}`;
      AudioManager.playMusic(this, getBossMusicKey(this.bossfightCurrentBoss, AUDIO_KEYS));
    } else if (this.activeChallenge === 'dungeon') {
      AudioManager.playMusic(this, this.getDungeonMusicKey());
    } else {
      AudioManager.playMusic(this, AUDIO_KEYS.arenaMusic);
    }
    this.turnText.setVisible(false);
    this.updateTurnLabel();

    this.createHandArea();
    this.setupGridDropZones();
    this.createCombatUI();
    this.updateCombatButtonState();
    this.renderDice();
    this.renderDiceCardInfoPanel();

    this.debug.log('Battle initialized', { turn: this.gameState.turn, playerCount: playerDefs.length, enemyCount: enemyDefs.length });
    if (this.configRandomMode) {
      const modifierName = this.getRandomModeDisplayName(this.activeRandomModifier ?? 'Classic');
      this.writeCombatLog(this.activeChallenge === 'dungeon'
        ? `Dungeon Modifier: ${modifierName} — active for your dice only.`
        : `Random Mode: ${modifierName} selected.`);
    }
    if (this.activeChallenge === 'dungeon') {
      const bossSuffix = this.dungeonBossRole === 'mini' && this.dungeonBossMinionType
        ? ` Mini-boss: ${this.dungeonBossMinionType} Lv.${this.dungeonEnemyClasses[0] ?? 1}.`
        : this.dungeonBoss
        ? ` Boss: ${this.dungeonBoss} Lv.${this.dungeonEnemyClasses[0] ?? 1}.`
        : '';
      this.writeCombatLog(`Dungeon Keeper — Wave ${this.dungeonWave}/${DUNGEON_MAX_WAVES}.${bossSuffix}`);
      const difficulty = getDungeonDifficulty(this.dungeonWave);
      if (difficulty === 'death-wave') {
        this.writeCombatLog('Death Wave — enemy critical chance is 25%; mini-bosses and bosses roll D12.');
      } else if (difficulty === 'boss-berserk') {
        this.writeCombatLog('Boss Berserk — all enemy dice have 50% critical chance, elite dice roll D20, and elite skills are 50% stronger.');
      }
    }
    await this.playDungeonIntroIfNeeded();
    this.syncMusicEffects();
    this.time.delayedCall(1000, () => {
      if (!this.sys.isActive()) return;
      this.turnText.setVisible(true);
      this.playTurnBanner(this.turnText.text);
      AudioManager.playSfx(this, AUDIO_KEYS.uiRound);
    });
  }

  private handleMultiplayerMatch(setup: ArenaMultiplayerMatchSetup) {
    if (!this.sys.isActive()) return;
    if (this.isMultiplayerMatch && this.multiplayerMatch?.matchId === setup.matchId) {
      this.multiplayer.updateMatch(setup);
      this.activeRandomModifier = setup.rules.randomMode ? setup.rules.randomModifier ?? 'Classic' : null;
      this.dicePips = new Map(Object.entries(setup.pips ?? {}));
      this.enemyDicePips = new Map(Object.entries(setup.pips ?? {}));
      this.applyServerAuthoritativeState(setup.state, setup.classLevels, setup.talentIndices);
      this.applyMultiplayerDiceCardState(setup.diceCards, setup.diceCardOffer, setup.turn, setup.diceCardPicksUsed);
      this.refreshMultiplayerCombanityBonuses();
      this.restoreMultiplayerCombatRecord(setup.record);
      this.updateMultiplayerTimerUi();
      if (setup.phase === 'complete') this.finishMultiplayerMatch(setup.result ?? 'draw');
      return;
    }
    if (this.gamePhase.stage !== 'lobby') {
      AlertManager.toast(this, { type: 'warning', message: 'A multiplayer match was found, but another battle is already running.' });
      return;
    }
    this.clearModeModal();
    this.multiplayer.beginMatch(setup);
    this.playerDisplayName = setup.playerName || this.playerDisplayName;
    this.enemyDisplayName = setup.opponentName || 'Opponent';
    this.turnLimit = setup.rules.turnLimit;
    this.activeChallenge = null;
    this.activeDailyKey = '';
    this.activeRandomModifier = setup.rules.randomMode ? setup.rules.randomModifier ?? 'Classic' : null;
    AlertManager.toast(this, { type: 'success', message: `Matched with ${this.enemyDisplayName}.` });
    this.startGame();
  }

  private initializeMultiplayerBattle(setup: ArenaMultiplayerMatchSetup) {
    this.activeRandomModifier = setup.rules.randomMode ? setup.rules.randomModifier ?? 'Classic' : null;
    this.gameState = {
      turn: setup.state.turn,
      combatPhase: setup.state.combatPhase,
      reviveCounts: { ...(setup.state.reviveCounts ?? {}) },
      dice: setup.state.dice.map((die) => ({
        ...die,
        gridPosition: die.gridPosition ? { ...die.gridPosition } : undefined
      }))
    };
    this.multiplayerDeadlineAt = setup.deadlineAt;
    this.multiplayerReady = setup.selfReady === true;
    this.multiplayerSubmitting = false;
    this.enemyLoadoutRevealed = false;
    this.instanceDefinitionOverrides.clear();
    this.instanceClassLevels.clear();
    this.instanceTalentIndices.clear();
    this.enemyClassLevels.clear();
    this.transforms.reset();

    this.gameState.dice.forEach((die) => {
      const base = this.definitions.get(die.typeId);
      if (!base) return;
      const classLevel = setup.rules.useLevelling
        ? Math.max(1, Math.floor(setup.classLevels[die.instanceId] ?? 1))
        : 1;
      const talentIndex = setup.talentIndices[die.instanceId] ?? null;
      let scaled = this.applyClassProgress(applyDiceTalent(base, talentIndex, classLevel), classLevel);
      if (die.transformIndex !== undefined) {
        scaled = applyTransformStats(scaled, die.transformIndex);
        this.transforms.setIndex(die.instanceId, die.transformIndex);
      }
      this.instanceDefinitionOverrides.set(die.instanceId, scaled);
      this.instanceClassLevels.set(die.instanceId, classLevel);
      this.instanceTalentIndices.set(die.instanceId, talentIndex);
      if (die.ownerId === 'enemy') this.enemyClassLevels.set(`${die.typeId}:${die.instanceId}`, classLevel);
    });

    this.dicePips = new Map(Object.entries(setup.pips ?? {}));
    this.enemyDicePips = new Map(Object.entries(setup.pips ?? {}));
    this.currentHandOrder = getAvailableHandDice(this.gameState, 'player').map((die) => die.instanceId);
    this.enemyFogOverlay?.setVisible(true);
    this.enemyFogText?.setVisible(true);
    this.turnText.setVisible(false);
    this.updateTurnLabel();
    this.time.delayedCall(1000, () => {
      if (!this.sys.isActive()) return;
      this.turnText.setVisible(true);
      this.playTurnBanner(this.turnText.text);
      AudioManager.playSfx(this, AUDIO_KEYS.uiRound);
    });

    AudioManager.playMusic(this, AUDIO_KEYS.arenaMusic);
    this.createHandArea();
    this.setupGridDropZones();
    this.createCombatUI();
    this.updateCombatButtonState();
    this.applyMultiplayerDiceCardState(setup.diceCards, setup.diceCardOffer, setup.turn, setup.diceCardPicksUsed);
    this.refreshMultiplayerCombanityBonuses();
    this.renderDiceCardInfoPanel();
    this.renderDice();
    this.renderEnemyDice();
    this.startMultiplayerCountdown();
    this.updateMultiplayerTimerUi();
    this.writeCombatLog(`Server PvP match started against ${this.enemyDisplayName}. Both players must place dice and ready up.`);
    if (setup.rules.randomizeLoadout) {
      this.writeCombatLog('Loadouts and class levels were randomised by the server for this match.');
    }
    if (setup.rules.randomMode) {
      this.writeCombatLog(`Random Mode: ${this.getRandomModeDisplayName(setup.rules.randomModifier ?? 'Classic')}.`);
    }
    this.restoreMultiplayerCombatRecord(setup.record);
    this.debug.log('Multiplayer battle initialized', { matchId: setup.matchId, turn: setup.state.turn, selfOwner: setup.selfOwner });
    if (setup.phase === 'complete') this.finishMultiplayerMatch(setup.result ?? 'draw');
  }

  private updateMultiplayerTimerUi() {
    if (!this.sys.isActive()) return;
    if (!this.isMultiplayerMatch) {
      this.multiplayerTimerText?.setVisible(false);
      return;
    }
    if (!this.multiplayerTimerText) {
      this.multiplayerTimerText = this.add.text(this.scale.width / 2, 92, '', {
        fontFamily: 'Orbitron',
        fontSize: '18px',
        color: '#ffcf7a'
      }).setOrigin(0.5).setDepth(220);
      this.gameContainer?.add(this.multiplayerTimerText);
    }
    if (this.gamePhase.stage !== 'placement' && this.gamePhase.stage !== 'combat') {
      this.multiplayerTimerText.setVisible(false);
      return;
    }
    const secs = Math.max(0, Math.ceil((this.multiplayerDeadlineAt - Date.now()) / 1000));
    const prefix = this.gamePhase.stage === 'combat'
      ? 'RESOLVING'
      : this.multiplayerReady || this.multiplayerSubmitting
      ? 'WAITING FOR OPPONENT'
      : 'PLACEMENT';
    this.multiplayerTimerText.setText(`${prefix} ${secs}s`);
    this.multiplayerTimerText.setVisible(true);
  }

  private startMultiplayerCountdown() {
    this.multiplayerCountdownEvent?.remove(false);
    this.multiplayerCountdownEvent = this.time.addEvent({
      delay: 250,
      loop: true,
      callback: () => this.updateMultiplayerTimerUi()
    });
  }

  private async readyForMultiplayerCombat() {
    if (!this.multiplayerMatch || !this.isMultiplayerMatch || this.multiplayerReady || this.multiplayerSubmitting) return;
    const requiredDice = Math.min(25, this.currentHandOrder.length);
    const boardPlaced = this.getHandPlacedDiceCount();
    if (!this.diceRolled || boardPlaced < requiredDice) {
      this.writeCombatLog(`Place all ${requiredDice} rolled dice before queuing combat.`);
      this.updateCombatButtonState();
      return;
    }
    const boardDice = getBoardDice(this.gameState, 'player').filter((die) => Boolean(die.gridPosition));
    if (boardDice.length !== requiredDice) {
      this.writeCombatLog('One or more dice are missing a valid grid position.');
      return;
    }

    this.multiplayerSubmitting = true;
    this.startCombatButton.disableInteractive();
    this.startCombatButton.setFillStyle(0x7f8c8d, 0.5);
    this.writeCombatLog('Board locked. Sending START COMBAT to the server...');
    this.updateMultiplayerTimerUi();

    try {
      const resolution = await this.multiplayer.submitTurn({
        turn: this.gameState.turn,
        ...(this.multiplayerDiceCardKey ? { diceCardKey: this.multiplayerDiceCardKey } : {}),
        dice: boardDice.map((die) => ({
          ownerId: 'player' as const,
          instanceId: die.instanceId,
          typeId: die.typeId,
          gridPosition: { ...die.gridPosition! }
        }))
      });
      if (!this.sys.isActive()) return;
      if (!resolution.accepted) {
        if (resolution.turn !== undefined && resolution.turn < this.gameState.turn) {
          this.multiplayerSubmitting = false;
          return;
        }
        if (this.gamePhase.stage !== 'placement' || this.multiplayerReady) {
          this.multiplayerSubmitting = false;
          return;
        }
        this.multiplayerSubmitting = false;
        this.handContainer.setVisible(true);
        this.writeCombatLog(`Server rejected the board${resolution.message ? `: ${resolution.message}` : '.'}`);
        AlertManager.toast(this, { type: 'warning', message: resolution.message ?? 'Multiplayer server did not accept the board.' });
        this.updateCombatButtonState();
        this.updateMultiplayerTimerUi();
        return;
      }
      if (resolution.status === 'waiting' || resolution.status === 'accepted') {
        this.multiplayerReady = resolution.selfReady === true;
        this.multiplayerSubmitting = false;
        this.multiplayerDeadlineAt = resolution.deadlineAt ?? this.multiplayerDeadlineAt;
        this.handContainer.setVisible(false);
        this.writeCombatLog('Combat queued. Waiting for your opponent to ready up or for the placement timer to expire.');
        this.updateCombatButtonState();
        this.updateMultiplayerTimerUi();
      }
    } catch (error) {
      this.multiplayerSubmitting = false;
      this.handContainer.setVisible(true);
      this.writeCombatLog('Unable to reach the multiplayer server.');
      this.debug.warn('Multiplayer ready-up failed.', error);
      this.updateCombatButtonState();
      this.updateMultiplayerTimerUi();
    }
  }

  private handleMultiplayerCombat(event: ArenaMultiplayerCombatEvent) {
    if (!this.isMultiplayerMatch || !this.multiplayerMatch) return;
    if (event.matchId && event.matchId !== this.multiplayerMatch.matchId) return;
    if (event.status === 'rejected' || event.status === 'failed') {
      if (event.turn !== undefined && event.turn < this.gameState.turn) {
        this.multiplayerSubmitting = false;
        return;
      }
      if (this.gamePhase.stage !== 'placement' || this.multiplayerReady) {
        this.multiplayerSubmitting = false;
        return;
      }
      this.multiplayerReady = false;
      this.multiplayerSubmitting = false;
      this.handContainer.setVisible(true);
      this.writeCombatLog(`Server rejected the board${event.message ? `: ${event.message}` : '.'}`);
      this.updateCombatButtonState();
      this.updateMultiplayerTimerUi();
      return;
    }
    if (event.status === 'waiting' || event.status === 'accepted') {
      this.multiplayerReady = event.selfReady === true;
      if (event.selfReady === true) this.multiplayerSubmitting = false;
      if (event.deadlineAt) this.multiplayerDeadlineAt = event.deadlineAt;
      this.updateMultiplayerTimerUi();
      return;
    }
    if (event.status !== 'resolved') return;

    this.multiplayerReady = true;
    this.multiplayerSubmitting = false;
    if (event.deadlineAt) this.multiplayerDeadlineAt = event.deadlineAt;
    if (event.state !== undefined) this.applyServerAuthoritativeState(event.state, event.classLevels, event.talentIndices);
    if (event.pips) {
      this.dicePips = new Map(Object.entries(event.pips));
      this.enemyDicePips = new Map(Object.entries(event.pips));
    }
    (event.events ?? []).forEach((line) => this.writeCombatLog(line));
    if (event.autoPlaced) this.writeCombatLog('The 30-second placement timer expired; remaining dice were auto-placed by the server.');

    if (event.result || event.phase === 'complete') {
      this.finishMultiplayerMatch(event.result ?? 'draw', event.message);
      return;
    }
    if (event.phase === 'placement') this.beginMultiplayerPlacement(event);
  }

  private beginMultiplayerPlacement(event: ArenaMultiplayerCombatEvent) {
    if (!this.multiplayerMatch) return;
    this.applyMultiplayerDiceCardState(event.diceCards, event.diceCardOffer, event.turn, event.diceCardPicksUsed);
    this.gamePhase = { stage: 'placement' };
    this.multiplayerReady = false;
    this.multiplayerSubmitting = false;
    this.multiplayerDeadlineAt = event.deadlineAt ?? Date.now() + 30_000;
    this.enemyLoadoutRevealed = false;
    this.enemyFogOverlay?.setVisible(true);
    this.enemyFogText?.setVisible(true);
    this.bringEnemyFogToFront();
    this.cancelPostCombatDrag();
    this.clearRangeHighlights();
    this.attackCountFeedbackByInstance.clear();
    this.startCombatButton.disableInteractive();
    this.startCombatButton.setFillStyle(0x7f8c8d, 0.5);
    this.rollAllButton.setVisible(false);
    this.rollAllButtonLabel.setVisible(false);
    this.rollHelperText.setVisible(false);
    this.updateTurnLabel();
    this.turnText.setVisible(true);
    this.playTurnBanner(this.turnText.text);
    this.writeCombatLog(`Turn ${this.gameState.turn} placement phase. Both players have 30 seconds to ready up.`);
    this.updateMultiplayerTimerUi();

    const returningDice = this.returnDiceToHand();
    this.dicePips = new Map(Object.entries(event.pips ?? {}));
    this.enemyDicePips = new Map(Object.entries(event.pips ?? {}));
    this.refreshMultiplayerCombanityBonuses();
    this.diceRolled = false;
    void returningDice.then(() => {
      if (!this.sys.isActive() || !this.isMultiplayerMatch) return;
      this.dicePips = new Map(Object.entries(event.pips ?? {}));
      this.enemyDicePips = new Map(Object.entries(event.pips ?? {}));
      this.diceRolled = false;
      this.updateMultiplayerTimerUi();
      this.updateCombatButtonState();
    });
  }

  private restoreMultiplayerCombatRecord(record?: string[]) {
    if (!Array.isArray(record) || record.length === 0) return;
    const normalized = record
      .map((line) => this.normalizeCombatLogText(line.replace(/\s+/g, ' ').trim()))
      .filter(Boolean)
      .slice(-200);
    if (normalized.length === 0) return;
    this.combatLogHistory = normalized;
    this.combatLogHistoryClearedForMatchId = this.combatLogMatchId;
    this.nativeCombatLogSetText?.(normalized[normalized.length - 1] ?? '');
    this.refreshHistoryModalView(true);
  }

  private finishMultiplayerMatch(result: 'victory' | 'defeat' | 'draw', message?: string) {
    this.multiplayerReady = true;
    this.enemyLoadoutRevealed = true;
    this.enemyFogOverlay?.setVisible(false);
    this.enemyFogText?.setVisible(false);
    this.renderEnemyDice();
    const fallback = result === 'victory'
      ? 'Your opponent was defeated.'
      : result === 'defeat'
      ? 'All your dice were defeated.'
      : 'The match ended in a draw.';
    this.endGame(result, message && message !== 'The match is complete.' ? message : fallback);
  }

  private getRandomModeDisplayName(modifier: RandomModeModifier): string {
    return modifier === 'DiceCard' ? 'Dice Card' : modifier;
  }

  private getDefinitionForInstance(die: DiceInstanceState): DiceDefinition | undefined {
    const definition = this.instanceDefinitionOverrides.get(die.instanceId) ?? this.definitions.get(die.typeId);
    return definition ? this.applyDungeonCardDefinitionForOwner(definition, die.ownerId, this.instanceClassLevels.get(die.instanceId) ?? 1) : undefined;
  }

  private applyDungeonCardDefinitionForOwner(definition: DiceDefinition, ownerId: DiceInstanceState['ownerId'], classLevel = 1): DiceDefinition {
    if (ownerId !== 'player' || !this.areDungeonCardsEnabled()) return definition;
    return applyDungeonCardStats(definition, getDungeonCardEffects(this.dungeonCardState, definition.typeId), classLevel);
  }

  private getDiceCardMaxHealthForDefinition(definition: DiceDefinition, ownerId: DiceInstanceState['ownerId']): number {
    const baseHealth = Math.max(1, Math.floor(definition.health));
    if (ownerId !== 'player') return baseHealth;
    return resolveDiceCardMaxHealth(
      baseHealth,
      this.activeDiceCards,
      definition.typeId,
      (DICE_RARITY_RANK[definition.rarity] ?? 0) < DICE_RARITY_RANK.Legendary
    );
  }

  private getDungeonCardAttackMultiplier(die: DiceInstanceState): number {
    return getDungeonCardDamageMultiplier(this.getDungeonCardEffectsForDie(die));
  }

  private stripDungeonCardHealth(definition: DiceDefinition): DiceDefinition {
    if (!this.areDungeonCardsEnabled()) return definition;
    return removeDungeonCardHealth(definition, getDungeonCardEffects(this.dungeonCardState, definition.typeId));
  }

  private getBaseDefinitionForInstance(die: DiceInstanceState): DiceDefinition | undefined {
    return this.definitions.get(die.typeId) ?? this.getDefinitionForInstance(die);
  }

  private getInstanceTalentIndex(die: DiceInstanceState): number | null {
    if (areTalentsSuppressedForChallenge(this.activeChallenge)) return null;
    const stored = this.instanceTalentIndices.get(die.instanceId);
    if (stored !== undefined) return stored;
    if (!this.isMultiplayerMatch && this.singleplayer.shouldRandomizeLoadoutAndClassUps()) return null;
    if (die.ownerId !== 'player') return null;
    const base = this.getBaseDefinitionForInstance(die);
    return base ? getEquippedTalentIndex(this, base, this.instanceClassLevels.get(die.instanceId) ?? 1) : null;
  }

  private getCombatBaseDefinition(die: DiceInstanceState): DiceDefinition | undefined {
    const base = this.getBaseDefinitionForInstance(die);
    if (!base) return undefined;
    const classLevel = this.instanceClassLevels.get(die.instanceId) ?? 1;
    const withTalent = applyDiceTalent(base, this.getInstanceTalentIndex(die), classLevel);
    return this.applyClassProgress(withTalent, classLevel);
  }

  private getCombatDieName(die: DiceInstanceState): string {
    const title = this.getBaseDefinitionForInstance(die)?.title;
    if (title) return title.replace(/\s+Dice$/i, '');
    return this.formatCombatTypeName(die.typeId);
  }

  private getCombatDieOwnerLabel(die: DiceInstanceState, capitalize = true): string {
    const label = die.ownerId === 'player' ? 'your' : 'enemy';
    return capitalize ? `${label.charAt(0).toUpperCase()}${label.slice(1)}` : label;
  }

  private getQualifiedCombatDieName(die: DiceInstanceState, capitalize = true): string {
    return `${this.getCombatDieOwnerLabel(die, capitalize)} ${this.getCombatDieName(die)}`;
  }

  private formatCombatTypeName(typeId: string): string {
    return typeId
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  private refreshDisplayNameReplacements() {
    const replacements: Array<{ pattern: RegExp; replacement: string }> = [];
    this.definitions?.forEach((definition, typeId) => {
      const displayName = definition.title.replace(/\s+Dice$/i, '');
      const escapedTypeId = typeId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!escapedTypeId) return;
      try {
        replacements.push({ pattern: new RegExp(`\\b${escapedTypeId}\\b`, 'g'), replacement: displayName });
      } catch {
      }
    });
    this.displayNameReplacements = replacements;
  }

  private normalizeCombatLogText(message: string): string {
    let normalized = message;
    for (const { pattern, replacement } of this.displayNameReplacements) {
      normalized = normalized.replace(pattern, replacement);
    }
    return normalized;
  }

  private writeCombatLog(message: string) {
    const normalized = this.normalizeCombatLogText(message.replace(/\s+/g, ' ').trim());
    if (!normalized || !this.combatLog) return;
    if (this.combatLogHistoryClearedForMatchId !== this.combatLogMatchId) {
      this.combatLogHistory = [];
      this.combatLogHistoryClearedForMatchId = this.combatLogMatchId;
    }
    const lastIndex = this.combatLogHistory.length - 1;
    let appended = false;
    if (lastIndex < 0 || this.combatLogHistory[lastIndex] !== normalized) {
      this.combatLogHistory.push(normalized);
      appended = true;
    }
    if (this.combatLogHistory.length > 200) {
      this.combatLogHistory.splice(0, this.combatLogHistory.length - 200);
    }
    this.nativeCombatLogSetText?.(normalized);
    this.refreshHistoryModalView(appended);
  }

  private refreshHistoryModalView(appendOccurred: boolean) {
    const view = this.historyModalView;
    if (!view) return;
    const { content, footer, jumpButton, viewportHeight, contentTop, viewportWidth, rootContainer } = view;
    if (!rootContainer.active) return;
    const contentHeight = this.renderCombatLogHistoryLines(content, viewportWidth);
    const countdown = this.turnLimit === -1
      ? `Turn ${this.gameState.turn}`
      : `Turn ${this.gameState.turn}/${this.turnLimit}`;
    const entryCount = this.combatLogHistory.length;
    footer.setText(`${entryCount} entr${entryCount === 1 ? 'y' : 'ies'} • ${countdown}`);
    view.maxScroll = Math.max(0, contentHeight - viewportHeight + 12);
    if (view.maxScroll === 0) {
      view.scrollOffset = 0;
      content.y = contentTop;
      view.wasNearBottom = true;
      view.pendingBelowFold = 0;
      jumpButton.setVisible(false);
      return;
    }
    if (!appendOccurred) return;
    if (view.wasNearBottom) {
      view.scrollOffset = -view.maxScroll;
      content.y = contentTop + view.scrollOffset;
      view.pendingBelowFold = 0;
      jumpButton.setVisible(false);
    } else {
      view.pendingBelowFold += 1;
      const label = view.pendingBelowFold === 1
        ? `↑ 1 NEW`
        : `↑ ${view.pendingBelowFold} NEW`;
      jumpButton.setText(label);
      jumpButton.setVisible(true);
    }
  }

  private getCombatLogSegments(entry: string): Array<{ text: string; color: string }> {
    const spans: Array<{ start: number; end: number; color: string }> = [];
    const criticalPattern = /\bCRITICAL\b/g;
    let match: RegExpExecArray | null;
    while ((match = criticalPattern.exec(entry))) {
      const markerStart = match.index;
      const prefix = entry.slice(0, markerStart);
      const amountMatch = /([+\-]?\d[\d,.]*)(?:\s+[A-Za-z]+){0,2}\s*(?:\(\s*)?$/.exec(prefix);
      const contextStart = Math.max(prefix.lastIndexOf(';'), prefix.lastIndexOf('!')) + 1;
      const context = entry.slice(contextStart, markerStart);
      const color = /\bheal(?:s|ing)?\b|\bhealth\b/i.test(context) ? '#7dff9f' : '#ff6b6b';
      const markerEnd = markerStart + match[0].length;
      spans.push({
        start: amountMatch ? markerStart - amountMatch[0].length : markerStart,
        end: entry[markerEnd] === ')' ? markerEnd + 1 : markerEnd,
        color
      });
    }
    if (spans.length === 0) return [{ text: entry, color: PALETTE.text }];
    const segments: Array<{ text: string; color: string }> = [];
    let cursor = 0;
    spans.forEach((span) => {
      if (span.start > cursor) segments.push({ text: entry.slice(cursor, span.start), color: PALETTE.text });
      const start = Math.max(cursor, span.start);
      if (span.end > start) segments.push({ text: entry.slice(start, span.end), color: span.color });
      cursor = Math.max(cursor, span.end);
    });
    if (cursor < entry.length) segments.push({ text: entry.slice(cursor), color: PALETTE.text });
    return segments;
  }

  private renderCombatLogHistoryLines(container: Phaser.GameObjects.Container, viewportWidth: number): number {
    container.removeAll(true);
    const entries = this.combatLogHistory.length
      ? this.combatLogHistory
      : ['(no combat events yet — start a match to see entries appear here)'];
    const style = { fontFamily: 'Orbitron', fontSize: '11px' };
    const measurer = this.add.text(0, 0, '', style).setVisible(false);
    const measure = (value: string) => {
      measurer.setText(value);
      return measurer.width;
    };
    const lineHeight = Math.ceil(measurer.setText('Ag').height) + 4;
    const maxWidth = Math.max(60, viewportWidth - 24);
    let y = 0;

    entries.forEach((entry, index) => {
      const display = `[${(index + 1).toString().padStart(3, '0')}] ${entry}`;
      const tokens: Array<{ text: string; color: string; spaceBefore: boolean }> = [];
      let pendingSpace = false;
      this.getCombatLogSegments(display).forEach((segment) => {
        segment.text.split(/(\s+)/).filter(Boolean).forEach((chunk) => {
          if (/^\s+$/.test(chunk)) {
            pendingSpace = true;
            return;
          }
          tokens.push({ text: chunk, color: segment.color, spaceBefore: pendingSpace });
          pendingSpace = false;
        });
      });

      const lines: Array<Array<{ text: string; color: string; width: number }>> = [];
      let currentLine: Array<{ text: string; color: string; width: number }> = [];
      let currentWidth = 0;
      const finishLine = () => {
        if (currentLine.length === 0) return;
        lines.push(currentLine);
        currentLine = [];
        currentWidth = 0;
      };
      tokens.forEach((token) => {
        const leadingSpace = currentLine.length > 0 && token.spaceBefore ? ' ' : '';
        let text = leadingSpace + token.text;
        let width = measure(text);
        if (currentLine.length > 0 && currentWidth + width > maxWidth) {
          finishLine();
          text = token.text;
          width = measure(text);
        }
        const previous = currentLine[currentLine.length - 1];
        if (previous && previous.color === token.color) {
          previous.text += text;
          previous.width += width;
        } else {
          currentLine.push({ text, color: token.color, width });
        }
        currentWidth += width;
      });
      finishLine();

      lines.forEach((runs, lineIndex) => {
        let x = 0;
        runs.forEach((run) => {
          const line = this.add.text(x, y + lineIndex * lineHeight, run.text, { ...style, color: run.color }).setOrigin(0, 0);
          container.add(line);
          x += run.width;
        });
      });
      y += Math.max(1, lines.length) * lineHeight + 4;
    });

    measurer.destroy();
    return y;
  }

  private openCombatLogHistoryModal() {
    this.clearModeModal();
    const { width, height } = this.scale;
    const centerX = width / 2;
    const centerY = height / 2;
    const viewportWidth = Math.min(900, width - 100);
    const viewportHeight = Math.min(430, height - 170);
    const overlay = this.add.rectangle(centerX, centerY, width, height, 0x000000, 0.68).setInteractive();
    const panel = this.add.rectangle(centerX, centerY, viewportWidth + 36, viewportHeight + 90, 0x102434, 0.98)
      .setStrokeStyle(2, 0x406987);
    const title = this.add.text(centerX, centerY - (viewportHeight + 90) / 2 + 24, 'COMBAT LOG HISTORY', {
      fontFamily: 'Orbitron', fontSize: '18px', color: PALETTE.accent
    }).setOrigin(0.5);
    const entryCount = this.combatLogHistory.length;
    const countdown = this.turnLimit === -1
      ? `Turn ${this.gameState.turn}`
      : `Turn ${this.gameState.turn}/${this.turnLimit}`;
    const footerLeft = this.add.text(
      centerX - (viewportWidth + 36) / 2 + 18,
      centerY - (viewportHeight + 90) / 2 + 48,
      `${entryCount} entr${entryCount === 1 ? 'y' : 'ies'} • ${countdown}`,
      { fontFamily: 'Orbitron', fontSize: '10px', color: PALETTE.textMuted, align: 'left' }
    ).setOrigin(0, 0.5);
    const hint = this.add.text(centerX + (viewportWidth + 36) / 2 - 18, centerY - (viewportHeight + 90) / 2 + 48,
      'Scroll to review • Press L or ESC to close',
      { fontFamily: 'Orbitron', fontSize: '10px', color: PALETTE.textMuted, align: 'right' }
    ).setOrigin(1, 0.5);
    const contentTop = centerY - viewportHeight / 2 + 8;
    const content = this.add.container(centerX - viewportWidth / 2, contentTop);
    const contentHeight = this.renderCombatLogHistoryLines(content, viewportWidth);
    const mask = this.add.rectangle(centerX - viewportWidth / 2, contentTop, viewportWidth, viewportHeight, 0xffffff, 0)
      .setOrigin(0, 0)
      .setVisible(false);
    content.setMask(mask.createGeometryMask());
    const closeButton = this.add.text(centerX, centerY + viewportHeight / 2 + 22, 'CLOSE', {
      fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.textMuted,
      backgroundColor: '#173247', padding: { left: 10, right: 10, top: 5, bottom: 5 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const jumpButton = this.add.text(centerX + viewportWidth / 2 - 18, centerY + viewportHeight / 2 + 22, '', {
      fontFamily: 'Orbitron', fontSize: '10px', color: '#ffffff',
      backgroundColor: '#2d6f99', padding: { left: 8, right: 8, top: 5, bottom: 5 }
    }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true }).setVisible(false);
    const elements: Phaser.GameObjects.GameObject[] = [overlay, panel, title, footerLeft, hint, content, mask, closeButton, jumpButton];
    this.modalContainer = this.add.container(0, 0, elements).setDepth(450);
    const close = () => this.clearModeModal();
    overlay.on('pointerdown', close);
    this.historyModalView = {
      content,
      footer: footerLeft,
      jumpButton,
      mask,
      contentTop,
      viewportHeight,
      viewportWidth,
      maxScroll: Math.max(0, contentHeight - viewportHeight + 12),
      scrollOffset: 0,
      pendingBelowFold: 0,
      wasNearBottom: true,
      rootContainer: this.modalContainer!
    };
    this.historyModalView.scrollOffset = -this.historyModalView.maxScroll;
    content.y = contentTop + this.historyModalView.scrollOffset;
    this.modalWheelHandler = (pointer: Phaser.Input.Pointer, _gameObjects: Phaser.GameObjects.GameObject[], _dx: number, dy: number) => {
      if (!this.historyModalView) return;
      const view = this.historyModalView;
      const withinX = pointer.worldX >= centerX - viewportWidth / 2 && pointer.worldX <= centerX + viewportWidth / 2;
      const withinY = pointer.worldY >= contentTop && pointer.worldY <= contentTop + viewportHeight;
      if (!withinX || !withinY || view.maxScroll <= 0) return;
      view.scrollOffset = Phaser.Math.Clamp(view.scrollOffset - dy * 0.45, -view.maxScroll, 0);
      content.y = contentTop + view.scrollOffset;
      const nearBottom = view.scrollOffset <= -view.maxScroll + 12;
      view.wasNearBottom = nearBottom;
      if (nearBottom && view.pendingBelowFold > 0) {
        view.pendingBelowFold = 0;
        jumpButton.setVisible(false);
      }
    };
    jumpButton.on('pointerdown', () => {
      if (!this.historyModalView) return;
      const view = this.historyModalView;
      view.scrollOffset = -view.maxScroll;
      content.y = contentTop + view.scrollOffset;
      view.wasNearBottom = true;
      view.pendingBelowFold = 0;
      jumpButton.setVisible(false);
    });
    this.input.on('wheel', this.modalWheelHandler);
    closeButton.on('pointerdown', close);
    this.setModalEsc(close);
  }

  private addCombatActionDetail(message: string) {
    const normalized = this.normalizeCombatLogText(message.replace(/\s+/g, ' ').trim());
    if (!normalized) return;
    this.combatActionDetails.push(normalized);
  }

  private hasOtherLivingDie(ownerId: 'player' | 'enemy', instanceId: string): boolean {
    return this.gameState.dice.some((die) =>
      die.ownerId === ownerId &&
      die.instanceId !== instanceId &&
      !die.isDestroyed &&
      (die.zone === 'board' || die.zone === 'hand')
    );
  }

  private getFootprintForDefinition(definition: DiceDefinition | undefined): number {
    return Math.max(1, Math.min(GRID_SIZE, Math.floor(definition?.footprint ?? 1)));
  }

  private getFootprintForDie(die: DiceInstanceState): number {
    return this.getFootprintForDefinition(this.getDefinitionForInstance(die));
  }

  private forEachFootprintCell(row: number, col: number, footprint: number, callback: (row: number, col: number) => void) {
    for (let rowOffset = 0; rowOffset < footprint; rowOffset++) {
      for (let colOffset = 0; colOffset < footprint; colOffset++) {
        callback(row + rowOffset, col + colOffset);
      }
    }
  }

  private canPlaceFootprint(row: number, col: number, footprint: number, usedCells: Set<string>): boolean {
    if (row < 0 || col < 0 || row + footprint > GRID_SIZE || col + footprint > GRID_SIZE) return false;
    let available = true;
    this.forEachFootprintCell(row, col, footprint, (cellRow, cellCol) => {
      if (usedCells.has(`${cellRow},${cellCol}`)) available = false;
    });
    return available;
  }

  private markFootprint(row: number, col: number, footprint: number, usedCells: Set<string>) {
    this.forEachFootprintCell(row, col, footprint, (cellRow, cellCol) => usedCells.add(`${cellRow},${cellCol}`));
  }

  private getFootprintCells(
    die: DiceInstanceState,
    position: { row: number; col: number } | undefined = die.gridPosition,
    footprint = this.getFootprintForDie(die)
  ): Array<{ row: number; col: number }> {
    if (!position) return [];
    const cells: Array<{ row: number; col: number }> = [];
    this.forEachFootprintCell(position.row, position.col, footprint, (row, col) => cells.push({ row, col }));
    return cells;
  }

  private getFootprintCellKeys(die: DiceInstanceState): string[] {
    const boardSide = this.getBoardSideForDie(die);
    return this.getFootprintCells(die).map((cell) => `${boardSide}:${cell.row},${cell.col}`);
  }

  private getFootprintColumnDistance(
    first: DiceInstanceState,
    second: DiceInstanceState,
    firstFootprint = this.getFootprintForDie(first),
    secondFootprint = this.getFootprintForDie(second)
  ): number {
    let best = Number.POSITIVE_INFINITY;
    this.getFootprintCells(first, first.gridPosition, firstFootprint).forEach((firstCell) => {
      this.getFootprintCells(second, second.gridPosition, secondFootprint).forEach((secondCell) => {
        best = Math.min(best, Math.abs(firstCell.col - secondCell.col));
      });
    });
    return best;
  }

  private getFootprintRowDistance(first: DiceInstanceState, second: DiceInstanceState): number {
    let best = Number.POSITIVE_INFINITY;
    this.getFootprintCells(first).forEach((firstCell) => {
      this.getFootprintCells(second).forEach((secondCell) => {
        best = Math.min(best, Math.abs(firstCell.row - secondCell.row));
      });
    });
    return best;
  }

  private getFootprintManhattanDistance(first: DiceInstanceState, second: DiceInstanceState): number {
    let best = Number.POSITIVE_INFINITY;
    this.getFootprintCells(first).forEach((firstCell) => {
      this.getFootprintCells(second).forEach((secondCell) => {
        best = Math.min(best, Math.abs(firstCell.row - secondCell.row) + Math.abs(firstCell.col - secondCell.col));
      });
    });
    return best;
  }

  private getFootprintChebyshevDistance(
    first: DiceInstanceState,
    second: DiceInstanceState,
    firstFootprint = this.getFootprintForDie(first),
    secondFootprint = this.getFootprintForDie(second)
  ): number {
    let best = Number.POSITIVE_INFINITY;
    this.getFootprintCells(first, first.gridPosition, firstFootprint).forEach((firstCell) => {
      this.getFootprintCells(second, second.gridPosition, secondFootprint).forEach((secondCell) => {
        best = Math.min(best, Math.max(Math.abs(firstCell.row - secondCell.row), Math.abs(firstCell.col - secondCell.col)));
      });
    });
    return best;
  }

  private getClosestFootprintOffsets(first: DiceInstanceState, second: DiceInstanceState): { rowOffset: number; colOffset: number; distance: number } {
    let best = { rowOffset: 0, colOffset: 0, distance: Number.POSITIVE_INFINITY };
    this.getFootprintCells(first).forEach((firstCell) => {
      this.getFootprintCells(second).forEach((secondCell) => {
        const rowOffset = secondCell.row - firstCell.row;
        const colOffset = secondCell.col - firstCell.col;
        const distance = Math.max(Math.abs(rowOffset), Math.abs(colOffset));
        const betterTieBreak = distance === best.distance
          && Math.abs(rowOffset) + Math.abs(colOffset) < Math.abs(best.rowOffset) + Math.abs(best.colOffset);
        if (distance < best.distance || betterTieBreak) {
          best = { rowOffset, colOffset, distance };
        }
      });
    });
    return best;
  }

  private getFootprintTargetsWithin(
    source: DiceInstanceState,
    candidates: DiceInstanceState[],
    radius: number,
    includeSource = false
  ): DiceInstanceState[] {
    const boardSide = this.getBoardSideForDie(source);
    const seen = new Set<string>();
    return candidates.filter((candidate) => {
      if ((!includeSource && candidate.instanceId === source.instanceId) || seen.has(candidate.instanceId)) return false;
      if (candidate.zone !== 'board' || candidate.isDestroyed || !candidate.gridPosition) return false;
      if (this.getBoardSideForDie(candidate) !== boardSide) return false;
      if (this.getFootprintChebyshevDistance(source, candidate) > radius) return false;
      seen.add(candidate.instanceId);
      return true;
    });
  }

  private collectOccupiedCells(ownerId: 'player' | 'enemy', excludedInstanceId?: string): Set<string> {
    return this.collectOccupiedCellsOnBoardSide(ownerId, excludedInstanceId);
  }

  private collectOccupiedCellsOnBoardSide(boardSide: 'player' | 'enemy', excludedInstanceId?: string): Set<string> {
    const usedCells = new Set<string>();
    this.gameState.dice.forEach((die) => {
      if (this.getBoardSideForDie(die) !== boardSide || die.instanceId === excludedInstanceId || die.zone !== 'board' || die.isDestroyed || !die.gridPosition) return;
      this.markFootprint(die.gridPosition.row, die.gridPosition.col, this.getFootprintForDie(die), usedCells);
    });
    this.gridLockTurnsByOwner[boardSide].forEach((turns, key) => {
      if (turns > 0) usedCells.add(key);
    });
    return usedCells;
  }

  private findRandomFootprintPosition(footprint: number, usedCells: Set<string>, pickColumn: () => number, columnBounds?: { min: number; max: number }, rng?: () => number): { row: number; col: number } | undefined {
    const minCol = Math.max(0, Math.min(GRID_SIZE - footprint, columnBounds?.min ?? 0));
    const maxCol = Math.max(minCol, Math.min(GRID_SIZE - footprint, columnBounds?.max ?? GRID_SIZE - footprint));
    for (let attempts = 0; attempts < 80; attempts++) {
      const row = this.rollSeededInt(0, GRID_SIZE - footprint, rng);
      const col = Math.max(minCol, Math.min(maxCol, pickColumn()));
      if (this.canPlaceFootprint(row, col, footprint, usedCells)) return { row, col };
    }
    for (let row = 0; row <= GRID_SIZE - footprint; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        if (this.canPlaceFootprint(row, col, footprint, usedCells)) return { row, col };
      }
    }
    return undefined;
  }

  private findRandomBossPosition(die: DiceInstanceState, footprint: number, usedCells: Set<string>, rng?: () => number): { row: number; col: number } | undefined {
    const definition = this.getDefinitionForInstance(die);
    const range = definition ? Math.max(1, this.getEffectiveAttackRange(die, definition)) : 4;
    const preferredColumns = Array.from({ length: GRID_SIZE - footprint + 1 }, (_, col) => {
      const candidate: DiceInstanceState = { ...die, gridPosition: { row: 0, col } };
      const covered = getCoveredEnemyColumns(
        candidate,
        range,
        (target) => target === candidate ? footprint : 1
      ).length;
      return { col, covered };
    }).sort((left, right) => right.covered - left.covered || (die.ownerId === 'enemy' ? right.col - left.col : left.col - right.col));
    for (const { col } of preferredColumns) {
      const position = this.findRandomFootprintPosition(footprint, usedCells, () => col, { min: col, max: col }, rng);
      if (position) return position;
    }
    return undefined;
  }

  private isBossDie(die: DiceInstanceState): boolean {
    if (this.activeChallenge === 'dungeon'
      && this.dungeonBossRole === 'mini'
      && this.dungeonBossMinionType
      && die.ownerId === 'enemy'
      && die.typeId === this.dungeonBossMinionType) {
      return true;
    }
    const definition = this.getDefinitionForInstance(die) ?? this.definitions.get(die.typeId);
    return definition?.isBoss === true;
  }

  private getDefinitionsForCombat(...dice: DiceInstanceState[]): Map<string, DiceDefinition> {
    const modified = new Map(this.definitions);
    dice.forEach((die) => {
      const override = this.getDefinitionForInstance(die);
      if (override) modified.set(die.typeId, override);
    });
    return modified;
  }

  private applyClassProgress(definition: DiceDefinition, classLevel: number, options: { uncapped?: boolean } = {}): DiceDefinition {
    return applyClassProgression(definition, classLevel, options);
  }

  private createHandArea() {
    const { width, height } = this.scale;
    this.currentHandOrder = getAvailableHandDice(this.gameState, 'player').map((die) => die.instanceId);
    if (this.currentHandOrder.length === 0) {
      this.currentHandOrder = getAvailableHandDice(this.gameState, 'player').map((die) => die.instanceId);
    }

    const handY = height - 110;
    const startX = (width - (this.currentHandOrder.length * 100)) / 2 + 50;

    this.handContainer = this.add.container(0, 0);

    this.rollHelperText = this.add.text(width / 2, handY - 102, 'CLICK ROLL ALL, THEN DRAG DICE TO YOUR GRID', {
      fontFamily: 'Orbitron',
      fontSize: '14px',
      color: PALETTE.accent
    }).setOrigin(0.5);

    this.createRollAllButton(width / 2, handY - 38);
    this.handContainer.add([this.rollHelperText, this.rollAllButton, this.rollAllButtonLabel]);
    this.handContainer.setVisible(true);

    this.currentHandOrder.forEach((instanceId, index) => {
      const handDie = this.gameState.dice.find((d) => d.instanceId === instanceId);
      if (!handDie) return;
      const definition = this.getDefinitionForInstance(handDie);
      if (!definition) return;

      const x = startX + index * 100;
      const dieContainer = this.createDraggableDie(instanceId, handDie.typeId, definition, x, handY, true);
      this.handDice.set(instanceId, dieContainer);
      this.handContainer.add(dieContainer);
      this.applyHandDieTransformVisual(dieContainer, handDie);
    });
  }

  private createRollAllButton(x: number, y: number) {
    this.rollAllButton = this.add.rectangle(x, y, 100, 28, 0xf4b860, 0.9)
      .setInteractive({ useHandCursor: true });
    this.rollAllButtonLabel = this.add.text(x, y, 'ROLL ALL!', {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: '#000000'
    }).setOrigin(0.5);

    this.rollAllButton.on('pointerover', () => this.rollAllButton.setFillStyle(0xffd700, 1));
    this.rollAllButton.on('pointerout', () => this.rollAllButton.setFillStyle(0xf4b860, 0.9));
    this.rollAllButton.on('pointerdown', () => this.rollAllDice());
  }

  private rollAllDice() {
    if (this.diceRolled) return;
    AudioManager.playSfx(this, AUDIO_KEYS.chestOpen);

    let rollResults: string[] = [];
    this.currentHandOrder.forEach((instanceId) => {
      const handDie = this.gameState.dice.find((d) => d.instanceId === instanceId);
      if (!handDie) return;
      const rolledPips = this.isMultiplayerMatch
        ? (this.dicePips.get(instanceId) ?? 1)
        : secureRandomBetween(1, this.getPipSidesForDie(handDie));
      if (!this.isMultiplayerMatch) this.dicePips.set(instanceId, rolledPips);
      rollResults.push(`${handDie.typeId}:${rolledPips}`);
      const transformed = this.isMultiplayerMatch ? undefined : this.transforms.tryAdvancePipTriggeredTransform(handDie, rolledPips);
      const visualDie = transformed ?? (this.gameState.dice.find((candidate) => candidate.instanceId === instanceId) ?? handDie);
      const container = this.handDice.get(instanceId);
      if (container) {
        const pipText = container.list.find((obj) => obj.name === 'pipText') as Phaser.GameObjects.Text;
        if (pipText) {
          pipText.setText(`${rolledPips}♦`);
          pipText.setColor(PALETTE.accent);
        }
        const visual = this.transforms.getTransformedVisual(visualDie);
        const handDefinition = this.getDefinitionForInstance(visualDie);
        const bg = container.list.find((obj) => obj.name === 'dieBg') as Phaser.GameObjects.Rectangle;
        const label = container.list.find((obj) => obj.name === 'dieLabel') as Phaser.GameObjects.Text;
        const accent = visual?.accent ?? handDefinition?.accent ?? '#ffffff';
        const tint = Phaser.Display.Color.HexStringToColor(accent).color;
        if (bg) {
          bg.setFillStyle(tint, visual ? 0.55 : 0.28);
          bg.setStrokeStyle(2, tint);
        }
        if (label) {
          label.setText(visual?.symbol ?? handDie.typeId.slice(0, 3).toUpperCase());
          label.setColor(accent);
        }
      }
    });

    this.diceRolled = true;
    this.rollAllButton.disableInteractive();
    this.rollAllButton.setFillStyle(0x7f8c8d, 0.5);
    this.rollAllButtonLabel.setText('ROLLED');
    this.updateCombatButtonState();
    this.autoPlaceDisorientedDice('player');
    this.writeCombatLog(`Rolled: ${rollResults.join(', ')}`);
    this.debug.log('All dice rolled', { results: rollResults });
  }

  private canDragDiePostCombat(instanceId: string): boolean {
    if (this.gameState.turn <= 1 || this.gamePhase.stage !== 'placement') return false;
    const die = this.gameState.dice.find((candidate) => candidate.instanceId === instanceId && candidate.ownerId === 'player');
    if (!die) return false;
    const definition = this.getDefinitionForInstance(die);
    return Boolean(definition && getRuntimeSkillMetaForTrigger(definition, 'Passive').canBeDraggedPostCombat);
  }

  private canDoubleClickDragPlacedDie(die: DiceInstanceState): boolean {
    if (this.gameState.turn <= 1 || this.gamePhase.stage !== 'placement' || !this.diceRolled) return false;
    if (die.ownerId !== 'player' || die.zone !== 'board' || die.isDestroyed || !die.gridPosition) return false;
    const definition = this.getDefinitionForInstance(die);
    return Boolean(definition && getRuntimeSkillMetaForTrigger(definition, 'Passive').canBeDraggedPostCombat);
  }

  private canDragReverseDie(instanceId: string): boolean {
    if (this.gamePhase.stage !== 'placement' || !this.diceRolled) return false;
    const die = this.gameState.dice.find((candidate) => candidate.instanceId === instanceId && candidate.ownerId === 'player' && (candidate.zone === 'hand' || candidate.zone === 'board') && !candidate.isDestroyed);
    if (!die) return false;
    const definition = this.getDefinitionForInstance(die);
    return Boolean(definition && getRuntimeSkillMetaForTrigger(definition, 'Passive').canReversePips);
  }

  private getPlacedDieAtPoint(x: number, y: number, excludedInstanceId: string): DiceInstanceState | undefined {
    const renderedTarget = this.playerGridContainer?.list.find((child) =>
      child instanceof Phaser.GameObjects.Rectangle
      && child.getData('isDie')
      && child.getData('dieInstanceId')
      && child.getData('dieInstanceId') !== excludedInstanceId
      && Phaser.Geom.Rectangle.Contains(child.getBounds(), x, y)
    );
    const renderedTargetId = renderedTarget?.getData('dieInstanceId') as string | undefined;
    if (renderedTargetId) {
      return this.gameState.dice.find((die) => die.instanceId === renderedTargetId && die.ownerId === 'player' && die.zone === 'board' && !die.isDestroyed);
    }
    return this.gameState.dice
      .filter((die) => die.ownerId === 'player' && die.zone === 'board' && !die.isDestroyed && die.instanceId !== excludedInstanceId && die.gridPosition)
      .find((die) => {
        const grid = this.getGridContainerForDie(die);
        const scale = grid.scaleX || 1;
        const footprint = this.getFootprintForDie(die);
        const visualSize = footprint * TILE_SIZE + (footprint - 1) * TILE_GAP - 8;
        const centerX = grid.x + (die.gridPosition!.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2 + (footprint - 1) * (TILE_SIZE + TILE_GAP) / 2) * scale;
        const centerY = grid.y + (die.gridPosition!.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2 + (footprint - 1) * (TILE_SIZE + TILE_GAP) / 2) * scale;
        const halfSize = visualSize * scale / 2;
        return Math.abs(x - centerX) <= halfSize && Math.abs(y - centerY) <= halfSize;
      });
  }

  private getPipsForDie(die: DiceInstanceState): number {
    return die.ownerId === 'player'
      ? (this.dicePips.get(die.instanceId) ?? 1)
      : (this.enemyDicePips.get(die.instanceId) ?? 1);
  }

  private updateHandPipText(die: DiceInstanceState) {
    const container = this.handDice.get(die.instanceId);
    const pipText = container?.list.find((object) => object.name === 'pipText') as Phaser.GameObjects.Text | undefined;
    pipText?.setText(`${this.getPipsForDie(die)}♦`);
  }

  private setPipsForDie(die: DiceInstanceState, pips: number) {
    if (die.ownerId === 'player') this.dicePips.set(die.instanceId, pips);
    else this.enemyDicePips.set(die.instanceId, pips);
  }

  private tryReversePipsDrop(container: Phaser.GameObjects.Container, reverseDie: DiceInstanceState, dropX: number, dropY: number): boolean {
    if (this.isMultiplayerMatch && (this.multiplayerReady || this.multiplayerSubmitting)) return false;
    if (!this.canDragReverseDie(reverseDie.instanceId)) return false;
    const target = this.getReverseTargetAtPoint(dropX, dropY, reverseDie.instanceId);
    if (!target) return false;

    const definition = this.getDefinitionForInstance(reverseDie);
    if (!definition) return false;
    const meta = getRuntimeSkillMetaForTrigger(definition, 'Passive');
    const currentTurn = this.gameState.turn;
    const cooldownUntilTurn = this.reverseCooldownUntilTurnByInstance.get(reverseDie.instanceId);
    if (cooldownUntilTurn !== undefined && currentTurn < cooldownUntilTurn) {
      this.writeCombatLog(`${this.getCombatDieName(reverseDie)} is recovering and cannot reverse pips this turn.`);
      this.returnDieToHand(container, reverseDie.instanceId);
      return true;
    }
    if (cooldownUntilTurn !== undefined) {
      this.reverseCooldownUntilTurnByInstance.delete(reverseDie.instanceId);
      this.reverseUsesByInstance.delete(reverseDie.instanceId);
    }
    const lastUsedTurn = this.reverseLastUsedTurnByInstance.get(reverseDie.instanceId);
    if (lastUsedTurn === currentTurn) {
      this.writeCombatLog(`${this.getCombatDieName(reverseDie)} can only reverse pips once per turn.`);
      this.returnDieToHand(container, reverseDie.instanceId);
      return true;
    }
    const reverseLimit = meta.reverseLimit;
    const uses = this.reverseUsesByInstance.get(reverseDie.instanceId) ?? 0;
    if (reverseLimit !== undefined && uses >= reverseLimit) {
      this.writeCombatLog(`${this.getCombatDieName(reverseDie)} has exhausted its reverse exchanges.`);
      this.returnDieToHand(container, reverseDie.instanceId);
      return true;
    }

    const reversePips = this.getPipsForDie(reverseDie);
    const targetPips = this.getPipsForDie(target);
    if (reversePips === targetPips) {
      this.writeCombatLog(`${this.getCombatDieName(reverseDie)} and ${this.getCombatDieName(target)} already have the same pip count.`);
      this.returnDieToHand(container, reverseDie.instanceId);
      return true;
    }
    this.setPipsForDie(reverseDie, targetPips);
    this.setPipsForDie(target, reversePips);
    const reverseDefinition = this.getDefinitionForInstance(reverseDie);
    const reverseMeta = reverseDefinition ? getRuntimeSkillMeta(reverseDefinition) : undefined;
    if (reverseMeta?.skillSfxKey) AudioManager.playSfx(this, reverseMeta.skillSfxKey);
	this.transforms.reconcilePipTriggeredTransform(reverseDie, targetPips);
    this.transforms.reconcilePipTriggeredTransform(target, reversePips);
    this.reverseLastUsedTurnByInstance.set(reverseDie.instanceId, currentTurn);
    const nextUses = uses + 1;
    if (reverseLimit !== undefined) {
      this.reverseUsesByInstance.set(reverseDie.instanceId, nextUses);
      if (nextUses >= reverseLimit) {
        const cooldownTurns = Math.max(0, Math.floor(meta.reverseCooldown ?? 1));
        if (cooldownTurns > 0) {
          this.reverseCooldownUntilTurnByInstance.set(reverseDie.instanceId, currentTurn + cooldownTurns);
        } else {
          this.reverseCooldownUntilTurnByInstance.delete(reverseDie.instanceId);
          this.reverseUsesByInstance.delete(reverseDie.instanceId);
        }
      }
    }

    const pipText = container.list.find((object) => object.name === 'pipText') as Phaser.GameObjects.Text | undefined;
    pipText?.setText(`${targetPips}♦`);
    this.updateHandPipText(target);
	this.refreshHandDieVisuals();
    this.renderDice();
    const liveReverseDie = this.gameState.dice.find((die) => die.instanceId === reverseDie.instanceId) ?? reverseDie;
    this.updateReverseIndicator(container, liveReverseDie);
    this.returnDieToHand(container, reverseDie.instanceId);
    this.writeCombatLog(`↔️ ${this.getCombatDieName(reverseDie)} reverses pips with ${this.getCombatDieName(target)} (${reversePips} ↔ ${targetPips}).`);
    return true;
  }

  private resetReverseCooldownsAtTurnStart() {
    const currentTurn = this.gameState.turn;
    this.reverseCooldownUntilTurnByInstance.forEach((availableTurn, instanceId) => {
      if (availableTurn <= currentTurn) {
        this.reverseCooldownUntilTurnByInstance.delete(instanceId);
        this.reverseUsesByInstance.delete(instanceId);
        this.reverseLastUsedTurnByInstance.delete(instanceId);
      }
    });
  }

  private getReverseIndicatorText(die: DiceInstanceState, meta: ReturnType<typeof getRuntimeSkillMeta>): string {
    if (meta.reverseLimit === undefined) return '↔ ∞';
    const uses = this.reverseUsesByInstance.get(die.instanceId) ?? 0;
    return `↔ ${Math.max(0, meta.reverseLimit - uses)}/${meta.reverseLimit}`;
  }

  private getReverseIndicatorColor(die: DiceInstanceState, meta: ReturnType<typeof getRuntimeSkillMeta>): string {
    if (meta.reverseLimit === undefined) return '#9dffb0';
    const cooldownUntilTurn = this.reverseCooldownUntilTurnByInstance.get(die.instanceId);
    const uses = this.reverseUsesByInstance.get(die.instanceId) ?? 0;
    return (uses >= meta.reverseLimit || (cooldownUntilTurn !== undefined && this.gameState.turn < cooldownUntilTurn))
      ? '#ff6b6b'
      : '#9dffb0';
  }

  private renderReverseIndicator(container: Phaser.GameObjects.Container, x: number, y: number, die: DiceInstanceState, definition: DiceDefinition) {
    const meta = getRuntimeSkillMetaForTrigger(definition, 'Passive');
    if (!meta.canReversePips) return;
    const indicator = this.add.text(x, y + 36, this.getReverseIndicatorText(die, meta), {
      fontFamily: 'Orbitron',
      fontSize: '8px',
      color: this.getReverseIndicatorColor(die, meta),
      stroke: '#071018',
      strokeThickness: 2
    }).setOrigin(0.5);
    indicator.setName('die-info');
    indicator.setData('reverseIndicator', true);
    container.add(indicator);
  }

  private updateReverseIndicator(container: Phaser.GameObjects.Container, die: DiceInstanceState) {
    const definition = this.getDefinitionForInstance(die);
    if (!definition) return;
    const meta = getRuntimeSkillMetaForTrigger(definition, 'Passive');
    const indicator = container.list.find((object) => object.getData('reverseIndicator')) as Phaser.GameObjects.Text | undefined;
    if (indicator) {
      indicator.setText(this.getReverseIndicatorText(die, meta));
      indicator.setColor(this.getReverseIndicatorColor(die, meta));
    }
  }

  private getReverseTargetAtPoint(x: number, y: number, excludedInstanceId: string): DiceInstanceState | undefined {
    const handTarget = [...this.handDice.entries()]
      .filter(([instanceId]) => instanceId !== excludedInstanceId)
      .find(([, container]) => Phaser.Geom.Rectangle.Contains(container.getBounds(), x, y));
    if (handTarget) {
      return this.gameState.dice.find((die) =>
        die.instanceId === handTarget[0]
        && die.ownerId === 'player'
        && die.zone === 'hand'
        && !die.isDestroyed
      );
    }
    return this.getPlacedDieAtPoint(x, y, excludedInstanceId);
  }

  private beginPlacedReverseDrag(die: DiceInstanceState, sourceRect: Phaser.GameObjects.Rectangle) {
    if (this.isMultiplayerMatch && (this.multiplayerReady || this.multiplayerSubmitting)) return;
    if (!this.canDragReverseDie(die.instanceId)) return;
    this.activePostCombatDragProxy?.destroy();
    const definition = this.getDefinitionForInstance(die);
    if (!definition) return;
    const bounds = sourceRect.getBounds();
    const color = Phaser.Display.Color.HexStringToColor(definition.accent).color;
    const proxy = this.add.container(bounds.centerX, bounds.centerY).setDepth(500);
    proxy.setSize(60, 70);
    const bg = this.add.rectangle(0, 0, 56, 56, color, 0.45).setStrokeStyle(2, color);
    const label = this.add.text(0, -15, definition.typeId.slice(0, 3).toUpperCase(), { fontFamily: 'Orbitron', fontSize: '12px', color: definition.accent }).setOrigin(0.5);
    const pipText = this.add.text(0, 5, `${this.getPipsForDie(die)}♦`, { fontFamily: 'Orbitron', fontSize: '14px', color: PALETTE.accent }).setOrigin(0.5);
    pipText.setName('pipText');
    proxy.add([bg, label, pipText]);
    this.renderReverseIndicator(proxy, 0, 0, die, definition);
    proxy.setInteractive({ draggable: true, useHandCursor: true });
    this.input.setDraggable(proxy);
    this.activePostCombatDragProxy = proxy;
    proxy.on('dragstart', () => {
      proxy.setScale(1.1);
      this.highlightValidDropZones(true, true);
    });
    proxy.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      proxy.x = dragX;
      proxy.y = dragY;
    });
    proxy.on('dragend', () => {
      const dropX = proxy.getBounds().centerX;
      const dropY = proxy.getBounds().centerY;
      proxy.setScale(1);
      this.highlightValidDropZones(false, true);
      if (this.gamePhase.stage !== 'placement') {
        proxy.destroy();
        if (this.activePostCombatDragProxy === proxy) this.activePostCombatDragProxy = null;
        return;
      }
      const liveDie = this.gameState.dice.find((candidate) => candidate.instanceId === die.instanceId);
      const reversed = liveDie ? this.tryReversePipsDrop(proxy, liveDie, dropX, dropY) : false;
      if (!reversed) this.writeCombatLog(`${this.getCombatDieName(die)} stayed in place.`);
      proxy.destroy();
      if (this.activePostCombatDragProxy === proxy) this.activePostCombatDragProxy = null;
    });
  }

  private beginPlacedRepositionDrag(die: DiceInstanceState, sourceRect: Phaser.GameObjects.Rectangle) {
    if (this.isMultiplayerMatch && (this.multiplayerReady || this.multiplayerSubmitting)) return;
    if (!this.canDoubleClickDragPlacedDie(die)) return;
    const definition = this.getDefinitionForInstance(die);
    if (!definition || !getRuntimeSkillMetaForTrigger(definition, 'Passive').canBeRepositioned) return;
    const bounds = sourceRect.getBounds();
    const color = Phaser.Display.Color.HexStringToColor(definition.accent).color;
    const proxy = this.add.container(bounds.centerX, bounds.centerY).setDepth(500);
    proxy.setSize(60, 70);
    proxy.add([
      this.add.rectangle(0, 0, 56, 56, color, 0.45).setStrokeStyle(2, color),
      this.add.text(0, -15, definition.typeId.slice(0, 3).toUpperCase(), { fontFamily: 'Orbitron', fontSize: '12px', color: definition.accent }).setOrigin(0.5),
      this.add.text(0, 5, `${this.getPipsForDie(die)}♦`, { fontFamily: 'Orbitron', fontSize: '14px', color: PALETTE.accent }).setOrigin(0.5)
    ]);
    proxy.setInteractive({ draggable: true, useHandCursor: true });
    this.input.setDraggable(proxy);
    this.activePostCombatDragProxy = proxy;
    proxy.on('dragstart', () => {
      proxy.setScale(1.1);
      this.highlightValidDropZones(true, false);
    });
    proxy.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      proxy.x = dragX;
      proxy.y = dragY;
    });
    proxy.on('dragend', () => {
      const dropX = proxy.getBounds().centerX;
      const dropY = proxy.getBounds().centerY;
      proxy.setScale(1);
      this.highlightValidDropZones(false, false);
      if (this.gamePhase.stage !== 'placement') {
        proxy.destroy();
        if (this.activePostCombatDragProxy === proxy) this.activePostCombatDragProxy = null;
        return;
      }
      const droppedZone = this.gridDropZones.find((zone) => Phaser.Geom.Rectangle.Contains(zone.getBounds(), dropX, dropY));
      const liveDie = this.gameState.dice.find((candidate) => candidate.instanceId === die.instanceId && candidate.zone === 'board' && !candidate.isDestroyed);
      if (!droppedZone || !liveDie) {
        this.writeCombatLog(`${this.getCombatDieName(die)} stayed in place.`);
      } else {
        const gridPos = droppedZone.getData('gridPos') as { row: number; col: number };
        const footprint = this.getFootprintForDie(liveDie);
        const usedCells = this.collectOccupiedCells('player', liveDie.instanceId);
        if (!this.canPlaceFootprint(gridPos.row, gridPos.col, footprint, usedCells)) {
          this.writeCombatLog(`${this.getCombatDieName(die)} cannot be repositioned there.`);
        } else {
          this.gameState = placeDieOnBoard(this.gameState, liveDie.instanceId, gridPos.row, gridPos.col);
          this.clearRangeHighlights();
          this.renderDice();
          this.writeCombatLog(`↔️ Repositioned ${this.getCombatDieName(die)} to [${gridPos.row}, ${gridPos.col}].`);
        }
      }
      proxy.destroy();
      if (this.activePostCombatDragProxy === proxy) this.activePostCombatDragProxy = null;
    });
  }

  private createDraggableDie(instanceId: string, typeId: DiceTypeId, definition: DiceDefinition, x: number, y: number, draggable: boolean): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);
    container.setSize(60, 70);

    const color = Phaser.Display.Color.HexStringToColor(definition.accent).color;

    const bg = this.add.rectangle(0, 0, 56, 56, color, 0.28)
      .setStrokeStyle(2, color);
    (bg as Phaser.GameObjects.Rectangle).setData('isDie', true);
    bg.name = 'dieBg';

    const label = this.add.text(0, -15, typeId.slice(0, 3).toUpperCase(), {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: definition.accent
    }).setOrigin(0.5);
    label.name = 'dieLabel';

    const pipText = this.add.text(0, 5, '?♦', {
      fontFamily: 'Orbitron',
      fontSize: '14px',
      color: PALETTE.textMuted
    }).setOrigin(0.5);
    (pipText as Phaser.GameObjects.Text).setName('pipText');

    container.add([bg, label, pipText]);
    const handDie = this.getPlayerHandDie(instanceId);
    if (handDie) {
      this.renderStatusEffects(container, 0, 0, handDie);
      this.renderReverseIndicator(container, 0, 0, handDie, definition);
    }

    if (draggable) {
      container.setInteractive({ draggable: true, useHandCursor: true });
      this.input.setDraggable(container);

      container.on('dragstart', () => {
        if (this.gamePhase.stage !== 'placement') return;
        const canReverse = this.canDragReverseDie(instanceId);
        if (!this.diceRolled && !this.canDragDiePostCombat(instanceId) && !canReverse) {
          return;
        }
        container.setScale(1.1);
        container.setDepth(100);
        this.highlightValidDropZones(true, canReverse);
      });

      container.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
        if (this.gamePhase.stage !== 'placement') return;
        const canReverse = this.canDragReverseDie(instanceId);
        if (!this.diceRolled && !this.canDragDiePostCombat(instanceId) && !canReverse) return;
        container.x = dragX;
        container.y = dragY;
      });

      container.on('dragend', () => {
        const canReverse = this.canDragReverseDie(instanceId);
        if (!this.diceRolled && !this.canDragDiePostCombat(instanceId) && !canReverse) {
          this.returnDieToHand(container, instanceId);
          return;
        }
        const dropX = container.getBounds().centerX;
        const dropY = container.getBounds().centerY;
        container.setScale(1);
        container.setDepth(0);
        this.highlightValidDropZones(false, canReverse);
        if (this.gamePhase.stage !== 'placement') {
          this.reflowHandPositions(instanceId, container);
          return;
        }
        const reverseDie = this.gameState.dice.find((die) => die.instanceId === instanceId);
        if (reverseDie && this.tryReversePipsDrop(container, reverseDie, dropX, dropY)) return;
        this.tryPlaceDie(container, instanceId);
      });
    }

    return container;
  }

  private applyHandDieTransformVisual(container: Phaser.GameObjects.Container, handDie: DiceInstanceState) {
    const visual = this.transforms.getTransformedVisual(handDie);
    const definition = this.getDefinitionForInstance(handDie);
    if (!definition) return;
    const accent = visual?.accent ?? definition.accent;
    const tint = Phaser.Display.Color.HexStringToColor(accent).color;
    const bg = container.list.find((obj) => obj.name === 'dieBg') as Phaser.GameObjects.Rectangle | undefined;
    const label = container.list.find((obj) => obj.name === 'dieLabel') as Phaser.GameObjects.Text | undefined;
    if (bg) {
      bg.setFillStyle(tint, visual ? 0.55 : 0.28);
      bg.setStrokeStyle(2, tint);
    }
    if (label) {
      label.setText(visual?.symbol ?? handDie.typeId.slice(0, 3).toUpperCase());
      label.setColor(accent);
    }
  }

  private invisiRollForEnemies() {
    const enemyDice = this.gameState.dice.filter(die => die.ownerId === 'enemy' && die.zone === 'board');
    const pipRng = this.getDungeonEnemyPipRng();
    enemyDice.forEach(die => {
      const rolled = this.rollPipsForEnemyDie(die, pipRng);
      this.enemyDicePips.set(die.instanceId, rolled);
    });
    this.debug.log('Enemy invisiroll complete', { count: enemyDice.length });
  }
  
  private getPipCount(typeId: DiceTypeId): number {
    switch (typeId) {
      default: return 1;
    }
  }

  private getPipSidesForDie(die: DiceInstanceState): number {
    if (die.ownerId === 'enemy' && this.activeChallenge === 'dungeon' && this.isBossDie(die)) {
      return getDungeonEliteDieSides(this.dungeonWave);
    }
    const bodySides = this.getDungeonCardBodySides(die.ownerId, die.typeId);
    return bodySides > 0 ? bodySides : 6;
  }

  private getDungeonCardBodySides(ownerId: DiceInstanceState['ownerId'], typeId: string): number {
    if (ownerId !== 'player' || !this.areDungeonCardsEnabled()) return 0;
    return getDungeonCardEffects(this.dungeonCardState, typeId).bodySides;
  }

  private rollPipsForEnemyDie(die: DiceInstanceState, rng?: () => number): number {
    return this.rollSeededInt(1, this.getPipSidesForDie(die), rng);
  }

  private getDungeonEnemyPlacementRng(): (() => number) | undefined {
    if (this.activeChallenge !== 'dungeon' || !this.dungeonEventKey) return undefined;
    return createDungeonSeededRng(`${this.dungeonEventKey}:dungeon-enemy-placement:${this.dungeonWave}:v1`);
  }

  private getDungeonEnemyPipRng(): (() => number) | undefined {
    if (this.activeChallenge !== 'dungeon' || !this.dungeonEventKey) return undefined;
    return createDungeonSeededRng(`${this.dungeonEventKey}:dungeon-enemy-pips:${this.dungeonWave}:${Math.max(1, this.gameState.turn)}:v1`);
  }

  private rollSeededInt(min: number, max: number, rng?: () => number): number {
    return rng ? rollDungeonSeededInt(rng, min, max) : Phaser.Math.Between(min, max);
  }

  private rollSeededChance(chance: number, rng?: () => number): boolean {
    return (rng ? rng() : secureRandom()) < chance;
  }

  private areDungeonCardsEnabled(): boolean {
    return this.activeChallenge === 'dungeon'
      && getDungeonDevState(this).dungeonCardsEnabled
      && canUseDungeonCards(this.dungeonModifier);
  }

  private getDungeonCardTypeName(typeId: string): string {
    const definition = this.definitions.get(typeId) ?? (this.cache.json.get(`dice:${typeId}`) as DiceDefinition | undefined);
    return (definition?.title ?? this.formatCombatTypeName(typeId)).replace(/\s+Dice$/i, '');
  }

  private getDungeonCardEffectsForDie(die: DiceInstanceState): DungeonCardEffects | undefined {
    if (!this.areDungeonCardsEnabled() || die.ownerId !== 'player') return undefined;
    return getDungeonCardEffects(this.dungeonCardState, die.typeId);
  }

  private getDungeonCardEligibleTypeIds(): string[] {
    return [...new Set(this.gameState.dice
      .filter((die) => die.ownerId === 'player')
      .map((die) => die.typeId))];
  }

  private getDungeonCardManaTypeIds(): string[] {
    const eligible = new Set<string>();
    this.gameState.dice.filter((die) => die.ownerId === 'player').forEach((die) => {
      if (eligible.has(die.typeId)) return;
      const definition = this.getDefinitionForInstance(die) ?? this.definitions.get(die.typeId);
      if (!definition) return;
      const classLevel = this.instanceClassLevels.get(die.instanceId) ?? 1;
      const hasActiveSkill = getValidSkillDefinitions(definition).some((skill) => {
        if (skill.type !== 'Active') return false;
        const lockClass = getSkillLockClass(skill);
        return lockClass === undefined || classLevel >= lockClass;
      });
      if (hasActiveSkill) eligible.add(die.typeId);
    });
    return [...eligible];
  }

  private rollDungeonCardOffer(
    state: DungeonCardState = this.dungeonCardState,
    bottomDeckKeys?: ReadonlySet<string>
  ): DungeonCard[] {
    return rollDungeonCardChoices(
      state,
      {
        typeIds: this.getDungeonCardEligibleTypeIds(),
        activeSkillTypeIds: this.getDungeonCardManaTypeIds(),
        bottomDeckKeys
      },
      3,
      this.getDungeonCardOfferRng(state)
    );
  }

  private getDungeonScopeMarkRng(state: DungeonCardState = this.dungeonCardState): () => number {
    return createDungeonSeededRng(`dungeon-scope-marks:${this.dungeonEventKey}:${this.dungeonWave}:${state.cardsPicked}:${state.shufflesUsed}:${state.scopeStacks}:v1`);
  }

  private getDungeonCardOfferRng(state: DungeonCardState = this.dungeonCardState): () => number {
    return createDungeonSeededRng(`dungeon-card-offer:${this.dungeonEventKey}:${this.dungeonWave}:${state.cardsPicked}:${state.shufflesUsed}:v1`);
  }

  private getDungeonNextShuffleState(turn: number): DungeonCardState {
    return {
      ...this.dungeonCardState,
      shufflesUsed: this.dungeonCardState.shufflesUsed + 1,
      lastShuffleTurn: turn
    };
  }

  private payDungeonCardShuffle(cost: number, nextState: DungeonCardState): boolean {
    if (cost <= 0) {
      if (this.persistDungeonCardState(nextState)) return true;
      discardDungeonRunCache(this);
      AlertManager.toast(this, { type: 'warning', message: 'Shuffle could not be saved — try again.' });
      return false;
    }
    const walletBefore = getDiamonds(this);
    if (walletBefore < cost) return false;
    const walletAfter = walletBefore - cost;
    const spend = beginDungeonCardSpend(this, {
      eventKey: this.dungeonEventKey,
      wave: this.dungeonWave,
      turn: this.gameState.turn,
      cost,
      shufflesUsed: nextState.shufflesUsed,
      walletBefore,
      walletAfter
    });
    if (!spend) {
      AlertManager.toast(this, { type: 'warning', message: 'Shuffle could not be started — no Diamonds were spent.' });
      return false;
    }
    if (!setDiamonds(this, walletAfter)) {
      this.settleDungeonCardSpendRefund(this.buildDungeonCarryover());
      discardDungeonRunCache(this);
      AlertManager.toast(this, { type: 'warning', message: 'Shuffle could not be charged — no unsaved charge was kept.' });
      return false;
    }
    if (!markDungeonCardSpendDebited(this, spend)) {
      this.settleDungeonCardSpendRefund(this.buildDungeonCarryover());
      discardDungeonRunCache(this);
      AlertManager.toast(this, { type: 'warning', message: 'Shuffle could not be verified — the charge was refunded.' });
      return false;
    }
    if (this.persistDungeonCardState(nextState)) {
      clearDungeonCardSpend(this);
      return true;
    }
    this.settleDungeonCardSpendRefund(this.buildDungeonCarryover());
    discardDungeonRunCache(this);
    AlertManager.toast(this, { type: 'warning', message: 'Shuffle refunded — dungeon progress could not be saved.' });
    return false;
  }

  private settleDungeonCardSpendRefund(savedCarryover: DungeonCarryover | null) {
    const spend = getDungeonCardSpend(this);
    if (!spend) return;
    const settlement = applyDungeonCardSpendRefund({
      spend,
      eventKey: this.dungeonEventKey,
      wave: this.dungeonWave,
      savedShufflesUsed: savedCarryover?.dungeonCards?.shufflesUsed ?? 0,
      currentDiamonds: getDiamonds(this),
      persistRefund: (nextDiamonds) => setDiamonds(this, nextDiamonds)
    });
    if (settlement.pending) {
      AlertManager.toast(this, { type: 'warning', message: 'A Dungeon Card shuffle refund is pending. Reopen the dungeon to retry it.' });
      return;
    }
    if (!settlement.clear) return;
    clearDungeonCardSpend(this);
    if (settlement.refunded > 0) {
      AlertManager.toast(this, { type: 'warning', message: `Refunded ${formatCompact(settlement.refunded)} Diamonds from an unsaved Dungeon Card shuffle.` });
    }
  }

  private applyDungeonCardHealth(typeId: string, previousRate: number, nextRate: number) {
    if (nextRate <= previousRate) return;
    const effects = getDungeonCardEffects(this.dungeonCardState, typeId);
    this.gameState = {
      ...this.gameState,
      dice: this.gameState.dice.map((die) => {
        if (die.ownerId !== 'player' || die.typeId !== typeId) return die;
        const definition = this.getDefinitionForInstance(die);
        const baseDefinition = this.getCombatBaseDefinition(die);
        const uncardedHealth = Math.max(
          definition ? removeDungeonCardHealth(definition, effects).health : die.maxHealth,
          baseDefinition?.health ?? 0
        );
        const adjustment = resolveDungeonCardHealthAdjustment({
          maxHealth: die.maxHealth,
          currentHealth: die.currentHealth,
          isDestroyed: die.isDestroyed,
          uncardedHealth,
          previousRate,
          nextRate
        });
        return {
          ...die,
          ...adjustment
        };
      })
    };
  }

  private applyDungeonCardChoice(card: DungeonCard, render: boolean) {
    const before = getDungeonCardEffects(this.dungeonCardState, card.typeId);
    const { draftOffer: _draftOffer, ...stateWithoutOffer } = this.dungeonCardState;
    const pickedState = pickDungeonCard(stateWithoutOffer, card);
    if (pickedState.cards.length === stateWithoutOffer.cards.length) return;
    const nextState = card.kind === 'Gunned Down'
      ? ensureDungeonScopeMarks(pickedState, this.getDungeonScopeMarkRng(pickedState))
      : pickedState;
    this.dungeonCardState = nextState;
    const after = getDungeonCardEffects(nextState, card.typeId);
    this.applyDungeonCardHealth(card.typeId, before.healthBonusRate, after.healthBonusRate);
    const stack = getDungeonCardStackCount(nextState, card);
    const targetName = this.getDungeonCardTypeName(card.typeId);
    const stackLabel = getDungeonCardPresentation(card, targetName, stack).stackLabel;
    this.writeCombatLog(`Dungeon Card: ${card.title} (${card.rarity}) → ${targetName} [${stackLabel}].`);
    AudioManager.playSfx(this, AUDIO_KEYS.chestOpen);
    this.renderDiceCardInfoPanel();
    if (render) {
      this.renderDice();
      this.renderEnemyDice();
      this.updateCombatButtonState();
    }
  }

  private isDungeonScopeMarked(die: DiceInstanceState): boolean {
    if (!die.gridPosition || !this.areDungeonCardsEnabled() || die.ownerId !== 'player') return false;
    const tileIndex = die.gridPosition.row * GRID_SIZE + die.gridPosition.col;
    return this.dungeonCardState.scopeMarks.includes(tileIndex);
  }

  private getDungeonScopeShotPlan(attacker: DiceInstanceState): {
    target: DiceInstanceState;
    meta: ReturnType<typeof getRuntimeSkillMeta>;
  } | null {
    if (attacker.ownerId !== 'player' || !this.isDungeonScopeMarked(attacker)) return null;
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition) return null;
    const meta = getRuntimeSkillMeta(definition);
    const scopeChance = meta.scopeChance ?? 1;
    if (!meta.hasScope || scopeChance <= 0) return null;
    const target = this.findSkillTargetForArena(attacker, 'Strongest', false);
    if (!target) return null;
    if (!secureChance(scopeChance)) return null;
    return { target, meta };
  }

  private async playDungeonScopeLockOn(target: DiceInstanceState): Promise<void> {
    const center = this.getTileCenter(target);
    let reticle: Phaser.GameObjects.Container | undefined;
    if (center) {
      reticle = this.add.container(center.x, center.y).setDepth(305);
      const ring = this.add.circle(0, 0, Math.max(20, TILE_SIZE * 0.38), 0xffd84d, 0.08)
        .setStrokeStyle(2, 0xffd84d, 0.95);
      const inner = this.add.circle(0, 0, Math.max(8, TILE_SIZE * 0.18), 0x000000, 0)
        .setStrokeStyle(1, 0xffffff, 0.8);
      const crosshair = this.add.text(0, 0, '⌖', {
        fontFamily: 'Orbitron',
        fontSize: `${Math.max(18, Math.round(TILE_SIZE * 0.44))}px`,
        color: '#ffd84d'
      }).setOrigin(0.5);
      reticle.add([ring, inner, crosshair]);
      this.tweens.add({ targets: reticle, angle: 180, duration: 1000, ease: 'Sine.easeInOut' });
      this.tweens.add({ targets: reticle, scale: { from: 1.45, to: 1 }, duration: 180, ease: 'Cubic.easeOut' });
    }
    AudioManager.playSfx(this, AUDIO_KEYS.sniperLockOn);
    await this.delay(1000);
    if (reticle) {
      this.tweens.killTweensOf(reticle);
      reticle.destroy(true);
    }
    AudioManager.playSfx(this, AUDIO_KEYS.sniperShoot);
  }

  private async executeDungeonScopeShot(
    attacker: DiceInstanceState,
    target: DiceInstanceState,
    basicDamage: number,
    meta: ReturnType<typeof getRuntimeSkillMeta>
  ): Promise<{ dealt: number; absorbed: number; defeated: boolean }> {
    await this.playDungeonScopeLockOn(target);
    const currentStacks = this.getScopeStacksForDie(attacker);
    const scopeDamage = resolveScopeShotDamage({
      basicDamage,
      scopeDamage: meta.scopeDamage,
      scopeDamageMult: meta.scopeDamageMult,
      scopeDamageIncreasePerStack: meta.scopeDamageIncreasePerStack,
      scopeStacks: currentStacks
    });
    const hit = this.applyDamageWithRevive(target.instanceId, scopeDamage, { source: attacker });
    this.gameState = hit.state;
    const scoredKill = hit.defeated || hit.killed;
    const nextStacks = scoredKill ? addScopeStack(currentStacks, meta.maxScopeStacks) : currentStacks;
    if (nextStacks > currentStacks) this.scopeStacksByInstance.set(attacker.instanceId, nextStacks);
    this.showDamageText(target, hit.dealt, '#ffd84d');
    this.showHeadshotText(target);
    await this.applyDamageDefeatHooks(attacker, target, scoredKill);
    const targetName = this.getCombatDieName(target);
    this.writeCombatLog(`🔭 ${this.getCombatDieName(attacker)} lands a scope shot on ${targetName} for ${this.formatDamageFeedback(hit)} damage!`);
    this.addCombatActionDetail(`Scope shot hit ${targetName} for ${this.formatDamageFeedback(hit)} damage`);
    if (scoredKill) {
      const bonus = formatPercent(nextStacks * (meta.scopeDamageIncreasePerStack ?? 0));
      const cap = meta.maxScopeStacks;
      this.renderDiceCardInfoPanel();
      this.writeCombatLog(`🔭 Scope kill confirmed — ${nextStacks}${cap === undefined ? '' : `/${cap}`} stack${nextStacks === 1 ? '' : 's'}, +${bonus} scope damage.`);
    }
    return { dealt: hit.dealt, absorbed: hit.absorbed, defeated: scoredKill };
  }

  private applyDungeonCardManaAtCombatStart() {
    if (!this.areDungeonCardsEnabled()) return;
    this.gameState.dice
      .filter((die) => die.ownerId === 'player' && die.zone === 'board' && !die.isDestroyed)
      .forEach((die) => {
        const gain = this.getDungeonCardEffectsForDie(die)?.manaCharge ?? 0;
        if (gain > 0) this.addManaToAllActiveSlots(die, Math.floor(gain));
      });
  }

  private applyDungeonCardCombatEndRegen() {
    if (!this.areDungeonCardsEnabled()) return;
    const healed: Array<{ die: DiceInstanceState; amount: number }> = [];
    this.gameState = {
      ...this.gameState,
      dice: this.gameState.dice.map((die) => {
        if (die.ownerId !== 'player' || die.isDestroyed) return die;
        const rate = this.getDungeonCardEffectsForDie(die)?.regenRate ?? 0;
        const amount = resolveCombatEndHealAmount(die.maxHealth, die.currentHealth, rate);
        if (amount <= 0) return die;
        healed.push({ die, amount });
        return { ...die, currentHealth: Math.min(die.maxHealth, die.currentHealth + amount) };
      })
    };
    healed.forEach(({ die, amount }) => {
      this.showHealText(die, amount);
      this.writeCombatLog(`${this.getQualifiedCombatDieName(die)} rejuvenates ${formatCompact(amount)} health from Dungeon Cards.`);
    });
  }

  private recordDungeonCardKill(defeated: DiceInstanceState) {
    if (!this.areDungeonCardsEnabled() || defeated.ownerId !== 'enemy') return;
    const before = this.dungeonCardState.pendingDraws;
    this.dungeonCardState = registerDungeonCardKills(this.dungeonCardState, 1);
    if (this.dungeonCardState.pendingDraws > before) {
      this.writeCombatLog(`Dungeon Card ready! ${this.dungeonCardState.pendingDraws} draw${this.dungeonCardState.pendingDraws === 1 ? '' : 's'} waiting.`);
    }
    this.renderDiceCardInfoPanel();
  }

  private setupGridDropZones() {
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const x = col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
        const y = row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;

        const zone = this.add.rectangle(x, y, TILE_SIZE - 4, TILE_SIZE - 4, 0x00ff00, 0)
          .setInteractive({ dropZone: true });

        zone.setData('gridPos', { row, col });
        this.playerGridContainer.add(zone);
        this.gridDropZones.push(zone);
      }
    }
  }

  private highlightValidDropZones(highlight: boolean, reverseDrag = false) {
    if (reverseDrag && this.gamePhase.stage !== 'placement') {
      highlight = false;
      reverseDrag = false;
    }
    const occupiedCells = reverseDrag ? this.collectOccupiedCells('player') : undefined;
    this.gridDropZones.forEach((zone) => {
      const gridPos = zone.getData('gridPos') as { row: number; col: number } | undefined;
      const occupied = Boolean(reverseDrag && gridPos && occupiedCells?.has(`${gridPos.row},${gridPos.col}`));
      const tint = reverseDrag && occupied ? 0xffffff : 0x2ecc71;
      zone.setFillStyle(highlight ? tint : 0x00ff00, highlight ? 0.3 : 0);
      zone.setStrokeStyle(highlight && reverseDrag && occupied ? 2 : 0, 0xffffff, highlight && reverseDrag && occupied ? 0.75 : 0);
    });

    this.handDice.forEach((container, instanceId) => {
      const bg = container.list.find((object) => object.name === 'dieBg') as Phaser.GameObjects.Rectangle | undefined;
      const label = container.list.find((object) => object.name === 'dieLabel') as Phaser.GameObjects.Text | undefined;
      const die = this.getPlayerHandDie(instanceId);
      const definition = die ? this.getDefinitionForInstance(die) : undefined;
      if (!bg || !definition) return;
      if (!reverseDrag) {
        this.applyHandDieTransformVisual(container, die);
        return;
      }
      bg.setFillStyle(0xffffff, 0.42);
      bg.setStrokeStyle(2, 0xffffff);
      if (label) label.setColor('#ffffff');
    });

    const boardDice = this.playerGridContainer?.list.filter((child) => child instanceof Phaser.GameObjects.Rectangle && child.getData('isDie')) ?? [];
    boardDice.forEach((child) => {
      const dieRect = child as Phaser.GameObjects.Rectangle;
      const instanceId = dieRect.getData('dieInstanceId') as string | undefined;
      const die = instanceId ? this.gameState.dice.find((candidate) => candidate.instanceId === instanceId) : undefined;
      const definition = die ? this.getDefinitionForInstance(die) : undefined;
      if (!definition) return;
      const visualAccent = this.transforms.getTransformedVisual(die)?.accent ?? definition.accent;
      const accent = Phaser.Display.Color.HexStringToColor(visualAccent).color;
      const alpha = this.transforms.getTransformedVisual(die) ? 0.55 : 0.28;
      dieRect.setFillStyle(reverseDrag ? 0xffffff : accent, reverseDrag ? 0.42 : alpha);
      dieRect.setStrokeStyle(2, reverseDrag ? 0xffffff : accent);
    });
  }

  private tryPlaceDie(container: Phaser.GameObjects.Container, instanceId: string) {
    if (this.isMultiplayerMatch && (this.multiplayerReady || this.multiplayerSubmitting)) {
      this.returnDieToHand(container, instanceId);
      return;
    }
    const droppedZone = this.gridDropZones.find((zone) => {
      const bounds = zone.getBounds();
      return Phaser.Geom.Intersects.RectangleToRectangle(
        new Phaser.Geom.Rectangle(container.getBounds().centerX - 10, container.getBounds().centerY - 10, 20, 20),
        bounds
      );
    });

    if (!droppedZone) {
      this.returnDieToHand(container, instanceId);
      return;
    }

    const gridPos = droppedZone.getData('gridPos') as { row: number; col: number };

    const existingDieInHand = this.gameState.dice.find((die) =>
      die.ownerId === 'player' &&
      die.instanceId === instanceId &&
      die.zone === 'hand' &&
      !die.isDestroyed
    );
    if (!existingDieInHand) {
      this.returnDieToHand(container, instanceId);
      return;
    }

    const footprint = this.getFootprintForDie(existingDieInHand);
    if (this.isFootprintGridLocked('player', gridPos.row, gridPos.col, footprint)) {
      this.writeCombatLog(`${this.getCombatDieName(existingDieInHand)} cannot be placed on a chained tile.`);
      this.returnDieToHand(container, instanceId);
      return;
    }
    const usedCells = this.collectOccupiedCells('player', instanceId);
    if (!this.canPlaceFootprint(gridPos.row, gridPos.col, footprint, usedCells)) {
      this.returnDieToHand(container, instanceId);
      return;
    }

    this.gameState = placeDieOnBoard(this.gameState, instanceId, gridPos.row, gridPos.col);
    this.clearRangeHighlights();

    container.destroy();
    this.handDice.delete(instanceId);
    this.placedDiceCount++;
    this.renderDice();
    this.updateCombatButtonState();
	  
    this.writeCombatLog(`Placed ${this.getCombatDieName(existingDieInHand)} at [${gridPos.row}, ${gridPos.col}] (${this.placedDiceCount}/${Math.min(25, this.currentHandOrder.length)})`);
    this.reflowHandPositions();
  }

  private returnDieToHand(container: Phaser.GameObjects.Container, instanceId: string) {
    this.reflowHandPositions(instanceId, container);
  }

  private reflowHandPositions(activeInstanceId?: string, activeContainer?: Phaser.GameObjects.Container) {
    const handY = this.scale.height - 110;
    const remaining = this.currentHandOrder.filter((id) => this.handDice.has(id) || id === activeInstanceId);
    const startX = (this.scale.width - (remaining.length * 100)) / 2 + 50;
    remaining.forEach((id, idx) => {
      const dieContainer = id === activeInstanceId ? activeContainer : this.handDice.get(id);
      if (!dieContainer) return;
      this.tweens.add({ targets: dieContainer, x: startX + idx * 100, y: handY, duration: 180, ease: 'Power2' });
    });
  }

  private updateCombatButtonState() {
    const requiredDice = Math.min(25, this.currentHandOrder.length);
    const boardPlaced = this.getHandPlacedDiceCount();
    this.placedDiceCount = boardPlaced;
    if (this.isMultiplayerMatch && (this.multiplayerReady || this.multiplayerSubmitting)) {
      this.startCombatButton.disableInteractive();
      this.startCombatButton.setFillStyle(0x7f8c8d, 0.5);
      return;
    }
    const allPlaced = this.placedDiceCount >= requiredDice;
    const canStart = this.diceRolled && (allPlaced || !this.hasPlaceableHandDice());
    this.startCombatButton.setFillStyle(canStart ? 0xe74c3c : 0x7f8c8d, canStart ? 0.9 : 0.5);
    if (canStart) {
      this.startCombatButton.setInteractive({ useHandCursor: true });
      this.writeCombatLog(allPlaced ? 'All dice placed! Click START COMBAT' : 'No more dice fit on the board! Click START COMBAT');
    } else {
      this.startCombatButton.disableInteractive();
      this.writeCombatLog(requiredDice > 0 ? `Place ${requiredDice - this.placedDiceCount} more dice...` : 'No dice available to place.');
    }
  }

  private createCombatUI() {
    const { width, height } = this.scale;
    const centerX = width / 2;
    const buttonY = height - 46;

    this.combatLogPanel = this.add.rectangle(centerX, height - 200, Math.min(980, width - 120), 46, 0x0d2231, 0.88)
      .setStrokeStyle(1, 0x3a6688);
    this.combatLog = this.add.text(centerX, height - 200, 'Place your dice, then start combat!', {
      fontFamily: 'Orbitron',
      fontSize: '11px',
      color: PALETTE.textMuted
    }).setOrigin(0.5).setAlign('center').setFixedSize(Math.min(940, width - 160), 24);
    this.nativeCombatLogSetText = this.combatLog.setText.bind(this.combatLog);
    this.combatLog.setText = (value: string | string[]) => {
      this.writeCombatLog(Array.isArray(value) ? value.join(' ') : value);
      return this.combatLog;
    };
    this.combatLogHistory = [];
    this.writeCombatLog('Place your dice, then start combat!');

    this.startCombatButton = this.add.rectangle(centerX, buttonY, 140, 40, 0xe74c3c, 0.9)
      .setInteractive({ useHandCursor: true });
    this.add.text(centerX, buttonY, 'START COMBAT', {
      fontFamily: 'Orbitron',
      fontSize: '14px',
      color: '#ffffff'
    }).setOrigin(0.5);

    this.startCombatButton.on('pointerover', () => {
      if (this.startCombatButton.input?.enabled) this.startCombatButton.setFillStyle(0xc0392b, 1);
    });
    this.startCombatButton.on('pointerout', () => {
      if (this.startCombatButton.input?.enabled) this.startCombatButton.setFillStyle(0xe74c3c, 0.9);
    });
    this.startCombatButton.on('pointerdown', () => this.startCombat());
  }

  private cancelPostCombatDrag() {
    this.highlightValidDropZones(false, true);
    this.activePostCombatDragProxy?.disableInteractive();
    this.activePostCombatDragProxy?.destroy();
    this.activePostCombatDragProxy = null;
  }
  
  private applyServerAuthoritativeState(
    serverState: unknown,
    classLevels?: Record<string, number>,
    talentIndices?: Record<string, number | null>
  ) {
    if (serverState === undefined || serverState === null) return;
    if (classLevels) {
      for (const [instanceId, rawLevel] of Object.entries(classLevels)) {
        const level = Math.max(1, Math.min(15, Math.floor(Number(rawLevel))));
        if (Number.isFinite(level)) this.instanceClassLevels.set(instanceId, level);
      }
    }
    if (talentIndices) {
      for (const [instanceId, rawIndex] of Object.entries(talentIndices)) {
        const index = rawIndex === null ? null : Math.max(0, Math.min(20, Math.floor(Number(rawIndex))));
        if (index === null || Number.isFinite(index)) this.instanceTalentIndices.set(instanceId, index);
      }
    }
    const sanitized = sanitizeServerBattleState(serverState, this.gameState, true);
    if (!sanitized) {
      this.debug.warn('Discarded malformed multiplayer state from the server.');
      return;
    }
    this.gameState = sanitized;
    this.gameState.dice.forEach((die) => {
      const base = this.definitions.get(die.typeId);
      if (!base) return;
      const classLevel = (this.multiplayer.rules?.useLevelling ?? false) ? (this.instanceClassLevels.get(die.instanceId) ?? 1) : 1;
      const talentIndex = areTalentsSuppressedForChallenge(this.activeChallenge) ? null : (this.instanceTalentIndices.get(die.instanceId) ?? null);
      let definition = this.applyClassProgress(applyDiceTalent(base, talentIndex, classLevel), classLevel);
      if (die.transformIndex !== undefined) {
        definition = applyTransformStats(definition, die.transformIndex);
        this.transforms.setIndex(die.instanceId, die.transformIndex);
      } else {
        this.transforms.clearInstance(die.instanceId);
      }
      this.instanceDefinitionOverrides.set(die.instanceId, definition);
      if (die.ownerId === 'enemy') this.enemyClassLevels.set(`${die.typeId}:${die.instanceId}`, classLevel);
    });
    this.renderDice();
    this.renderEnemyDice();
  }

  private async startCombat() {
    if (this.isMultiplayerMatch) {
      await this.readyForMultiplayerCombat();
      return;
    }
    this.attackCountFeedbackByInstance.clear();
    const requiredDice = Math.min(25, this.currentHandOrder.length);
    const boardPlaced = this.getHandPlacedDiceCount();
    if (!this.diceRolled || (boardPlaced < requiredDice && this.hasPlaceableHandDice())) {
    this.writeCombatLog(`Place all ${requiredDice} rolled dice before combat.`);
      this.updateCombatButtonState();
      return;
    }
    this.startCombatButton.disableInteractive();
    this.startCombatButton.setFillStyle(0x7f8c8d, 0.5);
    this.rollAllButton.setVisible(false);
    this.rollAllButtonLabel.setVisible(false);
    this.rollHelperText.setVisible(false);
    this.handContainer.setVisible(false);

    this.gamePhase = { stage: 'combat' };
    this.cancelPostCombatDrag();
    this.gridDropZones.forEach((zone) => {
      zone.setVisible(false);
      zone.setFillStyle(0x00ff00, 0);
      zone.setStrokeStyle(0, 0x00ff00, 0);
    });
    this.highlightValidDropZones(false);
    this.renderDice();
    this.clearRangeHighlights();
    this.placeEnemyDiceForTurn();
    this.enemyDicePips.clear();
    this.attackCapacityByInstance.clear();
    [...this.chainedByInstance.keys()].forEach((instanceId) => {
      if (!this.lockTurnsByInstance.has(instanceId)) this.chainedByInstance.delete(instanceId);
    });
    this.hitDuringAttackAction.clear();
    this.healingWaitByInstance.clear();
    this.healingRetryReadyByInstance.clear();
    this.avoidChanceIgnoredTargetByInstance.clear();
    this.invisiRollForEnemies();
    if (this.randomModeActive && this.activeRandomModifier === 'Combanity') {
      const player = this.getRollComboBonus('player');
      const enemy = this.activeChallenge === 'dungeon'
        ? { multiplier: 0, label: 'Classic' }
        : this.getRollComboBonus('enemy');
      const comboSfxKey = this.getComboSfxKey(player.multiplier >= enemy.multiplier ? player.label : enemy.label);
      if (comboSfxKey) this.time.delayedCall(500, () => AudioManager.playSfx(this, comboSfxKey));
    }

    this.enemyFogOverlay.setVisible(false);
    this.enemyFogText.setVisible(false);
    this.renderEnemyDice();

    this.playTurnBanner('START!');
    AudioManager.playSfx(this, AUDIO_KEYS.gameStart);
    this.writeCombatLog('Combat started! Revealing enemy positions...');
    await this.delay(1000);

    this.gameState = await this.combatOrchestrator.run(
      this.getCombatFlowContext('CombatStart'),
      () => this.beginCombatPhaseWithRolledPips(),
      this.gameState
    );
    await this.combatOrchestrator.run(
      this.getCombatFlowContext('CombatStart'),
      () => this.applyCombatStartSkillEffects(),
      undefined
    );
    this.combatOrchestrator.runSync(
      this.getCombatFlowContext('CombatStart'),
      () => this.applyInfiltratorCombatStart(),
      undefined
    );
    this.expireUntimedShields();
    this.combatOrchestrator.runSync(
      this.getCombatFlowContext('CombatStart'),
      () => this.applyTauntEffects(),
      undefined
    );
    await this.combatOrchestrator.run(
      this.getCombatFlowContext('CombatStart'),
      () => this.applyManaSkillEffectsAtCombatStart(),
      undefined
    );
    this.combatOrchestrator.runSync(
      this.getCombatFlowContext('CombatStart'),
      () => this.applyManaPotionAtCombatStart(),
      undefined
    );
    this.combatOrchestrator.runSync(
      this.getCombatFlowContext('CombatStart'),
      () => this.applyDungeonCardManaAtCombatStart(),
      undefined
    );
    await this.combatOrchestrator.run(
      this.getCombatFlowContext('CombatStart'),
      () => this.applyPoolEffectsAtCombatStart(),
      undefined
    );
    this.renderDice();
    this.renderEnemyDice();
    this.renderPools();

    if (await this.resolveCombatWin()) return;
    await this.combatOrchestrator.run(
      this.getCombatFlowContext('Attack'),
      () => this.runCombatLoop(),
      undefined
    );
  }


  private applySkillGrowth(instanceId: string, result: { applyGrowth?: boolean; growthDelta?: number; missingHealRate?: number }) {
    if (result.missingHealRate !== undefined && result.missingHealRate > 0) {
      const source = this.gameState.dice.find((die) => die.instanceId === instanceId && !die.isDestroyed);
      if (source) {
        const missing = Math.max(0, source.maxHealth - source.currentHealth);
        if (missing > 0) this.healDie(source.instanceId, Math.ceil(missing * result.missingHealRate), source);
      }
    }
    if (!result.applyGrowth) return;
    const die = this.gameState.dice.find((candidate) => candidate.instanceId === instanceId);
    const baseDelta = result.growthDelta ?? 1;
    const growthOverride = die && baseDelta > 0 ? (this.getDungeonCardEffectsForDie(die)?.growthDeltaOverride ?? 0) : 0;
    const delta = growthOverride > 0 ? growthOverride : baseDelta;
    const current = this.growthDeltaByInstance.get(instanceId) ?? 0;
    const next = current + delta;
    this.growthDeltaByInstance.set(instanceId, next);
    this.recordAttackCountEffect(instanceId, delta);
    if (die) {
      const definition = this.getDefinitionForInstance(die);
      const meta = definition ? getRuntimeSkillMeta(definition, undefined, true) : undefined;
      const sfx = delta > 0 ? meta?.growthSuccessSfxKey : meta?.growthFailedSfxKey;
      if (sfx) AudioManager.playSfx(this, sfx);
      this.animateGrowthEffect(die, delta > 0);
      this.writeAttackCountFeedback(die, delta);
    }
  }

  private async applySpecialSkillAttack(
    source: DiceInstanceState,
    damage: number,
    explicitTarget: DiceInstanceState | undefined,
    meta: ReturnType<typeof getRuntimeSkillMeta>,
    label: string,
    historyLine?: (target: DiceInstanceState, damageFeedback: string) => string
  ) {
    if (this.specialSkillAttackDepth >= 8) return;
    const liveSource = this.gameState.dice.find((die) => die.instanceId === source.instanceId && !die.isDestroyed);
    const attackSource = liveSource ?? (label === 'On-death attack' ? source : undefined);
    if (!attackSource) return;
    const target = explicitTarget && !explicitTarget.isDestroyed
      ? this.gameState.dice.find((die) => die.instanceId === explicitTarget.instanceId && !die.isDestroyed)
      : this.findAttackTargetForArena(attackSource);
    if (!target || target.ownerId === attackSource.ownerId) return;

    this.specialSkillAttackDepth += 1;
    try {
      const adjusted = applySkillDamageModifiers(damage, attackSource, target, meta);
      const finalDamage = Math.max(1, Math.floor(adjusted
        * this.getCombanityDamageMultiplier(attackSource, target)
        * this.getDiceCardSkillDamageMultiplier(attackSource)));
      const hit = this.applyDamageWithRevive(target.instanceId, finalDamage, { source: attackSource });
      this.gameState = hit.state;
      this.showDamageText(target, hit.dealt, '#ffbf80');
      await this.applyDamageDefeatHooks(attackSource, target, hit.defeated || hit.killed);
      const damageFeedback = this.formatDamageFeedback(hit);
      if (historyLine) this.writeCombatLog(historyLine(target, damageFeedback));
      else this.addCombatActionDetail(`${label} hit ${this.getCombatDieName(target)} for ${damageFeedback}`);
    } finally {
      this.specialSkillAttackDepth -= 1;
    }
  }

  private recordAttackCountEffect(instanceId: string, delta: number) {
    if (delta === 0) return;
    const seen = this.attackCountEffectSeenByInstance.get(instanceId) ?? { positive: false, negative: false };
    this.attackCountEffectSeenByInstance.set(instanceId, {
      positive: seen.positive || delta > 0,
      negative: seen.negative || delta < 0
    });
  }

  private recordGrantedAttackCount(instanceId: string, delta: number) {
    if (!Number.isFinite(delta) || delta === 0) return;
    this.grantedAttackCountByInstance.set(instanceId, (this.grantedAttackCountByInstance.get(instanceId) ?? 0) + delta);
    this.recordAttackCountEffect(instanceId, delta);
    const die = this.gameState.dice.find((candidate) => candidate.instanceId === instanceId);
    if (die) this.writeAttackCountFeedback(die, delta);
  }

  private writeAttackCountFeedback(die: DiceInstanceState, delta: number) {
    if (!Number.isFinite(delta) || delta === 0 || !this.combatLog) return;
    const direction = delta > 0 ? 'gain' : 'loss';
    const feedback = this.attackCountFeedbackByInstance.get(die.instanceId) ?? { gain: undefined, loss: undefined };
    const previous = feedback[direction];
    const amount = (previous?.amount ?? 0) + Math.abs(delta);
    const line = `${this.getQualifiedCombatDieName(die)} ${delta > 0 ? 'gains' : 'loses'} ${formatCompact(amount)} attack count${amount === 1 ? '' : 's'}!`;
    if (previous) {
      const index = this.combatLogHistory.lastIndexOf(previous.text);
      if (index >= 0) {
        this.combatLogHistory[index] = line;
        if (index === this.combatLogHistory.length - 1) this.nativeCombatLogSetText?.(line);
        this.refreshHistoryModalView(false);
        feedback[direction] = { amount, text: line };
        this.attackCountFeedbackByInstance.set(die.instanceId, feedback);
        return;
      }
    }
    this.writeCombatLog(line);
    feedback[direction] = { amount, text: line };
    this.attackCountFeedbackByInstance.set(die.instanceId, feedback);
  }

  private getAttackCountBuffLines(die: DiceInstanceState): Array<{ text: string; color: string }> {
    const seen = this.attackCountEffectSeenByInstance.get(die.instanceId);
    const passiveAttackCount = this.getPassiveAttackCount(die);
    const passiveProjectileCount = this.getPassiveProjectileCount(die);
    const rapidFireIncrease = this.getRapidFireIncrease(die);
    const dungeonCardEffects = this.getDungeonCardEffectsForDie(die);
    const dungeonAttackCount = dungeonCardEffects?.attackCount ?? 0;
    const dungeonProjectileCount = dungeonCardEffects?.projectileCount ?? 0;
    const timedAttackCount = Math.max(0, this.extraAttackTurnsByInstance.get(die.instanceId)?.extra ?? 0);
    const timedProjectileCount = Math.max(0, (this.basicAttacksPerAttackByInstance.get(die.instanceId)?.count ?? 1) - 1);
    const attackDelta = this.statusEffects.getSlowDelta(die.instanceId);
    const growthDelta = this.growthDeltaByInstance.get(die.instanceId) ?? 0;
    const showAttackCount = Boolean(seen?.positive) || growthDelta > 0 || attackDelta > 0 || passiveAttackCount > 0 || timedAttackCount > 0 || dungeonAttackCount > 0;
    const showProjectileCount = Boolean(seen?.positive) || passiveProjectileCount > 0 || timedProjectileCount > 0 || dungeonProjectileCount > 0;
    if (!seen && growthDelta === 0 && attackDelta <= 0 && passiveAttackCount <= 0 && passiveProjectileCount <= 0 && rapidFireIncrease <= 0 && timedAttackCount <= 0 && timedProjectileCount <= 0 && dungeonAttackCount <= 0 && dungeonProjectileCount <= 0) return [];

    const basePips = die.ownerId === 'player'
      ? (this.dicePips.get(die.instanceId) ?? this.getPipCount(die.typeId))
      : (this.enemyDicePips.get(die.instanceId) ?? this.getPipCount(die.typeId));
    const combatDelta = this.combatAttackCountDeltaByInstance.get(die.instanceId);
    const combatPositiveDelta = this.combatAttackCountPositiveDeltaByInstance.get(die.instanceId);
    const combatNegativeDelta = this.combatAttackCountNegativeDeltaByInstance.get(die.instanceId);
    const fireSupportBonus = this.getFireSupportBonus(die);
    const projectileDelta = Math.max(0, (this.basicAttacksPerAttackByInstance.get(die.instanceId)?.count ?? 1) - 1) + passiveProjectileCount + dungeonProjectileCount;
    const additiveDelta = (combatDelta ?? 0)
      + attackDelta
      + (this.extraAttackTurnsByInstance.get(die.instanceId)?.extra ?? 0)
      + (this.grantedAttackCountByInstance.get(die.instanceId) ?? 0)
      + (this.growthDeltaByInstance.get(die.instanceId) ?? 0)
      + passiveAttackCount
      + dungeonAttackCount
      + fireSupportBonus;
    const multiplier = this.attackMultiplierTurnsByInstance.get(die.instanceId)?.multiplier ?? 1;
    const multiplierDelta = multiplier === 1 ? 0 : Math.floor(Math.max(0, basePips + additiveDelta) * multiplier) - Math.max(0, basePips + additiveDelta);
    const attackCountDelta = additiveDelta + multiplierDelta;

    const positiveDelta = [
      combatPositiveDelta ?? (combatDelta === undefined ? 0 : Math.max(0, combatDelta)),
      this.extraAttackTurnsByInstance.get(die.instanceId)?.extra ?? 0,
      Math.max(0, this.grantedAttackCountByInstance.get(die.instanceId) ?? 0),
      Math.max(0, this.growthDeltaByInstance.get(die.instanceId) ?? 0),
      fireSupportBonus,
      Math.max(0, multiplierDelta),
      Math.max(0, attackDelta),
      passiveAttackCount,
      dungeonAttackCount
    ].reduce((sum, delta) => sum + Math.max(0, delta), 0);
    const negativeDelta = [
      combatNegativeDelta ?? (combatDelta === undefined ? 0 : Math.min(0, combatDelta)),
      attackDelta,
      Math.min(0, this.grantedAttackCountByInstance.get(die.instanceId) ?? 0),
      Math.min(0, this.growthDeltaByInstance.get(die.instanceId) ?? 0),
      Math.min(0, multiplierDelta)
    ].reduce((sum, delta) => sum + Math.min(0, delta), 0);
    const lines: Array<{ text: string; color: string }> = [];
    if (showAttackCount && positiveDelta > 0) lines.push({ text: `${countLabel(positiveDelta, 'Attack Count', 'Attack Counts')} +${positiveDelta}`, color: '#6dff8f' });
    if ((seen?.negative || growthDelta < 0) && negativeDelta < 0) lines.push({ text: `${countLabel(negativeDelta, 'Attack Count', 'Attack Counts')} ${negativeDelta}`, color: '#ff6b6b' });
    if (lines.length === 0) {
      if (attackCountDelta > 0 && showAttackCount) lines.push({ text: `${countLabel(attackCountDelta, 'Attack Count', 'Attack Counts')} +${attackCountDelta}`, color: '#6dff8f' });
      else if (attackCountDelta < 0 && (seen?.negative || growthDelta < 0)) lines.push({ text: `${countLabel(attackCountDelta, 'Attack Count', 'Attack Counts')} ${attackCountDelta}`, color: '#ff6b6b' });
    }
    if (showProjectileCount && projectileDelta > 0) lines.push({ text: `${countLabel(projectileDelta, 'Projectile Count', 'Projectile Counts')} +${projectileDelta}`, color: '#6dff8f' });
    if (rapidFireIncrease > 0) lines.push({ text: `Rapid Fire: ${countNoun(rapidFireIncrease, 'shot')}`, color: '#6dff8f' });
    return lines;
  }

  private getFireSupportBonus(die: DiceInstanceState): number {
    if (!die.gridPosition) return 0;
    const isBackline = die.ownerId === 'player'
      ? die.gridPosition.col === 0
      : die.gridPosition.col === 4;
    if (!isBackline) return 0;
    return this.fireSupportByOwner[die.ownerId];
  }

  private getPassiveAttackCount(die: DiceInstanceState): number {
    const definition = this.getDefinitionForInstance(die);
    if (!definition) return 0;
    const classLevel = this.instanceClassLevels.get(die.instanceId) ?? 1;
    return Math.max(0, Math.floor(getValidSkillDefinitions(definition)
      .filter((skill) => skill.type === 'Passive'
        && skill.modifiers?.skillRangeThreshold === undefined
        && (getSkillLockClass(skill) === undefined || classLevel >= getSkillLockClass(skill)!))
      .reduce((total, skill) => total + Math.max(0, skill.modifiers?.attackCount ?? 0), 0)));
  }

  private getPassiveProjectileCount(die: DiceInstanceState): number {
    const definition = this.getDefinitionForInstance(die);
    if (!definition) return 0;
    const classLevel = this.instanceClassLevels.get(die.instanceId) ?? 1;
    return Math.max(0, Math.floor(getValidSkillDefinitions(definition)
      .filter((skill) => skill.type === 'Passive'
        && skill.modifiers?.skillRangeThreshold === undefined
        && (getSkillLockClass(skill) === undefined || classLevel >= getSkillLockClass(skill)!))
      .reduce((total, skill) => total + Math.max(0, skill.modifiers?.projectileCount ?? 0), 0)));
  }

  private getRapidFireIncrease(die: DiceInstanceState): number {
    const definition = this.getDefinitionForInstance(die);
    if (!definition) return 0;
    return Math.max(0, Math.floor(getRuntimeSkillMeta(definition).rapidFireIncrease ?? 0));
  }

  private computeAttackCount(instanceId: string, basePips: number, timeDelta = 0, die?: DiceInstanceState): number {
    const debuff = this.statusEffects.getSlowDelta(instanceId);
    const buff = this.extraAttackTurnsByInstance.get(instanceId)?.extra ?? 0;
    const skillMult = this.attackMultiplierTurnsByInstance.get(instanceId)?.multiplier ?? 1;
    const comboMult = this.combanityAttackMultiplierByInstance.get(instanceId)?.multiplier ?? 1;
    const growthDelta = this.growthDeltaByInstance.get(instanceId) ?? 0;
    const fireSupportBonus = die ? this.getFireSupportBonus(die) : 0;
    const passiveSource = die ?? this.gameState.dice.find((candidate) => candidate.instanceId === instanceId);
    const passiveAttackCount = passiveSource ? this.getPassiveAttackCount(passiveSource) : 0;
    if (passiveAttackCount > 0) this.recordAttackCountEffect(instanceId, passiveAttackCount);
    const dungeonCardAttackCount = passiveSource ? (this.getDungeonCardEffectsForDie(passiveSource)?.attackCount ?? 0) : 0;
    if (dungeonCardAttackCount > 0) this.recordAttackCountEffect(instanceId, dungeonCardAttackCount);
    const adjusted = Math.max(0, basePips + timeDelta + debuff + buff + growthDelta + fireSupportBonus + passiveAttackCount + dungeonCardAttackCount);
    return Math.max(0, Math.floor(adjusted * skillMult * comboMult));
  }

  private getActiveManaSlots(die: DiceInstanceState): Array<{ key: string; title: string; manaNeeded: number; skillIndex?: number }> {
    const def = this.getDefinitionForInstance(die);
    if (!def) return [];
    const meta = getRuntimeSkillMeta(def);
    const classLevel = this.instanceClassLevels.get(die.instanceId) ?? 1;
    return getValidSkillDefinitions(def)
      .flatMap((skill, index) => (skill.manaNeeded ?? 0) <= 0
        ? []
        : [{ skill, index }])
       .filter(({ skill }) => {
         const lockClass = getSkillLockClass(skill);
         return lockClass === undefined || classLevel >= lockClass;
       })
      .map(({ skill, index }) => ({ key: `${skill.title}:${index}`, title: skill.title, manaNeeded: Math.max(1, skill.manaNeeded ?? 1), skillIndex: index }));
  }


  private getActiveSkillMetaForSlot(die: DiceInstanceState, slot?: { skillIndex?: number }): ReturnType<typeof getRuntimeSkillMeta> | undefined {
    const definition = this.getDefinitionForInstance(die);
    if (!definition) return undefined;
    return getRuntimeSkillMetaForTrigger(definition, 'Active', slot?.skillIndex);
  }

  private canActiveSlotFire(die: DiceInstanceState, slot: { key: string; manaNeeded: number; skillIndex?: number }, fallbackMeta?: ReturnType<typeof getRuntimeSkillMeta>): boolean {
    const slotMeta = this.getActiveSkillMetaForSlot(die, slot) ?? fallbackMeta;
    if (!slotMeta || (slotMeta.unlockAtClass !== undefined && (this.instanceClassLevels.get(die.instanceId) ?? 1) < slotMeta.unlockAtClass)) return false;
    return this.getActiveMana(die.instanceId, slot.key) >= slot.manaNeeded && this.isActiveManaEligibleThisTurn(die.instanceId, slot.key);
  }


  private getActiveMana(instanceId: string, key?: string): number {
    if (key) return this.activeManaByInstance.get(instanceId)?.get(key) ?? 0;
    return this.manaByInstance.get(instanceId) ?? 0;
  }

  private setActiveMana(instanceId: string, key: string | undefined, value: number, cap: number) {
    const next = Phaser.Math.Clamp(Math.floor(value), 0, Math.max(1, cap));
    if (!key) {
      this.manaByInstance.set(instanceId, next);
      return;
    }
    const slots = new Map(this.activeManaByInstance.get(instanceId) ?? []);
    slots.set(key, next);
    this.activeManaByInstance.set(instanceId, slots);
    const maxCurrent = Math.max(0, ...Array.from(slots.values()));
    this.manaByInstance.set(instanceId, maxCurrent);
  }

  private getManaSlotKey(instanceId: string, key?: string): string {
    return `${instanceId}:${key ?? 'default'}`;
  }

  private isActiveManaEligibleThisTurn(instanceId: string, key?: string): boolean {
    return (this.manaFilledTurnBySlot.get(this.getManaSlotKey(instanceId, key)) ?? -1) <= this.gameState.turn;
  }

  private resetActiveMana(instanceId: string, key?: string) {
    if (!key) {
      this.manaByInstance.set(instanceId, 0);
      this.activeManaByInstance.delete(instanceId);
      [...this.manaFilledTurnBySlot.keys()].filter((slotKey) => slotKey.startsWith(`${instanceId}:`)).forEach((slotKey) => this.manaFilledTurnBySlot.delete(slotKey));
      return;
    }
    const slots = new Map(this.activeManaByInstance.get(instanceId) ?? []);
    slots.set(key, 0);
    this.manaFilledTurnBySlot.delete(this.getManaSlotKey(instanceId, key));
    this.activeManaByInstance.set(instanceId, slots);
    this.manaByInstance.set(instanceId, Math.max(0, ...Array.from(slots.values())));
  }

  private addMana(instanceId: string, manaNeeded: number, currentMana: number, gain = 1, key?: string) {
    if (this.manaPausedTurnsByInstance.has(instanceId)) return;
    const before = Phaser.Math.Clamp(Math.floor(currentMana), 0, Math.max(1, manaNeeded));
    this.setActiveMana(instanceId, key, currentMana + gain, manaNeeded);
    const after = this.getActiveMana(instanceId, key);
    if (gain > 0 && before < manaNeeded && after >= manaNeeded) {
      this.manaFilledTurnBySlot.set(this.getManaSlotKey(instanceId, key), this.gameState.turn);
    }
  }

  private addManaToAllActiveSlots(die: DiceInstanceState, gain = 1) {
    if (this.manaPausedTurnsByInstance.has(die.instanceId)) return;
    const slots = this.getActiveManaSlots(die);
    if (slots.length === 0) return;
    slots.forEach((slot) => this.addMana(die.instanceId, slot.manaNeeded, this.getActiveMana(die.instanceId, slot.key), gain, slot.key));
    if (die.ownerId === 'player' && gain > 0) this.trackPlayerManaCharged(gain);
  }

  private trackPlayerManaCharged(gain: number) {
    this.playerManaChargedAccrued += gain;
    const total = AchievementStore.get(this).manaCharged + this.playerManaChargedAccrued;
    if (total >= 100) AchievementStore.unlock(this, 'magical_cycle');
  }

  private getActiveManaSlot(die: DiceInstanceState, title: string): { key: string; title: string; manaNeeded: number; mana: number } | undefined {
    return this.getActiveManaSlots(die)
      .map((slot) => ({ ...slot, mana: this.getActiveMana(die.instanceId, slot.key) }))
      .find((slot) => slot.title === title);
  }

  private getMeteorManaSlot(die: DiceInstanceState): { key: string; title: string; manaNeeded: number; mana: number } | undefined {
    return this.getActiveManaSlots(die)
      .map((slot) => ({ ...slot, mana: this.getActiveMana(die.instanceId, slot.key), meta: this.getActiveSkillMetaForSlot(die, slot) }))
      .find((slot) => slot.meta?.hasMeteor === true && (slot.meta?.meteorDamage !== undefined || slot.meta?.meteorCount !== undefined));
  }

  private spendBasicAttack(attacker: DiceInstanceState): number {
    const chainedAttacks = getBasicAttackProjectileCount({
      timedProjectiles: this.basicAttacksPerAttackByInstance.get(attacker.instanceId)?.count ?? 1,
      passiveProjectiles: this.getPassiveProjectileCount(attacker),
      dungeonCardProjectiles: this.getDungeonCardEffectsForDie(attacker)?.projectileCount ?? 0,
      rapidFireIncrease: this.getRapidFireIncrease(attacker)
    });
    this.gameState = {
      ...this.gameState,
      dice: this.gameState.dice.map((die) => {
        if (die.instanceId !== attacker.instanceId || die.isDestroyed || die.zone !== 'board') return die;
        const attacksRemaining = Math.max(0, die.attacksRemaining - 1);
        return { ...die, attacksRemaining, hasFinishedAttacking: attacksRemaining === 0 };
      })
    };
    return chainedAttacks;
  }

  private getCombatFlowContext(
    phase: CombatFlowPhase,
    source?: DiceInstanceState,
    target?: DiceInstanceState,
    skillType?: string,
    skillTitle?: string
  ): CombatFlowContext {
    return {
      phase,
      turn: this.gameState?.turn,
      sourceInstanceId: source?.instanceId,
      sourceTypeId: source?.typeId,
      targetInstanceId: target?.instanceId,
      targetTypeId: target?.typeId,
      skillType,
      skillTitle
    };
  }

  private async applyCombatStartSkillEffects() {
    const boardDice = this.gameState.dice.filter((die) => die.zone === 'board' && !die.isDestroyed && die.gridPosition);
    for (const attackerSnapshot of boardDice) {
      const attacker = this.gameState.dice.find((die) =>
        die.instanceId === attackerSnapshot.instanceId
        && die.zone === 'board'
        && !die.isDestroyed
        && die.gridPosition
      );
      if (!attacker) continue;
      this.hitDuringAttackAction.clear();
      const definition = this.getDefinitionForInstance(attacker);
      if (!getValidSkillDefinitions(definition).some((skill) => skill.type === 'CombatStart')) continue;
      const classLevel = this.instanceClassLevels.get(attacker.instanceId) ?? 1;
      const targetOwner = attacker.ownerId === 'player' ? 'enemy' : 'player';
      const startMeta = this.combatOrchestrator.runSync(
        this.getCombatFlowContext('CombatStart', attacker, undefined, 'CombatStart'),
        () => getRuntimeSkillMetaForTrigger(definition, 'CombatStart'),
        { transformFlags: [], targetingMode: definition.targetingMode }
      );
      const target = this.findSkillTargetForArena(attacker, startMeta.targetingMode ?? 'Nearest', false);
      const targetBoardSide = target ? this.getBoardSideForDie(target) : undefined;
      const targets = this.gameState.dice.filter((die) => die.ownerId === targetOwner && die.zone === 'board' && !die.isDestroyed && die.gridPosition
        && (!targetBoardSide || this.getBoardSideForDie(die) === targetBoardSide));
      const pips = attacker.ownerId === 'player' ? (this.dicePips.get(attacker.instanceId) ?? 1) : (this.enemyDicePips.get(attacker.instanceId) ?? 1);
      const startSkill = getValidSkillDefinitions(definition).find((skill) => skill.type === 'CombatStart');
      const result = await this.combatOrchestrator.run(
        this.getCombatFlowContext('CombatStart', attacker, target, 'CombatStart', startSkill?.title),
        () => executeCombatStartSkillEffects(attacker, definition, classLevel, target, targets, pips, (die) => this.getFootprintForDie(die)),
        { combatStartAuras: [] }
      );
      const startSkillFired = Boolean(
        startSkill
        && (result.applyGrowth
          || result.summonType
          || result.specialAttackDamage !== undefined
          || result.bonusAttacks !== undefined
          || result.grantAttacksToAlly !== undefined
          || result.grantAttacksToFoe !== undefined
          || result.statusApplications?.length
          || result.splashTargets?.length
          || result.heatwaveDamageAmount !== undefined
          || result.chainTarget
          || result.missingHealRate !== undefined)
      );
      const hasAreaDamage = Boolean(result.splashTargets?.length || result.heatwaveDamageAmount !== undefined);
      this.applySkillGrowth(attacker.instanceId, result);
      this.applySummonResult(attacker, result);
      const didLock = this.applySkillLocks(attacker, startMeta);
      if ((startSkillFired || didLock) && !hasAreaDamage) this.playPhaseSkillSfxForDie(attacker, startMeta);
      if (result.specialAttackDamage !== undefined) {
        await this.applySpecialSkillAttack(
          attacker,
          result.specialAttackDamage,
          result.specialAttackTarget,
          startMeta,
          'Combat-start attack',
          (target, feedback) => `${this.getCombatDieName(attacker)} hits ${this.getCombatDieName(target)} first for ${feedback} damage!`
        );
      }
      this.applySkillHealingResult(attacker, result, 'CombatStart');
      if (startMeta.activeStatusEffect !== 'taunt') this.applyStatusApplications(result.statusApplications);
      if (result.grantAttacksToAlly && result.grantAttacksToAlly > 0) {
        const recipient = this.selectAllyAttackRecipient(attacker, this.gameState, result.grantAttacksToAlly, undefined, result.grantAttacksToAllyRadius);
        if (recipient) {
          this.recordGrantedAttackCount(recipient.instanceId, result.grantAttacksToAlly);
          this.gameState = {
            ...this.gameState,
            dice: this.gameState.dice.map((die) => die.instanceId === recipient.instanceId
              ? { ...die, attacksRemaining: die.attacksRemaining + result.grantAttacksToAlly!, hasFinishedAttacking: false }
              : die)
          };
          this.addCombatActionDetail(`${startSkill?.title ?? 'Combat-start skill'} grants +${result.grantAttacksToAlly} attack${result.grantAttacksToAlly === 1 ? '' : 's'} to ${this.getCombatDieName(recipient)}`);
        }
      }
      if (result.grantAttacksToFoe && result.grantAttacksToFoe > 0) {
        this.gameState = this.grantFoeAttacks(attacker, result.grantAttacksToFoe, this.gameState);
        this.addCombatActionDetail(`${startSkill?.title ?? 'Combat-start skill'} grants +${result.grantAttacksToFoe} attack${result.grantAttacksToFoe === 1 ? '' : 's'} to the opposing side`);
      }
      if (result.splashTargets?.length && target) {
        const splashTargets = this.getFootprintTargetsWithin(target, targets, 1);
        if (splashTargets.length > 0) this.playSplashSfxForDie(attacker, startMeta);
        for (const victim of splashTargets) {
          const damage = Math.max(1, Math.floor((result.splashDamageAmount ?? definition.attack)
            * this.getCombanityDamageMultiplier(attacker, victim)
            * this.getDiceCardSkillDamageMultiplier(attacker)));
          const hit = this.applyDamageWithRevive(victim.instanceId, damage, { source: attacker });
          this.gameState = hit.state;
          this.showDamageText(victim, hit.dealt, '#ff9f58');
          this.animateSkillEffect('fire', attacker, victim);
          await this.applyDamageDefeatHooks(attacker, victim, hit.defeated || hit.killed);
          this.addCombatActionDetail(`Combat-start splash hit ${this.getCombatDieName(victim)} for ${this.formatDamageFeedback(hit)}`);
        }
      }
      if (result.heatwaveDamageAmount !== undefined && target?.gridPosition) {
        if (!result.splashTargets?.length) this.playSplashSfxForDie(attacker, startMeta);
        const heatwaveTargets = this.getFootprintTargetsWithin(target, targets, 1);
        const heatwaveHits: Array<{ target: DiceInstanceState; dealt: number; critical?: boolean }> = [];
        for (const victim of heatwaveTargets) {
          const damage = Math.max(1, Math.floor(result.heatwaveDamageAmount * this.getDiceCardSkillDamageMultiplier(attacker)));
          const hit = this.applyDamageWithRevive(victim.instanceId, damage, { source: attacker });
          this.gameState = hit.state;
          this.showDamageText(victim, hit.dealt, '#ff7a35');
          this.animateSkillEffect('heatwave', attacker, victim);
          await this.applyDamageDefeatHooks(attacker, victim, hit.defeated || hit.killed);
          heatwaveHits.push({ target: victim, dealt: hit.dealt, critical: hit.critical });
        }
        this.writeHeatwaveFeedback(attacker, heatwaveHits);
      }
      if (result.chainTarget) {
        for (const chainVictim of this.getChainJumpTargetsForArena(attacker, result.chainTarget, startMeta)) {
          if (chainVictim.isDestroyed) continue;
          const damage = Math.max(1, Math.floor((result.chainDamageAmount ?? definition.attack)
            * this.getCombanityDamageMultiplier(attacker, chainVictim)
            * this.getDiceCardSkillDamageMultiplier(attacker)));
          const hit = this.applyDamageWithRevive(chainVictim.instanceId, damage, { source: attacker });
          this.gameState = hit.state;
          this.showDamageText(chainVictim, hit.dealt, '#fff176');
          await this.applyDamageDefeatHooks(attacker, chainVictim, hit.defeated || hit.killed);
        }
      }
    }
  }

  private beginCombatPhaseWithRolledPips(): MatchBattleState {
    const playerBoardDice = getBoardDice(this.gameState, 'player');
    const enemyBoardDice = getBoardDice(this.gameState, 'enemy');
    const classLevelForDie = (die: DiceInstanceState) => this.instanceClassLevels.get(die.instanceId) ?? 1;
    const playerCombatStartAuras = collectCombatStartAuras(playerBoardDice, (die) => this.getDefinitionForInstance(die), classLevelForDie);
    const enemyCombatStartAuras = collectCombatStartAuras(enemyBoardDice, (die) => this.getDefinitionForInstance(die), classLevelForDie);
    const combatStartBonusFor = (die: DiceInstanceState) => computeCombatStartBonus(die, playerCombatStartAuras, enemyCombatStartAuras, (candidate) => this.getFootprintForDie(candidate));
    const combatStartFoeBonusFor = (die: DiceInstanceState) => computeCombatStartFoeBonus(die, playerCombatStartAuras, enemyCombatStartAuras);
    const rolledPipsFor = (die: DiceInstanceState) => die.ownerId === 'player'
      ? (this.dicePips.get(die.instanceId) ?? this.getPipCount(die.typeId))
      : (this.enemyDicePips.get(die.instanceId) ?? this.getPipCount(die.typeId));
    const collectPipAttackAuras = (dice: DiceInstanceState[]) => dice
      .map((die) => {
        const definition = this.getDefinitionForInstance(die);
        if (!definition) return null;
        const meta = getRuntimeSkillMeta(definition);
        const cardEffects = this.getDungeonCardEffectsForDie(die);
        const allyDelta = (cardEffects?.temporalAccelerationCount ?? 0) > 0
          ? cardEffects!.temporalAccelerationCount
          : meta.pipMatchAllyAttackDelta ?? 0;
        const foeDelta = (cardEffects?.temporalDilationCount ?? 0) > 0
          ? -cardEffects!.temporalDilationCount
          : meta.pipMatchFoeAttackDelta ?? 0;
        if (allyDelta === 0 && foeDelta === 0) return null;
        return { sourceId: die.instanceId, pips: rolledPipsFor(die), allyDelta, foeDelta };
      })
      .filter((aura): aura is { sourceId: string; pips: number; allyDelta: number; foeDelta: number } => aura !== null);
    const playerPipAttackAuras = collectPipAttackAuras(playerBoardDice);
    const enemyPipAttackAuras = collectPipAttackAuras(enemyBoardDice);
    const sumMatchingDelta = (auras: Array<{ sourceId: string; pips: number; allyDelta: number; foeDelta: number }>, die: DiceInstanceState, side: 'ally' | 'foe') =>
      auras.reduce((total, aura) => total + (aura.sourceId !== die.instanceId && aura.pips === rolledPipsFor(die) ? (side === 'ally' ? aura.allyDelta : aura.foeDelta) : 0), 0);
    const getMightyRoarMeta = (die: DiceInstanceState) => {
      const definition = this.getDefinitionForInstance(die);
      if (!definition) return undefined;
      return getValidSkillDefinitions(definition)
        .filter((skill) => skill.type === 'Passive')
        .map((skill) => skill.modifiers)
        .find((modifiers) => modifiers?.statusEffect === 'stun' && modifiers.skillRangeThreshold === undefined);
    };
    const shouldMightyRoar = (die: DiceInstanceState) => {
      if (!die.gridPosition || !getMightyRoarMeta(die)) return false;
      return !this.findAttackTargetForArena(die);
    };

    const consumedStunIds: string[] = [];
    const consumedHibernationIds: string[] = [];
    let nextState: MatchBattleState = {
      ...this.gameState,
      combatPhase: 'attacking',
      dice: this.gameState.dice.map((die) => {
        if (die.zone !== 'board' || die.isDestroyed) {
          return die;
        }

        const basePips = rolledPipsFor(die);
        const definition = this.getDefinitionForInstance(die);
        if (definition) {
          const pipTransform = this.transforms.wasPipTriggered(die.instanceId)
            ? undefined
            : this.transforms.tryAdvancePipTriggeredTransform(die, basePips);
          void pipTransform;
        }
        const transformedDie = this.gameState.dice.find((candidate) => candidate.instanceId === die.instanceId) ?? die;
        const combatStartBonus = combatStartBonusFor(transformedDie);
        const combatStartFoeBonus = combatStartFoeBonusFor(transformedDie);
        const pips = basePips + combatStartBonus + combatStartFoeBonus;
        const allyPipAttackAuras = transformedDie.ownerId === 'player' ? playerPipAttackAuras : enemyPipAttackAuras;
        const foePipAttackAuras = transformedDie.ownerId === 'player' ? enemyPipAttackAuras : playerPipAttackAuras;
        const pipAuraDelta = sumMatchingDelta(allyPipAttackAuras, transformedDie, 'ally') + sumMatchingDelta(foePipAttackAuras, transformedDie, 'foe');
        if (pipAuraDelta !== 0) this.animateTimeMark(transformedDie, pipAuraDelta > 0 ? 0x8fd5ff : 0xff6b6b);
        const combatAttackCountDelta = combatStartBonus + combatStartFoeBonus + pipAuraDelta;
        const combatPositiveDelta = [combatStartBonus, combatStartFoeBonus, pipAuraDelta].reduce((sum, delta) => sum + Math.max(0, delta), 0);
        const combatNegativeDelta = [combatStartBonus, combatStartFoeBonus, pipAuraDelta].reduce((sum, delta) => sum + Math.min(0, delta), 0);
        this.combatAttackCountDeltaByInstance.set(die.instanceId, combatAttackCountDelta);
        this.combatAttackCountPositiveDeltaByInstance.set(die.instanceId, combatPositiveDelta);
        this.combatAttackCountNegativeDeltaByInstance.set(die.instanceId, combatNegativeDelta);
        this.recordAttackCountEffect(die.instanceId, combatPositiveDelta);
        this.recordAttackCountEffect(die.instanceId, combatNegativeDelta);
        if (combatAttackCountDelta > 0) this.writeAttackCountFeedback(transformedDie, combatAttackCountDelta);
        const withPermanent = this.computeAttackCount(transformedDie.instanceId, pips, pipAuraDelta, transformedDie);
        const stunned = this.statusEffects.getStunTurns(transformedDie.instanceId) > 0;
        if (stunned) consumedStunIds.push(transformedDie.instanceId);
        const hibernating = this.statusEffects.getHibernationTurns(transformedDie.instanceId) > 0;
        if (hibernating) consumedHibernationIds.push(transformedDie.instanceId);
        const incapacitated = stunned || hibernating;
        const mightyRoar = shouldMightyRoar(transformedDie);

        return {
          ...transformedDie,
          hasFinishedAttacking: incapacitated || (!mightyRoar && withPermanent <= 0),
          attacksRemaining: incapacitated ? 0 : Math.max(mightyRoar ? 1 : 0, withPermanent)
        };
      })
    };
    consumedStunIds.forEach((instanceId) => {
      this.statusEffects.consumeStunTurn(instanceId);
    });
    consumedHibernationIds.forEach((instanceId) => {
      this.statusEffects.consumeHibernationTurn(instanceId);
    });
    nextState.dice
      .filter((die) => die.zone === 'board' && !die.isDestroyed)
      .forEach((die) => {
        const allyAuras = die.ownerId === 'player' ? playerPipAttackAuras : enemyPipAttackAuras;
        const foeAuras = die.ownerId === 'player' ? enemyPipAttackAuras : playerPipAttackAuras;
        const matchingAllyAuras = allyAuras.filter((aura) => aura.sourceId !== die.instanceId && aura.pips === rolledPipsFor(die) && aura.allyDelta > 0);
        const matchingFoeAuras = foeAuras.filter((aura) => aura.sourceId !== die.instanceId && aura.pips === rolledPipsFor(die) && aura.foeDelta < 0);
        const stacks = [
          ...matchingAllyAuras.map((aura) => ({ effect: 'acceleration' as const, turns: 1, sourceInstanceId: aura.sourceId })),
          ...matchingFoeAuras.map((aura) => ({ effect: 'dilation' as const, turns: 1, sourceInstanceId: aura.sourceId }))
        ];
        if (stacks.length > 0) {
          this.statusEffects.setTimeStatuses(die.instanceId, stacks);
          stacks.forEach((stack) => {
            const source = this.gameState.dice.find((candidate) => candidate.instanceId === stack.sourceInstanceId);
            if (source) this.writeStatusApplicationFeedback(source, die, stack.effect, stack.turns);
          });
        }
      });
    if (this.randomModeActive && this.activeRandomModifier === 'Combanity') {
      nextState = this.applyCombanityBonuses(nextState);
    }
    nextState.dice.forEach((die) => {
      if (die.zone === 'board' && !die.isDestroyed) this.attackCapacityByInstance.set(die.instanceId, Math.max(0, die.attacksRemaining));
    });
    nextState.dice.forEach((die) => {
      if (die.zone !== 'board' || die.isDestroyed) return;
      const slow = this.getAttackDeltaSummary(die.instanceId);
      if (!slow || slow.delta >= 0) return;
      const lostAttackCounts = Math.abs(slow.delta);
      this.writeAttackCountFeedback(die, -lostAttackCounts);
    });
    [...playerBoardDice, ...enemyBoardDice].forEach((die) => {
      const definition = this.getDefinitionForInstance(die);
      if (!definition) return;
      const meta = getRuntimeSkillMeta(definition);
      const combatStartMeta = getRuntimeSkillMetaForTrigger(definition, 'CombatStart');
      const hasCombatStart = getValidSkillDefinitions(definition).some((skill) => skill.type === 'CombatStart') && (combatStartMeta.allyExtraAttacks ?? 0) > 0;
      const hasPassivePipAura = (meta.pipMatchAllyAttackDelta ?? 0) !== 0 || (meta.pipMatchFoeAttackDelta ?? 0) !== 0;
      if (hasPassivePipAura) {
        this.playSkillSfxForDie(die, meta);
      }
      if (definition.typeId === 'Light' && hasCombatStart && die.gridPosition) {
        const grid = this.getGridContainerForDie(die);
        const x = grid.x + die.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
        const y = grid.y + die.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
        AnimationManager.animateLightCombatStart(this, x, y, Math.max(1, combatStartMeta.allyExtraAttacks ?? 1), this.getCombatPacingMultiplier());
      }
    });
    return nextState;
  }

  private getRollComboBonusFromValues(rawValues: number[]): { multiplier: number; reduction: number; label: string } {
    const values = [...rawValues].sort((a, b) => a - b);
    const counts = new Map<number, number>();
    values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
    const groups = [...counts.values()].sort((a, b) => b - a);
    const unique = [...new Set(values)];
    const key = unique.join(',');
    const isSmallStraight = key.includes('1,2,3,4') || key.includes('2,3,4,5') || key.includes('3,4,5,6');
    const isLargeStraight = key === '1,2,3,4,5' || key === '2,3,4,5,6';
    if (groups[0] === 5) return { multiplier: 6, reduction: 1, label: 'Five-of-a-kind' };
    if (groups[0] === 4) return { multiplier: 4, reduction: 0.5, label: 'Four-of-a-kind' };
    if (groups[0] === 3 && groups[1] === 2) return { multiplier: 3, reduction: 0.35, label: 'Full House' };
    if (isLargeStraight) return { multiplier: 2, reduction: 0.25, label: 'Large Straight' };
    if (isSmallStraight) return { multiplier: 1.5, reduction: 0.2, label: 'Small Straight' };
    if (groups[0] === 3) return { multiplier: 2, reduction: 0, label: 'Three-of-a-kind' };
    if (groups[0] === 2 && groups[1] === 2) return { multiplier: 1.5, reduction: 0, label: 'Two Pair' };
    if (groups[0] === 2) return { multiplier: 1.2, reduction: 0, label: 'Pair' };
    return { multiplier: 1, reduction: 0, label: 'Classic' };
  }

  private getRollComboBonus(ownerId: 'player' | 'enemy'): { multiplier: number; reduction: number; label: string } {
    const enemyRollSources = this.gameState.dice.filter((die) => die.ownerId === 'enemy' && !die.isDestroyed && (die.zone === 'board' || die.zone === 'hand'));
    const values = ownerId === 'player'
      ? this.currentHandOrder.map((instanceId) => this.dicePips.get(instanceId) ?? 1)
      : enemyRollSources.map((die) => this.enemyDicePips.get(die.instanceId) ?? 1);
    return this.getRollComboBonusFromValues(values);
  }

  private refreshMultiplayerCombanityBonuses(): void {
    if (!this.isMultiplayerMatch || this.activeRandomModifier !== 'Combanity') return;
    const player = this.getRollComboBonusFromValues(this.gameState.dice
      .filter((die) => die.ownerId === 'player' && !die.isDestroyed && (die.zone === 'board' || die.zone === 'hand'))
      .map((die) => this.dicePips.get(die.instanceId) ?? 1));
    const enemy = this.getRollComboBonusFromValues(this.gameState.dice
      .filter((die) => die.ownerId === 'enemy' && !die.isDestroyed && (die.zone === 'board' || die.zone === 'hand'))
      .map((die) => this.enemyDicePips.get(die.instanceId) ?? 1));
    this.combanityBonusByOwner = {
      player: { ...player, reduction: clampDamageReduction(player.reduction) },
      enemy: { ...enemy, reduction: clampDamageReduction(enemy.reduction) }
    };
  }

  private applyCombanityBonuses(state: MatchBattleState): MatchBattleState {
    const playerOnly = this.activeChallenge === 'dungeon';
    const player = this.getRollComboBonus('player');
    const enemy = playerOnly
      ? { multiplier: 1, reduction: 0, label: 'Classic' }
      : this.getRollComboBonus('enemy');
    this.combanityBonusByOwner = {
      player: { multiplier: player.multiplier, reduction: clampDamageReduction(player.reduction), label: player.label },
      enemy: { multiplier: enemy.multiplier, reduction: clampDamageReduction(enemy.reduction), label: enemy.label }
    };
    this.writeCombatLog(playerOnly
      ? `Combanity: You rolled ${player.label} (${player.multiplier}x). The Dungeon Keeper does not inherit it.`
      : `Combanity: You rolled ${player.label} (${player.multiplier}x), Bot rolled ${enemy.label} (${enemy.multiplier}x).`);
    return {
      ...state,
      dice: state.dice.map((die) => {
        if (die.zone !== 'board' || die.isDestroyed) return die;
        const bonus = die.ownerId === 'player' ? player : enemy;
        this.combanityAttackMultiplierByInstance.set(die.instanceId, { multiplier: bonus.multiplier, turns: 1 });
        this.recordAttackCountEffect(die.instanceId, bonus.multiplier - 1);
        this.damageReductionByInstance.set(die.instanceId, clampDamageReduction(bonus.reduction));
        return die;
      })
    };
  }

  private getComboSfxKey(comboLabel: string): string | null {
    switch (comboLabel) {
      case 'Pair': return 'combo_pair';
      case 'Two Pair': return 'combo_twoPair';
      case 'Three-of-a-kind': return 'combo_triple';
      case 'Small Straight':
      case 'Large Straight': return 'combo_straight';
      case 'Full House': return 'combo_fullHouse';
      case 'Four-of-a-kind': return 'combo_fourOfAKind';
      case 'Five-of-a-kind': return 'combo_fiveOfAKind';
      default: return null;
    }
  }

  private getCombanityDamageMultiplier(attacker: DiceInstanceState, target: DiceInstanceState): number {
    if (!this.randomModeActive || this.activeRandomModifier !== 'Combanity') return 1;
    void target;
    return Math.max(0, this.combanityAttackMultiplierByInstance.get(attacker.instanceId)?.multiplier
      ?? this.combanityBonusByOwner[attacker.ownerId].multiplier);
  }

  private animateTimeMark(die: DiceInstanceState, color: number) {
    if (!die.gridPosition) return;
    const grid = this.getGridContainerForDie(die);
    const x = grid.x + die.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const y = grid.y + die.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    void color;
    AnimationManager.animateTimeActive(this, x, y, this.getCombatPacingMultiplier());
  }

  private getManaCapForDie(die: DiceInstanceState): number {
    const slots = this.getActiveManaSlots(die);
    return slots.reduce((max, slot) => Math.max(max, slot.manaNeeded), 0);
  }

  private async applyManaSkillEffectsAtCombatStart() {
    const boardDice = this.gameState.dice.filter((die) => die.zone === 'board' && !die.isDestroyed && die.gridPosition);
    for (const sourceSnapshot of boardDice) {
      const source = this.gameState.dice.find((die) =>
        die.instanceId === sourceSnapshot.instanceId
        && die.zone === 'board'
        && !die.isDestroyed
        && die.gridPosition
      );
      if (!source) continue;
      const definition = this.getDefinitionForInstance(source);
      if (!definition || !getValidSkillDefinitions(definition).some((skill) => skill.type === 'CombatStart')) continue;
      const manaEffect = getCombatStartManaEffect(
        definition,
        this.instanceClassLevels.get(source.instanceId) ?? 1,
        this.getDungeonCardEffectsForDie(source)?.batteryAllyManaBonus ?? 0
      );
      if (!manaEffect) continue;
      const meta = getRuntimeSkillMetaForTrigger(definition, 'CombatStart');
      const addTo = (die: DiceInstanceState, amount: number) => {
        if (amount <= 0 || this.getManaCapForDie(die) <= 0) return;
        this.addManaToAllActiveSlots(die, Math.floor(amount));
        if (die.gridPosition) {
          const grid = this.getGridContainerForDie(die);
          const x = grid.x + die.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
          const y = grid.y + die.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
          AnimationManager.animateBatteryCharge(this, x, y, die.instanceId === source.instanceId ? 0x95c2ff : 0x3f5573, this.getCombatPacingMultiplier());
        }
      };
      addTo(source, manaEffect.selfGain);
      const summonedParentId = this.summonedByInstance.get(source.instanceId);
      const allies = summonedParentId
        ? boardDice.filter((die) => die.instanceId === summonedParentId && die.ownerId === source.ownerId)
        : boardDice.filter((die) => die.ownerId === source.ownerId && die.instanceId !== source.instanceId);
      const foes = boardDice.filter((die) => die.ownerId !== source.ownerId);
      allies
        .filter((die) => this.isWithinSupportRadius(source, die, manaEffect.radius))
        .forEach((die) => addTo(die, manaEffect.allyGain));
      foes
        .filter((die) => this.isWithinSupportRadius(source, die, manaEffect.radius))
        .forEach((die) => addTo(die, manaEffect.foeGain));

      const stealAmount = manaEffect.steal;
      if (stealAmount > 0) {
        const stealType = manaEffect.stealType;
        const stealTargets = boardDice.filter((die) =>
          die.instanceId !== source.instanceId
          && ((stealType === 'ally' && die.ownerId === source.ownerId)
            || (stealType === 'enemy' && die.ownerId !== source.ownerId)
            || (stealType === 'both'))
        );
        let stolen = 0;
        const stolenFrom: string[] = [];
        stealTargets.forEach((target) => {
          let targetStolen = 0;
          this.getActiveManaSlots(target).forEach((slot) => {
            const current = this.getActiveMana(target.instanceId, slot.key);
            const drained = Math.min(current, stealAmount);
            if (drained <= 0) return;
            this.setActiveMana(target.instanceId, slot.key, current - drained, slot.manaNeeded);
            stolen += drained;
            targetStolen += drained;
          });
          if (targetStolen > 0) stolenFrom.push(`${this.getCombatDieName(target)} (${targetStolen})`);
        });
        addTo(source, stolen);
        if (stolen > 0) {
          const sourceName = this.getCombatDieName(source);
          const targetText = stolenFrom.length > 0 ? ` from ${stolenFrom.join(', ')}` : '';
          this.addCombatActionDetail(`${sourceName} steals ${stolen} mana${targetText}`);
          this.writeCombatLog(`💠 ${sourceName} steals ${stolen} mana${targetText}!`);
        }
      }
      if (manaEffect.selfGain > 0 || manaEffect.allyGain > 0 || manaEffect.foeGain > 0 || manaEffect.steal > 0) {
        this.playPhaseSkillSfxForDie(source, meta);
      }
    }
    await this.delay(250);
  }

  private applyManaPotionAtCombatStart() {
    const boardDice = this.gameState.dice.filter((d) => d.zone === 'board' && !d.isDestroyed);
    boardDice.forEach((ally) => {
      const allyDef = this.getDefinitionForInstance(ally);
      if (!allyDef) return;
      if (this.getManaCapForDie(ally) <= 0) return;
      const gain = this.manaPotionGainByOwner[ally.ownerId];
      if (gain <= 0) return;
      this.addManaToAllActiveSlots(ally, gain);
    });
  }

  private async maybeRunDiceCardDraft(render = true) {
    if (this.areDungeonCardsEnabled()) {
      await this.maybeRunDungeonCardDraft(render);
      return;
    }
    if (!this.configRandomMode || this.activeRandomModifier !== 'DiceCard') return;
    if (!canOfferDiceCards(this.gameState.turn, this.diceCardPicksUsed, this.activeChallenge === 'dungeon')) return;

    const rarity = getDiceCardRarityRoll(() => secureRandom());
    const playerCards = rollDiceCards(3, rarity, 'player', this.gameState.dice, this.definitions, this.activeDiceCardKeys, () => secureRandom());
    if (playerCards.length === 0) return;
    const picked = await this.showDiceCardPicker(playerCards);
    this.applyDiceCard(picked, 'player', render);

    if (this.activeChallenge !== 'dungeon') {
      const enemyCards = rollDiceCards(3, rarity, 'enemy', this.gameState.dice, this.definitions, this.activeDiceCardKeys, () => secureRandom());
      if (enemyCards.length > 0) this.applyDiceCard(enemyCards[Phaser.Math.Between(0, enemyCards.length - 1)], 'enemy', render);
    }

    this.diceCardPicksUsed += 1;
  }

  private async maybeRunDungeonCardDraft(render = true) {
    if (!this.areDungeonCardsEnabled() || this.dungeonCardState.pendingDraws <= 0) return;
    const currentTurn = this.gameState.turn;
    let safety = 0;
    while (this.dungeonCardState.pendingDraws > 0 && safety++ < 20) {
      let choices = this.dungeonCardState.draftOffer?.length
        ? this.dungeonCardState.draftOffer
        : this.rollDungeonCardOffer();
      if (choices.length === 0) {
        this.dungeonCardState = { ...this.dungeonCardState, pendingDraws: 0 };
        break;
      }
      let shuffledThisDraft = false;
      let picked: DungeonCard | null = null;
      while (!picked) {
        const action = await this.showDungeonCardPicker(choices, shuffledThisDraft);
        if (action !== 'shuffle') {
          picked = action;
          continue;
        }
        if (shuffledThisDraft || !canShuffleDungeonCards(this.dungeonCardState, currentTurn)) continue;
        const cost = getDungeonCardShuffleCost(this.dungeonCardState);
        if (cost > 0 && getDiamonds(this) < cost) continue;
        const bottomDeckKeys = new Set(choices.map((card) => getDungeonCardKey(card.kind, card.rarity, card.typeId)));
        const nextShuffleState = this.getDungeonNextShuffleState(currentTurn);
        const nextChoices = this.rollDungeonCardOffer(nextShuffleState, bottomDeckKeys);
        if (nextChoices.length === 0) continue;
        const nextState: DungeonCardState = { ...nextShuffleState, draftOffer: nextChoices };
        if (!this.payDungeonCardShuffle(cost, nextState)) continue;
        this.dungeonCardState = nextState;
        choices = nextChoices;
        shuffledThisDraft = true;
      }
      this.applyDungeonCardChoice(picked, render);
      this.persistDungeonCardState();
    }
  }

  private showDungeonCardPicker(cards: DungeonCard[], shuffledThisDraft: boolean): Promise<DungeonCard | 'shuffle'> {
    return new Promise<DungeonCard | 'shuffle'>((resolve) => {
      const c = this.add.container(this.scale.width / 2, this.scale.height / 2).setDepth(500);
      const blocker = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 0.52).setInteractive();
      const bg = this.add.rectangle(0, 0, 760, 360, 0x071018, 0.98).setStrokeStyle(2, 0x9b5f3a);
      const title = this.add.text(0, -154, 'CHOOSE A DUNGEON CARD', { fontFamily: 'Orbitron', fontSize: '20px', color: '#ffe8c6' }).setOrigin(0.5);
      const required = getDungeonCardKillsRequired(this.dungeonCardState);
      const uniqueDraw = isDungeonCardUniqueDraw(this.dungeonCardState);
      const drawHint = uniqueDraw ? ' • UNIQUE DRAW: Common 20% / Rare 40% / Epic 30% / Legendary 10%' : '';
      const subtitle = this.add.text(0, -126, `${this.dungeonCardState.killsTowardNext}/${required} kills • ${this.dungeonCardState.pendingDraws} draw${this.dungeonCardState.pendingDraws === 1 ? '' : 's'} ready${drawHint}`, {
        fontFamily: 'Orbitron', fontSize: '10px', color: uniqueDraw ? '#ffd84d' : PALETTE.textMuted
      }).setOrigin(0.5);
      c.add([blocker, bg, title, subtitle]);

      const spacing = 220;
      const startX = -((cards.length - 1) * spacing) / 2;
      cards.forEach((card, index) => {
        const x = startX + index * spacing;
        const targetName = this.getDungeonCardTypeName(card.typeId);
        const owned = getDungeonCardStackCount(this.dungeonCardState, card);
        const presentation = getDungeonCardPresentation(card, targetName, owned);
        const color = presentation.color;
        const btn = this.add.rectangle(x, -4, 200, 226, 0x16344a, 0.98).setStrokeStyle(2, Phaser.Display.Color.HexStringToColor(color).color).setInteractive({ useHandCursor: true });
        const accent = this.add.rectangle(x, -111, 196, 6, Phaser.Display.Color.HexStringToColor(color).color, 0.9);
        const icon = this.add.text(x, -78, presentation.icon, { fontSize: '28px', color }).setOrigin(0.5);
        const heading = this.add.text(x, -38, `${presentation.rarity}\n${presentation.title}`, { fontFamily: 'Orbitron', fontSize: '12px', color: '#ffffff', align: 'center', wordWrap: { width: 188 } }).setOrigin(0.5);
        const target = this.add.text(x, 18, targetName, { fontFamily: 'Orbitron', fontSize: '14px', color, align: 'center' }).setOrigin(0.5);
        const desc = this.add.text(x, 68, presentation.description, { fontFamily: 'Orbitron', fontSize: '9px', color: PALETTE.text, align: 'center', wordWrap: { width: 180 } }).setOrigin(0.5);
        const stack = this.add.text(x, 101, presentation.stackLabel, { fontFamily: 'Orbitron', fontSize: '9px', color: presentation.unique ? '#ffd84d' : PALETTE.textMuted }).setOrigin(0.5);
        btn.on('pointerdown', () => {
          c.destroy(true);
          resolve(card);
        });
        btn.on('pointerover', () => btn.setFillStyle(0x1f4360, 1));
        btn.on('pointerout', () => btn.setFillStyle(0x16344a, 0.98));
        c.add([btn, accent, icon, heading, target, desc, stack]);
      });

      const cost = getDungeonCardShuffleCost(this.dungeonCardState);
      const canAfford = cost === 0 || getDiamonds(this) >= cost;
      const canShuffleThisTurn = canShuffleDungeonCards(this.dungeonCardState, this.gameState.turn);
      const canShuffle = !shuffledThisDraft && canShuffleThisTurn && canAfford;
      const shuffleLabel = shuffledThisDraft || !canShuffleThisTurn
        ? 'SHUFFLE USED'
        : canAfford
          ? `SHUFFLE DECK (${cost === 0 ? 'FREE' : `${cost} ◆`})`
          : `NEED ${cost} ◆`;
      const shuffle = this.add.text(0, 138, shuffleLabel, {
        fontFamily: 'Orbitron', fontSize: '11px', color: canShuffle ? '#071018' : '#8ea1b2',
        backgroundColor: canShuffle ? '#f4b860' : '#243845', padding: { left: 14, right: 14, top: 7, bottom: 7 }
      }).setOrigin(0.5);
      if (canShuffle) {
        shuffle.setInteractive({ useHandCursor: true });
        shuffle.on('pointerdown', () => {
          c.destroy(true);
          resolve('shuffle');
        });
      }
      const wallet = this.add.text(0, 164, `DIAMONDS ${formatCompact(getDiamonds(this))}  •  PICK ONE CARD`, {
        fontFamily: 'Orbitron', fontSize: '9px', color: PALETTE.textMuted
      }).setOrigin(0.5);
      c.add([shuffle, wallet]);
    });
  }

  private async showDiceCardPicker(cards: DiceCard[]): Promise<DiceCard> {
    return await new Promise<DiceCard>((resolve) => {
      const c = this.add.container(this.scale.width / 2, this.scale.height / 2).setDepth(500);
      const blocker = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 0.45).setInteractive();
      const bg = this.add.rectangle(0, 0, 560, 250, 0x071018, 0.96).setStrokeStyle(2, 0xc28f4a);
      const title = this.add.text(0, -95, 'Choose a Dice Card', { fontFamily: 'Orbitron', fontSize: '20px', color: '#ffe8c6' }).setOrigin(0.5);
      c.add([blocker, bg, title]);
      cards.forEach((card, idx) => {
        const x = -170 + idx * 170;
            const info = getDiceCardInfo(card.key, (typeId) => this.definitions.get(typeId)?.title);
        const btn = this.add.rectangle(x, 10, 150, 130, 0x16344a, 0.95).setStrokeStyle(2, 0xf0c36a).setInteractive({ useHandCursor: true });
        const iconText = this.add.text(x, -34, info.icon, { fontSize: '30px', color: info.color ?? '#ffffff' }).setOrigin(0.5);
        const tx = this.add.text(x, 26, `${card.rarity}\n${card.title}`, { fontFamily: 'Orbitron', fontSize: '13px', color: '#ffffff', align: 'center', wordWrap: { width: 138 } }).setOrigin(0.5);
        btn.on('pointerdown', () => { c.destroy(true); resolve(card); });
        c.add([btn, iconText, tx]);
      });
    });
  }

  private applyMultiplayerDiceCardState(
    cards: Partial<Record<'player' | 'enemy', DiceCard[]>> | undefined,
    offer: DiceCard[] | undefined,
    turn: number | undefined,
    _picksUsed: number | undefined
  ): void {
    if (!this.isMultiplayerMatch) return;
    this.activeDiceCardKeys.clear();
    this.activeDiceCards = [];
    this.activeDiceCardKeysByOwner.player.clear();
    this.activeDiceCardKeysByOwner.enemy.clear();
    if (cards) this.resetDiceCardRuntimeEffects();
    (['player', 'enemy'] as const).forEach((owner) => {
      const ownerCards = cards?.[owner] ?? [];
      ownerCards.forEach((card) => {
        this.activeDiceCardKeys.add(card.key);
        this.activeDiceCardKeysByOwner[owner].add(card.key);
        if (cards) this.applyDiceCardRuntimeEffects(card, owner);
        if (owner === 'player' && !this.activeDiceCards.some((active) => active.key === card.key)) {
          this.activeDiceCards.push(card);
        }
      });
    });
    if (!offer || offer.length === 0) {
      this.multiplayerDiceCardKey = null;
      this.multiplayerDiceCardOfferSignature = '';
      this.multiplayerDiceCardDraftOpen = false;
      this.renderDiceCardInfoPanel();
      return;
    }
    const signature = `${turn ?? 0}:${offer.map((card) => card.key).join('|')}`;
    if (signature !== this.multiplayerDiceCardOfferSignature) {
      this.multiplayerDiceCardOfferSignature = signature;
      this.multiplayerDiceCardKey = null;
    }
    this.renderDiceCardInfoPanel();
    if (this.multiplayerDiceCardKey || this.multiplayerDiceCardDraftOpen) return;
    this.multiplayerDiceCardDraftOpen = true;
    void this.showDiceCardPicker(offer).then((card) => {
      this.multiplayerDiceCardDraftOpen = false;
      if (!this.sys.isActive() || !this.isMultiplayerMatch) return;
      this.multiplayerDiceCardKey = card.key;
      this.activeDiceCardKeys.add(card.key);
      this.activeDiceCardKeysByOwner.player.add(card.key);
      this.applyDiceCardRuntimeEffects(card, 'player');
      if (!this.activeDiceCards.some((active) => active.key === card.key)) this.activeDiceCards.push(card);
      this.renderDiceCardInfoPanel();
      this.writeCombatLog(`Dice Card chosen: ${card.rarity} ${card.title}.`);
    });
  }

  private resetDiceCardRuntimeEffects() {
    this.oddInvestmentByOwner = { player: { damage: 0, reduction: 0 }, enemy: { damage: 0, reduction: 0 } };
    this.evenInvestmentByOwner = { player: { damage: 0, reduction: 0 }, enemy: { damage: 0, reduction: 0 } };
    this.fireSupportByOwner = { player: 0, enemy: 0 };
    this.vanguardReductionByOwner = { player: 0, enemy: 0 };
    this.centrelineDamageByOwner = { player: 0, enemy: 0 };
    this.straightFaceRateByOwner = { player: 0, enemy: 0 };
    this.royalObedienceRateByOwner = { player: 0, enemy: 0 };
    this.crowdAttackByOwner = { player: { damage: 0, reduction: 0 }, enemy: { damage: 0, reduction: 0 } };
    this.diceTypeUpgradeBonus.clear();
    this.spotlightByInstance.clear();
    this.giantHunterRateByOwner = { player: 0, enemy: 0 };
    this.fountainHealRateByOwner = { player: 0, enemy: 0 };
    this.manaPotionGainByOwner = { player: 0, enemy: 0 };
  }

  private applyDiceCardRuntimeEffects(card: DiceCard, owner: 'player' | 'enemy') {
    const effect = getDiceCardRuntimeContribution(card);
    this.fountainHealRateByOwner[owner] += effect.fountainHealRate;
    this.manaPotionGainByOwner[owner] += effect.manaPotionGain;
    this.giantHunterRateByOwner[owner] += effect.giantHunterRate;
    this.fireSupportByOwner[owner] += effect.fireSupportAttacks;
    this.vanguardReductionByOwner[owner] += effect.vanguardReduction;
    this.centrelineDamageByOwner[owner] += effect.centrelineDamage;
    this.straightFaceRateByOwner[owner] += effect.straightFaceRate;
    this.royalObedienceRateByOwner[owner] += effect.royalObedienceRate;
    if (effect.spotlightRate > 0) {
      this.gameState.dice.filter((d) => d.ownerId === owner).forEach((d) => {
        this.spotlightByInstance.set(d.instanceId, { mult: 1 + effect.spotlightRate, reduction: effect.spotlightRate });
      });
    }
    if (card.kind === 'Type Upgrade' && card.typeId) {
      const key = `${owner}:${card.typeId}`;
      this.diceTypeUpgradeBonus.set(key, (this.diceTypeUpgradeBonus.get(key) ?? 0) + effect.typeUpgradeRate);
    }
    if (effect.oddInvestmentDamage > 0 || effect.oddInvestmentReduction > 0) {
      this.oddInvestmentByOwner[owner] = {
        damage: this.oddInvestmentByOwner[owner].damage + effect.oddInvestmentDamage,
        reduction: this.oddInvestmentByOwner[owner].reduction + effect.oddInvestmentReduction
      };
    }
    if (effect.evenInvestmentDamage > 0 || effect.evenInvestmentReduction > 0) {
      this.evenInvestmentByOwner[owner] = {
        damage: this.evenInvestmentByOwner[owner].damage + effect.evenInvestmentDamage,
        reduction: this.evenInvestmentByOwner[owner].reduction + effect.evenInvestmentReduction
      };
    }
    if (effect.crowdAttackDamage > 0 || effect.crowdAttackReduction > 0) {
      this.crowdAttackByOwner[owner] = {
        damage: this.crowdAttackByOwner[owner].damage + effect.crowdAttackDamage,
        reduction: this.crowdAttackByOwner[owner].reduction + effect.crowdAttackReduction
      };
    }
    return effect;
  }

  private applyDiceCard(card: DiceCard, owner: 'player' | 'enemy', render = true) {
    this.activeDiceCardKeys.add(card.key);
    this.activeDiceCardKeysByOwner[owner].add(card.key);
    if (owner === 'player' && !this.activeDiceCards.some((active) => active.key === card.key)) this.activeDiceCards.push(card);
    const effect = this.applyDiceCardRuntimeEffects(card, owner);
    if (card.kind === 'Type Upgrade' && card.typeId) {
      const bonusRate = effect.typeUpgradeRate;
      if (owner === 'player' && this.activeRandomModifier === 'DiceCard') {
        const ownedKeys = this.activeDiceCardKeysByOwner.player;
        const hasAllRarities = (['Bronze', 'Silver', 'Gold'] as const).every((rarity) => ownedKeys.has(`${card.typeId} Upgrade:${rarity}`));
        if (hasAllRarities) AchievementStore.unlock(this, 'stacked_up');
      }
      this.gameState = {
        ...this.gameState,
        dice: this.gameState.dice.map((d) => {
          if (d.ownerId !== owner || d.typeId !== card.typeId) return d;
          const boostedMax = Math.max(1, Math.floor(d.maxHealth * (1 + bonusRate)));
          const maxDelta = Math.max(0, boostedMax - d.maxHealth);
          return { ...d, maxHealth: boostedMax, currentHealth: Math.min(boostedMax, Math.max(1, d.currentHealth + maxDelta)) };
        })
      };
    }
    if (card.kind === 'Straight Face') {
      this.applyBelowLegendaryMaxHealthBonus(owner, effect.straightFaceRate);
    }
    if (render) this.renderDiceCardInfoPanel();
  }

  private applyBelowLegendaryMaxHealthBonus(owner: 'player' | 'enemy', rate: number) {
    if (rate <= 0) return;
    this.gameState = {
      ...this.gameState,
      dice: this.gameState.dice.map((die) => {
        if (die.ownerId !== owner) return die;
        const definition = this.getDefinitionForInstance(die);
        if (!definition || (DICE_RARITY_RANK[definition.rarity] ?? 0) >= DICE_RARITY_RANK.Legendary) return die;
        const boostedMax = Math.max(1, Math.floor(die.maxHealth * (1 + rate)));
        const maxDelta = Math.max(0, boostedMax - die.maxHealth);
        return { ...die, maxHealth: boostedMax, currentHealth: Math.min(boostedMax, die.currentHealth + maxDelta) };
      })
    };
  }

  private expireUntimedShields() {
    this.shieldHpByInstance.forEach((_shieldHp, instanceId) => {
      if (!this.shieldDurationTurnsByInstance.has(instanceId)) this.shieldHpByInstance.delete(instanceId);
    });
    this.shieldDurationTurnsByInstance.forEach((_turns, instanceId) => {
      if (!this.shieldHpByInstance.has(instanceId)) this.shieldDurationTurnsByInstance.delete(instanceId);
    });
    this.shieldDamageTextByInstance.clear();
  }

  private applyTauntEffects() {
    const boardDice = this.gameState.dice.filter((die) => die.zone === 'board' && !die.isDestroyed && die.gridPosition);
    this.statusEffects.applyTauntEffects(boardDice, (shield) => {
      const definition = this.getDefinitionForInstance(shield);
      if (!definition) return [];
      const taunt = getCombatStartTauntEffect(definition, this.instanceClassLevels.get(shield.instanceId) ?? 1);
      if (!taunt) return [];
      return boardDice
        .filter((foe) => foe.ownerId !== shield.ownerId && this.getDistanceWithBoardSides(shield, foe) <= taunt.range)
        .map((target) => ({ target, duration: taunt.duration }));
    }, {
      onApplied: (source, target, _effect, duration) => this.writeStatusApplicationFeedback(source, target, 'taunt', duration)
    });
  }

  private applySkillLocks(source: DiceInstanceState, meta: ReturnType<typeof getRuntimeSkillMeta>, persistsAfterSourceDefeat = false): boolean {
    if (meta.hasLock !== true) return false;
    const definition = this.getDefinitionForInstance(source);
    if (!definition || !source.gridPosition) return false;
    let didLock = false;

    const sideTargeting = meta.lockSideTargeting ?? 'foes';
    const lockRange = meta.lockRange === -1
      ? Number.POSITIVE_INFINITY
      : Math.max(1, meta.lockRange ?? this.getEffectiveAttackRange(source, definition));
    const numLocks = Math.max(1, Math.floor(meta.numLocks ?? 1));
    const unlockEffect = meta.lockUnlockApplyStatusEffect && meta.statusEffect
      ? {
          effect: meta.statusEffect,
          duration: Math.max(1, Math.floor(
            meta.disorientationDuration
            ?? meta.statusDuration
            ?? (meta as unknown as Record<string, number | undefined>)[`${meta.statusEffect}Duration`]
            ?? 1
          )),
          delta: meta.attackDelta
        }
      : undefined;

    if (meta.onlyLockGridTiles !== true) {
      const candidates = this.gameState.dice
        .filter((die): die is DiceInstanceState & { gridPosition: { row: number; col: number } } => {
          if (die.instanceId === source.instanceId || die.zone !== 'board' || die.isDestroyed || !die.gridPosition) return false;
          if (this.isBossDie(die)) return false;
          const isFoe = die.ownerId !== source.ownerId;
          const allowedOwner = isFoe ? sideTargeting !== 'allies' : sideTargeting !== 'foes';
          if (!allowedOwner || this.chainedByInstance.has(die.instanceId)) return false;
          return this.getDistanceWithBoardSides(source, die) <= lockRange;
        })
        .map((die) => ({ die, distance: this.getDistanceWithBoardSides(source, die) }));

      const mode = meta.activeSkillTargeting ?? meta.skillTargeting ?? meta.targetingMode ?? definition.targetingMode ?? 'Nearest';
      const lockedNames: string[] = [];
      for (let index = 0; index < numLocks && candidates.length > 0; index++) {
        const target = this.selectTargetCandidate(candidates, mode);
        if (!target) break;
        this.chainedByInstance.set(target.instanceId, source.instanceId);
        if (meta.lockDuration !== undefined) {
          this.lockTurnsByInstance.set(target.instanceId, meta.lockDuration);
          this.persistentLockSourceIds.add(source.instanceId);
        } else if (persistsAfterSourceDefeat) {
          this.persistentLockSourceIds.add(source.instanceId);
        }
        if (unlockEffect) this.lockUnlockEffectByInstance.set(target.instanceId, unlockEffect);
        lockedNames.push(this.getCombatDieName(target));
        const candidateIndex = candidates.findIndex((candidate) => candidate.die.instanceId === target.instanceId);
        if (candidateIndex >= 0) candidates.splice(candidateIndex, 1);
      }
      if (lockedNames.length > 0) {
        didLock = true;
        const durationLabel = meta.lockDuration !== undefined ? ` for ${meta.lockDuration} turns` : '';
        this.writeCombatLog(`🔗 ${this.getCombatDieName(source)} chains ${lockedNames.join(', ')}${durationLabel}!`);
      }
    }

    if (meta.canLockGridTiles === true) {
      const opposingOwner = source.ownerId === 'player' ? 'enemy' : 'player';
      const gridOwner = sideTargeting === 'both'
        ? (secureRandomBetween(0, 1) === 0 ? source.ownerId : opposingOwner)
        : sideTargeting === 'allies' ? source.ownerId : opposingOwner;
      const activeLocks = this.gridLockTurnsByOwner[gridOwner];
      const tileDuration = meta.gridLockDuration ?? meta.lockDuration ?? 1;
      const available = Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => ({
        row: Math.floor(index / GRID_SIZE),
        col: index % GRID_SIZE
      })).filter((tile) => !activeLocks.has(`${tile.row},${tile.col}`));
      const tileCount = Math.min(numLocks, available.length);
      const lockedTiles: Array<{ row: number; col: number }> = [];
      for (let index = 0; index < tileCount; index++) {
        const pickIndex = secureRandomBetween(0, available.length - 1);
        const tile = available.splice(pickIndex, 1)[0];
        if (!tile) continue;
        activeLocks.set(`${tile.row},${tile.col}`, tileDuration);
        lockedTiles.push(tile);
      }
      if (lockedTiles.length > 0) {
        didLock = true;
        const tileList = lockedTiles.map((tile) => `[${tile.row}, ${tile.col}]`).join(', ');
        this.writeCombatLog(`⛓️ ${this.getCombatDieName(source)} locks ${tileList} for ${tileDuration} turns!`);
      }
    }
    return didLock;
  }

  private unlockChainedDie(instanceId: string) {
    const sourceId = this.chainedByInstance.get(instanceId);
    this.chainedByInstance.delete(instanceId);
    this.lockTurnsByInstance.delete(instanceId);
    this.retainedLockedDice.delete(instanceId);
    const unlockEffect = this.lockUnlockEffectByInstance.get(instanceId);
    this.lockUnlockEffectByInstance.delete(instanceId);
    if (!unlockEffect) return;
    const target = this.gameState.dice.find((die) => die.instanceId === instanceId && !die.isDestroyed);
    if (!target) return;
    const source = this.gameState.dice.find((die) => die.instanceId === sourceId) ?? target;
    this.applyStatusApplications([{
      source,
      target,
      effect: unlockEffect.effect,
      duration: unlockEffect.duration,
      delta: unlockEffect.delta
    }]);
    this.writeCombatLog(`🔓 ${this.getCombatDieName(target)} breaks free of its chains!`);
  }

  private applyPendingHandDisorientation() {
    if (this.pendingHandDisorientation.length === 0) return;
    const pending = this.pendingHandDisorientation.shift();
    if (!pending) return;
    const source = this.gameState.dice.find((die) => die.instanceId === pending.sourceInstanceId);
    const opposingOwner = source?.ownerId === 'player' ? 'enemy' : 'player';
    const candidates = getAvailableHandDice(this.gameState, opposingOwner);
    if (candidates.length === 0) return;
    const target = candidates[secureRandomBetween(0, candidates.length - 1)];
    if (!target) return;
    this.statusEffects.applyDisorientation(target.instanceId, pending.turns);
    this.writeStatusApplicationFeedback(source, target, 'disorientation', pending.turns);
  }

  private autoPlaceDisorientedDice(ownerId: 'player' | 'enemy') {
    const handDice = getAvailableHandDice(this.gameState, ownerId)
      .filter((die) => this.statusEffects.getDisorientationTurns(die.instanceId) > 0);
    if (handDice.length === 0) return;
    const usedCells = this.collectOccupiedCells(ownerId);
    handDice.forEach((die) => {
      const definition = this.getDefinitionForInstance(die) ?? this.definitions.get(die.typeId);
      const footprint = this.getFootprintForDefinition(definition);
      const position = this.findRandomFootprintPosition(
        footprint,
        usedCells,
        () => secureRandomBetween(0, GRID_SIZE - footprint)
      );
      if (!position) return;
      this.markFootprint(position.row, position.col, footprint, usedCells);
      this.gameState = placeDieOnBoard(this.gameState, die.instanceId, position.row, position.col);
      this.statusEffects.consumeDisorientationTurn(die.instanceId);
      if (ownerId === 'player') {
        const container = this.handDice.get(die.instanceId);
        container?.destroy();
        this.handDice.delete(die.instanceId);
      }
      this.writeCombatLog(`😵 ${this.getCombatDieName(die)} places itself at [${position.row}, ${position.col}] while disoriented!`);
    });
    if (ownerId === 'player') {
      this.renderDice();
      this.reflowHandPositions();
      this.updateCombatButtonState();
    }
  }

  private renderGridLocks() {
    this.gridLockOverlays.forEach((object) => object.destroy());
    this.gridLockOverlays = [];
    (['player', 'enemy'] as const).forEach((ownerId) => {
      const grid = ownerId === 'player' ? this.playerGridContainer : this.enemyGridContainer;
      if (!grid) return;
      this.gridLockTurnsByOwner[ownerId].forEach((turns, key) => {
        if (turns <= 0) return;
        const [row, col] = key.split(',').map(Number);
        if (!Number.isInteger(row) || !Number.isInteger(col)) return;
        const x = col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
        const y = row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
        const tile = this.add.rectangle(x, y, TILE_SIZE - 6, TILE_SIZE - 6, 0x9aa0a8, 0.3)
          .setStrokeStyle(2, 0xd6d9de, 0.85);
        tile.setName('grid-lock');
        const label = this.add.text(x, y, `⛓${turns}`, {
          fontFamily: 'Orbitron',
          fontSize: '12px',
          color: '#eef0f3'
        }).setOrigin(0.5);
        label.setName('grid-lock');
        grid.add([tile, label]);
        this.gridLockOverlays.push(tile, label);
      });
    });
  }

  private isFootprintGridLocked(ownerId: 'player' | 'enemy', row: number, col: number, footprint: number): boolean {
    const locks = this.gridLockTurnsByOwner[ownerId];
    for (let rowOffset = 0; rowOffset < footprint; rowOffset++) {
      for (let colOffset = 0; colOffset < footprint; colOffset++) {
        if ((locks.get(`${row + rowOffset},${col + colOffset}`) ?? 0) > 0) return true;
      }
    }
    return false;
  }

  private restoreDurationLockedDice() {
    if (this.retainedLockPositions.size === 0) {
      this.retainedLockedDice.clear();
      return;
    }
    this.retainedLockedDice = new Set(this.retainedLockPositions.keys());
    this.gameState = {
      ...this.gameState,
      dice: this.gameState.dice.map((die) => {
        const position = this.retainedLockPositions.get(die.instanceId);
        if (!position || die.isDestroyed) return die;
        return {
          ...die,
          zone: 'board' as const,
          gridPosition: position,
          attacksRemaining: 0,
          hasFinishedAttacking: true
        };
      })
    };
    this.writeRetainedChainFeedback();
    this.retainedLockPositions.clear();
  }

  private writeRetainedChainFeedback() {
    const retained = this.gameState.dice
      .filter((die) => !die.isDestroyed && this.retainedLockedDice.has(die.instanceId) && die.gridPosition)
      .sort((left, right) => (left.gridPosition?.row ?? 0) - (right.gridPosition?.row ?? 0)
        || (left.gridPosition?.col ?? 0) - (right.gridPosition?.col ?? 0));
    (['player', 'enemy'] as const).forEach((ownerId) => {
      const dice = retained.filter((die) => die.ownerId === ownerId);
      if (dice.length === 0) return;
      const ownerLabel = ownerId === 'player' ? 'Your' : 'Enemy';
      if (dice.length === 1) {
        const die = dice[0]!;
        this.writeCombatLog(`${ownerLabel} ${this.getCombatDieName(die)} is chained in position ${die.gridPosition!.col + 1}, ${die.gridPosition!.row + 1} and cannot return to hand!`);
        return;
      }
      const entries = dice.map((die) => `${this.getCombatDieName(die)} (position: ${die.gridPosition!.col + 1}, ${die.gridPosition!.row + 1})`);
      this.writeCombatLog(`${ownerLabel} ${entries.slice(0, -1).join(', ')} and ${entries[entries.length - 1]} are chained and cannot return to hand!`);
    });
  }

  private getHandPlacedDiceCount(): number {
    return getBoardDice(this.gameState, 'player')
      .filter((die) => !this.retainedLockedDice.has(die.instanceId)).length;
  }

  private hasPlaceableHandDice(): boolean {
    const usedCells = this.collectOccupiedCells('player');
    return this.currentHandOrder.some((instanceId) => {
      const die = this.gameState.dice.find((candidate) =>
        candidate.ownerId === 'player'
        && candidate.instanceId === instanceId
        && candidate.zone === 'hand'
        && !candidate.isDestroyed
      );
      if (!die) return false;
      const footprint = this.getFootprintForDie(die);
      for (let row = 0; row <= GRID_SIZE - footprint; row++) {
        for (let col = 0; col <= GRID_SIZE - footprint; col++) {
          if (this.canPlaceFootprint(row, col, footprint, usedCells)) return true;
        }
      }
      return false;
    });
  }

  private getActiveLockSource(die: DiceInstanceState): DiceInstanceState | undefined {
    const sourceId = this.chainedByInstance.get(die.instanceId);
    if (!sourceId) return undefined;
    return this.gameState.dice.find((source) =>
      source.instanceId === sourceId
      && (source.zone === 'board' && !source.isDestroyed || this.persistentLockSourceIds.has(source.instanceId)));
  }

  private getNextCombatAttacker(owners: Array<'player' | 'enemy'>): DiceInstanceState | undefined {
    const ownerOrder = new Map(owners.map((owner, index) => [owner, index]));
    let candidates = this.gameState.dice
      .filter((die) => die.zone === 'board' && !die.isDestroyed && !this.healingWaitByInstance.has(die.instanceId) && !die.hasFinishedAttacking && die.attacksRemaining > 0 && die.gridPosition);
    if (candidates.length === 0 && this.healingWaitByInstance.size > 0) {
      this.healingWaitByInstance.forEach((instanceId) => this.healingRetryReadyByInstance.add(instanceId));
      this.healingWaitByInstance.clear();
      candidates = this.gameState.dice
        .filter((die) => die.zone === 'board' && !die.isDestroyed && !die.hasFinishedAttacking && die.attacksRemaining > 0 && die.gridPosition);
    }
    if (candidates.length === 0) return undefined;

    const unchained = candidates.filter((die) => !this.getActiveLockSource(die));
    const orderedCandidates = unchained.length > 0 ? unchained : candidates;
    return orderedCandidates.sort((a, b) => {
      const aDeferred = this.getActiveLockSource(a) ? 1 : 0;
      const bDeferred = this.getActiveLockSource(b) ? 1 : 0;
      return aDeferred - bDeferred
        || (ownerOrder.get(a.ownerId) ?? 0) - (ownerOrder.get(b.ownerId) ?? 0)
        || b.gridPosition!.row - a.gridPosition!.row
        || b.gridPosition!.col - a.gridPosition!.col
        || a.instanceId.localeCompare(b.instanceId);
    })[0];
  }

  private getTypeUpgradeMultiplier(attacker: DiceInstanceState): number {
    const bonusRate = this.diceTypeUpgradeBonus.get(`${attacker.ownerId}:${attacker.typeId}`) ?? 0;
    return 1 + Math.max(0, bonusRate);
  }

  private getSpotlightScale(die: DiceInstanceState): number {
    const data = this.spotlightByInstance.get(die.instanceId);
    if (!data) return 0;
    return this.getEffectivePipForInvestment(die) === 3 ? data.reduction : 0;
  }
  
  private getEffectivePipForInvestment(die: DiceInstanceState): number {
    return die.ownerId === 'player' ? (this.dicePips.get(die.instanceId) ?? 1) : (this.enemyDicePips.get(die.instanceId) ?? 1);
  }

  private getInvestmentDamageBonus(die: DiceInstanceState): number {
    const effectivePip = this.getEffectivePipForInvestment(die);
    return effectivePip % 2 === 0 ? this.evenInvestmentByOwner[die.ownerId].damage : this.oddInvestmentByOwner[die.ownerId].damage;
  }

  private getCrowdAttackDamageBonus(die: DiceInstanceState): number {
    const effectivePip = this.getEffectivePipForInvestment(die);
    if (effectivePip === 1 || effectivePip === 2) {
      return this.crowdAttackByOwner[die.ownerId].damage;
    }
    return 0;
  }

  private getOffenseMultiplier(attacker: DiceInstanceState): number {
    const typeBoost = this.getTypeUpgradeMultiplier(attacker);
    return typeBoost * (1 + this.getSpotlightScale(attacker) + this.getInvestmentDamageBonus(attacker) + this.getCrowdAttackDamageBonus(attacker) + this.getCentrelineDamageBonus(attacker) + this.getRarityDamageBonus(attacker));
  }

  private getRarityDamageBonus(die: DiceInstanceState): number {
    const definition = this.getDefinitionForInstance(die);
    if (!definition) return 0;
    const rank = DICE_RARITY_RANK[definition.rarity] ?? 0;
    if (rank < DICE_RARITY_RANK.Legendary) return this.straightFaceRateByOwner[die.ownerId];
    if (rank >= DICE_RARITY_RANK.Legendary) return this.royalObedienceRateByOwner[die.ownerId];
    return 0;
  }

  private getCentrelineDamageBonus(die: DiceInstanceState): number {
    if (!die.gridPosition || die.gridPosition.col !== 2) return 0;
    return this.centrelineDamageByOwner[die.ownerId];
  }

  private getVanguardReduction(die: DiceInstanceState): number {
    if (!die.gridPosition) return 0;
    const isFrontline = die.ownerId === 'player' ? die.gridPosition.col === 4 : die.gridPosition.col === 0;
    return isFrontline ? this.vanguardReductionByOwner[die.ownerId] : 0;
  }

  private getSkillPowerMultiplier(attacker: DiceInstanceState): number {
    const multiplier = this.getOffenseMultiplier(attacker);
    if (this.activeChallenge === 'dungeon' && attacker.ownerId === 'enemy' && this.isBossDie(attacker)) {
      return multiplier * getDungeonEliteSkillMultiplier(this.dungeonWave);
    }
    return multiplier;
  }

  private getDiceCardSkillDamageMultiplier(attacker: DiceInstanceState): number {
    return this.getSkillPowerMultiplier(attacker) * this.getDungeonCardAttackMultiplier(attacker);
  }

  private getSkillSupportMultiplier(source: DiceInstanceState, target: DiceInstanceState = source): number {
    return this.getCombanityDamageMultiplier(source, target) * this.getSkillPowerMultiplier(source);
  }

  private getBasicAttackDamageBonus(attacker: DiceInstanceState): number {
    const storedBonus = Math.max(0, this.basicAttackDamageBonusByInstance.get(attacker.instanceId) ?? 0);
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition) return storedBonus;
    const meta = getRuntimeSkillMeta(definition);
    const statusBonusRate = Math.max(0, meta.bonusDamagePerStatus ?? 0);
    if (statusBonusRate <= 0) return storedBonus;
    const statusStacks = this.getTotalStatusStackCount(attacker);
    return storedBonus + Math.floor(definition.attack * statusBonusRate * statusStacks);
  }

  private getTotalStatusStackCount(die: DiceInstanceState): number {
    return (['slow', 'poison', 'ignition', 'fracture', 'taunt', 'stun', 'hibernation', 'berserk', 'acceleration', 'dilation', 'disorientation'] as const)
      .reduce((total, effect) => total + this.getStatusStackCount(die, effect), 0);
  }

  private getGiantHunterBonus(ownerId: 'player' | 'enemy', target: DiceInstanceState, bossEffectiveness: number): number {
    const rate = this.giantHunterRateByOwner[ownerId];
    if (rate <= 0) return 0;
    const bonus = Math.max(0, Math.floor(target.maxHealth * rate));
    return this.isBossDie(target) ? Math.floor(bonus * bossEffectiveness) : bonus;
  }

  private getActiveBuffSummaryForDie(die: DiceInstanceState): string[] {
    const owner = die.ownerId;
    const pct = (rate: number) => formatPercent(rate);
    const buffs: string[] = [];
    const typeBonus = this.diceTypeUpgradeBonus.get(`${owner}:${die.typeId}`) ?? 0;
    if (typeBonus > 0) {
      const typeName = this.definitions.get(die.typeId)?.title?.replace(/\s+Dice$/i, '') ?? this.formatCombatTypeName(die.typeId);
      buffs.push(`${typeName} Upgrade +${pct(typeBonus)} dmg/HP`);
    }
    const basicAttackDamage = this.basicAttackDamageBonusByInstance.get(die.instanceId) ?? 0;
    if (basicAttackDamage > 0) buffs.push(`Basic Attack +${formatCompact(basicAttackDamage)} damage`);
    const dungeonCards = this.getDungeonCardEffectsForDie(die);
    const dungeonCardCount = this.dungeonCardState.cards.filter((card) => card.typeId === die.typeId).length;
    if (dungeonCards && dungeonCardCount > 0) {
      const parts: string[] = [];
      if (dungeonCards.healthBonusRate > 0) parts.push(`+${pct(dungeonCards.healthBonusRate)} max HP`);
      if (dungeonCards.attackBonusRate > 0) parts.push(`+${pct(dungeonCards.attackBonusRate)} damage`);
      if (dungeonCards.rangeBonus > 0) parts.push(`+${dungeonCards.rangeBonus} range`);
      if (dungeonCards.regenRate > 0) parts.push(`${pct(dungeonCards.regenRate)} max HP end-of-combat heal`);
      if (dungeonCards.manaCharge > 0) parts.push(`+${dungeonCards.manaCharge} start mana`);
      if (dungeonCards.armorReduction > 0) parts.push(`${pct(dungeonCards.armorReduction)} DR`);
      if (dungeonCards.projectileCount > 0) parts.push(`+${countNoun(dungeonCards.projectileCount, 'projectile')}`);
      if (dungeonCards.attackCount > 0) parts.push(`+${countNoun(dungeonCards.attackCount, 'attack')}`);
      if (dungeonCards.bodySides > 0) parts.push(`D${dungeonCards.bodySides} body`);
      if (dungeonCards.extraRevives > 0) parts.push(`+${dungeonCards.extraRevives} immediate revive${dungeonCards.extraRevives === 1 ? '' : 's'}`);
      if (dungeonCards.ignitionRate > 0) parts.push(`${pct(dungeonCards.ignitionRate)} max HP Ignition`);
      if (dungeonCards.undeadHealthRate > 0) parts.push(`${pct(dungeonCards.undeadHealthRate)} Zombie spawn HP`);
      if (dungeonCards.soulBonusMultiplier > 1) parts.push(`Soul Fest +${pct(dungeonCards.soulBonusMultiplier - 1)} soul bonus`);
      if (dungeonCards.reaperManaDiscount > 0) parts.push(`Reaper's Touch -${dungeonCards.reaperManaDiscount} mana (Instakill Form)`);
      if (dungeonCards.cardOrbitCount > 0) parts.push(`${countNoun(dungeonCards.cardOrbitCount, 'orbiting card')} (${pct(dungeonCards.cardOrbitDamageRate)} damage)`);
      if (dungeonCards.growthDeltaOverride > 0) parts.push(`+${dungeonCards.growthDeltaOverride} growth`);
      if (dungeonCards.acidRainTurns > 0) parts.push(`${dungeonCards.acidRainTurns}-turn Acid Rain`);
      if (dungeonCards.transformDurationBonus > 0) parts.push(`+${countNoun(dungeonCards.transformDurationBonus, 'transform turn')}`);
      if (dungeonCards.rampageSplashRate > 0) parts.push(`${pct(dungeonCards.rampageSplashRate)} Rampage splash`);
      if (dungeonCards.batteryAllyManaBonus > 0) parts.push(`+${dungeonCards.batteryAllyManaBonus} Battery ally mana`);
      if (dungeonCards.galeDurationBonus > 0) parts.push(`+${dungeonCards.galeDurationBonus} Gale turn${dungeonCards.galeDurationBonus === 1 ? '' : 's'}`);
      if (dungeonCards.temporalAccelerationCount > 0) parts.push(`Temporal Acceleration ${countNoun(dungeonCards.temporalAccelerationCount, 'attack')}`);
      if (dungeonCards.temporalDilationCount > 0) parts.push(`Temporal Dilation -${countNoun(dungeonCards.temporalDilationCount, 'attack')}`);
      const overlayLabels = new Set<string>();
      dungeonCards.skillOverlays.forEach((overlay) => {
        const modifiers = overlay.modifiers;
        if (overlay.title === 'Meteor Strike' && typeof modifiers?.meteorCount === 'number') {
          overlayLabels.add(`${Math.max(1, Math.floor(modifiers.meteorCount))}× Meteor Strike`);
        } else if (overlay.title === 'Radiant Rally' && typeof modifiers?.grantAttacksToAlly === 'number') {
          overlayLabels.add(`Radiant Rally +${Math.max(0, Math.floor(modifiers.grantAttacksToAlly))} random ally attack`);
        } else if (overlay.title === 'Chain Spark' && modifiers?.chainTargets === -1) {
          overlayLabels.add('Chain Spark uncapped');
        } else if (overlay.title === 'Gale Tempo' && typeof modifiers?.projectileCountIncrease === 'number') {
          overlayLabels.add(`Gale Tempo +${Math.max(1, Math.floor(modifiers.projectileCountIncrease))} projectiles`);
        } else if (overlay.title === 'Chill Lock' && modifiers?.hitsAllFoes === true) {
          overlayLabels.add('Chill Lock hits all foes');
        }
      });
      overlayLabels.forEach((label) => parts.push(label));
      if (dungeonCards.grantedSkills.length > 0) parts.push(dungeonCards.grantedSkills.map((skill) => skill.title).join(' / '));
      if (parts.length > 0) buffs.push(`Dungeon Cards ×${dungeonCardCount}: ${parts.join(' / ')}`);
    }
    const effectivePip = this.getEffectivePipForInvestment(die);
    const spotlight = this.spotlightByInstance.get(die.instanceId);
    if (spotlight && effectivePip === 3) buffs.push(`Spotlight +${pct(spotlight.reduction)} dmg & DR (3-pip)`);
    const odd = this.oddInvestmentByOwner[owner];
    if (effectivePip % 2 === 1 && (odd.damage > 0 || odd.reduction > 0)) buffs.push(`Odd Investment +${pct(odd.damage)} dmg / ${pct(odd.reduction)} DR (odd pips)`);
    const even = this.evenInvestmentByOwner[owner];
    if (effectivePip % 2 === 0 && (even.damage > 0 || even.reduction > 0)) buffs.push(`Even Investment +${pct(even.damage)} dmg / ${pct(even.reduction)} DR (even pips)`);
    const crowd = this.crowdAttackByOwner[owner];
    if ((effectivePip === 1 || effectivePip === 2) && (crowd.damage > 0 || crowd.reduction > 0)) buffs.push(`Crowd Attack +${pct(crowd.damage)} dmg / ${pct(crowd.reduction)} DR (1-2 pips)`);
    const fireSupport = this.fireSupportByOwner[owner];
    if (die.gridPosition) {
      const isBackline = owner === 'player' ? die.gridPosition.col === 0 : die.gridPosition.col === 4;
      if (isBackline && fireSupport > 0) buffs.push(`Fire Support +${countNoun(fireSupport, 'attack')} (backline)`);
      const vanguard = this.getVanguardReduction(die);
      if (vanguard > 0) buffs.push(`Vanguard ${pct(vanguard)} DR (frontline)`);
      const centreline = this.getCentrelineDamageBonus(die);
      if (centreline > 0) buffs.push(`Centreline +${pct(centreline)} dmg (centre)`);
    }
    if (this.fountainHealRateByOwner[owner] > 0) buffs.push(`Fountain of Love ${pct(this.fountainHealRateByOwner[owner])} max HP heal`);
    if (this.manaPotionGainByOwner[owner] > 0) buffs.push(`Mana Potion +${this.manaPotionGainByOwner[owner]} mana`);
    if (this.giantHunterRateByOwner[owner] > 0) buffs.push(`Giant Hunter ${pct(this.giantHunterRateByOwner[owner])} max HP`);
    if (this.randomModeActive && this.activeRandomModifier === 'Combanity' && !(this.activeChallenge === 'dungeon' && owner === 'enemy')) {
      const combo = this.combanityBonusByOwner[owner];
      const drNote = combo.reduction > 0 ? ` / ${pct(combo.reduction)} DR` : '';
      buffs.push(`Combanity: ${combo.label} (${combo.multiplier}x dmg${drNote})`);
    }
    const rarity = this.getDefinitionForInstance(die)?.rarity;
    const rarityRank = rarity ? DICE_RARITY_RANK[rarity] ?? 0 : 0;
    const straightFace = this.straightFaceRateByOwner[owner];
    if (straightFace > 0 && rarityRank < DICE_RARITY_RANK.Legendary) buffs.push(`Straight Face +${pct(straightFace)} dmg & max HP (below Legendary)`);
    const royalObedience = this.royalObedienceRateByOwner[owner];
    if (royalObedience > 0 && rarityRank >= DICE_RARITY_RANK.Legendary) buffs.push(`Royal Obedience +${pct(royalObedience)} dmg (Legendary+)`);
    return buffs;
  }

  private applyInfiltratorCombatStart() {
    const infiltrators = this.gameState.dice.filter((die) =>
      die.zone === 'board' && !die.isDestroyed && Boolean(die.gridPosition) && Boolean(this.getDefinitionForInstance(die))
    );
    infiltrators.forEach((infiltrator) => {
      const definition = this.getDefinitionForInstance(infiltrator);
      if (!definition) return;
      const targetBoardSide = infiltrator.ownerId === 'player' ? 'enemy' : 'player';
      const foes = this.gameState.dice.filter((die) =>
        die.zone === 'board'
        && !die.isDestroyed
        && die.ownerId !== infiltrator.ownerId
        && die.gridPosition
      );
      const occupied = new Set(
        this.gameState.dice
          .filter((die) => die.zone === 'board' && !die.isDestroyed && die.instanceId !== infiltrator.instanceId && die.gridPosition)
          .filter((die) => this.getBoardSideForDie(die) === targetBoardSide)
          .flatMap((die) => this.getFootprintCells(die).map((cell) => `${cell.row},${cell.col}`))
      );
      const classLevel = this.instanceClassLevels.get(infiltrator.instanceId) ?? 1;
      if (!getInfiltratorSkillEffect(definition, classLevel)) return;
      const passiveMeta = getRuntimeSkillMetaForTrigger(definition, 'Passive');
      const boostedAttacks = Math.max(0, Math.floor(passiveMeta.numAttacksBoosted ?? 0));
      this.assassinBoostAttacksByInstance.set(infiltrator.instanceId, boostedAttacks);
      const placement = chooseInfiltratorPlacement(
        infiltrator,
        definition,
        classLevel,
        foes,
        occupied,
        GRID_SIZE,
        (from, to) => this.getDistanceWithBoardSides(from, to),
        (die) => this.getFootprintForDie(die)
      );
      if (!placement) return;
      this.gameState = {
        ...this.gameState,
        dice: this.gameState.dice.map((die) => die.instanceId === infiltrator.instanceId
          ? { ...die, gridPosition: placement.tile }
          : die)
      };
      this.infiltratedBoardSideByInstance.set(infiltrator.instanceId, placement.targetBoardSide);
      this.writeCombatLog(`${infiltrator.ownerId === 'player' ? 'Your' : 'Enemy'} ${this.getCombatDieName(infiltrator)} infiltrates the enemy board!`);
    });
  }

  private getBoardSideForDie(die: DiceInstanceState): 'player' | 'enemy' {
    return this.infiltratedBoardSideByInstance.get(die.instanceId) ?? die.ownerId;
  }

  private getGridContainerForDie(die: DiceInstanceState): Phaser.GameObjects.Container {
    return this.getBoardSideForDie(die) === 'player' ? this.playerGridContainer : this.enemyGridContainer;
  }

  private getBoardDiceOnSide(ownerId: 'player' | 'enemy', boardSide: 'player' | 'enemy'): DiceInstanceState[] {
    return getBoardDice(this.gameState, ownerId).filter((die) => this.getBoardSideForDie(die) === boardSide);
  }

  private getLivingDiceOnBoardSide(boardSide: 'player' | 'enemy'): DiceInstanceState[] {
    return this.gameState.dice.filter((die) =>
      die.zone === 'board' &&
      !die.isDestroyed &&
      die.gridPosition &&
      this.getBoardSideForDie(die) === boardSide
    );
  }

  private areDiceOnSameBoardSide(first: DiceInstanceState, second: DiceInstanceState): boolean {
    return this.getBoardSideForDie(first) === this.getBoardSideForDie(second);
  }

  private getDistanceWithBoardSides(
    attacker: DiceInstanceState,
    target: DiceInstanceState,
    attackerFootprint = this.getFootprintForDie(attacker),
    targetFootprint = this.getFootprintForDie(target)
  ): number {
    const attackerCells = this.getFootprintCells(attacker, attacker.gridPosition, attackerFootprint);
    const targetCells = this.getFootprintCells(target, target.gridPosition, targetFootprint);
    if (attackerCells.length === 0 || targetCells.length === 0) return Number.POSITIVE_INFINITY;
    const attackerSide = this.getBoardSideForDie(attacker);
    const targetSide = this.getBoardSideForDie(target);

    if (attackerSide === targetSide) {
      return this.getFootprintColumnDistance(attacker, target, attackerFootprint, targetFootprint);
    }

    let best = Number.POSITIVE_INFINITY;
    attackerCells.forEach((attackerCell) => {
      const attackerToFrontline = attackerSide === 'player'
        ? GRID_SIZE - attackerCell.col
        : attackerCell.col + 1;
      targetCells.forEach((targetCell) => {
        const targetFromFrontline = targetSide === 'player'
          ? GRID_SIZE - targetCell.col
          : targetCell.col + 1;
        best = Math.min(best, Math.max(0, attackerToFrontline + targetFromFrontline - 1));
      });
    });
    return best;
  }

  private isOnBlockedBackline(die: DiceInstanceState): boolean {
    if (!die.gridPosition) return false;
    const boardSide = this.getBoardSideForDie(die);
    return (boardSide === 'player' && die.gridPosition.col === 0) || (boardSide === 'enemy' && die.gridPosition.col === GRID_SIZE - 1);
  }

  private getAttackDistance(
    attacker: DiceInstanceState,
    target: DiceInstanceState,
    attackerFootprint = this.getFootprintForDie(attacker),
    targetFootprint = this.getFootprintForDie(target)
  ): number {
    if (!attacker.gridPosition || !target.gridPosition) return Number.POSITIVE_INFINITY;
    if (this.infiltratedBoardSideByInstance.has(attacker.instanceId)) {
      const attackerSide = this.getBoardSideForDie(attacker);
      const targetSide = this.getBoardSideForDie(target);
      if (attackerSide !== targetSide) return Number.POSITIVE_INFINITY;
      return Math.max(1, this.getFootprintChebyshevDistance(attacker, target, attackerFootprint, targetFootprint));
    }
    return this.getDistanceWithBoardSides(attacker, target, attackerFootprint, targetFootprint);
  }

  private selectTargetCandidate(
    candidates: { die: DiceInstanceState & { gridPosition: { row: number; col: number } }; distance: number }[],
    mode: DiceTargetingMode
  ): DiceInstanceState | undefined {
    if (candidates.length === 0) return undefined;
    const byNear = [...candidates].sort((a, b) => a.distance - b.distance || a.die.gridPosition.row - b.die.gridPosition.row || a.die.gridPosition.col - b.die.gridPosition.col);
    const byFar = [...candidates].sort((a, b) => b.distance - a.distance || b.die.gridPosition.row - a.die.gridPosition.row || b.die.gridPosition.col - a.die.gridPosition.col);
    if (mode === 'Nearest') return byNear[0].die;
    if (mode === 'Furthest') return byFar[0].die;
    if (mode === 'Strongest') return [...candidates].sort((a, b) => b.die.currentHealth - a.die.currentHealth || a.distance - b.distance)[0].die;
    if (mode === 'Weakest') return [...candidates].sort((a, b) => a.die.currentHealth - b.die.currentHealth || a.distance - b.distance)[0].die;
    return securePick(candidates)!.die;
  }

  private isBlockedByAllyChain(attacker: DiceInstanceState, target: DiceInstanceState): boolean {
    const sourceId = this.chainedByInstance.get(target.instanceId);
    if (!sourceId || sourceId === attacker.instanceId) return false;
    const source = this.gameState.dice.find((die) => die.instanceId === sourceId && die.ownerId === attacker.ownerId && !die.isDestroyed);
    return Boolean(source);
  }

  private findSkillTargetForArena(
    attacker: DiceInstanceState,
    mode: DiceTargetingMode,
    onlyTargetsAllies: boolean,
    excludeInstanceIds?: ReadonlySet<string>
  ): DiceInstanceState | undefined {
    const targetOwner = onlyTargetsAllies ? attacker.ownerId : attacker.ownerId === 'player' ? 'enemy' : 'player';
    const attackerDef = this.getDefinitionForInstance(attacker);
    if (!attackerDef || !attacker.gridPosition) return undefined;
    this.avoidChanceIgnoredTargetByInstance.delete(attacker.instanceId);
    const effectiveRange = this.getEffectiveAttackRange(attacker, attackerDef);
    let ignoredTargetId: string | undefined;
    const candidates = this.gameState.dice
      .filter((die): die is DiceInstanceState & { gridPosition: { row: number; col: number } } =>
        die.ownerId === targetOwner
        && die.zone === 'board'
        && !die.isDestroyed
        && !excludeInstanceIds?.has(die.instanceId)
        && Boolean(die.gridPosition)
        && (!onlyTargetsAllies || die.currentHealth < die.maxHealth))
      .map((die) => ({ die, distance: onlyTargetsAllies ? this.getAllyHealingDistance(attacker, die) : this.getAttackDistance(attacker, die) }))
      .filter(({ die, distance }) => {
        if (distance > Math.max(1, effectiveRange)) return false;
        if (onlyTargetsAllies) return true;
        const targetDefinition = this.getDefinitionForInstance(die);
        const avoidSkill = targetDefinition
          ? getValidSkillDefinitions(targetDefinition).find((skill) => {
            const chance = skill.modifiers?.avoidAttackChance;
            return typeof chance === 'number' && Number.isFinite(chance) && chance > 0;
          })
          : undefined;
        if (!targetDefinition || !avoidSkill) return true;
        const avoidMeta = getRuntimeSkillMeta({ ...targetDefinition, skills: [avoidSkill] });
        const avoidChance = Phaser.Math.Clamp(avoidMeta.avoidAttackChance ?? 0, 0, 1);
        const avoidRange = Math.max(1, Number.isFinite(targetDefinition.range) ? targetDefinition.range : effectiveRange);
        if (distance <= avoidRange && avoidChance > 0 && secureChance(avoidChance)) {
          ignoredTargetId ??= die.instanceId;
          return false;
        }
        return true;
      });
    const selected = this.selectTargetCandidate(candidates, mode);
    if (!selected && ignoredTargetId) this.avoidChanceIgnoredTargetByInstance.set(attacker.instanceId, ignoredTargetId);
    return selected;
  }

  private findActiveHealTargetForArena(attacker: DiceInstanceState, mode: DiceTargetingMode): DiceInstanceState | undefined {
    const attackerDef = this.getDefinitionForInstance(attacker);
    if (!attackerDef || !attacker.gridPosition) return undefined;
    const effectiveRange = Math.max(1, this.getEffectiveAttackRange(attacker, attackerDef));
    const candidates = this.gameState.dice
      .filter((die): die is DiceInstanceState & { gridPosition: { row: number; col: number } } =>
        die.ownerId === attacker.ownerId
        && die.zone === 'board'
        && !die.isDestroyed
        && Boolean(die.gridPosition)
        && die.currentHealth < die.maxHealth
        && this.getAllyHealingDistance(attacker, die) <= effectiveRange)
      .map((die) => ({ die, distance: this.getAllyHealingDistance(attacker, die) }));
    if (candidates.length === 0) return undefined;
    const allyCandidates = candidates.filter(({ die }) => die.instanceId !== attacker.instanceId);
    return this.selectTargetCandidate(allyCandidates.length > 0 ? allyCandidates : candidates, mode);
  }

  private getActiveTargetForSlot(attacker: DiceInstanceState, meta: ReturnType<typeof getRuntimeSkillMeta>, forcedTarget?: DiceInstanceState): DiceInstanceState | undefined {
    const mode = meta.activeSkillTargeting ?? meta.skillTargeting ?? meta.targetingMode ?? 'Nearest';
    if (meta.skillHealing !== undefined) return this.findActiveHealTargetForArena(attacker, mode);
    if (meta.activeOnlyTargetsAllies) return this.findSkillTargetForArena(attacker, mode, true);
    const selected = this.findSkillTargetForArena(attacker, mode, false);
    return forcedTarget && this.isWithinActiveSkillReach(attacker, forcedTarget) ? forcedTarget : selected;
  }

  private isWithinActiveSkillReach(attacker: DiceInstanceState, target: DiceInstanceState): boolean {
    const attackerDef = this.getDefinitionForInstance(attacker);
    if (!attackerDef) return false;
    const effectiveRange = this.getEffectiveAttackRange(attacker, attackerDef);
    return this.getAttackDistance(attacker, target) <= Math.max(1, effectiveRange);
  }

  private activeSkillRequiresTarget(meta: ReturnType<typeof getRuntimeSkillMeta>): boolean {
    if (meta.canFireWithNoTargets) return false;
    if (meta.skillHealing !== undefined || meta.activeOnlyTargetsAllies || meta.hasPierce === true || meta.instakill) return true;
    if (meta.hitsAllFoes || meta.hitsAllAllies) return false;
    if (meta.hasSplash === true || meta.hasChain === true || meta.hasHeatwave === true) return true;
    return meta.skillDamage !== undefined
      || meta.skillDamageRate !== undefined
      || meta.skillDamageRatesByPip !== undefined
      || meta.activeStatusEffect !== undefined
      || (meta.poisonDamage !== undefined && meta.activeStatusEffect === 'poison')
      || (meta.armorShredRate !== undefined && meta.activeDurationTurns !== undefined)
      || (meta.activeAttackDelta !== undefined && meta.activeDurationTurns !== undefined);
  }

  private findAttackTargetForArena(attacker: DiceInstanceState): DiceInstanceState | undefined {
    const attackerDef = this.getDefinitionForInstance(attacker);
    if (!attackerDef || !attacker.gridPosition) return undefined;
    const mode = attackerDef.targetingMode ?? 'Nearest';
    return this.findSkillTargetForArena(attacker, mode, false);
  }

  private findChainJumpTargetForArena(
    attacker: DiceInstanceState,
    primaryTarget: DiceInstanceState,
    meta: ReturnType<typeof getRuntimeSkillMeta>,
    excludeInstanceIds?: Set<string>
  ): DiceInstanceState | undefined {
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition || !primaryTarget.gridPosition) return undefined;
    const chainRange = Math.max(1, Math.floor(
      typeof meta.chainRange === 'number' && Number.isFinite(meta.chainRange)
        ? meta.chainRange
        : (typeof definition.range === 'number' && Number.isFinite(definition.range) ? definition.range : 1)
    ));
    const boardSide = this.getBoardSideForDie(primaryTarget);
    const mode = meta.activeSkillTargeting ?? meta.skillTargeting ?? meta.targetingMode ?? definition.targetingMode ?? 'Nearest';
    const inRange = this.gameState.dice
      .filter((die): die is DiceInstanceState & { gridPosition: { row: number; col: number } } =>
        die.instanceId !== primaryTarget.instanceId
        && !excludeInstanceIds?.has(die.instanceId)
        && !this.hitDuringAttackAction.has(die.instanceId)
        && die.ownerId === primaryTarget.ownerId
        && die.zone === 'board'
        && !die.isDestroyed
        && Boolean(die.gridPosition)
        && this.getBoardSideForDie(die) === boardSide
      )
      .map((die) => ({
        die,
        ...this.getClosestFootprintOffsets(primaryTarget, die)
      }))
      .filter(({ distance }) => distance <= chainRange);

    const isRow = ({ rowOffset }: { rowOffset: number }) => rowOffset === 0;
    const isColumnOrDiagonal = ({ rowOffset, colOffset }: { rowOffset: number; colOffset: number }) =>
      rowOffset !== 0 && (colOffset === 0 || Math.abs(rowOffset) === Math.abs(colOffset));
	  
    const rowCandidates = inRange.filter(isRow);
    const candidates = (rowCandidates.length > 0 ? rowCandidates : inRange.filter(isColumnOrDiagonal))
      .map(({ die, distance }) => ({ die, distance }));
    return this.selectTargetCandidate(candidates, mode);
  }

  private getChainJumpTargetsForArena(
    attacker: DiceInstanceState,
    firstTarget: DiceInstanceState | undefined,
    meta: ReturnType<typeof getRuntimeSkillMeta>
  ): DiceInstanceState[] {
    if (!firstTarget?.gridPosition) return [];
    const limit = getChainTargetLimit(meta);
    if (limit === 0) return this.hitDuringAttackAction.has(firstTarget.instanceId) ? [] : [firstTarget];
    const maxExtraJumps = limit === CHAIN_NO_TARGET_CAP ? Number.POSITIVE_INFINITY : Math.max(0, limit - 1);
    const visited = new Set<string>([attacker.instanceId, ...this.hitDuringAttackAction]);
    const sequence: DiceInstanceState[] = [];
    let extraJumps = 0;
    let current: DiceInstanceState | undefined = firstTarget;
    while (current) {
      const isPrimary = current.instanceId === firstTarget.instanceId;
      if (!isPrimary && extraJumps >= maxExtraJumps) break;
      if (!visited.has(current.instanceId)) {
        sequence.push(current);
        visited.add(current.instanceId);
        if (!isPrimary) extraJumps += 1;
      }
      current = this.findChainJumpTargetForArena(attacker, current, meta, visited);
    }
    return sequence;
  }

  private findNearestFoeIgnoringRange(attacker: DiceInstanceState): DiceInstanceState | undefined {
    const enemyOwner = attacker.ownerId === 'player' ? 'enemy' : 'player';
    if (!attacker.gridPosition) return undefined;
    return this.gameState.dice
      .filter((die): die is DiceInstanceState & { gridPosition: { row: number; col: number } } =>
        die.ownerId === enemyOwner && die.zone === 'board' && !die.isDestroyed && Boolean(die.gridPosition))
      .map((die) => ({ die, distance: this.getDistanceWithBoardSides(attacker, die) }))
      .sort((a, b) => a.distance - b.distance || a.die.gridPosition.row - b.die.gridPosition.row || a.die.gridPosition.col - b.die.gridPosition.col)[0]?.die;
  }

  private moveDieBesideTarget(die: DiceInstanceState, target: DiceInstanceState) {
    if (!target.gridPosition) return;
    const targetBoardSide = this.getBoardSideForDie(target);
    const usedCells = this.collectOccupiedCellsOnBoardSide(targetBoardSide, die.instanceId);
    const footprint = this.getFootprintForDie(die);
    const candidates: { row: number; col: number; distance: number; rowOffset: number; colOffset: number }[] = [];
    for (let row = 0; row <= GRID_SIZE - footprint; row++) {
      for (let col = 0; col <= GRID_SIZE - footprint; col++) {
        if (!this.canPlaceFootprint(row, col, footprint, usedCells)) continue;
        const offset = this.getClosestFootprintOffsets({ ...die, gridPosition: { row, col } }, target);
        candidates.push({
          row,
          col,
          distance: offset.distance,
          rowOffset: Math.abs(offset.rowOffset),
          colOffset: Math.abs(offset.colOffset)
        });
      }
    }
    const best = candidates.sort((a, b) => a.distance - b.distance || a.rowOffset - b.rowOffset || a.colOffset - b.colOffset || a.row - b.row || a.col - b.col)[0];
    if (!best) return;
    this.gameState = placeDieOnBoard(this.gameState, die.instanceId, best.row, best.col);
    if (targetBoardSide === die.ownerId) this.infiltratedBoardSideByInstance.delete(die.instanceId);
    else this.infiltratedBoardSideByInstance.set(die.instanceId, targetBoardSide);
  }

  private resolveTauntForcedTarget(attacker: DiceInstanceState): DiceInstanceState | undefined {
    const taunt = this.statusEffects.getTaunt(attacker.instanceId);
    if (!taunt) return undefined;
    const shield = this.gameState.dice.find((d) => d.instanceId === taunt.sourceId && d.zone === 'board' && !d.isDestroyed && d.gridPosition);
    if (!shield || !shield.gridPosition || !attacker.gridPosition) return undefined;
    const distance = this.getDistanceWithBoardSides(attacker, shield);
    const shieldDef = this.getDefinitionForInstance(shield);
    const tauntRange = shieldDef ? getRuntimeSkillMeta(shieldDef).tauntRange ?? 2 : 2;
    return distance <= tauntRange && !this.isBlockedByAllyChain(attacker, shield) ? shield : undefined;
  }

  private poolAffectsDie(pool: DicePoolInstance, die: DiceInstanceState): boolean {
    if (pool.affects === 'both') return true;
    if (pool.affects === 'allies') return die.ownerId === pool.sourceOwnerId;
    return die.ownerId !== pool.sourceOwnerId;
  }

  private spawnPools(
    source: DiceInstanceState,
    poolType: string | undefined,
    boardSide: 'player' | 'enemy',
    origin: { row: number; col: number },
    pattern?: Array<[number, number]>,
    duration?: number
  ): void {
    const definition = getPoolDefinition(this, poolType);
    if (!definition) return;
    const sourceDefinition = this.getDefinitionForInstance(source);
    const classLevel = this.instanceClassLevels.get(source.instanceId) ?? 1;
    const poolDamage = resolvePoolDamage(definition.damage, classLevel, sourceDefinition?.isBoss === true);
    const turns = Math.max(0, Math.floor(duration ?? definition.duration ?? 1));
    if (turns <= 0) return;
    const offsets = pattern?.length ? pattern : definition.pattern?.length ? definition.pattern : [[0, 0]] as Array<[number, number]>;
    const accent = Phaser.Display.Color.HexStringToColor(definition.accent ?? '#ff4500').color;
    for (const [rowOffset, colOffset] of offsets) {
      if (!Array.isArray([rowOffset, colOffset]) || !Number.isFinite(rowOffset) || !Number.isFinite(colOffset)) continue;
      const row = origin.row + Math.trunc(rowOffset);
      const col = origin.col + Math.trunc(colOffset);
      if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) continue;
      this.poolsByTile.set(`${boardSide}:${row},${col}`, {
        typeId: definition.typeId,
        title: definition.title,
        damage: poolDamage,
        turns,
        sourceOwnerId: source.ownerId,
        sourceTypeId: source.typeId,
        sourceInstanceId: source.instanceId,
        statusEffect: definition.statusEffect,
        statusDuration: definition.statusDuration,
        maxStacks: definition.maxStacks,
        lingerSfx: definition.lingerSfx,
        affects: definition.affects ?? 'foes',
        accent
      });
    }
  }

  private async applyPoolEffectsAtCombatStart() {
    if (this.poolsByTile.size === 0) return;
    const allBoardDice = this.gameState.dice.filter((die) => die.zone === 'board' && !die.isDestroyed && die.gridPosition);
    for (const die of allBoardDice) {
      const matchingPools = this.getFootprintCellKeys(die)
        .map((tileKey) => this.poolsByTile.get(tileKey))
        .filter((candidate): candidate is DicePoolInstance => Boolean(candidate && this.poolAffectsDie(candidate, die)));
      if (matchingPools.length === 0) continue;

      const groupedPools = new Map<string, DicePoolInstance[]>();
      for (const pool of matchingPools) {
        const group = groupedPools.get(pool.typeId) ?? [];
        group.push(pool);
        groupedPools.set(pool.typeId, group);
      }

      for (const pools of groupedPools.values()) {
        const pool = pools[0];
        if (pool.lingerSfx) AudioManager.playSfx(this, pool.lingerSfx);
        const liveSource = pool.sourceInstanceId
          ? this.gameState.dice.find((candidate) => candidate.instanceId === pool.sourceInstanceId && !candidate.isDestroyed)
          : undefined;
        const sourceProxy: DiceInstanceState = liveSource ?? {
          ...die,
          instanceId: pool.sourceInstanceId ?? `pool-${pool.typeId}`,
          ownerId: pool.sourceOwnerId,
          typeId: pool.sourceTypeId
        };
        const poolMultiplier = resolveStatMultiplier(this.getCombanityDamageMultiplier(sourceProxy, die))
          * resolveStatMultiplier(this.getDiceCardSkillDamageMultiplier(sourceProxy));
        let ticks = 0;
        let totalDealt = 0;
        let totalAbsorbed = 0;
        for (const tickPool of pools) {
          const currentDie = this.gameState.dice.find((candidate) => candidate.instanceId === die.instanceId);
          const storedDamage = resolveStatValue(tickPool.damage, 0);
          if (!currentDie || currentDie.isDestroyed || storedDamage <= 0) continue;
          const finalDamage = Math.max(1, Math.floor(storedDamage * poolMultiplier));
          const poolHit = this.applyDamageWithRevive(die.instanceId, finalDamage, { source: sourceProxy, allowGlobalCrit: false });
          this.gameState = poolHit.state;
          this.showDamageText(die, poolHit.dealt, '#ff9f58');
          await this.applyDamageDefeatHooks(sourceProxy, die, poolHit.defeated || poolHit.killed);
          ticks += 1;
          totalDealt += poolHit.dealt;
          totalAbsorbed += poolHit.absorbed;
        }
        const totalHit = { dealt: totalDealt, absorbed: totalAbsorbed };
        if (ticks > 1) {
          this.writeCombatLog(`${this.getQualifiedCombatDieName(die)} takes ${ticks} ticks of ${pool.title} damage!`);
          this.addCombatActionDetail(`${pool.title} hit ${this.getCombatDieName(die)} for ${this.formatDamageFeedback(totalHit)} over ${ticks} ticks`);
        } else if (ticks === 1) {
          this.writeCombatLog(`${this.getQualifiedCombatDieName(die)} takes ${this.formatDamageFeedback(totalHit)} ${pool.title} damage from the pool!`);
          this.addCombatActionDetail(`${pool.title} hit ${this.getCombatDieName(die)} for ${this.formatDamageFeedback(totalHit)}`);
        }
        const currentDie = this.gameState.dice.find((candidate) => candidate.instanceId === die.instanceId);
        if (currentDie && !currentDie.isDestroyed && pool.statusEffect) {
          this.applyStatusApplications([{
            source: liveSource ?? sourceProxy,
            target: currentDie,
            effect: pool.statusEffect,
            duration: pool.statusDuration ?? 1,
            damage: pool.statusEffect === 'poison' ? Math.max(1, pool.damage) : undefined,
            delta: pool.statusEffect === 'slow' ? -1 : undefined,
            rate: pool.statusEffect === 'fracture' ? 0.1 : undefined,
            maxStacks: pool.maxStacks
          }]);
        }
        const ignitionSource = liveSource ?? sourceProxy;
        const ignitionRate = pool.typeId === 'Lava' && pool.sourceTypeId === 'Meteor'
          ? this.getDungeonCardEffectsForDie(ignitionSource)?.ignitionRate ?? 0
          : 0;
        if (ignitionRate > 0 && currentDie && !currentDie.isDestroyed) {
          this.applyStatusApplications([{
            source: ignitionSource,
            target: currentDie,
            effect: 'ignition',
            duration: DUNGEON_IGNITION_DURATION,
            rate: ignitionRate
          }]);
        }
      }
    }
  }

  private renderPools() {
    const removeOld = (container: Phaser.GameObjects.Container) => {
      const toRemove: Phaser.GameObjects.GameObject[] = [];
      container.each((child: Phaser.GameObjects.GameObject) => {
        if (child.name === 'pool' || child.name === 'lava-pool') toRemove.push(child);
      });
      toRemove.forEach((child) => child.destroy());
    };
    removeOld(this.playerGridContainer);
    removeOld(this.enemyGridContainer);

    this.poolsByTile.forEach((pool, key) => {
      const [ownerId, coordinates] = key.split(':');
      if (!coordinates) return;
      const [rowText, colText] = coordinates.split(',');
      const row = Number(rowText);
      const col = Number(colText);
      if (!Number.isFinite(row) || !Number.isFinite(col)) return;
      const container = ownerId === 'player' ? this.playerGridContainer : this.enemyGridContainer;
      const tileX = col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
      const tileY = row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
      const accent = Number.isFinite(pool.accent) ? pool.accent : 0xff4500;
      const accentText = `#${accent.toString(16).padStart(6, '0')}`;

      const graphics = this.add.graphics();
      graphics.name = 'pool';
      graphics.fillStyle(accent, 0.45);
      graphics.fillRoundedRect(tileX - TILE_SIZE / 2 + 4, tileY - TILE_SIZE / 2 + 4, TILE_SIZE - 8, TILE_SIZE - 8, 4);
      graphics.lineStyle(2, accent, 0.85);
      graphics.strokeRoundedRect(tileX - TILE_SIZE / 2 + 4, tileY - TILE_SIZE / 2 + 4, TILE_SIZE - 8, TILE_SIZE - 8, 4);
      container.add(graphics);
      this.tweens.add({ targets: graphics, alpha: 0.35, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.InOut' });

      const turnLabel = this.add.text(tileX, tileY + TILE_SIZE / 2 - 10, `${pool.turns}T`, {
        fontFamily: 'Orbitron', fontSize: '9px', color: accentText
      }).setOrigin(0.5);
      turnLabel.setName('pool');
      container.add(turnLabel);
    });
  }

  private forceCombatResolutionState() {
    this.gameState = {
      ...this.gameState,
      dice: this.gameState.dice.map((die) => (
        die.zone === 'board' && !die.isDestroyed
          ? { ...die, hasFinishedAttacking: true, attacksRemaining: 0 }
          : die
      ))
    };
  }

  private async runCombatLoop() {
    this.combatTimeRemainingMs = COMBAT_TIME_LIMIT_MS;
    this.combatCountdownTriggered = false;
    this.updateCombatTimerUi();
    this.syncMusicEffects();
    const owners: Array<'player' | 'enemy'> = ['player', 'enemy'];
    const openingOwners: Array<'player' | 'enemy'> = ['player', 'enemy'];
    for (const openingOwner of openingOwners) {
      while (true) {
        const assassin = this.gameState.dice.find((die) => {
          if (die.ownerId !== openingOwner || die.zone !== 'board' || die.isDestroyed || die.hasFinishedAttacking) return false;
          if ((die.attacksRemaining ?? 0) <= 0 || !die.gridPosition) return false;
          if (this.getActiveLockSource(die)) return false;
          return this.hasStrikeFirstSkill(this.getDefinitionForInstance(die), die);
        });
        if (!assassin) break;
        const target = this.findAttackTargetForArena(assassin);
        if (!target) {
          this.gameState = {
            ...this.gameState,
            dice: this.gameState.dice.map((die) => die.instanceId === assassin.instanceId ? { ...die, attacksRemaining: 0, hasFinishedAttacking: true } : die)
          };
          continue;
        }
        const defs = this.getDefinitionsForCombat(assassin, target);
        const rawResult = executeAttack(this.gameState, assassin.instanceId, target.instanceId, defs, {
          attacker: this.getDefinitionForInstance(assassin),
          target: this.getDefinitionForInstance(target)
        });
        const multiplier = this.getCombanityDamageMultiplier(assassin, target);
        const solitudeBonus = this.getSolitudeBasicAttackBonus(assassin, target);
        const offenseMult = this.getOffenseMultiplier(assassin);
        const attackerMeta = getRuntimeSkillMeta(this.getDefinitionForInstance(assassin)!);
        const ironRate = attackerMeta?.targetCurrentHpBonusRate ?? 0;
        const ironBaseBonus = Math.max(0, Math.floor(target.currentHealth * ironRate));
        const ironBonus = this.isBossDie(target) ? Math.floor(ironBaseBonus * 0.25) : ironBaseBonus;
        const nonProportional = Math.max(1, rawResult.damage - ironBaseBonus);
        const scaledNonProportional = Math.floor(nonProportional * multiplier);
        const basicDamageBonus = this.getBasicAttackDamageBonus(assassin);
        const giantHunter = this.getGiantHunterBonus(assassin.ownerId, target, 0.25);
        const executionBoost = getExecutionRhythmBoost({
          remaining: this.assassinBoostAttacksByInstance.get(assassin.instanceId) ?? 0,
          damageMultiplier: attackerMeta.numAttacksDamageMult
        });
        const proportionalDamage = ironBonus + solitudeBonus + giantHunter;
        const adjustedDamage = Math.max(1, Math.floor((scaledNonProportional + basicDamageBonus) * offenseMult * this.getDungeonCardAttackMultiplier(assassin) * executionBoost.multiplier) + proportionalDamage);
        const projectileCount = this.spendBasicAttack(assassin);
        let totalDealt = 0;
        let totalAbsorbed = 0;
        let anyCritical = false;
        for (let projectileIndex = 0; projectileIndex < projectileCount; projectileIndex++) {
          const projectileTarget = this.gameState.dice.find((die) => die.instanceId === target.instanceId && !die.isDestroyed);
          if (!projectileTarget) break;
          const hit = this.applyDamageWithRevive(projectileTarget.instanceId, adjustedDamage, { proportionalDamage, source: assassin });
          this.gameState = hit.state;
          totalDealt += hit.dealt;
          totalAbsorbed += hit.absorbed;
          anyCritical = anyCritical || hit.critical;
          this.showDamageText(projectileTarget, hit.dealt, hit.critical ? '#ff3333' : this.statusEffects.hasFracture(projectileTarget.instanceId) ? '#ff4fd8' : '#ffdf7a');
          await this.applyPassiveSkillEffects(assassin, projectileTarget);
          await this.applyDamageDefeatHooks(assassin, projectileTarget, hit.defeated || hit.killed);
          if (hit.defeated || hit.killed) break;
        }
        if (executionBoost.consume) {
          const remainingBoost = this.assassinBoostAttacksByInstance.get(assassin.instanceId) ?? 0;
          if (remainingBoost > 0) this.assassinBoostAttacksByInstance.set(assassin.instanceId, remainingBoost - 1);
        }
        const projectileFeedback = projectileCount >= 2 ? ` ${projectileCount} times` : '';
        const shieldFeedback = totalAbsorbed > 0 ? ` (shield absorbed ${formatCompact(totalAbsorbed)} damage)` : '';
        this.writeCombatLog(`${openingOwner === 'player' ? 'Your' : 'Enemy'} ${this.getCombatDieName(assassin)} strikes ${this.getCombatDieName(target)} first${projectileFeedback} for ${formatCombatAmount(totalDealt, anyCritical, 'damage')}${shieldFeedback}!`);
        this.renderDice();
        this.renderEnemyDice();
        if (!(await this.delayCombatPaced(350))) return;
        if (await this.resolveCombatWin()) return;
      }
    }

    let timedOut = false;
    while (true) {
        if (this.combatTimeRemainingMs <= 0) {
          timedOut = true;
          break;
        }

        const attacker = this.getNextCombatAttacker(owners);
        if (!attacker) break;
        this.hitDuringAttackAction.clear();
        const ownerName = attacker.ownerId === 'player' ? 'Your' : 'Enemy';

        const attackerDef = this.getDefinitionForInstance(attacker);
        const attackerMeta = attackerDef ? getRuntimeSkillMeta(attackerDef) : undefined;
        const teleportTrigger = attackerDef
          ? getValidSkillDefinitions(attackerDef)
            .map((skill, index) => ({ skill, index, fireIndex: skill.modifiers?.teleportSkillFireIndex }))
            .find(({ fireIndex }) => typeof fireIndex === 'number' && Number.isInteger(fireIndex) && fireIndex >= 0)
          : undefined;
        const teleportSkillFireIndex = teleportTrigger?.fireIndex;
        const teleportTriggerMeta = attackerDef && teleportTrigger
          ? getRuntimeSkillMetaForTrigger(attackerDef, teleportTrigger.skill.type, teleportTrigger.index)
          : undefined;
        const getChargedActiveSlot = () => {
          const activeSlots = this.getActiveManaSlots(attacker)
            .map((slot) => ({ ...slot, mana: this.getActiveMana(attacker.instanceId, slot.key), meta: this.getActiveSkillMetaForSlot(attacker, slot) }));
          const meteorSlot = activeSlots.find((slot) => slot.meta?.hasMeteor === true && (slot.meta?.meteorDamage !== undefined || slot.meta?.meteorCount !== undefined));
          const instakillSlot = activeSlots.find((slot) => slot.meta?.instakill === true);
          const primarySlot = activeSlots.find((slot) => this.canActiveSlotFire(attacker, slot, slot.meta));
          const meteorFires = Boolean(meteorSlot && this.canActiveSlotFire(attacker, meteorSlot, meteorSlot.meta));
          const instakillFires = Boolean(instakillSlot && this.canActiveSlotFire(attacker, instakillSlot, instakillSlot.meta));
          const regularActiveFires = Boolean(primarySlot && !meteorFires && !instakillFires);
          return meteorFires ? meteorSlot : instakillFires ? instakillSlot : regularActiveFires ? primarySlot : undefined;
        };
        const forcedTarget = this.resolveTauntForcedTarget(attacker);
        let activeSlot = getChargedActiveSlot();
        let activeTarget: DiceInstanceState | undefined;
        let unavailableActiveTitle: string | undefined;
        if (activeSlot) {
          const meta = this.getActiveSkillMetaForSlot(attacker, activeSlot);
          activeTarget = this.getActiveTargetForSlot(attacker, meta, forcedTarget);
          if (!activeTarget && meta && this.activeSkillRequiresTarget(meta)) {
            if (meta.skillHealing === undefined) unavailableActiveTitle = activeSlot.title;
            activeSlot = undefined;
          }
        }
        const activeSlotMeta = activeSlot ? this.getActiveSkillMetaForSlot(attacker, activeSlot) : undefined;
        const anyActiveFires = Boolean(activeSlot);
        const skipBasicAttack = anyActiveFires;
        if (unavailableActiveTitle && teleportSkillFireIndex === undefined) {
          this.gameState = {
            ...this.gameState,
            dice: this.gameState.dice.map((die) => die.instanceId === attacker.instanceId
              ? { ...die, attacksRemaining: 0, hasFinishedAttacking: true }
              : die)
          };
          const targetMessage = 'a valid target';
          this.addCombatActionDetail(`${unavailableActiveTitle} cannot find ${targetMessage}.`);
          this.writeCombatLog(`${ownerName} ${this.getCombatDieName(attacker)} cannot find ${targetMessage} for ${unavailableActiveTitle} and skips!`);
          this.renderDice();
          this.renderEnemyDice();
          if (!(await this.delayCombatPaced(500))) {
            timedOut = true;
            break;
          }
          continue;
        }
        const lockSource = this.getActiveLockSource(attacker);
        if (lockSource) {
          this.gameState = {
            ...this.gameState,
            dice: this.gameState.dice.map((die) => die.instanceId === attacker.instanceId ? { ...die, attacksRemaining: 0, hasFinishedAttacking: true } : die)
          };
          this.writeCombatLog(`${ownerName} ${this.getCombatDieName(attacker)} is chained by ${this.getCombatDieName(lockSource)} and skips!`);
          this.renderDice();
          this.renderEnemyDice();
          if (!(await this.delayCombatPaced(500))) {
            timedOut = true;
            break;
          }
          continue;
        }
        const beamLine = this.findTranscendenceBeamTarget(attacker, forcedTarget);
        const beamTarget = beamLine?.target;
        let target = forcedTarget ?? beamTarget ?? (attackerMeta?.healOnAttack
          ? this.findSkillTargetForArena(attacker, attackerMeta.skillTargeting ?? attackerMeta.targetingMode ?? 'Weakest', true)
          : this.findAttackTargetForArena(attacker));
        if (activeTarget) target = activeTarget;
        const scopePlan = !activeSlot && !beamTarget && !attackerMeta?.healOnAttack
          ? this.getDungeonScopeShotPlan(attacker)
          : null;
        if (scopePlan) target = scopePlan.target;
        if (!target && !activeSlot) {
          const passiveMeta = attackerDef ? getRuntimeSkillMetaForTrigger(attackerDef, 'Passive') : undefined;
          if (passiveMeta?.canFireWithNoTargets) {
            await this.applyPassiveSkillEffects(attacker);
          }
          if (teleportSkillFireIndex !== undefined && teleportTriggerMeta) {
            const roarTarget = this.findNearestFoeIgnoringRange(attacker);
            if (roarTarget) {
              this.moveDieBesideTarget(attacker, roarTarget);
              AudioManager.playSfx(this, AUDIO_KEYS.leonMightyRoar);
              const movedLeon = this.gameState.dice.find((die) => die.instanceId === attacker.instanceId) ?? attacker;
              await this.applyTeleportSkillEffect(movedLeon, roarTarget, teleportSkillFireIndex);
              const stunDuration = getStatusEffectDurationFromModifiers(
                getValidSkillDefinitions(attackerDef!)[teleportSkillFireIndex]?.modifiers,
                'stun'
              ) ?? teleportTriggerMeta.statusDuration;
              if (teleportTriggerMeta.statusEffect === 'stun' || stunDuration !== undefined) {
                this.statusEffects.applyStun(roarTarget.instanceId, this.getSkillDurationTurns(stunDuration) ?? 1);
                this.writeStatusApplicationFeedback(attacker, roarTarget, 'stun');
              }
              this.gameState = spendAttack(this.gameState, attacker.instanceId);
              this.writeCombatLog(`${ownerName} ${this.getCombatDieName(attacker)} teleports beside ${this.getCombatDieName(roarTarget)} and fires ${getValidSkillDefinitions(attackerDef!)[teleportSkillFireIndex]?.title ?? 'its teleport skill'}!`);
              this.renderDice();
              this.renderEnemyDice();
              if (!(await this.delayCombatPaced(500))) {
                timedOut = true;
                break;
              }
              if (await this.resolveCombatWin()) return;
              continue;
            }
          }
          if (attackerMeta?.healOnAttack && !this.healingRetryReadyByInstance.has(attacker.instanceId)) {
            this.healingWaitByInstance.add(attacker.instanceId);
            this.addCombatActionDetail('Druidic Essence is holding its attack until an ally needs healing.');
            this.writeCombatLog(`${ownerName} ${this.getCombatDieName(attacker)} holds its attack until a damaged ally is available.`);
            this.renderDice();
            this.renderEnemyDice();
            if (!(await this.delayCombatPaced(300))) {
              timedOut = true;
              break;
            }
            continue;
          }
          this.healingRetryReadyByInstance.delete(attacker.instanceId);
          const ignoredAvoidTargetId = this.avoidChanceIgnoredTargetByInstance.get(attacker.instanceId);
          const ignoredAvoidTarget = ignoredAvoidTargetId
            ? this.gameState.dice.find((die) => die.instanceId === ignoredAvoidTargetId)
            : undefined;
          this.gameState = {
            ...this.gameState,
            dice: this.gameState.dice.map((die) => die.instanceId === attacker.instanceId ? { ...die, attacksRemaining: 0, hasFinishedAttacking: true } : die)
          };
          if (ignoredAvoidTarget) {
            const avoiderDefinition = this.getDefinitionForInstance(ignoredAvoidTarget);
            const avoidSkill = avoiderDefinition
              ? getValidSkillDefinitions(avoiderDefinition).find((skill) => {
                const chance = skill.modifiers?.avoidAttackChance;
                return typeof chance === 'number' && Number.isFinite(chance) && chance > 0;
              })
              : undefined;
            const avoiderName = this.getCombatDieName(ignoredAvoidTarget);
            const avoidSkillTitle = avoidSkill?.title ?? 'avoidance skill';
            this.addCombatActionDetail(`👁️ ${avoidSkillTitle}: ${this.getCombatDieName(attacker)} ignored ${avoiderName}.`);
            this.writeCombatLog(`👁️ ${ownerName} ${this.getCombatDieName(attacker)} ignored its attack on ${avoiderName} because ${avoiderName}'s ${avoidSkillTitle} triggered.`);
          } else {
            this.writeCombatLog(attackerMeta?.healOnAttack
              ? `${ownerName} ${this.getCombatDieName(attacker)} has no damaged ally in range and skips!`
              : `${ownerName} ${this.getCombatDieName(attacker)} is out of range and skips!`);
          }
          if (!(await this.delayCombatPaced(500))) {
            timedOut = true;
            break;
          }
          continue;
        }

         this.combatActionDetails = [];
         let damage = 0;
        let damageAbsorbed = 0;
        let targetDefeated = false;
        let didPerformBasicAction = false;
        let basicAttackVisualCount = 1;
        let basicAttackHitCount = 1;
        let basicAttackCritical = false;
        let basicHealCritical = false;
        let basicHealPrimaryTargetId: string | undefined;
        let basicHealAggregate = false;
        let basicDamageAggregate = false;
        let scopeShotPerformed = false;
        let basicAttackTargetCount = 1;
        let ricochetDealt = 0;
        let ricochetAbsorbed = 0;
        let ricochetCritical = false;

        if (!skipBasicAttack) {
          if (beamLine && (!forcedTarget || forcedTarget.instanceId === beamLine.target.instanceId)) {
            this.playAttackSfx(attacker);
            const result = await this.executeTranscendenceBeam(attacker, target, beamLine.pattern);
            damage = result.damage;
            targetDefeated = result.targetDestroyed;
            didPerformBasicAction = true;
          } else {
            this.playAttackSfx(attacker);
            if (attackerMeta?.healOnAttack) {
              const healProjectiles = this.spendBasicAttack(attacker);
              damage = 0;
              basicAttackHitCount = 0;
              let healCritical = false;
              let primaryHealed = 0;
              let ricochetHealed = 0;
              const healAffectedIds = new Set<string>();
              const healDetails: string[] = [];
              for (let projectileIndex = 0; projectileIndex < healProjectiles; projectileIndex++) {
                const healed = this.applyBasicHeal(attacker, attackerMeta);
                if (healed.healed <= 0) break;
                if (healed.critical) healCritical = true;
                basicHealPrimaryTargetId ??= healed.primaryTargetId;
                basicAttackHitCount += 1;
                primaryHealed += healed.healed;
                ricochetHealed += healed.ricochetHealed;
                healed.affectedIds.forEach((instanceId) => healAffectedIds.add(instanceId));
                healDetails.push(...healed.details);
              }
              basicHealAggregate = healAffectedIds.size > 2;
              this.combatActionDetails.push(...healDetails);
              damage = basicHealAggregate ? primaryHealed + ricochetHealed : primaryHealed;
              basicHealCritical = healCritical;
              didPerformBasicAction = damage > 0;
            } else {
            const defs = this.getDefinitionsForCombat(attacker, target);
            const rawResult = executeAttack(this.gameState, attacker.instanceId, target.instanceId, defs, {
              attacker: this.getDefinitionForInstance(attacker),
              target: this.getDefinitionForInstance(target)
            });
            const multiplier = this.getCombanityDamageMultiplier(attacker, target);
            const solitudeBonus = this.getSolitudeBasicAttackBonus(attacker, target);
            const offenseMult = this.getOffenseMultiplier(attacker);
            const ironRate = attackerMeta?.targetCurrentHpBonusRate ?? 0;
            const ironBaseBonus = Math.max(0, Math.floor(target.currentHealth * ironRate));
            const ironBonus = this.isBossDie(target) ? Math.floor(ironBaseBonus * 0.25) : ironBaseBonus;
            const nonProportional = Math.max(1, rawResult.damage - ironBaseBonus);
            const scaledNonProportional = Math.floor(nonProportional * multiplier);
            const basicDamageBonus = this.getBasicAttackDamageBonus(attacker);
            const giantHunter = this.getGiantHunterBonus(attacker.ownerId, target, 0.25);
            const executionBoost = getExecutionRhythmBoost({
              remaining: this.assassinBoostAttacksByInstance.get(attacker.instanceId) ?? 0,
              damageMultiplier: attackerMeta?.numAttacksDamageMult
            });
            const pips = attacker.ownerId === 'player' ? (this.dicePips.get(attacker.instanceId) ?? 1) : (this.enemyDicePips.get(attacker.instanceId) ?? 1);
            const pipDamageRate = pips % 2 === 0
              ? (attackerMeta?.evenPipDamageRate ?? 0)
              : (attackerMeta?.oddPipDamageRate ?? 0);
            const pipDamageMult = 1 + Math.max(0, pipDamageRate);
            const pipSiphonRate = pips % 2 === 0
              ? (attackerMeta?.evenPipSiphonRate ?? 0)
              : (attackerMeta?.oddPipSiphonRate ?? 0);
            const lowHpExploitMult = target.currentHealth < target.maxHealth * (attackerMeta?.lowHpThresholdRate ?? 0)
              ? 1 + (attackerMeta?.lowHpDamageBonusRate ?? 0)
              : 1;
            const gatedAttackerMeta = attackerMeta
              ? gateMetaByRangeThreshold(
                attackerMeta,
                isRangeThresholdSatisfied(attackerMeta, this.getAttackDistance(attacker, target), this.getEffectiveAttackRange(attacker, attackerDef))
              )
              : undefined;
            const criticalChance = gatedAttackerMeta?.criticalChanceIncrease ?? 0;
            const criticalDamageMultiplier = 2 + (gatedAttackerMeta?.criticalDamageIncrease ?? 0);
            const bearCrit = secureChance(this.getCriticalChance(criticalChance, true, attacker));
            const bearCritMult = bearCrit ? criticalDamageMultiplier : 1;
             const proportionalDamage = ironBonus + solitudeBonus + giantHunter;
             const adjustedDamage = Math.max(1, Math.floor((scaledNonProportional + basicDamageBonus) * offenseMult * this.getDungeonCardAttackMultiplier(attacker) * executionBoost.multiplier * pipDamageMult * lowHpExploitMult * bearCritMult) + proportionalDamage);
            if (adjustedDamage > 200) AchievementStore.unlock(this, 'lotta_damage');
            const projectileCount = this.spendBasicAttack(attacker);
            damage = 0;
            basicAttackHitCount = 0;
            const acquireTarget = !scopePlan
              && attackerMeta?.acquireTarget === true
              && projectileCount > 2
              && !forcedTarget;
            const acquiredTargetIds = new Set<string>();
            if (scopePlan) {
              const scopeShot = await this.executeDungeonScopeShot(attacker, target, adjustedDamage, scopePlan.meta);
              damage = scopeShot.dealt;
              damageAbsorbed = scopeShot.absorbed;
              targetDefeated = scopeShot.defeated;
              basicAttackHitCount = 1;
              basicAttackVisualCount = 1;
              scopeShotPerformed = true;
            } else {
              let projectileTarget = target;
              for (let projectileIndex = 0; projectileIndex < projectileCount; projectileIndex++) {
                if (acquireTarget && projectileIndex > 0) {
                  const mode = attackerDef?.targetingMode ?? 'Nearest';
                  let nextTarget = this.findSkillTargetForArena(attacker, mode, false, acquiredTargetIds);
                  if (!nextTarget) {
                    acquiredTargetIds.clear();
                    nextTarget = this.findSkillTargetForArena(attacker, mode, false);
                  }
                  if (!nextTarget) break;
                  projectileTarget = nextTarget;
                }
                const liveProjectileTarget = this.gameState.dice.find((die) =>
                  die.instanceId === projectileTarget.instanceId && !die.isDestroyed
                );
                if (!liveProjectileTarget) {
                  if (acquireTarget) continue;
                  break;
                }
                if (acquireTarget) acquiredTargetIds.add(liveProjectileTarget.instanceId);
                const hit = this.applyDamageWithRevive(liveProjectileTarget.instanceId, adjustedDamage, {
                  allowGlobalCrit: false,
                  proportionalDamage,
                  source: attacker
                });
                basicAttackHitCount += 1;
                this.gameState = hit.state;
                damage += hit.dealt;
                damageAbsorbed += hit.absorbed;
                if (bearCritMult > 1 || hit.critical) basicAttackCritical = true;
                if (damage > 200) AchievementStore.unlock(this, 'lotta_damage');
                targetDefeated = hit.defeated || hit.killed;
                this.showDamageText(liveProjectileTarget, hit.dealt, bearCritMult > 1 || hit.critical ? '#ff3333' : this.statusEffects.hasFracture(liveProjectileTarget.instanceId) ? '#ff4fd8' : '#ffdf7a');
                if (pipSiphonRate > 0) this.healDie(attacker.instanceId, Math.floor(hit.appliedDealt * pipSiphonRate), attacker);
                await this.applyPassiveSkillEffects(attacker, liveProjectileTarget);
                await this.applyDamageDefeatHooks(attacker, liveProjectileTarget, targetDefeated);
                if (targetDefeated && !acquireTarget) break;
              }
            }
            if (executionBoost.consume) {
              const remainingBoost = this.assassinBoostAttacksByInstance.get(attacker.instanceId) ?? 0;
              if (remainingBoost > 0) this.assassinBoostAttacksByInstance.set(attacker.instanceId, remainingBoost - 1);
            }
            const rampageRate = this.getDungeonCardEffectsForDie(attacker)?.rampageSplashRate ?? 0;
            if (!scopeShotPerformed && rampageRate > 0 && this.isBerserkActive(attacker)) {
              const splashSource = this.gameState.dice.find((die) => die.instanceId === target.instanceId) ?? target;
              const splashTargets = this.getFootprintTargetsWithin(
                splashSource,
                this.gameState.dice.filter((die) => die.ownerId !== attacker.ownerId && die.zone === 'board' && !die.isDestroyed),
                1
              );
              for (const victim of splashTargets) {
                const splashHit = this.applyDamageWithRevive(victim.instanceId, Math.max(1, Math.floor(adjustedDamage * rampageRate)), { source: attacker, allowGlobalCrit: false });
                this.gameState = splashHit.state;
                this.showDamageText(victim, splashHit.dealt, '#ff9f58');
                await this.applyDamageDefeatHooks(attacker, victim, splashHit.defeated || splashHit.killed);
                this.addCombatActionDetail(`Rampage splash hit ${this.getCombatDieName(victim)} for ${this.formatDamageFeedback(splashHit)}`);
              }
            }
            const damageAffectedIds = new Set<string>(acquireTarget ? acquiredTargetIds : [target.instanceId]);
            basicAttackTargetCount = damageAffectedIds.size;
            if (!scopeShotPerformed && attackerMeta?.hasRicochet === true) {
              const ricochet = await this.applyBasicRicochet(attacker, target, attackerMeta, Math.max(1, Math.floor(adjustedDamage)));
              ricochetDealt = ricochet.dealt;
              ricochetAbsorbed = ricochet.absorbed;
              ricochetCritical = ricochet.critical;
              ricochet.affectedIds.forEach((instanceId) => damageAffectedIds.add(instanceId));
              this.combatActionDetails.push(...ricochet.details);
            }
            basicDamageAggregate = damageAffectedIds.size > 2;
            if (basicDamageAggregate) {
              damage += ricochetDealt;
              damageAbsorbed += ricochetAbsorbed;
            }
            didPerformBasicAction = true;
            basicAttackVisualCount = Math.max(basicAttackVisualCount, basicAttackHitCount);
            }
          }
        } else if ((activeSlotMeta?.consumeAttack ?? attackerMeta?.consumeAttack ?? true) !== false) {
          this.gameState = spendAttack(this.gameState, attacker.instanceId);
        }

        if (didPerformBasicAction) {
          this.addManaToAllActiveSlots(attacker);
        }

        if (anyActiveFires && activeSlotMeta?.hasLock !== true) {
          const sfxKey = attacker.typeId === 'Death' && activeSlotMeta?.instakill === true
            ? AUDIO_KEYS.deathInstakill
            : activeSlotMeta?.activeSkillSfxKey ?? activeSlotMeta?.skillSfxKey ?? AUDIO_KEYS.skillTrigger;
          AudioManager.playSfx(this, sfxKey);
        }
        if (activeSlot) await this.applyActiveSkillEffects(attacker, target, activeSlot);
        if (this.combatTimeRemainingMs <= 0) {
          timedOut = true;
          break;
        }
        const details = this.combatActionDetails.length > 0 ? ` (${this.combatActionDetails.join('; ')})` : '';
        const projectileFeedback = basicAttackHitCount >= 2 ? ` ${basicAttackHitCount} times` : '';
        const shieldFeedback = this.formatShieldAbsorption(damageAbsorbed);
        const basicHealTarget = basicHealPrimaryTargetId
          ? this.gameState.dice.find((die) => die.instanceId === basicHealPrimaryTargetId) ?? target
          : target;
        if (!scopeShotPerformed) {
          this.writeCombatLog(
            skipBasicAttack
              ? formatActiveSkillActionLabel(ownerName, this.getCombatDieName(attacker), activeSlot?.title, details)
              : attackerMeta?.healOnAttack
                ? basicHealAggregate
                  ? `${formatRicochetAggregationLabel(ownerName, this.getCombatDieName(attacker), 'heals', damage, basicHealCritical)}${details}!`
                  : `${ownerName} ${this.getCombatDieName(attacker)} heals ${basicHealTarget.instanceId === attacker.instanceId ? 'itself' : this.getCombatDieName(basicHealTarget)}${projectileFeedback} for ${formatCombatAmount(damage, basicHealCritical, 'health')}${details}!`
                : basicDamageAggregate
                  ? `${formatRicochetAggregationLabel(ownerName, this.getCombatDieName(attacker), 'attacks', damage, basicAttackCritical || ricochetCritical)}${details}!`
                  : `${ownerName} ${this.getCombatDieName(attacker)} attacks ${basicAttackTargetCount > 1 ? `${basicAttackTargetCount} foes` : this.getCombatDieName(target)}${projectileFeedback} for ${formatCombatAmount(damage, basicAttackCritical, 'damage')}${shieldFeedback}${details}!`
          );
        }

        if (!beamTarget && !skipBasicAttack && !attackerMeta?.healOnAttack && !scopeShotPerformed) this.animateBasicAttackSequence(attacker, target, basicAttackVisualCount);
        this.renderDice();
        this.renderEnemyDice();
        this.syncBerserkSfxState();

        if (!(await this.delayCombatPaced(500))) {
          timedOut = true;
          break;
        }

        if (await this.resolveCombatWin()) {
          return;
        }
      }
    if (timedOut) {
      this.forceCombatResolutionState();
      this.writeCombatLog('⏱️ Time is up! Advancing to next turn...');
    } else {
      this.writeCombatLog('Combat phase complete!');
    }
    this.clearRangeHighlights();
    this.enemyLoadoutRevealed = true;
    await this.delay(1000);

    await this.applyCombatEndSkills();
    this.applyFountainOfLoveCombatEndHealing();
    this.applyDungeonCardCombatEndRegen();
    this.applyTimedSkillDecay();
    this.gameState = resolveCombatPhase(this.gameState);
    this.restoreDurationLockedDice();
    this.statusEffects.clearTaunts();
    this.combatAttackCountDeltaByInstance.clear();
    this.combatAttackCountPositiveDeltaByInstance.clear();
    this.combatAttackCountNegativeDeltaByInstance.clear();
    this.grantedAttackCountByInstance.clear();
    await this.applyTurnBasedEffects();
    this.renderDice();
    this.renderEnemyDice();
    this.renderPools();

    if (await this.resolveCombatWin(true)) {
      return;
    }

    if (
      this.activeChallenge === 'deucifer' &&
      !this.deuciferBossSummoned &&
      (this.gameState.turn >= 10 || getLivingDiceCount(this.gameState, 'enemy') === 0)
    ) {
      this.deuciferBossPending = true;
    }

    if (this.turnLimit !== -1 && this.gameState.turn >= this.turnLimit && !this.deuciferBossPending) {
      this.resolveTurnLimitResult();
      return;
    }

    const completedTurn = this.gameState.turn;
    this.gameState = endTurn(this.gameState);
    this.resetReverseCooldownsAtTurnStart();
    this.restoreEnemyFogForNewTurn();
    if (this.deuciferBossPending) this.summonDeuciferBoss();
    await this.maybeRunDiceCardDraft();
    if (this.configRandomMode && this.activeRandomModifier === 'Necromancy' && this.gameState.turn > 1) {
      this.applyNecromancyTurnEffect();
    }
    this.updateTurnLabel();
    this.playTurnBanner(this.turnText.text);
    AudioManager.playSfx(this, AUDIO_KEYS.uiRound);
    this.writeCombatLog(`Turn ${this.gameState.turn} - Roll and place your dice!`);

    await this.returnDiceToHand();
    this.refreshHandAfterPoisonEffects();
    this.renderDice();
    this.renderEnemyDice();
    this.renderPools();
    this.updateCombatButtonState();
    // Checkpoint after the full turn so mid-combat kills cannot be reloaded as free progress.
    if (this.activeChallenge === 'dungeon' && this.dungeonRunActive) {
      this.persistDungeonTurnSnapshot(completedTurn);
    }
  }

  private playAttackSfx(attacker: DiceInstanceState) {
    const baseKey = this.getDefinitionForInstance(attacker)?.attackSfx;
    if (baseKey) {
      AudioManager.playSfx(this, baseKey);
      return;
    }
    AudioManager.playRandomSfx(this, [AUDIO_KEYS.diceAttack01, AUDIO_KEYS.diceAttack02, AUDIO_KEYS.diceAttack03]);
  }

  private applyNecromancyTurnEffect() {
    const allDefinitions = getAllDiceDefinitions(this);
    const owners: Array<'player' | 'enemy'> = this.activeChallenge === 'dungeon' ? ['player'] : ['player', 'enemy'];
    owners.forEach((ownerId) => {
      const destroyed = this.gameState.dice.filter((d) => d.ownerId === ownerId && d.isDestroyed);
      if (destroyed.length > 0) {
        const chosen = destroyed[Phaser.Math.Between(0, destroyed.length - 1)];
        if (!chosen) return;
        this.defeatEventIdByInstance.delete(chosen.instanceId);
        if (chosen.instanceId.includes('-necro-')) this.instanceTalentIndices.set(chosen.instanceId, null);
        const restoredDefinition = this.getDefinitionForInstance(chosen);
        const restoredMaxHealth = Math.max(
          1,
          Math.floor(chosen.maxHealth),
          restoredDefinition ? Math.max(1, Math.floor(restoredDefinition.health)) : 0
        );
        this.gameState = {
          ...this.gameState,
          dice: this.gameState.dice.map((d) => d.instanceId === chosen.instanceId
          ? { ...d, isDestroyed: false, maxHealth: restoredMaxHealth, currentHealth: restoredMaxHealth, zone: 'hand', gridPosition: undefined }
          : d)
        };
        return;
      }
      const bestClass = Math.max(1, ...this.gameState.dice
        .filter((d) => d.ownerId === ownerId)
        .map((d) => this.instanceClassLevels.get(d.instanceId) ?? 1));
      const baseDef = allDefinitions[Phaser.Math.Between(0, allDefinitions.length - 1)];
      if (!baseDef) return;
      const def = this.applyClassProgress(baseDef, bestClass);
      const effectiveDefinition = this.applyDungeonCardDefinitionForOwner(def, ownerId, bestClass);
      const maxHealth = Math.max(1, Math.floor(effectiveDefinition.health));
      const newId = `${ownerId}-${def.typeId}-necro-${Date.now()}-${Phaser.Math.Between(1, 9999)}`;
      this.gameState = {
        ...this.gameState,
        dice: [...this.gameState.dice, {
          instanceId: newId,
          ownerId,
          typeId: def.typeId,
          maxHealth,
          currentHealth: maxHealth,
          attacksRemaining: 1,
          zone: 'hand',
          gridPosition: undefined,
          isDestroyed: false,
          hasFinishedAttacking: false
        }]
      };
      this.instanceDefinitionOverrides.set(newId, def);
      this.instanceClassLevels.set(newId, bestClass);
      this.instanceTalentIndices.set(newId, null);
    });
    this.writeCombatLog(this.activeChallenge === 'dungeon'
      ? 'Necromancy: a die has been revived or conjured for you.'
      : 'Necromancy: a die has been revived or conjured for both sides.');
  }

  private refreshHandAfterPoisonEffects() {
    const deadInHand: string[] = [];
    this.currentHandOrder.forEach((instanceId) => {
      const isDestroyed = this.gameState.dice.some(
        (d) => d.ownerId === 'player' && d.instanceId === instanceId && d.isDestroyed
      );
      if (isDestroyed) deadInHand.push(instanceId);
    });
    if (deadInHand.length === 0) return;

    deadInHand.forEach((typeId) => {
      this.handDice.get(typeId)?.destroy();
      this.handDice.delete(typeId);
    });
    this.currentHandOrder = this.currentHandOrder.filter((t) => !deadInHand.includes(t));
    this.combatLog.setText(
      `Some hand dice perished from poison between turns. ${this.currentHandOrder.length} dice remain.`
    );
    this.updateCombatButtonState();
  }

  private resolveTurnLimitResult() {
    const playerLiving = getLivingDiceCount(this.gameState, 'player');
    const enemyLiving = getLivingDiceCount(this.gameState, 'enemy');
    if (this.activeChallenge === 'deucifer' && enemyLiving > 0) {
      this.endGame('defeat', 'Defeat: Deucifer and his minions survived the 10 bonus rounds.');
      return;
    }
    if (playerLiving > enemyLiving) {
      this.endGame('victory', `Turn limit reached! You have ${playerLiving} dice vs opponent's ${enemyLiving}.`);
    } else if (enemyLiving > playerLiving) {
      this.endGame('defeat', `Turn limit reached! Opponent has ${enemyLiving} dice vs your ${playerLiving}.`);
    } else {
      this.endGame('draw', `Turn limit reached — DRAW! Both sides have ${playerLiving} dice.`);
    }
  }

  private getWeakestDamagedAlly(ownerId: DiceInstanceState['ownerId'], excludedInstanceId?: string): DiceInstanceState | undefined {
    const livingAllies = this.gameState.dice.filter((die) => die.ownerId === ownerId && !die.isDestroyed);
    const otherDamagedAllies = livingAllies
      .filter((die) => die.instanceId !== excludedInstanceId && die.currentHealth < die.maxHealth)
      .sort((a, b) => (a.currentHealth / a.maxHealth) - (b.currentHealth / b.maxHealth) || a.currentHealth - b.currentHealth);
    if (otherDamagedAllies[0]) return otherDamagedAllies[0];
    return livingAllies.find((die) => die.instanceId === excludedInstanceId && die.currentHealth < die.maxHealth);
  }

  private isBerserkActive(die: DiceInstanceState): boolean {
    const definition = this.getDefinitionForInstance(die);
    if (!definition || die.isDestroyed || die.maxHealth <= 0) return false;
    const meta = getRuntimeSkillMeta(definition);

    return meta.berserkThresholdRate !== undefined && die.currentHealth / die.maxHealth < meta.berserkThresholdRate;
  }

  private syncBerserkSfxState() {
    this.gameState.dice.forEach((die) => {
      if (die.zone !== 'board' || die.isDestroyed) {
        this.berserkTriggeredInstances.delete(die.instanceId);
        return;
      }
      const isActive = this.isBerserkActive(die);
      const wasActive = this.berserkTriggeredInstances.has(die.instanceId);
      if (isActive && !wasActive) {
        this.playSkillSfxForDie(die);
        this.berserkTriggeredInstances.add(die.instanceId);
      } else if (!isActive && wasActive) {
        this.berserkTriggeredInstances.delete(die.instanceId);
      }
    });
  }

  private getPoisonSummary(instanceId: string): {
    damage: number;
    turns: number;
    stacks: number;
    stackDetails: Array<{ damage: number; turns: number }>;
  } | undefined {
    return this.statusEffects.getPoisonSummary(instanceId);
  }

  private getIgnitionSummary(instanceId: string): {
    rate: number;
    turns: number;
    stacks: number;
    stackDetails: Array<{ rate: number; turns: number }>;
  } | undefined {
    return this.statusEffects.getIgnitionSummary(instanceId);
  }

  private getAttackDeltaSummary(instanceId: string): {
    delta: number;
    turns: number;
    stacks: number;
    stackDetails: Array<{ delta: number; turns: number }>;
  } | undefined {
    return this.statusEffects.getSlowSummary(instanceId);
  }

  private getStatusStackCount(die: DiceInstanceState, effect: 'slow' | 'poison' | 'ignition' | 'fracture' | 'taunt' | 'stun' | 'hibernation' | 'berserk' | 'acceleration' | 'dilation' | 'disorientation'): number {
    return this.statusEffects.getStatusStackCount(die.instanceId, effect, this.isBerserkActive(die));
  }

  private getStatusEffects(die: DiceInstanceState): Array<'slow' | 'poison' | 'ignition' | 'berserk' | 'taunt' | 'fracture' | 'stun' | 'hibernation' | 'acceleration' | 'dilation' | 'disorientation'> {
    return this.statusEffects.getStatusEffects(die.instanceId, this.isBerserkActive(die)) as Array<'slow' | 'poison' | 'ignition' | 'berserk' | 'taunt' | 'fracture' | 'stun' | 'hibernation' | 'acceleration' | 'dilation' | 'disorientation'>;
  }

  private getStatusEffectSummaryForDie(die: DiceInstanceState): string[] {
    const statusLines = this.statusEffects.getSummaryLines(die.instanceId);
    const lockTurns = this.lockTurnsByInstance.get(die.instanceId);
    if (this.getActiveLockSource(die)) {
      const lockLine = lockTurns !== undefined ? `Locked (${lockTurns} turn${lockTurns === 1 ? '' : 's'})` : 'Locked';
      const incapacitationIndex = statusLines.findIndex((line) => /^(Disorientation|Stun|Hibernation)/.test(line));
      statusLines.splice(incapacitationIndex >= 0 ? incapacitationIndex : statusLines.length, 0, lockLine);
    }
    const manaPausedTurns = this.manaPausedTurnsByInstance.get(die.instanceId);
    if (manaPausedTurns && manaPausedTurns > 0) {
      statusLines.push(`Mana paused (${manaPausedTurns} turn${manaPausedTurns === 1 ? '' : 's'})`);
    }
    if (this.isBerserkActive(die)) statusLines.push('Berserk active');
    return statusLines;
  }

  private getPlayerHandDie(instanceId: string): DiceInstanceState | undefined {
    return this.gameState.dice.find((die) => die.ownerId === 'player' && die.instanceId === instanceId && die.zone === 'hand' && !die.isDestroyed);
  }

  private getBaseCriticalChance(source?: DiceInstanceState): number {
    if (source?.ownerId !== 'enemy' || this.activeChallenge !== 'dungeon') return 0.05;
    return getDungeonEnemyCriticalChance(this.dungeonWave, this.isBossDie(source));
  }

  private rollGlobalCritical(source?: DiceInstanceState): boolean {
    return secureChance(this.getBaseCriticalChance(source));
  }

  private getCriticalChance(criticalChance: number, includesBaseChance = false, source?: DiceInstanceState): number {
    return Phaser.Math.Clamp(criticalChance + (includesBaseChance ? this.getBaseCriticalChance(source) : 0), 0, 1);
  }

  private applyCriticalDamage(damage: number, options: { allowGlobalCrit?: boolean; source?: DiceInstanceState } = {}): { damage: number; critical: boolean } {
    const critical = options.allowGlobalCrit !== false && this.rollGlobalCritical(options.source);
    return { damage: critical ? damage * 2 : damage, critical };
  }

  private applyCriticalHealing(amount: number, source?: DiceInstanceState): { amount: number; critical: boolean } {
    const critical = this.rollGlobalCritical(source);
    return { amount: critical ? amount * 2 : amount, critical };
  }

  private applyDamageWithRevive(instanceId: string, damage: number, options: { ignoreDamageReduction?: boolean; ignoreShield?: boolean; allowGlobalCrit?: boolean; proportionalDamage?: number; source?: DiceInstanceState } = {}): { state: MatchBattleState; dealt: number; appliedDealt: number; absorbed: number; defeated: boolean; killed: boolean; critical: boolean } {
    this.hitDuringAttackAction.add(instanceId);
    let shieldAbsorbed = 0;
    const proportionalDamage = Phaser.Math.Clamp(options.proportionalDamage ?? 0, 0, damage);
    const criticalDamage = this.applyCriticalDamage(damage - proportionalDamage, { allowGlobalCrit: options.allowGlobalCrit, source: options.source });
    damage = criticalDamage.damage + proportionalDamage;
    if (criticalDamage.critical) this.criticalDamageTextByInstance.add(instanceId);
    const die = this.gameState.dice.find((d) => d.instanceId === instanceId);
    if (damage > 0 && this.statusEffects.wakeHibernation(instanceId) && die) {
      this.writeCombatLog(`${this.getCombatDieName(die)} is jolted awake and loses Hibernation!`);
    }
    const reductionSources: number[] = [];
    if (!options.ignoreDamageReduction) {
      reductionSources.push(this.damageReductionByInstance.get(instanceId) ?? 0);
      if (die) {
        reductionSources.push(this.getSpotlightScale(die));
        reductionSources.push(this.getVanguardReduction(die));
        reductionSources.push(this.getDungeonCardEffectsForDie(die)?.armorReduction ?? 0);
        const effectivePip = this.getEffectivePipForInvestment(die);
        reductionSources.push(effectivePip % 2 === 0
          ? this.evenInvestmentByOwner[die.ownerId].reduction
          : this.oddInvestmentByOwner[die.ownerId].reduction);
        if (effectivePip === 1 || effectivePip === 2) {
          reductionSources.push(this.crowdAttackByOwner[die.ownerId].reduction);
        }
      }
    }
    const reduction = combineDamageReduction(reductionSources);
    if (reduction > 0) damage = Math.max(0, Math.floor(damage * (1 - reduction)));
    const armorShred = this.statusEffects.getFracture(instanceId);
    if (armorShred && armorShred.rate > 0) damage = Math.max(1, Math.floor(damage * (1 + armorShred.rate)));
    const before = this.gameState.dice.find((targetDie) => targetDie.instanceId === instanceId);
    const grantOnDamagedShield = (targetDie: DiceInstanceState, incomingDamage: number) => {
      const definition = this.getDefinitionForInstance(targetDie);
      if (!definition) return;
      const classLevel = this.instanceClassLevels.get(instanceId) ?? 1;
      const onDamagedSkill = getValidSkillDefinitions(definition).find((skill) => skill.type === 'OnDamaged');
      const onDamagedResult = this.combatOrchestrator.runSync(
        this.getCombatFlowContext('OnDamaged', options.source ?? targetDie, targetDie, 'OnDamaged', onDamagedSkill?.title),
        () => executeOnDamagedSkillEffects(targetDie, definition, classLevel, options.source ?? targetDie, incomingDamage, false),
        {}
      );
      this.applySkillGrowth(targetDie.instanceId, onDamagedResult);
      this.applySummonResult(targetDie, onDamagedResult);
      const onDamagedMeta = getRuntimeSkillMetaForTrigger(definition, 'OnDamaged');
      this.applySkillLocks(targetDie, onDamagedMeta);
      this.applyStatusApplications(onDamagedResult.statusApplications);
      if (onDamagedResult.specialAttackDamage !== undefined) {
        void this.applySpecialSkillAttack(
          targetDie,
          onDamagedResult.specialAttackDamage,
          onDamagedResult.specialAttackTarget,
          onDamagedMeta,
          'On-hit attack',
          (target, feedback) => `${this.getCombatDieName(targetDie)} prickles ${this.getCombatDieName(target)} for ${feedback} damage!`
        );
      }
      this.applySkillHealingResult(targetDie, onDamagedResult, 'OnDamaged');
      const onDamagedShield = onDamagedResult.shieldGain && onDamagedResult.shieldGain > 0
        ? Math.max(1, Math.ceil(onDamagedResult.shieldGain * this.getSkillSupportMultiplier(targetDie)))
        : 0;
      if (onDamagedShield > 0) {
        this.grantShield(targetDie, onDamagedShield);
        this.showHealText(targetDie, onDamagedShield);
        this.playSkillSfxForDie(targetDie, getRuntimeSkillMeta(definition));
      }
    };
    const shieldHp = options.ignoreShield ? 0 : (this.shieldHpByInstance.get(instanceId) ?? 0);
    if (shieldHp > 0) {
      const absorbed = Math.min(shieldHp, Math.max(0, damage));
      const remaining = Math.max(0, damage - absorbed);
      const nextShield = shieldHp - absorbed;
      if (absorbed > 0) this.shieldDamageTextByInstance.set(instanceId, (this.shieldDamageTextByInstance.get(instanceId) ?? 0) + absorbed);
      if (nextShield > 0) this.shieldHpByInstance.set(instanceId, nextShield);
      else this.shieldHpByInstance.delete(instanceId);
      if (absorbed > 0) shieldAbsorbed = absorbed;
      if (remaining <= 0) {
        if (before && absorbed > 0) grantOnDamagedShield(before, absorbed);
        this.criticalDamageTextByInstance.delete(instanceId);
        return { state: this.gameState, dealt: 0, appliedDealt: 0, absorbed: shieldAbsorbed, defeated: false, killed: false, critical: criticalDamage.critical };
      }
      damage = remaining;
    }
    const beforePosition = before?.gridPosition;
    const nextState = applyDamage(this.gameState, instanceId, damage);
    const after = nextState.dice.find((die) => die.instanceId === instanceId);
    let resolvedState = nextState;
    if (before && after) {
      const definition = this.getDefinitionForInstance(before);
      const classLevel = this.instanceClassLevels.get(instanceId) ?? 1;
      if (definition) {
        const onDamagedSkill = getValidSkillDefinitions(definition).find((skill) => skill.type === 'OnDamaged');
        const onDamagedResult = this.combatOrchestrator.runSync(
          this.getCombatFlowContext('OnDamaged', options.source ?? before, before, 'OnDamaged', onDamagedSkill?.title),
          () => executeOnDamagedSkillEffects(before, definition, classLevel, options.source ?? before, damage, after.isDestroyed),
          {}
        );
        this.applySkillGrowth(before.instanceId, onDamagedResult);
        this.applySummonResult(before, onDamagedResult);
        const onDamagedMeta = getRuntimeSkillMetaForTrigger(definition, 'OnDamaged');
        this.applySkillLocks(before, onDamagedMeta);
        this.applyStatusApplications(onDamagedResult.statusApplications);
        if (onDamagedResult.specialAttackDamage !== undefined) {
          void this.applySpecialSkillAttack(
            before,
            onDamagedResult.specialAttackDamage,
            onDamagedResult.specialAttackTarget,
            onDamagedMeta,
            'On-hit attack',
            (target, feedback) => `${this.getCombatDieName(before)} prickles ${this.getCombatDieName(target)} for ${feedback} damage!`
          );
        }
        this.applySkillHealingResult(before, onDamagedResult, 'OnDamaged');
        if (!after.isDestroyed && onDamagedResult.bonusAttacks && onDamagedResult.bonusAttacks > 0) {
          const recipient = onDamagedResult.grantAttacksToAlly !== undefined
            ? this.selectAllyAttackRecipient(before, resolvedState, onDamagedResult.grantAttacksToAlly, undefined, onDamagedResult.grantAttacksToAllyRadius)
            : after;
          const recipientId = recipient?.instanceId ?? instanceId;
          if (!this.chainedByInstance.has(recipientId)) {
            this.recordGrantedAttackCount(recipientId, onDamagedResult.bonusAttacks);
            resolvedState = {
              ...resolvedState,
              dice: resolvedState.dice.map((die) => {
                if (die.instanceId !== recipientId) return die;
                return { ...die, attacksRemaining: die.attacksRemaining + onDamagedResult.bonusAttacks!, hasFinishedAttacking: false };
              })
            };
            this.gameState = resolvedState;
          }
        }
        if (!after.isDestroyed && onDamagedResult.grantAttacksToFoe && onDamagedResult.grantAttacksToFoe > 0) {
          resolvedState = this.grantFoeAttacks(before, onDamagedResult.grantAttacksToFoe, resolvedState);
          this.gameState = resolvedState;
        }
        const onDamagedShield = !after.isDestroyed && onDamagedResult.shieldGain && onDamagedResult.shieldGain > 0
          ? Math.max(1, Math.ceil(onDamagedResult.shieldGain * this.getSkillSupportMultiplier(after)))
          : 0;
        if (onDamagedShield > 0) {
          this.grantShield(after, onDamagedShield);
          this.showHealText(after, onDamagedShield);
          this.playSkillSfxForDie(after, getRuntimeSkillMeta(definition));
        }
        if (onDamagedResult.extraEffects?.length) {
          this.combatLog.setText(onDamagedResult.extraEffects.join('; '));
        }
      }
    }
    if (before && after && !after.isDestroyed) {
      const definition = this.getDefinitionForInstance(before);
      const classLevel = this.instanceClassLevels.get(before.instanceId) ?? 1;
      if (definition) {
        const revengeSkill = getValidSkillDefinitions(definition).find((skill) => skill.modifiers?.hasRevenge === true && skill.modifiers.revengeThresholdRate !== undefined);
        const revengeResult = this.combatOrchestrator.runSync(
          this.getCombatFlowContext('OnDamaged', before, after, revengeSkill?.type, revengeSkill?.title),
          () => executeRevengeSkillEffects(
            after,
            definition,
            classLevel,
            before.currentHealth,
            after.currentHealth
          ),
          {}
        );
        if (revengeResult.revenge) {
          this.gameState = resolvedState;
          this.applySkillGrowth(after.instanceId, revengeResult);
          void this.applyRevengeSkillEffect(after, revengeResult.revenge);
        }
      }
    }
    if (!before || !after?.isDestroyed) return {
      state: resolvedState,
      dealt: before ? Math.max(0, damage) : 0,
      appliedDealt: Math.max(0, (before?.currentHealth ?? 0) - (after?.currentHealth ?? 0)),
      absorbed: shieldAbsorbed,
      defeated: false,
      killed: false,
      critical: criticalDamage.critical
    };
    AudioManager.playSfx(this, AUDIO_KEYS.diceDie);
    const beforeDefinition = before ? this.getDefinitionForInstance(before) : undefined;
    const reviveClassLevel = this.instanceClassLevels.get(instanceId) ?? 1;
    const reviveSkills = beforeDefinition
      ? getValidSkillDefinitions(beforeDefinition).filter((skill) => skill.type === 'OnDeath'
        && (getSkillLockClass(skill) === undefined || reviveClassLevel >= getSkillLockClass(skill)!))
      : [];
    const reviveMeta = beforeDefinition && reviveSkills.length > 0
      ? getRuntimeSkillMetaForTrigger({ ...beforeDefinition, skills: reviveSkills }, 'OnDeath')
      : undefined;
    const previousRevives = this.reviveCountByInstance.get(instanceId) ?? 0;
    const reviveChance = reviveMeta?.reviveChance === undefined
      ? undefined
      : Phaser.Math.Clamp(
        reviveMeta.reviveChance * Math.pow(reviveMeta.reviveChanceRate ?? 1, previousRevives),
        0,
        1
      );
    const maxRevives = reviveMeta?.maxRevives;
    const hasOtherLivingAlly = before ? nextState.dice.some((die) =>
      die.ownerId === before.ownerId
      && die.instanceId !== before.instanceId
      && !die.isDestroyed
      && (die.zone === 'board' || die.zone === 'hand')
    ) : false;
    const cardRevives = before ? Math.max(0, Math.floor(this.getDungeonCardEffectsForDie(before)?.extraRevives ?? 0)) : 0;
    const canCardRevive = previousRevives < cardRevives;
    const canBaseRevive = Boolean(
      reviveMeta?.hasRevive === true
      && reviveChance !== undefined
      && (maxRevives === undefined || previousRevives < maxRevives)
      && (!reviveMeta?.dontReviveWhenLastOneStanding || hasOtherLivingAlly)
    );
    if (!canCardRevive && (!canBaseRevive || !secureChance(reviveChance!))) {
      this.defeatEventIdByInstance.set(instanceId, ++this.nextDefeatEventId);
      return {
        state: resolvedState,
        dealt: Math.max(0, damage),
        appliedDealt: Math.max(0, before.currentHealth - (after?.currentHealth ?? 0)),
        absorbed: shieldAbsorbed,
        defeated: true,
        killed: true,
        critical: criticalDamage.critical
      };
    }
    const nextReviveCount = previousRevives + 1;
    const reviveStats = resolveReviveStats({
      maxHealth: before.maxHealth,
      baseAttack: beforeDefinition?.attack ?? 1,
      healthRate: reviveMeta?.reviveHealth,
      attackRate: reviveMeta?.reviveAttack
    });
    if (beforeDefinition) {
      this.instanceDefinitionOverrides.set(instanceId, this.stripDungeonCardHealth({
        ...beforeDefinition,
        attack: reviveStats.attack,
        health: reviveStats.maxHealth
      }));
    }
    this.reviveCountByInstance.set(instanceId, nextReviveCount);
    this.defeatEventIdByInstance.delete(instanceId);
    const reviveSkillDuration = Math.max(0, Math.floor(reviveMeta?.skillDuration ?? 0));
    if (reviveSkillDuration > 0) {
      const attackIncrease = Math.max(0, Math.floor(reviveMeta?.attackCountIncrease ?? 0));
      const projectileIncrease = Math.max(0, Math.floor(reviveMeta?.projectileCountIncrease ?? 0));
      if (attackIncrease > 0) {
        const current = this.extraAttackTurnsByInstance.get(instanceId);
        this.extraAttackTurnsByInstance.set(instanceId, {
          extra: (current?.extra ?? 0) + attackIncrease,
          turns: Math.max(current?.turns ?? 0, reviveSkillDuration)
        });
        this.recordAttackCountEffect(instanceId, attackIncrease);
        this.writeAttackCountFeedback(before, attackIncrease);
      }
      if (projectileIncrease > 0) {
        const current = this.basicAttacksPerAttackByInstance.get(instanceId);
        this.basicAttacksPerAttackByInstance.set(instanceId, {
          count: Math.max(current?.count ?? 1, 1 + projectileIncrease),
          turns: Math.max(current?.turns ?? 0, reviveSkillDuration)
        });
        this.recordAttackCountEffect(instanceId, projectileIncrease);
      }
    }
    this.animateSkullRevive(before);
    this.writeCombatLog(`${this.getCombatDieName(before)} immediately revives and comes back in action!`);
    return {
      dealt: Math.max(0, damage),
      appliedDealt: Math.max(0, before.currentHealth - (after?.currentHealth ?? 0)),
      absorbed: shieldAbsorbed,
      defeated: false,
      killed: true,
      critical: criticalDamage.critical,
      state: {
      ...nextState,
      reviveCounts: { ...nextState.reviveCounts, [instanceId]: nextReviveCount },
      dice: nextState.dice.map((die) => die.instanceId === instanceId
        ? {
            ...die,
            isDestroyed: false,
            zone: before.zone === 'board' ? 'board' : before.zone,
            maxHealth: reviveStats.maxHealth,
            currentHealth: reviveStats.currentHealth,
            attacksRemaining: before.attacksRemaining,
            hasFinishedAttacking: before.hasFinishedAttacking,
            gridPosition: beforePosition
          }
        : die)
      }
    };
  }
  private async applyRevengeSkillEffect(source: DiceInstanceState, revenge: { hits: number; damage: number; range: number; mode: DiceTargetingMode }) {
    const liveSource = this.gameState.dice.find((die) => die.instanceId === source.instanceId && !die.isDestroyed && die.gridPosition);
    const definition = liveSource ? this.getDefinitionForInstance(liveSource) : undefined;
    if (!liveSource?.gridPosition || !definition) return;
    const candidates = this.gameState.dice
      .filter((die): die is DiceInstanceState & { gridPosition: { row: number; col: number } } =>
        die.ownerId !== liveSource.ownerId
        && die.zone === 'board'
        && !die.isDestroyed
        && Boolean(die.gridPosition)
        && this.getAttackDistance(liveSource, die) <= revenge.range
      )
      .map((die) => ({ die, distance: this.getAttackDistance(liveSource, die) }));
    const target = this.selectTargetCandidate(candidates, revenge.mode);
    if (!target) return;

    for (let index = 0; index < revenge.hits; index++) {
      const freshTarget = this.gameState.dice.find((die) => die.instanceId === target.instanceId && !die.isDestroyed);
      if (!freshTarget) break;
      const revengeDamage = Math.max(1, Math.floor(revenge.damage * this.getDiceCardSkillDamageMultiplier(liveSource)));
      const hit = this.applyDamageWithRevive(freshTarget.instanceId, revengeDamage, { source: liveSource });
      this.gameState = hit.state;
      this.showDamageText(freshTarget, hit.dealt, '#6abf69');
      await this.applyDamageDefeatHooks(liveSource, freshTarget, hit.defeated || hit.killed);
      this.addCombatActionDetail(`Revenge hit ${this.getCombatDieName(freshTarget)} for ${this.formatDamageFeedback(hit)}`);
      if (hit.defeated) break;
    }
    this.writeCombatLog(`${this.getCombatDieName(liveSource)} unleashes Revenge!`);
  }


  private getPierceBehindTargets(attacker: DiceInstanceState, target: DiceInstanceState, range: number): DiceInstanceState[] {
    if (!attacker.gridPosition || !target.gridPosition || range <= 0) return [];
    const rowStep = Math.sign(target.gridPosition.row - attacker.gridPosition.row);
    const colStep = this.getBoardSideForDie(attacker) === 'player' ? 1 : -1;
    const targetBoardSide = this.getBoardSideForDie(target);
    const targetFootprint = this.getFootprintForDie(target);
    const enemies = this.getBoardDiceOnSide(target.ownerId, targetBoardSide);
    const targets: DiceInstanceState[] = [];
    const hitIds = new Set<string>();
    for (let i = targetFootprint; i < targetFootprint + range; i++) {
      const row = target.gridPosition.row + rowStep * i;
      const col = target.gridPosition.col + colStep * i;
      enemies.forEach((die) => {
        if (die.instanceId === target.instanceId || hitIds.has(die.instanceId)) return;
        if (!this.getFootprintCells(die).some((cell) => cell.row === row && cell.col === col)) return;
        hitIds.add(die.instanceId);
        targets.push(die);
      });
    }
    return targets;
  }

  private hasAdjacentAlly(die: DiceInstanceState): boolean {
    if (!die.gridPosition) return false;
    const allies = this.gameState.dice.filter((other) =>
      other.zone === 'board' &&
      !other.isDestroyed &&
      other.ownerId === die.ownerId &&
      other.instanceId !== die.instanceId &&
      other.gridPosition &&
      this.areDiceOnSameBoardSide(other, die)
    );
    return allies.some((other) => this.getFootprintChebyshevDistance(die, other) <= 1);
  }

  private hasAdjacentFoe(die: DiceInstanceState): boolean {
    if (!die.gridPosition) return false;
    return this.gameState.dice.some((other) => {
      if (other.zone !== 'board' || other.isDestroyed || other.ownerId === die.ownerId || other.instanceId === die.instanceId || !other.gridPosition || !this.areDiceOnSameBoardSide(other, die)) return false;
      return this.getFootprintChebyshevDistance(die, other) <= 1;
    });
  }

  private getSolitudeBasicAttackBonus(attacker: DiceInstanceState, target: DiceInstanceState): number {
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition || !attacker.gridPosition) return 0;
    const meta = getRuntimeSkillMeta(definition);
    if (!meta.checkForAdjacentAllies || meta.targetMaxHpBonusRate === undefined) return 0;
    if (meta.checkForAdjacentAllies && this.hasAdjacentAlly(attacker)) return 0;
    if (meta.checkForAdjacentFoes && this.hasAdjacentFoe(attacker)) return 0;
    const bossMitigation = this.isBossDie(target) ? 0.25 : 1;
    return Math.max(1, Math.floor(target.maxHealth * meta.targetMaxHpBonusRate * bossMitigation));
  }

  private getAllyHealingDistance(healer: DiceInstanceState, ally: DiceInstanceState): number {
    if (!healer.gridPosition || !ally.gridPosition || !this.areDiceOnSameBoardSide(healer, ally)) {
      return Number.POSITIVE_INFINITY;
    }
    return this.getFootprintColumnDistance(healer, ally);
  }

  private getWeakestInjuredAlly(healer: DiceInstanceState): DiceInstanceState | undefined {
    const definition = this.getDefinitionForInstance(healer);
    if (!definition || !healer.gridPosition) return undefined;
    const effectiveRange = Math.max(1, this.getEffectiveAttackRange(healer, definition));
    return this.gameState.dice
      .filter((die): die is DiceInstanceState & { gridPosition: { row: number; col: number } } =>
        die.ownerId === healer.ownerId
        && die.zone === 'board'
        && !die.isDestroyed
        && Boolean(die.gridPosition)
        && die.currentHealth < die.maxHealth
        && this.getAllyHealingDistance(healer, die) <= effectiveRange)
      .sort((a, b) => (a.currentHealth / a.maxHealth) - (b.currentHealth / b.maxHealth) || a.currentHealth - b.currentHealth || a.instanceId.localeCompare(b.instanceId))[0];
  }

  private getRicochetDistance(source: DiceInstanceState, target: DiceInstanceState): number {
    if (!source.gridPosition || !target.gridPosition || !this.areDiceOnSameBoardSide(source, target)) {
      return Number.POSITIVE_INFINITY;
    }
    return this.getFootprintManhattanDistance(source, target);
  }

  private applyBasicHeal(
    attacker: DiceInstanceState,
    meta: ReturnType<typeof getRuntimeSkillMeta>
  ): { healed: number; ricochetHealed: number; critical: boolean; affectedIds: string[]; primaryTargetId?: string; details: string[] } {
    const primary = this.getWeakestInjuredAlly(attacker);
    if (!primary) return { healed: 0, ricochetHealed: 0, critical: false, affectedIds: [], details: [] };
    const definition = this.getDefinitionForInstance(attacker);
    const healAmount = Math.max(1, Math.floor(
      (definition?.attack ?? attacker.maxHealth)
        * this.getSkillSupportMultiplier(attacker, primary)
    ));
    const healedIds = new Set<string>();
    const affectedIds: string[] = [];
    const details: string[] = [];
    let primaryHealed = 0;
    let primaryTargetId: string | undefined;
    let ricochetHealed = 0;
    let critical = false;
    const healOne = (die: DiceInstanceState, amount = healAmount, isPrimary = false) => {
      if (healedIds.has(die.instanceId)) return;
      healedIds.add(die.instanceId);
      const healResult = this.healDie(die.instanceId, amount, attacker);
      if (isPrimary) {
        primaryHealed = healResult.healed;
        if (healResult.healed > 0) primaryTargetId = die.instanceId;
      } else {
        ricochetHealed += healResult.healed;
      }
      if (healResult.appliedHealed > 0) affectedIds.push(die.instanceId);
      if (healResult.critical) critical = true;
      this.animateSkillEffect('heal', attacker, die);
      if (!isPrimary && healResult.healed > 0) {
        details.push(`Ricochet heals ${die.instanceId === attacker.instanceId ? 'itself' : this.getCombatDieName(die)} for ${formatCombatAmount(healResult.healed, healResult.critical, 'health')}`);
      }
    };
    healOne(primary, healAmount, true);
    if (meta.hasRicochet === true) {
      const ricochetCount = Math.max(0, Math.floor(meta.ricochetCount ?? 1));
      const ricochetRange = Math.max(1, meta.ricochetRange ?? 2);
      const dropOff = Math.min(1, Math.max(0, meta.ricochetDropOff ?? 1));
      this.gameState.dice
        .filter((die) => die.ownerId === attacker.ownerId && die.zone === 'board' && !die.isDestroyed && die.gridPosition && die.instanceId !== primary.instanceId && die.currentHealth < die.maxHealth)
        .map((die) => ({ die, distance: this.getRicochetDistance(primary, die) }))
        .filter(({ distance }) => distance <= ricochetRange)
        .sort((a, b) => (a.die.currentHealth / a.die.maxHealth) - (b.die.currentHealth / b.die.maxHealth) || a.distance - b.distance || a.die.instanceId.localeCompare(b.die.instanceId))
        .slice(0, ricochetCount)
        .forEach(({ die }, index) => {
          const bounceHeal = Math.max(1, Math.floor(healAmount * Math.pow(dropOff, index + 1)));
          healOne(die, bounceHeal);
        });
    }
    return { healed: primaryHealed, ricochetHealed, critical, affectedIds, primaryTargetId, details };
  }

  private getRicochetDamageDistance(source: DiceInstanceState, target: DiceInstanceState): number {
    if (!source.gridPosition || !target.gridPosition) return Number.POSITIVE_INFINITY;
    return this.areDiceOnSameBoardSide(source, target)
      ? this.getFootprintChebyshevDistance(source, target)
      : this.getDistanceWithBoardSides(source, target);
  }

  private async applyBasicRicochet(
    attacker: DiceInstanceState,
    target: DiceInstanceState,
    meta: ReturnType<typeof getRuntimeSkillMeta>,
    baseDamage: number
  ): Promise<{ dealt: number; absorbed: number; critical: boolean; affectedIds: string[]; details: string[] }> {
    const result = { dealt: 0, absorbed: 0, critical: false, affectedIds: [] as string[], details: [] as string[] };
    if (meta.hasRicochet !== true) return result;
    const ricochetCount = Math.max(0, Math.floor(meta.ricochetCount ?? 1));
    if (ricochetCount <= 0) return result;
    const ricochetRange = Math.max(1, meta.ricochetRange ?? 2);
    const dropOff = Math.min(1, Math.max(0, meta.ricochetDropOff ?? 1));
    const enemyOwner = attacker.ownerId === 'player' ? 'enemy' : 'player';
    const victims = this.gameState.dice
      .filter((die) => die.ownerId === enemyOwner && die.zone === 'board' && !die.isDestroyed && die.gridPosition && die.instanceId !== target.instanceId)
      .map((die) => ({ die, distance: this.getRicochetDamageDistance(target, die) }))
      .filter(({ distance }) => distance <= ricochetRange)
      .sort((a, b) => a.distance - b.distance || a.die.instanceId.localeCompare(b.die.instanceId))
      .slice(0, ricochetCount);
    for (const [index, { die }] of victims.entries()) {
      const bounceDamage = Math.max(1, Math.floor(baseDamage * Math.pow(dropOff, index + 1)));
      const hit = this.applyDamageWithRevive(die.instanceId, bounceDamage, { source: attacker });
      this.gameState = hit.state;
      this.showDamageText(die, hit.dealt, '#ffd166');
      this.animateSkillEffect('physical', attacker, die);
      await this.applyDamageDefeatHooks(attacker, die, hit.defeated || hit.killed);
      if (hit.dealt > 0 || hit.absorbed > 0 || hit.defeated || hit.killed) {
        result.affectedIds.push(die.instanceId);
        result.details.push(`Ricochet damages ${this.getCombatDieName(die)} for ${this.formatDamageFeedback(hit)}`);
      }
      result.dealt += hit.dealt;
      result.absorbed += hit.absorbed;
      if (hit.critical) result.critical = true;
    }
    return result;
  }

  private getLeonFuriousClawDamage(attacker: DiceInstanceState, target: DiceInstanceState): { damage: number; critical: boolean } {
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition) return { damage: 0, critical: false };
    const meta = getRuntimeSkillMeta(definition);
    const critical = secureChance(this.getCriticalChance(meta.criticalChanceIncrease ?? 0, true, attacker));
    const crit = critical ? 2 + (meta.criticalDamageIncrease ?? 0) : 1;
    return { damage: Math.max(1, Math.floor(definition.attack * this.getDiceCardSkillDamageMultiplier(attacker) * crit)), critical };
  }

  private async executeLeonFuriousClaw(attacker: DiceInstanceState, target: DiceInstanceState, hitCount = 2) {
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition || !target.gridPosition || target.isDestroyed) return;
    const targetCenter = this.getTileCenter(target);
    if (targetCenter && hitCount >= 2) {
      AnimationManager.animateDoubleSwipe(this, targetCenter.x, targetCenter.y, this.getDieAccentColor(attacker), 280, this.getCombatPacingMultiplier());
      await this.delayCombatVisualPaced(120);
    }
    this.playAttackSfx(attacker);
    AudioManager.playSfx(this, AUDIO_KEYS.leonFuriousClaw);
    for (let hitIndex = 0; hitIndex < hitCount; hitIndex++) {
      const freshTarget = this.gameState.dice.find((die) => die.instanceId === target.instanceId && !die.isDestroyed);
      if (!freshTarget) return;
      const leonDamage = this.getLeonFuriousClawDamage(attacker, freshTarget);
      const hit = this.applyDamageWithRevive(freshTarget.instanceId, leonDamage.damage, { source: attacker, allowGlobalCrit: false });
      this.gameState = hit.state;
      this.showDamageText(freshTarget, hit.dealt, leonDamage.critical ? '#ff3333' : '#ffbf4a');
      if (hit.defeated || hit.killed) {
        await this.applyDamageDefeatHooks(attacker, freshTarget, true);
        this.addCombatActionDetail(`Furious Claw hit ${this.getCombatDieName(freshTarget)} for ${this.formatDamageFeedback(hit, leonDamage.critical)}${hit.defeated ? '' : ' (revived)'}`);
        return;
      }
      this.addCombatActionDetail(`Furious Claw hit ${this.getCombatDieName(freshTarget)} for ${this.formatDamageFeedback(hit, leonDamage.critical)}`);
    }
  }

  private async applyDamageDefeatHooks(attacker: DiceInstanceState, defeated: DiceInstanceState, wasDefeated: boolean, context?: { judgmentHammerDepth?: number }) {
    if (!wasDefeated) return;
    const eventId = this.defeatEventIdByInstance.get(defeated.instanceId);
    const resolvedEventId = eventId ?? ++this.nextDefeatEventId;
    this.defeatEventIdByInstance.set(defeated.instanceId, resolvedEventId);
    if (this.processedDefeatEventIds.has(resolvedEventId)) return;
    this.processedDefeatEventIds.add(resolvedEventId);
    await this.applyOnKillSkillEffects(attacker, defeated, context);
    this.checkDeathTransformCondition(defeated);
    const liveDefeated = this.gameState.dice.find((die) => die.instanceId === defeated.instanceId);
    if (!liveDefeated?.isDestroyed) {
      this.defeatEventIdByInstance.delete(defeated.instanceId);
      const revivedDefinition = this.getDefinitionForInstance(liveDefeated);
      const revivedClassLevel = this.instanceClassLevels.get(liveDefeated.instanceId) ?? 1;
      const revivedNuclear = revivedDefinition
        ? getValidSkillDefinitions(revivedDefinition).some((skill) => skill.type === 'OnDeath'
          && skill.modifiers?.hasNuclear === true
          && (getSkillLockClass(skill) === undefined || revivedClassLevel >= getSkillLockClass(skill)!))
        : false;
      if (revivedDefinition && revivedNuclear) {
        const revivedMeta = getRuntimeSkillMetaForTrigger(revivedDefinition, 'OnDeath');
        await this.applyNuclearStrike(liveDefeated, revivedMeta, revivedDefinition, { allowRepeat: true });
      }
      return;
    }
    this.writeDefeatLog(defeated);
    this.recordDungeonCardKill(defeated);
    await this.applyOnDeathSkillEffects(defeated, attacker);
  }

  private writeDefeatLog(defeated: DiceInstanceState) {
    const ownerName = defeated.ownerId === 'player' ? this.playerDisplayName : this.enemyDisplayName;
    this.writeCombatLog(`${ownerName}'s ${this.getCombatDieName(defeated)} was defeated!`);
  }

  private writeStatusApplicationFeedback(
    source: DiceInstanceState | undefined,
    target: DiceInstanceState,
    effect: StatusEffectApplication['effect'],
    duration = 1,
    fallbackSourceName = 'Nasty Nightmare'
  ) {
    const sourceName = source ? this.getQualifiedCombatDieName(source) : fallbackSourceName;
    const targetName = this.getQualifiedCombatDieName(target, false);
    const statusName = effect.charAt(0).toUpperCase() + effect.slice(1);
    const turns = Math.max(1, Math.floor(duration));
    this.writeCombatLog(`${sourceName} applies ${statusName} to ${targetName} for ${turns} turn${turns === 1 ? '' : 's'}!`);
  }

  private grantShield(target: DiceInstanceState, amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.shieldHpByInstance.set(target.instanceId, (this.shieldHpByInstance.get(target.instanceId) ?? 0) + amount);
    this.writeCombatLog(`${this.getQualifiedCombatDieName(target)} gains ${formatCompact(amount)} shield!`);
  }

  private applyStatusApplications(applications: StatusEffectApplication[] | undefined) {
    this.statusEffects.apply(applications, this.getStatusEffectHooks());
  }

  private getStatusEffectHooks(): StatusEffectHooks {
    return {
      getLiveDie: (instanceId) => this.gameState.dice.find((die) => die.instanceId === instanceId && !die.isDestroyed),
      getSourceDie: (instanceId) => this.gameState.dice.find((die) => die.instanceId === instanceId),
      getBoardFoes: (ownerId) => this.gameState.dice.filter((die) =>
        die.ownerId !== ownerId && die.zone === 'board' && !die.isDestroyed
      ),
      getDuration: (rawDuration) => this.getSkillDurationTurns(rawDuration),
      getDamageMultiplier: (source) => this.getDiceCardSkillDamageMultiplier(source),
      animate: (animation, source, target) => this.animateSkillEffect(animation, source, target),
      onApplied: (source, target, effect, duration) => this.writeStatusApplicationFeedback(source, target, effect, duration),
      onAttackDelta: (target, delta) => {
        this.recordAttackCountEffect(target.instanceId, delta);
        if (delta === 0) return;
        this.gameState = {
          ...this.gameState,
          dice: this.gameState.dice.map((die) => {
            if (die.instanceId !== target.instanceId || die.isDestroyed || die.attacksRemaining <= 0) return die;
            const attacksRemaining = Math.max(0, die.attacksRemaining + delta);
            return { ...die, attacksRemaining, hasFinishedAttacking: attacksRemaining === 0 };
          })
        };
      },
      onAttackCountLoss: (die, amount) => this.writeAttackCountFeedback(die, -amount),
      resolveIgnitionDamage: (target, rate, isBoss) => resolveIgnitionDamage(target.maxHealth, rate, isBoss),
      isBoss: (target) => this.isBossDie(target),
      runTick: (tick) => this.runStatusTick(tick)
    };
  }

  private async runStatusTick(tick: StatusEffectTick): Promise<void> {
    const allowGlobalCrit = tick.effect !== 'ignition';
    const hit = this.applyDamageWithRevive(tick.target.instanceId, tick.amount, {
      source: tick.source,
      allowGlobalCrit
    });
    this.gameState = hit.state;
    this.showDamageText(tick.target, hit.dealt, tick.effect === 'poison' ? '#74d66f' : '#ff6b35');
    if (tick.effect === 'poison') {
      const poisonDieName = this.getQualifiedCombatDieName(tick.target);
      this.writeCombatLog(tick.stackCount > 1
        ? `${poisonDieName} takes ${tick.stackCount} ticks of poison damage! (total: ${this.formatDamageFeedback(hit)})`
        : `${poisonDieName} takes ${this.formatDamageFeedback(hit)} poison damage!`);
    } else {
      this.writeCombatLog(`${this.getQualifiedCombatDieName(tick.target)} takes ${this.formatDamageFeedback(hit)} Ignition damage (${formatPercent(tick.totalRate)} max HP${tick.bossReduced ? ', reduced against bosses' : ''})!`);
    }
    await this.applyDamageDefeatHooks(tick.source, tick.target, hit.defeated || hit.killed);
    if (hit.defeated) AudioManager.playSfx(this, AUDIO_KEYS.diceDie);
  }

  private async applyTeleportSkillEffect(attacker: DiceInstanceState, target: DiceInstanceState, skillIndex: number) {
    const definition = this.getDefinitionForInstance(attacker);
    const skill = definition ? getValidSkillDefinitions(definition)[skillIndex] : undefined;
    if (!definition || !skill) return;
    if (skill.type === 'Passive') {
      const firedMeta = getRuntimeSkillMetaForTrigger(definition, 'Passive', skillIndex);
      if ((firedMeta.attackCount ?? 0) > 0 && firedMeta.skillRangeThreshold !== undefined) {
        await this.executeLeonFuriousClaw(attacker, target, 2);
      } else {
        await this.applyPassiveSkillEffects(attacker, target, skillIndex);
      }
      return;
    }
    if (skill.type !== 'Active') return;
    const slot = this.getActiveManaSlots(attacker).find((candidate) => candidate.skillIndex === skillIndex);
    if (!slot || !this.canActiveSlotFire(attacker, slot, this.getActiveSkillMetaForSlot(attacker, slot))) {
      this.addCombatActionDetail(`${skill.title} is not fully charged after teleport.`);
      return;
    }
    await this.applyActiveSkillEffects(attacker, target, slot);
  }

  private async applyPassiveSkillEffects(attacker: DiceInstanceState, target?: DiceInstanceState, passiveSkillIndex?: number) {
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition) return;
    const meta = getRuntimeSkillMetaForTrigger(definition, 'Passive', passiveSkillIndex);
    const classLevel = this.instanceClassLevels.get(attacker.instanceId) ?? 1;
    const targetBoardSide = target ? this.getBoardSideForDie(target) : undefined;
    const boardSideTargets = target && targetBoardSide
      ? this.getLivingDiceOnBoardSide(targetBoardSide).filter((die) => die.ownerId === target.ownerId)
      : [];

    const pips = attacker.ownerId === 'player'
      ? (this.dicePips.get(attacker.instanceId) ?? 1)
      : (this.enemyDicePips.get(attacker.instanceId) ?? 1);
    const passiveSkill = getValidSkillDefinitions(definition).find((skill) => skill.type === 'Passive');
    const result = this.combatOrchestrator.runSync(
      this.getCombatFlowContext('Passive', attacker, target, 'Passive', passiveSkill?.title),
      () => executePassiveSkillEffects(attacker, definition, classLevel, target, boardSideTargets, pips, passiveSkillIndex, (die) => this.getFootprintForDie(die)),
      {}
    );
    this.applySkillGrowth(attacker.instanceId, result);
    this.applySummonResult(attacker, result);
    this.applySkillLocks(attacker, meta);
    this.applyStatusApplications(result.statusApplications);
    if (!target && (result.applyGrowth || result.summonType || (result.bonusAttacks ?? 0) > 0 || result.missingHealRate !== undefined)) {
      this.playPassiveSkillSfxForDie(attacker, meta);
    }
    if (result.bonusAttacks && result.bonusAttacks > 0) {
      const recipient = result.grantAttacksToAlly !== undefined
        ? this.selectAllyAttackRecipient(attacker, this.gameState, result.grantAttacksToAlly, undefined, result.grantAttacksToAllyRadius)
        : attacker;
      if (recipient) {
        this.recordGrantedAttackCount(recipient.instanceId, result.bonusAttacks);
        this.gameState = {
          ...this.gameState,
          dice: this.gameState.dice.map((die) => die.instanceId === recipient.instanceId
            ? { ...die, attacksRemaining: die.attacksRemaining + result.bonusAttacks!, hasFinishedAttacking: false }
            : die)
        };
      }
    }
    if (result.grantAttacksToFoe && result.grantAttacksToFoe > 0) {
      this.gameState = this.grantFoeAttacks(attacker, result.grantAttacksToFoe, this.gameState);
    }

    if (result.splashTargets?.length && target) {
      const splashTargets = this.getFootprintTargetsWithin(target, boardSideTargets, 1);
      if (splashTargets.length > 0) this.playSplashSfxForDie(attacker, meta);
      for (const die of splashTargets) {
        const dealt = Math.max(1, Math.ceil((result.splashDamageAmount ?? meta.splashDamage ?? definition.attack) * this.getCombanityDamageMultiplier(attacker, die) * this.getDiceCardSkillDamageMultiplier(attacker)));
        const splashHit = this.applyDamageWithRevive(die.instanceId, dealt, { source: attacker });
        this.gameState = splashHit.state;
        this.showDamageText(die, splashHit.dealt, '#ff9f58');
        await this.applyDamageDefeatHooks(attacker, die, splashHit.defeated || splashHit.killed);
        this.animateSkillEffect('fire', attacker, die);
        this.addCombatActionDetail(`Fire splash hit ${this.getCombatDieName(die)} for ${this.formatDamageFeedback(splashHit)}`);
      }
    }

    if (result.chainTarget && target) {
      this.playPassiveSkillSfxForDie(attacker, meta);
      const chainTargets = this.getChainJumpTargetsForArena(attacker, result.chainTarget, meta);
      let chainSource = target;
      for (const chainVictim of chainTargets) {
        if (chainVictim.isDestroyed) continue;
        const sourceCenter = this.getTileCenter(chainSource);
        const chainTargetCenter = this.getTileCenter(chainVictim);
        if (sourceCenter && chainTargetCenter) {
          AnimationManager.animateElectricChain(this, sourceCenter.x, sourceCenter.y, chainTargetCenter.x, chainTargetCenter.y, 220, this.getCombatPacingMultiplier());
        }
        const dealt = Math.max(1, Math.ceil((result.chainDamageAmount ?? meta.chainDamage ?? definition.attack) * this.getCombanityDamageMultiplier(attacker, chainVictim) * this.getDiceCardSkillDamageMultiplier(attacker)));
        const chainHit = this.applyDamageWithRevive(chainVictim.instanceId, dealt, { source: attacker });
        this.gameState = chainHit.state;
        this.showDamageText(chainVictim, chainHit.dealt, '#fff176');
        await this.applyDamageDefeatHooks(attacker, chainVictim, chainHit.defeated || chainHit.killed);
        this.addCombatActionDetail(`Electric chain hit ${this.getCombatDieName(chainVictim)} for ${this.formatDamageFeedback(chainHit)}`);
        chainSource = chainVictim;
      }
    }

    if (result.heatwaveDamageAmount !== undefined && attacker.gridPosition) {
      if (!result.splashTargets?.length) this.playSplashSfxForDie(attacker, meta);
      const enemyOwner = attacker.ownerId === 'player' ? 'enemy' : 'player';
      const attackerBoardSide = this.getBoardSideForDie(attacker);
      const heatwaveTargets = this.gameState.dice.filter((candidate) =>
        candidate.ownerId === enemyOwner && candidate.zone === 'board' && !candidate.isDestroyed && candidate.gridPosition &&
        this.getFootprintRowDistance(attacker, candidate) <= 1 &&
        (this.getBoardSideForDie(candidate) === attackerBoardSide
          ? this.getFootprintChebyshevDistance(attacker, candidate) <= 1
          : this.getDistanceWithBoardSides(attacker, candidate) <= 1));
      const heatwaveHits: Array<{ target: DiceInstanceState; dealt: number; critical?: boolean }> = [];
      for (const heatwaveTarget of heatwaveTargets) {
        const dealt = Math.max(1, Math.floor(result.heatwaveDamageAmount * this.getCombanityDamageMultiplier(attacker, heatwaveTarget) * this.getDiceCardSkillDamageMultiplier(attacker)));
        const heatwaveHit = this.applyDamageWithRevive(heatwaveTarget.instanceId, dealt, { source: attacker });
        this.gameState = heatwaveHit.state;
        this.showDamageText(heatwaveTarget, heatwaveHit.dealt, '#ff7a35');
        this.animateSkillEffect('heatwave', attacker, heatwaveTarget);
        await this.applyDamageDefeatHooks(attacker, heatwaveTarget, heatwaveHit.defeated || heatwaveHit.killed);
        heatwaveHits.push({ target: heatwaveTarget, dealt: heatwaveHit.dealt, critical: heatwaveHit.critical });
      }
      this.writeHeatwaveFeedback(attacker, heatwaveHits);
    }

    if (meta.hasPierce === true && target) {
      const pierceRange = Math.max(1, Math.floor(meta.pierceBehindRange ?? 1));
      const freshTarget = this.gameState.dice.find((die) => die.instanceId === target.instanceId && die.zone === 'board' && !die.isDestroyed && die.gridPosition);
      const pierceTargets = freshTarget ? this.getPierceBehindTargets(attacker, freshTarget, pierceRange) : [];
      if (pierceTargets.length > 0) this.playPassiveSkillSfxForDie(attacker, meta);
      for (const die of pierceTargets) {
        const pierceDamage = Math.max(1, Math.floor(definition.attack * this.getCombanityDamageMultiplier(attacker, die) * this.getDiceCardSkillDamageMultiplier(attacker)));
        const pierceHit = this.applyDamageWithRevive(die.instanceId, pierceDamage, { source: attacker });
        this.gameState = pierceHit.state;
        this.showDamageText(die, pierceHit.dealt, '#c9d6d3');
        await this.applyDamageDefeatHooks(attacker, die, pierceHit.defeated || pierceHit.killed);
        this.addCombatActionDetail(`Pierce hit ${this.getCombatDieName(die)} for ${this.formatDamageFeedback(pierceHit)}`);
      }
    }

    if (result.leonFuriousClaw && target) {
      const threshold = Math.max(0, meta.skillRangeThreshold ?? 2);
      const skillRangeLimit = Math.max(1, this.getEffectiveAttackRange(attacker, definition) - threshold);
      if (this.getAttackDistance(attacker, target) <= skillRangeLimit) {
        await this.executeLeonFuriousClaw(attacker, target, 1);
      }
    }
  }

  private async applyActiveSkillEffects(attacker: DiceInstanceState, target: DiceInstanceState | undefined, activeSlot: { key: string; title: string; manaNeeded: number; skillIndex?: number }) {
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition) return;
    const meta = getRuntimeSkillMetaForTrigger(definition, 'Active', activeSlot.skillIndex);
    const applyDirectDamage = (victim: DiceInstanceState, baseDamage: number): { dealt: number; absorbed: number; defeated: boolean; killed: boolean; critical: boolean } => {
      const skillAdjustedDamage = applySkillDamageModifiers(baseDamage, attacker, victim, meta);
      const multiplier = this.getCombanityDamageMultiplier(attacker, victim);
      const giantHunter = this.getGiantHunterBonus(attacker.ownerId, victim, 0.25);
      const adjustedDamage = Math.max(1, Math.floor(skillAdjustedDamage * multiplier * this.getDiceCardSkillDamageMultiplier(attacker)) + giantHunter);
      const directHit = this.applyDamageWithRevive(victim.instanceId, adjustedDamage, { proportionalDamage: giantHunter, source: attacker });
      this.gameState = directHit.state;
      return { dealt: directHit.dealt, absorbed: directHit.absorbed, defeated: directHit.defeated, killed: directHit.killed, critical: directHit.critical };
    };
    const classLevel = this.instanceClassLevels.get(attacker.instanceId) ?? 1;
    const currentMana = this.getActiveMana(attacker.instanceId, activeSlot.key);
    if (currentMana < activeSlot.manaNeeded || !this.isActiveManaEligibleThisTurn(attacker.instanceId, activeSlot.key)) {
      this.addCombatActionDetail('Building mana...');
      return;
    }
    const activePips = attacker.ownerId === 'player' ? (this.dicePips.get(attacker.instanceId) ?? 1) : (this.enemyDicePips.get(attacker.instanceId) ?? 1);
    const activeSkill = activeSlot.skillIndex === undefined
      ? getValidSkillDefinitions(definition).find((skill) => skill.type === 'Active')
      : getValidSkillDefinitions(definition)[activeSlot.skillIndex];
    const result = await this.combatOrchestrator.run(
      this.getCombatFlowContext('Active', attacker, target, 'Active', activeSkill?.title),
      () => executeActiveSkillEffects(attacker, definition, classLevel, target, currentMana, activeSlot, activePips),
      { needsMana: true }
    );
    await this.applyNuclearStrike(attacker, meta, definition);
    this.applySkillGrowth(attacker.instanceId, result);
    const didLock = !result.needsMana ? this.applySkillLocks(attacker, meta) : false;
    if (didLock) {
      const sfxKey = attacker.typeId === 'Death' && meta.instakill === true
        ? AUDIO_KEYS.deathInstakill
        : meta.activeSkillSfxKey ?? meta.skillSfxKey ?? AUDIO_KEYS.skillTrigger;
      AudioManager.playSfx(this, sfxKey);
    }

    if (result.needsMana) {
      this.addCombatActionDetail('Building mana...');
      this.addManaToAllActiveSlots(attacker);
    }

    if (result.transformToAlternateForm) {
      await this.transforms.transformToAlternateForm(attacker);
      this.resetActiveMana(attacker.instanceId, activeSlot.key);
      const transformed = this.gameState.dice.find((die) => die.instanceId === attacker.instanceId) ?? attacker;
      this.addCombatActionDetail(`${this.getCombatDieName(attacker)} transforms into ${this.getDefinitionForInstance(transformed)?.title ?? 'its alternate form'}!`);
      return;
    }

    if (result.summonType) {
      this.applySummonResult(attacker, result);
      this.resetActiveMana(attacker.instanceId, activeSlot.key);
      return;
    }

    if (result.meteorStrike) {
      const targetBoardSide: 'player' | 'enemy' = attacker.ownerId === 'player' ? 'enemy' : 'player';
      const enemyOwner: 'player' | 'enemy' = attacker.ownerId === 'player' ? 'enemy' : 'player';
      const meteorCount = Math.max(1, result.meteorStrike.meteorCount);
      const meteorRandomOrientation = result.meteorStrike.meteorRandomOrientation;
      const { damage: meteorDamage, poolType, poolDuration, poolPattern } = result.meteorStrike;
      let meteorCritical = false;
      let totalDamage = 0;
      const meteorHitsByVictim = new Map<string, { name: string; dealt: number; absorbed: number; critical: boolean }>();
      for (let meteorIndex = 0; meteorIndex < meteorCount; meteorIndex++) {
        const origin = meteorRandomOrientation
          ? { ...this.pickRandomGridTile(), boardSide: targetBoardSide }
          : this.pickRandomOccupiedTile(targetBoardSide, enemyOwner, true);
        if (!origin) break;
        const meteorBoardSide = origin.boardSide;
        this.animateMeteorImpact(meteorBoardSide, origin);
        await this.delayCombatVisualPaced(1000);
        const impactTiles = this.getPlusPatternTiles(origin);
        this.spawnPools(attacker, poolType, meteorBoardSide, origin, poolPattern, poolDuration);
        const meteorVictimIds = new Set<string>();
        for (const tile of impactTiles) {
          const victims = this.gameState.dice.filter((d) =>
            d.zone === 'board' && !d.isDestroyed && d.ownerId === enemyOwner
            && this.getBoardSideForDie(d) === meteorBoardSide
            && this.getFootprintCells(d).some((cell) => cell.row === tile.row && cell.col === tile.col));
          for (const victim of victims) {
            if (meteorVictimIds.has(victim.instanceId)) continue;
            meteorVictimIds.add(victim.instanceId);
            const hit = applyDirectDamage(victim, meteorDamage);
            this.showDamageText(victim, hit.dealt, '#ff9f58');
            await this.applyDamageDefeatHooks(attacker, victim, hit.defeated || hit.killed);
            const previousHit = meteorHitsByVictim.get(victim.instanceId);
            meteorHitsByVictim.set(victim.instanceId, {
              name: this.getCombatDieName(victim),
              dealt: (previousHit?.dealt ?? 0) + hit.dealt,
              absorbed: (previousHit?.absorbed ?? 0) + hit.absorbed,
              critical: Boolean(previousHit?.critical || hit.critical)
            });
            if (hit.critical) meteorCritical = true;
            totalDamage += hit.dealt;
          }
        }
        this.renderPools();
      }
      const meteorHits = [...meteorHitsByVictim.values()];
      meteorHits.forEach((hit) => {
        this.addCombatActionDetail(`Meteor hit ${hit.name} for ${this.formatDamageFeedback(hit)}`);
      });
      const scorchedNames = [...new Set(meteorHits.map((hit) => hit.name))];
      const scorchedLabel = scorchedNames.length > 0
        ? ` marked ${scorchedNames.join(', ')}`
        : '';
      this.writeCombatLog(`☄️ ${this.getCombatDieName(attacker)} meteor scorches ${meteorHits.length} foe${meteorHits.length === 1 ? '' : 's'}${scorchedLabel} in + patterns for ${formatCombatAmount(totalDamage, meteorCritical, 'total damage')} and leaves lava!`);
      this.resetActiveMana(attacker.instanceId, activeSlot.key);
      return;
    }

    if (result.instakill) {
      const freshTarget = target ? this.gameState.dice.find(d => d.instanceId === target.instanceId) : undefined;
      if (freshTarget && !freshTarget.isDestroyed) {
        const targetIsBoss = this.isBossDie(freshTarget);
        const reaperDamage = targetIsBoss
          ? Math.max(1, Math.floor((result.instakill.bossDamage ?? definition.attack)
            * this.getCombanityDamageMultiplier(attacker, freshTarget)
            * this.getDiceCardSkillDamageMultiplier(attacker)))
          : freshTarget.currentHealth;
        const instakillHit = this.applyDamageWithRevive(freshTarget.instanceId, reaperDamage, targetIsBoss ? { source: attacker } : { ignoreDamageReduction: true, ignoreShield: true, source: attacker });
        this.gameState = instakillHit.state;
        this.showDamageText(freshTarget, instakillHit.dealt, '#c57cff');
        await this.applyDamageDefeatHooks(attacker, freshTarget, instakillHit.defeated || instakillHit.killed);
        this.addCombatActionDetail(targetIsBoss
          ? `${activeSlot.title} hit ${this.getCombatDieName(freshTarget)} for ${this.formatDamageFeedback(instakillHit)}`
          : `${activeSlot.title} instantly defeated ${this.getCombatDieName(freshTarget)}`);
      }
      this.resetActiveMana(attacker.instanceId, activeSlot.key);
      return;
    }

    if (result.spearStrike) {
      const freshTarget = target ? this.gameState.dice.find(d => d.instanceId === target.instanceId) : undefined;
      if (freshTarget && !freshTarget.isDestroyed) {
        this.animateSpearActive(attacker, freshTarget);
        const hit = applyDirectDamage(freshTarget, result.spearStrike.damage);
        this.showDamageText(freshTarget, hit.dealt, '#dbe7e4');
        await this.applyDamageDefeatHooks(attacker, freshTarget, hit.defeated || hit.killed);
        this.addCombatActionDetail(`Spear hit ${this.getCombatDieName(freshTarget)} for ${this.formatDamageFeedback(hit)}`);
        for (const die of this.getPierceBehindTargets(attacker, freshTarget, result.spearStrike.pierceRange)) {
          const pierceHit = applyDirectDamage(die, result.spearStrike.pierceDamage);
          this.showDamageText(die, pierceHit.dealt, '#b58cff');
          await this.applyDamageDefeatHooks(attacker, die, pierceHit.defeated || pierceHit.killed);
          this.addCombatActionDetail(`Spear pierce hit ${this.getCombatDieName(die)} for ${this.formatDamageFeedback(pierceHit)}`);
        }
      }
      this.resetActiveMana(attacker.instanceId, activeSlot.key);
      return;
    }

    if (result.healTarget && result.healAmount !== undefined) {
      this.playSkillSfxForDie(attacker, meta);
      this.applySkillHealingResult(attacker, result, 'Active');
    }

    if (result.shieldGain !== undefined) {
      this.playSkillSfxForDie(attacker, meta);
      const shieldGain = Math.max(1, Math.ceil(result.shieldGain * this.getSkillSupportMultiplier(attacker)));
      this.grantShield(attacker, shieldGain);
      if (result.shieldTurns !== undefined) {
        const durationTurns = this.getSkillDurationTurns(result.shieldTurns);
        if (durationTurns !== undefined) this.shieldDurationTurnsByInstance.set(attacker.instanceId, durationTurns);
      }
      this.showHealText(attacker, shieldGain);
    }

    if (result.activeSplashDamageAmount !== undefined && target?.gridPosition) {
      const targetBoardSide = this.getBoardSideForDie(target);
      const splashTargets = this.getFootprintTargetsWithin(target, this.getLivingDiceOnBoardSide(targetBoardSide), 1);
      for (const splashTarget of splashTargets) {
        const hit = applyDirectDamage(splashTarget, result.activeSplashDamageAmount);
        this.showDamageText(splashTarget, hit.dealt, '#ff9f58');
        this.animateSkillEffect('fire', attacker, splashTarget);
        await this.applyDamageDefeatHooks(attacker, splashTarget, hit.defeated || hit.killed);
        this.addCombatActionDetail(`Active splash hit ${this.getCombatDieName(splashTarget)} for ${this.formatDamageFeedback(hit)}`);
      }
    }

    if (result.heatwaveDamageAmount !== undefined && target?.gridPosition) {
      const targetBoardSide = this.getBoardSideForDie(target);
      const heatwaveTargets = this.getFootprintTargetsWithin(target, this.getLivingDiceOnBoardSide(targetBoardSide), 1);
      const heatwaveHits: Array<{ target: DiceInstanceState; dealt: number; critical?: boolean }> = [];
      for (const heatwaveTarget of heatwaveTargets) {
        const hit = applyDirectDamage(heatwaveTarget, result.heatwaveDamageAmount);
        this.showDamageText(heatwaveTarget, hit.dealt, '#ff7a35');
        this.animateSkillEffect('heatwave', attacker, heatwaveTarget);
        await this.applyDamageDefeatHooks(attacker, heatwaveTarget, hit.defeated || hit.killed);
        heatwaveHits.push({ target: heatwaveTarget, dealt: hit.dealt, critical: hit.critical });
      }
      this.writeHeatwaveFeedback(attacker, heatwaveHits);
    }

    if (result.chainTarget) {
      const chainBoardSide = target ? this.getBoardSideForDie(target) : undefined;
      const firstChainTarget = result.chainTarget.instanceId !== target?.instanceId
        ? result.chainTarget
        : target && chainBoardSide
          ? this.findChainJumpTargetForArena(attacker, target, meta)
          : undefined;
      for (const chainVictim of this.getChainJumpTargetsForArena(attacker, firstChainTarget, meta)) {
        if (chainVictim.isDestroyed) continue;
        const hit = applyDirectDamage(chainVictim, result.chainDamageAmount ?? definition.attack);
        this.showDamageText(chainVictim, hit.dealt, '#fff176');
        this.animateSkillEffect('electric', attacker, chainVictim);
        await this.applyDamageDefeatHooks(attacker, chainVictim, hit.defeated || hit.killed);
        this.addCombatActionDetail(`Chain hit ${this.getCombatDieName(chainVictim)} for ${this.formatDamageFeedback(hit)}`);
      }
    }

    if (result.rapidFire) {
      const foeOwner = attacker.ownerId === 'player' ? 'enemy' : 'player';
      let totalDamage = 0;
      let hitCount = 0;
      let defeatedCount = 0;
      let anyCritical = false;
      const hitsByVictim = new Map<string, { name: string; dealt: number; absorbed: number; critical: boolean }>();
      for (let shot = 0; shot < result.rapidFire.hits; shot++) {
        const livingFoes = this.gameState.dice.filter((die) =>
          die.ownerId === foeOwner && die.zone === 'board' && !die.isDestroyed
        );
        const victim = securePick(livingFoes);
        if (!victim) break;
        const damage = Math.max(1, Math.floor(result.rapidFire.damage * this.getDiceCardSkillDamageMultiplier(attacker)));
        const hit = this.applyDamageWithRevive(victim.instanceId, damage, { source: attacker });
        this.gameState = hit.state;
        hitCount += 1;
        totalDamage += hit.dealt;
        anyCritical = anyCritical || hit.critical;
        if (hit.defeated || hit.killed) defeatedCount += 1;
        this.showDamageText(victim, hit.dealt, '#ff9f58');
        await this.applyDamageDefeatHooks(attacker, victim, hit.defeated || hit.killed);
        const previous = hitsByVictim.get(victim.instanceId);
        hitsByVictim.set(victim.instanceId, {
          name: this.getCombatDieName(victim),
          dealt: (previous?.dealt ?? 0) + hit.dealt,
          absorbed: (previous?.absorbed ?? 0) + hit.absorbed,
          critical: Boolean(previous?.critical || hit.critical)
        });
      }
      [...hitsByVictim.values()].forEach((hit) => {
        this.addCombatActionDetail(`Slugfest hit ${hit.name} for ${this.formatDamageFeedback(hit)} damage`);
      });
      this.writeCombatLog(`💥 ${this.getCombatDieName(attacker)} unleashes Slugfest — ${hitCount} shot${hitCount === 1 ? '' : 's'} for ${formatCombatAmount(totalDamage, anyCritical, 'total damage')}${defeatedCount > 0 ? `, defeating ${defeatedCount}` : ''}!`);
      this.resetActiveMana(attacker.instanceId, activeSlot.key);
      return;
    }

    if (result.cardSwarm) {
      const definition = this.getDefinitionForInstance(attacker);
      const orbitMeta = definition ? getRuntimeSkillMeta(definition) : undefined;
      const hitCount = Math.max(0, Math.floor(result.cardSwarm.hits));
      let totalDamage = 0;
      let defeatedCount = 0;
      let anyCritical = false;
      for (let hitIndex = 0; hitIndex < hitCount; hitIndex++) {
        const livingFoes = this.gameState.dice.filter((die) => die.ownerId !== attacker.ownerId && die.zone === 'board' && !die.isDestroyed);
        const victim = securePick(livingFoes);
        if (!victim) break;
        const randomDamage = orbitMeta?.randomDamage
          ? secureRandomBetween(orbitMeta.randomDamage.min, orbitMeta.randomDamage.max)
          : Math.max(1, definition?.attack ?? 1);
        const damage = Math.max(1, Math.floor(randomDamage * result.cardSwarm.damageRate * this.getDiceCardSkillDamageMultiplier(attacker)));
        const hit = this.applyDamageWithRevive(victim.instanceId, damage, { source: attacker });
        this.gameState = hit.state;
        totalDamage += hit.dealt;
        anyCritical = anyCritical || hit.critical;
        if (hit.defeated || hit.killed) defeatedCount += 1;
        this.showDamageText(victim, hit.dealt, '#ffd84d');
        this.animateSkillEffect('physical', attacker, victim);
        await this.applyDamageDefeatHooks(attacker, victim, hit.defeated || hit.killed);
        this.addCombatActionDetail(`Card Swarm hit ${this.getCombatDieName(victim)} for ${this.formatDamageFeedback(hit)}`);
      }
      this.writeCombatLog(`🃏 ${this.getCombatDieName(attacker)} unleashes Card Swarm — ${hitCount} card${hitCount === 1 ? '' : 's'} for ${formatCombatAmount(totalDamage, anyCritical, 'total damage')}${defeatedCount > 0 ? `, defeating ${defeatedCount}` : ''}!`);
      this.resetActiveMana(attacker.instanceId, activeSlot.key);
      return;
    }

    if (result.directDamage) {
      const damageTargets = result.hitsAllFoes
        ? this.gameState.dice.filter((die) => die.ownerId === (attacker.ownerId === 'player' ? 'enemy' : 'player') && die.zone === 'board' && !die.isDestroyed)
        : result.hitsAllAllies
          ? this.gameState.dice.filter((die) => die.ownerId === attacker.ownerId && die.zone === 'board' && !die.isDestroyed)
          : [result.directDamage.target];
      const isDrizzleRain = attacker.typeId === 'Drizzle' && result.hitsAllFoes === true;
      for (const freshTarget of damageTargets) {
        if (freshTarget.isDestroyed) continue;
        if (isDrizzleRain) {
          const targetCenter = this.getTileCenter(freshTarget);
          if (targetCenter) {
            AnimationManager.animateDrizzleRain(this, targetCenter.x, targetCenter.y, this.getDieAccentColor(attacker), this.getCombatPacingMultiplier());
          }
        }
        const hit = applyDirectDamage(freshTarget, result.directDamage!.damage);
        this.showDamageText(freshTarget, hit.dealt, '#ffbf80');
        if (isDrizzleRain && !hit.defeated && !hit.killed) {
          const acidTurns = this.getDungeonCardEffectsForDie(attacker)?.acidRainTurns ?? 0;
          if (acidTurns > 0) {
            const basicDamage = Math.max(1, Math.floor(this.getDefinitionForInstance(attacker)?.attack ?? result.directDamage!.damage));
            this.applyStatusApplications([{ source: attacker, target: freshTarget, effect: 'poison', duration: acidTurns, damage: basicDamage }]);
          }
        }
        await this.applyDamageDefeatHooks(attacker, freshTarget, hit.defeated || hit.killed);
        this.addCombatActionDetail(`Active hit ${this.getCombatDieName(freshTarget)} for ${this.formatDamageFeedback(hit)}`);
      }
    }

    if (result.bonusAttacks && result.bonusAttacks > 0) {
      const recipient = result.grantAttacksToAlly !== undefined
        ? this.selectAllyAttackRecipient(attacker, this.gameState, result.grantAttacksToAlly, meta.activeSkillTargeting, result.grantAttacksToAllyRadius)
        : attacker;
      if (recipient) {
        this.gameState = {
          ...this.gameState,
          dice: this.gameState.dice.map((die) => die.instanceId === recipient.instanceId
            ? { ...die, attacksRemaining: die.attacksRemaining + result.bonusAttacks!, hasFinishedAttacking: false }
            : die)
        };
        this.recordGrantedAttackCount(recipient.instanceId, result.bonusAttacks);
        this.addCombatActionDetail(`${activeSlot.title} grants +${result.bonusAttacks} attack${result.bonusAttacks === 1 ? '' : 's'} to ${recipient.instanceId === attacker.instanceId ? 'itself' : this.getCombatDieName(recipient)}`);
      }
    }
    if (result.grantAttacksToFoe && result.grantAttacksToFoe > 0) {
      this.gameState = this.grantFoeAttacks(attacker, result.grantAttacksToFoe, this.gameState, meta.activeSkillTargeting);
      this.addCombatActionDetail(`${activeSlot.title} grants +${result.grantAttacksToFoe} attack${result.grantAttacksToFoe === 1 ? '' : 's'} to the opposing side`);
    }

    if (result.projectileCountIncrease !== undefined && result.projectileCountTurns !== undefined) {
      if (attacker.gridPosition) {
        const g = this.getGridContainerForDie(attacker);
        const x = g.x + attacker.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
        const y = g.y + attacker.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
        AnimationManager.animateElementalSkill(this, x, y, 'wind', { tint: 0x9fe7d9, animated: false }, this.getCombatPacingMultiplier());
      }
      const projectileCountIncrease = Number.isFinite(result.projectileCountIncrease) ? Math.max(0, result.projectileCountIncrease) : 0;
      const galeExtension = this.getDungeonCardEffectsForDie(attacker)?.galeDurationBonus ?? 0;
      const projectileCountTurns = (Number.isFinite(result.projectileCountTurns) ? Math.max(1, result.projectileCountTurns) : 1) + galeExtension;
      const count = Math.max(1, 1 + projectileCountIncrease);
      this.basicAttacksPerAttackByInstance.set(attacker.instanceId, { count, turns: projectileCountTurns });
      this.recordAttackCountEffect(attacker.instanceId, projectileCountIncrease);
    }

    if (result.attackCountIncrease !== undefined && result.attackCountTurns !== undefined) {
      if (attacker.gridPosition) {
        const g = this.getGridContainerForDie(attacker);
        const x = g.x + attacker.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
        const y = g.y + attacker.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
        AnimationManager.animateElementalSkill(this, x, y, 'wind', { tint: 0x9fe7d9, animated: false }, this.getCombatPacingMultiplier());
      }
      const attackCountIncrease = Number.isFinite(result.attackCountIncrease) ? Math.max(0, result.attackCountIncrease) : 0;
      const attackCountTurns = Number.isFinite(result.attackCountTurns) ? Math.max(1, result.attackCountTurns) : 1;
      const current = this.extraAttackTurnsByInstance.get(attacker.instanceId);
      this.extraAttackTurnsByInstance.set(attacker.instanceId, {
        extra: (current?.extra ?? 0) + attackCountIncrease,
        turns: Math.max(current?.turns ?? 0, attackCountTurns)
      });
      this.gameState = {
        ...this.gameState,
        dice: this.gameState.dice.map((die) => die.instanceId === attacker.instanceId
          ? { ...die, attacksRemaining: Math.max(0, die.attacksRemaining + attackCountIncrease), hasFinishedAttacking: false }
          : die)
      };
      this.recordAttackCountEffect(attacker.instanceId, attackCountIncrease);
      this.writeAttackCountFeedback(attacker, attackCountIncrease);
    }

    if (meta.disableManaGain && meta.skillDuration !== undefined && meta.skillDuration > 0) {
      const galeExtension = this.getDungeonCardEffectsForDie(attacker)?.galeDurationBonus ?? 0;
      this.manaPausedTurnsByInstance.set(attacker.instanceId, meta.skillDuration + galeExtension);
    }

    this.applyStatusApplications(result.statusApplications);
    this.resetActiveMana(attacker.instanceId, activeSlot.key);
  }

  private canConjureSoulFromDefeat(conjurer: DiceInstanceState, meta: ReturnType<typeof getRuntimeSkillMeta>, defeated: DiceInstanceState): boolean {
    if (!meta.canConjureSouls || conjurer.instanceId === defeated.instanceId) return false;
    const conjureType = meta.conjureType ?? 'ally';
    if (conjureType === 'both') return true;
    if (conjureType === 'ally') return conjurer.ownerId === defeated.ownerId;
    return conjurer.ownerId !== defeated.ownerId;
  }

  private getConjuredSoulCount(die: DiceInstanceState, meta = getRuntimeSkillMeta(this.getDefinitionForInstance(die)!)): number {
    if (meta.noMaxSouls || meta.soulBoostPercent !== undefined) {
      return this.soulDiceSoulsConjured.get(die.instanceId) ?? 0;
    }
    return this.deathAlliesDefeatedCount.get(die.instanceId) ?? 0;
  }

  private getScopeStacksForDie(die: DiceInstanceState): number {
    return Math.max(0, Math.floor(this.scopeStacksByInstance.get(die.instanceId) ?? 0));
  }

  private setConjuredSoulCount(die: DiceInstanceState, meta: ReturnType<typeof getRuntimeSkillMeta>, count: number) {
    if (meta.noMaxSouls || meta.soulBoostPercent !== undefined) {
      this.soulDiceSoulsConjured.set(die.instanceId, count);
      return;
    }
    this.deathAlliesDefeatedCount.set(die.instanceId, count);
  }

  private checkDeathTransformCondition(defeated: DiceInstanceState) {
    const soulDice = this.gameState.dice.filter((die) => {
      if (die.isDestroyed) return false;
      const def = this.getDefinitionForInstance(die);
      if (!def) return false;
      const meta = getRuntimeSkillMeta(def);
      return meta.canConjureSouls === true
        && meta.transformSoulCount === undefined
        && this.canConjureSoulFromDefeat(die, meta, defeated);
    });
    
    soulDice.forEach((soulDie) => {
      const baseDefinition = this.definitions.get(soulDie.typeId);
      if (!baseDefinition) return;
      const scaledDef = this.getDefinitionForInstance(soulDie);
      const scaledMeta = getRuntimeSkillMeta(scaledDef);
      if (!scaledMeta.canConjureSouls) return;
      
      const currentSouls = this.getConjuredSoulCount(soulDie, scaledMeta);
      this.setConjuredSoulCount(soulDie, scaledMeta, currentSouls + 1);
      const soulFestMultiplier = this.getDungeonCardEffectsForDie(soulDie)?.soulBonusMultiplier ?? 1;

      if (scaledMeta.soulBoostPercent) {
        const classLevel = this.instanceClassLevels.get(soulDie.instanceId) ?? 1;
        const classMultiplier = getClassMultiplier(classLevel);
        const baseAttack = baseDefinition.attack;
        const baseHealth = baseDefinition.health;
        const boostPerSoul = scaledMeta.soulBoostPercent * soulFestMultiplier;
        const totalBoost = boostPerSoul * (currentSouls + 1);
        const newAttack = Math.round((baseAttack * (1 + totalBoost)) * classMultiplier);
        const newMaxHealth = Math.round((baseHealth * (1 + totalBoost)) * classMultiplier);
        const boostedDefinition: DiceDefinition = { ...scaledDef, attack: newAttack, health: newMaxHealth };
        const effectiveMaxHealth = this.applyDungeonCardDefinitionForOwner(boostedDefinition, soulDie.ownerId, classLevel).health;
        const newCurrentHealth = resolveMaxHealthGainCurrentHealth(
          soulDie.currentHealth,
          soulDie.maxHealth,
          effectiveMaxHealth
        );
        
        this.gameState = {
          ...this.gameState,
          dice: this.gameState.dice.map((d) =>
            d.instanceId === soulDie.instanceId
              ? { ...d, attack: newAttack, maxHealth: effectiveMaxHealth, currentHealth: newCurrentHealth }
              : d
          )
        };
        this.instanceDefinitionOverrides.set(soulDie.instanceId, boostedDefinition);
      }
		
      const soulCenter = this.getTileCenter(soulDie);
      const defeatedCenter = this.getTileCenter(defeated);
      if (soulCenter && defeatedCenter) {
        AnimationManager.animateSoulHarvest(this, defeatedCenter.x, defeatedCenter.y, soulCenter.x, soulCenter.y, soulDie.ownerId === 'enemy', this.getCombatPacingMultiplier());
      }

      const capturedType = soulDie.ownerId === defeated.ownerId ? 'ally' : 'enemy';
      const capturedLabel = scaledMeta.conjureType === 'both'
        ? capturedType
        : scaledMeta.conjureType === 'enemy' ? 'enemy' : 'ally';
      const totalSoulBoostPercent = scaledMeta.soulBoostPercent === undefined
        ? undefined
        : formatPercent(scaledMeta.soulBoostPercent * soulFestMultiplier * (currentSouls + 1));
      const totalBoostText = totalSoulBoostPercent === undefined ? '' : `, +${totalSoulBoostPercent} total stats`;
      this.writeCombatLog(`${this.getCombatDieName(soulDie)} captured ${capturedLabel} soul from ${this.getCombatDieName(defeated)}! (${currentSouls + 1} souls${totalBoostText})`);
      AudioManager.playSfx(this, AUDIO_KEYS.soulHarvest);
    });
    
    const deathDice = this.gameState.dice.filter((die) => {
      if (die.isDestroyed) return false;
      if (this.transforms.hasIndex(die.instanceId) && !this.transforms.isTimed(die.instanceId)) return false;
      const def = this.getDefinitionForInstance(die);
      if (!def) return false;
      const meta = getRuntimeSkillMeta(this.getBaseDefinitionForInstance(die) ?? def);
      return meta.transformSoulCount !== undefined && this.canConjureSoulFromDefeat(die, meta, defeated);
    });

    deathDice.forEach((deathDie) => {
      const definition = this.getDefinitionForInstance(deathDie);
      const baseDefinition = this.getBaseDefinitionForInstance(deathDie) ?? definition;
      if (!definition || !baseDefinition) return;
      const meta = getRuntimeSkillMeta(baseDefinition);
      if (meta.transformSoulCount === undefined) return;
      const previous = this.getConjuredSoulCount(deathDie, meta);
      const cap = meta.transformSoulCount ?? meta.maxSouls ?? 2;
      const count = Math.min(cap, previous + 1);
      this.setConjuredSoulCount(deathDie, meta, count);
      const deathCenter = this.getTileCenter(deathDie);
      const defeatedCenter = this.getTileCenter(defeated);
      if (deathCenter && defeatedCenter) {
        AnimationManager.animateSoulHarvest(this, defeatedCenter.x, defeatedCenter.y, deathCenter.x, deathCenter.y, deathDie.ownerId === 'enemy', this.getCombatPacingMultiplier());
      }

      if (count >= cap) this.transforms.transformFromSoulCap(deathDie);
    });
  }

  private async applyOnTransformedSkillEffects(transformed: DiceInstanceState) {
    const definition = this.getDefinitionForInstance(transformed);
    if (!definition) return;
    const classLevel = this.instanceClassLevels.get(transformed.instanceId) ?? 1;
    const transformedSkill = getValidSkillDefinitions(definition).find((skill) => skill.type === 'OnTransformed');
    const result = await this.combatOrchestrator.run(
      this.getCombatFlowContext('OnTransformed', transformed, transformed, 'OnTransformed', transformedSkill?.title),
      () => executeOnTransformedSkillEffects(transformed, definition, classLevel),
      {}
    );
    this.applySkillGrowth(transformed.instanceId, result);
    this.applySummonResult(transformed, result);
    const onTransformedMeta = getRuntimeSkillMetaForTrigger(definition, 'OnTransformed');
    const onTransformedSkill = getValidSkillDefinitions(definition).find((skill) => skill.type === 'OnTransformed');
    const onTransformedUnlocked = getValidSkillDefinitions(definition).some((skill) => skill.type === 'OnTransformed'
      && (getSkillLockClass(skill) === undefined || classLevel >= getSkillLockClass(skill)!));
    if (onTransformedUnlocked) await this.applyNuclearStrike(transformed, onTransformedMeta, definition);
    this.applySkillLocks(transformed, onTransformedMeta);
    this.applyStatusApplications(result.statusApplications);
    if (result.specialAttackDamage !== undefined) {
      const target = result.specialAttackTarget ?? this.findNearestFoeIgnoringRange(transformed);
      if (target) {
        this.moveDieBesideTarget(transformed, target);
        const moved = this.gameState.dice.find((die) => die.instanceId === transformed.instanceId) ?? transformed;
        const targetCenter = this.getTileCenter(target);
        if (targetCenter) {
          AnimationManager.animateDoubleSwipe(this, targetCenter.x, targetCenter.y, this.getDieAccentColor(transformed), 280, this.getCombatPacingMultiplier());
          await this.delayCombatVisualPaced(120);
        }
        const maulDamage = Math.max(1, Math.floor(applySkillDamageModifiers(result.specialAttackDamage, moved, target, onTransformedMeta)
          * this.getCombanityDamageMultiplier(moved, target)
          * this.getDiceCardSkillDamageMultiplier(moved)));
        const hit = this.applyDamageWithRevive(target.instanceId, maulDamage, { source: moved });
        this.gameState = hit.state;
        this.showDamageText(target, hit.dealt, '#d79a4a');
        this.animateSkillEffect('physical', moved, target);
        await this.applyDamageDefeatHooks(moved, target, hit.defeated || hit.killed);
        const transformIndex = this.transforms.getIndex(moved.instanceId) ?? 0;
        this.writeCombatLog(`${this.getCombatDieName(moved)} after its ${this.formatOrdinal(transformIndex + 1)} transformation mauls ${this.getCombatDieName(target)} for ${this.formatDamageFeedback(hit)} damage!`);
      }
    }
    this.applySkillHealingResult(transformed, result, 'OnTransformed');
    const meta = getRuntimeSkillMeta(definition);
    const bonusAttacks = Number.isFinite(result.bonusAttacks) ? Math.max(0, result.bonusAttacks ?? 0) : 0;
    if (bonusAttacks > 0) {
      const recipient = result.grantAttacksToAlly !== undefined
        ? this.selectAllyAttackRecipient(transformed, this.gameState, result.grantAttacksToAlly, undefined, result.grantAttacksToAllyRadius)
        : transformed;
      if (recipient) {
        this.playSkillSfxForDie(transformed, meta);
        const turns = Number.isFinite(result.extraAttacksTurns) ? Math.max(1, result.extraAttacksTurns) : 1;
        this.recordAttackCountEffect(recipient.instanceId, bonusAttacks);
        this.writeAttackCountFeedback(recipient, bonusAttacks);
        const current = this.extraAttackTurnsByInstance.get(recipient.instanceId);
        this.extraAttackTurnsByInstance.set(recipient.instanceId, {
          extra: (current?.extra ?? 0) + bonusAttacks,
          turns: Math.max(current?.turns ?? 0, turns)
        });
        this.gameState = {
          ...this.gameState,
          dice: this.gameState.dice.map((die) => die.instanceId === recipient.instanceId
            ? { ...die, attacksRemaining: die.attacksRemaining + bonusAttacks, hasFinishedAttacking: false }
            : die)
        };
      }
    }
    if (result.grantAttacksToFoe && result.grantAttacksToFoe > 0) {
      this.gameState = this.grantFoeAttacks(transformed, result.grantAttacksToFoe, this.gameState);
    }
    if (result.extraEffects?.length) result.extraEffects.forEach((effect) => this.addCombatActionDetail(effect));
  }

  private handleDefeatedDie(defeated: DiceInstanceState, wasDefeated: boolean) {
    if (!wasDefeated) return;
    const eventId = this.defeatEventIdByInstance.get(defeated.instanceId);
    if (eventId !== undefined && this.processedDefeatEventIds.has(eventId)) return;
    if (eventId !== undefined) this.processedDefeatEventIds.add(eventId);
    this.checkDeathTransformCondition(defeated);
  }

  private async applyCombatEndSkills() {
    const boardDice = this.gameState.dice.filter((die) => die.zone === 'board' && !die.isDestroyed);
    for (const die of boardDice) {
      const definition = this.getDefinitionForInstance(die);
      if (!definition) continue;
      const classLevel = this.instanceClassLevels.get(die.instanceId) ?? 1;
      const endSkill = getValidSkillDefinitions(definition).find((skill) => skill.type === 'CombatEnd');
      const result = await this.combatOrchestrator.run(
        this.getCombatFlowContext('CombatEnd', die, undefined, 'CombatEnd', endSkill?.title),
        () => executeCombatEndSkillEffects(die, definition, classLevel),
        {}
      );
      const endMeta = getRuntimeSkillMetaForTrigger(definition, 'CombatEnd');
      if (endMeta.statusToOpposingHand === true && endMeta.statusEffect) {
        const turns = endMeta.statusEffect === 'disorientation'
          ? (endMeta.disorientationDuration ?? 1)
          : (endMeta.statusDuration ?? 1);
        this.pendingHandDisorientation.push({
          sourceInstanceId: die.instanceId,
          turns: Math.max(1, Math.floor(turns))
        });
      }
      const endSkillFired = Boolean(
        endSkill
        && (result.applyGrowth
          || result.summonType
          || result.specialAttackDamage !== undefined
          || result.bonusAttacks !== undefined
          || result.statusApplications?.length
          || result.missingHealRate !== undefined)
      );
      if (endSkillFired) this.playPhaseSkillSfxForDie(die, endMeta);
      this.applySummonResult(die, result);
      this.applySkillLocks(die, endMeta);
      this.applyStatusApplications(result.statusApplications);
      this.applySkillGrowth(die.instanceId, result);
      if (result.specialAttackDamage !== undefined) {
        await this.applySpecialSkillAttack(
          die,
          result.specialAttackDamage,
          result.specialAttackTarget,
          endMeta,
          'Combat-end attack',
          (target, feedback) => `${this.getCombatDieName(die)} hits ${this.getCombatDieName(target)} last for ${feedback} damage!`
        );
      }
      this.applySkillHealingResult(die, result, 'CombatEnd');

      if (result.bonusAttacks && result.bonusAttacks > 0) {
        const recipient = result.grantAttacksToAlly !== undefined
          ? this.selectAllyAttackRecipient(die, this.gameState, result.grantAttacksToAlly, undefined, result.grantAttacksToAllyRadius)
          : die;
        if (recipient) {
          this.recordGrantedAttackCount(recipient.instanceId, result.bonusAttacks);
          this.gameState = {
            ...this.gameState,
            dice: this.gameState.dice.map((candidate) => candidate.instanceId === recipient.instanceId
              ? { ...candidate, attacksRemaining: Math.max(0, candidate.attacksRemaining + result.bonusAttacks!), hasFinishedAttacking: false }
              : candidate)
          };
        }
      }
      if (result.grantAttacksToFoe && result.grantAttacksToFoe > 0) {
        this.gameState = this.grantFoeAttacks(die, result.grantAttacksToFoe, this.gameState);
      }
    }
  }

  private applyTimedSkillDecay() {
    this.lockTurnsByInstance.forEach((turns, instanceId) => {
      const nextTurns = turns - 1;
      if (nextTurns <= 0) this.unlockChainedDie(instanceId);
      else this.lockTurnsByInstance.set(instanceId, nextTurns);
    });
    (['player', 'enemy'] as const).forEach((ownerId) => {
      const locks = this.gridLockTurnsByOwner[ownerId];
      [...locks.entries()].forEach(([key, turns]) => {
        const nextTurns = turns - 1;
        if (nextTurns <= 0) locks.delete(key);
        else locks.set(key, nextTurns);
      });
    });
    this.retainedLockPositions.clear();
    this.lockTurnsByInstance.forEach((_turns, instanceId) => {
      const die = this.gameState.dice.find((candidate) => candidate.instanceId === instanceId && candidate.zone === 'board' && !candidate.isDestroyed);
      if (die?.gridPosition) this.retainedLockPositions.set(instanceId, { ...die.gridPosition });
    });
    this.statusEffects.decayRoundStatuses();
    this.extraAttackTurnsByInstance.forEach((value, key) => {
      const nextTurns = value.turns - 1;
      if (nextTurns <= 0) {
        this.extraAttackTurnsByInstance.delete(key);
      } else {
        this.extraAttackTurnsByInstance.set(key, { ...value, turns: nextTurns });
      }
    });
    this.attackMultiplierTurnsByInstance.forEach((value, key) => {
      const nextTurns = value.turns - 1;
      if (nextTurns <= 0) {
        this.attackMultiplierTurnsByInstance.delete(key);
      } else {
        this.attackMultiplierTurnsByInstance.set(key, { ...value, turns: nextTurns });
      }
    });
    this.basicAttacksPerAttackByInstance.forEach((value, key) => {
      const nextTurns = value.turns - 1;
      if (nextTurns <= 0) {
        this.basicAttacksPerAttackByInstance.delete(key);
      } else {
        this.basicAttacksPerAttackByInstance.set(key, { ...value, turns: nextTurns });
      }
    });
    this.manaPausedTurnsByInstance.forEach((turns, key) => {
      const nextTurns = turns - 1;
      if (nextTurns <= 0) {
        this.manaPausedTurnsByInstance.delete(key);
      } else {
        this.manaPausedTurnsByInstance.set(key, nextTurns);
      }
    });
    this.combanityAttackMultiplierByInstance.forEach((value, key) => {
      const nextTurns = value.turns - 1;
      if (nextTurns <= 0) {
        this.combanityAttackMultiplierByInstance.delete(key);
      } else {
        this.combanityAttackMultiplierByInstance.set(key, { ...value, turns: nextTurns });
      }
    });
    this.shieldDurationTurnsByInstance.forEach((turns, key) => {
      const nextTurns = turns - 1;
      if (nextTurns <= 0) {
        this.shieldDurationTurnsByInstance.delete(key);
        this.shieldHpByInstance.delete(key);
      } else {
        this.shieldDurationTurnsByInstance.set(key, nextTurns);
      }
    });
    const expiredPools: string[] = [];
    this.transforms.tickDurations();
    this.poolsByTile.forEach((pool, key) => {
      const nextTurns = pool.turns - 1;
      if (nextTurns <= 0) {
        expiredPools.push(key);
      } else {
        this.poolsByTile.set(key, { ...pool, turns: nextTurns });
      }
    });
    expiredPools.forEach((key) => this.poolsByTile.delete(key));
  }

  private applyFountainOfLoveCombatEndHealing() {
    const healed: Array<{ die: DiceInstanceState; amount: number }> = [];
    this.gameState = {
      ...this.gameState,
      dice: this.gameState.dice.map((die) => {
        if (die.isDestroyed) return die;
        const rate = this.fountainHealRateByOwner[die.ownerId];
        if (rate <= 0) return die;
        const amount = resolveCombatEndHealAmount(die.maxHealth, die.currentHealth, rate);
        if (amount <= 0) return die;
        healed.push({ die, amount });
        return { ...die, currentHealth: Math.min(die.maxHealth, die.currentHealth + amount) };
      })
    };
    healed.forEach(({ die, amount }) => {
      this.showHealText(die, amount);
      this.writeCombatLog(`${this.getQualifiedCombatDieName(die)} rejuvenates ${formatCompact(amount)} health from Fountain of Love.`);
    });
  }

  private async applyNuclearStrike(
    source: DiceInstanceState,
    meta: ReturnType<typeof getRuntimeSkillMeta>,
    definition: DiceDefinition,
    options: { allowRepeat?: boolean } = {}
  ): Promise<void> {
    if (meta.hasNuclear !== true || (!options.allowRepeat && this.nuclearUsedByInstance.has(source.instanceId)) || !source.gridPosition) return;
    this.nuclearUsedByInstance.add(source.instanceId);
    const enemyOwner: 'player' | 'enemy' = source.ownerId === 'player' ? 'enemy' : 'player';
    const origin = { row: source.gridPosition.row, col: GRID_SIZE - 1 - source.gridPosition.col };
    const { rows, cols } = getNuclearAreaDimensions(meta.nuclearArea);
    const top = origin.row - Math.floor(rows / 2);
    const left = origin.col - Math.floor(cols / 2);
    const damage = Math.max(1, Math.floor((meta.nuclearDamage ?? definition.attack) * this.getDiceCardSkillDamageMultiplier(source)));
    const victims = this.gameState.dice.filter((die) =>
      die.ownerId === enemyOwner && die.zone === 'board' && !die.isDestroyed && die.gridPosition
      && this.getFootprintCells(die).some((cell) => cell.row >= top && cell.row < top + rows && cell.col >= left && cell.col < left + cols)
    );
    let anyCritical = false;
    let totalDealt = 0;
    for (const victim of victims) {
      // Nuclear is ordinary outgoing damage: card attack scales it and the victim's mitigation still applies.
      const hit = this.applyDamageWithRevive(victim.instanceId, damage, { source });
      this.gameState = hit.state;
      anyCritical = anyCritical || hit.critical;
      totalDealt += hit.dealt;
      this.showDamageText(victim, hit.dealt, '#ff3b30');
      await this.applyDamageDefeatHooks(source, victim, hit.defeated || hit.killed);
      this.addCombatActionDetail(`Nuclear blast hit ${this.getCombatDieName(victim)} for ${this.formatDamageFeedback(hit)}`);
    }
    if (meta.nuclearPool) {
      for (let row = top; row < top + rows; row++) {
        for (let col = left; col < left + cols; col++) {
          if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) continue;
          this.spawnPools(source, meta.nuclearPool, enemyOwner, { row, col }, [[0, 0]], meta.nuclearPoolLifespan);
        }
      }
      this.renderPools();
    }
    this.playSkillSfxForDie(source, meta);
    this.animateNuclearMissile(enemyOwner, origin);
    const reportedDamage = victims.length > 0 ? totalDealt : damage;
    this.writeCombatLog(`☢️ ${this.getCombatDieName(source)} detonates a nuclear strike on the opposite board for ${formatCombatAmount(reportedDamage, anyCritical, victims.length > 1 ? 'total damage' : 'damage')}!`);
  }

  private applyPlagueResult(
    attacker: DiceInstanceState,
    defeated: DiceInstanceState,
    plague: { typeId: string; healthRate: number; attackRate: number }
  ): void {
    const classLevel = this.instanceClassLevels.get(attacker.instanceId) ?? 1;
    const base = this.definitions.get(plague.typeId);
    if (!base) return;
    const cardEffects = this.getDungeonCardEffectsForDie(attacker);
    const healthRate = cardEffects?.undeadHealthRate && cardEffects.undeadHealthRate > 0
      ? Math.max(0, Math.min(1, cardEffects.undeadHealthRate))
      : plague.healthRate;
    const ownerId = attacker.ownerId;
    const boardSide = this.getBoardSideForDie(defeated);
    const footprint = this.getFootprintForDefinition(base);
    const usedCells = this.collectOccupiedCellsOnBoardSide(boardSide);
    const spawn = resolvePlagueSpawn({
      baseDefinition: base,
      classLevel,
      healthRate,
      attackRate: plague.attackRate,
      defeatedPips: this.getPipsForDie(defeated),
      defeatedPosition: defeated.gridPosition,
      defeatedBoardSide: boardSide,
      footprint,
      gridSize: GRID_SIZE,
      isAvailable: (row, col) => this.canPlaceFootprint(row, col, footprint, usedCells)
    });
    if (!spawn) return;
    const { definition, pips, position, boardSide: spawnBoardSide } = spawn;
    const effectiveDefinition = this.applyDungeonCardDefinitionForOwner(definition, ownerId, classLevel);
    const maxHealth = Math.max(1, Math.floor(effectiveDefinition.health));
    const currentHealth = Math.max(1, Math.min(maxHealth, Math.round(maxHealth * healthRate)));
    const instanceId = `${ownerId}-${plague.typeId}-plague-${Date.now()}-${Phaser.Math.Between(1, 9999)}`;
    const spawned: DiceInstanceState = {
      instanceId,
      typeId: plague.typeId,
      ownerId,
      zone: 'board',
      maxHealth,
      currentHealth,
      isDestroyed: false,
      hasFinishedAttacking: true,
      attacksRemaining: 0,
      gridPosition: position
    };
    this.gameState = { ...this.gameState, dice: [...this.gameState.dice, spawned] };
    this.instanceDefinitionOverrides.set(instanceId, definition);
    this.instanceClassLevels.set(instanceId, classLevel);
    this.summonedByInstance.set(instanceId, attacker.instanceId);
    if (spawnBoardSide === ownerId) this.infiltratedBoardSideByInstance.delete(instanceId);
    else this.infiltratedBoardSideByInstance.set(instanceId, spawnBoardSide);
    if (ownerId === 'player') this.dicePips.set(instanceId, pips);
    else this.enemyDicePips.set(instanceId, pips);
    this.renderDice();
    this.renderEnemyDice();
    this.writeCombatLog(`${this.getQualifiedCombatDieName(attacker)} spreads the plague, raising ${this.getCombatDieName(spawned)} on its side!`);
  }

  private applySkillHealingResult(
    source: DiceInstanceState,
    result: { healAmount?: number; healTarget?: DiceInstanceState },
    skillType?: DiceSkillType
  ) {
    if (result.healAmount === undefined) return;
    const liveSource = this.gameState.dice.find((die) => die.instanceId === source.instanceId && !die.isDestroyed) ?? source;
    const requestedTarget = result.healTarget ?? liveSource;
    const liveTarget = this.gameState.dice.find((die) => die.instanceId === requestedTarget.instanceId && !die.isDestroyed);
    if (!liveTarget) return;
    const amount = Math.max(1, Math.ceil(result.healAmount * this.getSkillSupportMultiplier(liveSource, liveTarget)));
    const healResult = this.healDie(liveTarget.instanceId, amount, liveSource);
    if (healResult.healed <= 0) return;
    this.animateSkillEffect('heal', liveSource, liveTarget);
    const healAction = formatCombatHealingActionLabel(
      skillType,
      this.getCombatDieName(liveTarget),
      liveTarget.instanceId === liveSource.instanceId
    );
    this.addCombatActionDetail(`${healAction} for ${formatCombatAmount(healResult.healed, healResult.critical, 'health')}!`);
  }

  private applySummonResult(
    parent: DiceInstanceState,
    result: { summonType?: string; summonCount?: number; summonPattern?: Array<[number, number]>; summonAllowRoll?: boolean }
  ): DiceInstanceState[] {
    if (!result.summonType) return [];
    const summonedDice: DiceInstanceState[] = [];
    const summonCount = Math.max(1, Math.floor(result.summonCount ?? 1));
    for (let summonIndex = 0; summonIndex < summonCount; summonIndex++) {
      const summoned = this.summonDieForOwner(parent.ownerId, result.summonType, this.getSummonedMinionClassLevel(parent), {
        parent,
        pattern: result.summonPattern,
        allowRoll: result.summonAllowRoll
      });
      if (summoned) {
        summonedDice.push(summoned);
      }
    }
    if (summonedDice.length > 0) {
      this.addCombatActionDetail(`✨ ${this.getCombatDieName(parent)} summons ${summonedDice.length} ${result.summonType}${summonedDice.length === 1 ? '' : 's'}!`);
    } else {
      this.addCombatActionDetail(`${this.getCombatDieName(parent)} failed to summon ${result.summonType} (no room).`);
    }
    return summonedDice;
  }

  private summonDieForOwner(
    ownerId: 'player' | 'enemy',
    typeId: DiceTypeId,
    classLevel = 1,
    options: { parent?: DiceInstanceState; pattern?: Array<[number, number]>; allowRoll?: boolean; count?: number } = {}
  ): DiceInstanceState | undefined {
    try {
      const cachedDefinition = this.definitions.get(typeId)
        ?? (this.cache.json.get(`dice:${typeId}`) as DiceDefinition | undefined);
      if (!cachedDefinition) return undefined;
      if (!this.definitions.has(typeId)) {
        this.definitions.set(typeId, { ...cachedDefinition, skills: getValidSkillDefinitions(cachedDefinition) });
      }
      const baseDefinition = this.definitions.get(typeId) ?? cachedDefinition;
      const safeClassLevel = Math.max(1, Math.min(15, Math.floor(classLevel || 1)));
      const classDefinition = this.applyClassProgress(baseDefinition, safeClassLevel);
      if (!classDefinition) return undefined;
      const definition = this.applyDungeonCardDefinitionForOwner(classDefinition, ownerId, safeClassLevel);
      const footprint = this.getFootprintForDefinition(definition);
      const usedCells = this.collectOccupiedCells(ownerId);
      const safeRange = Math.max(1, Math.floor(definition.range ?? baseDefinition.range ?? 1));
      const pickColumn = () => ownerId === 'enemy'
        ? this.pickEnemyColumn(safeRange)
        : Phaser.Math.Between(0, Math.max(0, GRID_SIZE - footprint));
      const bounds = ownerId === 'enemy'
        ? { min: safeRange >= 7 ? 2 : safeRange >= 6 ? 1 : 0, max: GRID_SIZE - footprint }
        : undefined;
      const patternedCandidates = (options.pattern ?? []).flatMap(([rowOffset, colOffset]) => {
        const parentPosition = options.parent?.gridPosition;
        if (!parentPosition) return [];
        const row = parentPosition.row + Math.trunc(rowOffset);
        const col = parentPosition.col + Math.trunc(colOffset);
        const inBounds = row >= 0 && col >= 0 && row <= GRID_SIZE - footprint && col <= GRID_SIZE - footprint;
        return inBounds && this.canPlaceFootprint(row, col, footprint, usedCells) && (!bounds || (col >= bounds.min && col <= bounds.max))
          ? [{ row, col }]
          : [];
      }) ?? [];
      const position = patternedCandidates[0]
        ?? this.findRandomFootprintPosition(footprint, usedCells, pickColumn, bounds);
      if (!position || position.row < 0 || position.col < 0 || position.row >= GRID_SIZE || position.col >= GRID_SIZE) return undefined;
      const instanceId = `${ownerId}-${typeId}-summon-${Date.now()}-${Phaser.Math.Between(1, 9999)}`;
      const maxHealth = Math.max(1, Math.floor(definition.health ?? baseDefinition.health ?? 1));
      const bodySides = this.getDungeonCardBodySides(ownerId, typeId);
      const rolledPips = options.allowRoll ? secureRandomBetween(1, bodySides > 0 ? bodySides : 6) : undefined;
      const attacksRemaining = rolledPips === undefined ? 0 : this.computeAttackCount(instanceId, rolledPips);
      const minion: DiceInstanceState = {
        instanceId,
        ownerId,
        typeId,
        currentHealth: maxHealth,
        maxHealth,
        attacksRemaining,
        hasFinishedAttacking: attacksRemaining <= 0,
        isDestroyed: false,
        zone: 'board',
        gridPosition: { row: position.row, col: position.col }
      };
      this.gameState = { ...this.gameState, dice: [...this.gameState.dice, minion] };
      if (rolledPips !== undefined) this.setPipsForDie(minion, rolledPips);
      this.instanceClassLevels.set(instanceId, safeClassLevel);
      this.instanceDefinitionOverrides.set(instanceId, classDefinition);
      if (options.parent) this.summonedByInstance.set(instanceId, options.parent.instanceId);
      this.markFootprint(position.row, position.col, footprint, usedCells);
      return minion;
    } catch (error) {
      this.debug.warn('summonDieForOwner failed; no spawn happened.', { ownerId, typeId, classLevel, error });
      return undefined;
    }
  }

  private getSummonedMinionClassLevel(parent: DiceInstanceState): number {
    return this.instanceClassLevels.get(parent.instanceId) ?? 1;
  }

  private summonDeuciferBoss() {
    try {
      const baseDefinition = this.definitions.get('Deucifer');
      if (!baseDefinition) {
        this.debug.warn('Deucifer definition missing; boss not summoned.');
        return;
      }
      const definition = this.applyClassProgress(baseDefinition, 1);
      if (!definition) return;
      const maxHealth = Math.max(1, Math.floor(definition.health ?? baseDefinition.health ?? 1));
      const instanceId = `enemy-Deucifer-boss-${Date.now()}-${Phaser.Math.Between(1, 9999)}`;
      const boss: DiceInstanceState = {
        instanceId,
        ownerId: 'enemy',
        typeId: baseDefinition.typeId,
        currentHealth: maxHealth,
        maxHealth,
        attacksRemaining: 0,
        hasFinishedAttacking: false,
        isDestroyed: false,
        zone: 'hand',
        gridPosition: undefined
      };
      this.gameState = { ...this.gameState, dice: [...this.gameState.dice, boss] };
      this.enemyDicePips.set(instanceId, Phaser.Math.Between(1, 6));
      this.instanceClassLevels.set(instanceId, 1);
      this.deuciferBossPending = false;
      this.deuciferBossSummoned = true;
      if (this.activeChallenge === 'deucifer') this.turnLimit = Math.max(this.turnLimit, this.gameState.turn + 9);
      this.enemyLoadoutRevealed = true;
      this.writeCombatLog('Deucifer has spawned — defeat him within 10 bonus rounds!');
    } catch (error) {
      this.debug.warn('summonDeuciferBoss failed; no boss spawn.', { error });
      this.deuciferBossPending = false;
    }
  }

  private healDie(instanceId: string, amount: number, source?: DiceInstanceState): { healed: number; appliedHealed: number; critical: boolean } {
    const target = this.gameState.dice.find((die) => die.instanceId === instanceId && !die.isDestroyed);
    if (!target || amount <= 0) return { healed: 0, appliedHealed: 0, critical: false };
    const cardMultiplier = source ? this.getDungeonCardAttackMultiplier(source) : 1;
    const scaledAmount = cardMultiplier === 1 ? amount : Math.max(1, Math.ceil(amount * cardMultiplier));
    const critHeal = this.applyCriticalHealing(scaledAmount, source);
    const healing = resolveHealingFeedback(target.maxHealth, target.currentHealth, critHeal.amount);
    if (healing.total <= 0) return { healed: 0, appliedHealed: 0, critical: false };
    if (healing.applied > 0) {
      this.gameState = {
        ...this.gameState,
        dice: this.gameState.dice.map((die) => die.instanceId === instanceId
          ? { ...die, currentHealth: Math.min(die.maxHealth, die.currentHealth + healing.applied) }
          : die)
      };
    }
    this.showHealText(target, healing.total, critHeal.critical);
    return { healed: healing.total, appliedHealed: healing.applied, critical: critHeal.critical };
  }

  private async applyTurnBasedEffects() {
    const hooks = this.getStatusEffectHooks();
    await this.statusEffects.tickPoison(hooks);
    await this.statusEffects.tickIgnition(hooks);

    this.statusEffects.decayFracture();
  }

  private getSkillDurationTurns(rawTurns?: number): number | undefined {
    if (rawTurns === undefined) return undefined;
    if (!Number.isFinite(rawTurns)) return undefined;
    return Math.max(1, Math.floor(rawTurns));
  }

  private async returnDiceToHand() {
    this.gamePhase = { stage: 'placement' };
    this.handContainer.setVisible(true);
    this.statusEffects.clearTaunts();
    [...this.chainedByInstance.keys()].forEach((instanceId) => {
      if (!this.lockTurnsByInstance.has(instanceId)) this.chainedByInstance.delete(instanceId);
    });
    this.healingWaitByInstance.clear();
    this.healingRetryReadyByInstance.clear();
    this.avoidChanceIgnoredTargetByInstance.clear();
    this.combatTimeRemainingMs = COMBAT_TIME_LIMIT_MS;
    this.combatCountdownTriggered = false;
    this.updateCombatTimerUi();
    this.syncMusicEffects();
    this.placedDiceCount = 0;
    this.diceRolled = false;
    this.transforms.clearPipTriggers();
    this.dicePips.clear();
    this.enemyDicePips.clear();
    this.handDice.forEach((container) => container.destroy());
    this.handDice.clear();
    this.infiltratedBoardSideByInstance.clear();
    this.gridDropZones.forEach((zone) => zone.setVisible(true));
    this.renderDice();
    this.renderEnemyDice();
    this.syncBerserkSfxState();
	  
    const { width, height } = this.scale;
    const handY = height - 110;
    this.currentHandOrder = getAvailableHandDice(this.gameState, 'player').map((die) => die.instanceId);
    this.applyPendingHandDisorientation();
    const startX = (width - (this.currentHandOrder.length * 100)) / 2 + 50;
    const requiredDice = Math.min(25, this.currentHandOrder.length);

    this.currentHandOrder.forEach((instanceId, index) => {
      const handDie = this.gameState.dice.find((d) => d.instanceId === instanceId);
      if (!handDie) return;
      const definition = this.getDefinitionForInstance(handDie);
      if (!definition) return;

      const x = startX + index * 100;
      const dieContainer = this.createDraggableDie(instanceId, handDie.typeId, definition, x, handY, true);
      this.handDice.set(instanceId, dieContainer);
      this.handContainer.add(dieContainer);
      this.applyHandDieTransformVisual(dieContainer, handDie);
    });

    this.diceRolled = requiredDice === 0;
    if (requiredDice > 0) {
      this.rollAllButton.setInteractive({ useHandCursor: true });
      this.rollAllButton.setFillStyle(0xf4b860, 0.9);
      this.rollAllButtonLabel.setText('ROLL ALL!');
    } else {
      this.rollAllButton.disableInteractive();
      this.rollAllButton.setFillStyle(0x7f8c8d, 0.5);
      this.rollAllButtonLabel.setText('NO DICE');
    }
    this.rollAllButton.setVisible(true);
    this.rollAllButtonLabel.setVisible(true);
    this.rollHelperText.setVisible(true);

    this.debug.log('Dice returned to hand', { turn: this.gameState.turn });
    await this.delay(300);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.sys.isActive()) {
        resolve();
        return;
      }
      this.time.delayedCall(ms, () => resolve());
    });
  }

  private getTileCenter(die: DiceInstanceState): { x: number; y: number } | undefined {
    if (!die.gridPosition) return undefined;
    const grid = this.getGridContainerForDie(die);
    const footprintOffset = (this.getFootprintForDie(die) - 1) * (TILE_SIZE + TILE_GAP) / 2;
    return {
      x: grid.x + die.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2 + footprintOffset,
      y: grid.y + die.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2 + footprintOffset
    };
  }

  private getDieAccentColor(die: DiceInstanceState): number {
    const accent = this.getDefinitionForInstance(die)?.accent;
    if (!accent) return 0xffffff;
    const parsed = Number.parseInt(accent.replace('#', ''), 16);
    return Number.isFinite(parsed) ? parsed : 0xffffff;
  }

  private animateGrowthEffect(die: DiceInstanceState, success: boolean) {
    const center = this.getTileCenter(die);
    if (!center) return;
    const color = success && die.typeId === 'BrokenGrowth' ? 0x2ecc71 : this.getDieAccentColor(die);
    AnimationManager.animateGrowthTurn(this, center.x, center.y, color, success, this.getCombatPacingMultiplier());
  }

  private animateSkillEffect(kind: 'ice' | 'fire' | 'poison' | 'electric' | 'heal' | 'fracture' | 'heatwave' | 'physical', attacker: DiceInstanceState, target: DiceInstanceState) {
    const liveAttacker = this.gameState.dice.find((die) => die.instanceId === attacker.instanceId) ?? attacker;
    const liveTarget = this.gameState.dice.find((die) => die.instanceId === target.instanceId) ?? target;
    const attackerCenter = this.getTileCenter(liveAttacker);
    const targetCenter = this.getTileCenter(liveTarget);
    if (!attackerCenter || !targetCenter) return;
    const pacing = this.getCombatPacingMultiplier();
    if (kind === 'heal') {
      AnimationManager.animateHealingBeam(this, attackerCenter.x, attackerCenter.y, targetCenter.x, targetCenter.y, pacing);
      AnimationManager.animateHealingPulse(this, targetCenter.x, targetCenter.y, pacing);
      return;
    }
    if (kind === 'fracture') { AnimationManager.animateFracture(this, targetCenter.x, targetCenter.y, pacing); return; }
    if (kind === 'heatwave') { AnimationManager.animateHeatwave(this, targetCenter.x, targetCenter.y, pacing); return; }
    AnimationManager.animateElementalSkill(this, targetCenter.x, targetCenter.y, kind, { animated: false }, pacing);
  }

  private pickRandomGridTile(): { row: number; col: number } {
    return { row: Phaser.Math.Between(0, GRID_SIZE - 1), col: Phaser.Math.Between(0, GRID_SIZE - 1) };
  }

  private pickRandomOccupiedTile(
    boardSide: 'player' | 'enemy',
    ownerId?: 'player' | 'enemy',
    includeInfiltratedTargets = false
  ): { row: number; col: number; boardSide: 'player' | 'enemy' } | null {
    const candidates = this.gameState.dice.filter((die) => {
      if (die.zone !== 'board' || die.isDestroyed || !die.gridPosition) return false;
      if (ownerId !== undefined && die.ownerId !== ownerId) return false;
      const isOnRequestedBoard = this.getBoardSideForDie(die) === boardSide;
      const isInfiltratedTarget = includeInfiltratedTargets
        && ownerId !== undefined
        && this.infiltratedBoardSideByInstance.has(die.instanceId);
      return isOnRequestedBoard || isInfiltratedTarget;
    });
    if (candidates.length === 0) return null;
    const picked = candidates[Phaser.Math.Between(0, candidates.length - 1)]!;
    const cells = this.getFootprintCells(picked);
    const cell = cells[Phaser.Math.Between(0, cells.length - 1)];
    return cell ? { ...cell, boardSide: this.getBoardSideForDie(picked) } : null;
  }

  private getPlusPatternTiles(origin: { row: number; col: number }): Array<{ row: number; col: number }> {
    return [
      origin,
      { row: origin.row - 1, col: origin.col },
      { row: origin.row + 1, col: origin.col },
      { row: origin.row, col: origin.col - 1 },
      { row: origin.row, col: origin.col + 1 }
    ].filter((tile) => tile.row >= 0 && tile.row < GRID_SIZE && tile.col >= 0 && tile.col < GRID_SIZE);
  }

  private animateMeteorImpact(boardSide: 'player' | 'enemy', tile: { row: number; col: number }) {
    const targetGrid = boardSide === 'player' ? this.playerGridContainer : this.enemyGridContainer;
    const tx = targetGrid.x + tile.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const ty = targetGrid.y + tile.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    AnimationManager.animateMeteorImpact(this, tx, ty, TILE_SIZE, this.getCombatPacingMultiplier());
  }

  private animateNuclearMissile(boardSide: 'player' | 'enemy', tile: { row: number; col: number }) {
    const targetGrid = boardSide === 'player' ? this.playerGridContainer : this.enemyGridContainer;
    const tx = targetGrid.x + tile.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const ty = targetGrid.y + tile.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    AnimationManager.animateNuclearMissile(this, tx, ty, TILE_SIZE, this.getCombatPacingMultiplier());
  }

  private animateSkullRevive(die: DiceInstanceState) {
    if (die.typeId !== 'Skull' || !die.gridPosition) return;
    const grid = this.getGridContainerForDie(die);
    const x = grid.x + die.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const y = grid.y + die.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    AnimationManager.animateSkullRevive(this, x, y, this.getCombatPacingMultiplier());
  }

  private animateTransformEffect(die: DiceInstanceState) {
    if (!die.gridPosition) return;
    const grid = this.getGridContainerForDie(die);
    const x = grid.x + die.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const y = grid.y + die.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const visual = this.transforms.getTransformedVisual(die);
    const color = visual ? Phaser.Display.Color.HexStringToColor(visual.accent).color : this.getDieAccentColor(die);
    AnimationManager.animateTransform(this, x, y, color, visual?.symbol, this.getCombatPacingMultiplier());
  }

  private animateBasicAttackSequence(attacker: DiceInstanceState, target: DiceInstanceState, count = 1) {
    const attackCount = Math.max(1, Math.floor(count));
    const pacing = this.getCombatPacingMultiplier();
    const step = scaleAnimationDuration(120, pacing);
    for (let index = 0; index < attackCount; index++) {
      this.time.delayedCall(index * step, () => this.animateAttack(attacker, target));
    }
  }

  private animateAttack(attacker: DiceInstanceState, target: DiceInstanceState) {
    if (!attacker.gridPosition || !target.gridPosition) return;

    const attackerGrid = this.getGridContainerForDie(attacker);
    const targetGrid = this.getGridContainerForDie(target);

    const attackerX = attacker.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const attackerY = attacker.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const targetX = target.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const targetY = target.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;

    const worldAttackerX = attackerGrid.x + attackerX;
    const worldAttackerY = attackerGrid.y + attackerY;
    const worldTargetX = targetGrid.x + targetX;
    const worldTargetY = targetGrid.y + targetY;

    const definition = this.getDefinitionForInstance(attacker);
    const beamHex = this.transforms.getTransformedVisual(attacker)?.accent ?? definition?.accent ?? '#ff6b6b';
    const beamColor = Phaser.Display.Color.HexStringToColor(beamHex).color;
    AnimationManager.animateAttackBeam(
      this,
      worldAttackerX,
      worldAttackerY,
      worldTargetX,
      worldTargetY,
      beamColor,
      this.getCombatPacingMultiplier()
    );
  }

  private animateTranscendenceBeam(attacker: DiceInstanceState, target: DiceInstanceState, pattern: TranscendenceBeamPattern) {
    if (!attacker.gridPosition || !target.gridPosition) return;

    const attackerGrid = this.getGridContainerForDie(attacker);
    const targetGrid = this.getGridContainerForDie(target);

    const attackerX = attackerGrid.x + attacker.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const attackerY = attackerGrid.y + attacker.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const cellPitch = TILE_SIZE + TILE_GAP;
    const targetBoardSide = this.getBoardSideForDie(target);
    const targetNormalized = this.getTranscendenceGridPosition(target.gridPosition, targetBoardSide);
    const points: Array<{ row: number; col: number }> = [];
    for (let offset = -GRID_SIZE * 2; offset <= GRID_SIZE * 2; offset++) {
      const row = targetNormalized.row + pattern.rowStep * offset;
      const normalizedCol = targetNormalized.col + pattern.colStep * offset;
      if (row >= 0 && row < GRID_SIZE && normalizedCol >= 0 && normalizedCol < GRID_SIZE) {
        points.push({
          row,
          col: targetBoardSide === 'player' ? normalizedCol : GRID_SIZE - 1 - normalizedCol
        });
      }
    }
    const first = points[0] ?? target.gridPosition;
    const last = points[points.length - 1] ?? target.gridPosition;
    const lineStartX = targetGrid.x + first.col * cellPitch + TILE_SIZE / 2;
    const lineStartY = targetGrid.y + first.row * cellPitch + TILE_SIZE / 2;
    const lineEndX = targetGrid.x + last.col * cellPitch + TILE_SIZE / 2;
    const lineEndY = targetGrid.y + last.row * cellPitch + TILE_SIZE / 2;

    AnimationManager.animateTranscendenceBeamFx(this, attackerX, attackerY, lineStartX, lineStartY, lineEndX, lineEndY, Phaser.Math.Distance.Between(lineStartX, lineStartY, lineEndX, lineEndY), this.getCombatPacingMultiplier());
  }

  private animateSpearActive(attacker: DiceInstanceState, target: DiceInstanceState) {
    if (!attacker.gridPosition || !target.gridPosition) return;
    const attackerGrid = this.getGridContainerForDie(attacker);
    const targetGrid = this.getGridContainerForDie(target);
    const ax = attackerGrid.x + attacker.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const ay = attackerGrid.y + attacker.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const tx = targetGrid.x + target.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const ty = targetGrid.y + target.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    AnimationManager.animateSpearStrike(this, ax, ay, tx, ty, this.getCombatPacingMultiplier());
  }

  private renderEnemyDice() {
    const childrenToRemove: Phaser.GameObjects.GameObject[] = [];
    this.enemyGridContainer.each((child: Phaser.GameObjects.GameObject) => {
      if (child instanceof Phaser.GameObjects.Rectangle && child.getData('isDie')) childrenToRemove.push(child);
      if (child instanceof Phaser.GameObjects.Text && (child.name === 'die-info' || child.name === 'status-effect')) childrenToRemove.push(child);
      if (child instanceof Phaser.GameObjects.Graphics && (child.name === 'hp-bar' || child.name === 'ammo-bar' || child.name === 'mana-bar' || child.name === 'status-effect' || child.name === 'shield-bubble')) childrenToRemove.push(child);
    });
    childrenToRemove.forEach((child) => child.destroy());

    const enemyBoardDice = this.gameState.dice.filter((die) =>
      die.zone === 'board' && !die.isDestroyed && die.gridPosition && this.getBoardSideForDie(die) === 'enemy');
    enemyBoardDice.forEach((die: DiceInstanceState) => {
      if (die.gridPosition) this.renderDie(this.getGridContainerForDie(die), die, die.gridPosition.row, die.gridPosition.col, false);
    });
    const enemyDice = getBoardDice(this.gameState, 'enemy');
    const statusDice = enemyDice.length > 0 || !this.enemyLoadoutRevealed
      ? enemyDice
      : this.gameState.dice.filter((die) => die.ownerId === 'enemy' && !die.isDestroyed);
    this.renderDiceStatusPanel(this.enemyStatusPanel, statusDice, "OPPONENT'S DICE", false, 'enemy');
    this.renderGridLocks();
    this.bringEnemyFogToFront();
  }

  private renderDungeonCardOrbits() {
    const existing = new Map<string, { orbit: Phaser.GameObjects.Container; count: number }>();
    this.dungeonCardOrbitObjects.forEach((orbit) => {
      const dieInstanceId = orbit.getData('dieInstanceId') as string | undefined;
      if (dieInstanceId) existing.set(dieInstanceId, { orbit, count: Number(orbit.getData('orbitCount')) || 0 });
      else {
        this.tweens.killTweensOf(orbit);
        orbit.destroy();
      }
    });
    const nextOrbits: Phaser.GameObjects.Container[] = [];
    if (!this.areDungeonCardsEnabled() || !this.gameContainer) {
      existing.forEach(({ orbit }) => {
        this.tweens.killTweensOf(orbit);
        orbit.destroy();
      });
      this.dungeonCardOrbitObjects = [];
      return;
    }
    const symbols = ['♠', '♥', '♣', '♦', '★', '✦'];
    this.gameState.dice
      .filter((die) => die.ownerId === 'player' && die.zone === 'board' && !die.isDestroyed && die.gridPosition)
      .forEach((die) => {
        const count = Math.max(0, Math.floor(this.getDungeonCardEffectsForDie(die)?.cardOrbitCount ?? 0));
        const center = this.getTileCenter(die);
        if (count <= 0 || !center) return;
        const current = existing.get(die.instanceId);
        if (current && current.count === count) {
          current.orbit.setPosition(center.x, center.y);
          nextOrbits.push(current.orbit);
          existing.delete(die.instanceId);
          return;
        }
        if (current) {
          this.tweens.killTweensOf(current.orbit);
          current.orbit.destroy();
        }
        existing.delete(die.instanceId);
        const orbit = this.add.container(center.x, center.y).setDepth(21);
        const radius = Math.max(25, TILE_SIZE * 0.44);
        for (let index = 0; index < count; index++) {
          const angle = (index / count) * Math.PI * 2;
          const card = this.add.rectangle(0, 0, 13, 18, 0x101c2b, 0.96).setStrokeStyle(1, 0xffd84d, 0.9);
          const pip = this.add.text(0, 0, symbols[index % symbols.length], {
            fontFamily: 'Orbitron',
            fontSize: '8px',
            color: '#ffd84d'
          }).setOrigin(0.5);
          orbit.add(this.add.container(Math.cos(angle) * radius, Math.sin(angle) * radius, [card, pip]));
        }
        this.gameContainer.add(orbit);
        this.tweens.add({ targets: orbit, angle: 360, duration: 4800, repeat: -1 });
        orbit.setData('dieInstanceId', die.instanceId);
        orbit.setData('orbitCount', count);
        nextOrbits.push(orbit);
      });
    existing.forEach(({ orbit }) => {
      this.tweens.killTweensOf(orbit);
      orbit.destroy();
    });
    this.dungeonCardOrbitObjects = nextOrbits;
  }

  private renderDungeonScopeMarks() {
    this.dungeonScopeMarkers.forEach((marker) => marker.destroy());
    this.dungeonScopeMarkers = [];
    if (!this.areDungeonCardsEnabled() || !this.playerGridContainer || !this.gameContainer || this.dungeonCardState.scopeMarks.length === 0) return;
    const grid = this.playerGridContainer;
    const scale = Math.max(0.01, grid.scaleX || 1);
    this.dungeonCardState.scopeMarks.forEach((tileIndex) => {
      const row = Math.floor(tileIndex / GRID_SIZE);
      const col = tileIndex % GRID_SIZE;
      const x = grid.x + (col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2) * scale;
      const y = grid.y + (row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2) * scale;
      const marker = this.add.container(x, y).setDepth(18);
      const ring = this.add.circle(0, 0, Math.max(8, TILE_SIZE * 0.23 * scale), 0xffb347, 0.12).setStrokeStyle(2, 0xffd84d, 0.95);
      const crosshair = this.add.text(0, 0, '⌖', {
        fontFamily: 'Orbitron',
        fontSize: `${Math.max(12, Math.round(TILE_SIZE * 0.32 * scale))}px`,
        color: '#ffd84d'
      }).setOrigin(0.5).setAlpha(0.85);
      marker.add([ring, crosshair]);
      this.gameContainer.add(marker);
      this.dungeonScopeMarkers.push(marker);
    });
  }

  private bringEnemyFogToFront() {
    if (!this.enemyGridContainer || !this.enemyFogOverlay || !this.enemyFogText) return;
    this.enemyGridContainer.bringToTop(this.enemyFogOverlay);
    this.enemyGridContainer.bringToTop(this.enemyFogText);
  }

  private restoreEnemyFogForNewTurn() {
    this.enemyFogOverlay?.setVisible(true);
    this.enemyFogText?.setVisible(true);
    this.bringEnemyFogToFront();
  }

  private generateEnemyPositions() {
    const enemyHandDice = getAvailableHandDice(this.gameState, 'enemy');
    const usedCells = this.collectOccupiedCells('enemy');
    const placementRng = this.getDungeonEnemyPlacementRng();

    for (const die of enemyHandDice) {
      const definition = this.getDefinitionForInstance(die) ?? this.definitions.get(die.typeId);
      const range = definition?.range ?? 4;
      const footprint = this.getFootprintForDefinition(definition);
      const position = this.isBossDie(die)
        ? this.findRandomBossPosition(die, footprint, usedCells, placementRng)
        : this.findRandomFootprintPosition(footprint, usedCells, () => this.pickEnemyColumn(range, placementRng), { min: range >= 7 ? 2 : range >= 6 ? 1 : 0, max: GRID_SIZE - footprint }, placementRng);
      if (!position) continue;
      this.markFootprint(position.row, position.col, footprint, usedCells);
      this.gameState = placeDieOnBoard(this.gameState, die.instanceId, position.row, position.col);
    }
  }

  private pickEnemyColumn(range: number, rng?: () => number): number {
    const minimumColumn = range >= 7 ? 2 : range >= 6 ? 1 : 0;
    const constrained = (columns: number[]) => this.pickRandomColumn(columns.filter((column) => column >= minimumColumn), rng);
    switch (this.configDifficulty) {
      case 'Baby':
        return this.rollSeededChance(0.85, rng) ? constrained([0, 1, 2]) : this.rollSeededInt(minimumColumn, GRID_SIZE - 1, rng);
      case 'Easy':
        return this.rollSeededChance(0.82, rng) ? constrained([1, 2]) : Math.max(minimumColumn, 0);
      case 'Hard':
        if (range <= 3) return this.rollSeededChance(0.75, rng) ? constrained([0, 1]) : this.rollSeededInt(minimumColumn, GRID_SIZE - 1, rng);
        if (range >= 5) return this.rollSeededChance(0.8, rng) ? constrained([2, 3, 4]) : this.rollSeededInt(minimumColumn, GRID_SIZE - 1, rng);
        return this.rollSeededInt(minimumColumn, GRID_SIZE - 1, rng);
      case 'Nightmare':
		if (this.shouldNightmareTakeInitiative()) {
          if (range >= 5) return constrained([0, 1, 2]);
          if (range === 4) return constrained([0, 1, 2]);
          return 0;
        }
        if (range <= 3) return 0;
        if (range === 4) return 1;
        if (range === 5) return 2;
        return constrained([3, 4]);
      case 'Medium':
      default:
        return this.rollSeededInt(minimumColumn, GRID_SIZE - 1, rng);
    }
  }

  private shouldNightmareTakeInitiative(): boolean {
    if (this.configDifficulty !== 'Nightmare') return false;
    const playerDice = this.gameState.dice.filter((die) => die.ownerId === 'player' && die.zone === 'board' && !die.isDestroyed && die.gridPosition);
    if (playerDice.length === 0) return false;
    const backlineCount = playerDice.filter((die) => (die.gridPosition?.col ?? GRID_SIZE) <= 1).length;
    const longRangeCount = playerDice.filter((die) => (this.getDefinitionForInstance(die)?.range ?? 0) >= 5).length;
    return backlineCount / playerDice.length >= 0.6 || (backlineCount >= 2 && longRangeCount >= 2);
  }

  private renderDiceCardInfoPanel() {
    this.diceCardInfoContainer?.destroy(true);
    const y = this.scale.height - 30;
    const c = this.add.container(0, 0).setDepth(350);
    this.diceCardInfoContainer = c;
    const tip = this.add.text(this.scale.width / 2 - 110, y - 70, '', { fontFamily: 'Orbitron', fontSize: '12px', color: '#fff2d8', backgroundColor: '#102030', padding: { x: 8, y: 6 }, wordWrap: { width: 210 } }).setDepth(351).setVisible(false);
    c.add(tip);
    const renderSide=(keys:string[], right:boolean)=>{
      keys.slice(-8).forEach((key, idx) => {
      const info = getDiceCardInfo(key, (typeId) => this.definitions.get(typeId)?.title);
      const px = right ? this.scale.width - 24 - (idx*24) : 24 + (idx*24);
      const icon = this.add.text(px, y, info.icon, { fontSize: '18px', color: info.color ?? '#ffffff' }).setOrigin(right ? 1 : 0, 1).setInteractive({ useHandCursor: true });
      icon.on('pointerover', () => { tip.setText(`${info.title} (${info.rarity})\n${info.desc}`).setVisible(true); });
      icon.on('pointerout', () => tip.setVisible(false));
      c.add(icon);
    });};
    if (this.areDungeonCardsEnabled()) {
      const grouped = new Map<string, { card: DungeonCard; count: number }>();
      this.dungeonCardState.cards.forEach((card) => {
        const current = grouped.get(card.key);
        grouped.set(card.key, { card, count: (current?.count ?? 0) + 1 });
      });
      const entries = [...grouped.values()];
      const perRow = Math.max(8, Math.floor((this.scale.width / 2 - 48) / 32));
      const rows = Math.max(1, Math.ceil(entries.length / perRow));
      entries.forEach(({ card, count }, idx) => {
        const typeName = this.getDungeonCardTypeName(card.typeId);
        const row = Math.floor(idx / perRow);
        const column = idx % perRow;
        const px = 24 + column * 32;
        const py = y - row * 24;
        const presentation = getDungeonCardPresentation(card, typeName, count);
        const icon = this.add.text(px, py, presentation.icon, { fontSize: '18px', color: presentation.color }).setOrigin(0, 1).setInteractive({ useHandCursor: true });
        const stack = this.add.text(px + 17, py - 2, `×${count}`, { fontFamily: 'Orbitron', fontSize: '9px', color: presentation.color }).setOrigin(0, 1);
        icon.on('pointerover', () => {
          tip.setText(presentation.tooltip).setVisible(true);
        });
        icon.on('pointerout', () => tip.setVisible(false));
        c.add([icon, stack]);
      });
      const required = getDungeonCardKillsRequired(this.dungeonCardState);
      c.add(this.add.text(24, y - 58 - Math.max(0, rows - 1) * 24, `DUNGEON CARDS ${this.dungeonCardState.cards.length}  •  ${this.dungeonCardState.killsTowardNext}/${required} KILLS${this.dungeonCardState.pendingDraws > 0 ? `  •  ${this.dungeonCardState.pendingDraws} DRAW READY` : ''}`, {
        fontFamily: 'Orbitron', fontSize: '10px', color: '#ffd7a3'
      }).setOrigin(0, 1));
      return;
    }
    if (this.activeRandomModifier === 'DiceCard') {
      const playerCardKeys = [...this.activeDiceCardKeysByOwner.player];
      const enemyCardKeys = [...this.activeDiceCardKeysByOwner.enemy];
      renderSide(playerCardKeys, false);
      renderSide(enemyCardKeys, true);
    }
  }

  private renderDice() {
    const childrenToRemove: Phaser.GameObjects.GameObject[] = [];
    this.playerGridContainer.each((child: Phaser.GameObjects.GameObject) => {
      if (child instanceof Phaser.GameObjects.Rectangle && child.getData('isDie')) {
        childrenToRemove.push(child);
      }
      if (child instanceof Phaser.GameObjects.Text && child.name !== '') {
        childrenToRemove.push(child);
      }
      if (child instanceof Phaser.GameObjects.Graphics && (child.name === 'hp-bar' || child.name === 'ammo-bar' || child.name === 'mana-bar' || child.name === 'status-effect' || child.name === 'shield-bubble')) {
        childrenToRemove.push(child);
      }
    });
    childrenToRemove.forEach(child => child.destroy());

    const playerBoardDice = this.gameState.dice.filter((die) =>
      die.zone === 'board' && !die.isDestroyed && die.gridPosition && this.getBoardSideForDie(die) === 'player');
    playerBoardDice.forEach((die: DiceInstanceState) => {
      if (die.gridPosition) this.renderDie(this.getGridContainerForDie(die), die, die.gridPosition.row, die.gridPosition.col, true);
    });
    this.renderDungeonCardOrbits();
    this.renderDungeonScopeMarks();
    const playerDice = getBoardDice(this.gameState, 'player');
    const playerLoadoutDice = this.gameState.dice.filter((die) => die.ownerId === 'player');
    const livingPlayerDice = playerLoadoutDice.filter((die) => !die.isDestroyed);
    const statusDice = this.activeChallenge === 'dungeon'
      ? playerLoadoutDice
      : this.gameState.turn > 1 || this.gameState.combatPhase === 'attacking'
        ? livingPlayerDice
        : playerDice;
    this.renderDiceStatusPanel(this.playerStatusPanel, statusDice, 'YOUR DICE', true, 'player');
    this.renderGridLocks();
  }

  private renderDiceStatusPanel(
    panel: Phaser.GameObjects.Container,
    dice: DiceInstanceState[],
    title: string,
    centered: boolean,
    side: 'player' | 'enemy'
  ) {
    if (!panel?.active) return;
    const previousOffset = this.dicePreviewViews[side]?.scrollOffset ?? 0;
    this.destroyDicePreviewView(side);
    panel.removeAll(true);
    const ownerName = centered ? this.playerDisplayName : this.enemyDisplayName;
    const metrics = getDicePreviewScrollMetrics(dice.length, previousOffset);
    const titleLabel = metrics.maxScroll > 0 ? `${title}  ↕ SCROLL` : title;
    panel.add(this.add.text(0, 0, ownerName, { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.text }).setOrigin(centered ? 0.5 : 0, 0));
    panel.add(this.add.text(0, 16, titleLabel, { fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.accentSoft }).setOrigin(centered ? 0.5 : 0, 0));
    const viewportTop = 36;
    const content = this.add.container(0, viewportTop - metrics.scrollOffset);
    panel.add(content);
    dice.forEach((diceUnit, index) => {
      const visual = this.transforms.getTransformedVisual(diceUnit);
      const def = this.getDefinitionForInstance(diceUnit);
      const baseDef = this.getBaseDefinitionForInstance(diceUnit) ?? def;
      const baseTitle = baseDef?.title ?? diceUnit.typeId;
      const dieTitle = baseTitle.endsWith('Dice') ? baseTitle.slice(0, -4).trim() : baseTitle;
      const classLevel = this.instanceClassLevels.get(diceUnit.instanceId) ?? 1;
      const shieldHp = this.shieldHpByInstance.get(diceUnit.instanceId) ?? 0;
      const shieldTag = shieldHp > 0 ? ` | SH ${formatCompact(shieldHp)}` : '';
      const status = diceUnit.isDestroyed ? 'DEFEATED' : `${formatCompact(diceUnit.currentHealth)}/${formatCompact(diceUnit.maxHealth)} HP${shieldTag}${visual?.symbol ? ` ${visual.symbol}` : ''}`;
      const dungeonElite = this.activeChallenge === 'dungeon' && this.isBossDie(diceUnit);
      const classLabel = dungeonElite
        ? ` D${getDungeonEliteDieSides(this.dungeonWave)}`
        : classLevel > 15 ? ` C${classLevel}` : ` C${classLevel}/15`;
      const bodySides = this.getDungeonCardEffectsForDie(diceUnit)?.bodySides ?? 0;
      const bodyLabel = bodySides > 0 ? ` • D${bodySides}` : '';
      content.add(this.add.text(0, index * metrics.rowHeight, `${dieTitle}${bodyLabel}${classLabel}: ${status}`, { fontFamily: 'Orbitron', fontSize: '11px', color: diceUnit.isDestroyed ? PALETTE.danger : (visual?.accent ?? PALETTE.textMuted) }).setOrigin(centered ? 0.5 : 0, 0));
    });
    const left = centered ? panel.x - 190 : panel.x;
    const width = centered ? 380 : 240;
    const top = panel.y + viewportTop;
    const mask = this.make.graphics({ x: 0, y: 0 }, false);
    mask.fillStyle(0xffffff, 1).fillRect(left, top, width, metrics.viewportHeight);
    content.setMask(mask.createGeometryMask());
    content.y = viewportTop - metrics.scrollOffset;
    this.dicePreviewViews[side] = {
      content,
      mask,
      left,
      top,
      width,
      viewportTop,
      viewportHeight: metrics.viewportHeight,
      rowHeight: metrics.rowHeight,
      maxScroll: metrics.maxScroll,
      scrollOffset: metrics.scrollOffset
    };
  }

  private destroyDicePreviewView(side: 'player' | 'enemy') {
    const view = this.dicePreviewViews[side];
    if (!view) return;
    if (view.content.active) view.content.clearMask();
    view.mask.destroy();
    delete this.dicePreviewViews[side];
  }

  private destroyDicePreviewViews() {
    (['player', 'enemy'] as const).forEach((side) => this.destroyDicePreviewView(side));
    this.dicePreviewViews = {};
  }

  private releaseDicePreviewWheelHandler() {
    if (!this.dicePreviewWheelHandler) return;
    this.input.off('wheel', this.dicePreviewWheelHandler);
    this.dicePreviewWheelHandler = null;
  }

  private handleDicePreviewWheel(pointer: Phaser.Input.Pointer, dy: number) {
    if (this.modalContainer?.active || dy === 0) return;
    (['player', 'enemy'] as const).forEach((side) => {
      const view = this.dicePreviewViews[side];
      if (!view || view.maxScroll <= 0) return;
      if (pointer.x < view.left || pointer.x > view.left + view.width) return;
      if (pointer.y < view.top || pointer.y > view.top + view.viewportHeight) return;
      view.scrollOffset = Phaser.Math.Clamp(view.scrollOffset - dy * 0.45, 0, view.maxScroll);
      view.content.y = view.viewportTop - view.scrollOffset;
    });
  }

  private captureDungeonLoadoutSnapshot(): DungeonLoadoutEntry[] {
    return getDiceDefinitions(this).slice(0, 5).map((definition) => {
      const progress = getDiceProgress(this, definition.typeId);
      const classLevel = Math.max(1, Math.min(15, Math.floor(progress.classLevel || 1)));
      return {
        typeId: definition.typeId,
        classLevel,
        talentIndex: null
      };
    });
  }

  private resolveLoadoutTalentIndex(definition: DiceDefinition, classLevel: number): number | null {
    if (areTalentsSuppressedForChallenge(this.activeChallenge)) return null;
    const equipped = getEquippedTalentIndex(this, definition, classLevel);
    if (!this.singleplayer.shouldRandomizeLoadoutAndClassUps()) return equipped;
    const owned = getOwnedTalentIndices(this, definition, classLevel);
    if (owned.length === 0) return null;
    return securePick([null, ...owned]) ?? null;
  }

  private pickRandomLoadout(pool: DiceDefinition[], useDifficultyRarityRules: boolean): DiceDefinition[] {
    const weightedPool = useDifficultyRarityRules ? this.buildDifficultyWeightedPool(pool) : [...pool];
    const arr = [...weightedPool];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = secureRandomBetween(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    const selected: DiceDefinition[] = [];
    const used = new Set<string>();
    for (const def of arr) {
      if (selected.length >= 5) break;
      if (!used.has(def.typeId)) {
        selected.push(def);
        used.add(def.typeId);
      }
    }

    let safety = 0;
    while (selected.length < 5 && arr.length > 0 && safety++ < 100) {
      const pick = securePick(arr);
      if (!pick) continue;
      selected.push(pick);
    }

    return selected.slice(0, 5);
  }

  private pickDungeonEnemyDefs(allDefinitions: DiceDefinition[]): DiceDefinition[] {
    const count = Math.max(1, this.dungeonEnemyClasses.length);
    const resolveDefinition = (typeId: string): DiceDefinition | undefined => (
      this.definitions.get(typeId as DiceTypeId)
      ?? allDefinitions.find((definition) => definition.typeId === typeId)
      ?? (this.cache.json.get(`dice:${typeId}`) as DiceDefinition | undefined)
    );
    const bossDef = this.dungeonBoss ? resolveDefinition(this.dungeonBoss) : undefined;
    const minionType = this.dungeonBossRole === 'mini' ? this.dungeonBossMinionType : null;
    const minionDef = minionType ? resolveDefinition(minionType) : undefined;
    const pool = allDefinitions.filter((definition) =>
      definition.isBoss !== true && definition.typeId !== 'Imp' && definition.typeId !== 'Wizard'
    );
    const typeIds = pickDungeonEnemyTypeIds({
      eventKey: this.dungeonEventKey,
      wave: this.dungeonWave,
      count,
      poolTypeIds: pool.map((definition) => definition.typeId),
      bossTypeId: this.dungeonBoss,
      miniBossTypeId: this.dungeonBossRole === 'mini' ? this.dungeonBossMinionType : null
    });
    const byTypeId = new Map(pool.map((definition) => [definition.typeId, definition] as const));
    const selected = typeIds.flatMap((typeId) => {
      const definition = typeId === this.dungeonBoss
        ? bossDef
        : this.dungeonBossRole === 'mini' && typeId === this.dungeonBossMinionType
          ? minionDef
          : byTypeId.get(typeId) ?? resolveDefinition(typeId);
      return definition ? [definition] : [];
    });
    for (const definition of [...pool].sort((a, b) => (a.typeId < b.typeId ? -1 : a.typeId > b.typeId ? 1 : 0))) {
      if (selected.length >= count) break;
      selected.push(definition);
    }
    return selected.slice(0, count);
  }

  private pickDailySeededLoadout(pool: DiceDefinition[], label: string): DiceDefinition[] {
    const weighted = this.buildDifficultyWeightedPool(pool);
    const byId = new Map(weighted.map((d) => [d.typeId, d]));
    const unique = [...new Set(weighted.map((d) => d.typeId))].sort();
    const selected: DiceDefinition[] = [];
    for (let i = 0; i < 5 && unique.length > 0; i++) {
      const idx = getDailySeededIndex(this.activeDailyKey, `${label}-loadout-${i}`, unique.length);
      const typeId = unique.splice(idx, 1)[0];
      const def = byId.get(typeId);
      if (def) selected.push(def);
    }
    return selected.slice(0, 5);
  }

  private buildDifficultyWeightedPool(pool: DiceDefinition[]): DiceDefinition[] {
    const allowed = pool.filter((definition) => {
      if (this.configDifficulty === 'Baby') return definition.rarity !== 'Epic' && definition.rarity !== 'Legendary';
      if (this.configDifficulty === 'Easy') return definition.rarity !== 'Legendary';
      if (this.configDifficulty === 'Nightmare') return definition.rarity !== 'Common';
      return true;
    });

    const source = allowed.length >= 5 ? allowed : pool;
    return source.flatMap((definition) => {
      let weight = 2;
      if (this.configDifficulty === 'Hard' && definition.rarity === 'Common') weight = 1;
      if (this.configDifficulty === 'Nightmare' && definition.rarity === 'Uncommon') weight = 1;
      return Array.from({ length: weight }, () => definition);
    });
  }
	
  private async applyOnKillSkillEffects(attacker: DiceInstanceState, _defeated: DiceInstanceState, context?: { judgmentHammerDepth?: number }) {
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition) return;
    const meta = getRuntimeSkillMeta(definition);
    const classLevel = this.instanceClassLevels.get(attacker.instanceId) ?? 1;
    const onKillSkill = getValidSkillDefinitions(definition).find((skill) => skill.type === 'OnKill');
    const result = await this.combatOrchestrator.run(
      this.getCombatFlowContext('OnKill', attacker, _defeated, 'OnKill', onKillSkill?.title),
      () => executeOnKillSkillEffects(attacker, definition, classLevel, _defeated),
      {}
    );
    this.applySkillGrowth(attacker.instanceId, result);
    this.applySummonResult(attacker, result);
    if (result.plague) this.applyPlagueResult(attacker, _defeated, result.plague);
    const onKillMeta = getRuntimeSkillMetaForTrigger(definition, 'OnKill');
    this.applySkillLocks(attacker, onKillMeta);
    this.applyStatusApplications(result.statusApplications);
    if (result.specialAttackDamage !== undefined) {
      await this.applySpecialSkillAttack(
        attacker,
        result.specialAttackDamage,
        result.specialAttackTarget,
        onKillMeta,
        'On-kill attack',
        (target, feedback) => `${this.getCombatDieName(attacker)} sentences ${this.getCombatDieName(target)} for ${feedback} damage!`
      );
    }
    this.applySkillHealingResult(attacker, result, 'OnKill');

    if (result.bonusAttacks && result.bonusAttacks > 0) {
      this.playSkillSfxForDie(attacker, meta);
      const recipient = result.grantAttacksToAlly !== undefined
        ? this.selectAllyAttackRecipient(attacker, this.gameState, result.grantAttacksToAlly, undefined, result.grantAttacksToAllyRadius)
        : attacker;
      if (recipient) {
        this.gameState = {
          ...this.gameState,
          dice: this.gameState.dice.map((die) => {
            if (die.instanceId !== recipient.instanceId) return die;
            this.recordGrantedAttackCount(die.instanceId, result.bonusAttacks!);
            return { ...die, attacksRemaining: die.attacksRemaining + result.bonusAttacks!, hasFinishedAttacking: false };
          })
        };
      }
    }
    if (result.grantAttacksToFoe && result.grantAttacksToFoe > 0) {
      this.gameState = this.grantFoeAttacks(attacker, result.grantAttacksToFoe, this.gameState);
    }
    if (result.bonusDamage && result.bonusDamage > 0) {
      const current = this.basicAttackDamageBonusByInstance.get(attacker.instanceId) ?? 0;
      this.basicAttackDamageBonusByInstance.set(attacker.instanceId, current + result.bonusDamage);
      this.playSkillSfxForDie(attacker, meta);
    }
    if (result.hammerTarget && result.hammerDamage !== undefined) {
      const hammerDepth = context?.judgmentHammerDepth ?? 0;
      const canSpawnHammer = hammerDepth === 0
        || (result.canRetriggerSkill === true && hammerDepth < (result.maxSkillRetriggers ?? 10));
      if (canSpawnHammer) {
        this.playSkillSfxForDie(attacker, meta);
        await this.dropJudgmentHammer(attacker, result.hammerDamage, result.hammerRadius, hammerDepth);
      }
    }
  }

  private async dropJudgmentHammer(attacker: DiceInstanceState, damage: number, radius = 1, chainDepth = 0) {
    const enemyOwner = attacker.ownerId === 'player' ? 'enemy' : 'player';
    const weakest = getBoardDice(this.gameState, enemyOwner)
      .filter((die) => die.gridPosition)
      .sort((a, b) => a.currentHealth - b.currentHealth || a.maxHealth - b.maxHealth)[0];
    if (!weakest?.gridPosition) return;
    if (!this.sys.isActive()) return;
    const freshWeakest = this.gameState.dice.find((die) => die.instanceId === weakest.instanceId && die.zone === 'board' && !die.isDestroyed && die.gridPosition);
    if (!freshWeakest?.gridPosition) return;
    const centerPoint = this.getTileCenter(freshWeakest);
    if (!centerPoint) return;
    const hammerDuration = Math.max(90, Math.round(250 / (chainDepth + 1)));
    await AnimationManager.animateJudgmentHammer(this, centerPoint.x, centerPoint.y, hammerDuration, this.getCombatPacingMultiplier());
    if (!this.sys.isActive()) return;
    const victims = this.getFootprintTargetsWithin(freshWeakest, getBoardDice(this.gameState, enemyOwner), radius, true);
    const hammerMarkedName = this.getCombatDieName(freshWeakest);
    const hammerHits = new Map<string, { name: string; damage: number; critical: boolean }>();
    for (const die of victims) {
      const liveVictim = this.gameState.dice.find((candidate) => candidate.instanceId === die.instanceId && candidate.zone === 'board' && !candidate.isDestroyed && candidate.gridPosition);
      if (!liveVictim || hammerHits.has(die.instanceId)) continue;
      const dealt = Math.max(1, Math.floor(damage * this.getCombanityDamageMultiplier(attacker, liveVictim) * this.getDiceCardSkillDamageMultiplier(attacker)));
      const hammerHit = this.applyDamageWithRevive(die.instanceId, dealt, { source: attacker });
      this.gameState = hammerHit.state;
      this.showDamageText(die, hammerHit.dealt, '#ffd36f');
      await this.applyDamageDefeatHooks(attacker, die, hammerHit.defeated || hammerHit.killed, { judgmentHammerDepth: chainDepth + 1 });
      this.addCombatActionDetail(`Hammer hit ${this.getCombatDieName(die)} for ${this.formatDamageFeedback(hammerHit)}`);
      hammerHits.set(die.instanceId, { name: this.getCombatDieName(die), damage: hammerHit.dealt, critical: hammerHit.critical });
    }
    const struckHits = [...hammerHits.entries()].map(([instanceId, hit]) => ({ instanceId, ...hit }));
    const hammerTotalDamage = struckHits.reduce((sum, hit) => sum + hit.damage, 0);
    const struckNames = struckHits
      .filter((hit) => hit.instanceId !== freshWeakest.instanceId)
      .map((hit) => hit.name);
    const anyCritical = struckHits.some((hit) => hit.critical);
    const struckLabel = struckHits.length > 0
      ? `${struckNames.length > 0 ? ` striking ${struckNames.join(', ')}` : ''} for ${formatCombatAmount(hammerTotalDamage, anyCritical, 'total damage')}`
      : ' but strikes nothing';
    this.writeCombatLog(`⚖️ ${this.getCombatDieName(attacker)}'s Hammer marks ${hammerMarkedName}${struckLabel}!`);
  }

  private isWithinSupportRadius(source: DiceInstanceState, target: DiceInstanceState, radius: number | undefined): boolean {
    return isWithinGridRadius(source, target, radius, (die) => this.getFootprintForDie(die as DiceInstanceState));
  }

  private selectAllyAttackRecipient(source: DiceInstanceState, state: MatchBattleState, _bonus: number, skillTargeting?: DiceTargetingMode, radius?: number): DiceInstanceState | undefined {
    const definition = this.getDefinitionForInstance(source);
    const meta = definition ? getRuntimeSkillMeta(definition) : undefined;
    const mode = skillTargeting ?? meta?.grantAttacksTargeting ?? meta?.skillTargeting ?? 'Random';
    const candidates = state.dice
      .filter((die) => die.ownerId === source.ownerId && die.instanceId !== source.instanceId && die.zone === 'board' && !die.isDestroyed && Boolean(die.gridPosition))
      .filter((die) => this.isWithinSupportRadius(source, die, radius))
      .map((die) => ({ die: die as DiceInstanceState & { gridPosition: { row: number; col: number } }, distance: this.getAllyHealingDistance(source, die) }));
    return this.selectTargetCandidate(candidates, mode);
  }

  private selectFoeAttackRecipient(source: DiceInstanceState, state: MatchBattleState, skillTargeting?: DiceTargetingMode): DiceInstanceState | undefined {
    const definition = this.getDefinitionForInstance(source);
    const meta = definition ? getRuntimeSkillMeta(definition) : undefined;
    const mode = skillTargeting ?? meta?.grantAttacksToFoeTargeting ?? meta?.skillTargeting ?? 'Random';
    const targetOwner = source.ownerId === 'player' ? 'enemy' : 'player';
    const candidates = state.dice
      .filter((die) => die.ownerId === targetOwner && die.zone === 'board' && !die.isDestroyed && Boolean(die.gridPosition))
      .map((die) => ({ die: die as DiceInstanceState & { gridPosition: { row: number; col: number } }, distance: this.getAttackDistance(source, die) }));
    return this.selectTargetCandidate(candidates, mode);
  }

  private grantFoeAttacks(source: DiceInstanceState, amount: number, state: MatchBattleState, skillTargeting?: DiceTargetingMode): MatchBattleState {
    if (!Number.isFinite(amount) || amount <= 0) return state;
    const recipient = this.selectFoeAttackRecipient(source, state, skillTargeting);
    if (!recipient) return state;
    this.recordGrantedAttackCount(recipient.instanceId, amount);
    return {
      ...state,
      dice: state.dice.map((die) => die.instanceId === recipient.instanceId
        ? { ...die, attacksRemaining: die.attacksRemaining + amount, hasFinishedAttacking: false }
        : die)
    };
  }

  private async applyOnDeathSkillEffects(defeated: DiceInstanceState, _attacker: DiceInstanceState) {
    const definition = this.getDefinitionForInstance(defeated);
    if (!definition) return;
    const meta = getRuntimeSkillMeta(definition);
    const classLevel = this.instanceClassLevels.get(defeated.instanceId) ?? 1;
    const onDeathSkill = getValidSkillDefinitions(definition).find((skill) => skill.type === 'OnDeath');
    const result = await this.combatOrchestrator.run(
      this.getCombatFlowContext('OnDeath', defeated, _attacker, 'OnDeath', onDeathSkill?.title),
      () => executeOnDeathSkillEffects(defeated, definition, classLevel, _attacker),
      {}
    );
    this.applySkillGrowth(defeated.instanceId, result);
    this.applySummonResult(defeated, result);
    const onDeathMeta = getRuntimeSkillMetaForTrigger(definition, 'OnDeath');
    const onDeathUnlocked = getValidSkillDefinitions(definition).some((skill) => skill.type === 'OnDeath'
      && (getSkillLockClass(skill) === undefined || classLevel >= getSkillLockClass(skill)!));
    if (onDeathUnlocked) await this.applyNuclearStrike(defeated, onDeathMeta, definition, { allowRepeat: true });
    this.applySkillLocks(defeated, onDeathMeta, true);
    this.applyStatusApplications(result.statusApplications);
    if (result.specialAttackDamage !== undefined) {
      await this.applySpecialSkillAttack(
        defeated,
        result.specialAttackDamage,
        result.specialAttackTarget,
        onDeathMeta,
        'On-death attack',
        (target, feedback) => `${this.getCombatDieName(defeated)} leaves a nasty surprise for ${this.getCombatDieName(target)} after getting taken down, resulting in ${feedback} damage!`
      );
    }
    this.applySkillHealingResult(defeated, result, 'OnDeath');

    if (result.bonusAttacks && result.bonusAttacks > 0 && result.extraEffects?.length) {
      this.playSkillSfxForDie(defeated, meta);
      const ally = result.grantAttacksToAlly !== undefined ? this.selectAllyAttackRecipient(defeated, this.gameState, result.grantAttacksToAlly, undefined, result.grantAttacksToAllyRadius) : undefined;
      if (ally) {
        this.gameState = {
          ...this.gameState,
          dice: this.gameState.dice.map((die) => {
            if (die.instanceId !== ally.instanceId) return die;
            this.recordGrantedAttackCount(die.instanceId, result.bonusAttacks!);
            return { ...die, attacksRemaining: die.attacksRemaining + result.bonusAttacks!, hasFinishedAttacking: false };
          })
        };
      }
      result.extraEffects.forEach((effect) => this.addCombatActionDetail(effect));
    }
    if (result.grantAttacksToFoe && result.grantAttacksToFoe > 0) {
      this.gameState = this.grantFoeAttacks(defeated, result.grantAttacksToFoe, this.gameState);
    }
  }

  private playSkillSfxForDie(die: DiceInstanceState, providedMeta?: ReturnType<typeof getRuntimeSkillMeta>) {
    const definition = this.getDefinitionForInstance(die);
    if (!definition) return;
    const meta = providedMeta ?? getRuntimeSkillMeta(definition);
    AudioManager.playSfx(this, meta.skillSfxKey ?? AUDIO_KEYS.skillTrigger);
  }

  private playPhaseSkillSfxForDie(die: DiceInstanceState, meta: ReturnType<typeof getRuntimeSkillMeta>) {
    if (meta.skillSfxKey) AudioManager.playSfx(this, meta.skillSfxKey);
  }

  private playSplashSfxForDie(_die: DiceInstanceState, meta: ReturnType<typeof getRuntimeSkillMeta>) {
    if (meta.skillSfxKey) AudioManager.playSfx(this, meta.skillSfxKey);
  }

  private playPassiveSkillSfxForDie(die: DiceInstanceState, providedMeta?: ReturnType<typeof getRuntimeSkillMeta>) {
    const definition = this.getDefinitionForInstance(die);
    if (!definition) return;
    const meta = providedMeta ?? getRuntimeSkillMeta(definition);
    AudioManager.playSfx(this, meta.passiveSkillSfxKey ?? meta.skillSfxKey ?? AUDIO_KEYS.skillTrigger);
  }  private getTranscendenceGridPosition(position: { row: number; col: number }, boardSide: 'player' | 'enemy'): { row: number; col: number } {
    return {
      row: position.row,
      col: boardSide === 'player' ? position.col : GRID_SIZE - 1 - position.col
    };
  }

  private isOnTranscendencePattern(source: { row: number; col: number }, target: { row: number; col: number }, pattern: TranscendenceBeamPattern): boolean {
    const rowDelta = target.row - source.row;
    const colDelta = target.col - source.col;
    const crossProduct = rowDelta * pattern.colStep - colDelta * pattern.rowStep;
    if (crossProduct === 0) return true;
    const lineLength = Math.hypot(pattern.rowStep, pattern.colStep);
    return Math.abs(crossProduct) <= lineLength * 0.5;
  }

  private getTranscendenceBeamPattern(attacker: DiceInstanceState, target: DiceInstanceState): TranscendenceBeamPattern | null {
    if (!attacker.gridPosition || !target.gridPosition) return null;
    const attackerSide = this.getBoardSideForDie(attacker);
    const targetSide = this.getBoardSideForDie(target);
    const attackerPosition = this.getTranscendenceGridPosition(attacker.gridPosition, attackerSide);
    const targetPosition = this.getTranscendenceGridPosition(target.gridPosition, targetSide);
    const rowDiff = targetPosition.row - attackerPosition.row;
    const colDiff = targetPosition.col - attackerPosition.col;
    if (rowDiff === 0 && colDiff === 0) return null;

    const gcd = (a: number, b: number): number => {
      let left = Math.abs(a);
      let right = Math.abs(b);
      while (right !== 0) {
        const remainder = left % right;
        left = right;
        right = remainder;
      }
      return Math.max(1, left);
    };
    const divisor = gcd(rowDiff, colDiff);
    return {
      rowStep: -Math.trunc(colDiff / divisor),
      colStep: Math.trunc(rowDiff / divisor)
    };
  }

  private async executeTranscendenceBeam(attacker: DiceInstanceState, target: DiceInstanceState, pattern: TranscendenceBeamPattern): Promise<{ damage: number; targetDestroyed: boolean }> {
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition || !attacker.gridPosition || !target.gridPosition) {
      return { damage: 0, targetDestroyed: false };
    }

    const meta = getRuntimeSkillMeta(definition);
    const baseMeta = getRuntimeSkillMeta(this.getBaseDefinitionForInstance(attacker) ?? definition);
    const damage = meta.beamDamage ?? baseMeta.beamDamage ?? Math.max(1, definition.attack);
    const targetPos = this.getTranscendenceGridPosition(target.gridPosition, this.getBoardSideForDie(target));
    const enemyOwner = attacker.ownerId === 'player' ? 'enemy' : 'player';
    const targetBoardSide = this.getBoardSideForDie(target);
    const victims = this.gameState.dice.filter((die) =>
      die.ownerId === enemyOwner
      && die.zone === 'board'
      && !die.isDestroyed
      && Boolean(die.gridPosition)
      && this.getBoardSideForDie(die) === targetBoardSide
      && (die.instanceId === target.instanceId || this.getFootprintCells(die).some((cell) =>
        this.isOnTranscendencePattern(targetPos, this.getTranscendenceGridPosition(cell, targetBoardSide), pattern)))
    );

    let primaryDefeated = false;
    let totalDamage = 0;
    for (const die of victims) {
      const dealt = Math.max(1, Math.floor(damage * this.getCombanityDamageMultiplier(attacker, die) * this.getDiceCardSkillDamageMultiplier(attacker)));
      const beamHit = this.applyDamageWithRevive(die.instanceId, dealt, { source: attacker });
      this.gameState = beamHit.state;
      this.showDamageText(die, beamHit.dealt, '#9ff8ff');
      await this.applyDamageDefeatHooks(attacker, die, beamHit.defeated || beamHit.killed);
      this.addCombatActionDetail(`Beam hit ${this.getCombatDieName(die)} for ${this.formatDamageFeedback(beamHit)}`);
      totalDamage += beamHit.dealt;
      if (die.instanceId === target.instanceId) primaryDefeated = beamHit.defeated;
    }

    this.gameState = {
      ...this.gameState,
      dice: this.gameState.dice.map((die) => {
        if (die.instanceId !== attacker.instanceId) return die;
        return {
          ...die,
          attacksRemaining: 0,
          hasFinishedAttacking: true
        };
      })
    };
    this.animateTranscendenceBeam(attacker, target, pattern);
    return { damage: totalDamage, targetDestroyed: primaryDefeated };
  }


  private findTranscendenceBeamTarget(attacker: DiceInstanceState, preferredTarget?: DiceInstanceState): TranscendenceBeamLine | undefined {
    const definition = this.getDefinitionForInstance(attacker);
    const baseDefinition = this.getBaseDefinitionForInstance(attacker) ?? definition;
    if (!definition || !baseDefinition) return undefined;
    const triggerMeta = getRuntimeSkillMeta(baseDefinition);
    const activeMeta = getRuntimeSkillMeta(definition);
    if (!triggerMeta.hasBeam && !activeMeta.hasBeam) return undefined;
    if (!attacker.gridPosition || attacker.attacksRemaining <= 0) return undefined;

    const enemyOwner = attacker.ownerId === 'player' ? 'enemy' : 'player';
    const candidates = this.gameState.dice
      .filter((die): die is DiceInstanceState & { gridPosition: { row: number; col: number } } =>
        die.ownerId === enemyOwner
        && die.zone === 'board'
        && !die.isDestroyed
        && Boolean(die.gridPosition))
      .map((die) => ({ die, pattern: this.getTranscendenceBeamPattern(attacker, die), distance: this.getAttackDistance(attacker, die) }))
      .filter((entry): entry is { die: DiceInstanceState & { gridPosition: { row: number; col: number } }; pattern: TranscendenceBeamPattern; distance: number } => entry.pattern !== null);

    if (preferredTarget?.gridPosition && preferredTarget.ownerId === enemyOwner && !preferredTarget.isDestroyed) {
      const forced = candidates.find((entry) => entry.die.instanceId === preferredTarget.instanceId);
      if (forced) return { target: forced.die, pattern: forced.pattern };
    }

    const mode = activeMeta.targetingMode ?? definition.targetingMode ?? 'Nearest';
    const byNear = [...candidates].sort((a, b) => a.distance - b.distance || a.die.gridPosition.row - b.die.gridPosition.row || a.die.gridPosition.col - b.die.gridPosition.col);
    const byFar = [...candidates].sort((a, b) => b.distance - a.distance || b.die.gridPosition.row - a.die.gridPosition.row || b.die.gridPosition.col - a.die.gridPosition.col);
    if (mode === 'Furthest') return byFar[0] ? { target: byFar[0].die, pattern: byFar[0].pattern } : undefined;
    if (mode === 'Strongest') {
      const strongest = [...candidates].sort((a, b) => b.die.currentHealth - a.die.currentHealth || b.die.maxHealth - a.die.maxHealth || a.distance - b.distance)[0];
      return strongest ? { target: strongest.die, pattern: strongest.pattern } : undefined;
    }
    if (mode === 'Weakest') {
      const weakest = [...candidates].sort((a, b) => a.die.currentHealth - b.die.currentHealth || a.die.maxHealth - b.die.maxHealth || a.distance - b.distance)[0];
      return weakest ? { target: weakest.die, pattern: weakest.pattern } : undefined;
    }
    if (mode === 'Random') {
      const random = securePick(candidates);
      return random ? { target: random.die, pattern: random.pattern } : undefined;
    }
    return byNear[0] ? { target: byNear[0].die, pattern: byNear[0].pattern } : undefined;
  }


  private refreshHandDieVisuals() {
    this.handDice.forEach((container, instanceId) => {
      const die = this.getPlayerHandDie(instanceId);
      if (die) this.applyHandDieTransformVisual(container, die);
    });
  }

  private getEffectiveAttackRange(die: DiceInstanceState, definition = this.getDefinitionForInstance(die)): number {
    if (!definition) return 0;
    const transform = this.transforms.getFlags(die, definition);
    const activeTransformIndex = this.transforms.getIndex(die.instanceId);
    const transformedStats = activeTransformIndex !== undefined && transform.isTransformed
      ? definition.transformStats?.[activeTransformIndex]
      : undefined;
    const baseRange = transformedStats?.range !== undefined
      ? (definition.title === transformedStats.title ? definition.range : transformedStats.range)
      : definition.range;
    return getFootprintAdjustedRange(baseRange, this.getFootprintForDie(die));
  }

  private getRangeCoverageText(die: DiceInstanceState): string {
    const definition = this.getDefinitionForInstance(die);
    if (!definition || !die.gridPosition) return `${this.getCombatDieName(die)} range unavailable.`;
    const targetOwner = die.ownerId === 'player' ? 'enemy' : 'player';
    const range = Math.max(1, this.getEffectiveAttackRange(die, definition));
    const attackerFootprint = this.getFootprintForDie(die);
    const coveredTiles: string[] = [];
    const coveredColumns = new Set<number>();
    const coveredRows = new Set<number>();
    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const proxyTarget: DiceInstanceState = {
          ...die,
          instanceId: `${die.instanceId}:range-proxy:${targetOwner}:${row}:${col}`,
          ownerId: targetOwner,
          gridPosition: { row, col }
        };
        if (this.getAttackDistance(die, proxyTarget, attackerFootprint, 1) > range) continue;
        coveredTiles.push(`${row},${col}`);
        coveredColumns.add(col);
        coveredRows.add(row);
      }
    }
    const columnText = coveredColumns.size > 0 ? [...coveredColumns].sort((left, right) => left - right).map((col) => col + 1).join(', ') : 'none';
    const rowText = coveredRows.size === 0
      ? 'no rows'
      : coveredRows.size === GRID_SIZE
      ? 'all rows'
      : `rows ${[...coveredRows].sort((left, right) => left - right).map((row) => row + 1).join(', ')}`;
    const tintName = die.ownerId === 'player' ? 'blue' : 'red';
    return `${this.getCombatDieName(die)} C${this.instanceClassLevels.get(die.instanceId) ?? 1} range ${range}: ${tintName} coverage hits ${coveredTiles.length}/25 enemy tiles (columns ${columnText}, ${rowText}).`;
  }

  private formatShieldAbsorption(absorbed: number | undefined): string {
    return (absorbed ?? 0) > 0 ? ` (shield absorbed ${formatCompact(absorbed!)} damage!)` : '';
  }

  private formatDamageFeedback(hit: { dealt: number; absorbed?: number; critical?: boolean }, critical = hit.critical): string {
    return `${formatCombatAmount(hit.dealt, critical, 'damage')}${this.formatShieldAbsorption(hit.absorbed)}`;
  }

  private formatOrdinal(value: number): string {
    const mod100 = value % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
    switch (value % 10) {
      case 1: return `${value}st`;
      case 2: return `${value}nd`;
      case 3: return `${value}rd`;
      default: return `${value}th`;
    }
  }

  private writeHeatwaveFeedback(
    attacker: DiceInstanceState,
    hits: Array<{ target: DiceInstanceState; dealt: number; critical?: boolean }>
  ) {
    if (hits.length === 0) return;
    const sourceName = this.getCombatDieName(attacker);
    if (hits.length === 1) {
      const entry = hits[0];
      if (!entry) return;
      this.writeCombatLog(`${sourceName} scorches ${this.getCombatDieName(entry.target)} nearby for ${formatCombatAmount(entry.dealt, entry.critical, 'damage')}!`);
      return;
    }
    const victimText = hits.map(({ target, dealt }) => `${this.getCombatDieName(target)} (damage: ${formatCompact(dealt)})`);
    const totalDamage = hits.reduce((sum, hit) => sum + hit.dealt, 0);
    const anyCritical = hits.some((hit) => hit.critical);
    const victimList = `${victimText.slice(0, -1).join(', ')}${victimText.length > 2 ? ',' : ''} and ${victimText[victimText.length - 1] ?? ''}`;
    this.writeCombatLog(`${sourceName} scorches ${victimList} for ${formatCombatAmount(totalDamage, anyCritical, 'total damage')}!`);
  }

  private showDamageText(target: DiceInstanceState, amount: number, color = '#ffdf7a', textOverride?: string) {
    const critical = this.criticalDamageTextByInstance.delete(target.instanceId);
    const shieldAbsorbed = this.shieldDamageTextByInstance.get(target.instanceId) ?? 0;
    this.shieldDamageTextByInstance.delete(target.instanceId);
    const visibleDamage = Number(amount) || 0;
    if (critical) color = '#ff3333';
    if (!target.gridPosition || (visibleDamage <= 0 && shieldAbsorbed <= 0 && !textOverride)) return;
    const grid = this.getGridContainerForDie(target);
    const footprintOffset = (this.getFootprintForDie(target) - 1) * (TILE_SIZE + TILE_GAP) / 2;
    const x = grid.x + target.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2 + footprintOffset;
    const y = grid.y + target.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2 + footprintOffset - 18;
    const damageLabel = textOverride
      ?? (shieldAbsorbed > 0
        ? visibleDamage > 0 ? `-${formatCompact(visibleDamage)}\n(-${formatCompact(shieldAbsorbed)})` : `-${formatCompact(shieldAbsorbed)}`
        : `-${formatCompact(visibleDamage)}`);
    if (shieldAbsorbed > 0 && !textOverride && !critical) color = '#7ddcff';
    const text = this.add.text(x, y, damageLabel, {
      fontFamily: 'Orbitron',
      fontSize: '16px',
      color,
      stroke: '#071018',
      strokeThickness: 4
    }).setOrigin(0.5).setDepth(300);
    this.tweens.add({ targets: text, y: y - 24, alpha: 0, duration: 640, ease: 'Cubic.easeOut', onComplete: () => text.destroy() });
  }

  private showHeadshotText(target: DiceInstanceState) {
    if (!target.gridPosition) return;
    const grid = this.getGridContainerForDie(target);
    const footprintOffset = (this.getFootprintForDie(target) - 1) * (TILE_SIZE + TILE_GAP) / 2;
    const x = grid.x + target.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2 + footprintOffset;
    const y = grid.y + target.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2 + footprintOffset - 40;
    const text = this.add.text(x, y, 'HEADSHOT!', {
      fontFamily: 'Orbitron',
      fontSize: '24px',
      color: '#ff8a1f',
      stroke: '#071018',
      strokeThickness: 5
    }).setOrigin(0.5).setDepth(301);
    this.tweens.add({
      targets: text,
      y: y - 34,
      alpha: 0,
      duration: 900,
      ease: 'Cubic.easeOut',
      onComplete: () => text.destroy()
    });
  }

  private showHealText(target: DiceInstanceState, amount: number, critical = false) {
    const fallbackHand = target.ownerId === 'player' ? this.handDice.get(target.instanceId) : undefined;
    if (!target.gridPosition && !fallbackHand) return;
    const footprintOffset = target.gridPosition ? (this.getFootprintForDie(target) - 1) * (TILE_SIZE + TILE_GAP) / 2 : 0;
    const x = target.gridPosition
      ? (this.getGridContainerForDie(target)).x + target.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2 + footprintOffset
      : fallbackHand!.x;
    const y = target.gridPosition
      ? (this.getGridContainerForDie(target)).y + target.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2 + footprintOffset - 18
      : fallbackHand!.y - 24;
    const text = this.add.text(x, y, `+${formatCompact(amount)}`, {
      fontFamily: 'Orbitron',
      fontSize: '16px',
      color: critical ? '#006b2f' : '#7dff9f',
      stroke: '#071018',
      strokeThickness: 4
    }).setOrigin(0.5).setDepth(300);
    this.tweens.add({ targets: text, y: y - 24, alpha: 0, duration: 640, ease: 'Cubic.easeOut', onComplete: () => text.destroy() });
  }

  private clearRangeHighlights() {
    this.rangeHighlightObjects.forEach((obj) => obj.destroy());
    this.rangeHighlightObjects = [];
    this.highlightedRangeInstanceId = null;
  }

  private showRangeHighlights(die: DiceInstanceState) {
    const definition = this.getDefinitionForInstance(die);
    if (!definition || !die.gridPosition) return;

    if (this.highlightedRangeInstanceId === die.instanceId) {
      this.clearRangeHighlights();
      return;
    }

    this.clearRangeHighlights();
    this.highlightedRangeInstanceId = die.instanceId;
    const color = die.ownerId === 'player' ? 0x2f8cff : 0xff4d4d;
    const label = die.ownerId === 'player' ? 'BLUE' : 'RED';

    const renderOnGrid = (targetOwner: 'player' | 'enemy') => {
      const targetGrid = targetOwner === 'enemy' ? this.enemyGridContainer : this.playerGridContainer;
      for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
          const proxyTarget: DiceInstanceState = {
            ...die,
            instanceId: `${die.instanceId}:range-proxy:${targetOwner}:${row}:${col}`,
            ownerId: targetOwner,
            gridPosition: { row, col }
          };
          if (this.getAttackDistance(die, proxyTarget, undefined, 1) > this.getEffectiveAttackRange(die, definition)) continue;
          const x = col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
          const y = row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
          const highlight = this.add.rectangle(x, y, TILE_SIZE - 6, TILE_SIZE - 6, color, targetOwner === die.ownerId ? 0.16 : 0.24)
            .setStrokeStyle(2, color, targetOwner === die.ownerId ? 0.6 : 0.85);
          highlight.setName('range-highlight');
          const text = this.add.text(x, y, label, { fontFamily: 'Orbitron', fontSize: '10px', color: die.ownerId === 'player' ? '#9fd0ff' : '#ffaaaa' }).setOrigin(0.5);
          text.setName('range-highlight');
          targetGrid.add([highlight, text]);
          this.rangeHighlightObjects.push(highlight, text);
        }
      }
    };

    renderOnGrid(die.ownerId);
    renderOnGrid(die.ownerId === 'player' ? 'enemy' : 'player');
  }

  private renderDie(container: Phaser.GameObjects.Container, die: DiceInstanceState, row: number, col: number, isPlayer: boolean) {
    const definition = this.getDefinitionForInstance(die);
    if (!definition) return;

    const visual = this.transforms.getTransformedVisual(die);
    const accentHex = visual?.accent ?? definition.accent;
    const color = Phaser.Display.Color.HexStringToColor(accentHex).color;
    const x = col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const y = row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;

    const shieldHp = this.shieldHpByInstance.get(die.instanceId) ?? 0;
    if (shieldHp > 0) {
      const shieldBubble = this.add.graphics();
      shieldBubble.name = 'shield-bubble';
      shieldBubble.lineStyle(2, 0x3a8dde, 0.95);
      shieldBubble.fillStyle(0x1c4f8f, 0.22);
      shieldBubble.fillCircle(x, y, 28);
      shieldBubble.strokeCircle(x, y, 28);
      container.add(shieldBubble);
    }

    if (this.getActiveLockSource(die)) {
      const chain = this.add.graphics();
      chain.name = 'status-effect';
      chain.lineStyle(3, 0x9ed0ff, 0.95);
      chain.strokeCircle(x, y, 25);
      chain.lineStyle(2, 0xd7f0ff, 0.9);
      chain.beginPath();
      chain.moveTo(x - 22, y - 9);
      chain.lineTo(x + 22, y + 9);
      chain.moveTo(x - 22, y + 9);
      chain.lineTo(x + 22, y - 9);
      chain.strokePath();
      container.add(chain);
    }

    const footprint = this.getFootprintForDefinition(definition);
    const visualSize = footprint * TILE_SIZE + (footprint - 1) * TILE_GAP - 8;
    const centerX = x + (footprint - 1) * (TILE_SIZE + TILE_GAP) / 2;
    const centerY = y + (footprint - 1) * (TILE_SIZE + TILE_GAP) / 2;

    const dieRect = this.add.rectangle(centerX, centerY, visualSize, visualSize, color, visual ? 0.55 : 0.28)
      .setStrokeStyle(2, color)
      .setInteractive({ useHandCursor: true });
    dieRect.setData('isDie', true);
    dieRect.setData('dieInstanceId', die.instanceId);
    let lastPointerDownAt = -Infinity;
    dieRect.on('pointerdown', () => {
      const now = this.time.now;
      const definitionMeta = getRuntimeSkillMetaForTrigger(definition, 'Passive');
      if (isPlayer && definitionMeta.canBeDraggedPostCombat && now - lastPointerDownAt <= 350) {
        if (definitionMeta.canReversePips) this.beginPlacedReverseDrag(die, dieRect);
        else if (definitionMeta.canBeRepositioned) this.beginPlacedRepositionDrag(die, dieRect);
        lastPointerDownAt = -Infinity;
        return;
      }
      lastPointerDownAt = now;
      this.showRangeHighlights(die);
      this.combatLog.setText(this.getRangeCoverageText(die));
      this.showDieInfoPopup(die);
    });
    container.add(dieRect);

    const shortLabel = visual?.symbol ?? definition.typeId.slice(0, 3).toUpperCase();
    const label = this.add.text(centerX, centerY - 12, shortLabel, {
      fontFamily: 'Orbitron',
      fontSize: '11px',
      color: accentHex
    }).setOrigin(0.5);
    label.setName('die-info');
    container.add(label);

    const pips = this.gameState.combatPhase === 'attacking'
      ? Math.max(0, die.attacksRemaining)
      : (isPlayer
        ? (this.dicePips.get(die.instanceId) ?? this.getPipCount(die.typeId))
        : (this.enemyDicePips.get(die.instanceId) ?? this.getPipCount(die.typeId)));
    const pipLabel = this.add.text(centerX, centerY + 2, `${pips}♦`, {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.accent
    }).setOrigin(0.5);
    pipLabel.setName('die-info');
    container.add(pipLabel);
	
    this.renderStatusEffects(container, centerX, centerY, die);
    this.renderReverseIndicator(container, centerX, centerY, die, definition);
    this.renderHealthBar(container, centerX, centerY + 18, die.currentHealth, die.maxHealth);
    const ammo = Math.max(0, die.attacksRemaining);
    const maxAmmo = Math.max(1, this.gameState.combatPhase === 'attacking'
      ? Math.max(this.attackCapacityByInstance.get(die.instanceId) ?? 1, die.attacksRemaining)
      : this.getPipCount(die.typeId));
    this.attackCapacityByInstance.set(die.instanceId, maxAmmo);
    this.renderAmmoBar(container, centerX, centerY + 28, ammo, maxAmmo);
    const meta = getRuntimeSkillMeta(definition);
    const isTransformed = this.transforms.hasIndex(die.instanceId);
    const activeSlots = this.getActiveManaSlots(die);
    let nextBarY = centerY + 40;
    if (meta.canConjureSouls && !isTransformed) {
      const souls = this.getConjuredSoulCount(die, meta);
      const soulCap = meta.noMaxSouls ? Math.max(1, souls) : Math.max(1, meta.maxSouls ?? 2);
      this.renderManaBar(container, centerX, nextBarY, souls, soulCap, 0xc06bdb);
      if (activeSlots.length > 0) nextBarY += 7;
    }
    activeSlots.forEach((skill, index) => {
      const barColor = index === 0 ? 0x6fa8ff : 0x9ed0ff;
      this.renderManaBar(container, centerX, nextBarY + (index * 7), this.getActiveMana(die.instanceId, skill.key), skill.manaNeeded, barColor);
    });
  }

  private showDieInfoPopup(die: DiceInstanceState) {
    const liveDie = this.gameState.dice.find((candidate) => candidate.instanceId === die.instanceId) ?? die;
    const definition = this.getDefinitionForInstance(liveDie);
    if (!definition) return;
    if (this.dieInfoPopupInstanceId === liveDie.instanceId && this.dieInfoPopup) {
      this.dieInfoPopupTimer?.remove(false);
      this.dieInfoPopup.destroy(true);
      this.dieInfoPopup = null;
      this.dieInfoPopupInstanceId = null;
      return;
    }
    this.dieInfoPopupTimer?.remove(false);
    this.dieInfoPopup?.destroy(true);
    const { width } = this.scale;
    const activeBuffs = this.getActiveBuffSummaryForDie(liveDie);
    const attackCountBuffs = this.getAttackCountBuffLines(liveDie);
    const statusEffects = this.getStatusEffectSummaryForDie(liveDie);
    const baseDefinition = this.getBaseDefinitionForInstance(liveDie) ?? definition;
    const combatBaseDefinition = this.getCombatBaseDefinition(liveDie) ?? baseDefinition;
    const baseMeta = getRuntimeSkillMeta(combatBaseDefinition);
    const { isTransformed } = this.transforms.getFlags(liveDie, definition);
    const isAlternateTransformed = isTransformed;
    const activeTransformIndex = isAlternateTransformed ? this.transforms.getIndex(liveDie.instanceId) : undefined;
    const transformedStats = activeTransformIndex !== undefined ? baseDefinition.transformStats?.[activeTransformIndex] : undefined;
    const displayTitle = isAlternateTransformed && transformedStats?.title ? transformedStats.title : baseDefinition.title;
    const displayDefinition = isAlternateTransformed && transformedStats && activeTransformIndex !== undefined
      ? applyTransformStats(combatBaseDefinition, activeTransformIndex)
      : (isAlternateTransformed ? combatBaseDefinition : definition);
    const skillDefinition = isAlternateTransformed
      ? this.applyDungeonCardDefinitionForOwner(displayDefinition, liveDie.ownerId, this.instanceClassLevels.get(liveDie.instanceId) ?? 1)
      : definition;
    const offenseMultiplier = this.getOffenseMultiplier(liveDie);
    const skillDamageMultiplier = this.getDiceCardSkillDamageMultiplier(liveDie);
    const basicAttackBonus = this.getBasicAttackDamageBonus(liveDie);
    const effectiveAtk = applyStatModifiers(displayDefinition.attack, 1, basicAttackBonus, offenseMultiplier * this.getDungeonCardAttackMultiplier(liveDie));
    const soulCount = baseMeta.canConjureSouls ? this.getConjuredSoulCount(liveDie, baseMeta) : 0;
    const soulCap = baseMeta.maxSouls;
    const soulFestMultiplier = this.getDungeonCardEffectsForDie(liveDie)?.soulBonusMultiplier ?? 1;
    const soulBoost = baseMeta.soulBoostPercent !== undefined && soulCount > 0 ? ` (+${formatPercent(baseMeta.soulBoostPercent * soulFestMultiplier * soulCount)} stats)` : '';
    const soulNote = baseMeta.canConjureSouls ? `SOULS ${soulCount}${baseMeta.noMaxSouls || soulCap === undefined ? '' : `/${soulCap}`}${soulBoost}` : '';
    const scopeStacks = baseMeta.hasScope ? this.getScopeStacksForDie(liveDie) : 0;
    const scopeCap = baseMeta.maxScopeStacks;
    const scopeBonus = scopeStacks * Math.max(0, baseMeta.scopeDamageIncreasePerStack ?? 0);
    const scopeNote = baseMeta.hasScope
      ? `SCOPE ${scopeStacks}${scopeCap === undefined ? '' : `/${scopeCap}`}${scopeBonus > 0 ? ` (+${formatPercent(scopeBonus)} scope damage)` : ''}`
      : '';
    const footprintNote = this.getFootprintForDefinition(definition) > 1 ? ` • ${this.getFootprintForDefinition(definition)}x${this.getFootprintForDefinition(definition)}` : '';
    const stats = this.add.text(width / 2, 50, `${displayTitle} • HP ${formatCompact(liveDie.currentHealth)}/${formatCompact(liveDie.maxHealth)} • ATK ${formatCompact(effectiveAtk)} • RNG ${this.getEffectiveAttackRange(liveDie, displayDefinition)}${footprintNote} • TARGET ${displayDefinition.targetingMode.toUpperCase()}`, {
      fontFamily: 'Orbitron',
      fontSize: '13px',
      color: PALETTE.text
    }).setOrigin(0.5);
    const activeSlots = this.getActiveManaSlots(liveDie);
    const activeManaLines = activeSlots.map((slot) => `${slot.title} ${this.getActiveMana(liveDie.instanceId, slot.key)}/${slot.manaNeeded}`);
    const shieldHp = this.shieldHpByInstance.get(liveDie.instanceId) ?? 0;
    const shieldTurns = this.shieldDurationTurnsByInstance.get(liveDie.instanceId);
    const shieldDurationNote = shieldTurns !== undefined ? ` (${shieldTurns} turn${shieldTurns === 1 ? '' : 's'})` : '';
    const shieldNote = shieldHp > 0 ? `SHIELD ${formatCompact(shieldHp)}${shieldDurationNote}` : '';
    const formatSkillType = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2');
    const classLevel = this.instanceClassLevels.get(liveDie.instanceId) ?? 1;
    const visibleSkills = skillDefinition.skills.filter((skill) => {
      const lockClass = getSkillLockClass(skill);
      return lockClass === undefined || classLevel >= lockClass;
    });
    const transformStats = activeTransformIndex !== undefined ? baseDefinition.transformStats?.[activeTransformIndex] : undefined;
    const formSkillsComingSoon = isSkillListComingSoon(transformStats?.skillsComingSoon);
    const skillSubheader = [
      soulNote,
      scopeNote,
      shieldNote
    ].filter(Boolean).join(' • ');
    const descriptionContext: SkillDescriptionContext = {
      diceDefinitions: Object.fromEntries([...getAllDiceDefinitions(this), ...getExclusiveDiceDefinitions(this)].map((candidate) => [candidate.typeId, candidate])),
      poolDefinitions: Object.fromEntries(getPoolDefinitions(this).map((candidate) => [candidate.typeId, candidate])),
      classLevel,
      isBoss: baseDefinition.isBoss === true
    };
    const skillDescription = formSkillsComingSoon
      ? 'Coming soon...'
      : visibleSkills.length === 0
      ? 'This dice does not have any special skills.'
      : visibleSkills.map((skill) =>
        `${skill.title} (${formatSkillType(skill.type)}): ${getClassScaledSkillDescription(skillDefinition, skill, skillDamageMultiplier, undefined, descriptionContext)}`
      ).join(' | ');
    const desc = this.add.text(width / 2, 78, `${skillSubheader ? `${skillSubheader}\n` : ''}${skillDescription}`, {
      fontFamily: 'Orbitron',
      fontSize: '11px',
      color: PALETTE.textMuted,
      wordWrap: { width: 530 }
    }).setOrigin(0.5, 0);
    const panelTop = 24;
    let nextBuffY = desc.y + desc.height + 8;
    const popupElements: Phaser.GameObjects.GameObject[] = [stats, desc];
    if (activeManaLines.length > 0) {
      const manaText = this.add.text(width / 2, nextBuffY, `Mana: ${activeManaLines.join('  •  ')}`, {
        fontFamily: 'Orbitron',
        fontSize: '10px',
        color: '#9ed0ff',
        align: 'center',
        wordWrap: { width: 530 }
      }).setOrigin(0.5, 0);
      popupElements.push(manaText);
      nextBuffY += manaText.height + 4;
    }
    if (statusEffects.length > 0) {
      const status = this.add.text(width / 2, nextBuffY, `Status Effects: ${statusEffects.join('  •  ')}`, {
        fontFamily: 'Orbitron',
        fontSize: '10px',
        color: '#8fd5ff',
        align: 'center',
        wordWrap: { width: 530 }
      }).setOrigin(0.5, 0);
      popupElements.push(status);
      nextBuffY += status.height + 4;
    }
    if (activeBuffs.length > 0) {
      const buffs = this.add.text(width / 2, nextBuffY, `Active Buffs: ${activeBuffs.join('  •  ')}`, {
        fontFamily: 'Orbitron',
        fontSize: '10px',
        color: '#f0c36a',
        align: 'center',
        wordWrap: { width: 530 }
      }).setOrigin(0.5, 0);
      popupElements.push(buffs);
      nextBuffY += buffs.height + 4;
    }
    attackCountBuffs.forEach((buff, index) => {
      const label = this.add.text(width / 2, nextBuffY + index * 14, buff.text, {
        fontFamily: 'Orbitron',
        fontSize: '10px',
        color: buff.color,
        align: 'center'
      }).setOrigin(0.5, 0);
      popupElements.push(label);
    });
    if (attackCountBuffs.length > 0) nextBuffY += attackCountBuffs.length * 14 + 4;
    const panelHeight = Math.max(112, nextBuffY - panelTop + 12);
    const panel = this.add.rectangle(width / 2, panelTop + panelHeight / 2, 560, panelHeight, 0x102434, 0.95).setStrokeStyle(2, 0x406987);
    popupElements.unshift(panel);
    this.dieInfoPopup = this.add.container(0, 0, popupElements).setDepth(330).setScale(0.96).setAlpha(0);
    this.dieInfoPopupInstanceId = liveDie.instanceId;
    this.tweens.add({ targets: this.dieInfoPopup, alpha: 1, scaleX: 1, scaleY: 1, duration: 120, ease: 'Back.Out' });
    this.dieInfoPopupTimer = this.time.delayedCall(2200, () => {
      if (!this.dieInfoPopup) return;
      this.tweens.add({ targets: this.dieInfoPopup, alpha: 0, scaleX: 0.98, scaleY: 0.98, duration: 140, ease: 'Sine.In', onComplete: () => {
        this.dieInfoPopup?.destroy(true);
        this.dieInfoPopup = null;
        this.dieInfoPopupInstanceId = null;
      } });
    });
  }

  private renderStatusEffects(container: Phaser.GameObjects.Container, x: number, y: number, die: DiceInstanceState) {
    const effects = this.getStatusEffects(die);
    if (effects.length === 0) return;
    effects.forEach((effect, index) => {
      const px = x - 22 + index * 16;
      const py = y - 24;
      const g = this.add.graphics();
      g.name = 'status-effect';
      g.fillStyle(STATUS_EFFECT_VISUALS[effect].color, 0.9);
      g.fillCircle(px, py, 7);
      g.lineStyle(1, 0xffffff, 0.8);
      g.strokeCircle(px, py, 7);
      container.add(g);
      const icon = this.add.text(px, py, STATUS_EFFECT_VISUALS[effect].icon, {
        fontFamily: 'Orbitron',
        fontSize: STATUS_EFFECT_VISUALS[effect].fontSize ?? '9px',
        color: STATUS_EFFECT_VISUALS[effect].iconColor ?? '#071018'
      }).setOrigin(0.5);
      icon.setName('status-effect');
      container.add(icon);
      const stacks = this.getStatusStackCount(die, effect);
      if (stacks > 1) {
        const stackLabel = this.add.text(px + 7, py + 5, `${stacks}`, {
          fontFamily: 'Orbitron',
          fontSize: '7px',
          color: '#ffffff',
          backgroundColor: '#173247',
          padding: { left: 1, right: 1, top: 0, bottom: 0 }
        }).setOrigin(0.5);
        stackLabel.setName('status-effect');
        container.add(stackLabel);
      }
    });
  }

  private renderHealthBar(container: Phaser.GameObjects.Container, x: number, y: number, hp: number, maxHp: number) {
    const ratio = Phaser.Math.Clamp(maxHp > 0 ? hp / maxHp : 0, 0, 1);
    const g = this.add.graphics();
    g.name = 'hp-bar';
    g.fillStyle(0x1f2f3d, 0.95);
    g.fillRoundedRect(x - 20, y - 3, 40, 6, 2);
    g.fillStyle(ratio > 0.5 ? 0x2ecc71 : ratio > 0.25 ? 0xf1c40f : 0xe74c3c, 1);
    g.fillRoundedRect(x - 20, y - 3, 40 * ratio, 6, 2);
    container.add(g);
  }

  private playTurnBanner(text: string) {
    if (!this.sys.isActive()) return;
    const { width } = this.scale;
    const banner = this.add.text(width / 2, -80, text, {
      fontFamily: 'Orbitron',
      fontSize: '40px',
      color: PALETTE.accent
    }).setOrigin(0.5).setDepth(300);
    this.tweens.add({ targets: banner, y: this.scale.height / 2, duration: 300, ease: 'Cubic.easeOut' });
    this.time.delayedCall(1100, () => {
      if (!this.sys.isActive() || !banner.scene) return;
      this.tweens.add({ targets: banner, y: this.scale.height + 80, alpha: 0, duration: 300, ease: 'Cubic.easeIn', onComplete: () => banner.destroy() });
    });
  }

  private updateCombatTimerUi() {
    if (!this.sys.isActive()) return;
    if (this.combatTimerText && !this.combatTimerText.active) {
      this.combatTimerText = null;
    }
    if (this.isMultiplayerMatch) {
      this.combatTimerText?.setVisible(false);
      return;
    }
    if (!this.gameContainer?.active) return;
    if (!this.combatTimerText) {
      this.combatTimerText = this.add.text(this.scale.width / 2, 92, '', {
        fontFamily: 'Orbitron',
        fontSize: '18px',
        color: '#ffcf7a'
      }).setOrigin(0.5).setDepth(220);
      this.gameContainer?.add(this.combatTimerText);
    }
    const secs = Math.max(0, Math.ceil(this.combatTimeRemainingMs / 1000));
    this.combatTimerText.setText(`COMBAT ${secs}s`);
    this.combatTimerText.setVisible(this.gamePhase.stage === 'combat');
  }

  private getCurrentDungeonSpeedMultiplier() {
    return this.activeChallenge === 'dungeon' ? getDungeonSpeedMultiplier(this.dungeonWave) : 1;
  }

  private syncMusicEffects() {
    if (!this.sys.isActive()) return;
    const effects = this.activeChallenge === 'dungeon'
      ? getDungeonMusicEffects(this.dungeonWave)
      : { speed: 1, pitch: 0 };
    AudioManager.setMusicRate(this, effects.speed / Math.pow(2, effects.pitch / 12));
    AudioManager.setMusicPitch(this, effects.pitch);
  }

  private getCombatPacingMultiplier() {
    if (this.gamePhase.stage !== 'combat') return 1;
    return this.getCurrentDungeonSpeedMultiplier() * getCombatTimeSpeedMultiplier(this.combatTimeRemainingMs);
  }

  private async delayCombatVisualPaced(ms: number): Promise<void> {
    const pacingMultiplier = this.getCombatPacingMultiplier();
    await this.delay(Math.max(1, Math.floor(ms / pacingMultiplier)));
  }

  private async delayCombatPaced(ms: number): Promise<boolean> {
    if (!this.sys.isActive()) return false;
    const prevMs = this.combatTimeRemainingMs;
    const pacingMultiplier = this.getCombatPacingMultiplier();
    const actualDelay = Math.max(1, Math.floor(ms / pacingMultiplier));
    this.combatTimeRemainingMs = Math.max(0, prevMs - actualDelay);

    const prevSeconds = Math.ceil(prevMs / 1000);
    const nextSeconds = Math.ceil(this.combatTimeRemainingMs / 1000);
    if (!this.combatCountdownTriggered && prevMs > 15_000 && this.combatTimeRemainingMs <= 15_000) {
      this.combatCountdownTriggered = true;
    }
    for (let second = prevSeconds - 1; second >= nextSeconds; second--) {
      if (second === 30 || second === 15) {
        AudioManager.playSfx(this, AUDIO_KEYS.gameTimerTick, { volume: 0.62 });
      } else if (second < 10 && second > 0) {
        AudioManager.playSfx(this, AUDIO_KEYS.gameCountdown, { volume: 0.62 });
      }
    }
    this.updateCombatTimerUi();
    this.syncMusicEffects();
    await this.delay(actualDelay);
    return this.combatTimeRemainingMs > 0 && this.sys.isActive();
  }

  private async resolveCombatWin(combatEndResolved = false): Promise<boolean> {
    if (!this.checkWinConditions()) return false;
    if (this.activeChallenge !== 'dungeon' || !this.dungeonVictoryPending) return true;
    this.dungeonVictoryPending = false;
    if (!combatEndResolved) {
      await this.applyCombatEndSkills();
      this.applyFountainOfLoveCombatEndHealing();
      this.applyDungeonCardCombatEndRegen();
      const playerLiving = getLivingDiceCount(this.gameState, 'player');
      if (playerLiving === 0) {
        this.endGame('defeat', getLivingDiceCount(this.gameState, 'enemy') === 0
          ? 'Mutual destruction — no dice survived the wave.'
          : 'All your dice were defeated!');
        return true;
      }
      if (getLivingDiceCount(this.gameState, 'enemy') > 0) {
        this.dungeonVictoryPending = true;
        return false;
      }
    }
    this.endGame('victory', 'All enemy dice defeated!');
    return true;
  }

  private checkWinConditions(): boolean {
    const playerLiving = getLivingDiceCount(this.gameState, 'player');
    const enemyLiving = getLivingDiceCount(this.gameState, 'enemy');
    const terminalOwner = getTerminalBattleOwner(playerLiving, enemyLiving);

    if (terminalOwner === 'mutual' && this.activeChallenge !== 'dungeon') {
      if (this.isMultiplayerMatch) this.finishMultiplayerMatch('draw', 'Mutual destruction — no dice survived.');
      else this.endGame('defeat', 'Mutual destruction — no dice survived the battle.');
      return true;
    }

    if (enemyLiving === 0) {
      if (this.activeChallenge === 'deucifer' && !this.deuciferBossSummoned) {
        return false;
      }
      if (this.activeChallenge === 'bossfight') {
        if (this.bossfightBossDefeatedThisTurn) return false;
        this.bossfightBossDefeatedThisTurn = true;
        this.bossfightPendingReward = { boss: this.bossfightCurrentBoss, level: this.bossfightLevel };
        completeBossfightLevel(this, this.bossfightCurrentBoss, this.bossfightLevel);
        this.endGame('victory', `${this.bossfightCurrentBoss} Lv.${this.bossfightLevel} defeated! Next stage unlocked.`);
        return true;
      }
      if (this.activeChallenge === 'dungeon') {
        if (playerLiving === 0) {
          this.endGame('defeat', 'Mutual destruction — no dice survived the wave.');
          return true;
        }
        this.dungeonVictoryPending = true;
        return true;
      }
      this.endGame('victory', 'All enemy dice defeated!');
      return true;
    }

    if (playerLiving === 0) {
      this.endGame('defeat', 'All your dice were defeated!');
      return true;
    }

    return false;
  }


  private endGame(stage: MatchResultStage, message: string) {
    if (this.gamePhase.stage === 'victory' || this.gamePhase.stage === 'defeat' || this.gamePhase.stage === 'draw') return;
    AudioManager.resetMusicEffects(this);
    if (this.matchStartedAtMs > 0 && Date.now() - this.matchStartedAtMs > SWEATY_MATCH_MS) {
      AchievementStore.unlock(this, 'that_was_sweaty');
    }
    this.gamePhase = { stage };
    this.multiplayerCountdownEvent?.remove(false);
    this.multiplayerCountdownEvent = null;
    this.multiplayerTimerText?.setVisible(false);

    if (this.activeChallenge === 'dungeon') {
      this.endDungeonRun(stage, message);
      return;
    }

    const versusBotVictory = stage === 'victory' && this.activeChallenge === null && !this.isMultiplayerMatch;
    const baseTokenReward = stage === 'victory' && this.activeChallenge === 'bossfight'
      ? 0
      : versusBotVictory
        ? this.singleplayer.getVictoryTokenReward(this.configDifficulty)
        : MATCH_TOKEN_REWARDS[stage];
    let tokenReward = baseTokenReward;
    let chipReward = 0;
    if (versusBotVictory) {
      const firstWinAward = this.singleplayer.getFirstWinAward(
        this.configDifficulty,
        this.singleplayer.hasClaimedBotFirstWin(this, this.configDifficulty)
      );
      if (firstWinAward) {
        tokenReward += firstWinAward.tokens;
        chipReward += firstWinAward.chips;
        this.singleplayer.markBotFirstWinClaimed(this, this.configDifficulty);
      }
    }
    if (stage === 'victory' && this.activeChallenge === 'daily') {
      const nextAchievements = AchievementStore.mutate(this, (state) => ({ ...state, dailyChallengeWins: state.dailyChallengeWins + 1 }));
      AchievementStore.unlock(this, 'challenger');
      if (nextAchievements.dailyChallengeWins >= 10) AchievementStore.unlock(this, 'problem_solver');
      setChallengeStatus(this, 'daily', 'completed', this.activeDailyKey);
      const dailyClaimKey = getChallengeClaimKey('daily', this.activeDailyKey);
      if (!hasChallengeRewardClaimed(this, dailyClaimKey)) {
        const reward = getChallengeReward('daily', this.dailyHard);
        tokenReward += reward.tokens;
        chipReward += reward.chips;
        markChallengeRewardClaimed(this, dailyClaimKey);
      }
    }
    if (stage === 'victory' && this.activeChallenge === 'deucifer') {
      AchievementStore.unlock(this, 'demonic_torment');
      setChallengeStatus(this, 'deucifer', 'completed', this.activeDailyKey);
      const deuciferClaimKey = getChallengeClaimKey('deucifer', this.activeDailyKey);
      if (!hasChallengeRewardClaimed(this, deuciferClaimKey)) {
        const reward = getChallengeReward('deucifer');
        tokenReward += reward.tokens;
        chipReward += reward.chips;
        markChallengeRewardClaimed(this, deuciferClaimKey);
      }
    }
    if (stage === 'victory' && this.activeChallenge === 'dopamine') {
      AchievementStore.unlock(this, 'hooked');
      setChallengeStatus(this, 'dopamine', 'completed', this.activeDailyKey);
      const dopamineClaimKey = getChallengeClaimKey('dopamine', this.activeDailyKey);
      if (!hasChallengeRewardClaimed(this, dopamineClaimKey)) {
        const reward = getChallengeReward('dopamine');
        tokenReward += reward.tokens;
        chipReward += reward.chips;
        markChallengeRewardClaimed(this, dopamineClaimKey);
      }
    }
    if (stage === 'victory' && this.activeChallenge === 'bossfight' && this.bossfightPendingReward) {
      const defeatedTier = this.bossfightPendingReward.level;
      AchievementStore.unlock(this, 'boss_slayer');
      if (defeatedTier >= 5) AchievementStore.unlock(this, 'boss_ripper');
      if (defeatedTier >= 10) AchievementStore.unlock(this, 'boss_hunter');
      const reward = claimBossfightReward(this, this.bossfightPendingReward.boss, this.bossfightPendingReward.level);
      tokenReward += reward.tokens;
      chipReward += reward.chips;
      this.bossfightPendingReward = null;
    }
    if (stage !== 'victory' && this.activeChallenge === 'daily') this.markChallengeFailed('daily');
    if (stage !== 'victory' && this.activeChallenge === 'deucifer') this.markChallengeFailed('deucifer');
    if (stage !== 'victory' && this.activeChallenge === 'dopamine') this.markChallengeFailed('dopamine');
    if (stage === 'victory') {
      const next = AchievementStore.mutate(this, (state) => ({ ...state, wins: state.wins + 1 }));
      AchievementStore.unlock(this, 'winner');
      if (next.wins >= 10) AchievementStore.unlock(this, 'veteran');
      if (next.wins >= 50) AchievementStore.unlock(this, 'master');
    }
    setDiceTokens(this, getDiceTokens(this) + tokenReward);
    if (chipReward > 0) {
      CasinoProgressStore.mutate(this, (progress) => ({ ...progress, chips: progress.chips + chipReward }));
    }
    const chipMessage = chipReward > 0 ? ` +${formatCompact(chipReward)} Casino Chips awarded.` : '';
    const rewardMessage = `${message} +${formatCompact(tokenReward)} Dice Tokens awarded.${chipMessage}`;

    const { width, height } = this.scale;
    const centerX = width / 2;
    const centerY = height / 2;

    this.add.rectangle(centerX, centerY, width, height, 0x000000, 0.7);

    const titleColor = stage === 'victory' ? PALETTE.success : (stage === 'draw' ? PALETTE.accentSoft : PALETTE.danger);
    const titleText = stage === 'victory' ? 'VICTORY!' : (stage === 'draw' ? 'DRAW!' : 'DEFEAT');

    this.add.text(centerX, centerY - 60, titleText, {
      fontFamily: 'Orbitron',
      fontSize: '48px',
      color: titleColor
    }).setOrigin(0.5);

    this.add.text(centerX, centerY, rewardMessage, {
      fontFamily: 'Orbitron',
      fontSize: '18px',
      color: PALETTE.text
    }).setOrigin(0.5);

    const continueBtn = this.add.rectangle(centerX, centerY + 80, 140, 44, 0x335770, 0.9)
      .setInteractive({ useHandCursor: true });
    this.add.text(centerX, centerY + 80, 'CONTINUE', {
      fontFamily: 'Orbitron',
      fontSize: '16px',
      color: PALETTE.text
    }).setOrigin(0.5);

    continueBtn.on('pointerover', () => continueBtn.setFillStyle(0x406987, 1));
    continueBtn.on('pointerout', () => continueBtn.setFillStyle(0x335770, 0.9));
    continueBtn.on('pointerdown', () => {
      this.scene.wake(SCENE_KEYS.Menu);
      this.scene.restart();
    });
  }

  private endDungeonRun(stage: MatchResultStage, message: string) {
    const transition = getDungeonResultTransition(stage, this.dungeonWave);
    if (transition.captureCarryover) {
      this.captureDungeonCarryover();
    } else {
      this.dungeonCarryover = null;
    }
    if (transition.clearedWave > 0) recordDungeonBestWave(this, transition.clearedWave);
    const progress = getDungeonProgress(this);
    const completed = transition.completed;
    let rewardText = '';
    if (transition.persistWave !== null) {
      if (this.persistDungeonRun(transition.persistWave)) {
        rewardText = this.grantDungeonRewardForWave(transition.rewardWave);
      }
    } else {
      const cleared = clearDungeonRun(this);
      this.dungeonRunActive = false;
      this.dungeonLoadoutSnapshot = null;
      if (cleared) rewardText = this.grantDungeonRewardForWave(transition.rewardWave);
    }
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const title = stage === 'victory'
      ? (completed ? 'DUNGEON CONQUERED!' : `WAVE ${this.dungeonWave} CLEARED!`)
      : 'RUN ENDED';
    const subtitle = stage === 'victory'
      ? (completed ? 'You survived all 50 waves.' : 'Your dice will carry over to the next wave. Beware!')
      : `${message} Best wave: ${progress.bestWave}/${DUNGEON_MAX_WAVES}.`;
    const elements: Phaser.GameObjects.GameObject[] = [
      this.add.rectangle(cx, cy, width, height, 0x000000, 0.72),
      this.add.rectangle(cx, cy, 560, 340, 0x102434, 0.99).setStrokeStyle(2, 0xb87545),
      this.add.text(cx, cy - 126, title, {
        fontFamily: 'Orbitron',
        fontSize: '26px',
        color: stage === 'victory' ? PALETTE.success : PALETTE.danger
      }).setOrigin(0.5),
      this.add.text(cx, cy - 78, subtitle, {
        fontFamily: 'Orbitron',
        fontSize: '12px',
        color: PALETTE.text,
        align: 'center',
        wordWrap: { width: 480 }
      }).setOrigin(0.5),
      this.add.text(cx, cy - 26, `BEST WAVE: ${progress.bestWave}/${DUNGEON_MAX_WAVES} • TICKETS LEFT: ${progress.ticketsRemaining}/${DUNGEON_DAILY_TICKETS}`, {
        fontFamily: 'Orbitron',
        fontSize: '11px',
        color: PALETTE.accentSoft
      }).setOrigin(0.5)
    ];
    if (rewardText) {
      elements.push(this.add.text(cx, cy + 20, `REWARD: ${rewardText}`, {
        fontFamily: 'Orbitron',
        fontSize: '13px',
        color: '#ffd7a3',
        align: 'center',
        wordWrap: { width: 460 }
      }).setOrigin(0.5));
    }
    const nextWave = transition.nextWave;
    const next = nextWave !== null;
    if (next) {
      elements.push(this.add.text(cx, cy + 54, 'The next wave is already gathering.', {
        fontFamily: 'Orbitron',
        fontSize: '11px',
        color: PALETTE.textMuted
      }).setOrigin(0.5));
    }
    const button = this.add.rectangle(cx, cy + 112, 260, 44, next ? 0x2ecc71 : 0x335770, 0.95)
      .setStrokeStyle(1, next ? 0xffffff : 0x406987)
      .setInteractive({ useHandCursor: true });
    const buttonLabel = this.add.text(cx, cy + 112, next ? 'NEXT WAVE →' : 'RETURN TO DUNGEONS', {
      fontFamily: 'Orbitron',
      fontSize: '14px',
      color: next ? '#071018' : PALETTE.text
    }).setOrigin(0.5);
    elements.push(button, buttonLabel);
    button.on('pointerdown', () => {
      if (nextWave !== null) {
        this.dungeonResultContainer?.destroy(true);
        this.dungeonResultContainer = null;
        this.startDungeonWave(nextWave);
        return;
      }
      this.restoreDungeonConfig();
      this.registry.set(DUNGEON_OPEN_MODAL_KEY, true);
      this.scene.wake(SCENE_KEYS.Menu);
      this.scene.restart();
    });
    this.dungeonResultContainer = this.add.container(0, 0, elements).setDepth(600);
  }

  private quitDungeonRun() {
    const clearedWave = Math.max(0, this.dungeonWave - 1);
    if (clearedWave > 0) recordDungeonBestWave(this, clearedWave);
    const rewardWave = getDungeonQuitRewardWave(this.dungeonWave);
    const cleared = clearDungeonRun(this);
    this.dungeonRunActive = false;
    this.restoreDungeonConfig();
    if (!cleared) {
      AlertManager.toast(this, { type: 'warning', message: 'Dungeon run could not be cleared; no quit reward was paid.' });
      return;
    }
    const rewardText = this.grantDungeonRewardForWave(rewardWave);
    if (rewardText) {
      AlertManager.toast(this, { type: 'success', message: `Dungeon quit reward paid: ${rewardText}.` });
    }
  }

  private toggleExitPrompt() {
    if (this.modalContainer || this.modalEscHandler) {
      return;
    }
    if (this.gamePhase.stage === 'victory' || this.gamePhase.stage === 'defeat' || this.gamePhase.stage === 'draw') {
      return;
    }
    if (this.dungeonResultContainer) {
      return;
    }
    if (this.exitPromptOpen) {
      this.closeExitPrompt();
      return;
    }
    this.exitPromptOpen = true;
    const { width, height } = this.scale;
    const isDungeonPrompt = this.activeChallenge === 'dungeon';
    const panelHeight = isDungeonPrompt ? 210 : 180;
    const titleY = isDungeonPrompt ? -40 : -28;
    const hintY = isDungeonPrompt ? -2 : 2;
    const buttonY = isDungeonPrompt ? 60 : 48;
    const title = isDungeonPrompt ? 'Quit Dungeon?' : 'Quit Arena Match?';
    const hintText = isDungeonPrompt
      ? 'Press ESC again or Cancel to continue. Quitting pays any reward for the current wave (every fifth wave). Your ticket will not be refunded.'
      : 'Press ESC again or Cancel to continue.';
    const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.55).setInteractive();
    const panel = this.add.rectangle(width / 2, height / 2, 380, panelHeight, 0x102434, 0.98).setStrokeStyle(2, 0x406987);
    const label = this.add.text(width / 2, height / 2 + titleY, title, { fontFamily: 'Orbitron', fontSize: '20px', color: PALETTE.text }).setOrigin(0.5);
    const hint = this.add.text(width / 2, height / 2 + hintY, hintText, {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.textMuted,
      align: 'center',
      wordWrap: { width: 330 }
    }).setOrigin(0.5);
    const cancel = this.add.text(width / 2 - 70, height / 2 + buttonY, 'CANCEL', { fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.text, backgroundColor: '#173247', padding: { left: 10, right: 10, top: 6, bottom: 6 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const quit = this.add.text(width / 2 + 70, height / 2 + buttonY, 'QUIT', { fontFamily: 'Orbitron', fontSize: '13px', color: '#ffffff', backgroundColor: '#9b2d2d', padding: { left: 12, right: 12, top: 6, bottom: 6 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    overlay.on('pointerdown', () => this.closeExitPrompt());
    cancel.on('pointerdown', () => this.closeExitPrompt());
    quit.on('pointerdown', () => {
      const wasFinished = this.gamePhase.stage === 'victory' || this.gamePhase.stage === 'defeat' || this.gamePhase.stage === 'draw';
      if (this.isMultiplayerMatch && !wasFinished) this.multiplayer.leaveSession();
      if (!wasFinished && this.activeChallenge === 'daily') this.markChallengeFailed('daily');
      if (!wasFinished && this.activeChallenge === 'deucifer') this.markChallengeFailed('deucifer');
      if (!wasFinished && this.activeChallenge === 'dopamine') this.markChallengeFailed('dopamine');
      if (this.activeChallenge === 'dungeon') {
        this.quitDungeonRun();
      }
      this.scene.wake(SCENE_KEYS.Menu);
      this.scene.start(SCENE_KEYS.Menu);
    });
    this.exitPromptElements = [overlay, panel, label, hint, cancel, quit];
    this.exitPromptElements.forEach((node) => (node as any).setDepth?.(400));
  }

  private closeExitPrompt() {
    this.exitPromptOpen = false;
    this.exitPromptElements.forEach((node) => node.destroy());
    this.exitPromptElements = [];
  }

  private renderAmmoBar(container: Phaser.GameObjects.Container, x: number, y: number, ammo: number, maxAmmo: number) {
    const ratio = Phaser.Math.Clamp(maxAmmo > 0 ? ammo / maxAmmo : 0, 0, 1);
    const g = this.add.graphics();
    g.name = 'ammo-bar';
    g.fillStyle(0x1f2f3d, 0.95);
    g.fillRoundedRect(x - 18, y - 3, 36, 5, 2);
    g.fillStyle(0xf1c40f, 1);
    g.fillRoundedRect(x - 18, y - 3, 36 * ratio, 5, 2);
    container.add(g);
  }

  private renderManaBar(container: Phaser.GameObjects.Container, x: number, y: number, mana: number, maxMana: number, fillColor = 0x6fa8ff) {
    const ratio = Phaser.Math.Clamp(maxMana > 0 ? mana / maxMana : 0, 0, 1);
    const g = this.add.graphics();
    g.name = 'mana-bar';
    g.fillStyle(0x1f2f3d, 0.95);
    g.fillRoundedRect(x - 18, y - 3, 36, 5, 2);
    g.fillStyle(fillColor, 1);
    if (ratio > 0) g.fillRoundedRect(x - 18, y - 3, 36 * ratio, 5, 2);
    container.add(g);
  }

  private placeEnemyDiceForTurn() {
    const enemyHandDice = getAvailableHandDice(this.gameState, 'enemy');
    const usedCells = this.collectOccupiedCells('enemy');
    enemyHandDice.forEach((die) => {
      this.placeEnemyDieUsingBehavior(die, usedCells);
    });
  }

  private placeEnemyDieUsingBehavior(die: DiceInstanceState, usedCells: Set<string>) {
    const definition = this.getDefinitionForInstance(die) ?? this.definitions.get(die.typeId);
    const range = definition?.range ?? 4;
    const footprint = this.getFootprintForDefinition(definition);
    const position = this.isBossDie(die)
      ? this.findRandomBossPosition(die, footprint, usedCells)
      : this.findRandomFootprintPosition(footprint, usedCells, () => this.pickEnemyColumn(range), { min: range >= 7 ? 2 : range >= 6 ? 1 : 0, max: GRID_SIZE - footprint });
    if (!position) return;
    this.markFootprint(position.row, position.col, footprint, usedCells);
    this.gameState = placeDieOnBoard(this.gameState, die.instanceId, position.row, position.col);
  }

  private pickRandomColumn(columns: number[], rng?: () => number): number {
    if (columns.length === 0) return 0;
    return columns[this.rollSeededInt(0, columns.length - 1, rng)] ?? 0;
  }
}
