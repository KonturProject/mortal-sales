import { Scene, Types } from 'phaser';

/** Resolves after `ms` of *scene* time (so hit-stop and time scaling stretch it, and a shut-down scene simply never wakes it). */
export function sleep(scene: Scene, ms: number): Promise<void> {
    return new Promise<void>(resolve => {
        if (ms <= 0) resolve();
        else scene.time.delayedCall(ms, () => resolve());
    });
}

/**
 * Resolves after `ms` of wall-clock time. For waits that must line up with sound: the scene clock can leap ahead when
 * the power saver lifts the frame-rate limit (the first frames after idle), and a recorded voice runs on real time.
 */
export function wallSleep(ms: number): Promise<void> {
    return new Promise<void>(resolve => window.setTimeout(resolve, Math.max(0, ms)));
}

/**
 * A tween as a promise, for readable choreography (`await fighter.walkTo(...)`).
 * A tween that gets killed (`killTweensOf`) never calls onComplete, which would leave the awaiting
 * sequence hanging forever — hence the fallback timer that resolves shortly after the tween should have ended.
 */
export function tweenTo(scene: Scene, config: Types.Tweens.TweenBuilderConfig): Promise<void> {
    return new Promise<void>(resolve => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            resolve();
        };
        const userComplete = config.onComplete;
        scene.tweens.add({
            ...config,
            onComplete: (tween, targets, ...params) => {
                userComplete?.(tween, targets, ...params);
                finish();
            },
        });
        const total = Number(config.duration ?? 0) + Number(config.delay ?? 0);
        scene.time.delayedCall(total + 250, finish);
    });
}

/** Freezes the whole picture for `ms` of real time — the beat that makes a heavy blow feel heavy. */
export function hitStop(scene: Scene, ms: number) {
    const slow = 0.05;
    scene.tweens.timeScale = slow;
    scene.time.timeScale = slow;
    window.setTimeout(() => {
        scene.tweens.timeScale = 1;
        scene.time.timeScale = 1;
    }, ms);
}
