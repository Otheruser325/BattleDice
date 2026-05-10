import Phaser from 'phaser';
import { PALETTE, drawPanel } from '../ui/theme';
import { CasinoProgressStore, type FivesHandState } from '../systems/CasinoProgressStore';
import { evaluateFivesCombo, type ChestType } from '../systems/CasinoComboTypes';
import { AlertManager } from '../utils/AlertManager';
import { getAllDiceDefinitions, getDiceProgress, getDiceTokens, setDiceProgress, setDiceTokens } from '../data/dice';
import { SCENE_KEYS } from './sceneKeys';

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
    { rarity: 'Common', rate: 20, copies: [5, 25] },
    { rarity: 'Uncommon', rate: 35, copies: [5, 25] },
    { rarity: 'Rare', rate: 42, copies: [3, 10] },
    { rarity: 'Epic', rate: 3, copies: [1, 5] }
  ],
  Diamond: [
    { rarity: 'Uncommon', rate: 11, copies: [15, 75] },
    { rarity: 'Rare', rate: 33, copies: [10, 50] },
    { rarity: 'Epic', rate: 55, copies: [3, 10] },
    { rarity: 'Legendary', rate: 1, copies: [1, 3] }
  ],
  Master: [
    { rarity: 'Rare', rate: 20, copies: [100, 250] },
    { rarity: 'Epic', rate: 50, copies: [8, 40] },
    { rarity: 'Legendary', rate: 30, copies: [1, 5] }
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
  }

  private clearFivesHandRuntime() {
    this.tableActive = false;
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
    this.render();
  }

  private playCraps() {
    const progress = CasinoProgressStore.get(this);
    if (this.tableActive) return AlertManager.toast(this, { type: 'warning', message: 'Finish current table first.' });
    if (progress.chips < 2) return AlertManager.toast(this, { type: 'warning', message: 'Need 2 chips for Craps.' });
    CasinoProgressStore.mutate(this, (current) => ({
      ...current,
      chips: current.chips - 2,
      chests: { ...current.chests, Bronze: current.chests.Bronze + Phaser.Math.Between(1, 6) }
    }));
    this.render();
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
    const panel = this.add.rectangle(width / 2, height / 2, 620, 360, 0x153449, 0.97).setStrokeStyle(2, 0x4f7ea1);
    const title = this.add.text(width / 2, height / 2 - 140, `${type} Chest`, {
      fontFamily: 'Orbitron',
      fontSize: '24px',
      color: PALETTE.accent
    }).setOrigin(0.5);
    const chest = this.add.rectangle(width / 2, height / 2 - 30, 120, 90, 0x2f5f80, 0.95).setStrokeStyle(2, 0x8fd5ff);
    const count = this.add.text(width / 2, height / 2 + 32, `Available: ${amount}`, {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.textMuted
    }).setOrigin(0.5);

    const dropInfo = this.add.text(width / 2, height / 2 + 92, this.getChestDropRateText(type), {
      fontFamily: 'Orbitron',
      fontSize: '11px',
      color: PALETTE.success,
      align: 'center',
      backgroundColor: '#0d2231',
      padding: { left: 8, right: 8, top: 6, bottom: 6 }
    }).setOrigin(0.5).setVisible(false);
    const ratesBtn = this.add.text(width / 2 + 98, height / 2 - 144, '?', {
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

    const close = () => [overlay, panel, title, chest, count, dropInfo, ratesBtn, open, openAll, closeBtn].forEach((o) => o.destroy());
    const doOpen = (all: boolean) => {
      const latest = CasinoProgressStore.get(this).chests[type];
      const openCount = all ? latest : Math.min(1, latest);
      if (openCount <= 0) return AlertManager.toast(this, { type: 'warning', message: `No ${type} chests available.` });
      this.openChests(type, openCount, all);
      close();
    };

    const open = this.add.text(width / 2 - 90, height / 2 + 122, 'Open', {
      fontFamily: 'Orbitron',
      fontSize: '13px',
      color: '#dff4ff',
      backgroundColor: amount > 0 ? '#2878b8' : '#5d6770',
      padding: { left: 12, right: 12, top: 6, bottom: 6 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const openAll = this.add.text(width / 2 + 90, height / 2 + 122, 'Open All!', {
      fontFamily: 'Orbitron',
      fontSize: '13px',
      color: '#eaffea',
      backgroundColor: amount > 0 ? '#2c9b52' : '#5d6770',
      padding: { left: 12, right: 12, top: 6, bottom: 6 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const closeBtn = this.add.text(width / 2, height / 2 + 158, 'Close', {
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
    setDiceProgress(this, die.typeId, { classLevel: progress.classLevel, copies: progress.copies + copies });
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
    const tokenSummary = this.add.text(width / 2, height / 2 - 214, `+${diceTokens} Dice Tokens`, {
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

    const container = this.add.container(width / 2 - 430, height / 2 - 220);
    const mask = this.add.rectangle(width / 2 - 430, height / 2 - 220, 860, 460, 0xffffff, 0).setOrigin(0, 0).setVisible(false);
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

    const maxScroll = Math.max(0, Math.ceil(entries.length / 3) * 92 - 460);
    let offset = 0;
    const wheelHandler = (_pointer: Phaser.Input.Pointer, _go: Phaser.GameObjects.GameObject[], _dx: number, dy: number) => {
      if (!overlay.active) return;
      offset = Phaser.Math.Clamp(offset - dy * 0.4, -maxScroll, 0);
      container.y = (height / 2 - 220) + offset;
    };
    this.input.on('wheel', wheelHandler);

    const close = () => {
      this.input.off('wheel', wheelHandler);
      [overlay, panel, title, tokenSummary, closeBtn, container, mask].forEach((obj) => obj.destroy());
    };
    closeBtn.on('pointerdown', close);
    overlay.on('pointerdown', close);
  }

  private getDiceTextureKey(pip: number) {
    return `dice-face-${Phaser.Math.Clamp(Math.floor(pip), 1, 6)}`;
  }

  private render() {
    if (!this.scene.isActive(CasinoScene.KEY)) return;
    this.diceImages.forEach((image, i) => {
      if (image?.scene) image.setTexture(this.getDiceTextureKey(this.dice[i] ?? 1));
    });
    this.lockTexts.forEach((text, i) => {
      if (!text?.scene) return;
      text.setText(this.locks[i] ? 'LOCKED' : 'UNLOCK');
      text.setColor(this.locks[i] ? PALETTE.accentSoft : PALETTE.textMuted);
    });
    const progress = CasinoProgressStore.get(this);
    this.chipText.setText(`CHIPS: ${progress.chips}`);
    const currentCombo = evaluateFivesCombo(this.dice);
    this.comboText.setText(
      `Current Fives: ${currentCombo.combo} — ${currentCombo.layout} • ${currentCombo.chestType} x${currentCombo.chestCount} (sum ${currentCombo.pipSum})`
    );
    this.statusText.setText(this.tableActive ? `Rolls left: ${this.rollsLeft}` : `CHIPS AVAILABLE: ${progress.chips}  •  Fives Roller: pay 10 chips to start a 3-roll hand.`);
    this.chestTexts.forEach((text, type) => text.setText(`${type}: ${progress.chests[type]}`));
  }

}
