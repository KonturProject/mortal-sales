/**
 * Turns the day's invoice counts of the two leaders in a pair into a *plan* of blows.
 * Pure on purpose (no Phaser, no Constants import): it is unit-tested under plain node
 * (`npm run test:fight`) and the tuning numbers below are the only thing to touch to
 * change how a round feels. See docs/superpowers/specs/2026-09-29-mortal-sales-design.md.
 *
 * `a` and `b` are the two groups' AVERAGE invoices per employee (day total / active staff), never the raw totals:
 * a group with twice the people would otherwise win every day. The managers' own ranking stays in absolute numbers.
 *
 * The size of a lead is measured against the business TARGET (average invoices per employee that counts as good,
 * 1.20 for now; a setting of the admin page), not against the pair's own sum: with a target of 1.20, 1.92 against 2.42
 * is a big gap (0.50 = 42 % of the target), while 0.05 against 0.15 is nothing.
 *
 *   dominance  D    = min(1, |a − b| / target)                0 = dead heat, 1 = a whole target apart
 *   confidence      = min(1, sample / confidenceInvoices)     sample = raw invoices of both groups together:
 *                                                             one invoice to none is not a massacre
 *   D_eff           = D · confidence
 *   leader blows    = baseHits + round(hitsSpan · D_eff)
 *   loser blows     = max(1, round(leaderBlows · (1 − D_eff)^loserExponent))   — both always fight
 */

export type Side = 'left' | 'right';
/** What the receiver of a blow does: a small recoil, a step back, dazed, floored, or sent flying. `none` = shrugs it off. */
export type Reaction = 'none' | 'flinch' | 'stagger' | 'stun' | 'knockdown' | 'launch';
/** 0 dead heat, 1 upper hand, 2 domination, 3 rout. */
export type Tier = 0 | 1 | 2 | 3;

export interface Blow {
    by: Side;
    kind: 'light' | 'heavy';
    /** Reaction of the *receiver*. */
    reaction: Reaction;
    /** The last blow of the round. */
    final: boolean;
}

export interface FightPlan {
    /** a + b; 0 means there is nothing to fight about. */
    total: number;
    tier: Tier;
    dEff: number;
    /** null on a tie. */
    leader: Side | null;
    leaderHits: number;
    loserHits: number;
    blows: Blow[];
}

export interface FightTuning {
    /** Average invoices per employee that counts as a good result; a lead is measured in shares of it. */
    targetAvg: number;
    /** Total invoices (both sides) from which the lead counts at full weight. */
    confidenceInvoices: number;
    /** D_eff at which tiers 1, 2 and 3 begin. */
    tierEdges: readonly [number, number, number];
    baseHits: number;
    hitsSpan: number;
    loserExponent: number;
}

export const FIGHT_TUNING: FightTuning = {
    targetAvg: 1.2,
    confidenceInvoices: 10,
    // With the 1.20 target: a gap of 0.18 starts "upper hand", 0.42 "domination", 0.84 "rout".
    tierEdges: [0.15, 0.35, 0.7],
    baseHits: 2,
    hitsSpan: 6,
    loserExponent: 1.6,
};

const other = (side: Side): Side => (side === 'left' ? 'right' : 'left');
const count = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);

export function tierFor(dEff: number, tuning: FightTuning = FIGHT_TUNING): Tier {
    const [t1, t2, t3] = tuning.tierEdges;
    return dEff >= t3 ? 3 : dEff >= t2 ? 2 : dEff >= t1 ? 1 : 0;
}

export interface PlanOptions {
    /** Raw invoices of both groups together — how much evidence the averages rest on. Defaults to a + b (right when the inputs are plain counts). */
    sample?: number;
    /** The target average per employee (the admin's setting); defaults to FIGHT_TUNING.targetAvg. */
    target?: number;
    tuning?: FightTuning;
    /** Who opens when the averages are equal. */
    tieStarter?: Side;
}

/** Averages closer than this are a tie (floating-point noise, not a result). */
const TIE_EPSILON = 1e-9;

/**
 * @param left   average invoices per employee of the left group
 * @param right  average invoices per employee of the right group
 */
export function plan(left: number, right: number, options: PlanOptions = {}): FightPlan {
    const tuning = options.tuning ?? FIGHT_TUNING;
    const tieStarter = options.tieStarter ?? 'left';
    const a = count(left);
    const b = count(right);
    const total = a + b;
    if (total <= 0) return { total: 0, tier: 0, dEff: 0, leader: null, leaderHits: 0, loserHits: 0, blows: [] };

    const sample = options.sample !== undefined ? count(options.sample) : total;
    const target = options.target !== undefined && options.target > 0 ? options.target : tuning.targetAvg;
    const dominance = Math.min(1, Math.abs(a - b) / target);
    const dEff = dominance * Math.min(1, sample / tuning.confidenceInvoices);
    const tier = tierFor(dEff, tuning);
    const leader: Side | null = Math.abs(a - b) <= TIE_EPSILON * Math.max(a, b) ? null : a > b ? 'left' : 'right';

    const leaderHits = tuning.baseHits + Math.round(tuning.hitsSpan * dEff);
    const loserHits = leader === null
        ? leaderHits
        : Math.max(1, Math.round(leaderHits * Math.pow(1 - dEff, tuning.loserExponent)));

    // Order: the trailing side opens (while it is still on its feet), then the two trade blows
    // for as long as the loser has any, and the leader closes with what is left — a combo.
    const first: Side = leader === null ? tieStarter : other(leader);
    const second: Side = other(first);
    const order: Side[] = [];
    for (let i = 0; i < loserHits; i++) order.push(first, second);
    for (let i = loserHits; i < leaderHits; i++) order.push(second);

    const blows: Blow[] = order.map((by, i) => {
        const final = i === order.length - 1;
        const byLeader = leader !== null && by === leader;
        let reaction: Reaction;
        if (leader === null) reaction = 'flinch';
        else if (byLeader) reaction = final ? finalReaction(tier) : tier === 0 ? 'flinch' : 'stagger';
        else reaction = tier >= 2 ? 'none' : 'flinch'; // a hopelessly trailing side barely scratches the leader
        return { by, kind: final && byLeader && tier >= 1 ? 'heavy' : 'light', reaction, final };
    });

    return { total, tier, dEff, leader, leaderHits, loserHits, blows };
}

function finalReaction(tier: Tier): Reaction {
    switch (tier) {
        case 3: return 'launch';
        case 2: return 'knockdown';
        case 1: return 'stun';
        default: return 'flinch';
    }
}
