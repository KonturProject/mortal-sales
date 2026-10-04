/**
 * Tests of the real Code.gs against fake Google services (see gas-harness.mjs).
 * Run:  node --test apps-script/test/        (from game/: npm run test:backend)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBackend } from './gas-harness.mjs';

const PIN = '1234';

/** "СР1 Менеджер 1", "СР1 Менеджер 2", ... */
const names = (dept, n) => Array.from({ length: n }, (_, i) => `${dept} Менеджер ${i + 1}`);
/** Import rows for the first `counts.length` managers of a department. */
const rowsFor = (dept, counts) => counts.map((count, i) => ({ name: names(dept, counts.length)[i], count }));

/** A backend whose roster has `spec = { dept: staffSize }` (default pairs: СР1-СР3, СР2-СР5, СР6-СР9). */
function withTeam(spec = { 'СР1': 4, 'СР3': 2 }, options) {
    const b = loadBackend(options);
    const entries = Object.entries(spec).flatMap(([dept, n]) => names(dept, n).map(name => ({ name, dept })));
    assert.equal(b.post({ action: 'importRoster', entries }).ok, true);
    return b;
}

const leader = (status, rop) => status.leaders.find(l => l.rop === rop);

/* ----------------------------------------------------------------- display key / first use */

test('the public GET needs the display key — without a configured one nothing is served', () => {
    assert.equal(loadBackend({ displayKey: null }).get().error, 'display_key_not_set');
    const b = loadBackend();
    assert.equal(b.get(null).error, 'bad_display_key');
    assert.equal(b.get('wrong-key-wrong-key').error, 'bad_display_key');
    assert.equal(b.get().ok, true);
});

test('first use creates every tab with its headers and the default departments, pairs and settings', () => {
    const b = loadBackend();
    assert.deepEqual(b.sheetNames(), []);
    const status = b.get();
    assert.deepEqual(b.sheetNames().sort(), ['Дни', 'Команда', 'Настройки', 'Пары', 'Подразделения', 'Снимки'].sort());
    assert.deepEqual(status.period, { id: 1, dayIndex: 0, daysTotal: 5, state: 'active' });
    assert.deepEqual(status.pairs, [{ id: 1, left: 'СР1', right: 'СР3' }, { id: 2, left: 'СР2', right: 'СР5' }, { id: 3, left: 'СР6', right: 'СР9' }]);
    assert.deepEqual(status.leaders.map(l => [l.rop, l.stars, l.staff, l.dayCount]), ['СР1', 'СР2', 'СР3', 'СР5', 'СР6', 'СР9'].map(c => [c, 0, 0, 0]));
    assert.equal(status.lastImport, null);
    assert.deepEqual(status.commands, []);
    assert.equal(status.serverNow, b.now());
    assert.equal(b.sheet('Команда').rows[0][0], 'ФИО');
});

test('the public GET never contains the PIN, its hash or the display key', () => {
    const b = withTeam();
    b.post({ action: 'changePin', newPin: '987654' });
    const text = JSON.stringify(b.get());
    assert.ok(!text.includes('987654') && !text.includes('ADMIN_PIN') && !text.includes('testkey'));
});

test('the public GET is cached for a few seconds and every write drops the cache', () => {
    const b = withTeam();
    b.get();
    assert.ok(b.cacheStore.has('status_core_v1'));
    assert.equal(b.post({ action: 'saveDepartment', code: 'СР1', leader: 'Орлов Игорь Петрович' }).ok, true);
    assert.ok(!b.cacheStore.has('status_core_v1'));
    assert.equal(leader(b.get(), 'СР1').name, 'Орлов Игорь Петрович');
    // the command queue and the clock are never cached
    b.post({ action: 'command', type: 'confetti' });
    assert.equal(b.get().commands.length, 1);
});

/* ----------------------------------------------------------------- PIN */

test('wrong PIN is refused and changes nothing', () => {
    const b = withTeam();
    assert.deepEqual(b.post({ pin: '0000', action: 'setStars', rop: 'СР1', stars: 1 }), { ok: false, error: 'invalid_pin' });
    assert.equal(leader(b.get(), 'СР1').stars, 0);
});

test('login checks the PIN; missing or absurd PINs fail; an unknown action is refused', () => {
    const b = loadBackend();
    assert.deepEqual(b.post({ action: 'login' }), { ok: true });
    assert.equal(b.post({ action: 'login', pin: null }).error, 'invalid_pin');
    assert.equal(b.post({ action: 'login', pin: 'x'.repeat(500) }).error, 'invalid_pin');
    assert.equal(b.post({ action: 'nope' }).error, 'bad_request');
    assert.equal(b.postRaw('not json').error, 'bad_request');
    assert.equal(b.postRaw('"just a string"').error, 'bad_request');
});

test('five wrong PINs lock the API; even the right PIN waits; it unlocks after the lock time', () => {
    const b = loadBackend();
    for (let i = 0; i < 4; i++) assert.equal(b.post({ action: 'login', pin: 'bad' + i }).error, 'invalid_pin');
    const fifth = b.post({ action: 'login', pin: 'bad5' });
    assert.equal(fifth.error, 'locked');
    assert.ok(fifth.retryAfterSec > 0 && fifth.retryAfterSec <= 600);
    assert.equal(b.post({ action: 'login', pin: PIN }).error, 'locked');
    b.advance(601 * 1000);
    assert.deepEqual(b.post({ action: 'login', pin: PIN }), { ok: true });
});

