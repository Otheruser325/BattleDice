import Phaser from 'phaser';
import { PALETTE } from '../ui/theme';

type AlertType = 'warning' | 'error' | 'success' | 'checking';

interface AlertConfig {
  message: string;
  type?: AlertType;
  title?: string;
}

interface ToastConfig {
  message: string;
  type?: Exclude<AlertType, 'checking'>;
  durationMs?: number;
}

export class AlertManager {
  private static scene: Phaser.Scene | null = null;
  private static container: Phaser.GameObjects.Container | null = null;
  private static escHandler: ((event: KeyboardEvent) => void) | null = null;
  private static toastTimer: Phaser.Time.TimerEvent | null = null;
  private static toastElements: Phaser.GameObjects.GameObject[] = [];
  private static toastMessage = '';

  static show(scene: Phaser.Scene, { message, type = 'warning', title }: AlertConfig) {
    if (!scene.add) {
      return;
    }

    this.hide();
    this.scene = scene;

    const { color, hex, fallbackTitle } = this.getTypeConfig(type);
    const cam = scene.cameras.main;
    const blocker = scene.add.rectangle(cam.centerX, cam.centerY, cam.width, cam.height, 0x000000, 0.52)
      .setDepth(10000)
      .setInteractive({ useHandCursor: false });
    const panel = scene.add.rectangle(cam.centerX, cam.centerY, 560, 214, 0x102434, 0.98)
      .setStrokeStyle(2, color)
      .setDepth(10001);
    const titleText = scene.add.text(cam.centerX, cam.centerY - 64, title ?? fallbackTitle, {
      fontFamily: 'Orbitron',
      fontSize: '24px',
      color: hex
    }).setOrigin(0.5).setDepth(10002);
    const bodyText = scene.add.text(cam.centerX, cam.centerY, message, {
      fontFamily: 'Orbitron',
      fontSize: '18px',
      color: PALETTE.text,
      align: 'center',
      wordWrap: { width: 472 }
    }).setOrigin(0.5).setDepth(10002);
    const closeButton = scene.add.text(cam.centerX, cam.centerY + 68, 'Close', {
      fontFamily: 'Orbitron',
      fontSize: '16px',
      color: PALETTE.accentSoft,
      backgroundColor: '#173247',
      padding: { left: 14, right: 14, top: 8, bottom: 8 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true }).setDepth(10002);

    closeButton.on('pointerdown', () => this.fadeOut());

    this.container = scene.add.container(0, 0, [blocker, panel, titleText, bodyText, closeButton]);
    this.container.setDepth(10000);

    this.escHandler = (event) => {
      event.stopPropagation();
      this.fadeOut();
    };

    scene.input.keyboard?.on('keydown-ESC', this.escHandler);
    scene.events.once('shutdown', () => this.hide());
    scene.events.once('destroy', () => this.hide());
  }

  static toast(scene: Phaser.Scene, { message, type = 'success', durationMs = 1800 }: ToastConfig) {
    if (this.toastElements.length > 0 && this.toastMessage === message) {
      this.toastTimer?.remove(false);
      this.toastTimer = scene.time.delayedCall(durationMs + 1000, () => this.clearToast());
      return;
    }
    this.clearToast();

    const { color } = this.getTypeConfig(type);
    const toastBg = scene.add.rectangle(scene.scale.width / 2, 48, 420, 38, 0x102434, 0.96)
      .setStrokeStyle(1, color)
      .setDepth(9000);
    const toastText = scene.add.text(scene.scale.width / 2, 48, message, {
      fontFamily: 'Orbitron',
      fontSize: '13px',
      color: PALETTE.text
    }).setOrigin(0.5).setDepth(9001);

    this.toastMessage = message;
    this.toastElements = [toastBg, toastText];
    this.toastTimer = scene.time.delayedCall(durationMs, () => this.clearToast());
  }

  static fadeOut() {
    if (!this.scene || !this.container) {
      return;
    }

    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration: 220,
      onComplete: () => this.hide()
    });
  }

  static hide() {
    if (this.scene && this.escHandler) {
      this.scene.input.keyboard?.off('keydown-ESC', this.escHandler);
    }

    this.escHandler = null;

    if (this.container) {
      this.container.destroy(true);
      this.container = null;
    }

    this.scene = null;
  }

  static clearToast() {
    this.toastTimer?.remove(false);
    this.toastTimer = null;
    this.toastElements.forEach((entry) => entry.destroy());
    this.toastElements = [];
    this.toastMessage = '';
  }

  private static getTypeConfig(type: AlertType) {
    switch (type) {
      case 'error':
        return { fallbackTitle: 'ERROR', color: 0xff7b6f, hex: '#ff7b6f' };
      case 'success':
        return { fallbackTitle: 'SUCCESS', color: 0x8ae0a1, hex: '#8ae0a1' };
      case 'checking':
        return { fallbackTitle: 'CHECKING', color: 0x8fd5ff, hex: '#8fd5ff' };
      case 'warning':
      default:
        return { fallbackTitle: 'WARNING', color: 0xf4b860, hex: '#f4b860' };
    }
  }
}
