import Phaser from 'phaser';
import { AlertManager } from '../utils/AlertManager';
import { AnimationManager } from '../utils/AnimationManager';
import { DebugManager } from '../utils/DebugManager';
import { MENU_TABS, PALETTE, getLayout } from '../ui/theme';
import { SCENE_KEYS, type SceneKey } from './sceneKeys';
import { AudioManager } from '../utils/AudioManager';

type MenuTab = (typeof MENU_TABS)[number];

export class MenuScene extends Phaser.Scene {
  static readonly KEY = SCENE_KEYS.Menu;

  private activeSceneKey: SceneKey = SCENE_KEYS.Shop;
  private tabButtons: Array<{ tab: MenuTab; container: Phaser.GameObjects.Container; label: Phaser.GameObjects.Text; chip: Phaser.GameObjects.Text; }> = [];
  private singleplayerPanel: Phaser.GameObjects.Container | null = null;
  private readonly debug = DebugManager.attachScene(MenuScene.KEY);

  constructor() {
    super(MenuScene.KEY);
  }

  create() {
    this.tabButtons = [];
    const { width, height, dockY } = getLayout(this);
    this.debug.log('Menu scene created.');
    AudioManager.playMusic(this, 'menu-music');

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

    if (!this.scene.isActive(SCENE_KEYS.Settings)) {
      this.scene.launch(SCENE_KEYS.Settings);
    }

    this.openTab(MENU_TABS.find((tab) => tab.sceneKey === this.activeSceneKey) ?? MENU_TABS[2]);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.tabButtons = [];
    });
  }

  private openTab(tab: MenuTab) {
    AudioManager.playSfx(this, 'ui-click');
    if (tab.sceneKey === SCENE_KEYS.Arena) {
      this.openSingleplayerPanel(tab);
      return;
    }
    this.closeSingleplayerPanel();
    if (this.scene.isActive(this.activeSceneKey)) {
      this.scene.stop(this.activeSceneKey);
    }
    AudioManager.playMusic(this, 'menu-music');

    this.activeSceneKey = tab.sceneKey;
    this.debug.event('Opening tab.', { tab: tab.label, sceneKey: tab.sceneKey, status: tab.status });
    this.scene.launch(tab.sceneKey);
    this.scene.bringToTop(MenuScene.KEY);
    this.scene.bringToTop(SCENE_KEYS.Settings);
    this.refreshTabs();

    if (tab.status === 'WIP') {
      AlertManager.toast(this, {
        type: 'warning',
        message: `${tab.label} is a work-in-progress surface.`
      });
    }
  }

  private openSingleplayerPanel(tab: MenuTab) {
    if (this.singleplayerPanel) {
      this.closeSingleplayerPanel();
      return;
    }

    this.singleplayerPanel = this.add.container(0, 0).setDepth(30);
    const { width, dockY } = getLayout(this);
    const panelWidth = 620;
    const panelHeight = 220;
    const panelX = width / 2;
    const panelY = dockY - 176;
    const panel = this.add.rectangle(panelX, panelY, panelWidth, panelHeight, 0x102434, 0.98)
      .setStrokeStyle(2, 0x496a84);
    const title = this.add.text(panelX, panelY - 88, 'SINGLEPLAYER', {
      fontFamily: 'Orbitron',
      fontSize: '22px',
      color: PALETTE.text
    }).setOrigin(0.5);
    const subtitle = this.add.text(panelX, panelY - 62, 'Choose a solo battle surface.', {
      fontFamily: 'Orbitron',
      fontSize: '11px',
      color: PALETTE.textMuted
    }).setOrigin(0.5);

    const versus = this.createSingleplayerOption(panelX - 190, panelY + 4, 'Versus Bot', 'Same bot setup as before.', 0x2271b3, () => {
      this.launchArenaTab(tab);
    });
    const random = this.createSingleplayerOption(panelX, panelY + 4, 'Random Mode', 'WIP: derive a random mode before Turn 1.', 0x6f5bb5, () => {
      AlertManager.toast(this, { type: 'warning', message: 'Random Mode is a WIP feature and is not implemented yet.' });
    });
    const challenges = this.createSingleplayerOption(panelX + 190, panelY + 4, 'Challenges', 'Coming soon...', 0x5d6770, () => {
      AlertManager.toast(this, { type: 'warning', message: 'Challenges are coming soon.' });
    });
    const close = this.add.text(panelX, panelY + 86, 'Close', {
      fontFamily: 'Orbitron',
      fontSize: '11px',
      color: PALETTE.textMuted,
      backgroundColor: '#173247',
      padding: { left: 10, right: 10, top: 5, bottom: 5 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    close.on('pointerdown', () => this.closeSingleplayerPanel());

    this.singleplayerPanel.add([panel, title, subtitle, ...versus, ...random, ...challenges, close]);
    this.refreshTabs();
  }

  private createSingleplayerOption(x: number, y: number, title: string, subtitle: string, color: number, onClick: () => void): Phaser.GameObjects.GameObject[] {
    const bg = this.add.rectangle(x, y, 172, 104, color, 0.9)
      .setStrokeStyle(1, 0x8fd5ff)
      .setInteractive({ useHandCursor: true });
    const titleText = this.add.text(x, y - 30, title.toUpperCase(), {
      fontFamily: 'Orbitron',
      fontSize: '13px',
      color: '#ffffff'
    }).setOrigin(0.5);
    const subText = this.add.text(x, y - 6, subtitle, {
      fontFamily: 'Orbitron',
      fontSize: '10px',
      color: '#e6f4ff',
      align: 'center',
      wordWrap: { width: 148 }
    }).setOrigin(0.5, 0);
    bg.on('pointerover', () => bg.setAlpha(1));
    bg.on('pointerout', () => bg.setAlpha(0.9));
    bg.on('pointerdown', onClick);
    return [bg, titleText, subText];
  }

  private launchArenaTab(tab: MenuTab) {
    this.closeSingleplayerPanel();
    MENU_TABS.forEach((candidate) => {
      if (candidate.sceneKey !== tab.sceneKey && this.scene.isActive(candidate.sceneKey)) {
        this.scene.stop(candidate.sceneKey);
      }
    });
    this.activeSceneKey = tab.sceneKey;
    this.debug.event('Opening singleplayer mode.', { tab: tab.label, sceneKey: tab.sceneKey, mode: 'Versus Bot' });
    this.scene.launch(tab.sceneKey);
    this.scene.bringToTop(MenuScene.KEY);
    this.scene.bringToTop(SCENE_KEYS.Settings);
    this.refreshTabs();
  }

  private closeSingleplayerPanel() {
    this.singleplayerPanel?.destroy(true);
    this.singleplayerPanel = null;
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
