import Phaser from 'phaser';
import { canReceiveUsefulCopies, getActiveLoadoutSlot, getAllDiceDefinitions, getDiceDefinitions, getDiceProgress, getDiceTokens, getDiamonds, getExclusiveDiceDefinitions, getRangeLabel, grantDiceCopies, LOADOUT_SLOT_COUNT, RARITY_TEXT_COLORS, setActiveLoadoutSlot, setDiceTokens, setDiamonds } from '../data/dice';
import {
  createMatchBattleState,
  getAvailableHandDice,
  placeDieOnBoard,
  getBoardDice,
  getLivingDiceCount,
  getNextAttacker,
  executeAttack,
  applyDamage,
  spendAttack,
  resolveCombatPhase,
  endTurn,
  type MatchBattleState
} from '../systems/BattleState';
import { DebugManager } from '../utils/DebugManager';
import { AlertManager } from '../utils/AlertManager';
import { PALETTE, getLayout } from '../ui/theme';
import type { DiceTypeId, DiceInstanceState, DiceDefinition, DiceTargetingMode } from '../types/game';
import { buildSkillIndex } from '../data/SkillLoader';
import { getRuntimeSkillMeta } from '../systems/DiceSkills';
import { executeOnDamagedSkillEffects, executeOnDeathSkillEffects, executeOnKillSkillEffects, executeOnTransformedSkillEffects, executeCombatEndSkillEffects, executePassiveSkillEffects, executeActiveSkillEffects, collectCombatStartAuras, computeCombatStartBonus, hasJudgmentHammer, getHammerDamage } from '../systems/CombatSkills';
import { applyClassProgression, getClassScaledSkillDescription, getClassMultiplier } from '../systems/ClassProgression';
import { SCENE_KEYS } from './sceneKeys';
import { CasinoProgressStore } from '../systems/CasinoProgressStore';
import { AUDIO_KEYS, AudioManager } from '../utils/AudioManager';
import { AnimationManager } from '../utils/AnimationManager';
import { canOfferDiceCards, getDiceCardMagnitude, getDiceCardRarityRoll, rollDiceCards, type DiceCard, type DiceCardRarity } from '../systems/DiceCards';
import { ProfileStore } from '../systems/ProfileStore';
import { AchievementStore } from '../systems/AchievementStore';
import { ArenaMultiplayerClient, type ArenaMultiplayerStatus } from '../systems/ArenaMultiplayerClient';
import { formatSkillInfo, getDiceAlternateFormLabel, getDiceModalDisplayDefinition } from './DiceScene';
 
 
type BotDifficulty = 'Baby' | 'Easy' | 'Medium' | 'Hard' | 'Nightmare';
type MatchResultStage = 'victory' | 'defeat' | 'draw';
type RandomModeModifier = 'Classic' | 'Combanity' | 'Duality' | 'Necromancy' | 'DiceCard';
type ChallengeKey = 'daily' | 'deucifer' | 'dopamine' | 'bossfight' | null;
type ChallengeStatus = 'not-started' | 'started' | 'completed' | 'failed';
type DailyLoadoutMode = 'mirror' | 'player-vs-enemy' | 'random-vs-random';
type TranscendenceBeamPattern = 'row' | 'column' | 'diagonalDown' | 'diagonalUp';
 
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
type BossfightBossType = 'Magician' | 'Leon';
const BOSSFIGHT_BOSSES: BossfightBossType[] = ['Magician', 'Leon'];
const MAX_BOSSFIGHT_LEVEL = 15;
const TRANSCENDENCE_GRID_WIDE_RANGE = GRID_SIZE * 2 - 1;
 
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
  private startCombatButton!: Phaser.GameObjects.Rectangle;
  private handContainer!: Phaser.GameObjects.Container;
  private handDice: Map<string, Phaser.GameObjects.Container> = new Map();
  private placedDiceCount = 0;
  private gridDropZones: Phaser.GameObjects.Rectangle[] = [];
  private dicePips: Map<string, number> = new Map();
  private enemyDicePips: Map<string, number> = new Map();
  private enemyClassLevels: Map<string, number> = new Map();
  private manaByInstance: Map<string, number> = new Map();
  private playerManaChargedAccrued = 0;
  private activeManaByInstance: Map<string, Map<string, number>> = new Map();
  private shieldHpByInstance: Map<string, number> = new Map();
  private shieldDurationTurnsByInstance: Map<string, number> = new Map();
  private tauntedByInstance: Map<string, { sourceId: string; turns: number }> = new Map();
  private attackCapacityByInstance: Map<string, number> = new Map();
  private attackDeltaByInstance: Map<string, { delta: number; turns: number }> = new Map();
  private extraAttackTurnsByInstance: Map<string, { extra: number; turns: number }> = new Map();
  private attackMultiplierTurnsByInstance: Map<string, { multiplier: number; turns: number }> = new Map();
  private basicAttacksPerAttackByInstance: Map<string, { count: number; turns: number }> = new Map();
  private combatAttackCountDeltaByInstance: Map<string, number> = new Map();
  private combatAttackCountPositiveDeltaByInstance: Map<string, number> = new Map();
  private combatAttackCountNegativeDeltaByInstance: Map<string, number> = new Map();
  private attackCountEffectSeenByInstance: Map<string, { positive: boolean; negative: boolean }> = new Map();
  private manaPausedTurnsByInstance: Map<string, number> = new Map();
  private combanityAttackMultiplierByInstance: Map<string, { multiplier: number; turns: number }> = new Map();
  private damageReductionByInstance: Map<string, number> = new Map();
  private poisonByInstance: Map<string, { damage: number; turns: number; stacks?: number; sourceOwnerId?: 'player' | 'enemy'; sourceTypeId?: string }> = new Map();
  private armorShredByInstance: Map<string, { rate: number; turns: number }> = new Map();
  private transcendenceTransformed: Set<string> = new Set();
  private oddPipTransformed: Set<string> = new Set();
  private rollAllButton!: Phaser.GameObjects.Rectangle;
  private rollAllButtonLabel!: Phaser.GameObjects.Text;
  private rollHelperText!: Phaser.GameObjects.Text;
  private diceRolled = false;
  private currentHandOrder: string[] = [];
  private lavaPoolsByTile: Map<string, { damage: number; turns: number; sourceOwnerId?: 'player' | 'enemy'; sourceTypeId?: string }> = new Map();
  private deathDiceTransformed: Set<string> = new Set();
  private deathAlliesDefeatedCount: Map<string, number> = new Map();
  private permanentAttackBonusByInstance: Map<string, number> = new Map();
  private basicAttackDamageBonusByInstance: Map<string, number> = new Map();
  private instanceDefinitionOverrides: Map<string, DiceDefinition> = new Map();
  private instanceClassLevels: Map<string, number> = new Map();
  private enemyLoadoutRevealed = false;
  private sessionStartedAtMs = 0;
  private infiltratedBoardSideByInstance: Map<string, 'player' | 'enemy'> = new Map();
  private chainedByInstance: Map<string, string> = new Map();
  private rangeHighlightObjects: Phaser.GameObjects.GameObject[] = [];
  private highlightedRangeInstanceId: string | null = null;
  private soulDiceSoulsConjured: Map<string, number> = new Map();
  private brokenGrowthDeltaByInstance: Map<string, number> = new Map();
  private modalContainer: Phaser.GameObjects.Container | null = null;
  private modalEscHandler: (() => void) | null = null;
  private modalWheelHandler: ((pointer: Phaser.Input.Pointer, gameObjects: Phaser.GameObjects.GameObject[], dx: number, dy: number) => void) | null = null;
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
  private crowdAttackByOwner: Record<'player' | 'enemy', { damage: number; reduction: number }> = { player: { damage: 0, reduction: 0 }, enemy: { damage: 0, reduction: 0 } };
  private assassinBoostAttacksByInstance: Map<string, number> = new Map();
  private diceCardPicksUsed = 0;
  private multiplayerClient = new ArenaMultiplayerClient();
  private multiplayerStatus: ArenaMultiplayerStatus = this.multiplayerClient.getStatus();
  private playerDisplayName = 'Player';
  private enemyDisplayName = 'Opponent';
  private deuciferBossPending = false;
  private deuciferBossSummoned = false;
  private bossfightLevel = 1;
  private bossfightCurrentBoss: BossfightBossType = 'Magician';
  private bossfightMenuBoss: BossfightBossType = 'Magician';
  private bossfightMenuLevel = 1;
  private bossfightBossDefeatedThisTurn = false;
  private bossfightPendingReward: { boss: BossfightBossType; level: number } | null = null;
  private stunnedByInstance: Map<string, number> = new Map();
 
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
    this.activeManaByInstance.clear();
    this.shieldHpByInstance.clear();
    this.shieldDurationTurnsByInstance.clear();
    this.tauntedByInstance.clear();
    this.attackDeltaByInstance.clear();
    this.extraAttackTurnsByInstance.clear();
    this.attackMultiplierTurnsByInstance.clear();
    this.basicAttacksPerAttackByInstance.clear();
    this.combatAttackCountDeltaByInstance.clear();
    this.combatAttackCountPositiveDeltaByInstance.clear();
    this.combatAttackCountNegativeDeltaByInstance.clear();
    this.attackCountEffectSeenByInstance.clear();
    this.manaPausedTurnsByInstance.clear();
    this.combanityAttackMultiplierByInstance.clear();
    this.damageReductionByInstance.clear();
    this.poisonByInstance.clear();
    this.armorShredByInstance.clear();
    this.diceRolled = false;
    this.currentHandOrder = [];
    this.activeRandomModifier = null;
    this.transcendenceTransformed.clear();
    this.oddPipTransformed.clear();
    this.lavaPoolsByTile.clear();
    this.deuciferBossPending = false;
    this.deuciferBossSummoned = false;
    this.bossfightLevel = 1;
    this.bossfightCurrentBoss = 'Magician';
    this.loadBossfightMenuState();
    this.bossfightBossDefeatedThisTurn = false;
    this.bossfightPendingReward = null;
    this.stunnedByInstance.clear();
    this.deathDiceTransformed.clear();
    this.deathAlliesDefeatedCount.clear();
    this.permanentAttackBonusByInstance.clear();
    this.basicAttackDamageBonusByInstance.clear();
    this.soulDiceSoulsConjured.clear();
    this.brokenGrowthDeltaByInstance.clear();
    this.instanceDefinitionOverrides.clear();
    this.instanceClassLevels.clear();
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
    this.crowdAttackByOwner = { player: { damage: 0, reduction: 0 }, enemy: { damage: 0, reduction: 0 } };
    this.diceTypeUpgradeBonus.clear();
    this.spotlightByInstance.clear();
    this.giantHunterRateByOwner = { player: 0, enemy: 0 };
    this.fountainHealRateByOwner = { player: 0, enemy: 0 };
    this.manaPotionGainByOwner = { player: 0, enemy: 0 };
    this.assassinBoostAttacksByInstance.clear();
    this.infiltratedBoardSideByInstance.clear();
    this.chainedByInstance.clear();
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
    ].filter((die): die is DiceDefinition => Boolean(die)).map((die) => [die.typeId, die]));
    this.skillIndex = buildSkillIndex([...this.definitions.values()]);
 
    AudioManager.playMusic(this, 'arena-music');
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
 
  private openArenaDiceStatsModal(typeId: DiceTypeId, showAlternate = false) {
    this.clearModeModal();
    const definition = getAllDiceDefinitions(this).find((die) => die.typeId === typeId);
    if (!definition) return;
    const progress = getDiceProgress(this, typeId);
    const scaled = getDiceModalDisplayDefinition(definition, progress.classLevel, showAlternate);
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const overlay = this.add.rectangle(cx, cy, width, height, 0x000000, 0.55).setInteractive();
    const panel = this.add.rectangle(cx, cy, 540, 340, 0x163246, 0.96).setStrokeStyle(2, 0x4f7ea1);
    const title = this.add.text(cx, cy - 140, `${scaled.title} • CLASS ${progress.classLevel}/15`, { fontFamily: 'Orbitron', fontSize: '20px', color: scaled.accent }).setOrigin(0.5);
    const stats = this.add.text(cx, cy - 106, `ATK ${scaled.attack}  |  HP ${scaled.health}  |  RANGE ${scaled.range} (${getRangeLabel(scaled.range)})`, { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.text, align: 'center' }).setOrigin(0.5);
    const rarityColor = RARITY_TEXT_COLORS[scaled.rarity] ?? PALETTE.text;
    const rarityLabel = this.add.text(cx - 140, cy - 84, 'RARITY', { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.text, align: 'right' }).setOrigin(1, 0.5);
    const rarityStats = this.add.text(cx - 126, cy - 84, scaled.rarity, { fontFamily: 'Orbitron', fontSize: '12px', color: rarityColor, align: 'left' }).setOrigin(0, 0.5);
    const targetStats = this.add.text(cx + 12, cy - 84, `TARGET ${scaled.targetingMode.toUpperCase()}  |  COPIES ${progress.copies}`, { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.text, align: 'left' }).setOrigin(0, 0.5);
    const skillViewportWidth = 470;
    const skillViewportHeight = 132;
    const skillViewportTop = cy - 70;
    const skillContainer = this.add.container(cx, skillViewportTop);
    const skill = this.add.text(0, 0, formatSkillInfo(scaled), {
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
    const alternateLabel = getDiceAlternateFormLabel(definition, showAlternate);
    const altBtn = this.add.text(cx, cy + 120, alternateLabel ?? '', {
      fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.accentSoft,
      backgroundColor: '#224b66', padding: { left: 8, right: 8, top: 4, bottom: 4 }
    }).setOrigin(0.5);
    if (alternateLabel) {
      altBtn.setInteractive({ useHandCursor: true });
      altBtn.on('pointerdown', () => this.openArenaDiceStatsModal(typeId, !showAlternate));
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
    const fallback: BossfightProgress = { unlockedLevels: { Magician: 1, Leon: 1 }, rewardClaims: [] };
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
      const parsed = JSON.parse(localStorage.getItem(BOSSFIGHT_PROGRESS_KEY) ?? '{}') as Partial<BossfightProgress>;
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
    localStorage.setItem(BOSSFIGHT_PROGRESS_KEY, JSON.stringify(normalized));
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
 
    const bossColor: Record<BossfightBossType, string> = { Magician: '#b073ff', Leon: '#e63946' };
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
    makeBossButton('Magician', cx - 128);
    makeBossButton('Leon', cx + 128);
 
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
      this.add.text(cx, cy + 64, `Reward: ${reward.tokens.toLocaleString()} Dice Tokens + ${reward.chips} Casino Chips`, { fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.text }).setOrigin(0.5),
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
    const dopamine = makeBtn(cx, cy, `Dopamine Challenge`, `Status: ${this.getChallengeStatusLabel(dopamineStatus)}\nMedium • Dice Card • 10 Turns\nReward: 2500 Tokens + 20 Chips`, () => {
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
    const deuc = makeBtn(cx + 320, cy, `Deucifer's Challenge`, `Status: ${this.getChallengeStatusLabel(deuciferStatus)}\nNightmare Deucifer\nClassic • 10 Turns (+5 vs boss)\nReward: 7500 Tokens + 50 Chips`, () => {
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
      return JSON.parse(localStorage.getItem(CHALLENGE_STATUS_KEY) ?? '{}') as Record<string, ChallengeStatus>;
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
    localStorage.setItem(CHALLENGE_STATUS_KEY, JSON.stringify(store));
  }
 
  private getChallengeStatusLabel(status: ChallengeStatus): string {
    if (status === 'started') return 'STARTED';
    if (status === 'completed') return 'COMPLETED';
    if (status === 'failed') return 'FAILED';
    return 'NOT STARTED';
  }
 
  private hasAssassinOpeningRuntime(definition: DiceDefinition | undefined): boolean {
    if (!definition) return false;
    return definition.skills.some((sk) => (sk.modifiers?.notes ?? []).includes('runtime:assassinBacklineTeleport'));
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
    
    // Day 7 large button
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
      const pick = legendaries.length > 0 ? legendaries[Math.floor(Math.random() * legendaries.length)] : undefined;
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
    const rawCode = window.prompt('Enter 6-digit lobby code', '');
    const lobbyCode = this.normalizeLobbyCode(rawCode ?? '');
    if (!lobbyCode) {
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
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () => alphabet[Phaser.Math.Between(0, alphabet.length - 1)] ?? 'A').join('');
  }
 
  private normalizeLobbyCode(code: string): string {
    const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return normalized.length === 6 ? normalized : '';
  }
 
  private queueArenaMultiplayer(options: { mode: 'matchmaking' | 'multiplayer'; lobbyAction?: 'create' | 'join'; lobbyCode?: string; randomMode: boolean }) {
    const profile = ProfileStore.get(this);
    this.playerDisplayName = profile.username || 'Player';
    const loadoutTypeIds = getDiceDefinitions(this).map((definition) => definition.typeId);
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
    this.multiplayerClient.connect(setStatus);
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
 
    this.gameContainer.add([this.turnText, this.playerGridContainer, this.enemyGridContainer, this.backButton, this.playerStatusPanel, this.enemyStatusPanel]);
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
    const allDefinitions = getAllDiceDefinitions(this);
    const shouldRandomizeLoadoutAndClassUps = this.configRandomMode && this.configRandomizeLoadoutAndClassUps;
    const dailyLoadoutMode = this.activeChallenge === 'daily' ? this.getDailyLoadoutMode() : null;
    const dailyRandomClassUps = this.activeChallenge === 'daily' && this.getDailyUsesRandomClassUps();
    const dailyMirrorLoadout = dailyLoadoutMode === 'mirror' ? this.pickDailySeededLoadout(allDefinitions, 'mirror') : null;
    const playerLoadoutDefinitions = dailyMirrorLoadout
      ?? (dailyLoadoutMode === 'random-vs-random'
        ? this.pickDailySeededLoadout(allDefinitions, 'player')
        : shouldRandomizeLoadoutAndClassUps && this.activeChallenge !== 'daily'
        ? this.pickRandomEnemyLoadout(allDefinitions)
        : getDiceDefinitions(this));
 
    const effectiveLevel = (raw: number) => this.configUseLevelling ? raw : 1;
 
    const playerClassLevels = new Map<DiceTypeId, number>();
    const hardDaily = this.activeChallenge === 'daily' && this.dailyHard;
    const playerMaxClass = hardDaily ? 10 : 15;
    const playerClassLevelsBySlot: number[] = [];
    const playerDefs = playerLoadoutDefinitions
      .map((definition, index) => {
        const classLevel = this.activeChallenge === 'daily' && this.configUseLevelling
          ? (dailyRandomClassUps
            ? Math.min(playerMaxClass, this.getDailySeededIndex(`player-class-${definition.typeId}-${index}`, playerMaxClass) + 1)
            : effectiveLevel(getDiceProgress(this, definition.typeId).classLevel))
          : shouldRandomizeLoadoutAndClassUps && this.configUseLevelling
          ? Phaser.Math.Between(1, 15)
          : effectiveLevel(getDiceProgress(this, definition.typeId).classLevel);
        playerClassLevels.set(definition.typeId, classLevel);
        playerClassLevelsBySlot[index] = classLevel;
        return this.applyClassProgress(definition, classLevel);
      });
 
    const playerBestClass = [...playerClassLevels.values()].reduce((max, lvl) => Math.max(max, lvl), 1);
 
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
      : this.pickRandomEnemyLoadout(allDefinitions);
    const enemyDefs = enemyRawDefs.map((definition, index) => {
      const classLevel = this.activeChallenge === 'bossfight'
        ? this.bossfightLevel
        : this.activeChallenge === 'deucifer'
        ? 11
        : this.activeChallenge === 'dopamine'
        ? 7
        : this.activeChallenge === 'daily' && this.configUseLevelling
        ? (hardDaily
          ? Math.min(15, Math.max(playerClassLevelsBySlot[index % Math.max(1, playerClassLevelsBySlot.length)] ?? playerBestClass, playerBestClass) + 5)
          : dailyRandomClassUps
          ? this.getDailySeededIndex(`enemy-class-${definition.typeId}-${index}`, 15) + 1
          : effectiveLevel(getDiceProgress(this, definition.typeId).classLevel))
        : shouldRandomizeLoadoutAndClassUps && this.configUseLevelling
        ? Phaser.Math.Between(1, 15)
        : effectiveLevel(this.rollEnemyClassLevel());
      this.enemyClassLevels.set(definition.typeId, classLevel);
      return this.applyClassProgress(definition, classLevel);
    });
 
    this.gameState = createMatchBattleState(playerDefs, enemyDefs);
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
 
    // Store per-instance class-scaled definitions so both stats and skills resolve at the die's class.
    this.instanceDefinitionOverrides.clear();
    this.gameState.dice.forEach((die) => {
      const scaledDef = die.ownerId === 'player'
        ? playerDefs.find((d) => d.typeId === die.typeId)
        : enemyDefs.find((d) => d.typeId === die.typeId);
      if (scaledDef) {
        this.instanceDefinitionOverrides.set(die.instanceId, scaledDef);
        this.instanceClassLevels.set(die.instanceId, die.ownerId === 'player'
          ? (playerClassLevels.get(die.typeId) ?? 1)
          : (this.enemyClassLevels.get(die.typeId) ?? 1));
      }
    });
 
    if (this.activeChallenge === 'deucifer') this.enemyDisplayName = 'Deucifer';
    if (this.activeChallenge === 'bossfight') this.enemyDisplayName = `${this.bossfightCurrentBoss} Lv.${this.bossfightLevel}`;
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
    if (this.configRandomMode) this.combatLog.setText(`Random Mode: ${this.getRandomModeDisplayName(this.activeRandomModifier ?? 'Classic')} selected.`);
  }
 
  private getRandomModeDisplayName(modifier: RandomModeModifier): string {
    return modifier === 'DiceCard' ? 'Dice Card' : modifier;
  }
 
  private getDefinitionForInstance(die: DiceInstanceState): DiceDefinition | undefined {
    return this.instanceDefinitionOverrides.get(die.instanceId) ?? this.definitions.get(die.typeId);
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
    const usedCells = new Set<string>();
    this.gameState.dice.forEach((die) => {
      if (die.ownerId !== ownerId || die.instanceId === excludedInstanceId || die.zone !== 'board' || die.isDestroyed || !die.gridPosition) return;
      this.markFootprint(die.gridPosition.row, die.gridPosition.col, this.getFootprintForDie(die), usedCells);
    });
    return usedCells;
  }
 
  private findRandomFootprintPosition(footprint: number, usedCells: Set<string>, pickColumn: () => number): { row: number; col: number } | undefined {
    for (let attempts = 0; attempts < 80; attempts++) {
      const row = Phaser.Math.Between(0, GRID_SIZE - footprint);
      const col = Math.min(GRID_SIZE - footprint, Math.max(0, pickColumn()));
      if (this.canPlaceFootprint(row, col, footprint, usedCells)) return { row, col };
    }
    for (let row = 0; row <= GRID_SIZE - footprint; row++) {
      for (let col = 0; col <= GRID_SIZE - footprint; col++) {
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
      const rolledPips = Math.floor(Math.random() * 6) + 1;
      this.dicePips.set(instanceId, rolledPips);
      rollResults.push(`${handDie.typeId}:${rolledPips}`);
 
      const container = this.handDice.get(instanceId);
      if (container) {
        const pipText = container.list.find((obj) => obj.name === 'pipText') as Phaser.GameObjects.Text;
        if (pipText) {
          pipText.setText(`${rolledPips}♦`);
          pipText.setColor(PALETTE.accent);
        }
        const visual = this.getTransformedVisual(handDie);
        const handDefinition = this.getDefinitionForInstance(handDie);
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
    this.combatLog.setText(`Rolled: ${rollResults.join(', ')}`);
    this.debug.log('All dice rolled', { results: rollResults });
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
    if (handDie) this.renderStatusEffects(container, 0, 0, handDie);
 
    if (draggable) {
      container.setInteractive({ draggable: true, useHandCursor: true });
      this.input.setDraggable(container);
 
      container.on('dragstart', () => {
        if (!this.diceRolled) {
          return;
        }
        container.setScale(1.1);
        container.setDepth(100);
        this.highlightValidDropZones(true);
      });
 
      container.on('drag', (_pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
        if (!this.diceRolled) return;
        container.x = dragX;
        container.y = dragY;
      });
 
      container.on('dragend', () => {
        if (!this.diceRolled) {
          this.returnDieToHand(container, instanceId);
          return;
        }
        container.setScale(1);
        container.setDepth(0);
        this.highlightValidDropZones(false);
        this.tryPlaceDie(container, instanceId);
      });
    }
 
    return container;
  }
 
  private invisiRollForEnemies() {
    const enemyDice = this.gameState.dice.filter(die => die.ownerId === 'enemy' && die.zone === 'board');
    enemyDice.forEach(die => {
      const rolled = Math.floor(Math.random() * 6) + 1;
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
 
  private highlightValidDropZones(highlight: boolean) {
    this.gridDropZones.forEach((zone) => {
      zone.setFillStyle(highlight ? 0x2ecc71 : 0x00ff00, highlight ? 0.3 : 0);
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
	  
    this.combatLog.setText(`Placed ${existingDieInHand.typeId} at [${gridPos.row}, ${gridPos.col}] (${this.placedDiceCount}/${Math.min(25, this.currentHandOrder.length)})`);
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
      this.combatLog.setText('All dice placed! Click START COMBAT');
    } else {
      this.startCombatButton.disableInteractive();
      this.combatLog.setText(requiredDice > 0 ? `Place ${requiredDice - this.placedDiceCount} more dice...` : 'No dice available to place.');
    }
  }
 
  private createCombatUI() {
    const { width, height } = this.scale;
    const centerX = width / 2;
    const buttonY = height - 46;
 
    this.combatLog = this.add.text(centerX, height - 200, 'Place your dice, then start combat!', {
      fontFamily: 'Orbitron',
      fontSize: '14px',
      color: PALETTE.textMuted
    }).setOrigin(0.5);
 
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
 
  private async startCombat() {
    const requiredDice = Math.min(25, this.currentHandOrder.length);
    const boardPlaced = getBoardDice(this.gameState, 'player').length;
    if (!this.diceRolled || boardPlaced < requiredDice) {
      this.combatLog.setText(`Place all ${requiredDice} rolled dice before combat.`);
      this.updateCombatButtonState();
      return;
    }
    this.startCombatButton.disableInteractive();
    this.startCombatButton.setFillStyle(0x7f8c8d, 0.5);
    this.rollAllButton.setVisible(false);
    this.rollAllButtonLabel.setVisible(false);
    this.rollHelperText.setVisible(false);
 
    this.gamePhase = { stage: 'combat' };
    this.clearRangeHighlights();
    this.placeEnemyDiceForTurn();
    this.multiplayerClient.syncTurn({
      turn: this.gameState.turn,
      playerName: this.playerDisplayName,
      dice: this.gameState.dice
        .filter((die) => die.zone === 'board' && !die.isDestroyed)
        .map((die) => ({ ownerId: die.ownerId, typeId: die.typeId, gridPosition: die.gridPosition }))
    });
 
    this.enemyDicePips.clear();
    this.attackCapacityByInstance.clear();
    this.transcendenceTransformed.clear();
    this.oddPipTransformed.clear();
    this.chainedByInstance.clear();
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
    this.combatLog.setText('Combat started! Revealing enemy positions...');
    await this.delay(1000);
 
    this.gameState = this.beginCombatPhaseWithRolledPips();
    this.applyAssassinCombatStart();
    this.shieldHpByInstance.clear();
    this.shieldDurationTurnsByInstance.clear();
    this.applyLockChainsAtCombatStart();
    this.applyShieldTauntsAtCombatStart();
    this.applyMagicianManaManipulatorAtCombatStart();
    this.applyWizardSpellcastAtCombatStart();
    await this.applyBatteryManaAtCombatStart();
    this.applyManaPotionAtCombatStart();
    this.applyLavaPoolDamageAtCombatStart();
    this.renderDice();
    this.renderEnemyDice();
    this.renderLavaPools();
 
    if (this.checkWinConditions()) return;
    await this.runCombatLoop();
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
    const additiveDelta = (combatDelta ?? (this.permanentAttackBonusByInstance.get(die.instanceId) ?? 0))
      + (this.attackDeltaByInstance.get(die.instanceId)?.delta ?? 0)
      + (this.extraAttackTurnsByInstance.get(die.instanceId)?.extra ?? 0)
      + (this.brokenGrowthDeltaByInstance.get(die.instanceId) ?? 0)
      + fireSupportBonus
      + Math.max(0, (this.basicAttacksPerAttackByInstance.get(die.instanceId)?.count ?? 1) - 1);
    const multiplier = this.attackMultiplierTurnsByInstance.get(die.instanceId)?.multiplier ?? 1;
    const multiplierDelta = multiplier === 1 ? 0 : Math.floor(Math.max(0, basePips + additiveDelta) * multiplier) - Math.max(0, basePips + additiveDelta);
    const attackCountDelta = additiveDelta + multiplierDelta;
 
    const positiveDelta = [
      combatPositiveDelta ?? (combatDelta === undefined ? Math.max(0, this.permanentAttackBonusByInstance.get(die.instanceId) ?? 0) : Math.max(0, combatDelta)),
      this.extraAttackTurnsByInstance.get(die.instanceId)?.extra ?? 0,
      Math.max(0, this.brokenGrowthDeltaByInstance.get(die.instanceId) ?? 0),
      fireSupportBonus,
      Math.max(0, (this.basicAttacksPerAttackByInstance.get(die.instanceId)?.count ?? 1) - 1),
      Math.max(0, multiplierDelta),
      Math.max(0, this.attackDeltaByInstance.get(die.instanceId)?.delta ?? 0)
    ].reduce((sum, delta) => sum + Math.max(0, delta), 0);
    const negativeDelta = [
      combatNegativeDelta ?? (combatDelta === undefined ? Math.min(0, this.permanentAttackBonusByInstance.get(die.instanceId) ?? 0) : Math.min(0, combatDelta)),
      this.attackDeltaByInstance.get(die.instanceId)?.delta ?? 0,
      Math.min(0, this.brokenGrowthDeltaByInstance.get(die.instanceId) ?? 0),
      Math.min(0, multiplierDelta)
    ].reduce((sum, delta) => sum + Math.min(0, delta), 0);
    const lines: Array<{ text: string; color: string }> = [];
    if (seen.positive && positiveDelta > 0) lines.push({ text: `Attack Count +${positiveDelta}`, color: '#6dff8f' });
    if (seen.negative && negativeDelta < 0) lines.push({ text: `Attack Count ${negativeDelta}`, color: '#ff6b6b' });
    if (lines.length > 0) return lines;
    if (attackCountDelta > 0 && seen.positive) return [{ text: `Attack Count +${attackCountDelta}`, color: '#6dff8f' }];
    if (attackCountDelta < 0 && seen.negative) return [{ text: `Attack Count ${attackCountDelta}`, color: '#ff6b6b' }];
    return [];
  }
 
  private getFireSupportBonus(die: DiceInstanceState): number {
    // Fire Support: dice on backline gain extra attacks
    // Player's backline: column 0 (leftmost)
    // Enemy's backline: column 4 (rightmost)
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
    const permanentAttackCount = this.permanentAttackBonusByInstance.get(instanceId) ?? 0;
    const brokenGrowthDelta = this.brokenGrowthDeltaByInstance.get(instanceId) ?? 0;
    const fireSupportBonus = die ? this.getFireSupportBonus(die) : 0;
    const adjusted = Math.max(0, basePips + timeDelta + debuff + buff + permanentAttackCount + brokenGrowthDelta + fireSupportBonus);
    return Math.max(0, Math.floor(adjusted * skillMult * comboMult));
  }
 
  private getActiveManaSlots(die: DiceInstanceState): Array<{ key: string; title: string; manaNeeded: number }> {
    const def = this.getDefinitionForInstance(die);
    if (!def) return [];
    const meta = getRuntimeSkillMeta(def);
    const classLevel = this.instanceClassLevels.get(die.instanceId) ?? 1;
    const transformSkillIndices = meta.transformSkillIndices?.length ? meta.transformSkillIndices : meta.transformSkillIndex === undefined ? [] : [meta.transformSkillIndex];
    const transformSkillIndex = transformSkillIndices[0];
    const transformSkill = transformSkillIndex === undefined ? undefined : def.skills[transformSkillIndex];
    if (meta.hasDeathInstakill && !this.deathDiceTransformed.has(die.instanceId)) return [];
    if (meta.hasDeathInstakill && this.deathDiceTransformed.has(die.instanceId)) {
      if (transformSkill && (transformSkill.manaNeeded ?? 0) > 0) {
        return [{ key: `transform:${transformSkill.title}:${transformSkillIndex}`, title: transformSkill.title, manaNeeded: Math.max(1, transformSkill.manaNeeded ?? 1) }];
      }
      return [{ key: 'deathInstakill', title: `Reaper's Touch`, manaNeeded: meta.deathInstakillMana ?? 12 }];
    }
    const hiddenTransformSkills = new Set(transformSkillIndices);
    return def.skills
      .flatMap((skill, index) => hiddenTransformSkills.has(index) || (skill.manaNeeded ?? 0) <= 0
        ? []
        : [{ skill, index }])
      .filter(({ skill }) => !(skill.modifiers?.notes ?? []).includes('runtime:unlockAtClass6') || classLevel >= 6)
      .map(({ skill, index }) => ({ key: `${skill.title}:${index}`, title: skill.title, manaNeeded: Math.max(1, skill.manaNeeded ?? 1) }));
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
 
  private resetActiveMana(instanceId: string, key?: string) {
    if (!key) {
      this.manaByInstance.set(instanceId, 0);
      this.activeManaByInstance.delete(instanceId);
      return;
    }
    const slots = new Map(this.activeManaByInstance.get(instanceId) ?? []);
    slots.set(key, 0);
    this.activeManaByInstance.set(instanceId, slots);
    this.manaByInstance.set(instanceId, Math.max(0, ...Array.from(slots.values())));
  }
 
  private addMana(instanceId: string, manaNeeded: number, currentMana: number, gain = 1, key?: string) {
    if (this.manaPausedTurnsByInstance.has(instanceId)) return;
    this.setActiveMana(instanceId, key, currentMana + gain, manaNeeded);
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
      .map((slot) => ({ ...slot, mana: this.getActiveMana(die.instanceId, slot.key) }))
      .find((slot) => slot.title === 'Spell Strike' || slot.title === 'Meteor Strike' || slot.title === 'Meteor');
  }
 
  private shouldCastWizardRoyale(attacker: DiceInstanceState, currentMana: number): boolean {
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition) return false;
    const meta = getRuntimeSkillMeta(definition);
    if (!meta.canSummonWizard || (this.instanceClassLevels.get(attacker.instanceId) ?? 1) < 6) return false;
    if (currentMana < 18) return false;
    const usedCells = this.collectOccupiedCells(attacker.ownerId);
    return Boolean(this.findRandomFootprintPosition(1, usedCells, () => attacker.ownerId === 'enemy' ? this.pickEnemyColumn(5) : Phaser.Math.Between(0, GRID_SIZE - 1)));
  }
 
  private spendBasicAttack(attacker: DiceInstanceState): boolean {
    const chainedAttacks = Math.max(1, this.basicAttacksPerAttackByInstance.get(attacker.instanceId)?.count ?? 1);
    const remaining = attacker.attacksRemaining ?? 0;
    this.gameState = {
      ...this.gameState,
      dice: this.gameState.dice.map((die) => {
        if (die.instanceId !== attacker.instanceId || die.isDestroyed || die.zone !== 'board') return die;
        const attacksRemaining = Math.max(0, die.attacksRemaining - 1);
        return { ...die, attacksRemaining, hasFinishedAttacking: attacksRemaining === 0 };
      })
    };
    return chainedAttacks > 1 && remaining > 0;
  }
 
  private beginCombatPhaseWithRolledPips(): MatchBattleState {
    const playerBoardDice = getBoardDice(this.gameState, 'player');
    const enemyBoardDice = getBoardDice(this.gameState, 'enemy');
    const playerCombatStartAuras = collectCombatStartAuras(playerBoardDice, (die) => this.getDefinitionForInstance(die));
    const enemyCombatStartAuras = collectCombatStartAuras(enemyBoardDice, (die) => this.getDefinitionForInstance(die));
    const combatStartBonusFor = (die: DiceInstanceState) => computeCombatStartBonus(die, playerCombatStartAuras, enemyCombatStartAuras);
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
    const shouldMightyRoar = (die: DiceInstanceState) => {
      const definition = this.getDefinitionForInstance(die);
      if (!definition || !getRuntimeSkillMeta(definition).hasLeonMightyRoar || !die.gridPosition) return false;
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
          const meta = getRuntimeSkillMeta(definition);
          if (meta.hasTranscendence && basePips === 6 && !this.transcendenceTransformed.has(die.instanceId)) {
            this.transcendenceTransformed.add(die.instanceId);
            this.applyOnTransformedSkillEffects(die);
          }
          if (meta.transformOnOddPip && basePips % 2 === 1 && !this.oddPipTransformed.has(die.instanceId)) {
            this.oddPipTransformed.add(die.instanceId);
            this.applyOnTransformedSkillEffects(die);
          }
        }
        const combatStartBonus = combatStartBonusFor(die);
        const pips = basePips + combatStartBonus;
        const allyPipAttackAuras = die.ownerId === 'player' ? playerPipAttackAuras : enemyPipAttackAuras;
        const foePipAttackAuras = die.ownerId === 'player' ? enemyPipAttackAuras : playerPipAttackAuras;
        const pipAuraDelta = sumMatchingDelta(allyPipAttackAuras, die, 'ally') + sumMatchingDelta(foePipAttackAuras, die, 'foe');
        if (pipAuraDelta !== 0) this.animateTimeMark(die, pipAuraDelta > 0 ? 0x8fd5ff : 0xff6b6b);
        const permanentAttackCount = this.permanentAttackBonusByInstance.get(die.instanceId) ?? 0;
        const combatAttackCountDelta = combatStartBonus + pipAuraDelta + permanentAttackCount;
        const combatPositiveDelta = [combatStartBonus, pipAuraDelta, permanentAttackCount].reduce((sum, delta) => sum + Math.max(0, delta), 0);
        const combatNegativeDelta = [combatStartBonus, pipAuraDelta, permanentAttackCount].reduce((sum, delta) => sum + Math.min(0, delta), 0);
        this.combatAttackCountDeltaByInstance.set(die.instanceId, combatAttackCountDelta);
        this.combatAttackCountPositiveDeltaByInstance.set(die.instanceId, combatPositiveDelta);
        this.combatAttackCountNegativeDeltaByInstance.set(die.instanceId, combatNegativeDelta);
        this.recordAttackCountEffect(die.instanceId, combatPositiveDelta);
        this.recordAttackCountEffect(die.instanceId, combatNegativeDelta);
        const withPermanent = this.computeAttackCount(die.instanceId, pips, pipAuraDelta, die);
        const stunned = this.stunnedByInstance.has(die.instanceId);
        const mightyRoar = shouldMightyRoar(die);
 
        return {
          ...die,
          hasFinishedAttacking: stunned || (!mightyRoar && withPermanent <= 0),
          attacksRemaining: stunned ? 0 : Math.max(mightyRoar ? 1 : 0, withPermanent)
        };
      })
    };
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
      const hasCombatStart = (meta.combatStartExtraAttacks ?? 0) > 0;
      const hasPassivePipAura = (meta.pipMatchAllyAttackDelta ?? 0) !== 0 || (meta.pipMatchFoeAttackDelta ?? 0) !== 0;
      if (hasCombatStart || hasPassivePipAura) this.playSkillSfxForDie(die);
      if (definition.typeId === 'Light' && hasCombatStart && die.gridPosition) {
        const grid = this.getGridContainerForDie(die);
        const x = grid.x + die.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
        const y = grid.y + die.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
        AnimationManager.animateLightCombatStart(this, x, y, Math.max(1, meta.combatStartExtraAttacks ?? 1));
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
    this.combatLog.setText(`Combanity: You rolled ${player.label} (${player.multiplier}x), Bot rolled ${enemy.label} (${enemy.multiplier}x).`);
    return {
      ...state,
      dice: state.dice.map((die) => {
        if (die.zone !== 'board' || die.isDestroyed) return die;
        const bonus = die.ownerId === 'player' ? player : enemy;
        this.combanityAttackMultiplierByInstance.set(die.instanceId, { multiplier: bonus.multiplier, turns: 1 });
        this.recordAttackCountEffect(die.instanceId, bonus.multiplier - 1);
        this.damageReductionByInstance.set(die.instanceId, Phaser.Math.Clamp(bonus.reduction, 0, 0.95));
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
    const attackerBonus = this.getRollComboBonus(attacker.ownerId === 'player' ? 'player' : 'enemy');
    const defenderBonus = this.getRollComboBonus(target.ownerId === 'player' ? 'player' : 'enemy');
    return Math.max(0, attackerBonus.multiplier * (1 - defenderBonus.reduction));
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
 
  private applyMagicianManaManipulatorAtCombatStart() {
    const magicians = this.gameState.dice.filter((die) => {
      const meta = this.getDefinitionForInstance(die) ? getRuntimeSkillMeta(this.getDefinitionForInstance(die)!) : undefined;
      return die.zone === 'board' && !die.isDestroyed && meta?.manaSteal !== undefined;
    });
    magicians.forEach((magician) => {
      const meta = getRuntimeSkillMeta(this.getDefinitionForInstance(magician)!);
      const steal = Math.max(1, Math.floor(meta.manaSteal ?? 1));
      const enemyOwner = magician.ownerId === 'player' ? 'enemy' : 'player';
      this.gameState.dice
        .filter((die) => die.ownerId === enemyOwner && die.zone === 'board' && !die.isDestroyed && this.getManaCapForDie(die) > 0)
        .forEach((enemy) => {
          let drainedTotal = 0;
          this.getActiveManaSlots(enemy).forEach((slot) => {
            const current = this.getActiveMana(enemy.instanceId, slot.key);
            const drained = Math.min(current, steal);
            if (drained <= 0) return;
            this.setActiveMana(enemy.instanceId, slot.key, current - drained, slot.manaNeeded);
            drainedTotal += drained;
          });
          if (drainedTotal <= 0) return;
          this.addManaToAllActiveSlots(magician, drainedTotal);
        });
      this.playSkillSfxForDie(magician, meta);
    });
  }
 
  private applyWizardSpellcastAtCombatStart() {
    const wizards = this.gameState.dice.filter((die) => {
      const definition = this.getDefinitionForInstance(die);
      return die.zone === 'board' && !die.isDestroyed && definition && getRuntimeSkillMeta(definition).spellcastManaGain !== undefined;
    });
    wizards.forEach((wizard) => {
      const meta = getRuntimeSkillMeta(this.getDefinitionForInstance(wizard)!);
      const magician = this.gameState.dice.find((die) => die.ownerId === wizard.ownerId && die.typeId === 'Magician' && !die.isDestroyed);
      if (!magician) return;
      if (this.getManaCapForDie(magician) <= 0) return;
      this.addManaToAllActiveSlots(magician, Math.max(1, Math.floor(meta.spellcastManaGain ?? 2)));
      this.playSkillSfxForDie(wizard, meta);
    });
  }
 
  private async applyBatteryManaAtCombatStart() {
    const boardDice = this.gameState.dice.filter((d) => d.zone === 'board' && !d.isDestroyed);
    const batteries = boardDice.filter((d) => {
      const def = this.getDefinitionForInstance(d);
      const notes = def?.skills[0]?.modifiers?.notes ?? [];
      return notes.includes('runtime:batteryManaAura');
    });
    let playedChargeVisual = false;
    batteries.forEach((battery) => {
      const def = this.getDefinitionForInstance(battery);
      const gain = def?.skills[0]?.modifiers?.manaGain ?? 0;
      if (gain <= 0) return;
      boardDice.filter((ally) => ally.ownerId === battery.ownerId).forEach((ally) => {
        const allyDef = this.getDefinitionForInstance(ally);
        if (ally.gridPosition) {
          const grid = this.getGridContainerForDie(ally);
          const x = grid.x + ally.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
          const y = grid.y + ally.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
          AnimationManager.animateBatteryCharge(this, x, y, ally.instanceId === battery.instanceId ? 0x95c2ff : 0x3f5573);
          playedChargeVisual = true;
        }
        if (!allyDef) return;
        if (this.getManaCapForDie(ally) <= 0) return;
        this.addManaToAllActiveSlots(ally, gain);
      });
    });
    if (playedChargeVisual) await this.delay(500);
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
 
    const rarity = getDiceCardRarityRoll(() => Math.random());
    const playerCards = rollDiceCards(3, rarity, 'player', this.gameState.dice, this.definitions, this.activeDiceCardKeys, () => Math.random());
    if (playerCards.length === 0) return;
    const picked = await this.showDiceCardPicker(playerCards);
    this.applyDiceCard(picked, 'player');
 
    const enemyCards = rollDiceCards(3, rarity, 'enemy', this.gameState.dice, this.definitions, this.activeDiceCardKeys, () => Math.random());
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
    this.renderDiceCardInfoPanel();
  }
 
  private applyShieldTauntsAtCombatStart() {
    this.tauntedByInstance.clear();
    const boardDice = this.gameState.dice.filter((d) => d.zone === 'board' && !d.isDestroyed && d.gridPosition);
    const shields = boardDice.filter((d) => {
      const def = this.getDefinitionForInstance(d);
      return def ? (getRuntimeSkillMeta(def).tauntRange ?? 0) > 0 : false;
    });
    shields.forEach((shield) => {
      const def = this.getDefinitionForInstance(shield);
      if (!def) return;
      const meta = getRuntimeSkillMeta(def);
      const range = meta.tauntRange ?? 0;
      const turns = meta.tauntDuration ?? 1;
      if (range <= 0) return;
      boardDice.filter((foe) => foe.ownerId !== shield.ownerId).forEach((foe) => {
        const dist = this.getDistanceWithBoardSides(shield, foe);
        if (dist <= range) this.tauntedByInstance.set(foe.instanceId, { sourceId: shield.instanceId, turns });
      });
    });
  }
 
  private applyLockChainsAtCombatStart() {
    this.chainedByInstance.clear();
    const boardDice = this.gameState.dice.filter((d) => d.zone === 'board' && !d.isDestroyed && d.gridPosition);
    const locks = boardDice.filter((die) => {
      const def = this.getDefinitionForInstance(die);
      return def ? (getRuntimeSkillMeta(def).lockRange ?? 0) > 0 : false;
    });
    locks.forEach((lock) => {
      const def = this.getDefinitionForInstance(lock);
      if (!def) return;
      const range = getRuntimeSkillMeta(def).lockRange ?? 0;
      const target = boardDice
        .filter((foe) => foe.ownerId !== lock.ownerId && !this.chainedByInstance.has(foe.instanceId))
        .map((foe) => ({ die: foe, distance: this.getDistanceWithBoardSides(lock, foe) }))
        .filter(({ distance }) => distance <= range)
        .sort((a, b) => a.distance - b.distance || a.die.currentHealth - b.die.currentHealth)[0]?.die;
      if (!target) return;
      this.chainedByInstance.set(target.instanceId, lock.instanceId);
      this.attackCapacityByInstance.set(target.instanceId, 0);
      this.showDamageText(target, 0, '#9ed0ff', 'LOCK');
    });
    if (this.chainedByInstance.size > 0) {
      this.gameState = {
        ...this.gameState,
        dice: this.gameState.dice.map((die) => this.chainedByInstance.has(die.instanceId)
          ? { ...die, attacksRemaining: 0, hasFinishedAttacking: true }
          : die)
      };
    }
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
    // Crowd Attack affects dice with 1 or 2 effective pips
    if (effectivePip === 1 || effectivePip === 2) {
      return this.crowdAttackByOwner[die.ownerId].damage;
    }
    return 0;
  }
 
  private getOffenseMultiplier(attacker: DiceInstanceState): number {
    const typeBoost = this.getTypeUpgradeMultiplier(attacker);
    return typeBoost * (1 + this.getSpotlightScale(attacker) + this.getInvestmentDamageBonus(attacker) + this.getCrowdAttackDamageBonus(attacker));
  }
 
  private getDiceCardSkillDamageMultiplier(attacker: DiceInstanceState): number {
    return this.getOffenseMultiplier(attacker);
  }
 
  private getBasicAttackDamageBonus(attacker: DiceInstanceState): number {
    return Math.max(0, this.basicAttackDamageBonusByInstance.get(attacker.instanceId) ?? 0);
  }
 
  private getGiantHunterBonus(ownerId: 'player' | 'enemy', target: DiceInstanceState): number {
    const rate = this.giantHunterRateByOwner[ownerId];
    if (rate <= 0) return 0;
    const bonus = Math.max(0, Math.floor(target.maxHealth * rate));
    return this.isBossDie(target) ? Math.floor(bonus * 0.5) : bonus;
  }
 
  private getActiveBuffSummaryForDie(die: DiceInstanceState): string[] {
    const owner = die.ownerId;
    const pct = (rate: number) => `${Math.round(rate * 100)}%`;
    const buffs: string[] = [];
    const typeBonus = this.diceTypeUpgradeBonus.get(`${owner}:${die.typeId}`) ?? 0;
    if (typeBonus > 0) buffs.push(`${die.typeId} Upgrade +${pct(typeBonus)} dmg/HP`);
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
    }
    if (this.fountainHealRateByOwner[owner] > 0) buffs.push(`Fountain of Love ${pct(this.fountainHealRateByOwner[owner])} heal`);
    if (this.manaPotionGainByOwner[owner] > 0) buffs.push(`Mana Potion +${this.manaPotionGainByOwner[owner]} mana`);
    if (this.giantHunterRateByOwner[owner] > 0) buffs.push(`Giant Hunter ${pct(this.giantHunterRateByOwner[owner])} max HP`);
    if (this.configRandomMode && this.activeRandomModifier === 'Combanity') {
      const combo = this.getRollComboBonus(owner);
      const drNote = combo.reduction > 0 ? ` / ${pct(combo.reduction)} DR` : '';
      buffs.push(`Combanity: ${combo.label} (${combo.multiplier}x dmg${drNote})`);
    }
    return buffs;
  }
 
  private applyAssassinCombatStart() {
    const assassins = this.gameState.dice.filter((d) => {
      if (d.zone !== 'board' || d.isDestroyed || !d.gridPosition) return false;
      const def = this.getDefinitionForInstance(d);
      return def?.skills.some((sk) => (sk.modifiers?.notes ?? []).includes('runtime:assassinBacklineTeleport')) ?? false;
    });
    assassins.forEach((assassin) => {
      const boardDice = this.gameState.dice.filter((d) => d.zone === 'board' && !d.isDestroyed && d.gridPosition);
      const foes = boardDice.filter((d) => d.ownerId !== assassin.ownerId && d.gridPosition);
      if (foes.length === 0 || !assassin.gridPosition) return;
      const furthest = [...foes].sort((a, b) => this.getDistanceWithBoardSides(assassin, b) - this.getDistanceWithBoardSides(assassin, a))[0];
      const skill = this.getDefinitionForInstance(assassin)?.skills.find((sk) => (sk.modifiers?.notes ?? []).includes('runtime:assassinBacklineTeleport'));
      const attackerDefinition = this.getDefinitionForInstance(assassin);
      const jumpRange = skill?.modifiers?.jumpRange ?? attackerDefinition?.range ?? 2;
      const targetOwner = assassin.ownerId === 'player' ? 'enemy' : 'player';
      const occupied = new Set(
        this.gameState.dice
          .filter((d) => d.zone === 'board' && !d.isDestroyed && d.instanceId !== assassin.instanceId && d.gridPosition)
          .filter((d) => this.getBoardSideForDie(d) === targetOwner)
          .map((d) => `${d.gridPosition!.row},${d.gridPosition!.col}`)
      );
 
      const neighbors = [
        { row: furthest.gridPosition!.row - 1, col: furthest.gridPosition!.col },
        { row: furthest.gridPosition!.row + 1, col: furthest.gridPosition!.col },
        { row: furthest.gridPosition!.row, col: furthest.gridPosition!.col - 1 },
        { row: furthest.gridPosition!.row, col: furthest.gridPosition!.col + 1 }
      ].filter((tile) => tile.row >= 0 && tile.row < GRID_SIZE && tile.col >= 0 && tile.col < GRID_SIZE && !occupied.has(`${tile.row},${tile.col}`));
 
      let chosen: { row: number; col: number } | null = null;
      let bestJumpDistance = Number.POSITIVE_INFINITY;
      neighbors.forEach((tile) => {
        const proxy: DiceInstanceState = { ...assassin, gridPosition: tile };
        const jumpDistance = this.getDistanceWithBoardSides(assassin, proxy);
        if (jumpRange >= 0 && jumpDistance > jumpRange) return;
        const isBetter = jumpDistance < bestJumpDistance
          || (jumpDistance === bestJumpDistance && Math.abs(tile.col - furthest.gridPosition!.col) < Math.abs((chosen?.col ?? tile.col) - furthest.gridPosition!.col));
        if (isBetter) {
          bestJumpDistance = jumpDistance;
          chosen = tile;
        }
      });
 
      if (!chosen) return;
      this.gameState = {
        ...this.gameState,
        dice: this.gameState.dice.map((d) => d.instanceId === assassin.instanceId
          ? { ...d, gridPosition: chosen! }
          : d)
      };
      this.infiltratedBoardSideByInstance.set(assassin.instanceId, targetOwner);
      const passive = this.getDefinitionForInstance(assassin)?.skills.find((sk)=>sk.type==='Passive');
      const passiveMods = passive?.modifiers as { numAttacksBoosted?: number } | undefined;
      const boostedAttacks = Math.max(0, passiveMods?.numAttacksBoosted ?? 0);
      this.assassinBoostAttacksByInstance.set(assassin.instanceId, boostedAttacks);
      if (boostedAttacks > 0) {
        this.combatLog.setText(`${assassin.ownerId === 'player' ? 'Your' : 'Enemy'} Assassin teleports and gains ${boostedAttacks} boosted attack(s)!`);
      } else {
        this.combatLog.setText(`${assassin.ownerId === 'player' ? 'Your' : 'Enemy'} Assassin teleports to the backline!`);
      }
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
    return candidates[Math.floor(Math.random() * candidates.length)].die;
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
    const effectiveRange = this.getEffectiveAttackRange(attacker, attackerDef);
    const attackerBoardSide = this.getBoardSideForDie(attacker);
    const candidates = this.gameState.dice
      .filter((die): die is DiceInstanceState & { gridPosition: { row: number; col: number } } =>
        die.ownerId === targetOwner
        && die.zone === 'board'
        && !die.isDestroyed
        && Boolean(die.gridPosition)
        && (onlyTargetsAllies || !this.isBlockedByAllyChain(attacker, die))
        && (!onlyTargetsAllies || this.getBoardSideForDie(die) === attackerBoardSide))
      .map((die) => ({ die, distance: this.getAttackDistance(attacker, die) }))
      .filter(({ distance }) => distance <= Math.max(1, effectiveRange));
    return this.selectTargetCandidate(candidates, mode);
  }
 
  private findActiveHealTargetForArena(attacker: DiceInstanceState, mode: DiceTargetingMode): DiceInstanceState | undefined {
    const attackerDef = this.getDefinitionForInstance(attacker);
    if (!attackerDef || !attacker.gridPosition) return undefined;
    const effectiveRange = this.getEffectiveAttackRange(attacker, attackerDef);
    const attackerBoardSide = this.getBoardSideForDie(attacker);
    const candidates = this.gameState.dice
      .filter((die): die is DiceInstanceState & { gridPosition: { row: number; col: number } } =>
        die.ownerId === attacker.ownerId
        && die.zone === 'board'
        && !die.isDestroyed
        && Boolean(die.gridPosition)
        && this.getBoardSideForDie(die) === attackerBoardSide)
      .map((die) => ({ die, distance: this.getAttackDistance(attacker, die) }))
      .filter(({ distance }) => distance <= Math.max(1, effectiveRange));
    const injuredAllies = candidates.filter(({ die }) => die.instanceId !== attacker.instanceId && die.currentHealth < die.maxHealth);
    return this.selectTargetCandidate(injuredAllies, mode)
      ?? candidates.find(({ die }) => die.instanceId === attacker.instanceId && die.currentHealth < die.maxHealth)?.die
      ?? candidates.find(({ die }) => die.instanceId === attacker.instanceId)?.die;
  }
 
  private findAttackTargetForArena(attacker: DiceInstanceState): DiceInstanceState | undefined {
    const attackerDef = this.getDefinitionForInstance(attacker);
    if (!attackerDef || !attacker.gridPosition) return undefined;
    const mode = getRuntimeSkillMeta(attackerDef).targetingMode ?? 'Nearest';
    return this.findSkillTargetForArena(attacker, mode, false);
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
 
  private moveLeonBesideTarget(leon: DiceInstanceState, target: DiceInstanceState) {
    if (!target.gridPosition) return;
    const usedCells = this.collectOccupiedCells(leon.ownerId, leon.instanceId);
    const footprint = this.getFootprintForDie(leon);
    const candidates: { row: number; col: number; distance: number }[] = [];
    for (let row = 0; row <= GRID_SIZE - footprint; row++) {
      for (let col = 0; col <= GRID_SIZE - footprint; col++) {
        if (!this.canPlaceFootprint(row, col, footprint, usedCells)) continue;
        const proxy: DiceInstanceState = { ...leon, gridPosition: { row, col } };
        candidates.push({ row, col, distance: this.getDistanceWithBoardSides(proxy, target) });
      }
    }
    const best = candidates.sort((a, b) => a.distance - b.distance || a.row - b.row || a.col - b.col)[0];
    if (!best) return;
    this.gameState = placeDieOnBoard(this.gameState, leon.instanceId, best.row, best.col);
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
 
  private applyLavaPoolDamageAtCombatStart() {
    if (this.lavaPoolsByTile.size === 0) return;
    const allBoardDice = this.gameState.dice.filter(d => d.zone === 'board' && !d.isDestroyed && d.gridPosition);
    allBoardDice.forEach(die => {
      const boardSide = this.getBoardSideForDie(die);
      const tileKey = `${boardSide}:${die.gridPosition!.row},${die.gridPosition!.col}`;
      const pool = this.lavaPoolsByTile.get(tileKey);
      if (pool) {
        if (pool.sourceOwnerId && die.ownerId === pool.sourceOwnerId) return;
        const sourceProxy: DiceInstanceState = { ...die, ownerId: pool.sourceOwnerId ?? die.ownerId, typeId: pool.sourceTypeId ?? die.typeId };
        const lavaMultiplier = this.getCombanityDamageMultiplier(sourceProxy, die) * this.getDiceCardSkillDamageMultiplier(sourceProxy);
        const finalDamage = Math.max(1, Math.floor(pool.damage * lavaMultiplier));
        const lavaHit = this.applyDamageWithRevive(die.instanceId, finalDamage);
        this.gameState = lavaHit.state;
        this.showDamageText(die, lavaHit.dealt, '#ff9f58');
        this.handleDefeatedDie(die, lavaHit.defeated);
        this.combatLog.setText(`${die.typeId} takes ${finalDamage} lava damage from the pool!`);
      }
    });
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
          return this.hasAssassinOpeningRuntime(this.getDefinitionForInstance(die));
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
        const adjustedDamage = Math.max(1, Math.floor((scaledNonProportional + basicDamageBonus + ironBonus + solitudeBonus + giantHunter) * offenseMult * assassinBoost));
        this.gameState = spendAttack(this.gameState, assassin.instanceId);
        const hit = this.applyDamageWithRevive(target.instanceId, adjustedDamage);
        this.gameState = hit.state;
        this.showDamageText(target, hit.dealt, this.armorShredByInstance.has(target.instanceId) ? '#ff4fd8' : '#ffdf7a');
        this.applyPassiveSkillEffects(assassin, target);
        this.handleDefeatedDie(target, hit.defeated);
        const rem = this.assassinBoostAttacksByInstance.get(assassin.instanceId) ?? 0;
        if (rem > 0) this.assassinBoostAttacksByInstance.set(assassin.instanceId, rem - 1);
        this.combatLog.setText(`${openingOwner === 'player' ? 'Your' : 'Enemy'} Assassin strikes first for ${hit.dealt}!`);
        this.renderDice();
        this.renderEnemyDice();
        if (!(await this.delayCombatPaced(350))) return;
        if (this.checkWinConditions()) return;
      }
    }
 
    let timedOut = false;
    for (const owner of owners) {
      const ownerName = owner === 'player' ? 'Your' : 'Enemy';
 
      while (true) {
        if (this.combatTimeRemainingMs <= 0) {
          timedOut = true;
          break;
        }
 
        const attacker = getNextAttacker(this.gameState, owner);
        if (!attacker) break;
 
        const attackerDef = this.getDefinitionForInstance(attacker);
        const attackerMeta = attackerDef ? getRuntimeSkillMeta(attackerDef) : undefined;
        const activeSlots = this.getActiveManaSlots(attacker)
          .map((slot) => ({ ...slot, mana: this.getActiveMana(attacker.instanceId, slot.key) }));
        const wizardSlot = activeSlots.find((slot) => slot.title === 'Wizard Royale');
        const meteorSlot = activeSlots.find((slot) => slot.title === 'Spell Strike' || slot.title === 'Meteor Strike' || slot.title === 'Meteor');
        const deathSlot = activeSlots.find((slot) => slot.title === `Reaper's Touch`);
        const primarySlot = activeSlots.find((slot) => slot.mana >= slot.manaNeeded);
        const wizardFires = Boolean(wizardSlot && this.shouldCastWizardRoyale(attacker, wizardSlot.mana));
        const meteorFires = Boolean(attackerMeta?.hasMeteorStrike && !wizardFires && meteorSlot && meteorSlot.mana >= meteorSlot.manaNeeded);
        const deathFires = Boolean(attackerMeta?.hasDeathInstakill && this.deathDiceTransformed.has(attacker.instanceId) && deathSlot && deathSlot.mana >= deathSlot.manaNeeded);
        const regularActiveFires = Boolean(primarySlot && !attackerMeta?.hasMeteorStrike && !attackerMeta?.hasDeathInstakill && !wizardFires);
        const anyActiveFires = wizardFires || meteorFires || deathFires || regularActiveFires;
        const activeSlot = wizardFires ? wizardSlot : meteorFires ? meteorSlot : deathFires ? deathSlot : regularActiveFires ? primarySlot : undefined;
        const skipBasicAttack = anyActiveFires;
        const forcedTarget = this.resolveTauntForcedTarget(attacker);
        const beamLine = this.findTranscendenceBeamTarget(attacker, forcedTarget);
        const beamTarget = beamLine?.target;
        let target = forcedTarget ?? beamTarget ?? this.findAttackTargetForArena(attacker);
        const activeTarget = activeSlot && attackerMeta?.activeOnlyTargetsAllies
          ? (attackerMeta.activeHeal !== undefined
            ? this.findActiveHealTargetForArena(attacker, attackerMeta.activeSkillTargeting ?? attackerMeta.targetingMode ?? 'Nearest')
            : this.findSkillTargetForArena(attacker, attackerMeta.activeSkillTargeting ?? attackerMeta.targetingMode ?? 'Nearest', true))
          : undefined;
        if (activeTarget) target = activeTarget;
        if (!target) {
          if (attackerMeta?.hasLeonMightyRoar) {
            const roarTarget = this.findNearestFoeIgnoringRange(attacker);
            if (roarTarget) {
              this.moveLeonBesideTarget(attacker, roarTarget);
              const movedLeon = this.gameState.dice.find((die) => die.instanceId === attacker.instanceId) ?? attacker;
              await this.executeLeonFuriousClaw(movedLeon, roarTarget);
              this.stunnedByInstance.set(roarTarget.instanceId, this.getSkillDurationTurns(attackerMeta.stunDuration) ?? 1);
              this.gameState = spendAttack(this.gameState, attacker.instanceId);
              this.combatLog.setText(`${ownerName} ${attacker.typeId} uses Mighty Roar and stuns ${roarTarget.typeId}!`);
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
          this.gameState = {
            ...this.gameState,
            dice: this.gameState.dice.map((die) => die.instanceId === attacker.instanceId ? { ...die, attacksRemaining: 0, hasFinishedAttacking: true } : die)
          };
          this.combatLog.setText(`${ownerName} ${attacker.typeId} is out of range and skips!`);
          if (!(await this.delayCombatPaced(500))) {
            timedOut = true;
            break;
          }
          continue;
        }
 
        if (!anyActiveFires) {
          this.addManaToAllActiveSlots(attacker);
        }
 
        let damage = 0;
        let targetDefeated = false;
        let basicAttackVisualCount = 1;
 
        if (!skipBasicAttack) {
          if (beamLine && (!forcedTarget || forcedTarget.instanceId === beamLine.target.instanceId)) {
            this.playAttackSfx(attacker, attackerMeta);
            const result = this.executeTranscendenceBeam(attacker, target, beamLine.pattern);
            damage = result.damage;
            targetDefeated = result.targetDestroyed;
          } else {
            this.playAttackSfx(attacker, attackerMeta);
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
            const adjustedDamage = Math.max(1, Math.floor((scaledNonProportional + basicDamageBonus + ironBonus + solitudeBonus + giantHunter) * offenseMult * assassinBoost * deuciferEvenMult * lowHpExploitMult));
            if (adjustedDamage > 200) AchievementStore.unlock(this, 'lotta_damage');
            const followUpBasicAttack = this.spendBasicAttack(attacker);
            const hit = this.applyDamageWithRevive(target.instanceId, adjustedDamage);
            this.gameState = hit.state;
            damage = hit.dealt;
            targetDefeated = hit.defeated;
            this.showDamageText(target, damage, this.armorShredByInstance.has(target.instanceId) ? '#ff4fd8' : '#ffdf7a');
            if (pips % 2 === 1 && (attackerMeta?.deuciferOddSiphonRate ?? 0) > 0) this.healDie(attacker.instanceId, Math.floor(damage * (attackerMeta?.deuciferOddSiphonRate ?? 0)));
            this.applySolarFormEffects(attacker, target, adjustedDamage, pips);
            this.applyPassiveSkillEffects(attacker, target);
            if (targetDefeated) {
              await this.applyOnKillSkillEffects(attacker, target);
              this.applyOnDeathSkillEffects(target, attacker);
              this.handleDefeatedDie(target, true);
            }
            const rem = this.assassinBoostAttacksByInstance.get(attacker.instanceId) ?? 0;
            if (rem > 0) this.assassinBoostAttacksByInstance.set(attacker.instanceId, rem - 1);
            if (followUpBasicAttack && !targetDefeated) {
              const followUp = this.applyDamageWithRevive(target.instanceId, adjustedDamage);
              this.gameState = followUp.state;
              damage += followUp.dealt;
              if (damage > 200) AchievementStore.unlock(this, 'lotta_damage');
              targetDefeated = followUp.defeated;
              this.showDamageText(target, followUp.dealt, this.armorShredByInstance.has(target.instanceId) ? '#ff4fd8' : '#ffdf7a');
              this.applySolarFormEffects(attacker, target, adjustedDamage, pips);
              this.applyPassiveSkillEffects(attacker, target);
              if (targetDefeated) {
                await this.applyOnKillSkillEffects(attacker, target);
                this.applyOnDeathSkillEffects(target, attacker);
                this.handleDefeatedDie(target, true);
              }
              basicAttackVisualCount = Math.max(basicAttackVisualCount, 2);
              const nextRem = this.assassinBoostAttacksByInstance.get(attacker.instanceId) ?? 0;
              if (nextRem > 0) this.assassinBoostAttacksByInstance.set(attacker.instanceId, nextRem - 1);
            }
          }
        } else if (attackerMeta?.consumeAttack !== false) {
          this.gameState = spendAttack(this.gameState, attacker.instanceId);
        }
 
        if (anyActiveFires) {
          const sfxKey = attackerMeta?.activeSkillSfxKey ?? attackerMeta?.skillSfxKey ?? AUDIO_KEYS.skillTrigger;
          AudioManager.playSfx(this, sfxKey);
        }
        if (activeSlot) await this.applyActiveSkillEffects(attacker, target, activeSlot);
        if (this.combatTimeRemainingMs <= 0) {
          timedOut = true;
          break;
        }
        if (targetDefeated && (beamTarget || skipBasicAttack)) {
          await this.applyOnKillSkillEffects(attacker, target);
          this.applyOnDeathSkillEffects(target, attacker);
          this.handleDefeatedDie(target, true);
        }
 
        this.combatLog.setText(
          skipBasicAttack
            ? `${ownerName} ${attacker.typeId} uses active skill!`
            : `${ownerName} ${attacker.typeId} attacks ${target.typeId} for ${damage} damage!${targetDefeated ? ' DESTROYED!' : ''}`
        );
 
        if (!beamTarget && !skipBasicAttack) this.animateBasicAttackSequence(attacker, target, basicAttackVisualCount);
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
      if (timedOut) break;
    }
    if (timedOut) {
      this.forceCombatResolutionState();
      this.combatLog.setText('⏱️ Time is up! Advancing to next turn...');
    } else {
      this.combatLog.setText('Combat phase complete!');
    }
    this.clearRangeHighlights();
    this.enemyLoadoutRevealed = true;
    await this.delay(1000);
 
    this.applyCombatEndSkills();
    this.applyFountainOfLoveCombatEndHealing();
    this.applyTimedSkillDecay();
    this.gameState = resolveCombatPhase(this.gameState);
    this.tauntedByInstance.clear();
    this.combatAttackCountDeltaByInstance.clear();
    this.applyTurnBasedEffects();
    this.renderDice();
    this.renderEnemyDice();
    this.renderLavaPools();
 
    if (this.checkWinConditions()) {
      return;
    }
 
    if (this.turnLimit !== -1 && this.gameState.turn >= this.turnLimit) {
      this.resolveTurnLimitResult();
      return;
    }
 
    this.gameState = endTurn(this.gameState);
    if (this.deuciferBossPending) this.summonDeuciferBoss();
    await this.maybeRunDiceCardDraft();
    if (this.configRandomMode && this.activeRandomModifier === 'Necromancy' && this.gameState.turn > 1) {
      this.applyNecromancyTurnEffect();
    }
    this.turnText.setText(this.turnLimit === -1 ? `TURN ${this.gameState.turn}` : `TURN ${this.gameState.turn}/${this.turnLimit}`);
    this.playTurnBanner(this.turnLimit === -1 ? `TURN ${this.gameState.turn}` : `TURN ${this.gameState.turn}/${this.turnLimit}`);
    AudioManager.playSfx(this, AUDIO_KEYS.uiRound);
    this.combatLog.setText(`Turn ${this.gameState.turn} - Roll and place your dice!`);
 
    await this.returnDiceToHand();
    this.refreshHandAfterPoisonEffects();
    this.renderDice();
    this.renderEnemyDice();
    this.renderLavaPools();
    this.updateCombatButtonState();
  }
 
  private playAttackSfx(attacker: DiceInstanceState, meta?: ReturnType<typeof getRuntimeSkillMeta>) {
    const transformed = this.transcendenceTransformed.has(attacker.instanceId) || this.deathDiceTransformed.has(attacker.instanceId);
    const transformedKey = meta?.transformedAttackSfxKey;
    const baseKey = meta?.attackSfxKey;
    if (transformed && transformedKey) {
      AudioManager.playSfx(this, transformedKey);
      return;
    }
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
    this.combatLog.setText('Necromancy: a die has been revived or conjured for both sides.');
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
      this.endGame('defeat', this.deuciferBossSummoned
        ? 'Turn limit reached! Deucifer and his minions still stand.'
        : "Turn limit reached! Deucifer's dice still stand.");
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
 
  private getStatusEffects(die: DiceInstanceState): Array<'slow' | 'poison' | 'berserk' | 'taunt' | 'fracture' | 'stun'> {
    const effects: Array<'slow' | 'poison' | 'berserk' | 'taunt' | 'fracture' | 'stun'> = [];
    if ((this.attackDeltaByInstance.get(die.instanceId)?.delta ?? 0) < 0) effects.push('slow');
    if (this.poisonByInstance.has(die.instanceId)) effects.push('poison');
    if (this.isBerserkActive(die)) effects.push('berserk');
    if (this.tauntedByInstance.has(die.instanceId)) effects.push('taunt');
    if (this.armorShredByInstance.has(die.instanceId)) effects.push('fracture');
    if (this.stunnedByInstance.has(die.instanceId)) effects.push('stun');
    return effects;
  }
 
  private getStatusEffectSummaryForDie(die: DiceInstanceState): string[] {
    const statusLines: string[] = [];
    const attackDelta = this.attackDeltaByInstance.get(die.instanceId);
    if (attackDelta && attackDelta.delta < 0) statusLines.push(`Slow ${attackDelta.delta} attacks (${attackDelta.turns} turns)`);
    const poison = this.poisonByInstance.get(die.instanceId);
    if (poison) {
      const stackText = poison.stacks && poison.stacks > 1 ? ` x${poison.stacks}` : '';
      statusLines.push(`Poison${stackText}: ${poison.damage}/turn (${poison.turns} turns)`);
    }
    const fracture = this.armorShredByInstance.get(die.instanceId);
    if (fracture) statusLines.push(`Fracture +${Math.round(fracture.rate * 100)}% damage taken (${fracture.turns} turns)`);
    const taunt = this.tauntedByInstance.get(die.instanceId);
    if (taunt) statusLines.push('Taunt');
    if (this.chainedByInstance.has(die.instanceId)) statusLines.push('Locked');
    const stunTurns = this.stunnedByInstance.get(die.instanceId);
    if (stunTurns) statusLines.push(`Stun (${stunTurns} turns)`);
    if (this.isBerserkActive(die)) statusLines.push('Berserk active');
    return statusLines;
  }
 
  private getPlayerHandDie(instanceId: string): DiceInstanceState | undefined {
    return this.gameState.dice.find((die) => die.ownerId === 'player' && die.instanceId === instanceId && die.zone === 'hand' && !die.isDestroyed);
  }
 
  private applyDamageWithRevive(instanceId: string, damage: number, options: { ignoreDamageReduction?: boolean; ignoreShield?: boolean } = {}): { state: MatchBattleState; dealt: number; defeated: boolean } {
    let reduction = options.ignoreDamageReduction ? 0 : (this.damageReductionByInstance.get(instanceId) ?? 0);
    const die = this.gameState.dice.find((d) => d.instanceId === instanceId);
    if (!options.ignoreDamageReduction && die) reduction += this.getSpotlightScale(die);
    if (!options.ignoreDamageReduction && die) reduction += this.getEffectivePipForInvestment(die) % 2 === 0 ? this.evenInvestmentByOwner[die.ownerId].reduction : this.oddInvestmentByOwner[die.ownerId].reduction;
    // Crowd Attack reduction for 1-2 pip dice
    if (!options.ignoreDamageReduction && die) {
      const effectivePip = this.getEffectivePipForInvestment(die);
      if (effectivePip === 1 || effectivePip === 2) {
        reduction += this.crowdAttackByOwner[die.ownerId].reduction;
      }
    }
    reduction = Phaser.Math.Clamp(reduction, 0, 0.95);
    if (reduction > 0) damage = Math.max(0, Math.floor(damage * (1 - reduction)));
    const armorShred = this.armorShredByInstance.get(instanceId);
    if (armorShred && armorShred.rate > 0) damage = Math.max(1, Math.floor(damage * (1 + armorShred.rate)));
    const shieldHp = options.ignoreShield ? 0 : (this.shieldHpByInstance.get(instanceId) ?? 0);
    if (shieldHp > 0) {
      const absorbed = Math.min(shieldHp, Math.max(0, damage));
      const remaining = Math.max(0, damage - absorbed);
      const nextShield = shieldHp - absorbed;
      if (nextShield > 0) this.shieldHpByInstance.set(instanceId, nextShield);
      else this.shieldHpByInstance.delete(instanceId);
      if (remaining <= 0) return { state: this.gameState, dealt: 0, defeated: false };
      damage = remaining;
    }
    const before = this.gameState.dice.find((die) => die.instanceId === instanceId);
    const beforePosition = before?.gridPosition;
    const nextState = applyDamage(this.gameState, instanceId, damage);
    const after = nextState.dice.find((die) => die.instanceId === instanceId);
    let resolvedState = nextState;
    if (before && after) {
      const definition = this.getDefinitionForInstance(before);
      const classLevel = this.instanceClassLevels.get(instanceId) ?? 1;
      if (definition) {
        const onDamagedResult = executeOnDamagedSkillEffects(before, definition, classLevel, before, damage, after.isDestroyed);
        if (!after.isDestroyed && onDamagedResult.bonusAttacks && onDamagedResult.bonusAttacks > 0) {
          const recipient = onDamagedResult.grantAttacksToAlly
            ? getBoardDice(resolvedState, before.ownerId).find((die) => die.instanceId !== instanceId)
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
        if (onDamagedResult.extraEffects?.length) {
          this.combatLog.setText(onDamagedResult.extraEffects.join('; '));
        }
      }
    }
    if (!before || !after?.isDestroyed) return { state: resolvedState, dealt: Math.max(0, (before?.currentHealth ?? 0) - (after?.currentHealth ?? 0)), defeated: false };
    AudioManager.playSfx(this, AUDIO_KEYS.diceDie);
    const reviveChance = before ? getRuntimeSkillMeta(this.getDefinitionForInstance(before)!).reviveChance : undefined;
    if (!reviveChance || Math.random() >= reviveChance) return { state: resolvedState, dealt: Math.max(0, before.currentHealth - (after?.currentHealth ?? 0)), defeated: true };
 
    this.animateSkullRevive(before);
    return {
      dealt: Math.max(0, before.currentHealth - (after?.currentHealth ?? 0)),
      defeated: true,
      state: {
      ...nextState,
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
 
  private isSolitudeIsolated(die: DiceInstanceState): boolean {
    if (!die.gridPosition) return false;
    const allies = this.gameState.dice.filter((other) =>
      other.zone === 'board' &&
      !other.isDestroyed &&
      other.ownerId === die.ownerId &&
      other.instanceId !== die.instanceId &&
      other.gridPosition &&
      this.areDiceOnSameBoardSide(other, die)
    );
    return !allies.some((other) => {
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
    if (!meta.hasSolitudePreCombat || meta.targetMaxHpBonusRate === undefined) return 0;
    if (meta.checkForAdjacentAllies && !this.isSolitudeIsolated(attacker)) return 0;
    if (meta.checkForAdjacentFoes && this.hasAdjacentFoe(attacker)) return 0;
    const bossMitigation = this.isBossDie(target) ? 0.25 : 1;
    return Math.max(1, Math.floor(target.maxHealth * meta.targetMaxHpBonusRate * bossMitigation));
  }
 
  private getLeonFuriousClawDamage(attacker: DiceInstanceState, target: DiceInstanceState): number {
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition) return 0;
    const crit = Math.random() < 0.2 ? 2 : 1;
    return Math.max(1, Math.floor(definition.attack * this.getOffenseMultiplier(attacker) * this.getDiceCardSkillDamageMultiplier(attacker) * crit));
  }
 
  private async executeLeonFuriousClaw(attacker: DiceInstanceState, target: DiceInstanceState, hitCount = 2) {
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition || !target.gridPosition || target.isDestroyed) return;
    this.playSkillSfxForDie(attacker, getRuntimeSkillMeta(definition));
    for (let hitIndex = 0; hitIndex < hitCount; hitIndex++) {
      const freshTarget = this.gameState.dice.find((die) => die.instanceId === target.instanceId && !die.isDestroyed);
      if (!freshTarget) return;
      const damage = this.getLeonFuriousClawDamage(attacker, freshTarget);
      const hit = this.applyDamageWithRevive(freshTarget.instanceId, damage);
      this.gameState = hit.state;
      this.showDamageText(freshTarget, hit.dealt, '#ffbf4a');
      if (hit.defeated) {
        await this.applyOnKillSkillEffects(attacker, freshTarget);
        this.applyOnDeathSkillEffects(freshTarget, attacker);
        this.handleDefeatedDie(freshTarget, true);
        return;
      }
    }
  }
 
  private applySolarFormEffects(attacker: DiceInstanceState, target: DiceInstanceState, baseDamage: number, pips: number) {
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition || !attacker.gridPosition || !target.gridPosition) return;
    const meta = getRuntimeSkillMeta(definition);
    if (!meta.transformOnOddPip || !this.oddPipTransformed.has(attacker.instanceId) || pips % 2 === 0) return;
 
    const splashRates = meta.splashDamageRatesByOddPip;
    const splashRate = splashRates?.[Math.max(0, Math.min(2, Math.floor((pips - 1) / 2)))] ?? 0;
    if (splashRate > 0) {
      const targetBoardSide = this.getBoardSideForDie(target);
      this.getBoardDiceOnSide(target.ownerId, targetBoardSide)
        .filter((die) =>
          die.instanceId !== target.instanceId &&
          die.gridPosition &&
          Math.abs(die.gridPosition.row - target.gridPosition!.row) <= 1 &&
          Math.abs(die.gridPosition.col - target.gridPosition!.col) <= 1)
        .forEach((die) => {
          const damage = Math.max(1, Math.floor(baseDamage * splashRate));
          const hit = this.applyDamageWithRevive(die.instanceId, damage);
          this.gameState = hit.state;
          this.showDamageText(die, hit.dealt, '#ffb347');
          this.handleDefeatedDie(die, hit.defeated);
        });
    }
 
    const heatwaveRate = meta.heatwaveDamageRate ?? 0;
    if (heatwaveRate <= 0) return;
    const attackerBoardSide = this.getBoardSideForDie(attacker);
    this.getBoardDiceOnSide(attacker.ownerId === 'player' ? 'enemy' : 'player', attackerBoardSide)
      .filter((die) =>
        die.gridPosition &&
        Math.abs(die.gridPosition.row - attacker.gridPosition!.row) <= 1 &&
        Math.abs(die.gridPosition.col - attacker.gridPosition!.col) <= 1)
      .forEach((die) => {
        const damage = Math.max(1, Math.floor(baseDamage * heatwaveRate));
        const hit = this.applyDamageWithRevive(die.instanceId, damage);
        this.gameState = hit.state;
        this.showDamageText(die, hit.dealt, '#ff7a35');
        this.handleDefeatedDie(die, hit.defeated);
      });
  }
 
  private applyPassiveSkillEffects(attacker: DiceInstanceState, target: DiceInstanceState) {
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition || !target.gridPosition) return;
    const meta = getRuntimeSkillMeta(definition);
    const classLevel = this.instanceClassLevels.get(attacker.instanceId) ?? 1;
    const targetBoardSide = this.getBoardSideForDie(target);
    const boardSideTargets = this.getLivingDiceOnBoardSide(targetBoardSide).filter((die) => die.ownerId === target.ownerId);
 
    const result = executePassiveSkillEffects(attacker, definition, classLevel, target, boardSideTargets);
 
    if (result.splashTargets?.length) {
      this.playPassiveSkillSfxForDie(attacker, meta);
      result.splashTargets.forEach((die) => {
        const dealt = Math.max(1, Math.ceil(meta.splashDamage! * this.getCombanityDamageMultiplier(attacker, die) * this.getOffenseMultiplier(attacker)));
        const splashHit = this.applyDamageWithRevive(die.instanceId, dealt);
        this.gameState = splashHit.state;
        this.showDamageText(die, splashHit.dealt, '#ff9f58');
        this.handleDefeatedDie(die, splashHit.defeated);
        this.animateSkillEffect('fire', attacker, die);
      });
    }
 
    if (result.chainTarget) {
      this.playPassiveSkillSfxForDie(attacker, meta);
      const dealt = Math.max(1, Math.ceil(meta.chainDamage * this.getCombanityDamageMultiplier(attacker, result.chainTarget) * this.getOffenseMultiplier(attacker)));
      const chainHit = this.applyDamageWithRevive(result.chainTarget.instanceId, dealt);
      this.gameState = chainHit.state;
      this.showDamageText(result.chainTarget, chainHit.dealt, '#fff176');
      this.handleDefeatedDie(result.chainTarget, chainHit.defeated);
      this.animateSkillEffect('electric', attacker, result.chainTarget);
    }
 
    if (result.pierceTargets?.length) {
      this.playPassiveSkillSfxForDie(attacker, meta);
      result.pierceTargets.forEach((die) => {
        const pierceDamage = Math.max(1, Math.floor(definition.attack * this.getCombanityDamageMultiplier(attacker, die) * this.getDiceCardSkillDamageMultiplier(attacker)));
        const pierceHit = this.applyDamageWithRevive(die.instanceId, pierceDamage);
        this.gameState = pierceHit.state;
        this.showDamageText(die, pierceHit.dealt, '#c9d6d3');
        this.handleDefeatedDie(die, pierceHit.defeated);
      });
    }
 
    if (result.leonFuriousClaw && this.getAttackDistance(attacker, target) <= 2) {
      void this.executeLeonFuriousClaw(attacker, target, 1);
    }
  }
 
  private async applyActiveSkillEffects(attacker: DiceInstanceState, target: DiceInstanceState, activeSlot: { key: string; title: string; manaNeeded: number }) {
    const applyDirectDamage = (victim: DiceInstanceState, baseDamage: number): { dealt: number; defeated: boolean } => {
      const multiplier = this.getCombanityDamageMultiplier(attacker, victim);
      const giantHunter = this.getGiantHunterBonus(attacker.ownerId, victim);
      const adjustedDamage = Math.max(1, Math.floor((baseDamage + giantHunter) * multiplier * this.getDiceCardSkillDamageMultiplier(attacker)));
      const directHit = this.applyDamageWithRevive(victim.instanceId, adjustedDamage);
      this.gameState = directHit.state;
      return { dealt: directHit.dealt, defeated: directHit.defeated };
    };
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition) return;
    const meta = getRuntimeSkillMeta(definition);
    const classLevel = this.instanceClassLevels.get(attacker.instanceId) ?? 1;
    const currentMana = this.getActiveMana(attacker.instanceId, activeSlot.key);
    const isDeathTransformed = this.deathDiceTransformed.has(attacker.instanceId);
 
    const result = executeActiveSkillEffects(attacker, definition, classLevel, target, currentMana, activeSlot, isDeathTransformed);
 
    if (result.needsMana) {
      this.combatLog.setText('Building mana...');
      this.addManaToAllActiveSlots(attacker);
    }
 
    if (result.summonWizard) {
      const wizard = this.summonMinionForOwner(attacker.ownerId, 'Wizard', this.getSummonedMinionClassLevel(attacker));
      if (wizard) {
        this.resetActiveMana(attacker.instanceId, activeSlot.key);
        this.combatLog.setText(`🪄 ${attacker.typeId} summons a Wizard Dice!`);
        return;
      }
    }
 
    if (result.meteorStrike) {
      const attackerBoardSide = this.getBoardSideForDie(attacker);
      const targetBoardSide: 'player' | 'enemy' = attackerBoardSide === 'player' ? 'enemy' : 'player';
      const enemyOwner: 'player' | 'enemy' = attacker.ownerId === 'player' ? 'enemy' : 'player';
      const meteorCount = Math.max(1, result.meteorStrike.meteorCount);
      const hasRandomOrientation = result.meteorStrike.hasRandomOrientation;
      const { damage: meteorDamage, lavaDamage, lavaTurns } = result.meteorStrike;
      let totalHits = 0;
      for (let meteorIndex = 0; meteorIndex < meteorCount; meteorIndex++) {
        const origin = hasRandomOrientation
          ? this.pickRandomGridTile()
          : this.pickRandomOccupiedTile(targetBoardSide, enemyOwner);
        if (!origin) break;
        this.animateMeteorImpact(targetBoardSide, origin);
        await this.delayCombatVisualPaced(1000);
        const impactTiles = this.getPlusPatternTiles(origin);
        const lavaTiles = hasRandomOrientation ? [origin] : impactTiles;
        lavaTiles.forEach((tile) => {
          const lavaKey = `${targetBoardSide}:${tile.row},${tile.col}`;
          this.lavaPoolsByTile.set(lavaKey, { damage: lavaDamage, turns: lavaTurns, sourceOwnerId: attacker.ownerId, sourceTypeId: attacker.typeId });
        });
        impactTiles.forEach((tile) => {
          const victim = this.gameState.dice.find((d) =>
            d.zone === 'board' && !d.isDestroyed && d.ownerId === enemyOwner && d.gridPosition?.row === tile.row && d.gridPosition?.col === tile.col
            && this.getBoardSideForDie(d) === targetBoardSide);
          if (!victim) return;
          const hit = applyDirectDamage(victim, meteorDamage);
          this.showDamageText(victim, hit.dealt, '#ff9f58');
          this.handleDefeatedDie(victim, hit.defeated);
          totalHits += 1;
        });
        this.renderLavaPools();
      }
      this.combatLog.setText(`☄️ ${attacker.typeId} meteor scorches ${totalHits} foe${totalHits === 1 ? '' : 's'} in + patterns for ${meteorDamage} damage and leaves lava!`);
      this.resetActiveMana(attacker.instanceId, activeSlot.key);
      return;
    }
 
    if (result.deathInstakill) {
      const freshTarget = this.gameState.dice.find(d => d.instanceId === target.instanceId);
      if (freshTarget && !freshTarget.isDestroyed) {
        AudioManager.playSfx(this, AUDIO_KEYS.deathInstakill);
        const targetIsBoss = this.isBossDie(freshTarget);
        const reaperDamage = targetIsBoss
          ? Math.max(1, Math.floor(definition.attack * 10 * this.getDiceCardSkillDamageMultiplier(attacker)))
          : freshTarget.currentHealth;
        const instakillHit = this.applyDamageWithRevive(freshTarget.instanceId, reaperDamage, targetIsBoss ? {} : { ignoreDamageReduction: true, ignoreShield: true });
        this.gameState = instakillHit.state;
        this.showDamageText(freshTarget, instakillHit.dealt, '#c57cff');
        this.combatLog.setText(targetIsBoss
          ? `☠️ Death Dice's Reaper's Touch carves ${freshTarget.typeId} for ${instakillHit.dealt} damage!`
          : `☠️ Death Dice's Reaper's Touch instantly kills ${freshTarget.typeId}!`);
        if (instakillHit.defeated) {
          await this.applyOnKillSkillEffects(attacker, freshTarget);
          this.applyOnDeathSkillEffects(freshTarget, attacker);
          this.handleDefeatedDie(freshTarget, true);
        }
      }
      this.resetActiveMana(attacker.instanceId, activeSlot.key);
      return;
    }
 
    if (result.summonImp) {
      const imp = this.summonMinionForOwner(attacker.ownerId, 'Imp', this.getSummonedMinionClassLevel(attacker));
      if (imp) {
        this.resetActiveMana(attacker.instanceId, activeSlot.key);
        this.combatLog.setText(`🔥 ${attacker.typeId} summons an Imp Dice!`);
      }
      return;
    }
 
    if (result.spearStrike) {
      const freshTarget = this.gameState.dice.find(d => d.instanceId === target.instanceId);
      if (freshTarget && !freshTarget.isDestroyed) {
        this.animateSpearActive(attacker, freshTarget);
        const hit = applyDirectDamage(freshTarget, result.spearStrike.damage);
        this.showDamageText(freshTarget, hit.dealt, '#dbe7e4');
        this.handleDefeatedDie(freshTarget, hit.defeated);
        this.getPierceBehindTargets(attacker, freshTarget, result.spearStrike.pierceRange).forEach((die) => {
          const pierceHit = applyDirectDamage(die, result.spearStrike.pierceDamage);
          this.showDamageText(die, pierceHit.dealt, '#b58cff');
          this.handleDefeatedDie(die, pierceHit.defeated);
        });
      }
      this.resetActiveMana(attacker.instanceId, activeSlot.key);
      return;
    }
 
    if (result.healTarget && result.healAmount !== undefined) {
      const healTarget = result.healTarget;
      const healAmount = Math.max(1, Math.ceil(result.healAmount * this.getCombanityDamageMultiplier(attacker, healTarget) * this.getTypeUpgradeMultiplier(attacker)));
      this.playSkillSfxForDie(attacker, meta);
      this.gameState = {
        ...this.gameState,
        dice: this.gameState.dice.map((die) => {
          if (die.instanceId !== healTarget.instanceId || die.isDestroyed) return die;
          return { ...die, currentHealth: Math.min(die.maxHealth, die.currentHealth + healAmount) };
        })
      };
      this.showHealText(healTarget, healAmount);
      this.animateSkillEffect('heal', attacker, healTarget);
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
 
    if (result.poisonTarget && result.poisonDamage !== undefined && result.poisonTurns !== undefined) {
      const poisonDamage = Math.max(1, Math.floor(result.poisonDamage * this.getDiceCardSkillDamageMultiplier(attacker)));
      const poisonTurns = result.poisonTurns;
      const existing = this.poisonByInstance.get(target.instanceId);
      this.poisonByInstance.set(target.instanceId, { damage: (existing?.damage ?? 0) + poisonDamage, turns: (existing?.turns ?? 0) + poisonTurns, stacks: (existing?.stacks ?? 0) + 1, sourceOwnerId: attacker.ownerId, sourceTypeId: attacker.typeId });
      this.animateSkillEffect('poison', attacker, target);
    }
 
    if (result.directDamage) {
      const freshTarget = result.directDamage.target;
      if (!freshTarget.isDestroyed) {
        const hit = applyDirectDamage(freshTarget, result.directDamage.damage);
        this.showDamageText(freshTarget, hit.dealt, '#ffbf80');
        this.handleDefeatedDie(freshTarget, hit.defeated);
      }
    }
 
    if (result.attackCountIncrease !== undefined && result.extraAttacksTurns !== undefined) {
      if (attacker.gridPosition) {
        const g = this.getGridContainerForDie(attacker);
        const x = g.x + attacker.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
        const y = g.y + attacker.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
        AnimationManager.animateElementalSkill(this, x, y, 'wind', 0x9fe7d9);
      }
      const count = Math.max(1, 1 + result.attackCountIncrease);
      this.basicAttacksPerAttackByInstance.set(attacker.instanceId, { count, turns: result.extraAttacksTurns });
      this.recordAttackCountEffect(attacker.instanceId, result.attackCountIncrease);
      if (meta.disableManaGain) this.manaPausedTurnsByInstance.set(attacker.instanceId, result.extraAttacksTurns);
    }
 
    if (result.armorShredTarget && result.armorShredRate !== undefined && result.armorShredTurns !== undefined) {
      const durationTurns = this.getSkillDurationTurns(result.armorShredTurns);
      if (durationTurns !== undefined) {
        this.armorShredByInstance.set(result.armorShredTarget.instanceId, { rate: result.armorShredRate, turns: durationTurns });
      }
    }
 
    if (result.attackDeltaTarget && result.attackDelta !== undefined && result.attackDeltaTurns !== undefined) {
      const durationTurns = this.getSkillDurationTurns(result.attackDeltaTurns);
      if (durationTurns !== undefined) {
        const existing = this.attackDeltaByInstance.get(result.attackDeltaTarget.instanceId);
        let appliedDelta = result.attackDelta;
        let nextDelta = result.attackDelta;
        let nextTurns = durationTurns;
        if (result.statusEffect === 'slow' && result.attackDelta < 0 && (result.attackDeltaMaxStacks ?? 1) > 1) {
          const maxStacks = Math.max(1, Math.floor(result.attackDeltaMaxStacks ?? 1));
          const stackUnit = Math.abs(result.attackDelta);
          const minDelta = -stackUnit * maxStacks;
          nextDelta = Math.max(minDelta, (existing?.delta ?? 0) + result.attackDelta);
          nextTurns = Math.max(existing?.turns ?? 0, durationTurns);
          appliedDelta = nextDelta - (existing?.delta ?? 0);
        }
        this.attackDeltaByInstance.set(result.attackDeltaTarget.instanceId, { delta: nextDelta, turns: nextTurns });
        this.recordAttackCountEffect(result.attackDeltaTarget.instanceId, appliedDelta);
        if (result.statusEffect === 'slow') {
          this.gameState = {
            ...this.gameState,
            dice: this.gameState.dice.map((die) => {
              if (die.instanceId !== result.attackDeltaTarget!.instanceId || die.isDestroyed || die.attacksRemaining <= 0) return die;
              const attacksRemaining = Math.max(0, die.attacksRemaining + appliedDelta);
              return { ...die, attacksRemaining, hasFinishedAttacking: attacksRemaining === 0 };
            })
          };
          this.animateSkillEffect('ice', attacker, result.attackDeltaTarget);
        }
      }
    }
 
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
    if (meta.hasSoulHarvestPassive || meta.noMaxSouls || meta.soulBoostPercent !== undefined) {
      return this.soulDiceSoulsConjured.get(die.instanceId) ?? 0;
    }
    return this.deathAlliesDefeatedCount.get(die.instanceId) ?? 0;
  }
 
  private setConjuredSoulCount(die: DiceInstanceState, meta: ReturnType<typeof getRuntimeSkillMeta>, count: number) {
    if (meta.hasSoulHarvestPassive || meta.noMaxSouls || meta.soulBoostPercent !== undefined) {
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
      return meta.hasSoulHarvestPassive && this.canConjureSoulFromDefeat(die, meta, defeated);
    });
    
    soulDice.forEach((soulDie) => {
      const baseDefinition = this.definitions.get(soulDie.typeId);
      if (!baseDefinition) return;
      const scaledDef = this.getDefinitionForInstance(soulDie);
      const scaledMeta = getRuntimeSkillMeta(scaledDef);
      if (!scaledMeta.hasSoulHarvestPassive) return;
      
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
		
      this.combatLog.setText(`Soul Dice harvested ally soul! (${currentSouls + 1} souls, +${scaledMeta.soulBoostPercent}% stats)`);
      AudioManager.playSfx(this, AUDIO_KEYS.soulHarvest);
    });
    
    const deathDice = this.gameState.dice.filter((die) => {
      if (die.isDestroyed) return false;
      const def = this.getDefinitionForInstance(die);
      if (!def) return false;
      const meta = getRuntimeSkillMeta(def);
      return meta.hasDeathTransform && this.canConjureSoulFromDefeat(die, meta, defeated);
    });
 
    deathDice.forEach((deathDie) => {
      if (this.deathDiceTransformed.has(deathDie.instanceId)) return;
      const definition = this.getDefinitionForInstance(deathDie);
      if (!definition || !getRuntimeSkillMeta(definition).hasDeathTransform) return;
 
      const meta = getRuntimeSkillMeta(definition);
      const previous = this.getConjuredSoulCount(deathDie, meta);
      const cap = meta.maxSouls ?? 2;
      const count = Math.min(cap, previous + 1);
      this.setConjuredSoulCount(deathDie, meta, count);
 
      if (count >= cap) {
        this.deathDiceTransformed.add(deathDie.instanceId);
        this.gameState = {
          ...this.gameState,
          dice: this.gameState.dice.map((die) =>
            die.instanceId === deathDie.instanceId
              ? { ...die, maxHealth: die.maxHealth * 2, currentHealth: die.maxHealth * 2 }
              : die
          )
        };
        this.resetActiveMana(deathDie.instanceId);
        this.combatLog.setText('☠️ Death Dice transforms! Max HP doubled — Instakill Form ACTIVE!');
        this.applyOnTransformedSkillEffects(deathDie);
        this.animateTransformEffect(deathDie);
      }
    });
  }
 
  private applyOnTransformedSkillEffects(transformed: DiceInstanceState) {
    const definition = this.getDefinitionForInstance(transformed);
    if (!definition) return;
    const classLevel = this.instanceClassLevels.get(transformed.instanceId) ?? 1;
    const result = executeOnTransformedSkillEffects(transformed, definition, classLevel);
    if (!result.bonusAttacks || result.bonusAttacks <= 0) return;
    this.playSkillSfxForDie(transformed, getRuntimeSkillMeta(definition));
    this.recordAttackCountEffect(transformed.instanceId, result.bonusAttacks);
    const turns = Math.max(1, result.extraAttacksTurns ?? 1);
    const current = this.extraAttackTurnsByInstance.get(transformed.instanceId);
    this.extraAttackTurnsByInstance.set(transformed.instanceId, {
      extra: (current?.extra ?? 0) + result.bonusAttacks,
      turns: Math.max(current?.turns ?? 0, turns)
    });
    this.gameState = {
      ...this.gameState,
      dice: this.gameState.dice.map((die) => die.instanceId === transformed.instanceId
        ? { ...die, attacksRemaining: die.attacksRemaining + result.bonusAttacks!, hasFinishedAttacking: false }
        : die)
    };
    if (result.extraEffects?.length) this.combatLog.setText(result.extraEffects.join('; '));
  }
 
  private handleDefeatedDie(defeated: DiceInstanceState, wasDefeated: boolean) {
    if (wasDefeated) this.checkDeathTransformCondition(defeated);
  }
 
  private applyCombatEndSkills() {
    this.gameState = {
      ...this.gameState,
      dice: this.gameState.dice.map((die) => {
        if (die.zone !== 'board' || die.isDestroyed) return die;
        const definition = this.getDefinitionForInstance(die);
        if (!definition) return die;
        const classLevel = this.instanceClassLevels.get(die.instanceId) ?? 1;
        const result = executeCombatEndSkillEffects(die, definition, classLevel);
 
        if (result.applyGrowth) {
          const delta = result.growthDelta ?? 1;
          const current = this.permanentAttackBonusByInstance.get(die.instanceId) ?? 0;
          this.permanentAttackBonusByInstance.set(die.instanceId, current + delta);
          this.recordAttackCountEffect(die.instanceId, delta);
        }
 
        if (result.applyBrokenGrowth && result.brokenGrowthDelta !== undefined) {
          const delta = result.brokenGrowthDelta;
          const currentDelta = this.brokenGrowthDeltaByInstance.get(die.instanceId) ?? 0;
          const newDelta = currentDelta + delta;
          this.brokenGrowthDeltaByInstance.set(die.instanceId, newDelta);
          this.recordAttackCountEffect(die.instanceId, delta);
          this.combatLog.setText(`Broken Growth Dice: ${delta > 0 ? '+1' : '-1'} attack count (total: ${newDelta > 0 ? '+' : ''}${newDelta})`);
        }
 
        if (result.bonusAttacks && result.bonusAttacks > 0) {
          this.recordAttackCountEffect(die.instanceId, result.bonusAttacks);
          return { ...die, attacksRemaining: Math.max(0, die.attacksRemaining + result.bonusAttacks) };
        }
        return die;
      })
    };
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
    this.attackDeltaByInstance.forEach((value, key) => {
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
        const healed = Math.max(1, Math.floor(die.maxHealth * rate));
        return { ...die, currentHealth: Math.min(die.maxHealth, die.currentHealth + healed) };
      })
    };
  }
 
  private summonMinionForOwner(ownerId: 'player' | 'enemy', typeId: 'Imp' | 'Wizard', classLevel = 1): DiceInstanceState | undefined {
    const baseDefinition = this.definitions.get(typeId);
    if (!baseDefinition) return undefined;
    const definition = this.applyClassProgress(baseDefinition, classLevel);
    const footprint = this.getFootprintForDefinition(definition);
    const usedCells = this.collectOccupiedCells(ownerId);
    const position = this.findRandomFootprintPosition(footprint, usedCells, () => ownerId === 'enemy' ? this.pickEnemyColumn(definition.range) : Phaser.Math.Between(0, GRID_SIZE - footprint));
    if (!position) return undefined;
    const instanceId = `${ownerId}-${typeId}-summon-${Date.now()}-${Phaser.Math.Between(1, 9999)}`;
    const minion: DiceInstanceState = {
      instanceId,
      ownerId,
      typeId,
      currentHealth: definition.health,
      maxHealth: definition.health,
      attacksRemaining: 0,
      hasFinishedAttacking: true,
      isDestroyed: false,
      zone: 'board',
      gridPosition: position
    };
    this.gameState = { ...this.gameState, dice: [...this.gameState.dice, minion] };
    this.instanceClassLevels.set(instanceId, classLevel);
    this.instanceDefinitionOverrides.set(instanceId, definition);
    this.markFootprint(position.row, position.col, footprint, usedCells);
    return minion;
  }
 
  private getSummonedMinionClassLevel(parent: DiceInstanceState): number {
    return this.instanceClassLevels.get(parent.instanceId) ?? 1;
  }
 
  private summonDeuciferBoss() {
    const definition = this.definitions.get('Deucifer');
    if (!definition) return;
    const instanceId = `enemy-Deucifer-boss-${Date.now()}`;
    const boss: DiceInstanceState = {
      instanceId,
      ownerId: 'enemy',
      typeId: 'Deucifer',
      currentHealth: definition.health,
      maxHealth: definition.health,
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
    if (this.activeChallenge === 'deucifer') this.turnLimit = Math.max(this.turnLimit, 15);
    this.enemyLoadoutRevealed = true;
    this.combatLog.setText('Deucifer is waiting in hand...');
  }
 
  private healDie(instanceId: string, amount: number) {
    const target = this.gameState.dice.find((die) => die.instanceId === instanceId && !die.isDestroyed);
    if (!target || amount <= 0) return;
    const healedAmount = Math.min(amount, Math.max(0, target.maxHealth - target.currentHealth));
    if (healedAmount <= 0) return;
    this.gameState = {
      ...this.gameState,
      dice: this.gameState.dice.map((die) => die.instanceId === instanceId
        ? { ...die, currentHealth: Math.min(die.maxHealth, die.currentHealth + healedAmount) }
        : die)
    };
    this.showHealText(target, healedAmount);
  }
 
  private applyTurnBasedEffects() {
    const newlyDefeated: DiceInstanceState[] = [];
    this.poisonByInstance.forEach((effect, instanceId) => {
      if (effect.turns <= 0) return;
      const target = this.gameState.dice.find((die) => die.instanceId === instanceId && !die.isDestroyed);
      if (target) this.showDamageText(target, Math.max(1, Math.floor(effect.damage)), '#74d66f');
      this.gameState = {
        ...this.gameState,
        dice: this.gameState.dice.map((die) => {
          if (die.instanceId !== instanceId || die.isDestroyed) return die;
          const tickDamage = Math.max(1, Math.floor(effect.damage));
          const currentHealth = Math.max(0, die.currentHealth - tickDamage);
          const isDestroyed = currentHealth <= 0;
          if (isDestroyed && !die.isDestroyed) newlyDefeated.push(die);
          return {
            ...die,
            currentHealth,
            isDestroyed,
            zone: isDestroyed ? 'eliminated' : die.zone,
            gridPosition: isDestroyed ? undefined : die.gridPosition,
            hasFinishedAttacking: isDestroyed ? true : die.hasFinishedAttacking,
            attacksRemaining: isDestroyed ? 0 : die.attacksRemaining
          };
        })
      };
      this.poisonByInstance.set(instanceId, { ...effect, turns: effect.turns - 1 });
      if (effect.turns - 1 <= 0) {
        this.poisonByInstance.delete(instanceId);
      }
    });
    this.armorShredByInstance.forEach((effect, instanceId) => {
      this.armorShredByInstance.set(instanceId, { ...effect, turns: effect.turns - 1 });
      if (effect.turns - 1 <= 0) this.armorShredByInstance.delete(instanceId);
    });
    newlyDefeated.forEach((die) => this.handleDefeatedDie(die, true));
    if (newlyDefeated.length > 0) AudioManager.playSfx(this, AUDIO_KEYS.diceDie);
  }
 
  private getSkillDurationTurns(rawTurns?: number): number | undefined {
    if (rawTurns === undefined) return undefined;
    if (!Number.isFinite(rawTurns)) return undefined;
    return Math.max(1, Math.floor(rawTurns));
  }
 
  private async returnDiceToHand() {
    this.gamePhase = { stage: 'placement' };
    this.tauntedByInstance.clear();
    this.chainedByInstance.clear();
    this.combatTimeRemainingMs = 30_000;
    this.combatCountdownTriggered = false;
    this.updateCombatTimerUi();
    this.placedDiceCount = 0;
    this.diceRolled = false;
    this.dicePips.clear();
    this.handDice.forEach((container) => container.destroy());
    this.handDice.clear();
    this.infiltratedBoardSideByInstance.clear();
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
 
  private animateSkillEffect(kind: 'ice' | 'fire' | 'poison' | 'electric' | 'heal', attacker: DiceInstanceState, target: DiceInstanceState) {
    if (!attacker.gridPosition || !target.gridPosition) return;
    const attackerGrid = this.getGridContainerForDie(attacker);
    const targetGrid = this.getGridContainerForDie(target);
    const ax = attackerGrid.x + attacker.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const ay = attackerGrid.y + attacker.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const tx = targetGrid.x + target.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const ty = targetGrid.y + target.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const g = this.add.graphics();
    if (kind === 'ice') { g.lineStyle(2, 0x8fd5ff, 0.9); g.strokeRect(tx - 18, ty - 18, 36, 36); }
    if (kind === 'fire') { g.fillStyle(0xff8a3d, 0.25); g.fillTriangle(tx, ty - 18, tx - 14, ty + 16, tx + 14, ty + 16); }
    if (kind === 'poison') { g.fillStyle(0x74d66f, 0.28); g.fillCircle(tx, ty, 14); g.fillCircle(tx + 12, ty - 8, 7); }
    if (kind === 'electric') { g.lineStyle(2, 0xffef7a, 0.95); g.beginPath(); g.moveTo(ax, ay); g.lineTo((ax+tx)/2 - 8, (ay+ty)/2 + 6); g.lineTo((ax+tx)/2 + 6, (ay+ty)/2 - 5); g.lineTo(tx, ty); g.strokePath(); }
    if (kind === 'heal') { g.lineStyle(3, 0x7dff9f, 0.95); g.strokeCircle(tx, ty, 18); g.lineBetween(tx - 10, ty, tx + 10, ty); g.lineBetween(tx, ty - 10, tx, ty + 10); }
    this.tweens.add({ targets: g, alpha: 0, duration: 420, onComplete: () => g.destroy() });
  }
 
  private pickRandomGridTile(): { row: number; col: number } {
    return { row: Phaser.Math.Between(0, GRID_SIZE - 1), col: Phaser.Math.Between(0, GRID_SIZE - 1) };
  }
 
  private pickRandomOccupiedTile(boardSide: 'player' | 'enemy', ownerId?: 'player' | 'enemy'): { row: number; col: number } | null {
    const candidates = this.gameState.dice.filter((die) =>
      die.zone === 'board' &&
      !die.isDestroyed &&
      die.gridPosition &&
      this.getBoardSideForDie(die) === boardSide &&
      (ownerId === undefined || die.ownerId === ownerId)
    );
    if (candidates.length === 0) return null;
    const picked = candidates[Phaser.Math.Between(0, candidates.length - 1)]!;
    return picked.gridPosition ? { row: picked.gridPosition.row, col: picked.gridPosition.col } : null;
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
    AnimationManager.animateDeathTransform(this, x, y);
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
    const targetX = targetGrid.x + target.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const targetY = targetGrid.y + target.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const boardWidth = GRID_SIZE * (TILE_SIZE + TILE_GAP) - TILE_GAP;
    const cellPitch = TILE_SIZE + TILE_GAP;
    const targetCenterX = target.gridPosition.col * cellPitch + TILE_SIZE / 2;
    const targetCenterY = target.gridPosition.row * cellPitch + TILE_SIZE / 2;
    const lineStartX = pattern === 'column'
      ? targetGrid.x + targetCenterX
      : pattern === 'diagonalDown'
      ? targetGrid.x + targetCenterX - Math.min(target.gridPosition.row, target.gridPosition.col) * cellPitch
      : pattern === 'diagonalUp'
      ? targetGrid.x + targetCenterX - Math.min(GRID_SIZE - 1 - target.gridPosition.row, target.gridPosition.col) * cellPitch
      : targetGrid.x;
    const lineStartY = pattern === 'column'
      ? targetGrid.y
      : pattern === 'diagonalDown'
      ? targetGrid.y + targetCenterY - Math.min(target.gridPosition.row, target.gridPosition.col) * cellPitch
      : pattern === 'diagonalUp'
      ? targetGrid.y + targetCenterY + Math.min(GRID_SIZE - 1 - target.gridPosition.row, target.gridPosition.col) * cellPitch
      : targetGrid.y + targetCenterY;
    const lineEndX = pattern === 'column'
      ? lineStartX
      : pattern === 'diagonalDown'
      ? targetGrid.x + targetCenterX + Math.min(GRID_SIZE - 1 - target.gridPosition.row, GRID_SIZE - 1 - target.gridPosition.col) * cellPitch
      : pattern === 'diagonalUp'
      ? targetGrid.x + targetCenterX + Math.min(target.gridPosition.row, GRID_SIZE - 1 - target.gridPosition.col) * cellPitch
      : targetGrid.x + boardWidth;
    const lineEndY = pattern === 'column'
      ? targetGrid.y + boardWidth
      : pattern === 'diagonalDown'
      ? targetGrid.y + targetCenterY + Math.min(GRID_SIZE - 1 - target.gridPosition.row, GRID_SIZE - 1 - target.gridPosition.col) * cellPitch
      : pattern === 'diagonalUp'
      ? targetGrid.y + targetCenterY - Math.min(target.gridPosition.row, GRID_SIZE - 1 - target.gridPosition.col) * cellPitch
      : targetGrid.y + targetCenterY;
    
    AnimationManager.animateTranscendenceBeamFx(this, attackerX, attackerY, lineStartX, lineStartY, lineEndX, lineEndY, Phaser.Math.Distance.Between(lineStartX, lineStartY, lineEndX, lineEndY));
    void targetX;
    void targetY;
  }
 
  private animateJudgmentHammer(boardSide: 'player' | 'enemy', row: number, col: number) {
    const grid = boardSide === 'player' ? this.playerGridContainer : this.enemyGridContainer;
    const x = grid.x + col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const y = grid.y + row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    AnimationManager.animateJudgmentHammer(this, x, y, 420);
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
 
  private generateEnemyPositions() {
    const enemyHandDice = getAvailableHandDice(this.gameState, 'enemy');
    const usedCells = this.collectOccupiedCells('enemy');
 
    for (const die of enemyHandDice) {
      const definition = this.getDefinitionForInstance(die) ?? this.definitions.get(die.typeId);
      const range = definition?.range ?? 4;
      const footprint = this.getFootprintForDefinition(definition);
      const position = this.isBossDie(die)
        ? this.findRandomBossPosition(die, footprint, usedCells)
        : this.findRandomFootprintPosition(footprint, usedCells, () => this.pickEnemyColumn(range));
      if (!position) continue;
      this.markFootprint(position.row, position.col, footprint, usedCells);
      this.gameState = placeDieOnBoard(this.gameState, die.instanceId, position.row, position.col);
    }
  }
 
  private pickEnemyColumn(range: number): number {
    switch (this.configDifficulty) {
      case 'Baby':
        return Math.random() < 0.85 ? this.pickRandomColumn([0, 1]) : Phaser.Math.Between(0, GRID_SIZE - 1);
      case 'Easy':
        return Math.random() < 0.82 ? this.pickRandomColumn([1, 2]) : 0;
      case 'Hard':
        if (range <= 3) return Math.random() < 0.75 ? this.pickRandomColumn([0, 1]) : Phaser.Math.Between(0, GRID_SIZE - 1);
        if (range >= 5) return Math.random() < 0.8 ? this.pickRandomColumn([2, 3, 4]) : Phaser.Math.Between(0, GRID_SIZE - 1);
        return Phaser.Math.Between(0, GRID_SIZE - 1);
      case 'Nightmare':
        if (this.shouldNightmareTakeInitiative()) {
          if (range >= 5) return this.pickRandomColumn([0, 1]);
          if (range === 4) return this.pickRandomColumn([0, 1, 2]);
          return 0;
        }
        if (range <= 3) return 0;
        if (range === 4) return 1;
        if (range === 5) return 2;
        return this.pickRandomColumn([3, 4]);
      case 'Medium':
      default:
        return Phaser.Math.Between(0, GRID_SIZE - 1);
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
    if (name.endsWith(' Upgrade')) {
      const pct = [0, 50, 75, 100][mag];
      const typeName = name.replace(' Upgrade', '');
      const dieFaceByRarity: Record<string, string> = { Bronze: '⚃', Silver: '⚄', Gold: '⚅' };
      const colorByRarity: Record<string, string> = { Bronze: '#cd7f32', Silver: '#c0c0c0', Gold: '#ffd700' };
      const icon = dieFaceByRarity[rarity] ?? '⚅';
      const color = colorByRarity[rarity] ?? '#ffd700';
      return { icon, color, title: name, rarity, desc: `${typeName} gets +${pct}% basic+skill damage and max HP.` };
    }
    if (name === 'Fountain of Love') {
      const pct = [0, 10, 15, 20][mag];
      return { icon: '💖', title: name, rarity, desc: `On Combat End: all friendly dice heal ${pct}% max HP.` };
    }
    if (name === 'Mana Potion') {
      return { icon: '🧪', title: name, rarity, desc: `On Combat Start: all friendly dice gain +${mag} mana.` };
    }
    if (name === 'Spotlight') {
      const pct = [0, 20, 30, 40][mag];
      return { icon: '🔦', title: name, rarity, desc: `Passive: 3-pip dice gain ${pct}% damage reduction and ${pct}% more damage.` };
    }
    if (name === 'Odd Investment') {
      const dmg = [0, 20, 30, 40][mag];
      const red = [0, 10, 15, 20][mag];
      return { icon: '🌓', title: name, rarity, desc: `Passive: odd effective-pip dice gain +${dmg}% damage and ${red}% damage reduction.` };
    }
    if (name === 'Even Investment') {
      const dmg = [0, 20, 30, 40][mag];
      const red = [0, 10, 15, 20][mag];
      return { icon: '🌗', title: name, rarity, desc: `Passive: even effective-pip dice gain +${dmg}% damage and ${red}% damage reduction.` };
    }
    if (name === 'Giant Hunter') {
      const pct = [0, 1, 2, 3][mag];
      return { icon: '🗡️', title: name, rarity, desc: `Passive: direct damage adds ${pct}% target max HP.` };
    }
	if (name === 'Crowd Attack') {
      const dmg = [0, 20, 30, 40][mag];
      const red = [0, 10, 15, 20][mag];
      return { icon: '👥', title: name, rarity, desc: `Passive: dice with 1 or 2 pips gain +${dmg}% damage and ${red}% damage reduction.` };
    }
	if (name === 'Fire Support') {
      return { icon: '🏹', title: name, rarity, desc: `Passive: dice placed on the backline gain +${mag} attack count.` };
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
      const baseTitle = def?.title ?? diceUnit.typeId;
      const dieTitle = baseTitle.endsWith('Dice') ? baseTitle.slice(0, -4).trim() : baseTitle;
      const classLevel = this.instanceClassLevels.get(diceUnit.instanceId) ?? 1;
      const shieldHp = this.shieldHpByInstance.get(diceUnit.instanceId) ?? 0;
      const shieldTag = shieldHp > 0 ? ` | SH ${shieldHp}` : '';
      const status = diceUnit.isDestroyed ? 'DEFEATED' : `${diceUnit.currentHealth}/${diceUnit.maxHealth} HP${shieldTag}${visual ? ` ${visual.symbol}` : ''}`;
      const classLabel = this.isBossDie(diceUnit) ? '' : ` C${classLevel}/15`;
      panel.add(this.add.text(0, 36 + index * 16, `${dieTitle}${classLabel}: ${status}`, { fontFamily: 'Orbitron', fontSize: '11px', color: diceUnit.isDestroyed ? PALETTE.danger : (visual?.accent ?? PALETTE.textMuted) }).setOrigin(centered ? 0.5 : 0, 0));
    });
  }
 
  private pickRandomEnemyLoadout(pool: DiceDefinition[]): DiceDefinition[] {
    const weightedPool = this.buildDifficultyWeightedPool(pool);
    const arr = [...weightedPool];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
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
      const pick = arr[Math.floor(Math.random() * arr.length)];
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
 
  private async applyOnKillSkillEffects(attacker: DiceInstanceState, _defeated: DiceInstanceState) {
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition) return;
    const meta = getRuntimeSkillMeta(definition);
    const classLevel = this.instanceClassLevels.get(attacker.instanceId) ?? 1;
    const result = executeOnKillSkillEffects(attacker, definition, classLevel, _defeated);
 
    if (result.bonusAttacks && result.bonusAttacks > 0) {
      this.playSkillSfxForDie(attacker, meta);
      this.gameState = {
        ...this.gameState,
        dice: this.gameState.dice.map((die) => {
          if (die.instanceId !== attacker.instanceId) return die;
          this.recordAttackCountEffect(die.instanceId, result.bonusAttacks!);
          return { ...die, attacksRemaining: die.attacksRemaining + result.bonusAttacks!, hasFinishedAttacking: false };
        })
      };
    }
    if (result.bonusDamage && result.bonusDamage > 0) {
      const current = this.basicAttackDamageBonusByInstance.get(attacker.instanceId) ?? 0;
      this.basicAttackDamageBonusByInstance.set(attacker.instanceId, current + result.bonusDamage);
      this.playSkillSfxForDie(attacker, meta);
    }
    if (result.hammerTarget && result.hammerDamage !== undefined) {
      this.playSkillSfxForDie(attacker, meta);
      await this.dropJudgmentHammer(attacker, result.hammerDamage, new Set<string>());
    }
  }
 
  private async dropJudgmentHammer(attacker: DiceInstanceState, damage: number, chainGuard: Set<string>) {
    const enemyOwner = attacker.ownerId === 'player' ? 'enemy' : 'player';
    const weakest = getBoardDice(this.gameState, enemyOwner)
      .filter((die) => die.gridPosition)
      .sort((a, b) => a.currentHealth - b.currentHealth || a.maxHealth - b.maxHealth)[0];
    if (!weakest?.gridPosition || chainGuard.has(weakest.instanceId)) return;
    chainGuard.add(weakest.instanceId);
    await this.delayCombatVisualPaced(500);
    if (!this.sys.isActive()) return;
    const freshWeakest = this.gameState.dice.find((die) => die.instanceId === weakest.instanceId && die.zone === 'board' && !die.isDestroyed && die.gridPosition);
    if (!freshWeakest?.gridPosition) return;
    const center = freshWeakest.gridPosition;
    const targetBoardSide = this.getBoardSideForDie(freshWeakest);
    this.animateJudgmentHammer(targetBoardSide, center.row, center.col);
    const victims = getBoardDice(this.gameState, enemyOwner).filter((die) =>
      die.gridPosition &&
      this.getBoardSideForDie(die) === targetBoardSide &&
      Math.abs(die.gridPosition.row - center.row) <= 1 &&
      Math.abs(die.gridPosition.col - center.col) <= 1
    );
    const defeatedByHammer: DiceInstanceState[] = [];
    victims.forEach((die) => {
      const dealt = Math.max(1, Math.floor(damage * this.getCombanityDamageMultiplier(attacker, die) * this.getDiceCardSkillDamageMultiplier(attacker)));
      const hammerHit = this.applyDamageWithRevive(die.instanceId, dealt);
      this.gameState = hammerHit.state;
      this.showDamageText(die, hammerHit.dealt, '#ffd36f');
      if (hammerHit.defeated) {
        defeatedByHammer.push(die);
        this.handleDefeatedDie(die, hammerHit.defeated);
      }
    });
    if (defeatedByHammer.length > 0 && chainGuard.size < 10) {
      await this.dropJudgmentHammer(attacker, damage, chainGuard);
    }
  }
 
  private applyOnDeathSkillEffects(defeated: DiceInstanceState, _attacker: DiceInstanceState) {
    const definition = this.getDefinitionForInstance(defeated);
    if (!definition) return;
    const meta = getRuntimeSkillMeta(definition);
    const classLevel = this.instanceClassLevels.get(defeated.instanceId) ?? 1;
    const result = executeOnDeathSkillEffects(defeated, definition, classLevel, _attacker);
 
    if (result.bonusAttacks && result.bonusAttacks > 0 && result.extraEffects?.length) {
      this.playSkillSfxForDie(defeated, meta);
      const allyOwner = defeated.ownerId;
      const ally = getBoardDice(this.gameState, allyOwner).find((die) => die.instanceId !== defeated.instanceId);
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
      this.combatLog.setText(result.extraEffects.join('; '));
    }
  }
 
  private playSkillSfxForDie(die: DiceInstanceState, providedMeta?: ReturnType<typeof getRuntimeSkillMeta>) {
    const definition = this.getDefinitionForInstance(die);
    if (!definition) return;
    const meta = providedMeta ?? getRuntimeSkillMeta(definition);
    AudioManager.playSfx(this, meta.skillSfxKey ?? AUDIO_KEYS.skillTrigger);
  }
 
  private playPassiveSkillSfxForDie(die: DiceInstanceState, providedMeta?: ReturnType<typeof getRuntimeSkillMeta>) {
    const definition = this.getDefinitionForInstance(die);
    if (!definition) return;
    const meta = providedMeta ?? getRuntimeSkillMeta(definition);
    AudioManager.playSfx(this, meta.passiveSkillSfxKey ?? meta.skillSfxKey ?? AUDIO_KEYS.skillTrigger);
  }
 
  private isOnTranscendencePattern(source: { row: number; col: number }, target: { row: number; col: number }, pattern: TranscendenceBeamPattern): boolean {
    if (pattern === 'row') return target.row === source.row;
    if (pattern === 'column') return target.col === source.col;
    if (pattern === 'diagonalDown') return target.row - source.row === target.col - source.col;
    return target.row - source.row === source.col - target.col;
  }
 
  private getTranscendenceBeamPattern(attacker: DiceInstanceState, target: DiceInstanceState): TranscendenceBeamPattern | null {
    if (!attacker.gridPosition || !target.gridPosition) return null;
    const rowDiff = target.gridPosition.row - attacker.gridPosition.row;
    const colDiff = target.gridPosition.col - attacker.gridPosition.col;
    if (rowDiff === 0) return 'column';
    if (colDiff === 0) return 'row';
    if (Math.abs(rowDiff) === Math.abs(colDiff)) return rowDiff === colDiff ? 'diagonalUp' : 'diagonalDown';
    return Math.abs(colDiff) >= Math.abs(rowDiff) ? 'column' : 'row';
  }
 
  private executeTranscendenceBeam(attacker: DiceInstanceState, target: DiceInstanceState, pattern: TranscendenceBeamPattern): { damage: number; targetDestroyed: boolean } {
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition || !attacker.gridPosition || !target.gridPosition) {
      return { damage: 0, targetDestroyed: false };
    }
 
    const meta = getRuntimeSkillMeta(definition);
    const damage = meta.beamDamage ?? 300;
    const targetPos = target.gridPosition;
    const targetBoardSide = this.getBoardSideForDie(target);
    const enemyOwner = attacker.ownerId === 'player' ? 'enemy' : 'player';
    const victims = this.getBoardDiceOnSide(enemyOwner, targetBoardSide).filter((die) =>
      die.gridPosition &&
      (die.instanceId === target.instanceId || this.isOnTranscendencePattern(targetPos, die.gridPosition, pattern))
    );
 
    let primaryDefeated = false;
    victims.forEach((die) => {
      const dealt = Math.max(1, Math.floor(damage * this.getCombanityDamageMultiplier(attacker, die) * this.getDiceCardSkillDamageMultiplier(attacker)));
      const beamHit = this.applyDamageWithRevive(die.instanceId, dealt);
      this.gameState = beamHit.state;
      this.showDamageText(die, beamHit.dealt, '#9ff8ff');
      if (die.instanceId !== target.instanceId) this.handleDefeatedDie(die, beamHit.defeated);
      if (die.instanceId === target.instanceId) primaryDefeated = beamHit.defeated;
    });
 
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
    return { damage, targetDestroyed: primaryDefeated };
  }
 
 
  private findTranscendenceBeamTarget(attacker: DiceInstanceState, preferredTarget?: DiceInstanceState): TranscendenceBeamLine | undefined {
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition) return undefined;
    const meta = getRuntimeSkillMeta(definition);
    const basePips = attacker.ownerId === 'player' ? (this.dicePips.get(attacker.instanceId) ?? 0) : (this.enemyDicePips.get(attacker.instanceId) ?? 0);
    if (meta.hasTranscendence && basePips === 6 && !this.transcendenceTransformed.has(attacker.instanceId)) {
      this.transcendenceTransformed.add(attacker.instanceId);
      this.applyOnTransformedSkillEffects(attacker);
    }
    if (!meta.hasTranscendence || basePips !== 6 || !attacker.gridPosition || attacker.attacksRemaining <= 0) return undefined;
 
    const enemyOwner = attacker.ownerId === 'player' ? 'enemy' : 'player';
    const attackerBoardSide = this.getBoardSideForDie(attacker);
    const targetBoardSide: 'player' | 'enemy' = attackerBoardSide === 'player' ? 'enemy' : 'player';
    const candidates = this.getBoardDiceOnSide(enemyOwner, targetBoardSide)
      .filter((die): die is DiceInstanceState & { gridPosition: { row: number; col: number } } => Boolean(die.gridPosition))
      .filter((die) => !this.isBlockedByAllyChain(attacker, die))
      .map((die) => ({ die, pattern: this.getTranscendenceBeamPattern(attacker, die), distance: this.getAttackDistance(attacker, die) }))
      .filter((entry): entry is { die: DiceInstanceState & { gridPosition: { row: number; col: number } }; pattern: TranscendenceBeamPattern; distance: number } => entry.pattern !== null);
 
    if (preferredTarget?.gridPosition && preferredTarget.ownerId === enemyOwner && !preferredTarget.isDestroyed) {
      const forced = candidates.find((entry) => entry.die.instanceId === preferredTarget.instanceId);
      if (forced) return { target: forced.die, pattern: forced.pattern };
    }
 
    const mode = meta.targetingMode ?? definition.targetingMode ?? 'Nearest';
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
      const random = candidates[Math.floor(Math.random() * candidates.length)];
      return random ? { target: random.die, pattern: random.pattern } : undefined;
    }
    return byNear[0] ? { target: byNear[0].die, pattern: byNear[0].pattern } : undefined;
  }
 
 
  private getTransformedVisual(die: DiceInstanceState): { accent: string; symbol: string } | null {
    const definition = this.getDefinitionForInstance(die);
    if (!definition) return null;
    const meta = getRuntimeSkillMeta(definition);
    const isDeathTransformed = meta.hasDeathTransform && this.deathDiceTransformed.has(die.instanceId);
    const pip = die.ownerId === 'player' ? (this.dicePips.get(die.instanceId) ?? 0) : (this.enemyDicePips.get(die.instanceId) ?? 0);
    const isPlacementPhase = this.gamePhase.stage === 'placement';
    const isTranscendenceTransformed = meta.hasTranscendence && (isPlacementPhase ? pip === 6 : this.transcendenceTransformed.has(die.instanceId));
    const isOddPipTransformed = meta.transformOnOddPip && (isPlacementPhase ? pip % 2 === 1 : this.oddPipTransformed.has(die.instanceId));
    if (!isDeathTransformed && !isTranscendenceTransformed && !isOddPipTransformed) return null;
    return {
      accent: meta.transformAccent ?? definition.accent,
      symbol: meta.transformSymbol ?? '✦'
    };
  }
 
  private getEffectiveAttackRange(die: DiceInstanceState, definition = this.getDefinitionForInstance(die)): number {
    if (!definition) return 0;
    const meta = getRuntimeSkillMeta(definition);
    const pip = die.ownerId === 'player' ? (this.dicePips.get(die.instanceId) ?? 0) : (this.enemyDicePips.get(die.instanceId) ?? 0);
    const isTranscendenceSixForm = meta.hasTranscendence && (pip === 6 || this.transcendenceTransformed.has(die.instanceId));
    return isTranscendenceSixForm ? TRANSCENDENCE_GRID_WIDE_RANGE : definition.range;
  }
 
  private getRangeCoverageText(die: DiceInstanceState): string {
    const definition = this.getDefinitionForInstance(die);
    if (!definition || !die.gridPosition) return `${die.typeId} range unavailable.`;
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
    return `${die.typeId} C${this.instanceClassLevels.get(die.instanceId) ?? 1} range ${this.getEffectiveAttackRange(die, definition)}: ${tintName} coverage hits ${tileCount}/25 enemy tiles (columns ${columnText}, all rows).`;
  }
 
  private showDamageText(target: DiceInstanceState, amount: number, color = '#ffdf7a', textOverride?: string) {
    if (!target.gridPosition || (amount <= 0 && !textOverride)) return;
    const grid = this.getGridContainerForDie(target);
    const x = grid.x + target.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const y = grid.y + target.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2 - 18;
    const text = this.add.text(x, y, textOverride ?? `-${amount}`, {
      fontFamily: 'Orbitron',
      fontSize: '16px',
      color,
      stroke: '#071018',
      strokeThickness: 4
    }).setOrigin(0.5).setDepth(300);
    this.tweens.add({ targets: text, y: y - 24, alpha: 0, duration: 640, ease: 'Cubic.easeOut', onComplete: () => text.destroy() });
  }
 
  private showHealText(target: DiceInstanceState, amount: number) {
    const fallbackHand = target.ownerId === 'player' ? this.handDice.get(target.instanceId) : undefined;
    if (!target.gridPosition && !fallbackHand) return;
    const x = target.gridPosition
      ? (this.getGridContainerForDie(target)).x + target.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2
      : fallbackHand!.x;
    const y = target.gridPosition
      ? (this.getGridContainerForDie(target)).y + target.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2 - 18
      : fallbackHand!.y - 24;
    const text = this.add.text(x, y, `+${amount}`, {
      fontFamily: 'Orbitron',
      fontSize: '16px',
      color: '#7dff9f',
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
 
    const footprint = this.getFootprintForDefinition(definition);
    const visualSize = footprint * TILE_SIZE + (footprint - 1) * TILE_GAP - 8;
    const centerX = x + (footprint - 1) * (TILE_SIZE + TILE_GAP) / 2;
    const centerY = y + (footprint - 1) * (TILE_SIZE + TILE_GAP) / 2;
 
    const dieRect = this.add.rectangle(centerX, centerY, visualSize, visualSize, color, visual ? 0.55 : 0.28)
      .setStrokeStyle(2, color)
      .setInteractive({ useHandCursor: true });
    dieRect.setData('isDie', true);
    dieRect.on('pointerdown', () => {
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
    this.renderHealthBar(container, centerX, centerY + 18, die.currentHealth, die.maxHealth);
    const ammo = Math.max(0, die.attacksRemaining);
    const maxAmmo = Math.max(1, this.gameState.combatPhase === 'attacking'
      ? Math.max(this.attackCapacityByInstance.get(die.instanceId) ?? 1, die.attacksRemaining)
      : this.getPipCount(die.typeId));
    this.attackCapacityByInstance.set(die.instanceId, maxAmmo);
    this.renderAmmoBar(container, centerX, centerY + 28, ammo, maxAmmo);
    const meta = getRuntimeSkillMeta(definition);
    const isDeathTransformed = meta.hasDeathTransform && this.deathDiceTransformed.has(die.instanceId);
    const activeSlots = this.getActiveManaSlots(die);
    let nextBarY = centerY + 40;
    if (meta.canConjureSouls && !this.deathDiceTransformed.has(die.instanceId)) {
      const souls = this.getConjuredSoulCount(die, meta);
      const soulCap = meta.noMaxSouls ? Math.max(1, souls) : Math.max(1, meta.maxSouls ?? 2);
      this.renderManaBar(container, centerX, nextBarY, souls, soulCap, 0xc06bdb);
      if (activeSlots.length > 0) nextBarY += 7;
    }
    if (meta.hasDeathInstakill && !isDeathTransformed) return;
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
    const meta = getRuntimeSkillMeta(definition);
    const pip = liveDie.ownerId === 'player' ? (this.dicePips.get(liveDie.instanceId) ?? 0) : (this.enemyDicePips.get(liveDie.instanceId) ?? 0);
    const isPlacementPhase = this.gamePhase.stage === 'placement';
    const isDeathTransformed = meta.hasDeathTransform && this.deathDiceTransformed.has(liveDie.instanceId);
    const isTranscendenceTransformed = meta.hasTranscendence && (isPlacementPhase ? pip === 6 : this.transcendenceTransformed.has(liveDie.instanceId));
    const isOddPipTransformed = meta.transformOnOddPip && (isPlacementPhase ? pip % 2 === 1 : this.oddPipTransformed.has(liveDie.instanceId));
    const isAlternateTransformed = isDeathTransformed || isTranscendenceTransformed || isOddPipTransformed;
    const transformSkillIndices = new Set(meta.transformSkillIndices?.length ? meta.transformSkillIndices : meta.transformSkillIndex === undefined ? [] : [meta.transformSkillIndex]);
    const displayTitle = isAlternateTransformed ? (meta.transformTitle ?? definition.title) : definition.title;
    const typeUpgradeMult = this.getTypeUpgradeMultiplier(liveDie);
    const effectiveAtk = Math.max(1, Math.floor(definition.attack * typeUpgradeMult));
    const soulCount = meta.canConjureSouls ? this.getConjuredSoulCount(liveDie, meta) : 0;
    const soulCap = meta.maxSouls;
    const soulBoost = meta.soulBoostPercent !== undefined && soulCount > 0 ? ` (+${Math.round(meta.soulBoostPercent * soulCount * 100)}% stats)` : '';
    const soulNote = meta.canConjureSouls ? ` • SOULS ${soulCount}${meta.noMaxSouls || soulCap === undefined ? '' : `/${soulCap}`}${soulBoost}` : '';
    const footprintNote = this.getFootprintForDefinition(definition) > 1 ? ` • ${this.getFootprintForDefinition(definition)}x${this.getFootprintForDefinition(definition)}` : '';
    const stats = this.add.text(width / 2, 50, `${displayTitle} • HP ${liveDie.currentHealth}/${liveDie.maxHealth} • ATK ${effectiveAtk} • RNG ${definition.range}${footprintNote}${soulNote} • TARGET ${definition.targetingMode.toUpperCase()}`, {
      fontFamily: 'Orbitron',
      fontSize: '13px',
      color: PALETTE.text
    }).setOrigin(0.5);
    const activeSlots = this.getActiveManaSlots(liveDie);
    const mana = Math.max(0, ...activeSlots.map((slot) => this.getActiveMana(liveDie.instanceId, slot.key)));
    const shieldHp = this.shieldHpByInstance.get(liveDie.instanceId) ?? 0;
    const shieldNote = shieldHp > 0 ? ` • Shield ${shieldHp}` : '';
    const manaNote = activeSlots.length > 0 ? ` • Mana ${mana}` : '';
    const formatSkillType = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2');
    const classLevel = this.instanceClassLevels.get(liveDie.instanceId) ?? 1;
    const visibleSkills = definition.skills.filter((skill, index) => {
      if ((skill.modifiers?.notes ?? []).includes('runtime:unlockAtClass6') && classLevel < 6) return false;
      if (isAlternateTransformed && transformSkillIndices.size > 0) return transformSkillIndices.has(index);
      return !transformSkillIndices.has(index);
    });
    const desc = this.add.text(width / 2, 78, `${visibleSkills.map((skill) => `${skill.title} (${formatSkillType(skill.type)}): ${getClassScaledSkillDescription(definition, skill, typeUpgradeMult)}`).join(' | ')}${shieldNote}${manaNote}`, {
      fontFamily: 'Orbitron',
      fontSize: '11px',
      color: PALETTE.textMuted,
      wordWrap: { width: 530 }
    }).setOrigin(0.5, 0);
    const panelTop = 24;
    let nextBuffY = desc.y + desc.height + 8;
    const panelHeight = Math.max(112, nextBuffY - panelTop + (statusEffects.length > 0 ? 18 : 0) + (activeBuffs.length > 0 ? 18 : 0) + attackCountBuffs.length * 14 + 12);
    const panel = this.add.rectangle(width / 2, panelTop + panelHeight / 2, 560, panelHeight, 0x102434, 0.95).setStrokeStyle(2, 0x406987);
    const popupElements: Phaser.GameObjects.GameObject[] = [panel, stats, desc];
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
    const palette: Record<'slow' | 'poison' | 'berserk' | 'taunt' | 'fracture' | 'stun', { color: number; icon: string }> = {
      slow: { color: 0x8fd5ff, icon: '❄' },
      poison: { color: 0x74d66f, icon: '☠' },
      berserk: { color: 0xff4d4d, icon: '!' },
      taunt: { color: 0xffb347, icon: 'T' },
      fracture: { color: 0xffbf80, icon: '🜂' },
      stun: { color: 0xfff176, icon: 'S' }
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
      if (effect === 'poison') {
        const stacks = this.poisonByInstance.get(die.instanceId)?.stacks ?? 0;
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
      if (this.activeChallenge === 'bossfight') {
        if (this.bossfightBossDefeatedThisTurn) return false;
        this.bossfightBossDefeatedThisTurn = true;
        this.bossfightPendingReward = { boss: this.bossfightCurrentBoss, level: this.bossfightLevel };
        this.completeBossfightLevel(this.bossfightCurrentBoss, this.bossfightLevel);
        this.endGame('victory', `${this.bossfightCurrentBoss} Lv.${this.bossfightLevel} defeated! Next stage unlocked.`);
        return true;
      }
      if (this.activeChallenge === 'deucifer' && !this.deuciferBossSummoned) {
        this.deuciferBossPending = true;
        this.turnLimit = Math.max(this.turnLimit, 15);
        this.combatLog.setText('Deucifer rises next turn...');
        return false;
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
      const parsed = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
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
    localStorage.setItem(BOT_FIRST_WIN_KEY, JSON.stringify(next));
  }
 
  private getChallengeRewardClaims(): string[] {
    const stored = this.registry.get(CHALLENGE_REWARD_CLAIMS_KEY) as string[] | undefined;
    if (stored) return stored;
    try {
      const parsed = JSON.parse(localStorage.getItem(CHALLENGE_REWARD_CLAIMS_KEY) ?? '[]') as unknown;
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
    localStorage.setItem(CHALLENGE_REWARD_CLAIMS_KEY, JSON.stringify(next));
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
    const chipMessage = chipReward > 0 ? ` +${chipReward} Casino Chips awarded.` : '';
    const rewardMessage = `${message} +${tokenReward} Dice Tokens awarded.${chipMessage}`;
 
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
  }
