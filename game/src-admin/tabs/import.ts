import { newRequestId, type Manager } from '../api';
import { badge, chip, clear, DEPT_CODES, deptLabel, h, section, select, table } from '../dom';
import { normName, parseCounts, parseTextTable, type CountRow } from '../parse';
import { readTableFile } from '../readFile';
import type { Ctx, Tab } from './types';

interface Item extends CountRow {
    key: string;
    manager?: Manager;
    /** The same person appears again later in the file: the last value counts. */
    shadowed: boolean;
}

/**
 * The 2-hourly import: a file (or text pasted from a spreadsheet) with "ФИО | счета от 20 минут на текущий момент".
 * Nothing is sent until the preview has been checked: unknown names (skip them, or add them to a department),
 * counts that went down (a correction — must be allowed on purpose), inactive managers (skipped), duplicates.
 */
export function importTab(ctx: Ctx): Tab {
    const element = h('div');
    const preview = h('div');
    const fileInput = h('input', { type: 'file', accept: '.xlsx,.csv,.tsv,.txt' });
    const pasteBox = h('textarea', { rows: 5, placeholder: 'Или вставьте сюда строки «ФИО  число» (можно прямо из Excel)…' });
    const readButton = h('button', { type: 'button' }, 'Прочитать');

    let parsed: { rows: CountRow[]; ignored: string[]; label: string } | null = null;
    /** normalized name -> department an unknown name is added to ('' = skip it). */
    const assignment = new Map<string, string>();
    let allowDecrease = false;

    readButton.addEventListener('click', () => void ctx.guard(readButton, async () => {
        const file = fileInput.files?.[0];
        const table = file ? await readTableFile(file) : parseTextTable(pasteBox.value);
        const result = parseCounts(table);
        if (result.rows.length === 0) throw new Error('В данных не нашлось ни одной строки вида «ФИО — число».');
        parsed = { ...result, label: file ? file.name : 'вставленный текст' };
        assignment.clear();
        allowDecrease = false;
        ctx.setStatus(`Прочитано строк: ${result.rows.length}. Проверьте предпросмотр ниже.`, 'ok');
        renderPreview();
    }));

    element.append(
        section('1. Файл или текст',
            h('p', { className: 'hint' }, 'Формат: в строке ФИО и число счетов от 20 минут на текущий момент (накопительно за игровой день). Заголовок не нужен. Подойдёт .xlsx, .csv или текст из буфера. Если выбран файл, текст ниже не используется.'),
            h('div', { className: 'stack' }, h('label', {}, 'Файл'), fileInput, pasteBox, h('div', { className: 'btn-row' }, readButton)),
        ),
        preview,
    );

    function renderPreview() {
        clear(preview);
        if (!parsed) return;
        const team = ctx.state.team;
        const index = new Map(team.map(m => [normName(m.name), m]));

        const lastIndex = new Map<string, number>();
        parsed.rows.forEach((r, i) => lastIndex.set(normName(r.name), i));
        const items: Item[] = parsed.rows.map((r, i) => {
            const key = normName(r.name);
            return { ...r, key, manager: index.get(key), shadowed: lastIndex.get(key) !== i };
        });

        const unknown = [...new Map(items.filter(i => !i.manager).map(i => [i.key, i])).values()];
        const invalid = items.filter(i => !Number.isInteger(i.count) || i.count < 0 || i.count > 100000);
        const inactive = items.filter(i => i.manager && !i.manager.active && !i.shadowed);
        const decreased = items.filter(i => i.manager?.active && !i.shadowed && i.count < i.manager.day);
        const inFile = new Set(items.map(i => i.key));
        const missing = team.filter(m => m.active && !inFile.has(normName(m.name)));

        const sendable = items.filter(i => (i.manager ? i.manager.active : !!assignment.get(i.key)));
        const changed = sendable.filter(i => !i.shadowed && (i.manager ? i.count !== i.manager.day : i.count > 0));
        const finished = ctx.state.status.period.state === 'finished';
        const blocked = invalid.length > 0 || finished || sendable.length === 0 || (decreased.length > 0 && !allowDecrease);

        preview.append(section(`2. Предпросмотр — ${parsed.label}`,
            h('div', { className: 'chips' },
                chip('Строк в файле', String(items.length)),
                chip('Изменится', String(changed.length)),
                chip('Нет в справочнике', String(unknown.length)),
                chip('Уменьшилось', String(decreased.length)),
                chip('Неактивных', String(inactive.length)),
                chip('Не в файле (останутся как были)', String(missing.length)),
            ),
            parsed.ignored.length > 0 ? h('p', { className: 'hint' }, `Пропущено строк без числа: ${parsed.ignored.length} (${parsed.ignored.slice(0, 3).join('; ')}${parsed.ignored.length > 3 ? '…' : ''}).`) : null,
            finished ? h('p', { className: 'error-note' }, 'Неделя завершена — загрузка закрыта. Начните новую неделю на вкладке «День и неделя».') : null,
        ));

        if (unknown.length > 0) {
            const everyone = select([{ value: '', label: '— выберите —' }, ...DEPT_CODES.map(c => ({ value: c, label: deptLabel(c, ctx.state) }))], '');
            const apply = h('button', { type: 'button', className: 'ghost' }, 'Добавить всех новых в это подразделение');
            apply.addEventListener('click', () => {
                if (!everyone.value) return;
                unknown.forEach(u => assignment.set(u.key, everyone.value));
                renderPreview();
            });
            preview.append(section('Этих людей нет в справочнике',
                h('p', { className: 'hint' }, 'Выберите подразделение — человек будет добавлен в справочник и учтён. «Пропустить» — строка не загрузится.'),
                h('div', { className: 'inline-field' }, everyone, apply),
            ));
        }

        const rows = items.map(item => {
            const m = item.manager;
            let dept: string | HTMLElement = m ? deptLabel(m.dept, ctx.state) : '';
            let status: HTMLElement;
            if (!m) {
                dept = select([{ value: '', label: 'пропустить' }, ...DEPT_CODES.map(c => ({ value: c, label: deptLabel(c, ctx.state) }))], assignment.get(item.key) ?? '', value => {
                    assignment.set(item.key, value);
                    renderPreview();
                });
                status = assignment.get(item.key) ? badge('новый — будет добавлен', 'warn') : badge('нет в справочнике — пропуск', 'dim');
            } else if (!m.active) status = badge('неактивен — пропуск', 'dim');
            else if (!Number.isInteger(item.count) || item.count < 0) status = badge('значение не целое', 'bad');
            else if (item.shadowed) status = badge('дубль — учтётся последняя строка', 'warn');
            else if (item.count < m.day) status = badge('меньше, чем было', 'bad');
            else if (item.count === m.day) status = badge('без изменений', 'dim');
            else status = badge('ок', 'ok');
            const before = m ? m.day : 0;
            const delta = item.count - before;
            return [item.name, dept, String(before), String(item.count), delta === 0 ? '' : `${delta > 0 ? '+' : ''}${delta}`, status];
        });
        preview.append(table(
            [{ text: 'ФИО в файле' }, { text: 'Подразделение' }, { text: 'Было', num: true }, { text: 'Станет', num: true }, { text: 'Δ', num: true }, { text: 'Статус' }],
            rows,
        ));

        if (decreased.length > 0) {
            const allow = h('input', { type: 'checkbox', checked: allowDecrease });
            allow.addEventListener('change', () => { allowDecrease = allow.checked; renderPreview(); });
            preview.append(h('label', { className: 'check' }, allow, ` Разрешить уменьшение (${decreased.length}): это исправление ошибки, а не новые счета`));
        }

        const send = h('button', { type: 'button', disabled: blocked }, `Загрузить (${sendable.length})`);
        send.addEventListener('click', () => void ctx.guard(send, async () => {
            const newPeople = unknown.filter(u => assignment.get(u.key));
            const summary = `Загрузить ${sendable.length} строк?\n\nИзменится у ${changed.length}${newPeople.length ? `\nБудет добавлено в справочник: ${newPeople.length}` : ''}${decreased.length ? `\nУменьшится значение у ${decreased.length}` : ''}\n\nНа экранах начнётся бой (в течение ~15 секунд).`;
            if (!confirm(summary)) return;
            ctx.setStatus('Загружаю…');
            const res = await ctx.call<{ importId: number; applied: number; changed: number; added: number; skipped: string[] }>('importSnapshot', {
                rows: sendable.map(i => ({ name: i.name, count: i.count })),
                addUnknown: newPeople.map(u => ({ name: u.name, dept: assignment.get(u.key) })),
                allowDecrease,
                requestId: newRequestId(),
            });
            parsed = null;
            assignment.clear();
            allowDecrease = false;
            fileInput.value = '';
            pasteBox.value = '';
            ctx.setStatus(`Загрузка № ${res.importId}: учтено ${res.applied}, изменилось ${res.changed}${res.added ? `, добавлено сотрудников ${res.added}` : ''}. Бой на экранах начнётся в течение ~15 секунд.`, 'ok');
            await ctx.refresh();
        }));
        const cancel = h('button', { type: 'button', className: 'ghost' }, 'Отмена');
        cancel.addEventListener('click', () => { parsed = null; renderPreview(); ctx.setStatus(''); });
        preview.append(h('div', { className: 'btn-row' }, send, cancel));
    }

    return {
        id: 'import',
        title: 'Загрузка данных',
        element,
        // The roster may have changed (a person added, moved, deactivated): re-check the open preview against it.
        render: renderPreview,
    };
}
