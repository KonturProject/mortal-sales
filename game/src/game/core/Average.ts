/** Pure helpers shared by the game, the debug hooks and the tests (no Phaser, no DOM). */

/** Average invoices per employee that counts as a good result until the backend says otherwise. */
export const DEFAULT_TARGET_AVG = 1.2;

/** Average invoices per employee; a group with nobody on the roster counts as one person (never divide by zero). */
export function average(sum: number, staff: number): number {
    return sum / Math.max(1, staff);
}
