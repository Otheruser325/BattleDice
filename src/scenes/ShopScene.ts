import Phaser from 'phaser';
import { DebugManager } from '../utils/DebugManager';
import { PALETTE, drawPanel } from '../ui/theme';

export class ShopScene extends Phaser.Scene {
  static readonly KEY = 'ShopScene';
  private readonly debug = DebugManager.attachScene(ShopScene.KEY);

  constructor() {
    super(ShopScene.KEY);
  }

  create() {
    this.debug.log('Shop scene rendered.');
    const panel = drawPanel(this, 'SHOP', 'WIP  |  economy, skins, bundles');

    const cards = [
      ['Crates', 'Draft rare dice skins, particle traces and loadout flair.'],
      ['Boards', 'Alternate battleground themes for your 5x5 autoroller arena.'],
      ['Bundles', 'Starter packs for seasonal dice, emblems and casino tokens.']
    ];

    cards.forEach(([title, body], index) => {
      const x = panel.x + 34 + index * 350;
      this.add.rectangle(x + 150, panel.y + 168, 286, 168, 0x102434, 0.98)
        .setStrokeStyle(1, 0x406987);
      this.add.text(x + 24, panel.y + 110, title.toUpperCase(), {
        fontFamily: 'Orbitron',
        fontSize: '20px',
        color: PALETTE.accentSoft
      });
      this.add.text(x + 24, panel.y + 148, body, {
        fontFamily: 'Orbitron',
        fontSize: '13px',
        color: PALETTE.textMuted,
        wordWrap: { width: 238 }
      });
    });

    this.add.text(panel.centerX, panel.bottom - 52, 'Store items are queued behind the combat foundation and online loop.', {
      fontFamily: 'Orbitron',
      fontSize: '13px',
      color: PALETTE.textMuted
    }).setOrigin(0.5);
  }
}
