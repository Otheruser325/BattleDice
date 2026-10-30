import Phaser from 'phaser';
import { getAllDiceDefinitions, getClassCopyCost, getDiceProgress, getTalentClassNeeded, getTalents, getUnobtainableTalentReason, getDiceTokens, getDiamonds, getRemainingUsefulCopies, grantDiceCopies, grantTalent, isTalentOwned, setDiceProgress, setDiceTokens, setDiamonds } from '../data/dice';
import { CasinoProgressStore } from '../systems/CasinoProgressStore';
import { PALETTE, drawPanel } from '../ui/theme';
import { AlertManager } from '../utils/AlertManager';
import { SCENE_KEYS } from './sceneKeys';
import { formatCompact } from '../utils/FormatManager';
import { DEV_MENU_AVAILABLE } from '../utils/BuildFlags';

export class DevScene extends Phaser.Scene {
  static readonly KEY = SCENE_KEYS.Dev;

  private selectedDiceIndex = 0;
  private diceNameText!: Phaser.GameObjects.Text;
  private diceProgressText!: Phaser.GameObjects.Text;
  private walletText!: Phaser.GameObjects.Text;
  private diceTalentText!: Phaser.GameObjects.Text;
  constructor() {
    super(DevScene.KEY);
  }

  create() {
    if (!DEV_MENU_AVAILABLE) {
      this.scene.stop(DevScene.KEY);
      return;
    }

    const panel = drawPanel(this, 'DEV BUILD MENU', 'PLAYTEST GRANTS — SHIPS ENABLED');

    this.add.text(panel.x + 30, panel.y + 92, 'Use these controls to seed local playtest progress without affecting game balance tuning.', {
      fontFamily: 'Orbitron',
      fontSize: '13px',
      color: PALETTE.textMuted,
      wordWrap: { width: panel.width - 60 }
    });

    this.drawDiceGrantPanel(panel.x + 38, panel.y + 142, panel.width * 0.56, 360);
    this.drawCurrencyGrantPanel(panel.x + panel.width * 0.64, panel.y + 142, panel.width * 0.30, 360);
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

    this.makeButton(x + 64, y + 190, '+10 CARDS', () => this.grantDiceCards(10));
    this.makeButton(x + 164, y + 190, '+100 CARDS', () => this.grantDiceCards(100));
    this.makeButton(x + 274, y + 190, '+1000 CARDS', () => this.grantDiceCards(1000));
    this.makeButton(x + 390, y + 190, 'CLASS UP', () => this.classUpSelectedDie());
    this.makeButton(x + width / 2, y + 244, 'UNLOCK / MAX SELECTED DIE', () => this.grantDiceCardsToMaxClass());

    this.diceTalentText = this.add.text(x + width / 2, y + 278, '', {
      fontFamily: 'Orbitron',
      fontSize: '11px',
      color: PALETTE.textMuted,
      align: 'center',
      wordWrap: { width: width - 60 }
    }).setOrigin(0.5);
    this.makeButton(x + width / 2, y + 318, 'ENABLE COMPATIBLE TALENTS', () => this.enableCompatibleTalents());
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
    this.makeButton(x + 300, y + 143, '+1,000,000', () => this.grantTokens(1_000_000));

    this.add.text(x + 18, y + 164, 'Diamonds', {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.text
    });
    this.makeButton(x + 52, y + 203, '+10', () => this.grantDiamonds(10));
    this.makeButton(x + 116, y + 203, '+100', () => this.grantDiamonds(100));
    this.makeButton(x + 188, y + 203, '+1,000', () => this.grantDiamonds(1_000));
    this.makeButton(x + 268, y + 203, '+10,000', () => this.grantDiamonds(10_000));

    this.add.text(x + 18, y + 224, 'Casino Chips', {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.text
    });
    this.makeButton(x + 52, y + 263, '+10', () => this.grantChips(10));
    this.makeButton(x + 116, y + 263, '+100', () => this.grantChips(100));
    this.makeButton(x + 188, y + 263, '+1,000', () => this.grantChips(1_000));

    this.add.text(x + 18, y + 284, 'Fives Gauge', {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.text
    });
    this.makeButton(x + 52, y + 323, '+100', () => this.grantGauge(100));
    this.makeButton(x + 128, y + 323, 'Set 1k', () => this.setGauge(1000));
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
    const cappedSuffix = grantAmount < copies ? ` (requested ${formatCompact(copies)}, capped at ${formatCompact(grantAmount)})` : '';
    AlertManager.toast(this, { type: 'success', message: `Granted ${formatCompact(grantAmount)} ${definition.title} card${grantAmount === 1 ? '' : 's'}${cappedSuffix}.` });
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
    AlertManager.toast(this, { type: 'success', message: `Granted ${formatCompact(copiesNeeded)} ${definition.title} card${copiesNeeded === 1 ? '' : 's'} to reach max class progression.` });
    this.refresh();
  }

