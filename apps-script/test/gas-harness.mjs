/**
 * Runs the real apps-script/Code.gs in Node against in-memory stand-ins for the Google services it
 * uses (SpreadsheetApp with real-looking tabs, PropertiesService, CacheService, LockService, Utilities,
 * ContentService), so the backend logic can be tested — and served locally (game/tools/mock-backend.mjs) —
 * without touching a real spreadsheet or deploying anything.
 *
 * Only what Code.gs needs is imitated. Time zone: the sheet is "Europe/Moscow" (UTC+3, no DST).
 */
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CODE_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'Code.gs');
const MOSCOW_OFFSET_MS = 3 * 3600 * 1000;

function pad(n, width = 2) {
    return String(n).padStart(width, '0');
}

/** Google's Utilities.formatDate for the few patterns Code.gs uses; always Moscow time. */
function formatDate(date, _tz, pattern) {
    const d = new Date(date.getTime() + MOSCOW_OFFSET_MS);
    return pattern.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|ss|u/g, (token, literal) => {
        if (literal !== undefined) return literal;
        switch (token) {
            case 'yyyy': return pad(d.getUTCFullYear(), 4);
            case 'MM': return pad(d.getUTCMonth() + 1);
            case 'dd': return pad(d.getUTCDate());
            case 'HH': return pad(d.getUTCHours());
            case 'mm': return pad(d.getUTCMinutes());
            case 'ss': return pad(d.getUTCSeconds());
            case 'u': return String(d.getUTCDay() === 0 ? 7 : d.getUTCDay());
            default: return token;
        }
    });
}

const isEmpty = (v) => v === '' || v === undefined || v === null;

class FakeSheet {
    constructor(name) {
        this.name = name;
        this.rows = [];
    }
    getName() { return this.name; }
    /** Like Sheets: the last row that holds anything (cleared cells do not count). */
    getLastRow() {
        for (let i = this.rows.length - 1; i >= 0; i--) if ((this.rows[i] || []).some(v => !isEmpty(v))) return i + 1;
        return 0;
    }
    getLastColumn() { return this.rows.reduce((max, r) => Math.max(max, (r || []).length), 0); }
    setFrozenRows() {}
    getDataRange() {
        const last = this.getLastRow();
        return { getValues: () => this.getRange(1, 1, Math.max(1, last), Math.max(1, this.getLastColumn())).getValues() };
    }
    getRange(row, col, numRows = 1, numCols = 1) {
        const sheet = this;
        const ensure = (r) => { while (sheet.rows.length < r) sheet.rows.push([]); };
        return {
            getValues: () => {
                const out = [];
                for (let r = 0; r < numRows; r++) {
                    const line = [];
                    for (let c = 0; c < numCols; c++) {
                        const v = (sheet.rows[row - 1 + r] || [])[col - 1 + c];
                        line.push(v === undefined || v === null ? '' : v);
                    }
                    out.push(line);
                }
                return out;
            },
            setValues: (values) => {
                if (values.length !== numRows || values.some(line => line.length !== numCols)) throw new Error(`setValues: ${values.length}x${values[0]?.length} does not fit ${numRows}x${numCols}`);
                ensure(row - 1 + numRows);
                values.forEach((line, r) => line.forEach((v, c) => { sheet.rows[row - 1 + r][col - 1 + c] = v; }));
            },
            setValue: (value) => {
                ensure(row);
                sheet.rows[row - 1][col - 1] = value;
            },
            clearContent: () => {
                for (let r = 0; r < numRows; r++) for (let c = 0; c < numCols; c++) {
                    if (sheet.rows[row - 1 + r]) sheet.rows[row - 1 + r][col - 1 + c] = '';
                }
            },
        };
    }
    /** Data rows below the header, trailing empty rows dropped — what a person sees in the tab. */
    table() {
        return this.rows.slice(1, this.getLastRow()).map(r => r.slice());
    }
}

/**
 * @param {object} [options]
 * @param {number} [options.startAt]  fake "now" (ms); defaults to a Wednesday in a fixed week
 * @param {boolean} [options.realClock]  follow the real clock instead (for the local mock server)
 * @param {string|null} [options.pin]  admin PIN to set up (null: none)
 * @param {string|null} [options.displayKey]  display key to set up (null: not set)
 */
