import Phaser from 'phaser';

type FadeTarget = Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.AlphaSingle;

export class AnimationManager {
  static fadeIn(
    scene: Phaser.Scene,
    targets: FadeTarget | FadeTarget[],
    duration = 250
  ) {
    const list = Array.isArray(targets) ? targets : [targets];
    list.forEach((target) => target.setAlpha(0));

    scene.tweens.add({
      targets: list,
      alpha: 1,
      duration,
      ease: 'Sine.easeOut'
    });
  }

  static fadeOut(
    scene: Phaser.Scene,
    targets: FadeTarget | FadeTarget[],
    duration = 250,
    onComplete?: () => void
  ) {
    const list = Array.isArray(targets) ? targets : [targets];

    scene.tweens.add({
      targets: list,
      alpha: 0,
      duration,
      ease: 'Sine.easeIn',
      onComplete
    });
  }

  static pulse(scene: Phaser.Scene, target: Phaser.GameObjects.GameObject, scale = 1.04, duration = 180) {
    scene.tweens.add({
      targets: target,
      scaleX: scale,
      scaleY: scale,
      duration,
      ease: 'Quad.easeOut',
      yoyo: true
    });
  }

  static async animateDiceRoll(
    scene: Phaser.Scene,
    finalFaces: number[],
    diceSprites: Phaser.GameObjects.Image[],
    options: { locked?: boolean[]; textureKeyPrefix?: string; jitter?: number } = {}
  ): Promise<void> {
    const duration = 700;
    const jitter = options.jitter ?? 12;
    const interval = 40;
    const locked = options.locked ?? [];
    const textureKeyPrefix = options.textureKeyPrefix ?? 'dice-face-';
    let elapsed = 0;

    diceSprites.forEach((die) => {
      die.setVisible(true);
      die.setScale(1);
      die.setAngle(0);
      die.setData('originalX', die.x);
      die.setData('originalY', die.y);
    });

    await new Promise<void>((resolve) => {
      const timer = scene.time.addEvent({
        delay: interval,
        loop: true,
        callback: () => {
          elapsed += interval;

          diceSprites.forEach((die, index) => {
            const originalX = Number(die.getData('originalX'));
            const originalY = Number(die.getData('originalY'));
            const tempFace = Phaser.Math.Between(1, 6);

            if (!locked[index]) {
              die.setTexture(`${textureKeyPrefix}${tempFace}`);
              die.setPosition(
                originalX + Phaser.Math.Between(-jitter, jitter),
                originalY + Phaser.Math.Between(-jitter, jitter)
              );
            }

            scene.tweens.add({
              targets: die,
              x: originalX,
              y: originalY,
              duration: 50,
              ease: 'Quad.easeOut'
            });
          });

          if (elapsed < duration) {
            return;
          }

          timer.remove(false);

          diceSprites.forEach((die, index) => {
            const originalX = Number(die.getData('originalX'));
            const originalY = Number(die.getData('originalY'));
            const finalFace = finalFaces[index] ?? Phaser.Math.Between(1, 6);

            die.setTexture(`${textureKeyPrefix}${finalFace}`);
            scene.tweens.add({
              targets: die,
              angle: { from: Phaser.Math.Between(-180, 180), to: 0 },
              scale: { from: 0.6, to: 1 },
              x: originalX,
              y: originalY,
              duration: 300,
              ease: 'Back.easeOut'
            });
          });

          resolve();
        }
      });
    });
  }

  static animateJudgmentHammer(scene: Phaser.Scene, x: number, y: number, duration = 420) {
    const g = scene.add.graphics().setDepth(260);
    g.lineStyle(2, 0xff4d4d, 0.95);
    g.strokeCircle(x, y, 64 * 1.4);
    g.fillStyle(0xff4d4d, 0.16);
    g.fillCircle(x, y, 64 * 1.35);
    g.fillStyle(0xd8d8d8, 0.95);
    g.fillRect(x - 7, y - 100, 14, 52);
    g.fillStyle(0x8c8c8c, 1);
    g.fillRect(x - 20, y - 56, 40, 26);
    scene.tweens.add({ targets: g, alpha: 0, duration, onComplete: () => g.destroy() });
  }

  static animateElementalSkill(scene: Phaser.Scene, x: number, y: number, kind: 'ice' | 'fire' | 'electric' | 'poison' | 'wind', tint?: number) {
    const g = scene.add.graphics().setDepth(255);
    const color = tint ?? ({ ice: 0x8fd5ff, fire: 0xff8a4c, electric: 0xfff176, poison: 0x74d66f, wind: 0x9fe7d9 } as const)[kind];
    if (kind === 'wind') {
      for (let i = 0; i < 3; i++) {
        g.lineStyle(2, color, 0.8 - i * 0.2);
        g.strokeCircle(x, y, 14 + i * 9);
      }
    } else {
      g.lineStyle(3, color, 0.9);
      g.strokeCircle(x, y, 16);
      g.fillStyle(color, 0.2);
      g.fillCircle(x, y, 18);
    }
    scene.tweens.add({ targets: g, alpha: 0, scale: 1.25, duration: 320, onComplete: () => g.destroy() });
  }

