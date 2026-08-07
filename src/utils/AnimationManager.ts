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

    const isRenderable = (die: Phaser.GameObjects.Image | undefined) => Boolean(die && die.scene && die.active && die.texture && die.frame);
    const liveDice = diceSprites.filter((die) => isRenderable(die));
    if (!scene.sys.isActive() || liveDice.length === 0) return;

    liveDice.forEach((die) => {
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

          liveDice.forEach((die, index) => {
            if (!isRenderable(die) || !scene.sys.isActive()) return;
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

            if (!die.scene) return;
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

          liveDice.forEach((die, index) => {
            if (!isRenderable(die) || !scene.sys.isActive()) return;
            const originalX = Number(die.getData('originalX'));
            const originalY = Number(die.getData('originalY'));
            const finalFace = finalFaces[index] ?? Phaser.Math.Between(1, 6);

            die.setTexture(`${textureKeyPrefix}${finalFace}`);
            if (!die.scene) return;
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

  static animateElementalSkill(scene: Phaser.Scene, x: number, y: number, kind: 'ice' | 'fire' | 'electric' | 'poison' | 'wind' | 'physical', tintOrOptions?: number | { tint?: number; animated?: boolean; duration?: number }) {
    const options = typeof tintOrOptions === 'number' ? { tint: tintOrOptions } : (tintOrOptions ?? {});
    const g = scene.add.graphics().setDepth(255);
    const color = options.tint ?? ({ ice: 0x8fd5ff, fire: 0xff8a4c, electric: 0xfff176, poison: 0x74d66f, wind: 0x9fe7d9, physical: 0xe8eef4 } as const)[kind];

    if (kind === 'wind') {
      for (let i = 0; i < 3; i += 1) {
        g.lineStyle(2, color, 0.8 - i * 0.2);
        g.strokeCircle(x, y, 14 + i * 9);
      }
    } else if (kind === 'ice') {
      g.lineStyle(2, 0x8fd5ff, 0.9);
      g.strokeRect(x - 18, y - 18, 36, 36);
    } else if (kind === 'fire') {
      g.fillStyle(0xff8a3d, 0.25);
      g.fillTriangle(x, y - 18, x - 14, y + 16, x + 14, y + 16);
    } else if (kind === 'poison') {
      g.fillStyle(0x74d66f, 0.28);
      g.fillCircle(x, y, 14);
      g.fillCircle(x + 12, y - 8, 7);
    } else if (kind === 'electric') {
      g.lineStyle(2, 0xffef7a, 0.95);
      g.beginPath();
      g.moveTo(x - 12, y - 10);
      g.lineTo(x - 2, y - 2);
      g.lineTo(x - 8, y + 2);
      g.lineTo(x + 4, y + 12);
      g.lineTo(x - 2, y + 2);
      g.lineTo(x + 10, y - 4);
      g.strokePath();
    } else if (kind === 'physical') {
      g.fillStyle(0xe8eef4, 0.3);
      g.fillCircle(x, y, 12);
      g.lineStyle(3, 0xffffff, 0.9);
      g.strokeCircle(x, y, 16);
    }

    if (options.animated === false) {
      scene.time.delayedCall(options.duration ?? 320, () => g.destroy());
      return;
    }

    scene.tweens.add({ targets: g, alpha: 0, scale: 1.25, duration: options.duration ?? 320, onComplete: () => g.destroy() });
  }
  
  static animateDrizzleRain(scene: Phaser.Scene, x: number, y: number, tint = 0x6fb7ff) {
    const rain = scene.add.graphics().setDepth(264).setPosition(x, y - 34);
    rain.lineStyle(2, tint, 0.78);
    const drops = [-24, -16, -7, 3, 13, 23];
    drops.forEach((offset, index) => {
      const dropY = (index % 3) * 8;
      rain.lineBetween(offset, dropY, offset - 3, dropY + 13);
    });
    const splash = scene.add.graphics().setDepth(265).setPosition(x, y + 15).setAlpha(0);
    splash.lineStyle(2, tint, 0.9);
    splash.arc(0, 0, 16, Phaser.Math.DegToRad(205), Phaser.Math.DegToRad(335), false);
    scene.tweens.add({
      targets: rain,
      y: y + 8,
      alpha: 0,
      duration: 280,
      ease: 'Cubic.easeIn',
      onComplete: () => rain.destroy()
    });
    scene.tweens.add({
      targets: splash,
      alpha: 0.9,
      scale: 1.25,
      duration: 110,
      delay: 170,
      yoyo: true,
      onComplete: () => splash.destroy()
    });
  }

  static animateDoubleSwipe(scene: Phaser.Scene, x: number, y: number, color: number, duration = 280) {
    const leftSlash = scene.add.graphics().setDepth(266).setPosition(x, y);
    const rightSlash = scene.add.graphics().setDepth(266).setPosition(x, y);
    const glow = scene.add.graphics().setDepth(265).setPosition(x, y);
    leftSlash.lineStyle(4, color, 0.95);
    leftSlash.beginPath();
    leftSlash.moveTo(-30, -20);
    leftSlash.lineTo(7, 20);
    leftSlash.strokePath();
    rightSlash.lineStyle(4, color, 0.95);
    rightSlash.beginPath();
    rightSlash.moveTo(30, -20);
    rightSlash.lineTo(-7, 20);
    rightSlash.strokePath();
    glow.lineStyle(8, color, 0.22);
    glow.strokeCircle(0, 0, 22);
    [leftSlash, rightSlash].forEach((slash) => slash.setAlpha(0));
    scene.tweens.add({
      targets: leftSlash,
      alpha: 1,
      scaleX: 1.12,
      duration: duration * 0.42,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        scene.tweens.add({ targets: leftSlash, alpha: 0, duration: duration * 0.38, onComplete: () => leftSlash.destroy() });
      }
    });
    scene.tweens.add({
      targets: rightSlash,
      alpha: 1,
      scaleX: 1.12,
      duration: duration * 0.42,
      delay: duration * 0.25,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        scene.tweens.add({ targets: rightSlash, alpha: 0, duration: duration * 0.38, onComplete: () => rightSlash.destroy() });
      }
    });
    scene.tweens.add({
      targets: glow,
      alpha: 0,
      scale: 1.35,
      duration,
      ease: 'Quad.easeOut',
      onComplete: () => glow.destroy()
    });
  }

  static animateFracture(scene: Phaser.Scene, x: number, y: number) {
    const g = scene.add.graphics().setDepth(260);
    g.fillStyle(0xff4da6, 0.22);
    g.fillRoundedRect(x - 23, y - 23, 46, 46, 12);
    g.lineStyle(4, 0xff9bd0, 0.98);
    g.strokeRoundedRect(x - 23, y - 23, 46, 46, 12);
    g.lineStyle(3, 0x331127, 0.98);
    g.beginPath();
    g.moveTo(x - 3, y - 20);
    g.lineTo(x + 6, y - 7);
    g.lineTo(x - 5, y + 3);
    g.lineTo(x + 4, y + 20);
    g.strokePath();
    scene.time.delayedCall(800, () => g.destroy());
  }

  static animateSoulHarvest(scene: Phaser.Scene, fromX: number, fromY: number, toX: number, toY: number, enemySide = false) {
    const color = enemySide ? 0xff5b5b : 0x5ab7ff;
    const soul = scene.add.graphics().setDepth(270);
    soul.fillStyle(color, 0.88);
    soul.fillCircle(0, 0, 7);
    soul.fillCircle(-4, -5, 4);
    soul.fillCircle(4, -5, 4);
    soul.setPosition(fromX, fromY);
    const trail = scene.add.graphics().setDepth(269);
    scene.tweens.add({
      targets: soul,
      x: toX,
      y: toY,
      scaleX: 0.55,
      scaleY: 0.55,
      duration: 620,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        trail.clear();
        trail.lineStyle(2, color, 0.32);
        trail.strokeLineShape(new Phaser.Geom.Line(fromX, fromY, soul.x, soul.y));
      },
      onComplete: () => {
        const burst = scene.add.graphics().setDepth(271);
        burst.lineStyle(2, color, 0.9);
        burst.strokeCircle(toX, toY, 12);
        scene.tweens.add({ targets: burst, alpha: 0, scale: 1.8, duration: 260, onComplete: () => burst.destroy() });
        trail.destroy();
        soul.destroy();
      }
    });
  }
  
  static animateGrowthTurn(scene: Phaser.Scene, x: number, y: number, color: number, success = true) {
    if (success) {
      const arrow = scene.add.graphics().setDepth(262).setPosition(x, y);
      arrow.lineStyle(4, color, 0.95);
      arrow.beginPath();
      arrow.arc(0, 0, 20, Phaser.Math.DegToRad(35), Phaser.Math.DegToRad(320), false);
      arrow.strokePath();
      arrow.fillStyle(color, 0.95);
      arrow.fillTriangle(16, -16, 29, -15, 21, -3);
      scene.tweens.add({
        targets: arrow,
        angle: 360,
        duration: 900,
        ease: 'Sine.easeInOut',
        onComplete: () => arrow.destroy()
      });
      return;
    }

    const burst = scene.add.graphics().setDepth(263).setPosition(x, y);
    burst.fillStyle(0xb86cff, 0.34);
    burst.fillCircle(0, 0, 13);
    burst.lineStyle(3, 0xe1b4ff, 0.95);
    for (let i = 0; i < 10; i += 1) {
      const angle = (Math.PI * 2 * i) / 10;
      const inner = 9 + (i % 2) * 4;
      const outer = 26 + (i % 3) * 5;
      burst.lineBetween(Math.cos(angle) * inner, Math.sin(angle) * inner, Math.cos(angle) * outer, Math.sin(angle) * outer);
    }
    burst.lineStyle(2, 0xffffff, 0.7);
    burst.strokeCircle(0, 0, 18);
    scene.tweens.add({
      targets: burst,
      alpha: 0,
      scale: 1.45,
      duration: 420,
      ease: 'Back.easeOut',
      onComplete: () => burst.destroy()
    });
  }

  static animateElectricChain(scene: Phaser.Scene, fromX: number, fromY: number, toX: number, toY: number, duration = 220) {
    const chain = scene.add.graphics().setDepth(264);
    const glow = scene.add.graphics().setDepth(263);
    const progress = { value: 0 };
    const redraw = () => {
      chain.clear();
      glow.clear();
      const endX = Phaser.Math.Linear(fromX, toX, progress.value);
      const endY = Phaser.Math.Linear(fromY, toY, progress.value);
      const distance = Phaser.Math.Distance.Between(fromX, fromY, endX, endY);
      const angle = Math.atan2(toY - fromY, toX - fromX);
      const normalX = -Math.sin(angle);
      const normalY = Math.cos(angle);
      const segments = Math.max(2, Math.ceil(distance / 18));
      const points = [{ x: fromX, y: fromY }];
      for (let i = 1; i < segments; i += 1) {
        const fraction = i / segments;
        const jitter = (i % 2 === 0 ? 5 : -5) * Math.min(1, progress.value * 2);
        points.push({
          x: Phaser.Math.Linear(fromX, endX, fraction) + normalX * jitter,
          y: Phaser.Math.Linear(fromY, endY, fraction) + normalY * jitter
        });
      }
      points.push({ x: endX, y: endY });
      glow.lineStyle(10, 0xffd83d, 0.22);
      glow.beginPath();
      glow.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((point) => glow.lineTo(point.x, point.y));
      glow.strokePath();
      chain.lineStyle(3, 0xfff176, 0.98);
      chain.beginPath();
      chain.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((point) => chain.lineTo(point.x, point.y));
      chain.strokePath();
    };
    redraw();
    scene.tweens.add({
      targets: progress,
      value: 1,
      duration,
      ease: 'Cubic.easeOut',
      onUpdate: redraw,
      onComplete: () => {
        scene.tweens.add({
          targets: [chain, glow],
          alpha: 0,
          duration: 100,
          onComplete: () => {
            chain.destroy();
            glow.destroy();
          }
        });
      }
    });
  }

  static animateHeatwave(scene: Phaser.Scene, x: number, y: number) {
    const g = scene.add.graphics().setDepth(258);
    g.fillStyle(0xff6a2a, 0.24);
    g.fillCircle(x, y, 18);
    for (let i = 0; i < 5; i += 1) {
      const angle = (Math.PI * 2 * i) / 5;
      const tipX = x + Math.cos(angle) * 26;
      const tipY = y + Math.sin(angle) * 26;
      g.fillStyle(i % 2 === 0 ? 0xffb347 : 0xff5c2a, 0.72);
      g.fillTriangle(x, y, tipX - Math.sin(angle) * 7, tipY + Math.cos(angle) * 7, tipX + Math.sin(angle) * 7, tipY - Math.cos(angle) * 7);
    }
    scene.tweens.add({ targets: g, alpha: 0, scale: 1.55, duration: 360, ease: 'Quad.easeOut', onComplete: () => g.destroy() });
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

  static animateHealingBeam(scene: Phaser.Scene, ax: number, ay: number, tx: number, ty: number) {
    const g = scene.add.graphics().setDepth(259);
    g.lineStyle(4, 0x8ff0b8, 0.8);
    g.strokeLineShape(new Phaser.Geom.Line(ax, ay, tx, ty));
    g.lineStyle(9, 0xd2ffe5, 0.22);
    g.strokeLineShape(new Phaser.Geom.Line(ax, ay, tx, ty));
    scene.tweens.add({ targets: g, alpha: 0, duration: 300, onComplete: () => g.destroy() });
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

  static animateAchievementPopup(scene: Phaser.Scene, achievementId: string, onComplete?: () => void) {
    const { width, height } = scene.scale;
    const startY = height + 80;
    const restY = height - 72;
    const popupContainer = scene.add.container(width / 2, startY).setDepth(1000);
    
    const bg = scene.add.rectangle(0, 0, 200, 70, 0x1a3a52, 0.95)
      .setStrokeStyle(2, 0xf4b860);
    const title = scene.add.text(0, -20, 'ACHIEVEMENT UNLOCKED', {
      fontFamily: 'Orbitron',
      fontSize: '10px',
      color: '#f4b860'
    }).setOrigin(0.5);
    const name = scene.add.text(0, 10, achievementId.replace(/_/g, ' ').toUpperCase(), {
      fontFamily: 'Orbitron',
      fontSize: '14px',
      color: '#ffffff',
      wordWrap: { width: 180 }
    }).setOrigin(0.5);
    
    popupContainer.add([bg, title, name]);
    
    // Animate in from below (middle-bottom HUD area)
    scene.tweens.add({
      targets: popupContainer,
      y: restY,
      duration: 500,
      ease: 'Back.easeOut'
    });
    
    // Keep the popup gently floating while visible.
    const floatTween = scene.tweens.add({
      targets: popupContainer,
      y: restY - 10,
      duration: 500,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
      delay: 500
    });

    // Around 3 seconds of on-screen time after open animation.
    scene.time.delayedCall(3500, () => {
      floatTween.stop();
      scene.tweens.add({
        targets: popupContainer,
        y: startY,
        alpha: 0,
        duration: 400,
        ease: 'Sine.easeIn',
        onComplete: () => {
          popupContainer.destroy();
          if (onComplete) onComplete();
        }
      });
    });
    
    return popupContainer;
  }
}
