import Phaser from 'phaser';
import { PALETTE, drawPanel } from '../ui/theme';
import { CasinoProgressStore, type FivesHandState } from '../systems/CasinoProgressStore';
import { evaluateFivesCombo, type ChestType } from '../systems/CasinoComboTypes';
import { AlertManager } from '../utils/AlertManager';
import { getAllDiceDefinitions, getDiceProgress, getDiceTokens, grantDiceCopies, setDiceTokens } from '../data/dice';
import { SCENE_KEYS } from './sceneKeys';
import { AudioManager } from '../utils/AudioManager';

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

type RewardRarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary';

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

const RARITY_RANK: Record<string, number> = { Common: 0, Uncommon: 1, Rare: 2, Epic: 3, Legendary: 4 };

export class CasinoScene extends Phaser.Scene {
  static readonly KEY = SCENE_KEYS.Casino;

  constructor() {
    super(CasinoScene.KEY);
  }

  private dice: number[] = [1, 1, 1, 1, 1];
  private locks: boolean[] = [false, false, false, false, false];
  private rollsLeft = 3;
  private tableActive = false;
  private crapsTableActive = false;

  private diceImages: Phaser.GameObjects.Image[] = [];
  private lockTexts: Phaser.GameObjects.Text[] = [];
  private chestTexts = new Map<ChestType, Phaser.GameObjects.Text>();
  private chipText!: Phaser.GameObjects.Text;
  private comboText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;

  create() {
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

    this.statusText = this.add.text(panel.centerX, panel.y + 88, '', {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.textMuted
    }).setOrigin(0.5);

    this.drawDiceRow(panel.centerX, panel.centerY - 72);

    this.comboText = this.add.text(panel.centerX, panel.centerY - 18, '', {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.success,
      align: 'center'
    }).setOrigin(0.5);

    this.drawButtons(panel.centerX, panel.centerY + 18);
    this.drawChestSidebar(panel.right - 145, panel.y + 112);
    this.render();
  }


