import { Scene, Display, Loader, Textures } from 'phaser';
import { RosterConfig } from '../systems/RosterConfig';
import { GAME } from '../core/Constants';
import { fitCameraToGame } from '../core/Render';

/** Character and background textures (everything except generated text canvases). */
const SMOOTH_TEXTURE_KEY = /^(hero_|bg_)/;

/**
 * Loads the real cropped sprites from public/assets/sprites/. Any file that
 * doesn't exist yet fails to load — on that specific loaderror we generate a
 * colored-shape placeholder texture under the same key, so the scene is always
 * fully playable regardless of which real assets have landed. Real PNGs simply
 * take priority once present; no code change needed when they're dropped in.
 *
 * Pose textures beyond the standing one (attack poses, hurt/stun/knockdown/… art from the
 * animation drop folder, left-facing variants) are optional variety: a missing one gets no
 * placeholder and the fighter falls back to a plain tween (see objects/Fighter.ts).
 */
export class Preloader extends Scene {
    constructor() {
        super('Preloader');
    }

    preload() {
        this.drawLoadingScreen();

        this.load.on('loaderror', (file: Loader.File) => this.onLoadError(file.key));

        this.load.setPath('assets/sprites');
        // The arena background is optional until the real one is built (tools/build-sprites.py --only bg);
        // ArenaScene falls back to the placeholder cave.
        this.load.image('bg_arena', 'bg_arena.jpg');
        this.load.image('bg_cave', 'bg_cave.jpg');
        for (const hero of RosterConfig.heroes) {
            for (const key of RosterConfig.textureKeys(hero.slug)) this.load.image(key, `${key}.png`);
        }
    }

    create() {
        // The sprite art is painted and resampled, not true pixel art. `pixelArt: true` would sample it
        // with NEAREST, which at a non-integer render scale (1.25×, 1.5× — see core/Quality.ts) leaves
        // jagged, uneven edges; smooth filtering looks the same at 1:1 and better everywhere else.
        for (const key of this.textures.getTextureKeys()) {
            if (SMOOTH_TEXTURE_KEY.test(key)) this.textures.get(key).setFilter(Textures.FilterMode.LINEAR);
        }

        this.scene.start('ArenaScene');
        this.scene.launch('HUDScene');
    }

    /** Flat Graphics/Text splash + progress bar — same no-asset-needed approach as onLoadError's placeholders. */
    private drawLoadingScreen() {
        const w = GAME.WIDTH;
        const h = GAME.HEIGHT;
        const barW = 320;
        const barH = 18;
        const barX = w / 2 - barW / 2;
        const barY = h / 2 + 20;

        fitCameraToGame(this);
        this.cameras.main.setBackgroundColor('#08090f');

        const title = this.add.text(w / 2, h / 2 - 30, 'MORTAL SALES', {
            fontFamily: 'Impact, "Arial Black", Arial, sans-serif',
            fontSize: '48px',
            color: '#ffd23a',
            resolution: GAME.RENDER_SCALE,
        }).setOrigin(0.5).setStroke('#6b1200', 8);

        const track = this.add.graphics();
        track.fillStyle(0x0d1220, 0.9);
        track.fillRoundedRect(barX, barY, barW, barH, barH / 2);
        track.lineStyle(2, 0x3a5a7a, 0.9);
        track.strokeRoundedRect(barX, barY, barW, barH, barH / 2);

        const bar = this.add.graphics();

        this.load.on('progress', (value: number) => {
            bar.clear();
            const innerW = Math.max(0, (barW - 6) * value);
            if (innerW <= 1) return;
            bar.fillGradientStyle(0xff8a3c, 0xff8a3c, 0xffd23a, 0xffd23a, 1);
            bar.fillRoundedRect(barX + 3, barY + 3, innerW, barH - 6, (barH - 6) / 2);
        });

        this.load.on('complete', () => {
            title.destroy();
            track.destroy();
            bar.destroy();
        });
    }

    private onLoadError(key: string) {
        if (this.textures.exists(key)) return; // real file already loaded fine elsewhere

        // Only the standing pose of a hero and the placeholder cave are required.
        const def = RosterConfig.heroes.find(h => h.sprite === key);
        if (!def && key !== 'bg_cave') return;

        const g = this.make.graphics({ x: 0, y: 0 });

        if (key === 'bg_cave') {
            g.fillGradientStyle(0x08090f, 0x08090f, 0x2a1830, 0x2a1830, 1);
            g.fillRect(0, 0, GAME.WIDTH, GAME.HEIGHT);
            g.generateTexture('bg_cave', GAME.WIDTH, GAME.HEIGHT);
        } else if (def) {
            const color = Display.Color.HexStringToColor(def.color).color;
            g.fillStyle(color, 1);
            g.fillCircle(60, 60, 55);
            g.lineStyle(4, 0xffffff, 1);
            g.strokeCircle(60, 60, 55);
            g.generateTexture(key, 120, 120);
        }

        g.destroy();
    }
}
