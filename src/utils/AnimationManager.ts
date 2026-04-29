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
    diceSprites: Phaser.GameObjects.Image[]
  ): Promise<void> {
    const duration = 700;
    const jitter = 12;
    const interval = 40;
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

          diceSprites.forEach((die) => {
            const originalX = Number(die.getData('originalX'));
            const originalY = Number(die.getData('originalY'));
            const tempFace = Phaser.Math.Between(1, 6);

            die.setTexture(`dice${tempFace}`);
            die.setPosition(
              originalX + Phaser.Math.Between(-jitter, jitter),
              originalY + Phaser.Math.Between(-jitter, jitter)
            );

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

            die.setTexture(`dice${finalFace}`);
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
}
