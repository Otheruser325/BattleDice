import Phaser from 'phaser';
import { SettingsStore } from '../systems/SettingsStore';
import { PALETTE } from '../ui/theme';
import type { AppSettings } from '../types/game';
import { DebugManager } from '../utils/DebugManager';
import { AUDIO_KEYS, AudioManager } from '../utils/AudioManager';
import { SCENE_KEYS } from './sceneKeys';
import { ProfileStore } from '../systems/ProfileStore';
import { getDiamonds } from '../data/dice';
import { AlertManager } from '../utils/AlertManager';
import { withBasePath } from '../utils/BuildEnv';

type SettingKey = keyof AppSettings;

export class SettingsScene extends Phaser.Scene {
  static readonly KEY = SCENE_KEYS.Settings;
  private modalOpen = false;
  private modalElements: Phaser.GameObjects.GameObject[] = [];
  private readonly debug = DebugManager.attachScene(SettingsScene.KEY);
  private settingsButtonBg?: Phaser.GameObjects.Arc;
  private settingsButtonIcon?: Phaser.GameObjects.Image;
  private matchStateCheckTimer?: Phaser.Time.TimerEvent;

  constructor() {
    super(SettingsScene.KEY);
  }

  create() {
    const { width } = this.scale;
    this.debug.log('Settings overlay ready.');

    this.settingsButtonBg = this.add.circle(width - 48, 46, 28, 0x112638, 0.94)
      .setStrokeStyle(1, 0x4f748e)
      .setInteractive({ useHandCursor: true });
    this.settingsButtonIcon = this.add.image(width - 48, 46, 'settings-icon')
      .setDisplaySize(28, 28)
      .setTint(0xf5dfb0)
      .setInteractive({ useHandCursor: true });

    [this.settingsButtonBg, this.settingsButtonIcon].forEach((target) => {
      target.setDepth(40);
      target.on('pointerdown', () => (this.modalOpen ? this.closeModal() : this.openModal()));
    });

    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.modalOpen) this.closeModal();
    });

    this.matchStateCheckTimer = this.time.addEvent({
      delay: 500,
      loop: true,
      callback: () => this.updateSettingsButtonVisibility()
    });
  }

  private updateSettingsButtonVisibility() {
    const buttonVisible = !this.isMatchInProgress();
    this.settingsButtonBg?.setVisible(buttonVisible);
    this.settingsButtonIcon?.setVisible(buttonVisible);
  }

  private isMatchInProgress(): boolean {
    const arenaScene = this.scene.get(SCENE_KEYS.Arena);
    if (!arenaScene || !arenaScene.sys.isActive()) return false;
    const arenaState = arenaScene as unknown as { gamePhase?: { stage: string } };
    if (arenaState.gamePhase) {
      const { stage } = arenaState.gamePhase;
      if (stage === 'placement' || stage === 'combat') return true;
      if (stage === 'lobby') return false;
    }
    return false;
  }

  private openModal() {
    if (this.modalOpen) return;
    this.modalOpen = true;
    this.debug.event('Opening settings modal.');
    const settings = SettingsStore.get(this);
    const { width } = this.scale;

    const overlay = this.add.rectangle(this.scale.width / 2, this.scale.height / 2, this.scale.width, this.scale.height, 0x041018, 0.45)
      .setInteractive()
      .setDepth(41);

    const panel = this.add.rectangle(width - 196, 196, 288, 292, 0x102434, 0.97)
      .setStrokeStyle(1, 0x496a84)
      .setDepth(42);

    const title = this.add.text(width - 314, 76, 'SETTINGS', {
      fontFamily: 'Orbitron', fontSize: '20px', color: PALETTE.text
    }).setDepth(43);

    const subtitle = this.add.text(width - 314, 98, 'Menu overlay', {
      fontFamily: 'Orbitron', fontSize: '11px', color: PALETTE.textMuted
    }).setDepth(43);

    const toggles: Array<[SettingKey, string]> = [
      ['music', 'Music playback'],
      ['sfx', 'Button + combat SFX'],
      ['screenShake', 'Screen shake'],
      ['reducedMotion', 'Reduced motion']
    ];

    this.modalElements.push(overlay, panel, title, subtitle);

    toggles.forEach(([key, label], index) => {
      const rowY = 120 + index * 44;
      const row = this.createToggleRow(width - 304, rowY, label, key, settings[key]);
      this.modalElements.push(...row);
    });

    const changelogBtn = this.add.text(width - 314, 275, 'Changelog', {
      fontFamily: 'Orbitron', fontSize: '13px', color: '#071018', backgroundColor: '#f4b860', padding: { left: 10, right: 10, top: 6, bottom: 6 }
    }).setInteractive({ useHandCursor: true }).setDepth(43);
    changelogBtn.on('pointerdown', () => this.openChangelogModal());

    const nameBtn = this.add.text(width - 314, 305, 'Change Name', {
      fontFamily: 'Orbitron', fontSize: '13px', color: '#071018', backgroundColor: '#9fe6ff', padding: { left: 10, right: 10, top: 6, bottom: 6 }
    }).setInteractive({ useHandCursor: true }).setDepth(43);
    nameBtn.on('pointerdown', () => this.promptForNameChange());

    const close = this.add.text(width - 154, 305, 'Close', {
      fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.accentSoft, backgroundColor: '#173247', padding: { left: 10, right: 10, top: 6, bottom: 6 }
    }).setInteractive({ useHandCursor: true }).setDepth(43);
    close.on('pointerdown', () => this.closeModal());
    this.modalElements.push(changelogBtn, nameBtn, close);
  }

  private async openChangelogModal() {
    const { width, height } = this.scale;
    const panelWidth = 720;
    const panelHeight = 520;
    const contentPadding = 30;
    const scrollSpeed = 0.5;

    const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x02080d, 0.72).setDepth(70);
    const panel = this.add.rectangle(width / 2, height / 2, panelWidth, panelHeight, 0x102434, 0.98).setStrokeStyle(2, 0x496a84).setDepth(71);
    const title = this.add.text(width / 2, height / 2 - panelHeight / 2 + 30, 'BATTLE DICE CHANGELOG', { fontFamily: 'Orbitron', fontSize: '20px', color: PALETTE.text }).setOrigin(0.5).setDepth(72);
    const closeBtn = this.add.text(width / 2, height / 2 + panelHeight / 2 - 30, 'Close', { fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.accentSoft, backgroundColor: '#173247', padding: { left: 10, right: 10, top: 6, bottom: 6 } }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(72);

    // Create scrollable content container - positioned at content area with proper padding
    const contentWidth = panelWidth - contentPadding * 2;
    const contentStartY = height / 2 - panelHeight / 2 + 70;
    const contentStartX = width / 2 - panelWidth / 2 + contentPadding;
    const contentHeight = panelHeight - 100;
    const contentContainer = this.add.container(contentStartX, contentStartY).setDepth(72);

    // Create mask for scrolling (use graphics to avoid white rectangle)
    const maskShape = this.make.graphics({ x: 0, y: 0 }, false);
    maskShape.fillStyle(0xffffff);
    maskShape.fillRect(contentStartX, contentStartY, contentWidth, contentHeight);
    maskShape.setDepth(72);

    const body = this.add.text(0, 0, 'Loading changelog...', { fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.textMuted, wordWrap: { width: contentWidth } });
    contentContainer.add(body);
    contentContainer.setMask(maskShape.createGeometryMask());

    // Scroll state
    let scrollY = 0;
    let contentHeightActual = 0;
    let isDragging = false;
    let lastDragY = 0;

    // Drag scrolling - works on the overlay (entire modal area)
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (contentHeightActual > contentHeight) {
        isDragging = true;
        lastDragY = pointer.y;
      }
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (isDragging && contentHeightActual > contentHeight) {
        const deltaY = pointer.y - lastDragY;
        scrollY = Phaser.Math.Clamp(scrollY - deltaY * scrollSpeed, 0, Math.max(0, contentHeightActual - contentHeight));
        body.setY(-scrollY);
        lastDragY = pointer.y;
      }
    });

    this.input.on('pointerup', () => {
      isDragging = false;
    });

    // Mouse wheel scrolling with momentum
    this.input.keyboard?.on('wheel', (_: unknown, _2: unknown, _3: unknown, deltaY: number) => {
      if (contentHeightActual > contentHeight) {
        scrollY = Phaser.Math.Clamp(scrollY + deltaY * 1.5, 0, Math.max(0, contentHeightActual - contentHeight));
        body.setY(-scrollY);
      }
    });

    // Keyboard arrow scrolling
    this.input.keyboard?.on('keydown-UP', () => {
      if (contentHeightActual > contentHeight) {
        scrollY = Phaser.Math.Clamp(scrollY - 50, 0, Math.max(0, contentHeightActual - contentHeight));
        body.setY(-scrollY);
      }
    });

    this.input.keyboard?.on('keydown-DOWN', () => {
      if (contentHeightActual > contentHeight) {
        scrollY = Phaser.Math.Clamp(scrollY + 50, 0, Math.max(0, contentHeightActual - contentHeight));
        body.setY(-scrollY);
      }
    });

    const close = () => {
      this.input.off('pointermove');
      this.input.off('pointerdown');
      this.input.off('pointerup');
      this.input.keyboard?.off('keydown-UP');
      this.input.keyboard?.off('keydown-DOWN');
      [overlay, panel, title, closeBtn, contentContainer, maskShape].forEach((e) => e.destroy());
    };
    this.input.keyboard?.once('keydown-ESC', close);
    closeBtn.on('pointerdown', close);

    try {
      const response = await fetch(withBasePath('config/changelog.json'));
      const payload = await response.json();
      const lines: string[] = (payload.entries ?? []).map((entry: { version: string; date: string; notes: string[] }) => `• ${entry.version} (${entry.date})\n${entry.notes.map((n) => `  • ${n}`).join('\n')}`);
      body.setText(lines.join('\n\n') || 'No entries found.');
      
      // Dynamic content height based on actual text
      contentHeightActual = body.height;
      body.setX(0);
      body.setY(0);
      scrollY = 0;
    } catch {
      body.setText('Could not fetch config/changelog.json');
    }
  }

  private createToggleRow(x: number, y: number, label: string, key: SettingKey, enabled: boolean) {
    const labelText = this.add.text(x, y, label, { fontFamily: 'Orbitron', fontSize: '12px', color: PALETTE.text }).setDepth(43);
    const pill = this.add.rectangle(x + 212, y + 10, 70, 26, enabled ? 0xf4b860 : 0x183447, 1).setStrokeStyle(1, enabled ? 0xffdfa4 : 0x4b6e89).setInteractive({ useHandCursor: true }).setDepth(43);
    const value = this.add.text(x + 212, y + 10, enabled ? 'ON' : 'OFF', { fontFamily: 'Orbitron', fontSize: '11px', color: enabled ? '#071018' : PALETTE.textMuted }).setOrigin(0.5).setDepth(44);
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
    this.updateSettingsButtonVisibility();
  }

  private promptForNameChange() {
    const profile = ProfileStore.get(this);
    const isFirst = profile.nameChangesUsed === 0;
    const costLabel = isFirst ? 'FREE (first change)' : '50 diamonds';
    const entry = window.prompt(`Enter new username (1-18 chars). Cost: ${costLabel}`, profile.username || '');
    if (entry == null) return;
    const next = entry.trim();
    if (!next) { AlertManager.toast(this, { type: 'warning', message: 'Name cannot be empty.' }); return; }
    if (!ProfileStore.canAffordNameChange(this)) {
      AlertManager.toast(this, { type: 'warning', message: `Not enough diamonds. Need 50, have ${getDiamonds(this)}.` });
      return;
    }
    const result = ProfileStore.applyNameChange(this, next);
    if (!result.ok) { AlertManager.toast(this, { type: 'warning', message: 'Name change failed.' }); return; }
    AlertManager.toast(this, { type: 'success', message: `Name changed to ${next}${result.cost > 0 ? ` (-${result.cost} diamonds)` : ' (free)'}.` });
  }
}
