import { type Manager } from '../api';
import { append, badge, chip, clear, DEPT_CODES, deptLabel, h, section, select, setOptions, table } from '../dom';
import { normName, parseRoster, parseTextTable, type ParsedRoster } from '../parse';
import { readTableFile } from '../readFile';
import type { Ctx, Tab } from './types';

const deptOptions = (ctx: Ctx, withAll = false) => [
    ...(withAll ? [{ value: '', label: 'Все подразделения' }] : []),
    ...DEPT_CODES.map(code => ({ value: code, label: deptLabel(code, ctx.state) })),
];

/**
 * The roster: who works in which department, and who counts. A manager can be moved to another department,
 * renamed, put on "inactive" (vacation, left: out of the staff the average is divided by, off the screen's rating)
 * or removed. The one-time "who is in which department" file goes in through "Импорт справочника из файла".
 */
export function teamTab(ctx: Ctx): Tab {
    const element = h('div');
    let query = '';
    let deptFilter = '';
    let showInactive = true;

    const chipsHost = h('div', { className: 'chips' });
    const listHost = h('div');

    /* ----------------------------------------------------------- toolbar (built once, keeps focus) */
    const search = h('input', { type: 'search', placeholder: 'Поиск по ФИО…' });
    search.addEventListener('input', () => { query = normName(search.value); renderList(); });
    const filter = select(deptOptions(ctx, true), '', value => { deptFilter = value; renderList(); });
    const inactiveToggle = h('input', { type: 'checkbox', checked: true });
    inactiveToggle.addEventListener('change', () => { showInactive = inactiveToggle.checked; renderList(); });

    /* ----------------------------------------------------------- add one */
    const newName = h('input', { type: 'text', placeholder: 'Фамилия Имя Отчество', maxLength: 80 });
    const newDept = select(deptOptions(ctx), DEPT_CODES[0]);
    const addButton = h('button', { type: 'button' }, 'Добавить');
    addButton.addEventListener('click', () => void ctx.guard(addButton, async () => {
        await ctx.call('saveManager', { name: newName.value, dept: newDept.value, active: true });
        ctx.setStatus(`Добавлен: ${newName.value.trim()} → ${newDept.value}.`, 'ok');
        newName.value = '';
        await ctx.refresh();
    }));

    /* ----------------------------------------------------------- roster from a file */
    const rosterHost = h('div');
    const rosterFile = h('input', { type: 'file', accept: '.xlsx,.csv,.tsv,.txt' });
    const rosterPaste = h('textarea', { rows: 4, placeholder: 'Или вставьте текст: строка с названием подразделения (…_СР1_…), под ней ФИО, и так по каждому подразделению' });
    const rosterRead = h('button', { type: 'button', className: 'ghost' }, 'Прочитать');
    let parsedRoster: ParsedRoster | null = null;
    let deactivateMissing = false;
    rosterRead.addEventListener('click', () => void ctx.guard(rosterRead, async () => {
        const file = rosterFile.files?.[0];
        const rows = file ? await readTableFile(file) : parseTextTable(rosterPaste.value);
        const result = parseRoster(rows);
        if (result.entries.length === 0) throw new Error('В данных не нашлось сотрудников под заголовками подразделений (…_СР1_…).');
        parsedRoster = result;
        deactivateMissing = false;
        renderRosterPreview();
    }));

    function renderRosterPreview() {
        clear(rosterHost);
        if (!parsedRoster) return;
        const roster = parsedRoster;
        const index = new Map(ctx.state.team.map(m => [normName(m.name), m]));
        const inFile = new Set(roster.entries.map(e => normName(e.name)));
        const fresh = roster.entries.filter(e => !index.has(normName(e.name)));
        const moved = roster.entries.filter(e => index.has(normName(e.name)) && index.get(normName(e.name))!.dept !== e.dept);
        const same = roster.entries.length - fresh.length - moved.length;
        const absent = ctx.state.team.filter(m => m.active && !inFile.has(normName(m.name)));

        const perDept = DEPT_CODES.map(code => `${code}: ${roster.entries.filter(e => e.dept === code).length}`).join(' · ');
        const check = h('input', { type: 'checkbox', checked: deactivateMissing });
        check.addEventListener('change', () => { deactivateMissing = check.checked; renderRosterPreview(); });
        const apply = h('button', { type: 'button' }, 'Применить справочник');
        apply.addEventListener('click', () => void ctx.guard(apply, async () => {
            if (!confirm(`Применить справочник?\n\nНовых: ${fresh.length}\nПереведено в другое подразделение: ${moved.length}\nБез изменений: ${same}${deactivateMissing ? `\nСтанут неактивными: ${absent.length}` : ''}`)) return;
            const res = await ctx.call<{ added: number; moved: number; unchanged: number; deactivated: number }>('importRoster', {
                entries: roster.entries, deptTitles: roster.deptTitles, deactivateMissing,
            });
            parsedRoster = null;
            rosterFile.value = '';
            rosterPaste.value = '';
            ctx.setStatus(`Справочник: добавлено ${res.added}, переведено ${res.moved}, без изменений ${res.unchanged}${res.deactivated ? `, деактивировано ${res.deactivated}` : ''}.`, 'ok');
            await ctx.refresh();
        }));
        append(rosterHost, [
            h('div', { className: 'chips' }, chip('В файле', String(roster.entries.length)), chip('Новых', String(fresh.length)), chip('Переведены', String(moved.length)), chip('Без изменений', String(same)), chip('Нет в файле', String(absent.length))),
            h('p', { className: 'hint' }, `По подразделениям: ${perDept}`),
            roster.unassigned.length ? h('p', { className: 'error-note' }, `Без подразделения (стоят выше первого заголовка), не будут добавлены: ${roster.unassigned.join(', ')}`) : null,
            moved.length ? h('p', { className: 'hint' }, `Переводы: ${moved.slice(0, 8).map(e => `${e.name} → ${e.dept}`).join('; ')}${moved.length > 8 ? '…' : ''}`) : null,
            h('label', { className: 'check' }, check, ` Сделать неактивными тех, кого нет в файле (${absent.length})`),
            h('div', { className: 'btn-row' }, apply),
        ]);
    }

    const rosterPanel = h('details', { className: 'panel' },
        h('summary', {}, 'Импорт справочника из файла («кто в каком подразделении»)'),
        h('p', { className: 'hint' }, 'Нужен для первичного заполнения и для массовых перестановок. Названия подразделений берутся из заголовков. Сотрудники не удаляются; их счета не меняются.'),
        h('div', { className: 'stack' }, rosterFile, rosterPaste, h('div', { className: 'btn-row' }, rosterRead)),
        rosterHost,
    );

    /* ----------------------------------------------------------- the table */
    function save(manager: Manager, patch: Partial<Pick<Manager, 'name' | 'dept' | 'active'>>, okText: string, control?: HTMLElement) {
        void ctx.guard(control instanceof HTMLButtonElement ? control : null, async () => {
            try {
                await ctx.call('saveManager', { originalName: manager.name, name: patch.name ?? manager.name, dept: patch.dept ?? manager.dept, active: patch.active ?? manager.active });
                ctx.setStatus(okText, 'ok');
            } finally {
                await ctx.refresh(); // also puts a refused edit's control back to what the backend has
            }
        });
    }

    function renderList() {
        clear(listHost);
        const team = ctx.state.team;
        const rows = team
            .filter(m => (!deptFilter || m.dept === deptFilter) && (showInactive || m.active) && (!query || normName(m.name).includes(query)))
            .sort((a, b) => a.dept.localeCompare(b.dept) || a.name.localeCompare(b.name, 'ru'));

        listHost.append(table(
            [{ text: 'ФИО' }, { text: 'Подразделение' }, { text: 'Активен' }, { text: 'Сегодня', num: true }, { text: 'Неделя', num: true }, { text: '' }],
            rows.map(m => {
                // A row whose department is empty or misspelled (typed by hand in the sheet) is on no screen: show it, and make it easy to fix.
                const known = DEPT_CODES.includes(m.dept);
                const dept = select(known ? deptOptions(ctx) : [{ value: m.dept, label: `— не задано${m.dept ? ` («${m.dept}»)` : ''} —` }, ...deptOptions(ctx)], m.dept,
                    value => { if (value) save(m, { dept: value }, `${m.name}: теперь в ${value}.`); });
                const active = h('input', { type: 'checkbox', checked: m.active });
                active.addEventListener('change', () => save(m, { active: active.checked }, `${m.name}: ${active.checked ? 'снова в штате' : 'выведен из штата (неактивен)'}.`));
                const rename = h('button', { type: 'button', className: 'ghost small', title: 'Переименовать' }, 'Изменить');
                rename.addEventListener('click', () => {
                    const name = prompt('ФИО сотрудника', m.name);
                    if (name !== null && name.trim() && name.trim() !== m.name) save(m, { name }, `Переименован: ${name.trim()}.`, rename);
                });
                const remove = h('button', { type: 'button', className: 'ghost small danger-text', title: 'Удалить из справочника' }, 'Удалить');
                remove.addEventListener('click', () => void ctx.guard(remove, async () => {
                    if (!confirm(`Удалить «${m.name}» из справочника?\n\nЕго прошлые загрузки останутся в истории. Если человек просто в отпуске — лучше снять галочку «Активен».`)) return;
                    await ctx.call('deleteManager', { name: m.name });
                    ctx.setStatus(`Удалён: ${m.name}.`, 'ok');
                    await ctx.refresh();
                }));
                return [
                    h('span', {}, m.name, m.active ? '' : badge('неактивен', 'dim'), known ? '' : badge('нет подразделения', 'bad')),
                    dept, active, String(m.day), String(m.prior + m.day), h('div', { className: 'btn-row tight' }, rename, remove),
                ];
            }),
        ));
        listHost.append(h('p', { className: 'hint' }, `Показано ${rows.length} из ${team.length}. Смена подразделения, галочка «Активен» и переименование сохраняются сразу.`));
    }

    element.append(
        chipsHost,
        h('div', { className: 'toolbar' }, search, filter, h('label', { className: 'check' }, inactiveToggle, ' показывать неактивных')),
        listHost,
        section('Добавить сотрудника', h('div', { className: 'inline-field' }, newName, newDept, addButton)),
        rosterPanel,
    );

    function render() {
        const { team } = ctx.state;
        // department titles may have changed: refresh the labels of the two department pickers
        setOptions(filter, deptOptions(ctx, true));
        setOptions(newDept, deptOptions(ctx));
        clear(chipsHost);
        chipsHost.append(...DEPT_CODES.map(code => {
            const staff = team.filter(m => m.dept === code && m.active).length;
            return chip(deptLabel(code, ctx.state), `${staff} чел.`);
        }));
        renderList();
        renderRosterPreview();
    }

    return { id: 'team', title: 'Сотрудники', element, render };
}