test('changePin stores a salted hash, the old PIN stops working, bad formats are refused', () => {
    const b = loadBackend();
    assert.equal(b.post({ action: 'changePin', newPin: 'abcd' }).field, 'newPin');
    assert.equal(b.post({ action: 'changePin', newPin: '1234' }).field, 'newPin_same');
    assert.deepEqual(b.post({ action: 'changePin', newPin: '55667788' }), { ok: true });
    assert.equal(b.post({ action: 'login' }).error, 'invalid_pin'); // the harness still sends 1234
    assert.deepEqual(b.post({ action: 'login', pin: '55667788' }), { ok: true });
    const stored = b.props.get('ADMIN_PIN_HASH');
    assert.match(stored, /^[0-9a-f-]+\$[0-9a-f]{64}$/);
    assert.ok(!stored.includes('55667788'));
});

/* ----------------------------------------------------------------- roster */

test('importRoster adds, moves and keeps; names match loosely (ё/е, spaces, case); titles are saved', () => {
    const b = loadBackend();
    const first = b.post({
        action: 'importRoster',
        entries: [{ name: 'Артёмова Анна Ивановна', dept: 'СР1' }, { name: 'Белов Борис Петрович', dept: 'СР2' }],
        deptTitles: { 'СР1': 'КЦПК_НП_СР_Тверь_СР1_ГБ' },
    });
    assert.deepEqual([first.added, first.moved, first.unchanged, first.total], [2, 0, 0, 2]);

    const second = b.post({
        action: 'importRoster',
        entries: [{ name: 'артемова   анна ивановна', dept: 'СР3' }, { name: 'Новый Сотрудник Сергеевич', dept: 'СР3' }],
    });
    assert.deepEqual([second.added, second.moved, second.unchanged, second.total], [1, 1, 0, 3]);
    const team = b.table('Команда');
    assert.deepEqual(team.find(r => r[0] === 'Артёмова Анна Ивановна').slice(0, 3), ['Артёмова Анна Ивановна', 'СР3', true]);
    assert.equal(b.table('Подразделения')[0][1], 'КЦПК_НП_СР_Тверь_СР1_ГБ');

    const third = b.post({ action: 'importRoster', entries: [{ name: 'Новый Сотрудник Сергеевич', dept: 'СР3' }], deactivateMissing: true });
    assert.deepEqual([third.unchanged, third.deactivated], [1, 2]);
    assert.equal(leader(b.get(), 'СР3').staff, 1);
    assert.equal(b.get().managers.length, 1);
});

test('importRoster refuses bad entries without changing anything', () => {
    const b = loadBackend();
    assert.equal(b.post({ action: 'importRoster', entries: [] }).field, 'entries');
    assert.deepEqual(b.post({ action: 'importRoster', entries: [{ name: 'Иванов Иван', dept: 'СР1' }, { name: 'Петров Пётр', dept: 'СР7' }] }),
        { ok: false, error: 'bad_request', field: 'entries', row: 2 });
    assert.equal(b.post({ action: 'importRoster', entries: [{ name: '=HYPERLINK("x")', dept: 'СР1' }] }).error, 'bad_request');
    assert.deepEqual(b.table('Команда') ?? [], []);
});

test('saveManager: add, rename, move to another department, deactivate; duplicates and unknown names are refused', () => {
    const b = withTeam({ 'СР1': 2 });
    assert.equal(b.post({ action: 'saveManager', name: 'Новая Сотрудница', dept: 'СР2' }).ok, true);
    assert.equal(b.post({ action: 'saveManager', name: 'новая  сотрудница', dept: 'СР2' }).error, 'duplicate_name');

    const edited = b.post({ action: 'saveManager', originalName: 'Новая Сотрудница', name: 'Новая Сотрудница-Иванова', dept: 'СР3', active: false });
    assert.deepEqual(edited.manager, { name: 'Новая Сотрудница-Иванова', dept: 'СР3', active: false, day: 0, prior: 0 });
    assert.equal(leader(b.get(), 'СР3').staff, 0, 'a deactivated manager is not in the staff');
    assert.equal(leader(b.get(), 'СР2').staff, 0);

    assert.equal(b.post({ action: 'saveManager', originalName: 'Никто Такой', name: 'Кто-то', dept: 'СР1' }).error, 'not_found');
    // renaming onto somebody else
    assert.equal(b.post({ action: 'saveManager', originalName: 'Новая Сотрудница-Иванова', name: names('СР1', 2)[0], dept: 'СР1' }).error, 'duplicate_name');
    // bad input
    assert.equal(b.post({ action: 'saveManager', name: 'Х', dept: 'СР1' }).field, 'name');
    assert.equal(b.post({ action: 'saveManager', name: '+7 (999)', dept: 'СР1' }).field, 'name');
    assert.equal(b.post({ action: 'saveManager', name: 'Иванов Иван', dept: 'СР42' }).field, 'dept');
});

test('a manager moved to another department takes their counts with them', () => {
    const b = withTeam({ 'СР1': 2, 'СР3': 1 });
    b.post({ action: 'importSnapshot', rows: [...rowsFor('СР1', [4, 1]), ...rowsFor('СР3', [2])] });
    b.post({ action: 'saveManager', originalName: names('СР1', 2)[0], name: names('СР1', 2)[0], dept: 'СР3' });
    const status = b.get();
    assert.deepEqual([leader(status, 'СР1').staff, leader(status, 'СР1').dayCount], [1, 1]);
    assert.deepEqual([leader(status, 'СР3').staff, leader(status, 'СР3').dayCount], [2, 6]);
});

test('deleteManager removes from the roster, history stays; unknown name is refused', () => {
    const b = withTeam({ 'СР1': 2 });
    b.post({ action: 'importSnapshot', rows: rowsFor('СР1', [3, 3]) });
    assert.equal(b.post({ action: 'deleteManager', name: names('СР1', 2)[1] }).ok, true);
    assert.equal(b.get().managers.length, 1);
    assert.equal(b.table('Снимки').length, 2);
    assert.equal(b.post({ action: 'deleteManager', name: names('СР1', 2)[1] }).error, 'not_found');
});

