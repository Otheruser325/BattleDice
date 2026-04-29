import Phaser from 'phaser';
import { getDiceDefinitions } from '../data/dice';
import {
  createMatchBattleState,
  getAvailableHandDice,
  placeDieOnBoard,
  getBoardDice,
  getLivingDiceCount,
  getNextAttacker,
  findAttackTarget,
  executeAttack,
  resolveCombatPhase,
  endTurn,
  type MatchBattleState
} from '../systems/BattleState';
import { DebugManager } from '../utils/DebugManager';
import { PALETTE, getLayout } from '../ui/theme';
import type { DiceTypeId, DiceInstanceState, DiceDefinition } from '../types/game';

interface PlacedDie {
  typeId: DiceTypeId;
  row: number;
  col: number;
  pips: number;
}

interface GamePhase {
  stage: 'lobby' | 'placement' | 'combat' | 'resolved' | 'victory' | 'defeat';
}

const DEFAULT_PLAYER_LOADOUT: DiceTypeId[] = ['Fire', 'Ice', 'Poison', 'Lightning', 'Wind'];

const GRID_SIZE = 5;
const TILE_SIZE = 64;
const TILE_GAP = 8;

export class ArenaScene extends Phaser.Scene {
  static readonly KEY = 'ArenaScene';
  private readonly debug = DebugManager.attachScene(ArenaScene.KEY);

  private gameState!: MatchBattleState;
  private definitions!: Map<DiceTypeId, DiceDefinition>;
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
  private rollAllButton!: Phaser.GameObjects.Rectangle;
  private rollAllButtonLabel!: Phaser.GameObjects.Text;
  private diceRolled = false;
  private currentHandOrder: DiceTypeId[] = [];

  constructor() {
    super(ArenaScene.KEY);
  }

