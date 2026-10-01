// Run: npm run test:fight
import test from 'node:test';
import assert from 'node:assert/strict';
import { fightPairsFor, isUsableStatus, isUsableFinale } from '../src/game/systems/FightPairs.ts';
import { average } from '../src/game/core/Average.ts';
import { shortName, fmtAverage } from '../src/game/core/Names.ts';

const leaders = [
    { rop: 'СР1', stars: 5, staff: 12, dayCount: 0, periodCount: 0 },
    { rop: 'СР3', stars: 5, staff: 12, dayCount: 0, periodCount: 0 },
    { rop: 'СР2', stars: 5, staff: 9, dayCount: 0, periodCount: 0 },
    { rop: 'СР5', stars: 5, staff: 16, dayCount: 0, periodCount: 0 },
];
const pairs = [{ id: 1, left: 'СР1', right: 'СР3' }, { id: 2, left: 'СР2', right: 'СР5' }];
const imp = (before, after) => ({ id: 2, at: '2026-10-01T12:00:00Z', before, after });

test('fightPairsFor: only pairs whose day sum grew fight, with averages per employee', () => {
    const res = fightPairsFor(imp({ 'СР1': 10, 'СР3': 10, 'СР2': 5, 'СР5': 5 }, { 'СР1': 23, 'СР3': 29, 'СР2': 5, 'СР5': 5 }), pairs, leaders);
    assert.equal(res.length, 1, 'pair 2 did not move');
    const p = res[0];
    assert.deepEqual([p.pairId, p.leftSum, p.rightSum, p.leftStaff, p.rightStaff, p.sample], [1, 23, 29, 12, 12, 52]);
    assert.ok(Math.abs(p.leftAvg - 23 / 12) < 1e-12 && Math.abs(p.rightAvg - 29 / 12) < 1e-12);
    assert.ok(Math.abs(p.leftBeforeAvg - 10 / 12) < 1e-12);
});

test('fightPairsFor: growth on one side is enough; a correction downwards is not a fight', () => {
    assert.equal(fightPairsFor(imp({ 'СР1': 1, 'СР3': 3 }, { 'СР1': 1, 'СР3': 4 }), pairs, leaders).length, 1);
    assert.equal(fightPairsFor(imp({ 'СР1': 9, 'СР3': 9 }, { 'СР1': 7, 'СР3': 8 }), pairs, leaders).length, 0);
    assert.equal(fightPairsFor(imp({}, {}), pairs, leaders).length, 0);
});

test('fightPairsFor: a bigger department has the smaller average for the same sum (the whole point)', () => {
    const [p] = fightPairsFor(imp({ 'СР2': 0, 'СР5': 0 }, { 'СР2': 17, 'СР5': 25 }), pairs, leaders);
    assert.ok(p.rightSum > p.leftSum);
    assert.ok(p.leftAvg > p.rightAvg, '17/9 beats 25/16');
});

test('fightPairsFor: a department without staff or missing from the import does not break anything', () => {
    const [p] = fightPairsFor(imp({}, { 'СР1': 3 }), pairs, [{ rop: 'СР1', stars: 5, staff: 0, dayCount: 3, periodCount: 3 }]);
    assert.deepEqual([p.leftAvg, p.rightAvg, p.leftStaff], [3, 0, 0]);
});

test('isUsableStatus refuses error pages and answers of an older backend', () => {
    const good = { ok: true, period: { daysTotal: 5 }, pairs: [], leaders: [], managers: [] };
    assert.equal(isUsableStatus(good), true);
    for (const bad of [null, undefined, 'text', {}, { ok: false, error: 'bad_display_key' }, { ...good, pairs: undefined }, { ...good, period: {} }, { ...good, leaders: {} }]) {
        assert.equal(isUsableStatus(bad), false, JSON.stringify(bad));
    }
});

test('isUsableFinale refuses a finale the scenes could not iterate over', () => {
    const result = { pairId: 1, left: 'СР1', right: 'СР3', winner: 'СР3', starsBefore: {}, starsAfter: {} };
    assert.equal(isUsableFinale({ dayNo: 1, results: [result] }), true);
    assert.equal(isUsableFinale({ dayNo: 1, results: [] }), true);
    for (const bad of [{}, { results: 'x' }, { results: [null] }, { results: [{ ...result, starsAfter: undefined }] }, { results: [{ ...result, pairId: '1' }] }]) {
        assert.equal(isUsableFinale(bad), false, JSON.stringify(bad));
    }
});

test('average never divides by zero', () => {
    assert.equal(average(6, 3), 2);
    assert.equal(average(5, 0), 5);
    assert.equal(average(0, 0), 0);
});

test('shortName: "Фамилия И.О." for the screen, safe for odd input', () => {
    assert.equal(shortName('Иванова Мария Сергеевна'), 'Иванова М.С.');
    assert.equal(shortName('  Петров   Пётр '), 'Петров П.');
    assert.equal(shortName('Мамедова Лейла Руфат Кызы'), 'Мамедова Л.Р.');
    assert.equal(shortName('Мадонна'), 'Мадонна');
    assert.equal(shortName(''), '');
    assert.equal(shortName('иванов иван иванович'), 'иванов И.И.');
});

test('fmtAverage writes the number the Russian way', () => {
    assert.equal(fmtAverage(1.2), '1,20');
    assert.equal(fmtAverage(2.4166666), '2,42');
    assert.equal(fmtAverage(0), '0,00');
});
