import Phaser from 'phaser';
import { DebugManager } from '../utils/DebugManager';
import { PALETTE, drawPanel } from '../ui/theme';
import { CasinoProgressStore } from '../systems/CasinoProgressStore';
import { evaluateFivesCombo, type ChestType } from '../systems/CasinoComboTypes';
import { AlertManager } from '../utils/AlertManager';

export class CasinoScene extends Phaser.Scene {
  static readonly KEY = 'CasinoScene';
  private readonly debug = DebugManager.attachScene(CasinoScene.KEY);

  private dice: number[] = [1, 1, 1, 1, 1];
  private locks: boolean[] = [false, false, false, false, false];
  private rollsLeft = 3;
  private diceTexts: Phaser.GameObjects.Text[] = [];
  private chestTexts = new Map<ChestType, Phaser.GameObjects.Text>();
  private statusText!: Phaser.GameObjects.Text;
  private shiftKey: Phaser.Input.Keyboard.Key | null = null;

  create() {
    const panel = drawPanel(this, 'CASINO', 'TABLES + CHESTS');
    this.add.rectangle(panel.centerX, panel.centerY - 10, 780, 360, 0x173247, 0.92).setStrokeStyle(1, 0x4f7ea1);
    this.statusText = this.add.text(panel.centerX, panel.y + 88, 'Fives Roller: pay 10 chips to start a 3-roll hand.', { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.textMuted }).setOrigin(0.5);

    this.drawDiceRow(panel.centerX, panel.centerY - 72);
    this.drawButtons(panel.centerX, panel.centerY + 4);
    this.drawChestSidebar(panel.right - 135, panel.y + 116);
    this.shiftKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT) ?? null;
    this.render();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.shiftKey = null;
      this.diceTexts = [];
      this.chestTexts.clear();
    });
    this.debug.log('Casino scene ready');
  }

  private drawDiceRow(cx: number, y: number) {
    for (let i = 0; i < 5; i++) {
      const x = cx - 160 + i * 80;
      this.add.rectangle(x, y, 62, 62, 0x183447, 1).setStrokeStyle(1, 0x3a6688);
      const die = this.add.text(x, y - 8, '1', { fontFamily: 'Orbitron', fontSize: '28px', color: PALETTE.text }).setOrigin(0.5);
      const lock = this.add.text(x, y + 22, 'UNLOCK', { fontFamily: 'Orbitron', fontSize: '9px', color: PALETTE.textMuted, backgroundColor: '#173247', padding: { left: 4, right: 4, top: 2, bottom: 2 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      lock.on('pointerdown', () => {
        if (this.rollsLeft >= 3 || this.rollsLeft <= 0) return;
        this.locks[i] = !this.locks[i];
        lock.setText(this.locks[i] ? 'LOCKED' : 'UNLOCK');
      });
      this.diceTexts.push(die);
    }
  }

  private drawButtons(cx: number, y: number) {
    const makeBtn = (x: number, btnY: number, label: string, fn: () => void) => {
      const t = this.add.text(x, btnY, label, { fontFamily: 'Orbitron', fontSize: '12px', color: '#000000', backgroundColor: '#f4b860', padding: { left: 10, right: 10, top: 6, bottom: 6 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      t.on('pointerdown', fn);
    };

    makeBtn(cx - 180, y, 'START FIVES (10)', () => this.startFives());
    makeBtn(cx - 40, y, 'ROLL', () => this.rollDice());
    makeBtn(cx + 70, y, 'CASH OUT', () => this.cashOut());
    makeBtn(cx + 190, y, 'CRAPS (2)', () => this.playCraps());
  }

  private drawChestSidebar(x: number, y: number) {
    this.add.text(x, y - 32, 'CHESTS', { fontFamily: 'Orbitron', fontSize: '14px', color: PALETTE.accent }).setOrigin(0.5);
    (['Bronze', 'Silver', 'Gold', 'Diamond', 'Master'] as ChestType[]).forEach((type, idx) => {
      const btn = this.add.text(x, y + idx * 42, `${type}: 0`, { fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.text, backgroundColor: '#173247', padding: { left: 8, right: 8, top: 5, bottom: 5 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => this.openChest(type));
      this.chestTexts.set(type, btn);
    });
  }

  private startFives() {
    const p = CasinoProgressStore.get(this);
    if (p.chips < 10) return AlertManager.toast(this, { type: 'warning', message: 'Need 10 chips for Fives.' });
    CasinoProgressStore.mutate(this, (curr) => ({ ...curr, chips: curr.chips - 10 }));
    this.rollsLeft = 3;
    this.locks = [false, false, false, false, false];
    this.statusText.setText('Fives started. Roll 1 is free; lock dice on rolls 2 and 3.');
    this.rollDice();
    this.render();
  }

  private rollDice() {
    if (this.rollsLeft <= 0) return;
    this.dice = this.dice.map((value, i) => (this.locks[i] ? value : Phaser.Math.Between(1, 6)));
    this.rollsLeft -= 1;
    this.render();
  }

  private cashOut() {
    if (this.rollsLeft === 3) return;
    const payout = evaluateFivesCombo(this.dice);
    CasinoProgressStore.mutate(this, (curr) => ({
      ...curr,
      chests: { ...curr.chests, [payout.chestType]: curr.chests[payout.chestType] + payout.chestCount }
    }));
    this.statusText.setText(`${payout.combo}: +${payout.chestCount} ${payout.chestType} chests (pip total ${payout.pipSum})`);
    this.rollsLeft = 3;
    this.locks = [false, false, false, false, false];
    this.render();
  }

  private playCraps() {
    const p = CasinoProgressStore.get(this);
    if (p.chips < 2) return AlertManager.toast(this, { type: 'warning', message: 'Need 2 chips for Craps.' });
    CasinoProgressStore.mutate(this, (curr) => ({ ...curr, chips: curr.chips - 2, chests: { ...curr.chests, Bronze: curr.chests.Bronze + Phaser.Math.Between(1, 6) } }));
    this.statusText.setText('Craps table paid out Bronze chests.');
    this.render();
  }

  private openChest(type: ChestType) {
    const curr = CasinoProgressStore.get(this).chests[type];
    if (curr <= 0) return AlertManager.toast(this, { type: 'warning', message: `No ${type} chests available.` });
    const openCount = this.shiftKey?.isDown ? curr : 1;
    CasinoProgressStore.mutate(this, (p) => ({ ...p, chests: { ...p.chests, [type]: Math.max(0, p.chests[type] - openCount) } }));
    AlertManager.toast(this, { type: 'success', message: `Opened ${openCount} ${type} chest${openCount > 1 ? 's' : ''}.` });
    this.render();
  }

  private render() {
    this.diceTexts.forEach((t, i) => t.setText(String(this.dice[i])));
    const progress = CasinoProgressStore.get(this);
    this.chestTexts.forEach((t, type) => t.setText(`${type}: ${progress.chests[type]}`));
  }
}
