import Phaser from 'phaser';
import { getAllDiceDefinitions, getDiceDefinitions, getDiceProgress, getDiceTokens, setDiceTokens } from '../data/dice';
import {
  createMatchBattleState,
  getAvailableHandDice,
  placeDieOnBoard,
  getBoardDice,
  getLivingDiceCount,
  getNextAttacker,
  findAttackTarget,
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
import type { DiceTypeId, DiceInstanceState, DiceDefinition } from '../types/game';
import { buildSkillIndex } from '../data/SkillLoader';
import { getRuntimeSkillMeta } from '../systems/DiceSkills';
import { applyClassProgression } from '../systems/ClassProgression';
import { getCombatDistance, getCoveredEnemyColumns, getCoveredEnemyTileCount } from '../systems/CombatRange';
import { SCENE_KEYS } from './sceneKeys';
import { CasinoProgressStore } from '../systems/CasinoProgressStore';
import { AUDIO_KEYS, AudioManager } from '../utils/AudioManager';
import { AnimationManager } from '../utils/AnimationManager';
import { canOfferDiceCards, getDiceCardMagnitude, getDiceCardRarityRoll, rollDiceCards, type DiceCard, type DiceCardRarity } from '../systems/DiceCards';


type BotDifficulty = 'Baby' | 'Easy' | 'Medium' | 'Hard' | 'Nightmare';
type MatchResultStage = 'victory' | 'defeat' | 'draw';
type RandomModeModifier = 'Classic' | 'Combanity' | 'Duality' | 'Necromancy' | 'DiceCard';
type ChallengeKey = 'daily' | 'deucifer' | null;
type ChallengeStatus = 'not-started' | 'started' | 'completed' | 'failed';

interface GamePhase {
  stage: 'lobby' | 'placement' | 'combat' | 'resolved' | MatchResultStage;
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
  private shieldHpByInstance: Map<string, number> = new Map();
  private tauntedByInstance: Map<string, { sourceId: string; turns: number }> = new Map();
  private attackCapacityByInstance: Map<string, number> = new Map();
  private attackDeltaByInstance: Map<string, { delta: number; turns: number }> = new Map();
  private extraAttackTurnsByInstance: Map<string, { extra: number; turns: number }> = new Map();
  private attackMultiplierTurnsByInstance: Map<string, { multiplier: number; turns: number }> = new Map();
  private damageReductionByInstance: Map<string, number> = new Map();
  private poisonByInstance: Map<string, { damage: number; turns: number }> = new Map();
  private armorShredByInstance: Map<string, { rate: number; turns: number }> = new Map();
  private transcendenceTransformed: Set<string> = new Set();
  private rollAllButton!: Phaser.GameObjects.Rectangle;
  private rollAllButtonLabel!: Phaser.GameObjects.Text;
  private rollHelperText!: Phaser.GameObjects.Text;
  private diceRolled = false;
  private currentHandOrder: string[] = [];

  private lavaPoolsByTile: Map<string, { damage: number; turns: number }> = new Map();
  private deathDiceTransformed: Set<string> = new Set();
  private deathAlliesDefeatedCount: Map<string, number> = new Map();
  private permanentAttackBonusByInstance: Map<string, number> = new Map();
  private instanceDefinitionOverrides: Map<string, DiceDefinition> = new Map();
  private instanceClassLevels: Map<string, number> = new Map();
  private enemyLoadoutRevealed = false;
  private rangeHighlightObjects: Phaser.GameObjects.GameObject[] = [];
  private highlightedRangeInstanceId: string | null = null;

  private modalContainer: Phaser.GameObjects.Container | null = null;
  private modalEscHandler: (() => void) | null = null;
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
  private assassinBoostAttacksByInstance: Map<string, number> = new Map();
  private diceCardPicksUsed = 0;

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
    this.shieldHpByInstance.clear();
    this.tauntedByInstance.clear();
    this.attackDeltaByInstance.clear();
    this.extraAttackTurnsByInstance.clear();
    this.attackMultiplierTurnsByInstance.clear();
    this.damageReductionByInstance.clear();
    this.poisonByInstance.clear();
    this.armorShredByInstance.clear();
    this.diceRolled = false;
    this.currentHandOrder = [];
    this.activeRandomModifier = null;
    this.transcendenceTransformed.clear();
    this.lavaPoolsByTile.clear();
    this.deathDiceTransformed.clear();
    this.deathAlliesDefeatedCount.clear();
    this.permanentAttackBonusByInstance.clear();
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
    this.diceTypeUpgradeBonus.clear();
    this.spotlightByInstance.clear();
    this.giantHunterRateByOwner = { player: 0, enemy: 0 };
    this.fountainHealRateByOwner = { player: 0, enemy: 0 };
    this.manaPotionGainByOwner = { player: 0, enemy: 0 };
    this.assassinBoostAttacksByInstance.clear();
    this.diceCardPicksUsed = 0;
  }

  create() {
    this.resetRuntimeState();
    const layout = getLayout(this);

    this.definitions = new Map(getAllDiceDefinitions(this).map((die) => [die.typeId, die]));
    this.skillIndex = buildSkillIndex([...this.definitions.values()]);

    AudioManager.playMusic(this, 'arena-music');
    this.createBackground(layout);
    this.createLobbyUI();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.tweens.killAll();
      this.time.removeAllEvents();
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

    const rules = this.add.text(centerX, centerY + 120, [
      'Win: Defeat all enemy dice',
      'Lose: All your dice are defeated',
      '',
      '5x5 Grid • Turn-based Combat'
    ].join('\n'), {
      fontFamily: 'Orbitron',
      fontSize: '14px',
      color: PALETTE.textMuted,
      align: 'center'
    }).setOrigin(0.5);

    this.uiContainer.add([wipBadge, title, subtitle, playButton, rules]);
  }

  // ── MATCH MODE MODAL ────────────────────────────────────────────────────────

  private clearModeModal() {
    this.clearModalEsc();
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
      { key: 'matchmaking',  label: 'MATCHMAKING',  desc: 'Pure PvP vs real players.\nNo bots — no turn limit.' },
      { key: 'singleplayer', label: 'SINGLEPLAYER', desc: 'Battle a bot opponent.\nFully configurable.' },
      { key: 'multiplayer',  label: 'MULTIPLAYER',  desc: 'Play against friends.\nFully configurable.' }
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
      this.add.text(cx, cy - 60, 'Pure PvP — No bots, no turn limit.', {
        fontFamily: 'Orbitron', fontSize: '14px', color: PALETTE.text
      }).setOrigin(0.5),
      this.add.text(cx, cy - 22, 'Automatically finds a real opponent in the matchmaking\nqueue. Requires real players to be online.', {
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
      fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.textMuted,
      backgroundColor: '#1e3347', padding: { left: 12, right: 12, top: 7, bottom: 7 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    queueBtn.on('pointerdown', () => {
      AlertManager.toast(this, { type: 'warning', message: 'Online matchmaking is not yet available.' });
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
    createOption(cx, cy + 2, 'Bossfight', 'WIP: bossfight content and rulesets are coming soon.', 0x6f5bb5, () => {
      AlertManager.toast(this, { type: 'warning', message: 'Bossfight is a WIP feature and is not implemented yet.' });
    });
    createOption(cx + 220, cy + 2, 'Challenges', 'Daily PvE + Deucifer boss challenge.', 0x5d6770, () => this.openChallengesModal());

    const backBtn = this.add.text(cx, cy + 126, '← BACK', {
      fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.accentSoft,
      backgroundColor: '#173247', padding: { left: 12, right: 12, top: 7, bottom: 7 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backBtn.on('pointerdown', () => this.openModeSelectModal());
    elements.push(backBtn);

    this.modalContainer = this.add.container(0, 0, elements).setDepth(250);
    this.setModalEsc(() => this.openModeSelectModal());
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
    const makeBtn = (x: number, y: number, label: string, sub: string, onClick: () => void) => {
      const r = this.add.rectangle(x, y, 280, 120, 0x173247, 0.96).setStrokeStyle(2, 0x406987).setInteractive({ useHandCursor: true });
      const t = this.add.text(x, y - 28, label, { fontFamily: 'Orbitron', fontSize: '16px', color: PALETTE.accent }).setOrigin(0.5);
      const d = this.add.text(x, y + 2, sub, { fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.textMuted, align: 'center', wordWrap: { width: 250 } }).setOrigin(0.5, 0);
      r.on('pointerdown', onClick);
      return [r, t, d];
    };
    const daily = makeBtn(cx - 170, cy, `Daily Challenge${this.dailyHard ? ' ☠ HARD!' : ''}`, `Status: ${this.getChallengeStatusLabel(dailyStatus)}\nRandom mode mashup • Reward: ${this.dailyHard ? '1600 Tokens + 20 Chips' : '800 Tokens + 10 Chips'}`, () => {
      this.activeChallenge = 'daily';
      this.setChallengeStatus('daily', 'started');
      this.configRandomMode = true;
      this.configRandomizeLoadoutAndClassUps = true;
      this.configUseLevelling = true;
      this.configDifficulty = this.dailyHard ? 'Nightmare' : 'Medium';
      this.turnLimit = 10;
      this.clearModeModal();
      this.startGame();
    });
    const deuc = makeBtn(cx + 170, cy, `Deucifer's Challenge`, `Status: ${this.getChallengeStatusLabel(deuciferStatus)}\nNightmare Deucifer\nClassic • 10 Turns • Reward: 7500 Tokens + 50 Chips`, () => {
      this.activeChallenge = 'deucifer';
      this.activeDailyKey = '';
      this.setChallengeStatus('deucifer', 'started');
      this.configRandomMode = false;
      this.configRandomizeLoadoutAndClassUps = false;
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
      this.add.rectangle(cx, cy, 760, 360, 0x102434, 0.98).setStrokeStyle(2, 0x335770),
      this.add.text(cx, cy - 145, 'CHALLENGES', { fontFamily: 'Orbitron', fontSize: '22px', color: PALETTE.accent }).setOrigin(0.5),
      ...daily, ...deuc, back
    ]).setDepth(250);
    this.setModalEsc(() => this.openSingleplayerModal());
  }


  private getDailySeededModifier(): RandomModeModifier {
    const modifiers: RandomModeModifier[] = ['Classic', 'Combanity', 'Duality', 'Necromancy', 'DiceCard'];
    const key = this.activeDailyKey || new Date().toISOString().slice(0, 10);
    const seed = [...`${key}:modifier:v2`].reduce((acc, ch) => ((acc * 31) + ch.charCodeAt(0)) >>> 0, 2166136261);
    return modifiers[seed % modifiers.length] ?? 'Classic';
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

  private openSingleplayerConfigModal() {
    this.activeChallenge = null;
    this.turnLimit = this.configTurnCount;
    this.configRandomizeLoadoutAndClassUps = false;
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

    this.makeSelectRow(
      [{ label: 'BABY', value: 'Baby' as const }, { label: 'EASY', value: 'Easy' as const }, { label: 'MEDIUM', value: 'Medium' as const }, { label: 'HARD', value: 'Hard' as const }, { label: 'NIGHTMARE', value: 'Nightmare' as const }],
      () => this.configDifficulty, (v) => { this.configDifficulty = v; },
      cx + 72, cy - 118, rowContainer
    );
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

    const noteText = this.add.text(cx, cy + 84, 'Difficulty changes bot loadout, class range, and placement style.\nFirst win on each difficulty grants bonus Tokens + Chips.', {
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
      this.add.rectangle(cx, cy, 640, 370, 0x102434, 0.98).setStrokeStyle(2, 0x335770),
      this.add.text(cx, cy - 158, 'MULTIPLAYER', {
        fontFamily: 'Orbitron', fontSize: '22px', color: PALETTE.accent
      }).setOrigin(0.5),
      this.add.text(cx - 265, cy - 90, 'Use Levelling', {
        fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.textMuted
      }).setOrigin(0, 0.5),
      this.add.text(cx - 265, cy - 28, 'Turn Count', {
        fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.textMuted
      }).setOrigin(0, 0.5)
    );

    const rowContainer = this.add.container(0, 0);
    elements.push(rowContainer);

    this.makeSelectRow(
      [{ label: 'ON', value: true }, { label: 'OFF', value: false }],
      () => this.configUseLevelling, (v) => { this.configUseLevelling = v; },
      cx - 12, cy - 90, rowContainer
    );
    this.makeSelectRow(
      [{ label: '3', value: 3 }, { label: '5', value: 5 }, { label: '7', value: 7 }, { label: '10', value: 10 }, { label: '∞', value: -1 }],
      () => this.configTurnCount, (v) => { this.configTurnCount = v; },
      cx + 84, cy - 28, rowContainer
    );

    const noteText = this.add.text(cx, cy + 32, 'Play against friends in the same session.\nOnline connectivity for remote matches coming soon.', {
      fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.textMuted, align: 'center'
    }).setOrigin(0.5);
    elements.push(noteText);

    const backBtn = this.add.text(cx - 90, cy + 140, '← BACK', {
      fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.accentSoft,
      backgroundColor: '#173247', padding: { left: 12, right: 12, top: 7, bottom: 7 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backBtn.on('pointerdown', () => this.openModeSelectModal());
    elements.push(backBtn);

    const queueBtn = this.add.text(cx + 90, cy + 140, 'QUEUE →', {
      fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.textMuted,
      backgroundColor: '#1e3347', padding: { left: 16, right: 16, top: 7, bottom: 7 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    queueBtn.on('pointerdown', () => {
      AlertManager.toast(this, { type: 'warning', message: 'Online multiplayer is not yet available.' });
    });
    elements.push(queueBtn);

    this.modalContainer = this.add.container(0, 0, elements).setDepth(250);
    this.setModalEsc(() => this.openModeSelectModal());
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
    const btnW = options.length > 4 ? 88 : 72;
    const gap = 8;
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
        fontFamily: 'Orbitron', fontSize: '12px', color: '#99b2c3'
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

    this.resetRuntimeState();

    this.turnLimit = selectedTurnLimit === -1 ? this.configTurnCount : selectedTurnLimit;
    this.activeChallenge = selectedChallenge;
    this.activeDailyKey = selectedDailyKey;
    this.dailyHard = selectedDailyHard;
    this.configRandomMode = selectedRandomMode;
    this.configRandomizeLoadoutAndClassUps = selectedRandomizeLoadoutAndClassUps;
    this.configDifficulty = selectedDifficulty;
    this.configUseLevelling = selectedUseLevelling;
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
    const playerLoadoutDefinitions = shouldRandomizeLoadoutAndClassUps ? this.pickRandomEnemyLoadout(allDefinitions) : getDiceDefinitions(this);

    const effectiveLevel = (raw: number) => this.configUseLevelling ? raw : 1;

    const playerClassLevels = new Map<DiceTypeId, number>();
    const playerDefs = playerLoadoutDefinitions
      .map((definition) => {
        const classLevel = shouldRandomizeLoadoutAndClassUps && this.configUseLevelling
          ? (this.activeChallenge === 'daily'
            ? this.getDailySeededIndex(`player-class-${definition.typeId}-${playerClassLevels.size}`, 15) + 1
            : Phaser.Math.Between(1, 15))
          : effectiveLevel(getDiceProgress(this, definition.typeId).classLevel);
        playerClassLevels.set(definition.typeId, classLevel);
        return this.applyClassProgress(definition, classLevel);
      });

    const enemyRawDefs = this.activeChallenge === 'deucifer'
      ? ['Poison', 'Solitude', 'Judgment', 'Skull', 'Death']
        .map((typeId) => allDefinitions.find((d) => d.typeId === typeId))
        .filter((d): d is DiceDefinition => Boolean(d))
      : this.pickRandomEnemyLoadout(allDefinitions);
    const enemyDefs = enemyRawDefs.map((definition) => {
      const classLevel = this.activeChallenge === 'deucifer'
        ? 11
        : shouldRandomizeLoadoutAndClassUps && this.configUseLevelling
        ? (this.activeChallenge === 'daily'
          ? this.getDailySeededIndex(`enemy-class-${definition.typeId}-${this.enemyClassLevels.size}`, 15) + 1
          : Phaser.Math.Between(1, 15))
        : effectiveLevel(this.rollEnemyClassLevel());
      this.enemyClassLevels.set(definition.typeId, classLevel);
      return this.applyClassProgress(definition, classLevel);
    });

    this.gameState = createMatchBattleState(playerDefs, enemyDefs);
    if (this.configRandomMode) {
      const modifiers: RandomModeModifier[] = ['Classic', 'Combanity', 'Duality', 'Necromancy', 'DiceCard'];
      this.activeRandomModifier = this.activeChallenge === 'daily'
        ? this.getDailySeededModifier()
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
    if (this.configRandomMode) this.combatLog.setText(`Random Mode: ${this.activeRandomModifier ?? 'Classic'} selected.`);
  }

  private getDefinitionForInstance(die: DiceInstanceState): DiceDefinition | undefined {
    return this.instanceDefinitionOverrides.get(die.instanceId) ?? this.definitions.get(die.typeId);
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

    this.rollHelperText = this.add.text(width / 2, handY - 84, 'CLICK ROLL ALL, THEN DRAG DICE TO YOUR GRID', {
      fontFamily: 'Orbitron',
      fontSize: '14px',
      color: PALETTE.accent
    }).setOrigin(0.5);

    this.createRollAllButton(width / 2, handY - 58);

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

    const existingDie = this.gameState.dice.find((die) =>
      die.ownerId === 'player' &&
      die.zone === 'board' &&
      die.gridPosition?.row === gridPos.row &&
      die.gridPosition?.col === gridPos.col
    );

    if (existingDie) {
      this.returnDieToHand(container, instanceId);
      return;
    }

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
      this.combatLog.setText(`Place ${requiredDice - this.placedDiceCount} more dice...`);
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

    this.enemyDicePips.clear();
    this.attackCapacityByInstance.clear();
    this.transcendenceTransformed.clear();
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
    this.applyShieldTauntsAtCombatStart();
    await this.applyBatteryManaAtCombatStart();
    this.applyManaPotionAtCombatStart();

    this.applyLavaPoolDamageAtCombatStart();
    this.renderDice();
    this.renderEnemyDice();
    this.renderLavaPools();

    if (this.checkWinConditions()) return;

    await this.runCombatLoop();
  }


  private computeAttackCount(instanceId: string, basePips: number, timeDelta = 0): number {
    const debuff = this.attackDeltaByInstance.get(instanceId)?.delta ?? 0;
    const buff = this.extraAttackTurnsByInstance.get(instanceId)?.extra ?? 0;
    const mult = this.attackMultiplierTurnsByInstance.get(instanceId)?.multiplier ?? 1;
    const permanent = this.permanentAttackBonusByInstance.get(instanceId) ?? 0;
    const adjusted = Math.max(1, basePips + timeDelta + debuff + buff + permanent);
    return Math.max(1, Math.floor(adjusted * mult));
  }

  private beginCombatPhaseWithRolledPips(): MatchBattleState {
    const playerBoardDice = getBoardDice(this.gameState, 'player');
    const enemyBoardDice = getBoardDice(this.gameState, 'enemy');
    const playerBonus = playerBoardDice.reduce((sum, die) => {
      const definition = this.getDefinitionForInstance(die);
      if (!definition) return sum;
      return sum + (getRuntimeSkillMeta(definition).combatStartExtraAttacks ?? 0);
    }, 0);
    const enemyBonus = enemyBoardDice.reduce((sum, die) => {
      const definition = this.getDefinitionForInstance(die);
      if (!definition) return sum;
      return sum + (getRuntimeSkillMeta(definition).combatStartExtraAttacks ?? 0);
    }, 0);
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

    let nextState: MatchBattleState = {
      ...this.gameState,
      combatPhase: 'attacking',
      dice: this.gameState.dice.map((die) => {
        if (die.zone !== 'board' || die.isDestroyed) {
          return die;
        }

        const basePips = rolledPipsFor(die);
        const definition = this.getDefinitionForInstance(die);
        if (definition && getRuntimeSkillMeta(definition).hasTranscendence && basePips === 6) {
          this.transcendenceTransformed.add(die.instanceId);
        }
        const pips = basePips + (die.ownerId === 'player' ? playerBonus : enemyBonus);
        const allyPipAttackAuras = die.ownerId === 'player' ? playerPipAttackAuras : enemyPipAttackAuras;
        const foePipAttackAuras = die.ownerId === 'player' ? enemyPipAttackAuras : playerPipAttackAuras;
        const pipAuraDelta = sumMatchingDelta(allyPipAttackAuras, die, 'ally') + sumMatchingDelta(foePipAttackAuras, die, 'foe');
        if (pipAuraDelta !== 0) this.animateTimeMark(die, pipAuraDelta > 0 ? 0x8fd5ff : 0xff6b6b);
        const withPermanent = this.computeAttackCount(die.instanceId, pips, pipAuraDelta);

        return {
          ...die,
          hasFinishedAttacking: false,
          attacksRemaining: Math.max(1, withPermanent)
        };
      })
    };
    if (this.configRandomMode && this.activeRandomModifier === 'Combanity') {
      nextState = this.applyCombanityBonuses(nextState);
    }
    nextState.dice.forEach((die) => {
      if (die.zone === 'board' && !die.isDestroyed) this.attackCapacityByInstance.set(die.instanceId, Math.max(1, die.attacksRemaining));
    });
    [...playerBoardDice, ...enemyBoardDice].forEach((die) => {
      const definition = this.getDefinitionForInstance(die);
      if (!definition) return;
      const meta = getRuntimeSkillMeta(definition);
      const hasCombatStart = (meta.combatStartExtraAttacks ?? 0) > 0;
      const hasPassivePipAura = (meta.pipMatchAllyAttackDelta ?? 0) !== 0 || (meta.pipMatchFoeAttackDelta ?? 0) !== 0;
      if (hasCombatStart || hasPassivePipAura) this.playSkillSfxForDie(die);
      if (definition.typeId === 'Light' && hasCombatStart && die.gridPosition) {
        const grid = die.ownerId === 'player' ? this.playerGridContainer : this.enemyGridContainer;
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
    if (groups[0] === 5) return { multiplier: 10, reduction: 1, label: 'Five-of-a-kind' };
    if (groups[0] === 4) return { multiplier: 5, reduction: 0.5, label: 'Four-of-a-kind' };
    if (groups[0] === 3 && groups[1] === 2) return { multiplier: 4, reduction: 0.35, label: 'Full House' };
    if (isLargeStraight) return { multiplier: 2.5, reduction: 0.25, label: 'Large Straight' };
    if (isSmallStraight) return { multiplier: 2, reduction: 0.2, label: 'Small Straight' };
    if (groups[0] === 3) return { multiplier: 3, reduction: 0, label: 'Three-of-a-kind' };
    if (groups[0] === 2 && groups[1] === 2) return { multiplier: 2, reduction: 0, label: 'Two Pair' };
    if (groups[0] === 2) return { multiplier: 1.5, reduction: 0, label: 'Pair' };
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
        this.attackMultiplierTurnsByInstance.set(die.instanceId, { multiplier: bonus.multiplier, turns: 1 });
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
    const grid = die.ownerId === 'player' ? this.playerGridContainer : this.enemyGridContainer;
    const x = grid.x + die.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const y = grid.y + die.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    void color;
    AnimationManager.animateTimeActive(this, x, y);
  }

  private getManaCapForDie(die: DiceInstanceState): number {
    const def = this.getDefinitionForInstance(die);
    if (!def) return 0;
    const meta = getRuntimeSkillMeta(def);
    if (meta.hasDeathInstakill && this.deathDiceTransformed.has(die.instanceId)) return meta.deathInstakillMana ?? 12;
    return meta.activeManaNeeded ?? 0;
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
          const grid = ally.ownerId === 'player' ? this.playerGridContainer : this.enemyGridContainer;
          const x = grid.x + ally.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
          const y = grid.y + ally.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
          AnimationManager.animateBatteryCharge(this, x, y, ally.instanceId === battery.instanceId ? 0x95c2ff : 0x3f5573);
          playedChargeVisual = true;
        }
        if (!allyDef) return;
        const cap = this.getManaCapForDie(ally);
        if (cap <= 0) return;
        const current = this.manaByInstance.get(ally.instanceId) ?? 0;
        this.manaByInstance.set(ally.instanceId, Math.min(cap, current + gain));
      });
    });
    if (playedChargeVisual) await this.delay(500);
  }

  private applyManaPotionAtCombatStart() {

    const boardDice = this.gameState.dice.filter((d) => d.zone === 'board' && !d.isDestroyed);
    boardDice.forEach((ally) => {
      const allyDef = this.getDefinitionForInstance(ally);
      if (!allyDef) return;
      const cap = this.getManaCapForDie(ally);
      if (cap <= 0) return;
      const gain = this.manaPotionGainByOwner[ally.ownerId];
      if (gain <= 0) return;
      const current = this.manaByInstance.get(ally.instanceId) ?? 0;
      this.manaByInstance.set(ally.instanceId, Math.min(cap, current + gain));
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
        const btn = this.add.rectangle(x, 10, 150, 130, 0x16344a, 0.95).setStrokeStyle(2, 0xf0c36a).setInteractive({ useHandCursor: true });
        const tx = this.add.text(x, 2, `${card.rarity}\n${card.title}`, { fontFamily: 'Orbitron', fontSize: '13px', color: '#ffffff', align: 'center', wordWrap: { width: 138 } }).setOrigin(0.5);
        btn.on('pointerdown', () => { c.destroy(true); resolve(card); });
        c.add([btn, tx]);
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
      this.gameState = {
        ...this.gameState,
        dice: this.gameState.dice.map((d) => {
          if (d.ownerId !== owner || d.typeId !== card.typeId) return d;
          const boostedMax = Math.max(1, Math.floor(d.maxHealth * (1 + bonusRate)));
          const healthRate = d.maxHealth > 0 ? d.currentHealth / d.maxHealth : 1;
          return { ...d, maxHealth: boostedMax, currentHealth: Math.min(boostedMax, Math.max(1, Math.floor(boostedMax * healthRate))) };
        })
      };
    }
    if (card.kind === 'Giant Hunter') { this.giantHunterRateByOwner[owner] += [0, 0.01, 0.02, 0.03][mag]; }
    this.renderDiceCardInfoPanel();
  }

  private applyShieldTauntsAtCombatStart() {
    this.tauntedByInstance.clear();
    const boardDice = this.gameState.dice.filter((d) => d.zone === 'board' && !d.isDestroyed && d.gridPosition);
    const shields = boardDice.filter((d) => {
      const def = this.getDefinitionForInstance(d);
      return def?.skills.some((sk) => (sk.modifiers?.notes ?? []).includes('runtime:shieldTaunt')) ?? false;
    });
    shields.forEach((shield) => {
      const def = this.getDefinitionForInstance(shield);
      const skill = def?.skills.find((sk) => (sk.modifiers?.notes ?? []).includes('runtime:shieldTaunt'));
      const range = skill?.modifiers?.tauntRange ?? 0;
      const turns = skill?.modifiers?.tauntDuration ?? 1;
      if (range <= 0) return;
      boardDice.filter((foe) => foe.ownerId !== shield.ownerId).forEach((foe) => {
        const dist = getCombatDistance(shield, foe);
        if (dist <= range) this.tauntedByInstance.set(foe.instanceId, { sourceId: shield.instanceId, turns });
      });
    });
  }

  private getTypeUpgradeMultiplier(attacker: DiceInstanceState): number {
    const bonusRate = this.diceTypeUpgradeBonus.get(`${attacker.ownerId}:${attacker.typeId}`) ?? 0;
    return 1 + Math.max(0, bonusRate);
  }

  private getSpotlightScale(die: DiceInstanceState): number {
    const data = this.spotlightByInstance.get(die.instanceId);
    if (!data) return 0;
    const pip = die.ownerId === 'player' ? (this.dicePips.get(die.instanceId) ?? 1) : (this.enemyDicePips.get(die.instanceId) ?? 1);
    return pip === 3 ? data.reduction : 0;
  }

  private getOffenseMultiplier(attacker: DiceInstanceState): number {
    const typeBoost = this.getTypeUpgradeMultiplier(attacker);
    return typeBoost * (1 + this.getSpotlightScale(attacker));
  }

  private getDiceCardSkillDamageMultiplier(attacker: DiceInstanceState): number {
    if (attacker.typeId === 'Iron' || attacker.typeId === 'Solitude') return 1;
    return this.getOffenseMultiplier(attacker);
  }

  private applyAssassinCombatStart() {
    const boardDice = this.gameState.dice.filter((d) => d.zone === 'board' && !d.isDestroyed && d.gridPosition);
    const assassins = boardDice.filter((d) => {
      const def = this.getDefinitionForInstance(d);
      return def?.skills.some((sk) => (sk.modifiers?.notes ?? []).includes('runtime:assassinBacklineTeleport')) ?? false;
    });
    assassins.forEach((assassin) => {
      const foes = boardDice.filter((d) => d.ownerId !== assassin.ownerId && d.gridPosition);
      if (foes.length === 0) return;
      const furthest = [...foes].sort((a, b) => {
        const da = Math.abs((a.gridPosition?.col ?? 0) - (assassin.gridPosition?.col ?? 0));
        const db = Math.abs((b.gridPosition?.col ?? 0) - (assassin.gridPosition?.col ?? 0));
        return db - da;
      })[0];
      const skill = this.getDefinitionForInstance(assassin)?.skills.find((sk) => (sk.modifiers?.notes ?? []).includes('runtime:assassinBacklineTeleport'));
      const jumpRange = skill?.modifiers?.jumpRange ?? -1;
      const mirroredFurthestCol = GRID_SIZE - 1 - furthest.gridPosition!.col;
      const targetCol = jumpRange < 0
        ? mirroredFurthestCol
        : (assassin.ownerId === 'player'
          ? Math.min(GRID_SIZE - 1, (assassin.gridPosition?.col ?? 0) + jumpRange)
          : Math.max(0, (assassin.gridPosition?.col ?? 0) - jumpRange));
      const targetRow = furthest.gridPosition!.row;
      const occupied = new Set(
        this.gameState.dice
          .filter((d) => d.zone === 'board' && !d.isDestroyed && d.ownerId === assassin.ownerId && d.instanceId !== assassin.instanceId && d.gridPosition)
          .map((d) => `${d.gridPosition!.row},${d.gridPosition!.col}`)
      );
      const preferredDir = assassin.ownerId === 'player' ? -1 : 1;
      const colCandidates = [targetCol, targetCol + preferredDir, targetCol - preferredDir, targetCol + preferredDir * 2, targetCol - preferredDir * 2].filter((c) => c >= 0 && c < GRID_SIZE);
      let chosen: { row: number; col: number } | null = null;
      for (const c of colCandidates) {
        for (const r of [targetRow, targetRow - 1, targetRow + 1, targetRow - 2, targetRow + 2, 0, 1, 2, 3, 4]) {
          if (r>=0 && r<5 && !occupied.has(`${r},${c}`)) { chosen = { row: r, col: c }; break; }
        }
        if (chosen) break;
      }
      if (!chosen) return;
      this.gameState = { ...this.gameState, dice: this.gameState.dice.map((d)=> d.instanceId===assassin.instanceId ? { ...d, gridPosition: chosen!, attacksRemaining: d.attacksRemaining + 1 } : d ) };
      const passive = this.getDefinitionForInstance(assassin)?.skills.find((sk)=>sk.type==='Passive');
      const passiveMods = passive?.modifiers as { numAttacksBoosted?: number } | undefined;
      this.assassinBoostAttacksByInstance.set(assassin.instanceId, Math.max(0, passiveMods?.numAttacksBoosted ?? 0));
    });
  }

  private resolveTauntForcedTarget(attacker: DiceInstanceState): DiceInstanceState | undefined {
    const taunt = this.tauntedByInstance.get(attacker.instanceId);
    if (!taunt) return undefined;
    const shield = this.gameState.dice.find((d) => d.instanceId === taunt.sourceId && d.zone === 'board' && !d.isDestroyed && d.gridPosition);
    if (!shield || !shield.gridPosition || !attacker.gridPosition) return undefined;
    const distance = getCombatDistance(attacker, shield);
    const shieldDef = this.getDefinitionForInstance(shield);
    const tauntSkill = shieldDef?.skills.find((sk) => (sk.modifiers?.notes ?? []).includes('runtime:shieldTaunt'));
    const tauntRange = tauntSkill?.modifiers?.tauntRange ?? 2;
    return distance <= tauntRange ? shield : undefined;
  }

  private applyLavaPoolDamageAtCombatStart() {
    if (this.lavaPoolsByTile.size === 0) return;
    const allBoardDice = this.gameState.dice.filter(d => d.zone === 'board' && !d.isDestroyed && d.gridPosition);
    allBoardDice.forEach(die => {
      const tileKey = `${die.ownerId}:${die.gridPosition!.row},${die.gridPosition!.col}`;
      const pool = this.lavaPoolsByTile.get(tileKey);
      if (pool) {
        const wasAlive = !die.isDestroyed;
        this.gameState = this.applyDamageWithRevive(die.instanceId, pool.damage);
        const after = this.gameState.dice.find((d) => d.instanceId === die.instanceId);
        if (wasAlive && after?.isDestroyed) this.checkDeathTransformCondition(die);
        this.combatLog.setText(`${die.typeId} takes ${pool.damage} lava damage from the pool!`);
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
    const owners: ['player', 'enemy'] = ['player', 'enemy'];

    let timedOut = false;
    for (const owner of owners) {
      const ownerName = owner === 'player' ? 'Your' : 'Enemy';

      while (true) {
        if (this.combatTimeRemainingMs <= 0) {
          timedOut = true;
          break;
        }

        const boostedAssassin = this.gameState.dice
          .filter((die) => die.ownerId === owner && die.zone === 'board' && !die.isDestroyed && !die.hasFinishedAttacking && die.attacksRemaining > 0)
          .find((die) => (this.assassinBoostAttacksByInstance.get(die.instanceId) ?? 0) > 0);
        const attacker = boostedAssassin ?? getNextAttacker(this.gameState, owner);
        if (!attacker) break;

        const beamTarget = this.findTranscendenceBeamTarget(attacker);
        const forcedTarget = this.resolveTauntForcedTarget(attacker);
        const target = forcedTarget ?? beamTarget ?? findAttackTarget(this.gameState, attacker, this.getDefinitionsForCombat(attacker));
        if (!target) {
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

        const attackerDef = this.getDefinitionForInstance(attacker);
        const attackerMeta = attackerDef ? getRuntimeSkillMeta(attackerDef) : undefined;
        const currMana = this.manaByInstance.get(attacker.instanceId) ?? 0;
        const meteorFires = (attackerMeta?.hasMeteorStrike ?? false) && currMana >= (attackerMeta?.activeManaNeeded ?? 7);
        const deathFires = (attackerMeta?.hasDeathInstakill ?? false) && this.deathDiceTransformed.has(attacker.instanceId) && currMana >= (attackerMeta?.deathInstakillMana ?? 12);
        const regularActiveFires = (attackerMeta?.activeManaNeeded ?? 0) > 0 && currMana >= (attackerMeta?.activeManaNeeded ?? 0) && !attackerMeta?.hasMeteorStrike && !attackerMeta?.hasDeathInstakill;
        const anyActiveFires = meteorFires || deathFires || regularActiveFires;
        const skipBasicAttack = anyActiveFires;

        let damage = 0;
        let targetDestroyed = false;

        if (!skipBasicAttack) {
          if (beamTarget) {
            this.playAttackSfx(attacker, attackerMeta);
            const result = this.executeTranscendenceBeam(attacker, target);
            damage = result.damage;
            targetDestroyed = result.targetDestroyed;
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
            const proportional = Math.max(0, Math.floor(target.currentHealth * ironRate));
            const nonProportional = Math.max(1, rawResult.damage - proportional);
            const scaledNonProportional = Math.floor(nonProportional * multiplier);
            const giantHunter = this.giantHunterRateByOwner[attacker.ownerId] > 0 ? Math.max(0, Math.floor(target.maxHealth * this.giantHunterRateByOwner[attacker.ownerId])) : 0;
            const assassinBoost = (this.assassinBoostAttacksByInstance.get(attacker.instanceId) ?? 0) > 0 ? 2 : 1;
            const adjustedDamage = Math.max(1, Math.floor((scaledNonProportional + proportional + solitudeBonus + giantHunter) * offenseMult * assassinBoost));
            this.gameState = spendAttack(this.gameState, attacker.instanceId);
            this.gameState = this.applyDamageWithRevive(target.instanceId, adjustedDamage);
            damage = adjustedDamage;
            targetDestroyed = this.gameState.dice.find((d) => d.instanceId === target.instanceId)?.isDestroyed ?? false;
            this.showDamageText(target, damage);
            this.applyPassiveSkillEffects(attacker, target);
            const rem = this.assassinBoostAttacksByInstance.get(attacker.instanceId) ?? 0;
            if (rem > 0) this.assassinBoostAttacksByInstance.set(attacker.instanceId, rem - 1);
          }
        } else {
          this.gameState = spendAttack(this.gameState, attacker.instanceId);
        }

        if (anyActiveFires) {
          const sfxKey = attackerMeta?.skillSfxKey ?? AUDIO_KEYS.skillTrigger;
          AudioManager.playSfx(this, sfxKey);
        }
        await this.applyActiveSkillEffects(attacker, target);
        if (this.combatTimeRemainingMs <= 0) {
          timedOut = true;
          break;
        }
        if (targetDestroyed) {
          await this.applyOnKillSkillEffects(attacker, target);
          this.applyOnDeathSkillEffects(target, attacker);
          this.checkDeathTransformCondition(target);
        }

        this.combatLog.setText(
          skipBasicAttack
            ? `${ownerName} ${attacker.typeId} uses active skill!`
            : `${ownerName} ${attacker.typeId} attacks ${target.typeId} for ${damage} damage!${targetDestroyed ? ' DESTROYED!' : ''}`
        );

        if (!beamTarget && !skipBasicAttack) this.animateAttack(attacker, target);
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
    this.applyTimedSkillDecay();
    this.gameState = resolveCombatPhase(this.gameState);
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

    await this.maybeRunDiceCardDraft();
    this.gameState = endTurn(this.gameState);
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

  private getStatusEffects(die: DiceInstanceState): Array<'slow' | 'poison' | 'berserk' | 'taunt' | 'fracture'> {
    const effects: Array<'slow' | 'poison' | 'berserk' | 'taunt' | 'fracture'> = [];
    if ((this.attackDeltaByInstance.get(die.instanceId)?.delta ?? 0) < 0) effects.push('slow');
    if (this.poisonByInstance.has(die.instanceId)) effects.push('poison');
    if (this.isBerserkActive(die)) effects.push('berserk');
    if (this.tauntedByInstance.has(die.instanceId)) effects.push('taunt');
    if (this.armorShredByInstance.has(die.instanceId)) effects.push('fracture');
    return effects;
  }

  private getPlayerHandDie(instanceId: string): DiceInstanceState | undefined {
    return this.gameState.dice.find((die) => die.ownerId === 'player' && die.instanceId === instanceId && die.zone === 'hand' && !die.isDestroyed);
  }


  private applyDamageWithRevive(instanceId: string, damage: number): MatchBattleState {
    let reduction = this.damageReductionByInstance.get(instanceId) ?? 0;
    const die = this.gameState.dice.find((d) => d.instanceId === instanceId);
    if (die) reduction += this.getSpotlightScale(die);
    reduction = Phaser.Math.Clamp(reduction, 0, 0.95);
    if (reduction > 0) damage = Math.max(0, Math.floor(damage * (1 - reduction)));
    const armorShred = this.armorShredByInstance.get(instanceId);
    if (armorShred && armorShred.rate > 0) damage = Math.max(1, Math.floor(damage * (1 + armorShred.rate)));
    const shieldHp = this.shieldHpByInstance.get(instanceId) ?? 0;
    if (shieldHp > 0) {
      const absorbed = Math.min(shieldHp, Math.max(0, damage));
      const remaining = Math.max(0, damage - absorbed);
      const nextShield = shieldHp - absorbed;
      if (nextShield > 0) this.shieldHpByInstance.set(instanceId, nextShield);
      else this.shieldHpByInstance.delete(instanceId);
      if (remaining <= 0) return this.gameState;
      damage = remaining;
    }
    const before = this.gameState.dice.find((die) => die.instanceId === instanceId);
    const beforePosition = before?.gridPosition;
    const nextState = applyDamage(this.gameState, instanceId, damage);
    const after = nextState.dice.find((die) => die.instanceId === instanceId);
    if (!before || !after?.isDestroyed) return nextState;
    AudioManager.playSfx(this, AUDIO_KEYS.diceDie);
    const definition = this.getDefinitionForInstance(before);
    const reviveChance = definition ? getRuntimeSkillMeta(definition).reviveChance : undefined;
    if (!reviveChance || Math.random() >= reviveChance) return nextState;

    this.animateSkullRevive(before);
    return {
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
    };
  }

  private getPierceBehindTargets(attacker: DiceInstanceState, target: DiceInstanceState, range: number): DiceInstanceState[] {
    if (!attacker.gridPosition || !target.gridPosition || range <= 0) return [];
    const rowStep = Math.sign(target.gridPosition.row - attacker.gridPosition.row);
    const colStep = attacker.ownerId === 'player' ? 1 : -1;
    const enemies = getBoardDice(this.gameState, target.ownerId);
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
      other.gridPosition
    );
    return !allies.some((other) => {
      const dr = Math.abs(other.gridPosition!.row - die.gridPosition!.row);
      const dc = Math.abs(other.gridPosition!.col - die.gridPosition!.col);
      return dr <= 1 && dc <= 1;
    });
  }

  private getSolitudeBasicAttackBonus(attacker: DiceInstanceState, target: DiceInstanceState): number {
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition || !attacker.gridPosition) return 0;
    const meta = getRuntimeSkillMeta(definition);
    if (!meta.hasSolitudePreCombat || meta.targetMaxHpBonusRate === undefined) return 0;
    if (!this.isSolitudeIsolated(attacker)) return 0;
    return Math.max(1, Math.floor(target.maxHealth * meta.targetMaxHpBonusRate));
  }

  private applyPassiveSkillEffects(attacker: DiceInstanceState, target: DiceInstanceState) {
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition || !target.gridPosition) return;
    const meta = getRuntimeSkillMeta(definition);
    if (meta.splashDamage) {
      const splashTargets = getBoardDice(this.gameState, target.ownerId).filter((die) =>
        die.instanceId !== target.instanceId &&
        die.gridPosition &&
        Math.abs(die.gridPosition.row - target.gridPosition!.row) <= 1 &&
        Math.abs(die.gridPosition.col - target.gridPosition!.col) <= 1
      );
      if (splashTargets.length > 0) this.playSkillSfxForDie(attacker, meta);
      splashTargets.forEach((die) => {
        const dealt = Math.max(1, Math.ceil(meta.splashDamage! * this.getCombanityDamageMultiplier(attacker, die) * this.getOffenseMultiplier(attacker)));
        this.gameState = this.applyDamageWithRevive(die.instanceId, dealt);
        this.showDamageText(die, dealt, '#ff9f58');
        if (this.gameState.dice.find((d) => d.instanceId === die.instanceId)?.isDestroyed) this.checkDeathTransformCondition(die);
        this.animateSkillEffect('fire', attacker, die);
      });
    }
    if (meta.chainDamage) {
      const chainTarget = getBoardDice(this.gameState, target.ownerId).find((die) =>
        die.instanceId !== target.instanceId &&
        die.gridPosition &&
        Math.abs(die.gridPosition.row - target.gridPosition!.row) <= 2 &&
        Math.abs(die.gridPosition.col - target.gridPosition!.col) <= 2
      );
      if (chainTarget) {
        this.playSkillSfxForDie(attacker, meta);
        const dealt = Math.max(1, Math.ceil(meta.chainDamage * this.getCombanityDamageMultiplier(attacker, chainTarget) * this.getOffenseMultiplier(attacker)));
        this.gameState = this.applyDamageWithRevive(chainTarget.instanceId, dealt);
        this.showDamageText(chainTarget, dealt, '#fff176');
        if (this.gameState.dice.find((d) => d.instanceId === chainTarget.instanceId)?.isDestroyed) this.checkDeathTransformCondition(chainTarget);
        this.animateSkillEffect('electric', attacker, chainTarget);
      }
    }

    if (meta.pierceBehindRange) {
      this.playSkillSfxForDie(attacker, meta);
      this.getPierceBehindTargets(attacker, target, meta.pierceBehindRange).forEach((die) => {
        const pierceDamage = Math.max(1, Math.floor(definition.attack * this.getCombanityDamageMultiplier(attacker, die) * this.getDiceCardSkillDamageMultiplier(attacker)));
        this.gameState = this.applyDamageWithRevive(die.instanceId, pierceDamage);
        this.showDamageText(die, pierceDamage, '#c9d6d3');
        if (this.gameState.dice.find((d) => d.instanceId === die.instanceId)?.isDestroyed) this.checkDeathTransformCondition(die);
      });
    }
  }

  private async applyActiveSkillEffects(attacker: DiceInstanceState, target: DiceInstanceState) {
    const applyDirectDamage = (victim: DiceInstanceState, baseDamage: number): number => {
      const multiplier = this.getCombanityDamageMultiplier(attacker, victim);
      const giantHunter = this.giantHunterRateByOwner[attacker.ownerId] > 0 ? Math.max(0, Math.floor(victim.maxHealth * this.giantHunterRateByOwner[attacker.ownerId])) : 0;
      const adjustedDamage = Math.max(1, Math.floor((baseDamage + giantHunter) * multiplier * this.getDiceCardSkillDamageMultiplier(attacker)));
      this.gameState = this.applyDamageWithRevive(victim.instanceId, adjustedDamage);
      return adjustedDamage;
    };
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition) return;
    const meta = getRuntimeSkillMeta(definition);

    if (meta.hasMeteorStrike) {
      const manaNeeded = meta.activeManaNeeded ?? 7;
      const currentMana = this.manaByInstance.get(attacker.instanceId) ?? 0;
      if (currentMana >= manaNeeded) {
        const enemyOwner = attacker.ownerId === 'player' ? 'enemy' : 'player';
        const enemies = getBoardDice(this.gameState, enemyOwner);
        if (enemies.length > 0) {
          const meteorTarget = enemies[Math.floor(Math.random() * enemies.length)];
          const freshTarget = this.gameState.dice.find(d => d.instanceId === meteorTarget.instanceId);
          if (freshTarget && !freshTarget.isDestroyed) {
            const meteorDamage = meta.meteorDamage ?? 60;
            const lavaDamage = meta.lavaDamage ?? 25;
            this.animateMeteorStrike(freshTarget);
            await this.delayCombatVisualPaced(1000);
            const dealt = applyDirectDamage(freshTarget, meteorDamage);
            this.showDamageText(freshTarget, dealt, '#ff9f58');
            if (freshTarget.gridPosition) {
              const origin = freshTarget.gridPosition;
              const tiles = [origin, { row: origin.row - 1, col: origin.col }, { row: origin.row + 1, col: origin.col }, { row: origin.row, col: origin.col - 1 }, { row: origin.row, col: origin.col + 1 }]
                .filter((tile) => tile.row >= 0 && tile.row < GRID_SIZE && tile.col >= 0 && tile.col < GRID_SIZE);
              tiles.forEach((tile) => {
                const lavaKey = `${enemyOwner}:${tile.row},${tile.col}`;
                this.lavaPoolsByTile.set(lavaKey, { damage: lavaDamage, turns: 3 });
              });
            }
            const destroyed = this.gameState.dice.find(d => d.instanceId === freshTarget.instanceId)?.isDestroyed;
            if (destroyed) this.checkDeathTransformCondition(freshTarget);
            this.combatLog.setText(`☄️ ${attacker.typeId} meteor strikes ${freshTarget.typeId} for ${meteorDamage} damage! Lava pool placed!${destroyed ? ' DESTROYED!' : ''}`);
          }
        }
        this.manaByInstance.set(attacker.instanceId, 0);
      } else {
        this.manaByInstance.set(attacker.instanceId, Math.min(manaNeeded, currentMana + 1));
      }
      return;
    }

    if (meta.hasDeathInstakill && this.deathDiceTransformed.has(attacker.instanceId)) {
      const instakillMana = meta.deathInstakillMana ?? 12;
      const currentMana = this.manaByInstance.get(attacker.instanceId) ?? 0;
      if (currentMana >= instakillMana) {
        const freshTarget = this.gameState.dice.find(d => d.instanceId === target.instanceId);
        if (freshTarget && !freshTarget.isDestroyed) {
          AudioManager.playSfx(this, AUDIO_KEYS.deathInstakill);
          this.gameState = this.applyDamageWithRevive(freshTarget.instanceId, freshTarget.currentHealth);
          this.showDamageText(freshTarget, freshTarget.currentHealth, '#c57cff');
          this.combatLog.setText(`☠️ Death Dice's Reaper's Touch instantly kills ${freshTarget.typeId}!`);
          const destroyed = this.gameState.dice.find(d => d.instanceId === freshTarget.instanceId)?.isDestroyed;
          if (destroyed) {
            await this.applyOnKillSkillEffects(attacker, freshTarget);
            this.applyOnDeathSkillEffects(freshTarget, attacker);
            this.checkDeathTransformCondition(freshTarget);
          }
        }
        this.manaByInstance.set(attacker.instanceId, 0);
      } else {
        this.manaByInstance.set(attacker.instanceId, Math.min(instakillMana, currentMana + 1));
      }
      return;
    }

    const manaNeeded = meta.activeManaNeeded ?? 0;
    const currentMana = this.manaByInstance.get(attacker.instanceId) ?? 0;
    const canCastActive = manaNeeded > 0 && currentMana >= manaNeeded;
    const windBuffTurns = this.attackMultiplierTurnsByInstance.get(attacker.instanceId)?.turns ?? 0;
    const windMultiplierActive = attacker.typeId === 'Wind' && windBuffTurns > 0;
    if (!canCastActive) {
      if (manaNeeded > 0 && !windMultiplierActive) this.manaByInstance.set(attacker.instanceId, Math.min(manaNeeded, currentMana + 1));
      return;
    }
    if (meta.hasSpearActive) {
      const freshTarget = this.gameState.dice.find(d => d.instanceId === target.instanceId);
      if (freshTarget && !freshTarget.isDestroyed) {
        this.animateSpearActive(attacker, freshTarget);
        const primaryDamage = Math.max(1, Math.ceil(meta.activeDamage ?? 104));
        const dealt = applyDirectDamage(freshTarget, primaryDamage);
        this.showDamageText(freshTarget, dealt, '#dbe7e4');
        if (this.gameState.dice.find((d) => d.instanceId === freshTarget.instanceId)?.isDestroyed) this.checkDeathTransformCondition(freshTarget);
        this.getPierceBehindTargets(attacker, freshTarget, 2).forEach((die) => {
          const pierceDamage = Math.max(1, Math.ceil(meta.pierceBehindDamage ?? 208));
          const dealt = applyDirectDamage(die, pierceDamage);
          this.showDamageText(die, dealt, '#b58cff');
          if (this.gameState.dice.find((d) => d.instanceId === die.instanceId)?.isDestroyed) this.checkDeathTransformCondition(die);
        });
      }
      this.manaByInstance.set(attacker.instanceId, 0);
      return;
    }
    if (meta.activeHeal !== undefined) {
      const healTarget = this.getWeakestDamagedAlly(attacker.ownerId, attacker.instanceId);
      if (healTarget) {
        this.playSkillSfxForDie(attacker, meta);
        const healAmount = Math.max(1, Math.ceil(meta.activeHeal * this.getCombanityDamageMultiplier(attacker, healTarget) * this.getTypeUpgradeMultiplier(attacker)));
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
    }
    if ((meta.shield ?? 0) > 0) {
      this.playSkillSfxForDie(attacker, meta);
      const shieldGain = Math.max(1, Math.ceil((meta.shield ?? 0) * this.getCombanityDamageMultiplier(attacker, attacker) * this.getTypeUpgradeMultiplier(attacker)));
      this.shieldHpByInstance.set(attacker.instanceId, (this.shieldHpByInstance.get(attacker.instanceId) ?? 0) + shieldGain);
      this.showHealText(attacker, shieldGain);
    }
    if (attacker.typeId === 'Ice') {
      const freshTarget = this.gameState.dice.find(d => d.instanceId === target.instanceId);
      if (freshTarget && !freshTarget.isDestroyed) {
        const dealt = applyDirectDamage(freshTarget, Math.max(1, Math.ceil(meta.activeDamage ?? 16)));
        this.showDamageText(freshTarget, dealt, '#8fd5ff');
        this.gameState = {
          ...this.gameState,
          dice: this.gameState.dice.map((die) => {
            if (die.instanceId !== freshTarget.instanceId || die.isDestroyed || die.attacksRemaining <= 0) return die;
            const attacksRemaining = Math.max(1, die.attacksRemaining - 1);
            return { ...die, attacksRemaining, hasFinishedAttacking: attacksRemaining === 0 };
          })
        };
        if (this.gameState.dice.find((d) => d.instanceId === freshTarget.instanceId)?.isDestroyed) this.checkDeathTransformCondition(freshTarget);
        this.animateSkillEffect('ice', attacker, freshTarget);
      }
    }
    if (attacker.typeId === 'Poison') {
      const poisonDamage = Math.max(1, Math.ceil(meta.poisonDamage ?? 0));
      const poisonTurns = Math.max(1, meta.activeDurationTurns ?? 0);
      const freshTarget = this.gameState.dice.find(d => d.instanceId === target.instanceId);
      if (freshTarget && !freshTarget.isDestroyed) {
        const activePoisonDamage = Math.max(1, Math.ceil(meta.activeDamage ?? poisonDamage));
        const dealt = applyDirectDamage(freshTarget, activePoisonDamage);
        this.showDamageText(freshTarget, dealt, '#89f57a');
      }
      const existing = this.poisonByInstance.get(target.instanceId);
      this.poisonByInstance.set(target.instanceId, { damage: (existing?.damage ?? 0) + poisonDamage, turns: (existing?.turns ?? 0) + poisonTurns });
      this.animateSkillEffect('poison', attacker, target);
    }

    const shouldApplyGenericActiveDamage = meta.activeDamage !== undefined && !meta.hasSpearActive && !meta.hasMeteorStrike && !(meta.hasDeathInstakill && this.deathDiceTransformed.has(attacker.instanceId)) && attacker.typeId !== 'Ice' && attacker.typeId !== 'Poison';
    if (shouldApplyGenericActiveDamage) {
      const freshTarget = this.gameState.dice.find(d => d.instanceId === target.instanceId);
      if (freshTarget && !freshTarget.isDestroyed) {
        const dealt = applyDirectDamage(freshTarget, Math.max(1, Math.ceil(meta.activeDamage ?? 1)));
        this.showDamageText(freshTarget, dealt, '#ffbf80');
        if (this.gameState.dice.find((d) => d.instanceId === freshTarget.instanceId)?.isDestroyed) this.checkDeathTransformCondition(freshTarget);
      }
    }

    if ((meta.activeExtraAttacks ?? 0) > 0 && (meta.activeDurationTurns ?? 0) > 0) {
      if (attacker.typeId === 'Wind') {
        if (attacker.gridPosition) {
          const g = attacker.ownerId === 'player' ? this.playerGridContainer : this.enemyGridContainer;
          const x = g.x + attacker.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
          const y = g.y + attacker.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
          AnimationManager.animateElementalSkill(this, x, y, 'wind', 0x9fe7d9);
        }
        this.attackMultiplierTurnsByInstance.set(attacker.instanceId, { multiplier: 2, turns: meta.activeDurationTurns! });
        const freshAttacker = this.gameState.dice.find(d => d.instanceId === attacker.instanceId);
        if (freshAttacker && !freshAttacker.isDestroyed) {
          this.gameState = {
            ...this.gameState,
            dice: this.gameState.dice.map(d =>
              d.instanceId === attacker.instanceId
                ? { ...d, attacksRemaining: Math.max(0, d.attacksRemaining) + Math.max(1, meta.activeExtraAttacks ?? 1), hasFinishedAttacking: false }
                : d
            )
          };
        }
      } else {
        this.extraAttackTurnsByInstance.set(attacker.instanceId, { extra: meta.activeExtraAttacks!, turns: meta.activeDurationTurns! });
      }
    }
    if ((meta.armorShredRate ?? 0) > 0 && (meta.activeDurationTurns ?? 0) > 0) {
      this.armorShredByInstance.set(target.instanceId, { rate: meta.armorShredRate!, turns: meta.activeDurationTurns! });
      const freshTarget = this.gameState.dice.find(d => d.instanceId === target.instanceId);
      if (freshTarget) this.showDamageText(freshTarget, 0, '#ffbf80', 'FRACTURE');
    }
    if ((meta.activeAttackDelta ?? 0) !== 0 && (meta.activeDurationTurns ?? 0) > 0) {
      this.attackDeltaByInstance.set(target.instanceId, { delta: meta.activeAttackDelta!, turns: meta.activeDurationTurns! });
      if (attacker.typeId === 'Ice') this.animateSkillEffect('ice', attacker, target);
    }
    this.manaByInstance.set(attacker.instanceId, 0);
  }

  private checkDeathTransformCondition(defeated: DiceInstanceState) {
    const owner = defeated.ownerId;
    const deathDice = this.gameState.dice.filter((die) =>
      die.ownerId === owner &&
      !die.isDestroyed &&
      die.typeId === 'Death'
    );

    deathDice.forEach((deathDie) => {
      if (this.deathDiceTransformed.has(deathDie.instanceId)) return;
      const definition = this.getDefinitionForInstance(deathDie);
      if (!definition || !getRuntimeSkillMeta(definition).hasDeathTransform) return;

      const defeatedAllies = this.gameState.dice.filter((die) =>
        die.ownerId === owner &&
        die.instanceId !== deathDie.instanceId &&
        die.isDestroyed
      ).length;
      const previous = this.deathAlliesDefeatedCount.get(deathDie.instanceId) ?? 0;
      const cap = getRuntimeSkillMeta(definition).maxSouls ?? 2;
      const count = Math.min(cap, Math.max(previous, defeatedAllies));
      this.deathAlliesDefeatedCount.set(deathDie.instanceId, count);

      if (count >= 2) {
        this.deathDiceTransformed.add(deathDie.instanceId);
        this.gameState = {
          ...this.gameState,
          dice: this.gameState.dice.map((die) =>
            die.instanceId === deathDie.instanceId
              ? { ...die, maxHealth: die.maxHealth * 2, currentHealth: die.maxHealth * 2 }
              : die
          )
        };
        this.manaByInstance.set(deathDie.instanceId, 0);
        this.combatLog.setText('☠️ Death Dice transforms! Max HP doubled — Instakill Form ACTIVE!');
        this.animateTransformEffect(deathDie);
      }
    });
  }

  private applyCombatEndSkills() {
    this.gameState = {
      ...this.gameState,
      dice: this.gameState.dice.map((die) => {
        if (die.zone !== 'board' || die.isDestroyed) return die;
        const definition = this.getDefinitionForInstance(die);
        if (!definition) return die;
        const meta = getRuntimeSkillMeta(definition);
        const bonus = meta.combatEndExtraAttacks ?? 0;

        if (meta.hasGrowthPermanent) {
          const current = this.permanentAttackBonusByInstance.get(die.instanceId) ?? 0;
          this.permanentAttackBonusByInstance.set(die.instanceId, current + 1);
        }

        return bonus > 0 ? { ...die, attacksRemaining: Math.max(0, die.attacksRemaining + bonus) } : die;
      })
    };
  }

  private applyTimedSkillDecay() {
    this.tauntedByInstance.forEach((value, key) => {
      const turns = value.turns - 1;
      if (turns <= 0) this.tauntedByInstance.delete(key);
      else this.tauntedByInstance.set(key, { ...value, turns });
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

  private applyTurnBasedEffects() {
    this.gameState = { ...this.gameState, dice: this.gameState.dice.map((die) => {
      if (die.zone !== 'board' || die.isDestroyed) return die;
      const rate = this.fountainHealRateByOwner[die.ownerId];
      if (rate <= 0) return die;
      return { ...die, currentHealth: Math.min(die.maxHealth, die.currentHealth + Math.max(1, Math.floor(die.maxHealth * rate))) };
    }) };
    const newlyDefeated: DiceInstanceState[] = [];
    this.poisonByInstance.forEach((effect, instanceId) => {
      if (effect.turns <= 0) return;
      this.gameState = {
        ...this.gameState,
        dice: this.gameState.dice.map((die) => {
          if (die.instanceId !== instanceId || die.isDestroyed) return die;
          const currentHealth = Math.max(0, die.currentHealth - effect.damage);
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
    newlyDefeated.forEach((die) => this.checkDeathTransformCondition(die));
    if (newlyDefeated.length > 0) AudioManager.playSfx(this, AUDIO_KEYS.diceDie);
  }

  private async returnDiceToHand() {
    this.gamePhase = { stage: 'placement' };
    this.combatTimeRemainingMs = 30_000;
    this.combatCountdownTriggered = false;
    this.updateCombatTimerUi();
    this.placedDiceCount = 0;
    this.diceRolled = false;
    this.dicePips.clear();

    this.handDice.forEach((container) => container.destroy());
    this.handDice.clear();

    this.renderDice();
    this.renderEnemyDice();
    this.syncBerserkSfxState();

    const { width, height } = this.scale;
    const handY = height - 110;
    this.currentHandOrder = getAvailableHandDice(this.gameState, 'player').map((die) => die.instanceId);
    const startX = (width - (this.currentHandOrder.length * 100)) / 2 + 50;

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

    this.rollAllButton.setInteractive({ useHandCursor: true });
    this.rollAllButton.setFillStyle(0xf4b860, 0.9);
    this.rollAllButtonLabel.setText('ROLL ALL!');
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
    const isPlayerAttacker = attacker.ownerId === 'player';
    const attackerGrid = isPlayerAttacker ? this.playerGridContainer : this.enemyGridContainer;
    const targetGrid = target.ownerId === 'player' ? this.playerGridContainer : this.enemyGridContainer;
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

  private animateMeteorStrike(target: DiceInstanceState) {
    if (!target.gridPosition) return;
    const targetGrid = target.ownerId === 'player' ? this.playerGridContainer : this.enemyGridContainer;
    const tx = targetGrid.x + target.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const ty = targetGrid.y + target.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
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
        this.tweens.add({ targets: burst, scale: 3.2, alpha: 0, duration: 220, onComplete: () => burst.destroy() });
      }
    });
  }

  private animateSkullRevive(die: DiceInstanceState) {
    if (die.typeId !== 'Skull' || !die.gridPosition) return;
    const grid = die.ownerId === 'player' ? this.playerGridContainer : this.enemyGridContainer;
    const x = grid.x + die.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const y = grid.y + die.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    AnimationManager.animateSkullRevive(this, x, y);
  }

  private animateTransformEffect(die: DiceInstanceState) {
    if (!die.gridPosition) return;
    const grid = die.ownerId === 'player' ? this.playerGridContainer : this.enemyGridContainer;
    const x = grid.x + die.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const y = grid.y + die.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    AnimationManager.animateDeathTransform(this, x, y);
  }

  private animateAttack(attacker: DiceInstanceState, target: DiceInstanceState) {
    if (!attacker.gridPosition || !target.gridPosition) return;

    const isPlayerAttacker = attacker.ownerId === 'player';
    const attackerGrid = isPlayerAttacker ? this.playerGridContainer : this.enemyGridContainer;
    const targetGrid = isPlayerAttacker ? this.enemyGridContainer : this.playerGridContainer;

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


  private animateTranscendenceBeam(attacker: DiceInstanceState, target: DiceInstanceState) {
    if (!attacker.gridPosition || !target.gridPosition) return;

    const isPlayerAttacker = attacker.ownerId === 'player';
    const attackerGrid = isPlayerAttacker ? this.playerGridContainer : this.enemyGridContainer;
    const targetGrid = isPlayerAttacker ? this.enemyGridContainer : this.playerGridContainer;

    const attackerX = attackerGrid.x + attacker.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const attackerY = attackerGrid.y + attacker.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const targetX = targetGrid.x + target.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const targetY = targetGrid.y + target.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const boardWidth = GRID_SIZE * (TILE_SIZE + TILE_GAP) - TILE_GAP;
    const rowY = targetGrid.y + target.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    
    AnimationManager.animateTranscendenceBeamFx(this, attackerX, attackerY, targetGrid.x, rowY, targetX, targetY, boardWidth);
  }


  private animateJudgmentHammer(ownerId: 'player' | 'enemy', row: number, col: number) {
    const grid = ownerId === 'player' ? this.enemyGridContainer : this.playerGridContainer;
    const x = grid.x + col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const y = grid.y + row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    AnimationManager.animateJudgmentHammer(this, x, y, 420);
  }

  private animateSpearActive(attacker: DiceInstanceState, target: DiceInstanceState) {
    if (!attacker.gridPosition || !target.gridPosition) return;
    const attackerGrid = attacker.ownerId === 'player' ? this.playerGridContainer : this.enemyGridContainer;
    const targetGrid = target.ownerId === 'player' ? this.playerGridContainer : this.enemyGridContainer;
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

    const enemyDice = getBoardDice(this.gameState, 'enemy');
    enemyDice.forEach((die: DiceInstanceState) => {
      if (die.gridPosition) {
        this.renderDie(this.enemyGridContainer, die, die.gridPosition.row, die.gridPosition.col, false);
      }
    });
    const statusDice = enemyDice.length > 0 || !this.enemyLoadoutRevealed
      ? enemyDice
      : this.gameState.dice.filter((die) => die.ownerId === 'enemy' && !die.isDestroyed);
    this.renderDiceStatusPanel(this.enemyStatusPanel, statusDice, "OPPONENT'S DICE", false);
  }

  private generateEnemyPositions() {
    const enemyHandDice = getAvailableHandDice(this.gameState, 'enemy');
    const usedCells = new Set<string>();

    for (const die of enemyHandDice) {
      const definition = this.definitions.get(die.typeId);
      const range = definition?.range ?? 4;
      let row: number, col: number, key: string;
      let attempts = 0;
      do {
        row = Phaser.Math.Between(0, GRID_SIZE - 1);
        col = this.pickEnemyColumn(range);
        key = `${row},${col}`;
        attempts++;
      } while (usedCells.has(key) && attempts < 50);
      usedCells.add(key);
      this.gameState = placeDieOnBoard(this.gameState, die.instanceId, row, col);
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
        if (range <= 3) return 0;
        if (range === 4) return 1;
        if (range === 5) return 2;
        return this.pickRandomColumn([3, 4]);
      case 'Medium':
      default:
        return Phaser.Math.Between(0, GRID_SIZE - 1);
    }
  }


  private getDiceCardDescription(key: string): { icon: string; title: string; rarity: string; desc: string } {
    const [name, rarity = ''] = key.split(':');
    const mag = getDiceCardMagnitude((rarity || 'Bronze') as DiceCardRarity);
    if (name.endsWith(' Upgrade')) {
      const pct = [0, 50, 75, 100][mag];
      const typeName = name.replace(' Upgrade', '');
      return { icon: '⬆️', title: name, rarity, desc: `${typeName} gets +${pct}% basic+skill damage and max HP.` };
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
    if (name === 'Giant Hunter') {
      const pct = [0, 1, 2, 3][mag];
      return { icon: '🗡️', title: name, rarity, desc: `Passive: direct damage adds ${pct}% target max HP.` };
    }
    return { icon: '🎴', title: name, rarity, desc: '' };
  }

  private renderDiceCardInfoPanel() {
    this.diceCardInfoContainer?.destroy(true);
    const playerKeys = [...this.activeDiceCardKeysByOwner.player];
    const enemyKeys = [...this.activeDiceCardKeysByOwner.enemy];
    if (playerKeys.length === 0 && enemyKeys.length === 0) return;
    const y = this.scale.height - 30;
    const c = this.add.container(0, 0).setDepth(350);
    this.diceCardInfoContainer = c;
    const tip = this.add.text(this.scale.width / 2 - 110, y - 70, '', { fontFamily: 'Orbitron', fontSize: '12px', color: '#fff2d8', backgroundColor: '#102030', padding: { x: 8, y: 6 }, wordWrap: { width: 210 } }).setDepth(351).setVisible(false);
    const renderSide=(keys:string[], right:boolean)=>{
      keys.slice(-8).forEach((key, idx) => {
      const info = this.getDiceCardDescription(key);
      const px = right ? this.scale.width - 24 - (idx*24) : 24 + (idx*24);
      const icon = this.add.text(px, y, info.icon, { fontSize: '18px' }).setOrigin(right ? 1 : 0, 1).setInteractive({ useHandCursor: true });
      icon.on('pointerover', () => { tip.setText(`${info.title} (${info.rarity})\n${info.desc}`).setVisible(true); });
      icon.on('pointerout', () => tip.setVisible(false));
      c.add(icon);
    });};
    renderSide(playerKeys,false);
    renderSide(enemyKeys,true);
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

    const playerDice = getBoardDice(this.gameState, 'player');
    playerDice.forEach((die: DiceInstanceState) => {
      if (die.gridPosition) {
        this.renderDie(this.playerGridContainer, die, die.gridPosition.row, die.gridPosition.col, true);
      }
    });
    const livingPlayerDice = this.gameState.dice.filter((die) => die.ownerId === 'player' && !die.isDestroyed);
    const statusDice = this.gameState.turn <= 1 && this.gameState.combatPhase !== 'attacking'
      ? playerDice
      : livingPlayerDice;
    this.renderDiceStatusPanel(this.playerStatusPanel, statusDice, 'YOUR DICE', true);
  }

  private renderDiceStatusPanel(panel: Phaser.GameObjects.Container, dice: DiceInstanceState[], title: string, centered: boolean) {
    panel.removeAll(true);
    panel.add(this.add.text(0, 0, title, { fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.accentSoft }).setOrigin(centered ? 0.5 : 0, 0));
    dice.forEach((diceUnit, index) => {
      const visual = this.getTransformedVisual(diceUnit);
      const classLevel = this.instanceClassLevels.get(diceUnit.instanceId) ?? 1;
      const shieldHp = this.shieldHpByInstance.get(diceUnit.instanceId) ?? 0;
      const shieldTag = shieldHp > 0 ? ` | SH ${shieldHp}` : '';
      const status = diceUnit.isDestroyed ? 'DEFEATED' : `${diceUnit.currentHealth}/${diceUnit.maxHealth} HP${shieldTag}${visual ? ` ${visual.symbol}` : ''}`;
      panel.add(this.add.text(0, 20 + index * 16, `${diceUnit.typeId} C${classLevel}/15: ${status}`, { fontFamily: 'Orbitron', fontSize: '11px', color: diceUnit.isDestroyed ? PALETTE.danger : (visual?.accent ?? PALETTE.textMuted) }).setOrigin(centered ? 0.5 : 0, 0));
    });
  }

  private pickRandomEnemyLoadout(pool: DiceDefinition[]): DiceDefinition[] {
    if (this.activeChallenge === 'daily') {
      const weighted = this.buildDifficultyWeightedPool(pool);
      const byId = new Map(weighted.map((d) => [d.typeId, d]));
      const unique = [...new Set(weighted.map((d) => d.typeId))].sort();
      const selected: DiceDefinition[] = [];
      for (let i = 0; i < 5 && unique.length > 0; i++) {
        const idx = this.getDailySeededIndex(`loadout-${i}`, unique.length);
        const typeId = unique.splice(idx, 1)[0];
        const def = byId.get(typeId);
        if (def) selected.push(def);
      }
      return selected.slice(0, 5);
    }

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
    const bonus = meta.onKillExtraAttacks ?? 0;
    if (bonus > 0) {
      this.playSkillSfxForDie(attacker, meta);
      this.gameState = {
        ...this.gameState,
        dice: this.gameState.dice.map((die) => die.instanceId === attacker.instanceId ? { ...die, attacksRemaining: die.attacksRemaining + bonus, hasFinishedAttacking: false } : die)
      };
    }
    if (meta.hasJudgmentHammer) {
      this.playSkillSfxForDie(attacker, meta);
      await this.dropJudgmentHammer(attacker, meta.hammerDamage ?? 150, new Set<string>());
    }
  }

  private async dropJudgmentHammer(attacker: DiceInstanceState, damage: number, chainGuard: Set<string>) {
    const enemyOwner = attacker.ownerId === 'player' ? 'enemy' : 'player';
    const weakest = getBoardDice(this.gameState, enemyOwner)
      .filter((die) => die.gridPosition)
      .sort((a, b) => a.currentHealth - b.currentHealth || a.maxHealth - b.maxHealth)[0];
    if (!weakest?.gridPosition || chainGuard.has(weakest.instanceId)) return;
    chainGuard.add(weakest.instanceId);
    const center = weakest.gridPosition;
    await this.delayCombatVisualPaced(500);
    if (!this.sys.isActive()) return;
    this.animateJudgmentHammer(attacker.ownerId, center.row, center.col);
    const victims = getBoardDice(this.gameState, enemyOwner).filter((die) =>
      die.gridPosition &&
      Math.abs(die.gridPosition.row - center.row) <= 1 &&
      Math.abs(die.gridPosition.col - center.col) <= 1
    );
    const defeatedByHammer: DiceInstanceState[] = [];
    victims.forEach((die) => {
      const dealt = Math.max(1, Math.floor(damage * this.getCombanityDamageMultiplier(attacker, die) * this.getDiceCardSkillDamageMultiplier(attacker)));
      this.gameState = this.applyDamageWithRevive(die.instanceId, dealt);
      this.showDamageText(die, dealt, '#ffd36f');
      const destroyed = this.gameState.dice.find((d) => d.instanceId === die.instanceId)?.isDestroyed ?? false;
      if (destroyed) {
        defeatedByHammer.push(die);
        this.checkDeathTransformCondition(die);
      }
    });
    if (defeatedByHammer.length > 0 && chainGuard.size < 10) {
      await this.dropJudgmentHammer(attacker, damage, chainGuard);
    }
  }

  private applyOnDeathSkillEffects(defeated: DiceInstanceState, _attacker: DiceInstanceState) {
    const definition = this.getDefinitionForInstance(defeated);
    if (!definition) return;
    const bonus = getRuntimeSkillMeta(definition).onDeathExtraAttacks ?? 0;
    if (bonus <= 0) return;
    this.playSkillSfxForDie(defeated);
    const allyOwner = defeated.ownerId;
    const ally = getBoardDice(this.gameState, allyOwner).find((die) => die.instanceId !== defeated.instanceId);
    if (!ally) return;
    this.gameState = {
      ...this.gameState,
      dice: this.gameState.dice.map((die) => die.instanceId === ally.instanceId ? { ...die, attacksRemaining: die.attacksRemaining + bonus, hasFinishedAttacking: false } : die)
    };
  }

  private playSkillSfxForDie(die: DiceInstanceState, providedMeta?: ReturnType<typeof getRuntimeSkillMeta>) {
    const definition = this.getDefinitionForInstance(die);
    if (!definition) return;
    const meta = providedMeta ?? getRuntimeSkillMeta(definition);
    AudioManager.playSfx(this, meta.skillSfxKey ?? AUDIO_KEYS.skillTrigger);
  }

  private executeTranscendenceBeam(attacker: DiceInstanceState, target: DiceInstanceState): { damage: number; targetDestroyed: boolean } {
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition || !attacker.gridPosition || !target.gridPosition) {
      return { damage: 0, targetDestroyed: false };
    }

    const meta = getRuntimeSkillMeta(definition);
    const damage = meta.beamDamage ?? 300;
    const targetPos = target.gridPosition;
    const enemyOwner = attacker.ownerId === 'player' ? 'enemy' : 'player';
    const victims = getBoardDice(this.gameState, enemyOwner).filter((die) =>
      die.gridPosition &&
      (die.instanceId === target.instanceId || die.gridPosition.row === targetPos.row)
    );

    let primaryDestroyed = false;
    victims.forEach((die) => {
      const dealt = Math.max(1, Math.floor(damage * this.getCombanityDamageMultiplier(attacker, die) * this.getDiceCardSkillDamageMultiplier(attacker)));
      this.gameState = this.applyDamageWithRevive(die.instanceId, dealt);
      this.showDamageText(die, dealt, '#9ff8ff');
      const destroyed = this.gameState.dice.find((d) => d.instanceId === die.instanceId)?.isDestroyed ?? false;
      if (destroyed) this.checkDeathTransformCondition(die);
      if (die.instanceId === target.instanceId) primaryDestroyed = destroyed;
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
    this.animateTranscendenceBeam(attacker, target);
    return { damage, targetDestroyed: primaryDestroyed };
  }


  private findTranscendenceBeamTarget(attacker: DiceInstanceState): DiceInstanceState | undefined {
    const definition = this.getDefinitionForInstance(attacker);
    if (!definition) return undefined;
    const meta = getRuntimeSkillMeta(definition);
    const basePips = attacker.ownerId === 'player' ? (this.dicePips.get(attacker.instanceId) ?? 0) : (this.enemyDicePips.get(attacker.instanceId) ?? 0);
    if (!meta.hasTranscendence || basePips !== 6 || !this.transcendenceTransformed.has(attacker.instanceId) || !attacker.gridPosition || attacker.attacksRemaining <= 0) return undefined;
    const enemyOwner = attacker.ownerId === 'player' ? 'enemy' : 'player';
    const targets = getBoardDice(this.gameState, enemyOwner).filter((die) => die.gridPosition);
    return targets
      .map((die) => ({ die, distance: getCombatDistance(attacker, die) }))
      .sort((a, b) => a.distance - b.distance)[0]?.die;
  }


  private getTransformedVisual(die: DiceInstanceState): { accent: string; symbol: string } | null {
    const definition = this.getDefinitionForInstance(die);
    if (!definition) return null;
    const meta = getRuntimeSkillMeta(definition);
    const isDeathTransformed = meta.hasDeathTransform && this.deathDiceTransformed.has(die.instanceId);
    const pip = die.ownerId === 'player' ? (this.dicePips.get(die.instanceId) ?? 0) : (this.enemyDicePips.get(die.instanceId) ?? 0);
    const isPlacementPhase = this.gamePhase.stage === 'placement';
    const isTranscendenceTransformed = meta.hasTranscendence && (isPlacementPhase ? pip === 6 : this.transcendenceTransformed.has(die.instanceId));
    if (!isDeathTransformed && !isTranscendenceTransformed) return null;
    return {
      accent: meta.transformAccent ?? definition.accent,
      symbol: meta.transformSymbol ?? '✦'
    };
  }

  private getRangeCoverageText(die: DiceInstanceState): string {
    const definition = this.getDefinitionForInstance(die);
    if (!definition || !die.gridPosition) return `${die.typeId} range unavailable.`;
    const coveredColumns = getCoveredEnemyColumns(die, definition.range);
    const columnText = coveredColumns.length > 0 ? coveredColumns.map((col) => col + 1).join(', ') : 'none';
    const tileCount = getCoveredEnemyTileCount(die, definition.range);
    const tintName = die.ownerId === 'player' ? 'blue' : 'red';
    return `${die.typeId} C${this.instanceClassLevels.get(die.instanceId) ?? 1} range ${definition.range}: ${tintName} coverage hits ${tileCount}/25 enemy tiles (columns ${columnText}, all rows).`;
  }

  private showDamageText(target: DiceInstanceState, amount: number, color = '#ffdf7a', textOverride?: string) {
    if (!target.gridPosition || (amount <= 0 && !textOverride)) return;
    const grid = target.ownerId === 'player' ? this.playerGridContainer : this.enemyGridContainer;
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
      ? (target.ownerId === 'player' ? this.playerGridContainer : this.enemyGridContainer).x + target.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2
      : fallbackHand!.x;
    const y = target.gridPosition
      ? (target.ownerId === 'player' ? this.playerGridContainer : this.enemyGridContainer).y + target.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2 - 18
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
    const targetOwner = die.ownerId === 'player' ? 'enemy' : 'player';
    const targetGrid = targetOwner === 'enemy' ? this.enemyGridContainer : this.playerGridContainer;
    const color = die.ownerId === 'player' ? 0x2f8cff : 0xff4d4d;
    const label = die.ownerId === 'player' ? 'BLUE' : 'RED';

    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const proxyTarget: DiceInstanceState = {
          ...die,
          ownerId: targetOwner,
          gridPosition: { row, col }
        };
        if (getCombatDistance(die, proxyTarget) > Math.max(1, definition.range)) continue;

        const x = col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
        const y = row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
        const highlight = this.add.rectangle(x, y, TILE_SIZE - 6, TILE_SIZE - 6, color, 0.24)
          .setStrokeStyle(2, color, 0.85);
        highlight.setName('range-highlight');
        const text = this.add.text(x, y, label, {
          fontFamily: 'Orbitron',
          fontSize: '10px',
          color: die.ownerId === 'player' ? '#9fd0ff' : '#ffaaaa'
        }).setOrigin(0.5);
        text.setName('range-highlight');
        targetGrid.add([highlight, text]);
        this.rangeHighlightObjects.push(highlight, text);
      }
    }
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

    const dieRect = this.add.rectangle(x, y, TILE_SIZE - 8, TILE_SIZE - 8, color, visual ? 0.55 : 0.28)
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
    const label = this.add.text(x, y - 12, shortLabel, {
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
    const pipLabel = this.add.text(x, y + 2, `${pips}♦`, {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.accent
    }).setOrigin(0.5);
    pipLabel.setName('die-info');
    container.add(pipLabel);
	
    this.renderStatusEffects(container, x, y, die);
    this.renderHealthBar(container, x, y + 18, die.currentHealth, die.maxHealth);
    const ammo = Math.max(0, die.attacksRemaining);
    const maxAmmo = Math.max(1, this.gameState.combatPhase === 'attacking'
      ? Math.max(this.attackCapacityByInstance.get(die.instanceId) ?? 1, die.attacksRemaining)
      : this.getPipCount(die.typeId));
    this.attackCapacityByInstance.set(die.instanceId, maxAmmo);
    const mana = this.manaByInstance.get(die.instanceId) ?? 0;
    this.renderAmmoBar(container, x, y + 28, ammo, maxAmmo);
    const meta = getRuntimeSkillMeta(definition);
    const manaSkills = definition.skills.filter((skill) => (skill.manaNeeded ?? 0) > 0);
    const isDeathTransformed = meta.hasDeathTransform && this.deathDiceTransformed.has(die.instanceId);
    if (meta.canConjureSouls && !this.deathDiceTransformed.has(die.instanceId)) {
      const souls = this.deathAlliesDefeatedCount.get(die.instanceId) ?? 0;
      const soulCap = Math.max(1, meta.maxSouls ?? 2);
      this.renderManaBar(container, x, y + 34, souls, soulCap, 0xc06bdb);
    }
    if (meta.hasDeathInstakill && !isDeathTransformed) return;
    const skillsToRender = meta.hasDeathInstakill ? [{ manaNeeded: meta.deathInstakillMana ?? 12 }] : manaSkills;
    skillsToRender.forEach((skill, index) => {
      this.renderManaBar(container, x, y + 40 + (index * 6), mana, Math.max(1, skill.manaNeeded ?? 1), 0x6fa8ff);
    });
  }

  private showDieInfoPopup(die: DiceInstanceState) {
    const definition = this.getDefinitionForInstance(die);
    if (!definition) return;
    if (this.dieInfoPopupInstanceId === die.instanceId && this.dieInfoPopup) {
      this.dieInfoPopupTimer?.remove(false);
      this.dieInfoPopup.destroy(true);
      this.dieInfoPopup = null;
      this.dieInfoPopupInstanceId = null;
      return;
    }
    this.dieInfoPopupTimer?.remove(false);
    this.dieInfoPopup?.destroy(true);
    const { width } = this.scale;
    const panel = this.add.rectangle(width / 2, 76, 560, 102, 0x102434, 0.95).setStrokeStyle(2, 0x406987);
    const stats = this.add.text(width / 2, 52, `${definition.title} • HP ${die.currentHealth}/${die.maxHealth} • ATK ${definition.attack} • RNG ${definition.range} • TARGET ${definition.targetingMode.toUpperCase()}`, {
      fontFamily: 'Orbitron',
      fontSize: '13px',
      color: PALETTE.text
    }).setOrigin(0.5);
    const mana = this.manaByInstance.get(die.instanceId) ?? 0;
    const shieldHp = this.shieldHpByInstance.get(die.instanceId) ?? 0;
    const shieldNote = shieldHp > 0 ? ` • Shield ${shieldHp}` : '';
    const manaNote = definition.skills.some((skill) => (skill.manaNeeded ?? 0) > 0) ? ` • Mana ${mana}` : '';
    const formatSkillType = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2');
    const desc = this.add.text(width / 2, 84, `${definition.skills.map((skill) => `${skill.title} (${formatSkillType(skill.type)}): ${skill.description}`).join(' | ')}${shieldNote}${manaNote}`, {
      fontFamily: 'Orbitron',
      fontSize: '11px',
      color: PALETTE.textMuted,
      wordWrap: { width: 530 }
    }).setOrigin(0.5);
    this.dieInfoPopup = this.add.container(0, 0, [panel, stats, desc]).setDepth(330).setScale(0.96).setAlpha(0);
    this.dieInfoPopupInstanceId = die.instanceId;
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
    const palette: Record<'slow' | 'poison' | 'berserk' | 'taunt' | 'fracture', { color: number; icon: string }> = {
      slow: { color: 0x8fd5ff, icon: '❄' },
      poison: { color: 0x74d66f, icon: '☠' },
      berserk: { color: 0xff4d4d, icon: '!' },
      taunt: { color: 0xffb347, icon: 'T' },
      fracture: { color: 0xffbf80, icon: '🜂' }
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
      this.endGame('victory', 'All enemy dice defeated!');
      return true;
    }

    if (playerLiving === 0) {
      this.endGame('defeat', 'All your dice were defeated!');
      return true;
    }

    return false;
  }

  private getClaimedBotFirstWins(): BotDifficulty[] {
    const stored = this.registry.get(BOT_FIRST_WIN_KEY) as BotDifficulty[] | undefined;
    if (stored) return stored;
    try {
      const parsed = JSON.parse(localStorage.getItem(BOT_FIRST_WIN_KEY) ?? '[]') as BotDifficulty[];
      this.registry.set(BOT_FIRST_WIN_KEY, parsed);
      return parsed;
    } catch {
      return [];
    }
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
      const parsed = JSON.parse(localStorage.getItem(CHALLENGE_REWARD_CLAIMS_KEY) ?? '[]') as string[];
      this.registry.set(CHALLENGE_REWARD_CLAIMS_KEY, parsed);
      return parsed;
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

    const baseTokenReward = MATCH_TOKEN_REWARDS[stage];
    let tokenReward = baseTokenReward;
    let chipReward = 0;
    if (stage === 'victory' && !this.hasClaimedBotFirstWin(this.configDifficulty)) {
      const firstWinReward = BOT_FIRST_WIN_REWARDS[this.configDifficulty];
      tokenReward += firstWinReward.tokens;
      chipReward += firstWinReward.chips;
      this.markBotFirstWinClaimed(this.configDifficulty);
    }
    if (stage === 'victory' && this.activeChallenge === 'daily') {
      this.setChallengeStatus('daily', 'completed');
      const dailyClaimKey = `daily:${this.activeDailyKey || new Date().toISOString().slice(0, 10)}`;
      if (!this.hasChallengeRewardClaimed(dailyClaimKey)) {
        tokenReward += this.dailyHard ? 1600 : 800;
        chipReward += this.dailyHard ? 20 : 10;
        this.markChallengeRewardClaimed(dailyClaimKey);
      }
    }
    if (stage === 'victory' && this.activeChallenge === 'deucifer') {
      this.setChallengeStatus('deucifer', 'completed');
      const deuciferClaimKey = 'deucifer';
      if (!this.hasChallengeRewardClaimed(deuciferClaimKey)) {
        tokenReward += 7500;
        chipReward += 50;
        this.markChallengeRewardClaimed(deuciferClaimKey);
      }
    }
    if (stage !== 'victory' && this.activeChallenge === 'daily') this.setChallengeStatus('daily', 'failed');
    if (stage !== 'victory' && this.activeChallenge === 'deucifer') this.setChallengeStatus('deucifer', 'failed');
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
    overlay.on('pointerdown', () => this.closeExitPrompt());
    cancel.on('pointerdown', () => this.closeExitPrompt());
    quit.on('pointerdown', () => {
      if (this.activeChallenge === 'daily') this.setChallengeStatus('daily', 'failed');
      if (this.activeChallenge === 'deucifer') this.setChallengeStatus('deucifer', 'failed');
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
    g.fillRoundedRect(x - 18, y - 3, 36 * ratio, 5, 2);
    container.add(g);
  }

  private placeEnemyDiceForTurn() {
    const enemyHandDice = getAvailableHandDice(this.gameState, 'enemy');
    const usedCells = new Set<string>();
    enemyHandDice.forEach((die) => {
      this.placeEnemyDieUsingBehavior(die, usedCells);
    });
  }

  private placeEnemyDieUsingBehavior(die: DiceInstanceState, usedCells: Set<string>) {
    const definition = this.getDefinitionForInstance(die) ?? this.definitions.get(die.typeId);
    const range = definition?.range ?? 4;
    let row = 0;
    let col = 0;
    let key = '';
    let attempts = 0;
    do {
      row = Phaser.Math.Between(0, GRID_SIZE - 1);
      col = this.pickEnemyColumn(range);
      key = `${row},${col}`;
      attempts++;
    } while (usedCells.has(key) && attempts < 50);
    usedCells.add(key);
    this.gameState = placeDieOnBoard(this.gameState, die.instanceId, row, col);
  }

  private pickRandomColumn(columns: number[]): number {
    return columns[Phaser.Math.Between(0, columns.length - 1)] ?? 0;
  }
}
