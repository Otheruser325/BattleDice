import Phaser from 'phaser';
import { DiceCatalogLoader } from '../data/DiceCatalogLoader';
import { PoolCatalogLoader } from '../data/PoolCatalogLoader';
import { SettingsStore } from '../systems/SettingsStore';
import { AlertManager } from '../utils/AlertManager';
import { AnimationManager } from '../utils/AnimationManager';
import { DebugManager } from '../utils/DebugManager';
import { AudioManager } from '../utils/AudioManager';
import { withBasePath } from '../utils/BuildEnv';
import { LoginManager } from '../utils/LoginManager';
import { SCENE_KEYS } from './sceneKeys';

const MENU_BACKGROUND_PATH = withBasePath('assets/images/bg/Background-floor.png');
const SETTINGS_ICON_PATH = withBasePath('assets/images/ui/settings.png');
const CHANGELOG_ICON_PATH = withBasePath('assets/images/ui/changelog.png');

export class BootScene extends Phaser.Scene {
  static readonly KEY = SCENE_KEYS.Boot;
  private readonly debug = DebugManager.attachScene(BootScene.KEY);
  private titleText!: Phaser.GameObjects.Text;
  private progressLabel!: Phaser.GameObjects.Text;
  private progressBar!: Phaser.GameObjects.Rectangle;
  private progressBox!: Phaser.GameObjects.Rectangle;

  constructor() {
    super(BootScene.KEY);
  }

  preload() {
    const { width, height } = this.scale;
    this.cameras.main.setBackgroundColor('#071018');

    this.debug.log('Preload started.');

    this.titleText = this.add.text(width / 2, height / 2 - 60, 'BATTLE DICE', {
      fontFamily: 'Orbitron',
      fontSize: '48px',
      color: '#f9f4e3'
    }).setOrigin(0.5);

    this.progressBox = this.add.rectangle(width / 2, height / 2 + 22, 360, 22, 0x112638, 0.95)
      .setStrokeStyle(1, 0x406987);
    this.progressBar = this.add.rectangle((width / 2) - 174, height / 2 + 22, 0, 12, 0xf4b860)
      .setOrigin(0, 0.5);
    this.progressLabel = this.add.text(width / 2, height / 2 + 58, 'Preparing autoroller prototype...', {
      fontFamily: 'Orbitron',
      fontSize: '14px',
      color: '#99b2c3'
    }).setOrigin(0.5);

    this.load.on('progress', (value: number) => {
      this.progressBar.width = Math.max(10, 348 * value);
    });

    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      this.debug.error('Preload file failed.', {
        key: file.key,
        type: file.type,
        src: file.src
      });
      this.progressLabel.setText(`Missing preload asset: ${file.key}`);
    });

    this.load.on('complete', () => {
      this.progressLabel.setText('Assets loaded. Fetching dice definitions...');
    });

    this.load.image('menu-bg', MENU_BACKGROUND_PATH);
    this.load.image('settings-icon', SETTINGS_ICON_PATH);
    this.load.image('changelog-icon', CHANGELOG_ICON_PATH);
    AudioManager.preload(this);
    for (let face = 1; face <= 6; face++) {
      const names = ['one', 'two', 'three', 'four', 'five', 'six'];
      this.load.image(`dice-face-${face}`, withBasePath(`assets/images/dice/dice-six-faces-${names[face - 1]}.png`));
    }
    DiceCatalogLoader.preloadFlags(this);
  }

  async create() {
    const settings = SettingsStore.get(this);
    DebugManager.setEnabled(settings.debugLogs);
    this.debug.log('Boot create started.');

    try {
      const [flags, poolFlags] = await Promise.all([
        DiceCatalogLoader.loadFetchableDefinitions(this),
        PoolCatalogLoader.loadDefinitions(this)
      ]);
      this.progressLabel.setText('Battle station ready.');
      this.debug.log('Dice and pool catalogs hydrated successfully.', {
        fetchableTypeIds: flags.fetchableTypeIds,
        typeIds: poolFlags.typeIds
      });

      LoginManager.present(this, () => {
        AnimationManager.fadeOut(
          this,
          [this.titleText, this.progressBar, this.progressBox, this.progressLabel],
          260,
          () => this.scene.start(SCENE_KEYS.Menu)
        );
      });
    } catch (error) {
      this.debug.error('Failed to load game catalogs.', error);
      this.progressLabel.setText('Game definitions failed to load.');
      AlertManager.show(this, {
        type: 'error',
        title: 'CATALOG LOAD FAILURE',
        message: 'The dice or pool definition catalogs could not be loaded. Check their Flags.json files and referenced type-id files.'
      });
    }
  }
}
