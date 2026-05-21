import Phaser from 'phaser';
import { DebugManager } from '../utils/DebugManager';
import { PALETTE, drawPanel } from '../ui/theme';
import { SCENE_KEYS } from './sceneKeys';
import { AchievementStore, type AchievementId } from '../systems/AchievementStore';

export class AchievementsScene extends Phaser.Scene {
  static readonly KEY = SCENE_KEYS.Achievements;
  private readonly debug = DebugManager.attachScene(AchievementsScene.KEY);

  constructor() {
    super(AchievementsScene.KEY);
  }

  create() {
    this.debug.log('Achievements scene rendered.');
    const panel = drawPanel(this, 'ACHIEVEMENTS', 'FLEX  |  progression shell');

    const unlocked = AchievementStore.get(this).unlocked;
    const columns: Array<{ title: string; items: Array<{ id: AchievementId; label: string }> }> = [
      { title: 'Combat', items: [{ id: 'winner', label: 'Winner: Win your first match.' }, { id: 'veteran', label: 'Veteran: Win 10 matches.' }, { id: 'master', label: 'Master: Win 50 matches.' }, { id: 'lotta_damage', label: 'Lotta Damage: Deal over 200 damage to an enemy dice.' }] },
      { title: 'Time', items: [{ id: 'sweatin_it', label: "Sweatin' It: Play Battle Dice for 1 hour total." }, { id: 'cant_keep_up', label: "Can't Keep Up: Play Battle Dice for 12 hours total." }, { id: 'diceaholic', label: 'Diceaholic: Play Battle Dice for 24 hours total.' }, { id: 'darkest_hour', label: 'In Our Darkest Hour...: Obtain a Legendary Dice.' }] },
      { title: 'Casino', items: [{ id: 'vegas_boy', label: 'Vegas Boy: First time playing a casino table.' }, { id: 'gambolic', label: 'Gambolic: Play 10 casino tables total.' }, { id: 'risksino', label: 'Risksino: Play 50 casino tables total.' }, { id: 'jackpot', label: 'Jackpot: Roll a Five-of-a-kind in Fives/Combanity.' }] }
    ];

    const allItems = columns.flatMap((col) => col.items);
    const unlockedCount = allItems.filter((item) => Boolean(unlocked[item.id])).length;
    this.add.text(panel.right - 24, panel.y + 70, `UNLOCKED: ${unlockedCount}/${allItems.length}`, {
      fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.accentSoft
    }).setOrigin(1, 0);

    const content = this.add.container(0, 0);
    columns.forEach((column, index) => {
      const x = panel.x + 28 + index * 355;
      const card = this.add.rectangle(x + 154, panel.y + 174, 300, 520, 0x102434, 0.97)
        .setStrokeStyle(1, 0x406987);
      const title = this.add.text(x + 24, panel.y + 104, column.title.toUpperCase(), {
        fontFamily: 'Orbitron',
        fontSize: '18px',
        color: PALETTE.accentSoft
      });
      content.add([card, title]);

      column.items.forEach((item, itemIndex) => {
        const done = Boolean(unlocked[item.id]);
        const text = this.add.text(x + 24, panel.y + 146 + itemIndex * 52, `${done ? '✓' : '•'} ${item.label}`, {
          fontFamily: 'Orbitron',
          fontSize: '12px',
          color: done ? PALETTE.success : PALETTE.textMuted,
          wordWrap: { width: 250 }
        });
        content.add(text);
      });
    });

    const viewTop = panel.y + 96;
    const viewHeight = panel.height - 150;
    const viewLeft = panel.x + 16;
    const viewWidth = panel.width - 32;
    const maskRect = this.add.rectangle(viewLeft, viewTop, viewWidth, viewHeight, 0xffffff, 0).setOrigin(0, 0).setVisible(false);
    content.setMask(maskRect.createGeometryMask());
    const maxScroll = 120;
    let scroll = 0;
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _gos: Phaser.GameObjects.GameObject[], _dx: number, dy: number) => {
      const within = pointer.worldX >= viewLeft && pointer.worldX <= viewLeft + viewWidth && pointer.worldY >= viewTop && pointer.worldY <= viewTop + viewHeight;
      if (!within) return;
      scroll = Phaser.Math.Clamp(scroll - dy * 0.35, -maxScroll, 0);
      content.y = scroll;
    });
  }
}
