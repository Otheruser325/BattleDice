import Phaser from 'phaser';
import { PALETTE, drawPanel } from '../ui/theme';
import { CasinoProgressStore, type FivesHandState } from '../systems/CasinoProgressStore';
import { evaluateFivesCombo, type ChestType } from '../systems/CasinoComboTypes';
import { AlertManager } from '../utils/AlertManager';
import { canReceiveUsefulCopies, getAllDiceDefinitions, getDiceProgress, getDiceTokens, getRemainingUsefulCopies, grantDiceCopies, setDiceTokens, DEFAULT_LOADOUT_IDS, getRangeLabel } from '../data/dice';
import { applyClassProgression } from '../systems/ClassProgression';
import { formatSkillInfo } from './DiceScene';
import { SCENE_KEYS } from './sceneKeys';
import { AudioManager } from '../utils/AudioManager';
import { AnimationManager } from '../utils/AnimationManager';
import { AchievementStore } from '../systems/AchievementStore';

interface ChestRewardEntry {
  typeId: string;
  title: string;
  rarity: string;
  copies: number;
  isNew: boolean;
}

interface ChestOpenRewards {
  entries: ChestRewardEntry[];
  diceTokens: number;
}

const CHEST_TYPES: ChestType[] = ['Bronze', 'Silver', 'Gold', 'Diamond', 'Master'];

const CHEST_TOKEN_REWARDS: Record<ChestType, [number, number]> = {
  Bronze: [5, 10],
  Silver: [20, 40],
  Gold: [60, 120],
  Diamond: [150, 360],
  Master: [500, 1500]
};

type RewardRarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Mythic';

interface ChestDropRateEntry {
  rarity: RewardRarity;
  rate: number;
  copies: [number, number];
}

const CHEST_DROP_RATES: Record<ChestType, ChestDropRateEntry[]> = {
  Bronze: [
    { rarity: 'Common', rate: 95, copies: [1, 5] },
    { rarity: 'Uncommon', rate: 5, copies: [1, 5] }
  ],
  Silver: [
    { rarity: 'Common', rate: 40, copies: [3, 10] },
    { rarity: 'Uncommon', rate: 50, copies: [3, 10] },
    { rarity: 'Rare', rate: 10, copies: [1, 5] }
  ],
  Gold: [
    { rarity: 'Common', rate: 20, copies: [10, 40] },
    { rarity: 'Uncommon', rate: 35, copies: [5, 25] },
    { rarity: 'Rare', rate: 42, copies: [3, 10] },
    { rarity: 'Epic', rate: 3, copies: [1, 5] }
  ],
  Diamond: [
    { rarity: 'Common', rate: 10, copies: [40, 160] },
    { rarity: 'Uncommon', rate: 15, copies: [20, 80] },
    { rarity: 'Rare', rate: 30, copies: [10, 40] },
    { rarity: 'Epic', rate: 45, copies: [3, 6] },
    { rarity: 'Legendary', rate: 1, copies: [1, 3] }
  ],
  Master: [
    { rarity: 'Common', rate: 5, copies: [250, 750] },
    { rarity: 'Uncommon', rate: 8, copies: [150, 450] },
    { rarity: 'Rare', rate: 22, copies: [50, 200] },
    { rarity: 'Epic', rate: 40, copies: [6, 30] },
    { rarity: 'Legendary', rate: 25, copies: [1, 5] }
  ]
};

const RARITY_RANK: Record<string, number> = { Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4, Mythic: 5 };
const FIVES_GAUGE_MAX = 1000;

export class CasinoScene extends Phaser.Scene {
  static readonly KEY = SCENE_KEYS.Casino;

  constructor() {
    super(CasinoScene.KEY);
  }

  private dice: number[] = [1, 1, 1, 1, 1];
  private locks: boolean[] = [false, false, false, false, false];
  private rollsLeft = 3;
  private isRolling = false;
  private tableActive = false;
  private crapsTableActive = false;

  private diceImages: Phaser.GameObjects.Image[] = [];
  public diceSprites: Phaser.GameObjects.Image[] = [];
  private lockTexts: Phaser.GameObjects.Text[] = [];
  private chestTexts = new Map<ChestType, Phaser.GameObjects.Text>();
  private chipText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private fivesGaugeFill!: Phaser.GameObjects.Rectangle;
  private fivesGaugeText!: Phaser.GameObjects.Text;
  private rollButton!: Phaser.GameObjects.Text;
  private activeRewardDetailClose: (() => void) | null = null;
  private casinoGrantChipsHandler: (() => void) | null = null;

  private gaugeBg!: Phaser.GameObjects.Rectangle;
  private gaugeFill!: Phaser.GameObjects.Rectangle;
  private gaugeText!: Phaser.GameObjects.Text;

