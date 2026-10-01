import { GameObjects, Scene } from 'phaser';
import {
    EventBus, GameEvents, FetchErrorPayload, AdminCommandPayload, FightRoundPayload, FightPairPayload,
    FinalePayload, FinaleResult, BlowPayload,
} from '../core/EventBus';
import { GameState } from '../core/GameState';
import { fmtAverage } from '../core/Names';
import { fitCameraToGame } from '../core/Render';
import { GAME, HUD, LIFEBAR, MATCH, POLL } from '../core/Constants';
import { hudText } from '../core/TextStyles';
import { shortName } from '../core/Names';
import { RosterConfig } from '../systems/RosterConfig';
import { emitConfettiBurst, emitTitle, flashScreen } from '../systems/Fx';
import { AudioSystem } from '../systems/Audio';
import { PairLifebar } from '../objects/PairLifebar';
import { ManagerBoard } from '../objects/ManagerBoard';

const STATUS_X = GAME.WIDTH - 14;
const STATUS_Y = HUD.STATUS_Y;
const STATUS_TICK_MS = 30000;
const MUTE_X = STATUS_X - 120;

/**
 * Everything drawn on top of the arena: the three pair lifebars with the leaders' stars, the day counter, the
 * managers' rating, the announcements (FIGHT!, the day's verdict) and the connection/mute controls. It talks to
 * ArenaScene only through the EventBus, never directly.
 */
export class HUDScene extends Scene {
    private lifebars: PairLifebar[] = [];
    private board!: ManagerBoard;
    private dayText!: GameObjects.Text;
    private statusDot!: GameObjects.Arc;
    private statusText!: GameObjects.Text;
    private muteIcon!: GameObjects.Text;
    /** Centre-screen message while there is no data at all (first load, refused key, no connection). */
    private notice!: GameObjects.Text;
    private lastError = '';
    private consecutiveFailures = 0;
    private lastGoodAt = Date.now();
    /**
     * The round / finale that is playing *now* (set when the arena really starts it, not when its event arrives — a second
     * event can arrive while the first still plays). The blows move the bars from `before` to `after`.
     */
    private round = new Map<number, FightPairPayload>();
    private finale: FinalePayload | null = null;

    constructor() {
        super('HUDScene');
    }

    create() {
        fitCameraToGame(this);

        for (let i = 0; i < MATCH.PAIRS; i++) this.lifebars.push(new PairLifebar(this, i));

        const belowBars = LIFEBAR.TOP + MATCH.PAIRS * (LIFEBAR.ROW_H + LIFEBAR.ROW_GAP);
        this.dayText = this.add.text(GAME.WIDTH / 2, belowBars + 2, '', hudText(13, '#c9d6ec'))
            .setOrigin(0.5, 0).setStroke('#0b1020', 4).setAlpha(0.95);

        this.board = new ManagerBoard(this);

        this.notice = this.add.text(GAME.WIDTH / 2, 330, '', { ...hudText(26, '#ffe89a'), align: 'center', wordWrap: { width: 760 } })
            .setOrigin(0.5).setStroke('#0b1020', 6).setDepth(3000);
        this.renderNotice();

        this.statusText = this.add.text(STATUS_X - 10, STATUS_Y, '', hudText(11, '#8fb8d9', 'Arial, sans-serif')).setOrigin(1, 0.5).setAlpha(0.9);
        this.statusDot = this.add.circle(STATUS_X, STATUS_Y, 4, 0x36e08a);
        this.renderStatus();

        this.muteIcon = this.add.text(MUTE_X, STATUS_Y, '', { fontFamily: 'Arial, sans-serif', fontSize: '15px', resolution: GAME.RENDER_SCALE })
            .setOrigin(0.5).setAlpha(0.9).setInteractive({ useHandCursor: true });
        this.renderMuteIcon();
        this.muteIcon.on('pointerdown', () => {
            AudioSystem.init();
            AudioSystem.toggleMute();
            this.renderMuteIcon();
        });

        this.render();

        const handlers: Array<[string, (...args: never[]) => void]> = [
            [GameEvents.DATA_UPDATED, this.onDataUpdated],
            [GameEvents.FETCH_ERROR, this.onFetchError],
            [GameEvents.FIGHT_ROUND, this.onFightRound],
            [GameEvents.FIGHT_START, this.onFightStart],
            [GameEvents.BLOW, this.onBlow],
            [GameEvents.FIGHT_END, this.onFightEnd],
            [GameEvents.FINALE, this.onFinale],
            [GameEvents.FINALE_START, this.onFinaleStart],
            [GameEvents.FINALE_PAIR, this.onFinalePair],
            [GameEvents.FINALE_END, this.onFinaleEnd],
            [GameEvents.ADMIN_COMMAND, this.onAdminCommand],
        ];
        handlers.forEach(([event, fn]) => EventBus.on(event, fn as never, this));

        const statusTimer = this.time.addEvent({ delay: STATUS_TICK_MS, loop: true, callback: () => this.renderStatus() });
        this.events.once('shutdown', () => {
            handlers.forEach(([event, fn]) => EventBus.off(event, fn as never, this));
            statusTimer.remove();
        });
    }

