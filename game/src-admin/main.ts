import { BackendError, callBackend, type AdminState } from './api';
import { clear, h } from './dom';
import { animTab } from './tabs/anim';
import { historyTab } from './tabs/history';
import { importTab } from './tabs/import';
import { overviewTab } from './tabs/overview';
import { pairsTab } from './tabs/pairs';
import { settingsTab } from './tabs/settings';
import { teamTab } from './tabs/team';
import type { Ctx, Tab } from './tabs/types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const pinForm = $<HTMLFormElement>('pin-form');
const pinInput = $<HTMLInputElement>('pin');
const panel = $<HTMLDivElement>('panel');
const nav = $<HTMLElement>('tab-nav');
const content = $<HTMLDivElement>('tab-content');
const statusEl = $<HTMLParagraphElement>('status');

/** Kept in memory only for this page's lifetime — never stored, never in a URL. */
let pin = '';
let state: AdminState | null = null;
let tabs: Tab[] = [];
let activeTab = 'overview';

function setStatus(text: string, kind: 'ok' | 'error' | '' = '') {
    statusEl.textContent = text;
    statusEl.className = kind;
    if (kind === 'ok') statusEl.scrollIntoView({ block: 'nearest' });
}

function showLogin(message = '') {
    pin = '';
    state = null;
    pinInput.value = '';
    panel.hidden = true;
    pinForm.hidden = false;
    tabs = [];
    clear(nav);
    clear(content);
    setStatus(message, message ? 'error' : '');
}

const FIELD_NAMES: Record<string, string> = {
    name: 'ФИО', dept: 'подразделение', originalName: 'прежнее ФИО', rows: 'строки загрузки', entries: 'список сотрудников', addUnknown: 'новые сотрудники',
    pairs: 'пары', stars: 'звёзды', rop: 'подразделение', code: 'подразделение', title: 'название', leader: 'руководитель', daysPerPeriod: 'число дней',
    newPin: 'новый PIN', newPin_same: 'новый PIN совпадает со старым', key: 'ключ экрана', type: 'тип команды', args: 'параметры команды',
};

/** One place that turns a failed call into a message (and sends the user back to the PIN form when the PIN is the problem). */
function report(err: unknown) {
    if (!(err instanceof BackendError)) {
        console.error(err);
        setStatus(err instanceof Error && err.message ? err.message : 'Что-то пошло не так. Подробности в консоли браузера.', 'error');
        return;
    }
    const d = err.detail;
    switch (err.code) {
        case 'invalid_pin':
            showLogin('Неверный PIN. Введите его снова.');
            break;
        case 'locked': {
            const minutes = Math.max(1, Math.ceil((d?.retryAfterSec ?? 600) / 60));
            showLogin(`Слишком много неверных попыток. Подождите примерно ${minutes} мин.`);
            break;
        }
        case 'network':
            setStatus('Не удалось связаться с сервером. Проверьте соединение.', 'error');
            break;
        case 'demo':
            setStatus('Демо-режим (config.json: useMock=true): бэкенд не подключён. Укажите appsScriptUrl.', 'error');
            break;
        case 'bad_request': {
            const field = FIELD_NAMES[d?.field ?? ''] ?? d?.field ?? 'данные';
            setStatus(`Проверьте поле: ${field}${d?.row ? ` (строка ${d.row})` : ''}.`, 'error');
            break;
        }
        case 'unknown_managers':
            setStatus(`В загрузке есть сотрудники, которых нет в справочнике: ${(d?.names ?? []).slice(0, 5).join(', ')}${(d?.names?.length ?? 0) > 5 ? '…' : ''}.`, 'error');
            break;
        case 'count_decreased':
            setStatus(`Значения стали меньше прежних (${(d?.items ?? []).slice(0, 3).map(i => `${i.name}: ${i.from} → ${i.to}`).join('; ')}). Если это исправление — разрешите уменьшение.`, 'error');
            break;
        case 'period_finished':
            setStatus('Неделя завершена. Начните новую неделю на вкладке «День и неделя».', 'error');
            break;
        case 'no_pairs':
            setStatus('Не заданы пары — вкладка «Пары и отделы».', 'error');
            break;
        case 'duplicate_name':
            setStatus('Сотрудник с таким ФИО уже есть в справочнике.', 'error');
            break;
        case 'not_found':
            setStatus('Не найдено (возможно, запись уже изменили). Данные обновлены.', 'error');
            break;
        case 'server_error':
            setStatus(`Ошибка на стороне сервера${d?.detail ? `: ${d.detail}` : ''}.`, 'error');
            break;
        default:
            setStatus(`Ошибка: ${err.code}`, 'error');
    }
}

const ctx: Ctx = {
    get state() {
        if (!state) throw new Error('state is not loaded yet');
        return state;
    },
    call: (action, payload = {}) => callBackend(action, pin, payload),
    async refresh() {
        state = await callBackend<AdminState>('getAdminState', pin);
        tabs.forEach(tab => tab.render());
    },
    setStatus,
    report,
    async guard(button, fn) {
        if (button) button.disabled = true;
        try {
            await fn();
        } catch (err) {
            report(err);
        } finally {
            if (button) button.disabled = false;
        }
    },
};

function openTab(id: string) {
    activeTab = id;
    nav.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
    for (const tab of tabs) tab.element.hidden = tab.id !== id;
    setStatus('');
    tabs.find(tab => tab.id === id)?.render();
}

function buildTabs() {
    tabs = [
        overviewTab(ctx),
        importTab(ctx),
        teamTab(ctx),
        pairsTab(ctx),
        historyTab(ctx),
        animTab(ctx),
        settingsTab(ctx, newPin => { pin = newPin; }),
    ];
    clear(nav);
    clear(content);
    for (const tab of tabs) {
        const button = h('button', { type: 'button', className: 'tab-btn', role: 'tab', dataset: { tab: tab.id } }, tab.title);
        button.addEventListener('click', () => openTab(tab.id));
        nav.append(button);
        tab.element.hidden = true;
        tab.element.className = 'tab';
        content.append(tab.element);
    }
}

pinForm.addEventListener('submit', async e => {
    e.preventDefault();
    setStatus('Проверяю…');
    const typed = pinInput.value;
    try {
        await callBackend('login', typed);
        pin = typed;
        state = await callBackend<AdminState>('getAdminState', pin);
    } catch (err) {
        report(err);
        return;
    }
    pinInput.value = '';
    pinForm.hidden = true;
    panel.hidden = false;
    setStatus('');
    buildTabs();
    openTab(activeTab);
    tabs.forEach(tab => tab.render());
});

$('logout').addEventListener('click', () => showLogin());
