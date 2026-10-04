import { newRequestId } from '../api';
import { average, badge, chip, clear, deptLabel, fmtAvg, h, section, select, stars, table } from '../dom';
import type { Ctx, Tab } from './types';

/** Who leads a pair right now, by the average per employee — the same rule the backend uses to end the day. */
function verdict(ctx: Ctx, left: string, right: string): { winner: string; la: number; ra: number } {
    const leaders = ctx.state.status.leaders;
    const l = leaders.find(x => x.rop === left);
    const r = leaders.find(x => x.rop === right);
    const la = average(l?.dayCount ?? 0, l?.staff ?? 0);
    const ra = average(r?.dayCount ?? 0, r?.staff ?? 0);
    return { winner: Math.abs(la - ra) < 1e-9 ? 'draw' : la > ra ? left : right, la, ra };
}

export function overviewTab(ctx: Ctx): Tab {
    const element = h('div');

    function render() {
        clear(element);
        const { status, team, depts, settings } = ctx.state;
        const finished = status.period.state === 'finished';
        const active = team.filter(m => m.active).length;

        element.append(
            h('div', { className: 'chips' },
                chip('Неделя №', String(status.period.id)),
                chip('День', finished ? 'неделя завершена' : `${Math.min(status.period.dayIndex + 1, status.period.daysTotal)} из ${status.period.daysTotal}`),
                chip('Последняя загрузка', status.lastImport ? new Date(status.lastImport.at).toLocaleString('ru-RU') : 'ещё не было'),
                chip('Сотрудников', `${active} активных из ${team.length}`),
                chip('Цель на сотрудника', fmtAvg(settings.targetAvg)),
            ),
        );

        // --- today's standings, pair by pair
        const rows = status.pairs.map(pair => {
            const l = status.leaders.find(x => x.rop === pair.left);
            const r = status.leaders.find(x => x.rop === pair.right);
            const v = verdict(ctx, pair.left, pair.right);
            const side = (rop: string, lead: typeof l, avg: number) => [
                h('span', {}, deptLabel(rop, ctx.state)),
                `${lead?.dayCount ?? 0} сч. / ${lead?.staff ?? 0} чел.`,
                h('strong', {}, fmtAvg(avg)),
                v.winner === rop ? badge('впереди', 'ok') : v.winner === 'draw' ? badge('поровну', 'dim') : '',
                stars(lead?.stars ?? 0),
            ];
            return [String(pair.id), ...side(pair.left, l, v.la), ...side(pair.right, r, v.ra)];
        });
        element.append(section('Сегодня по парам (среднее счетов на сотрудника)',
            status.pairs.length === 0 ? h('p', { className: 'hint' }, 'Пары не заданы — вкладка «Пары и отделы».') : table(
                [{ text: '№' }, { text: 'Слева' }, { text: 'Всего', num: true }, { text: 'Среднее', num: true }, { text: '' }, { text: 'Звёзды' },
                    { text: 'Справа' }, { text: 'Всего', num: true }, { text: 'Среднее', num: true }, { text: '' }, { text: 'Звёзды' }],
                rows,
            ),
            h('p', { className: 'hint' }, 'Исход пары и бой на экране определяет среднее число счетов на одного активного сотрудника, а не общая сумма: большой отдел не получает преимущества.'),
        ));

        // --- end of day / new week
        const finishButton = h('button', { type: 'button', className: 'danger', disabled: finished || status.pairs.length === 0 }, 'Завершить день');
        finishButton.addEventListener('click', () => void ctx.guard(finishButton, async () => {
            // The day cannot be un-finished: judge by the numbers as they are *now* (another admin may have imported since this tab was drawn).
            await ctx.refresh();
            const status = ctx.state.status;
            if (status.period.state === 'finished') throw new Error('Неделя уже завершена — день завершать нельзя.');
            const lines = status.pairs.map(pair => {
                const v = verdict(ctx, pair.left, pair.right);
                if (v.winner === 'draw') return `${pair.left} ${fmtAvg(v.la)} = ${fmtAvg(v.ra)} ${pair.right} — ничья, звёзды не меняются`;
                return `${pair.left} ${fmtAvg(v.la)} : ${fmtAvg(v.ra)} ${pair.right} — побеждает ${v.winner} и получает звезду`;
            });
            const last = status.period.dayIndex + 1 >= status.period.daysTotal;
            if (!confirm(`Завершить день ${status.period.dayIndex + 1}?\n\n${lines.join('\n')}\n\n${last ? 'Это последний день недели: будет решён матч каждой пары.\n\n' : ''}Счётчики дня обнулятся, на экранах начнётся финал. Отменить нельзя (звёзды можно поправить вручную ниже).`)) return;
            ctx.setStatus('Завершаю день…');
            const res = await ctx.call<{ dayNo: number; periodFinished: boolean }>('finishDay', { requestId: newRequestId() });
            ctx.setStatus(res.periodFinished ? `День ${res.dayNo} завершён. Неделя закончена — на экранах решается матч.` : `День ${res.dayNo} завершён. Финал на экранах начнётся в течение ~15 секунд.`, 'ok');
            await ctx.refresh();
        }));

        const newWeekButton = h('button', { type: 'button', className: 'ghost' }, 'Начать новую неделю');
        newWeekButton.addEventListener('click', () => void ctx.guard(newWeekButton, async () => {
            if (!confirm('Начать новую неделю?\n\nЗвёзды у всех обнулятся, счётчики недели и дня тоже, матч начнётся заново.')) return;
            const res = await ctx.call<{ periodId: number }>('newPeriod', { requestId: newRequestId() });
            ctx.setStatus(`Началась неделя № ${res.periodId}.`, 'ok');
            await ctx.refresh();
        }));

        element.append(section('День и неделя',
            h('div', { className: 'btn-row' }, finishButton, newWeekButton),
            h('p', { className: 'hint' }, finished
                ? 'Неделя завершена: победители пар показаны на экране. Загрузка данных закрыта до начала новой недели.'
                : 'Кнопка завершает игровой день: в каждой паре побеждает тот, у кого выше среднее на сотрудника, и получает звезду. Ничья звёзд не меняет.'),
        ));

        // --- manual stars
        const starsRows = depts.map(d => {
            const pick = select([0, 1, 2, 3, 4, 5].map(n => ({ value: String(n), label: `${n} ${stars(n)}` })), String(d.stars));
            const save = h('button', { type: 'button', className: 'ghost' }, 'Сохранить');
            save.addEventListener('click', () => void ctx.guard(save, async () => {
                await ctx.call('setStars', { rop: d.code, stars: Number(pick.value) });
                ctx.setStatus(`${d.code}: звёзд — ${pick.value}.`, 'ok');
                await ctx.refresh();
            }));
            return [deptLabel(d.code, ctx.state), pick, `${d.wins} / ${d.draws} / ${d.losses}`, save];
        });
        element.append(section('Звёзды: ручная поправка',
            table([{ text: 'Подразделение' }, { text: 'Звёзды' }, { text: 'Побед / ничьих / поражений за неделю' }, { text: '' }], starsRows),
            h('p', { className: 'hint' }, 'Звезда — выигранный день недели. Для ошибочного «Завершить день» или дня, который решили не засчитывать. На экране изменение появится при ближайшем опросе, без анимации.'),
        ));

        // --- settings: days per week, target average
        const days = h('input', { type: 'number', min: '1', max: '5', step: '1', value: String(settings.daysPerPeriod) });
        const target = h('input', { type: 'number', min: '0.05', max: '50', step: '0.05', value: String(settings.targetAvg) });
        const saveSettings = h('button', { type: 'button', className: 'ghost' }, 'Сохранить');
        saveSettings.addEventListener('click', () => void ctx.guard(saveSettings, async () => {
            await ctx.call('setSettings', { daysPerPeriod: Number(days.value), targetAvg: Number(target.value) });
            ctx.setStatus(`Сохранено: дней в неделе ${days.value}, цель ${fmtAvg(Number(target.value))} на сотрудника.`, 'ok');
            await ctx.refresh();
        }));
        element.append(section('Настройки',
            h('div', { className: 'inline-field' }, h('label', {}, 'Дней до решающего матча (1–5)'), days),
            h('div', { className: 'inline-field' }, h('label', {}, 'Цель: среднее счетов на сотрудника'), target, saveSettings),
            h('p', { className: 'hint' }, 'Цель — результат, который считается хорошим (сейчас 1,20). От неё зависит сила боя на экране: разрыв между подразделениями измеряется в долях цели. '
                + 'Например, при цели 1,20 разрыв 1,92 против 2,42 (0,50) — это 42 % цели, и бой заканчивается нокдауном. Исход дня («кто выиграл») от цели не зависит.'),
        ));
    }

    return { id: 'overview', title: 'День и неделя', element, render };
}
