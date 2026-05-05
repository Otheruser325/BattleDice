import Phaser from 'phaser';
import { getAllDiceDefinitions, getDiceDefinitions, getDiceProgress } from '../data/dice';
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

interface PlacedDie {
  typeId: DiceTypeId;
  row: number;
  col: number;
  pips: number;
}

interface GamePhase {
  stage: 'lobby' | 'placement' | 'combat' | 'resolved' | 'victory' | 'defeat';
}

const DEFAULT_PLAYER_LOADOUT: DiceTypeId[] = ['Fire', 'Ice', 'Poison', 'Electric', 'Wind'];

const GRID_SIZE = 5;
const TILE_SIZE = 64;
const TILE_GAP = 8;

export class ArenaScene extends Phaser.Scene {
  static readonly KEY = 'ArenaScene';
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
  private attackDeltaByInstance: Map<string, { delta: number; turns: number }> = new Map();
  private extraAttackTurnsByInstance: Map<string, { extra: number; turns: number }> = new Map();
  private attackMultiplierTurnsByInstance: Map<string, { multiplier: number; turns: number }> = new Map();
  private poisonByInstance: Map<string, { damage: number; turns: number }> = new Map();
  private transcendenceBeamUsed: Set<string> = new Set();
  private rollAllButton!: Phaser.GameObjects.Rectangle;
  private rollAllButtonLabel!: Phaser.GameObjects.Text;
  private diceRolled = false;
  private currentHandOrder: DiceTypeId[] = [];

  private lavaPoolsByTile: Map<string, { damage: number; turns: number }> = new Map();
  private deathDiceTransformed: Set<string> = new Set();
  private deathAlliesDefeatedCount: Map<string, number> = new Map();
  private permanentAttackBonusByInstance: Map<string, number> = new Map();
  private instanceBaseAttack: Map<string, number> = new Map();

