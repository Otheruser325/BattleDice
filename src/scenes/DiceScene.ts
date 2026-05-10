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
  setDiceTokens,
  DEFAULT_LOADOUT_IDS
} from '../data/dice';
import { DebugManager } from '../utils/DebugManager';
import { PALETTE, drawPanel } from '../ui/theme';
import { applyClassProgression, getClassProgressionPreview } from '../systems/ClassProgression';
import { getRuntimeSkillMeta } from '../systems/DiceSkills';
import { SCENE_KEYS } from './sceneKeys';

function formatSkillType(type: string | undefined): string {
  if (!type) return 'Passive';
  return type.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export class DiceScene extends Phaser.Scene {
  static readonly KEY = SCENE_KEYS.Dice;
  private readonly debug = DebugManager.attachScene(DiceScene.KEY);

  private modalElements: Phaser.GameObjects.GameObject[] = [];
  private modalEscHandler: (() => void) | null = null;

  private readonly classTokenCosts: Record<number, Record<string, number>> = {
    2: { Common: 50, Uncommon: 75, Rare: 100, Epic: 200, Legendary: 500 },
    3: { Common: 150, Uncommon: 225, Rare: 400, Epic: 750, Legendary: 1500 },
    4: { Common: 300, Uncommon: 450, Rare: 800, Epic: 1500, Legendary: 3000 },
    5: { Common: 500, Uncommon: 750, Rare: 1500, Epic: 3000, Legendary: 6000 },
    6: { Common: 800, Uncommon: 1200, Rare: 2500, Epic: 5000, Legendary: 10000 },
    7: { Common: 1200, Uncommon: 1800, Rare: 3750, Epic: 7500, Legendary: 15000 },
    8: { Common: 2000, Uncommon: 3000, Rare: 6000, Epic: 10000, Legendary: 20000 },
    9: { Common: 4000, Uncommon: 6000, Rare: 12000, Epic: 20000, Legendary: 40000 },
    10: { Common: 6000, Uncommon: 9000, Rare: 18000, Epic: 30000, Legendary: 60000 }
  };
  private readonly classCopyCosts: Record<number, Record<string, number>> = {
    2: { Common: 10, Uncommon: 8, Rare: 5, Epic: 2, Legendary: 1 },
    3: { Common: 20, Uncommon: 15, Rare: 10, Epic: 4, Legendary: 1 },
    4: { Common: 40, Uncommon: 30, Rare: 15, Epic: 6, Legendary: 1 },
    5: { Common: 80, Uncommon: 50, Rare: 25, Epic: 8, Legendary: 2 },
    6: { Common: 120, Uncommon: 80, Rare: 40, Epic: 10, Legendary: 2 },
    7: { Common: 200, Uncommon: 150, Rare: 75, Epic: 15, Legendary: 3 },
    8: { Common: 400, Uncommon: 250, Rare: 120, Epic: 20, Legendary: 3 },
    9: { Common: 700, Uncommon: 425, Rare: 200, Epic: 25, Legendary: 4 },
    10: { Common: 1000, Uncommon: 750, Rare: 250, Epic: 30, Legendary: 4 }
  };
  private cardScrollOffset = 0;

  constructor() {
    super(DiceScene.KEY);
  }

  private isDiceLocked(typeId: string): boolean {
    if (DEFAULT_LOADOUT_IDS.has(typeId)) return false;
    const progress = getDiceProgress(this, typeId);
    return progress.copies === 0;
  }

  create() {
    const panel = drawPanel(this, 'DICE', 'Loadout  |  Non-defaults unlock with copies');
    const rarityRank: Record<string, number> = { Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4 };
    const definitions = [...getAllDiceDefinitions(this)].sort((a, b) => (rarityRank[a.rarity] ?? 99) - (rarityRank[b.rarity] ?? 99) || a.title.localeCompare(b.title));
    let loadout = getSelectedLoadout(this);
    this.debug.log('Dice scene rendered.', { diceCount: definitions.length });

    let tokens = getDiceTokens(this);
    const tokenText = this.add.text(panel.x + 28, panel.y + 58, `DICE TOKENS: ${tokens}  •  Click cards to assign selected slot`, {
      fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.accentSoft
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

    const cardsContainer = this.add.container(0, 0).setDepth(6);
    const cardsTopY = panel.y + 160;
    const cardPitch = 210;

    definitions.forEach((die, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const x = panel.x + 28 + col * 360;
      const y = cardsTopY + row * cardPitch;
      const accent = Phaser.Display.Color.HexStringToColor(die.accent).color;
      const cls = getDiceProgress(this, die.typeId).classLevel;
      const displayedDie = applyClassProgression(die, cls);
      const locked = this.isDiceLocked(die.typeId);

      const cardFill = locked ? 0x111e28 : 0x173247;
      const cardWidth = 320;
      const baseCardHeight = 176;
      const cardTopY = y;
      const header = this.add.rectangle(x + 160, cardTopY + 22, cardWidth, 42, locked ? 0x1a2535 : accent, locked ? 0.08 : 0.14);

      const titleColor = locked ? PALETTE.textMuted : die.accent;
      const title = this.add.text(x + 20, y + 10, die.title.toUpperCase(), {
        fontFamily: 'Orbitron',
        fontSize: '20px',
        color: titleColor
      });
      const classTag = this.add.text(x + 300, y + 10, locked ? 'LOCKED' : `C${cls}`, {
        fontFamily: 'Orbitron',
        fontSize: '14px',
        color: locked ? PALETTE.danger : PALETTE.accentSoft
      }).setOrigin(1, 0);

      const statLine = this.add.text(x + 20, y + 52, `${die.rarity.toUpperCase()}  |  ATK ${displayedDie.attack}  |  HP ${displayedDie.health}
RANGE ${die.range} (${getRangeLabel(die.range)})`, {
        fontFamily: 'Orbitron',
        fontSize: '12px',
        color: locked ? PALETTE.textMuted : PALETTE.text
      });

      const primarySkill = getPrimarySkill(displayedDie);
      const displayType = primarySkill?.type
        ? formatSkillType(primarySkill.type).toUpperCase()
        : 'PASSIVE';
      const skillTypeLine = this.add.text(x + 20, y + 78, displayType, {
        fontFamily: 'Orbitron',
        fontSize: '12px',
        color: locked ? PALETTE.textMuted : PALETTE.accentSoft
      });

      const skillTitle = this.add.text(x + 20, y + 106, locked ? '??? — Obtain copies to unlock' : (primarySkill?.title ?? 'No skill'), {
        fontFamily: 'Orbitron',
        fontSize: '14px',
        color: locked ? PALETTE.textMuted : PALETTE.text
      });

      const skillDesc = this.add.text(x + 20, y + 130, locked ? 'Visit the Shop to purchase copies of this die.' : (displayedDie.skills[0]?.description ?? ''), {
        fontFamily: 'Orbitron',
        fontSize: '12px',
        color: PALETTE.textMuted,
        wordWrap: { width: 280 }
      });

      const computedCardHeight = Math.max(baseCardHeight, Math.ceil((skillDesc.y + skillDesc.height) - cardTopY + 18));
      const card = this.add.rectangle(x + 160, cardTopY + computedCardHeight / 2, cardWidth, computedCardHeight, cardFill, 0.92).setInteractive({ useHandCursor: !locked })
        .setStrokeStyle(2, locked ? 0x2a3a47 : accent);
      header.setPosition(x + 160, cardTopY + 22);

      if (!locked) {
        card.on('pointerdown', () => {
          this.openDiceModal(die.typeId, tokenText, () => {
            loadout = getSelectedLoadout(this);
            refreshSlots();
            tokens = getDiceTokens(this);
            tokenText.setText(`DICE TOKENS: ${tokens}  •  Click cards to assign selected slot`);
          }, selectedSlot);
        });
        card.on('pointerover', () => card.setFillStyle(0x1f3e56, 1));
        card.on('pointerout', () => card.setFillStyle(0x173247, 0.98));
      }

      cardsContainer.add([card, header, title, classTag, statLine, skillTypeLine, skillTitle, skillDesc]);
      card.setDepth(0); header.setDepth(1);

      if (locked) {
        const lockOverlay = this.add.rectangle(x + 160, cardTopY + computedCardHeight / 2, 320, computedCardHeight, 0x000000, 0.22);
        const lockIcon = this.add.text(x + 160, y + 84, '🔒', {
          fontSize: '28px'
        }).setOrigin(0.5);
        cardsContainer.add([lockOverlay, lockIcon]);
      }
    });

    const viewTop = panel.y + 150;
    const viewHeight = panel.height - 230;
    const viewLeft = panel.x + 12;
    const viewWidth = panel.width - 24;
    const maskShape = this.add.rectangle(viewLeft, viewTop, viewWidth, viewHeight, 0xffffff, 0)
      .setOrigin(0, 0)
      .setVisible(false);
    cardsContainer.setMask(maskShape.createGeometryMask());

    const totalRows = Math.ceil(definitions.length / 3);
    const contentHeight = totalRows * cardPitch;
    const maxScroll = Math.max(0, contentHeight - viewHeight + 24);

    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _gameObjects: Phaser.GameObjects.GameObject[], _dx: number, dy: number) => {
      const withinX = pointer.worldX >= viewLeft && pointer.worldX <= viewLeft + viewWidth;
      const withinY = pointer.worldY >= viewTop && pointer.worldY <= viewTop + viewHeight;
      if (!withinX || !withinY) return;
      this.cardScrollOffset = Phaser.Math.Clamp(this.cardScrollOffset - dy * 0.35, -maxScroll, 0);
      cardsContainer.y = this.cardScrollOffset;
    });

    this.input.keyboard?.on('keydown-TAB', (event: KeyboardEvent) => {
      event.preventDefault();
      selectedSlot = (selectedSlot + 1) % 5;
      refreshSlots();
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.modalEscHandler) this.input.keyboard?.off('keydown-ESC', this.modalEscHandler);
      this.modalEscHandler = null;
      this.modalElements = [];
    });
  }


  private getAlternateFormLabel(die: ReturnType<typeof getAllDiceDefinitions>[number], showingAlternate: boolean): string | null {
    const meta = getRuntimeSkillMeta(die);
    if (!meta.alternateButton || !meta.baseButton) return null;
    return showingAlternate ? meta.baseButton : meta.alternateButton;
  }

  private getModalDisplayDie(die: ReturnType<typeof getAllDiceDefinitions>[number], classLevel: number, showAlternate: boolean) {
    const scaled = applyClassProgression(die, classLevel);
    if (!showAlternate) return scaled;

    const meta = getRuntimeSkillMeta(scaled);
    if (!meta.transformTitle) return scaled;

    if (meta.hasDeathTransform) {
      return {
        ...scaled,
        title: meta.transformTitle,
        health: scaled.health * 2,
        accent: meta.transformAccent ?? scaled.accent,
        skills: [{
          type: 'Active' as const,
          title: "Reaper's Touch",
          description: 'At 12 mana, instantly kills the target. Death transforms into this form after 2 allies are defeated.',
          manaNeeded: meta.deathInstakillMana ?? 12,
          modifiers: { notes: ['runtime:deathInstakill'] }
        }]
      };
    }

    if (meta.hasTranscendence) {
      return {
        ...scaled,
        title: meta.transformTitle,
        accent: meta.transformAccent ?? scaled.accent,
        skills: [{
          type: 'Passive' as const,
          title: scaled.skills[0]?.title ?? 'Perpendicular Beam',
          description: `Rolled 6 form: beam attacks consume 6 attacks and fire a wide cyan beam through the target row and column for ${meta.beamDamage ?? 600} damage.`,
          modifiers: { beamDamage: meta.beamDamage, notes: ['runtime:hasTranscendence'] }
        }]
      };
    }

    return scaled;
  }

  private openDiceModal(typeId: string, tokenText: Phaser.GameObjects.Text, onUpdate: () => void, selectedSlot: number, showAlternate = false) {
    this.modalElements.forEach((el) => el.destroy());
    this.modalElements = [];
    if (this.modalEscHandler) {
      this.input.keyboard?.off('keydown-ESC', this.modalEscHandler);
      this.modalEscHandler = null;
    }
    const die = getAllDiceDefinitions(this).find((definition) => definition.typeId === typeId);
    if (!die) return;
    const progress = getDiceProgress(this, typeId);
    const displayDie = this.getModalDisplayDie(die, progress.classLevel, showAlternate);
    const { width, height } = this.scale;
    const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.55).setInteractive();
    const panel = this.add.rectangle(width / 2, height / 2, 540, 390, 0x163246, 0.96).setStrokeStyle(2, 0x4f7ea1);
    const cls = progress.classLevel;
    const hp = displayDie.health;
    const atk = displayDie.attack;
    const isMaxed = cls >= 15;
    const title = this.add.text(width / 2, height / 2 - 155, `${displayDie.title} • CLASS ${cls}/15${isMaxed ? ' (MAX)' : ''}`, { fontFamily: 'Orbitron', fontSize: '20px', color: displayDie.accent }).setOrigin(0.5);
    const stats = this.add.text(width / 2, height / 2 - 110, `ATK ${atk}  |  HP ${hp}  |  RANGE ${displayDie.range} (${getRangeLabel(displayDie.range)})\nRARITY ${displayDie.rarity}  |  COPIES ${progress.copies}`, { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.text, align: 'center' }).setOrigin(0.5);
    const primary = getPrimarySkill(displayDie);
    const skill = this.add.text(width / 2, height / 2 - 50, `${primary?.title ?? 'No skill'} (${formatSkillType(primary?.type)})\n${primary?.description ?? ''}`, { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.textMuted, align: 'center', wordWrap: { width: 440 } }).setOrigin(0.5);

    const nextClass = Math.min(15, cls + 1);
    const tokenCost = this.classTokenCosts[nextClass]?.[die.rarity] ?? 0;
    const copyCost = this.classCopyCosts[nextClass]?.[die.rarity] ?? (nextClass <= 1 ? 0 : nextClass * 10);
    const canUpgrade = !isMaxed && getDiceTokens(this) >= tokenCost && progress.copies >= copyCost;

    let costText: Phaser.GameObjects.Text;
    if (isMaxed) {
      costText = this.add.text(width / 2, height / 2 + 40, 'MAX CLASS REACHED — No more copies needed', { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.success }).setOrigin(0.5);
    } else {
      costText = this.add.text(width / 2, height / 2 + 40, `Class UP -> C${nextClass} (+10% multiplicative stats/skills) | Cost: ${tokenCost} tokens + ${copyCost} copies`, { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.accentSoft }).setOrigin(0.5);
    }

    const assignable = !getSelectedLoadout(this).includes(typeId);
    const assignBtn = this.add.rectangle(width / 2 - 110, height / 2 + 110, 180, 40, assignable ? 0x3498db : 0x7f8c8d, 0.95).setInteractive({ useHandCursor: assignable });
    const assignTxt = this.add.text(width / 2 - 110, height / 2 + 110, assignable ? 'ASSIGN!' : 'IN LOADOUT', { fontFamily: 'Orbitron', fontSize: '14px', color: '#ffffff' }).setOrigin(0.5);
    const upBtn = this.add.rectangle(width / 2 + 110, height / 2 + 110, 180, 40, canUpgrade ? 0x2ecc71 : 0x7f8c8d, 0.95).setInteractive({ useHandCursor: canUpgrade });
    const upTxt = this.add.text(width / 2 + 110, height / 2 + 110, isMaxed ? 'MAXED' : (canUpgrade ? 'CLASS UP' : 'LOCKED'), { fontFamily: 'Orbitron', fontSize: '14px', color: '#ffffff' }).setOrigin(0.5);
    const upgradePreview = getClassProgressionPreview(die, cls);
    const previewLines = [`ATK +${upgradePreview.attackDelta}`, `HP +${upgradePreview.healthDelta}`, ...upgradePreview.skillDeltas];
    const upgradeTooltip = this.add.text(width / 2 + 110, height / 2 + 62, previewLines.join('\n'), {
      fontFamily: 'Orbitron',
      fontSize: '11px',
      color: PALETTE.success,
      align: 'center',
      backgroundColor: '#0d2231',
      padding: { left: 8, right: 8, top: 6, bottom: 6 }
    }).setOrigin(0.5).setVisible(false);
    const alternateLabel = this.getAlternateFormLabel(die, showAlternate);
    const altBtn = this.add.text(width / 2, height / 2 + 142, alternateLabel ?? '', { fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.accentSoft, backgroundColor: '#224b66', padding: { left: 8, right: 8, top: 4, bottom: 4 } }).setOrigin(0.5);
    if (alternateLabel) {
      altBtn.setInteractive({ useHandCursor: true });
      altBtn.on('pointerdown', () => this.openDiceModal(typeId, tokenText, onUpdate, selectedSlot, !showAlternate));
    } else {
      altBtn.setVisible(false);
    }
    const close = this.add.text(width / 2, height / 2 + 170, 'Close', { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.textMuted, backgroundColor: '#173247', padding: { left: 8, right: 8, top: 4, bottom: 4 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    if (canUpgrade) {
      const showUpgradeTooltip = () => upgradeTooltip.setVisible(true);
      const hideUpgradeTooltip = () => upgradeTooltip.setVisible(false);
      upTxt.setInteractive({ useHandCursor: true });
      upBtn.on('pointerover', showUpgradeTooltip);
      upTxt.on('pointerover', showUpgradeTooltip);
      upBtn.on('pointerout', hideUpgradeTooltip);
      upTxt.on('pointerout', hideUpgradeTooltip);
      upBtn.on('pointerdown', () => {
        setDiceTokens(this, getDiceTokens(this) - tokenCost);
        setDiceProgress(this, typeId, { classLevel: cls + 1, copies: progress.copies - copyCost });
        tokenText.setText(`DICE TOKENS: ${getDiceTokens(this)}  •  Click cards to assign selected slot`);
        onUpdate();
        this.openDiceModal(typeId, tokenText, onUpdate, selectedSlot, showAlternate);
      });
    }
    if (assignable) {
      assignBtn.on('pointerdown', () => {
        const loadout = getSelectedLoadout(this);
        const existingIndex = loadout.findIndex((entry) => entry === typeId);
        if (existingIndex >= 0) return;
        loadout[selectedSlot] = typeId;
        setSelectedLoadout(this, loadout);
        closeModal();
        onUpdate();
        this.scene.restart();
      });
    }
    const closeModal = () => {
      this.modalElements.forEach((el) => el.destroy());
      this.modalElements = [];
      if (this.modalEscHandler) {
        this.input.keyboard?.off('keydown-ESC', this.modalEscHandler);
        this.modalEscHandler = null;
      }
    };
    overlay.on('pointerdown', closeModal);
    close.on('pointerdown', closeModal);
    this.modalEscHandler = () => closeModal();
    this.input.keyboard?.on('keydown-ESC', this.modalEscHandler);
    this.modalElements = [overlay, panel, title, stats, skill, costText, assignBtn, assignTxt, upBtn, upTxt, upgradeTooltip, altBtn, close];
    this.modalElements.forEach((el) => (el as any).setDepth?.(450));
  }
}
