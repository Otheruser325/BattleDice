import Phaser from 'phaser';
import { PALETTE } from '../ui/theme';
import { AudioManager } from './AudioManager';
import { ProfileStore } from '../systems/ProfileStore';
import {
  ACCOUNT_SESSION_TTL_MS,
  clearAccountSession,
  getValidSession,
  signInAsGuest,
  type AccountProvider,
  type AccountSession
} from './AccountManager';
import { SCENE_KEYS } from '../scenes/sceneKeys';

const OAUTH_ENDPOINTS: Partial<Record<Exclude<AccountProvider, 'guest'>, string>> = {};

const SESSION_DAYS = Math.round(ACCOUNT_SESSION_TTL_MS / (24 * 60 * 60 * 1000));

function providerLabel(provider: Exclude<AccountProvider, 'guest'>): string {
  return provider === 'google' ? 'Google' : 'Discord';
}

export class LoginManager {
  static hasValidSession(): boolean {
    return getValidSession() !== null;
  }

  static resetToLogin(scene: Phaser.Scene): void {
    clearAccountSession();
    const activeScenes = scene.scene.manager.getScenes(true)
      .filter((active) => active.scene.key !== scene.scene.key && active.scene.key !== SCENE_KEYS.Boot);
    activeScenes.forEach((active) => active.scene.stop());
    scene.scene.start(SCENE_KEYS.Boot);
  }

  static present(scene: Phaser.Scene, onComplete: (session: AccountSession) => void): void {
    const existing = getValidSession();
    if (existing) {
      onComplete(existing);
      return;
    }

    const { width, height } = scene.scale;
    const elements: Phaser.GameObjects.GameObject[] = [];
    const panelWidth = 500;
    const panelHeight = 236;
    const panelY = height - panelHeight / 2 - 8;
    let finished = false;

    const cleanup = () => {
      if (finished) return;
      finished = true;
      scene.events.off(Phaser.Scenes.Events.SHUTDOWN, cleanup);
      elements.forEach((element) => element.destroy());
    };
    const complete = (session: AccountSession) => {
      cleanup();
      onComplete(session);
    };

    const panel = scene.add.rectangle(width / 2, panelY, panelWidth, panelHeight, 0x163246, 0.98)
      .setStrokeStyle(2, 0x4f7ea1)
      .setDepth(901);
    const title = scene.add.text(width / 2, panelY - 92, 'SIGN IN', {
      fontFamily: 'Orbitron',
      fontSize: '18px',
      color: PALETTE.text
    }).setOrigin(0.5).setDepth(902);
    const subtitle = scene.add.text(width / 2, panelY - 69, `Continue to Battle Dice. Sessions last ${SESSION_DAYS} days.`, {
      fontFamily: 'Orbitron',
      fontSize: '10px',
      color: PALETTE.textMuted,
      align: 'center',
      wordWrap: { width: 440 }
    }).setOrigin(0.5).setDepth(902);
    const status = scene.add.text(width / 2, panelY + 79, 'Google and Discord are beta until OAuth is connected.', {
      fontFamily: 'Orbitron',
      fontSize: '9px',
      color: PALETTE.textMuted,
      align: 'center',
      wordWrap: { width: 440 }
    }).setOrigin(0.5).setDepth(902);
    elements.push(panel, title, subtitle, status);

    const addProviderButton = (
      y: number,
      label: string,
      fill: number,
      hoverFill: number,
      textColor: string,
      onPress: () => void
    ) => {
      const background = scene.add.rectangle(width / 2, y, 380, 30, fill, 1)
        .setStrokeStyle(1, hoverFill)
        .setDepth(902)
        .setInteractive({ useHandCursor: true });
      const text = scene.add.text(width / 2, y, label, {
        fontFamily: 'Orbitron',
        fontSize: '11px',
        color: textColor
      }).setOrigin(0.5).setDepth(903);
      background.on('pointerover', () => background.setFillStyle(hoverFill, 1));
      background.on('pointerout', () => background.setFillStyle(fill, 1));
      background.on('pointerdown', () => {
        AudioManager.playSfx(scene, 'ui-click');
        onPress();
      });
      elements.push(background, text);
    };

    const oauth = (provider: Exclude<AccountProvider, 'guest'>) => {
      const endpoint = OAUTH_ENDPOINTS[provider];
      if (!endpoint) {
        status.setText(`${providerLabel(provider)} OAuth is not connected yet. Continue as Guest for now.`);
        return;
      }
      window.location.assign(endpoint);
    };

    addProviderButton(panelY - 43, 'CONTINUE WITH GOOGLE', 0xf4b860, 0xffce77, '#071018', () => oauth('google'));
    addProviderButton(panelY - 7, 'CONTINUE WITH DISCORD', 0x5865f2, 0x7480ff, '#ffffff', () => oauth('discord'));
    addProviderButton(panelY + 29, 'CONTINUE AS GUEST', 0x5b6672, 0x748494, '#ffffff', () => {
      complete(signInAsGuest(ProfileStore.get(scene).username));
    });

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
  }
}
