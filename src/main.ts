import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { SettingsScene } from './scenes/SettingsScene';
import { ShopScene } from './scenes/ShopScene';
import { DiceScene } from './scenes/DiceScene';
import { ArenaScene } from './scenes/ArenaScene';
import { CasinoScene } from './scenes/CasinoScene';
import { AchievementsScene } from './scenes/AchievementsScene';
import { DevScene } from './scenes/DevScene';
import { DebugManager } from './utils/DebugManager';

DebugManager.installGlobalHooks();

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game-container',
  width: 1280,
  height: 720,
  backgroundColor: '#071018',
  scene: [
    BootScene,
    ShopScene,
    DiceScene,
    ArenaScene,
    CasinoScene,
    AchievementsScene,
    DevScene,
    MenuScene,
    SettingsScene
  ],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  fps: {
    target: 60,
    forceSetTimeOut: true
  }
};

new Phaser.Game(config);
