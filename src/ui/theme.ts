import Phaser from 'phaser';

export const PALETTE = {
  ink: '#061018',
  navy: '#0e2030',
  panel: '#12293a',
  panelAlt: '#19374d',
  line: '#335770',
  accent: '#f4b860',
  accentSoft: '#ffd9a2',
  ice: '#8fd5ff',
  text: '#f9f4e3',
  textMuted: '#99b2c3',
  success: '#8ae0a1',
  danger: '#ff897d'
} as const;

export const MENU_TABS = [
  { label: 'Shop', sceneKey: 'ShopScene', status: 'Offers' },
  { label: 'Dice', sceneKey: 'DiceScene', status: 'Loadout' },
  { label: 'Arena', sceneKey: 'ArenaScene', status: 'Demo' },
  { label: 'Casino', sceneKey: 'CasinoScene', status: 'WIP' },
  { label: 'Achievements', sceneKey: 'AchievementsScene', status: 'WIP' }
] as const;

export function getLayout(scene: Phaser.Scene) {
  const { width, height } = scene.scale;
  const padding = 36;
  const dockHeight = 90;
  const headerHeight = 94;
  const content = new Phaser.Geom.Rectangle(
    padding,
    headerHeight,
    width - padding * 2,
    height - headerHeight - dockHeight - 18
  );

  return {
    width,
    height,
    content,
    dockY: height - 54,
    dockHeight
  };
}

export function drawPanel(scene: Phaser.Scene, title: string, subtitle: string) {
  const { content } = getLayout(scene);

  scene.add.rectangle(content.centerX, content.centerY, content.width, content.height, 0x102434, 0.9)
    .setStrokeStyle(2, 0x335770);

  scene.add.rectangle(content.centerX, content.y + 42, content.width - 24, 62, 0x102535, 0.94)
    .setStrokeStyle(1, 0x406987);

  scene.add.text(content.x + 28, content.y + 18, title, {
    fontFamily: 'Orbitron',
    fontSize: '28px',
    color: PALETTE.text
  });

  scene.add.text(content.right - 28, content.y + 24, subtitle, {
    fontFamily: 'Orbitron',
    fontSize: '12px',
    color: PALETTE.textMuted
  }).setOrigin(1, 0);

  return content;
}