  private getCopiesNeededToReachMaxClass(classLevel: number, copies: number, rarity: string): number {
    let level = classLevel;
    let remainingCopies = copies;
    let additional = 0;
    while (level < 15) {
      const nextLevel = level + 1;
      const required = getClassCopyCost(nextLevel, rarity);
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

  private enableCompatibleTalents() {
    const definition = this.getSelectedDefinition();
    if (!definition) return;
    const talents = getTalents(definition);
    if (talents.length === 0) {
      AlertManager.toast(this, { type: 'warning', message: `${definition.title} has no talents to enable.` });
      return;
    }
    const granted: string[] = [];
    const blockedByClass: string[] = [];
    let locked = false;
    talents.forEach((talent, index) => {
      const reason = getUnobtainableTalentReason(this, definition, index);
      if (reason === null) {
        if (grantTalent(this, definition, index)) granted.push(talent.title);
        return;
      }
      if (reason === 'class') blockedByClass.push(`${talent.title} (class ${getTalentClassNeeded(talent)})`);
      if (reason === 'locked') locked = true;
    });
    if (granted.length > 0) {
      AlertManager.toast(this, { type: 'success', message: `Enabled ${granted.join(', ')} on ${definition.title}.` });
    } else if (locked) {
      AlertManager.toast(this, { type: 'warning', message: `Unlock ${definition.title} before enabling its talents.` });
    } else if (blockedByClass.length > 0) {
      AlertManager.toast(this, { type: 'warning', message: `Class up ${definition.title} first: ${blockedByClass.join(', ')}.` });
    } else {
      AlertManager.toast(this, { type: 'warning', message: `${definition.title} has no compatible talents left to enable.` });
    }
    this.refresh();
  }

  private classUpSelectedDie() {
    const definition = this.getSelectedDefinition();
    if (!definition) return;
    const progress = getDiceProgress(this, definition.typeId);
    if (progress.classLevel >= 15) {
      AlertManager.toast(this, { type: 'warning', message: `${definition.title} is already at max class.` });
      return;
    }
    const nextLevel = progress.classLevel + 1;
    setDiceProgress(this, definition.typeId, {
      ...progress,
      classLevel: nextLevel
    });
    AlertManager.toast(this, { type: 'success', message: `Upgraded ${definition.title} to Class ${nextLevel}.` });
    this.refresh();
  }

  private grantChips(amount: number) {
    CasinoProgressStore.mutate(this, (progress) => ({ ...progress, chips: progress.chips + amount }));
    AlertManager.toast(this, { type: 'success', message: `Granted ${formatCompact(amount)} casino chips.` });
    this.refresh();
  }

  private grantTokens(amount: number) {
    setDiceTokens(this, getDiceTokens(this) + amount);
    AlertManager.toast(this, { type: 'success', message: `Granted ${formatCompact(amount)} dice tokens.` });
    this.refresh();
  }

  private grantDiamonds(amount: number) {
    setDiamonds(this, getDiamonds(this) + amount);
    AlertManager.toast(this, { type: 'success', message: `Granted ${formatCompact(amount)} diamonds.` });
    this.refresh();
  }

  private grantGauge(amount: number) {
    CasinoProgressStore.mutate(this, (progress) => ({ ...progress, fivesGauge: progress.fivesGauge + amount }));
    AlertManager.toast(this, { type: 'success', message: `Granted ${formatCompact(amount)} to Fives gauge.` });
    this.refresh();
  }

  private setGauge(amount: number) {
    CasinoProgressStore.mutate(this, (progress) => ({ ...progress, fivesGauge: amount }));
    AlertManager.toast(this, { type: 'success', message: `Set Fives gauge to ${formatCompact(amount)}.` });
    this.refresh();
  }

  private refresh() {
    const definition = this.getSelectedDefinition();
    if (definition) {
      const progress = getDiceProgress(this, definition.typeId);
      this.diceNameText.setText(`${definition.title} (${definition.rarity})`);
      this.diceProgressText.setText(`Type ID: ${definition.typeId}  •  Class ${progress.classLevel}  •  ${formatCompact(progress.copies)} cards`);
      const talents = getTalents(definition);
      if (talents.length === 0) {
        this.diceTalentText.setText('Talents: none available');
      } else if (definition.talentsComingSoon) {
        this.diceTalentText.setText('Talents: coming soon');
      } else {
        const owned = talents.filter((_, index) => isTalentOwned(this, definition.typeId, index)).length;
        const classGated = talents.filter((talent, index) => getUnobtainableTalentReason(this, definition, index) === 'class').length;
        this.diceTalentText.setText(`Talents: ${owned}/${talents.length} owned${classGated > 0 ? ` • ${classGated} need a higher class` : ''}`);
      }
    } else {
      this.diceNameText.setText('No dice loaded');
      this.diceProgressText.setText('Dice catalog unavailable.');
      this.diceTalentText.setText('Talents: unavailable');
    }

    const casino = CasinoProgressStore.get(this);
    this.walletText.setText([
      `Casino Chips: ${formatCompact(casino.chips)}`,
      `Dice Tokens: ${formatCompact(getDiceTokens(this))}`,
      `Diamonds: ${formatCompact(getDiamonds(this))}`,
      `Fives Gauge: ${formatCompact(casino.fivesGauge)}/${formatCompact(1000)}`
    ].join('\n'));
  }
}