test('saveDepartment sets the title and the leader; formulas and bad codes are refused', () => {
    const b = loadBackend();
    assert.equal(b.post({ action: 'saveDepartment', code: 'СР2', title: 'Финансы', leader: 'Орлова Анна Игоревна' }).ok, true);
    assert.deepEqual(b.table('Подразделения')[1].slice(0, 3), ['СР2', 'Финансы', 'Орлова Анна Игоревна']);
    assert.equal(b.post({ action: 'saveDepartment', code: 'СР2', leader: '' }).ok, true);
    assert.equal(leader(b.get(), 'СР2').name, undefined);
    assert.equal(b.post({ action: 'saveDepartment', code: 'СР9', title: '=1+1' }).field, 'title');
    assert.equal(b.post({ action: 'saveDepartment', code: 'СР99', title: 'x' }).field, 'code');
    assert.equal(b.post({ action: 'saveDepartment', code: 'СР1' }).error, 'bad_request');
});

test('a person editing the sheet by hand is understood: "нет" deactivates, blank rows are ignored', () => {
    const b = withTeam({ 'СР1': 3 });
    b.sheet('Команда').getRange(2, 3).setValue('нет');
    b.sheet('Команда').getRange(10, 1).setValue('   '); // a stray blank-looking row
    assert.equal(leader(b.get(), 'СР1').staff, 2);
});

/* ----------------------------------------------------------------- imports */

test('importSnapshot records the counts, the history and the before/after day sums of every department', () => {
    const b = withTeam({ 'СР1': 4, 'СР3': 2 });
    const res = b.post({ action: 'importSnapshot', rows: [...rowsFor('СР1', [3, 1, 0, 2]), ...rowsFor('СР3', [5, 4])] });
    assert.deepEqual([res.ok, res.importId, res.applied, res.changed], [true, 1, 6, 5]);

    const status = b.get();
    assert.deepEqual([leader(status, 'СР1').staff, leader(status, 'СР1').dayCount, leader(status, 'СР1').periodCount], [4, 6, 6]);
    assert.deepEqual([leader(status, 'СР3').staff, leader(status, 'СР3').dayCount], [2, 9]);
    assert.equal(status.lastImport.id, 1);
    assert.deepEqual(status.lastImport.before, { 'СР1': 0, 'СР2': 0, 'СР3': 0, 'СР5': 0, 'СР6': 0, 'СР9': 0 });
    assert.deepEqual(status.lastImport.after, { 'СР1': 6, 'СР2': 0, 'СР3': 9, 'СР5': 0, 'СР6': 0, 'СР9': 0 });
    assert.equal(status.managers.length, 6);

    const snaps = b.table('Снимки');
    assert.equal(snaps.length, 6);
    assert.deepEqual(snaps[0].filter((_, i) => i !== 1), [1, 1, names('СР1', 4)[0], 'СР1', 3, 3]);
    assert.ok(snaps[0][1] instanceof Date);

    // the second import: cumulative, only the growth is a delta, and before/after follow
    b.post({ action: 'importSnapshot', rows: rowsFor('СР1', [3, 2, 0, 4]) });
    const again = b.get();
    assert.equal(again.lastImport.id, 2);
    assert.deepEqual([again.lastImport.before['СР1'], again.lastImport.after['СР1']], [6, 9]);
    assert.deepEqual(b.table('Снимки').slice(6).map(r => r[6]), [0, 1, 0, 2]);
});

test('importSnapshot is all-or-nothing: unknown names are refused with the list and nothing is written', () => {
    const b = withTeam({ 'СР1': 2 });
    const res = b.post({ action: 'importSnapshot', rows: [...rowsFor('СР1', [1, 1]), { name: 'Чужой Человек', count: 4 }, { name: 'Ещё Один', count: 1 }] });
    assert.deepEqual(res, { ok: false, error: 'unknown_managers', names: ['Чужой Человек', 'Ещё Один'] });
    assert.equal(leader(b.get(), 'СР1').dayCount, 0);
    assert.deepEqual(b.table('Снимки'), []);
});

test('addUnknown creates the managers named in the import (with a department), once', () => {
    const b = withTeam({ 'СР1': 1 });
    const res = b.post({
        action: 'importSnapshot',
        rows: [...rowsFor('СР1', [1]), { name: 'Чужой Человек', count: 4 }],
        addUnknown: [{ name: 'Чужой Человек', dept: 'СР2' }],
    });
    assert.deepEqual([res.ok, res.added, res.applied], [true, 1, 2]);
    assert.deepEqual([leader(b.get(), 'СР2').staff, leader(b.get(), 'СР2').dayCount], [1, 4]);
    assert.equal(b.post({ action: 'importSnapshot', rows: [{ name: 'Чужой Человек', count: 4 }], addUnknown: [{ name: 'Чужой Человек', dept: 'СР3' }] }).added, 0);
    assert.equal(b.post({ action: 'importSnapshot', rows: [{ name: 'Кто Угодно', count: 1 }], addUnknown: [{ name: 'Кто Угодно', dept: 'СР77' }] }).field, 'addUnknown');
});

test('counts that went down are refused (with the list) unless allowDecrease says it is a correction', () => {
    const b = withTeam({ 'СР1': 2 });
    b.post({ action: 'importSnapshot', rows: rowsFor('СР1', [5, 5]) });
    const refused = b.post({ action: 'importSnapshot', rows: rowsFor('СР1', [3, 6]) });
    assert.deepEqual(refused, { ok: false, error: 'count_decreased', items: [{ name: names('СР1', 2)[0], from: 5, to: 3 }] });
    assert.equal(leader(b.get(), 'СР1').dayCount, 10);

    const corrected = b.post({ action: 'importSnapshot', rows: rowsFor('СР1', [3, 6]), allowDecrease: true });
    assert.equal(corrected.ok, true);
    assert.equal(leader(b.get(), 'СР1').dayCount, 9);
    assert.equal(b.table('Снимки').at(-2)[6], -2);
});

