import Phaser from 'phaser';
import { SettingsStore } from '../systems/SettingsStore';
import { PALETTE } from '../ui/theme';
import type { AppSettings } from '../types/game';
import { DebugManager } from '../utils/DebugManager';
import { AUDIO_KEYS, AudioManager } from '../utils/AudioManager';
import { SCENE_KEYS } from './sceneKeys';

type SettingKey = keyof AppSettings;

export class SettingsScene extends Phaser.Scene {
  static readonly KEY = SCENE_KEYS.Settings;

  private modalOpen = false;
  private modalElements: Phaser.GameObjects.GameObject[] = [];
  private readonly debug = DebugManager.attachScene(SettingsScene.KEY);

  constructor() {
    super(SettingsScene.KEY);
  }

  create() {
    const { width } = this.scale;
    this.debug.log('Settings overlay ready.');

    const buttonBg = this.add.circle(width - 48, 46, 28, 0x112638, 0.94)
      .setStrokeStyle(1, 0x4f748e)
      .setInteractive({ useHandCursor: true });
    const buttonIcon = this.add.image(width - 48, 46, 'settings-icon')
      .setDisplaySize(28, 28)
      .setTint(0xf5dfb0)
      .setInteractive({ useHandCursor: true });

    [buttonBg, buttonIcon].forEach((target) => {
      target.setDepth(40);
      target.on('pointerdown', () => {
        if (this.modalOpen) {
          this.closeModal();
        } else {
          this.openModal();
        }
      });
    });

    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.modalOpen) {
        this.closeModal();
      }
    });
  }

  private openModal() {
    if (this.modalOpen) {
      return;
    }

    this.modalOpen = true;
    this.debug.event('Opening settings modal.');
    const settings = SettingsStore.get(this);
    const { width } = this.scale;

    const overlay = this.add.rectangle(this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height, 0x041018, 0.45)
      .setInteractive()
      .setDepth(41);
    overlay.on('pointerdown', () => this.closeModal());

    const panel = this.add.rectangle(width - 196, 184, 288, 260, 0x102434, 0.97)
      .setStrokeStyle(1, 0x496a84)
      .setDepth(42);

    const title = this.add.text(width - 314, 76, 'SETTINGS', {
      fontFamily: 'Orbitron',
      fontSize: '20px',
      color: PALETTE.text
    }).setDepth(43);

    const subtitle = this.add.text(width - 314, 102, 'Global menu overlay', {
      fontFamily: 'Orbitron',
      fontSize: '11px',
      color: PALETTE.textMuted
    }).setDepth(43);

    const toggles: Array<[SettingKey, string]> = [
      ['music', 'Music playback'],
      ['sfx', 'Button + combat SFX'],
      ['screenShake', 'Screen shake'],
      ['reducedMotion', 'Reduced motion']
    ];

    this.modalElements.push(overlay, panel, title, subtitle);

    toggles.forEach(([key, label], index) => {
      const rowY = 136 + index * 44;
      const row = this.createToggleRow(width - 304, rowY, label, key, settings[key]);
      this.modalElements.push(...row);
    });

    const close = this.add.text(width - 314, 252, 'Close', {
      fontFamily: 'Orbitron',
      fontSize: '13px',
      color: PALETTE.accentSoft,
      backgroundColor: '#173247',
      padding: { left: 10, right: 10, top: 6, bottom: 6 }
    }).setInteractive({ useHandCursor: true }).setDepth(43);
    close.on('pointerdown', () => this.closeModal());
    this.modalElements.push(close);
  }

  private createToggleRow(x: number, y: number, label: string, key: SettingKey, enabled: boolean) {
    const labelText = this.add.text(x, y, label, {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.text
    }).setDepth(43);

    const pill = this.add.rectangle(x + 212, y + 10, 70, 26, enabled ? 0xf4b860 : 0x183447, 1)
      .setStrokeStyle(1, enabled ? 0xffdfa4 : 0x4b6e89)
      .setInteractive({ useHandCursor: true })
      .setDepth(43);
    const value = this.add.text(x + 212, y + 10, enabled ? 'ON' : 'OFF', {
      fontFamily: 'Orbitron',
      fontSize: '11px',
      color: enabled ? '#071018' : PALETTE.textMuted
    }).setOrigin(0.5).setDepth(44);

    const flip = () => {
      const next = SettingsStore.toggle(this, key);
      const on = next[key];
      this.debug.event('Toggled setting.', { key, value: on });
      pill.setFillStyle(on ? 0xf4b860 : 0x183447, 1);
      pill.setStrokeStyle(1, on ? 0xffdfa4 : 0x4b6e89);
      value.setText(on ? 'ON' : 'OFF');
      value.setColor(on ? '#071018' : PALETTE.textMuted);
      if (key === 'music') {
        const preferredMusic = this.scene.isActive(SCENE_KEYS.Arena) ? AUDIO_KEYS.arenaMusic : AUDIO_KEYS.menuMusic;
        AudioManager.refreshMusicForSettings(this, preferredMusic);
      }
    };

    pill.on('pointerdown', flip);
    value.setInteractive({ useHandCursor: true }).on('pointerdown', flip);

    return [labelText, pill, value];
  }

  private closeModal() {
    this.debug.event('Closing settings modal.');
    this.modalOpen = false;
    this.modalElements.forEach((element) => element.destroy());
    this.modalElements = [];
  }
}