    /* --------------------------------------------------------------- data */

    private onDataUpdated() {
        this.consecutiveFailures = 0;
        this.lastError = '';
        this.lastGoodAt = Date.now();
        this.renderStatus();
        this.renderNotice();
        this.render();
    }

    private onFetchError(payload: FetchErrorPayload) {
        this.consecutiveFailures = payload.consecutiveFailures;
        this.lastError = payload.error;
        this.renderStatus();
        this.renderNotice();
    }

    /** Why there is nothing to show — in words the person at the screen (or the admin) can act on. */
    private errorText(): string {
        if (this.lastError.includes('display_key_not_set')) return 'Ключ экрана ещё не создан.\nАдминка → вкладка «Доступ» → «Создать ключ экрана».';
        if (this.lastError.includes('bad_display_key')) return 'Неверный ключ экрана.\nОткройте на этом экране ссылку из админки (вкладка «Доступ»).';
        if (this.lastError.includes('server_error')) return 'Сервер данных ответил ошибкой. Идёт повторная попытка…';
        return 'Нет связи с сервером данных. Идёт повторная попытка…';
    }

    private renderNotice() {
        if (GameState.hasBaseline) {
            this.notice.setVisible(false);
            return;
        }
        // The very first request is simply in flight until the first failure comes back.
        const text = this.lastError ? this.errorText() : 'Загрузка данных…';
        this.notice.setVisible(true);
        if (this.notice.text !== text) this.notice.setText(text);
    }

    private barFor(pairId: number): PairLifebar | undefined {
        return this.lifebars.find(bar => bar.pairId === pairId);
    }

    private leaderName(rop: string): string {
        const fromSheet = GameState.leader(rop)?.name;
        if (fromSheet) return shortName(fromSheet);
        const slug = RosterConfig.heroSlugForRop(rop);
        return (slug ? RosterConfig.heroDef(slug)?.name : undefined) ?? rop;
    }

    private leaderColor(rop: string): string {
        const slug = RosterConfig.heroSlugForRop(rop);
        return (slug ? RosterConfig.heroDef(slug)?.color : undefined) ?? '#888888';
    }

    /** The resting picture from the data. Every part skips a no-op, so an unchanged poll costs no frames. */
    private render() {
        // Before the first answer there is nothing to put in the panels: show only the notice.
        this.dayText.setVisible(GameState.hasBaseline);
        this.board.setVisible(GameState.hasBaseline);
        this.lifebars.forEach((bar, i) => {
            const pair = GameState.pairs[i];
            bar.setVisible(!!pair);
            if (!pair) return;
            bar.setPair(pair.id, {
                left: { rop: pair.left, color: this.leaderColor(pair.left), name: this.leaderName(pair.left) },
                right: { rop: pair.right, color: this.leaderColor(pair.right), name: this.leaderName(pair.right) },
            });
            bar.setCounts(GameState.dayAvg(pair.left), GameState.dayAvg(pair.right));
            bar.setCaptions(
                { sum: GameState.dayCount(pair.left), staff: GameState.leader(pair.left)?.staff ?? 0 },
                { sum: GameState.dayCount(pair.right), staff: GameState.leader(pair.right)?.staff ?? 0 },
            );
            bar.setStars(GameState.leader(pair.left)?.stars ?? MATCH.STARS, GameState.leader(pair.right)?.stars ?? MATCH.STARS);
        });

        const { period } = GameState;
        const text = period.state === 'finished'
            ? 'НЕДЕЛЬНЫЙ МАТЧ ЗАВЕРШЁН'
            : `ДЕНЬ ${Math.min(period.dayIndex + 1, period.daysTotal)} ИЗ ${period.daysTotal} · ЦЕЛЬ ${fmtAverage(GameState.targetAvg)} НА ЧЕЛОВЕКА`;
        if (this.dayText.text !== text) this.dayText.setText(text);

        this.board.update(GameState.managers);
    }

    /* -------------------------------------------------------------- fights */

    /** An import landed: hold the bars at the "before" picture right away, because the poll that carried the event also carried the new numbers. */
    private onFightRound(payload: FightRoundPayload) {
        if (payload.demo) return;
        for (const pair of payload.pairs) this.barFor(pair.pairId)?.lockForRound({ left: pair.leftBeforeAvg, right: pair.rightBeforeAvg });
    }

