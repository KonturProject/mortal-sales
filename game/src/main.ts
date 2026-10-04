import StartGame, { powerSaver } from './game/main';
import type { ArenaScene } from './game/scenes/ArenaScene';
import { EventBus, GameEvents, FinalePayload, FinaleResult } from './game/core/EventBus';
import { GameState, StatusResponse, average } from './game/core/GameState';
import { DataPollingService } from './game/systems/DataPollingService';
import { AudioSystem } from './game/systems/Audio';
import { plan } from './game/systems/FightPlanner';
import { MATCH } from './game/core/Constants';

/** Ids for the `finale` commands the debug hooks hand to the polling pipeline (they only have to keep rising). */
let debugCommandId = 1000;

/** The day's verdict per pair from the current state, as the backend computes it: the higher average per employee wins. */
function dayResults(winners: Record<number, string>, stars: Record<string, number>): FinaleResult[] {
    return GameState.pairs.map(pair => {
        const [l, r] = [GameState.leader(pair.left), GameState.leader(pair.right)];
        const leftSum = l?.dayCount ?? 0;
        const rightSum = r?.dayCount ?? 0;
        const leftStaff = l?.staff ?? 1;
        const rightStaff = r?.staff ?? 1;
        const leftAvg = average(leftSum, leftStaff);
        const rightAvg = average(rightSum, rightStaff);
        const natural = Math.abs(leftAvg - rightAvg) < 1e-9 ? 'draw' : leftAvg > rightAvg ? pair.left : pair.right;
        const winner = winners[pair.id] ?? natural;
        const starsBefore = { [pair.left]: stars[pair.left] ?? 0, [pair.right]: stars[pair.right] ?? 0 };
        const starsAfter = { ...starsBefore };
        if (winner !== 'draw') starsAfter[winner] = Math.min(MATCH.STARS, starsAfter[winner] + 1); // a star is a day won
        return { pairId: pair.id, left: pair.left, right: pair.right, winner, leftAvg, rightAvg, leftSum, rightSum, leftStaff, rightStaff, starsBefore, starsAfter };
    });
}