  create() {
    const layout = getLayout(this);

    this.definitions = new Map(getDiceDefinitions(this).map((die) => [die.typeId, die]));

    this.createBackground(layout);
    this.createLobbyUI();

    this.debug.log('Arena scene created', { phase: this.gamePhase.stage });
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
    playButton.on('pointerdown', () => this.startGame());

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

  private startGame() {
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

  private initializeBattle() {
    const playerDefs = getDiceDefinitions(this);
    const enemyDefs = this.pickRandomEnemyLoadout(playerDefs);
    this.gameState = createMatchBattleState(playerDefs, enemyDefs);

    const enemyPositions = this.generateEnemyPositions();
    enemyPositions.forEach((pos, index) => {
      const instanceId = `enemy-${pos.typeId}-${index + 1}`;
      this.gameState = placeDieOnBoard(this.gameState, instanceId, pos.row, pos.col);
    });

    this.turnText.setVisible(true);
    this.turnText.setText(`TURN ${this.gameState.turn}`);

    this.createHandArea();
    this.setupGridDropZones();
    this.createCombatUI();
    this.updateCombatButtonState();

    this.debug.log('Battle initialized', { turn: this.gameState.turn });
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
      case 'Lightning': return 3;
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
    const canStart = this.placedDiceCount >= requiredDice;
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
    const buttonY = height - 100;

    this.combatLog = this.add.text(centerX, buttonY - 40, 'Place your dice, then start combat!', {
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

    this.startCombatButton.on('pointerover', () => this.startCombatButton.setFillStyle(0xc0392b, 1));
    this.startCombatButton.on('pointerout', () => this.startCombatButton.setFillStyle(0xe74c3c, 0.9));
    this.startCombatButton.on('pointerdown', () => this.startCombat());
  }

  private async startCombat() {
    this.startCombatButton.disableInteractive();
    this.startCombatButton.setFillStyle(0x7f8c8d, 0.5);

    this.gamePhase = { stage: 'combat' };

    this.invisiRollForEnemies();

    this.enemyFogOverlay.setVisible(false);
    this.enemyFogText.setVisible(false);
    this.renderEnemyDice();

    this.playTurnBanner('START!');
    this.combatLog.setText('Combat started! Revealing enemy positions...');
    await this.delay(1000);

    this.gameState = this.beginCombatPhaseWithRolledPips();
    await this.runCombatLoop();
  }

  private beginCombatPhaseWithRolledPips(): MatchBattleState {
    const playerBoardDice = getBoardDice(this.gameState, 'player');
    const enemyBoardDice = getBoardDice(this.gameState, 'enemy');
    const playerBonus = playerBoardDice.some((die) => die.typeId === 'Light') ? 1 : 0;
    const enemyBonus = enemyBoardDice.some((die) => die.typeId === 'Light') ? 1 : 0;

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

        return {
          ...die,
          hasFinishedAttacking: false,
          attacksRemaining: pips
        };
      })
    };
  }

  private async runCombatLoop() {
    const owners: ['player', 'enemy'] = ['player', 'enemy'];

    for (const owner of owners) {
      const ownerName = owner === 'player' ? 'Your' : 'Enemy';

      while (true) {
        const attacker = getNextAttacker(this.gameState, owner);
        if (!attacker) break;

        const target = attacker.typeId === 'Broken'
          ? this.findRandomTarget(attacker)
          : findAttackTarget(this.gameState, attacker, this.definitions);
        if (!target) {
          this.combatLog.setText(`${ownerName} ${attacker.typeId} has no target!`);
          await this.delay(500);
          break;
        }

        const result = executeAttack(this.gameState, attacker.instanceId, target.instanceId, this.definitions);
        this.gameState = result.newState;

        this.combatLog.setText(
          `${ownerName} ${attacker.typeId} attacks ${target.typeId} for ${result.damage} damage!${result.targetDestroyed ? ' DESTROYED!' : ''}`
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

    this.gameState = resolveCombatPhase(this.gameState);
    this.gameState = endTurn(this.gameState);

    await this.returnDiceToHand();

    this.turnText.setText(`TURN ${this.gameState.turn}`);
    this.playTurnBanner(`TURN ${this.gameState.turn}`);
    this.combatLog.setText(`Turn ${this.gameState.turn} - Roll and place your dice!`);

    this.startCombatButton.setInteractive({ useHandCursor: true });
    this.startCombatButton.setFillStyle(0xe74c3c, 0.9);
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
      if (child instanceof Phaser.GameObjects.Graphics && child.name === 'hp-bar') childrenToRemove.push(child);
    });
    childrenToRemove.forEach((child) => child.destroy());

    const enemyDice = getBoardDice(this.gameState, 'enemy');
    enemyDice.forEach((die: DiceInstanceState) => {
      if (die.gridPosition) {
        const definition = this.definitions.get(die.typeId);
        if (!definition) return;

        const color = Phaser.Display.Color.HexStringToColor(definition.accent).color;
        const x = die.gridPosition.col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
        const y = die.gridPosition.row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;

        const dieRect = this.add.rectangle(x, y, TILE_SIZE - 8, TILE_SIZE - 8, color, 0.28).setStrokeStyle(2, color);
        dieRect.setData('isDie', true);
        this.enemyGridContainer.add(dieRect);

        const label = this.add.text(x, y - 8, definition.typeId.slice(0, 3).toUpperCase(), {
          fontFamily: 'Orbitron',
          fontSize: '12px',
          color: definition.accent
        }).setOrigin(0.5);
        label.setName('die-info');
        this.enemyGridContainer.add(label);

        this.renderHealthBar(this.enemyGridContainer, x, y + 16, die.currentHealth, die.maxHealth);
      }
    });
    this.renderDiceStatusPanel(this.enemyStatusPanel, enemyDice, 'OPPONENT');
  }

  private generateEnemyPositions(): PlacedDie[] {
    const types = getAvailableHandDice(this.gameState, 'enemy').map((die) => die.typeId);
    const positions: PlacedDie[] = [];
    const usedCells = new Set<string>();

    for (let i = 0; i < types.length; i++) {
      let row: number, col: number, key: string;
      do {
        row = Math.floor(Math.random() * 2);
        col = Math.floor(Math.random() * GRID_SIZE);
        key = `${row},${col}`;
      } while (usedCells.has(key));
      usedCells.add(key);
      positions.push({ typeId: types[i] as DiceTypeId, row, col, pips: 1 });
    }
    return positions;
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
      const status = diceUnit.isDestroyed ? 'DEFEATED' : `${diceUnit.currentHealth}/${diceUnit.maxHealth} HP`;
      panel.add(this.add.text(0, 20 + index * 16, `${diceUnit.typeId}: ${status}`, { fontFamily: 'Orbitron', fontSize: '11px', color: diceUnit.isDestroyed ? PALETTE.danger : PALETTE.textMuted }));
    });
  }