    /** The arena has really begun the round (it may have waited behind a finale). */
    private onFightStart(payload: FightRoundPayload) {
        this.round = new Map(payload.pairs.map(pair => [pair.pairId, pair]));
        emitTitle(this, GAME.WIDTH / 2, 330, 'FIGHT!', { size: 118, holdMs: 650 });
        flashScreen(this, 0xffffff, 0.22, 120);
        AudioSystem.playFightStinger();
    }

    private onBlow(blow: BlowPayload) {
        const pair = this.round.get(blow.pairId);
        if (!pair) return;
        const progress = (blow.index + 1) / blow.total;
        const lerp = (from: number, to: number) => from + (to - from) * progress;
        this.barFor(blow.pairId)?.stepTowards(lerp(pair.leftBeforeAvg, pair.leftAvg), lerp(pair.rightBeforeAvg, pair.rightAvg));
    }

    private onFightEnd(payload: FightRoundPayload) {
        if (!payload.demo) {
            for (const pair of payload.pairs) this.barFor(pair.pairId)?.unlockRound({ left: pair.leftAvg, right: pair.rightAvg });
        }
        this.round.clear();
        this.render(); // anything that arrived while the bars were locked
    }

    /* -------------------------------------------------------------- finale */

    private onFinale(payload: FinalePayload) {
        if (!payload.demo) {
            for (const result of payload.results) {
                const bar = this.barFor(result.pairId);
                if (!bar) continue;
                // The data already holds the verdict (stars lost, day counters back to zero); show the day as it was until the animation says otherwise.
                bar.holdStars(true);
                bar.forceStars(result.starsBefore[result.left] ?? MATCH.STARS, result.starsBefore[result.right] ?? MATCH.STARS);
                bar.lockForRound({ left: result.leftAvg, right: result.rightAvg });
            }
        }
    }

    private onFinaleStart(payload: FinalePayload) {
        this.finale = payload;
        emitTitle(this, GAME.WIDTH / 2, 320, `ИТОГ ДНЯ ${payload.dayNo}`, { size: 84, color: '#ffffff', stroke: '#16305c', holdMs: 900 });
        flashScreen(this, 0xffe89a, 0.18, 160);
    }

    private onFinalePair(result: FinaleResult) {
        if (this.finale?.demo) return;
        const bar = this.barFor(result.pairId);
        if (!bar || result.winner === 'draw') return;
        const loser = result.winner === result.left ? result.right : result.left;
        bar.flashName(result.winner);
        void bar.breakStar(loser, result.starsAfter[loser] ?? 0);
    }

    private onFinaleEnd(payload: FinalePayload) {
        if (!payload.demo) {
            for (const result of payload.results) {
                const bar = this.barFor(result.pairId);
                if (!bar) continue;
                bar.holdStars(false);
                bar.unlockRound({ left: GameState.dayAvg(result.left), right: GameState.dayAvg(result.right) });
            }
        }
        this.finale = null;
        this.render();
        if (payload.periodFinished && !payload.demo) {
            emitTitle(this, GAME.WIDTH / 2, 320, 'МАТЧ НЕДЕЛИ ЗАВЕРШЁН', { size: 64, holdMs: 2600 });
            emitConfettiBurst(this, 140);
            flashScreen(this, 0xffe89a, 0.3, 200, 2);
            AudioSystem.playFanfare();
        }
    }

    /* ------------------------------------------------------ admin commands */

    private onAdminCommand(cmd: AdminCommandPayload) {
        if (cmd.type !== 'confetti' && cmd.type !== 'celebrate') return;
        emitConfettiBurst(this, 120);
        flashScreen(this, 0xffe89a, 0.3, 200, 2);
    }

    /* ---------------------------------------------------- status and mute */

    private renderMuteIcon() {
        this.muteIcon.setText(AudioSystem.isMuted ? '🔇' : '🔊');
    }

    private renderStatus() {
        const minutesAgo = Math.floor((Date.now() - this.lastGoodAt) / 60000);

        // A single missed poll is routine (Apps Script sometimes answers very slowly) and is not shown.
        let dot: number;
        let text: string;
        if (this.consecutiveFailures < POLL.OFFLINE_AFTER_FAILURES) {
            dot = 0x36e08a;
            text = 'в эфире';
        } else {
            dot = this.consecutiveFailures >= POLL.MAX_CONSECUTIVE_FAILURES ? 0xe0483a : 0xe0b23a;
            text = this.lastError.includes('display_key') ? 'нет доступа: ключ экрана' : `офлайн · ${minutesAgo} мин`;
        }
        this.statusDot.setFillStyle(dot);
        if (this.statusText.text !== text) this.statusText.setText(text);
    }
}
