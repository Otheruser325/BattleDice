import Phaser from 'phaser';
import { getAllDiceDefinitions, getPrimarySkill, getRangeLabel, getSelectedLoadout, setSelectedLoadout } from '../data/dice';
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
    const definitions = getAllDiceDefinitions(this);
    let loadout = getSelectedLoadout(this);
    this.debug.log('Dice scene rendered.', { diceCount: definitions.length });

    this.add.text(panel.x + 28, panel.y + 58, 'DICE TOKENS: 0 (WIP)  •  Click cards to assign selected slot', {
      fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.accentSoft
    });
    const slotText = this.add.text(panel.x + 28, panel.y + 78, `LOADOUT: ${loadout.join(' | ')}`, {
      fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.text
    });
    let selectedSlot = 0;
    this.add.text(panel.right - 28, panel.y + 78, 'Active slot: 1', { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.accent }).setOrigin(1, 0).setName('slot-indicator');

    definitions.forEach((die, index) => {
      const col = index % 3;
      const row = Math.floor(index / 3);
      const x = panel.x + 28 + col * 360;
      const y = panel.y + 88 + row * 210;
      const accent = Phaser.Display.Color.HexStringToColor(die.accent).color;

      const card = this.add.rectangle(x + 160, y + 84, 320, 176, 0x173247, 0.98).setInteractive({ useHandCursor: true })
        .setStrokeStyle(2, accent);
      this.add.rectangle(x + 160, y + 22, 320, 42, accent, 0.18);

      this.add.text(x + 20, y + 10, die.title.toUpperCase(), {
        fontFamily: 'Orbitron',
        fontSize: '20px',
        color: die.accent
      });

      this.add.text(x + 20, y + 52, `${die.rarity.toUpperCase()}  |  ATK ${die.attack}   |   HP ${die.health}   |   RANGE ${die.range} (${getRangeLabel(die.range)})`, {
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

      card.on('pointerdown', () => {
        loadout[selectedSlot] = die.typeId;
        setSelectedLoadout(this, loadout);
        slotText.setText(`LOADOUT: ${loadout.join(' | ')}`);
      });
      card.on('pointerover', () => card.setFillStyle(0x1f3e56, 1));
      card.on('pointerout', () => card.setFillStyle(0x173247, 0.98));
    });

    this.input.keyboard?.on('keydown-TAB', (event: KeyboardEvent) => {
      event.preventDefault();
      selectedSlot = (selectedSlot + 1) % 5;
      const indicator = this.children.getByName('slot-indicator') as Phaser.GameObjects.Text;
      indicator.setText(`Active slot: ${selectedSlot + 1}`);
    });
  }
}
