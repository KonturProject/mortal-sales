import { QUALITY } from './Quality';

export const GAME = {
    /** Logical size — every coordinate in the code is in these units. */
    WIDTH: 1280,
    HEIGHT: 720,
    /**
     * The canvas buffer is RENDER_SCALE × the logical size (camera zoom, see
     * core/Render.ts) and text is rasterised at the same factor, so text lands on
     * buffer pixels 1:1 instead of being stretched from a 720p buffer by the
     * browser (that made HUD text blurry). Chosen per device at load: it follows the
     * real on-screen size, capped at 2 (1.5 on weak machines) — see core/Quality.ts.
     */
    RENDER_SCALE: QUALITY.renderScale,
} as const;

/** Working days in a match (the week) and the star slots of a leader: a star is a day won, so the slots cover a full week. */
export const MATCH = {
    DAYS: 5,
    STARS: 5,
    /** Number of leader pairs on screen (3 fighters a side). */
    PAIRS: 3,
} as const;

/**
 * The arena floor as three depth lanes, one per pair. Lane 0 is the farthest (higher on screen, smaller, its
 * fighters stand closer to the vanishing point), lane 2 the nearest. Pair #i uses lane i; the pair's first
 * leader stands on the left, the second on the right (mirrored). Feet anchor at `y`.
 *
 * `clashX` is where the lane's two fighters meet; the three lanes meet at different x on purpose, so the
 * fighters of neighbouring lanes do not stand on top of each other while all three pairs fight at once.
 * Tuned for the temple-courtyard background (bg_arena.jpg): the stone floor is only the bottom ~20 % of the
 * picture (y≈580–720), so the three lanes are narrow strips and the fighters are small — a distant view.
 * Retune the lanes if the background changes.
 */
export const ARENA = {
    LANES: [
        { y: 614, scale: 0.87, homeLeft: 300, homeRight: 980, clashX: 640 },
        { y: 657, scale: 1.01, homeLeft: 205, homeRight: 1075, clashX: 470 },
        { y: 700, scale: 1.17, homeLeft: 115, homeRight: 1165, clashX: 810 },
    ],
    /** Hero textures are built at 2x their on-screen size (tools/build-sprites.py). */
    TEXTURE_SCALE: 0.5,
    /** Gap between the two fighters' standing front edges while they trade blows. */
    CLASH_GAP: 64,
    /** Fighters may not be thrown past these x (the rock walls of the placeholder arena). */
    WALL_LEFT: 60,
    WALL_RIGHT: 1220,
} as const;

/** Timings of one round and of the fighters' moves, ms. */
export const FIGHT = {
    /** A real round opens with "РАУНД N" (and the announcer's call); the fighters move on the "FIGHT!" this long after. */
    ROUND_INTRO_MS: 1600,
    /** Between the start of one pair's round and the next one's, so the three pairs do not move in lock-step. */
    PAIR_STAGGER_MS: 420,
    STEP_IN_MS: 620,
    STEP_OUT_MS: 720,
    /** One blow: wind-up, lunge, contact hold, recover. The next blow starts BEAT_MS after the impact of the previous one. */
    WINDUP_MS: 120,
    LUNGE_MS: 80,
    HOLD_MS: 45,
    RECOVER_MS: 160,
    BEAT_MS: 250,
    /** Step back on a staggering blow. */
    STAGGER_PX: 26,
    STAGGER_MS: 150,
    STUN_MS: 1250,
    KNOCKDOWN_LIE_MS: 700,
    GETUP_MS: 380,
    /** Shorter than it looks tempting: the lanes' homes sit near the walls, and a thrown fighter must not land behind the neighbouring lanes' fighters. */
    LAUNCH_DISTANCE: 230,
    /** Rise at the peak is this × the lane's sprite scale × 1.6, so the near lane flies higher than the far one (perspective). */
    LAUNCH_HEIGHT: 190,
    LAUNCH_MS: 800,
    LAUNCH_LIE_MS: 900,
    /** Freeze of the whole picture at the moment of a heavy impact. */
    HITSTOP_MS: 90,
    /** Camera shake at the final blow, per tier (index = tier). */
    SHAKE: [
        { ms: 80, intensity: 0.0015 },
        { ms: 120, intensity: 0.0028 },
        { ms: 200, intensity: 0.005 },
        { ms: 420, intensity: 0.011 },
    ],
} as const;

/** Day-end finale ("Finish him"): per pair, one after another. */
export const FINALE = {
    INTRO_MS: 1600,
    PAIR_GAP_MS: 700,
    /** Time the winner's pose / the loser's KO is held before the next pair steps up. */
    HOLD_MS: 1400,
    STAR_BREAK_MS: 1000,
} as const;

/** Top of the screen: one lifebar row per pair. */
export const LIFEBAR = {
    TOP: 12,
    ROW_H: 30,
    ROW_GAP: 6,
    /** Half-width of the centre gap that holds "VS". */
    CENTER_GAP: 46,
    BAR_W: 372,
    /** Seconds the bar takes to settle after a poll that changed the numbers (a fight drags it out over the round instead). */
    SETTLE_MS: 600,
} as const;

/**
 * The managers' rating: two panels on the sky/columns at the left and right, under the lifebars (the floor is taken by
 * the fighters). Ranks 1..ROWS on the left, the next ROWS on the right, then the pages turn.
 */
export const BOARD = {
    PANEL_W: 262,
    MARGIN_X: 12,
    /** y of the first row; the panel's header sits just above it. */
    TOP: 152,
    ROWS: 13,
    ROW_H: 17,
    PAGE_MS: 15_000,
} as const;

export const HUD = {
    /** Connection status and the mute button, bottom-right corner of the floor. */
    STATUS_Y: GAME.HEIGHT - 12,
} as const;

export const POLL = {
    INTERVAL_MS: 15000,
    /**
     * Longer than the poll interval on purpose: Apps Script answers in ~3 s typically, but roughly one
     * request in ten takes 10–30 s (measured 2026-09-21). Giving up at 15 s turned each of those into a
     * failed poll; DataPollingService never runs two polls at once, so a slow one just delays the next.
     */
    TIMEOUT_MS: 30000,
    /**
     * If the status request has not answered after this long — a cold Apps Script instance can take 10–40 s,
     * which left the screen at zeros for a minute after opening the page — a second identical request is
     * started and whichever answers first wins. (A request that fails outright is retried at once.) At most
     * MAX_ATTEMPTS per poll, so the extra load only exists while the backend is being slow.
     */
    HEDGE_AFTER_MS: 6000,
    MAX_ATTEMPTS: 2,
    /** One failed poll in a row is normal noise and is not shown; from this many the HUD says "offline". */
    OFFLINE_AFTER_FAILURES: 2,
    MAX_CONSECUTIVE_FAILURES: 5,
    /** A command older than this when the display first sees it (it was offline) is not worth playing any more. */
    COMMAND_MAX_AGE_MS: 120_000,
    /** Gap between several commands that arrive in one poll, so they read one after another. */
    COMMAND_STAGGER_MS: 700,
} as const;

export const HERO_SLUGS = [
    'hero_lion',
    'hero_scrooge',
    'hero_grinch',
    'hero_yoda',
    'hero_neznaika',
    'hero_minion',
] as const;

export type HeroSlug = typeof HERO_SLUGS[number];
