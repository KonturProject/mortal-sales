import { MATCH } from './Constants';
import { average, DEFAULT_TARGET_AVG } from './Average';
export { average };

/** Backend view of one leader (РГ). `stars` are the days won in the current match (0..5). */
export interface LeaderStatus {
    rop: string;
    stars: number;
    /** Invoices of the whole group since the day began (cumulative). */
    dayCount: number;
    /** Invoices of the whole group over the match so far, today included. */
    periodCount: number;
    /** Active employees of the group — what the day's total is divided by. */
    staff: number;
    /** The leader's own name, if the sheet has one; otherwise the mascot's name is shown. */
    name?: string;
}

export interface ManagerStatus {
    name: string;
    rop: string;
    day: number;
    period: number;
}

export interface PairStatus {
    id: number;
    left: string;
    right: string;
}

/** The latest import: day totals per leader just before it and just after it. */
export interface ImportStatus {
    id: number;
    at: string;
    before: Record<string, number>;
    after: Record<string, number>;
}

export interface PeriodStatus {
    id: number;
    /** Days already finished (0..daysTotal). */
    dayIndex: number;
    daysTotal: number;
    state: 'active' | 'finished';
    /** pairId -> winner code of the match, 'draw' when level; only when `state` is 'finished'. */
    winners?: Record<string, string>;
}

/** An admin "play this animation" request as the backend hands it to the displays. */
export interface BackendCommand {
    /** Rising counter — each display plays every id once. */
    id: number;
    type: string;
    args: Record<string, unknown>;
    /** Backend clock, ms. */
    issuedAt: number;
}

export interface StatusResponse {
    ok: boolean;
    period: PeriodStatus;
    pairs: PairStatus[];
    leaders: LeaderStatus[];
    managers: ManagerStatus[];
    lastImport: ImportStatus | null;
    /** Average invoices per employee that counts as a good result (admin setting); a lead is measured against it. */
    targetAvg?: number;
    lastUpdated: string;
    /** Recent admin animation requests (absent on an older backend). */
    commands?: BackendCommand[];
    /** Backend clock, ms — compared with `issuedAt` so a display's own clock does not matter. */
    serverNow?: number;
    error?: string;
}

/**
 * Centralized mutable state, shared between the polling system and every scene.
 * Not a Phaser object — plain singleton, following the game-creator EventBus/GameState pattern.
 */
class GameStateStore {
    period: PeriodStatus = { id: 0, dayIndex: 0, daysTotal: MATCH.DAYS, state: 'active' };
    pairs: PairStatus[] = [];
    leaders: LeaderStatus[] = [];
    managers: ManagerStatus[] = [];
    lastImport: ImportStatus | null = null;
    targetAvg: number = DEFAULT_TARGET_AVG;
    /** true once at least one poll has landed — the first poll is a baseline, never played as a fight */
    hasBaseline = false;
    lastFetchOk = false;
    lastUpdated: string | null = null;

    applyStatus(status: StatusResponse) {
        this.period = status.period;
        this.pairs = [...status.pairs].sort((a, b) => a.id - b.id);
        this.leaders = status.leaders;
        this.managers = status.managers;
        this.lastImport = status.lastImport;
        this.targetAvg = status.targetAvg !== undefined && status.targetAvg > 0 ? status.targetAvg : DEFAULT_TARGET_AVG;
        this.lastUpdated = status.lastUpdated;
        this.lastFetchOk = true;
        this.hasBaseline = true;
    }

    leader(rop: string): LeaderStatus | undefined {
        return this.leaders.find(l => l.rop === rop);
    }

    /** Day invoices of a group (0 when unknown). */
    dayCount(rop: string): number {
        return this.leader(rop)?.dayCount ?? 0;
    }

    /** Day average per employee of a group — the number fights are decided by. */
    dayAvg(rop: string): number {
        const leader = this.leader(rop);
        return leader ? average(leader.dayCount, leader.staff) : 0;
    }

    reset() {
        this.period = { id: 0, dayIndex: 0, daysTotal: MATCH.DAYS, state: 'active' };
        this.pairs = [];
        this.leaders = [];
        this.managers = [];
        this.lastImport = null;
        this.hasBaseline = false;
        this.lastFetchOk = false;
        this.lastUpdated = null;
    }
}

export const GameState = new GameStateStore();
