import { GameObjects, Scene } from 'phaser';
import { MATCH } from '../core/Constants';
import { tweenTo } from '../core/Async';
import { emitBurst } from '../systems/Fx';
import { AudioSystem } from '../systems/Audio';

const LIT = { fill: 0xffd23a, stroke: 0x8a5a00 };
const DIM = { fill: 0x1a2030, stroke: 0x424c66 };
const HOT = 0xff3b2e;

/**
 * A leader's lives: MATCH.STARS stars, the first `count` lit. Losing one is an event of its own (the star swells,
 * shakes and drops away), so it is animated by `breakStar`, never by a plain `setCount`.
 */
export class StarRow extends GameObjects.Container {
    private stars: GameObjects.Star[] = [];
    private lit: number = MATCH.STARS;
    private readonly gap: number;

    /** @param mirror stars run from the centre outwards on the right-hand side, so the lost one is always the one nearest the name */
    constructor(scene: Scene, x: number, y: number, size = 7, mirror = false) {
        super(scene, x, y);
        this.gap = size * 2 + 3;
        for (let i = 0; i < MATCH.STARS; i++) {
            const star = scene.add.star((mirror ? -i : i) * this.gap, 0, 5, size * 0.45, size, DIM.fill).setStrokeStyle(1.5, DIM.stroke, 1);
            this.stars.push(star);
        }
        this.add(this.stars);
        this.paint(this.lit);
        scene.add.existing(this);
    }

    /** Horizontal room the row takes. */
    get span(): number {
        return MATCH.STARS * this.gap;
    }

    private paint(count: number) {
        this.stars.forEach((star, i) => {
            const lit = i < count;
            star.setFillStyle(lit ? LIT.fill : DIM.fill, 1).setStrokeStyle(1.5, lit ? LIT.stroke : DIM.stroke, 1);
        });
    }

    /** Snap to `count` lit stars (no animation) — for the baseline and for corrections. */
    setCount(count: number) {
        const next = Math.max(0, Math.min(MATCH.STARS, Math.round(count)));
        if (next === this.lit) return;
        this.lit = next;
        this.paint(next);
    }

    get value(): number {
        return this.lit;
    }

    /** The star at index `newCount` (the last lit one) goes out. Resolves when it has fallen and the row shows `newCount`. */
    async breakStar(newCount: number): Promise<void> {
        const next = Math.max(0, Math.min(MATCH.STARS, Math.round(newCount)));
        if (next >= this.lit) { // not a loss (a correction upwards, or no change): just show it
            this.setCount(next);
            return;
        }
        const star = this.stars[next];
        this.lit = next;
        AudioSystem.playStarBreak();
        star.setFillStyle(HOT, 1);
        emitBurst(this.scene, this.x + star.x, this.y + star.y, LIT.fill, 10);
        await tweenTo(this.scene, { targets: star, scale: 1.9, duration: 140, ease: 'Back.easeOut' });
        await tweenTo(this.scene, { targets: star, angle: 22, duration: 60, yoyo: true, repeat: 3, ease: 'Sine.easeInOut' });
        await tweenTo(this.scene, { targets: star, y: star.y + 38, angle: 200, alpha: 0, duration: 420, ease: 'Quad.easeIn' });
        star.setPosition(star.x, 0).setAngle(0).setScale(1).setAlpha(1);
        this.paint(next);
    }
}
