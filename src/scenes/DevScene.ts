import Phaser from 'phaser';
import { getAllDiceDefinitions, getDiceProgress, getDiceTokens, getDiamonds, grantDiceCopies, setDiceTokens, setDiamonds } from '../data/dice';
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
    this.makeButton(x + width / 2, y + 244, 'UNLOCK / TOP UP SELECTED DIE', () => this.grantDiceCards(1));
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

    this.makeButton(x + width / 2, y + 146, '+100 CASINO CHIPS', () => this.grantChips(100));
    this.makeButton(x + width / 2, y + 190, '+1000 DICE TOKENS', () => this.grantTokens(1000));
    this.makeButton(x + width / 2, y + 234, '+100 DIAMONDS', () => this.grantDiamonds(100));
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
    grantDiceCopies(this, definition.typeId, copies);
    AlertManager.toast(this, { type: 'success', message: `Granted ${copies} ${definition.title} card${copies === 1 ? '' : 's'}.` });
    this.refresh();
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
