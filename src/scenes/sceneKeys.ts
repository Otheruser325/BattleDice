export const SCENE_KEYS = {
  Boot: 'BootScene',
  Shop: 'ShopScene',
  Dice: 'DiceScene',
  Arena: 'ArenaScene',
  Casino: 'CasinoScene',
  Achievements: 'AchievementsScene',
  Dev: 'DevScene',
  Menu: 'MenuScene',
  Settings: 'SettingsScene'
} as const;

export type SceneKey = (typeof SCENE_KEYS)[keyof typeof SCENE_KEYS];
