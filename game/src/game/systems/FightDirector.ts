import { Scene } from 'phaser';
import { Fighter, Facing } from '../objects/Fighter';
import { plan, FightPlan, Tier } from './FightPlanner';
import { EventBus, GameEvents, FinaleResult } from '../core/EventBus';
import { FIGHT, FINALE } from '../core/Constants';
import { hitStop, sleep } from '../core/Async';
import { emitComicText, emitTitle } from './Fx';
import { AudioSystem } from './Audio';

/**
 * Turns plans into choreography. One pair at a time in here; ArenaScene runs the pairs of a round side by side and
 * queues rounds/finales one after another. Everything is `await`-able finite tweens — nothing loops, so between
 * events the picture is still and PowerSaver can drop to the idle frame rate.
 */
export class FightDirector {
    constructor(private scene: Scene) {}

    private shake(tier: Tier) {
        const s = FIGHT.SHAKE[tier];
        this.scene.cameras.main.shake(s.ms, s.intensity);
    }

    /** The plan for these two averages per employee (`sample` = raw invoices behind them), opener chosen at random on a tie. */
    planFor(leftAvg: number, rightAvg: number, sample: number, target?: number): FightPlan {
        return plan(leftAvg, rightAvg, { sample, target, tieStarter: Math.random() < 0.5 ? 'left' : 'right' });
    }

    /* ------------------------------------------------------------- round */

    /** Step up, trade the planned blows, step back. Resolves when both are home again. */
    async playPair(left: Fighter, right: Fighter, fight: FightPlan, onBlow?: (index: number, total: number) => void): Promise<void> {
        if (fight.blows.length === 0) return;
        left.engaged = right.engaged = true;
        await Promise.all([left.stepIn(), right.stepIn()]);

        for (const [index, blow] of fight.blows.entries()) {
            const attacker = blow.by === 'left' ? left : right;
            const defender = blow.by === 'left' ? right : left;
            const push: Facing = attacker.facing;
            let reaction: Promise<void> = Promise.resolve();

            await attacker.strike(defender, blow.kind, at => {
                onBlow?.(index, fight.blows.length);
                const big = blow.kind === 'heavy' || (blow.final && fight.tier >= 1);
                attacker.impactFx(at, big);
                if (big) AudioSystem.playHeavyHit();
                if (blow.reaction !== 'none') reaction = defender.react(blow.reaction, push);
                else void defender.react('none', push);
                if (blow.final) {
                    this.shake(fight.tier);
                    if (fight.tier >= 2) {
                        hitStop(this.scene, FIGHT.HITSTOP_MS * (fight.tier === 3 ? 1.6 : 1));
                        emitComicText(this.scene, at.x, at.y - 30);
                    }
                }
            });

            // The final blow's reaction (stun, fall, flight) is the point of the round: wait it out. The others overlap.
            if (blow.final) await reaction;
            else await sleep(this.scene, FIGHT.BEAT_MS);
        }

        await Promise.all([left.goHome(), right.goHome()]);
        left.engaged = right.engaged = false;
    }

    /* ------------------------------------------------------------ finale */

    /**
     * The day's verdict for one pair. A draw: both bow. Otherwise the day's winner finishes the loser off — two
     * quick blows and a heavy one that sends the loser flying — and at the moment the loser lands the HUD breaks
     * one of their stars. Resolves when both are home (or, for the match loser, the caller lays them down later).
     */
    async playFinalePair(result: FinaleResult, left: Fighter, right: Fighter): Promise<void> {
        left.engaged = right.engaged = true;
        await Promise.all([left.stepIn(), right.stepIn()]);
        const cx = (left.x + right.x) / 2;
        const cy = Math.min(left.y, right.y) - 190;

        const draw = result.winner === 'draw';
        if (draw) {
            emitTitle(this.scene, cx, cy, 'НИЧЬЯ', { size: 54, color: '#cfe3f5', stroke: '#1d2b44', strokeWidth: 8, holdMs: 900 });
            await Promise.all([left.bow(), right.bow()]);
            EventBus.emit(GameEvents.FINALE_PAIR, result);
            await sleep(this.scene, FINALE.HOLD_MS * 0.6);
        } else {
            const winner = result.winner === left.rop ? left : right;
            const loser = winner === left ? right : left;
            const push: Facing = winner.facing;

            emitTitle(this.scene, cx, cy, 'FINISH HIM!', { size: 64, color: '#ff4a2e', stroke: '#2a0500', strokeWidth: 10, holdMs: 800 });
            AudioSystem.playFightStinger();
            await sleep(this.scene, 500);

            for (let i = 0; i < 2; i++) {
                await winner.strike(loser, 'light', at => {
                    winner.impactFx(at, false);
                    void loser.react('stagger', push);
                });
                await sleep(this.scene, FIGHT.BEAT_MS);
            }
            let flight: Promise<void> = Promise.resolve();
            await winner.strike(loser, 'heavy', at => {
                winner.impactFx(at, true);
                AudioSystem.playHeavyHit();
                flight = loser.react('launch', push);
                this.shake(3);
                hitStop(this.scene, FIGHT.HITSTOP_MS * 1.6);
                emitComicText(this.scene, at.x, at.y - 30);
            });
            // The star breaks as the loser hits the floor.
            await sleep(this.scene, FIGHT.LAUNCH_MS * 0.95);
            EventBus.emit(GameEvents.FINALE_PAIR, result);
            void winner.celebrate();
            await flight;
            await sleep(this.scene, FINALE.HOLD_MS * 0.4);
        }

        await Promise.all([left.goHome(), right.goHome()]);
        left.engaged = right.engaged = false;
    }
}
