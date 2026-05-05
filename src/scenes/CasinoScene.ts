import Phaser from 'phaser';
import { PALETTE, drawPanel } from '../ui/theme';
import { CasinoProgressStore } from '../systems/CasinoProgressStore';
import { evaluateFivesCombo, type ChestType } from '../systems/CasinoComboTypes';
import { AlertManager } from '../utils/AlertManager';
import { getAllDiceDefinitions, getDiceProgress, setDiceProgress } from '../data/dice';
import { SCENE_KEYS } from './sceneKeys';

interface ChestRewardEntry {
  typeId: string;
  title: string;
  rarity: string;
  copies: number;
  isNew: boolean;
}

const CHEST_TYPES: ChestType[] = ['Bronze', 'Silver', 'Gold', 'Diamond', 'Master'];
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
  private statusText!: Phaser.GameObjects.Text;

  create() {
    this.resetRuntimeUiState();

    const panel = drawPanel(this, 'CASINO', 'TABLES + CHESTS');
    this.add.rectangle(panel.centerX, panel.centerY - 10, 780, 360, 0x173247, 0.92)
      .setStrokeStyle(1, 0x4f7ea1);

    this.chipText = this.add.text(panel.centerX, panel.y + 62, '', {
      fontFamily: 'Orbitron',
      fontSize: '15px',
      color: PALETTE.accentSoft
    }).setOrigin(0.5);

    this.statusText = this.add.text(panel.centerX, panel.y + 88, '', {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.textMuted
    }).setOrigin(0.5);

    this.drawDiceRow(panel.centerX, panel.centerY - 72);
    this.drawButtons(panel.centerX, panel.centerY + 4);
    this.drawChestSidebar(panel.right - 145, panel.y + 112);
    this.render();
  }


  private resetRuntimeUiState() {
    this.diceImages = [];
    this.lockTexts = [];
    this.chestTexts.clear();
    this.tableActive = false;
    this.rollsLeft = 3;
    this.locks = [false, false, false, false, false];
    this.dice = [1, 1, 1, 1, 1];
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

    CasinoProgressStore.mutate(this, (current) => ({ ...current, chips: current.chips - 10 }));
    this.dice = [1, 1, 1, 1, 1];
    this.locks = [false, false, false, false, false];
    this.rollsLeft = 3;
    this.tableActive = true;
    this.rollDice();
    this.render();
  }

  private rollDice() {
    if (!this.tableActive || this.rollsLeft <= 0) return;
    this.dice = this.dice.map((pip, i) => (this.locks[i] ? pip : Phaser.Math.Between(1, 6)));
    this.rollsLeft -= 1;
    this.render();
  }

  private cashOut() {
    if (!this.tableActive || this.rollsLeft === 3) return;
    const payout = evaluateFivesCombo(this.dice);
    CasinoProgressStore.mutate(this, (current) => ({
      ...current,
      chests: { ...current.chests, [payout.chestType]: current.chests[payout.chestType] + payout.chestCount }
    }));
    this.tableActive = false;
    this.rollsLeft = 3;
    this.locks = [false, false, false, false, false];
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

  private openChestModal(type: ChestType) {
    const amount = CasinoProgressStore.get(this).chests[type];
    const { width, height } = this.scale;
    const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.55).setInteractive();
    const panel = this.add.rectangle(width / 2, height / 2, 560, 320, 0x153449, 0.97).setStrokeStyle(2, 0x4f7ea1);
    const title = this.add.text(width / 2, height / 2 - 120, `${type} Chest`, {
      fontFamily: 'Orbitron',
      fontSize: '24px',
      color: PALETTE.accent
    }).setOrigin(0.5);
    const chest = this.add.rectangle(width / 2, height / 2 - 20, 120, 90, 0x2f5f80, 0.95).setStrokeStyle(2, 0x8fd5ff);
    const count = this.add.text(width / 2, height / 2 + 42, `Available: ${amount}`, {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.textMuted
    }).setOrigin(0.5);

    const close = () => [overlay, panel, title, chest, count, open, openAll, closeBtn].forEach((o) => o.destroy());
    const doOpen = (all: boolean) => {
      const latest = CasinoProgressStore.get(this).chests[type];
      const openCount = all ? latest : Math.min(1, latest);
      if (openCount <= 0) return AlertManager.toast(this, { type: 'warning', message: `No ${type} chests available.` });
      this.openChests(type, openCount, all);
      close();
    };

    const open = this.add.text(width / 2 - 90, height / 2 + 92, 'Open', {
      fontFamily: 'Orbitron',
      fontSize: '13px',
      color: '#dff4ff',
      backgroundColor: amount > 0 ? '#2878b8' : '#5d6770',
      padding: { left: 12, right: 12, top: 6, bottom: 6 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const openAll = this.add.text(width / 2 + 90, height / 2 + 92, 'Open All!', {
      fontFamily: 'Orbitron',
      fontSize: '13px',
      color: '#eaffea',
      backgroundColor: amount > 0 ? '#2c9b52' : '#5d6770',
      padding: { left: 12, right: 12, top: 6, bottom: 6 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const closeBtn = this.add.text(width / 2, height / 2 + 130, 'Close', {
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
    const merged = new Map<string, ChestRewardEntry>();
    for (let i = 0; i < openCount; i++) {
      const reward = this.rollChestReward(type);
      if (!reward) continue;
      const current = merged.get(reward.typeId);
      merged.set(reward.typeId, current
        ? { ...current, copies: current.copies + reward.copies, isNew: current.isNew || reward.isNew }
        : reward);
    }

    const entries = [...merged.values()].sort((a, b) => (
      RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity] || a.title.localeCompare(b.title)
    ));
    const burst = this.add.rectangle(this.scale.width / 2, this.scale.height / 2, 120, 90, 0x8fd5ff, 0.25)
      .setStrokeStyle(2, 0xffffff)
      .setDepth(9999);
    this.tweens.add({ targets: burst, scale: isAll ? 4 : 2, alpha: 0, duration: isAll ? 520 : 320, onComplete: () => burst.destroy() });
    this.showRewardsModal(type, entries);
    this.render();
  }

  private rollChestReward(type: ChestType): ChestRewardEntry | null {
    const defs = getAllDiceDefinitions(this);
    const byRarity = (rarity: string) => defs.filter((definition) => definition.rarity === rarity);
    const pick = (pool: typeof defs) => (pool.length ? pool[Math.floor(Math.random() * pool.length)] : null);
    const r = Math.random() * 100;

    let rarity: 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' = 'Common';
    if (type === 'Bronze') rarity = r < 95 ? 'Common' : 'Uncommon';
    if (type === 'Silver') rarity = r < 40 ? 'Common' : (r < 90 ? 'Uncommon' : 'Rare');
    if (type === 'Gold') rarity = r < 20 ? 'Common' : (r < 55 ? 'Uncommon' : (r < 97 ? 'Rare' : 'Epic'));
    if (type === 'Diamond') rarity = r < 11 ? 'Uncommon' : (r < 44 ? 'Rare' : (r < 99 ? 'Epic' : 'Legendary'));
    if (type === 'Master') rarity = r < 20 ? 'Rare' : (r < 70 ? 'Epic' : 'Legendary');

    const die = pick(byRarity(rarity));
    if (!die) return null;

    let copies = 1;
    if (type === 'Bronze') copies = Phaser.Math.Between(1, 5);
    if (type === 'Silver') copies = rarity === 'Rare' ? Phaser.Math.Between(1, 5) : Phaser.Math.Between(3, 10);
    if (type === 'Gold') copies = rarity === 'Rare' ? Phaser.Math.Between(3, 10) : rarity === 'Epic' ? Phaser.Math.Between(1, 5) : Phaser.Math.Between(5, 25);
    if (type === 'Diamond') copies = rarity === 'Rare' ? Phaser.Math.Between(10, 50) : rarity === 'Epic' ? Phaser.Math.Between(3, 10) : rarity === 'Legendary' ? Phaser.Math.Between(1, 3) : Phaser.Math.Between(15, 75);
    if (type === 'Master') copies = rarity === 'Epic' ? Phaser.Math.Between(8, 40) : rarity === 'Legendary' ? Phaser.Math.Between(1, 5) : Phaser.Math.Between(100, 250);

    const progress = getDiceProgress(this, die.typeId);
    const isNew = progress.copies <= 0;
    setDiceProgress(this, die.typeId, { classLevel: progress.classLevel, copies: progress.copies + copies });
    return { typeId: die.typeId, title: die.title, rarity: die.rarity, copies, isNew };
  }

  private showRewardsModal(type: ChestType, entries: ChestRewardEntry[]) {
    const { width, height } = this.scale;
    const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.58).setInteractive();
    const panel = this.add.rectangle(width / 2, height / 2, 930, 560, 0x153449, 0.98).setStrokeStyle(2, 0x4f7ea1);
    const title = this.add.text(width / 2, height / 2 - 250, `${type} Rewards`, {
      fontFamily: 'Orbitron',
      fontSize: '28px',
      color: PALETTE.accent
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
      [overlay, panel, title, closeBtn, container, mask].forEach((obj) => obj.destroy());
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
    this.statusText.setText(this.tableActive ? `Rolls left: ${this.rollsLeft}` : 'Fives Roller: pay 10 chips to start a 3-roll hand.');
    this.chestTexts.forEach((text, type) => text.setText(`${type}: ${progress.chests[type]}`));
  }

}
