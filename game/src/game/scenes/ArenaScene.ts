import { GameObjects, Scene } from 'phaser';
import {
    EventBus, GameEvents, AdminCommandPayload, FightRoundPayload, FinalePayload, BlowPayload,
} from '../core/EventBus';
import { GameState, PairStatus } from '../core/GameState';
import { fitCameraToGame } from '../core/Render';
import { ARENA, FIGHT, FINALE, GAME, MATCH } from '../core/Constants';
import { sleep } from '../core/Async';
import { RosterConfig } from '../systems/RosterConfig';
import { DataPollingService } from '../systems/DataPollingService';
import { FightDirector } from '../systems/FightDirector';
import { Fighter } from '../objects/Fighter';
import { emitConfettiBurst, startIdleSway } from '../systems/Fx';

/**
 * The arena: three depth lanes, one per pair, the pair's first leader on the left and the second on the right.
 * Reacts to game events only — what fights, and how hard, is decided upstream (DataPollingService diffs the
 * imports, FightPlanner plans the blows). Rounds and finales are queued and played one after another; the
 * three pairs of a round fight side by side.
 */
export class ArenaScene extends Scene {
    private director!: FightDirector;
    /** One fighter per department code, kept for the whole session and re-seated when the pairs change. */
    readonly fighters = new Map<string, Fighter>();
    private seated = '';
    private queueTail: Promise<void> = Promise.resolve();
    private queued = 0;
    /** The week's verdict is on display (winners celebrating, losers down). */
    private matchEndShown = false;
    private matchLabels: GameObjects.Text[] = [];

    constructor() {
        super('ArenaScene');
    }

    create() {
        fitCameraToGame(this);
        this.cameras.main.setBackgroundColor('#08090f');

        const bgKey = this.textures.exists('bg_arena') ? 'bg_arena' : 'bg_cave';
        this.add.image(GAME.WIDTH / 2, GAME.HEIGHT / 2, bgKey).setDisplaySize(GAME.WIDTH, GAME.HEIGHT).setDepth(-10);

        this.director = new FightDirector(this);

        for (const rop of RosterConfig.ropCodes()) {
            const slug = RosterConfig.heroSlugForRop(rop);
            const def = slug ? RosterConfig.heroDef(slug) : undefined;
            if (!def) continue;
            const fighter = new Fighter(this, def, rop);
            fighter.setVisible(false);
            this.fighters.set(rop, fighter);
        }
        startIdleSway(this, [...this.fighters.values()]);

        EventBus.on(GameEvents.FIGHT_ROUND, this.onFightRound, this);
        EventBus.on(GameEvents.FINALE, this.onFinale, this);
        EventBus.on(GameEvents.DATA_UPDATED, this.onDataUpdated, this);
        EventBus.on(GameEvents.ADMIN_COMMAND, this.onAdminCommand, this);
        this.events.once('shutdown', () => {
            EventBus.off(GameEvents.FIGHT_ROUND, this.onFightRound, this);
            EventBus.off(GameEvents.FINALE, this.onFinale, this);
            EventBus.off(GameEvents.DATA_UPDATED, this.onDataUpdated, this);
            EventBus.off(GameEvents.ADMIN_COMMAND, this.onAdminCommand, this);
        });

        // A poll may have landed before this scene finished creating.
        this.syncWithState();
        DataPollingService.start();
    }

    /* ------------------------------------------------------------- state */

    private onDataUpdated() {
        this.syncWithState();
    }

    /**
     * Puts the fighters where the data says (pairs, and the week's verdict). Skipped while a round or a finale is
     * playing — the animation is what shows the change then — and retried when the queue drains.
     */
    private syncWithState() {
        if (this.queued > 0 || !GameState.hasBaseline) return;
        this.seatPairs(GameState.pairs);
        this.syncMatchEnd();
    }

    private seatPairs(pairs: PairStatus[]) {
        const signature = pairs.map(p => `${p.id}:${p.left}/${p.right}`).join('|');
        if (signature === this.seated) return;
        this.seated = signature;

        const used = new Set<string>();
        pairs.slice(0, MATCH.PAIRS).forEach((pair, lane) => {
            const left = this.fighters.get(pair.left);
            const right = this.fighters.get(pair.right);
            if (!left || !right) return;
            const geometry = ARENA.LANES[lane];
            for (const [fighter, side] of [[left, 'left'], [right, 'right']] as const) {
                fighter.setLane(side, geometry);
                fighter.standAtHome();
                fighter.setVisible(true).setAlpha(0);
                this.tweens.add({ targets: fighter, alpha: 1, duration: 300 });
                used.add(fighter.rop);
            }
        });
        for (const [rop, fighter] of this.fighters) if (!used.has(rop)) fighter.setVisible(false);
        this.clearMatchEnd();
        this.syncMatchEnd();
    }

    /** The week's match, as data says it stands: decided (winners up, losers down) or running. */
    private syncMatchEnd() {
        const finished = GameState.period.state === 'finished';
        if (finished && !this.matchEndShown) this.showMatchEnd(GameState.period.winners ?? {}, false);
        else if (!finished && this.matchEndShown) this.clearMatchEnd();
    }

