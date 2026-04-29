import Phaser from 'phaser';
import {
  getAllDiceDefinitions,
  getPrimarySkill,
  getRangeLabel,
  getSelectedLoadout,
  setSelectedLoadout,
  getDiceTokens,
  getDiceProgress,
  setDiceProgress,
  setDiceTokens
} from '../data/dice';
import { DebugManager } from '../utils/DebugManager';
import { PALETTE, drawPanel } from '../ui/theme';

export class DiceScene extends Phaser.Scene {
  static readonly KEY = 'DiceScene';
  private readonly debug = DebugManager.attachScene(DiceScene.KEY);

  private modalElements: Phaser.GameObjects.GameObject[] = [];

  private readonly classTokenCosts: Record<number, Record<string, number>> = {
    2: { Common: 50, Uncommon: 75, Rare: 100, Epic: 200, Legendary: 500 },
    3: { Common: 150, Uncommon: 225, Rare: 400, Epic: 750, Legendary: 1500 },
    4: { Common: 300, Uncommon: 450, Rare: 800, Epic: 1500, Legendary: 3000 },
    5: { Common: 500, Uncommon: 750, Rare: 1500, Epic: 3000, Legendary: 6000 }
  };

  constructor() {
    super(DiceScene.KEY);
  }

  create() {
    const panel = drawPanel(this, 'DICE', 'Default loadout  |  five starter autorollers');
    const definitions = getAllDiceDefinitions(this);
    let loadout = getSelectedLoadout(this);
    this.debug.log('Dice scene rendered.', { diceCount: definitions.length });

    let tokens = getDiceTokens(this);
    const tokenText = this.add.text(panel.x + 28, panel.y + 58, `DICE TOKENS: ${tokens}  •  Click cards to assign selected slot`, {
      fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.accentSoft
    });
    const slotText = this.add.text(panel.x + 28, panel.y + 78, '', { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.text });
    const slotBoxes: Phaser.GameObjects.Rectangle[] = [];
    const slotLabels: Phaser.GameObjects.Text[] = [];
    let selectedSlot = 0;
    const slotStartX = panel.centerX - 260;
    for (let i = 0; i < 5; i++) {
      const x = slotStartX + i * 130;
      const box = this.add.rectangle(x, panel.y + 118, 118, 46, 0x173247, 0.95).setStrokeStyle(2, 0x406987).setInteractive({ useHandCursor: true });
      const lbl = this.add.text(x, panel.y + 118, loadout[i]?.slice(0, 4).toUpperCase() ?? '-', { fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.text }).setOrigin(0.5);
      box.on('pointerdown', () => {
        selectedSlot = i;
        refreshSlots();
      });
      slotBoxes.push(box);
      slotLabels.push(lbl);
    }

    const refreshSlots = () => {
      slotText.setText(`LOADOUT VIEW (top-mid): ${loadout.join(' | ')}  •  Active slot: ${selectedSlot + 1}`);
      slotBoxes.forEach((box, i) => box.setStrokeStyle(2, i === selectedSlot ? 0xf4b860 : 0x406987));
      slotLabels.forEach((lbl, i) => lbl.setText(loadout[i]?.slice(0, 4).toUpperCase() ?? '-'));
    };
    refreshSlots();

    definitions.forEach((die, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const x = panel.x + 28 + col * 360;
      const y = panel.y + 160 + row * 210;
      const accent = Phaser.Display.Color.HexStringToColor(die.accent).color;

      const card = this.add.rectangle(x + 160, y + 84, 320, 176, 0x173247, 0.98).setInteractive({ useHandCursor: true })
        .setStrokeStyle(2, accent);
      this.add.rectangle(x + 160, y + 22, 320, 42, accent, 0.18);

      this.add.text(x + 20, y + 10, die.title.toUpperCase(), {
        fontFamily: 'Orbitron',
        fontSize: '20px',
        color: die.accent
      });

      this.add.text(x + 20, y + 52, `${die.rarity.toUpperCase()}  |  ATK ${die.attack}   |   HP ${die.health}   |   RANGE ${die.range} (${getRangeLabel(die.range)})`, {
        fontFamily: 'Orbitron',
        fontSize: '12px',
        color: PALETTE.text
      });

      const primarySkill = getPrimarySkill(die);
      const manaLine = primarySkill?.type === 'Active' && primarySkill.manaNeeded
        ? `Mana ${primarySkill.manaNeeded}`
        : 'Passive ready';
      this.add.text(x + 20, y + 78, `${primarySkill?.type?.toUpperCase() ?? 'PASSIVE'}  |  ${manaLine}`, {
        fontFamily: 'Orbitron',
        fontSize: '12px',
        color: PALETTE.accentSoft
      });

      this.add.text(x + 20, y + 106, primarySkill?.title ?? 'No skill', {
        fontFamily: 'Orbitron',
        fontSize: '14px',
        color: PALETTE.text
      });

      this.add.text(x + 20, y + 130, primarySkill?.description ?? '', {
        fontFamily: 'Orbitron',
        fontSize: '12px',
        color: PALETTE.textMuted,
        wordWrap: { width: 280 }
      });

      card.on('pointerdown', () => {
        this.openDiceModal(die.typeId, tokenText, () => {
          loadout = getSelectedLoadout(this);
          refreshSlots();
          tokens = getDiceTokens(this);
          tokenText.setText(`DICE TOKENS: ${tokens}  •  Click cards to assign selected slot`);
        });
      });
      card.on('pointerover', () => card.setFillStyle(0x1f3e56, 1));
      card.on('pointerout', () => card.setFillStyle(0x173247, 0.98));
    });

    this.input.keyboard?.on('keydown-TAB', (event: KeyboardEvent) => {
      event.preventDefault();
      selectedSlot = (selectedSlot + 1) % 5;
      refreshSlots();
    });
  }

