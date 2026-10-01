import { Display, GameObjects, Scene, Types } from 'phaser';
import { HeroDef, Move, RosterConfig } from '../systems/RosterConfig';
import { ARENA, FIGHT } from '../core/Constants';
import { emitBurst, emitDust, emitHitSpark, emitShockwaveRing, emitSparkles, emitStunStars, Swayable } from '../systems/Fx';
import { AudioSystem } from '../systems/Audio';
import { sleep, tweenTo } from '../core/Async';
import type { Reaction, Side } from '../systems/FightPlanner';

/** +1: faces right (the left-hand fighter), -1: faces left (the right-hand one, drawn mirrored). */
export type Facing = 1 | -1;

const WALK_LEAN = 3;
const WINDUP_BACK = 12;

/**
 * A department leader's mascot in the arena. Anchored at its feet (bottom-centre); every texture is already at
 * one common pixel scale (tools/build-sprites.py), so swapping poses never changes the size and squash/stretch
 * pivots around the feet. All moves are promises that resolve when the move has *landed* (a strike: at the impact),
 * so the director can write a fight as plain `await` code.
 *
 * Every move works without art beyond the standing pose (recoil, squash, tilt, topple, spin); a pose from the
 * hero's pools (RosterConfig.poseKeys) is used whenever there is one.
 *
 * One move at a time: every move starts with `halt()`, which stops whatever was running and takes a new `epoch`
 * number. A move that was interrupted still wakes up after its `await` — and must then do nothing (`step()` /
 * `rest()` return false): otherwise its tail would swap the pose and start a tween in the middle of the move that
 * replaced it.
 */
export class Fighter extends GameObjects.Container implements Swayable {
    readonly def: HeroDef;
    readonly rop: string;
    private sprite: GameObjects.Image;
    private baseScale = 1;
    private floorY = 0;
    facing: Facing = 1;
    side: Side = 'left';
    /** Where it stands when not fighting, and where it stands to trade blows. */
    homeX = 0;
    clashX = 0;
    /** Set by the director for the whole round/finale; the idle sway keeps off a fighter that is engaged. */
    engaged = false;

    private epoch = 0;
    private lastPick: Partial<Record<Move, string>> = {};
    private leftKeys: Set<string>;
    private standKey: string;
    private lyingKey: string | null = null;

    constructor(scene: Scene, def: HeroDef, rop: string) {
        super(scene, 0, 0);
        this.def = def;
        this.rop = rop;
        this.standKey = def.sprite;
        this.leftKeys = new Set(RosterConfig.leftVariantKeys(def.slug));
        this.sprite = scene.add.image(0, 0, def.sprite).setOrigin(0.5, 1);
        this.add(this.sprite);
        scene.add.existing(this);
    }

    /* ------------------------------------------------------ move bookkeeping */

    /**
     * Ends whatever the fighter is doing and starts a new move. The sprite's own tweens go too (a flight spins the
     * sprite, not the container), and its pivot and spin are put back, because a flight moves the pivot to the body centre.
     */
    private halt(): number {
        this.scene.tweens.killTweensOf(this);
        this.scene.tweens.killTweensOf(this.sprite);
        this.sprite.setOrigin(0.5, 1).setPosition(0, 0).setAngle(0);
        return ++this.epoch;
    }

    /** One tween of a move. False = another move took over while it ran, so the caller must stop right there. */
    private async step(epoch: number, config: Types.Tweens.TweenBuilderConfig): Promise<boolean> {
        await tweenTo(this.scene, config);
        return this.epoch === epoch;
    }

    private async rest(epoch: number, ms: number): Promise<boolean> {
        await sleep(this.scene, ms);
        return this.epoch === epoch;
    }

    /* ----------------------------------------------------------- geometry */

    /** Puts the fighter on a lane: `side` decides which way it faces and which end of the lane it stands at. */
    setLane(side: Side, lane: { y: number; scale: number; homeLeft: number; homeRight: number; clashX: number }) {
        this.side = side;
        this.facing = side === 'left' ? 1 : -1;
        this.floorY = lane.y;
        this.baseScale = ARENA.TEXTURE_SCALE * lane.scale;
        this.homeX = side === 'left' ? lane.homeLeft : lane.homeRight;
        this.clashX = lane.clashX;
        this.setDepth(lane.y);
        this.showStanding();
    }

