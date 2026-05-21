import Phaser from 'phaser';
import { AlertManager } from '../utils/AlertManager';
import { AnimationManager } from '../utils/AnimationManager';
import { DebugManager } from '../utils/DebugManager';
import { MENU_TABS, PALETTE, getLayout } from '../ui/theme';
import { SCENE_KEYS, type SceneKey } from './sceneKeys';
import { AudioManager } from '../utils/AudioManager';
import { ProfileStore } from '../systems/ProfileStore';
import { getAllDiceDefinitions, getDiamonds, getDiceTokens, grantDiceCopies, setDiamonds, setDiceTokens } from '../data/dice';
import { AchievementStore } from '../systems/AchievementStore';

type MenuTab = (typeof MENU_TABS)[number];

export class MenuScene extends Phaser.Scene {
  static readonly KEY = SCENE_KEYS.Menu;

  private activeSceneKey: SceneKey = SCENE_KEYS.Shop;
  private tabButtons: Array<{ tab: MenuTab; container: Phaser.GameObjects.Container; label: Phaser.GameObjects.Text; chip: Phaser.GameObjects.Text; }> = [];
  private readonly debug = DebugManager.attachScene(MenuScene.KEY);
  private loginRewardModalOpen = false;

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

    this.add.text(40, 28, 'BATTLE DICE: AUTOROLLER', {
      fontFamily: 'Orbitron',
      fontSize: '32px',
      color: PALETTE.text
    });

    this.add.text(42, 62, 'Random Dice-inspired lane battler', {
      fontFamily: 'Orbitron',
      fontSize: '12px',
      color: PALETTE.textMuted
    });


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

    this.ensureUsername();
    this.maybeGrantNewUserLoginReward();
    this.openTab(MENU_TABS.find((tab) => tab.sceneKey === this.activeSceneKey) ?? MENU_TABS[2]);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.tabButtons = [];
    });
  }

  private openTab(tab: MenuTab) {
    AudioManager.playSfx(this, 'ui-click');
    if (this.scene.isActive(this.activeSceneKey)) {
      this.scene.stop(this.activeSceneKey);
    }
    AudioManager.playMusic(this, 'menu-music');

    this.activeSceneKey = tab.sceneKey;
    this.debug.event('Opening tab.', { tab: tab.label, sceneKey: tab.sceneKey, status: tab.status });
    this.scene.launch(tab.sceneKey);
    this.scene.bringToTop(MenuScene.KEY);
    if (tab.sceneKey === SCENE_KEYS.Arena) {
      if (this.scene.isActive(SCENE_KEYS.Settings)) this.scene.stop(SCENE_KEYS.Settings);
    } else {
      if (!this.scene.isActive(SCENE_KEYS.Settings)) this.scene.launch(SCENE_KEYS.Settings);
      this.scene.bringToTop(SCENE_KEYS.Settings);
    }
    this.refreshTabs();

    if (tab.status === 'WIP') {
      AlertManager.toast(this, {
        type: 'warning',
        message: `${tab.label} is a work-in-progress surface.`
      });
    }
  }

  private ensureUsername() {
    const profile = ProfileStore.get(this);
    if (profile.username.trim()) return;
    const entry = window.prompt('Create your username (1-18 chars)', 'Player');
    const username = (entry ?? '').trim().slice(0, 18) || 'Player';
    ProfileStore.set(this, { username });
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

  private maybeGrantNewUserLoginReward() {
    const profile = ProfileStore.get(this);
    const createdAt = profile.createdAt ? new Date(profile.createdAt) : undefined;
    const isNewUser = !createdAt || (Date.now() - createdAt.getTime()) <= (7 * 24 * 60 * 60 * 1000);
    if (!isNewUser) return;
    const reward = profile.loginReward ?? { startDate: new Date().toISOString().slice(0, 10), claimedDays: [] as number[] };
    const claimed = new Set(reward.claimedDays);
    const day = Math.max(1, Math.min(7, claimed.size + 1));
    if (claimed.has(day)) return;

    let message = '';
    if (day === 1) { setDiamonds(this, getDiamonds(this) + 50); message = '+50 Diamonds'; }
    if (day === 2) { setDiceTokens(this, getDiceTokens(this) + 1000); message = '+1,000 Dice Tokens'; }
    if (day === 3) { message = '+20 Casino Chips'; this.registry.events.emit('casino:grantChips', 20); }
    if (day === 4) { setDiamonds(this, getDiamonds(this) + 100); message = '+100 Diamonds'; }
    if (day === 5) { setDiceTokens(this, getDiceTokens(this) + 2500); message = '+2,500 Dice Tokens'; }
    if (day === 6) { message = '+50 Casino Chips'; this.registry.events.emit('casino:grantChips', 50); }
    if (day === 7) {
      const legendaries = getAllDiceDefinitions(this).filter((d) => d.rarity === 'Legendary');
      const pick = legendaries[Math.floor(Math.random() * legendaries.length)];
      if (pick) grantDiceCopies(this, pick.typeId, 1);
      AchievementStore.unlock(this, 'darkest_hour');
      message = 'Free Random Legendary Dice!';
    }
    claimed.add(day);
    ProfileStore.set(this, {
      loginReward: {
        ...reward,
        claimedDays: [...claimed].sort((a, b) => a - b),
        lastClaimDate: new Date().toISOString().slice(0, 10)
      }
    });
    this.openLoginRewardModal(day, message);
  }

  private openLoginRewardModal(day: number, rewardText: string) {
    if (this.loginRewardModalOpen) return;
    this.loginRewardModalOpen = true;
    const { width, height } = this.scale;
    const overlay = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.72).setDepth(200).setInteractive();
    const panel = this.add.rectangle(width / 2, height / 2, 540, 300, 0x102434, 0.98).setDepth(201).setStrokeStyle(2, 0x406987);
    const title = this.add.text(width / 2, height / 2 - 90, `NEW USER LOGIN REWARD — DAY ${day}`, { fontFamily: 'Orbitron', fontSize: '19px', color: PALETTE.accentSoft }).setOrigin(0.5).setDepth(202);
    const subtitle = this.add.text(width / 2, height / 2 - 28, rewardText, { fontFamily: 'Orbitron', fontSize: '22px', color: PALETTE.text }).setOrigin(0.5).setDepth(202);
    const hint = this.add.text(width / 2, height / 2 + 18, 'Click CLAIM! to continue', { fontFamily: 'Orbitron', fontSize: '13px', color: PALETTE.textMuted }).setOrigin(0.5).setDepth(202);
    const claim = this.add.text(width / 2, height / 2 + 74, 'CLAIM!', { fontFamily: 'Orbitron', fontSize: '18px', color: '#000000', backgroundColor: '#f4b860', padding: { left: 18, right: 18, top: 8, bottom: 8 } })
      .setOrigin(0.5).setDepth(203).setInteractive({ useHandCursor: true });
    claim.on('pointerdown', () => {
      [overlay, panel, title, subtitle, hint, claim].forEach((node) => node.destroy());
      this.loginRewardModalOpen = false;
      AlertManager.toast(this, { type: 'success', message: `Claimed Day ${day}: ${rewardText}` });
    });
  }
}
