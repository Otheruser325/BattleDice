import Phaser from 'phaser';
import { DebugManager } from '../utils/DebugManager';
import { PALETTE, drawPanel } from '../ui/theme';

export class CasinoScene extends Phaser.Scene {
  static readonly KEY = 'CasinoScene';
  private readonly debug = DebugManager.attachScene(CasinoScene.KEY);

  constructor() {
    super(CasinoScene.KEY);
  }

  create() {
    this.debug.log('Casino scene rendered.');
    const panel = drawPanel(this, 'CASINO', 'WIP  |  side-mode rewards');

    this.add.rectangle(panel.centerX, panel.centerY - 24, 560, 240, 0x102434, 0.98)
      .setStrokeStyle(1, 0x406987);

    this.add.text(panel.centerX, panel.centerY - 74, 'High-risk side tables', {
      fontFamily: 'Orbitron',
      fontSize: '24px',
      color: PALETTE.accentSoft
    }).setOrigin(0.5);

    this.add.text(panel.centerX, panel.centerY - 6,
      'Future hooks:\nLucky roll contracts\nRoulette-style pip boosters\nShort PvE wagers for upgrade currency',
      {
        align: 'center',
        fontFamily: 'Orbitron',
        fontSize: '15px',
        color: PALETTE.textMuted,
        lineSpacing: 10
      }
    ).setOrigin(0.5);

    this.add.text(panel.centerX, panel.bottom - 52, 'Built to feed the main online autoroller loop without crowding the core menu.', {
      fontFamily: 'Orbitron',
      fontSize: '13px',
      color: PALETTE.textMuted
    }).setOrigin(0.5);
  }
}
