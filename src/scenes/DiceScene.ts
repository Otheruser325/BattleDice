import Phaser from 'phaser';
import {
  getAllDiceDefinitions,
  getRangeLabel,
  getSelectedLoadout,
  setSelectedLoadout,
  getActiveLoadoutSlot,
  setActiveLoadoutSlot,
  LOADOUT_SLOT_COUNT,
  RARITY_TEXT_COLORS,
  getDiceTokens,
  getDiceProgress,
  setDiceProgress,
  setDiceTokens,
  DEFAULT_LOADOUT_IDS
} from '../data/dice';
import { DebugManager } from '../utils/DebugManager';
import { PALETTE, drawPanel } from '../ui/theme';
import { applyClassProgression, getClassMultiplier, getClassProgressionPreview, getClassScaledSkillDescription } from '../systems/ClassProgression';
import { getRuntimeSkillMeta } from '../systems/DiceSkills';
import { SCENE_KEYS } from './sceneKeys';
import { AudioManager } from '../utils/AudioManager';
import { AchievementStore } from '../systems/AchievementStore';
import type { DiceDefinition, DiceSkillDefinition } from '../types/game';
import { SettingsStore } from '../systems/SettingsStore';
import { applyDiceTalent, getEquippedTalentId, setEquippedTalentId } from '../systems/DiceTalents';

function formatSkillType(type: string | undefined): string {
  if (!type) return 'Passive';
  return type.replace(/([a-z])([A-Z])/g, '$1 $2');
}

function formatSkillEntry(skill: DiceSkillDefinition, index: number, total: number, definition?: DiceDefinition, skillDamageMultiplier = 1): string {
  const prefix = total > 1 ? `${index + 1}. ` : '';
  const manaLine = skill.type === 'Active' && (skill.manaNeeded ?? 0) > 0 ? `\nMana needed: ${skill.manaNeeded}` : '';
  const description = definition ? getClassScaledSkillDescription(definition, skill, skillDamageMultiplier) : skill.description;
  return `${prefix}${skill.title} (${formatSkillType(skill.type)})${manaLine}\n${description}`;
}

function getTransformSkillIndexSet(definition: DiceDefinition): Set<number> {
  const meta = getRuntimeSkillMeta(definition);
  return new Set(meta.transformSkillIndices?.length ? meta.transformSkillIndices : meta.transformSkillIndex === undefined ? [] : [meta.transformSkillIndex]);
}

function getVisibleSkillCount(definition: DiceDefinition): number {
  const hiddenTransformSkills = getTransformSkillIndexSet(definition);
  return definition.skills.filter((_, index) => !hiddenTransformSkills.has(index)).length;
}

function formatSkillTypeLine(definition: DiceDefinition): string {
  const hiddenTransformSkills = getTransformSkillIndexSet(definition);
  const visibleSkills = definition.skills.filter((_, index) => !hiddenTransformSkills.has(index));
  if (visibleSkills.length === 1) {
    return formatSkillType(visibleSkills[0]?.type).toUpperCase();
  }
  return `${visibleSkills.length} SKILLS`;
}

export function formatSkillInfo(definition: DiceDefinition, locked = false, skillDamageMultiplier = 1): string {
  if (locked) return '??? — Obtain copies to unlock\nVisit the Shop to purchase copies of this die.';
  const hiddenTransformSkills = getTransformSkillIndexSet(definition);
  const visibleSkills = definition.skills
    .map((skill, index) => ({ skill, index }))
    .filter(({ index }) => !hiddenTransformSkills.has(index));
  if (visibleSkills.length === 0) return 'No skill';
  return visibleSkills.map(({ skill }, visibleIndex) => formatSkillEntry(skill, visibleIndex, visibleSkills.length, {
    ...definition,
    skills: definition.skills
  }, skillDamageMultiplier)).join('\n\n');
}

export function getDiceAlternateFormLabel(die: DiceDefinition, showingAlternate: boolean): string | null {
  const meta = getRuntimeSkillMeta(die);
  if (!meta.alternateButton || !meta.baseButton) return null;
  return showingAlternate ? meta.baseButton : meta.alternateButton;
}