    /** Snaps to the resting place. */
    standAtHome() {
        this.halt();
        this.lyingKey = null;
        this.showStanding();
        this.setPosition(this.homeX, this.floorY).setScale(this.baseScale).setAngle(0).setDepth(this.floorY);
    }

    /** Display width of a texture at this fighter's scale. */
    private widthOf(key: string): number {
        return this.scene.textures.getFrame(key).width * this.baseScale;
    }

    get standWidth(): number {
        return this.widthOf(this.standKey);
    }

    /** x of the body centre when this fighter stands its ground at the clash line. */
    get stanceX(): number {
        return this.clashX - this.facing * (ARENA.CLASH_GAP / 2 + this.standWidth / 2);
    }

    /* -------------------------------------------------------------- poses */

    private has(key: string): boolean {
        return this.scene.textures.exists(key);
    }

    /** A random existing pose of a move, never the one used last time when there is a choice. */
    private pick(move: Move): string | null {
        const pool = RosterConfig.poseKeys(this.def.slug, move).filter(k => this.has(k));
        if (pool.length === 0) return null;
        const candidates = pool.length > 1 ? pool.filter(k => k !== this.lastPick[move]) : pool;
        const key = candidates[Math.floor(Math.random() * candidates.length)];
        this.lastPick[move] = key;
        return key;
    }

    private setPose(key: string) {
        // A hand-drawn left-facing version beats mirroring the right-facing one (a logo on a hoodie stays readable).
        if (this.facing === -1 && this.leftKeys.has(key) && this.has(`${key}_L`)) {
            this.sprite.setTexture(`${key}_L`).setFlipX(false);
        } else {
            this.sprite.setTexture(key).setFlipX(this.facing === -1);
        }
    }

    showStanding() {
        this.setPose(this.standKey);
    }

    /* ------------------------------------------------------------ moving */

    /** Walk (slide with a lean, no bobbing — bobbing made the characters look like they hover) to `x`. */
    async walkTo(x: number, ms: number): Promise<void> {
        if (Math.abs(x - this.x) < 2) return;
        const e = this.halt();
        const dir: Facing = x > this.x ? 1 : -1;
        this.showStanding();
        this.scene.tweens.add({ targets: this, angle: dir * WALK_LEAN * this.facing, duration: ms * 0.3, yoyo: true, hold: ms * 0.1, ease: 'Sine.easeInOut' });
        if (!(await this.step(e, { targets: this, x, duration: ms, ease: 'Sine.easeInOut' }))) return;
        this.setAngle(0);
    }

    goHome(ms: number = FIGHT.STEP_OUT_MS): Promise<void> {
        return this.walkTo(this.homeX, ms);
    }

    stepIn(ms: number = FIGHT.STEP_IN_MS): Promise<void> {
        return this.walkTo(this.stanceX, ms);
    }

    /* ----------------------------------------------------------- striking */

