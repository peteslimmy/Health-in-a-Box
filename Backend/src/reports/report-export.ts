import * as XLSX from 'xlsx';
import { ReportColumn, ReportRow } from './report-types';

export type ExportMeta = {
  title: string;
  generatedAt: string;
  generatedBy: string;
  filters: string;
  notes: string[];
};

/** Cells that a spreadsheet would treat as a formula are prefixed so they stay plain text. */
export function neutraliseFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

const BOM = String.fromCharCode(0xfeff);

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function textOf(value: string | number | null, column: ReportColumn): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // Only free text can carry a formula; numbers and money legitimately start with "-".
  return column.type === 'text' ? neutraliseFormula(text) : text;
}

/** UTF-8 with a byte-order mark so Excel opens naira and accented names correctly. */
export function toCsv(
  columns: ReportColumn[],
  rows: ReportRow[],
  totals: ReportRow | null,
  meta: ExportMeta,
): Buffer {
  const lines: string[] = [];
  lines.push(csvCell(neutraliseFormula(meta.title)));
  lines.push(csvCell(`Generated ${meta.generatedAt} by ${neutraliseFormula(meta.generatedBy)}`));
  if (meta.filters) lines.push(csvCell(`Filters: ${neutraliseFormula(meta.filters)}`));
  for (const note of meta.notes) lines.push(csvCell(neutraliseFormula(note)));
  lines.push('');
  lines.push(columns.map((column) => csvCell(neutraliseFormula(column.label))).join(','));
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(textOf(row[column.key] ?? null, column))).join(','));
  }
  if (totals) {
    lines.push(
      columns.map((column) => csvCell(textOf(totals[column.key] ?? null, column))).join(','),
    );
  }
  return Buffer.from(BOM + `${lines.join('\r\n')}\r\n`, 'utf8');
}

/** Money beyond Excel's 15 significant digits stays text rather than losing precision. */
function cellFor(value: string | number | null, column: ReportColumn): XLSX.CellObject {
  if (value === null || value === undefined || value === '') return { t: 's', v: '' };
  if (column.type === 'money' || column.type === 'percent') {
    const text = String(value);
    if (text.replace(/[-.]/g, '').length > 15) return { t: 's', v: text };
    return { t: 'n', v: Number(text), z: column.type === 'money' ? '#,##0.00' : '0.0' };
  }
  if (column.type === 'int') return { t: 'n', v: Number(value), z: '0' };
  return { t: 's', v: textOf(value, column) };
}

export function toXlsx(
  columns: ReportColumn[],
  rows: ReportRow[],
  totals: ReportRow | null,
  meta: ExportMeta,
): Buffer {
  const header: XLSX.CellObject[][] = [
    [{ t: 's', v: neutraliseFormula(meta.title) }],
    [{ t: 's', v: `Generated ${meta.generatedAt} by ${neutraliseFormula(meta.generatedBy)}` }],
    ...(meta.filters
      ? [[{ t: 's', v: `Filters: ${neutraliseFormula(meta.filters)}` } as XLSX.CellObject]]
      : []),
    ...meta.notes.map((note) => [{ t: 's', v: neutraliseFormula(note) } as XLSX.CellObject]),
    [],
    columns.map((column) => ({ t: 's', v: neutraliseFormula(column.label) }) as XLSX.CellObject),
  ];
  const body = rows.map((row) => columns.map((column) => cellFor(row[column.key] ?? null, column)));
  if (totals) body.push(columns.map((column) => cellFor(totals[column.key] ?? null, column)));
  const sheet = XLSX.utils.aoa_to_sheet([...header, ...body] as unknown as unknown[][]);
  sheet['!cols'] = columns.map((column) => ({
    wch: Math.max(12, Math.min(40, column.label.length + 4)),
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Report');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