export function getDiceModalDisplayDefinition(die: DiceDefinition, classLevel: number, showAlternate: boolean): DiceDefinition {
  const scaled = applyClassProgression(die, classLevel);
  const meta = getRuntimeSkillMeta(scaled);
  const transformSkillIndices = meta.transformSkillIndices?.length ? meta.transformSkillIndices : meta.transformSkillIndex === undefined ? [] : [meta.transformSkillIndex];
  if (!showAlternate) {
    if (scaled.typeId === 'Druid' && meta.hasDruidBearTransform) {
      return {
        ...scaled,
        skills: scaled.skills.filter((skill) => !(skill.modifiers?.notes ?? []).includes('runtime:druidBearForm'))
      };
    }
    return scaled;
  }
  if (!meta.transformTitle) return scaled;

  const transformSkills = transformSkillIndices
    .map((index) => scaled.skills[index])
    .filter((skill): skill is DiceSkillDefinition => Boolean(skill));
  if (meta.hasDeathTransform && transformSkills.length > 0) {
    return {
      ...scaled,
      title: meta.transformTitle,
      health: scaled.health * 2,
      accent: meta.transformAccent ?? scaled.accent,
      skills: transformSkills.map((skill) => ({
        ...skill,
        description: skill.title === "Reaper's Touch"
          ? `Instantly kills a target. Bosses instead take ${scaled.attack * 10} damage.`
          : skill.description
      }))
    };
  }
  if (transformSkills.length > 0) {
    const isDruidBear = scaled.typeId === 'Druid' && meta.hasDruidBearTransform;
    const bearMultiplier = getClassMultiplier(classLevel);
    return {
      ...scaled,
      title: meta.transformTitle,
      attack: isDruidBear ? Math.max(1, Math.round(50 * bearMultiplier)) : scaled.attack,
      health: isDruidBear ? Math.max(1, Math.round(1500 * bearMultiplier)) : scaled.health,
      range: isDruidBear ? 2 : scaled.range,
      targetingMode: isDruidBear ? 'Nearest' : scaled.targetingMode,
      accent: meta.transformAccent ?? (isDruidBear ? '#9b6a3a' : scaled.accent),
      skills: transformSkills
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
        description: `If it rolls 6, transforms into The Transcendence and beam attacks consume all remaining attacks to strike through the perpendicular line through the target for ${meta.beamDamage ?? 600} damage.`,
        modifiers: { beamDamage: meta.beamDamage, notes: ['runtime:hasTranscendence'] }
      }]
    };
  }

  return scaled;
}


export class DiceScene extends Phaser.Scene {
  static readonly KEY = SCENE_KEYS.Dice;
  private readonly debug = DebugManager.attachScene(DiceScene.KEY);

  private modalElements: Phaser.GameObjects.GameObject[] = [];
  private modalEscHandler: (() => void) | null = null;
  private modalWheelHandler: ((pointer: Phaser.Input.Pointer, gameObjects: Phaser.GameObjects.GameObject[], dx: number, dy: number) => void) | null = null;

  private readonly classTokenCosts: Record<number, Record<string, number>> = {
    2: { Common: 50, Uncommon: 75, Rare: 100, Epic: 200, Legendary: 500, Mythic: 1000 },
    3: { Common: 150, Uncommon: 225, Rare: 400, Epic: 750, Legendary: 1500, Mythic: 3000 },
    4: { Common: 300, Uncommon: 450, Rare: 800, Epic: 1500, Legendary: 3000, Mythic: 6000 },
    5: { Common: 500, Uncommon: 750, Rare: 1500, Epic: 3000, Legendary: 6000, Mythic: 12000 },
    6: { Common: 800, Uncommon: 1200, Rare: 2500, Epic: 5000, Legendary: 10000, Mythic: 20000 },
    7: { Common: 1200, Uncommon: 1800, Rare: 3750, Epic: 7500, Legendary: 15000, Mythic: 30000 },
    8: { Common: 2000, Uncommon: 3000, Rare: 6000, Epic: 10000, Legendary: 20000, Mythic: 40000 },
    9: { Common: 4000, Uncommon: 6000, Rare: 12000, Epic: 20000, Legendary: 40000, Mythic: 80000 },
    10: { Common: 6000, Uncommon: 9000, Rare: 18000, Epic: 30000, Legendary: 60000, Mythic: 120000 },
	11: { Common: 10000, Uncommon: 15000, Rare: 25000, Epic: 50000, Legendary: 100000, Mythic: 200000 },
	12: { Common: 20000, Uncommon: 30000, Rare: 50000, Epic: 80000, Legendary: 150000, Mythic: 300000 },
	13: { Common: 40000, Uncommon: 60000, Rare: 80000, Epic: 160000, Legendary: 300000, Mythic: 600000 },
	14: { Common: 70000, Uncommon: 105000, Rare: 140000, Epic: 280000, Legendary: 600000, Mythic: 1200000 },
	15: { Common: 100000, Uncommon: 150000, Rare: 200000, Epic: 400000, Legendary: 1000000, Mythic: 2000000 }
  };
  private readonly classCopyCosts: Record<number, Record<string, number>> = {
    2: { Common: 10, Uncommon: 8, Rare: 5, Epic: 2, Legendary: 1, Mythic: 1 },
    3: { Common: 20, Uncommon: 15, Rare: 10, Epic: 4, Legendary: 1, Mythic: 1 },
    4: { Common: 40, Uncommon: 30, Rare: 15, Epic: 6, Legendary: 2, Mythic: 1 },
    5: { Common: 80, Uncommon: 50, Rare: 25, Epic: 8, Legendary: 2, Mythic: 1 },
    6: { Common: 120, Uncommon: 80, Rare: 40, Epic: 10, Legendary: 3, Mythic: 1 },
    7: { Common: 200, Uncommon: 150, Rare: 75, Epic: 15, Legendary: 3, Mythic: 2 },
    8: { Common: 400, Uncommon: 250, Rare: 120, Epic: 20, Legendary: 4, Mythic: 2 },
    9: { Common: 700, Uncommon: 425, Rare: 200, Epic: 30, Legendary: 5, Mythic: 2 },
    10: { Common: 1000, Uncommon: 750, Rare: 500, Epic: 60, Legendary: 6, Mythic: 3 },
	11: { Common: 1500, Uncommon: 1000, Rare: 750, Epic: 100, Legendary: 8, Mythic: 3 },
	12: { Common: 2500, Uncommon: 1750, Rare: 1000, Epic: 200, Legendary: 10, Mythic: 3 },
	13: { Common: 5000, Uncommon: 3000, Rare: 2000, Epic: 400, Legendary: 12, Mythic: 4 },
	14: { Common: 7500, Uncommon: 5000, Rare: 3250, Epic: 650, Legendary: 15, Mythic: 4 },
	15: { Common: 10000, Uncommon: 7500, Rare: 5000, Epic: 1000, Legendary: 20, Mythic: 5 }
  };
  private cardScrollOffset = 0;

