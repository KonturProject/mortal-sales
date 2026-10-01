import type { DayRow, SnapshotRow } from '../api';
import { badge, chip, clear, deptLabel, fmtAvg, h, section, table } from '../dom';
import type { Ctx, Tab } from './types';

const OUTCOME_KIND: Record<string, 'ok' | 'bad' | 'dim'> = { 'победа': 'ok', 'поражение': 'bad', 'ничья': 'dim' };

/** Read-only: every import (who had how many, and by how much it changed) and every finished day. Loaded when the tab is opened. */
export function historyTab(ctx: Ctx): Tab {
    const element = h('div');
    const importsHost = h('div');
    const daysHost = h('div');
    const refreshButton = h('button', { type: 'button', className: 'ghost' }, 'Обновить');
    let loaded = false;

    async function load() {
        const [imports, days] = await Promise.all([
            ctx.call<{ total: number; rows: SnapshotRow[] }>('listSnapshots', { limit: 200 }),
            ctx.call<{ total: number; rows: DayRow[] }>('listDays', { limit: 120 }),
        ]);
        loaded = true;

        clear(importsHost);
        importsHost.append(
            h('div', { className: 'chips' }, chip('Всего строк истории', String(imports.total)), chip('Показано (новые сверху)', String(imports.rows.length))),
            table(
                [{ text: 'Загрузка' }, { text: 'Время' }, { text: 'ФИО' }, { text: 'Подразделение' }, { text: 'Счетов', num: true }, { text: 'Δ', num: true }],
                imports.rows.map(r => [`№ ${r.importId}`, r.time, r.name, r.dept, String(r.count), r.delta === 0 ? '' : `${r.delta > 0 ? '+' : ''}${r.delta}`]),
            ),
        );

        clear(daysHost);
        daysHost.append(table(
            [{ text: 'Неделя' }, { text: 'День' }, { text: 'Время' }, { text: 'Подразделение' }, { text: 'Счетов', num: true }, { text: 'Людей', num: true }, { text: 'Среднее', num: true }, { text: 'Пара', num: true }, { text: 'Итог' }, { text: 'Звёзд', num: true }],
            days.rows.map(r => [String(r.periodId), String(r.dayNo), r.time, deptLabel(r.dept, ctx.state), String(r.sum), String(r.staff), fmtAvg(r.avg),
                r.pair === null ? '' : String(r.pair), r.outcome === '—' ? '' : badge(r.outcome, OUTCOME_KIND[r.outcome] ?? 'dim'), String(r.starsAfter)]),
        ));
    }

    refreshButton.addEventListener('click', () => void ctx.guard(refreshButton, load));

    element.append(
        h('div', { className: 'toolbar' }, refreshButton),
        section('Завершённые дни', daysHost),
        section('Загрузки (последние 200 строк)', importsHost),
    );

    return {
        id: 'history',
        title: 'История',
        element,
        render() {
            // History is only fetched once the tab is first opened (and by "Обновить"): it is the heaviest call.
            if (!loaded && !element.hidden) void ctx.guard(null, load);
        },
    };
}
