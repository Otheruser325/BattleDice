import Phaser from 'phaser';
import { getAllDiceDefinitions, getDiceProgress, getDiceTokens, getDiamonds, getRemainingUsefulCopies, grantDiceCopies, setDiceTokens, setDiamonds } from '../data/dice';
import { CasinoProgressStore } from '../systems/CasinoProgressStore';
import { PALETTE, drawPanel } from '../ui/theme';
import { AlertManager } from '../utils/AlertManager';
import { SCENE_KEYS } from './sceneKeys';

export class DevScene extends Phaser.Scene {
  static readonly KEY = SCENE_KEYS.Dev;

  private selectedDiceIndex = 0;
  private diceNameText!: Phaser.GameObjects.Text;
  private diceProgressText!: Phaser.GameObjects.Text;
  private walletText!: Phaser.GameObjects.Text;
  private readonly classCopyCosts: Record<number, Record<string, number>> = {
    2: { Common: 10, Uncommon: 8, Rare: 5, Epic: 2, Legendary: 1 },
    3: { Common: 20, Uncommon: 15, Rare: 10, Epic: 4, Legendary: 1 },
    4: { Common: 40, Uncommon: 30, Rare: 15, Epic: 6, Legendary: 2 },
    5: { Common: 80, Uncommon: 50, Rare: 25, Epic: 8, Legendary: 2 },
    6: { Common: 120, Uncommon: 80, Rare: 40, Epic: 10, Legendary: 3 },
    7: { Common: 200, Uncommon: 150, Rare: 75, Epic: 15, Legendary: 3 },
    8: { Common: 400, Uncommon: 250, Rare: 120, Epic: 20, Legendary: 4 },
    9: { Common: 700, Uncommon: 425, Rare: 200, Epic: 30, Legendary: 5 },
    10: { Common: 1000, Uncommon: 750, Rare: 500, Epic: 60, Legendary: 6 },
    11: { Common: 1500, Uncommon: 1000, Rare: 750, Epic: 100, Legendary: 8 },
    12: { Common: 2500, Uncommon: 1750, Rare: 1000, Epic: 200, Legendary: 10 },
    13: { Common: 5000, Uncommon: 3000, Rare: 2000, Epic: 400, Legendary: 12 },
    14: { Common: 7500, Uncommon: 5000, Rare: 3250, Epic: 650, Legendary: 15 },
    15: { Common: 10000, Uncommon: 7500, Rare: 5000, Epic: 1000, Legendary: 20 }
  };

  constructor() {
    super(DevScene.KEY);
  }

  create() {
    const panel = drawPanel(this, 'DEV BUILD MENU', 'PLAYTEST GRANTS — SHIPS ENABLED');

    this.add.text(panel.x + 30, panel.y + 92, 'Use these controls to seed local playtest progress without affecting game balance tuning.', {
      fontFamily: 'Orbitron',
      fontSize: '13px',
      color: PALETTE.textMuted,
      wordWrap: { width: panel.width - 60 }
    });

    this.drawDiceGrantPanel(panel.x + 38, panel.y + 142, panel.width * 0.56, 300);
    this.drawCurrencyGrantPanel(panel.x + panel.width * 0.64, panel.y + 142, panel.width * 0.30, 300);
    this.refresh();
  }

  private drawDiceGrantPanel(x: number, y: number, width: number, height: number) {
    this.add.rectangle(x + width / 2, y + height / 2, width, height, 0x173247, 0.94)
      .setStrokeStyle(1, 0x4f7ea1);
    this.add.text(x + 18, y + 16, 'DICE CARD GRANTS', {
      fontFamily: 'Orbitron',
      fontSize: '16px',
      color: PALETTE.accent
    });

    this.diceNameText = this.add.text(x + width / 2, y + 82, '', {
      fontFamily: 'Orbitron',
      fontSize: '24px',
      color: PALETTE.text,
      align: 'center'
    }).setOrigin(0.5);

    this.diceProgressText = this.add.text(x + width / 2, y + 122, '', {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.textMuted,
      align: 'center'
    }).setOrigin(0.5);

    this.makeButton(x + 70, y + 82, '◀ PREV', () => this.stepDice(-1));
    this.makeButton(x + width - 70, y + 82, 'NEXT ▶', () => this.stepDice(1));

    this.makeButton(x + 96, y + 190, '+10 CARDS', () => this.grantDiceCards(10));
    this.makeButton(x + 236, y + 190, '+100 CARDS', () => this.grantDiceCards(100));
    this.makeButton(x + 390, y + 190, '+1000 CARDS', () => this.grantDiceCards(1000));
    this.makeButton(x + width / 2, y + 244, 'UNLOCK / MAX SELECTED DIE', () => this.grantDiceCardsToMaxClass());
  }

  private drawCurrencyGrantPanel(x: number, y: number, width: number, height: number) {
    this.add.rectangle(x + width / 2, y + height / 2, width, height, 0x173247, 0.94)
      .setStrokeStyle(1, 0x4f7ea1);
    this.add.text(x + 18, y + 16, 'WALLET GRANTS', {
      fontFamily: 'Orbitron',
      fontSize: '16px',
      color: PALETTE.accent
    });

    this.walletText = this.add.text(x + width / 2, y + 62, '', {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.textMuted,
      align: 'center',
      lineSpacing: 7
    }).setOrigin(0.5, 0);

    this.add.text(x + 18, y + 104, 'Dice Tokens', {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.text
    });
    this.makeButton(x + 58, y + 143, '+1,000', () => this.grantTokens(1_000));
    this.makeButton(x + 128, y + 143, '+10,000', () => this.grantTokens(10_000));
    this.makeButton(x + 210, y + 143, '+100,000', () => this.grantTokens(100_000));

    this.add.text(x + 18, y + 164, 'Diamonds', {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.text
    });
    this.makeButton(x + 52, y + 203, '+10', () => this.grantDiamonds(10));
    this.makeButton(x + 116, y + 203, '+100', () => this.grantDiamonds(100));
    this.makeButton(x + 188, y + 203, '+1,000', () => this.grantDiamonds(1_000));

    this.add.text(x + 18, y + 224, 'Casino Chips', {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.text
    });
    this.makeButton(x + 52, y + 263, '+10', () => this.grantChips(10));
    this.makeButton(x + 116, y + 263, '+100', () => this.grantChips(100));
    this.makeButton(x + 188, y + 263, '+1,000', () => this.grantChips(1_000));
  }

