import { Injectable } from '@nestjs/common';
import { Department, PaymentChannel } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { money, moneyString } from '../common/utils/money';
import { readRows } from './table-reader';

export type ParsedLine = {
  rowNumber: number;
  rawDepartment: string;
  departmentId: string;
  departmentCode: string;
  reportedTotal: string;
  channelTotal: string;
  variance: string;
  amounts: Record<string, string>;
};

export type ParseIssue = {
  row?: number;
  field?: string;
  code: string;
  message: string;
};

export type ParseResult = {
  lines: ParsedLine[];
  errors: ParseIssue[];
  warnings: ParseIssue[];
  channelColumns: Array<{ header: string; code: string; name: string }>;
  ignoredColumns: string[];
  grandTotal: string;
  channelTotal: string;
  rows: Array<Record<string, unknown>>;
  /** Names in the file that the centre does not have yet (so they can be added after review). */
  unmatched: { departments: string[]; channels: string[] };
};

type LoadedDepartment = Department & { aliases: Array<{ alias: string }> };
type LoadedChannel = PaymentChannel & { aliases: Array<{ alias: string }> };

export const IGNORED_HEADERS = new Set(['s n', 'sn', 'no', 'number', '#']);
export const DEPARTMENT_HEADERS = new Set([
  'department',
  'revenue department',
  'dept',
  'department name',
]);
export const TOTAL_HEADERS = new Set(['total', 'total amount', 'grand total', 'amount']);
export const FOOTER_LABELS = new Set([
  'grand total',
  'grandtotal',
  'total',
  'totals',
  'total amount',
]);

export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return '';
}

/** Largest tolerated difference between a reported row/grand total and the computed sum. */
export const TOTAL_TOLERANCE = new Decimal('0.01');

export function parseAmount(raw: string): Decimal | null {
  const cleaned = raw
    .replace(/\s/g, '')
    .replace(/[\u20A6$\u20AC\u00A3]/g, '')
    .replace(/^NGN/i, '')
    .replace(/,/g, '')
    .replace(/^\((.*)\)$/, '-$1');
  if (cleaned === '') return new Decimal(0);
  try {
    const value = new Decimal(cleaned);
    if (!value.isFinite() || value.decimalPlaces() > 2) return null;
    return value;
  } catch {
    return null;
  }
}

@Injectable()
export class RevenueParserService {
  parse(
    buffer: Buffer,
    filename: string,
    departments: LoadedDepartment[],
    channels: LoadedChannel[],
  ): ParseResult {
    return this.parseRows(readRows(buffer, filename), departments, channels);
  }

