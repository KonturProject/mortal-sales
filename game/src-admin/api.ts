export interface RuntimeConfig {
    appsScriptUrl: string;
    useMock?: boolean;
}

/** Extra fields the backend attaches to a refusal (which row, which names, which counts went down...). */
export interface BackendErrorDetail {
    field?: string;
    retryAfterSec?: number;
    row?: number;
    names?: string[];
    items?: { name: string; from: number; to: number }[];
    detail?: string;
}

/** A failed backend call. `code` is the backend's error code, or 'network' / 'demo' for problems on this side. */
export class BackendError extends Error {
    constructor(
        public code: string,
        public detail?: BackendErrorDetail,
    ) {
        super(code);
    }
}

let configPromise: Promise<RuntimeConfig> | null = null;

export function loadConfig(): Promise<RuntimeConfig> {
    configPromise ??= (async () => {
        const res = await fetch('config.json', { cache: 'no-store' });
        if (!res.ok) throw new Error(`config.json fetch failed: ${res.status}`);
        const config: RuntimeConfig = await res.json();
        // Dev only: `?backend=http://127.0.0.1:8787/exec` talks to the local mock backend (game/tools/mock-backend.mjs).
        if (import.meta.env.DEV) {
            const backend = new URLSearchParams(location.search).get('backend');
            if (backend) return { appsScriptUrl: backend, useMock: false };
        }
        return config;
    })();
    return configPromise;
}

/** Fresh id per user action; the backend ignores a repeat of the same id (double click, retry). */
export function newRequestId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Calls an admin action. The PIN travels in the POST body (never in a URL). The body is sent as
 * text/plain on purpose: Apps Script Web Apps do not answer a CORS preflight, and application/json would trigger one.
 */
export async function callBackend<T extends object = Record<string, never>>(
    action: string,
    pin: string,
    payload: Record<string, unknown> = {},
): Promise<T> {
    const config = await loadConfig();
    if (config.useMock || !config.appsScriptUrl) throw new BackendError('demo');

    let data: { ok: boolean; error?: string } & BackendErrorDetail & T;
    try {
        const res = await fetch(config.appsScriptUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action, pin, ...payload }),
        });
        data = await res.json();
    } catch {
        throw new BackendError('network');
    }

    if (!data.ok) {
        const { field, retryAfterSec, row, names, items, detail } = data;
        throw new BackendError(data.error ?? 'unknown', { field, retryAfterSec, row, names, items, detail });
    }
    return data;
}

/* ------------------------------------------------------------------ what getAdminState returns */

export interface Manager {
    name: string;
    dept: string;
    active: boolean;
    /** Invoices today so far. */
    day: number;
    /** Invoices of the week before today. */
    prior: number;
}

export interface Dept {
    code: string;
    title: string;
    leader: string;
    stars: number;
    wins: number;
    losses: number;
    draws: number;
}

export interface Pair {
    id: number;
    left: string;
    right: string;
}

export interface Leader {
    rop: string;
    stars: number;
    staff: number;
    dayCount: number;
    periodCount: number;
    name?: string;
}

export interface AdminState {
    ok: true;
    status: {
        period: { id: number; dayIndex: number; daysTotal: number; state: 'active' | 'finished'; winners?: Record<string, string> };
        pairs: Pair[];
        leaders: Leader[];
        lastImport: { id: number; at: string; before: Record<string, number>; after: Record<string, number> } | null;
    };
    team: Manager[];
    depts: Dept[];
    pairs: Pair[];
    settings: { daysPerPeriod: number; targetAvg: number };
    displayKeySet: boolean;
}

export interface SnapshotRow {
    importId: number;
    time: string;
    dayId: number;
    name: string;
    dept: string;
    count: number;
    delta: number;
}

export interface DayRow {
    dayId: number;
    periodId: number;
    dayNo: number;
    time: string;
    dept: string;
    sum: number;
    staff: number;
    avg: number;
    pair: number | null;
    outcome: string;
    starsAfter: number;
}