    /**
     * One blow at `target`: a short wind-up, a lunge that carries the fist to the target's leading edge (the pose's
     * width decides how far), contact. Resolves *at contact* (or at once if something interrupted the blow); the
     * recovery back to the stance runs on by itself, so the opponent's reaction and the next blow can start right away.
     */
    async strike(target: Fighter, kind: 'light' | 'heavy', onImpact: (info: { x: number; y: number }) => void): Promise<void> {
        const f = this.facing;
        const e = this.halt();
        this.lyingKey = null;
        this.setPosition(this.x, this.floorY).setAngle(0);

        // Pose: a heavy blow prefers its own art, a light one takes punches and kicks alike.
        const poseKey = (kind === 'heavy' ? this.pick('heavy') : null)
            ?? (Math.random() < 0.3 ? this.pick('kick') : null)
            ?? this.pick('attack')
            ?? this.pick('kick')
            ?? this.standKey;
        const poseW = this.widthOf(poseKey);
        const overlap = 10 * this.baseScale * 2;
        const rawX = target.x - f * (target.standWidth / 2 + poseW / 2) + f * overlap;
        const lungeX = f > 0 ? Math.max(this.stanceX, rawX) : Math.min(this.stanceX, rawX);
        const s = this.baseScale;
        const heavy = kind === 'heavy';
        this.setDepth(this.floorY + 1);

        if (!(await this.step(e, {
            targets: this, x: this.stanceX - f * (heavy ? WINDUP_BACK * 1.8 : WINDUP_BACK),
            scaleX: s * 0.94, scaleY: s * (heavy ? 1.09 : 1.05), angle: -f * (heavy ? 7 : 4),
            duration: heavy ? FIGHT.WINDUP_MS * 1.5 : FIGHT.WINDUP_MS, ease: 'Quad.easeOut',
        }))) return;
        this.setPose(poseKey);
        if (!(await this.step(e, {
            targets: this, x: lungeX,
            scaleX: s * 1.1, scaleY: s * 0.95, angle: f * (heavy ? 8 : 5),
            duration: FIGHT.LUNGE_MS, ease: 'Quad.easeIn',
        }))) return;

        // Contact: where the fist meets the target.
        onImpact({ x: this.x + f * (poseW / 2), y: this.y - this.sprite.height * s * 0.58 });
        AudioSystem.playHitThud();

        // Recovery is fire-and-forget: the director's next beat does not wait for it (and a newer move cancels it).
        void this.rest(e, FIGHT.HOLD_MS).then(still => {
            if (!still) return;
            this.showStanding();
            this.scene.tweens.add({
                targets: this, x: this.stanceX, scaleX: s, scaleY: s, angle: 0,
                duration: FIGHT.RECOVER_MS, ease: 'Sine.easeOut',
                onComplete: () => { if (this.epoch === e) this.setDepth(this.floorY); },
            });
        });
    }

    /* ---------------------------------------------------------- reactions */

    /**
     * What the fighter does when a blow lands. `push` is the direction the blow drives it (+1 to the right).
     * Resolves when the reaction is over and the fighter is on its feet again (`none`/`flinch`/`stagger` end at once).
     */
    async react(kind: Reaction, push: Facing): Promise<void> {
        switch (kind) {
            case 'none': return this.shrug(push);
            case 'flinch': return this.recoil(push, 8, 130);
            case 'stagger': return this.recoil(push, FIGHT.STAGGER_PX, FIGHT.STAGGER_MS);
            case 'stun': return this.stunned(push);
            case 'knockdown': return this.knockedDown(push);
            case 'launch': return this.launched(push);
        }
    }

    /** A blow that does nothing much: the target just rocks. */
    private async shrug(push: Facing) {
        const e = this.halt();
        const s = this.baseScale;
        if (!(await this.step(e, { targets: this, angle: push * 2.5, scaleX: s * 0.985, duration: 70, yoyo: true, ease: 'Sine.easeOut' }))) return;
        this.setAngle(0).setScale(s);
    }

    private flash() {
        this.sprite.setTint(0xff9d9d);
        this.scene.time.delayedCall(90, () => this.sprite.clearTint());
    }

    private clampX(x: number): number {
        return Math.min(ARENA.WALL_RIGHT, Math.max(ARENA.WALL_LEFT, x));
    }

    /**
     * Feet x that keeps a body lying along the floor toward `push` inside the arena. A toppled fighter rotates about
     * its feet, so it reaches a whole body length beyond them; near a wall that would put it off the screen.
     */
    private lieX(x: number, push: Facing): number {
        const length = this.sprite.height * this.baseScale;
        return push > 0
            ? Math.min(x, ARENA.WALL_RIGHT + 30 - length)
            : Math.max(x, ARENA.WALL_LEFT - 30 + length);
    }

    /** Hurt pose (or none), a push back, a squash — then back to the stance. */
    private async recoil(push: Facing, px: number, ms: number) {
        const e = this.halt();
        this.flash();
        const hurt = this.pick('hurt');
        if (hurt) this.setPose(hurt);
        const s = this.baseScale;
        if (!(await this.step(e, {
            targets: this, x: this.clampX(this.x + push * px), angle: push * 6, scaleX: s * 0.95, scaleY: s * 1.04,
            duration: ms, ease: 'Quad.easeOut',
        }))) return;
        this.showStanding();
        await this.step(e, { targets: this, x: this.clampX(this.stanceX), angle: 0, scaleX: s, scaleY: s, duration: ms * 1.4, ease: 'Sine.easeOut' });
    }

