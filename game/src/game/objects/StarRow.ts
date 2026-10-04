import { GameObjects, Scene } from 'phaser';
import { MATCH } from '../core/Constants';
import { tweenTo } from '../core/Async';
import { emitBurst } from '../systems/Fx';
import { AudioSystem } from '../systems/Audio';

const LIT = { fill: 0xffd23a, stroke: 0x8a5a00 };
const DIM = { fill: 0x1a2030, stroke: 0x424c66 };
const FLASH = 0xffffff;

/**
 * A leader's wins of the week: MATCH.STARS slots, the first `count` lit — one star per day won. A star is earned in the
 * finale (an event of its own: it flashes, swells and settles), so it is animated by `earnStar`, never by a plain `setCount`.
 */
export class StarRow extends GameObjects.Container {
    private stars: GameObjects.Star[] = [];
    private lit: number = 0;
    private readonly gap: number;

    /** @param mirror stars run from the screen edge inwards on both sides, so the newest star is always the one nearest the name */
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

    /** The star at index `lit` lights up. Resolves when it has settled and the row shows `newCount`. */
    async earnStar(newCount: number): Promise<void> {
        const next = Math.max(0, Math.min(MATCH.STARS, Math.round(newCount)));
        if (next <= this.lit) { // not a gain (a correction downwards, or no change): just show it
            this.setCount(next);
            return;
        }
        const star = this.stars[next - 1];
        this.paint(next - 1); // anything between (a missed update) is shown at once, the new star is the one that is played
        this.lit = next;
        AudioSystem.playStarGain();
        star.setFillStyle(FLASH, 1).setStrokeStyle(1.5, LIT.fill, 1);
        emitBurst(this.scene, this.x + star.x, this.y + star.y, LIT.fill, 12);
        await tweenTo(this.scene, { targets: star, scale: 2.2, duration: 160, ease: 'Back.easeOut' });
        star.setFillStyle(LIT.fill, 1).setStrokeStyle(1.5, LIT.stroke, 1);
        await tweenTo(this.scene, { targets: star, scale: 1, duration: 260, ease: 'Bounce.easeOut' });
        this.paint(next);
    }
}
