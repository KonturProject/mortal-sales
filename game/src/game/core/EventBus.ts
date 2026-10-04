import { Events } from 'phaser';

/**
 * One pair that fights after an import. A fight is decided by the groups' AVERAGE invoices per employee (day total
 * / active staff), so a big group has no head start; the sums and staff sizes ride along for the HUD captions.
 */
export interface FightPairPayload {
    pairId: number;
    left: string;
    right: string;
    leftAvg: number;
    rightAvg: number;
    /** The averages just before this import — where the lifebars start. */
    leftBeforeAvg: number;
    rightBeforeAvg: number;
    leftSum: number;
    rightSum: number;
    leftStaff: number;
    rightStaff: number;
    /** Raw invoices of both groups together (how much evidence the averages rest on). */
    sample: number;
}

/** An import landed (or the admin asked for a demo fight): these pairs trade blows now. */
export interface FightRoundPayload {
    importId: number;
    /** Round of the game day (the import's number that day): announced as "РАУНД N" before the "FIGHT!". None for a demo. */
    round?: number;
    pairs: FightPairPayload[];
    /** Shown on request from the admin page — visual only, no bar / number changes. */
    demo?: boolean;
}

/** One blow landed in a pair's round: `index` of `total` (0-based), so the HUD can drain the trailing bar step by step. */
export interface BlowPayload {
    pairId: number;
    index: number;
    total: number;
}

/** How one pair's day ended, as the backend recorded it when the admin pressed "finish the day". */
export interface FinaleResult {
    pairId: number;
    left: string;
    right: string;
    /** Department code of the winner of the day (the higher average per employee), or 'draw'. */
    winner: string;
    leftAvg: number;
    rightAvg: number;
    leftSum: number;
    rightSum: number;
    leftStaff: number;
    rightStaff: number;
    starsBefore: Record<string, number>;
    starsAfter: Record<string, number>;
}

export interface FinalePayload {
    /** 1-based number of the day that just ended. */
    dayNo: number;
    results: FinaleResult[];
    /** The fifth day was the last one: the week's match is decided. */
    periodFinished: boolean;
    /** pairId -> winner code of the match ('draw' if level), only when `periodFinished`. */
    matchWinners?: Record<string, string>;
    demo?: boolean;
}

/**
 * An animation the admin page asked the displays to play (see apps-script/Code.gs, action 'command').
 * Purely visual — handlers must not touch GameState. `fight` and `finale` are turned into FIGHT_ROUND /
 * FINALE by DataPollingService.routeCommand; the rest reach the scenes as they are.
 */
export interface AdminCommandPayload {
    type: string;
    args: Record<string, unknown>;
}

export interface FetchErrorPayload {
    consecutiveFailures: number;
    error: string;
}

/**
 * Single shared emitter connecting DataPollingService (data layer) to the
 * Phaser scenes (ArenaScene draws the fighters, HUDScene draws lifebars, stars and the rating).
 */
export const EventBus = new Events.EventEmitter();

export const GameEvents = {
    DATA_UPDATED: 'data:updated',
    /** An import landed: the pairs in the payload are about to trade blows (queued behind whatever is still playing). */
    FIGHT_ROUND: 'fight:round',
    /** ArenaScene -> HUD: the round has really begun (FIGHT! banner, sound). */
    FIGHT_START: 'fight:round-start',
    /** ArenaScene -> HUD: one blow of a pair's round has landed (drives the lifebars blow by blow). */
    BLOW: 'fight:blow',
    /** ArenaScene -> HUD: every pair of the round has finished (the bars are released, the music may fade). */
    FIGHT_END: 'fight:round-end',
    /** The admin ended the day: the results are recorded, the animation is about to play (queued). */
    FINALE: 'fight:finale',
    /** ArenaScene -> HUD: the finale has really begun ("day result" banner). */
    FINALE_START: 'fight:finale-start',
    /** ArenaScene -> HUD: this pair's day is decided *now* — break the loser's star, name the winner. */
    FINALE_PAIR: 'fight:finale-pair',
    /** ArenaScene -> HUD: the whole finale is over. */
    FINALE_END: 'fight:finale-end',
    FETCH_ERROR: 'data:fetch-error',
    ADMIN_COMMAND: 'admin:command',
} as const;
