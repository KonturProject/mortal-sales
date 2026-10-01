// Run: npm run test:fight   (node >= 22.18 strips the TypeScript types itself)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseTextTable, parseCounts, parseRoster, deptCodeIn, normName } from '../src-admin/parse.ts';

test('deptCodeIn finds the code inside a long department heading, Cyrillic or Latin look-alike letters', () => {
    assert.equal(deptCodeIn('КЦПК_НП_СР_Тверь_СР1_ГБ'), 'СР1');
    assert.equal(deptCodeIn('АП_НП_СР_Москва_СР5_ГБ_УД'), 'СР5');
    assert.equal(deptCodeIn('КЦПК_НП_CP_Тверь_CP6_Право'), 'СР6'); // Latin C and P
    assert.equal(deptCodeIn('СР 9'), 'СР9');
    assert.equal(deptCodeIn('Иванов Иван Иванович'), null);
    assert.equal(deptCodeIn('СР_Тверь'), null);
});

test('parseCounts: name then number per row; headers and notes are reported, not guessed at', () => {
    const { rows, ignored } = parseCounts([
        ['ФИО', 'Счета'],
        ['Иванов Иван Иванович', 3],
        ['  Петрова   Анна ', '5'],
        ['Сидоров Пётр', '2,0'],
        [null, 7],
        [],
        ['Итого', ''],
    ]);
    assert.deepEqual(rows, [{ name: 'Иванов Иван Иванович', count: 3 }, { name: 'Петрова Анна', count: 5 }, { name: 'Сидоров Пётр', count: 2 }]);
    assert.deepEqual(ignored, ['ФИО | Счета', '7', 'Итого']);
});

test('parseTextTable: tabs (pasted from a spreadsheet), semicolons, or "name 5" lines', () => {
    assert.deepEqual(parseTextTable('Иванов Иван\t3\nПетрова Анна\t5\r\n'), [['Иванов Иван', '3'], ['Петрова Анна', '5']]);
    assert.deepEqual(parseTextTable('Иванов Иван;3'), [['Иванов Иван', '3']]);
    assert.deepEqual(parseTextTable('Иванов Иван Иванович 12\nПросто текст\n\n'), [['Иванов Иван Иванович', '12'], ['Просто текст']]);
});

test('parseRoster: headings with the managers beneath, and names above the first heading are unassigned', () => {
    const parsed = parseRoster([
        ['Лишний Человек'],
        ['КЦПК_НП_СР_Тверь_СР1_ГБ'],
        ['Иванов Иван Иванович'],
        ['Петрова Анна Сергеевна'],
        ['КЦПК_НП_СР_Тверь_СР2_Фин'],
        ['Сидоров Пётр Петрович'],
    ]);
    assert.deepEqual(parsed.entries, [
        { name: 'Иванов Иван Иванович', dept: 'СР1' }, { name: 'Петрова Анна Сергеевна', dept: 'СР1' }, { name: 'Сидоров Пётр Петрович', dept: 'СР2' },
    ]);
    assert.deepEqual(parsed.deptTitles, { 'СР1': 'КЦПК_НП_СР_Тверь_СР1_ГБ', 'СР2': 'КЦПК_НП_СР_Тверь_СР2_Фин' });
    assert.deepEqual(parsed.unassigned, ['Лишний Человек']);
});

test('parseRoster: the two-column layout "name | code"', () => {
    const parsed = parseRoster([['Иванов Иван', 'СР3'], ['Петрова Анна', 'СР 5']]);
    assert.deepEqual(parsed.entries, [{ name: 'Иванов Иван', dept: 'СР3' }, { name: 'Петрова Анна', dept: 'СР5' }]);
    assert.deepEqual(parsed.deptTitles, {});
});

test('normName matches like the backend: case, ё/е, spaces', () => {
    assert.equal(normName('  Артёмова   АННА '), 'артемова анна');
});

// The admin's real files stay out of git (*.xlsx is ignored); when they sit in the repo root, check them too.
const ROOT = new URL('../../', import.meta.url);
const countsFile = new URL('Данные для загрузки.xlsx', ROOT);
const rosterFile = new URL('Распределение менеджеров по подразделениям.xlsx', ROOT);

test('the real "Данные для загрузки.xlsx" parses to name + count rows', { skip: !fs.existsSync(countsFile) }, async () => {
    const { readSheet } = await import('read-excel-file/universal');
    const sheet = await readSheet(new Blob([fs.readFileSync(countsFile)]));
    const { rows, ignored } = parseCounts(sheet);
    assert.equal(ignored.length, 0);
    assert.ok(rows.length >= 60, `rows: ${rows.length}`);
    assert.ok(rows.every(r => Number.isInteger(r.count) && r.count >= 0 && r.name.split(' ').length >= 2));
});

test('the real roster file parses to the six departments', { skip: !fs.existsSync(rosterFile) }, async () => {
    const { readSheet } = await import('read-excel-file/universal');
    const parsed = parseRoster(await readSheet(new Blob([fs.readFileSync(rosterFile)])));
    assert.deepEqual(Object.keys(parsed.deptTitles).sort(), ['СР1', 'СР2', 'СР3', 'СР5', 'СР6', 'СР9']);
    assert.deepEqual(parsed.unassigned, []);
    const sizes = Object.fromEntries(Object.keys(parsed.deptTitles).map(code => [code, parsed.entries.filter(e => e.dept === code).length]));
    assert.deepEqual(sizes, { 'СР1': 12, 'СР2': 9, 'СР3': 12, 'СР5': 16, 'СР6': 5, 'СР9': 11 });
    // and the two real files agree with each other
    if (fs.existsSync(countsFile)) {
        return readSheet(new Blob([fs.readFileSync(countsFile)])).then(sheet => {
            const known = new Set(parsed.entries.map(e => normName(e.name)));
            const unknown = parseCounts(sheet).rows.filter(r => !known.has(normName(r.name)));
            assert.deepEqual(unknown, []);
        });
    }
});