  static animateSkullRevive(scene: Phaser.Scene, x: number, y: number) {
    const g = scene.add.graphics().setDepth(260);
    g.lineStyle(3, 0xd8e4e8, 0.9);
    g.strokeLineShape(new Phaser.Geom.Line(x - 14, y + 14, x + 14, y - 14));
    g.strokeLineShape(new Phaser.Geom.Line(x - 14, y - 14, x + 14, y + 14));
    scene.tweens.add({ targets: g, y: y - 8, alpha: 0, duration: 500, onComplete: () => g.destroy() });
  }

  static animateDeathTransform(scene: Phaser.Scene, x: number, y: number) {
    const g = scene.add.graphics().setDepth(260);
    g.lineStyle(3, 0xc06bdb, 0.95);
    g.strokeCircle(x, y, 20);
    g.lineStyle(2, 0xe7b6ff, 0.95);
    g.strokeCircle(x + 20, y, 6);
    scene.tweens.add({ targets: g, alpha: 0, scale: 3, duration: 500, onComplete: () => g.destroy() });
  }


  static animateBatteryCharge(scene: Phaser.Scene, x: number, y: number, color: number) {
    const g = scene.add.graphics().setDepth(320).setAlpha(0);
    g.fillStyle(color, 0.4);
    g.fillCircle(x, y, 10);
    scene.tweens.add({
      targets: g,
      alpha: 0.95,
      scaleX: 2.2,
      scaleY: 2.2,
      duration: 250,
      yoyo: true,
      onComplete: () => g.destroy()
    });
  }

  static animateLightCombatStart(scene: Phaser.Scene, x: number, y: number, upArrows: number) {
    const sparkle = scene.add.graphics().setDepth(320).setAlpha(0);
    sparkle.lineStyle(2, 0xffe066, 0.95);
    sparkle.strokeCircle(x, y, 12);
    sparkle.lineStyle(1, 0xfff4b0, 0.9);
    sparkle.strokeCircle(x, y, 20);
    scene.tweens.add({ targets: sparkle, alpha: 1, scale: 1.3, duration: 750, yoyo: true, onComplete: () => sparkle.destroy() });

    for (let i = 0; i < Math.max(1, upArrows); i += 1) {
      const t = scene.add.text(x - 10 + i * 8, y + 10, '↑', { fontFamily: 'Orbitron', fontSize: '14px', color: '#ffe066' }).setOrigin(0.5).setDepth(321);
      scene.tweens.add({ targets: t, y: y - 24 - i * 2, alpha: 0, duration: 1500, onComplete: () => t.destroy() });
    }
  }

  static animateTimeActive(scene: Phaser.Scene, x: number, y: number) {
    const t = scene.add.text(x, y - 20, '⏰', { fontSize: '16px', color: '#ffffff' }).setOrigin(0.5).setDepth(260);
    const r = scene.add.graphics().setDepth(259);
    r.lineStyle(2, 0x8fd5ff, 0.95);
    r.strokeCircle(x, y, 16);
    scene.tweens.add({ targets: [t, r], alpha: 0, y: y - 30, duration: 450, onComplete: () => { t.destroy(); r.destroy(); } });
  }

  static animateHealingPulse(scene: Phaser.Scene, x: number, y: number) {
    const g = scene.add.graphics().setDepth(260);
    g.lineStyle(3, 0x8ff0b8, 0.95);
    g.strokeCircle(x, y, 14);
    g.lineStyle(2, 0xd2ffe5, 0.9);
    g.strokeCircle(x, y, 24);
    scene.tweens.add({ targets: g, alpha: 0, scale: 1.8, duration: 320, onComplete: () => g.destroy() });
  }

  static animateSpearStrike(scene: Phaser.Scene, ax: number, ay: number, tx: number, ty: number) {
    const g = scene.add.graphics().setDepth(260);
    g.lineStyle(8, 0x8fd5ff, 0.95);
    g.strokeLineShape(new Phaser.Geom.Line(ax, ay, tx, ty));
    g.lineStyle(14, 0xc8f0ff, 0.35);
    g.strokeLineShape(new Phaser.Geom.Line(ax, ay, tx, ty));
    scene.tweens.add({ targets: g, alpha: 0, duration: 280, onComplete: () => g.destroy() });
  }

  static animateTranscendenceBeamFx(scene: Phaser.Scene, attackerX: number, attackerY: number, targetGridX: number, rowY: number, targetX: number, targetY: number, boardWidth: number) {
    const g = scene.add.graphics().setDepth(260);
    g.lineStyle(5, 0x6ff6ff, 0.94);
    g.strokeLineShape(new Phaser.Geom.Line(attackerX, attackerY, targetX, targetY));
    g.lineStyle(8, 0x6ff6ff, 0.55);
    g.strokeLineShape(new Phaser.Geom.Line(targetGridX, rowY, targetGridX + boardWidth, rowY));
    g.lineStyle(13, 0xcffcff, 0.22);
    g.strokeLineShape(new Phaser.Geom.Line(targetGridX, rowY, targetGridX + boardWidth, rowY));
    scene.tweens.add({ targets: g, alpha: 0, scale: 1.04, duration: 520, onComplete: () => g.destroy() });
  }

}
