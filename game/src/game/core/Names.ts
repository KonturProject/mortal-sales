/** "1,20" — average invoices per employee, the way Russian sheets write it. */
export function fmtAverage(value: number): string {
    return value.toFixed(2).replace('.', ',');
}

/**
 * "Иванова Мария Сергеевна" -> "Иванова М.С." — what the screen shows. The full names stay in the admin and the
 * sheet; on a wall display the short form is both readable and a little less exposing.
 * A name that does not split into surname + given name is returned as it is.
 */
export function shortName(full: string): string {
    const parts = full.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return full.trim();
    const [surname, given, ...rest] = parts;
    const initials = [given, ...(rest.length > 0 ? [rest[0]] : [])].map(p => `${p[0].toUpperCase()}.`).join('');
    return `${surname} ${initials}`;
}
