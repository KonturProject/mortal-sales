import { clear, DEPT_CODES, deptLabel, h, section, setOptions, table } from '../dom';
import type { Ctx, Tab } from './types';

const MAX_PAIRS = 3;
const NONE = '';

/**
 * Who fights whom (up to three pairs; every department at most once; the first of a pair stands on the left of the
 * screen), plus the departments' own names and leaders — the leader's name is what the lifebar shows.
 */
export function pairsTab(ctx: Ctx): Tab {
    const element = h('div');
    const pairHost = h('div');
    const deptHost = h('div');
    const lefts: HTMLSelectElement[] = [];
    const rights: HTMLSelectElement[] = [];

    const options = (withNone: boolean) => [
        ...(withNone ? [{ value: NONE, label: '— нет —' }] : []),
        ...DEPT_CODES.map(code => ({ value: code, label: deptLabel(code, ctx.state) })),
    ];

    for (let i = 0; i < MAX_PAIRS; i++) {
        lefts.push(h('select'));
        rights.push(h('select'));
    }

    const save = h('button', { type: 'button' }, 'Сохранить пары');
    save.addEventListener('click', () => void ctx.guard(save, async () => {
        const pairs: { left: string; right: string }[] = [];
        for (let i = 0; i < MAX_PAIRS; i++) {
            const [left, right] = [lefts[i].value, rights[i].value];
            if (!left && !right) continue;
            if (!left || !right) throw new Error(`Пара ${i + 1}: выберите обоих участников или оставьте пару пустой.`);
            if (left === right) throw new Error(`Пара ${i + 1}: подразделение не может драться само с собой.`);
            pairs.push({ left, right });
        }
        const used = pairs.flatMap(p => [p.left, p.right]);
        const twice = used.find((code, i) => used.indexOf(code) !== i);
        if (twice) throw new Error(`${twice} стоит в нескольких парах: каждое подразделение — не больше чем в одной.`);
        if (pairs.length === 0) throw new Error('Нужна хотя бы одна пара.');
        if (!confirm(`Сохранить пары?\n\n${pairs.map((p, i) => `${i + 1}. ${p.left} — ${p.right}`).join('\n')}\n\nНа экранах бойцы переставятся при ближайшем опросе. Звёзды остаются у подразделений.`)) return;
        await ctx.call('setPairs', { pairs });
        ctx.setStatus('Пары сохранены.', 'ok');
        await ctx.refresh();
    }));

    pairHost.append(table(
        [{ text: '№' }, { text: 'Слева на экране' }, { text: 'Справа на экране' }],
        lefts.map((left, i) => [String(i + 1), left, rights[i]]),
    ), h('div', { className: 'btn-row' }, save));

    element.append(
        section('Пары',
            h('p', { className: 'hint' }, 'Пара № 1 дерётся на задней линии арены, № 3 — на передней. Подразделения без пары на экране не показываются, но их показатели продолжают считаться.'),
            pairHost,
        ),
        section('Подразделения и руководители', deptHost),
    );

    function renderDepts() {
        clear(deptHost);
        const rows = ctx.state.depts.map(d => {
            const title = h('input', { type: 'text', value: d.title, maxLength: 120, placeholder: 'КЦПК_НП_СР_Тверь_СР1_ГБ' });
            const leader = h('input', { type: 'text', value: d.leader, maxLength: 80, placeholder: 'ФИО руководителя группы' });
            const button = h('button', { type: 'button', className: 'ghost' }, 'Сохранить');
            button.addEventListener('click', () => void ctx.guard(button, async () => {
                await ctx.call('saveDepartment', { code: d.code, title: title.value, leader: leader.value });
                ctx.setStatus(`${d.code}: сохранено.`, 'ok');
                await ctx.refresh();
            }));
            return [deptLabel(d.code), title, leader, button];
        });
        deptHost.append(
            table([{ text: 'Подразделение (герой)' }, { text: 'Название' }, { text: 'РГ (руководитель)' }, { text: '' }], rows),
            h('p', { className: 'hint' }, 'Название — для вас (подставляется из файла справочника). Имя руководителя показывается на лайфбаре как «Фамилия И.О.»; если не задано — имя героя.'),
        );
    }

    function render() {
        const { pairs } = ctx.state;
        for (let i = 0; i < MAX_PAIRS; i++) {
            const pair = pairs.find(p => p.id === i + 1) ?? pairs[i];
            setOptions(lefts[i], options(true), pair?.left ?? NONE);
            setOptions(rights[i], options(true), pair?.right ?? NONE);
        }
        renderDepts();
    }

    return { id: 'pairs', title: 'Пары и отделы', element, render };
}
