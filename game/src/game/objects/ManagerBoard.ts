import { Display, GameObjects, Scene, Time } from 'phaser';
import { BOARD, GAME } from '../core/Constants';
import { hudText } from '../core/TextStyles';
import { shortName } from '../core/Names';
import { ManagerStatus } from '../core/GameState';
import { RosterConfig } from '../systems/RosterConfig';

const PER_PAGE = BOARD.ROWS * 2;

interface Row {
    dot: GameObjects.Arc;
    label: GameObjects.Text;
    numbers: GameObjects.Text;
}

/**
 * The managers' rating in absolute numbers: place, short name (with the colour of the group), invoices over the
 * week and, smaller, today's. Two panels (left and right of the arena); sorted by the week's total. With more managers than fit
 * (2 × BOARD.ROWS) the pages turn every BOARD.PAGE_MS — one short fade, a finite tween, so a still display stays at the
 * idle frame rate.
 */
export class ManagerBoard extends GameObjects.Container {
    private rows: Row[] = [];
    private caption: GameObjects.Text;
    private pageText: GameObjects.Text;
    private sorted: ManagerStatus[] = [];
    private page = 0;
    private signature = '';
    private timer: Time.TimerEvent | null = null;

    constructor(scene: Scene) {
        super(scene, 0, 0);

        const panelH = BOARD.ROWS * BOARD.ROW_H + 32;
        const panelXs = [BOARD.MARGIN_X, GAME.WIDTH - BOARD.MARGIN_X - BOARD.PANEL_W];
        const panel = scene.add.graphics();
        for (const x of panelXs) {
            panel.fillStyle(0x070a14, 0.8);
            panel.fillRoundedRect(x - 4, BOARD.TOP - 26, BOARD.PANEL_W + 8, panelH, 8);
            panel.lineStyle(1.5, 0xc9b27a, 0.85);
            panel.strokeRoundedRect(x - 4, BOARD.TOP - 26, BOARD.PANEL_W + 8, panelH, 8);
        }
        this.add(panel);

        this.caption = scene.add.text(panelXs[0] + 4, BOARD.TOP - 13, 'РЕЙТИНГ МЕНЕДЖЕРОВ · неделя (+сегодня)', hudText(11, '#e8d9a8'))
            .setOrigin(0, 0.5);
        this.pageText = scene.add.text(panelXs[1] + BOARD.PANEL_W - 4, BOARD.TOP - 13, '', hudText(11, '#e8d9a8')).setOrigin(1, 0.5);
        this.add([this.caption, this.pageText]);

        for (const [column, x] of panelXs.entries()) {
            for (let line = 0; line < BOARD.ROWS; line++) {
                const y = BOARD.TOP + line * BOARD.ROW_H + BOARD.ROW_H / 2;
                const dot = scene.add.circle(x + 5, y, 4, 0x888888);
                const label = scene.add.text(x + 15, y, '', hudText(12, '#f1ecdc', 'Arial, sans-serif')).setOrigin(0, 0.5).setStroke('#0a0a12', 3);
                const numbers = scene.add.text(x + BOARD.PANEL_W - 4, y, '', hudText(12, '#ffffff')).setOrigin(1, 0.5).setStroke('#0a0a12', 3);
                this.add([dot, label, numbers]);
                // Slot order = rank order within a page: the whole left panel first, then the right one.
                this.rows[column * BOARD.ROWS + line] = { dot, label, numbers };
            }
        }

        scene.add.existing(this);
    }

    /** Load the current managers; re-renders only when something the board shows has changed. */
    update(managers: ManagerStatus[]) {
        const sorted = [...managers].sort((a, b) => b.period - a.period || b.day - a.day || a.name.localeCompare(b.name, 'ru'));
        const signature = sorted.map(m => `${m.name}|${m.rop}|${m.day}|${m.period}`).join(';');
        if (signature === this.signature) return;
        this.signature = signature;
        this.sorted = sorted;
        if (this.page >= this.pageCount()) this.page = 0;
        this.render();
        this.restartTimer();
    }

    private pageCount(): number {
        return Math.max(1, Math.ceil(this.sorted.length / PER_PAGE));
    }

    private restartTimer() {
        this.timer?.remove();
        this.timer = null;
        if (this.pageCount() <= 1) return;
        this.timer = this.scene.time.addEvent({ delay: BOARD.PAGE_MS, loop: true, callback: () => this.turnPage() });
    }

    private fadeTargets(): GameObjects.GameObject[] {
        return this.rows.flatMap(r => [r.dot, r.label, r.numbers]);
    }

    private turnPage() {
        this.scene.tweens.add({
            targets: this.fadeTargets(),
            alpha: 0,
            duration: 220,
            onComplete: () => {
                this.page = (this.page + 1) % this.pageCount();
                this.render();
                this.scene.tweens.add({ targets: this.fadeTargets(), alpha: 1, duration: 220 });
            },
        });
    }

    private render() {
        const start = this.page * PER_PAGE;
        this.rows.forEach((row, slot) => {
            const manager = this.sorted[start + slot];
            row.dot.setVisible(!!manager);
            row.label.setVisible(!!manager);
            row.numbers.setVisible(!!manager);
            if (!manager) return;

            const rank = start + slot + 1;
            const slug = RosterConfig.heroSlugForRop(manager.rop);
            const color = slug ? RosterConfig.heroDef(slug)?.color : undefined;
            row.dot.setFillStyle(color ? Display.Color.HexStringToColor(color).color : 0x888888);
            row.label.setText(`${rank}. ${shortName(manager.name)}`).setColor(rank <= 3 ? '#ffe89a' : '#f1ecdc');
            row.numbers.setText(manager.day > 0 ? `${manager.period}  (+${manager.day})` : String(manager.period));
        });
        const pages = this.pageCount();
        this.pageText.setText(pages > 1 ? `стр. ${this.page + 1}/${pages}` : '');
    }
}
