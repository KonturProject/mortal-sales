import { parseTextTable, type Table } from './parse';

/** An .xlsx (read in the browser — nothing is uploaded anywhere but the final, checked import) or a CSV/TSV/text file as rows of cells. */
export async function readTableFile(file: File): Promise<Table> {
    const name = file.name.toLowerCase();
    if (name.endsWith('.xlsx')) {
        const { readSheet } = await import('read-excel-file/universal');
        return (await readSheet(file)) as Table;
    }
    if (name.endsWith('.xls')) throw new Error('Старый формат .xls не читается: сохраните файл как .xlsx (или .csv) и загрузите снова.');
    return parseTextTable(await file.text());
}
