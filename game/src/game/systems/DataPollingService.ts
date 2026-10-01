import {
    EventBus, GameEvents, AdminCommandPayload, FightRoundPayload, FinalePayload,
} from '../core/EventBus';
import { GameState, StatusResponse } from '../core/GameState';
import { POLL } from '../core/Constants';
import { fightPairsFor, isUsableFinale, isUsableStatus } from './FightPairs';

interface RuntimeConfig {
    appsScriptUrl: string;
    useMock?: boolean;
}

const KEY_STORAGE = 'mortal_sales_display_key';

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let consecutiveFailures = 0;
/** A poll is still waiting for its answer — the next one must not start (two answers could arrive out of order). */
let pollInFlight = false;
let config: RuntimeConfig | null = null;
/** Highest admin command id this display has already seen; null until the first poll (the baseline). */
let lastCommandId: number | null = null;
/** Id of the newest import this display has already played; null until the first poll (the baseline). */
let lastImportId: number | null = null;

async function loadRuntimeConfig(): Promise<RuntimeConfig> {
    const res = await fetch('config.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`config.json fetch failed: ${res.status}`);
    const loaded: RuntimeConfig = await res.json();
    // Dev only: `?backend=http://localhost:8787/exec` points the game at the local mock backend (game/tools/mock-backend.mjs).
    if (import.meta.env.DEV) {
        const backend = new URLSearchParams(location.search).get('backend');
        if (backend) return { appsScriptUrl: backend, useMock: false };
    }
    return loaded;
}

/**
 * The display key keeps the (public) status URL from handing out employees' names to anyone who finds it.
 * The office screen is opened once as `…/index.html#key=SECRET`; the key is remembered in localStorage
 * and the fragment is wiped from the address bar. The backend refuses a GET without the right key.
 */
function displayKey(): string {
    try {
        const fromHash = new URLSearchParams(location.hash.replace(/^#/, '')).get('key');
        if (fromHash) {
            localStorage.setItem(KEY_STORAGE, fromHash);
            history.replaceState(null, '', location.pathname + location.search);
        }
        return localStorage.getItem(KEY_STORAGE) ?? '';
    } catch {
        return '';
    }
}

function withKey(url: string): string {
    const key = displayKey();
    return key ? `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}` : url;
}

async function fetchStatus(): Promise<StatusResponse> {
    if (!config) throw new Error('DataPollingService not started');

    if (config.useMock || !config.appsScriptUrl) {
        const res = await fetch('assets/mock/mock-status.json', { cache: 'no-store' });
        return res.json();
    }

    return fetchWithHedge(withKey(config.appsScriptUrl));
}

/**
 * GET the status with a safety net for Apps Script's slow tail: a second request joins in when the first is
 * slow (POLL.HEDGE_AFTER_MS) or fails, the first success wins and the other is abandoned. Rejects only when
 * every attempt (POLL.MAX_ATTEMPTS) has failed.
 */
function fetchWithHedge(url: string): Promise<StatusResponse> {
    return new Promise<StatusResponse>((resolve, reject) => {
        const controllers: AbortController[] = [];
        let pending = 0;
        let settled = false;
        let lastError: unknown = new Error('no attempt made');
        let hedgeTimer: ReturnType<typeof setTimeout> | null = null;

        const finish = () => {
            settled = true;
            if (hedgeTimer !== null) clearTimeout(hedgeTimer);
            controllers.forEach(c => c.abort()); // the loser (and the finished winner) — nothing left to wait for
        };

        const launch = () => {
            if (settled || controllers.length >= POLL.MAX_ATTEMPTS) return;
            const controller = new AbortController();
            controllers.push(controller);
            pending++;
            const timeout = setTimeout(() => controller.abort(), POLL.TIMEOUT_MS);

            fetch(url, { signal: controller.signal })
                .then(res => {
                    if (!res.ok) throw new Error(`status fetch failed: ${res.status}`);
                    return res.json() as Promise<StatusResponse>;
                })
                .then(status => {
                    if (!isUsableStatus(status)) throw new Error(`backend refused the status request: ${status?.error ?? 'unusable answer'}`);
                    if (settled) return;
                    finish();
                    resolve(status);
                })
                .catch(err => {
                    pending--;
                    if (settled) return;
                    lastError = err;
                    if (controllers.length < POLL.MAX_ATTEMPTS) launch(); // failed outright: retry now instead of waiting for the hedge timer
                    else if (pending === 0) {
                        finish();
                        reject(lastError);
                    }
                })
                .finally(() => clearTimeout(timeout));
        };

        hedgeTimer = setTimeout(launch, POLL.HEDGE_AFTER_MS);
        launch();
    });
}

/**
 * A new import since the last poll means the numbers just moved: every pair whose day totals grew trades
 * blows. Like everything else, the first poll after page load is only a baseline — whatever happened before
 * this tab opened is history and is shown as the resting state, not replayed.
 */
function detectFightRound(status: StatusResponse) {
    const imp = status.lastImport;
    if (lastImportId === null) {
        lastImportId = imp?.id ?? 0;
        return;
    }
    if (!imp) return;
    if (imp.id < lastImportId) { // the backend's counter was reset: start over from here, no fight
        lastImportId = imp.id;
        return;
    }
    if (imp.id === lastImportId) return;
    lastImportId = imp.id;

    const pairs = fightPairsFor(imp, status.pairs, status.leaders);
    if (pairs.length > 0) EventBus.emit(GameEvents.FIGHT_ROUND, { importId: imp.id, pairs } satisfies FightRoundPayload);
}

/**
 * `fight` and `finale` are commands with a meaning of their own: a demo fight for chosen counts, and the end of
 * the day with results the backend has already recorded. Everything else is a plain visual request for the scenes.
 */
function routeCommand(command: AdminCommandPayload) {
    const args = command.args;
    switch (command.type) {
        case 'fight': {
            // A demo round: averages per employee as the admin typed them; plenty of "evidence" unless it says otherwise.
            const pair = GameState.pairs.find(p => p.id === Number(args.pairId));
            const leftAvg = Number(args.leftAvg);
            const rightAvg = Number(args.rightAvg);
            if (!pair || !(leftAvg >= 0) || !(rightAvg >= 0)) return;
            const [leftStaff, rightStaff] = [GameState.leader(pair.left)?.staff ?? 1, GameState.leader(pair.right)?.staff ?? 1];
            if (leftAvg + rightAvg <= 0) return;
            EventBus.emit(GameEvents.FIGHT_ROUND, {
                importId: -1, demo: true,
                pairs: [{
                    pairId: pair.id, left: pair.left, right: pair.right, leftAvg, rightAvg, leftBeforeAvg: leftAvg, rightBeforeAvg: rightAvg,
                    leftSum: Math.round(leftAvg * leftStaff), rightSum: Math.round(rightAvg * rightStaff), leftStaff, rightStaff,
                    sample: Number.isFinite(Number(args.sample)) ? Number(args.sample) : 100,
                }],
            } satisfies FightRoundPayload);
            break;
        }
        case 'finale':
            // A malformed finale would throw inside every listener; a day's result is never worth a crashed scene.
            if (isUsableFinale(args)) EventBus.emit(GameEvents.FINALE, args as unknown as FinalePayload);
            else console.warn('[DataPollingService] unusable finale command ignored', args);
            break;
        default:
            EventBus.emit(GameEvents.ADMIN_COMMAND, command);
    }
}

/**
 * Plays the animations the admin page asked for. Like the import diff, the first poll only sets the
 * baseline: commands issued before this page opened are history, not something to replay on every reload.
 * The first command of a poll is emitted at once (not on the next tick): the finale must reach the HUD
 * before DATA_UPDATED does, or the HUD would show the day's result before the animation.
 */
function dispatchCommands(status: StatusResponse) {
    const commands = [...(status.commands ?? [])].sort((a, b) => a.id - b.id);
    const newest = commands.length > 0 ? commands[commands.length - 1].id : 0;

    if (lastCommandId === null) {
        lastCommandId = newest;
        return;
    }
    // The ids only ever grow. If the newest one is *lower* than what this display has seen, the backend's
    // counter was reset (its properties were cleared): start over from there, or every new command would be
    // ignored until the counter caught up again.
    if (commands.length > 0 && newest < lastCommandId) lastCommandId = newest - commands.length;

    let staggerIndex = 0;
    for (const command of commands) {
        if (command.id <= lastCommandId) continue;
        // Age by the backend's own clock, so a wrong clock on this computer cannot swallow (or replay) commands.
        const ageMs = status.serverNow !== undefined ? status.serverNow - command.issuedAt : 0;
        if (ageMs > POLL.COMMAND_MAX_AGE_MS) continue;
        const payload: AdminCommandPayload = { type: command.type, args: command.args ?? {} };
        if (staggerIndex === 0) routeCommand(payload);
        else setTimeout(() => routeCommand(payload), staggerIndex * POLL.COMMAND_STAGGER_MS);
        staggerIndex++;
    }
    lastCommandId = Math.max(lastCommandId, newest);
}

/** Everything one status answer sets in motion, in the order the scenes rely on: fights, then commands, then the numbers. */
function process(status: StatusResponse) {
    GameState.applyStatus(status);
    detectFightRound(status);
    dispatchCommands(status);
    EventBus.emit(GameEvents.DATA_UPDATED, status);
}

async function tick() {
    if (pollInFlight) return;
    pollInFlight = true;
    try {
        const status = await fetchStatus();
        consecutiveFailures = 0;
        process(status);
    } catch (err) {
        console.error('[DataPollingService] tick failed:', err);
        consecutiveFailures++;
        GameState.lastFetchOk = false;
        EventBus.emit(GameEvents.FETCH_ERROR, { consecutiveFailures, error: String(err) });
        // Keep polling regardless of failure count — a long-lived kiosk tab should
        // recover on its own once connectivity/the endpoint comes back.
    } finally {
        pollInFlight = false;
    }
}

/** Set while start() is running or has run, so that two scenes (or a hot reload) cannot start two polling loops. */
let started = false;

export const DataPollingService = {
    async start() {
        if (started) return;
        started = true;
        // config.json is the very first request of a kiosk that may boot before its network is up: keep trying
        // instead of leaving the screen on "loading" for good.
        while (!config) {
            try {
                config = await loadRuntimeConfig();
            } catch (err) {
                console.error('[DataPollingService] config.json not loaded, retrying:', err);
                consecutiveFailures++;
                EventBus.emit(GameEvents.FETCH_ERROR, { consecutiveFailures, error: String(err) });
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        await tick();
        // Dev builds only: `?pollms=2000` polls faster, for testing; a production build always uses POLL.INTERVAL_MS.
        const override = import.meta.env.DEV ? Number(new URLSearchParams(location.search).get('pollms')) : 0;
        intervalHandle = setInterval(tick, override >= 500 ? override : POLL.INTERVAL_MS);
    },

    /** Dev-only entry point: runs a synthetic status through exactly the same path as a real poll. */
    applyForDebug(status: StatusResponse) {
        process(status);
    },

    /** Dev-only: plays a command as if the backend had handed it out (`fight`, `finale`, or a visual one). */
    routeCommand,

    stop() {
        if (intervalHandle !== null) {
            clearInterval(intervalHandle);
            intervalHandle = null;
        }
        started = false;
    },
};
