import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';

/** Hard limits applied to untrusted uploads before and during parsing. */
export const MAX_ROWS = 20_000;
export const MAX_COLUMNS = 100;
export const MAX_SHEETS = 20;

/** Reads a CSV or XLSX file into rows (header row first). Throws a plain Error with a user-safe message. */
export function readRows(buffer: Buffer, filename: string): unknown[][] {
  let records: unknown[][];
  if (filename.toLowerCase().endsWith('.csv')) {
    records = parse(buffer, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      to_line: MAX_ROWS + 2,
    }) as unknown[][];
  } else {
    const workbook = XLSX.read(buffer, {
      type: 'buffer',
      cellDates: false,
      cellFormula: false,
      cellHTML: false,
      bookVBA: false,
      sheetRows: MAX_ROWS + 2,
    });
    if (workbook.SheetNames.length > MAX_SHEETS) {
      throw new Error(`The workbook has more than ${MAX_SHEETS} sheets`);
    }
    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) return [];
    records = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[firstSheet], {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    });
  }
  if (records.length > MAX_ROWS + 1) {
    throw new Error(`The file has more than ${MAX_ROWS} rows`);
  }
  if (records.some((row) => row.length > MAX_COLUMNS)) {
    throw new Error(`The file has more than ${MAX_COLUMNS} columns`);
  }
  return records;
}
