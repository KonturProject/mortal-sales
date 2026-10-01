import { GameObjects, Scene } from 'phaser';
import { GAME } from '../core/Constants';

/** Tweened-circle particle burst — no particle plugin needed. */
export function emitBurst(scene: Scene, x: number, y: number, color: number, count = 10) {
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
        const speed = 50 + Math.random() * 70;
        const particle = scene.add.circle(x, y, 2 + Math.random() * 3, color, 1);
        scene.tweens.add({
            targets: particle,
            x: x + Math.cos(angle) * speed,
            y: y + Math.sin(angle) * speed - 20,
            alpha: 0,
            scale: 0.2,
            duration: 380 + Math.random() * 220,
            ease: 'Quad.easeOut',
            onComplete: () => particle.destroy(),
        });
    }
}

export interface TitleStyle {
    size?: number;
    color?: string;
    stroke?: string;
    strokeWidth?: number;
    holdMs?: number;
    depth?: number;
    /** Stays on screen until the returned text is destroyed by the caller (no fade-out). */
    persist?: boolean;
}

/**
 * A big announcement ("FIGHT!", "FINISH HIM!"): slams in from a large scale, holds, fades. One finite tween chain.
 * Resolves when it has faded (or, with `persist`, when it has landed).
 */
export function emitTitle(scene: Scene, x: number, y: number, text: string, style: TitleStyle = {}): { text: GameObjects.Text; done: Promise<void> } {
    const t = scene.add.text(x, y, text, {
        fontFamily: 'Impact, "Arial Black", Arial, sans-serif',
        fontSize: `${style.size ?? 96}px`,
        resolution: GAME.RENDER_SCALE,
        color: style.color ?? '#ffd23a',
    }).setOrigin(0.5).setDepth(style.depth ?? 4000).setStroke(style.stroke ?? '#6b1200', style.strokeWidth ?? 12).setScale(2.6).setAlpha(0);
    const done = new Promise<void>(resolve => {
        scene.tweens.chain({
            targets: t,
            tweens: [
                { scale: 1, alpha: 1, duration: 240, ease: 'Back.easeOut' },
                { scale: 1.04, duration: style.holdMs ?? 700 },
                ...(style.persist ? [] : [{ alpha: 0, scale: 1.12, duration: 320, ease: 'Sine.easeIn' }]),
            ],
            onComplete: () => {
                if (!style.persist) t.destroy();
                resolve();
            },
        });
    });
    return { text: t, done };
}

/** Low puff of floor dust that rolls out sideways — a fall, a landing, a hard step. `dir` biases it (+1 right, -1 left, 0 both ways). */
export function emitDust(scene: Scene, x: number, y: number, size = 1, dir: -1 | 0 | 1 = 0, count = 8) {
    for (let i = 0; i < count; i++) {
        const way = dir !== 0 ? dir : (i % 2 === 0 ? 1 : -1);
        const puff = scene.add.circle(x + (Math.random() - 0.5) * 16 * size, y - 2, (5 + Math.random() * 6) * size, 0xd8ccb8, 0.55)
            .setDepth(y + 2);
        scene.tweens.add({
            targets: puff,
            x: puff.x + way * (20 + Math.random() * 50) * size,
            y: puff.y - (6 + Math.random() * 20) * size,
            scale: 1.8 + Math.random() * 0.8,
            alpha: 0,
            duration: 420 + Math.random() * 300,
            ease: 'Quad.easeOut',
            onComplete: () => puff.destroy(),
        });
    }
}

/** Comic-book impact star: a pointed flash that pops and fades where a blow lands. */
export function emitHitSpark(scene: Scene, x: number, y: number, color: number, big = false) {
    const spark = scene.add.star(x, y, 8, big ? 10 : 6, big ? 42 : 24, 0xffffff, 1).setStrokeStyle(3, color, 1).setDepth(3000).setAngle(Math.random() * 45);
    scene.tweens.add({
        targets: spark,
        scale: { from: 0.4, to: big ? 1.7 : 1.2 },
        alpha: { from: 1, to: 0 },
        angle: spark.angle + 25,
        duration: big ? 320 : 220,
        ease: 'Cubic.easeOut',
        onComplete: () => spark.destroy(),
    });
}

/** Three little stars circling a head for `ms` — a dazed fighter. Finite (one tween), destroyed when done. */
export function emitStunStars(scene: Scene, follow: { x: number; y: number }, headY: number, radius: number, ms: number) {
    const stars = [0, 1, 2].map(() => scene.add.star(0, 0, 5, 3, 7, 0xffe45c, 1).setStrokeStyle(1.5, 0xb8860b, 1).setDepth(3100));
    const orbit = { phase: 0 };
    const place = () => {
        stars.forEach((s, i) => {
            const a = orbit.phase + (i * Math.PI * 2) / 3;
            s.setPosition(follow.x + Math.cos(a) * radius, follow.y + headY + Math.sin(a) * radius * 0.35);
            s.setAngle(a * 57);
        });
    };
    place();
    scene.tweens.add({
        targets: orbit,
        phase: Math.PI * 2 * (ms / 520),
        duration: ms,
        ease: 'Linear',
        onUpdate: place,
        onComplete: () => stars.forEach(s => s.destroy()),
    });
}

