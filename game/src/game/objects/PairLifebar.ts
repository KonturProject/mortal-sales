import { Display, GameObjects, Scene } from 'phaser';
import { GAME, LIFEBAR } from '../core/Constants';
import { hudText } from '../core/TextStyles';
import { StarRow } from './StarRow';
import { sleep } from '../core/Async';
import { fmtAverage as formatAverage } from '../core/Names';

/** Room for a leader's name between the stars and the bar, px. */
const NAME_ROOM = 112;

/** Safety net: a lock that the round never released (the scene died mid-fight) lets go by itself. */
const LOCK_TIMEOUT_MS = 90_000;

interface SideView {
    rop: string;
    color: number;
    name: GameObjects.Text;
    /** The group's average invoices per employee — the number a fight is decided by. */
    count: GameObjects.Text;
    /** "28 сч. · 12 чел." — where the average comes from. */
    caption: GameObjects.Text;
    stars: StarRow;
}


export interface Caption {
    sum: number;
    staff: number;
}

/**
 * One row of the top HUD: the two leaders of a pair as in a fighting game — name and stars on the outside, a bar
 * that runs in from the centre, the day's invoice count next to the "VS". A bar's length is that leader's count
 * relative to the pair's leader, so the trailing side's bar is visibly shorter; both start full at 0:0.
 *
 * Two things can take a row out of the polling flow: a fight round drags the bars blow by blow (`lockForRound`),
 * and a finale holds the stars until the animation breaks one (`holdStars`). While either is on, plain data
 * updates leave that part alone.
 */
export class PairLifebar extends GameObjects.Container {
    pairId = -1;
    private g: GameObjects.Graphics;
    private left!: SideView;
    private right!: SideView;
    private shown = { left: 0, right: 0 };
    /** How many animations (a round, a finale) are holding the bars at their "before" picture; the data may not move them while > 0. */
    private locks = 0;
    /** Same idea for the stars: a finale holds them at their "before" picture until it breaks one. */
    private starHolds = 0;
    private lockToken = 0;
    private captions: { left: Caption; right: Caption } | null = null;

    constructor(scene: Scene, rowIndex: number) {
        super(scene, 0, LIFEBAR.TOP + rowIndex * (LIFEBAR.ROW_H + LIFEBAR.ROW_GAP));
        this.g = scene.add.graphics();
        this.add(this.g);

        const cx = GAME.WIDTH / 2;
        const midY = LIFEBAR.ROW_H / 2;
        this.add(scene.add.text(cx, midY, 'VS', hudText(15, '#ff8a5c')).setOrigin(0.5).setStroke('#2a0f00', 4));

        this.left = this.buildSide(scene, 'left', cx - LIFEBAR.CENTER_GAP - 10);
        this.right = this.buildSide(scene, 'right', cx + LIFEBAR.CENTER_GAP + 10);
        scene.add.existing(this);
        this.draw();
    }

    private buildSide(scene: Scene, side: 'left' | 'right', countX: number): SideView {
        const midY = LIFEBAR.ROW_H / 2;
        const isLeft = side === 'left';
        const stars = new StarRow(scene, isLeft ? 14 : GAME.WIDTH - 14, midY, 7, !isLeft);
        const nameX = isLeft ? 14 + stars.span + 4 : GAME.WIDTH - 14 - stars.span - 4;
        const name = scene.add.text(nameX, midY, '', hudText(15, '#ffffff')).setOrigin(isLeft ? 0 : 1, 0.5).setStroke('#0b1020', 4);
        const count = scene.add.text(countX, midY, '0,00', hudText(18, '#ffffff')).setOrigin(isLeft ? 1 : 0, 0.5).setStroke('#0b1020', 4);
        // The caption sits at the outer end of the bar, on the dark track, out of the way of the number.
        const captionX = isLeft ? countX - LIFEBAR.BAR_W + 18 : countX + LIFEBAR.BAR_W - 18;
        const caption = scene.add.text(captionX, midY, '', hudText(11, '#e6eefc', 'Arial, sans-serif')).setOrigin(isLeft ? 0 : 1, 0.5).setStroke('#0b1020', 3);
        this.add([stars, name, count, caption]);
        return { rop: '', color: 0xffffff, name, count, caption, stars };
    }

    /* --------------------------------------------------------- identity */

    /** Who fights on this row. Colours and names only; the numbers come with setCounts. */
    setPair(pairId: number, sides: { left: { rop: string; color: string; name: string }; right: { rop: string; color: string; name: string } }) {
        this.pairId = pairId;
        for (const key of ['left', 'right'] as const) {
            const view = this[key];
            const info = sides[key];
            view.rop = info.rop;
            view.color = Display.Color.HexStringToColor(info.color).color;
            const upper = info.name.toUpperCase();
            if (view.name.text !== upper) view.name.setText(upper);
            // A long surname must not run onto the bar: squeeze it to the room between the stars and the bar.
            view.name.setScale(Math.min(1, NAME_ROOM / Math.max(1, view.name.width)), 1);
        }
        this.draw();
    }

    get leftRop(): string { return this.left.rop; }
    get rightRop(): string { return this.right.rop; }

    /** Briefly lights up a leader's name (the day's winner). */
    flashName(rop: string) {
        const view = this.left.rop === rop ? this.left : this.right.rop === rop ? this.right : null;
        if (!view) return;
        view.name.setColor('#ffd23a');
        void sleep(this.scene, 2200).then(() => view.name.setColor('#ffffff'));
    }