  constructor() {
    super(DiceScene.KEY);
  }

  private isDiceLocked(typeId: string): boolean {
    if (DEFAULT_LOADOUT_IDS.has(typeId)) return false;
    const progress = getDiceProgress(this, typeId);
    return !progress.unlocked;
  }

  create() {
    const panel = drawPanel(this, 'DICE', 'Deck slots 1-3 save separate loadouts  |  Non-defaults unlock with copies');
    const rarityRank: Record<string, number> = { Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4, Mythic: 5 };
    const definitions = [...getAllDiceDefinitions(this)].sort((a, b) => (rarityRank[a.rarity] ?? 99) - (rarityRank[b.rarity] ?? 99) || a.title.localeCompare(b.title));
    let loadout = getSelectedLoadout(this);
    this.debug.log('Dice scene rendered.', { diceCount: definitions.length });

    let tokens = getDiceTokens(this);
    const tokenText = this.add.text(panel.x + 28, panel.y + 58, `DICE TOKENS: ${tokens}  •  Select a loadout slot, then choose a die to equip`, {
      fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.accentSoft
    });
    const slotText = this.add.text(panel.x + 28, panel.y + 78, '', { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.text });
    const ownedCountText = this.add.text(panel.right - 28, panel.y + 78, '', { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.accentSoft }).setOrigin(1,0);
    const slotBoxes: Phaser.GameObjects.Rectangle[] = [];
    const slotLabels: Phaser.GameObjects.Text[] = [];
    let pendingEquipTypeId: string | null = null;
    let selectedSlot: number | null = null;
    let selectedDeckSlot = getActiveLoadoutSlot(this);
    const deckBoxes: Phaser.GameObjects.Rectangle[] = [];
    for (let i = 0; i < LOADOUT_SLOT_COUNT; i++) {
      const x = panel.right - 212 + i * 58;
      const box = this.add.rectangle(x, panel.y + 116, 46, 34, 0x1b4058, 0.95).setStrokeStyle(2, 0x406987).setInteractive({ useHandCursor: true });
      const lbl = this.add.text(x, panel.y + 116, `${i + 1}`, { fontFamily: 'Orbitron', fontSize: '14px', color: PALETTE.text }).setOrigin(0.5);
      box.on('pointerdown', () => {
        setActiveLoadoutSlot(this, i);
        selectedDeckSlot = i;
        loadout = getSelectedLoadout(this);
        pendingEquipTypeId = null;
        selectedSlot = null;
        refreshSlots();
      });
      deckBoxes.push(box);
      slotLabels.push(lbl);
    }
    const deckLabel = this.add.text(panel.right - 212, panel.y + 90, 'DECK', { fontFamily: 'Orbitron', fontSize: '10px', color: PALETTE.textMuted }).setOrigin(0.5);
    const slotStartX = panel.centerX - 312;
    for (let i = 0; i < 5; i++) {
      const x = slotStartX + i * 112;
      const box = this.add.rectangle(x, panel.y + 118, 104, 46, 0x173247, 0.95).setStrokeStyle(2, 0x406987).setInteractive({ useHandCursor: true });
      const lbl = this.add.text(x, panel.y + 118, loadout[i]?.slice(0, 4).toUpperCase() ?? '-', { fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.text }).setOrigin(0.5);
      const selectSlot = () => {
        if (!pendingEquipTypeId) {
          selectedSlot = i;
          refreshSlots();
          return;
        }
        const typeId = pendingEquipTypeId;
        pendingEquipTypeId = null;
        selectedSlot = i;
        if (equipDieInSlot(typeId, i)) {
          this.scene.restart();
        } else {
          refreshSlots();
        }
      };
      box.on('pointerdown', selectSlot);
      box.on('pointerover', () => {
        if (pendingEquipTypeId) box.setFillStyle(0x315e7a, 1);
      });
      box.on('pointerout', () => box.setFillStyle(0x173247, 0.95));
      lbl.setInteractive({ useHandCursor: true }).on('pointerdown', selectSlot);
      slotBoxes.push(box);
      slotLabels.push(lbl);
    }

    const refreshSlots = () => {
      slotText.setText(
        `DECK ${selectedDeckSlot + 1}: ${loadout.join(' | ')}  •  ${
          pendingEquipTypeId
            ? `Select a slot for ${pendingEquipTypeId}`
            : selectedSlot === null
              ? 'Select a slot, then choose a die'
              : `Equip target: slot ${selectedSlot + 1}`
        }`
      );
      const owned = definitions.filter((d)=>!this.isDiceLocked(d.typeId)).length;
      ownedCountText.setText(`OWNED ${owned}/${definitions.length}`);
      deckBoxes.forEach((box, i) => box.setStrokeStyle(2, i === selectedDeckSlot ? 0xf4b860 : 0x406987));
      slotBoxes.forEach((box, i) => {
        const selected = i === selectedSlot;
        box.setStrokeStyle(2, selected || pendingEquipTypeId ? 0xf4b860 : 0x406987);
        box.setFillStyle(selected ? 0x315e7a : 0x173247, 0.95);
      });
      slotLabels.forEach((lbl, i) => {
        if (i < LOADOUT_SLOT_COUNT) return;
        const loadoutIndex = i - LOADOUT_SLOT_COUNT;
        lbl.setText(loadout[loadoutIndex]?.slice(0, 4).toUpperCase() ?? '-');
      });
    };
    refreshSlots();

    const equipDieInSlot = (typeId: string, slot: number): boolean => {
      const nextLoadout = getSelectedLoadout(this);
      const existingIndex = nextLoadout.findIndex((entry) => entry === typeId);
      if (existingIndex === slot) return false;
      if (existingIndex >= 0) {
        [nextLoadout[slot], nextLoadout[existingIndex]] = [nextLoadout[existingIndex], nextLoadout[slot]];
      } else {
        nextLoadout[slot] = typeId;
      }
      setSelectedLoadout(this, nextLoadout);
      loadout = getSelectedLoadout(this);
      refreshSlots();
      return true;
    };

    const cardsContainer = this.add.container(0, 0).setDepth(6);
    const interactiveCards: Phaser.GameObjects.Rectangle[] = [];
    const refreshCardStats: Array<() => void> = [];
    const cardsTopY = panel.y + 160;
    const cardPitch = 250;

    definitions.forEach((die, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const x = panel.x + 28 + col * 360;
      const y = cardsTopY + row * cardPitch;
      const accent = Phaser.Display.Color.HexStringToColor(die.accent).color;
      const cls = getDiceProgress(this, die.typeId).classLevel;
       const displayedDie = applyDiceTalent(applyClassProgression(die, cls), getEquippedTalentId(this, die.typeId));
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

      const rarityColor = locked ? PALETTE.textMuted : (RARITY_TEXT_COLORS[die.rarity] ?? PALETTE.text);
      const rarityLine = this.add.text(x + 20, y + 52, die.rarity.toUpperCase(), {
        fontFamily: 'Orbitron',
        fontSize: '12px',
        color: rarityColor
      });
      const statLine = this.add.text(x + 106, y + 52, `ATK ${displayedDie.attack}  |  HP ${displayedDie.health}
        RANGE ${displayedDie.range} (${getRangeLabel(displayedDie.range)})`, {
        fontFamily: 'Orbitron',
        fontSize: '12px',
        color: PALETTE.textMuted
      });

      const skillInfo = formatSkillInfo(displayedDie, locked);
      const displayType = locked
        ? 'LOCKED'
        : formatSkillTypeLine(displayedDie);
      const skillTypeLine = this.add.text(x + 20, y + 78, displayType, {
        fontFamily: 'Orbitron',
        fontSize: '12px',
        color: locked ? PALETTE.textMuted : PALETTE.accentSoft
      });

      const skillDesc = this.add.text(x + 20, y + 104, skillInfo, {
        fontFamily: 'Orbitron',
        fontSize: '12px',
        color: PALETTE.textMuted,
        wordWrap: { width: 280 }
      });

      const refreshCardStatLine = () => {
        const nextCls = getDiceProgress(this, die.typeId).classLevel;
        const nextDisplayedDie = applyDiceTalent(applyClassProgression(die, nextCls), getEquippedTalentId(this, die.typeId));
        classTag.setText(this.isDiceLocked(die.typeId) ? 'LOCKED' : `C${nextCls}`);
        statLine.setText(`ATK ${nextDisplayedDie.attack}  |  HP ${nextDisplayedDie.health}
RANGE ${nextDisplayedDie.range} (${getRangeLabel(nextDisplayedDie.range)})`);
        skillTypeLine.setText(formatSkillTypeLine(nextDisplayedDie));
        skillDesc.setText(formatSkillInfo(nextDisplayedDie, this.isDiceLocked(die.typeId)));
      };
      refreshCardStats.push(refreshCardStatLine);

      const computedCardHeight = Math.max(baseCardHeight, Math.ceil((skillDesc.y + skillDesc.height) - cardTopY + 18));
      const card = this.add.rectangle(x + 160, cardTopY + computedCardHeight / 2, cardWidth, computedCardHeight, cardFill, 0.92)
        .setStrokeStyle(2, locked ? 0x2a3a47 : accent);
      card.setData('typeId', die.typeId);
      header.setPosition(x + 160, cardTopY + 22);

      interactiveCards.push(card);
      card.on('pointerdown', () => {
        if (this.isDiceLocked(die.typeId)) return;
        const quickEquipDice = SettingsStore.get(this).quickEquipDice;
        if (quickEquipDice && selectedSlot !== null) {
          if (equipDieInSlot(die.typeId, selectedSlot)) {
            this.scene.restart();
          }
          return;
        }
        this.openDiceModal(die.typeId, tokenText, () => {
          loadout = getSelectedLoadout(this);
          refreshSlots();
          tokens = getDiceTokens(this);
          tokenText.setText(`DICE TOKENS: ${tokens}  •  Select a loadout slot, then choose a die to equip`);
          refreshCardStats.forEach((refresh) => refresh());
          refreshVisibleCardInteractivity();
        }, () => {
          if (selectedSlot !== null) {
            if (equipDieInSlot(die.typeId, selectedSlot)) {
              this.scene.restart();
            }
            return;
          }
          pendingEquipTypeId = die.typeId;
          refreshSlots();
        });
      });
      card.on('pointerover', () => {
        if (this.isDiceLocked(die.typeId)) return;
        card.setFillStyle(0x1f3e56, 1);
      });
      card.on('pointerout', () => card.setFillStyle(this.isDiceLocked(die.typeId) ? 0x111e28 : 0x173247, 0.98));

      cardsContainer.add([card, header, title, classTag, rarityLine, statLine, skillTypeLine, skillDesc]);
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
    const refreshVisibleCardInteractivity = () => {
      interactiveCards.forEach((card) => {
        const typeId = (card as any).data?.values?.typeId as string | undefined;
        const isLocked = typeId ? this.isDiceLocked(typeId) : false;
        const cardHalfHeight = card.displayHeight / 2;
        const top = card.y + cardsContainer.y - cardHalfHeight;
        const bottom = card.y + cardsContainer.y + cardHalfHeight;
        const isVisible = bottom >= viewTop && top <= viewTop + viewHeight;
        if (isVisible && !isLocked) {
          if (!card.input?.enabled) card.setInteractive({ useHandCursor: true });
          else card.input.cursor = 'pointer';
        } else if (card.input?.enabled) {
          card.disableInteractive();
        }
      });
    };
    refreshVisibleCardInteractivity();

    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _gameObjects: Phaser.GameObjects.GameObject[], _dx: number, dy: number) => {
      const withinX = pointer.worldX >= viewLeft && pointer.worldX <= viewLeft + viewWidth;
      const withinY = pointer.worldY >= viewTop && pointer.worldY <= viewTop + viewHeight;
      if (!withinX || !withinY) return;
      this.cardScrollOffset = Phaser.Math.Clamp(this.cardScrollOffset - dy * 0.35, -maxScroll, 0);
      cardsContainer.y = this.cardScrollOffset;
      refreshVisibleCardInteractivity();
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.modalEscHandler) this.input.keyboard?.off('keydown-ESC', this.modalEscHandler);
      if (this.modalWheelHandler) this.input.off('wheel', this.modalWheelHandler);
      this.modalEscHandler = null;
      this.modalWheelHandler = null;
      this.modalElements = [];
    });
  }

  private getAlternateFormLabel(die: ReturnType<typeof getAllDiceDefinitions>[number], showingAlternate: boolean): string | null {
    return getDiceAlternateFormLabel(die, showingAlternate);
  }

  private getModalDisplayDie(die: ReturnType<typeof getAllDiceDefinitions>[number], classLevel: number, showAlternate: boolean) {
    return getDiceModalDisplayDefinition(die, classLevel, showAlternate);
  }

  private openDiceModal(
    typeId: string,
    tokenText: Phaser.GameObjects.Text,
    onUpdate: () => void,
    onEquipRequest: () => void,
    showAlternate = false
  ) {
    this.modalElements.forEach((el) => el.destroy());
    this.modalElements = [];
    if (this.modalEscHandler) {
      this.input.keyboard?.off('keydown-ESC', this.modalEscHandler);
      this.modalEscHandler = null;
    }
    if (this.modalWheelHandler) {
      this.input.off('wheel', this.modalWheelHandler);
      this.modalWheelHandler = null;
    }
    const die = getAllDiceDefinitions(this).find((definition) => definition.typeId === typeId);
    if (!die) return;
    const progress = getDiceProgress(this, typeId);
    const displayDie = applyDiceTalent(
      this.getModalDisplayDie(die, progress.classLevel, showAlternate),
      getEquippedTalentId(this, typeId)
    );
    const { width, height } = this.scale;
    const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.55).setInteractive();
    const panel = this.add.rectangle(width / 2, height / 2, 540, 390, 0x163246, 0.96).setStrokeStyle(2, 0x4f7ea1);
    const cls = progress.classLevel;
    const hp = displayDie.health;
    const atk = displayDie.attack;
    const isMaxed = cls >= 15;
    const title = this.add.text(width / 2, height / 2 - 155, `${displayDie.title} • CLASS ${cls}/15${isMaxed ? ' (MAX)' : ''}`, { fontFamily: 'Orbitron', fontSize: '20px', color: displayDie.accent }).setOrigin(0.5);
    const stats = this.add.text(width / 2, height / 2 - 116, `ATK ${atk}  |  HP ${hp}  |  RANGE ${displayDie.range} (${getRangeLabel(displayDie.range)})`, { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.text, align: 'center' }).setOrigin(0.5);
    const rarityLabel = this.add.text(width / 2 - 140, height / 2 - 94, 'RARITY', { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.text, align: 'right' }).setOrigin(1, 0.5);
    const rarityColor = RARITY_TEXT_COLORS[displayDie.rarity] ?? PALETTE.text;
    const rarityStats = this.add.text(width / 2 - 126, height / 2 - 94, displayDie.rarity.toUpperCase(), { fontFamily: 'Orbitron', fontSize: '12px', color: rarityColor, align: 'left' }).setOrigin(0, 0.5);
    const targetStats = this.add.text(width / 2 + 12, height / 2 - 94, `TARGET ${displayDie.targetingMode.toUpperCase()}  |  COPIES ${progress.copies}`, { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.text, align: 'left' }).setOrigin(0, 0.5);
    const skillViewportWidth = 470;
    const skillViewportHeight = 112;
    const skillViewportTop = height / 2 - 88;
    const skillTextContent = formatSkillInfo(displayDie);
    const skillContainer = this.add.container(width / 2, skillViewportTop);
    const skill = this.add.text(0, 0, skillTextContent, {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.textMuted,
      align: 'center',
      wordWrap: { width: 440 }
    }).setOrigin(0.5, 0);
    skillContainer.add(skill);
    const skillMaskShape = this.add.rectangle(width / 2 - skillViewportWidth / 2, skillViewportTop, skillViewportWidth, skillViewportHeight, 0xffffff, 0)
      .setOrigin(0, 0)
      .setVisible(false);
    skillContainer.setMask(skillMaskShape.createGeometryMask());
    const maxSkillScroll = Math.max(0, skill.height - skillViewportHeight);
    const skillScrollHint = this.add.text(width / 2, skillViewportTop + skillViewportHeight + 4, maxSkillScroll > 0 ? 'Scroll for more skill info' : '', {
      fontFamily: 'Orbitron',
      fontSize: '10px',
      color: PALETTE.textMuted
    }).setOrigin(0.5);
    let skillScrollOffset = 0;
    this.modalWheelHandler = (pointer: Phaser.Input.Pointer, _gameObjects: Phaser.GameObjects.GameObject[], _dx: number, dy: number) => {
      const withinX = pointer.worldX >= width / 2 - skillViewportWidth / 2 && pointer.worldX <= width / 2 + skillViewportWidth / 2;
      const withinY = pointer.worldY >= skillViewportTop && pointer.worldY <= skillViewportTop + skillViewportHeight;
      if (!withinX || !withinY || maxSkillScroll <= 0) return;
      skillScrollOffset = Phaser.Math.Clamp(skillScrollOffset - dy * 0.35, -maxSkillScroll, 0);
      skillContainer.y = skillViewportTop + skillScrollOffset;
    };
    this.input.on('wheel', this.modalWheelHandler);

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

    const currentTalentId = getEquippedTalentId(this, typeId);
    const talentsAvailable = Boolean(die.talents?.length);
    const talentsComingSoon = !talentsAvailable && Boolean(die.talentsComingSoon);
    let talentBtn: Phaser.GameObjects.Text | null = null;
    if (talentsAvailable || talentsComingSoon) {
      const talentButtonLabel = talentsAvailable
        ? `DICE TALENTS${currentTalentId ? ' • EQUIPPED' : ''}`
        : 'DICE TALENTS • COMING SOON...';
      talentBtn = this.add.text(width / 2, height / 2 + 78, talentButtonLabel, {
        fontFamily: 'Orbitron',
        fontSize: '11px',
        color: talentsAvailable ? '#ffffff' : PALETTE.textMuted,
        backgroundColor: talentsAvailable ? '#315e7a' : '#5a6268',
        fixedWidth: 470,
        align: 'center',
        padding: { left: 10, right: 10, top: 7, bottom: 7 }
      }).setOrigin(0.5);
      if (talentsAvailable) {
        talentBtn.setInteractive({ useHandCursor: true });
        talentBtn.on('pointerdown', () => this.openTalentSelectionModal(typeId, tokenText, onUpdate, onEquipRequest, showAlternate));
      }
    }

    const assignBtn = this.add.rectangle(width / 2 - 110, height / 2 + 110, 180, 40, 0x3498db, 0.95)
      .setInteractive({ useHandCursor: true });
    const assignTxt = this.add.text(width / 2 - 110, height / 2 + 110, 'EQUIP', { fontFamily: 'Orbitron', fontSize: '11px', color: '#ffffff' }).setOrigin(0.5);
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
      altBtn.on('pointerdown', () => this.openDiceModal(typeId, tokenText, onUpdate, onEquipRequest, !showAlternate));
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
        AudioManager.playSfx(this, 'class-up');
        setDiceTokens(this, getDiceTokens(this) - tokenCost);
        const newClassLevel = cls + 1;
        setDiceProgress(this, typeId, { classLevel: newClassLevel, copies: progress.copies - copyCost });
        if (newClassLevel >= 6) AchievementStore.unlock(this, 'getting_stronger');
        if (newClassLevel >= 11) AchievementStore.unlock(this, 'augmented');
        if (newClassLevel >= 15) AchievementStore.unlock(this, 'maximum_power');
        tokenText.setText(`DICE TOKENS: ${getDiceTokens(this)}  •  Select a loadout slot, then choose a die to equip`);
        onUpdate();
        this.openDiceModal(typeId, tokenText, onUpdate, onEquipRequest, showAlternate);
      });
    }
    assignBtn.on('pointerdown', () => {
      closeModal();
      onEquipRequest();
    });
    const closeModal = () => {
      this.modalElements.forEach((el) => el.destroy());
      this.modalElements = [];
      if (this.modalEscHandler) {
        this.input.keyboard?.off('keydown-ESC', this.modalEscHandler);
        this.modalEscHandler = null;
      }
      if (this.modalWheelHandler) {
        this.input.off('wheel', this.modalWheelHandler);
        this.modalWheelHandler = null;
      }
    };
    overlay.on('pointerdown', closeModal);
    close.on('pointerdown', closeModal);
    this.modalEscHandler = () => closeModal();
    this.input.keyboard?.on('keydown-ESC', this.modalEscHandler);
    this.modalElements = [
      overlay, panel, title, stats, rarityLabel, rarityStats, targetStats, skillContainer, skillMaskShape,
      skillScrollHint, costText, ...(talentBtn ? [talentBtn] : []), assignBtn, assignTxt, upBtn, upTxt,
      upgradeTooltip, altBtn, close
    ];
    this.modalElements.forEach((el) => (el as any).setDepth?.(450));
  }

  private openTalentSelectionModal(
    typeId: string,
    tokenText: Phaser.GameObjects.Text,
    onUpdate: () => void,
    onEquipRequest: () => void,
    showAlternate: boolean
  ) {
    this.modalElements.forEach((el) => el.destroy());
    this.modalElements = [];
    if (this.modalEscHandler) {
      this.input.keyboard?.off('keydown-ESC', this.modalEscHandler);
      this.modalEscHandler = null;
    }
    if (this.modalWheelHandler) {
      this.input.off('wheel', this.modalWheelHandler);
      this.modalWheelHandler = null;
    }
    const definition = getAllDiceDefinitions(this).find((die) => die.typeId === typeId);
    if (!definition?.talents?.length) return;

    const { width, height } = this.scale;
    const centerY = height / 2;
    const overlay = this.add.rectangle(width / 2, centerY, width, height, 0x000000, 0.68).setInteractive();
    const panel = this.add.rectangle(width / 2, centerY, 540, 390, 0x163246, 0.98).setStrokeStyle(2, 0x4f7ea1);
    const title = this.add.text(width / 2, centerY - 160, `${definition.title} • DICE TALENTS`, {
      fontFamily: 'Orbitron', fontSize: '18px', color: definition.accent
    }).setOrigin(0.5);
    const hint = this.add.text(width / 2, centerY - 132, 'Equip one talent per die. Equipping another replaces the current talent.', {
      fontFamily: 'Orbitron', fontSize: '10px', color: PALETTE.textMuted, align: 'center'
    }).setOrigin(0.5);
    const elements: Phaser.GameObjects.GameObject[] = [overlay, panel, title, hint];
    const currentTalentId = getEquippedTalentId(this, typeId);

    const close = () => {
      elements.forEach((element) => element.destroy());
      this.modalElements = [];
      if (this.modalEscHandler) {
        this.input.keyboard?.off('keydown-ESC', this.modalEscHandler);
        this.modalEscHandler = null;
      }
      if (this.modalWheelHandler) {
        this.input.off('wheel', this.modalWheelHandler);
        this.modalWheelHandler = null;
      }
    };
    const choose = (talentId: string | null) => {
      setEquippedTalentId(this, definition, talentId);
      close();
      onUpdate();
      this.openDiceModal(typeId, tokenText, onUpdate, onEquipRequest, showAlternate);
    };

    definition.talents.forEach((talent, index) => {
      const y = centerY - 72 + index * 62;
      const active = talent.id === currentTalentId;
      const row = this.add.rectangle(width / 2, y, 470, 50, active ? 0x315e7a : 0x173247, 0.98)
        .setStrokeStyle(1, active ? 0xf4b860 : 0x406987)
        .setInteractive({ useHandCursor: true });
      const name = this.add.text(width / 2 - 210, y - 11, `${active ? '● ' : ''}${talent.title}`, {
        fontFamily: 'Orbitron', fontSize: '11px', color: active ? '#fff1c2' : PALETTE.text
      }).setOrigin(0, 0.5);
      const description = this.add.text(width / 2 - 210, y + 11, talent.description, {
        fontFamily: 'Orbitron', fontSize: '9px', color: PALETTE.textMuted, wordWrap: { width: 340 }
      }).setOrigin(0, 0.5);
      const action = this.add.text(width / 2 + 180, y, active ? 'UNEQUIP' : 'EQUIP', {
        fontFamily: 'Orbitron', fontSize: '9px', color: active ? '#ffb5b5' : '#b8ffd1',
        backgroundColor: active ? '#702f3d' : '#246044',
        padding: { left: 5, right: 5, top: 4, bottom: 4 }
      }).setOrigin(0.5);
      row.on('pointerdown', () => choose(active ? null : talent.id));
      elements.push(row, name, description, action);
    });

    const closeButton = this.add.text(width / 2, centerY + 148, 'CLOSE', {
      fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.textMuted,
      backgroundColor: '#173247', padding: { left: 10, right: 10, top: 5, bottom: 5 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    closeButton.on('pointerdown', close);
    overlay.on('pointerdown', close);
    elements.push(closeButton);
    this.modalElements = elements;
    elements.forEach((element) => (element as any).setDepth?.(450));
    this.modalEscHandler = close;
    this.input.keyboard?.on('keydown-ESC', close);
  }
}