  create() {
    if (this.casinoGrantChipsHandler) this.registry.events.off('casino:grantChips', this.casinoGrantChipsHandler);
    this.casinoGrantChipsHandler = () => {
      if (this.chipText?.scene) this.render();
    };
    this.registry.events.on('casino:grantChips', this.casinoGrantChipsHandler);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.casinoGrantChipsHandler) this.registry.events.off('casino:grantChips', this.casinoGrantChipsHandler);
      this.casinoGrantChipsHandler = null;
    });
    this.resetRuntimeUiState();

    const panel = drawPanel(this, 'CASINO', 'TABLES + CHESTS');
    this.add.rectangle(panel.centerX, panel.centerY - 10, 780, 360, 0x173247, 0.92)
      .setStrokeStyle(1, 0x4f7ea1);

    this.add.rectangle(panel.centerX, panel.y + 62, 180, 30, 0x0d2231, 0.95)
      .setStrokeStyle(1, 0xf4b860);

    this.chipText = this.add.text(panel.centerX, panel.y + 62, '', {
      fontFamily: 'Orbitron',
      fontSize: '16px',
      color: PALETTE.accentSoft
    }).setOrigin(0.5);

    this.add.rectangle(panel.centerX, panel.y + 84, 180, 10, 0x0d2231, 0.95).setStrokeStyle(1, 0xf4b860);
    this.fivesGaugeFill = this.add.rectangle(panel.centerX - 89, panel.y + 84, 0, 8, 0xf4b860, 0.95).setOrigin(0, 0.5);
    this.fivesGaugeText = this.add.text(panel.centerX, panel.y + 98, '', {
      fontFamily: 'Orbitron',
      fontSize: '10px',
      color: PALETTE.textMuted
    }).setOrigin(0.5);

    this.statusText = this.add.text(panel.centerX, panel.y + 112, '', {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.textMuted
    }).setOrigin(0.5);

    this.drawDiceRow(panel.centerX, panel.centerY - 60);

    this.comboText = this.add.text(panel.centerX, panel.centerY - 6, '', {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.success,
      align: 'center'
    }).setOrigin(0.5);

    this.drawButtons(panel.centerX, panel.centerY + 32);
    this.drawChestSidebar(panel.right - 145, panel.y + 112);

    const gaugeY = panel.centerY + 85;
    this.add.text(panel.centerX, gaugeY - 18, 'FIVES GAUGE (1000 = GUARANTEED FIVE-OF-A-KIND)', {
      fontFamily: 'Orbitron',
      fontSize: '10px',
      color: PALETTE.textMuted
    }).setOrigin(0.5);

    this.gaugeBg = this.add.rectangle(panel.centerX, gaugeY, 400, 16, 0x0d2231, 0.95)
      .setStrokeStyle(1, 0x3a6688);

    this.gaugeFill = this.add.rectangle(panel.centerX - 200, gaugeY, 0, 14, 0xf4b860, 0.85)
      .setOrigin(0, 0.5);

    this.gaugeText = this.add.text(panel.centerX, gaugeY, '', {
      fontFamily: 'Orbitron',
      fontSize: '11px',
      color: '#ffffff',
      fontStyle: 'bold'
    }).setOrigin(0.5);

    this.render();
  }


  private resetRuntimeUiState() {
    this.diceImages = [];
    this.diceSprites = this.diceImages;
    this.lockTexts = [];
    this.chestTexts.clear();

    const savedHand = CasinoProgressStore.get(this).fivesHand;
    if (savedHand?.tableActive) {
      this.restoreFivesHand(savedHand);
      return;
    }

    this.clearFivesHandRuntime();
  }

  private restoreFivesHand(hand: FivesHandState) {
    this.dice = [...hand.dice];
    this.locks = [...hand.locks];
    this.rollsLeft = hand.rollsLeft;
    this.tableActive = hand.tableActive;
    this.crapsTableActive = false;
  }

  private clearFivesHandRuntime() {
    this.tableActive = false;
    this.isRolling = false;
    this.crapsTableActive = false;
    this.rollsLeft = 3;
    this.locks = [false, false, false, false, false];
    this.dice = [1, 1, 1, 1, 1];
  }

  private saveFivesHand() {
    CasinoProgressStore.mutate(this, (current) => ({
      ...current,
      fivesHand: {
        dice: [...this.dice],
        locks: [...this.locks],
        rollsLeft: this.rollsLeft,
        tableActive: this.tableActive
      }
    }));
  }

  private clearSavedFivesHand() {
    CasinoProgressStore.mutate(this, (current) => ({ ...current, fivesHand: null }));
  }

  private drawDiceRow(cx: number, y: number) {
    for (let i = 0; i < 5; i++) {
      const x = cx - 160 + i * 80;
      this.add.rectangle(x, y, 62, 62, 0x183447, 1).setStrokeStyle(1, 0x3a6688);
      const die = this.add.image(x, y - 6, this.getDiceTextureKey(this.dice[i]))
        .setDisplaySize(43, 43);
      const lock = this.add.text(x, y + 22, 'UNLOCK', {
        fontFamily: 'Orbitron',
        fontSize: '9px',
        color: PALETTE.textMuted,
        backgroundColor: '#173247',
        padding: { left: 4, right: 4, top: 2, bottom: 2 }
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });

      lock.on('pointerdown', () => {
        if (!this.tableActive || this.rollsLeft >= 3 || this.rollsLeft <= 0 || this.isRolling) return;
        this.locks[i] = !this.locks[i];
        this.saveFivesHand();
        this.render();
      });

      this.diceImages.push(die);
      this.lockTexts.push(lock);
    }
  }

  private drawButtons(cx: number, y: number) {
    const makeButton = (x: number, label: string, onClick: () => void) => {
      const button = this.add.text(x, y, label, {
        fontFamily: 'Orbitron',
        fontSize: '12px',
        color: '#000000',
        backgroundColor: '#f4b860',
        padding: { left: 10, right: 10, top: 6, bottom: 6 }
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      button.on('pointerdown', onClick);
      return button;
    };

    makeButton(cx - 180, 'START FIVES (10)', () => this.startFives());
    this.rollButton = makeButton(cx - 40, 'ROLL', () => this.rollDice());
    makeButton(cx + 70, 'CASH OUT', () => this.cashOut());
    makeButton(cx + 190, 'CRAPS (2)', () => this.playCraps());
  }

  private getLockedDiceCount(): number {
    return this.locks.filter(Boolean).length;
  }

  private getLockedDiceRerollCost(): number {
    return this.getLockedDiceCount() * 5;
  }

  private canRollFives(progress = CasinoProgressStore.get(this)): boolean {
    return this.tableActive && this.rollsLeft > 0 && !this.isRolling && this.getLockedDiceCount() < 5 && progress.chips >= this.getLockedDiceRerollCost();
  }

  private drawChestSidebar(x: number, y: number) {
    this.add.text(x, y - 26, 'CHESTS', {
      fontFamily: 'Orbitron',
      fontSize: '14px',
      color: PALETTE.accent
    }).setOrigin(0.5);

    CHEST_TYPES.forEach((type, idx) => {
      const rowY = y + idx * 48;
      const label = this.add.text(x - 30, rowY, `${type}: 0`, {
        fontFamily: 'Orbitron',
        fontSize: '11px',
        color: PALETTE.text
      }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
      const openBtn = this.add.text(x + 70, rowY - 10, 'Open', {
        fontFamily: 'Orbitron',
        fontSize: '10px',
        color: '#dff4ff',
        backgroundColor: '#2878b8',
        padding: { left: 6, right: 6, top: 3, bottom: 3 }
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      const allBtn = this.add.text(x + 70, rowY + 10, 'Open All!', {
        fontFamily: 'Orbitron',
        fontSize: '10px',
        color: '#eaffea',
        backgroundColor: '#2c9b52',
        padding: { left: 6, right: 6, top: 3, bottom: 3 }
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });

      label.on('pointerdown', () => this.openChestModal(type));
      openBtn.on('pointerdown', () => this.openChestModal(type));
      allBtn.on('pointerdown', () => this.openChestModal(type));
      this.chestTexts.set(type, label);
    });
  }

  private startFives() {
    const progress = CasinoProgressStore.get(this);
    if (this.tableActive) return AlertManager.toast(this, { type: 'warning', message: 'Finish current table first.' });
    if (progress.chips < 10) return AlertManager.toast(this, { type: 'warning', message: 'Need 10 chips for Fives.' });

    this.dice = [1, 1, 1, 1, 1];
    this.locks = [false, false, false, false, false];
    this.rollsLeft = 3;
    this.tableActive = true;
    this.crapsTableActive = false;
    CasinoProgressStore.mutate(this, (current) => ({ ...current, chips: current.chips - 10 }));
    this.trackCasinoTablePlay();
    this.rollDice();
    this.render();
  }

  private async rollDice() {
    const lockedCost = this.getLockedDiceRerollCost();
    const progress = CasinoProgressStore.get(this);
    if (!this.tableActive || this.rollsLeft <= 0 || this.isRolling) return;
    if (this.getLockedDiceCount() >= 5) return AlertManager.toast(this, { type: 'warning', message: 'Unlock at least one die before re-rolling.' });
    if (progress.chips < lockedCost) return AlertManager.toast(this, { type: 'warning', message: `Need ${lockedCost} chips to re-roll with locked dice.` });
    if (lockedCost > 0) CasinoProgressStore.mutate(this, (current) => ({ ...current, chips: current.chips - lockedCost }));
    this.isRolling = true;
    AudioManager.playSfx(this, 'chest-open');
    const isGuaranteed = progress.fivesGauge >= FIVES_GAUGE_MAX;
    if (isGuaranteed) {
      const guaranteedPip = Phaser.Math.Between(1, 6);
      this.dice = [guaranteedPip, guaranteedPip, guaranteedPip, guaranteedPip, guaranteedPip];
      this.locks = [false, false, false, false, false];
    } else {
      this.dice = this.dice.map((pip, i) => (this.locks[i] ? pip : Phaser.Math.Between(1, 6)));
    }

    this.rollsLeft -= 1;
    const rollSum = this.dice.reduce((a, b) => a + b, 0);

    CasinoProgressStore.mutate(this, (current) => ({
      ...current,
      fivesGauge: isGuaranteed ? 0 : current.fivesGauge, // Only reset when guaranteed, don't charge on re-roll
      fivesHand: {
        dice: [...this.dice],
        locks: [...this.locks],
        rollsLeft: this.rollsLeft,
        tableActive: this.tableActive
      }
    }));

    try {
      await AnimationManager.animateDiceRoll(this, this.dice, this.diceSprites, { locked: this.locks, jitter: 8 });
    } finally {
      this.isRolling = false;
    }
    const combo = evaluateFivesCombo(this.dice);
    const comboSfxKey = this.getComboSfxKey(combo.combo);
    if (comboSfxKey) AudioManager.playSfx(this, comboSfxKey);
    this.render();
  }

  private cashOut() {
    if (!this.tableActive || this.rollsLeft === 3 || this.isRolling) return;
    const payout = evaluateFivesCombo(this.dice);
    CasinoProgressStore.mutate(this, (current) => ({
      ...current,
      fivesGauge: payout.combo === 'Five-of-a-kind' ? 0 : Math.min(FIVES_GAUGE_MAX, current.fivesGauge + payout.pipSum),
      chests: { ...current.chests, [payout.chestType]: current.chests[payout.chestType] + payout.chestCount }
    }));
    this.clearFivesHandRuntime();
    this.clearSavedFivesHand();
    this.crapsTableActive = false;
    if (payout.combo === 'Five-of-a-kind') AchievementStore.unlock(this, 'jackpot');
    this.render();
  }

  private playCraps() {
    const progress = CasinoProgressStore.get(this);
    if (this.tableActive) return AlertManager.toast(this, { type: 'warning', message: 'Finish current table first.' });
    if (progress.chips < 2) return AlertManager.toast(this, { type: 'warning', message: 'Need 2 chips for Craps.' });

    AudioManager.playSfx(this, 'chest-open');
    const outcome = this.resolveCrapsRound();
    this.crapsTableActive = true;
    this.dice = [outcome.finalRoll[0], outcome.finalRoll[1], 1, 1, 1];
    this.locks = [true, true, false, false, false];

    CasinoProgressStore.mutate(this, (current) => ({
      ...current,
      chips: current.chips - 2,
      fivesGauge: 0,
      chests: outcome.chestType
        ? { ...current.chests, [outcome.chestType]: current.chests[outcome.chestType] + outcome.chestCount }
        : current.chests
    }));
    this.trackCasinoTablePlay();

    const chestText = outcome.chestType ? `${outcome.chestType} x${outcome.chestCount}` : 'no chest';
    void AnimationManager.animateDiceRoll(this, this.dice, this.diceSprites, { locked: [false, false, true, true, true], jitter: 8 });
    this.statusText.setText(`Craps: ${outcome.summary} • ${chestText}`);
    this.render(outcome.summary, chestText);
  }

  private trackCasinoTablePlay() {
    const next = AchievementStore.mutate(this, (state) => ({ ...state, casinoTablesPlayed: state.casinoTablesPlayed + 1 }));
    AchievementStore.unlock(this, 'vegas_boy');
    if (next.casinoTablesPlayed >= 10) AchievementStore.unlock(this, 'gambolic');
    if (next.casinoTablesPlayed >= 50) AchievementStore.unlock(this, 'risksino');
  }

  private getComboSfxKey(combo: string): string | null {
    switch (combo) {
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

  private rollCrapsDice(): [number, number] {
    return [Phaser.Math.Between(1, 6), Phaser.Math.Between(1, 6)];
  }

  private resolveCrapsRound(): { finalRoll: [number, number]; summary: string; chestType: ChestType | null; chestCount: number } {
    const firstRoll = this.rollCrapsDice();
    const firstSum = firstRoll[0] + firstRoll[1];
    if (firstSum === 7 || firstSum === 11) {
      return { finalRoll: firstRoll, summary: `Natural ${firstSum} on ${firstRoll.join('+')}`, chestType: 'Gold', chestCount: firstSum };
    }
    if (firstSum === 2 || firstSum === 3 || firstSum === 12) {
      return { finalRoll: firstRoll, summary: `Craps ${firstSum} on ${firstRoll.join('+')}`, chestType: null, chestCount: 0 };
    }

    const point = firstSum;
    let finalRoll = firstRoll;
    for (let rollCount = 1; rollCount <= 60; rollCount++) {
      finalRoll = this.rollCrapsDice();
      const sum = finalRoll[0] + finalRoll[1];
      if (sum === point) {
        const isHardPoint = finalRoll[0] === finalRoll[1];
        return {
          finalRoll,
          summary: `Point ${point} made with ${finalRoll.join('+')}`,
          chestType: isHardPoint ? 'Gold' : 'Silver',
          chestCount: sum
        };
      }
      if (sum === 7) {
        return { finalRoll, summary: `Seven-out against point ${point} (${finalRoll.join('+')})`, chestType: null, chestCount: 0 };
      }
    }

    return { finalRoll, summary: `Point ${point} pushed after a long table`, chestType: 'Bronze', chestCount: point };
  }


  private getChestDropRateText(type: ChestType) {
    const [minTokens, maxTokens] = CHEST_TOKEN_REWARDS[type];
    const cardRates = CHEST_DROP_RATES[type]
      .map((entry) => `${entry.rarity}: ${entry.rate}% • ${entry.copies[0]}-${entry.copies[1]} cards`)
      .join('\n');
    return `${cardRates}\nDice Tokens: +${minTokens}-${maxTokens}`;
  }

  private openChestModal(type: ChestType) {
    const amount = CasinoProgressStore.get(this).chests[type];
    const { width, height } = this.scale;
    const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.55).setInteractive();
    const panel = this.add.rectangle(width / 2, height / 2, 680, 420, 0x153449, 0.97).setStrokeStyle(2, 0x4f7ea1);
    const title = this.add.text(width / 2, height / 2 - 170, `${type} Chest`, {
      fontFamily: 'Orbitron',
      fontSize: '24px',
      color: PALETTE.accent
    }).setOrigin(0.5);
    const chest = this.add.rectangle(width / 2, height / 2 - 62, 120, 90, 0x2f5f80, 0.95).setStrokeStyle(2, 0x8fd5ff);
    const count = this.add.text(width / 2, height / 2 + 0, `Available: ${amount}`, {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.textMuted
    }).setOrigin(0.5);

    const dropInfo = this.add.text(width / 2, height / 2 + 74, this.getChestDropRateText(type), {
      fontFamily: 'Orbitron',
      fontSize: '10px',
      color: PALETTE.success,
      align: 'center',
      backgroundColor: '#0d2231',
      padding: { left: 8, right: 8, top: 6, bottom: 6 },
      wordWrap: { width: 560 }
    }).setOrigin(0.5).setVisible(false);
    const ratesBtn = this.add.text(width / 2 + 160, height / 2 - 170, '?', {
      fontFamily: 'Orbitron',
      fontSize: '15px',
      color: '#0b1520',
      backgroundColor: PALETTE.accent,
      padding: { left: 7, right: 7, top: 2, bottom: 2 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    let dropInfoPinned = false;
    const toggleDropInfo = () => {
      dropInfoPinned = !dropInfoPinned;
      dropInfo.setVisible(dropInfoPinned);
    };
    ratesBtn.on('pointerover', () => dropInfo.setVisible(true));
    ratesBtn.on('pointerout', () => { if (!dropInfoPinned) dropInfo.setVisible(false); });
    ratesBtn.on('pointerdown', toggleDropInfo);

    const escHandler = () => {
      if (this.activeRewardDetailClose) {
        this.activeRewardDetailClose();
        return;
      }
      close();
    };
    this.input.keyboard?.on('keydown-ESC', escHandler);
    const close = () => {
      this.input.keyboard?.off('keydown-ESC', escHandler);
      [overlay, panel, title, chest, count, dropInfo, ratesBtn, open, openAll, closeBtn].forEach((o) => o.destroy());
    };
    const doOpen = (all: boolean) => {
      const latest = CasinoProgressStore.get(this).chests[type];
      const openCount = all ? latest : Math.min(1, latest);
      if (openCount <= 0) return AlertManager.toast(this, { type: 'warning', message: `No ${type} chests available.` });
      this.openChests(type, openCount, all);
      close();
    };

    const open = this.add.text(width / 2 - 100, height / 2 + 146, 'Open', {
      fontFamily: 'Orbitron',
      fontSize: '13px',
      color: '#dff4ff',
      backgroundColor: amount > 0 ? '#2878b8' : '#5d6770',
      padding: { left: 12, right: 12, top: 6, bottom: 6 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const openAll = this.add.text(width / 2 + 100, height / 2 + 146, 'Open All!', {
      fontFamily: 'Orbitron',
      fontSize: '13px',
      color: '#eaffea',
      backgroundColor: amount > 0 ? '#2c9b52' : '#5d6770',
      padding: { left: 12, right: 12, top: 6, bottom: 6 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const closeBtn = this.add.text(width / 2, height / 2 + 184, 'Close', {
      fontFamily: 'Orbitron',
      fontSize: '11px',
      color: PALETTE.textMuted,
      backgroundColor: '#173247',
      padding: { left: 8, right: 8, top: 4, bottom: 4 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    open.on('pointerdown', () => doOpen(false));
    openAll.on('pointerdown', () => doOpen(true));
    closeBtn.on('pointerdown', close);
    overlay.on('pointerdown', close);
  }

  private openChests(type: ChestType, openCount: number, isAll: boolean) {
    CasinoProgressStore.mutate(this, (progress) => ({
      ...progress,
      chests: { ...progress.chests, [type]: Math.max(0, progress.chests[type] - openCount) }
    }));
    AudioManager.playSfx(this, 'chest-open');
    const rewards = this.rollChestOpenRewards(type, openCount);
    const entries = rewards.entries.sort((a, b) => (
      RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity] || a.title.localeCompare(b.title)
    ));
    const burst = this.add.rectangle(this.scale.width / 2, this.scale.height / 2, 120, 90, 0x8fd5ff, 0.25)
      .setStrokeStyle(2, 0xffffff)
      .setDepth(9999);
    this.tweens.add({ targets: burst, scale: isAll ? 4 : 2, alpha: 0, duration: isAll ? 520 : 320, onComplete: () => burst.destroy() });
    this.showRewardsModal(type, entries, rewards.diceTokens);
    this.render();
  }

  private rollChestOpenRewards(type: ChestType, openCount: number): ChestOpenRewards {
    const merged = new Map<string, ChestRewardEntry>();
    const pendingCopies = new Map<string, number>();
    const tokenRange = CHEST_TOKEN_REWARDS[type];
    let diceTokens = 0;
    let emptyRewardRolls = 0;

    for (let i = 0; i < openCount; i++) {
      diceTokens += Phaser.Math.Between(tokenRange[0], tokenRange[1]);
      const reward = this.rollChestReward(type, pendingCopies);
      if (!reward) {
        emptyRewardRolls += 1;
        continue;
      }
      pendingCopies.set(reward.typeId, (pendingCopies.get(reward.typeId) ?? 0) + reward.copies);

      const current = merged.get(reward.typeId);
      merged.set(reward.typeId, current
        ? { ...current, copies: current.copies + reward.copies, isNew: current.isNew || reward.isNew }
        : reward);
    }

    if (emptyRewardRolls > 0) {
      const fallbackMin = Math.max(10, Math.floor(tokenRange[0] * 0.5));
      const fallbackMax = Math.max(fallbackMin, Math.floor(tokenRange[1] * 0.5));
      for (let i = 0; i < emptyRewardRolls; i++) diceTokens += Phaser.Math.Between(fallbackMin, fallbackMax);
    }

    setDiceTokens(this, getDiceTokens(this) + diceTokens);

    return { entries: [...merged.values()], diceTokens };
  }

  private rollChestReward(type: ChestType, pendingCopies: Map<string, number>): ChestRewardEntry | null {
    const defs = getAllDiceDefinitions(this).filter((definition) => {
      if (!canReceiveUsefulCopies(this, definition.typeId)) return false;
      const pending = pendingCopies.get(definition.typeId) ?? 0;
      return pending < getRemainingUsefulCopies(this, definition.typeId);
    });
    const byRarity = (rarity: string, pool = defs) => pool.filter((definition) => definition.rarity === rarity);
    const table = CHEST_DROP_RATES[type];

    // Calculate remaining useful copies per rarity for smarter roll distribution
    const rarityRemainingCapacity = new Map<string, number>();
    for (const entry of table) {
      const pool = byRarity(entry.rarity);
      let totalRemaining = 0;
      for (const def of pool) {
        const pending = pendingCopies.get(def.typeId) ?? 0;
        const remaining = getRemainingUsefulCopies(this, def.typeId);
        totalRemaining += Math.max(0, remaining - pending);
      }
      rarityRemainingCapacity.set(entry.rarity, totalRemaining);
    }

    const tryGrantFromPool = (pool: typeof defs, rarity: string, copyRange: [number, number]): ChestRewardEntry | null => {
      const remainingPool = [...pool];
      while (remainingPool.length > 0) {
        // Prefer dice with more remaining useful copies
        remainingPool.sort((a, b) => {
          const aPending = pendingCopies.get(a.typeId) ?? 0;
          const bPending = pendingCopies.get(b.typeId) ?? 0;
          const aRemaining = Math.max(0, getRemainingUsefulCopies(this, a.typeId) - aPending);
          const bRemaining = Math.max(0, getRemainingUsefulCopies(this, b.typeId) - bPending);
          return bRemaining - aRemaining;
        });
        const die = remainingPool[0];
        const copies = Phaser.Math.Between(copyRange[0], copyRange[1]);
        const progress = getDiceProgress(this, die.typeId);
        const beforeCopies = progress.copies;
        const wasUnlocked = progress.unlocked || DEFAULT_LOADOUT_IDS.has(die.typeId);
        grantDiceCopies(this, die.typeId, copies);
        const afterCopies = getDiceProgress(this, die.typeId).copies;
        const grantedCopies = Math.max(0, afterCopies - beforeCopies);
        // Only mark as NEW if the die was not previously unlocked AND we actually granted copies
        const isNew = !wasUnlocked && grantedCopies > 0;
        if (grantedCopies > 0) return { typeId: die.typeId, title: die.title, rarity, copies: grantedCopies, isNew };
        remainingPool.shift();
      }
      return null;
    };

    const availableTable = table.filter((entry) => byRarity(entry.rarity).length > 0);
    if (availableTable.length === 0) return null;

    // Use remaining capacity to weight rarity selection (hardened selection)
    const weightedTable = availableTable.map(entry => ({
      ...entry,
      adjustedRate: entry.rate * Math.max(1, Math.log10(1 + (rarityRemainingCapacity.get(entry.rarity) ?? 1)))
    }));

    let remainingEntries = [...weightedTable];
    while (remainingEntries.length > 0) {
      const totalRate = remainingEntries.reduce((sum, entry) => sum + entry.adjustedRate, 0);
      let roll = Math.random() * totalRate;
      const selected = remainingEntries.find((entry) => {
        roll -= entry.adjustedRate;
        return roll < 0;
      }) ?? remainingEntries[remainingEntries.length - 1];

      const reward = tryGrantFromPool(byRarity(selected.rarity), selected.rarity, selected.copies);
      if (reward) return reward;
      remainingEntries = remainingEntries.filter((entry) => entry.rarity !== selected.rarity);
    }

    return null;
  }

  private showRewardsModal(type: ChestType, entries: ChestRewardEntry[], diceTokens: number) {
    const { width, height } = this.scale;
    const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.58).setInteractive();
    const panel = this.add.rectangle(width / 2, height / 2, 930, 560, 0x153449, 0.98).setStrokeStyle(2, 0x4f7ea1);
    const title = this.add.text(width / 2, height / 2 - 250, `${type} Rewards`, {
      fontFamily: 'Orbitron',
      fontSize: '28px',
      color: PALETTE.accent
    }).setOrigin(0.5);
    const tokenSummary = this.add.text(width / 2, height / 2 - 214, `Dice Tokens: +${diceTokens.toLocaleString()} (now ${getDiceTokens(this).toLocaleString()})`, {
      fontFamily: 'Orbitron',
      fontSize: '16px',
      color: PALETTE.accentSoft
    }).setOrigin(0.5);
    const closeBtn = this.add.text(width / 2, height / 2 + 252, 'Close', {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.textMuted,
      backgroundColor: '#173247',
      padding: { left: 10, right: 10, top: 5, bottom: 5 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    const rewardsTop = height / 2 - 178;
    const rewardsHeight = 408;
    const container = this.add.container(width / 2 - 430, rewardsTop);
    const mask = this.add.rectangle(width / 2 - 430, rewardsTop, 860, rewardsHeight, 0xffffff, 0).setOrigin(0, 0).setVisible(false);
    container.setMask(mask.createGeometryMask());

    const rarityColors: Record<string, string> = {
      Common: '#ffffff',
      Uncommon: '#3dc45d',
      Rare: '#5ba3ff',
      Epic: '#b96cff',
      Legendary: '#ffd84d',
      Mythic: '#ff4d4d'
    };

    entries.forEach((entry, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = col * 280;
      const y = row * 92;
      const rarityColor = rarityColors[entry.rarity] ?? PALETTE.text;
      const accentHex = Phaser.Display.Color.HexStringToColor(rarityColor).color;
      const card = this.add.rectangle(x + 132, y + 38, 264, 76, 0x204d6a, 0.95)
        .setStrokeStyle(2, accentHex)
        .setInteractive({ useHandCursor: true });
      const header = this.add.rectangle(x + 132, y + 18, 264, 28, accentHex, 0.15);
      const titleText = this.add.text(x + 16, y + 10, entry.title.toUpperCase(), {
        fontFamily: 'Orbitron',
        fontSize: '13px',
        color: rarityColor
      });
      const copiesText = this.add.text(x + 16, y + 50, `+${entry.copies} copies`, {
        fontFamily: 'Orbitron',
        fontSize: '12px',
        color: PALETTE.accentSoft
      });
      const newBadge = entry.isNew ? this.add.text(x + 190, y + 50, 'NEW', {
        fontFamily: 'Orbitron',
        fontSize: '10px',
        color: '#000000',
        backgroundColor: '#2ecc71',
        padding: { left: 6, right: 6, top: 2, bottom: 2 }
      }) : null;
      card.on('pointerover', () => card.setFillStyle(0x2a6080, 0.95));
      card.on('pointerout', () => card.setFillStyle(0x204d6a, 0.95));
      card.on('pointerdown', () => this.showRewardDiceDetails(entry.typeId));
      container.add([card, header, titleText, copiesText]);
      if (newBadge) container.add(newBadge);
    });

    const maxScroll = Math.max(0, Math.ceil(entries.length / 3) * 92 - rewardsHeight);
    let offset = 0;
    const scrollBounds = new Phaser.Geom.Rectangle(width / 2 - 430, rewardsTop, 860, rewardsHeight);
    const wheelHandler = (pointer: Phaser.Input.Pointer, _go: Phaser.GameObjects.GameObject[], _dx: number, dy: number) => {
      if (!overlay.active || !Phaser.Geom.Rectangle.Contains(scrollBounds, pointer.x, pointer.y)) return;
      offset = Phaser.Math.Clamp(offset - dy * 0.8, -maxScroll, 0);
      container.y = rewardsTop + offset;
    };
    this.input.on('wheel', wheelHandler);

    const escHandler = () => {
      if (this.activeRewardDetailClose) {
        this.activeRewardDetailClose();
        return;
      }
      close();
    };
    this.input.keyboard?.on('keydown-ESC', escHandler);
    const close = () => {
      this.input.off('wheel', wheelHandler);
      this.input.keyboard?.off('keydown-ESC', escHandler);
      [overlay, panel, title, tokenSummary, closeBtn, container, mask].forEach((obj) => obj.destroy());
    };
    closeBtn.on('pointerdown', close);
    overlay.on('pointerdown', () => undefined);
  }

  private showRewardDiceDetails(typeId: string) {
    const definition = getAllDiceDefinitions(this).find((d) => d.typeId === typeId);
    if (!definition) return;
    const progress = getDiceProgress(this, definition.typeId);
    const { width, height } = this.scale;
    
    // Get display stats with class progression applied
    const displayDie = applyClassProgression(definition, progress.classLevel);
    
    const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.55).setInteractive();
    const panel = this.add.rectangle(width / 2, height / 2, 540, 380, 0x163246, 0.96).setStrokeStyle(2, 0x4f7ea1);
    
    const rarityColors: Record<string, string> = {
      Common: '#ffffff',
      Uncommon: '#3dc45d',
      Rare: '#5ba3ff',
      Epic: '#b96cff',
      Legendary: '#ffd84d',
      Mythic: '#ff4d4d'
    };
    const rarityColor = rarityColors[definition.rarity] ?? PALETTE.text;
    
    const cls = progress.classLevel;
    const isMaxed = cls >= 15;
    
    // Title with class level
    const title = this.add.text(width / 2, height / 2 - 155, `${displayDie.title} • CLASS ${cls}/15${isMaxed ? ' (MAX)' : ''}`, {
      fontFamily: 'Orbitron',
      fontSize: '20px',
      color: definition.accent
    }).setOrigin(0.5);
    
    // Stats with class progression
    const stats = this.add.text(width / 2, height / 2 - 116, `ATK ${displayDie.attack}  |  HP ${displayDie.health}  |  RANGE ${displayDie.range} (${getRangeLabel(displayDie.range)})`, {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.text,
      align: 'center'
    }).setOrigin(0.5);
    
    // Rarity label and colored rarity text (matching DiceScene style)
    const rarityLabel = this.add.text(width / 2 - 140, height / 2 - 94, 'RARITY', {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.text,
      align: 'right'
    }).setOrigin(1, 0.5);
    const rarityStats = this.add.text(width / 2 - 126, height / 2 - 94, definition.rarity, {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: rarityColor,
      align: 'left'
    }).setOrigin(0, 0.5);
    
    // Target and copies (matching DiceScene style)
    const targetStats = this.add.text(width / 2 + 126, height / 2 - 94, `TARGET ${definition.targetingMode.toUpperCase()}  |  COPIES ${progress.copies}`, {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.text,
      align: 'left'
    }).setOrigin(0, 0.5);
    
    // Class circle indicator
    const classCircle = this.add.circle(width / 2 + 220, height / 2 - 92, 28, Phaser.Display.Color.HexStringToColor(rarityColor).color, 0.95).setStrokeStyle(2, 0xffffff, 0.55);
    const classLabel = this.add.text(width / 2 + 220, height / 2 - 100, 'CLASS', {
      fontFamily: 'Orbitron',
      fontSize: '9px',
      color: definition.rarity === 'Common' || definition.rarity === 'Legendary' ? '#111111' : '#ffffff'
    }).setOrigin(0.5);
    const classLevelText = this.add.text(width / 2 + 220, height / 2 - 84, `${cls}`, {
      fontFamily: 'Orbitron',
      fontSize: '18px',
      color: definition.rarity === 'Common' || definition.rarity === 'Legendary' ? '#111111' : '#ffffff'
    }).setOrigin(0.5);
    
    // Skill info with scrolling (matching DiceScene style)
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
    
    // Scroll handler
    let skillScrollOffset = 0;
    const wheelHandler = (pointer: Phaser.Input.Pointer, _go: Phaser.GameObjects.GameObject[], _dx: number, dy: number) => {
      const withinX = pointer.worldX >= width / 2 - skillViewportWidth / 2 && pointer.worldX <= width / 2 + skillViewportWidth / 2;
      const withinY = pointer.worldY >= skillViewportTop && pointer.worldY <= skillViewportTop + skillViewportHeight;
      if (!withinX || !withinY || maxSkillScroll <= 0) return;
      skillScrollOffset = Phaser.Math.Clamp(skillScrollOffset - dy * 0.35, -maxSkillScroll, 0);
      skillContainer.y = skillViewportTop + skillScrollOffset;
    };
    this.input.on('wheel', wheelHandler);
    
    const closeBtn = this.add.text(width / 2, height / 2 + 155, 'Close', {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.textMuted,
      backgroundColor: '#173247',
      padding: { left: 10, right: 10, top: 6, bottom: 6 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    
    const escHandler = () => close();
    this.input.keyboard?.on('keydown-ESC', escHandler);
    const close = () => {
      this.input.off('wheel', wheelHandler);
      this.input.keyboard?.off('keydown-ESC', escHandler);
      [overlay, panel, title, stats, rarityLabel, rarityStats, targetStats, classCircle, classLabel, classLevelText, skillContainer, skillMaskShape, skillScrollHint, closeBtn].forEach((obj) => obj.destroy());
      this.activeRewardDetailClose = null;
    };
    this.activeRewardDetailClose = close;
    closeBtn.on('pointerdown', close);
    overlay.on('pointerdown', () => undefined);
    
    // Set depth for all elements
    [overlay, panel, title, stats, rarityLabel, rarityStats, targetStats, classCircle, classLabel, classLevelText, skillContainer, skillMaskShape, skillScrollHint, closeBtn].forEach((el) => (el as any).setDepth?.(450));
  }

  private getDiceTextureKey(pip: number) {
    return `dice-face-${Phaser.Math.Clamp(Math.floor(pip), 1, 6)}`;
  }

  private render(crapsSummary?: string, crapsChestText?: string) {
    const showFivesDice = this.tableActive;
    const showCrapsDice = !this.tableActive && this.crapsTableActive;

    this.diceImages.forEach((image, i) => {
      if (!image?.scene) return;
      image.setTexture(this.getDiceTextureKey(this.dice[i] ?? 1));
      image.setVisible(showFivesDice || (showCrapsDice && i < 2));
    });
    this.lockTexts.forEach((text, i) => {
      if (!text?.scene) return;
      text.setVisible(showFivesDice || (showCrapsDice && i < 2));
      if (showCrapsDice && i < 2) {
        text.setText('CRAPS');
        text.setColor(PALETTE.accentSoft);
        return;
      }
      text.setText(this.locks[i] ? 'LOCKED' : 'UNLOCK');
      text.setColor(this.locks[i] ? PALETTE.accentSoft : PALETTE.textMuted);
    });
    const progress = CasinoProgressStore.get(this);
    this.chipText.setText(`CHIPS: ${progress.chips}`);
    const gaugeWidth = Math.round(178 * Phaser.Math.Clamp(progress.fivesGauge / FIVES_GAUGE_MAX, 0, 1));
    this.fivesGaugeFill.setDisplaySize(gaugeWidth, 8);
    this.fivesGaugeText.setText(`FIVES GAUGE: ${progress.fivesGauge}/${FIVES_GAUGE_MAX}`);
    const lockedCost = this.getLockedDiceRerollCost();
    const canRoll = this.canRollFives(progress);
    this.rollButton.setText(lockedCost > 0 ? `ROLL (-${lockedCost})` : 'ROLL');
    this.rollButton.setColor(canRoll ? '#000000' : PALETTE.textMuted);
    this.rollButton.setBackgroundColor(canRoll ? '#f4b860' : '#3e4f5c');
    if (canRoll && !this.rollButton.input?.enabled) this.rollButton.setInteractive({ useHandCursor: true });
    else if (!canRoll && this.rollButton.input?.enabled) this.rollButton.disableInteractive();
    if (this.tableActive) {
      const currentCombo = evaluateFivesCombo(this.dice);
      this.comboText.setText(
        `Current Fives: ${currentCombo.combo} — ${currentCombo.layout} • ${currentCombo.chestType} x${currentCombo.chestCount} (sum ${currentCombo.pipSum})`
      );
    } else if (this.crapsTableActive) {
      this.comboText.setText('Craps table resolved. Start Fives to view combo payout previews.');
    } else {
      this.comboText.setText('Start Fives or Craps to roll dice.');
    }
    this.statusText.setText(crapsSummary
      ? `Craps: ${crapsSummary} • ${crapsChestText}`
      : (this.tableActive ? `Rolls left: ${this.rollsLeft}  •  Locked dice reroll cost: ${lockedCost} chips` : `CHIPS AVAILABLE: ${progress.chips}  •  Fives Roller: pay 10 chips. Craps: pay 2 chips, two dice, natural 7/11 wins.`));
    this.chestTexts.forEach((text, type) => text.setText(`${type}: ${progress.chests[type]}`));

    // Render Fives Gauge
    const currentGauge = progress.fivesGauge;
    const progressPct = Phaser.Math.Clamp(currentGauge / 1000, 0, 1);
    this.gaugeFill.width = progressPct * 400;

    if (currentGauge >= 1000) {
      this.gaugeFill.setFillStyle(0x27ae60, 0.9); // Green when ready
      this.gaugeText.setText(`READY! GUARANTEED 5-OF-A-KIND`);
      if (!this.tweens.isTweening(this.gaugeFill)) {
        this.gaugeFill.setAlpha(0.9);
        this.tweens.add({
          targets: this.gaugeFill,
          alpha: 0.5,
          duration: 600,
          yoyo: true,
          repeat: -1
        });
      }
    } else {
      this.gaugeFill.setFillStyle(0xf4b860, 0.85); // Gold
      this.gaugeText.setText(`${currentGauge} / 1000`);
      this.gaugeFill.setAlpha(0.85);
      this.tweens.killTweensOf(this.gaugeFill);
    }
  }

}
