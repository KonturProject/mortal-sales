import { BackendError } from '../api';
import { clear, h, section } from '../dom';
import type { Ctx, Tab } from './types';

/** The address of the game page that sits next to this admin page, with the display key in the fragment (never sent to any server). */
function screenUrl(key: string): string {
    const url = new URL('index.html', location.href);
    url.search = '';
    url.hash = `key=${key}`;
    return url.toString();
}

/** Access: the PIN of this page and the key the office screens use to read the data. */
export function settingsTab(ctx: Ctx, onPinChanged: (pin: string) => void): Tab {
    const element = h('div');
    const keyHost = h('div');

    /* ----------------------------------------------------------- display key */
    async function showKey(): Promise<string | null> {
        const res = await ctx.call<{ key: string | null }>('getDisplayKey');
        return res.key;
    }

    function renderKey(key: string | null) {
        clear(keyHost);
        const make = h('button', { type: 'button', className: key ? 'ghost' : '' }, key ? 'Создать новый ключ' : 'Создать ключ экрана');
        make.addEventListener('click', () => void ctx.guard(make, async () => {
            if (key && !confirm('Создать новый ключ?\n\nВсе экраны, открытые по старой ссылке, перестанут получать данные, пока на них не откроют новую.')) return;
            const res = await ctx.call<{ key: string }>('setDisplayKey', {});
            ctx.setStatus('Ключ экрана создан. Откройте на экранах ссылку ниже.', 'ok');
            renderKey(res.key);
            await ctx.refresh();
        }));
        keyHost.append(
            h('p', { className: 'hint' }, 'Данные на экран отдаются только по ключу: в них имена сотрудников и их результаты, а адрес бэкенда не секрет. Ссылку с ключом открывают на экране один раз — ключ запоминается в браузере.'),
            key
                ? h('div', { className: 'stack' },
                    h('label', {}, 'Ссылка для экрана'),
                    h('input', { type: 'text', readOnly: true, value: screenUrl(key), onfocus: (e: Event) => (e.target as HTMLInputElement).select() }),
                    h('p', { className: 'hint' }, 'Не публикуйте её: у кого есть ссылка, тот видит данные.'))
                : h('p', { className: 'error-note' }, 'Ключ ещё не создан — экраны не смогут получить данные.'),
            h('div', { className: 'btn-row' }, make),
        );
    }

    /* ----------------------------------------------------------- PIN */
    const pinOld = h('input', { type: 'password', inputMode: 'numeric', autocomplete: 'off', required: true });
    const pinNew = h('input', { type: 'password', inputMode: 'numeric', autocomplete: 'new-password', pattern: '[0-9]{4,12}', required: true });
    const pinNew2 = h('input', { type: 'password', inputMode: 'numeric', autocomplete: 'new-password', pattern: '[0-9]{4,12}', required: true });
    const pinButton = h('button', { type: 'submit' }, 'Сменить PIN');
    const pinForm = h('form', {},
        h('label', {}, 'Текущий PIN-код'), pinOld,
        h('label', {}, 'Новый PIN-код (4–12 цифр)'), pinNew,
        h('label', {}, 'Новый PIN-код ещё раз'), pinNew2,
        pinButton,
    );
    pinForm.addEventListener('submit', event => {
        event.preventDefault();
        void ctx.guard(pinButton, async () => {
            if (!/^[0-9]{4,12}$/.test(pinNew.value)) throw new Error('Новый PIN — от 4 до 12 цифр.');
            if (pinNew.value !== pinNew2.value) throw new Error('Новый PIN и повтор не совпадают.');
            try {
                // The current PIN typed here is checked by the backend itself, as the PIN of this very call.
                await ctx.call('changePin', { pin: pinOld.value, newPin: pinNew.value });
            } catch (err) {
                // A mistyped *current* PIN is a typo in this form, not a reason to throw the user back to the login screen.
                if (err instanceof BackendError && err.code === 'invalid_pin') throw new Error('Текущий PIN указан неверно.');
                throw err;
            }
            onPinChanged(pinNew.value);
            [pinOld, pinNew, pinNew2].forEach(input => { input.value = ''; });
            ctx.setStatus('PIN изменён. Прежний больше не действует.', 'ok');
        });
    });

    element.append(
        section('Ключ экрана', keyHost),
        section('PIN-код админки', pinForm, h('p', { className: 'hint' }, 'После нескольких неверных вводов подряд вход блокируется на 10 минут.')),
    );

    return {
        id: 'settings',
        title: 'Доступ',
        element,
        render() {
            if (!ctx.state.displayKeySet) renderKey(null);
            else if (!keyHost.hasChildNodes()) void ctx.guard(null, async () => renderKey(await showKey()));
        },
    };
}