    /* ---------------------------------------------------------- numbers */

    /** Bars and numbers to these counts, settling over `ms` (0 = at once). Ignored while a round is dragging the bars. */
    setCounts(left: number, right: number, ms: number = LIFEBAR.SETTLE_MS) {
        if (this.locks > 0) return;
        this.animateCounts(left, right, ms);
    }

    private animateCounts(left: number, right: number, ms: number) {
        if (this.shown.left === left && this.shown.right === right) return; // an idle display stays idle
        this.scene.tweens.killTweensOf(this.shown);
        if (ms <= 0) {
            this.shown.left = left;
            this.shown.right = right;
            this.draw();
            return;
        }
        this.scene.tweens.add({
            targets: this.shown, left, right, duration: ms, ease: 'Sine.easeOut',
            onUpdate: () => this.draw(),
        });
    }

    /** "28 сч. · 12 чел." under each side's bar. Held back with the numbers while a round is playing. */
    setCaptions(left: Caption, right: Caption) {
        this.captions = { left, right };
        if (this.locks === 0) this.paintCaptions();
    }

    private paintCaptions() {
        if (!this.captions) return;
        for (const side of ['left', 'right'] as const) {
            const { sum, staff } = this.captions[side];
            const text = `${sum} сч. · ${staff} чел.`;
            if (this[side].caption.text !== text) this[side].caption.setText(text);
        }
    }

    /** A round starts: jump to the averages before the import, and stop following the data until `unlockRound`. */
    lockForRound(before: { left: number; right: number }) {
        // A second lock (a finale queued behind a round) must not yank the bars to its own picture while the first still plays.
        if (this.locks === 0) this.animateCounts(before.left, before.right, 0);
        this.locks++;
        const token = ++this.lockToken;
        void sleep(this.scene, LOCK_TIMEOUT_MS).then(() => { if (this.lockToken === token) this.locks = 0; });
    }

    /** A blow landed: the bars move a step of the way from before to after. */
    stepTowards(left: number, right: number) {
        if (this.locks === 0) return;
        this.animateCounts(left, right, 200);
    }

    unlockRound(final: { left: number; right: number }) {
        this.locks = Math.max(0, this.locks - 1);
        if (this.locks > 0) return; // another animation still holds the bars; the last one to finish shows the final numbers
        this.lockToken++;
        this.animateCounts(final.left, final.right, 300);
        this.paintCaptions();
    }

    /* ------------------------------------------------------------ stars */

    /** Follow the data's stars — unless a finale is holding them. */
    setStars(left: number, right: number) {
        if (this.starHolds > 0) return;
        this.left.stars.setCount(left);
        this.right.stars.setCount(right);
    }

    holdStars(hold: boolean) {
        this.starHolds = Math.max(0, this.starHolds + (hold ? 1 : -1));
    }

    /** Snaps both star rows to these values even while held (the finale's "before" picture). */
    forceStars(left: number, right: number) {
        this.left.stars.setCount(left);
        this.right.stars.setCount(right);
    }

    breakStar(rop: string, starsAfter: number): Promise<void> {
        const view = this.left.rop === rop ? this.left : this.right.rop === rop ? this.right : null;
        return view ? view.stars.breakStar(starsAfter) : Promise.resolve();
    }

    /* ------------------------------------------------------------- draw */

    private fractions(): { left: number; right: number } {
        const { left, right } = this.shown;
        if (left <= 0 && right <= 0) return { left: 1, right: 1 };
        const top = Math.max(left, right);
        return { left: left / top, right: right / top };
    }

    private draw() {
        const g = this.g;
        g.clear();
        const cx = GAME.WIDTH / 2;
        const h = LIFEBAR.ROW_H - 8;
        const y = 4;
        const w = LIFEBAR.BAR_W;
        const innerLeft = cx - LIFEBAR.CENTER_GAP;
        const innerRight = cx + LIFEBAR.CENTER_GAP;
        const f = this.fractions();

        // Tracks.
        g.fillStyle(0x0b1020, 0.82);
        g.fillRoundedRect(innerLeft - w, y, w, h, 5);
        g.fillRoundedRect(innerRight, y, w, h, 5);
        // Fills, growing out of the centre.
        g.fillStyle(this.left.color, 1);
        if (f.left > 0.001) g.fillRoundedRect(innerLeft - w * f.left + 1, y + 1, w * f.left - 2, h - 2, 4);
        g.fillStyle(this.right.color, 1);
        if (f.right > 0.001) g.fillRoundedRect(innerRight + 1, y + 1, w * f.right - 2, h - 2, 4);
        // Glassy highlight along the top edge of each fill.
        g.fillStyle(0xffffff, 0.2);
        if (f.left > 0.001) g.fillRect(innerLeft - w * f.left + 4, y + 2, w * f.left - 8, (h - 4) * 0.35);
        if (f.right > 0.001) g.fillRect(innerRight + 4, y + 2, w * f.right - 8, (h - 4) * 0.35);
        // Frames.
        g.lineStyle(2, 0xd8c98a, 0.95);
        g.strokeRoundedRect(innerLeft - w, y, w, h, 5);
        g.strokeRoundedRect(innerRight, y, w, h, 5);

        const l = formatAverage(this.shown.left);
        const r = formatAverage(this.shown.right);
        if (this.left.count.text !== l) this.left.count.setText(l);
        if (this.right.count.text !== r) this.right.count.setText(r);
    }
}
