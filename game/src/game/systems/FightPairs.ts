import type { FightPairPayload } from '../core/EventBus';
import type { ImportStatus, LeaderStatus, PairStatus } from '../core/GameState';
import { average } from '../core/Average.ts';

/**
 * Which pairs trade blows after an import, and with what numbers. A pair fights when a day sum on either side GREW since
 * the previous import (a correction downwards is not a fight) and there is something to fight about. The fight itself is
 * decided by the AVERAGES per employee (day sum / staff), the sums and staff sizes ride along for the HUD captions.
 * Pure, so the rules are unit-tested (game/tests/game-logic.test.mjs).
 */
export function fightPairsFor(imp: ImportStatus, pairs: PairStatus[], leaders: LeaderStatus[]): FightPairPayload[] {
    const staffOf = (rop: string) => leaders.find(l => l.rop === rop)?.staff ?? 0;
    const result: FightPairPayload[] = [];
    for (const pair of pairs) {
        const leftSum = imp.after[pair.left] ?? 0;
        const rightSum = imp.after[pair.right] ?? 0;
        const leftBeforeSum = imp.before[pair.left] ?? 0;
        const rightBeforeSum = imp.before[pair.right] ?? 0;
        const grew = leftSum > leftBeforeSum || rightSum > rightBeforeSum;
        if (!grew || leftSum + rightSum <= 0) continue;
        const [leftStaff, rightStaff] = [staffOf(pair.left), staffOf(pair.right)];
        result.push({
            pairId: pair.id, left: pair.left, right: pair.right,
            leftAvg: average(leftSum, leftStaff), rightAvg: average(rightSum, rightStaff),
            leftBeforeAvg: average(leftBeforeSum, leftStaff), rightBeforeAvg: average(rightBeforeSum, rightStaff),
            leftSum, rightSum, leftStaff, rightStaff, sample: leftSum + rightSum,
        });
    }
    return result;
}

/** A status answer that cannot be played (an older backend, a half-written error page): refuse it instead of crashing a scene. */
export function isUsableStatus(status: unknown): boolean {
    const s = status as Record<string, unknown> | null;
    if (!s || typeof s !== 'object' || s.ok !== true) return false;
    const period = s.period as Record<string, unknown> | undefined;
    return !!period && typeof period === 'object' && typeof period.daysTotal === 'number'
        && Array.isArray(s.pairs) && Array.isArray(s.leaders) && Array.isArray(s.managers);
}

/** A `finale` command that carries what the HUD and the arena iterate over. */
export function isUsableFinale(args: Record<string, unknown>): boolean {
    return Array.isArray(args.results) && args.results.every((r: unknown) => {
        const x = r as Record<string, unknown> | null;
        return !!x && typeof x === 'object' && typeof x.pairId === 'number' && typeof x.left === 'string' && typeof x.right === 'string'
            && typeof x.winner === 'string' && typeof x.starsBefore === 'object' && typeof x.starsAfter === 'object';
    });
}