test('importSnapshot validates the rows: counts must be whole numbers from 0, names present', () => {
    const b = withTeam({ 'СР1': 1 });
    const name = names('СР1', 1)[0];
    for (const count of [-1, 1.5, 'abc', null, 1e9]) {
        assert.equal(b.post({ action: 'importSnapshot', rows: [{ name, count }] }).error, 'bad_request', String(count));
    }
    assert.deepEqual(b.post({ action: 'importSnapshot', rows: [{ name: '', count: 1 }] }), { ok: false, error: 'bad_request', field: 'rows', row: 1 });
    assert.equal(b.post({ action: 'importSnapshot', rows: [] }).field, 'rows');
    assert.equal(b.post({ action: 'importSnapshot', rows: 'x' }).field, 'rows');
    assert.equal(leader(b.get(), 'СР1').dayCount, 0);
});

test('inactive managers in the file are skipped (and listed); a name twice in the file counts once, the last value', () => {
    const b = withTeam({ 'СР1': 3 });
    const [a, c, d] = names('СР1', 3);
    b.post({ action: 'saveManager', originalName: d, name: d, dept: 'СР1', active: false });
    const res = b.post({ action: 'importSnapshot', rows: [{ name: a, count: 2 }, { name: a.toLowerCase(), count: 5 }, { name: c, count: 1 }, { name: d, count: 9 }] });
    assert.deepEqual([res.ok, res.applied, res.skipped, res.duplicates], [true, 2, [d], [a]]);
    assert.deepEqual([leader(b.get(), 'СР1').staff, leader(b.get(), 'СР1').dayCount], [2, 6]);
});

test('a managers absent from the file keep their count', () => {
    const b = withTeam({ 'СР1': 3 });
    b.post({ action: 'importSnapshot', rows: rowsFor('СР1', [2, 2, 2]) });
    b.post({ action: 'importSnapshot', rows: [{ name: names('СР1', 3)[0], count: 5 }] });
    assert.equal(leader(b.get(), 'СР1').dayCount, 9);
});

test('a repeated request (same requestId) runs once', () => {
    const b = withTeam({ 'СР1': 1 });
    const req = { action: 'importSnapshot', rows: rowsFor('СР1', [3]), requestId: 'abc-1' };
    const first = b.post(req);
    const second = b.post(req);
    assert.deepEqual(second, first);
    assert.equal(b.table('Снимки').length, 1);
    assert.equal(b.get().lastImport.id, 1);
});

test('every write takes the script lock, a read does not', () => {
    const b = withTeam({ 'СР1': 1 });
    const before = b.lockCalls.count;
    b.get();
    b.post({ action: 'getAdminState' });
    assert.equal(b.lockCalls.count, before);
    b.post({ action: 'importSnapshot', rows: rowsFor('СР1', [1]) });
    assert.equal(b.lockCalls.count, before + 1);
});

test('getAdminState gives the whole picture (all managers incl. inactive, departments, pairs, settings, key flag)', () => {
    const b = withTeam({ 'СР1': 2 });
    b.post({ action: 'saveManager', originalName: names('СР1', 2)[1], name: names('СР1', 2)[1], dept: 'СР1', active: false });
    const state = b.post({ action: 'getAdminState' });
    assert.equal(state.ok, true);
    assert.deepEqual(state.team.map(m => m.active), [true, false]);
    assert.equal(state.depts.length, 6);
    assert.equal(state.pairs.length, 3);
    assert.deepEqual(state.settings, { daysPerPeriod: 5, targetAvg: 1.2 });
    assert.equal(state.displayKeySet, true);
    assert.equal(state.status.managers.length, 1);
});

/* ----------------------------------------------------------------- pairs */

test('setPairs: up to three pairs, every department at most once; the screens see it at once', () => {
    const b = loadBackend();
    assert.deepEqual(b.post({ action: 'setPairs', pairs: [{ left: 'СР5', right: 'СР1' }, { left: 'СР2', right: 'СР9' }] }).pairs,
        [{ id: 1, left: 'СР5', right: 'СР1' }, { id: 2, left: 'СР2', right: 'СР9' }]);
    b.get();
    assert.deepEqual(b.get().pairs.map(p => [p.left, p.right]), [['СР5', 'СР1'], ['СР2', 'СР9']]);

    assert.equal(b.post({ action: 'setPairs', pairs: [{ left: 'СР1', right: 'СР1' }] }).error, 'bad_request');
    assert.equal(b.post({ action: 'setPairs', pairs: [{ left: 'СР1', right: 'СР2' }, { left: 'СР2', right: 'СР3' }] }).row, 2);
    assert.equal(b.post({ action: 'setPairs', pairs: [] }).field, 'pairs');
    assert.equal(b.post({ action: 'setPairs', pairs: [{ left: 'СР1', right: 'СР2' }, { left: 'СР3', right: 'СР5' }, { left: 'СР6', right: 'СР9' }, { left: 'СР1', right: 'СР2' }] }).field, 'pairs');
    assert.equal(b.post({ action: 'setPairs', pairs: [{ left: 'СР1', right: 'СР77' }] }).error, 'bad_request');
    assert.deepEqual(b.get().pairs.length, 2, 'a refused request changes nothing');
});

/* ----------------------------------------------------------------- the day */