export function loadBackend({ startAt = Date.parse('2026-09-30T10:00:00+03:00'), realClock = false, pin = '1234', displayKey = 'testkey-0123456789' } = {}) {
    const clock = { offset: 0, fixed: startAt };
    const now = () => (realClock ? Date.now() + clock.offset : clock.fixed + clock.offset);

    // Date that follows the fake clock.
    const RealDate = Date;
    class FakeDate extends RealDate {
        constructor(...args) {
            if (args.length === 0) super(now());
            else super(...args);
        }
        static now() { return now(); }
    }

    const sheets = new Map();
    const props = new Map();
    const cacheStore = new Map();
    const lockCalls = { count: 0, reads: 0 };

    const sandbox = {
        console,
        Date: FakeDate,
        JSON, Math, Number, String, Array, Object, isFinite, isNaN, parseInt, parseFloat, RegExp, Error, Boolean,
        Logger: { log() {} },
        SpreadsheetApp: {
            openById: () => ({
                getSheetByName: (name) => sheets.get(name) ?? null,
                insertSheet: (name) => {
                    if (sheets.has(name)) throw new Error(`A sheet with the name "${name}" already exists`);
                    const sheet = new FakeSheet(name);
                    sheets.set(name, sheet);
                    return sheet;
                },
                getSpreadsheetTimeZone: () => 'Europe/Moscow',
            }),
        },
        PropertiesService: {
            getScriptProperties: () => ({
                getProperty: (k) => (props.has(k) ? props.get(k) : null),
                setProperty: (k, v) => { props.set(k, String(v)); },
                deleteProperty: (k) => { props.delete(k); },
            }),
        },
        CacheService: {
            getScriptCache: () => ({
                get: (k) => {
                    const hit = cacheStore.get(k);
                    if (!hit || hit.expires <= now()) { cacheStore.delete(k); return null; }
                    return hit.value;
                },
                put: (k, v, ttlSec = 600) => { cacheStore.set(k, { value: String(v), expires: now() + ttlSec * 1000 }); },
                remove: (k) => { cacheStore.delete(k); },
            }),
        },
        LockService: { getScriptLock: () => ({ waitLock() { lockCalls.count++; }, tryLock() { lockCalls.reads++; return true; }, releaseLock() {} }) },
        ContentService: {
            MimeType: { JSON: 'application/json' },
            createTextOutput: (text) => ({ setMimeType() { return this; }, getContent: () => text }),
        },
        Utilities: {
            DigestAlgorithm: { SHA_256: 'SHA_256' },
            Charset: { UTF_8: 'UTF_8' },
            computeDigest: (_alg, input) => Array.from(crypto.createHash('sha256').update(String(input), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
            getUuid: () => crypto.randomUUID(),
            formatDate,
        },
    };

    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(CODE_PATH, 'utf8'), sandbox, { filename: 'Code.gs' });

    if (pin !== null) sandbox.storePin_(pin);
    if (displayKey !== null) props.set('DISPLAY_KEY', displayKey);

    const call = (fn) => JSON.parse(fn().getContent());
    return {
        /** Public GET (with the display key unless told otherwise). */
        get: (key = displayKey) => call(() => sandbox.doGet({ parameter: key === null ? {} : { key } })),
        /** Admin POST with a JSON body (like the admin page sends it as text/plain). The PIN is added unless the body has one. */
        post: (body) => call(() => sandbox.doPost({ postData: { contents: JSON.stringify({ pin, ...body }) } })),
        /** Raw POST body, for malformed-request tests. */
        postRaw: (contents) => call(() => sandbox.doPost({ postData: { contents } })),
        /** Call a top-level function of Code.gs (e.g. setup_). */
        run: (name, ...args) => sandbox[name](...args),
        /** Move the fake clock forward. */
        advance: (ms) => { clock.offset += ms; },
        now,
        props,
        cacheStore,
        lockCalls,
        /** Rows of a tab (below the header) as a person sees them. */
        table: (name) => sheets.get(name)?.table() ?? null,
        sheetNames: () => [...sheets.keys()],
        /** Delete a whole tab, like a person right-clicking it in the spreadsheet. */
        deleteSheet: (name) => sheets.delete(name),
        /** The raw sheet, to tamper with it like a human editing the spreadsheet. */
        sheet: (name) => sheets.get(name),
    };
}
