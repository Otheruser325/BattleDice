import Phaser from 'phaser';
import { canReceiveUsefulCopies, getActiveLoadoutSlot, getAllDiceDefinitions, getDiceDefinitions, getDiceProgress, getDiceTokens, getDiamonds, getExclusiveDiceDefinitions, getOwnedTalentIndices, getRangeLabel, grantDiceCopies, LOADOUT_SLOT_COUNT, RARITY_TEXT_COLORS, setActiveLoadoutSlot, setDiceTokens, setDiamonds } from '../data/dice';
import {
  createMatchBattleState,
  getAvailableHandDice,
  placeDieOnBoard,
  getBoardDice,
  getLivingDiceCount,
  executeAttack,
  applyDamage,
  spendAttack,
  resolveCombatPhase,
  endTurn,
  sanitizeServerBattleState,
  type MatchBattleState
} from '../systems/BattleState';
import { DebugManager } from '../utils/DebugManager';
import { readIntegrityChecked, writeIntegrityChecked } from '../utils/SecureStorage';
import { AlertManager } from '../utils/AlertManager';
import { PALETTE, getLayout } from '../ui/theme';
import type { DiceTypeId, DiceInstanceState, DiceDefinition, DiceTargetingMode } from '../types/game';
import { buildSkillIndex } from '../data/SkillLoader';
import { CHAIN_NO_TARGET_CAP, getChainTargetLimit, getRuntimeSkillMeta, getRuntimeSkillMetaForTrigger, getValidSkillDefinitions, getStatusEffectDuration, getStatusEffectDurationFromModifiers, getSkillLockClass, getInitialTransformIndex, getAvailableTransformIndices, getPipTriggeredTransformIndex, getPipMappedRate, resolvePipScaledDamage, gateMetaByRangeThreshold, isRangeThresholdSatisfied } from '../systems/DiceSkills';
import { CombatSkillOrchestrator, executeOnDamagedSkillEffects, executeOnDeathSkillEffects, executeOnKillSkillEffects, executeOnTransformedSkillEffects, executeCombatStartSkillEffects, executeCombatEndSkillEffects, executePassiveSkillEffects, executeActiveSkillEffects, executeRevengeSkillEffects, applySkillDamageModifiers, getCombatStartManaEffect, getCombatStartTauntEffect, chooseInfiltratorPlacement, canSkillStrikeFirst, collectCombatStartAuras, computeCombatStartBonus, computeCombatStartFoeBonus, type CombatFlowContext, type CombatFlowPhase, type StatusEffectApplication } from '../systems/CombatSkills';
import { getClassMultiplier, applyClassProgression, applyTransformStats, getTransformRecoveryRate, getClassScaledSkillDescription } from '../systems/ClassProgression';
import { SCENE_KEYS } from './sceneKeys';
import { CasinoProgressStore } from '../systems/CasinoProgressStore';
import { AUDIO_KEYS, AudioManager } from '../utils/AudioManager';
import { AnimationManager } from '../utils/AnimationManager';
import { canOfferDiceCards, getDiceCardMagnitude, getDiceCardRarityRoll, rollDiceCards, type DiceCard, type DiceCardRarity } from '../systems/DiceCards';
import { ProfileStore } from '../systems/ProfileStore';
import { AchievementStore } from '../systems/AchievementStore';
import { ArenaMultiplayerClient, type ArenaMultiplayerStatus } from '../systems/ArenaMultiplayerClient';
import { formatSkillInfo, getDiceAlternateFormLabel, getDiceModalDisplayDefinition, getNextDiceFormIndex } from './DiceScene';
import { applyDiceTalent } from '../systems/DiceTalents';
import { getEquippedTalentIndex } from '../data/dice';
import { isSkillListComingSoon, mergeSkillsByIndex } from '../systems/SkillOverlay';
import { formatCompact, formatPercent } from '../utils/FormatManager';
import { secureChance, secureLobbyCode, securePick, secureRandom, secureRandomBetween } from '../utils/RandomManager';


type BotDifficulty = 'Baby' | 'Easy' | 'Medium' | 'Hard' | 'Nightmare';
type MatchResultStage = 'victory' | 'defeat' | 'draw';
type RandomModeModifier = 'Classic' | 'Combanity' | 'Duality' | 'Necromancy' | 'DiceCard';
type ChallengeKey = 'daily' | 'deucifer' | 'dopamine' | 'bossfight' | null;
type ChallengeStatus = 'not-started' | 'started' | 'completed' | 'failed';
type DailyLoadoutMode = 'mirror' | 'player-vs-enemy' | 'random-vs-random';
interface TranscendenceBeamPattern {
  rowStep: number;
  colStep: number;
}

interface GamePhase {
  stage: 'lobby' | 'placement' | 'combat' | 'resolved' | MatchResultStage;
}

interface TranscendenceBeamLine {
  target: DiceInstanceState;
  pattern: TranscendenceBeamPattern;
}

const GRID_SIZE = 5;
const TILE_SIZE = 64;
const TILE_GAP = 8;
const MATCH_TOKEN_REWARDS: Record<MatchResultStage, number> = { victory: 500, defeat: 50, draw: 200 };
const LOBBY_JOIN_ATTEMPT_LIMIT = 5;
const LOBBY_JOIN_LOCKOUT_MS = 30_000;
const BOT_FIRST_WIN_REWARDS: Record<BotDifficulty, { tokens: number; chips: number }> = {
  Baby: { tokens: 500, chips: 20 },
  Easy: { tokens: 1_000, chips: 40 },
  Medium: { tokens: 2_000, chips: 60 },
  Hard: { tokens: 5_000, chips: 80 },
  Nightmare: { tokens: 10_000, chips: 100 }
};
const BOT_FIRST_WIN_KEY = 'arena:claimedBotFirstWins';
const CHALLENGE_STATUS_KEY = 'arena:challengeStatus';
const CHALLENGE_REWARD_CLAIMS_KEY = 'arena:challengeRewardClaims';
const BOSSFIGHT_PROGRESS_KEY = 'arena:bossfightProgress';
const BOSSFIGHT_MENU_STATE_KEY = 'arena:bossfightMenuState';
type BossfightBossType = 'Magician' | 'Leon' | 'Basilisk';
const BOSSFIGHT_BOSSES: BossfightBossType[] = ['Magician', 'Leon', 'Basilisk'];
const MAX_BOSSFIGHT_LEVEL = 15;

interface BossfightProgress {
  unlockedLevels: Record<BossfightBossType, number>;
  rewardClaims: string[];
}