    /** Dazed: pushed back, stars circle the head, the body sways. */
    private async stunned(push: Facing) {
        const e = this.halt();
        this.flash();
        const s = this.baseScale;
        const stun = this.pick('stun') ?? this.pick('hurt');
        if (stun) this.setPose(stun);
        if (!(await this.step(e, { targets: this, x: this.clampX(this.x + push * FIGHT.STAGGER_PX * 1.4), angle: push * 9, duration: FIGHT.STAGGER_MS, ease: 'Quad.easeOut' }))) return;
        emitStunStars(this.scene, this, -this.sprite.height * s * 0.96, this.standWidth * 0.32, FIGHT.STUN_MS);
        AudioSystem.playStun();
        if (!(await this.step(e, {
            targets: this, angle: -push * 7, scaleY: s * 0.97, duration: FIGHT.STUN_MS / 4, yoyo: true, repeat: 1, ease: 'Sine.easeInOut',
        }))) return;
        this.showStanding();
        await this.step(e, { targets: this, x: this.clampX(this.stanceX), angle: 0, scaleX: s, scaleY: s, duration: 260, ease: 'Sine.easeOut' });
    }

    /**
     * Falls and lies on the floor for `ms`: with a `knockdown` pose from the art if there is one, otherwise the standing
     * sprite toppled about the feet. False = interrupted.
     */
    private async lieDown(e: number, push: Facing, ms: number): Promise<boolean> {
        const s = this.baseScale;
        const art = this.pick('knockdown');
        if (art) {
            this.setPose(art);
            this.lyingKey = art;
            if (!(await this.step(e, { targets: this, x: this.clampX(this.x + push * 30), angle: 0, scaleX: s * 1.06, scaleY: s * 0.94, duration: 200, ease: 'Quad.easeOut' }))) return false;
            this.setScale(s);
        } else {
            this.lyingKey = 'toppled';
            const halfThickness = (this.sprite.width * s) / 2;
            if (!(await this.step(e, { targets: this, angle: push * 92, y: this.floorY - halfThickness, x: this.lieX(this.clampX(this.x + push * 24), push), duration: 340, ease: 'Quad.easeIn' }))) return false;
            this.setAngle(push * 90);
        }
        emitDust(this.scene, this.x, this.floorY, this.baseScale * 1.6, push);
        AudioSystem.playFall();
        if (!(await this.step(e, { targets: this, y: this.y - 8, duration: 90, yoyo: true, ease: 'Sine.easeOut' }))) return false;
        return this.rest(e, ms);
    }

    private async knockedDown(push: Facing) {
        const e = this.halt();
        this.flash();
        if (!(await this.lieDown(e, push, FIGHT.KNOCKDOWN_LIE_MS))) return;
        await this.getUp();
    }

    /** The epic one: flung across the arena, spinning, into the floor (or the wall), a bounce, a long lie. */
    private async launched(push: Facing) {
        const e = this.halt();
        this.flash();
        const s = this.baseScale;
        const art = this.pick('fly') ?? this.pick('hurt');
        if (art) this.setPose(art);
        AudioSystem.playLaunch();

        // Spin about the middle of the body, not the feet: swap the sprite's pivot for the flight (halt() puts it back).
        const h = this.sprite.height;
        this.sprite.setOrigin(0.5, 0.5).setY(-h / 2);

        const landX = this.lieX(this.clampX(this.x + push * FIGHT.LAUNCH_DISTANCE), push);
        const hitWall = landX !== this.x + push * FIGHT.LAUNCH_DISTANCE;
        // The trail of afterimages is skipped on purpose: three tweens for the arc are enough work for a weak laptop.
        void tweenTo(this.scene, { targets: this.sprite, angle: push * (360 + 90), duration: FIGHT.LAUNCH_MS, ease: 'Sine.easeOut' });
        void tweenTo(this.scene, { targets: this, x: landX, duration: FIGHT.LAUNCH_MS, ease: 'Quad.easeOut' });
        if (!(await this.step(e, { targets: this, y: this.floorY - FIGHT.LAUNCH_HEIGHT * s * 1.6, duration: FIGHT.LAUNCH_MS * 0.45, ease: 'Quad.easeOut' }))) return;
        if (!(await this.step(e, { targets: this, y: this.floorY - (this.sprite.height * s) / 2 + 6, duration: FIGHT.LAUNCH_MS * 0.55, ease: 'Quad.easeIn' }))) return;

        // Landing: back to the feet pivot, lying on its side.
        this.sprite.setOrigin(0.5, 1).setPosition(0, 0).setAngle(0);
        this.setAngle(push * 90).setY(this.floorY - (this.sprite.width * s) / 2);
        this.lyingKey = 'toppled';
        emitDust(this.scene, this.x, this.floorY, s * 2.6, push, 12);
        emitShockwaveRing(this.scene, this.x, this.floorY - 10, 0xd8ccb8);
        if (hitWall) this.scene.cameras.main.shake(160, 0.007);
        AudioSystem.playFall();
        if (!(await this.step(e, { targets: this, y: this.y - 26, duration: 130, yoyo: true, ease: 'Quad.easeOut' }))) return;
        if (!(await this.rest(e, FIGHT.LAUNCH_LIE_MS))) return;
        await this.getUp();
    }

