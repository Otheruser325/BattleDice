import Phaser from 'phaser';
import { getDiceDefinitions, getPrimarySkill } from '../data/dice';
import { DebugManager } from '../utils/DebugManager';
import { PALETTE, drawPanel } from '../ui/theme';

export class DiceScene extends Phaser.Scene {
  static readonly KEY = 'DiceScene';
  private readonly debug = DebugManager.attachScene(DiceScene.KEY);

  constructor() {
    super(DiceScene.KEY);
  }

  create() {
    const panel = drawPanel(this, 'DICE', 'Default loadout  |  five starter autorollers');
    const definitions = getDiceDefinitions(this);
    this.debug.log('Dice scene rendered.', { diceCount: definitions.length });

    definitions.forEach((die, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const x = panel.x + 28 + col * 360;
      const y = panel.y + 88 + row * 210;
      const accent = Phaser.Display.Color.HexStringToColor(die.accent).color;

      this.add.rectangle(x + 160, y + 84, 320, 176, 0x102434, 0.98)
        .setStrokeStyle(2, accent);
      this.add.rectangle(x + 160, y + 22, 320, 42, accent, 0.18);

      this.add.text(x + 20, y + 10, die.title.toUpperCase(), {
        fontFamily: 'Orbitron',
        fontSize: '20px',
        color: die.accent
      });

      this.add.text(x + 20, y + 52, `ATK ${die.attack}   |   HP ${die.health}   |   RANGE ${die.range} (${die.rangeLabel})`, {
        fontFamily: 'Orbitron',
        fontSize: '12px',
        color: PALETTE.text
      });

      const primarySkill = getPrimarySkill(die);
      const manaLine = primarySkill?.type === 'Active' && primarySkill.manaNeeded
        ? `Mana ${primarySkill.manaNeeded}`
        : 'Passive ready';
      this.add.text(x + 20, y + 78, `${primarySkill?.type.toUpperCase() ?? 'PASSIVE'}  |  ${manaLine}`, {
        fontFamily: 'Orbitron',
        fontSize: '12px',
        color: PALETTE.accentSoft
      });

      this.add.text(x + 20, y + 106, primarySkill?.title ?? 'No skill', {
        fontFamily: 'Orbitron',
        fontSize: '14px',
        color: PALETTE.text
      });

      this.add.text(x + 20, y + 130, primarySkill?.description ?? '', {
        fontFamily: 'Orbitron',
        fontSize: '12px',
        color: PALETTE.textMuted,
        wordWrap: { width: 280 }
      });
    });
  }
}