  private pickRandomEnemyLoadout(pool: DiceDefinition[]): DiceDefinition[] {
    const targetCount = Math.max(3, Math.min(6, pool.length));
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, targetCount);
  }

  private renderDie(container: Phaser.GameObjects.Container, die: DiceInstanceState, row: number, col: number, isPlayer: boolean) {
    const definition = this.definitions.get(die.typeId);
    if (!definition) return;

    const color = Phaser.Display.Color.HexStringToColor(definition.accent).color;
    const x = col * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;
    const y = row * (TILE_SIZE + TILE_GAP) + TILE_SIZE / 2;

    const dieRect = this.add.rectangle(x, y, TILE_SIZE - 8, TILE_SIZE - 8, color, 0.28)
      .setStrokeStyle(2, color);
    dieRect.setData('isDie', true);
    container.add(dieRect);

    const label = this.add.text(x, y - 12, definition.typeId.slice(0, 3).toUpperCase(), {
      fontFamily: 'Orbitron',
      fontSize: '11px',
      color: definition.accent
    }).setOrigin(0.5);
    container.add(label);

    const pips = isPlayer
      ? (this.dicePips.get(die.typeId) ?? this.getPipCount(die.typeId))
      : (this.enemyDicePips.get(die.instanceId) ?? this.getPipCount(die.typeId));
    const pipLabel = this.add.text(x, y + 2, `${pips}♦`, {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.accent
    }).setOrigin(0.5);
    container.add(pipLabel);

    const hpText = `${die.currentHealth}/${die.maxHealth}`;
    const hpLabel = this.add.text(x, y + 24, hpText, {
      fontFamily: 'Orbitron',
      fontSize: '8px',
      color: PALETTE.text
    }).setOrigin(0.5);
    hpLabel.setName('die-info');
    container.add(hpLabel);
    this.renderHealthBar(container, x, y + 16, die.currentHealth, die.maxHealth);
    const ammo = Math.max(0, die.attacksRemaining);
    const maxAmmo = Math.max(1, this.getPipCount(die.typeId));
    this.renderAmmoBar(container, x + 24, y + 16, ammo, maxAmmo);
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

  private findRandomTarget(attacker: DiceInstanceState): DiceInstanceState | undefined {
    const enemyOwner = attacker.ownerId === 'player' ? 'enemy' : 'player';
    const targets = getBoardDice(this.gameState, enemyOwner);
    if (!targets.length) return undefined;
    return targets[Math.floor(Math.random() * targets.length)];
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
    g.name = 'hp-bar';
    g.fillStyle(0x1f2f3d, 0.95);
    g.fillRoundedRect(x - 14, y - 3, 28, 6, 2);
    g.fillStyle(0x6fa8ff, 1);
    g.fillRoundedRect(x - 14, y - 3, 28 * ratio, 6, 2);
    container.add(g);
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
    quit.on('pointerdown', () => this.scene.start('MenuScene'));
    this.exitPromptElements = [overlay, panel, label, hint, cancel, quit];
    this.exitPromptElements.forEach((node) => (node as any).setDepth?.(400));
  }

  private closeExitPrompt() {
    this.exitPromptOpen = false;
    this.exitPromptElements.forEach((node) => node.destroy());
    this.exitPromptElements = [];
  }
}