    private showMatchEnd(winners: Record<string, string>, animate: boolean) {
        this.matchEndShown = true;
        for (const pair of GameState.pairs) {
            const left = this.fighters.get(pair.left);
            const right = this.fighters.get(pair.right);
            if (!left || !right) continue;
            // No entry (the pairs were changed after the week ended), or a winner who is not part of this pair: nothing to show for it.
            const winnerRop = winners[String(pair.id)];
            if (winnerRop === undefined || (winnerRop !== 'draw' && winnerRop !== left.rop && winnerRop !== right.rop)) continue;
            const lane = ARENA.LANES[GameState.pairs.indexOf(pair)] ?? ARENA.LANES[0];
            if (winnerRop === 'draw') {
                this.addMatchLabel(lane.clashX, lane.y - 190, 'НИЧЬЯ', '#cfe3f5'); // the lanes meet at different x, so the labels do not stack
                continue;
            }
            const winner = winnerRop === left.rop ? left : right;
            const loser = winner === left ? right : left;
            if (animate) void winner.celebrate();
            loser.stayDown(winner.facing);
            this.addMatchLabel(winner.homeX, lane.y - 200, 'ПОБЕДИТЕЛЬ НЕДЕЛИ', '#ffd23a');
        }
    }

    private addMatchLabel(x: number, y: number, text: string, color: string) {
        this.matchLabels.push(
            this.add.text(x, y, text, {
                fontFamily: 'Impact, "Arial Black", Arial, sans-serif', fontSize: '22px', resolution: GAME.RENDER_SCALE, color,
            }).setOrigin(0.5).setStroke('#1b1400', 5).setDepth(3500),
        );
    }

    private clearMatchEnd() {
        this.matchLabels.forEach(t => t.destroy());
        this.matchLabels = [];
        if (this.matchEndShown) {
            this.matchEndShown = false;
            for (const fighter of this.fighters.values()) if (fighter.visible) fighter.standAtHome();
        }
    }

    /* ------------------------------------------------------------- queue */

    private enqueue(job: () => Promise<void>) {
        this.queued++;
        this.queueTail = this.queueTail
            .then(job)
            .catch(err => {
                // Whatever went wrong mid-animation, nobody may stay frozen in a pose or "engaged" (the idle sway would never touch them again).
                console.error('[ArenaScene] job failed:', err);
                this.recoverFighters();
            })
            .then(() => {
                this.queued--;
                if (this.queued === 0) this.syncWithState();
            });
    }

    /** Everyone back on their feet at home, nothing engaged. Only used after a failure. */
    private recoverFighters() {
        for (const fighter of this.fighters.values()) {
            fighter.engaged = false;
            if (fighter.visible) fighter.standAtHome();
        }
    }

    /**
     * A pair may only fight if it is really standing in the arena as a pair: both leaders seated, on the same lane, on opposite
     * sides. After a change of pairs (or before the first poll) an event can name two fighters that are not facing each other.
     */
    private seatedPair(leftRop: string, rightRop: string): [Fighter, Fighter] | null {
        const left = this.fighters.get(leftRop);
        const right = this.fighters.get(rightRop);
        if (!left || !right || !left.visible || !right.visible) return null;
        if (left.side !== 'left' || right.side !== 'right' || left.clashX !== right.clashX) return null;
        return [left, right];
    }

    /* ------------------------------------------------------------- round */

    private onFightRound(payload: FightRoundPayload) {
        this.enqueue(() => this.playRound(payload));
    }

    /** Public so the dev hooks can drive it: every listed pair fights, staggered, each in its own lane. */
    async playRound(payload: FightRoundPayload): Promise<void> {
        EventBus.emit(GameEvents.FIGHT_START, payload);
        try {
            await Promise.all(payload.pairs.map(async (pair, i) => {
                const seated = this.seatedPair(pair.left, pair.right);
                if (!seated) return;
                await sleep(this, i * FIGHT.PAIR_STAGGER_MS);
                const fight = this.director.planFor(pair.leftAvg, pair.rightAvg, pair.sample, GameState.targetAvg);
                await this.director.playPair(seated[0], seated[1], fight, (index, total) => {
                    EventBus.emit(GameEvents.BLOW, { pairId: pair.pairId, index, total } satisfies BlowPayload);
                });
            }));
        } finally {
            EventBus.emit(GameEvents.FIGHT_END, payload); // the HUD must always let its bars go
        }
    }

    /* ------------------------------------------------------------ finale */

    private onFinale(payload: FinalePayload) {
        this.enqueue(() => this.playFinale(payload));
    }

    async playFinale(payload: FinalePayload): Promise<void> {
        EventBus.emit(GameEvents.FINALE_START, payload);
        try {
            await sleep(this, FINALE.INTRO_MS);
            for (const result of payload.results) {
                const seated = this.seatedPair(result.left, result.right);
                if (!seated) {
                    EventBus.emit(GameEvents.FINALE_PAIR, result); // not on the arena any more: the HUD still breaks the star
                    continue;
                }
                await this.director.playFinalePair(result, seated[0], seated[1]);
                await sleep(this, FINALE.PAIR_GAP_MS);
            }
            if (payload.periodFinished) {
                this.showMatchEnd(payload.matchWinners ?? {}, true);
                emitConfettiBurst(this, 90);
            }
        } finally {
            EventBus.emit(GameEvents.FINALE_END, payload); // the HUD must always release the stars and bars
        }
    }

    /* ---------------------------------------------------- admin commands */

    private onAdminCommand(cmd: AdminCommandPayload) {
        if (cmd.type === 'celebrate') {
            this.fighters.forEach(fighter => { if (fighter.visible && fighter.canSway()) void fighter.celebrate(); });
        }
        // 'confetti' is drawn by HUDScene (full-screen effect).
    }
}