  private resetRuntimeUiState() {
    this.diceImages = [];
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
        .setDisplaySize(42, 42);
      const lock = this.add.text(x, y + 22, 'UNLOCK', {
        fontFamily: 'Orbitron',
        fontSize: '9px',
        color: PALETTE.textMuted,
        backgroundColor: '#173247',
        padding: { left: 4, right: 4, top: 2, bottom: 2 }
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });

      lock.on('pointerdown', () => {
        if (!this.tableActive || this.rollsLeft >= 3 || this.rollsLeft <= 0) return;
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
    };

    makeButton(cx - 180, 'START FIVES (10)', () => this.startFives());
    makeButton(cx - 40, 'ROLL', () => this.rollDice());
    makeButton(cx + 70, 'CASH OUT', () => this.cashOut());
    makeButton(cx + 190, 'CRAPS (2)', () => this.playCraps());
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
    this.rollDice();
    this.render();
  }

  private rollDice() {
    if (!this.tableActive || this.rollsLeft <= 0) return;
    this.dice = this.dice.map((pip, i) => (this.locks[i] ? pip : Phaser.Math.Between(1, 6)));
    this.rollsLeft -= 1;
    this.saveFivesHand();
    this.render();
  }

  private cashOut() {
    if (!this.tableActive || this.rollsLeft === 3) return;
    const payout = evaluateFivesCombo(this.dice);
    CasinoProgressStore.mutate(this, (current) => ({
      ...current,
      chests: { ...current.chests, [payout.chestType]: current.chests[payout.chestType] + payout.chestCount }
    }));
    this.clearFivesHandRuntime();
    this.clearSavedFivesHand();
    this.crapsTableActive = false;
    this.render();
  }

  private playCraps() {
    const progress = CasinoProgressStore.get(this);
    if (this.tableActive) return AlertManager.toast(this, { type: 'warning', message: 'Finish current table first.' });
    if (progress.chips < 2) return AlertManager.toast(this, { type: 'warning', message: 'Need 2 chips for Craps.' });

    const outcome = this.resolveCrapsRound();
    this.crapsTableActive = true;
    this.dice = [outcome.finalRoll[0], outcome.finalRoll[1], 1, 1, 1];
    this.locks = [true, true, false, false, false];

    CasinoProgressStore.mutate(this, (current) => ({
      ...current,
      chips: current.chips - 2,
      chests: outcome.chestType
        ? { ...current.chests, [outcome.chestType]: current.chests[outcome.chestType] + outcome.chestCount }
        : current.chests
    }));

    const chestText = outcome.chestType ? `${outcome.chestType} x${outcome.chestCount}` : 'no chest';
    this.statusText.setText(`Craps: ${outcome.summary} • ${chestText}`);
    this.render(outcome.summary, chestText);
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

    const escHandler = () => close();
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
    const tokenRange = CHEST_TOKEN_REWARDS[type];
    let diceTokens = 0;

    for (let i = 0; i < openCount; i++) {
      diceTokens += Phaser.Math.Between(tokenRange[0], tokenRange[1]);
      const reward = this.rollChestReward(type);
      if (!reward) continue;

      const current = merged.get(reward.typeId);
      merged.set(reward.typeId, current
        ? { ...current, copies: current.copies + reward.copies, isNew: current.isNew || reward.isNew }
        : reward);
    }

    setDiceTokens(this, getDiceTokens(this) + diceTokens);

    return { entries: [...merged.values()], diceTokens };
  }

  private rollChestReward(type: ChestType): ChestRewardEntry | null {
    const defs = getAllDiceDefinitions(this);
    const byRarity = (rarity: string) => defs.filter((definition) => definition.rarity === rarity);
    const pick = (pool: typeof defs) => (pool.length ? pool[Math.floor(Math.random() * pool.length)] : null);
    const table = CHEST_DROP_RATES[type];
    const roll = Math.random() * 100;
    let cumulative = 0;
    const selected = table.find((entry) => {
      cumulative += entry.rate;
      return roll < cumulative;
    }) ?? table[table.length - 1];

    const die = pick(byRarity(selected.rarity));
    if (!die) return null;

    const copies = Phaser.Math.Between(selected.copies[0], selected.copies[1]);

    const progress = getDiceProgress(this, die.typeId);
    const isNew = progress.copies <= 0;
    grantDiceCopies(this, die.typeId, copies);
    return { typeId: die.typeId, title: die.title, rarity: die.rarity, copies, isNew };
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

    entries.forEach((entry, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = col * 280;
      const y = row * 92;
      const card = this.add.rectangle(x + 132, y + 38, 264, 76, 0x204d6a, 0.95).setStrokeStyle(1, 0x4f7ea1);
      const txt = this.add.text(x + 12, y + 10, `${entry.title} [${entry.rarity}]\n+${entry.copies} copies${entry.isNew ? '  NEW' : ''}`, {
        fontFamily: 'Orbitron',
        fontSize: '12px',
        color: PALETTE.text,
        lineSpacing: 4
      });
      container.add([card, txt]);
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

    const escHandler = () => close();
    this.input.keyboard?.on('keydown-ESC', escHandler);
    const close = () => {
      this.input.off('wheel', wheelHandler);
      this.input.keyboard?.off('keydown-ESC', escHandler);
      [overlay, panel, title, tokenSummary, closeBtn, container, mask].forEach((obj) => obj.destroy());
    };
    closeBtn.on('pointerdown', close);
    overlay.on('pointerdown', close);
  }

  private getDiceTextureKey(pip: number) {
    return `dice-face-${Phaser.Math.Clamp(Math.floor(pip), 1, 6)}`;
  }

  private render(crapsSummary?: string, crapsChestText?: string) {
    if (!this.scene.isActive(CasinoScene.KEY)) return;
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
      : (this.tableActive ? `Rolls left: ${this.rollsLeft}` : `CHIPS AVAILABLE: ${progress.chips}  •  Fives Roller: pay 10 chips. Craps: pay 2 chips, two dice, natural 7/11 wins.`));
    this.chestTexts.forEach((text, type) => text.setText(`${type}: ${progress.chests[type]}`));
  }

}