  private modalContainer: Phaser.GameObjects.Container | null = null;
  private modalEscHandler: (() => void) | null = null;
  private configDifficulty: 'Easy' | 'Medium' | 'Hard' = 'Medium';
  private configUseLevelling: boolean = true;
  private configTurnCount: number = -1;
  private turnLimit: number = -1;

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
    this.attackDeltaByInstance.clear();
    this.extraAttackTurnsByInstance.clear();
    this.attackMultiplierTurnsByInstance.clear();
    this.poisonByInstance.clear();
    this.diceRolled = false;
    this.currentHandOrder = [];
    this.transcendenceBeamUsed.clear();
    this.lavaPoolsByTile.clear();
    this.deathDiceTransformed.clear();
    this.deathAlliesDefeatedCount.clear();
    this.permanentAttackBonusByInstance.clear();
    this.instanceBaseAttack.clear();
    this.clearModeModal();
    this.turnLimit = -1;
  }

  create() {
    this.resetRuntimeState();
    const layout = getLayout(this);

    this.definitions = new Map(getAllDiceDefinitions(this).map((die) => [die.typeId, die]));
    this.skillIndex = buildSkillIndex([...this.definitions.values()]);

    this.createBackground(layout);
    this.createLobbyUI();

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
    this.clearModeModal();
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;
    const elements: Phaser.GameObjects.GameObject[] = [];

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
      }).setOrigin(0, 0.5)
    );

    const rowContainer = this.add.container(0, 0);
    elements.push(rowContainer);

    this.makeSelectRow(
      [{ label: 'EASY', value: 'Easy' as const }, { label: 'MEDIUM', value: 'Medium' as const }, { label: 'HARD', value: 'Hard' as const }],
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

    const noteText = this.add.text(cx, cy + 56, 'Difficulty changes bot class-level range.\nLevelling applies Class UP stat bonuses to all dice.', {
      fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.textMuted, align: 'center'
    }).setOrigin(0.5);
    elements.push(noteText);

    const backBtn = this.add.text(cx - 90, cy + 168, '← BACK', {
      fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.accentSoft,
      backgroundColor: '#173247', padding: { left: 12, right: 12, top: 7, bottom: 7 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backBtn.on('pointerdown', () => this.openModeSelectModal());
    elements.push(backBtn);

    const startBtn = this.add.text(cx + 90, cy + 168, 'START →', {
      fontFamily: 'Orbitron', fontSize: '13px', color: '#000000',
      backgroundColor: '#2ecc71', padding: { left: 16, right: 16, top: 7, bottom: 7 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    startBtn.on('pointerdown', () => {
      this.turnLimit = this.configTurnCount;
      this.clearModeModal();
      this.startGame();
    });
    elements.push(startBtn);

    this.modalContainer = this.add.container(0, 0, elements).setDepth(250);
    this.setModalEsc(() => this.openModeSelectModal());
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
  ): void {
    const btnW = 72;
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
      container.add([rect, text]);
    });

    refresh();
  }

  // ── GAME START ───────────────────────────────────────────────────────────────

  private startGame() {
    this.resetRuntimeState();
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
        this.scene.sleep('MenuScene');
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

    const arenaY = height / 2;
    const boardWidth = GRID_SIZE * (TILE_SIZE + TILE_GAP) - TILE_GAP;
    const gridX = (width - boardWidth) / 2;
    const gap = 36;
    const enemyY = arenaY - boardWidth - gap / 2;
    const playerY = arenaY + gap / 2;

    this.enemyGridContainer = this.createGrid(gridX, enemyY, 'ENEMY GRID', false);
    this.playerGridContainer = this.createGrid(gridX, playerY, 'YOUR GRID', true);
    this.playerStatusPanel = this.add.container(24, 120);
    this.enemyStatusPanel = this.add.container(width - 220, 120);

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
    switch (this.configDifficulty) {
      case 'Easy': return Phaser.Math.Between(1, 2);
      case 'Hard': return Phaser.Math.Between(3, 8);
      case 'Medium': default: return Phaser.Math.Between(1, 5);
    }
  }

  private initializeBattle() {
    const playerLoadoutDefinitions = getDiceDefinitions(this);
    const allDefinitions = getAllDiceDefinitions(this);

    const effectiveLevel = (raw: number) => this.configUseLevelling ? raw : 1;

    const playerDefs = playerLoadoutDefinitions
      .map((definition) => this.applyClassProgress(definition, effectiveLevel(getDiceProgress(this, definition.typeId).classLevel)));

    const enemyRawDefs = this.pickRandomEnemyLoadout(allDefinitions);
    const enemyDefs = enemyRawDefs.map((definition) => {
      const classLevel = effectiveLevel(this.rollEnemyClassLevel());
      this.enemyClassLevels.set(definition.typeId, classLevel);
      return this.applyClassProgress(definition, classLevel);
    });

    this.gameState = createMatchBattleState(playerDefs, enemyDefs);

    // Bug fix: store per-instance scaled attack so resolveDamage uses class-adjusted values
    this.instanceBaseAttack.clear();
    this.gameState.dice.forEach((die) => {
      const scaledDef = die.ownerId === 'player'
        ? playerDefs.find((d) => d.typeId === die.typeId)
        : enemyDefs.find((d) => d.typeId === die.typeId);
      if (scaledDef) this.instanceBaseAttack.set(die.instanceId, scaledDef.attack);
    });

    this.generateEnemyPositions();

    this.turnText.setVisible(true);
    this.turnText.setText(`TURN ${this.gameState.turn}`);

    this.createHandArea();
    this.setupGridDropZones();
    this.createCombatUI();
    this.updateCombatButtonState();

    this.debug.log('Battle initialized', { turn: this.gameState.turn, playerCount: playerDefs.length, enemyCount: enemyDefs.length });
  }

  private getDefinitionsForAttacker(attacker: DiceInstanceState): Map<string, DiceDefinition> {
    const scaledAttack = this.instanceBaseAttack.get(attacker.instanceId);
    if (scaledAttack === undefined) return this.definitions;
    const baseDef = this.definitions.get(attacker.typeId);
    if (!baseDef || baseDef.attack === scaledAttack) return this.definitions;
    const modified = new Map(this.definitions);
    modified.set(attacker.typeId, { ...baseDef, attack: scaledAttack });
    return modified;
  }

  private applyClassProgress(definition: DiceDefinition, classLevel: number): DiceDefinition {
    return {
      ...definition,
      attack: definition.attack + (classLevel - 1) * 2,
      health: definition.health + (classLevel - 1) * 8
    };
  }

  private createHandArea() {
    const { width, height } = this.scale;
    this.currentHandOrder = getAvailableHandDice(this.gameState, 'player').map((die) => die.typeId);
    if (this.currentHandOrder.length === 0) {
      this.currentHandOrder = [...DEFAULT_PLAYER_LOADOUT];
    }

    const handY = height - 140;
    const startX = (width - (this.currentHandOrder.length * 100)) / 2 + 50;

    this.handContainer = this.add.container(0, 0);

    this.add.text(width / 2, handY - 70, 'CLICK ROLL ALL, THEN DRAG DICE TO YOUR GRID', {
      fontFamily: 'Orbitron',
      fontSize: '14px',
      color: PALETTE.accent
    }).setOrigin(0.5);

    this.createRollAllButton(width / 2, handY - 35);

    this.currentHandOrder.forEach((typeId, index) => {
      const definition = this.definitions.get(typeId);
      if (!definition) return;

      const x = startX + index * 100;
      const dieContainer = this.createDraggableDie(typeId, definition, x, handY, true);
      this.handDice.set(typeId, dieContainer);
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

    let rollResults: string[] = [];
    this.currentHandOrder.forEach((typeId) => {
      const rolledPips = Math.floor(Math.random() * 6) + 1;
      this.dicePips.set(typeId, rolledPips);
      rollResults.push(`${typeId}:${rolledPips}`);

      const container = this.handDice.get(typeId);
      if (container) {
        const pipText = container.list.find((obj) => obj.name === 'pipText') as Phaser.GameObjects.Text;
        if (pipText) {
          pipText.setText(`${rolledPips}♦`);
          pipText.setColor(PALETTE.accent);
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

  private createDraggableDie(typeId: DiceTypeId, definition: DiceDefinition, x: number, y: number, draggable: boolean): Phaser.GameObjects.Container {
    const container = this.add.container(x, y);
    container.setSize(60, 70);

    const color = Phaser.Display.Color.HexStringToColor(definition.accent).color;

    const bg = this.add.rectangle(0, 0, 56, 56, color, 0.28)
      .setStrokeStyle(2, color);
    (bg as Phaser.GameObjects.Rectangle).setData('isDie', true);

    const label = this.add.text(0, -15, typeId.slice(0, 3).toUpperCase(), {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: definition.accent
    }).setOrigin(0.5);

    const pipText = this.add.text(0, 5, '?♦', {
      fontFamily: 'Orbitron',
      fontSize: '14px',
      color: PALETTE.textMuted
    }).setOrigin(0.5);
    (pipText as Phaser.GameObjects.Text).setName('pipText');

    container.add([bg, label, pipText]);

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
          this.returnDieToHand(container, typeId);
          return;
        }
        container.setScale(1);
        container.setDepth(0);
        this.highlightValidDropZones(false);
        this.tryPlaceDie(container, typeId);
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
      case 'Fire': return 3;
      case 'Electric': return 3;
      case 'Ice': return 2;
      case 'Poison': return 1;
      case 'Wind': return 1;
      default: return 2;
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

  private tryPlaceDie(container: Phaser.GameObjects.Container, typeId: DiceTypeId) {
    const droppedZone = this.gridDropZones.find((zone) => {
      const bounds = zone.getBounds();
      return Phaser.Geom.Intersects.RectangleToRectangle(
        new Phaser.Geom.Rectangle(container.getBounds().centerX - 10, container.getBounds().centerY - 10, 20, 20),
        bounds
      );
    });

    if (!droppedZone) {
      this.returnDieToHand(container, typeId);
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
      this.returnDieToHand(container, typeId);
      return;
    }

    const existingDieInHand = this.gameState.dice.find((die) =>
      die.ownerId === 'player' &&
      die.typeId === typeId &&
      die.zone === 'hand' &&
      !die.isDestroyed
    );

    const instanceId = existingDieInHand?.instanceId ?? `player-${typeId}-${Date.now()}`;
    if (!existingDieInHand) {
      this.debug.log('Creating new die instance', { typeId, instanceId });
    }
    this.gameState = placeDieOnBoard(this.gameState, instanceId, gridPos.row, gridPos.col);

    container.destroy();
    this.handDice.delete(typeId);

    this.placedDiceCount++;
    this.renderDice();
    this.updateCombatButtonState();

    this.combatLog.setText(`Placed ${typeId} at [${gridPos.row}, ${gridPos.col}] (${this.placedDiceCount}/5)`);
  }

  private returnDieToHand(container: Phaser.GameObjects.Container, typeId: DiceTypeId) {
    const index = this.currentHandOrder.indexOf(typeId);
    const { width } = this.scale;
    const startX = (width - (this.currentHandOrder.length * 100)) / 2 + 50;
    const handY = this.scale.height - 140;
    const targetX = startX + index * 80;

    this.tweens.add({
      targets: container,
      x: targetX,
      y: handY,
      duration: 200,
      ease: 'Power2'
    });
  }

  private updateCombatButtonState() {
    const requiredDice = this.currentHandOrder.length;
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
    const buttonY = height - 145;

    this.combatLog = this.add.text(centerX, buttonY - 70, 'Place your dice, then start combat!', {
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
    const requiredDice = this.currentHandOrder.length;
    const boardPlaced = getBoardDice(this.gameState, 'player').length;
    if (!this.diceRolled || boardPlaced < requiredDice) {
      this.combatLog.setText(`Place all ${requiredDice} rolled dice before combat.`);
      this.updateCombatButtonState();
      return;
    }
    this.startCombatButton.disableInteractive();
    this.startCombatButton.setFillStyle(0x7f8c8d, 0.5);

    this.gamePhase = { stage: 'combat' };
    this.placeEnemyDiceForTurn();

    this.enemyDicePips.clear();
    this.transcendenceBeamUsed.clear();
    this.invisiRollForEnemies();

    this.enemyFogOverlay.setVisible(false);
    this.enemyFogText.setVisible(false);
    this.renderEnemyDice();

    this.playTurnBanner('START!');
    this.combatLog.setText('Combat started! Revealing enemy positions...');
    await this.delay(1000);

    this.gameState = this.beginCombatPhaseWithRolledPips();

    this.applyLavaPoolDamageAtCombatStart();
    this.renderDice();
    this.renderEnemyDice();
    this.renderLavaPools();

    if (this.checkWinConditions()) return;

    await this.runCombatLoop();
  }

  private beginCombatPhaseWithRolledPips(): MatchBattleState {
    const playerBoardDice = getBoardDice(this.gameState, 'player');
    const enemyBoardDice = getBoardDice(this.gameState, 'enemy');
    const playerBonus = playerBoardDice.reduce((sum, die) => {
      const definition = this.definitions.get(die.typeId);
      if (!definition) return sum;
      return sum + (getRuntimeSkillMeta(definition).combatStartExtraAttacks ?? 0);
    }, 0);
    const enemyBonus = enemyBoardDice.reduce((sum, die) => {
      const definition = this.definitions.get(die.typeId);
      if (!definition) return sum;
      return sum + (getRuntimeSkillMeta(definition).combatStartExtraAttacks ?? 0);
    }, 0);

    return {
      ...this.gameState,
      combatPhase: 'attacking',
      dice: this.gameState.dice.map((die) => {
        if (die.zone !== 'board' || die.isDestroyed) {
          return die;
        }

        const basePips = die.ownerId === 'player'
          ? (this.dicePips.get(die.typeId) ?? this.getPipCount(die.typeId))
          : (this.enemyDicePips.get(die.instanceId) ?? this.getPipCount(die.typeId));
        const pips = basePips + (die.ownerId === 'player' ? playerBonus : enemyBonus);
        const debuff = this.attackDeltaByInstance.get(die.instanceId);
        const buff = this.extraAttackTurnsByInstance.get(die.instanceId);
        const mult = this.attackMultiplierTurnsByInstance.get(die.instanceId);
        const withDebuff = debuff ? Math.max(1, pips + debuff.delta) : pips;
        const withBuff = buff ? withDebuff + buff.extra : withDebuff;
        const withMultiplier = mult ? Math.max(1, Math.floor(withBuff * mult.multiplier)) : withBuff;
        const permanentBonus = this.permanentAttackBonusByInstance.get(die.instanceId) ?? 0;
        const withPermanent = withMultiplier + permanentBonus;

        return {
          ...die,
          hasFinishedAttacking: false,
          attacksRemaining: Math.max(1, withPermanent)
        };
      })
    };
  }

  private applyLavaPoolDamageAtCombatStart() {
    if (this.lavaPoolsByTile.size === 0) return;
    const allBoardDice = this.gameState.dice.filter(d => d.zone === 'board' && !d.isDestroyed && d.gridPosition);
    allBoardDice.forEach(die => {
      const tileKey = `${die.ownerId}:${die.gridPosition!.row},${die.gridPosition!.col}`;
      const pool = this.lavaPoolsByTile.get(tileKey);
      if (pool) {
        const wasAlive = !die.isDestroyed;
        this.gameState = applyDamage(this.gameState, die.instanceId, pool.damage);
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
        if (child instanceof Phaser.GameObjects.Graphics && child.name === 'lava-pool') {
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

      const turnLabel = this.add.text(tileX, tileY + TILE_SIZE / 2 - 10, `${pool.turns}T`, {
        fontFamily: 'Orbitron', fontSize: '9px', color: '#ff8c00'
      }).setOrigin(0.5);
      turnLabel.setName('lava-pool');
      container.add(turnLabel);
    });
    void boardWidth;
  }

  private async runCombatLoop() {
    const owners: ['player', 'enemy'] = ['player', 'enemy'];

    for (const owner of owners) {
      const ownerName = owner === 'player' ? 'Your' : 'Enemy';

      while (true) {
        const attacker = getNextAttacker(this.gameState, owner);
        if (!attacker) break;

        const beamTarget = this.findTranscendenceBeamTarget(attacker);
        const target = beamTarget ?? findAttackTarget(this.gameState, attacker, this.definitions);
        if (!target) {
          this.gameState = {
            ...this.gameState,
            dice: this.gameState.dice.map((die) => die.instanceId === attacker.instanceId ? { ...die, attacksRemaining: 0, hasFinishedAttacking: true } : die)
          };
          this.combatLog.setText(`${ownerName} ${attacker.typeId} is out of range and skips!`);
          await this.delay(500);
          continue;
        }

        const attackerDef = this.definitions.get(attacker.typeId);
        const attackerMeta = attackerDef ? getRuntimeSkillMeta(attackerDef) : undefined;
        const currMana = this.manaByInstance.get(attacker.instanceId) ?? 0;
        const meteorFires = (attackerMeta?.hasMeteorStrike ?? false) && currMana >= (attackerMeta?.activeManaNeeded ?? 7);
        const deathFires = (attackerMeta?.hasDeathInstakill ?? false) && this.deathDiceTransformed.has(attacker.instanceId) && currMana >= (attackerMeta?.deathInstakillMana ?? 12);
        const regularActiveFires = (attackerMeta?.activeManaNeeded ?? 0) > 0 && currMana >= (attackerMeta?.activeManaNeeded ?? 0) && !attackerMeta?.hasMeteorStrike && !attackerMeta?.hasDeathInstakill;
        const anyActiveFires = meteorFires || deathFires || regularActiveFires;
        const BASIC_WITH_ACTIVE = new Set(['Ice', 'Poison']);
        const skipBasicAttack = anyActiveFires && !BASIC_WITH_ACTIVE.has(attacker.typeId);

        let damage = 0;
        let targetDestroyed = false;

        if (!skipBasicAttack) {
          const result = executeAttack(this.gameState, attacker.instanceId, target.instanceId, this.getDefinitionsForAttacker(attacker));
          this.gameState = result.newState;
          damage = result.damage;
          targetDestroyed = result.targetDestroyed;
          this.applyTranscendenceBeam(attacker, target);
          this.applyPassiveSkillEffects(attacker, target);
        } else {
          this.gameState = spendAttack(this.gameState, attacker.instanceId);
        }

        this.applyActiveSkillEffects(attacker, target);
        if (targetDestroyed) {
          this.applyOnKillSkillEffects(attacker, target);
          this.applyOnDeathSkillEffects(target, attacker);
          this.checkDeathTransformCondition(target);
        }

        this.combatLog.setText(
          skipBasicAttack
            ? `${ownerName} ${attacker.typeId} uses active skill!`
            : `${ownerName} ${attacker.typeId} attacks ${target.typeId} for ${damage} damage!${targetDestroyed ? ' DESTROYED!' : ''}`
        );

        this.animateAttack(attacker, target);
        this.renderDice();
        this.renderEnemyDice();

        await this.delay(800);

        if (this.checkWinConditions()) {
          return;
        }
      }
    }

    this.combatLog.setText('Combat phase complete!');
    await this.delay(1000);

    this.applyCombatEndSkills();
    this.applyTimedSkillDecay();
    this.gameState = resolveCombatPhase(this.gameState);
    this.gameState = endTurn(this.gameState);

    await this.returnDiceToHand();
    this.applyTurnBasedEffects();
    this.refreshHandAfterPoisonEffects();
    this.renderDice();
    this.renderEnemyDice();
    this.renderLavaPools();

    if (this.checkWinConditions()) {
      return;
    }

    if (this.turnLimit !== -1 && this.gameState.turn > this.turnLimit) {
      this.resolveTurnLimitResult();
      return;
    }

    this.turnText.setText(`TURN ${this.gameState.turn}`);
    this.playTurnBanner(`TURN ${this.gameState.turn}`);
    this.combatLog.setText(`Turn ${this.gameState.turn} - Roll and place your dice!`);

    this.updateCombatButtonState();
  }

  private refreshHandAfterPoisonEffects() {
    const deadInHand: string[] = [];
    this.currentHandOrder.forEach((typeId) => {
      const isDestroyed = this.gameState.dice.some(
        (d) => d.ownerId === 'player' && d.typeId === typeId && d.isDestroyed
      );
      if (isDestroyed) deadInHand.push(typeId);
    });
    if (deadInHand.length === 0) return;

    deadInHand.forEach((typeId) => {
      this.handDice.get(typeId)?.destroy();
      this.handDice.delete(typeId);
    });
    this.currentHandOrder = this.currentHandOrder.filter((t) => !deadInHand.includes(t));
    this.combatLog.setText(
      `${deadInHand.join(', ')} perished from poison between turns. ${this.currentHandOrder.length} dice remain.`
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
      this.endGame('victory', `Turn limit reached — DRAW! Both sides have ${playerLiving} dice.`);
    }
  }

  private applyPassiveSkillEffects(attacker: DiceInstanceState, target: DiceInstanceState) {
    const definition = this.definitions.get(attacker.typeId);
    if (!definition || !target.gridPosition) return;
    const meta = getRuntimeSkillMeta(definition);
    if (meta.splashDamage) {
      const splashTargets = getBoardDice(this.gameState, target.ownerId).filter((die) =>
        die.instanceId !== target.instanceId &&
        die.gridPosition &&
        Math.abs(die.gridPosition.row - target.gridPosition!.row) <= 1 &&
        Math.abs(die.gridPosition.col - target.gridPosition!.col) <= 1
      );
      splashTargets.forEach((die) => {
        this.gameState = applyDamage(this.gameState, die.instanceId, meta.splashDamage!);
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
        this.gameState = applyDamage(this.gameState, chainTarget.instanceId, meta.chainDamage);
      }
    }
  }

  private applyActiveSkillEffects(attacker: DiceInstanceState, target: DiceInstanceState) {
    const definition = this.definitions.get(attacker.typeId);
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
            this.gameState = applyDamage(this.gameState, freshTarget.instanceId, 60);
            if (freshTarget.gridPosition) {
              const lavaKey = `${enemyOwner}:${freshTarget.gridPosition.row},${freshTarget.gridPosition.col}`;
              this.lavaPoolsByTile.set(lavaKey, { damage: 25, turns: 3 });
            }
            const destroyed = this.gameState.dice.find(d => d.instanceId === freshTarget.instanceId)?.isDestroyed;
            this.combatLog.setText(`☄️ ${attacker.typeId} meteor strikes ${freshTarget.typeId} for 60 damage! Lava pool placed!${destroyed ? ' DESTROYED!' : ''}`);
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
          this.gameState = applyDamage(this.gameState, freshTarget.instanceId, freshTarget.currentHealth);
          this.combatLog.setText(`☠️ Death Dice's Reaper's Touch instantly kills ${freshTarget.typeId}!`);
          const destroyed = this.gameState.dice.find(d => d.instanceId === freshTarget.instanceId)?.isDestroyed;
          if (destroyed) {
            this.applyOnKillSkillEffects(attacker, freshTarget);
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
    const windMultiplierActive = attacker.typeId === 'Wind' && this.attackMultiplierTurnsByInstance.has(attacker.instanceId);
    if (!canCastActive) {
      if (manaNeeded > 0 && !windMultiplierActive) this.manaByInstance.set(attacker.instanceId, Math.min(manaNeeded, currentMana + 1));
      return;
    }
    if (attacker.typeId === 'Poison') {
      const poisonDamage = meta.poisonDamage ?? 10;
      const poisonTurns = Math.max(1, meta.activeDurationTurns ?? 2);
      this.poisonByInstance.set(target.instanceId, { damage: poisonDamage, turns: poisonTurns });
    }
    if ((meta.activeExtraAttacks ?? 0) > 0 && (meta.activeDurationTurns ?? 0) > 0) {
      if (attacker.typeId === 'Wind') {
        this.attackMultiplierTurnsByInstance.set(attacker.instanceId, { multiplier: 2, turns: meta.activeDurationTurns! });
        const freshAttacker = this.gameState.dice.find(d => d.instanceId === attacker.instanceId);
        if (freshAttacker && !freshAttacker.isDestroyed) {
          this.gameState = {
            ...this.gameState,
            dice: this.gameState.dice.map(d =>
              d.instanceId === attacker.instanceId
                ? { ...d, attacksRemaining: Math.max(1, d.attacksRemaining * 2) }
                : d
            )
          };
        }
      } else {
        this.extraAttackTurnsByInstance.set(attacker.instanceId, { extra: meta.activeExtraAttacks!, turns: meta.activeDurationTurns! });
      }
    }
    if ((meta.activeAttackDelta ?? 0) !== 0 && (meta.activeDurationTurns ?? 0) > 0) {
      this.attackDeltaByInstance.set(target.instanceId, { delta: meta.activeAttackDelta!, turns: meta.activeDurationTurns! });
    }
    this.manaByInstance.set(attacker.instanceId, 0);
  }

  private checkDeathTransformCondition(defeated: DiceInstanceState) {
    const owner = defeated.ownerId;
    const alliesOfOwner = this.gameState.dice.filter(d => d.ownerId === owner && !d.isDestroyed && d.typeId === 'Death');
    alliesOfOwner.forEach(deathDie => {
      if (this.deathDiceTransformed.has(deathDie.instanceId)) return;
      const count = (this.deathAlliesDefeatedCount.get(deathDie.instanceId) ?? 0) + 1;
      this.deathAlliesDefeatedCount.set(deathDie.instanceId, count);
      if (count >= 2) {
        this.deathDiceTransformed.add(deathDie.instanceId);
        this.gameState = {
          ...this.gameState,
          dice: this.gameState.dice.map(d =>
            d.instanceId === deathDie.instanceId
              ? (() => { const transformedMaxHealth = d.maxHealth + 170; return { ...d, maxHealth: transformedMaxHealth, currentHealth: transformedMaxHealth }; })()
              : d
          )
        };
        this.manaByInstance.set(deathDie.instanceId, 0);
        this.combatLog.setText(`☠️ Death Dice transforms! HP surges to 320 — Instakill Form ACTIVE!`);
      }
    });
  }

  private applyCombatEndSkills() {
    this.gameState = {
      ...this.gameState,
      dice: this.gameState.dice.map((die) => {
        if (die.zone !== 'board' || die.isDestroyed) return die;
        const definition = this.definitions.get(die.typeId);
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
    newlyDefeated.forEach((die) => this.checkDeathTransformCondition(die));
  }

  private async returnDiceToHand() {
    this.placedDiceCount = 0;
    this.diceRolled = false;
    this.dicePips.clear();

    this.handDice.forEach((container) => container.destroy());
    this.handDice.clear();

    this.renderDice();
    this.renderEnemyDice();

    const { width, height } = this.scale;
    const handY = height - 140;
    this.currentHandOrder = getAvailableHandDice(this.gameState, 'player').map((die) => die.typeId);
    const startX = (width - (this.currentHandOrder.length * 100)) / 2 + 50;

    this.currentHandOrder.forEach((typeId, index) => {
      const definition = this.definitions.get(typeId);
      if (!definition) return;

      const x = startX + index * 100;
      const dieContainer = this.createDraggableDie(typeId, definition, x, handY, true);
      this.handDice.set(typeId, dieContainer);
      this.handContainer.add(dieContainer);
    });

    this.rollAllButton.setInteractive({ useHandCursor: true });
    this.rollAllButton.setFillStyle(0xf4b860, 0.9);
    this.rollAllButtonLabel.setText('ROLL ALL!');

    this.debug.log('Dice returned to hand', { turn: this.gameState.turn });
    await this.delay(300);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
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
    graphics.lineStyle(3, 0xff6b6b, 0.8);
    graphics.strokeLineShape(new Phaser.Geom.Line(worldAttackerX, worldAttackerY, worldTargetX, worldTargetY));

    this.tweens.add({
      targets: graphics,
      alpha: 0,
      duration: 400,
      onComplete: () => graphics.destroy()
    });
  }

  private renderEnemyDice() {
    const childrenToRemove: Phaser.GameObjects.GameObject[] = [];
    this.enemyGridContainer.each((child: Phaser.GameObjects.GameObject) => {
      if (child instanceof Phaser.GameObjects.Rectangle && child.getData('isDie')) childrenToRemove.push(child);
      if (child instanceof Phaser.GameObjects.Text && child.name === 'die-info') childrenToRemove.push(child);
      if (child instanceof Phaser.GameObjects.Graphics && (child.name === 'hp-bar' || child.name === 'ammo-bar' || child.name === 'mana-bar')) childrenToRemove.push(child);
    });
    childrenToRemove.forEach((child) => child.destroy());

    const enemyDice = getBoardDice(this.gameState, 'enemy');
    enemyDice.forEach((die: DiceInstanceState) => {
      if (die.gridPosition) {
        this.renderDie(this.enemyGridContainer, die, die.gridPosition.row, die.gridPosition.col, false);
      }
    });
    this.renderDiceStatusPanel(this.enemyStatusPanel, enemyDice, 'OPPONENT');
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
        row = this.pickEnemyRow(range);
        col = Math.floor(Math.random() * GRID_SIZE);
        key = `${row},${col}`;
        attempts++;
      } while (usedCells.has(key) && attempts < 50);
      usedCells.add(key);
      this.gameState = placeDieOnBoard(this.gameState, die.instanceId, row, col);
    }
  }

  private pickEnemyRow(range: number): number {
    if (range <= 3) {
      const roll = Math.random();
      if (roll < 0.45) return 0;
      if (roll < 0.75) return 1;
      return Phaser.Math.Between(2, GRID_SIZE - 1);
    }
    return Phaser.Math.Between(0, GRID_SIZE - 1);
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
      if (child instanceof Phaser.GameObjects.Graphics && (child.name === 'hp-bar' || child.name === 'ammo-bar' || child.name === 'mana-bar')) {
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
    this.renderDiceStatusPanel(this.playerStatusPanel, playerDice, 'YOUR DICE');
  }

  private renderDiceStatusPanel(panel: Phaser.GameObjects.Container, dice: DiceInstanceState[], title: string) {
    panel.removeAll(true);
    panel.add(this.add.text(0, 0, title, { fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.accentSoft }));
    dice.forEach((diceUnit, index) => {
      const isTransformed = diceUnit.typeId === 'Death' && this.deathDiceTransformed.has(diceUnit.instanceId);
      const status = diceUnit.isDestroyed ? 'DEFEATED' : `${diceUnit.currentHealth}/${diceUnit.maxHealth} HP${isTransformed ? ' ☠' : ''}`;
      panel.add(this.add.text(0, 20 + index * 16, `${diceUnit.typeId}: ${status}`, { fontFamily: 'Orbitron', fontSize: '11px', color: diceUnit.isDestroyed ? PALETTE.danger : (isTransformed ? '#9b59b6' : PALETTE.textMuted) }));
    });
  }

  private pickRandomEnemyLoadout(pool: DiceDefinition[]): DiceDefinition[] {
    const arr = [...pool];
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
      if (pick && !used.has(pick.typeId)) {
        selected.push(pick);
        used.add(pick.typeId);
      } else if (pick) {
        selected.push(pick);
      }
    }

    return selected.slice(0, 5);
  }

  private applyOnKillSkillEffects(attacker: DiceInstanceState, _defeated: DiceInstanceState) {
    const definition = this.definitions.get(attacker.typeId);
    if (!definition) return;
    const bonus = getRuntimeSkillMeta(definition).onKillExtraAttacks ?? 0;
    if (bonus <= 0) return;
    this.gameState = {
      ...this.gameState,
      dice: this.gameState.dice.map((die) => die.instanceId === attacker.instanceId ? { ...die, attacksRemaining: die.attacksRemaining + bonus, hasFinishedAttacking: false } : die)
    };
  }

  private applyOnDeathSkillEffects(defeated: DiceInstanceState, _attacker: DiceInstanceState) {
    const definition = this.definitions.get(defeated.typeId);
    if (!definition) return;
    const bonus = getRuntimeSkillMeta(definition).onDeathExtraAttacks ?? 0;
    if (bonus <= 0) return;
    const allyOwner = defeated.ownerId;
    const ally = getBoardDice(this.gameState, allyOwner).find((die) => die.instanceId !== defeated.instanceId);
    if (!ally) return;
    this.gameState = {
      ...this.gameState,
      dice: this.gameState.dice.map((die) => die.instanceId === ally.instanceId ? { ...die, attacksRemaining: die.attacksRemaining + bonus, hasFinishedAttacking: false } : die)
    };
  }

  private applyTranscendenceBeam(attacker: DiceInstanceState, target: DiceInstanceState) {
    const definition = this.definitions.get(attacker.typeId);
    if (!definition || !attacker.gridPosition || !target.gridPosition) return;
    const meta = getRuntimeSkillMeta(definition);
    if (!meta.hasTranscendence) return;
    if (this.transcendenceBeamUsed.has(attacker.instanceId)) return;
    const targetPos = target.gridPosition;
    const basePips = attacker.ownerId === 'player' ? (this.dicePips.get(attacker.typeId) ?? 0) : (this.enemyDicePips.get(attacker.instanceId) ?? 0);
    if (basePips !== 6) return;
    const enemyOwner = attacker.ownerId === 'player' ? 'enemy' : 'player';
    const victims = getBoardDice(this.gameState, enemyOwner).filter((die) => die.instanceId !== target.instanceId && die.gridPosition && (die.gridPosition.row === targetPos.row || die.gridPosition.col === targetPos.col));
    victims.forEach((die) => {
      this.gameState = executeAttack(this.gameState, attacker.instanceId, die.instanceId, new Map([[attacker.typeId, { ...this.definitions.get(attacker.typeId)!, attack: 300 }]])).newState;
    });
    this.gameState = {
      ...this.gameState,
      dice: this.gameState.dice.map((die) => die.instanceId === attacker.instanceId ? { ...die, attacksRemaining: 0, hasFinishedAttacking: true } : die)
    };
    this.transcendenceBeamUsed.add(attacker.instanceId);
  }

  private findTranscendenceBeamTarget(attacker: DiceInstanceState): DiceInstanceState | undefined {
    const definition = this.definitions.get(attacker.typeId);
    if (!definition) return undefined;
    const meta = getRuntimeSkillMeta(definition);
    const basePips = attacker.ownerId === 'player' ? (this.dicePips.get(attacker.typeId) ?? 0) : (this.enemyDicePips.get(attacker.instanceId) ?? 0);
    if (!meta.hasTranscendence || basePips !== 6 || this.transcendenceBeamUsed.has(attacker.instanceId) || !attacker.gridPosition) return undefined;
    const enemyOwner = attacker.ownerId === 'player' ? 'enemy' : 'player';
    const targets = getBoardDice(this.gameState, enemyOwner).filter((die) => die.gridPosition);
    return targets
      .map((die) => ({ die, distance: Math.max(Math.abs((die.gridPosition!.col - attacker.gridPosition!.col)), attacker.ownerId === 'player' ? ((4 - attacker.gridPosition!.row) + 1 + die.gridPosition!.row) : (attacker.gridPosition!.row + 1 + (4 - die.gridPosition!.row)))}))
      .sort((a, b) => a.distance - b.distance)[0]?.die;
  }

  private renderDie(container: Phaser.GameObjects.Container, die: DiceInstanceState, row: number, col: number, isPlayer: boolean) {
    const definition = this.definitions.get(die.typeId);
    if (!definition) return;

    const isDeathTransformed = die.typeId === 'Death' && this.deathDiceTransformed.has(die.instanceId);
    const accentHex = isDeathTransformed ? '#c06bdb' : definition.accent;
    const color = Phaser.Display.Color.HexStringToColor(accentHex).color;
    const x = col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const y = row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;

    const dieRect = this.add.rectangle(x, y, TILE_SIZE - 8, TILE_SIZE - 8, color, isDeathTransformed ? 0.55 : 0.28)
      .setStrokeStyle(2, color);
    dieRect.setData('isDie', true);
    container.add(dieRect);

    const shortLabel = isDeathTransformed ? '☠' : definition.typeId.slice(0, 3).toUpperCase();
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
        ? (this.dicePips.get(die.typeId) ?? this.getPipCount(die.typeId))
        : (this.enemyDicePips.get(die.instanceId) ?? this.getPipCount(die.typeId)));
    const pipLabel = this.add.text(x, y + 2, `${pips}♦`, {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.accent
    }).setOrigin(0.5);
    pipLabel.setName('die-info');
    container.add(pipLabel);

    const hpText = `${die.currentHealth}/${die.maxHealth}`;
    const hpLabel = this.add.text(x, y + 24, hpText, {
      fontFamily: 'Orbitron',
      fontSize: '8px',
      color: PALETTE.text
    }).setOrigin(0.5);
    hpLabel.setName('die-info');
    container.add(hpLabel);
    this.renderHealthBar(container, x, y + 18, die.currentHealth, die.maxHealth);
    const ammo = Math.max(0, die.attacksRemaining);
    const maxAmmo = Math.max(1, this.gameState.combatPhase === 'attacking' ? Math.max(die.attacksRemaining, pips) : this.getPipCount(die.typeId));
    const definitionSkill = this.definitions.get(die.typeId)?.skills[0];
    const manaNeeded = definitionSkill?.manaNeeded ?? maxAmmo;
    const mana = this.manaByInstance.get(die.instanceId) ?? 0;
    this.renderAmmoBar(container, x, y + 28, ammo, maxAmmo);
    this.renderManaBar(container, x, y + 34, mana, Math.max(1, manaNeeded));
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
    const { width } = this.scale;
    const banner = this.add.text(width / 2, -80, text, {
      fontFamily: 'Orbitron',
      fontSize: '40px',
      color: PALETTE.accent
    }).setOrigin(0.5).setDepth(300);
    this.tweens.add({ targets: banner, y: this.scale.height / 2, duration: 300, ease: 'Cubic.easeOut' });
    this.time.delayedCall(1100, () => {
      this.tweens.add({ targets: banner, y: this.scale.height + 80, alpha: 0, duration: 300, ease: 'Cubic.easeIn', onComplete: () => banner.destroy() });
    });
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

  private endGame(stage: 'victory' | 'defeat', message: string) {
    this.gamePhase = { stage };

    const { width, height } = this.scale;
    const centerX = width / 2;
    const centerY = height / 2;

    this.add.rectangle(centerX, centerY, width, height, 0x000000, 0.7);

    const titleColor = stage === 'victory' ? PALETTE.success : PALETTE.danger;
    const titleText = stage === 'victory' ? 'VICTORY!' : 'DEFEAT';

    this.add.text(centerX, centerY - 60, titleText, {
      fontFamily: 'Orbitron',
      fontSize: '48px',
      color: titleColor
    }).setOrigin(0.5);

    this.add.text(centerX, centerY, message, {
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
      this.scene.wake('MenuScene');
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
      this.scene.wake('MenuScene');
      this.scene.start('MenuScene');
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
    g.fillStyle(0x6fa8ff, 1);
    g.fillRoundedRect(x - 18 + (36 * (1 - ratio)), y - 3, 36 * ratio, 5, 2);
    container.add(g);
  }

  private renderManaBar(container: Phaser.GameObjects.Container, x: number, y: number, mana: number, maxMana: number) {
    const ratio = Phaser.Math.Clamp(maxMana > 0 ? mana / maxMana : 0, 0, 1);
    const g = this.add.graphics();
    g.name = 'mana-bar';
    g.fillStyle(0x1f2f3d, 0.95);
    g.fillRoundedRect(x - 18, y - 3, 36, 5, 2);
    g.fillStyle(0x6fa8ff, 1);
    g.fillRoundedRect(x - 18, y - 3, 36 * ratio, 5, 2);
    container.add(g);
  }

  private placeEnemyDiceForTurn() {
    const enemyHandDice = getAvailableHandDice(this.gameState, 'enemy');
    const usedCells = new Set<string>();
    enemyHandDice.forEach((die) => {
      let row = 0;
      let col = 0;
      let key = '';
      let attempts = 0;
      do {
        row = Math.floor(Math.random() * 2);
        col = Math.floor(Math.random() * GRID_SIZE);
        key = `${row},${col}`;
        attempts++;
      } while (usedCells.has(key) && attempts < 50);
      usedCells.add(key);
      this.gameState = placeDieOnBoard(this.gameState, die.instanceId, row, col);
    });
  }
}
