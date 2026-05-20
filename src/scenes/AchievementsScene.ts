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
    const panel = drawPanel(this, 'ACHIEVEMENTS', 'WIP  |  progression shell');

    const unlocked = AchievementStore.get(this).unlocked;
    const columns: Array<{ title: string; items: Array<{ id: AchievementId; label: string }> }> = [
      { title: 'Combat', items: [{ id: 'winner', label: 'Winner: Win your first match.' }, { id: 'veteran', label: 'Veteran: Win 10 matches.' }, { id: 'master', label: 'Master: Win 50 matches.' }, { id: 'lotta_damage', label: 'Lotta Damage: Deal over 200 damage to an enemy dice.' }] },
      { title: 'Time', items: [{ id: 'sweatin_it', label: "Sweatin' It: Play Battle Dice for 1 hour total." }, { id: 'cant_keep_up', label: "Can't Keep Up: Play Battle Dice for 12 hours total." }, { id: 'diceaholic', label: 'Diceaholic: Play Battle Dice for 24 hours total.' }, { id: 'darkest_hour', label: 'In Our Darkest Hour...: Obtain a Legendary Dice.' }] },
      { title: 'Casino', items: [{ id: 'vegas_boy', label: 'Vegas Boy: First time playing a casino table.' }, { id: 'gambolic', label: 'Gambolic: Play 10 casino tables total.' }, { id: 'risksino', label: 'Risksino: Play 50 casino tables total.' }, { id: 'jackpot', label: 'Jackpot: Roll a Five-of-a-kind in Fives/Combanity.' }] }
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
        const done = Boolean(unlocked[item.id]);
        this.add.text(x + 24, panel.y + 146 + itemIndex * 52, `${done ? '✓' : '•'} ${item.label}`, {
          fontFamily: 'Orbitron',
          fontSize: '12px',
          color: done ? PALETTE.success : PALETTE.textMuted,
          wordWrap: { width: 250 }
        });
      });
    });
  }
}