document.addEventListener('DOMContentLoaded', () => {

    const game = StartGame('game-container');
    AudioSystem.unlockOnGesture();
    AudioSystem.loadClips();

    if (import.meta.env.DEV) {
        const arena = () => game.scene.getScene('ArenaScene') as ArenaScene;

        // Manual test hooks, from the devtools console. Call `__debug.poller.stop()` first when testing by hand,
        // otherwise the next real poll overwrites whatever you injected.
        (window as any).__debug = {
            EventBus,
            GameEvents,
            GameState,
            game,
            poller: DataPollingService,
            audio: AudioSystem,
            arena,
            /** `__debug.power()` -> current frame-rate mode and the rate frames are really drawn at. */
            power: () => powerSaver?.stats(),
            /** Feed a status object through the real poll pipeline (fights, commands, HUD) without any network. */
            injectStatus: (status: StatusResponse) => DataPollingService.applyForDebug(status),
            /** `__debug.plan(2.5, 0.4, { sample: 60 })` -> the blows the planner would throw for these AVERAGES per employee. */
            plan,
            /** `__debug.fight(1, 2.5, 0.4)` — a demo round of pair #1 at these averages per employee; no data changes. */
            fight: (pairId: number, leftAvg: number, rightAvg: number, sample?: number) =>
                DataPollingService.routeCommand({ type: 'fight', args: { pairId, leftAvg, rightAvg, sample } }),
            /**
             * `__debug.importCounts({ 'СР1': 12, 'СР3': 4 })` — a real import: sets these groups' day TOTALS, bumps the import
             * id, so the fights, the bars and the lifebars run exactly as after a real import.
             */
            importCounts: (counts: Record<string, number>) => {
                const before = Object.fromEntries(GameState.leaders.map(l => [l.rop, l.dayCount]));
                const after = { ...before, ...counts };
                DataPollingService.applyForDebug({
                    ok: true,
                    period: GameState.period,
                    pairs: GameState.pairs,
                    leaders: GameState.leaders.map(l => ({ ...l, dayCount: after[l.rop] ?? l.dayCount })),
                    managers: GameState.managers,
                    lastImport: { id: (GameState.lastImport?.id ?? 0) + 1, at: new Date().toISOString(), round: (GameState.lastImport?.round ?? 0) + 1, before, after },
                    lastUpdated: new Date().toISOString(),
                });
            },
            /** `__debug.finale({ dayNo: 3, periodFinished: false, winners: { 1: 'СР1', 2: 'draw', 3: 'СР9' } })` — a demo finale (visual only). */
            finale: (options: { dayNo?: number; periodFinished?: boolean; winners?: Record<number, string> } = {}) => {
                const stars = Object.fromEntries(GameState.leaders.map(l => [l.rop, l.stars]));
                const results = dayResults(options.winners ?? {}, stars);
                const payload: FinalePayload = {
                    dayNo: options.dayNo ?? GameState.period.dayIndex + 1,
                    results,
                    periodFinished: options.periodFinished ?? false,
                    matchWinners: Object.fromEntries(results.map(r => [String(r.pairId), r.winner])),
                    demo: true,
                };
                DataPollingService.routeCommand({ type: 'finale', args: payload as unknown as Record<string, unknown> });
            },
            /**
             * `__debug.finishDay({ 1: 'СР1', 2: 'draw' })` — what pressing "finish the day" causes end to end: a status whose groups
             * already hold the winner's star and whose day counters are back at zero, carrying a real (non-demo) `finale` command.
             * Pairs not listed are decided by the day's averages. On the fifth day the week's match is decided too.
             */
            finishDay: (winners: Record<number, string> = {}) => {
                const stars: Record<string, number> = Object.fromEntries(GameState.leaders.map(l => [l.rop, l.stars]));
                const results = dayResults(winners, stars);
                for (const r of results) {
                    stars[r.left] = r.starsAfter[r.left];
                    stars[r.right] = r.starsAfter[r.right];
                }
                const dayIndex = GameState.period.dayIndex + 1;
                const periodFinished = dayIndex >= GameState.period.daysTotal;
                const matchWinners: Record<string, string> = {};
                for (const pair of GameState.pairs) {
                    const [l, r] = [GameState.leader(pair.left), GameState.leader(pair.right)];
                    const [ls, rs] = [stars[pair.left], stars[pair.right]];
                    const [la, ra] = [average(l?.periodCount ?? 0, l?.staff ?? 1), average(r?.periodCount ?? 0, r?.staff ?? 1)];
                    matchWinners[String(pair.id)] = ls !== rs ? (ls > rs ? pair.left : pair.right)
                        : Math.abs(la - ra) < 1e-9 ? 'draw' : la > ra ? pair.left : pair.right;
                }
                const payload: FinalePayload = { dayNo: dayIndex, results, periodFinished, matchWinners: periodFinished ? matchWinners : undefined };
                debugCommandId++;
                const now = Date.now();
                DataPollingService.applyForDebug({
                    ok: true,
                    period: { ...GameState.period, dayIndex, state: periodFinished ? 'finished' : 'active', winners: periodFinished ? matchWinners : undefined },
                    pairs: GameState.pairs,
                    leaders: GameState.leaders.map(l => ({ ...l, stars: stars[l.rop], dayCount: 0 })),
                    managers: GameState.managers.map(m => ({ ...m, day: 0 })),
                    lastImport: GameState.lastImport,
                    lastUpdated: new Date(now).toISOString(),
                    serverNow: now,
                    commands: [{ id: debugCommandId, type: 'finale', args: payload as unknown as Record<string, unknown>, issuedAt: now }],
                });
            },
            /** `__debug.newWeek()` — the admin's "new week": no stars, the match running again. */
            newWeek: () => {
                DataPollingService.applyForDebug({
                    ok: true,
                    period: { id: GameState.period.id + 1, dayIndex: 0, daysTotal: GameState.period.daysTotal, state: 'active' },
                    pairs: GameState.pairs,
                    leaders: GameState.leaders.map(l => ({ ...l, stars: 0, dayCount: 0, periodCount: 0 })),
                    managers: GameState.managers.map(m => ({ ...m, day: 0, period: 0 })),
                    lastImport: GameState.lastImport,
                    lastUpdated: new Date().toISOString(),
                });
            },
            /** `__debug.command('confetti')` — what the admin page's animation buttons cause. */
            command: (type: string, args: Record<string, unknown> = {}) => DataPollingService.routeCommand({ type, args }),
        };
    }

});