    /** From the floor back onto its feet with a squash-and-stretch pop, and back to the stance line. */
    async getUp(): Promise<void> {
        const e = this.halt();
        const s = this.baseScale;
        if (this.lyingKey) this.showStanding();
        this.lyingKey = null;
        if (!(await this.step(e, { targets: this, angle: 0, y: this.floorY, scaleX: s * 0.94, scaleY: s * 1.07, duration: FIGHT.GETUP_MS, ease: 'Back.easeOut' }))) return;
        emitSparkles(this.scene, this.x, this.y - this.sprite.height * s * 0.5, this.standWidth * 0.8, 3);
        await this.step(e, { targets: this, x: this.clampX(this.stanceX), scaleX: s, scaleY: s, duration: 200, ease: 'Sine.easeOut' });
    }

    /* ------------------------------------------------- end-of-day poses */

    /** Victory: the win pose if there is one, otherwise the squash-and-stretch bounce, with sparkles. */
    async celebrate(): Promise<void> {
        const e = this.halt();
        this.lyingKey = null;
        this.setPosition(this.x, this.floorY).setAngle(0);
        const s = this.baseScale;
        const win = this.pick('win');
        if (win) this.setPose(win);
        else this.showStanding();
        emitSparkles(this.scene, this.x, this.y - this.sprite.height * s * 0.5, this.standWidth * 0.9, 10);
        if (!(await this.step(e, { targets: this, scaleX: s * 1.08, scaleY: s * 0.94, duration: 140, yoyo: true, repeat: 2, ease: 'Quad.easeInOut' }))) return;
        this.setScale(s);
        this.showStanding(); // the win pose is a moment, not a place to stay
    }

    /** A draw: both bow (a short forward tilt). */
    async bow(): Promise<void> {
        const e = this.halt();
        if (!(await this.step(e, { targets: this, angle: this.facing * 10, duration: 260, yoyo: true, hold: 200, ease: 'Sine.easeInOut' }))) return;
        this.setAngle(0);
    }

    /** Snap-freeze of the final pose used by the persistent "week is decided" tableau. */
    stayDown(push: Facing) {
        this.halt();
        const art = this.pick('ko') ?? this.pick('knockdown');
        if (art) {
            this.setPose(art);
            this.lyingKey = art;
            this.setAngle(0).setY(this.floorY);
        } else {
            this.lyingKey = 'toppled';
            // Centre the lying body on the home spot instead of hanging it off the feet.
            const length = this.sprite.height * this.baseScale;
            this.setAngle(push * 90).setPosition(this.lieX(this.homeX - (push * length) / 2, push), this.floorY - (this.sprite.width * this.baseScale) / 2);
        }
    }

    /* --------------------------------------------------------- impact fx */

    /** Burst, spark and ring at the contact point, sized by the kind of blow. */
    impactFx(at: { x: number; y: number }, heavy: boolean) {
        const color = Display.Color.HexStringToColor(this.def.color).color;
        emitBurst(this.scene, at.x, at.y, color, heavy ? 18 : 10);
        emitHitSpark(this.scene, at.x, at.y, color, heavy);
        emitShockwaveRing(this.scene, at.x, at.y, color);
    }

    /* -------------------------------------------------------- Swayable */

    canSway(): boolean {
        return !this.engaged && this.lyingKey === null && this.visible;
    }
}