const BOT_DIFFICULTY_CLASSES: Record<BotDifficulty, [number, number]> = {
  Baby: [1, 1],
  Easy: [1, 3],
  Medium: [3, 6],
  Hard: [5, 9],
  Nightmare: [7, 12]
};

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
  private tauntedByInstance: Map<string, { sourceId: string; turns: number }> = new Map();
  private attackCapacityByInstance: Map<string, number> = new Map();
  private attackDeltaByInstance: Map<string, { delta: number; turns: number; stacks?: Array<{ delta: number; turns: number }> }> = new Map();
  private timeStatusByInstance: Map<string, Array<{ effect: 'acceleration' | 'dilation'; turns: number; sourceInstanceId: string }>> = new Map();
  private extraAttackTurnsByInstance: Map<string, { extra: number; turns: number }> = new Map();
  private attackMultiplierTurnsByInstance: Map<string, { multiplier: number; turns: number }> = new Map();
  private basicAttacksPerAttackByInstance: Map<string, { count: number; turns: number }> = new Map();
  private combatAttackCountDeltaByInstance: Map<string, number> = new Map();
  private combatAttackCountPositiveDeltaByInstance: Map<string, number> = new Map();
  private combatAttackCountNegativeDeltaByInstance: Map<string, number> = new Map();
  private attackCountEffectSeenByInstance: Map<string, { positive: boolean; negative: boolean }> = new Map();
  private manaPausedTurnsByInstance: Map<string, number> = new Map();
  private combanityAttackMultiplierByInstance: Map<string, { multiplier: number; turns: number }> = new Map();
  private combanityBonusByOwner: Record<'player' | 'enemy', { multiplier: number; reduction: number; label: string; allowsFullReduction: boolean }> = {
    player: { multiplier: 1, reduction: 0, label: 'Classic', allowsFullReduction: false },
    enemy: { multiplier: 1, reduction: 0, label: 'Classic', allowsFullReduction: false }
  };
  private damageReductionByInstance: Map<string, number> = new Map();
  private criticalDamageTextByInstance: Set<string> = new Set();
  private poisonByInstance: Map<string, { stacks: Array<{ damage: number; turns: number; sourceInstanceId?: string; sourceOwnerId?: 'player' | 'enemy'; sourceTypeId?: string }> }> = new Map();
  private armorShredByInstance: Map<string, { rate: number; turns: number }> = new Map();
  private transformIndexByInstance: Map<string, number> = new Map();
  private pipTransformTriggeredThisTurn: Set<string> = new Set();
  private transformDurationByInstance: Map<string, number> = new Map();
  private rollAllButton!: Phaser.GameObjects.Rectangle;
  private rollAllButtonLabel!: Phaser.GameObjects.Text;
  private rollHelperText!: Phaser.GameObjects.Text;
  private diceRolled = false;
  private currentHandOrder: string[] = [];
  private lavaPoolsByTile: Map<string, { damage: number; turns: number; sourceOwnerId?: 'player' | 'enemy'; sourceTypeId?: string }> = new Map();
  private deathAlliesDefeatedCount: Map<string, number> = new Map();
  private reviveCountByInstance: Map<string, number> = new Map();
  private basicAttackDamageBonusByInstance: Map<string, number> = new Map();
  private instanceDefinitionOverrides: Map<string, DiceDefinition> = new Map();
  private instanceClassLevels: Map<string, number> = new Map();
  private instanceTalentIndices: Map<string, number> = new Map();
  private enemyLoadoutRevealed = false;
  private sessionStartedAtMs = 0;
  private infiltratedBoardSideByInstance: Map<string, 'player' | 'enemy'> = new Map();
  private chainedByInstance: Map<string, string> = new Map();
  private hitDuringAttackAction: Set<string> = new Set();
  private persistentLockSourceIds: Set<string> = new Set();
  private rangeHighlightObjects: Phaser.GameObjects.GameObject[] = [];
  private highlightedRangeInstanceId: string | null = null;
  private soulDiceSoulsConjured: Map<string, number> = new Map();
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
  private configDifficulty: BotDifficulty = 'Medium';
  private configUseLevelling: boolean = true;
  private configRandomMode: boolean = false;
  private configRandomizeLoadoutAndClassUps: boolean = false;
  private configTurnCount: number = -1;
  private activeChallenge: ChallengeKey = null;
  private dailyHard = false;
  private turnLimit: number = -1;
  private activeRandomModifier: RandomModeModifier | null = null;
  private activeDailyKey = '';
  private combatTimeRemainingMs = 30_000;
  private combatCountdownTriggered = false;
  private combatTimerText: Phaser.GameObjects.Text | null = null;
  private berserkTriggeredInstances: Set<string> = new Set();
  private activeDiceCardKeys: Set<string> = new Set();
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
  private crowdAttackByOwner: Record<'player' | 'enemy', { damage: number; reduction: number }> = { player: { damage: 0, reduction: 0 }, enemy: { damage: 0, reduction: 0 } };
  private assassinBoostAttacksByInstance: Map<string, number> = new Map();
  private specialSkillAttackDepth = 0;
  private diceCardPicksUsed = 0;
  private multiplayerClient = new ArenaMultiplayerClient();
  private multiplayerStatus: ArenaMultiplayerStatus = this.multiplayerClient.getStatus();
  private playerDisplayName = 'Player';
  private enemyDisplayName = 'Opponent';
  private deuciferBossPending = false;
  private deuciferBossSummoned = false;
  private summonedByInstance: Map<string, string> = new Map();
  private bossfightLevel = 1;
  private bossfightCurrentBoss: BossfightBossType = 'Magician';
  private bossfightMenuBoss: BossfightBossType = 'Magician';
  private bossfightMenuLevel = 1;
  private bossfightBossDefeatedThisTurn = false;
  private bossfightPendingReward: { boss: BossfightBossType; level: number } | null = null;
  private stunnedByInstance: Map<string, number> = new Map();
  private healingWaitByInstance: Set<string> = new Set();
  private healingRetryReadyByInstance: Set<string> = new Set();
  private avoidChanceIgnoredTargetByInstance: Map<string, string> = new Map();
  private reverseUsesByInstance: Map<string, number> = new Map();
  private reverseLastUsedTurnByInstance: Map<string, number> = new Map();
  private reverseCooldownUntilTurnByInstance: Map<string, number> = new Map();
  private lobbyJoinAttempts = 0;
  private lobbyJoinBlockedUntilMs = 0;
  private pendingMultiplayerMatch = false;
  private isMultiplayerMatch = false;
  private activePostCombatDragProxy: Phaser.GameObjects.Container | null = null;

  constructor() {
    super(ArenaScene.KEY);
  }

  private resetRuntimeState() {
    this.gamePhase = { stage: 'lobby' };
    this.exitPromptOpen = false;
    this.exitPromptElements = [];
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
    this.tauntedByInstance.clear();
    this.attackDeltaByInstance.clear();
    this.timeStatusByInstance.clear();
    this.extraAttackTurnsByInstance.clear();
    this.attackMultiplierTurnsByInstance.clear();
    this.basicAttacksPerAttackByInstance.clear();
    this.combatAttackCountDeltaByInstance.clear();
    this.combatAttackCountPositiveDeltaByInstance.clear();
    this.combatAttackCountNegativeDeltaByInstance.clear();
    this.attackCountEffectSeenByInstance.clear();
    this.manaPausedTurnsByInstance.clear();
    this.combanityAttackMultiplierByInstance.clear();
    this.combanityBonusByOwner = {
      player: { multiplier: 1, reduction: 0, label: 'Classic', allowsFullReduction: false },
      enemy: { multiplier: 1, reduction: 0, label: 'Classic', allowsFullReduction: false }
    };
    this.damageReductionByInstance.clear();
    this.poisonByInstance.clear();
    this.armorShredByInstance.clear();
    this.diceRolled = false;
    this.currentHandOrder = [];
    this.activeRandomModifier = null;
    this.transformIndexByInstance.clear();
    this.pipTransformTriggeredThisTurn.clear();
    this.transformDurationByInstance.clear();
    this.lavaPoolsByTile.clear();
    this.deuciferBossPending = false;
    this.deuciferBossSummoned = false;
    this.summonedByInstance.clear();
    this.bossfightLevel = 1;
    this.bossfightCurrentBoss = 'Magician';
    this.loadBossfightMenuState();
    this.bossfightBossDefeatedThisTurn = false;
    this.bossfightPendingReward = null;
    this.stunnedByInstance.clear();
    this.healingWaitByInstance.clear();
    this.healingRetryReadyByInstance.clear();
    this.avoidChanceIgnoredTargetByInstance.clear();
    this.reverseUsesByInstance.clear();
    this.reverseLastUsedTurnByInstance.clear();
    this.reverseCooldownUntilTurnByInstance.clear();
	this.lobbyJoinAttempts = 0;
    this.lobbyJoinBlockedUntilMs = 0;
    this.pendingMultiplayerMatch = false;
    this.isMultiplayerMatch = false;
    this.activePostCombatDragProxy?.destroy();
    this.activePostCombatDragProxy = null;
    this.deathAlliesDefeatedCount.clear();
    this.reviveCountByInstance.clear();
    this.basicAttackDamageBonusByInstance.clear();
    this.soulDiceSoulsConjured.clear();
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
    this.activeDiceCardKeysByOwner.player.clear();
    this.activeDiceCardKeysByOwner.enemy.clear();
    this.oddInvestmentByOwner = { player: { damage: 0, reduction: 0 }, enemy: { damage: 0, reduction: 0 } };
    this.evenInvestmentByOwner = { player: { damage: 0, reduction: 0 }, enemy: { damage: 0, reduction: 0 } };
    this.fireSupportByOwner = { player: 0, enemy: 0 };
    this.vanguardReductionByOwner = { player: 0, enemy: 0 };
    this.centrelineDamageByOwner = { player: 0, enemy: 0 };
    this.crowdAttackByOwner = { player: { damage: 0, reduction: 0 }, enemy: { damage: 0, reduction: 0 } };
    this.diceTypeUpgradeBonus.clear();
    this.spotlightByInstance.clear();
    this.giantHunterRateByOwner = { player: 0, enemy: 0 };
    this.fountainHealRateByOwner = { player: 0, enemy: 0 };
    this.manaPotionGainByOwner = { player: 0, enemy: 0 };
    this.assassinBoostAttacksByInstance.clear();
    this.specialSkillAttackDepth = 0;
    this.combatOrchestrator.clear();
    this.infiltratedBoardSideByInstance.clear();
    this.chainedByInstance.clear();
    this.hitDuringAttackAction.clear();
    this.persistentLockSourceIds.clear();
    this.diceCardPicksUsed = 0;
    this.multiplayerStatus = this.multiplayerClient.getStatus();
    this.enemyDisplayName = 'Opponent';
  }

  create() {
    this.resetRuntimeState();
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
      this.time.removeAllEvents();
      this.multiplayerClient.disconnect();
      this.combatTimerText?.destroy();
      this.combatTimerText = null;
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

    const subtitle = this.add.text(centerX, centerY - 40, 'PvE Combat Mode', {
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

    const claimedDays = new Set(profile.loginReward?.claimedDays ?? []);
    const loginRewardComplete = claimedDays.size >= 7;
    const loginBtnX = width - 108;
    const loginBtnY = 144;
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

    this.uiContainer.add([wipBadge, playerHeader, title, subtitle, playButton, ...lineupObjects, rules, loginRewardBtn, loginRewardLabel, loginRewardSub]);
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
      const progress = getDiceProgress(this, definition.typeId);
      const accent = Phaser.Display.Color.HexStringToColor(definition.accent).color;
      const card = this.add.rectangle(x, startY + 22, 54, 46, 0x173247, 0.96)
        .setStrokeStyle(2, accent)
        .setInteractive({ useHandCursor: true });
      const label = this.add.text(x, startY + 12, definition.typeId.slice(0, 4).toUpperCase(), {
        fontFamily: 'Orbitron', fontSize: '10px', color: definition.accent
      }).setOrigin(0.5);
      const rarityColor = RARITY_TEXT_COLORS[definition.rarity] ?? PALETTE.text;
      const rarityFill = Phaser.Display.Color.HexStringToColor(rarityColor).color;
      const classCircle = this.add.circle(x + 17, startY + 33, 11, rarityFill, 0.95)
        .setStrokeStyle(1, 0xffffff, 0.55);
      const classText = this.add.text(x + 17, startY + 33, `${progress.classLevel}`, {
        fontFamily: 'Orbitron', fontSize: '9px', color: definition.rarity === 'Common' || definition.rarity === 'Legendary' ? '#111111' : '#ffffff'
      }).setOrigin(0.5);
      card.on('pointerdown', () => this.openArenaDiceStatsModal(definition.typeId));
      objects.push(card, label, classCircle, classText);
    });

    return objects;
  }

  private openArenaDiceStatsModal(typeId: DiceTypeId, formIndex = 0) {
    this.clearModeModal();
    const definition = getAllDiceDefinitions(this).find((die) => die.typeId === typeId);
    if (!definition) return;
    const progress = getDiceProgress(this, typeId);
    const talentDefinition = applyDiceTalent(definition, getEquippedTalentIndex(this, definition));
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
    const rarityStats = this.add.text(cx - 126, cy - 84, scaled.rarity, { fontFamily: 'Orbitron', fontSize: '12px', color: rarityColor, align: 'left' }).setOrigin(0, 0.5);
    const targetStats = this.add.text(cx + 12, cy - 84, `TARGET ${scaled.targetingMode.toUpperCase()}  |  COPIES ${formatCompact(progress.copies)}`, { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.text, align: 'left' }).setOrigin(0, 0.5);
    const skillViewportWidth = 470;
    const skillViewportHeight = 132;
    const skillViewportTop = cy - 70;
    const skillContainer = this.add.container(cx, skillViewportTop);
    const skill = this.add.text(0, 0, formatSkillInfo(scaled, false, 1, formIndex > 0 ? formIndex - 1 : undefined, definition), {
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
      altBtn.on('pointerdown', () => this.openArenaDiceStatsModal(typeId, getNextDiceFormIndex(definition, formIndex)));
    } else {
      altBtn.setVisible(false);
    }
    const closeBtn = this.add.text(cx, cy + 146, 'Close', {
      fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.textMuted,
      backgroundColor: '#173247', padding: { left: 8, right: 8, top: 4, bottom: 4 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerdown', () => this.clearModeModal());

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
    overlay.on('pointerdown', () => this.clearModeModal());
    this.setModalEsc(() => this.clearModeModal());
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
      this.add.text(cx, cy - 60, 'Pure PvP — fixed 10 turns, Classic, current loadouts.', {
        fontFamily: 'Orbitron', fontSize: '14px', color: PALETTE.text
      }).setOrigin(0.5),
      this.add.text(cx, cy - 22, 'Automatically finds a real opponent in the matchmaking queue.\nMatchmaking always uses Classic mode and current loadouts.', {
        fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.textMuted,
        align: 'center', wordWrap: { width: 540 }
      }).setOrigin(0.5)
    );

    const backBtn = this.add.text(cx - 90, cy + 104, '← BACK', {
      fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.accentSoft,
      backgroundColor: '#173247', padding: { left: 12, right: 12, top: 7, bottom: 7 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backBtn.on('pointerdown', () => this.openModeSelectModal());
    elements.push(backBtn);

    const queueBtn = this.add.text(cx + 90, cy + 104, 'ENTER QUEUE →', {
      fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.text,
      backgroundColor: '#2d6f99', padding: { left: 12, right: 12, top: 7, bottom: 7 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    queueBtn.on('pointerdown', () => {
      this.queueArenaMultiplayer({ mode: 'matchmaking', randomMode: false });
    });
    elements.push(queueBtn);

    this.modalContainer = this.add.container(0, 0, elements).setDepth(250);
    this.setModalEsc(() => this.openModeSelectModal());
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


  private normalizeBossfightProgress(value: Partial<BossfightProgress> | null | undefined): BossfightProgress {
    const fallback: BossfightProgress = { unlockedLevels: { Magician: 1, Leon: 1, Basilisk: 1 }, rewardClaims: [] };
    const unlockedLevels = { ...fallback.unlockedLevels };
    BOSSFIGHT_BOSSES.forEach((boss) => {
      const raw = value?.unlockedLevels?.[boss];
      unlockedLevels[boss] = Phaser.Math.Clamp(Math.floor(Number(raw ?? 1) || 1), 1, MAX_BOSSFIGHT_LEVEL);
    });
    const rewardClaims = Array.isArray(value?.rewardClaims)
      ? value.rewardClaims.filter((entry): entry is string => typeof entry === 'string')
      : [];
    return { unlockedLevels, rewardClaims };
  }

  private getBossfightProgress(): BossfightProgress {
    const stored = this.registry.get(BOSSFIGHT_PROGRESS_KEY) as BossfightProgress | undefined;
    if (stored) {
      const normalized = this.normalizeBossfightProgress(stored);
      this.registry.set(BOSSFIGHT_PROGRESS_KEY, normalized);
      return normalized;
    }
    try {
      const parsed = readIntegrityChecked<Partial<BossfightProgress>>(BOSSFIGHT_PROGRESS_KEY) ?? {};
      const normalized = this.normalizeBossfightProgress(parsed);
      this.registry.set(BOSSFIGHT_PROGRESS_KEY, normalized);
      return normalized;
    } catch {
      return this.normalizeBossfightProgress(undefined);
    }
  }

  private setBossfightProgress(progress: BossfightProgress) {
    const normalized = this.normalizeBossfightProgress(progress);
    this.registry.set(BOSSFIGHT_PROGRESS_KEY, normalized);
    writeIntegrityChecked(BOSSFIGHT_PROGRESS_KEY, normalized);
  }

  private getBossfightHighestUnlockedLevel(boss: BossfightBossType): number {
    return this.getBossfightProgress().unlockedLevels[boss];
  }

  private getBossfightClaimKey(boss: BossfightBossType, level: number): string {
    return `${boss}:${level}`;
  }

  private getBossfightRewards(level: number): { tokens: number; chips: number } {
    const boundedLevel = Phaser.Math.Clamp(Math.floor(level), 1, MAX_BOSSFIGHT_LEVEL);
    return { tokens: 1000 + (boundedLevel - 1) * 500, chips: 10 + (boundedLevel - 1) * 5 };
  }

 private loadBossfightMenuState() {
    try {
      const stored = JSON.parse(localStorage.getItem(BOSSFIGHT_MENU_STATE_KEY) ?? '{}') as Partial<{ boss: BossfightBossType; level: number }>;
      const boss = BOSSFIGHT_BOSSES.includes(stored.boss as BossfightBossType) ? stored.boss as BossfightBossType : 'Magician';
      this.bossfightMenuBoss = boss;
      this.bossfightMenuLevel = Phaser.Math.Clamp(Math.floor(Number(stored.level ?? 1) || 1), 1, this.getBossfightHighestUnlockedLevel(boss));
    } catch {
      this.bossfightMenuBoss = 'Magician';
      this.bossfightMenuLevel = 1;
    }
  }

  private saveBossfightMenuState() {
    localStorage.setItem(BOSSFIGHT_MENU_STATE_KEY, JSON.stringify({
      boss: this.bossfightMenuBoss,
      level: this.bossfightMenuLevel
    }));
  }

  private completeBossfightLevel(boss: BossfightBossType, level: number) {
    const progress = this.getBossfightProgress();
    const currentUnlocked = progress.unlockedLevels[boss];
    if (level >= currentUnlocked && currentUnlocked < MAX_BOSSFIGHT_LEVEL) {
      progress.unlockedLevels[boss] = Math.min(MAX_BOSSFIGHT_LEVEL, level + 1);
      this.setBossfightProgress(progress);
    }
  }

  private claimBossfightReward(boss: BossfightBossType, level: number): { tokens: number; chips: number } {
    const progress = this.getBossfightProgress();
    const claimKey = this.getBossfightClaimKey(boss, level);
    if (progress.rewardClaims.includes(claimKey)) return { tokens: 0, chips: 0 };
    const reward = this.getBossfightRewards(level);
    progress.rewardClaims = [...progress.rewardClaims, claimKey];
    this.setBossfightProgress(progress);
    return reward;
  }

  private openBossfightModal() {
    this.clearModeModal();
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const elements: Phaser.GameObjects.GameObject[] = [];
    const progress = this.getBossfightProgress();
    const unlockedLevel = progress.unlockedLevels[this.bossfightMenuBoss];
    this.bossfightMenuLevel = Phaser.Math.Clamp(this.bossfightMenuLevel, 1, unlockedLevel);
    const reward = this.getBossfightRewards(this.bossfightMenuLevel);
    const isMaxSelected = this.bossfightMenuLevel >= unlockedLevel;

    const bossColor: Record<BossfightBossType, string> = { Magician: '#b073ff', Leon: '#e63946', Basilisk: '#6abf69' };
    elements.push(
      this.add.rectangle(cx, cy, width, height, 0x000000, 0.6).setInteractive(),
      this.add.rectangle(cx, cy, 720, 390, 0x102434, 0.98).setStrokeStyle(2, 0x6f5bb5),
      this.add.text(cx, cy - 158, 'BOSSFIGHT', { fontFamily: 'Orbitron', fontSize: '22px', color: PALETTE.accent }).setOrigin(0.5),
      this.add.text(cx, cy - 130, 'Choose a Mythic boss and highest unlocked level.', { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.textMuted }).setOrigin(0.5)
    );

    const makeBossButton = (boss: BossfightBossType, x: number) => {
      const selected = this.bossfightMenuBoss === boss;
      const button = this.add.rectangle(x, cy - 76, 210, 82, selected ? 0x2d4e72 : 0x173247, 0.96)
        .setStrokeStyle(2, Phaser.Display.Color.HexStringToColor(bossColor[boss]).color)
        .setInteractive({ useHandCursor: true });
      const title = this.add.text(x, cy - 94, boss.toUpperCase(), { fontFamily: 'Orbitron', fontSize: '16px', color: bossColor[boss] }).setOrigin(0.5);
      const sub = this.add.text(x, cy - 66, `Unlocked Lv.${progress.unlockedLevels[boss]}`, { fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.textMuted }).setOrigin(0.5);
      button.on('pointerdown', () => {
        this.bossfightMenuBoss = boss;
        this.bossfightMenuLevel = Math.min(this.bossfightMenuLevel, this.getBossfightHighestUnlockedLevel(boss));
		this.saveBossfightMenuState();
        this.openBossfightModal();
      });
      elements.push(button, title, sub);
    };
    makeBossButton('Magician', cx - 180);
    makeBossButton('Leon', cx);
    makeBossButton('Basilisk', cx + 180);

    const levelText = this.add.text(cx, cy + 18, `${this.bossfightMenuBoss} Lv.${this.bossfightMenuLevel}`, {
      fontFamily: 'Orbitron', fontSize: '28px', color: bossColor[this.bossfightMenuBoss]
    }).setOrigin(0.5);
    const leftEnabled = this.bossfightMenuLevel > 1;
    const rightEnabled = this.bossfightMenuLevel < unlockedLevel;
    const left = this.add.text(cx - 148, cy + 18, '◀', { fontFamily: 'Orbitron', fontSize: '28px', color: leftEnabled ? PALETTE.accentSoft : '#4d6170' }).setOrigin(0.5).setInteractive({ useHandCursor: leftEnabled });
    const right = this.add.text(cx + 148, cy + 18, '▶', { fontFamily: 'Orbitron', fontSize: '28px', color: rightEnabled ? PALETTE.accentSoft : '#4d6170' }).setOrigin(0.5).setInteractive({ useHandCursor: rightEnabled });
    if (leftEnabled) left.on('pointerdown', () => { this.bossfightMenuLevel -= 1; this.saveBossfightMenuState(); this.openBossfightModal(); });
    if (rightEnabled) right.on('pointerdown', () => { this.bossfightMenuLevel += 1; this.saveBossfightMenuState(); this.openBossfightModal(); });
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
    this.bossfightLevel = Phaser.Math.Clamp(Math.floor(level), 1, this.getBossfightHighestUnlockedLevel(boss));
	this.bossfightMenuBoss = boss;
    this.bossfightMenuLevel = this.bossfightLevel;
    this.saveBossfightMenuState();
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
    const dateKey = new Date().toISOString().slice(0, 10);
    this.activeDailyKey = dateKey;
    this.dailyHard = Number(dateKey.split('-')[2]) % 4 === 0;
    const dailyStatus = this.getChallengeStatus('daily');
    const deuciferStatus = this.getChallengeStatus('deucifer');
    const dopamineStatus = this.getChallengeStatus('dopamine');
    const makeBtn = (x: number, y: number, label: string, sub: string, onClick: () => void) => {
      const r = this.add.rectangle(x, y, 300, 150, 0x173247, 0.96).setStrokeStyle(2, 0x406987).setInteractive({ useHandCursor: true });
      const t = this.add.text(x, y - 28, label, { fontFamily: 'Orbitron', fontSize: '16px', color: PALETTE.accent }).setOrigin(0.5);
      const d = this.add.text(x, y - 2, sub, { fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.textMuted, align: 'center', wordWrap: { width: 268 } }).setOrigin(0.5, 0);
      r.on('pointerdown', onClick);
      return [r, t, d];
    };
    const dailyLoadoutMode = this.getDailyLoadoutMode();
    const dailyClassMode = this.getDailyUsesRandomClassUps() ? 'Random class-ups' : 'Your class-ups';
    const dailyModeLabel = dailyLoadoutMode === 'mirror'
      ? 'Mirror vs mirror'
      : dailyLoadoutMode === 'random-vs-random'
      ? 'Random vs random'
      : 'Your loadout vs enemy loadout';
    const dailyReward = this.dailyHard ? '2400 Tokens + 30 Chips' : '800 Tokens + 10 Chips';
    const daily = makeBtn(cx - 320, cy, `Daily Challenge${this.dailyHard ? ' ☠ HARD!' : ''}`, `Status: ${this.getChallengeStatusLabel(dailyStatus)}\n${dailyModeLabel}\n${dailyClassMode}\nReward: ${dailyReward}`, () => {
      this.activeChallenge = 'daily';
      if (this.getChallengeStatus('daily') !== 'completed') this.setChallengeStatus('daily', 'started');
      this.configRandomMode = true;
      this.configRandomizeLoadoutAndClassUps = this.getDailyUsesRandomClassUps();
      this.configUseLevelling = true;
      this.configDifficulty = this.dailyHard ? 'Nightmare' : 'Medium';
      this.turnLimit = 10;
      this.clearModeModal();
      this.startGame();
    });
    const dopamine = makeBtn(cx, cy, `Dopamine Challenge`, `Status: ${this.getChallengeStatusLabel(dopamineStatus)}\nMedium • Dice Card • 10 Turns\nReward: ${formatCompact(2500)} Tokens + ${formatCompact(20)} Chips`, () => {
      this.activeChallenge = 'dopamine';
      this.activeDailyKey = '';
      if (this.getChallengeStatus('dopamine') !== 'completed') this.setChallengeStatus('dopamine', 'started');
      this.configRandomMode = true;
      this.activeRandomModifier = 'DiceCard';
      this.configRandomizeLoadoutAndClassUps = false;
      this.configDifficulty = 'Medium';
      this.configUseLevelling = true;
      this.turnLimit = 10;
      this.clearModeModal();
      this.startGame();
    });
    const deuc = makeBtn(cx + 320, cy, `Deucifer's Challenge`, `Status: ${this.getChallengeStatusLabel(deuciferStatus)}\nNightmare Deucifer\nClassic • 10 Turns — Deucifer joins at round 10 (+10 vs boss)\nReward: ${formatCompact(7500)} Tokens + ${formatCompact(50)} Chips`, () => {
      this.activeChallenge = 'deucifer';
      this.activeDailyKey = '';
      if (this.getChallengeStatus('deucifer') !== 'completed') this.setChallengeStatus('deucifer', 'started');
      this.configRandomMode = false;
      this.configDifficulty = 'Nightmare';
      this.configUseLevelling = true;
      this.turnLimit = 10;
      this.clearModeModal();
      this.startGame();
    });
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

  private getDailySeededModifier(): RandomModeModifier {
    const modifiers: RandomModeModifier[] = ['Classic', 'Combanity', 'Duality', 'Necromancy', 'DiceCard'];
    const key = this.activeDailyKey || new Date().toISOString().slice(0, 10);
    const seed = [...`${key}:modifier:v2`].reduce((acc, ch) => ((acc * 31) + ch.charCodeAt(0)) >>> 0, 2166136261);
    return modifiers[seed % modifiers.length] ?? 'Classic';
  }

  private getDailyLoadoutMode(): DailyLoadoutMode {
    const roll = this.getDailySeededIndex('daily-loadout-mode', 100);
    if (roll < 33) return 'mirror';
    if (roll < 67) return 'player-vs-enemy';
    return 'random-vs-random';
  }

  private getDailyUsesRandomClassUps(): boolean {
    return this.getDailySeededIndex('daily-class-mode', 2) === 0;
  }

  private getDailySeededIndex(label: string, length: number): number {
    if (length <= 0) return 0;
    const key = this.activeDailyKey || new Date().toISOString().slice(0, 10);
    const seed = [...`${key}:${label}:v2`].reduce((acc, ch) => ((acc * 33) ^ ch.charCodeAt(0)) >>> 0, 5381);
    return seed % length;
  }

  private getChallengeStatusStore(): Record<string, ChallengeStatus> {
    try {
      return readIntegrityChecked<Record<string, ChallengeStatus>>(CHALLENGE_STATUS_KEY) ?? {};
    } catch {
      return {};
    }
  }

  private getChallengeStatus(challenge: Exclude<ChallengeKey, null>): ChallengeStatus {
    const store = this.getChallengeStatusStore();
    if (challenge === 'daily') return store[`daily:${this.activeDailyKey || new Date().toISOString().slice(0, 10)}`] ?? 'not-started';
    return store[challenge] ?? 'not-started';
  }

  private setChallengeStatus(challenge: Exclude<ChallengeKey, null>, status: ChallengeStatus) {
    const store = this.getChallengeStatusStore();
    const key = challenge === 'daily' ? `daily:${this.activeDailyKey || new Date().toISOString().slice(0, 10)}` : challenge;
    store[key] = status;
    writeIntegrityChecked(CHALLENGE_STATUS_KEY, store);
  }

  private getChallengeStatusLabel(status: ChallengeStatus): string {
    if (status === 'started') return 'STARTED';
    if (status === 'completed') return 'COMPLETED';
    if (status === 'failed') return 'FAILED';
    return 'NOT STARTED';
  }

  private hasStrikeFirstSkill(definition: DiceDefinition | undefined, die?: DiceInstanceState): boolean {
    if (!definition) return false;
    const classLevel = die ? this.instanceClassLevels.get(die.instanceId) ?? 1 : 1;
    return canSkillStrikeFirst(definition, classLevel);
  }

  private getLoginRewardProgress() {
    const today = new Date().toISOString().slice(0, 10);
    const profile = ProfileStore.get(this);
    const reward = profile.loginReward ?? { startDate: today, claimedDays: [] as number[] };
    const rawClaimedDays = Array.isArray(reward.claimedDays) ? reward.claimedDays : [];
    const validClaimedDays = [...new Set(rawClaimedDays
      .map((d) => Math.floor(Number(d)))
      .filter((d) => d >= 1 && d <= 7))]
      .sort((a, b) => a - b);
    const contiguousClaimedDays = validClaimedDays.filter((day, index) => day === index + 1);
    const claimed = new Set(contiguousClaimedDays);
    const isMalformed = Boolean(profile.loginReward) && rawClaimedDays.length > 0 && (
      rawClaimedDays.length !== validClaimedDays.length
      || validClaimedDays.length !== contiguousClaimedDays.length
      || validClaimedDays.some((day, index) => day !== index + 1)
    );
    if (isMalformed) {
      ProfileStore.set(this, {
        loginReward: {
          ...reward,
          claimedDays: contiguousClaimedDays,
          lastClaimDate: undefined,
          lastClaimAt: undefined,
          day7LegendaryTypeId: contiguousClaimedDays.includes(7) ? reward.day7LegendaryTypeId : undefined,
          day7LegendaryTitle: contiguousClaimedDays.includes(7) ? reward.day7LegendaryTitle : undefined
        }
      });
    }
    const startMs = new Date(`${reward.startDate}T00:00:00Z`).getTime();
    const todayMs = new Date(`${today}T00:00:00Z`).getTime();
    const elapsedDays = Number.isFinite(startMs) ? Math.max(0, Math.floor((todayMs - startMs) / 86400000)) : 0;
    const unlockedDay = Math.max(1, Math.min(7, elapsedDays + 1));
    const nextSequentialDay = claimed.size + 1;
    const alreadyClaimedToday = reward.lastClaimDate === today;
    const nextClaimableDay = !alreadyClaimedToday && nextSequentialDay <= unlockedDay && nextSequentialDay <= 7 ? nextSequentialDay : null;
    const nextUnlockDay = Math.min(7, Math.max(nextSequentialDay, unlockedDay + 1));
    return { reward, claimed, unlockedDay, nextClaimableDay, nextUnlockDay, alreadyClaimedToday, isComplete: claimed.size >= 7, isMalformed };
  }

  private openLoginRewardModal() {
    const { reward, claimed, unlockedDay, nextClaimableDay, nextUnlockDay, alreadyClaimedToday, isComplete, isMalformed } = this.getLoginRewardProgress();
    
    this.clearModeModal();
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    
    const overlay = this.add.rectangle(cx, cy, width, height, 0x000000, 0.7).setInteractive().setDepth(250);
    const panel = this.add.rectangle(cx, cy, 580, 420, 0x102434, 0.98).setStrokeStyle(2, 0xf4b860).setDepth(251);
    const title = this.add.text(cx, cy - 170, '7-DAY LOGIN REWARDS', { fontFamily: 'Orbitron', fontSize: '20px', color: '#f4b860' }).setOrigin(0.5).setDepth(252);
    
    const rewards = [
      { day: 1, label: '+50 Diamonds', color: 0x3498db },
      { day: 2, label: '+1,000 Tokens', color: 0x9b59b6 },
      { day: 3, label: '+20 Chips', color: 0xe67e22 },
      { day: 4, label: '+100 Diamonds', color: 0x3498db },
      { day: 5, label: '+2,500 Tokens', color: 0x9b59b6 },
      { day: 6, label: '+50 Chips', color: 0xe67e22 },
      { day: 7, label: 'LEGENDARY DIE!', color: 0xf1c40f }
    ];
    
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
      : `${isMalformed ? 'Fixed malformed claim order • ' : ''}Claimed: ${claimed.size}/7 days • ${statusDetail}`;
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
    const { reward, claimed, nextClaimableDay, unlockedDay, alreadyClaimedToday, nextUnlockDay } = this.getLoginRewardProgress();
    
    if (claimed.has(day)) {
      AlertManager.toast(this, { type: 'warning', message: `Day ${day} already claimed!` });
      return;
    }
    if (nextClaimableDay === null || day !== nextClaimableDay) {
      const waitingDay = Math.min(7, unlockedDay + 1);
      AlertManager.toast(this, { type: 'warning', message: alreadyClaimedToday ? `Day ${nextUnlockDay} unlocks tomorrow.` : day > unlockedDay ? `Day ${day} is locked. Come back tomorrow.` : `Claim Day ${nextClaimableDay} first.` });
      if (day > unlockedDay && waitingDay <= 7) AlertManager.toast(this, { type: 'warning', message: `Next reward unlocks on Day ${waitingDay}.` });
      return;
    }
    
    let message = '';
    let claimedDay7LegendaryTypeId = reward.day7LegendaryTypeId;
    let claimedDay7LegendaryTitle = reward.day7LegendaryTitle;
    if (day === 1) { setDiamonds(this, getDiamonds(this) + 50); message = '+50 Diamonds'; }
    if (day === 2) { setDiceTokens(this, getDiceTokens(this) + 1000); message = '+1,000 Dice Tokens'; }
    if (day === 3) { message = '+20 Casino Chips'; CasinoProgressStore.mutate(this, (progress) => ({ ...progress, chips: progress.chips + 20 })); }
    if (day === 4) { setDiamonds(this, getDiamonds(this) + 100); message = '+100 Diamonds'; }
    if (day === 5) { setDiceTokens(this, getDiceTokens(this) + 2500); message = '+2,500 Dice Tokens'; }
    if (day === 6) { message = '+50 Casino Chips'; CasinoProgressStore.mutate(this, (progress) => ({ ...progress, chips: progress.chips + 50 })); }
    if (day === 7) {
      const lastClaimMs = reward.lastClaimAt ? new Date(reward.lastClaimAt).getTime() : 0;
      const nowMs = Date.now();
      const hoursSinceLastClaim = lastClaimMs > 0 ? (nowMs - lastClaimMs) / (1000 * 60 * 60) : 0;
      const canReattemptDay7 = hoursSinceLastClaim >= 24;
      
      if (canReattemptDay7) {
        claimed.delete(7);
      }
      
      const legendaries = getAllDiceDefinitions(this)
        .filter((d) => d.rarity === 'Legendary')
        .filter((d) => canReceiveUsefulCopies(this, d.typeId));
      const pick = legendaries.length > 0 ? securePick(legendaries) : undefined;
      if (pick) {
        grantDiceCopies(this, pick.typeId, 1);
        message = `Legendary Dice: ${pick.title}`;
        claimedDay7LegendaryTypeId = pick.typeId;
        claimedDay7LegendaryTitle = pick.title;
      } else if (canReattemptDay7) {
        setDiceTokens(this, getDiceTokens(this) + 5000);
        message = 'Legendary pool full: +5,000 Dice Tokens (retry tomorrow)';
        claimedDay7LegendaryTypeId = undefined;
        claimedDay7LegendaryTitle = 'Legendary pool full (+5,000 Dice Tokens)';
      } else {
        AlertManager.toast(this, { type: 'warning', message: 'Day 7 already claimed! Come back tomorrow for the next reward cycle.' });
        return;
      }
      AchievementStore.unlock(this, 'darkest_hour');
    }
    
    claimed.add(day);
    ProfileStore.set(this, {
      loginReward: {
        ...reward,
        claimedDays: [...claimed].sort((a, b) => a - b),
        lastClaimDate: new Date().toISOString().slice(0, 10),
        lastClaimAt: new Date().toISOString(),
        day7LegendaryTypeId: day === 7 ? claimedDay7LegendaryTypeId : reward.day7LegendaryTypeId,
        day7LegendaryTitle: day === 7 ? claimedDay7LegendaryTitle : reward.day7LegendaryTitle
      }
    });
    
    AlertManager.toast(this, { type: 'success', message: `Claimed Day ${day}: ${message}` });
    this.openLoginRewardModal();
  }

  private openSingleplayerConfigModal() {
    this.activeChallenge = null;
    this.turnLimit = this.configTurnCount;
    this.clearModeModal();
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const elements: Phaser.GameObjects.GameObject[] = [];

    const randomizeClassLabel = this.add.text(cx - 265, cy + 120, 'Randomize Loadout/Class UP', {
      fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.textMuted
    }).setOrigin(0, 0.5);
    randomizeClassLabel.setVisible(this.configRandomMode);

    elements.push(
      this.add.rectangle(cx, cy, width, height, 0x000000, 0.6).setInteractive(),
      this.add.rectangle(cx, cy, 640, 420, 0x102434, 0.98).setStrokeStyle(2, 0x335770),
      this.add.text(cx, cy - 180, 'SINGLEPLAYER', {
        fontFamily: 'Orbitron', fontSize: '22px', color: PALETTE.accent
      }).setOrigin(0.5),
      this.add.text(cx - 265, cy - 118, 'Difficulty', {
        fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.textMuted
      }).setOrigin(0, 0.5),
      this.add.text(cx - 265, cy - 60, 'Use Levelling', {
        fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.textMuted
      }).setOrigin(0, 0.5),
      this.add.text(cx - 265, cy + 0, 'Turn Count', {
        fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.textMuted
      }).setOrigin(0, 0.5),
      this.add.text(cx - 265, cy + 60, 'Random Mode', {
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
    const rewardHint = this.add.text(cx + 72, cy - 142, '', {
      fontFamily: 'Orbitron', fontSize: '10px', color: '#f4cf8a', align: 'center', wordWrap: { width: 520 }
    }).setOrigin(0.5);
    elements.push(rewardHint);
    const refreshDifficultyHint = () => {
      const selected = difficultyMeta.find((item) => item.value === this.configDifficulty) ?? difficultyMeta[0];
      const claimed = this.hasClaimedBotFirstWin(selected.value);
      rewardHint.setText(`Selected: ${selected.label}  •  First-win reward ${selected.reward}${claimed ? ' (CLAIMED)' : ' (UNCLAIMED)'}`);
    };

    this.makeSelectRow(
      difficultyMeta.map((item) => ({ label: item.label, value: item.value })),
      () => this.configDifficulty, (v) => {
        this.configDifficulty = v;
        refreshDifficultyHint();
      },
      cx + 72, cy - 118, rowContainer
    );
    refreshDifficultyHint();
    this.makeSelectRow(
      [{ label: 'ON', value: true }, { label: 'OFF', value: false }],
      () => this.configUseLevelling, (v) => { this.configUseLevelling = v; },
      cx - 12, cy - 60, rowContainer
    );
    this.makeSelectRow(
      [{ label: '3', value: 3 }, { label: '5', value: 5 }, { label: '7', value: 7 }, { label: '10', value: 10 }, { label: '∞', value: -1 }],
      () => this.configTurnCount, (v) => { this.configTurnCount = v; },
      cx + 84, cy + 0, rowContainer
    );
    this.makeSelectRow(
      [{ label: 'ON', value: true }, { label: 'OFF', value: false }],
      () => this.configRandomMode, (v) => {
        this.configRandomMode = v;
        randomizeClassLabel.setVisible(v);
        randomizeToggle.setVisible(v);
      },
      cx - 12, cy + 60, rowContainer
    );
    const randomizeToggle = this.makeSelectRow(
      [{ label: 'ON', value: true }, { label: 'OFF', value: false }],
      () => this.configRandomizeLoadoutAndClassUps, (v) => { this.configRandomizeLoadoutAndClassUps = v; },
      cx + 96, cy + 120, rowContainer
    );
    randomizeToggle.setVisible(this.configRandomMode);

    const noteText = this.add.text(cx, cy + 84, 'Difficulty changes bot loadout, class range, and placement style.\nSingle reward line shows selected difficulty bonus and claim state.', {
      fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.textMuted, align: 'center'
    }).setOrigin(0.5);
    elements.push(noteText);

    const backBtn = this.add.text(cx - 90, cy + 168, '← BACK', {
      fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.accentSoft,
      backgroundColor: '#173247', padding: { left: 12, right: 12, top: 7, bottom: 7 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backBtn.on('pointerdown', () => this.openSingleplayerModal());
    elements.push(backBtn);

    const startBtn = this.add.text(cx + 90, cy + 168, 'START →', {
      fontFamily: 'Orbitron', fontSize: '13px', color: '#000000',
      backgroundColor: '#2ecc71', padding: { left: 16, right: 16, top: 7, bottom: 7 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    startBtn.on('pointerdown', () => {
      this.activeChallenge = null;
      this.activeDailyKey = '';
      this.turnLimit = this.configTurnCount;
      this.clearModeModal();
      this.startGame();
    });
    elements.push(startBtn);

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

    const backBtn = this.add.text(cx - 90, cy + 140, '← BACK', {
      fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.accentSoft,
      backgroundColor: '#173247', padding: { left: 12, right: 12, top: 7, bottom: 7 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backBtn.on('pointerdown', () => this.openModeSelectModal());
    elements.push(backBtn);

    this.modalContainer = this.add.container(0, 0, elements).setDepth(250);
    this.setModalEsc(() => this.openModeSelectModal());
  }

  private openMultiplayerJoinModal() {
	if (!this.canAttemptLobbyJoin()) return;
    const rawCode = window.prompt('Enter 6-digit lobby code', '');
    if (rawCode === null) return;
    const lobbyCode = this.normalizeLobbyCode(rawCode);
    if (!lobbyCode) {
	  this.registerFailedLobbyJoin();
      AlertManager.toast(this, { type: 'warning', message: 'Enter a valid 6-character lobby code.' });
      return;
    }
    this.queueArenaMultiplayer({ mode: 'multiplayer', lobbyAction: 'join', lobbyCode, randomMode: false });
  }

  private openMultiplayerCreateModal() {
    this.clearModeModal();
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const elements: Phaser.GameObjects.GameObject[] = [];

    elements.push(
      this.add.rectangle(cx, cy, width, height, 0x000000, 0.6).setInteractive(),
      this.add.rectangle(cx, cy, 660, 410, 0x102434, 0.98).setStrokeStyle(2, 0x335770),
      this.add.text(cx, cy - 172, 'CREATE LOBBY', {
        fontFamily: 'Orbitron', fontSize: '22px', color: PALETTE.accent
      }).setOrigin(0.5),
      this.add.text(cx - 265, cy - 104, 'Use Levelling', {
        fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.textMuted
      }).setOrigin(0, 0.5),
      this.add.text(cx - 265, cy - 42, 'Turn Count', {
        fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.textMuted
      }).setOrigin(0, 0.5),
      this.add.text(cx - 265, cy + 20, 'Random Mode', {
        fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.textMuted
      }).setOrigin(0, 0.5)
    );

    const rowContainer = this.add.container(0, 0);
    elements.push(rowContainer);
    this.makeSelectRow(
      [{ label: 'ON', value: true }, { label: 'OFF', value: false }],
      () => this.configUseLevelling, (v) => { this.configUseLevelling = v; },
      cx - 12, cy - 104, rowContainer
    );
    this.makeSelectRow(
      [{ label: '3', value: 3 }, { label: '5', value: 5 }, { label: '7', value: 7 }, { label: '10', value: 10 }, { label: '∞', value: -1 }],
      () => this.configTurnCount, (v) => { this.configTurnCount = v; },
      cx + 84, cy - 42, rowContainer
    );
    this.makeSelectRow(
      [{ label: 'ON', value: true }, { label: 'OFF', value: false }],
      () => this.configRandomMode,
      (v) => { this.configRandomMode = v; },
      cx - 12, cy + 20, rowContainer
    );

    const noteText = this.add.text(cx, cy + 72, 'Creates a Rivalis lobby using your current loadout.\nShare the generated 6-digit code with your friend.', {
      fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.textMuted, align: 'center'
    }).setOrigin(0.5);
    elements.push(noteText);

    const backBtn = this.add.text(cx - 90, cy + 154, '← BACK', {
      fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.accentSoft,
      backgroundColor: '#173247', padding: { left: 12, right: 12, top: 7, bottom: 7 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backBtn.on('pointerdown', () => this.openMultiplayerModal());
    elements.push(backBtn);

    const createBtn = this.add.text(cx + 90, cy + 154, 'CREATE →', {
      fontFamily: 'Orbitron', fontSize: '13px', color: '#000000',
      backgroundColor: '#2ecc71', padding: { left: 16, right: 16, top: 7, bottom: 7 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    createBtn.on('pointerdown', () => {
      const lobbyCode = this.generateLobbyCode();
      this.openMultiplayerLobbyWaitModal(lobbyCode);
      this.queueArenaMultiplayer({ mode: 'multiplayer', lobbyAction: 'create', lobbyCode, randomMode: this.configRandomMode });
    });
    elements.push(createBtn);

    this.modalContainer = this.add.container(0, 0, elements).setDepth(250);
    this.setModalEsc(() => this.openMultiplayerModal());
  }

  private openMultiplayerLobbyWaitModal(lobbyCode: string) {
    this.clearModeModal();
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const closeBtn = this.add.text(cx, cy + 116, 'START LOCAL PREVIEW →', {
      fontFamily: 'Orbitron', fontSize: '13px', color: '#000000',
      backgroundColor: '#2ecc71', padding: { left: 16, right: 16, top: 7, bottom: 7 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerdown', () => {
      if (this.multiplayerClient.configured) {
        AlertManager.toast(this, { type: 'warning', message: 'Waiting for Rivalis lobby match; local fallback is disabled.' });
        return;
      }
      this.clearModeModal();
      this.startGame();
    });
    this.modalContainer = this.add.container(0, 0, [
      this.add.rectangle(cx, cy, width, height, 0x000000, 0.6).setInteractive(),
      this.add.rectangle(cx, cy, 620, 330, 0x102434, 0.98).setStrokeStyle(2, 0x335770),
      this.add.text(cx, cy - 120, 'LOBBY CREATED', { fontFamily: 'Orbitron', fontSize: '22px', color: PALETTE.accent }).setOrigin(0.5),
      this.add.text(cx, cy - 50, lobbyCode, { fontFamily: 'Orbitron', fontSize: '44px', color: '#f4b860' }).setOrigin(0.5),
      this.add.text(cx, cy + 12, 'Share this code with your friend.\nWaiting for Rivalis to match the lobby...', {
        fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.textMuted, align: 'center'
      }).setOrigin(0.5),
      ...(this.multiplayerClient.configured ? [] : [closeBtn])
    ]).setDepth(250);
    this.setModalEsc(() => this.openMultiplayerCreateModal());
  }

  private generateLobbyCode(): string {
    return secureLobbyCode(6);
  }

  private normalizeLobbyCode(code: string): string {
    const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return normalized.length === 6 ? normalized : '';
  }
  
  private getLobbyJoinThrottleRemainingMs(): number {
    if (this.lobbyJoinBlockedUntilMs <= 0) return 0;
    return Math.max(0, this.lobbyJoinBlockedUntilMs - Date.now());
  }

  private registerFailedLobbyJoin(): void {
    this.lobbyJoinAttempts += 1;
    if (this.lobbyJoinAttempts >= LOBBY_JOIN_ATTEMPT_LIMIT) {
      this.lobbyJoinBlockedUntilMs = Date.now() + LOBBY_JOIN_LOCKOUT_MS;
      this.lobbyJoinAttempts = 0;
    }
  }

  private canAttemptLobbyJoin(): boolean {
    const remainingMs = this.getLobbyJoinThrottleRemainingMs();
    if (remainingMs <= 0) return true;
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    AlertManager.toast(this, {
      type: 'warning',
      message: `Too many invalid lobby codes. Try again in ${remainingSeconds}s.`
    });
    return false;
  }

  private queueArenaMultiplayer(options: { mode: 'matchmaking' | 'multiplayer'; lobbyAction?: 'create' | 'join'; lobbyCode?: string; randomMode: boolean }) {
    const profile = ProfileStore.get(this);
    this.playerDisplayName = profile.username || 'Player';
    const loadoutTypeIds = getDiceDefinitions(this).map((definition) => definition.typeId);
	this.pendingMultiplayerMatch = true;
    this.enemyDisplayName = options.mode === 'matchmaking' ? 'Rivalis Opponent' : 'Friend';
    this.turnLimit = options.mode === 'matchmaking' ? 10 : this.configTurnCount;
    this.activeChallenge = null;
    this.activeDailyKey = '';
    this.configRandomMode = options.randomMode;
    this.configRandomizeLoadoutAndClassUps = false;
    const multiplayerUsesLevelling = options.mode === 'matchmaking' ? true : this.configUseLevelling;
    const setStatus = (status: ArenaMultiplayerStatus) => {
      this.multiplayerStatus = status;
      AlertManager.toast(this, {
        type: status.state === 'failed' || status.state === 'disabled' ? 'warning' : 'success',
        message: status.message
      });
	  if (status.state === 'lobby' || status.state === 'matched') {
        this.lobbyJoinAttempts = 0;
        this.lobbyJoinBlockedUntilMs = 0;
      }
      if (status.state === 'failed' && options.lobbyAction === 'join') {
        this.registerFailedLobbyJoin();
      }
      if (status.state === 'connected') {
        this.multiplayerClient.join({
          mode: options.mode,
          lobbyAction: options.lobbyAction,
          lobbyCode: options.lobbyCode,
          playerName: this.playerDisplayName,
          ruleset: 'classic',
          useLevelling: multiplayerUsesLevelling,
          turnLimit: this.turnLimit,
          randomMode: this.configRandomMode,
          loadoutTypeIds
        });
      }
    };
    if (!this.multiplayerClient.configured) {
      AlertManager.toast(this, { type: 'warning', message: this.multiplayerClient.getStatus().message });
      return;
    }
    void this.multiplayerClient.connect(setStatus);
    this.multiplayerStatus = this.multiplayerClient.getStatus();
    if (this.multiplayerStatus.state === 'disabled') {
      AlertManager.toast(this, { type: 'warning', message: this.multiplayerStatus.message });
      return;
    }
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
	const multiplayerMatch = this.pendingMultiplayerMatch;
    const selectedTurnLimit = this.turnLimit;
    const selectedChallenge = this.activeChallenge;
    const selectedDailyKey = this.activeDailyKey;
    const selectedDailyHard = this.dailyHard;
    const selectedRandomMode = this.configRandomMode;
    const selectedRandomizeLoadoutAndClassUps = this.configRandomizeLoadoutAndClassUps;
    const selectedDifficulty = this.configDifficulty;
    const selectedUseLevelling = this.configUseLevelling;
    const selectedEnemyDisplayName = this.enemyDisplayName;
    const selectedPlayerDisplayName = this.playerDisplayName;
    const selectedBossfightBoss = this.bossfightCurrentBoss;
    const selectedBossfightLevel = this.bossfightLevel;

    this.resetRuntimeState();

    this.turnLimit = selectedTurnLimit === -1 ? this.configTurnCount : selectedTurnLimit;
    this.activeChallenge = selectedChallenge;
    this.activeDailyKey = selectedDailyKey;
    this.dailyHard = selectedDailyHard;
    this.configRandomMode = selectedRandomMode;
    this.configRandomizeLoadoutAndClassUps = selectedRandomizeLoadoutAndClassUps;
    this.configDifficulty = selectedDifficulty;
    this.configUseLevelling = selectedUseLevelling;
    this.enemyDisplayName = selectedEnemyDisplayName;
    this.playerDisplayName = selectedPlayerDisplayName;
    this.bossfightCurrentBoss = selectedBossfightBoss;
    this.bossfightLevel = selectedBossfightLevel;
	this.isMultiplayerMatch = multiplayerMatch;
    this.combatLogMatchId += 1;
    this.gamePhase = { stage: 'placement' };
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
        this.initializeBattle();
        this.time.delayedCall(550, () => {
          loading.destroy();
          loadingLabel.destroy();
        });
      }
    });
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
    this.input.keyboard?.on('keydown-ESC', () => this.toggleExitPrompt());
    this.combatHistoryButton = this.add.text(width - 24, 20, 'LOG HISTORY [L]', {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.accentSoft,
      backgroundColor: '#173247',
      padding: { left: 10, right: 10, top: 6, bottom: 6 }
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    this.combatHistoryButton.on('pointerdown', () => this.openCombatLogHistoryModal());
    this.input.keyboard?.on('keydown-L', () => this.openCombatLogHistoryModal());

    this.turnText = this.add.text(width / 2, 60, 'TURN 1', {
      fontFamily: 'Orbitron',
      fontSize: '28px',
      color: PALETTE.accent
    }).setOrigin(0.5).setVisible(false);

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
    const [minClass, maxClass] = BOT_DIFFICULTY_CLASSES[this.configDifficulty];
    return Phaser.Math.Between(minClass, maxClass);
  }

  private initializeBattle() {
    const allDefinitions = getAllDiceDefinitions(this).map((definition) => ({
      ...definition,
      skills: getValidSkillDefinitions(definition)
    }));
    const shouldRandomizeLoadoutAndClassUps = this.configRandomMode && this.configRandomizeLoadoutAndClassUps;
    const dailyLoadoutMode = this.activeChallenge === 'daily' ? this.getDailyLoadoutMode() : null;
    const dailyRandomClassUps = this.activeChallenge === 'daily' && this.getDailyUsesRandomClassUps();
    const dailyMirrorLoadout = dailyLoadoutMode === 'mirror' ? this.pickDailySeededLoadout(allDefinitions, 'mirror') : null;
    const playerLoadoutDefinitions = dailyMirrorLoadout
      ?? (dailyLoadoutMode === 'random-vs-random'
        ? this.pickDailySeededLoadout(allDefinitions, 'player')
        : shouldRandomizeLoadoutAndClassUps && this.activeChallenge !== 'daily'
        ? this.pickRandomLoadout(allDefinitions, false)
        : getDiceDefinitions(this).map((definition) => ({
          ...definition,
          skills: getValidSkillDefinitions(definition)
        })));

    const effectiveLevel = (raw: number) => this.configUseLevelling ? raw : 1;

    const playerClassLevels = new Map<DiceTypeId, number>();
    const playerClassLevelsByInstanceId = new Map<string, number>();
    const enemyClassLevelsByInstanceId = new Map<string, number>();
    const hardDaily = this.activeChallenge === 'daily' && this.dailyHard;
    const playerMaxClass = hardDaily ? 10 : 15;
    const playerClassLevelsBySlot: number[] = [];
    const playerTalentBySlot: Array<number | null> = [];
    const enemyClassLevelsBySlot: number[] = [];
    const playerDefs = playerLoadoutDefinitions
      .map((definition, index) => {
        const classLevel = this.activeChallenge === 'daily' && this.configUseLevelling
          ? (dailyRandomClassUps
            ? Phaser.Math.Between(1, playerMaxClass)
            : effectiveLevel(getDiceProgress(this, definition.typeId).classLevel))
          : shouldRandomizeLoadoutAndClassUps && this.configUseLevelling
          ? Phaser.Math.Between(1, 15)
          : effectiveLevel(getDiceProgress(this, definition.typeId).classLevel);
        const talentIndex = this.resolveLoadoutTalentIndex(definition);
        playerClassLevels.set(definition.typeId, classLevel);
        playerClassLevelsBySlot[index] = classLevel;
        playerTalentBySlot[index] = talentIndex;
        return this.applyClassProgress(
          applyDiceTalent(definition, talentIndex),
          classLevel
        );
      });

    const playerBestClass = [...playerClassLevels.values()].reduce((max, lvl) => Math.max(max, lvl), 1);
    const playerClassBySlot = [...playerClassLevelsBySlot];
    const enemyRawDefs = this.activeChallenge === 'bossfight'
      ? [this.bossfightCurrentBoss]
        .map((typeId) => this.definitions.get(typeId))
        .filter((d): d is DiceDefinition => Boolean(d))
      : this.activeChallenge === 'deucifer'
      ? ['Poison', 'Solitude', 'Judgment', 'Skull', 'Death']
        .map((typeId) => this.definitions.get(typeId) ?? allDefinitions.find((d) => d.typeId === typeId))
        .filter((d): d is DiceDefinition => Boolean(d))
      : this.activeChallenge === 'dopamine'
      ? ['Healing', 'Light', 'Battery', 'Meteor', 'Wind']
        .map((typeId) => allDefinitions.find((d) => d.typeId === typeId))
        .filter((d): d is DiceDefinition => Boolean(d))
		: dailyMirrorLoadout
      ? dailyMirrorLoadout
      : dailyLoadoutMode
      ? this.pickDailySeededLoadout(allDefinitions, 'enemy')
      : this.pickRandomLoadout(allDefinitions, true);
    const enemyDefs = enemyRawDefs.map((definition, index) => {
      const classLevel = this.activeChallenge === 'bossfight'
        ? this.bossfightLevel
        : this.activeChallenge === 'deucifer'
        ? 11
        : this.activeChallenge === 'dopamine'
        ? 7
		: this.activeChallenge === 'daily' && this.configUseLevelling          ? (hardDaily
          ? Math.min(15, (dailyMirrorLoadout
            ? (playerClassBySlot[index % Math.max(1, playerClassBySlot.length)] ?? 1)
            : (playerClassLevels.get(definition.typeId) ?? playerBestClass)) + Phaser.Math.Between(3, 5))
          : dailyMirrorLoadout
          ? (playerClassBySlot[index % Math.max(1, playerClassBySlot.length)] ?? 1)
          : dailyRandomClassUps
          ? Phaser.Math.Between(1, 15)
          : effectiveLevel(getDiceProgress(this, definition.typeId).classLevel))
        : shouldRandomizeLoadoutAndClassUps && this.configUseLevelling
        ? Phaser.Math.Between(1, 15)
        : effectiveLevel(this.rollEnemyClassLevel());
      this.enemyClassLevels.set(`${definition.typeId}:${index}`, classLevel);
      enemyClassLevelsBySlot[index] = classLevel;
      return this.applyClassProgress(definition, classLevel);
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
      const modifiers: RandomModeModifier[] = ['Classic', 'Combanity', 'Duality', 'Necromancy', 'DiceCard'];
      this.activeRandomModifier = this.activeChallenge === 'daily'
        ? this.getDailySeededModifier()
        : this.activeChallenge === 'dopamine'
        ? 'DiceCard'
        : (modifiers[Phaser.Math.Between(0, modifiers.length - 1)] ?? 'Classic');
      if (this.activeRandomModifier === 'Duality') {
        this.gameState = {
          ...this.gameState,
          dice: this.gameState.dice.flatMap((die) => {
            if (die.ownerId !== 'player' && die.ownerId !== 'enemy') return [die];
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
          if (talentIndex !== null && talentIndex !== undefined) this.instanceTalentIndices.set(die.instanceId, talentIndex);
        }
      }
    });

    if (this.activeChallenge === 'deucifer') this.enemyDisplayName = 'Deucifer';
    if (this.activeChallenge === 'bossfight') this.enemyDisplayName = `${this.bossfightCurrentBoss} Lv.${this.bossfightLevel}`;
    if (this.activeChallenge === 'bossfight') {
      AudioManager.playMusic(this, this.bossfightCurrentBoss === 'Magician'
        ? AUDIO_KEYS.magicianMusic
        : this.bossfightCurrentBoss === 'Leon'
        ? AUDIO_KEYS.leonMusic
        : AUDIO_KEYS.basiliskMusic);
    } else {
      AudioManager.playMusic(this, AUDIO_KEYS.arenaMusic);
    }
    this.generateEnemyPositions();

    this.turnText.setVisible(false);
    this.turnText.setText(this.turnLimit === -1 ? `TURN ${this.gameState.turn}` : `TURN ${this.gameState.turn}/${this.turnLimit}`);
    this.time.delayedCall(1000, () => {
      if (!this.sys.isActive()) return;
      this.turnText.setVisible(true);
      this.playTurnBanner(this.turnText.text);
      AudioManager.playSfx(this, AUDIO_KEYS.uiRound);
    });

    this.createHandArea();
    this.setupGridDropZones();
    this.createCombatUI();
    this.updateCombatButtonState();
    this.renderDiceCardInfoPanel();

    this.debug.log('Battle initialized', { turn: this.gameState.turn, playerCount: playerDefs.length, enemyCount: enemyDefs.length });
    if (this.configRandomMode) this.writeCombatLog(`Random Mode: ${this.getRandomModeDisplayName(this.activeRandomModifier ?? 'Classic')} selected.`);
  }

  private getRandomModeDisplayName(modifier: RandomModeModifier): string {
    return modifier === 'DiceCard' ? 'Dice Card' : modifier;
  }

  private getDefinitionForInstance(die: DiceInstanceState): DiceDefinition | undefined {
    return this.instanceDefinitionOverrides.get(die.instanceId) ?? this.definitions.get(die.typeId);
  }

  private getBaseDefinitionForInstance(die: DiceInstanceState): DiceDefinition | undefined {
    return this.definitions.get(die.typeId) ?? this.getDefinitionForInstance(die);
  }

  private getInstanceTalentIndex(die: DiceInstanceState): number | null {
    const stored = this.instanceTalentIndices.get(die.instanceId);
    if (stored !== undefined) return stored;
    const base = this.getBaseDefinitionForInstance(die);
    return base ? getEquippedTalentIndex(this, base) : null;
  }

  private getCombatBaseDefinition(die: DiceInstanceState): DiceDefinition | undefined {
    const base = this.getBaseDefinitionForInstance(die);
    if (!base) return undefined;
    const classLevel = this.instanceClassLevels.get(die.instanceId) ?? 1;
    const withTalent = die.ownerId === 'player'
      ? applyDiceTalent(base, this.getInstanceTalentIndex(die))
      : base;
    return this.applyClassProgress(withTalent, classLevel);
  }

  private applyTransformRootStats(die: DiceInstanceState, transformIndex = 0): DiceInstanceState {
    const baseDefinition = this.getCombatBaseDefinition(die) ?? this.getDefinitionForInstance(die);
    if (!baseDefinition || getInitialTransformIndex(this.getBaseDefinitionForInstance(die) ?? baseDefinition) === undefined) return die;
    if (!baseDefinition.transformStats?.[transformIndex]) return die;
    const transformedDefinition = applyTransformStats(baseDefinition, transformIndex);
    const recoveryRate = getTransformRecoveryRate(this.getBaseDefinitionForInstance(die) ?? baseDefinition, transformIndex) ?? 0;
    this.instanceDefinitionOverrides.set(die.instanceId, transformedDefinition);
    this.gameState = {
      ...this.gameState,
      dice: this.gameState.dice.map((candidate) => {
        if (candidate.instanceId !== die.instanceId) return candidate;
        const maxHealth = transformedDefinition.health;
        const currentHealth = Math.min(maxHealth, Math.max(0, candidate.currentHealth) + Math.floor(maxHealth * recoveryRate));
        return { ...candidate, maxHealth, currentHealth };
      })
    };
    return this.gameState.dice.find((candidate) => candidate.instanceId === die.instanceId) ?? die;
  }

  private getCombatDieName(die: DiceInstanceState): string {
    const title = this.getBaseDefinitionForInstance(die)?.title;
    if (title) return title.replace(/\s+Dice$/i, '');
    return this.formatCombatTypeName(die.typeId);
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

  private renderCombatLogHistoryLines(container: Phaser.GameObjects.Container, viewportWidth: number): number {
    container.removeAll(true);
    const entries = this.combatLogHistory.length
      ? this.combatLogHistory
      : ['(no combat events yet — start a match to see entries appear here)'];
    let y = 0;
    entries.forEach((entry, index) => {
      const line = this.add.text(0, y, `[${(index + 1).toString().padStart(3, '0')}] ${entry}`, {
        fontFamily: 'Orbitron',
        fontSize: '11px',
        color: this.getCombatLogEntryColor(entry),
        wordWrap: { width: viewportWidth - 24 },
        lineSpacing: 4
      }).setOrigin(0, 0);
      container.add(line);
      y += line.height + 4;
    });
    return y;
  }

  private getCombatLogEntryColor(entry: string): string {
    if (!entry.includes('(CRITICAL)')) return PALETTE.text;
    return /\bheals?\b/i.test(entry) ? '#7dff9f' : '#ff6b6b';
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

  private collectOccupiedCells(ownerId: 'player' | 'enemy', excludedInstanceId?: string): Set<string> {
    return this.collectOccupiedCellsOnBoardSide(ownerId, excludedInstanceId);
  }

  private collectOccupiedCellsOnBoardSide(boardSide: 'player' | 'enemy', excludedInstanceId?: string): Set<string> {
    const usedCells = new Set<string>();
    this.gameState.dice.forEach((die) => {
      if (this.getBoardSideForDie(die) !== boardSide || die.instanceId === excludedInstanceId || die.zone !== 'board' || die.isDestroyed || !die.gridPosition) return;
      this.markFootprint(die.gridPosition.row, die.gridPosition.col, this.getFootprintForDie(die), usedCells);
    });
    return usedCells;
  }

  private findRandomFootprintPosition(footprint: number, usedCells: Set<string>, pickColumn: () => number, columnBounds?: { min: number; max: number }): { row: number; col: number } | undefined {
    const minCol = Math.max(0, Math.min(GRID_SIZE - footprint, columnBounds?.min ?? 0));
    const maxCol = Math.max(minCol, Math.min(GRID_SIZE - footprint, columnBounds?.max ?? GRID_SIZE - footprint));
    for (let attempts = 0; attempts < 80; attempts++) {
      const row = Phaser.Math.Between(0, GRID_SIZE - footprint);
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

  private findRandomBossPosition(die: DiceInstanceState, footprint: number, usedCells: Set<string>): { row: number; col: number } | undefined {
    const maxCol = GRID_SIZE - footprint;
    return this.findRandomFootprintPosition(footprint, usedCells, () => Phaser.Math.Between(0, maxCol));
  }

  private isBossDie(die: DiceInstanceState): boolean {
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

  private applyClassProgress(definition: DiceDefinition, classLevel: number): DiceDefinition {
    return applyClassProgression(definition, classLevel);
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
      const rolledPips = secureRandomBetween(1, 6);
      this.dicePips.set(instanceId, rolledPips);
      rollResults.push(`${handDie.typeId}:${rolledPips}`);
      const transformed = this.tryAdvancePipTriggeredTransform(handDie, rolledPips);
      const visualDie = transformed ?? (this.gameState.dice.find((candidate) => candidate.instanceId === instanceId) ?? handDie);
      const container = this.handDice.get(instanceId);
      if (container) {
        const pipText = container.list.find((obj) => obj.name === 'pipText') as Phaser.GameObjects.Text;
        if (pipText) {
          pipText.setText(`${rolledPips}♦`);
          pipText.setColor(PALETTE.accent);
        }
        const visual = this.getTransformedVisual(visualDie);
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
	this.reconcilePipTriggeredTransform(reverseDie, targetPips);
    this.reconcilePipTriggeredTransform(target, reversePips);
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
    const visual = this.getTransformedVisual(handDie);
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
    enemyDice.forEach(die => {
      const rolled = secureRandomBetween(1, 6);
      this.enemyDicePips.set(die.instanceId, rolled);
    });
    this.debug.log('Enemy invisiroll complete', { count: enemyDice.length });
  }
  
  private getPipCount(typeId: DiceTypeId): number {
    switch (typeId) {
      default: return 1;
    }
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
      const visualAccent = this.getTransformedVisual(die)?.accent ?? definition.accent;
      const accent = Phaser.Display.Color.HexStringToColor(visualAccent).color;
      const alpha = this.getTransformedVisual(die) ? 0.55 : 0.28;
      dieRect.setFillStyle(reverseDrag ? 0xffffff : accent, reverseDrag ? 0.42 : alpha);
      dieRect.setStrokeStyle(2, reverseDrag ? 0xffffff : accent);
    });
  }

  private tryPlaceDie(container: Phaser.GameObjects.Container, instanceId: string) {
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
    const boardPlaced = getBoardDice(this.gameState, 'player').length;
    this.placedDiceCount = boardPlaced;
    const canStart = this.placedDiceCount >= requiredDice && this.diceRolled;
    this.startCombatButton.setFillStyle(canStart ? 0xe74c3c : 0x7f8c8d, canStart ? 0.9 : 0.5);
    if (canStart) {
      this.startCombatButton.setInteractive({ useHandCursor: true });
      this.writeCombatLog('All dice placed! Click START COMBAT');
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
  
  private async confirmTurnWithServer(payload: unknown): Promise<boolean> {
    if (!this.isMultiplayerMatch) return true;
    const resolution = await this.multiplayerClient.submitTurn(payload);
    if (!resolution.accepted) {
      this.writeCombatLog(`Server rejected the turn${resolution.message ? `: ${resolution.message}` : '.'}`);
      AlertManager.toast(this, {
        type: 'warning',
        message: resolution.message ?? 'Multiplayer server did not accept the turn.'
      });
      this.startCombatButton.setInteractive({ useHandCursor: true });
      this.startCombatButton.setFillStyle(0xe74c3c, 0.9);
      return false;
    }
    this.applyServerAuthoritativeState(resolution.state);
    return true;
  }

  private applyServerAuthoritativeState(serverState: unknown) {
    if (serverState === undefined || serverState === null) return;
    const sanitized = sanitizeServerBattleState(serverState, this.gameState);
    if (!sanitized) {
      this.debug.warn('Discarded malformed multiplayer state from the server.');
      return;
    }
    this.gameState = sanitized;
    this.renderDice();
    this.renderEnemyDice();
  }

  private async startCombat() {
    const requiredDice = Math.min(25, this.currentHandOrder.length);
    const boardPlaced = getBoardDice(this.gameState, 'player').length;
    if (!this.diceRolled || boardPlaced < requiredDice) {
    this.writeCombatLog(`Place all ${requiredDice} rolled dice before combat.`);
      this.updateCombatButtonState();
      return;
    }
	const turnPayload = {
      turn: this.gameState.turn,
      playerName: this.playerDisplayName,
      dice: this.gameState.dice
        .filter((die) => die.zone === 'board' && !die.isDestroyed)
        .map((die) => ({ ownerId: die.ownerId, typeId: die.typeId, gridPosition: die.gridPosition }))
    };
    if (!(await this.confirmTurnWithServer(turnPayload))) return;
    this.startCombatButton.disableInteractive();
    this.startCombatButton.setFillStyle(0x7f8c8d, 0.5);
    this.rollAllButton.setVisible(false);
    this.rollAllButtonLabel.setVisible(false);
    this.rollHelperText.setVisible(false);

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
    this.chainedByInstance.clear();
    this.hitDuringAttackAction.clear();
    this.persistentLockSourceIds.clear();
    this.healingWaitByInstance.clear();
    this.healingRetryReadyByInstance.clear();
    this.avoidChanceIgnoredTargetByInstance.clear();
    this.invisiRollForEnemies();
    if (this.configRandomMode && this.activeRandomModifier === 'Combanity') {
      const player = this.getRollComboBonus('player');
      const enemy = this.getRollComboBonus('enemy');
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
      () => this.applyShieldTauntsAtCombatStart(),
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
    await this.combatOrchestrator.run(
      this.getCombatFlowContext('CombatStart'),
      () => this.applyLavaPoolDamageAtCombatStart(),
      undefined
    );
    this.renderDice();
    this.renderEnemyDice();
    this.renderLavaPools();

    if (this.checkWinConditions()) return;
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
        if (missing > 0) this.healDie(source.instanceId, Math.ceil(missing * result.missingHealRate));
      }
    }
    if (!result.applyGrowth) return;
    const delta = result.growthDelta ?? 1;
    const current = this.growthDeltaByInstance.get(instanceId) ?? 0;
    const next = current + delta;
    this.growthDeltaByInstance.set(instanceId, next);
    this.recordAttackCountEffect(instanceId, delta);
    const die = this.gameState.dice.find((candidate) => candidate.instanceId === instanceId);
    if (die) {
      this.animateGrowthEffect(die, delta > 0);
      this.writeCombatLog(`${this.getCombatDieName(die)}: ${delta > 0 ? '+' : ''}${delta} attack count (total: ${next > 0 ? '+' : ''}${next})`);
    }
  }

  private async applySpecialSkillAttack(
    source: DiceInstanceState,
    damage: number,
    explicitTarget: DiceInstanceState | undefined,
    meta: ReturnType<typeof getRuntimeSkillMeta>,
    label: string
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
      this.addCombatActionDetail(`${label} hit ${this.getCombatDieName(target)} for ${formatCompact(hit.dealt)}${this.criticalSuffix(hit.critical)}`);
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

  private getAttackCountBuffLines(die: DiceInstanceState): Array<{ text: string; color: string }> {
    const seen = this.attackCountEffectSeenByInstance.get(die.instanceId);
    if (!seen) return [];

    const basePips = die.ownerId === 'player'
      ? (this.dicePips.get(die.instanceId) ?? this.getPipCount(die.typeId))
      : (this.enemyDicePips.get(die.instanceId) ?? this.getPipCount(die.typeId));
    const combatDelta = this.combatAttackCountDeltaByInstance.get(die.instanceId);
    const combatPositiveDelta = this.combatAttackCountPositiveDeltaByInstance.get(die.instanceId);
    const combatNegativeDelta = this.combatAttackCountNegativeDeltaByInstance.get(die.instanceId);
    const fireSupportBonus = this.getFireSupportBonus(die);
    const projectileDelta = Math.max(0, (this.basicAttacksPerAttackByInstance.get(die.instanceId)?.count ?? 1) - 1);
    const additiveDelta = (combatDelta ?? 0)
      + (this.attackDeltaByInstance.get(die.instanceId)?.delta ?? 0)
      + (this.extraAttackTurnsByInstance.get(die.instanceId)?.extra ?? 0)
      + (this.growthDeltaByInstance.get(die.instanceId) ?? 0)
      + fireSupportBonus;
    const multiplier = this.attackMultiplierTurnsByInstance.get(die.instanceId)?.multiplier ?? 1;
    const multiplierDelta = multiplier === 1 ? 0 : Math.floor(Math.max(0, basePips + additiveDelta) * multiplier) - Math.max(0, basePips + additiveDelta);
    const attackCountDelta = additiveDelta + multiplierDelta;

    const positiveDelta = [
      combatPositiveDelta ?? (combatDelta === undefined ? 0 : Math.max(0, combatDelta)),
      this.extraAttackTurnsByInstance.get(die.instanceId)?.extra ?? 0,
      Math.max(0, this.growthDeltaByInstance.get(die.instanceId) ?? 0),
      fireSupportBonus,
      Math.max(0, multiplierDelta),
      Math.max(0, this.attackDeltaByInstance.get(die.instanceId)?.delta ?? 0)
    ].reduce((sum, delta) => sum + Math.max(0, delta), 0);
    const negativeDelta = [
      combatNegativeDelta ?? (combatDelta === undefined ? 0 : Math.min(0, combatDelta)),
      this.attackDeltaByInstance.get(die.instanceId)?.delta ?? 0,
      Math.min(0, this.growthDeltaByInstance.get(die.instanceId) ?? 0),
      Math.min(0, multiplierDelta)
    ].reduce((sum, delta) => sum + Math.min(0, delta), 0);
    const lines: Array<{ text: string; color: string }> = [];
    if (seen.positive && positiveDelta > 0) lines.push({ text: `Attack Count +${positiveDelta}`, color: '#6dff8f' });
    if (seen.negative && negativeDelta < 0) lines.push({ text: `Attack Count ${negativeDelta}`, color: '#ff6b6b' });
    if (lines.length === 0) {
      if (attackCountDelta > 0 && seen.positive) lines.push({ text: `Attack Count +${attackCountDelta}`, color: '#6dff8f' });
      else if (attackCountDelta < 0 && seen.negative) lines.push({ text: `Attack Count ${attackCountDelta}`, color: '#ff6b6b' });
    }
    if (seen.positive && projectileDelta > 0) lines.push({ text: `Projectile Count +${projectileDelta}`, color: '#6dff8f' });
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

  private computeAttackCount(instanceId: string, basePips: number, timeDelta = 0, die?: DiceInstanceState): number {
    const debuff = this.attackDeltaByInstance.get(instanceId)?.delta ?? 0;
    const buff = this.extraAttackTurnsByInstance.get(instanceId)?.extra ?? 0;
    const skillMult = this.attackMultiplierTurnsByInstance.get(instanceId)?.multiplier ?? 1;
    const comboMult = this.combanityAttackMultiplierByInstance.get(instanceId)?.multiplier ?? 1;
    const growthDelta = this.growthDeltaByInstance.get(instanceId) ?? 0;
    const fireSupportBonus = die ? this.getFireSupportBonus(die) : 0;
    const adjusted = Math.max(0, basePips + timeDelta + debuff + buff + growthDelta + fireSupportBonus);
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

  private isDieTransformed(die: DiceInstanceState, definition = this.getDefinitionForInstance(die)): boolean {
    return Boolean(definition && this.getActiveTransformIndex(die, definition) !== undefined);
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
      .find((slot) => slot.meta?.meteorDamage !== undefined || slot.meta?.meteorCount !== undefined);
  }

  private spendBasicAttack(attacker: DiceInstanceState): number {
    const chainedAttacks = Math.max(1, this.basicAttacksPerAttackByInstance.get(attacker.instanceId)?.count ?? 1);
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
      const targets = this.gameState.dice.filter((die) => die.ownerId === targetOwner && die.zone === 'board' && !die.isDestroyed && die.gridPosition);
      const target = this.findSkillTargetForArena(attacker, startMeta.targetingMode ?? 'Nearest', false);
      const pips = attacker.ownerId === 'player' ? (this.dicePips.get(attacker.instanceId) ?? 1) : (this.enemyDicePips.get(attacker.instanceId) ?? 1);
      const startSkill = getValidSkillDefinitions(definition).find((skill) => skill.type === 'CombatStart');
      const result = await this.combatOrchestrator.run(
        this.getCombatFlowContext('CombatStart', attacker, target, 'CombatStart', startSkill?.title),
        () => executeCombatStartSkillEffects(attacker, definition, classLevel, target, targets, pips),
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
      if (startSkillFired && !hasAreaDamage) this.playPhaseSkillSfxForDie(attacker, startMeta);
      this.applySkillGrowth(attacker.instanceId, result);
      this.applySummonResult(attacker, result);
      this.applySkillLocks(attacker, startMeta);
      if (result.specialAttackDamage !== undefined) {
        await this.applySpecialSkillAttack(attacker, result.specialAttackDamage, result.specialAttackTarget, startMeta, 'Combat-start attack');
      }
      if (startMeta.activeStatusEffect !== 'taunt') this.applyStatusApplications(result.statusApplications);
      if (result.grantAttacksToAlly && result.grantAttacksToAlly > 0) {
        const recipient = this.selectAllyAttackRecipient(attacker, this.gameState, result.grantAttacksToAlly);
        if (recipient) {
          this.recordAttackCountEffect(recipient.instanceId, result.grantAttacksToAlly);
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
      if (result.splashTargets?.length) {
        this.playSplashSfxForDie(attacker, startMeta);
        for (const victim of result.splashTargets) {
          const damage = Math.max(1, Math.floor((result.splashDamageAmount ?? definition.attack)
            * this.getCombanityDamageMultiplier(attacker, victim)
            * this.getDiceCardSkillDamageMultiplier(attacker)));
          const hit = this.applyDamageWithRevive(victim.instanceId, damage, { source: attacker });
          this.gameState = hit.state;
          this.showDamageText(victim, hit.dealt, '#ff9f58');
          this.animateSkillEffect('fire', attacker, victim);
          await this.applyDamageDefeatHooks(attacker, victim, hit.defeated || hit.killed);
          this.addCombatActionDetail(`Combat-start splash hit ${this.getCombatDieName(victim)} for ${formatCompact(hit.dealt)}${this.criticalSuffix(hit.critical)}`);
        }
      }
      if (result.heatwaveDamageAmount !== undefined && target?.gridPosition) {
        if (!result.splashTargets?.length) this.playSplashSfxForDie(attacker, startMeta);
        const heatwaveTargets = targets.filter((victim) => victim.instanceId !== target.instanceId
          && victim.gridPosition
          && Math.abs(victim.gridPosition.row - target.gridPosition!.row) <= 1
          && Math.abs(victim.gridPosition.col - target.gridPosition!.col) <= 1);
        for (const victim of heatwaveTargets) {
          const damage = Math.max(1, Math.floor(result.heatwaveDamageAmount * this.getOffenseMultiplier(attacker) * this.getDiceCardSkillDamageMultiplier(attacker)));
          const hit = this.applyDamageWithRevive(victim.instanceId, damage, { source: attacker });
          this.gameState = hit.state;
          this.showDamageText(victim, hit.dealt, '#ff7a35');
          this.animateSkillEffect('heatwave', attacker, victim);
          await this.applyDamageDefeatHooks(attacker, victim, hit.defeated || hit.killed);
          this.addCombatActionDetail(`Combat-start heatwave hit ${this.getCombatDieName(victim)} for ${formatCompact(hit.dealt)}${this.criticalSuffix(hit.critical)}`);
        }
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
    const playerCombatStartAuras = collectCombatStartAuras(playerBoardDice, (die) => this.getDefinitionForInstance(die));
    const enemyCombatStartAuras = collectCombatStartAuras(enemyBoardDice, (die) => this.getDefinitionForInstance(die));
    const combatStartBonusFor = (die: DiceInstanceState) => computeCombatStartBonus(die, playerCombatStartAuras, enemyCombatStartAuras);
    const combatStartFoeBonusFor = (die: DiceInstanceState) => computeCombatStartFoeBonus(die, playerCombatStartAuras, enemyCombatStartAuras);
    const rolledPipsFor = (die: DiceInstanceState) => die.ownerId === 'player'
      ? (this.dicePips.get(die.instanceId) ?? this.getPipCount(die.typeId))
      : (this.enemyDicePips.get(die.instanceId) ?? this.getPipCount(die.typeId));
    const collectPipAttackAuras = (dice: DiceInstanceState[]) => dice
      .map((die) => {
        const definition = this.getDefinitionForInstance(die);
        if (!definition) return null;
        const meta = getRuntimeSkillMeta(definition);
        const allyDelta = meta.pipMatchAllyAttackDelta ?? 0;
        const foeDelta = meta.pipMatchFoeAttackDelta ?? 0;
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
          const pipTransform = this.pipTransformTriggeredThisTurn.has(die.instanceId)
            ? undefined
            : this.tryAdvancePipTriggeredTransform(die, basePips);
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
        const withPermanent = this.computeAttackCount(transformedDie.instanceId, pips, pipAuraDelta, transformedDie);
        const stunned = this.stunnedByInstance.has(transformedDie.instanceId);
        const mightyRoar = shouldMightyRoar(transformedDie);

        return {
          ...transformedDie,
          hasFinishedAttacking: stunned || (!mightyRoar && withPermanent <= 0),
          attacksRemaining: stunned ? 0 : Math.max(mightyRoar ? 1 : 0, withPermanent)
        };
      })
    };
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
        if (stacks.length > 0) this.timeStatusByInstance.set(die.instanceId, stacks);
      });
    if (this.configRandomMode && this.activeRandomModifier === 'Combanity') {
      nextState = this.applyCombanityBonuses(nextState);
    }
    nextState.dice.forEach((die) => {
      if (die.zone === 'board' && !die.isDestroyed) this.attackCapacityByInstance.set(die.instanceId, Math.max(0, die.attacksRemaining));
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
        AnimationManager.animateLightCombatStart(this, x, y, Math.max(1, combatStartMeta.allyExtraAttacks ?? 1));
      }
    });
    return nextState;
  }

  private getRollComboBonus(ownerId: 'player' | 'enemy'): { multiplier: number; reduction: number; label: string } {
    const enemyRollSources = this.gameState.dice.filter((die) => die.ownerId === 'enemy' && !die.isDestroyed && (die.zone === 'board' || die.zone === 'hand'));
    const values = (ownerId === 'player'
      ? this.currentHandOrder.map((instanceId) => this.dicePips.get(instanceId) ?? 1)
      : enemyRollSources.map((die) => this.enemyDicePips.get(die.instanceId) ?? 1))
      .sort((a, b) => a - b);
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

  private applyCombanityBonuses(state: MatchBattleState): MatchBattleState {
    const player = this.getRollComboBonus('player');
    const enemy = this.getRollComboBonus('enemy');
    this.combanityBonusByOwner = {
      player: { multiplier: player.multiplier, reduction: player.reduction, label: player.label, allowsFullReduction: player.label === 'Five-of-a-kind' },
      enemy: { multiplier: enemy.multiplier, reduction: enemy.reduction, label: enemy.label, allowsFullReduction: enemy.label === 'Five-of-a-kind' }
    };
    this.writeCombatLog(`Combanity: You rolled ${player.label} (${player.multiplier}x), Bot rolled ${enemy.label} (${enemy.multiplier}x).`);
    return {
      ...state,
      dice: state.dice.map((die) => {
        if (die.zone !== 'board' || die.isDestroyed) return die;
        const bonus = die.ownerId === 'player' ? player : enemy;
        this.combanityAttackMultiplierByInstance.set(die.instanceId, { multiplier: bonus.multiplier, turns: 1 });
        this.recordAttackCountEffect(die.instanceId, bonus.multiplier - 1);
        this.damageReductionByInstance.set(die.instanceId, Phaser.Math.Clamp(bonus.reduction, 0, bonus.label === 'Five-of-a-kind' ? 1 : 0.95));
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
    if (!this.configRandomMode || this.activeRandomModifier !== 'Combanity') return 1;
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
    AnimationManager.animateTimeActive(this, x, y);
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
      const manaEffect = getCombatStartManaEffect(definition, this.instanceClassLevels.get(source.instanceId) ?? 1);
      if (!manaEffect) continue;
      const meta = getRuntimeSkillMetaForTrigger(definition, 'CombatStart');
      const addTo = (die: DiceInstanceState, amount: number) => {
        if (amount <= 0 || this.getManaCapForDie(die) <= 0) return;
        this.addManaToAllActiveSlots(die, Math.floor(amount));
        if (die.gridPosition) {
          const grid = this.getGridContainerForDie(die);
          const x = grid.x + die.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
          const y = grid.y + die.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
          AnimationManager.animateBatteryCharge(this, x, y, die.instanceId === source.instanceId ? 0x95c2ff : 0x3f5573);
        }
      };
      addTo(source, manaEffect.selfGain);
      const summonedParentId = this.summonedByInstance.get(source.instanceId);
      const allies = summonedParentId
        ? boardDice.filter((die) => die.instanceId === summonedParentId && die.ownerId === source.ownerId)
        : boardDice.filter((die) => die.ownerId === source.ownerId && die.instanceId !== source.instanceId);
      const foes = boardDice.filter((die) => die.ownerId !== source.ownerId);
      allies.forEach((die) => addTo(die, manaEffect.allyGain));
      foes.forEach((die) => addTo(die, manaEffect.foeGain));

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

  private async maybeRunDiceCardDraft() {
    if (!this.configRandomMode || this.activeRandomModifier !== 'DiceCard') return;
    if (!canOfferDiceCards(this.gameState.turn, this.diceCardPicksUsed)) return;

    const rarity = getDiceCardRarityRoll(() => secureRandom());
    const playerCards = rollDiceCards(3, rarity, 'player', this.gameState.dice, this.definitions, this.activeDiceCardKeys, () => secureRandom());
    if (playerCards.length === 0) return;
    const picked = await this.showDiceCardPicker(playerCards);
    this.applyDiceCard(picked, 'player');

    const enemyCards = rollDiceCards(3, rarity, 'enemy', this.gameState.dice, this.definitions, this.activeDiceCardKeys, () => secureRandom());
    if (enemyCards.length > 0) this.applyDiceCard(enemyCards[Phaser.Math.Between(0, enemyCards.length - 1)], 'enemy');

    this.diceCardPicksUsed += 1;
  }

  private async showDiceCardPicker(cards: DiceCard[]): Promise<DiceCard> {
    return await new Promise<DiceCard>((resolve) => {
      const c = this.add.container(this.scale.width / 2, this.scale.height / 2).setDepth(500);
      const bg = this.add.rectangle(0, 0, 560, 250, 0x071018, 0.96).setStrokeStyle(2, 0xc28f4a);
      const title = this.add.text(0, -95, 'Choose a Dice Card', { fontFamily: 'Orbitron', fontSize: '20px', color: '#ffe8c6' }).setOrigin(0.5);
      c.add([bg, title]);
      cards.forEach((card, idx) => {
        const x = -170 + idx * 170;
            const info = this.getDiceCardDescription(card.key);
        const btn = this.add.rectangle(x, 10, 150, 130, 0x16344a, 0.95).setStrokeStyle(2, 0xf0c36a).setInteractive({ useHandCursor: true });
        const iconText = this.add.text(x, -34, info.icon, { fontSize: '30px', color: info.color ?? '#ffffff' }).setOrigin(0.5);
        const tx = this.add.text(x, 26, `${card.rarity}\n${card.title}`, { fontFamily: 'Orbitron', fontSize: '13px', color: '#ffffff', align: 'center', wordWrap: { width: 138 } }).setOrigin(0.5);
        btn.on('pointerdown', () => { c.destroy(true); resolve(card); });
        c.add([btn, iconText, tx]);
      });
    });
  }

  private applyDiceCard(card: DiceCard, owner: 'player' | 'enemy') {
    this.activeDiceCardKeys.add(card.key);
    this.activeDiceCardKeysByOwner[owner].add(card.key);
    const mag = getDiceCardMagnitude(card.rarity);
    if (card.kind === 'Fountain of Love') {
      const add = [0, 0.1, 0.15, 0.2][mag];
      this.fountainHealRateByOwner[owner] += add;
    }
    if (card.kind === 'Mana Potion') { this.manaPotionGainByOwner[owner] += mag; }
    if (card.kind === 'Spotlight') {
      const scale = [0, 0.2, 0.3, 0.4][mag];
      const side = this.gameState.dice.filter((d) => d.ownerId === owner);
      side.forEach((d) => this.spotlightByInstance.set(d.instanceId, { mult: 1 + scale, reduction: scale }));
    }
    if (card.kind === 'Type Upgrade' && card.typeId) {
      const bonusRate = [0, 0.5, 0.75, 1][mag];
      const key = `${owner}:${card.typeId}`;
      this.diceTypeUpgradeBonus.set(key, (this.diceTypeUpgradeBonus.get(key) ?? 0) + bonusRate);
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
    if (card.kind === 'Giant Hunter') { this.giantHunterRateByOwner[owner] += [0, 0.01, 0.02, 0.03][mag]; }
    if (card.kind === 'Odd Investment') this.oddInvestmentByOwner[owner] = { damage: this.oddInvestmentByOwner[owner].damage + [0, 0.2, 0.3, 0.4][mag], reduction: this.oddInvestmentByOwner[owner].reduction + [0, 0.1, 0.15, 0.2][mag] };
    if (card.kind === 'Even Investment') this.evenInvestmentByOwner[owner] = { damage: this.evenInvestmentByOwner[owner].damage + [0, 0.2, 0.3, 0.4][mag], reduction: this.evenInvestmentByOwner[owner].reduction + [0, 0.1, 0.15, 0.2][mag] };
    if (card.kind === 'Crowd Attack') this.crowdAttackByOwner[owner] = { damage: this.crowdAttackByOwner[owner].damage + [0, 0.2, 0.3, 0.4][mag], reduction: this.crowdAttackByOwner[owner].reduction + [0, 0.1, 0.15, 0.2][mag] };
    if (card.kind === 'Fire Support') this.fireSupportByOwner[owner] += [0, 1, 2, 3][mag];
    if (card.kind === 'Vanguard') this.vanguardReductionByOwner[owner] += [0, 0.2, 0.3, 0.4][mag];
    if (card.kind === 'Centreline') this.centrelineDamageByOwner[owner] += [0, 0.2, 0.4, 0.6][mag];
    this.renderDiceCardInfoPanel();
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

  private applyShieldTauntsAtCombatStart() {
    this.tauntedByInstance.clear();
    const boardDice = this.gameState.dice.filter((die) => die.zone === 'board' && !die.isDestroyed && die.gridPosition);
    boardDice.forEach((shield) => {
      const definition = this.getDefinitionForInstance(shield);
      if (!definition) return;
      const taunt = getCombatStartTauntEffect(definition, this.instanceClassLevels.get(shield.instanceId) ?? 1);
      if (!taunt) return;
      boardDice.filter((foe) => foe.ownerId !== shield.ownerId).forEach((foe) => {
        const distance = this.getDistanceWithBoardSides(shield, foe);
        if (distance <= taunt.range) this.tauntedByInstance.set(foe.instanceId, { sourceId: shield.instanceId, turns: taunt.duration });
      });
    });
  }

  private applySkillLocks(source: DiceInstanceState, meta: ReturnType<typeof getRuntimeSkillMeta>, persistsAfterSourceDefeat = false) {
    if (!meta.canLockFoes && !meta.canLockAllies) return;
    const definition = this.getDefinitionForInstance(source);
    if (!definition || !source.gridPosition) return;

    const range = Math.max(1, meta.lockRange ?? this.getEffectiveAttackRange(source, definition));
    const numLocks = Math.max(1, Math.floor(meta.numLocks ?? 1));
    const candidates = this.gameState.dice
      .filter((die): die is DiceInstanceState & { gridPosition: { row: number; col: number } } => {
        if (die.instanceId === source.instanceId || die.zone !== 'board' || die.isDestroyed || !die.gridPosition) return false;
        if (this.isBossDie(die)) return false;
        const isFoe = die.ownerId !== source.ownerId;
        const allowedOwner = (isFoe && meta.canLockFoes === true) || (!isFoe && meta.canLockAllies === true);
        if (!allowedOwner || this.chainedByInstance.has(die.instanceId)) return false;
        return this.getDistanceWithBoardSides(source, die) <= range;
      })
      .map((die) => ({ die, distance: this.getDistanceWithBoardSides(source, die) }));

    const mode = meta.activeSkillTargeting ?? meta.skillTargeting ?? meta.targetingMode ?? definition.targetingMode ?? 'Nearest';
    for (let index = 0; index < numLocks && candidates.length > 0; index++) {
      const target = this.selectTargetCandidate(candidates, mode);
      if (!target) break;
      this.chainedByInstance.set(target.instanceId, source.instanceId);
      if (persistsAfterSourceDefeat) this.persistentLockSourceIds.add(source.instanceId);
      const candidateIndex = candidates.findIndex((candidate) => candidate.die.instanceId === target.instanceId);
      if (candidateIndex >= 0) candidates.splice(candidateIndex, 1);
    }
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
    return typeBoost * (1 + this.getSpotlightScale(attacker) + this.getInvestmentDamageBonus(attacker) + this.getCrowdAttackDamageBonus(attacker) + this.getCentrelineDamageBonus(attacker));
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

  private getDiceCardSkillDamageMultiplier(attacker: DiceInstanceState): number {
    return this.getOffenseMultiplier(attacker);
  }

  private getBasicAttackDamageBonus(attacker: DiceInstanceState): number {
    const storedBonus = Math.max(0, this.basicAttackDamageBonusByInstance.get(attacker.instanceId) ?? 0);
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition) return storedBonus;
    const meta = getRuntimeSkillMeta(definition);
    const statusBonusRate = Math.max(0, meta.bonusDamagePerStatus ?? 0);
    if (statusBonusRate <= 0) return storedBonus;
    return storedBonus + Math.floor(definition.attack * statusBonusRate * this.getTotalStatusStackCount(attacker));
  }

  private getTotalStatusStackCount(die: DiceInstanceState): number {
    return (['slow', 'poison', 'fracture', 'taunt', 'stun', 'berserk', 'acceleration', 'dilation'] as const)
      .reduce((total, effect) => total + this.getStatusStackCount(die, effect), 0);
  }

  private getGiantHunterBonus(ownerId: 'player' | 'enemy', target: DiceInstanceState): number {
    const rate = this.giantHunterRateByOwner[ownerId];
    if (rate <= 0) return 0;
    const bonus = Math.max(0, Math.floor(target.maxHealth * rate));
    return this.isBossDie(target) ? Math.floor(bonus * 0.5) : bonus;
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
      if (isBackline && fireSupport > 0) buffs.push(`Fire Support +${fireSupport} attacks (backline)`);
      const vanguard = this.getVanguardReduction(die);
      if (vanguard > 0) buffs.push(`Vanguard ${pct(vanguard)} DR (frontline)`);
      const centreline = this.getCentrelineDamageBonus(die);
      if (centreline > 0) buffs.push(`Centreline +${pct(centreline)} dmg (centre)`);
    }
    if (this.fountainHealRateByOwner[owner] > 0) buffs.push(`Fountain of Love ${pct(this.fountainHealRateByOwner[owner])} heal`);
    if (this.manaPotionGainByOwner[owner] > 0) buffs.push(`Mana Potion +${this.manaPotionGainByOwner[owner]} mana`);
    if (this.giantHunterRateByOwner[owner] > 0) buffs.push(`Giant Hunter ${pct(this.giantHunterRateByOwner[owner])} max HP`);
    if (this.configRandomMode && this.activeRandomModifier === 'Combanity') {
      const combo = this.combanityBonusByOwner[owner];
      const drNote = combo.reduction > 0 ? ` / ${pct(combo.reduction)} DR` : '';
      buffs.push(`Combanity: ${combo.label} (${combo.multiplier}x dmg${drNote})`);
    }
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
          .map((die) => `${die.gridPosition!.row},${die.gridPosition!.col}`)
      );
      const placement = chooseInfiltratorPlacement(
        infiltrator,
        definition,
        this.instanceClassLevels.get(infiltrator.instanceId) ?? 1,
        foes,
        occupied,
        GRID_SIZE,
        (from, to) => this.getDistanceWithBoardSides(from, to)
      );
      if (!placement) return;
      this.gameState = {
        ...this.gameState,
        dice: this.gameState.dice.map((die) => die.instanceId === infiltrator.instanceId
          ? { ...die, gridPosition: placement.tile }
          : die)
      };
      this.infiltratedBoardSideByInstance.set(infiltrator.instanceId, placement.targetBoardSide);
      const passiveMeta = getRuntimeSkillMetaForTrigger(definition, 'Passive');
      const boostedAttacks = Math.max(0, Math.floor(passiveMeta.numAttacksBoosted ?? 0));
      this.assassinBoostAttacksByInstance.set(infiltrator.instanceId, boostedAttacks);
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

  private getDistanceWithBoardSides(attacker: DiceInstanceState, target: DiceInstanceState): number {
    if (!attacker.gridPosition || !target.gridPosition) return Number.POSITIVE_INFINITY;
    const attackerSide = this.getBoardSideForDie(attacker);
    const targetSide = this.getBoardSideForDie(target);

    if (attackerSide === targetSide) {
      return Math.abs(attacker.gridPosition.col - target.gridPosition.col);
    }

    const attackerToFrontline = attackerSide === 'player'
      ? GRID_SIZE - attacker.gridPosition.col
      : attacker.gridPosition.col + 1;
    const targetFromFrontline = targetSide === 'player'
      ? GRID_SIZE - target.gridPosition.col
      : target.gridPosition.col + 1;
    return Math.max(0, attackerToFrontline + targetFromFrontline - 1);
  }

  private isOnBlockedBackline(die: DiceInstanceState): boolean {
    if (!die.gridPosition) return false;
    const boardSide = this.getBoardSideForDie(die);
    return (boardSide === 'player' && die.gridPosition.col === 0) || (boardSide === 'enemy' && die.gridPosition.col === GRID_SIZE - 1);
  }

  private getAttackDistance(attacker: DiceInstanceState, target: DiceInstanceState): number {
    if (!attacker.gridPosition || !target.gridPosition) return Number.POSITIVE_INFINITY;
    if (this.infiltratedBoardSideByInstance.has(attacker.instanceId)) {
      const attackerSide = this.getBoardSideForDie(attacker);
      const targetSide = this.getBoardSideForDie(target);
      if (attackerSide !== targetSide) return Number.POSITIVE_INFINITY;
      return Math.abs(attacker.gridPosition.col - target.gridPosition.col) + 1;
    }
    return this.getDistanceWithBoardSides(attacker, target);
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

  private findSkillTargetForArena(attacker: DiceInstanceState, mode: DiceTargetingMode, onlyTargetsAllies: boolean): DiceInstanceState | undefined {
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
    return this.selectTargetCandidate(candidates, mode);
  }

  private getActiveTargetForSlot(attacker: DiceInstanceState, meta: ReturnType<typeof getRuntimeSkillMeta>, forcedTarget?: DiceInstanceState): DiceInstanceState | undefined {
    const mode = meta.activeSkillTargeting ?? meta.skillTargeting ?? meta.targetingMode ?? 'Nearest';
    if (meta.activeHeal !== undefined) return this.findActiveHealTargetForArena(attacker, mode);
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
    if (meta.activeOnlyTargetsAllies || meta.pierceBehindDamage !== undefined || meta.instakill) return true;
    if (meta.hitsAllFoes || meta.hitsAllAllies) return false;
    if (meta.splashDamage !== undefined || meta.splashDamageRate !== undefined || meta.splashDamageRatesByPip !== undefined
      || meta.chainDamage !== undefined || meta.chainDamageRate !== undefined || meta.chainDamageRatesByPip !== undefined
      || meta.heatwaveDamage !== undefined || meta.heatwaveDamageRate !== undefined || meta.heatwaveDamageRatesByPip !== undefined) return true;
    return meta.activeDamage !== undefined
      || meta.activeDamageRate !== undefined
      || meta.activeDamageRatesByPip !== undefined
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
        rowOffset: die.gridPosition.row - primaryTarget.gridPosition!.row,
        colOffset: die.gridPosition.col - primaryTarget.gridPosition!.col
      }))
      .filter(({ rowOffset, colOffset }) => Math.max(Math.abs(rowOffset), Math.abs(colOffset)) <= chainRange);

    const isRow = ({ rowOffset }: { rowOffset: number }) => rowOffset === 0;
    const isColumnOrDiagonal = ({ rowOffset, colOffset }: { rowOffset: number; colOffset: number }) =>
      rowOffset !== 0 && (colOffset === 0 || Math.abs(rowOffset) === Math.abs(colOffset));
	  
    const rowCandidates = inRange.filter(isRow);
    const candidates = (rowCandidates.length > 0 ? rowCandidates : inRange.filter(isColumnOrDiagonal))
      .map(({ die }) => ({
        die,
        distance: Math.max(
          Math.abs(primaryTarget.gridPosition!.row - die.gridPosition.row),
          Math.abs(primaryTarget.gridPosition!.col - die.gridPosition.col)
        )
      }));
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
        const rowOffset = Math.abs(row - target.gridPosition.row);
        const colOffset = Math.abs(col - target.gridPosition.col);
        candidates.push({ row, col, distance: rowOffset + colOffset, rowOffset, colOffset });
      }
    }
    const best = candidates.sort((a, b) => a.distance - b.distance || a.rowOffset - b.rowOffset || a.colOffset - b.colOffset || a.row - b.row || a.col - b.col)[0];
    if (!best) return;
    this.gameState = placeDieOnBoard(this.gameState, die.instanceId, best.row, best.col);
    if (targetBoardSide === die.ownerId) this.infiltratedBoardSideByInstance.delete(die.instanceId);
    else this.infiltratedBoardSideByInstance.set(die.instanceId, targetBoardSide);
  }

  private resolveTauntForcedTarget(attacker: DiceInstanceState): DiceInstanceState | undefined {
    const taunt = this.tauntedByInstance.get(attacker.instanceId);
    if (!taunt) return undefined;
    const shield = this.gameState.dice.find((d) => d.instanceId === taunt.sourceId && d.zone === 'board' && !d.isDestroyed && d.gridPosition);
    if (!shield || !shield.gridPosition || !attacker.gridPosition) return undefined;
    const distance = this.getDistanceWithBoardSides(attacker, shield);
    const shieldDef = this.getDefinitionForInstance(shield);
    const tauntRange = shieldDef ? getRuntimeSkillMeta(shieldDef).tauntRange ?? 2 : 2;
    return distance <= tauntRange && !this.isBlockedByAllyChain(attacker, shield) ? shield : undefined;
  }

  private async applyLavaPoolDamageAtCombatStart() {
    if (this.lavaPoolsByTile.size === 0) return;
    const allBoardDice = this.gameState.dice.filter(d => d.zone === 'board' && !d.isDestroyed && d.gridPosition);
    for (const die of allBoardDice) {
      const boardSide = this.getBoardSideForDie(die);
      const tileKey = `${boardSide}:${die.gridPosition!.row},${die.gridPosition!.col}`;
      const pool = this.lavaPoolsByTile.get(tileKey);
      if (!pool || (pool.sourceOwnerId && die.ownerId === pool.sourceOwnerId)) continue;
      const sourceProxy: DiceInstanceState = { ...die, ownerId: pool.sourceOwnerId ?? die.ownerId, typeId: pool.sourceTypeId ?? die.typeId };
      const lavaMultiplier = this.getCombanityDamageMultiplier(sourceProxy, die) * this.getDiceCardSkillDamageMultiplier(sourceProxy);
      const finalDamage = Math.max(1, Math.floor(pool.damage * lavaMultiplier));
      const lavaHit = this.applyDamageWithRevive(die.instanceId, finalDamage, { source: sourceProxy });
      this.gameState = lavaHit.state;
      this.showDamageText(die, lavaHit.dealt, '#ff9f58');
      await this.applyDamageDefeatHooks(sourceProxy, die, lavaHit.defeated || lavaHit.killed);
      this.addCombatActionDetail(`Lava hit ${this.getCombatDieName(die)} for ${formatCompact(lavaHit.dealt)}${this.criticalSuffix(lavaHit.critical)}`);
      this.writeCombatLog(`${this.getCombatDieName(die)} takes ${formatCompact(lavaHit.dealt)} lava damage${this.criticalSuffix(lavaHit.critical)} from the pool!`);
    }
  }

  private renderLavaPools() {
    const boardWidth = GRID_SIZE * (TILE_SIZE + TILE_GAP) - TILE_GAP;
    const removeOld = (container: Phaser.GameObjects.Container) => {
      const toRemove: Phaser.GameObjects.GameObject[] = [];
      container.each((child: Phaser.GameObjects.GameObject) => {
        if (child.name === 'lava-pool') {
          toRemove.push(child);
        }
      });
      toRemove.forEach(c => c.destroy());
    };

    removeOld(this.playerGridContainer);
    removeOld(this.enemyGridContainer);

    this.lavaPoolsByTile.forEach((pool, key) => {
      const parts = key.split(':');
      if (parts.length < 2) return;
      const ownerId = parts[0];
      const coords = parts[1].split(',');
      if (coords.length < 2) return;
      const row = parseInt(coords[0]);
      const col = parseInt(coords[1]);
      const container = ownerId === 'player' ? this.playerGridContainer : this.enemyGridContainer;
      const tileX = col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
      const tileY = row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;

      const g = this.add.graphics();
      g.name = 'lava-pool';
      g.fillStyle(0xff4500, 0.45);
      g.fillRoundedRect(tileX - TILE_SIZE / 2 + 4, tileY - TILE_SIZE / 2 + 4, TILE_SIZE - 8, TILE_SIZE - 8, 4);
      g.lineStyle(2, 0xff6b00, 0.85);
      g.strokeRoundedRect(tileX - TILE_SIZE / 2 + 4, tileY - TILE_SIZE / 2 + 4, TILE_SIZE - 8, TILE_SIZE - 8, 4);
      container.add(g);
      this.tweens.add({ targets: g, alpha: 0.35, duration: 420, yoyo: true, repeat: -1, ease: 'Sine.InOut' });

      const turnLabel = this.add.text(tileX, tileY + TILE_SIZE / 2 - 10, `${pool.turns}T`, {
        fontFamily: 'Orbitron', fontSize: '9px', color: '#ff8c00'
      }).setOrigin(0.5);
      turnLabel.setName('lava-pool');
      container.add(turnLabel);
    });
    void boardWidth;
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
    this.combatTimeRemainingMs = 30_000;
    this.combatCountdownTriggered = false;
    this.updateCombatTimerUi();
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
        const giantHunter = this.getGiantHunterBonus(assassin.ownerId, target);
        const assassinBoost = (this.assassinBoostAttacksByInstance.get(assassin.instanceId) ?? 0) > 0 ? 2 : 1;
        const proportionalDamage = ironBonus + solitudeBonus;
        const adjustedDamage = Math.max(1, Math.floor((scaledNonProportional + basicDamageBonus + giantHunter) * offenseMult * assassinBoost) + proportionalDamage);
        this.gameState = spendAttack(this.gameState, assassin.instanceId);
        const hit = this.applyDamageWithRevive(target.instanceId, adjustedDamage, { proportionalDamage, source: assassin });
        this.gameState = hit.state;
        this.showDamageText(target, hit.dealt, hit.critical ? '#ff3333' : this.armorShredByInstance.has(target.instanceId) ? '#ff4fd8' : '#ffdf7a');
        await this.applyPassiveSkillEffects(assassin, target);
        await this.applyDamageDefeatHooks(assassin, target, hit.defeated || hit.killed);
        const rem = this.assassinBoostAttacksByInstance.get(assassin.instanceId) ?? 0;
        if (rem > 0) this.assassinBoostAttacksByInstance.set(assassin.instanceId, rem - 1);
        this.writeCombatLog(`${openingOwner === 'player' ? 'Your' : 'Enemy'} ${this.getCombatDieName(assassin)} strikes first for ${formatCompact(hit.dealt)}${this.criticalSuffix(hit.critical)}!`);
        this.renderDice();
        this.renderEnemyDice();
        if (!(await this.delayCombatPaced(350))) return;
        if (this.checkWinConditions()) return;
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
          const meteorSlot = activeSlots.find((slot) => slot.meta?.meteorDamage !== undefined || slot.meta?.meteorCount !== undefined);
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
            unavailableActiveTitle = activeSlot.title;
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
        if (!target && !activeSlot) {
          const passiveMeta = attackerDef ? getRuntimeSkillMetaForTrigger(attackerDef, 'Passive') : undefined;
          if (passiveMeta?.canFireWithNoTargets) {
            await this.applyPassiveSkillEffects(attacker);
          }
          if (teleportSkillFireIndex !== undefined && teleportTriggerMeta) {
            const roarTarget = this.findNearestFoeIgnoringRange(attacker);
            if (roarTarget) {
              this.moveDieBesideTarget(attacker, roarTarget);
              const movedLeon = this.gameState.dice.find((die) => die.instanceId === attacker.instanceId) ?? attacker;
              await this.applyTeleportSkillEffect(movedLeon, roarTarget, teleportSkillFireIndex);
              const stunDuration = getStatusEffectDurationFromModifiers(
                getValidSkillDefinitions(attackerDef!)[teleportSkillFireIndex]?.modifiers,
                'stun'
              ) ?? teleportTriggerMeta.statusDuration;
              if (teleportTriggerMeta.statusEffect === 'stun' || stunDuration !== undefined) {
                this.stunnedByInstance.set(roarTarget.instanceId, this.getSkillDurationTurns(stunDuration) ?? 1);
              }
              this.gameState = spendAttack(this.gameState, attacker.instanceId);
              this.writeCombatLog(`${ownerName} ${this.getCombatDieName(attacker)} teleports beside ${this.getCombatDieName(roarTarget)} and fires ${getValidSkillDefinitions(attackerDef!)[teleportSkillFireIndex]?.title ?? 'its teleport skill'}!`);
              this.renderDice();
              this.renderEnemyDice();
              if (!(await this.delayCombatPaced(500))) {
                timedOut = true;
                break;
              }
              if (this.checkWinConditions()) return;
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
        let targetDefeated = false;
        let didPerformBasicAction = false;
        let basicAttackVisualCount = 1;
        let basicAttackHitCount = 1;
        let basicAttackCritical = false;
        let basicHealCritical = false;

        if (!skipBasicAttack) {
          if (beamLine && (!forcedTarget || forcedTarget.instanceId === beamLine.target.instanceId)) {
            this.playAttackSfx(attacker, attackerMeta);
            const result = await this.executeTranscendenceBeam(attacker, target, beamLine.pattern);
            damage = result.damage;
            targetDefeated = result.targetDestroyed;
            didPerformBasicAction = true;
          } else {
            this.playAttackSfx(attacker, attackerMeta);
            if (attackerMeta?.healOnAttack) {
              const healProjectiles = this.spendBasicAttack(attacker);
              damage = 0;
              basicAttackHitCount = 0;
              let healCritical = false;
              for (let projectileIndex = 0; projectileIndex < healProjectiles; projectileIndex++) {
                const healed = this.applyBasicHeal(attacker, attackerMeta);
                if (healed.healed <= 0) break;
                if (healed.critical) healCritical = true;
                basicAttackHitCount += 1;
                damage += healed.healed;
              }
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
            const giantHunter = this.getGiantHunterBonus(attacker.ownerId, target);
            const assassinBoost = (this.assassinBoostAttacksByInstance.get(attacker.instanceId) ?? 0) > 0 ? 2 : 1;
            const pips = attacker.ownerId === 'player' ? (this.dicePips.get(attacker.instanceId) ?? 1) : (this.enemyDicePips.get(attacker.instanceId) ?? 1);
            const deuciferEvenMult = pips % 2 === 0 ? 1 + (attackerMeta?.deuciferEvenDamageRate ?? 0) : 1;
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
            const bearCrit = secureChance(this.getCriticalChance(criticalChance, criticalChance > 0));
            const bearCritMult = bearCrit ? criticalDamageMultiplier : 1;
             const proportionalDamage = ironBonus + solitudeBonus;
             const adjustedDamage = Math.max(1, Math.floor((scaledNonProportional + basicDamageBonus + giantHunter) * offenseMult * assassinBoost * deuciferEvenMult * lowHpExploitMult * bearCritMult) + proportionalDamage);
            if (adjustedDamage > 200) AchievementStore.unlock(this, 'lotta_damage');
            const projectileCount = this.spendBasicAttack(attacker);
            damage = 0;
            basicAttackHitCount = 0;
            for (let projectileIndex = 0; projectileIndex < projectileCount; projectileIndex++) {
              const projectileTarget = this.gameState.dice.find((die) => die.instanceId === target.instanceId && !die.isDestroyed) ?? target;
              const hit = this.applyDamageWithRevive(projectileTarget.instanceId, adjustedDamage, {
                allowGlobalCrit: bearCrit ? false : undefined,
                proportionalDamage,
                source: attacker
              });
              basicAttackHitCount += 1;
              this.gameState = hit.state;
              damage += hit.dealt;
              if (bearCritMult > 1 || hit.critical) basicAttackCritical = true;
              if (damage > 200) AchievementStore.unlock(this, 'lotta_damage');
              targetDefeated = hit.defeated;
              this.showDamageText(projectileTarget, hit.dealt, bearCritMult > 1 || hit.critical ? '#ff3333' : this.armorShredByInstance.has(projectileTarget.instanceId) ? '#ff4fd8' : '#ffdf7a');
              if (pips % 2 === 1 && (attackerMeta?.deuciferOddSiphonRate ?? 0) > 0) this.healDie(attacker.instanceId, Math.floor(hit.dealt * (attackerMeta?.deuciferOddSiphonRate ?? 0)));
              await this.applyPassiveSkillEffects(attacker, projectileTarget);
              await this.applyDamageDefeatHooks(attacker, projectileTarget, targetDefeated || hit.killed);
              const rem = this.assassinBoostAttacksByInstance.get(attacker.instanceId) ?? 0;
              if (rem > 0) this.assassinBoostAttacksByInstance.set(attacker.instanceId, rem - 1);
              if (targetDefeated) break;
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

        if (anyActiveFires) {
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
        this.writeCombatLog(
          skipBasicAttack
            ? `${ownerName} ${this.getCombatDieName(attacker)} uses ${activeSlot?.title ?? 'active skill'}${details}!`
            : attackerMeta?.healOnAttack
              ? `${ownerName} ${this.getCombatDieName(attacker)} heals ${target.instanceId === attacker.instanceId ? 'itself' : this.getCombatDieName(target)}${projectileFeedback} for ${formatCompact(damage)} health${basicHealCritical ? ' (CRITICAL)' : ''}${details}!`
              : `${ownerName} ${this.getCombatDieName(attacker)} attacks ${this.getCombatDieName(target)}${projectileFeedback} for ${formatCompact(damage)} damage${basicAttackCritical ? ' (CRITICAL)' : ''}!${details}`
        );

        if (!beamTarget && !skipBasicAttack && !attackerMeta?.healOnAttack) this.animateBasicAttackSequence(attacker, target, basicAttackVisualCount);
        this.renderDice();
        this.renderEnemyDice();
        this.syncBerserkSfxState();

        if (!(await this.delayCombatPaced(500))) {
          timedOut = true;
          break;
        }

        if (this.checkWinConditions()) {
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
    this.applyTimedSkillDecay();
    this.gameState = resolveCombatPhase(this.gameState);
    this.tauntedByInstance.clear();
    this.combatAttackCountDeltaByInstance.clear();
    this.combatAttackCountPositiveDeltaByInstance.clear();
    this.combatAttackCountNegativeDeltaByInstance.clear();
    await this.applyTurnBasedEffects();
    this.renderDice();
    this.renderEnemyDice();
    this.renderLavaPools();

    if (this.checkWinConditions()) {
      return;
    }

    if (
      this.activeChallenge === 'deucifer' &&
      this.gameState.turn === 10 &&
      !this.deuciferBossSummoned
    ) {
      this.deuciferBossPending = true;
    }

    if (this.turnLimit !== -1 && this.gameState.turn >= this.turnLimit && !this.deuciferBossPending) {
      this.resolveTurnLimitResult();
      return;
    }

    this.gameState = endTurn(this.gameState);
    this.resetReverseCooldownsAtTurnStart();
    this.restoreEnemyFogForNewTurn();
    if (this.deuciferBossPending) this.summonDeuciferBoss();
    await this.maybeRunDiceCardDraft();
    if (this.configRandomMode && this.activeRandomModifier === 'Necromancy' && this.gameState.turn > 1) {
      this.applyNecromancyTurnEffect();
    }
    this.turnText.setText(this.turnLimit === -1 ? `TURN ${this.gameState.turn}` : `TURN ${this.gameState.turn}/${this.turnLimit}`);
    this.playTurnBanner(this.turnLimit === -1 ? `TURN ${this.gameState.turn}` : `TURN ${this.gameState.turn}/${this.turnLimit}`);
    AudioManager.playSfx(this, AUDIO_KEYS.uiRound);
    this.writeCombatLog(`Turn ${this.gameState.turn} - Roll and place your dice!`);

    await this.returnDiceToHand();
    this.refreshHandAfterPoisonEffects();
    this.renderDice();
    this.renderEnemyDice();
    this.renderLavaPools();
    this.updateCombatButtonState();
  }

  private playAttackSfx(attacker: DiceInstanceState, meta?: ReturnType<typeof getRuntimeSkillMeta>) {
    const baseKey = meta?.attackSfxKey;
    if (baseKey) {
      AudioManager.playSfx(this, baseKey);
      return;
    }
    AudioManager.playRandomSfx(this, [AUDIO_KEYS.diceAttack01, AUDIO_KEYS.diceAttack02, AUDIO_KEYS.diceAttack03]);
  }

  private applyNecromancyTurnEffect() {
    const allDefinitions = getAllDiceDefinitions(this);
    (['player', 'enemy'] as const).forEach((ownerId) => {
      const destroyed = this.gameState.dice.filter((d) => d.ownerId === ownerId && d.isDestroyed);
      if (destroyed.length > 0) {
        const chosen = destroyed[Phaser.Math.Between(0, destroyed.length - 1)];
        if (!chosen) return;
        this.defeatEventIdByInstance.delete(chosen.instanceId);
        this.gameState = {
          ...this.gameState,
          dice: this.gameState.dice.map((d) => d.instanceId === chosen.instanceId
          ? { ...d, isDestroyed: false, currentHealth: d.maxHealth, zone: 'hand', gridPosition: undefined }
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
      const newId = `${ownerId}-${def.typeId}-necro-${Date.now()}-${Phaser.Math.Between(1, 9999)}`;
      this.gameState = {
        ...this.gameState,
        dice: [...this.gameState.dice, {
          instanceId: newId,
          ownerId,
          typeId: def.typeId,
          maxHealth: def.health,
          currentHealth: def.health,
          attacksRemaining: 1,
          zone: 'hand',
          gridPosition: undefined,
          isDestroyed: false,
          hasFinishedAttacking: false
        }]
      };
      this.instanceDefinitionOverrides.set(newId, def);
      this.instanceClassLevels.set(newId, bestClass);
    });
    this.writeCombatLog('Necromancy: a die has been revived or conjured for both sides.');
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
    const poison = this.poisonByInstance.get(instanceId);
    if (!poison) return undefined;
    const activeStacks = poison.stacks.filter((stack) => stack.turns > 0);
    if (activeStacks.length === 0) return undefined;
    return {
      damage: activeStacks.reduce((sum, stack) => sum + stack.damage, 0),
      turns: Math.max(...activeStacks.map((stack) => stack.turns)),
      stacks: activeStacks.length,
      stackDetails: activeStacks.map((stack) => ({ damage: stack.damage, turns: stack.turns }))
    };
  }

  private getAttackDeltaSummary(instanceId: string): {
    delta: number;
    turns: number;
    stacks: number;
    stackDetails: Array<{ delta: number; turns: number }>;
  } | undefined {
    const attackDelta = this.attackDeltaByInstance.get(instanceId);
    if (!attackDelta) return undefined;
    const stacks = attackDelta.stacks?.filter((stack) => stack.turns > 0);
    if (!stacks?.length) {
      return {
        delta: attackDelta.delta,
        turns: attackDelta.turns,
        stacks: Math.abs(attackDelta.delta) > 0 ? 1 : 0,
        stackDetails: [{ delta: attackDelta.delta, turns: attackDelta.turns }]
      };
    }
    return {
      delta: stacks.reduce((sum, stack) => sum + stack.delta, 0),
      turns: Math.max(...stacks.map((stack) => stack.turns)),
      stacks: stacks.length,
      stackDetails: stacks.map((stack) => ({ delta: stack.delta, turns: stack.turns }))
    };
  }

  private getStatusStackCount(die: DiceInstanceState, effect: 'slow' | 'poison' | 'fracture' | 'taunt' | 'stun' | 'berserk' | 'acceleration' | 'dilation'): number {
    if (effect === 'poison') return this.getPoisonSummary(die.instanceId)?.stacks ?? 0;
    if (effect === 'slow') return this.getAttackDeltaSummary(die.instanceId)?.stacks ?? 0;
    if (effect === 'fracture') return this.armorShredByInstance.has(die.instanceId) ? 1 : 0;
    if (effect === 'taunt') return this.tauntedByInstance.has(die.instanceId) ? 1 : 0;
    if (effect === 'stun') return (this.stunnedByInstance.get(die.instanceId) ?? 0) > 0 ? 1 : 0;
    if (effect === 'acceleration' || effect === 'dilation') {
      return (this.timeStatusByInstance.get(die.instanceId) ?? []).filter((status) => status.effect === effect && status.turns > 0).length;
    }
    return this.isBerserkActive(die) ? 1 : 0;
  }

  private getStatusEffects(die: DiceInstanceState): Array<'slow' | 'poison' | 'berserk' | 'taunt' | 'fracture' | 'stun' | 'acceleration' | 'dilation'> {
    const effects: Array<'slow' | 'poison' | 'berserk' | 'taunt' | 'fracture' | 'stun' | 'acceleration' | 'dilation'> = [];
    if ((this.attackDeltaByInstance.get(die.instanceId)?.delta ?? 0) < 0) effects.push('slow');
    if (this.poisonByInstance.has(die.instanceId)) effects.push('poison');
    if (this.isBerserkActive(die)) effects.push('berserk');
    if (this.tauntedByInstance.has(die.instanceId)) effects.push('taunt');
    if (this.armorShredByInstance.has(die.instanceId)) effects.push('fracture');
    if (this.stunnedByInstance.has(die.instanceId)) effects.push('stun');
    if (this.getStatusStackCount(die, 'acceleration') > 0) effects.push('acceleration');
    if (this.getStatusStackCount(die, 'dilation') > 0) effects.push('dilation');
    return effects;
  }

  private getStatusEffectSummaryForDie(die: DiceInstanceState): string[] {
    const statusLines: string[] = [];
    const attackDelta = this.getAttackDeltaSummary(die.instanceId);
    if (attackDelta && attackDelta.delta < 0) {
      const stackText = attackDelta.stacks > 1 ? ` x${attackDelta.stacks}` : '';
      const details = attackDelta.stackDetails.map((stack) => `${stack.delta} attack${Math.abs(stack.delta) === 1 ? '' : 's'} (${stack.turns} turns)`).join(', ');
      statusLines.push(attackDelta.stacks > 1 ? `Slow${stackText}: ${details}` : `Slow ${details}`);
    }
    const poison = this.getPoisonSummary(die.instanceId);
    if (poison) {
      const stackText = poison.stacks > 1 ? ` x${poison.stacks}` : '';
      const details = poison.stackDetails.map((stack) => `${formatCompact(stack.damage)}/turn (${stack.turns} turns)`).join(', ');
      statusLines.push(`Poison${stackText}: ${details}`);
    }
    const timeStatuses = this.timeStatusByInstance.get(die.instanceId) ?? [];
    (['acceleration', 'dilation'] as const).forEach((effect) => {
      const active = timeStatuses.filter((status) => status.effect === effect && status.turns > 0);
      if (active.length === 0) return;
      const label = effect === 'acceleration' ? 'Acceleration' : 'Dilation';
      statusLines.push(`${label}${active.length > 1 ? ` x${active.length}` : ''} (${Math.max(...active.map((status) => status.turns))} turn${Math.max(...active.map((status) => status.turns)) === 1 ? '' : 's'})`);
    });
    const fracture = this.armorShredByInstance.get(die.instanceId);
    if (fracture) statusLines.push(`Fracture +${formatPercent(fracture.rate)} damage taken (${fracture.turns} turns)`);
    const taunt = this.tauntedByInstance.get(die.instanceId);
    if (taunt) statusLines.push('Taunt');
    if (this.getActiveLockSource(die)) statusLines.push('Locked');
    const stunTurns = this.stunnedByInstance.get(die.instanceId);
    if (stunTurns) statusLines.push(`Stun (${stunTurns} turns)`);
    if (this.isBerserkActive(die)) statusLines.push('Berserk active');
    return statusLines;
  }

  private getPlayerHandDie(instanceId: string): DiceInstanceState | undefined {
    return this.gameState.dice.find((die) => die.ownerId === 'player' && die.instanceId === instanceId && die.zone === 'hand' && !die.isDestroyed);
  }

  private rollGlobalCritical(): boolean {
    return secureChance(0.05);
  }

  private getCriticalChance(criticalChance: number, includesBaseChance = false): number {
    return Phaser.Math.Clamp(criticalChance + (includesBaseChance ? 0.05 : 0), 0, 1);
  }

  private applyCriticalDamage(damage: number, options: { allowGlobalCrit?: boolean } = {}): { damage: number; critical: boolean } {
    const critical = options.allowGlobalCrit !== false && this.rollGlobalCritical();
    return { damage: critical ? damage * 2 : damage, critical };
  }

  private applyCriticalHealing(amount: number): { amount: number; critical: boolean } {
    const critical = this.rollGlobalCritical();
    return { amount: critical ? amount * 2 : amount, critical };
  }

  private applyDamageWithRevive(instanceId: string, damage: number, options: { ignoreDamageReduction?: boolean; ignoreShield?: boolean; allowGlobalCrit?: boolean; proportionalDamage?: number; source?: DiceInstanceState } = {}): { state: MatchBattleState; dealt: number; defeated: boolean; killed: boolean; critical: boolean } {
    this.hitDuringAttackAction.add(instanceId);
    const proportionalDamage = Phaser.Math.Clamp(options.proportionalDamage ?? 0, 0, damage);
    const criticalDamage = this.applyCriticalDamage(damage - proportionalDamage, { allowGlobalCrit: options.allowGlobalCrit });
    damage = criticalDamage.damage + proportionalDamage;
    if (criticalDamage.critical) this.criticalDamageTextByInstance.add(instanceId);
    let reduction = options.ignoreDamageReduction ? 0 : (this.damageReductionByInstance.get(instanceId) ?? 0);
    const die = this.gameState.dice.find((d) => d.instanceId === instanceId);
    if (!options.ignoreDamageReduction && die) reduction += this.getSpotlightScale(die);
    if (!options.ignoreDamageReduction && die) reduction += this.getVanguardReduction(die);
    if (!options.ignoreDamageReduction && die) reduction += this.getEffectivePipForInvestment(die) % 2 === 0 ? this.evenInvestmentByOwner[die.ownerId].reduction : this.oddInvestmentByOwner[die.ownerId].reduction;
    if (!options.ignoreDamageReduction && die) {
      const effectivePip = this.getEffectivePipForInvestment(die);
      if (effectivePip === 1 || effectivePip === 2) {
        reduction += this.crowdAttackByOwner[die.ownerId].reduction;
      }
    }
    const allowsFullCombanityReduction = die
      ? this.combanityBonusByOwner[die.ownerId].allowsFullReduction
      : false;
    reduction = Phaser.Math.Clamp(reduction, 0, allowsFullCombanityReduction ? 1 : 0.95);
    if (reduction > 0) damage = Math.max(0, Math.floor(damage * (1 - reduction)));
    const armorShred = this.armorShredByInstance.get(instanceId);
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
        void this.applySpecialSkillAttack(targetDie, onDamagedResult.specialAttackDamage, onDamagedResult.specialAttackTarget, onDamagedMeta, 'On-hit attack');
      }
      if (onDamagedResult.shieldGain && onDamagedResult.shieldGain > 0) {
        this.shieldHpByInstance.set(instanceId, (this.shieldHpByInstance.get(instanceId) ?? 0) + onDamagedResult.shieldGain);
        this.showHealText(targetDie, onDamagedResult.shieldGain);
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
      if (remaining <= 0) {
        if (before && absorbed > 0) grantOnDamagedShield(before, absorbed);
        this.criticalDamageTextByInstance.delete(instanceId);
        return { state: this.gameState, dealt: 0, defeated: false, killed: false, critical: criticalDamage.critical };
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
          void this.applySpecialSkillAttack(before, onDamagedResult.specialAttackDamage, onDamagedResult.specialAttackTarget, onDamagedMeta, 'On-hit attack');
        }
        if (!after.isDestroyed && onDamagedResult.bonusAttacks && onDamagedResult.bonusAttacks > 0) {
          const recipient = onDamagedResult.grantAttacksToAlly !== undefined
            ? this.selectAllyAttackRecipient(before, resolvedState, onDamagedResult.grantAttacksToAlly)
            : after;
          const recipientId = recipient?.instanceId ?? instanceId;
          if (!this.chainedByInstance.has(recipientId)) {
            this.recordAttackCountEffect(recipientId, onDamagedResult.bonusAttacks);
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
        if (!after.isDestroyed && onDamagedResult.shieldGain && onDamagedResult.shieldGain > 0) {
          this.shieldHpByInstance.set(instanceId, (this.shieldHpByInstance.get(instanceId) ?? 0) + onDamagedResult.shieldGain);
          this.showHealText(after, onDamagedResult.shieldGain);
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
        const revengeSkill = getValidSkillDefinitions(definition).find((skill) => skill.modifiers?.revengeThresholdRate !== undefined);
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
    if (!before || !after?.isDestroyed) return { state: resolvedState, dealt: Math.max(0, (before?.currentHealth ?? 0) - (after?.currentHealth ?? 0)), defeated: false, killed: false, critical: criticalDamage.critical };
    AudioManager.playSfx(this, AUDIO_KEYS.diceDie);
    const beforeDefinition = before ? this.getDefinitionForInstance(before) : undefined;
    const reviveMeta = beforeDefinition ? getRuntimeSkillMeta(beforeDefinition) : undefined;
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
    const canRevive = Boolean(
      reviveChance !== undefined
      && (maxRevives === undefined || previousRevives < maxRevives)
      && (!reviveMeta?.dontReviveWhenLastOneStanding || hasOtherLivingAlly)
    );
    if (!canRevive || !secureChance(reviveChance!)) {
      this.defeatEventIdByInstance.set(instanceId, ++this.nextDefeatEventId);
      return { state: resolvedState, dealt: Math.max(0, before.currentHealth - (after?.currentHealth ?? 0)), defeated: true, killed: true, critical: criticalDamage.critical };
    }
    this.reviveCountByInstance.set(instanceId, previousRevives + 1);
    this.defeatEventIdByInstance.delete(instanceId);
    this.animateSkullRevive(before);
    return {
      dealt: Math.max(0, before.currentHealth - (after?.currentHealth ?? 0)),
      defeated: false,
      killed: true,
      critical: criticalDamage.critical,
      state: {
      ...nextState,
      reviveCounts: { ...nextState.reviveCounts, [instanceId]: previousRevives + 1 },
      dice: nextState.dice.map((die) => die.instanceId === instanceId
        ? {
            ...die,
            isDestroyed: false,
            zone: before.zone === 'board' ? 'board' : before.zone,
            currentHealth: die.maxHealth,
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
      const hit = this.applyDamageWithRevive(freshTarget.instanceId, revenge.damage);
      this.gameState = hit.state;
      this.showDamageText(freshTarget, hit.dealt, '#6abf69');
      await this.applyDamageDefeatHooks(liveSource, freshTarget, hit.defeated || hit.killed);
      this.addCombatActionDetail(`Revenge hit ${this.getCombatDieName(freshTarget)} for ${formatCompact(hit.dealt)}${this.criticalSuffix(hit.critical)}`);
      if (hit.defeated) break;
    }
    this.writeCombatLog(`${this.getCombatDieName(liveSource)} unleashes Revenge!`);
  }


  private getPierceBehindTargets(attacker: DiceInstanceState, target: DiceInstanceState, range: number): DiceInstanceState[] {
    if (!attacker.gridPosition || !target.gridPosition || range <= 0) return [];
    const rowStep = Math.sign(target.gridPosition.row - attacker.gridPosition.row);
    const colStep = this.getBoardSideForDie(attacker) === 'player' ? 1 : -1;
    const targetBoardSide = this.getBoardSideForDie(target);
    const enemies = this.getBoardDiceOnSide(target.ownerId, targetBoardSide);
    const targets: DiceInstanceState[] = [];
    for (let i = 1; i <= range; i++) {
      const row = target.gridPosition.row + rowStep * i;
      const col = target.gridPosition.col + colStep * i;
      const hit = enemies.find((die) => die.gridPosition?.row === row && die.gridPosition?.col === col);
      if (hit) targets.push(hit);
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
    return allies.some((other) => {
      const dr = Math.abs(other.gridPosition!.row - die.gridPosition!.row);
      const dc = Math.abs(other.gridPosition!.col - die.gridPosition!.col);
      return dr <= 1 && dc <= 1;
    });
  }

  private hasAdjacentFoe(die: DiceInstanceState): boolean {
    if (!die.gridPosition) return false;
    return this.gameState.dice.some((other) => {
      if (other.zone !== 'board' || other.isDestroyed || other.ownerId === die.ownerId || other.instanceId === die.instanceId || !other.gridPosition || !this.areDiceOnSameBoardSide(other, die)) return false;
      const dr = Math.abs(other.gridPosition.row - die.gridPosition.row);
      const dc = Math.abs(other.gridPosition.col - die.gridPosition.col);
      return dr <= 1 && dc <= 1;
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
    return Math.abs(healer.gridPosition.col - ally.gridPosition.col);
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
    return Math.abs(target.gridPosition.row - source.gridPosition.row)
      + Math.abs(target.gridPosition.col - source.gridPosition.col);
  }

  private applyBasicHeal(attacker: DiceInstanceState, meta: ReturnType<typeof getRuntimeSkillMeta>): { healed: number; critical: boolean } {
    const primary = this.getWeakestInjuredAlly(attacker);
    if (!primary) return { healed: 0, critical: false };
    const definition = this.getDefinitionForInstance(attacker);
    const healAmount = Math.max(1, Math.floor(
      (definition?.attack ?? attacker.maxHealth)
        * this.getCombanityDamageMultiplier(attacker, primary)
        * this.getDiceCardSkillDamageMultiplier(attacker)
    ));
    const healedIds = new Set<string>();
    let healedTotal = 0;
    let critical = false;
    const healOne = (die: DiceInstanceState) => {
      if (healedIds.has(die.instanceId)) return;
      healedIds.add(die.instanceId);
      const healResult = this.healDie(die.instanceId, healAmount);
      healedTotal += healResult.healed;
      if (healResult.critical) critical = true;
      this.animateSkillEffect('heal', attacker, die);
      this.addCombatActionDetail(`heals ${die.instanceId === attacker.instanceId ? 'itself' : this.getCombatDieName(die)} for ${formatCompact(healResult.healed)} health${healResult.critical ? ' (CRITICAL)' : ''}`);
    };
    healOne(primary);
    const ricochetCount = Math.max(0, Math.floor(meta.ricochetCount ?? 1));
    const ricochetRange = Math.max(1, meta.ricochetRange ?? 2);
    this.gameState.dice
      .filter((die) => die.ownerId === attacker.ownerId && die.zone === 'board' && !die.isDestroyed && die.gridPosition && die.instanceId !== primary.instanceId && die.currentHealth < die.maxHealth)
      .map((die) => ({ die, distance: this.getRicochetDistance(primary, die) }))
      .filter(({ distance }) => distance <= ricochetRange)
      .sort((a, b) => (a.die.currentHealth / a.die.maxHealth) - (b.die.currentHealth / b.die.maxHealth) || a.distance - b.distance || a.die.instanceId.localeCompare(b.die.instanceId))
      .slice(0, ricochetCount)
      .forEach(({ die }) => healOne(die));
    return { healed: healedTotal, critical };
  }

  private transformToAlternateForm(attacker: DiceInstanceState) {
    const definition = this.getDefinitionForInstance(attacker);
    const baseDefinition = this.getBaseDefinitionForInstance(attacker) ?? definition;
    if (!definition || !baseDefinition || getInitialTransformIndex(baseDefinition) === undefined) return;
    const instanceId = attacker.instanceId;
    const transformIndex = this.getTransformIndexForActiveDefinition(
      baseDefinition,
      definition,
      this.transformIndexByInstance.get(instanceId)
    );
    if (transformIndex === undefined) return;
    const transformedBase = applyTransformStats(this.getCombatBaseDefinition(attacker) ?? baseDefinition, transformIndex);
    this.transformIndexByInstance.set(instanceId, transformIndex);
    this.setTransformDuration(instanceId, baseDefinition, transformIndex);
    const transformedDefinition: DiceDefinition = transformedBase;
    const recoveryRate = getTransformRecoveryRate(baseDefinition, transformIndex) ?? 0;
    this.instanceDefinitionOverrides.set(instanceId, transformedDefinition);
    this.gameState = {
      ...this.gameState,
      dice: this.gameState.dice.map((die) => die.instanceId === instanceId
        ? {
          ...die,
          maxHealth: transformedDefinition.health,
          currentHealth: Math.min(transformedDefinition.health, Math.max(0, die.currentHealth) + Math.floor(transformedDefinition.health * recoveryRate))
        }
        : die)
    };
    const transformed = this.gameState.dice.find((die) => die.instanceId === instanceId) ?? attacker;
    this.writeCombatLog(`${this.getCombatDieName(attacker)} transforms into ${definition.transformStats?.[transformIndex]?.title ?? 'its alternate form'}!`);
    void this.applyOnTransformedSkillEffects(transformed);
    this.animateTransformEffect(transformed);
  }

  private getLeonFuriousClawDamage(attacker: DiceInstanceState, target: DiceInstanceState): { damage: number; critical: boolean } {
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition) return { damage: 0, critical: false };
    const meta = getRuntimeSkillMeta(definition);
    const critical = secureChance(this.getCriticalChance(meta.criticalChanceIncrease ?? 0, (meta.criticalChanceIncrease ?? 0) > 0));
    const crit = critical ? 2 + (meta.criticalDamageIncrease ?? 0) : 1;
    return { damage: Math.max(1, Math.floor(definition.attack * this.getOffenseMultiplier(attacker) * this.getDiceCardSkillDamageMultiplier(attacker) * crit)), critical };
  }

  private async executeLeonFuriousClaw(attacker: DiceInstanceState, target: DiceInstanceState, hitCount = 2) {
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition || !target.gridPosition || target.isDestroyed) return;
    const targetCenter = this.getTileCenter(target);
    if (targetCenter && hitCount >= 2) {
      AnimationManager.animateDoubleSwipe(this, targetCenter.x, targetCenter.y, this.getDieAccentColor(attacker));
      await this.delayCombatVisualPaced(120);
    }
    this.playSkillSfxForDie(attacker, getRuntimeSkillMeta(definition));
    for (let hitIndex = 0; hitIndex < hitCount; hitIndex++) {
      const freshTarget = this.gameState.dice.find((die) => die.instanceId === target.instanceId && !die.isDestroyed);
      if (!freshTarget) return;
      const leonDamage = this.getLeonFuriousClawDamage(attacker, freshTarget);
      const hit = this.applyDamageWithRevive(freshTarget.instanceId, leonDamage.damage, { allowGlobalCrit: false });
      this.gameState = hit.state;
      this.showDamageText(freshTarget, hit.dealt, leonDamage.critical ? '#ff3333' : '#ffbf4a');
      if (hit.defeated || hit.killed) {
        await this.applyDamageDefeatHooks(attacker, freshTarget, true);
        this.addCombatActionDetail(`Furious Claw hit ${this.getCombatDieName(freshTarget)} for ${formatCompact(hit.dealt)}${this.criticalSuffix(leonDamage.critical)}${hit.defeated ? '' : ' (revived)'}`);
        return;
      }
      this.addCombatActionDetail(`Furious Claw hit ${this.getCombatDieName(freshTarget)} for ${formatCompact(hit.dealt)}${this.criticalSuffix(leonDamage.critical)}`);
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
      return;
    }
    this.writeDefeatLog(defeated);
    await this.applyOnDeathSkillEffects(defeated, attacker);
  }

  private writeDefeatLog(defeated: DiceInstanceState) {
    const ownerName = defeated.ownerId === 'player' ? this.playerDisplayName : this.enemyDisplayName;
    this.writeCombatLog(`${ownerName}'s ${this.getCombatDieName(defeated)} was defeated!`);
  }

  private applyStatusApplications(applications: StatusEffectApplication[] | undefined) {
    if (!applications?.length) return;
    applications.forEach((application) => {
      const target = this.gameState.dice.find((die) => die.instanceId === application.target.instanceId && !die.isDestroyed);
      if (!target) return;
      const duration = this.getSkillDurationTurns(application.duration);
      if (duration === undefined) return;
      if (application.effect === 'poison' && application.damage !== undefined) {
        const damage = Math.max(1, Math.floor(application.damage * this.getDiceCardSkillDamageMultiplier(application.source)));
        const existing = this.poisonByInstance.get(target.instanceId);
        this.poisonByInstance.set(target.instanceId, {
          stacks: [...(existing?.stacks ?? []), {
            damage,
            turns: duration,
            sourceInstanceId: application.source.instanceId,
            sourceOwnerId: application.source.ownerId,
            sourceTypeId: application.source.typeId
          }]
        });
        this.animateSkillEffect('poison', application.source, target);
      } else if (application.effect === 'slow' && application.delta !== undefined) {
        const current = this.attackDeltaByInstance.get(target.instanceId);
        const currentStacks = current?.stacks?.filter((stack) => stack.turns > 0) ?? [];
        const maxStacks = Math.max(1, Math.floor(application.maxStacks ?? 1));
        const nextStacks = [...currentStacks, { delta: application.delta, turns: duration }].slice(-maxStacks);
        const previousDelta = current?.delta ?? 0;
        const nextDelta = nextStacks.reduce((sum, stack) => sum + stack.delta, 0);
        const appliedDelta = nextDelta - previousDelta;
        this.attackDeltaByInstance.set(target.instanceId, { delta: nextDelta, turns: Math.max(...nextStacks.map((stack) => stack.turns)), stacks: nextStacks });
        this.recordAttackCountEffect(target.instanceId, appliedDelta);
        if (appliedDelta !== 0) {
          this.gameState = {
            ...this.gameState,
            dice: this.gameState.dice.map((die) => {
              if (die.instanceId !== target.instanceId || die.isDestroyed || die.attacksRemaining <= 0) return die;
              const attacksRemaining = Math.max(0, die.attacksRemaining + appliedDelta);
              return { ...die, attacksRemaining, hasFinishedAttacking: attacksRemaining === 0 };
            })
          };
        }
        this.animateSkillEffect('ice', application.source, target);
      } else if (application.effect === 'fracture' && application.rate !== undefined) {
        this.armorShredByInstance.set(target.instanceId, { rate: application.rate, turns: duration });
        this.animateSkillEffect('fracture', application.source, target);
      } else if (application.effect === 'stun') {
        this.stunnedByInstance.set(target.instanceId, duration);
        this.animateSkillEffect('ice', application.source, target);
      } else if (application.effect === 'taunt') {
        this.tauntedByInstance.set(target.instanceId, { sourceId: application.source.instanceId, turns: duration });
        this.animateSkillEffect('physical', application.source, target);
      }
    });
  }

  private async applyTeleportSkillEffect(attacker: DiceInstanceState, target: DiceInstanceState, skillIndex: number) {
    const definition = this.getDefinitionForInstance(attacker);
    const skill = definition ? getValidSkillDefinitions(definition)[skillIndex] : undefined;
    if (!definition || !skill) return;
    if (skill.type === 'Passive') {
      const firedMeta = getRuntimeSkillMetaForTrigger(definition, 'Passive', skillIndex);
      if (firedMeta.attackCountIncrease !== undefined && firedMeta.skillRangeThreshold !== undefined) {
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
      () => executePassiveSkillEffects(attacker, definition, classLevel, target, boardSideTargets, pips, passiveSkillIndex),
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
        ? this.selectAllyAttackRecipient(attacker, this.gameState, result.grantAttacksToAlly)
        : attacker;
      if (recipient) {
        this.recordAttackCountEffect(recipient.instanceId, result.bonusAttacks);
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

    if (result.splashTargets?.length) {
      this.playSplashSfxForDie(attacker, meta);
      for (const die of result.splashTargets) {
        const dealt = Math.max(1, Math.ceil((result.splashDamageAmount ?? meta.splashDamage ?? definition.attack) * this.getCombanityDamageMultiplier(attacker, die) * this.getDiceCardSkillDamageMultiplier(attacker)));
        const splashHit = this.applyDamageWithRevive(die.instanceId, dealt, { source: attacker });
        this.gameState = splashHit.state;
        this.showDamageText(die, splashHit.dealt, '#ff9f58');
        await this.applyDamageDefeatHooks(attacker, die, splashHit.defeated || splashHit.killed);
        this.animateSkillEffect('fire', attacker, die);
        this.addCombatActionDetail(`Fire splash hit ${this.getCombatDieName(die)} for ${formatCompact(splashHit.dealt)}${this.criticalSuffix(splashHit.critical)}`);
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
          AnimationManager.animateElectricChain(this, sourceCenter.x, sourceCenter.y, chainTargetCenter.x, chainTargetCenter.y);
        }
        const dealt = Math.max(1, Math.ceil((result.chainDamageAmount ?? meta.chainDamage ?? definition.attack) * this.getCombanityDamageMultiplier(attacker, chainVictim) * this.getDiceCardSkillDamageMultiplier(attacker)));
        const chainHit = this.applyDamageWithRevive(chainVictim.instanceId, dealt, { source: attacker });
        this.gameState = chainHit.state;
        this.showDamageText(chainVictim, chainHit.dealt, '#fff176');
        await this.applyDamageDefeatHooks(attacker, chainVictim, chainHit.defeated || chainHit.killed);
        this.addCombatActionDetail(`Electric chain hit ${this.getCombatDieName(chainVictim)} for ${formatCompact(chainHit.dealt)}${this.criticalSuffix(chainHit.critical)}`);
        chainSource = chainVictim;
      }
    }

    if (result.heatwaveDamageAmount !== undefined && attacker.gridPosition) {
      if (!result.splashTargets?.length) this.playSplashSfxForDie(attacker, meta);
      const enemyOwner = attacker.ownerId === 'player' ? 'enemy' : 'player';
      const attackerBoardSide = this.getBoardSideForDie(attacker);
      const heatwaveTargets = this.gameState.dice.filter((candidate) =>
        candidate.ownerId === enemyOwner && candidate.zone === 'board' && !candidate.isDestroyed && candidate.gridPosition &&
        Math.abs(candidate.gridPosition.row - attacker.gridPosition!.row) <= 1 &&
        (this.getBoardSideForDie(candidate) === attackerBoardSide
          ? Math.abs(candidate.gridPosition.col - attacker.gridPosition!.col) <= 1
          : this.getDistanceWithBoardSides(attacker, candidate) <= 1));
      for (const heatwaveTarget of heatwaveTargets) {
        const dealt = Math.max(1, Math.floor(result.heatwaveDamageAmount * this.getCombanityDamageMultiplier(attacker, heatwaveTarget) * this.getDiceCardSkillDamageMultiplier(attacker)));
        const heatwaveHit = this.applyDamageWithRevive(heatwaveTarget.instanceId, dealt, { source: attacker });
        this.gameState = heatwaveHit.state;
        this.showDamageText(heatwaveTarget, heatwaveHit.dealt, '#ff7a35');
        this.animateSkillEffect('heatwave', attacker, heatwaveTarget);
        await this.applyDamageDefeatHooks(attacker, heatwaveTarget, heatwaveHit.defeated || heatwaveHit.killed);
        this.addCombatActionDetail(`Heatwave hit ${this.getCombatDieName(heatwaveTarget)} for ${formatCompact(heatwaveHit.dealt)}${this.criticalSuffix(heatwaveHit.critical)}`);
      }
    }

    if (result.pierceTargets?.length) {
      this.playPassiveSkillSfxForDie(attacker, meta);
      for (const die of result.pierceTargets) {
        const pierceDamage = Math.max(1, Math.floor(definition.attack * this.getCombanityDamageMultiplier(attacker, die) * this.getDiceCardSkillDamageMultiplier(attacker)));
        const pierceHit = this.applyDamageWithRevive(die.instanceId, pierceDamage, { source: attacker });
        this.gameState = pierceHit.state;
        this.showDamageText(die, pierceHit.dealt, '#c9d6d3');
        await this.applyDamageDefeatHooks(attacker, die, pierceHit.defeated || pierceHit.killed);
        this.addCombatActionDetail(`Pierce hit ${this.getCombatDieName(die)} for ${formatCompact(pierceHit.dealt)}${this.criticalSuffix(pierceHit.critical)}`);
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
    const applyDirectDamage = (victim: DiceInstanceState, baseDamage: number): { dealt: number; defeated: boolean; killed: boolean; critical: boolean } => {
      const skillAdjustedDamage = applySkillDamageModifiers(baseDamage, attacker, victim, meta);
      const multiplier = this.getCombanityDamageMultiplier(attacker, victim);
      const giantHunter = this.getGiantHunterBonus(attacker.ownerId, victim);
      const adjustedDamage = Math.max(1, Math.floor(skillAdjustedDamage * multiplier * this.getDiceCardSkillDamageMultiplier(attacker)) + giantHunter);
      const directHit = this.applyDamageWithRevive(victim.instanceId, adjustedDamage, { source: attacker });
      this.gameState = directHit.state;
      return { dealt: directHit.dealt, defeated: directHit.defeated, killed: directHit.killed, critical: directHit.critical };
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
    this.applySkillGrowth(attacker.instanceId, result);
    if (!result.needsMana) this.applySkillLocks(attacker, meta);

    if (result.needsMana) {
      this.addCombatActionDetail('Building mana...');
      this.addManaToAllActiveSlots(attacker);
    }

    if (result.transformToAlternateForm) {
      await this.transformToAlternateForm(attacker);
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
      const { damage: meteorDamage, lavaDamage, lavaTurns, lavaPoolPattern } = result.meteorStrike;
      let totalHits = 0;
      let meteorCritical = false;
      let totalDamage = 0;
      const meteorHitNames: string[] = [];
      for (let meteorIndex = 0; meteorIndex < meteorCount; meteorIndex++) {
        const origin = meteorRandomOrientation
          ? { ...this.pickRandomGridTile(), boardSide: targetBoardSide }
          : this.pickRandomOccupiedTile(targetBoardSide, enemyOwner, true);
        if (!origin) break;
        const meteorBoardSide = origin.boardSide;
        this.animateMeteorImpact(meteorBoardSide, origin);
        await this.delayCombatVisualPaced(1000);
        const impactTiles = this.getPlusPatternTiles(origin);
        const lavaTiles = lavaDamage === undefined
          ? []
          : (lavaPoolPattern?.length
            ? lavaPoolPattern.map(([rowOffset, colOffset]) => ({ row: origin.row + rowOffset, col: origin.col + colOffset })).filter((tile) => tile.row >= 0 && tile.row < GRID_SIZE && tile.col >= 0 && tile.col < GRID_SIZE)
            : [origin]);
        lavaTiles.forEach((tile) => {
          const lavaKey = `${meteorBoardSide}:${tile.row},${tile.col}`;
          this.lavaPoolsByTile.set(lavaKey, { damage: lavaDamage, turns: lavaTurns, sourceOwnerId: attacker.ownerId, sourceTypeId: attacker.typeId });
        });
        for (const tile of impactTiles) {
          const victim = this.gameState.dice.find((d) =>
            d.zone === 'board' && !d.isDestroyed && d.ownerId === enemyOwner && d.gridPosition?.row === tile.row && d.gridPosition?.col === tile.col
            && this.getBoardSideForDie(d) === meteorBoardSide);
          if (!victim) continue;
          const hit = applyDirectDamage(victim, meteorDamage);
          this.showDamageText(victim, hit.dealt, '#ff9f58');
          await this.applyDamageDefeatHooks(attacker, victim, hit.defeated || hit.killed);
          this.addCombatActionDetail(`Meteor hit ${this.getCombatDieName(victim)} for ${formatCompact(hit.dealt)}${this.criticalSuffix(hit.critical)}`);
          if (hit.critical) meteorCritical = true;
          meteorHitNames.push(this.getCombatDieName(victim));
          totalHits += 1;
          totalDamage += hit.dealt;
        }
        this.renderLavaPools();
      }
      const scorchedNames = [...new Set(meteorHitNames)];
      const scorchedLabel = scorchedNames.length > 0
        ? ` marked ${scorchedNames.join(', ')}`
        : '';
      this.writeCombatLog(`☄️ ${this.getCombatDieName(attacker)} meteor scorches ${totalHits} foe${totalHits === 1 ? '' : 's'}${scorchedLabel} in + patterns for ${formatCompact(totalDamage)} total damage${this.criticalSuffix(meteorCritical)} and leaves lava!`);
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
          ? `${activeSlot.title} hit ${this.getCombatDieName(freshTarget)} for ${formatCompact(instakillHit.dealt)}${this.criticalSuffix(instakillHit.critical)}`
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
        this.addCombatActionDetail(`Spear hit ${this.getCombatDieName(freshTarget)} for ${formatCompact(hit.dealt)}${this.criticalSuffix(hit.critical)}`);
        for (const die of this.getPierceBehindTargets(attacker, freshTarget, result.spearStrike.pierceRange)) {
          const pierceHit = applyDirectDamage(die, result.spearStrike.pierceDamage);
          this.showDamageText(die, pierceHit.dealt, '#b58cff');
          await this.applyDamageDefeatHooks(attacker, die, pierceHit.defeated || pierceHit.killed);
          this.addCombatActionDetail(`Spear pierce hit ${this.getCombatDieName(die)} for ${formatCompact(pierceHit.dealt)}${this.criticalSuffix(pierceHit.critical)}`);
        }
      }
      this.resetActiveMana(attacker.instanceId, activeSlot.key);
      return;
    }

    if (result.healTarget && result.healAmount !== undefined) {
      const healTarget = result.healTarget;
      const healAmount = Math.max(1, Math.ceil(result.healAmount * this.getCombanityDamageMultiplier(attacker, healTarget) * this.getDiceCardSkillDamageMultiplier(attacker)));
      this.playSkillSfxForDie(attacker, meta);
      const healResult = this.healDie(healTarget.instanceId, healAmount);
      this.animateSkillEffect('heal', attacker, healTarget);
      this.addCombatActionDetail(`${activeSlot.title} heals ${healTarget.instanceId === attacker.instanceId ? 'itself' : this.getCombatDieName(healTarget)} for ${formatCompact(healResult.healed)} health${this.criticalSuffix(healResult.critical)}`);
    }

    if (result.shieldGain !== undefined) {
      this.playSkillSfxForDie(attacker, meta);
      const shieldGain = Math.max(1, Math.ceil(result.shieldGain * this.getCombanityDamageMultiplier(attacker, attacker) * this.getTypeUpgradeMultiplier(attacker)));
      this.shieldHpByInstance.set(attacker.instanceId, (this.shieldHpByInstance.get(attacker.instanceId) ?? 0) + shieldGain);
      if (result.shieldTurns !== undefined) {
        const durationTurns = this.getSkillDurationTurns(result.shieldTurns);
        if (durationTurns !== undefined) this.shieldDurationTurnsByInstance.set(attacker.instanceId, durationTurns);
      }
      this.showHealText(attacker, shieldGain);
    }

    if (result.activeSplashDamageAmount !== undefined && target?.gridPosition) {
      const targetBoardSide = this.getBoardSideForDie(target);
      const splashTargets = this.getLivingDiceOnBoardSide(targetBoardSide).filter((die) => die.instanceId !== target.instanceId
        && Math.abs((die.gridPosition?.row ?? 99) - target.gridPosition.row) <= 1
        && Math.abs((die.gridPosition?.col ?? 99) - target.gridPosition.col) <= 1);
      for (const splashTarget of splashTargets) {
        const hit = applyDirectDamage(splashTarget, result.activeSplashDamageAmount);
        this.showDamageText(splashTarget, hit.dealt, '#ff9f58');
        this.animateSkillEffect('fire', attacker, splashTarget);
        await this.applyDamageDefeatHooks(attacker, splashTarget, hit.defeated || hit.killed);
        this.addCombatActionDetail(`Active splash hit ${this.getCombatDieName(splashTarget)} for ${formatCompact(hit.dealt)}${this.criticalSuffix(hit.critical)}`);
      }
    }

    if (result.heatwaveDamageAmount !== undefined && target?.gridPosition) {
      const targetBoardSide = this.getBoardSideForDie(target);
      const heatwaveTargets = this.getLivingDiceOnBoardSide(targetBoardSide).filter((die) => die.instanceId !== target.instanceId
        && Math.abs((die.gridPosition?.row ?? 99) - target.gridPosition.row) <= 1
        && Math.abs((die.gridPosition?.col ?? 99) - target.gridPosition.col) <= 1);
      for (const heatwaveTarget of heatwaveTargets) {
        const hit = applyDirectDamage(heatwaveTarget, result.heatwaveDamageAmount);
        this.showDamageText(heatwaveTarget, hit.dealt, '#ff7a35');
        this.animateSkillEffect('heatwave', attacker, heatwaveTarget);
        await this.applyDamageDefeatHooks(attacker, heatwaveTarget, hit.defeated || hit.killed);
        this.addCombatActionDetail(`Heatwave hit ${this.getCombatDieName(heatwaveTarget)} for ${formatCompact(hit.dealt)}${this.criticalSuffix(hit.critical)}`);
      }
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
        this.addCombatActionDetail(`Chain hit ${this.getCombatDieName(chainVictim)} for ${formatCompact(hit.dealt)}${this.criticalSuffix(hit.critical)}`);
      }
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
            AnimationManager.animateDrizzleRain(this, targetCenter.x, targetCenter.y, this.getDieAccentColor(attacker));
          }
        }
        const hit = applyDirectDamage(freshTarget, result.directDamage!.damage);
        this.showDamageText(freshTarget, hit.dealt, '#ffbf80');
        await this.applyDamageDefeatHooks(attacker, freshTarget, hit.defeated || hit.killed);
        this.addCombatActionDetail(`Active hit ${this.getCombatDieName(freshTarget)} for ${formatCompact(hit.dealt)}${this.criticalSuffix(hit.critical)}`);
      }
    }

    if (result.bonusAttacks && result.bonusAttacks > 0) {
      const recipient = result.grantAttacksToAlly !== undefined
        ? this.selectAllyAttackRecipient(attacker, this.gameState, result.grantAttacksToAlly, meta.activeSkillTargeting)
        : attacker;
      if (recipient) {
        this.gameState = {
          ...this.gameState,
          dice: this.gameState.dice.map((die) => die.instanceId === recipient.instanceId
            ? { ...die, attacksRemaining: die.attacksRemaining + result.bonusAttacks!, hasFinishedAttacking: false }
            : die)
        };
        this.recordAttackCountEffect(recipient.instanceId, result.bonusAttacks);
        this.addCombatActionDetail(`${activeSlot.title} grants +${result.bonusAttacks} attack${result.bonusAttacks === 1 ? '' : 's'} to ${recipient.instanceId === attacker.instanceId ? 'itself' : this.getCombatDieName(recipient)}`);
      }
    }
    if (result.grantAttacksToFoe && result.grantAttacksToFoe > 0) {
      this.gameState = this.grantFoeAttacks(attacker, result.grantAttacksToFoe, this.gameState, meta.activeSkillTargeting);
      this.addCombatActionDetail(`${activeSlot.title} grants +${result.grantAttacksToFoe} attack${result.grantAttacksToFoe === 1 ? '' : 's'} to the opposing side`);
    }

    if (result.attackCountIncrease !== undefined && result.extraAttacksTurns !== undefined) {
      if (attacker.gridPosition) {
        const g = this.getGridContainerForDie(attacker);
        const x = g.x + attacker.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
        const y = g.y + attacker.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
        AnimationManager.animateElementalSkill(this, x, y, 'wind', { tint: 0x9fe7d9, animated: false });
      }
      const attackCountIncrease = Number.isFinite(result.attackCountIncrease) ? Math.max(0, result.attackCountIncrease) : 0;
      const attackCountTurns = Number.isFinite(result.extraAttacksTurns) ? Math.max(1, result.extraAttacksTurns) : 1;
      const count = Math.max(1, 1 + attackCountIncrease);
      this.basicAttacksPerAttackByInstance.set(attacker.instanceId, { count, turns: attackCountTurns });
      this.recordAttackCountEffect(attacker.instanceId, attackCountIncrease);
      if (meta.disableManaGain) this.manaPausedTurnsByInstance.set(attacker.instanceId, attackCountTurns);
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
      
      if (scaledMeta.soulBoostPercent) {
        const classLevel = this.instanceClassLevels.get(soulDie.instanceId) ?? 1;
        const classMultiplier = getClassMultiplier(classLevel);
        const baseAttack = baseDefinition.attack;
        const baseHealth = baseDefinition.health;
        const boostPerSoul = scaledMeta.soulBoostPercent;
        const totalBoost = boostPerSoul * (currentSouls + 1);
        const newAttack = Math.round((baseAttack * (1 + totalBoost)) * classMultiplier);
        const newMaxHealth = Math.round((baseHealth * (1 + totalBoost)) * classMultiplier);
        const healthRatio = soulDie.currentHealth / soulDie.maxHealth;
        const newCurrentHealth = Math.round(newMaxHealth * healthRatio);
        
        this.gameState = {
          ...this.gameState,
          dice: this.gameState.dice.map((d) =>
            d.instanceId === soulDie.instanceId
              ? { ...d, attack: newAttack, maxHealth: newMaxHealth, currentHealth: newCurrentHealth }
              : d
          )
        };
        this.instanceDefinitionOverrides.set(soulDie.instanceId, { ...scaledDef, attack: newAttack, health: newMaxHealth });
      }
		
      const soulCenter = this.getTileCenter(soulDie);
      const defeatedCenter = this.getTileCenter(defeated);
      if (soulCenter && defeatedCenter) {
        AnimationManager.animateSoulHarvest(this, defeatedCenter.x, defeatedCenter.y, soulCenter.x, soulCenter.y, soulDie.ownerId === 'enemy');
      }

      const capturedType = soulDie.ownerId === defeated.ownerId ? 'ally' : 'enemy';
      const capturedLabel = scaledMeta.conjureType === 'both'
        ? capturedType
        : scaledMeta.conjureType === 'enemy' ? 'enemy' : 'ally';
      const totalSoulBoostPercent = scaledMeta.soulBoostPercent === undefined
        ? undefined
        : formatPercent(scaledMeta.soulBoostPercent * (currentSouls + 1));
      const totalBoostText = totalSoulBoostPercent === undefined ? '' : `, +${totalSoulBoostPercent} total stats`;
      this.writeCombatLog(`${this.getCombatDieName(soulDie)} captured ${capturedLabel} soul from ${this.getCombatDieName(defeated)}! (${currentSouls + 1} souls${totalBoostText})`);
      AudioManager.playSfx(this, AUDIO_KEYS.soulHarvest);
    });
    
    const deathDice = this.gameState.dice.filter((die) => {
      if (die.isDestroyed) return false;
      const def = this.getDefinitionForInstance(die);
      if (!def) return false;
      const meta = getRuntimeSkillMeta(def);
      return meta.transformSoulCount !== undefined && this.canConjureSoulFromDefeat(die, meta, defeated);
    });

    deathDice.forEach((deathDie) => {
      if (this.transformIndexByInstance.has(deathDie.instanceId)) return;
      const definition = this.getDefinitionForInstance(deathDie);
      if (!definition || getRuntimeSkillMeta(definition).transformSoulCount === undefined) return;

      const meta = getRuntimeSkillMeta(definition);
      const previous = this.getConjuredSoulCount(deathDie, meta);
      const cap = meta.transformSoulCount ?? meta.maxSouls ?? 2;
      const count = Math.min(cap, previous + 1);
      this.setConjuredSoulCount(deathDie, meta, count);
      const deathCenter = this.getTileCenter(deathDie);
      const defeatedCenter = this.getTileCenter(defeated);
      if (deathCenter && defeatedCenter) {
        AnimationManager.animateSoulHarvest(this, defeatedCenter.x, defeatedCenter.y, deathCenter.x, deathCenter.y, deathDie.ownerId === 'enemy');
      }

      if (count >= cap) {
        const deathBaseDefinition = this.getBaseDefinitionForInstance(deathDie) ?? definition;
        const transformIndex = this.getTransformIndexForFlag(deathBaseDefinition, 'instakillForm', (skill) => skill.modifiers?.instakill === true);
        if (transformIndex === undefined) return;
        this.transformIndexByInstance.set(deathDie.instanceId, transformIndex);
        this.setTransformDuration(deathDie.instanceId, this.getBaseDefinitionForInstance(deathDie) ?? definition, transformIndex);
        const transformedDefinition = applyTransformStats(this.getCombatBaseDefinition(deathDie) ?? this.getBaseDefinitionForInstance(deathDie) ?? definition, transformIndex);
        const recoveryRate = getTransformRecoveryRate(this.getBaseDefinitionForInstance(deathDie) ?? definition, transformIndex) ?? 1;
         this.instanceDefinitionOverrides.set(deathDie.instanceId, transformedDefinition);
        this.gameState = {
          ...this.gameState,
          dice: this.gameState.dice.map((die) => {
            if (die.instanceId !== deathDie.instanceId) return die;
            const maxHealth = transformedDefinition.health;
            const recoveredHealth = Math.min(maxHealth, Math.max(0, die.currentHealth) + Math.floor(maxHealth * recoveryRate));
            return { ...die, maxHealth, currentHealth: recoveredHealth };
          })
        };
        this.resetActiveMana(deathDie.instanceId);
      const transformedTitle = deathBaseDefinition.transformStats?.[transformIndex]?.title ?? 'its alternate form';
      this.writeCombatLog(`${this.getCombatDieName(deathDie)} transforms into ${transformedTitle}!`);
        void this.applyOnTransformedSkillEffects(deathDie);
        this.animateTransformEffect(deathDie);
      }
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
    this.applySkillLocks(transformed, onTransformedMeta);
    this.applyStatusApplications(result.statusApplications);
    if (result.specialAttackDamage !== undefined) {
      const target = result.specialAttackTarget ?? this.findNearestFoeIgnoringRange(transformed);
      if (target) {
        this.moveDieBesideTarget(transformed, target);
        const moved = this.gameState.dice.find((die) => die.instanceId === transformed.instanceId) ?? transformed;
        const targetCenter = this.getTileCenter(target);
        if (targetCenter) {
          AnimationManager.animateDoubleSwipe(this, targetCenter.x, targetCenter.y, this.getDieAccentColor(transformed));
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
        this.addCombatActionDetail(`Transform attack hit ${this.getCombatDieName(target)} for ${formatCompact(hit.dealt)}${this.criticalSuffix(hit.critical)}`);
      }
    }
    const meta = getRuntimeSkillMeta(definition);
    const bonusAttacks = Number.isFinite(result.bonusAttacks) ? Math.max(0, result.bonusAttacks ?? 0) : 0;
    if (bonusAttacks > 0) {
      const recipient = result.grantAttacksToAlly !== undefined
        ? this.selectAllyAttackRecipient(transformed, this.gameState, result.grantAttacksToAlly)
        : transformed;
      if (recipient) {
        this.playSkillSfxForDie(transformed, meta);
        const turns = Number.isFinite(result.extraAttacksTurns) ? Math.max(1, result.extraAttacksTurns) : 1;
        this.recordAttackCountEffect(recipient.instanceId, bonusAttacks);
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
        await this.applySpecialSkillAttack(die, result.specialAttackDamage, result.specialAttackTarget, endMeta, 'Combat-end attack');
      }

      if (result.bonusAttacks && result.bonusAttacks > 0) {
        const recipient = result.grantAttacksToAlly !== undefined
          ? this.selectAllyAttackRecipient(die, this.gameState, result.grantAttacksToAlly)
          : die;
        if (recipient) {
          this.recordAttackCountEffect(recipient.instanceId, result.bonusAttacks);
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
    this.tauntedByInstance.forEach((value, key) => {
      const turns = value.turns - 1;
      if (turns <= 0) this.tauntedByInstance.delete(key);
      else this.tauntedByInstance.set(key, { ...value, turns });
    });
    this.stunnedByInstance.forEach((turns, key) => {
      const nextTurns = turns - 1;
      if (nextTurns <= 0) this.stunnedByInstance.delete(key);
      else this.stunnedByInstance.set(key, nextTurns);
    });
    this.timeStatusByInstance.forEach((statuses, key) => {
      const nextStatuses = statuses.map((status) => ({ ...status, turns: status.turns - 1 })).filter((status) => status.turns > 0);
      if (nextStatuses.length === 0) this.timeStatusByInstance.delete(key);
      else this.timeStatusByInstance.set(key, nextStatuses);
    });
    this.attackDeltaByInstance.forEach((value, key) => {
      if (value.stacks?.length) {
        const nextStacks = value.stacks.map((stack) => ({ ...stack, turns: stack.turns - 1 })).filter((stack) => stack.turns > 0);
        if (nextStacks.length === 0) {
          this.attackDeltaByInstance.delete(key);
        } else {
          this.attackDeltaByInstance.set(key, {
            delta: nextStacks.reduce((sum, stack) => sum + stack.delta, 0),
            turns: Math.max(...nextStacks.map((stack) => stack.turns)),
            stacks: nextStacks
          });
        }
        return;
      }
      const nextTurns = value.turns - 1;
      if (nextTurns <= 0) {
        this.attackDeltaByInstance.delete(key);
      } else {
        this.attackDeltaByInstance.set(key, { ...value, turns: nextTurns });
      }
    });
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
    const expiredLava: string[] = [];
    this.transformDurationByInstance.forEach((duration, instanceId) => {
      const nextDuration = duration - 1;
      if (nextDuration <= 0) this.expireTransform(instanceId);
      else this.transformDurationByInstance.set(instanceId, nextDuration);
    });
    this.lavaPoolsByTile.forEach((pool, key) => {
      const nextTurns = pool.turns - 1;
      if (nextTurns <= 0) {
        expiredLava.push(key);
      } else {
        this.lavaPoolsByTile.set(key, { ...pool, turns: nextTurns });
      }
    });
    expiredLava.forEach(k => this.lavaPoolsByTile.delete(k));
  }

  private applyFountainOfLoveCombatEndHealing() {
    this.gameState = {
      ...this.gameState,
      dice: this.gameState.dice.map((die) => {
        if (die.isDestroyed) return die;
        const rate = this.fountainHealRateByOwner[die.ownerId];
        if (rate <= 0) return die;
        const critHeal = this.applyCriticalHealing(Math.max(1, Math.floor(die.maxHealth * rate)));
        return { ...die, currentHealth: Math.min(die.maxHealth, die.currentHealth + critHeal.amount) };
      })
    };
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
      const baseDefinition = this.definitions.get(typeId);
      if (!baseDefinition) return undefined;
      const safeClassLevel = Math.max(1, Math.min(15, Math.floor(classLevel || 1)));
      const definition = this.applyClassProgress(baseDefinition, safeClassLevel);
      if (!definition) return undefined;
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
      const rolledPips = options.allowRoll ? secureRandomBetween(1, 6) : undefined;
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
      this.instanceDefinitionOverrides.set(instanceId, definition);
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
      if (this.activeChallenge === 'deucifer') this.turnLimit = Math.max(this.turnLimit, 20);
      this.enemyLoadoutRevealed = true;
      this.writeCombatLog('Deucifer has spawned after round 10 — defeat him within 10 bonus rounds!');
    } catch (error) {
      this.debug.warn('summonDeuciferBoss failed; no boss spawn.', { error });
      this.deuciferBossPending = false;
    }
  }

  private healDie(instanceId: string, amount: number): { healed: number; critical: boolean } {
    const target = this.gameState.dice.find((die) => die.instanceId === instanceId && !die.isDestroyed);
    if (!target || amount <= 0) return { healed: 0, critical: false };
    const critHeal = this.applyCriticalHealing(amount);
    const healedAmount = Math.min(critHeal.amount, Math.max(0, target.maxHealth - target.currentHealth));
    if (healedAmount <= 0) return { healed: 0, critical: false };
    this.gameState = {
      ...this.gameState,
      dice: this.gameState.dice.map((die) => die.instanceId === instanceId
        ? { ...die, currentHealth: Math.min(die.maxHealth, die.currentHealth + healedAmount) }
        : die)
    };
    this.showHealText(target, healedAmount, critHeal.critical);
    return { healed: healedAmount, critical: critHeal.critical };
  }

  private async applyTurnBasedEffects() {
    for (const [instanceId, effect] of [...this.poisonByInstance.entries()]) {
      const activeStacks = effect.stacks.filter((stack) => stack.turns > 0);
      if (activeStacks.length === 0) {
        this.poisonByInstance.delete(instanceId);
        continue;
      }

      const target = this.gameState.dice.find((die) => die.instanceId === instanceId && !die.isDestroyed);
      if (target) {
        const tickDamage = Math.max(1, Math.floor(activeStacks.reduce((sum, stack) => sum + stack.damage, 0)));
        const sourceStack = activeStacks[0];
        const source = sourceStack?.sourceInstanceId
          ? this.gameState.dice.find((die) => die.instanceId === sourceStack.sourceInstanceId)
          : undefined;
        const sourceProxy: DiceInstanceState = source ?? {
          ...target,
          instanceId: sourceStack?.sourceInstanceId ?? `poison:${sourceStack?.sourceTypeId ?? target.typeId}`,
          ownerId: sourceStack?.sourceOwnerId ?? target.ownerId,
          typeId: sourceStack?.sourceTypeId ?? target.typeId
        };
        const hit = this.applyDamageWithRevive(instanceId, tickDamage, { source: sourceProxy });
        this.gameState = hit.state;
        this.showDamageText(target, hit.dealt, '#74d66f');
        await this.applyDamageDefeatHooks(sourceProxy, target, hit.defeated || hit.killed);
        if (hit.defeated) AudioManager.playSfx(this, AUDIO_KEYS.diceDie);
      }

      const nextStacks = activeStacks
        .map((stack) => ({ ...stack, turns: stack.turns - 1 }))
        .filter((stack) => stack.turns > 0);
      if (nextStacks.length > 0) this.poisonByInstance.set(instanceId, { stacks: nextStacks });
      else this.poisonByInstance.delete(instanceId);
    }

    this.armorShredByInstance.forEach((effect, instanceId) => {
      this.armorShredByInstance.set(instanceId, { ...effect, turns: effect.turns - 1 });
      if (effect.turns - 1 <= 0) this.armorShredByInstance.delete(instanceId);
    });
  }

  private getSkillDurationTurns(rawTurns?: number): number | undefined {
    if (rawTurns === undefined) return undefined;
    if (!Number.isFinite(rawTurns)) return undefined;
    return Math.max(1, Math.floor(rawTurns));
  }

  private setTransformDuration(instanceId: string, definition: DiceDefinition, transformIndex: number) {
    const duration = definition.transformStats?.[transformIndex]?.transformDuration;
    if (duration !== undefined && Number.isFinite(duration) && duration >= 0) {
      this.transformDurationByInstance.set(instanceId, Math.floor(duration));
    } else {
      this.transformDurationByInstance.delete(instanceId);
    }
  }

  private getTransformIndexForFlag(
    definition: DiceDefinition,
    flag: string,
    capability?: (skill: DiceDefinition['skills'][number]) => boolean
  ): number | undefined {
    const index = definition.transformFlags?.indexOf(flag) ?? -1;
    const stats = index >= 0 ? definition.transformStats?.[index] : undefined;
    const registered = getRuntimeSkillMeta(definition).transformFlags.includes(flag);
    if (!stats || !registered) return undefined;
    if (capability && !stats.skills?.some(capability)) return undefined;
    return index;
  }

  private expireTransform(instanceId: string) {
    const die = this.gameState.dice.find((candidate) => candidate.instanceId === instanceId);
    if (!die) return;
    const base = this.getCombatBaseDefinition(die);
    if (base) {
      this.instanceDefinitionOverrides.set(instanceId, base);
      this.gameState = {
        ...this.gameState,
        dice: this.gameState.dice.map((candidate) => candidate.instanceId !== instanceId
          ? candidate
          : { ...candidate, maxHealth: base.health, currentHealth: Math.min(base.health, candidate.currentHealth) })
      };
    }
    this.transformIndexByInstance.delete(instanceId);
    this.transformDurationByInstance.delete(instanceId);
  }

  private async returnDiceToHand() {
    this.gamePhase = { stage: 'placement' };
    this.tauntedByInstance.clear();
    this.chainedByInstance.clear();
    this.persistentLockSourceIds.clear();
    this.healingWaitByInstance.clear();
    this.healingRetryReadyByInstance.clear();
    this.avoidChanceIgnoredTargetByInstance.clear();
    this.combatTimeRemainingMs = 30_000;
    this.combatCountdownTriggered = false;
    this.updateCombatTimerUi();
    this.placedDiceCount = 0;
    this.diceRolled = false;
    this.pipTransformTriggeredThisTurn.clear();
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
    return {
      x: grid.x + die.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2,
      y: grid.y + die.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2
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
    AnimationManager.animateGrowthTurn(this, center.x, center.y, color, success);
  }

  private animateSkillEffect(kind: 'ice' | 'fire' | 'poison' | 'electric' | 'heal' | 'fracture' | 'heatwave' | 'physical', attacker: DiceInstanceState, target: DiceInstanceState) {
    const liveAttacker = this.gameState.dice.find((die) => die.instanceId === attacker.instanceId) ?? attacker;
    const liveTarget = this.gameState.dice.find((die) => die.instanceId === target.instanceId) ?? target;
    const attackerCenter = this.getTileCenter(liveAttacker);
    const targetCenter = this.getTileCenter(liveTarget);
    if (!attackerCenter || !targetCenter) return;
    if (kind === 'heal') {
      AnimationManager.animateHealingBeam(this, attackerCenter.x, attackerCenter.y, targetCenter.x, targetCenter.y);
      AnimationManager.animateHealingPulse(this, targetCenter.x, targetCenter.y);
      return;
    }
    if (kind === 'fracture') { AnimationManager.animateFracture(this, targetCenter.x, targetCenter.y); return; }
    if (kind === 'heatwave') { AnimationManager.animateHeatwave(this, targetCenter.x, targetCenter.y); return; }
    AnimationManager.animateElementalSkill(this, targetCenter.x, targetCenter.y, kind, { animated: false });
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
    return picked.gridPosition
      ? { row: picked.gridPosition.row, col: picked.gridPosition.col, boardSide: this.getBoardSideForDie(picked) }
      : null;
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
    const meteor = this.add.circle(tx - 110, ty - 140, 8, 0xff8f4d, 0.95).setDepth(2000);
    const trail = this.add.graphics().setDepth(1999);
    this.tweens.add({
      targets: meteor,
      x: tx,
      y: ty,
      duration: 900,
      ease: 'Cubic.In',
      onUpdate: () => {
        trail.clear();
        trail.lineStyle(3, 0xffd08a, 0.65);
        trail.strokeLineShape(new Phaser.Geom.Line(meteor.x - 32, meteor.y - 26, meteor.x, meteor.y));
      },
      onComplete: () => {
        trail.destroy();
        meteor.destroy();
        const burst = this.add.circle(tx, ty, 10, 0xffb366, 0.65).setDepth(2001);
        const plus = this.add.graphics().setDepth(2002);
        plus.lineStyle(5, 0xffd08a, 0.78);
        plus.lineBetween(tx - TILE_SIZE * 0.58, ty, tx + TILE_SIZE * 0.58, ty);
        plus.lineBetween(tx, ty - TILE_SIZE * 0.58, tx, ty + TILE_SIZE * 0.58);
        this.tweens.add({ targets: burst, scale: 3.2, alpha: 0, duration: 220, onComplete: () => burst.destroy() });
        this.tweens.add({ targets: plus, alpha: 0, duration: 260, onComplete: () => plus.destroy() });
      }
    });
  }

  private animateSkullRevive(die: DiceInstanceState) {
    if (die.typeId !== 'Skull' || !die.gridPosition) return;
    const grid = this.getGridContainerForDie(die);
    const x = grid.x + die.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const y = grid.y + die.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    AnimationManager.animateSkullRevive(this, x, y);
  }

  private animateTransformEffect(die: DiceInstanceState) {
    if (!die.gridPosition) return;
    const grid = this.getGridContainerForDie(die);
    const x = grid.x + die.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const y = grid.y + die.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const visual = this.getTransformedVisual(die);
    const color = visual ? Phaser.Display.Color.HexStringToColor(visual.accent).color : this.getDieAccentColor(die);
    AnimationManager.animateTransform(this, x, y, color, visual?.symbol);
  }

  private animateBasicAttackSequence(attacker: DiceInstanceState, target: DiceInstanceState, count = 1) {
    const attackCount = Math.max(1, Math.floor(count));
    for (let index = 0; index < attackCount; index++) {
      this.time.delayedCall(index * 120, () => this.animateAttack(attacker, target));
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

    const graphics = this.add.graphics();
    const definition = this.getDefinitionForInstance(attacker);
    const beamHex = this.getTransformedVisual(attacker)?.accent ?? definition?.accent ?? '#ff6b6b';
    const beamColor = Phaser.Display.Color.HexStringToColor(beamHex).color;
    graphics.lineStyle(3, beamColor, 0.82);
    graphics.strokeLineShape(new Phaser.Geom.Line(worldAttackerX, worldAttackerY, worldTargetX, worldTargetY));

    this.tweens.add({
      targets: graphics,
      alpha: 0,
      duration: 400,
      onComplete: () => graphics.destroy()
    });
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

    AnimationManager.animateTranscendenceBeamFx(this, attackerX, attackerY, lineStartX, lineStartY, lineEndX, lineEndY, Phaser.Math.Distance.Between(lineStartX, lineStartY, lineEndX, lineEndY));
  }

  private animateSpearActive(attacker: DiceInstanceState, target: DiceInstanceState) {
    if (!attacker.gridPosition || !target.gridPosition) return;
    const attackerGrid = this.getGridContainerForDie(attacker);
    const targetGrid = this.getGridContainerForDie(target);
    const ax = attackerGrid.x + attacker.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const ay = attackerGrid.y + attacker.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const tx = targetGrid.x + target.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const ty = targetGrid.y + target.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    AnimationManager.animateSpearStrike(this, ax, ay, tx, ty);
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
    this.renderDiceStatusPanel(this.enemyStatusPanel, statusDice, "OPPONENT'S DICE", false);
  }

  private restoreEnemyFogForNewTurn() {
    this.enemyFogOverlay?.setVisible(true);
    this.enemyFogText?.setVisible(true);
  }

  private generateEnemyPositions() {
    const enemyHandDice = getAvailableHandDice(this.gameState, 'enemy');
    const usedCells = this.collectOccupiedCells('enemy');

    for (const die of enemyHandDice) {
      const definition = this.getDefinitionForInstance(die) ?? this.definitions.get(die.typeId);
      const range = definition?.range ?? 4;
      const footprint = this.getFootprintForDefinition(definition);
      const position = this.isBossDie(die)
        ? this.findRandomBossPosition(die, footprint, usedCells)
        : this.findRandomFootprintPosition(footprint, usedCells, () => this.pickEnemyColumn(range), { min: range >= 7 ? 2 : range >= 6 ? 1 : 0, max: GRID_SIZE - footprint });
      if (!position) continue;
      this.markFootprint(position.row, position.col, footprint, usedCells);
      this.gameState = placeDieOnBoard(this.gameState, die.instanceId, position.row, position.col);
    }
  }

  private pickEnemyColumn(range: number): number {
    const minimumColumn = range >= 7 ? 2 : range >= 6 ? 1 : 0;
    const constrained = (columns: number[]) => this.pickRandomColumn(columns.filter((column) => column >= minimumColumn));
    switch (this.configDifficulty) {
      case 'Baby':
        return secureChance(0.85) ? constrained([0, 1, 2]) : secureRandomBetween(minimumColumn, GRID_SIZE - 1);
      case 'Easy':
        return secureChance(0.82) ? constrained([1, 2]) : Math.max(minimumColumn, 0);
      case 'Hard':
        if (range <= 3) return secureChance(0.75) ? constrained([0, 1]) : secureRandomBetween(minimumColumn, GRID_SIZE - 1);
        if (range >= 5) return secureChance(0.8) ? constrained([2, 3, 4]) : secureRandomBetween(minimumColumn, GRID_SIZE - 1);
        return Phaser.Math.Between(minimumColumn, GRID_SIZE - 1);
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
        return Phaser.Math.Between(minimumColumn, GRID_SIZE - 1);
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

  private getDiceCardDescription(key: string): { icon: string; title: string; rarity: string; desc: string; color?: string } {
    const [name, rarity = ''] = key.split(':');
    const mag = getDiceCardMagnitude((rarity || 'Bronze') as DiceCardRarity);
    const pctText = (percentage: number) => formatPercent(percentage / 100);
    if (name.endsWith(' Upgrade')) {
      const pct = [0, 50, 75, 100][mag];
      const typeId = name.replace(/ Upgrade$/, '');
      const typeName = this.definitions.get(typeId)?.title?.replace(/\s+Dice$/i, '') ?? typeId;
      const dieFaceByRarity: Record<string, string> = { Bronze: '⚃', Silver: '⚄', Gold: '⚅' };
      const colorByRarity: Record<string, string> = { Bronze: '#cd7f32', Silver: '#c0c0c0', Gold: '#ffd700' };
      const icon = dieFaceByRarity[rarity] ?? '⚅';
      const color = colorByRarity[rarity] ?? '#ffd700';
      return { icon, color, title: `${typeName} Upgrade`, rarity, desc: `${typeName} gets +${pctText(pct)} basic+skill damage and max HP.` };
    }
    if (name === 'Fountain of Love') {
      const pct = [0, 10, 15, 20][mag];
      return { icon: '💖', title: name, rarity, desc: `On Combat End: all friendly dice heal ${pctText(pct)} max HP.` };
    }
    if (name === 'Mana Potion') {
      return { icon: '🧪', title: name, rarity, desc: `On Combat Start: all friendly dice gain +${mag} mana.` };
    }
    if (name === 'Spotlight') {
      const pct = [0, 20, 30, 40][mag];
      return { icon: '🔦', title: name, rarity, desc: `Passive: 3-pip dice gain ${pctText(pct)} damage reduction and ${pctText(pct)} more damage.` };
    }
    if (name === 'Odd Investment') {
      const dmg = [0, 20, 30, 40][mag];
      const red = [0, 10, 15, 20][mag];
      return { icon: '🌓', title: name, rarity, desc: `Passive: odd effective-pip dice gain +${pctText(dmg)} damage and ${pctText(red)} damage reduction.` };
    }
    if (name === 'Even Investment') {
      const dmg = [0, 20, 30, 40][mag];
      const red = [0, 10, 15, 20][mag];
      return { icon: '🌗', title: name, rarity, desc: `Passive: even effective-pip dice gain +${pctText(dmg)} damage and ${pctText(red)} damage reduction.` };
    }
    if (name === 'Giant Hunter') {
      const pct = [0, 1, 2, 3][mag];
      return { icon: '🗡️', title: name, rarity, desc: `Passive: direct damage adds ${pctText(pct)} target max HP.` };
    }
	if (name === 'Crowd Attack') {
      const dmg = [0, 20, 30, 40][mag];
      const red = [0, 10, 15, 20][mag];
      return { icon: '👥', title: name, rarity, desc: `Passive: dice with 1 or 2 pips gain +${pctText(dmg)} damage and ${pctText(red)} damage reduction.` };
    }
	if (name === 'Fire Support') {
      return { icon: '🏹', title: name, rarity, desc: `Passive: dice placed on the backline gain +${mag} attack count.` };
    }
    if (name === 'Vanguard') {
      const pct = [0, 20, 30, 40][mag];
      return { icon: '🛡️', title: name, rarity, desc: `Passive: frontline dice gain ${pctText(pct)} damage reduction.` };
    }
    if (name === 'Centreline') {
      const pct = [0, 20, 40, 60][mag];
      return { icon: '🎯', title: name, rarity, desc: `Passive: centre-column dice gain +${pctText(pct)} damage.` };
    }
    return { icon: '🎴', title: name, rarity, desc: '' };
  }

  private isDiceCardTypeUpgradeKey(key: string): boolean {
    return (key.split(':')[0] ?? '').endsWith(' Upgrade');
  }

  private renderDiceCardInfoPanel() {
    this.diceCardInfoContainer?.destroy(true);
    const y = this.scale.height - 30;
    const c = this.add.container(0, 0).setDepth(350);
    this.diceCardInfoContainer = c;
    const tip = this.add.text(this.scale.width / 2 - 110, y - 70, '', { fontFamily: 'Orbitron', fontSize: '12px', color: '#fff2d8', backgroundColor: '#102030', padding: { x: 8, y: 6 }, wordWrap: { width: 210 } }).setDepth(351).setVisible(false);
    const renderSide=(keys:string[], right:boolean)=>{
      keys.slice(-8).forEach((key, idx) => {
      const info = this.getDiceCardDescription(key);
      const px = right ? this.scale.width - 24 - (idx*24) : 24 + (idx*24);
      const icon = this.add.text(px, y, info.icon, { fontSize: '18px', color: info.color ?? '#ffffff' }).setOrigin(right ? 1 : 0, 1).setInteractive({ useHandCursor: true });
      icon.on('pointerover', () => { tip.setText(`${info.title} (${info.rarity})\n${info.desc}`).setVisible(true); });
      icon.on('pointerout', () => tip.setVisible(false));
      c.add(icon);
    });};
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
    const playerDice = getBoardDice(this.gameState, 'player');
    const livingPlayerDice = this.gameState.dice.filter((die) => die.ownerId === 'player' && !die.isDestroyed);
    const statusDice = this.gameState.turn <= 1 && this.gameState.combatPhase !== 'attacking'
      ? playerDice
      : livingPlayerDice;
    this.renderDiceStatusPanel(this.playerStatusPanel, statusDice, 'YOUR DICE', true);
  }

  private renderDiceStatusPanel(panel: Phaser.GameObjects.Container, dice: DiceInstanceState[], title: string, centered: boolean) {
    panel.removeAll(true);
    const ownerName = centered ? this.playerDisplayName : this.enemyDisplayName;
    panel.add(this.add.text(0, 0, ownerName, { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.text }).setOrigin(centered ? 0.5 : 0, 0));
    panel.add(this.add.text(0, 16, title, { fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.accentSoft }).setOrigin(centered ? 0.5 : 0, 0));
    dice.forEach((diceUnit, index) => {
      const visual = this.getTransformedVisual(diceUnit);
      const def = this.getDefinitionForInstance(diceUnit);
      const baseDef = this.getBaseDefinitionForInstance(diceUnit) ?? def;
      const baseTitle = baseDef?.title ?? diceUnit.typeId;
      const dieTitle = baseTitle.endsWith('Dice') ? baseTitle.slice(0, -4).trim() : baseTitle;
      const classLevel = this.instanceClassLevels.get(diceUnit.instanceId) ?? 1;
      const shieldHp = this.shieldHpByInstance.get(diceUnit.instanceId) ?? 0;
      const shieldTag = shieldHp > 0 ? ` | SH ${formatCompact(shieldHp)}` : '';
      const status = diceUnit.isDestroyed ? 'DEFEATED' : `${formatCompact(diceUnit.currentHealth)}/${formatCompact(diceUnit.maxHealth)} HP${shieldTag}${visual?.symbol ? ` ${visual.symbol}` : ''}`;
      const classLabel = this.isBossDie(diceUnit) ? '' : ` C${classLevel}/15`;
      panel.add(this.add.text(0, 36 + index * 16, `${dieTitle}${classLabel}: ${status}`, { fontFamily: 'Orbitron', fontSize: '11px', color: diceUnit.isDestroyed ? PALETTE.danger : (visual?.accent ?? PALETTE.textMuted) }).setOrigin(centered ? 0.5 : 0, 0));
    });
  }

  private resolveLoadoutTalentIndex(definition: DiceDefinition): number | null {
    const equipped = getEquippedTalentIndex(this, definition);
    if (!this.configRandomMode || !this.configRandomizeLoadoutAndClassUps) return equipped;
    const owned = getOwnedTalentIndices(this, definition);
    if (owned.length === 0) return null;
    return securePick(owned) ?? null;
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

  private pickDailySeededLoadout(pool: DiceDefinition[], label: string): DiceDefinition[] {
    const weighted = this.buildDifficultyWeightedPool(pool);
    const byId = new Map(weighted.map((d) => [d.typeId, d]));
    const unique = [...new Set(weighted.map((d) => d.typeId))].sort();
    const selected: DiceDefinition[] = [];
    for (let i = 0; i < 5 && unique.length > 0; i++) {
      const idx = this.getDailySeededIndex(`${label}-loadout-${i}`, unique.length);
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
    const onKillMeta = getRuntimeSkillMetaForTrigger(definition, 'OnKill');
    this.applySkillLocks(attacker, onKillMeta);
    this.applyStatusApplications(result.statusApplications);
    if (result.specialAttackDamage !== undefined) {
      await this.applySpecialSkillAttack(attacker, result.specialAttackDamage, result.specialAttackTarget, onKillMeta, 'On-kill attack');
    }

    if (result.bonusAttacks && result.bonusAttacks > 0) {
      this.playSkillSfxForDie(attacker, meta);
      const recipient = result.grantAttacksToAlly !== undefined
        ? this.selectAllyAttackRecipient(attacker, this.gameState, result.grantAttacksToAlly)
        : attacker;
      if (recipient) {
        this.gameState = {
          ...this.gameState,
          dice: this.gameState.dice.map((die) => {
            if (die.instanceId !== recipient.instanceId) return die;
            this.recordAttackCountEffect(die.instanceId, result.bonusAttacks!);
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
    const center = freshWeakest.gridPosition;
    const targetBoardSide = this.getBoardSideForDie(freshWeakest);
    await AnimationManager.animateJudgmentHammer(this, this.getGridContainerForDie(freshWeakest).x + center.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2, this.getGridContainerForDie(freshWeakest).y + center.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2, 250);
    const victims = getBoardDice(this.gameState, enemyOwner).filter((die) =>
      die.gridPosition &&
      this.getBoardSideForDie(die) === targetBoardSide &&
      Math.abs(die.gridPosition.row - center.row) <= radius &&
      Math.abs(die.gridPosition.col - center.col) <= radius
    );
    const hammerMarkedName = this.getCombatDieName(freshWeakest);
    const hammerHitNames: string[] = [];
    let hammerTotalDamage = 0;
    for (const die of victims) {
      const liveVictim = this.gameState.dice.find((candidate) => candidate.instanceId === die.instanceId && candidate.zone === 'board' && !candidate.isDestroyed && candidate.gridPosition);
      if (!liveVictim) continue;
      const dealt = Math.max(1, Math.floor(damage * this.getCombanityDamageMultiplier(attacker, liveVictim) * this.getDiceCardSkillDamageMultiplier(attacker)));
      const hammerHit = this.applyDamageWithRevive(die.instanceId, dealt);
      this.gameState = hammerHit.state;
      this.showDamageText(die, hammerHit.dealt, '#ffd36f');
      await this.applyDamageDefeatHooks(attacker, die, hammerHit.defeated || hammerHit.killed, { judgmentHammerDepth: chainDepth + 1 });
      this.addCombatActionDetail(`Judgment Hammer hit ${this.getCombatDieName(die)} for ${formatCompact(hammerHit.dealt)}${this.criticalSuffix(hammerHit.critical)}`);
      hammerHitNames.push(this.getCombatDieName(die));
      hammerTotalDamage += hammerHit.dealt;
    }
    const struckNames = [...new Set(hammerHitNames)];
    const struckLabel = struckNames.length > 0
      ? ` striking ${struckNames.join(', ')} for ${formatCompact(hammerTotalDamage)} total damage`
      : ' but strikes nothing';
    this.writeCombatLog(`⚖️ ${this.getCombatDieName(attacker)} Judgment Hammer marks ${hammerMarkedName}${struckLabel}!`);
  }

  private selectAllyAttackRecipient(source: DiceInstanceState, state: MatchBattleState, _bonus: number, skillTargeting?: DiceTargetingMode): DiceInstanceState | undefined {
    const definition = this.getDefinitionForInstance(source);
    const meta = definition ? getRuntimeSkillMeta(definition) : undefined;
    const mode = skillTargeting ?? meta?.grantAttacksTargeting ?? meta?.skillTargeting ?? 'Random';
    const candidates = state.dice
      .filter((die) => die.ownerId === source.ownerId && die.instanceId !== source.instanceId && die.zone === 'board' && !die.isDestroyed && Boolean(die.gridPosition))
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
    this.recordAttackCountEffect(recipient.instanceId, amount);
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
    this.applySkillLocks(defeated, onDeathMeta, true);
    this.applyStatusApplications(result.statusApplications);
    if (result.specialAttackDamage !== undefined) {
      await this.applySpecialSkillAttack(defeated, result.specialAttackDamage, result.specialAttackTarget, onDeathMeta, 'On-death attack');
    }

    if (result.bonusAttacks && result.bonusAttacks > 0 && result.extraEffects?.length) {
      this.playSkillSfxForDie(defeated, meta);
      const ally = result.grantAttacksToAlly !== undefined ? this.selectAllyAttackRecipient(defeated, this.gameState, result.grantAttacksToAlly) : undefined;
      if (ally) {
        this.gameState = {
          ...this.gameState,
          dice: this.gameState.dice.map((die) => {
            if (die.instanceId !== ally.instanceId) return die;
            this.recordAttackCountEffect(die.instanceId, result.bonusAttacks!);
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
      && (die.instanceId === target.instanceId || this.isOnTranscendencePattern(targetPos, this.getTranscendenceGridPosition(die.gridPosition!, targetBoardSide), pattern))
    );

    let primaryDefeated = false;
    let totalDamage = 0;
    for (const die of victims) {
      const dealt = Math.max(1, Math.floor(damage * this.getCombanityDamageMultiplier(attacker, die) * this.getDiceCardSkillDamageMultiplier(attacker)));
      const beamHit = this.applyDamageWithRevive(die.instanceId, dealt);
      this.gameState = beamHit.state;
      this.showDamageText(die, beamHit.dealt, '#9ff8ff');
      await this.applyDamageDefeatHooks(attacker, die, beamHit.defeated || beamHit.killed);
      this.addCombatActionDetail(`Beam hit ${this.getCombatDieName(die)} for ${formatCompact(beamHit.dealt)}${this.criticalSuffix(beamHit.critical)}`);
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


  private tryAdvancePipTriggeredTransform(die: DiceInstanceState, pips: number): DiceInstanceState | undefined {
    const definition = this.getDefinitionForInstance(die);
    const baseDefinition = this.getBaseDefinitionForInstance(die) ?? definition;
    if (!definition || !baseDefinition?.transformStats?.length) return undefined;
    const currentIndex = this.transformIndexByInstance.get(die.instanceId) ?? -1;
    const transformIndex = getPipTriggeredTransformIndex(baseDefinition, pips, currentIndex);
    if (transformIndex === undefined || transformIndex === currentIndex) return undefined;
    const transformFlag = baseDefinition.transformFlags?.[transformIndex];
    const meta = getRuntimeSkillMeta(baseDefinition);
    if (!transformFlag || !meta.transformFlags.includes(transformFlag)) return undefined;
    this.transformIndexByInstance.set(die.instanceId, transformIndex);
    this.pipTransformTriggeredThisTurn.add(die.instanceId);
    this.setTransformDuration(die.instanceId, baseDefinition, transformIndex);
    const transformed = this.applyTransformRootStats(die, transformIndex);
    void this.applyOnTransformedSkillEffects(transformed);
    this.animateTransformEffect(transformed);
    const triggerLabel = pips % 2 === 1 ? 'odd' : 'even';
    this.writeCombatLog(`${this.getCombatDieName(die)} advances into ${baseDefinition.transformStats?.[transformIndex]?.title ?? 'its alternate form'} on an ${triggerLabel} roll (${pips}♦)!`);
    return transformed;
  }

  private getTransformIndexForActiveDefinition(
    baseDefinition: DiceDefinition,
    _definition: DiceDefinition,
    currentIndex?: number
  ): number | undefined {
    const available = getAvailableTransformIndices(baseDefinition);
    if (available.length === 0) return undefined;
    if (currentIndex !== undefined && available.includes(currentIndex)) {
      return available.find((index) => index > currentIndex) ?? currentIndex;
    }
    return available[0];
  }

  private getActiveTransformIndex(die: DiceInstanceState, _definition: DiceDefinition): number | undefined {
    return this.transformIndexByInstance.get(die.instanceId);
  }
  
  private reconcilePipTriggeredTransform(die: DiceInstanceState, pips: number): void {
    const currentIndex = this.transformIndexByInstance.get(die.instanceId);
    if (currentIndex === undefined || !this.pipTransformTriggeredThisTurn.has(die.instanceId)) return;
    const baseDefinition = this.getBaseDefinitionForInstance(die) ?? this.getDefinitionForInstance(die);
    if (!baseDefinition?.transformStats?.length) return;
    const stillValid = getPipTriggeredTransformIndex(baseDefinition, pips, currentIndex - 1);
    if (stillValid === currentIndex) return;
    this.expireTransform(die.instanceId);
    this.pipTransformTriggeredThisTurn.delete(die.instanceId);
  }

  private refreshHandDieVisuals() {
    this.handDice.forEach((container, instanceId) => {
      const die = this.getPlayerHandDie(instanceId);
      if (die) this.applyHandDieTransformVisual(container, die);
    });
  }

  private getTransformedVisual(die: DiceInstanceState): { accent: string; symbol?: string } | null {
    const definition = this.getDefinitionForInstance(die);
    const baseDefinition = this.getBaseDefinitionForInstance(die);
    if (!definition || !baseDefinition) return null;
    const meta = getRuntimeSkillMeta(baseDefinition);
    const transformIndex = this.getActiveTransformIndex(die, definition);
    if (transformIndex === undefined) return null;
    const transformedStats = baseDefinition.transformStats?.[transformIndex];
    const transformFlag = baseDefinition.transformFlags?.[transformIndex];
    if (!transformedStats || !transformFlag || !meta.transformFlags.includes(transformFlag)) return null;
    return {
      accent: transformedStats.accent ?? baseDefinition.accent,
      symbol: transformedStats.symbol
    };
  }

  private getDieTransformFlags(die: DiceInstanceState, definition: DiceDefinition = this.getDefinitionForInstance(die)): { isTransformed: boolean } {
    if (!definition) return { isTransformed: false };
    const baseDefinition = this.getBaseDefinitionForInstance(die) ?? definition;
    const activeIndex = this.transformIndexByInstance.get(die.instanceId);
    return { isTransformed: activeIndex !== undefined && Boolean(baseDefinition.transformStats?.[activeIndex]) };
  }

  private getEffectiveAttackRange(die: DiceInstanceState, definition = this.getDefinitionForInstance(die)): number {
    if (!definition) return 0;
    const transform = this.getDieTransformFlags(die, definition);
    const activeTransformIndex = this.getActiveTransformIndex(die, definition);
    const transformedStats = activeTransformIndex !== undefined && transform.isTransformed
      ? definition.transformStats?.[activeTransformIndex]
      : undefined;
    if (transformedStats?.range !== undefined) {
      return definition.title === transformedStats.title ? definition.range : transformedStats.range;
    }
    return definition.range;
  }

  private getRangeCoverageText(die: DiceInstanceState): string {
    const definition = this.getDefinitionForInstance(die);
    if (!definition || !die.gridPosition) return `${this.getCombatDieName(die)} range unavailable.`;
    const targetOwner = die.ownerId === 'player' ? 'enemy' : 'player';
    const coveredColumns: number[] = [];
    for (let col = 0; col < GRID_SIZE; col++) {
      const proxyTarget: DiceInstanceState = {
        ...die,
        instanceId: `${die.instanceId}:range-proxy:${targetOwner}:${col}`,
        ownerId: targetOwner,
        gridPosition: { row: 0, col }
      };
      if (this.getAttackDistance(die, proxyTarget) <= Math.max(1, this.getEffectiveAttackRange(die, definition))) coveredColumns.push(col);
    }
    const columnText = coveredColumns.length > 0 ? coveredColumns.map((col) => col + 1).join(', ') : 'none';
    const tileCount = coveredColumns.length * GRID_SIZE;
    const tintName = die.ownerId === 'player' ? 'blue' : 'red';
    return `${this.getCombatDieName(die)} C${this.instanceClassLevels.get(die.instanceId) ?? 1} range ${this.getEffectiveAttackRange(die, definition)}: ${tintName} coverage hits ${tileCount}/25 enemy tiles (columns ${columnText}, all rows).`;
  }

  private criticalSuffix(critical: boolean | undefined): string {
    return critical ? ' (CRITICAL)' : '';
  }

  private showDamageText(target: DiceInstanceState, amount: number, color = '#ffdf7a', textOverride?: string) {
    const critical = this.criticalDamageTextByInstance.delete(target.instanceId);
    const shieldAbsorbed = this.shieldDamageTextByInstance.get(target.instanceId) ?? 0;
    this.shieldDamageTextByInstance.delete(target.instanceId);
    const visibleDamage = Number(amount) || 0;
    if (critical) color = '#ff3333';
    if (!target.gridPosition || (visibleDamage <= 0 && shieldAbsorbed <= 0 && !textOverride)) return;
    const grid = this.getGridContainerForDie(target);
    const x = grid.x + target.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const y = grid.y + target.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2 - 18;
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

  private showHealText(target: DiceInstanceState, amount: number, critical = false) {
    const fallbackHand = target.ownerId === 'player' ? this.handDice.get(target.instanceId) : undefined;
    if (!target.gridPosition && !fallbackHand) return;
    const x = target.gridPosition
      ? (this.getGridContainerForDie(target)).x + target.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2
      : fallbackHand!.x;
    const y = target.gridPosition
      ? (this.getGridContainerForDie(target)).y + target.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2 - 18
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
          if (this.getAttackDistance(die, proxyTarget) > Math.max(1, this.getEffectiveAttackRange(die, definition))) continue;
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

    const visual = this.getTransformedVisual(die);
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
    const isTransformed = this.isDieTransformed(die, definition);
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
    const { isTransformed } = this.getDieTransformFlags(liveDie, definition);
    const isAlternateTransformed = isTransformed;
    const activeTransformIndex = isAlternateTransformed ? this.getActiveTransformIndex(liveDie, definition) : undefined;
    const transformedStats = activeTransformIndex !== undefined ? baseDefinition.transformStats?.[activeTransformIndex] : undefined;
    const displayTitle = isAlternateTransformed && transformedStats?.title ? transformedStats.title : baseDefinition.title;
    const typeUpgradeMult = this.getTypeUpgradeMultiplier(liveDie);
    const displayDefinition = isAlternateTransformed && transformedStats && activeTransformIndex !== undefined
      ? applyTransformStats(combatBaseDefinition, activeTransformIndex)
      : (isAlternateTransformed ? combatBaseDefinition : definition);
    const effectiveAtk = Math.max(1, Math.floor(displayDefinition.attack * typeUpgradeMult));
    const soulCount = baseMeta.canConjureSouls ? this.getConjuredSoulCount(liveDie, baseMeta) : 0;
    const soulCap = baseMeta.maxSouls;
    const soulBoost = baseMeta.soulBoostPercent !== undefined && soulCount > 0 ? ` (+${formatPercent(baseMeta.soulBoostPercent * soulCount)} stats)` : '';
    const soulNote = baseMeta.canConjureSouls ? ` • SOULS ${soulCount}${baseMeta.noMaxSouls || soulCap === undefined ? '' : `/${soulCap}`}${soulBoost}` : '';
    const footprintNote = this.getFootprintForDefinition(definition) > 1 ? ` • ${this.getFootprintForDefinition(definition)}x${this.getFootprintForDefinition(definition)}` : '';
    const stats = this.add.text(width / 2, 50, `${displayTitle} • HP ${formatCompact(liveDie.currentHealth)}/${formatCompact(liveDie.maxHealth)} • ATK ${formatCompact(effectiveAtk)} • RNG ${displayDefinition.range}${footprintNote} • TARGET ${displayDefinition.targetingMode.toUpperCase()}`, {
      fontFamily: 'Orbitron',
      fontSize: '13px',
      color: PALETTE.text
    }).setOrigin(0.5);
    const activeSlots = this.getActiveManaSlots(liveDie);
    const activeManaLines = activeSlots.map((slot) => `${slot.title} ${this.getActiveMana(liveDie.instanceId, slot.key)}/${slot.manaNeeded}`);
    const shieldHp = this.shieldHpByInstance.get(liveDie.instanceId) ?? 0;
    const shieldTurns = this.shieldDurationTurnsByInstance.get(liveDie.instanceId);
    const shieldDurationNote = shieldTurns !== undefined ? ` (${shieldTurns} turn${shieldTurns === 1 ? '' : 's'})` : '';
    const shieldNote = shieldHp > 0 ? ` • Shield ${formatCompact(shieldHp)}${shieldDurationNote}` : '';
    const formatSkillType = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2');
    const classLevel = this.instanceClassLevels.get(liveDie.instanceId) ?? 1;
    const visibleSkills = (isAlternateTransformed
      ? displayDefinition.skills
      : combatBaseDefinition.skills)
      .filter((skill) => {
        const lockClass = getSkillLockClass(skill);
        return lockClass === undefined || classLevel >= lockClass;
      });
    const descriptorDefinition = isAlternateTransformed ? combatBaseDefinition : undefined;
    const descriptorSkills = activeTransformIndex !== undefined && descriptorDefinition
      ? mergeSkillsByIndex(descriptorDefinition.skills, descriptorDefinition.transformStats?.[activeTransformIndex]?.skills)
      : [];
    const transformStats = activeTransformIndex !== undefined ? baseDefinition.transformStats?.[activeTransformIndex] : undefined;
    const formSkillsComingSoon = isSkillListComingSoon(transformStats?.skillsComingSoon);
    const skillSubheader = [soulNote ? soulNote.replace(/^\s*•\s*/, 'SOULS ') : '', shieldNote ? shieldNote.replace(/^\s*•\s*/, 'SHIELD ') : ''].filter(Boolean).join(' • ');
    const skillDescription = formSkillsComingSoon
      ? 'Coming soon...'
      : visibleSkills.length === 0
      ? 'This dice does not have any special skills.'
      : visibleSkills.map((skill, skillIndex) => {
        const sourceSkill = descriptorSkills.find((candidate) => candidate.title === skill.title && candidate.type === skill.type)
          ?? descriptorSkills[skillIndex];
        return `${skill.title} (${formatSkillType(skill.type)}): ${getClassScaledSkillDescription(displayDefinition, skill, typeUpgradeMult, sourceSkill?.modifiers)}`;
      }).join(' | ');
    const desc = this.add.text(width / 2, 78, `${skillSubheader ? `${skillSubheader}\n` : ''}${skillDescription}`, {
      fontFamily: 'Orbitron',
      fontSize: '11px',
      color: PALETTE.textMuted,
      wordWrap: { width: 530 }
    }).setOrigin(0.5, 0);
    const panelTop = 24;
    let nextBuffY = desc.y + desc.height + 8;
    const panelHeight = Math.max(112, nextBuffY - panelTop + activeManaLines.length * 12 + (statusEffects.length > 0 ? 18 : 0) + (activeBuffs.length > 0 ? 18 : 0) + attackCountBuffs.length * 14 + 12);
    const panel = this.add.rectangle(width / 2, panelTop + panelHeight / 2, 560, panelHeight, 0x102434, 0.95).setStrokeStyle(2, 0x406987);
    const popupElements: Phaser.GameObjects.GameObject[] = [panel, stats, desc];
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
    const palette: Record<'slow' | 'poison' | 'berserk' | 'taunt' | 'fracture' | 'stun' | 'acceleration' | 'dilation', { color: number; icon: string }> = {
      slow: { color: 0x8fd5ff, icon: '❄' },
      poison: { color: 0x74d66f, icon: '☠' },
      berserk: { color: 0xff4d4d, icon: '!' },
      taunt: { color: 0xffb347, icon: 'T' },
      fracture: { color: 0xffbf80, icon: '🜂' },
      stun: { color: 0xfff176, icon: 'S' },
      acceleration: { color: 0x8fd5ff, icon: 'A' },
      dilation: { color: 0xb58cff, icon: 'D' }
    };
    effects.forEach((effect, index) => {
      const px = x - 22 + index * 16;
      const py = y - 24;
      const g = this.add.graphics();
      g.name = 'status-effect';
      g.fillStyle(palette[effect].color, 0.9);
      g.fillCircle(px, py, 7);
      g.lineStyle(1, 0xffffff, 0.8);
      g.strokeCircle(px, py, 7);
      container.add(g);
      const icon = this.add.text(px, py, palette[effect].icon, {
        fontFamily: 'Orbitron',
        fontSize: '9px',
        color: '#071018'
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

  private getCombatPacingMultiplier() {
    return this.gamePhase.stage === 'combat' && this.combatTimeRemainingMs <= 15_000 ? 2 : 1;
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
      if (second === 15) {
        AudioManager.playSfx(this, AUDIO_KEYS.gameTimerTick, { volume: 0.62 });
      } else if (second < 10 && second > 0) {
        AudioManager.playSfx(this, AUDIO_KEYS.gameCountdown, { volume: 0.62 });
      }
    }
    this.updateCombatTimerUi();
    await this.delay(actualDelay);
    return this.combatTimeRemainingMs > 0 && this.sys.isActive();
  }

  private checkWinConditions(): boolean {
    const playerLiving = getLivingDiceCount(this.gameState, 'player');
    const enemyLiving = getLivingDiceCount(this.gameState, 'enemy');

    if (enemyLiving === 0) {
      if (this.activeChallenge === 'deucifer' && !this.deuciferBossSummoned) {
        return false;
      }
      if (this.activeChallenge === 'bossfight') {
        if (this.bossfightBossDefeatedThisTurn) return false;
        this.bossfightBossDefeatedThisTurn = true;
        this.bossfightPendingReward = { boss: this.bossfightCurrentBoss, level: this.bossfightLevel };
        this.completeBossfightLevel(this.bossfightCurrentBoss, this.bossfightLevel);
        this.endGame('victory', `${this.bossfightCurrentBoss} Lv.${this.bossfightLevel} defeated! Next stage unlocked.`);
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


  private readStringArrayFromStorage(key: string): string[] {
    try {
      const parsed = readIntegrityChecked<unknown>(key) ?? [];
      const valid: BotDifficulty[] = Array.isArray(parsed)
        ? parsed.filter((entry): entry is BotDifficulty =>
          entry === 'Baby' || entry === 'Easy' || entry === 'Medium' || entry === 'Hard' || entry === 'Nightmare')
        : [];
      this.registry.set(key, valid);
      return valid;
    } catch {
      return [];
    }
  }

  private getClaimedBotFirstWins(): BotDifficulty[] {
    const stored = this.registry.get(BOT_FIRST_WIN_KEY) as BotDifficulty[] | undefined;
    if (stored) return stored;
    const parsed = this.readStringArrayFromStorage(BOT_FIRST_WIN_KEY)
      .filter((value): value is BotDifficulty => value in BOT_DIFFICULTY_CLASSES);
    this.registry.set(BOT_FIRST_WIN_KEY, parsed);
    return parsed;
  }

  private hasClaimedBotFirstWin(difficulty: BotDifficulty): boolean {
    return this.getClaimedBotFirstWins().includes(difficulty);
  }

  private markBotFirstWinClaimed(difficulty: BotDifficulty) {
    const next = [...new Set([...this.getClaimedBotFirstWins(), difficulty])];
    this.registry.set(BOT_FIRST_WIN_KEY, next);
    writeIntegrityChecked(BOT_FIRST_WIN_KEY, next);
  }

  private getChallengeRewardClaims(): string[] {
    const stored = this.registry.get(CHALLENGE_REWARD_CLAIMS_KEY) as string[] | undefined;
    if (stored) return stored;
    try {
      const parsed = readIntegrityChecked<unknown>(CHALLENGE_REWARD_CLAIMS_KEY) ?? [];
      const valid = Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
      this.registry.set(CHALLENGE_REWARD_CLAIMS_KEY, valid);
      return valid;
    } catch {
      return [];
    }
  }

  private hasChallengeRewardClaimed(claimKey: string): boolean {
    return this.getChallengeRewardClaims().includes(claimKey);
  }

  private markChallengeRewardClaimed(claimKey: string) {
    const next = [...new Set([...this.getChallengeRewardClaims(), claimKey])];
    this.registry.set(CHALLENGE_REWARD_CLAIMS_KEY, next);
    writeIntegrityChecked(CHALLENGE_REWARD_CLAIMS_KEY, next);
  }

  private endGame(stage: MatchResultStage, message: string) {
    if (this.gamePhase.stage === 'victory' || this.gamePhase.stage === 'defeat' || this.gamePhase.stage === 'draw') return;
    this.gamePhase = { stage };

    const baseTokenReward = stage === 'victory' && this.activeChallenge === 'bossfight' ? 0 : MATCH_TOKEN_REWARDS[stage];
    let tokenReward = baseTokenReward;
    let chipReward = 0;
    if (stage === 'victory' && this.activeChallenge === null && !this.hasClaimedBotFirstWin(this.configDifficulty)) {
      const firstWinReward = BOT_FIRST_WIN_REWARDS[this.configDifficulty];
      tokenReward += firstWinReward.tokens;
      chipReward += firstWinReward.chips;
      this.markBotFirstWinClaimed(this.configDifficulty);
    }
    if (stage === 'victory' && this.activeChallenge === 'daily') {
      const nextAchievements = AchievementStore.mutate(this, (state) => ({ ...state, dailyChallengeWins: state.dailyChallengeWins + 1 }));
      AchievementStore.unlock(this, 'challenger');
      if (nextAchievements.dailyChallengeWins >= 10) AchievementStore.unlock(this, 'problem_solver');
      this.setChallengeStatus('daily', 'completed');
      const dailyClaimKey = `daily:${this.activeDailyKey || new Date().toISOString().slice(0, 10)}`;
      if (!this.hasChallengeRewardClaimed(dailyClaimKey)) {
        tokenReward += this.dailyHard ? 2400 : 800;
        chipReward += this.dailyHard ? 30 : 10;
        this.markChallengeRewardClaimed(dailyClaimKey);
      }
    }
    if (stage === 'victory' && this.activeChallenge === 'deucifer') {
      AchievementStore.unlock(this, 'demonic_torment');
      this.setChallengeStatus('deucifer', 'completed');
      const deuciferClaimKey = 'deucifer';
      if (!this.hasChallengeRewardClaimed(deuciferClaimKey)) {
        tokenReward += 7500;
        chipReward += 50;
        this.markChallengeRewardClaimed(deuciferClaimKey);
      }
    }
    if (stage === 'victory' && this.activeChallenge === 'dopamine') {
      AchievementStore.unlock(this, 'hooked');
      this.setChallengeStatus('dopamine', 'completed');
      const dopamineClaimKey = 'dopamine';
      if (!this.hasChallengeRewardClaimed(dopamineClaimKey)) {
        tokenReward += 2500;
        chipReward += 20;
        this.markChallengeRewardClaimed(dopamineClaimKey);
      }
    }
    if (stage === 'victory' && this.activeChallenge === 'bossfight' && this.bossfightPendingReward) {
      const defeatedTier = this.bossfightPendingReward.level;
      AchievementStore.unlock(this, 'boss_slayer');
      if (defeatedTier >= 5) AchievementStore.unlock(this, 'boss_ripper');
      if (defeatedTier >= 10) AchievementStore.unlock(this, 'boss_hunter');
      const reward = this.claimBossfightReward(this.bossfightPendingReward.boss, this.bossfightPendingReward.level);
      tokenReward += reward.tokens;
      chipReward += reward.chips;
      this.bossfightPendingReward = null;
    }
    if (stage !== 'victory' && this.activeChallenge === 'daily') {
      const dailyStatus = this.getChallengeStatus('daily');
      if (dailyStatus !== 'completed' && this.canChallengeBeMarkedFailed('daily')) this.setChallengeStatus('daily', 'failed');
    }
    if (stage !== 'victory' && this.activeChallenge === 'deucifer') {
      const deuciferStatus = this.getChallengeStatus('deucifer');
      if (deuciferStatus !== 'completed' && this.canChallengeBeMarkedFailed('deucifer')) this.setChallengeStatus('deucifer', 'failed');
    }
    if (stage !== 'victory' && this.activeChallenge === 'dopamine') {
      const dopamineStatus = this.getChallengeStatus('dopamine');
      if (dopamineStatus !== 'completed' && this.canChallengeBeMarkedFailed('dopamine')) this.setChallengeStatus('dopamine', 'failed');
    }
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

  private toggleExitPrompt() {
    if (this.modalContainer || this.modalEscHandler) {
      return;
    }
    if (this.exitPromptOpen) {
      this.closeExitPrompt();
      return;
    }
    this.exitPromptOpen = true;
    const { width, height } = this.scale;
    const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.55).setInteractive();
    const panel = this.add.rectangle(width / 2, height / 2, 380, 180, 0x102434, 0.98).setStrokeStyle(2, 0x406987);
    const label = this.add.text(width / 2, height / 2 - 28, 'Quit Arena Match?', { fontFamily: 'Orbitron', fontSize: '20px', color: PALETTE.text }).setOrigin(0.5);
    const hint = this.add.text(width / 2, height / 2 + 2, 'Press ESC again or Cancel to continue.', { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.textMuted }).setOrigin(0.5);
    const cancel = this.add.text(width / 2 - 70, height / 2 + 48, 'CANCEL', { fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.text, backgroundColor: '#173247', padding: { left: 10, right: 10, top: 6, bottom: 6 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const quit = this.add.text(width / 2 + 70, height / 2 + 48, 'QUIT', { fontFamily: 'Orbitron', fontSize: '13px', color: '#ffffff', backgroundColor: '#9b2d2d', padding: { left: 12, right: 12, top: 6, bottom: 6 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    overlay.on('pointerdown', () => this.closeExitPrompt());
    cancel.on('pointerdown', () => this.closeExitPrompt());
    quit.on('pointerdown', () => {
      const wasFinished = this.gamePhase.stage === 'victory' || this.gamePhase.stage === 'defeat' || this.gamePhase.stage === 'draw';
      if (this.activeChallenge === 'daily') {
        const dailyStatus = this.getChallengeStatus('daily');
        if (!wasFinished && dailyStatus !== 'completed' && this.canChallengeBeMarkedFailed('daily')) this.setChallengeStatus('daily', 'failed');
      }
      if (this.activeChallenge === 'deucifer') {
        const deuciferStatus = this.getChallengeStatus('deucifer');
        if (!wasFinished && deuciferStatus !== 'completed' && this.canChallengeBeMarkedFailed('deucifer')) this.setChallengeStatus('deucifer', 'failed');
      }
      if (this.activeChallenge === 'dopamine') {
        const dopamineStatus = this.getChallengeStatus('dopamine');
        if (!wasFinished && dopamineStatus !== 'completed' && this.canChallengeBeMarkedFailed('dopamine')) this.setChallengeStatus('dopamine', 'failed');
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

  private pickRandomColumn(columns: number[]): number {
    if (columns.length === 0) return 0;
    return columns[Phaser.Math.Between(0, columns.length - 1)] ?? 0;
  }
  private canChallengeBeMarkedFailed(challenge: Exclude<ChallengeKey, null>): boolean {
    if (challenge === 'daily') {
      const claimKey = `daily:${this.activeDailyKey || new Date().toISOString().slice(0, 10)}`;
      return !this.hasChallengeRewardClaimed(claimKey);
    }
    if (challenge === 'deucifer') return !this.hasChallengeRewardClaimed('deucifer');
    return !this.hasChallengeRewardClaimed('dopamine');
  }
}
