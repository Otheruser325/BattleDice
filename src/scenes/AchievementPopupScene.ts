import Phaser from 'phaser';
import { AchievementStore } from '../systems/AchievementStore';
import { AnimationManager } from '../utils/AnimationManager';
import { SCENE_KEYS } from './sceneKeys';

export class AchievementPopupScene extends Phaser.Scene {
  static readonly KEY = SCENE_KEYS.AchievementPopup;
  private popupActive = false;
  private popupTimer: Phaser.Time.TimerEvent | null = null;

  constructor() {
    super(AchievementPopupScene.KEY);
  }

  create() {
    this.popupTimer = this.time.addEvent({
      delay: 100,
      loop: true,
      callback: () => this.checkPendingPopups()
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.popupTimer?.destroy();
      this.popupTimer = null;
      this.popupActive = false;
    });
  }

  private checkPendingPopups() {
    if (this.popupActive) return;
    const nextPopup = AchievementStore.getPendingPopups()[0];
    if (!nextPopup) return;
    this.popupActive = true;
    this.scene.bringToTop(AchievementPopupScene.KEY);
    AnimationManager.animateAchievementPopup(this, nextPopup.id, () => {
      AchievementStore.clearPendingPopup(nextPopup.id);
      this.popupActive = false;
    });
  }
}
