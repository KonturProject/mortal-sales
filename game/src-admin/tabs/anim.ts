import { newRequestId } from '../api';
import { deptLabel, h, section, setOptions } from '../dom';
import type { Ctx, Tab } from './types';

/**
 * Animations on the screens, shown on request. Purely visual: no numbers, stars or sheet cells change.
 * A demo fight takes the averages per employee typed here (so the four degrees of a fight can be shown at any time).
 */
export function animTab(ctx: Ctx): Tab {
    const element = h('div');
    const pairPick = h('select');
    const leftAvg = h('input', { type: 'number', min: '0', step: '0.05', value: '2.5' });
    const rightAvg = h('input', { type: 'number', min: '0', step: '0.05', value: '0.4' });
    const preview = h('p', { className: 'hint' });

    const send = async (button: HTMLButtonElement, type: string, args: Record<string, unknown> = {}, text = 'Отправлено.') => {
        await ctx.guard(button, async () => {
            await ctx.call('command', { type, args, requestId: newRequestId() });
            ctx.setStatus(`${text} Экраны покажут это в течение ~15 секунд.`, 'ok');
            // A short pause stops an accidental double click from queueing the animation twice.
            await new Promise(resolve => setTimeout(resolve, 1200));
        });
    };

    /** Same measure as the game's FightPlanner: the gap between the averages in shares of the target. */
    function describe() {
        const [l, r] = [Number(leftAvg.value), Number(rightAvg.value)];
        const target = ctx.state.settings.targetAvg;
        const dominance = Math.min(1, Math.abs(l - r) / target);
        const tier = dominance >= 0.7 ? 'разгром: эпичный отлёт' : dominance >= 0.35 ? 'доминирование: нокдаун' : dominance >= 0.15 ? 'перевес: оглушение' : 'равный бой';
        preview.textContent = l + r > 0
            ? `Разрыв ${Math.abs(l - r).toFixed(2).replace('.', ',')} = ${(dominance * 100).toFixed(0)} % цели (${String(target).replace('.', ',')}) — ${tier}.`
            : 'Введите средние значения.';
    }
    leftAvg.addEventListener('input', describe);
    rightAvg.addEventListener('input', describe);

    const fight = h('button', { type: 'button', className: 'anim-btn' }, 'Показать бой этой пары');
    fight.addEventListener('click', () => void send(fight, 'fight', { pairId: Number(pairPick.value), leftAvg: Number(leftAvg.value), rightAvg: Number(rightAvg.value) }, 'Бой отправлен.'));

    const finale = h('button', { type: 'button', className: 'anim-btn' }, 'Финал дня (демо, по сегодняшним цифрам)');
    finale.addEventListener('click', () => void send(finale, 'finale', {}, 'Демо-финал отправлен (звёзды не меняются).'));

    const confetti = h('button', { type: 'button', className: 'anim-btn' }, 'Конфетти');
    confetti.addEventListener('click', () => void send(confetti, 'confetti'));
    const celebrate = h('button', { type: 'button', className: 'anim-btn' }, 'Все празднуют');
    celebrate.addEventListener('click', () => void send(celebrate, 'celebrate'));

    element.append(
        h('p', { className: 'hint' }, 'Анимации только показываются на экранах — данные, звёзды и таблицу они не меняют. Экраны подхватывают команду при очередном опросе, обычно в течение 15 секунд.'),
        section('Демонстрационный бой',
            h('div', { className: 'inline-field' }, h('label', {}, 'Пара'), pairPick),
            h('div', { className: 'inline-field' }, h('label', {}, 'Среднее слева'), leftAvg, h('label', {}, 'Среднее справа'), rightAvg),
            preview,
            h('div', { className: 'btn-grid' }, fight),
        ),
        section('Финал и праздник', h('div', { className: 'btn-grid' }, finale, confetti, celebrate)),
    );
    return {
        id: 'anim',
        title: 'Анимации',
        element,
        render() {
            describe();
            const pairs = ctx.state.pairs;
            setOptions(pairPick, pairs.map(p => ({ value: String(p.id), label: `Пара ${p.id}: ${deptLabel(p.left, ctx.state)} — ${deptLabel(p.right, ctx.state)}` })), pairPick.value);
        },
    };
}
