import { GAME } from './Constants';

/**
 * Every `add.text` style needs `resolution: GAME.RENDER_SCALE`, or the text is rasterised at 1× and comes out
 * blurry on the bigger canvas buffer. This is the one place that remembers it.
 */
export function hudText(size: number, color = '#ffffff', family = 'Arial Black, Arial, sans-serif') {
    return { fontFamily: family, fontSize: `${size}px`, resolution: GAME.RENDER_SCALE, color };
}