test('finishDay decides a pair by the AVERAGE per employee: the bigger group with more invoices loses to the smaller one', () => {
    const b = withTeam({ 'СР1': 6, 'СР3': 2, 'СР2': 1, 'СР5': 1 });
    // СР1: 9 invoices over 6 people = 1.5 each; СР3: 4 over 2 = 2.0 each → СР3 wins although СР1 has more invoices (9 > 4).
    b.post({ action: 'importSnapshot', rows: [...rowsFor('СР1', [2, 2, 2, 1, 1, 1]), ...rowsFor('СР3', [2, 2]), ...rowsFor('СР2', [3]), ...rowsFor('СР5', [3])] });

    const res = b.post({ action: 'finishDay' });
    assert.equal(res.ok, true);
    assert.equal(res.dayNo, 1);
    const [p1, p2, p3] = res.results;
    assert.deepEqual([p1.winner, p1.leftSum, p1.leftStaff, p1.leftAvg, p1.rightAvg], ['СР3', 9, 6, 1.5, 2]);
    assert.equal(p2.winner, 'draw', 'equal averages');
    assert.equal(p3.winner, 'draw', 'two empty groups');
    assert.deepEqual([p1.starsBefore, p1.starsAfter], [{ 'СР1': 0, 'СР3': 0 }, { 'СР1': 0, 'СР3': 1 }], 'the winner gains a star');
    assert.deepEqual(p2.starsAfter, { 'СР2': 0, 'СР5': 0 }, 'a draw gives none');

    const status = b.get();
    assert.deepEqual([leader(status, 'СР1').stars, leader(status, 'СР3').stars, leader(status, 'СР2').stars], [0, 1, 0]);
    // the day is archived, the week keeps the counts, the new day starts from zero
    assert.deepEqual([leader(status, 'СР1').dayCount, leader(status, 'СР1').periodCount], [0, 9]);
    assert.deepEqual([status.period.dayIndex, status.period.state], [1, 'active']);
    assert.equal(b.table('Дни').length, 6);
    assert.deepEqual(b.table('Дни')[0].filter((_, i) => ![3].includes(i)), [1, 1, 1, 'СР1', 9, 6, 1.5, 1, 'поражение', 0]);
    assert.equal(b.table('Дни')[2][9], 'победа');
    assert.equal(b.table('Дни')[4][9], 'ничья');
    assert.deepEqual(b.table('Подразделения')[0].slice(3), [0, 0, 1, 0]);
    assert.deepEqual(b.table('Подразделения')[2].slice(3), [1, 1, 0, 0]);

    // the displays get the result as a command
    const finale = status.commands.find(c => c.type === 'finale');
    assert.equal(finale.args.dayNo, 1);
    assert.equal(finale.args.periodFinished, false);
    assert.equal(finale.args.results[0].winner, 'СР3');
});

test('the next day starts from zero: the same counts as yesterday are not a decrease', () => {
    const b = withTeam({ 'СР1': 1, 'СР3': 1 });
    b.post({ action: 'importSnapshot', rows: [...rowsFor('СР1', [5]), ...rowsFor('СР3', [2])] });
    b.post({ action: 'finishDay' });
    assert.equal(b.post({ action: 'importSnapshot', rows: [...rowsFor('СР1', [1]), ...rowsFor('СР3', [2])] }).ok, true);
    assert.equal(leader(b.get(), 'СР1').periodCount, 6);
    assert.equal(b.table('Снимки').at(-1)[2], 2, 'snapshots carry the id of their day');
});

test('finishDay refuses without pairs', () => {
    const b = loadBackend();
    b.get();
    b.sheet('Пары').getRange(2, 2, 3, 2).clearContent();
    assert.equal(b.post({ action: 'finishDay' }).error, 'no_pairs');
});

test('the week: after the last day each pair\'s match goes to the one with more stars; level stars → the higher weekly average', () => {
    const b = withTeam({ 'СР1': 2, 'СР3': 2 });
    assert.equal(b.post({ action: 'setSettings', daysPerPeriod: 2 }).ok, true);
    // day 1: СР1 wins (avg 5 vs 1); day 2: СР3 wins (avg 2 vs 1) — stars 1:1, weekly averages 6 vs 3 → СР1 takes the match
    b.post({ action: 'importSnapshot', rows: [...rowsFor('СР1', [5, 5]), ...rowsFor('СР3', [1, 1])] });
    assert.equal(b.post({ action: 'finishDay' }).periodFinished, false);
    b.post({ action: 'importSnapshot', rows: [...rowsFor('СР1', [1, 1]), ...rowsFor('СР3', [2, 2])] });
    const last = b.post({ action: 'finishDay' });
    assert.equal(last.periodFinished, true);
    assert.deepEqual([leader(b.get(), 'СР1').stars, leader(b.get(), 'СР3').stars], [1, 1]);
    assert.equal(last.matchWinners['1'], 'СР1');

    const status = b.get();
    assert.deepEqual([status.period.state, status.period.dayIndex, status.period.daysTotal], ['finished', 2, 2]);
    assert.equal(status.period.winners['1'], 'СР1');
    assert.equal(status.period.winners['3'], 'draw');
    assert.equal(status.commands.at(-1).args.periodFinished, true);

    // a finished week takes no more imports or days
    assert.equal(b.post({ action: 'importSnapshot', rows: rowsFor('СР1', [9, 9]) }).error, 'period_finished');
    assert.equal(b.post({ action: 'finishDay' }).error, 'period_finished');

    // a new week: no stars, counters cleared, the match running
    assert.equal(b.post({ action: 'newPeriod' }).periodId, 2);
    const fresh = b.get();
    assert.deepEqual(fresh.period, { id: 2, dayIndex: 0, daysTotal: 2, state: 'active' });
    assert.deepEqual(fresh.leaders.map(l => [l.stars, l.dayCount, l.periodCount]), fresh.leaders.map(() => [0, 0, 0]));
    assert.deepEqual(b.table('Подразделения').map(r => r.slice(3)), b.table('Подразделения').map(() => [0, 0, 0, 0]));
    assert.equal(b.post({ action: 'importSnapshot', rows: rowsFor('СР1', [1, 1]) }).ok, true);
});

