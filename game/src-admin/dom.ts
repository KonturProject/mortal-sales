import ropMapping from '../src/game/config/ropMapping.json';
import heroRoster from '../src/game/config/heroRoster.json';
import type { AdminState } from './api';

export type Child = Node | string | number | null | undefined | false;

/**
 * Tiny element builder: h('button', { className: 'ghost', onclick: fn }, 'Text'). Text is always set as a text node
 * (never innerHTML) — everything shown here may come from a spreadsheet.
 */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'dataset') Object.assign(el.dataset, value as Record<string, string>);
        else if (key === 'style') Object.assign(el.style, value as Record<string, string>);
        else if (key in el) (el as unknown as Record<string, unknown>)[key] = value;
        else el.setAttribute(key, String(value));
    }
    append(el, children);
    return el;
}

export function append(parent: Element, children: Child[]) {
    for (const child of children) {
        if (child === null || child === undefined || child === false) continue;
        parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
}

export function clear(el: Element) {
    el.replaceChildren();
}

/** "2,08" — average invoices per employee. */
export const fmtAvg = (n: number): string => n.toFixed(2).replace('.', ',');

/** Average per employee; a department with nobody counts as one person (never divides by zero) — same rule as the backend and the game. */
export const average = (sum: number, staff: number): number => sum / Math.max(1, staff);

export const stars = (n: number, max = 5): string => '★'.repeat(n) + '☆'.repeat(Math.max(0, max - n));

const HERO_NAMES: Record<string, string> = Object.fromEntries(heroRoster.heroes.map(hero => [hero.slug, hero.name]));
const MAPPING = ropMapping.mapping as Record<string, string>;

/** Department codes in the game's order. */
export const DEPT_CODES = Object.keys(MAPPING);

/** "СР1 · Лев" — the code and the mascot that stands for it on the screen, plus the sheet's own title when there is one. */
export function deptLabel(code: string, state?: AdminState | null): string {
    const mascot = HERO_NAMES[MAPPING[code]] ?? '';
    const title = state?.depts.find(d => d.code === code)?.title ?? '';
    const shortTitle = title.split('_').slice(-2).join('_'); // "КЦПК_НП_СР_Тверь_СР1_ГБ" -> "СР1_ГБ"
    return [code, mascot, shortTitle && shortTitle !== code ? `(${shortTitle})` : ''].filter(Boolean).join(' · ');
}

export function select(options: { value: string; label: string }[], value: string, onchange?: (value: string) => void): HTMLSelectElement {
    const el = h('select');
    for (const o of options) el.add(new Option(o.label, o.value, false, o.value === value));
    if (onchange) el.addEventListener('change', () => onchange(el.value));
    return el;
}

/** Refills a select in place (keeps the element, so focus and listeners survive a re-render). */
export function setOptions(el: HTMLSelectElement, options: { value: string; label: string }[], value = el.value) {
    el.replaceChildren(...options.map(o => new Option(o.label, o.value, false, o.value === value)));
}

export function badge(text: string, kind: 'ok' | 'warn' | 'bad' | 'dim' = 'dim'): HTMLSpanElement {
    return h('span', { className: `badge ${kind}` }, text);
}

/** Section with a heading, for the tabs. */
export function section(title: string, ...children: Child[]): HTMLElement {
    return h('section', { className: 'block' }, h('h2', {}, title), ...children);
}

export function chip(label: string, value: string): HTMLDivElement {
    return h('div', { className: 'chip' }, h('span', {}, label), h('strong', {}, value));
}

export function table(headers: { text: string; num?: boolean }[], rows: Child[][]): HTMLElement {
    const head = h('tr', {}, ...headers.map(c => h('th', { className: c.num ? 'num' : '' }, c.text)));
    const body = rows.map(cells => h('tr', {}, ...cells.map((cell, i) => h('td', { className: headers[i]?.num ? 'num' : '' }, cell))));
    return h('div', { className: 'table-wrap' }, h('table', {}, h('thead', {}, head), h('tbody', {}, ...body)));
}
