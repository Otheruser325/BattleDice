import Phaser from 'phaser';
import { DebugManager } from '../utils/DebugManager';
import { PALETTE, drawPanel } from '../ui/theme';
import { SCENE_KEYS } from './sceneKeys';

export class AchievementsScene extends Phaser.Scene {
  static readonly KEY = SCENE_KEYS.Achievements;
  private readonly debug = DebugManager.attachScene(AchievementsScene.KEY);

  constructor() {
    super(AchievementsScene.KEY);
  }

  create() {
    this.debug.log('Achievements scene rendered.');
    const panel = drawPanel(this, 'ACHIEVEMENTS', 'WIP  |  progression shell');

    const columns = [
      {
        title: 'Combat',
        items: ['First chain lightning hit', 'Splash 3 enemies in one volley', 'Win a lane with a 1-pip die']
      },
      {
        title: 'Collection',
        items: ['Unlock a full seasonal loadout', 'Evolve every default die once', 'Discover a hidden arena skin']
      },
      {
        title: 'Online',
        items: ['Play your first live match', 'Hold five columns at once', 'Win three ranked duels in a row']
      }
    ];

    columns.forEach((column, index) => {
      const x = panel.x + 28 + index * 355;
      this.add.rectangle(x + 154, panel.y + 174, 300, 240, 0x102434, 0.97)
        .setStrokeStyle(1, 0x406987);
      this.add.text(x + 24, panel.y + 104, column.title.toUpperCase(), {
        fontFamily: 'Orbitron',
        fontSize: '18px',
        color: PALETTE.accentSoft
      });

      column.items.forEach((item, itemIndex) => {
        this.add.text(x + 24, panel.y + 146 + itemIndex * 42, `• ${item}`, {
          fontFamily: 'Orbitron',
          fontSize: '13px',
          color: PALETTE.textMuted,
          wordWrap: { width: 250 }
        });
      });
    });
  }
}