test('a star is a day won: the winner gains one, the loser and a draw gain nothing, never above the 5 slots', () => {
    const b = withTeam({ 'СР1': 1, 'СР3': 1 });
    const stars = () => [leader(b.get(), 'СР1').stars, leader(b.get(), 'СР3').stars];
    assert.deepEqual(stars(), [0, 0], 'a week starts with empty stars');
    b.post({ action: 'importSnapshot', rows: [...rowsFor('СР1', [3]), ...rowsFor('СР3', [1])] });
    b.post({ action: 'finishDay' });
    assert.deepEqual(stars(), [1, 0]);
    b.post({ action: 'importSnapshot', rows: [...rowsFor('СР1', [1]), ...rowsFor('СР3', [2])] });
    b.post({ action: 'finishDay' });
    assert.deepEqual(stars(), [1, 1]);
    b.post({ action: 'importSnapshot', rows: [...rowsFor('СР1', [2]), ...rowsFor('СР3', [2])] });
    b.post({ action: 'finishDay' });
    assert.deepEqual(stars(), [1, 1], 'a draw gives nothing');
    b.post({ action: 'setStars', rop: 'СР1', stars: 5 });
    b.post({ action: 'importSnapshot', rows: [...rowsFor('СР1', [4]), ...rowsFor('СР3', [1])] });
    b.post({ action: 'finishDay' });
    assert.deepEqual(stars(), [5, 1], 'never above 5');
});

test('the match is decided by stars when they differ (more stars wins)', () => {
    const b = withTeam({ 'СР1': 1, 'СР3': 1 });
    b.post({ action: 'setSettings', daysPerPeriod: 1 });
    b.post({ action: 'importSnapshot', rows: [...rowsFor('СР1', [1]), ...rowsFor('СР3', [4])] });
    assert.equal(b.post({ action: 'finishDay' }).matchWinners['1'], 'СР3');
});

test('setStars corrects a department\'s stars within 0..5', () => {
    const b = loadBackend();
    assert.deepEqual(b.post({ action: 'setStars', rop: 'СР5', stars: 2 }), { ok: true, rop: 'СР5', stars: 2 });
    assert.equal(leader(b.get(), 'СР5').stars, 2);
    for (const stars of [-1, 6, 2.5, 'x']) assert.equal(b.post({ action: 'setStars', rop: 'СР5', stars }).field, 'stars');
    assert.equal(b.post({ action: 'setStars', rop: 'СР0', stars: 1 }).field, 'rop');
});

test('setSettings: days per week 1..5 (one star slot per day)', () => {
    const b = loadBackend();
    assert.equal(b.post({ action: 'setSettings', daysPerPeriod: 4 }).daysPerPeriod, 4);
    assert.equal(b.get().period.daysTotal, 4);
    for (const daysPerPeriod of [0, 6, 11, 2.5, 'x']) assert.equal(b.post({ action: 'setSettings', daysPerPeriod }).field, 'daysPerPeriod');
});

/* ----------------------------------------------------------------- history */

test('listSnapshots / listDays: newest first, limited, filterable by import', () => {
    const b = withTeam({ 'СР1': 2 });
    b.post({ action: 'importSnapshot', rows: rowsFor('СР1', [1, 1]) });
    b.post({ action: 'importSnapshot', rows: rowsFor('СР1', [2, 3]) });
    const all = b.post({ action: 'listSnapshots' });
    assert.equal(all.total, 4);
    assert.deepEqual(all.rows.map(r => r.importId), [2, 2, 1, 1]);
    assert.equal(all.rows[0].time, '2026-09-30 10:00');
    assert.equal(all.rows[0].delta, 2);
    assert.equal(b.post({ action: 'listSnapshots', limit: 1 }).rows.length, 1);
    assert.deepEqual(b.post({ action: 'listSnapshots', importId: 1 }).rows.map(r => r.count), [1, 1]);

    b.post({ action: 'finishDay' });
    const days = b.post({ action: 'listDays' });
    assert.equal(days.total, 6);
    assert.deepEqual(days.rows.find(r => r.dept === 'СР1'), { dayId: 1, periodId: 1, dayNo: 1, time: '2026-09-30 10:00', dept: 'СР1', sum: 5, staff: 2, avg: 2.5, pair: 1, outcome: 'победа', starsAfter: 1 }, 'a group with people beats an empty one');
});

/* ----------------------------------------------------------------- display key / commands */

test('setDisplayKey generates or sets the key the screens need; the old key stops working', () => {
    const b = loadBackend();
    const made = b.post({ action: 'setDisplayKey' });
    assert.match(made.key, /^[a-z0-9]{28}$/);
    assert.equal(b.get('testkey-0123456789').error, 'bad_display_key');
    assert.equal(b.get(made.key).ok, true);
    assert.equal(b.post({ action: 'getDisplayKey' }).key, made.key);
    assert.equal(b.post({ action: 'setDisplayKey', key: 'short' }).field, 'key');
    assert.equal(b.post({ action: 'setDisplayKey', key: 'a-fine-custom-key-123' }).key, 'a-fine-custom-key-123');
    assert.equal(loadBackend({ displayKey: null }).post({ action: 'getDisplayKey' }).key, null);
});

