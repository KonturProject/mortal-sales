// Run: npm run test:fight   (node >= 22.18 strips the TypeScript types itself)
import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, tierFor, FIGHT_TUNING } from '../src/game/systems/FightPlanner.ts';

const hits = (p, side) => p.blows.filter(b => b.by === side).length;

test('nothing to fight about when both averages are zero (or garbage)', () => {
    assert.deepEqual(plan(0, 0).blows, []);
    assert.deepEqual(plan(-3, Number.NaN).blows, []);
    assert.equal(plan(0, 0).total, 0);
});

test('a tie: both sides throw the same number of blows, alternating, nobody is floored', () => {
    const p = plan(6, 6);
    assert.equal(p.leader, null);
    assert.equal(p.tier, 0);
    assert.equal(p.blows.length, 4);
    assert.deepEqual(p.blows.map(b => b.by), ['left', 'right', 'left', 'right']);
    assert.ok(p.blows.every(b => b.reaction === 'flinch'));
    assert.equal(plan(6, 6, { tieStarter: 'right' }).blows[0].by, 'right');
});

test('the lead is measured against the target (1.20): 1.92 vs 2.42 is a big gap, not an even fight', () => {
    assert.equal(FIGHT_TUNING.targetAvg, 1.2);
    const p = plan(1.92, 2.42, { sample: 52 });
    assert.equal(p.leader, 'right');
    assert.equal(p.tier, 2, 'half a target apart: domination');
    assert.equal(p.blows.at(-1).reaction, 'knockdown');
    assert.deepEqual([p.leaderHits, p.loserHits], [5, 2]);
});

test('a tiny gap is an even fight whatever the level', () => {
    for (const [a, b] of [[0.1, 0.05], [1.2, 1.1], [3.0, 2.95]]) assert.equal(plan(a, b, { sample: 100 }).tier, 0, `${a}:${b}`);
});

test('the same gap weighs more against a lower target (the admin can change it)', () => {
    const base = plan(1.92, 2.42, { sample: 52 });
    const lenient = plan(1.92, 2.42, { sample: 52, target: 2.4 });
    const strict = plan(1.92, 2.42, { sample: 52, target: 0.6 });
    assert.ok(lenient.dEff < base.dEff && base.dEff < strict.dEff);
    assert.deepEqual([lenient.tier, base.tier, strict.tier], [1, 2, 3]);
    assert.equal(plan(1.92, 2.42, { sample: 52, target: -1 }).tier, base.tier, 'a nonsense target falls back to the default');
});

test('inputs are averages per employee: the bigger group does not win just by being bigger', () => {
    // 16 people with 40 invoices (2.5 each) against 5 people with 15 invoices (3.0 each): the small group is ahead.
    const p = plan(40 / 16, 15 / 5, { sample: 55 });
    assert.equal(p.leader, 'right');
    assert.ok(p.dEff > 0);
});

test('the evidence (raw invoices) damps the lead, not the averages themselves', () => {
    assert.equal(plan(1, 0, { sample: 1 }).tier, 0); // the very first invoice of the morning
    assert.equal(plan(1, 0, { sample: 50 }).tier, 3); // the same averages after a full day
    assert.ok(plan(1, 0, { sample: 1 }).dEff < plan(1, 0, { sample: 5 }).dEff);
});

test('averages that differ only by floating-point noise are a tie', () => {
    const p = plan(0.1 + 0.2, 0.3);
    assert.equal(p.leader, null);
    assert.equal(p.blows.length, 4);
});

test('a single early invoice is not a massacre (confidence damping)', () => {
    const p = plan(1, 0);
    assert.equal(p.tier, 0);
    assert.equal(p.leader, 'left');
    assert.equal(hits(p, 'left'), 3);
    assert.equal(hits(p, 'right'), 3);
});

test('tier table: averages -> tier and blows for the leader / the trailing side', () => {
    const cases = [
        // left, right, tier, leaderHits, loserHits, finalReaction
        [1.44, 1.2, 1, 3, 2, 'stun'],       // a gap of 0.24 = 20 % of the target
        [2.42, 1.92, 2, 5, 2, 'knockdown'], // 0.50 = 42 %
        [2.1, 1.2, 3, 7, 1, 'launch'],      // 0.90 = 75 %
        [3.0, 1.0, 3, 8, 1, 'launch'],      // more than a whole target apart
        [1.3, 1.2, 0, 3, 3, 'flinch'],      // 0.10 = 8 %: an even exchange
    ];
    for (const [l, r, tier, nL, nW, final] of cases) {
        const p = plan(l, r, { sample: 100 });
        assert.equal(p.tier, tier, `tier of ${l}:${r}`);
        assert.equal(p.leaderHits, nL, `leader hits of ${l}:${r}`);
        assert.equal(p.loserHits, nW, `loser hits of ${l}:${r}`);
        assert.equal(hits(p, 'left'), nL);
        assert.equal(hits(p, 'right'), nW);
        assert.equal(p.blows.at(-1).reaction, final, `final reaction of ${l}:${r}`);
    }
});

test('the trailing side always fights, and always opens', () => {
    for (const [l, r] of [[5, 0.1], [3, 0], [1.3, 1.2], [2.5, 2.45]]) {
        const p = plan(l, r, { sample: 100 });
        assert.ok(hits(p, 'right') >= 1, `${l}:${r}`);
        assert.equal(p.blows[0].by, 'right');
    }
});

test('the leader closes the round with the final (heavy for tier >= 1) blow', () => {
    const p = plan(3.0, 0.4, { sample: 100 });
    const last = p.blows.at(-1);
    assert.equal(last.by, 'left');
    assert.equal(last.final, true);
    assert.equal(last.kind, 'heavy');
    assert.equal(p.blows.filter(b => b.final).length, 1);
});

test('domination: the trailing side barely scratches the leader', () => {
    const p = plan(2.42, 1.92, { sample: 100 });
    assert.ok(p.blows.filter(b => b.by === 'right').every(b => b.reaction === 'none'));
    assert.ok(p.blows.filter(b => b.by === 'left' && !b.final).every(b => b.reaction === 'stagger'));
});

test('the plan is symmetric: swapping the sides swaps the roles', () => {
    const a = plan(2.42, 1.92, { sample: 100 });
    const b = plan(1.92, 2.42, { sample: 100 });
    assert.equal(a.tier, b.tier);
    assert.equal(b.leader, 'right');
    assert.deepEqual(b.blows.map(x => x.by), a.blows.map(x => (x.by === 'left' ? 'right' : 'left')));
    assert.deepEqual(b.blows.map(x => x.reaction), a.blows.map(x => x.reaction));
});

test('tier edges are inclusive at the lower bound', () => {
    const [t1, t2, t3] = FIGHT_TUNING.tierEdges;
    assert.equal(tierFor(t1 - 1e-9), 0);
    assert.equal(tierFor(t1), 1);
    assert.equal(tierFor(t2), 2);
    assert.equal(tierFor(t3), 3);
});

test('no input can make the plan blow up (huge, tiny, infinite, equal)', () => {
    for (const [a, b] of [[1e9, 0], [1e-12, 0], [Infinity, 1], [5, 5], [0.0001, 0.0002]]) {
        const p = plan(a, b, { sample: 1e9 });
        assert.ok(p.blows.length <= 9, `${a}:${b} -> ${p.blows.length} blows`);
        assert.ok(p.blows.every(x => x.by === 'left' || x.by === 'right'));
        assert.ok(Number.isFinite(p.dEff));
    }
});