  private openDiceModal(typeId: string, tokenText: Phaser.GameObjects.Text, onUpdate: () => void) {
    this.modalElements.forEach((el) => el.destroy());
    this.modalElements = [];
    const die = getAllDiceDefinitions(this).find((definition) => definition.typeId === typeId);
    if (!die) return;
    const progress = getDiceProgress(this, typeId);
    const { width, height } = this.scale;
    const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.55).setInteractive();
    const panel = this.add.rectangle(width / 2, height / 2, 520, 360, 0x102434, 0.98).setStrokeStyle(2, 0x406987);
    const cls = progress.classLevel;
    const hp = die.health + (cls - 1) * 8;
    const atk = die.attack + (cls - 1) * 2;
    const title = this.add.text(width / 2, height / 2 - 140, `${die.title} • CLASS ${cls}/15`, { fontFamily: 'Orbitron', fontSize: '20px', color: die.accent }).setOrigin(0.5);
    const stats = this.add.text(width / 2, height / 2 - 95, `ATK ${atk}  |  HP ${hp}  |  RANGE ${die.range} (${getRangeLabel(die.range)})\nRARITY ${die.rarity}  |  COPIES ${progress.copies}`, { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.text, align: 'center' }).setOrigin(0.5);
    const skill = this.add.text(width / 2, height / 2 - 35, `${getPrimarySkill(die)?.title ?? 'No skill'}\n${getPrimarySkill(die)?.description ?? ''}`, { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.textMuted, align: 'center', wordWrap: { width: 440 } }).setOrigin(0.5);
    const nextClass = Math.min(15, cls + 1);
    const tokenCost = this.classTokenCosts[nextClass]?.[die.rarity] ?? 0;
    const copyCost = nextClass <= 1 ? 0 : nextClass * 10;
    const canUpgrade = cls < 15 && getDiceTokens(this) >= tokenCost && progress.copies >= copyCost;
    const costText = this.add.text(width / 2, height / 2 + 55, `Class UP -> C${nextClass} | Cost: ${tokenCost} tokens + ${copyCost} copies`, { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.accentSoft }).setOrigin(0.5);
    const assignable = !getSelectedLoadout(this).includes(typeId);
    const assignBtn = this.add.rectangle(width / 2 - 110, height / 2 + 110, 180, 40, assignable ? 0x3498db : 0x7f8c8d, 0.95).setInteractive({ useHandCursor: assignable });
    const assignTxt = this.add.text(width / 2 - 110, height / 2 + 110, assignable ? 'ASSIGN!' : 'IN LOADOUT', { fontFamily: 'Orbitron', fontSize: '14px', color: '#ffffff' }).setOrigin(0.5);
    const upBtn = this.add.rectangle(width / 2 + 110, height / 2 + 110, 180, 40, canUpgrade ? 0x2ecc71 : 0x7f8c8d, 0.95).setInteractive({ useHandCursor: canUpgrade });
    const upTxt = this.add.text(width / 2, height / 2 + 110, canUpgrade ? 'CLASS UP' : 'LOCKED', { fontFamily: 'Orbitron', fontSize: '14px', color: '#ffffff' }).setOrigin(0.5);
    const close = this.add.text(width / 2, height / 2 + 152, 'Close', { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.textMuted, backgroundColor: '#173247', padding: { left: 8, right: 8, top: 4, bottom: 4 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    if (canUpgrade) {
      upBtn.on('pointerdown', () => {
        setDiceTokens(this, getDiceTokens(this) - tokenCost);
        setDiceProgress(this, typeId, { classLevel: cls + 1, copies: progress.copies - copyCost });
        tokenText.setText(`DICE TOKENS: ${getDiceTokens(this)}  •  Click cards to assign selected slot`);
        onUpdate();
        this.openDiceModal(typeId, tokenText, onUpdate);
      });
    }
    if (assignable) {
      assignBtn.on('pointerdown', () => {
        const loadout = getSelectedLoadout(this);
        const existingIndex = loadout.findIndex((entry) => entry === typeId);
        if (existingIndex >= 0) return;
        loadout[0] = typeId;
        setSelectedLoadout(this, loadout);
        closeModal();
        onUpdate();
        this.scene.restart();
      });
    }
    const closeModal = () => {
      this.modalElements.forEach((el) => el.destroy());
      this.modalElements = [];
    };
    overlay.on('pointerdown', closeModal);
    close.on('pointerdown', closeModal);
    this.modalElements = [overlay, panel, title, stats, skill, costText, assignBtn, assignTxt, upBtn, upTxt, close];
    this.modalElements.forEach((el) => (el as any).setDepth?.(450));
  }
}
