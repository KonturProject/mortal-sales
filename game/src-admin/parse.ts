/**
 * Turns what the admin drops into the page (an .xlsx, a CSV/TSV, or text pasted from a spreadsheet) into the
 * lists the backend takes. Pure functions on rows of cells — no DOM, no network — so they run under plain
 * node in tests (game/tests/admin-parse.test.mjs) against the real files.
 */

export type Cell = string | number | boolean | Date | null | undefined;
export type Table = Cell[][];

const text = (cell: Cell): string => (cell === null || cell === undefined ? '' : String(cell)).replace(/\s+/g, ' ').trim();

const isNumeric = (cell: Cell): boolean =>
    typeof cell === 'number' || (typeof cell === 'string' && /^\d+(?:[.,]\d+)?$/.test(cell.trim()));

/* ------------------------------------------------------------------ text -> table */

/** Pasted text or a CSV/TSV file as rows of cells: tabs, else semicolons, else "name 5" with a trailing number. */
export function parseTextTable(source: string): Table {
    const table: Table = [];
    for (const raw of source.replace(/\r/g, '').split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        if (line.includes('\t')) table.push(line.split('\t'));
        else if (line.includes(';')) table.push(line.split(';'));
        else {
            const m = line.match(/^(.*?\S)\s+(\d+(?:[.,]\d+)?)$/);
            table.push(m ? [m[1], m[2]] : [line]);
        }
    }
    return table;
}

/* ------------------------------------------------------------------ the day's counts */

export interface CountRow {
    name: string;
    count: number;
}

export interface ParsedCounts {
    rows: CountRow[];
    /** Lines with something in them that did not look like "name, number" (a header, a note, a total...). */
    ignored: string[];
}

/** "ФИО | счета": per row the first text cell is the name, the first number after it the count. Headers and notes are ignored, and reported. */
export function parseCounts(table: Table): ParsedCounts {
    const rows: CountRow[] = [];
    const ignored: string[] = [];
    for (const row of table) {
        let name = '';
        let count = Number.NaN;
        for (const cell of row) {
            const value = text(cell);
            if (!value) continue;
            if (!name) {
                if (!isNumeric(cell)) name = value;
            } else if (Number.isNaN(count) && isNumeric(cell)) {
                count = Number(value.replace(',', '.'));
                break;
            }
        }
        if (name && Number.isFinite(count)) rows.push({ name, count });
        else if (row.some(c => text(c) !== '')) ignored.push(row.map(text).filter(Boolean).join(' | '));
    }
    return { rows, ignored };
}

/* ------------------------------------------------------------------ the roster ("who is in which department") */

export interface RosterEntry {
    name: string;
    dept: string;
}

export interface ParsedRoster {
    entries: RosterEntry[];
    /** Department code -> the heading it had in the file ("КЦПК_НП_СР_Тверь_СР1_ГБ"). */
    deptTitles: Record<string, string>;
    /** Names that stood above the first department heading — nowhere to put them. */
    unassigned: string[];
}

/** "КЦПК_НП_СР_Тверь_СР1_ГБ" -> "СР1". Latin look-alikes (CP) are accepted: such files are typed on any keyboard. */
export function deptCodeIn(source: string): string | null {
    const m = source.match(/(?:^|[^\p{L}\d])[СCсc][РPрp]\s*(\d{1,2})(?!\d)/u);
    return m ? `СР${m[1]}` : null;
}

/** A heading names a department: it holds a code and is one word ("..._СР1_ГБ") rather than a person's name. */
function isHeading(value: string): boolean {
    return deptCodeIn(value) !== null && (!/\s/.test(value) || value.includes('_'));
}

/**
 * Two layouts: headings in one column with the managers beneath each ("КЦПК_НП_СР_Тверь_СР1_ГБ", then names...), or a
 * second column holding each manager's department code.
 */
export function parseRoster(table: Table): ParsedRoster {
    const entries: RosterEntry[] = [];
    const deptTitles: Record<string, string> = {};
    const unassigned: string[] = [];
    let current: string | null = null;

    for (const row of table) {
        const cells = row.map(text).filter(Boolean);
        if (cells.length === 0) continue;
        const name = cells[0];

        if (cells.length >= 2 && cells[1].length <= 8 && deptCodeIn(cells[1])) {
            entries.push({ name, dept: deptCodeIn(cells[1]) as string });
        } else if (isHeading(name)) {
            current = deptCodeIn(name);
            if (current) deptTitles[current] = name;
        } else if (current) {
            entries.push({ name, dept: current });
        } else {
            unassigned.push(name);
        }
    }
    return { entries, deptTitles, unassigned };
}

/** Names match regardless of case, "ё"/"е" and runs of spaces — like the backend does. */
export function normName(name: string): string {
    return name.normalize('NFC').replace(/ё/g, 'е').replace(/Ё/g, 'Е').replace(/\s+/g, ' ').trim().toLowerCase();
}
