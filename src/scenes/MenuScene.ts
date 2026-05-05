import Phaser from 'phaser';
import { AlertManager } from '../utils/AlertManager';
import { AnimationManager } from '../utils/AnimationManager';
import { DebugManager } from '../utils/DebugManager';
import { MENU_TABS, PALETTE, getLayout } from '../ui/theme';

type MenuTab = (typeof MENU_TABS)[number];

export class MenuScene extends Phaser.Scene {
  static readonly KEY = 'MenuScene';

  private activeSceneKey = 'ArenaScene';
  private tabButtons: Array<{ tab: MenuTab; container: Phaser.GameObjects.Container; label: Phaser.GameObjects.Text; chip: Phaser.GameObjects.Text; }> = [];
  private readonly debug = DebugManager.attachScene(MenuScene.KEY);

  constructor() {
    super(MenuScene.KEY);
  }

  create() {
    this.tabButtons = [];
    const { width, height, dockY } = getLayout(this);
    this.debug.log('Menu scene created.');

    this.add.image(width / 2, height / 2, 'menu-bg')
      .setDisplaySize(width, height)
      .setTint(0x3d6f9a)
      .setAlpha(0.18);

    this.add.rectangle(width / 2, height / 2, width, height, 0x0b2535, 0.55);
    this.add.circle(width * 0.18, height * 0.24, 180, 0x1c4f71, 0.12);
    this.add.circle(width * 0.82, height * 0.18, 120, 0xf4b860, 0.08);

    this.add.text(40, 28, 'BATTLE DICE', {
      fontFamily: 'Orbitron',
      fontSize: '32px',
      color: PALETTE.text
    });

    this.add.text(42, 62, 'Autoroller menu shell  |  Random Dice-inspired lane battler', {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.textMuted
    });

    this.add.text(width - 40, 34, 'ONLINE PROTOTYPE', {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.accentSoft
    }).setOrigin(1, 0);

    const dock = this.add.rectangle(width / 2, dockY, width - 72, 66, 0x112638, 0.95)
      .setStrokeStyle(1, 0x3f627c);

    dock.setDepth(10);

    const slotWidth = (width - 144) / MENU_TABS.length;
    MENU_TABS.forEach((tab, index) => {
      const x = 72 + slotWidth * index + slotWidth / 2;
      const container = this.add.container(x, dockY);
      const hit = this.add.rectangle(0, 0, slotWidth - 10, 52, 0x000000, 0.001)
        .setInteractive({ useHandCursor: true });
      const label = this.add.text(0, -7, tab.label.toUpperCase(), {
        fontFamily: 'Orbitron',
        fontSize: '16px',
        color: PALETTE.textMuted
      }).setOrigin(0.5);
      const chip = this.add.text(0, 12, tab.status.toUpperCase(), {
        fontFamily: 'Orbitron',
        fontSize: '10px',
        color: PALETTE.textMuted,
        backgroundColor: '#173247',
        padding: { left: 8, right: 8, top: 4, bottom: 4 }
      }).setOrigin(0.5);

      hit.on('pointerdown', () => this.openTab(tab));
      hit.on('pointerover', () => {
        if (this.activeSceneKey !== tab.sceneKey) {
          label.setColor(PALETTE.text);
          chip.setColor(PALETTE.text);
        }
      });
      hit.on('pointerout', () => this.refreshTabs());

      container.add([hit, label, chip]);
      container.setDepth(11);
      this.tabButtons.push({ tab, container, label, chip });
    });

    if (!this.scene.isActive('SettingsScene')) {
      this.scene.launch('SettingsScene');
    }

    this.openTab(MENU_TABS.find((tab) => tab.sceneKey === this.activeSceneKey) ?? MENU_TABS[2]);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.tabButtons = [];
    });
  }

  private openTab(tab: MenuTab) {
    if (this.scene.isActive(this.activeSceneKey)) {
      this.scene.stop(this.activeSceneKey);
    }

    this.activeSceneKey = tab.sceneKey;
    this.debug.event('Opening tab.', { tab: tab.label, sceneKey: tab.sceneKey, status: tab.status });
    this.scene.launch(tab.sceneKey);
    this.scene.bringToTop(this.scene.key);
    this.scene.bringToTop('SettingsScene');
    this.refreshTabs();

    if (tab.status === 'WIP') {
      AlertManager.toast(this, {
        type: 'warning',
        message: `${tab.label} is a work-in-progress surface.`
      });
    }
  }

  private refreshTabs() {
    this.tabButtons.forEach(({ tab, label, chip }) => {
      if (!label?.scene || !chip?.scene) return;
      const active = tab.sceneKey === this.activeSceneKey;
      label.setColor(active ? PALETTE.text : PALETTE.textMuted);
      chip.setColor(active ? '#0b1520' : PALETTE.textMuted);
      chip.setBackgroundColor(active ? PALETTE.accent : '#173247');
      label.setScale(active ? 1.04 : 1);
      if (active) {
        AnimationManager.pulse(this, label, 1.03, 120);
      }
    });
  }
}
