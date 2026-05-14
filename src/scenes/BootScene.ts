import Phaser from 'phaser';
import { DiceCatalogLoader } from '../data/DiceCatalogLoader';
import { SettingsStore } from '../systems/SettingsStore';
import { AlertManager } from '../utils/AlertManager';
import { AnimationManager } from '../utils/AnimationManager';
import { DebugManager } from '../utils/DebugManager';
import { AudioManager } from '../utils/AudioManager';
import { SCENE_KEYS } from './sceneKeys';

const MENU_BACKGROUND_PATH = '/assets/images/bg/Background-floor.png';
const SETTINGS_ICON_PATH = '/assets/images/ui/settings.png';
const CHANGELOG_ICON_PATH = '/assets/images/ui/changelog.png';

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
      this.load.image(`dice-face-${face}`, `/assets/images/dice/dice-six-faces-${names[face - 1]}.png`);
    }
    DiceCatalogLoader.preloadFlags(this);
  }

  async create() {
    SettingsStore.get(this);
    this.debug.log('Boot create started.');

    try {
      const flags = await DiceCatalogLoader.loadFetchableDefinitions(this);
      this.progressLabel.setText('Battle station ready.');
      this.debug.log('Dice catalog hydrated successfully.', {
        fetchableTypeIds: flags.fetchableTypeIds
      });

      AnimationManager.fadeOut(
        this,
        [this.titleText, this.progressBar, this.progressBox, this.progressLabel],
        320,
        () => this.scene.start(SCENE_KEYS.Menu)
      );
    } catch (error) {
      this.debug.error('Failed to load dice catalog.', error);
      this.progressLabel.setText('Dice definitions failed to load.');
      AlertManager.show(this, {
        type: 'error',
        title: 'DICE LOAD FAILURE',
        message: 'The dice definition catalog could not be loaded. Check Flags.json and the referenced type-id files.'
      });
    }
  }
}