/** Small sparkle-shaped burst for celebratory moments (goal reached). */
export function emitSparkles(scene: Scene, x: number, y: number, spread: number, count = 18) {
    for (let i = 0; i < count; i++) {
        const sx = x + (Math.random() - 0.5) * spread;
        const sy = y + (Math.random() - 0.5) * spread * 0.6;
        const star = scene.add.star(sx, sy, 4, 2, 5, 0xffe89a, 1).setScale(0);
        scene.tweens.add({
            targets: star,
            scale: { from: 0, to: 0.8 + Math.random() * 0.6 },
            angle: -90 + Math.random() * 180,
            y: sy - 30 - Math.random() * 40,
            alpha: { from: 1, to: 0 },
            duration: 700 + Math.random() * 500,
            delay: Math.random() * 200,
            ease: 'Cubic.easeOut',
            onComplete: () => star.destroy(),
        });
    }
}

const CONFETTI_COLORS = [0x2fd0e0, 0x36e08a, 0xffe89a, 0xff6688, 0xc9a227];

/** Full-screen falling confetti burst for the weekly-goal finale. */
export function emitConfettiBurst(scene: Scene, count = 120) {
    for (let i = 0; i < count; i++) {
        const x = Math.random() * GAME.WIDTH;
        const color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
        const piece = scene.add.rectangle(x, -10, 6, 10, color, 1).setAngle(Math.random() * 360);
        scene.tweens.add({
            targets: piece,
            y: GAME.HEIGHT + 20,
            angle: piece.angle + (Math.random() > 0.5 ? 360 : -360),
            x: x + (Math.random() - 0.5) * 120,
            duration: 1800 + Math.random() * 1200,
            delay: Math.random() * 500,
            ease: 'Sine.easeIn',
            onComplete: () => piece.destroy(),
        });
    }
}

/** Brief full-screen color pulse(s) — used for both the goal-finale vignette and per-hit color flashes. */
export function flashScreen(scene: Scene, color: number, alpha: number, duration: number, pulses = 1) {
    const rect = scene.add.rectangle(GAME.WIDTH / 2, GAME.HEIGHT / 2, GAME.WIDTH, GAME.HEIGHT, color, 0)
        .setDepth(2000);
    scene.tweens.add({
        targets: rect,
        alpha,
        duration,
        yoyo: true,
        repeat: pulses - 1,
        ease: 'Sine.easeInOut',
        onComplete: () => rect.destroy(),
    });
}

/** Expanding ring outline at an impact point — reads as a "shockwave" alongside the particle burst. */
export function emitShockwaveRing(scene: Scene, x: number, y: number, color: number): GameObjects.Arc {
    const ring = scene.add.circle(x, y, 6, 0x000000, 0).setStrokeStyle(3, color, 0.9);
    scene.tweens.add({
        targets: ring,
        radius: 40,
        alpha: 0,
        duration: 350,
        ease: 'Quad.easeOut',
        onComplete: () => ring.destroy(),
    });
    return ring;
}

const ONOMATOPOEIA = ['БАМ!', 'ХРЯСЬ!', 'БАХ!', 'ХЛОП!'];

/** Comic-book impact text, Reserved for bigger sales — see FX.COMIC_TEXT_MIN_DELTA. */
export function emitComicText(scene: Scene, x: number, y: number): GameObjects.Text {
    const text = ONOMATOPOEIA[Math.floor(Math.random() * ONOMATOPOEIA.length)];
    const t = scene.add.text(x, y, text, {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '26px',
        resolution: GAME.RENDER_SCALE,
        fontStyle: 'bold',
        color: '#fff5f5',
    }).setOrigin(0.5).setAngle(-8).setStroke('#d23a3a', 5);
    scene.tweens.add({
        targets: t,
        y: y - 30,
        angle: 4,
        scale: { from: 0.6, to: 1.1 },
        alpha: { from: 1, to: 0 },
        duration: 550,
        ease: 'Back.easeOut',
        onComplete: () => t.destroy(),
    });
    return t;
}

export interface Swayable {
    angle: number;
    /** False while the character is busy (mid-strike, victory pose) — it is skipped this round. */
    canSway(): boolean;
}

/**
 * Rare idle sway so standing art doesn't read as a frozen photo: every 10–16 s two or
 * three random characters tilt a little about their feet, a fraction of a second apart.
 * Only `angle` changes — the feet never leave the floor (an up/down bob was removed
 * because the characters looked like they hovered).
 *
 * One shared schedule instead of a timer per character on purpose: each sway is an
 * animation, and animations make the game render at its full frame rate (PowerSaver);
 * seven independent timers kept it out of the low-rate idle mode about a quarter of the time.
 */
export function startIdleSway(scene: Scene, sprites: Swayable[]) {
    const schedule = () => scene.time.delayedCall(10000 + Math.random() * 6000, () => {
        const ready = sprites.filter(s => s.canSway()).sort(() => Math.random() - 0.5);
        ready.slice(0, 2 + Math.floor(Math.random() * 2)).forEach(sprite => {
            scene.time.delayedCall(Math.random() * 500, () => {
                if (!sprite.canSway()) return;
                scene.tweens.chain({
                    targets: sprite,
                    tweens: [
                        { angle: -6, duration: 140, ease: 'Quad.easeOut' },
                        { angle: 0, duration: 260, ease: 'Sine.easeOut' },
                    ],
                });
            });
        });
        schedule();
    });
    schedule();
}