test('commands: demo fight, demo finale, confetti; validated; the queue keeps ten and drops the old ones', () => {
    const b = withTeam({ 'СР1': 2, 'СР3': 2 });
    assert.equal(b.post({ action: 'command', type: 'fight', args: { pairId: 1, leftAvg: 2.5, rightAvg: 0.4 } }).id, 1);
    assert.equal(b.post({ action: 'command', type: 'fight', args: { pairId: 1, leftAvg: 2, rightAvg: 1, sample: 30 } }).ok, true);
    for (const args of [{}, { pairId: 1, leftAvg: -1, rightAvg: 1 }, { pairId: 1, leftAvg: 'x', rightAvg: 1 }, { pairId: 1, leftAvg: 1, rightAvg: 1, sample: -3 }]) {
        assert.equal(b.post({ action: 'command', type: 'fight', args }).error, 'bad_request');
    }
    assert.equal(b.post({ action: 'command', type: 'explode' }).field, 'type');

    b.post({ action: 'importSnapshot', rows: [...rowsFor('СР1', [4, 4]), ...rowsFor('СР3', [1, 1])] });
    assert.equal(b.post({ action: 'command', type: 'finale' }).ok, true);
    const demo = b.get().commands.find(c => c.type === 'finale');
    assert.equal(demo.args.demo, true);
    assert.equal(demo.args.results[0].winner, 'СР1');
    assert.deepEqual(demo.args.results[0].starsBefore, demo.args.results[0].starsAfter, 'a demo takes no star');
    assert.equal(leader(b.get(), 'СР3').stars, 0);
    assert.equal(leader(b.get(), 'СР1').stars, 0);

    for (let i = 0; i < 12; i++) b.post({ action: 'command', type: 'confetti' });
    const queue = b.get().commands;
    assert.equal(queue.length, 10);
    assert.deepEqual(queue.map(c => c.id), [...queue.map(c => c.id)].sort((x, y) => x - y));
    b.advance(11 * 60 * 1000);
    assert.deepEqual(b.get().commands, []);
});

/* ----------------------------------------------------------------- regressions found in the full review */

test('the target average is a setting (default 1.20), reaches the screens, and is validated', () => {
    const b = loadBackend();
    assert.equal(b.get().targetAvg, 1.2);
    assert.deepEqual(b.post({ action: 'setSettings', targetAvg: 1.5 }), { ok: true, daysPerPeriod: 5, targetAvg: 1.5 });
    assert.equal(b.get().targetAvg, 1.5);
    assert.deepEqual(b.post({ action: 'setSettings', daysPerPeriod: 4, targetAvg: 0.8 }), { ok: true, daysPerPeriod: 4, targetAvg: 0.8 });
    assert.equal(b.post({ action: 'setSettings', targetAvg: 1.234 }).targetAvg, 1.23, 'two decimals are enough');
    for (const targetAvg of [0, -1, 51, 'x', null, '']) assert.equal(b.post({ action: 'setSettings', targetAvg }).field, 'targetAvg', String(targetAvg));
    assert.equal(b.post({ action: 'setSettings' }).error, 'bad_request');
    assert.equal(b.post({ action: 'getAdminState' }).settings.targetAvg, 1.23);
    // a bad value written by hand into the sheet falls back to the default instead of breaking the screens
    const row = b.sheet('Настройки').rows.findIndex(r => r[0] === 'TargetAvg');
    b.sheet('Настройки').getRange(row + 1, 2).setValue('abc');
    assert.equal(b.post({ action: 'getAdminState' }).settings.targetAvg, 1.2);
});

test('a department listed in two pairs of a hand-edited sheet fights only once (it must not earn two stars in a day)', () => {
    const b = withTeam({ 'СР1': 1, 'СР2': 1, 'СР3': 1 });
    b.sheet('Пары').getRange(2, 1, 3, 3).setValues([[1, 'СР1', 'СР3'], [2, 'СР1', 'СР2'], [3, 'СР2', 'СР5']]);
    assert.deepEqual(b.get().pairs.map(p => [p.left, p.right]), [['СР1', 'СР3'], ['СР2', 'СР5']]);
    b.post({ action: 'importSnapshot', rows: [...rowsFor('СР1', [1]), ...rowsFor('СР3', [3]), ...rowsFor('СР2', [1])] });
    b.post({ action: 'finishDay' });
    assert.deepEqual(b.get().leaders.map(l => [l.rop, l.stars]), [['СР1', 0], ['СР2', 1], ['СР3', 1], ['СР5', 0], ['СР6', 0], ['СР9', 0]], 'СР3 beat СР1, СР2 beat the empty СР5; nobody earned twice');
});

test('a tab that somebody deleted or renamed is created again instead of failing every request', () => {
    const b = withTeam({ 'СР1': 1 });
    b.post({ action: 'importSnapshot', rows: rowsFor('СР1', [2]) });
    assert.equal(b.deleteSheet('Пары'), true);
    assert.equal(b.deleteSheet('Настройки'), true);
    const state = b.post({ action: 'getAdminState' });
    assert.equal(state.ok, true);
    assert.equal(state.pairs.length, 3, 'the default pairs are back');
    assert.equal(state.settings.daysPerPeriod, 5);
    assert.ok(b.sheetNames().includes('Пары') && b.sheetNames().includes('Настройки'));
    assert.equal(b.get().ok, true);
});

test('names match whatever way the letters are encoded (composed or decomposed "й", "ё")', () => {
    const b = loadBackend();
    const composed = 'Майорова Ёлка Иванова'; // й, Ё as single characters
    const decomposed = composed.normalize('NFD'); // и + combining breve, Е + combining diaeresis
    assert.notEqual(composed, decomposed);
    b.post({ action: 'importRoster', entries: [{ name: composed, dept: 'СР1' }] });
    const res = b.post({ action: 'importSnapshot', rows: [{ name: decomposed, count: 3 }] });
    assert.equal(res.ok, true);
    assert.equal(res.applied, 1);
    assert.equal(b.post({ action: 'saveManager', name: decomposed, dept: 'СР2' }).error, 'duplicate_name');
});

