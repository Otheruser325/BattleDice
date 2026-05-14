import Phaser from 'phaser';

type DiceSprite = Phaser.GameObjects.Image & { originalX?: number; originalY?: number };

export async function animateDiceRoll(scene: Phaser.Scene & { diceSprites?: DiceSprite[] }, finalFaces: number[]) {
  const duration = 700;
  const jitter = 12;
  const interval = 40;

  const dice = scene.diceSprites ?? [];
  dice.forEach((die) => {
    die.originalX = die.x;
    die.originalY = die.y;
    die.setVisible(true);
  });

  let elapsed = 0;

  return new Promise<void>((resolve) => {
    const timer = scene.time.addEvent({
      delay: interval,
      loop: true,
      callback: () => {
        elapsed += interval;

        dice.forEach((die) => {
          const temp = Phaser.Math.Between(1, 6);
          die.setTexture(`dice-face-${temp}`);

          const ox = Phaser.Math.Between(-jitter, jitter);
          const oy = Phaser.Math.Between(-jitter, jitter);
          die.x += ox;
          die.y += oy;

          scene.tweens.add({
            targets: die,
            x: die.originalX,
            y: die.originalY,
            duration: 50,
            ease: 'Quad.easeOut'
          });
        });

        if (elapsed >= duration) {
          timer.remove(false);

          dice.forEach((die, i) => {
            const face = finalFaces[i] ?? Phaser.Math.Between(1, 6);
            die.setTexture(`dice-face-${face}`);

            scene.tweens.add({
              targets: die,
              angle: Phaser.Math.Between(-90, 90),
              scale: 1,
              duration: 300,
              ease: 'Back.easeOut',
              onStart: () => {
                die.angle = Phaser.Math.Between(-180, 180);
                die.setScale(0.6);
              },
              onComplete: () => {
                die.angle = 0;
              }
            });
          });

          resolve();
        }
      }
    });
  });
}

export function animateJudgmentHammer(
  scene: Phaser.Scene,
  x: number,
  y: number,
  duration = 420
) {
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


export function animateElementalSkill(scene: Phaser.Scene, x: number, y: number, kind: 'ice'|'fire'|'electric'|'poison'|'wind', tint?: number) {
  const g = scene.add.graphics().setDepth(255);
  const color = tint ?? ({ ice:0x8fd5ff, fire:0xff8a4c, electric:0xfff176, poison:0x74d66f, wind:0x9fe7d9 } as const)[kind];
  if (kind === 'wind') {
    for (let i=0;i<3;i++){ g.lineStyle(2, color, 0.8 - i*0.2); g.strokeCircle(x, y, 14 + i*9); }
  } else {
    g.lineStyle(3, color, 0.9); g.strokeCircle(x, y, 16); g.fillStyle(color, 0.2); g.fillCircle(x, y, 18);
  }
  scene.tweens.add({ targets:g, alpha:0, scale:1.25, duration:320, onComplete:()=>g.destroy() });
}

export function animateMeteorImpact(scene: Phaser.Scene, x: number, y: number) {
  const g = scene.add.graphics().setDepth(258);
  g.fillStyle(0xff8a4c, 0.9); g.fillCircle(x, y-40, 10);
  g.lineStyle(4, 0xffc27a, 0.9); g.strokeLineShape(new Phaser.Geom.Line(x-5, y-65, x, y-42));
  scene.tweens.add({targets:g, y:'+=42', alpha:0, duration:260, onComplete:()=>g.destroy()});
}
