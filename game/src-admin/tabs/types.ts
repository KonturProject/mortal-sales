import type { AdminState } from '../api';

/** What every tab gets from the page: the latest state, and the way to talk to the backend. */
export interface Ctx {
    readonly state: AdminState;
    /** Raw backend call; throws BackendError (the PIN is added by the page). */
    call<T extends object = Record<string, never>>(action: string, payload?: Record<string, unknown>): Promise<T>;
    /** Re-reads everything and re-renders the tabs. */
    refresh(): Promise<void>;
    setStatus(text: string, kind?: 'ok' | 'error' | ''): void;
    /** Runs `fn` with the button disabled; a backend error becomes the page's status message instead of an exception. */
    guard(button: HTMLButtonElement | null, fn: () => Promise<void>): Promise<void>;
    report(err: unknown): void;
}

export interface Tab {
    id: string;
    title: string;
    element: HTMLElement;
    /** Redraw from `ctx.state`. */
    render(): void;
}
