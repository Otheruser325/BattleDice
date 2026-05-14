import Phaser from 'phaser';

type DiceSprite = Phaser.GameObjects.Image & {
  originalX?: number;
  originalY?: number;
};

type DiceRollOptions = {
  locked?: boolean[];
  finalScale?: number;
};

export async function animateDiceRoll(
  scene: Phaser.Scene & { diceSprites?: DiceSprite[] },
  finalFaces: number[],
  options: DiceRollOptions = {}
) {
  const duration = 700;
  const locked = options.locked ?? [];
  const finalScale = options.finalScale ?? 1.12;
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

        dice.forEach((die, i) => {
          if (locked[i]) return;
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

            if (locked[i]) {
              die.x = die.originalX ?? die.x;
              die.y = die.originalY ?? die.y;
              die.angle = 0;
              die.setScale(1);
              return;
            }

            scene.tweens.add({
              targets: die,
              angle: Phaser.Math.Between(-90, 90),
              scale: finalScale,
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

export function animateJudgmentHammer(scene: Phaser.Scene, x: number, y: number, duration = 420) {
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

export function animateElementalSkill(
  scene: Phaser.Scene,
  x: number,
  y: number,
  kind: 'ice' | 'fire' | 'electric' | 'poison' | 'wind',
  tint?: number
) {
  const g = scene.add.graphics().setDepth(255);
  const color = tint ??
    ({ ice: 0x8fd5ff, fire: 0xff8a4c, electric: 0xfff176, poison: 0x74d66f, wind: 0x9fe7d9 } as const)[kind];

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

  scene.tweens.add({
    targets: g,
    alpha: 0,
    scale: 1.25,
    duration: 320,
    onComplete: () => g.destroy()
  });
}

export function animateMeteorImpact(scene: Phaser.Scene, x: number, y: number) {
  const g = scene.add.graphics().setDepth(258);
  g.fillStyle(0xff8a4c, 0.9);
  g.fillCircle(x, y - 40, 10);
  g.lineStyle(4, 0xffc27a, 0.9);
  g.strokeLineShape(new Phaser.Geom.Line(x - 5, y - 65, x, y - 42));
  scene.tweens.add({ targets: g, y: '+=42', alpha: 0, duration: 260, onComplete: () => g.destroy() });
}

export function animateSkullRevive(scene: Phaser.Scene, x: number, y: number) {
  const g = scene.add.graphics().setDepth(260);
  g.lineStyle(3, 0xd8e4e8, 0.9);
  g.strokeLineShape(new Phaser.Geom.Line(x - 14, y + 14, x + 14, y - 14));
  g.strokeLineShape(new Phaser.Geom.Line(x - 14, y - 14, x + 14, y + 14));
  scene.tweens.add({ targets: g, y: y - 8, alpha: 0, duration: 500, onComplete: () => g.destroy() });
}

export function animateDeathTransform(scene: Phaser.Scene, x: number, y: number) {
  const g = scene.add.graphics().setDepth(260);
  g.lineStyle(3, 0xc06bdb, 0.95);
  g.strokeCircle(x, y, 20);
  g.lineStyle(2, 0xe7b6ff, 0.95);
  g.strokeCircle(x + 20, y, 6);
  scene.tweens.add({ targets: g, alpha: 0, scale: 3, duration: 500, onComplete: () => g.destroy() });
}

export function animateTimeActive(scene: Phaser.Scene, x: number, y: number) {
  const t = scene.add.text(x, y - 20, '⏰', { fontSize: '16px', color: '#ffffff' }).setOrigin(0.5).setDepth(260);
  const r = scene.add.graphics().setDepth(259);
  r.lineStyle(2, 0x8fd5ff, 0.95);
  r.strokeCircle(x, y, 16);
  scene.tweens.add({
    targets: [t, r],
    alpha: 0,
    y: y - 30,
    duration: 450,
    onComplete: () => {
      t.destroy();
      r.destroy();
    }
  });
}

export function animateHealingPulse(scene: Phaser.Scene, x: number, y: number) {
  const g = scene.add.graphics().setDepth(260);
  g.lineStyle(3, 0x8ff0b8, 0.95);
  g.strokeCircle(x, y, 14);
  g.lineStyle(2, 0xd2ffe5, 0.9);
  g.strokeCircle(x, y, 24);
  scene.tweens.add({ targets: g, alpha: 0, scale: 1.8, duration: 320, onComplete: () => g.destroy() });
}

export function animateSpearStrike(scene: Phaser.Scene, ax: number, ay: number, tx: number, ty: number) {
  const g = scene.add.graphics().setDepth(260);
  g.lineStyle(8, 0x8fd5ff, 0.95);
  g.strokeLineShape(new Phaser.Geom.Line(ax, ay, tx, ty));
  g.lineStyle(14, 0xc8f0ff, 0.35);
  g.strokeLineShape(new Phaser.Geom.Line(ax, ay, tx, ty));
  scene.tweens.add({ targets: g, alpha: 0, duration: 280, onComplete: () => g.destroy() });
}

export function animateTranscendenceBeamFx(
  scene: Phaser.Scene,
  attackerX: number,
  attackerY: number,
  targetGridX: number,
  rowY: number,
  targetX: number,
  targetY: number,
  boardWidth: number
) {
  const g = scene.add.graphics().setDepth(260);
  g.lineStyle(5, 0x6ff6ff, 0.94);
  g.strokeLineShape(new Phaser.Geom.Line(attackerX, attackerY, targetX, targetY));
  g.lineStyle(8, 0x6ff6ff, 0.55);
  g.strokeLineShape(new Phaser.Geom.Line(targetGridX, rowY, targetGridX + boardWidth, rowY));
  g.lineStyle(13, 0xcffcff, 0.22);
  g.strokeLineShape(new Phaser.Geom.Line(targetGridX, rowY, targetGridX + boardWidth, rowY));
  scene.tweens.add({ targets: g, alpha: 0, scale: 1.04, duration: 520, onComplete: () => g.destroy() });
}