  /** Validates an already-extracted table (header row first). Used for CSV, XLSX and PDF alike. */
  parseRows(
    rawRows: unknown[][],
    departments: LoadedDepartment[],
    channels: LoadedChannel[],
  ): ParseResult {
    const errors: ParseIssue[] = [];
    const warnings: ParseIssue[] = [];
    const rows = rawRows.filter((row) => row.some((cell) => cellText(cell) !== ''));
    if (rows.length === 0) {
      return {
        lines: [],
        errors: [{ code: 'EMPTY_FILE', message: 'The file contains no rows' }],
        warnings,
        channelColumns: [],
        ignoredColumns: [],
        grandTotal: '0.00',
        channelTotal: '0.00',
        rows: [],
        unmatched: { departments: [], channels: [] },
      };
    }

    const headerRow = rows[0].map((cell) => cellText(cell));
    const columns = headerRow.map((header) => normalize(header));
    const departmentIndex = columns.findIndex((column) => DEPARTMENT_HEADERS.has(column));
    if (departmentIndex === -1) {
      return {
        lines: [],
        errors: [
          {
            code: 'MISSING_DEPARTMENT_COLUMN',
            field: 'department',
            message: 'A department column is required (e.g. "Revenue Department")',
          },
        ],
        warnings,
        channelColumns: [],
        ignoredColumns: [],
        grandTotal: '0.00',
        channelTotal: '0.00',
        rows: [],
        unmatched: { departments: [], channels: [] },
      };
    }

    const channelLookup = new Map<string, LoadedChannel>();
    for (const channel of channels) {
      for (const key of [channel.code, channel.name, ...channel.aliases.map((a) => a.alias)]) {
        channelLookup.set(normalize(key), channel);
      }
    }

    const departmentLookup = new Map<string, LoadedDepartment>();
    for (const department of departments) {
      for (const key of [
        department.code,
        department.name,
        ...department.aliases.map((a) => a.alias),
      ]) {
        departmentLookup.set(normalize(key), department);
      }
    }

    const channelColumns: Array<{ header: string; code: string; name: string; index: number }> = [];
    const totalIndexes = new Set<number>();
    const unknownIndexes: number[] = [];
    const ignoredColumns: string[] = [];
    const seenChannels = new Set<string>();

    columns.forEach((column, index) => {
      if (index === departmentIndex) return;
      if (column === '') {
        ignoredColumns.push(headerRow[index] || `column ${index + 1}`);
        return;
      }
      if (IGNORED_HEADERS.has(column)) {
        ignoredColumns.push(headerRow[index]);
        return;
      }
      if (TOTAL_HEADERS.has(column) && !seenChannels.has('__total__')) {
        seenChannels.add('__total__');
        totalIndexes.add(index);
        return;
      }
      const channel = channelLookup.get(column);
      if (!channel) {
        unknownIndexes.push(index);
        return;
      }
      if (seenChannels.has(channel.id)) {
        errors.push({
          field: headerRow[index],
          code: 'DUPLICATE_CHANNEL_COLUMN',
          message: `Channel "${channel.code}" appears more than once`,
        });
        return;
      }
      seenChannels.add(channel.id);
      channelColumns.push({
        header: headerRow[index],
        code: channel.code,
        name: channel.name,
        index,
      });
    });

    if (channelColumns.length === 0) {
      errors.push({
        code: 'NO_CHANNEL_COLUMNS',
        message: 'No recognized payment-channel columns were found',
      });
    }

    const ignoredUnknown = new Set<number>();
    const lines: ParsedLine[] = [];
    const seenDepartments = new Set<string>();
    let footerTotal: Decimal | null = null;
    let computedGrand = new Decimal(0);
    let computedChannels = new Decimal(0);
    const storedRows: Array<Record<string, unknown>> = [];
    // Tally controls work on every printed row, whether or not its department is set up yet.
    const serialIndex = columns.findIndex((column) => IGNORED_HEADERS.has(column));
    const serials: Array<{ row: number; serial: number }> = [];
    let printedRowTotals = new Decimal(0);
    const columnSums = new Map<string, Decimal>();
    let footerCells: Record<string, Decimal> | null = null;
    let footerRowNumber = 0;
    const unmatchedDepartments = new Set<string>();

    for (let r = 1; r < rows.length; r += 1) {
      const row = rows[r];
      const rowNumber = r + 1;
      const rawDepartment = cellText(row[departmentIndex]);
      if (rawDepartment === '') continue;
      const departmentKey = normalize(rawDepartment);

      let channelDecimal = new Decimal(0);
      const amounts: Record<string, string> = {};
      const rowAmounts: Record<string, Decimal> = {};
      let rowInvalid = false;
      for (const column of channelColumns) {
        const raw = cellText(row[column.index]);
        if (raw !== '') ignoredUnknown.delete(column.index);
        const amount = parseAmount(raw);
        if (amount === null) {
          errors.push({
            row: rowNumber,
            field: column.header,
            code: 'INVALID_AMOUNT',
            message: `"${raw}" is not a valid amount`,
          });
          rowInvalid = true;
          continue;
        }
        if (amount.lt(0)) {
          errors.push({
            row: rowNumber,
            field: column.header,
            code: 'NEGATIVE_AMOUNT',
            message: 'Negative amounts are not allowed',
          });
          rowInvalid = true;
        }
        channelDecimal = channelDecimal.plus(amount);
        amounts[column.code] = moneyString(amount);
        rowAmounts[column.code] = amount;
      }

      const totalRaw = totalIndexes.size > 0 ? cellText(row[[...totalIndexes][0]]) : '';
      const totalValue = totalRaw === '' ? channelDecimal : parseAmount(totalRaw);
      if (totalValue === null) {
        errors.push({
          row: rowNumber,
          field: 'total',
          code: 'INVALID_AMOUNT',
          message: `"${totalRaw}" is not a valid total amount`,
        });
        rowInvalid = true;
      }
      if (totalValue && totalValue.lt(0)) {
        errors.push({
          row: rowNumber,
          field: 'total',
          code: 'NEGATIVE_AMOUNT',
          message: 'Negative totals are not allowed',
        });
        rowInvalid = true;
      }

      if (FOOTER_LABELS.has(departmentKey)) {
        if (lines.length === 0) {
          errors.push({
            row: rowNumber,
            code: 'MISSING_DEPARTMENT_ROWS',
            message: 'A total row was found before any department rows',
          });
        } else if (footerTotal !== null) {
          warnings.push({
            row: rowNumber,
            code: 'DUPLICATE_TOTAL_ROW',
            message: 'An additional total row was ignored',
          });
        } else {
          footerTotal = totalValue ?? channelDecimal;
          footerCells = rowAmounts;
          footerRowNumber = rowNumber;
        }
        continue;
      }

      if (!rowInvalid) {
        printedRowTotals = printedRowTotals.plus(totalValue ?? channelDecimal);
        for (const [code, amount] of Object.entries(rowAmounts)) {
          columnSums.set(code, (columnSums.get(code) ?? new Decimal(0)).plus(amount));
        }
      }
      if (serialIndex !== -1) {
        const serial = Number(cellText(row[serialIndex]));
        if (Number.isInteger(serial)) serials.push({ row: rowNumber, serial });
      }

      const department = departmentLookup.get(departmentKey);
      if (!department) {
        unmatchedDepartments.add(rawDepartment.replace(/\s+/g, ' ').trim());
        errors.push({
          row: rowNumber,
          field: 'department',
          code: 'UNKNOWN_DEPARTMENT',
          message: `Department "${rawDepartment}" is not configured for this centre`,
        });
        continue;
      }
      if (seenDepartments.has(department.id)) {
        errors.push({
          row: rowNumber,
          field: 'department',
          code: 'DUPLICATE_DEPARTMENT',
          message: `Department "${department.name}" appears more than once`,
        });
        continue;
      }
      seenDepartments.add(department.id);

      const normalizedTotal = money(channelDecimal);
      if (totalValue && !rowInvalid) {
        const variance = money(totalValue.minus(normalizedTotal));
        if (variance.abs().gt(TOTAL_TOLERANCE)) {
          // INV-001: a row whose reported total disagrees with its channel sum cannot be
          // committed; it must be corrected at source, never auto-balanced.
          errors.push({
            row: rowNumber,
            field: 'total',
            code: 'ROW_TOTAL_MISMATCH',
            message: `${department.name}: reported total ${money(totalValue).toFixed(
              2,
            )} differs from the channel sum ${normalizedTotal.toFixed(2)} by ${variance.toFixed(2)}`,
          });
        } else if (!variance.isZero()) {
          warnings.push({
            row: rowNumber,
            code: 'ROW_VARIANCE',
            message: `${department.name} total differs from the channel sum by ${variance.toFixed(2)} (within tolerance)`,
          });
        }
      }

      const reported = totalValue ?? normalizedTotal;
      computedGrand = computedGrand.plus(reported);
      computedChannels = computedChannels.plus(normalizedTotal);
      lines.push({
        rowNumber,
        rawDepartment,
        departmentId: department.id,
        departmentCode: department.code,
        reportedTotal: moneyString(reported),
        channelTotal: moneyString(normalizedTotal),
        variance: moneyString(reported.minus(normalizedTotal)),
        amounts,
      });
      storedRows.push(
        Object.fromEntries(
          headerRow.map((header, index) => [header || `column_${index + 1}`, row[index] ?? null]),
        ),
      );
    }

    const unmatchedChannels: string[] = [];
    for (const index of unknownIndexes) {
      if (rows.slice(1).some((row) => cellText(row[index]) !== '')) {
        unmatchedChannels.push(headerRow[index]);
        errors.push({
          field: headerRow[index] || `column ${index + 1}`,
          code: 'UNKNOWN_CHANNEL_COLUMN',
          message: `Column "${headerRow[index]}" does not match a configured payment channel`,
        });
      } else {
        ignoredUnknown.add(index);
        ignoredColumns.push(headerRow[index]);
      }
    }

    if (lines.length === 0 && errors.length === 0) {
      errors.push({ code: 'NO_DATA_ROWS', message: 'No department rows were found' });
    }

    // Serial numbers must run 1, 2, 3 ... with no gap or repeat: a jump means a printed row is missing.
    if (serials.length > 0) {
      let expected = serials[0].serial;
      if (serials[0].serial !== 1) {
        errors.push({
          row: serials[0].row,
          code: 'SERIAL_GAP',
          message: `The first row is numbered ${serials[0].serial}, not 1; earlier rows may be missing`,
        });
      }
      for (const { row, serial } of serials) {
        if (serial !== expected) {
          errors.push({
            row,
            code: 'SERIAL_GAP',
            message:
              serial > expected
                ? `Row numbers jump from ${expected - 1} to ${serial}; a row may be missing`
                : `Row number ${serial} appears more than once or out of order`,
          });
          expected = serial;
        }
        expected += 1;
      }
    }

    if (footerTotal !== null && !errors.some((e) => e.code === 'MISSING_DEPARTMENT_ROWS')) {
      // Down-footing: the printed grand total must equal the sum of the printed department totals.
      const difference = footerTotal.minus(printedRowTotals);
      if (difference.abs().gt(TOTAL_TOLERANCE)) {
        errors.push({
          row: footerRowNumber,
          code: 'GRAND_TOTAL_MISMATCH',
          message: `Printed grand total ${footerTotal.toFixed(2)} differs from the sum of the department totals ${printedRowTotals.toFixed(2)} by ${difference.toFixed(2)}`,
        });
      }
      if (footerCells) {
        // Column totals: each channel's printed total must equal the sum of its department figures.
        for (const column of channelColumns) {
          const printed = footerCells[column.code];
          if (printed === undefined) continue;
          const summed = columnSums.get(column.code) ?? new Decimal(0);
          const gap = printed.minus(summed);
          if (gap.abs().gt(TOTAL_TOLERANCE)) {
            errors.push({
              row: footerRowNumber,
              field: column.header,
              code: 'COLUMN_TOTAL_MISMATCH',
              message: `${column.header}: printed total ${printed.toFixed(2)} differs from the sum of the rows ${summed.toFixed(2)} by ${gap.toFixed(2)}`,
            });
          }
        }
        // Cross-footing: the printed channel totals must add up to the printed grand total.
        const printedChannelSum = Object.values(footerCells).reduce(
          (total, value) => total.plus(value),
          new Decimal(0),
        );
        const crossGap = footerTotal.minus(printedChannelSum);
        if (crossGap.abs().gt(TOTAL_TOLERANCE)) {
          errors.push({
            row: footerRowNumber,
            code: 'CROSS_FOOTING_MISMATCH',
            message: `The printed channel totals add up to ${printedChannelSum.toFixed(2)} but the printed grand total is ${footerTotal.toFixed(2)} (difference ${crossGap.toFixed(2)})`,
          });
        }
      }
      computedGrand = footerTotal;
    } else if (footerTotal === null && lines.length > 0) {
      warnings.push({
        code: 'NO_TOTAL_ROW',
        message: 'The file has no grand-total row, so the figures could not be cross-checked',
      });
    }

    return {
      lines,
      errors,
      warnings,
      channelColumns: channelColumns.map(({ header, code, name }) => ({ header, code, name })),
      ignoredColumns: [...new Set(ignoredColumns)],
      grandTotal: moneyString(computedGrand),
      channelTotal: moneyString(computedChannels),
      rows: storedRows.slice(0, 2000),
      unmatched: { departments: [...unmatchedDepartments], channels: unmatchedChannels },
    };
  }
}