  private makeButton(x: number, y: number, label: string, onClick: () => void) {
    const button = this.add.text(x, y, label, {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: '#071018',
      backgroundColor: PALETTE.accent,
      padding: { left: 10, right: 10, top: 6, bottom: 6 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    button.on('pointerdown', onClick);
    button.on('pointerover', () => button.setBackgroundColor(PALETTE.accentSoft));
    button.on('pointerout', () => button.setBackgroundColor(PALETTE.accent));
    return button;
  }

  private stepDice(direction: number) {
    const definitions = getAllDiceDefinitions(this);
    if (!definitions.length) return;
    this.selectedDiceIndex = Phaser.Math.Wrap(this.selectedDiceIndex + direction, 0, definitions.length);
    this.refresh();
  }

  private getSelectedDefinition() {
    const definitions = getAllDiceDefinitions(this);
    return definitions[this.selectedDiceIndex % Math.max(1, definitions.length)] ?? null;
  }

  private grantDiceCards(copies: number) {
    const definition = this.getSelectedDefinition();
    if (!definition) return;
    const remainingUseful = getRemainingUsefulCopies(this, definition.typeId);
    const grantAmount = Math.min(copies, remainingUseful);
    if (grantAmount <= 0) {
      AlertManager.toast(this, { type: 'warning', message: `${definition.title} cannot receive more useful copies.` });
      return;
    }
    grantDiceCopies(this, definition.typeId, grantAmount);
    const cappedSuffix = grantAmount < copies ? ` (requested ${copies}, capped at ${grantAmount})` : '';
    AlertManager.toast(this, { type: 'success', message: `Granted ${grantAmount} ${definition.title} card${grantAmount === 1 ? '' : 's'}${cappedSuffix}.` });
    this.refresh();
  }

  private grantDiceCardsToMaxClass() {
    const definition = this.getSelectedDefinition();
    if (!definition) return;
    const progress = getDiceProgress(this, definition.typeId);
    if (!progress.unlocked) {
      grantDiceCopies(this, definition.typeId, 1);
      AlertManager.toast(this, { type: 'success', message: `${definition.title} unlocked. Click again to max selected die class copies.` });
      this.refresh();
      return;
    }
    const copiesNeeded = this.getCopiesNeededToReachMaxClass(progress.classLevel, progress.copies, definition.rarity);
    if (copiesNeeded <= 0) {
      AlertManager.toast(this, { type: 'warning', message: `${definition.title} is already maxed for available copy progression.` });
      return;
    }
    grantDiceCopies(this, definition.typeId, copiesNeeded);
    AlertManager.toast(this, { type: 'success', message: `Granted ${copiesNeeded} ${definition.title} card${copiesNeeded === 1 ? '' : 's'} to reach max class progression.` });
    this.refresh();
  }

  private getCopiesNeededToReachMaxClass(classLevel: number, copies: number, rarity: string): number {
    let level = classLevel;
    let remainingCopies = copies;
    let additional = 0;
    while (level < 15) {
      const nextLevel = level + 1;
      const required = this.classCopyCosts[nextLevel]?.[rarity] ?? 0;
      if (required <= 0) break;
      if (remainingCopies < required) {
        additional += required - remainingCopies;
        remainingCopies = 0;
      } else {
        remainingCopies -= required;
      }
      level = nextLevel;
    }
    return additional;
  }

  private grantChips(amount: number) {
    CasinoProgressStore.mutate(this, (progress) => ({ ...progress, chips: progress.chips + amount }));
    AlertManager.toast(this, { type: 'success', message: `Granted ${amount} casino chips.` });
    this.refresh();
  }

  private grantTokens(amount: number) {
    setDiceTokens(this, getDiceTokens(this) + amount);
    AlertManager.toast(this, { type: 'success', message: `Granted ${amount} dice tokens.` });
    this.refresh();
  }

  private grantDiamonds(amount: number) {
    setDiamonds(this, getDiamonds(this) + amount);
    AlertManager.toast(this, { type: 'success', message: `Granted ${amount} diamonds.` });
    this.refresh();
  }

  private refresh() {
    const definition = this.getSelectedDefinition();
    if (definition) {
      const progress = getDiceProgress(this, definition.typeId);
      this.diceNameText.setText(`${definition.title} (${definition.rarity})`);
      this.diceProgressText.setText(`Type ID: ${definition.typeId}  •  Class ${progress.classLevel}  •  ${progress.copies} cards`);
    } else {
      this.diceNameText.setText('No dice loaded');
      this.diceProgressText.setText('Dice catalog unavailable.');
    }

    const casino = CasinoProgressStore.get(this);
    this.walletText.setText([
      `Casino Chips: ${casino.chips}`,
      `Dice Tokens: ${getDiceTokens(this)}`,
      `Diamonds: ${getDiamonds(this)}`
    ].join('\n'));
  }
}