test('the command queue is trimmed by size (a Script Property holds 9 KB), newest first to survive', () => {
    const b = withTeam({ 'СР1': 1, 'СР3': 1, 'СР2': 1, 'СР5': 1, 'СР6': 1, 'СР9': 1 });
    let lastDayNo = 0;
    for (let day = 0; day < 9; day++) { // a week has at most 5 days: the 6th finale is the first day of week 2
        b.post({ action: 'importSnapshot', rows: names('СР1', 1).map(name => ({ name, count: day + 1 })) });
        const res = b.post({ action: 'finishDay' });
        assert.equal(res.ok, true, `day ${day + 1}`);
        lastDayNo = res.dayNo;
        if (res.periodFinished) assert.equal(b.post({ action: 'newPeriod' }).ok, true);
    }
    const raw = b.props.get('COMMANDS');
    assert.ok(raw.length < 9000, `queue JSON is ${raw.length} chars`);
    const queue = b.get().commands;
    assert.ok(queue.length >= 1);
    assert.equal(queue.at(-1).args.dayNo, lastDayNo, 'the newest finale is always kept');
});

test('history listing reads only the newest rows of a huge tab and still reports the real total', () => {
    const b = withTeam({ 'СР1': 1 });
    const sheet = b.sheet('Снимки');
    const many = Array.from({ length: 4500 }, (_, i) => [1 + Math.floor(i / 65), new Date(b.now()), 1, `Имя ${i}`, 'СР1', i, 1]);
    sheet.getRange(2, 1, many.length, 7).setValues(many);
    const res = b.post({ action: 'listSnapshots', limit: 3 });
    assert.equal(res.total, 4500);
    assert.deepEqual(res.rows.map(r => r.name), ['Имя 4499', 'Имя 4498', 'Имя 4497']);
});

test('a hand-written note below a table does not become a manager of a real department', () => {
    const b = withTeam({ 'СР1': 2 });
    b.sheet('Команда').getRange(30, 1).setValue('Заметка: не трогать');
    const status = b.get();
    assert.equal(status.managers.length, 2, 'a row without a valid department is not on the screen');
    assert.equal(leader(status, 'СР1').staff, 2);
});

test('the status is consistent for a department with nobody in it (no NaN, no division by zero)', () => {
    const b = loadBackend();
    const status = b.get();
    assert.ok(status.leaders.every(l => l.staff === 0 && l.dayCount === 0 && l.periodCount === 0));
    const day = b.post({ action: 'finishDay' });
    assert.equal(day.ok, true);
    assert.ok(day.results.every(r => r.winner === 'draw' && Number.isFinite(r.leftAvg) && Number.isFinite(r.rightAvg)));
});

/* ----------------------------------------------------------------- second pass of the review */

test('department codes typed by hand (Latin look-alikes, spaces, lower case) still count', () => {
    const b = withTeam({ 'СР1': 2 });
    b.sheet('Команда').getRange(2, 2).setValue('cp1');      // Latin c and p
    b.sheet('Команда').getRange(3, 2).setValue(' СР 1 ');  // spaces
    b.sheet('Пары').getRange(2, 2, 1, 2).setValues([['CP1', 'ср3']]);
    const status = b.get();
    assert.equal(leader(status, 'СР1').staff, 2);
    assert.deepEqual(status.pairs[0], { id: 1, left: 'СР1', right: 'СР3' });
    assert.equal(b.post({ action: 'saveManager', name: 'Новый Человек', dept: 'cp2' }).manager.dept, 'СР2');
});

test('API values are not guessed: "false" deactivates, null / empty are not zero', () => {
    const b = withTeam({ 'СР1': 1 });
    const [name] = names('СР1', 1);
    assert.equal(b.post({ action: 'saveManager', originalName: name, name, dept: 'СР1', active: 'false' }).manager.active, false);
    assert.equal(b.post({ action: 'saveManager', originalName: name, name, dept: 'СР1', active: true }).manager.active, true);
    for (const stars of [null, '', true]) assert.equal(b.post({ action: 'setStars', rop: 'СР1', stars }).field, 'stars', String(stars));
    for (const args of [{ pairId: null, leftAvg: 1, rightAvg: 1 }, { pairId: 1, leftAvg: null, rightAvg: 1 }, { pairId: 0, leftAvg: 1, rightAvg: 1 }, { pairId: 4, leftAvg: 1, rightAvg: 1 }, { pairId: 1.5, leftAvg: 1, rightAvg: 1 }]) {
        assert.equal(b.post({ action: 'command', type: 'fight', args }).error, 'bad_request', JSON.stringify(args));
    }
});

test('after the week ended, changed pairs do not inherit the old winners', () => {
    const b = withTeam({ 'СР1': 1, 'СР3': 1, 'СР2': 1 });
    b.post({ action: 'setSettings', daysPerPeriod: 1 });
    b.post({ action: 'importSnapshot', rows: [...rowsFor('СР1', [3]), ...rowsFor('СР3', [1])] });
    assert.equal(b.post({ action: 'finishDay' }).matchWinners['1'], 'СР1');
    assert.equal(b.get().period.winners['1'], 'СР1');
    b.post({ action: 'setPairs', pairs: [{ left: 'СР3', right: 'СР2' }] }); // pair 1 is now another pair
    assert.deepEqual(b.get().period.winners, {}, 'СР1 is not part of pair 1 any more');
    b.post({ action: 'setPairs', pairs: [{ left: 'СР2', right: 'СР1' }] });
    assert.equal(b.get().period.winners['1'], 'СР1', 'but it is again once СР1 fights in pair 1');
});

test('the status is rebuilt under the script lock (a GET never reads half of a write), and served from cache otherwise', () => {
    const b = withTeam({ 'СР1': 1 });
    const before = b.lockCalls.reads;
    b.get();
    assert.equal(b.lockCalls.reads, before + 1, 'a cache miss takes the lock');
    b.get();
    assert.equal(b.lockCalls.reads, before + 1, 'a cache hit does not');
});
