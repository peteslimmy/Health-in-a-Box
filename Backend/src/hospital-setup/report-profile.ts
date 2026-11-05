import { Decimal } from 'decimal.js';
import { moneyString } from '../common/utils/money';
import type { PdfReportData } from '../imports/pdf-report-reader';
import {
  DEPARTMENT_HEADERS,
  FOOTER_LABELS,
  IGNORED_HEADERS,
  RevenueParserService,
  TOTAL_HEADERS,
  cellText,
  normalize,
} from '../imports/revenue-parser.service';

export type ProfiledDepartment = {
  rowNumber: number;
  /** The name exactly as printed, with spacing tidied. Future reports are matched against it. */
  printedName: string;
  name: string;
  code: string;
  total: string;
};

export type ProfiledChannel = {
  printedHeading: string;
  name: string;
  code: string;
  total: string;
  /** False when every department shows zero for this channel in the report. */
  hasActivity: boolean;
};

export type ReportProfile = {
  source: {
    fileName: string;
    kind: 'PDF' | 'CSV' | 'XLSX';
    title: string | null;
    /** Where the report was produced, when it printed the time: `YYYY-MM-DDTHH:mm` (local). */
    printedAt: string | null;
    printDate: string | null;
    period: { start: string; end: string } | null;
    pages: number | null;
    setAsideLines: string[];
  };
  hospital: {
    suggestedName: string;
    suggestedCode: string;
    /** A hospital number or code printed on the report itself, if one was found. */
    printedNumber: string | null;
  };
  departments: ProfiledDepartment[];
  channels: ProfiledChannel[];
  grandTotal: string;
  tally: { ok: boolean; problems: Array<{ row?: number; message: string }> };
  notes: string[];
};

const STOP_WORDS = new Set(['OF', 'THE', 'AND', 'FOR', '&', 'AT', 'IN']);

/** `ACCIDENT  AND EMERGENCY UNIT` -> single spaces, nothing else changed. */
export const tidySpaces = (value: string) => value.replace(/\s+/g, ' ').trim();

export function titleCase(value: string): string {
  return tidySpaces(value)
    .toLowerCase()
    .replace(
      /(^|[\s(\-/&])([a-z])/g,
      (_m, lead: string, letter: string) => lead + letter.toUpperCase(),
    )
    .replace(/\b(Of|And|The|For|In|At)\b(?!\s*$)/g, (word, _w, offset: number) =>
      offset === 0 ? word : word.toLowerCase(),
    );
}

/** `Mobile Money` -> `MOBILE_MONEY`; always 2 to 26 characters of A-Z, 0-9 and underscore. */
export function codeFromName(name: string, taken: Set<string>): string {
  const base =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 26) || 'ITEM';
  let code = base.length < 2 ? `${base}_` : base;
  for (let n = 2; taken.has(code); n += 1) code = `${base.slice(0, 24)}_${n}`;
  taken.add(code);
  return code;
}

/** `UNIVERSITY OF ABUJA TEACHING HOSPITAL, GWAGWALADA` -> `UATH`. */
export function codeFromHospitalName(name: string): string {
  const first = name.split(',')[0];
  const letters = first
    .toUpperCase()
    .split(/[^A-Z0-9&]+/)
    .filter((word) => word && !STOP_WORDS.has(word))
    .map((word) => word[0])
    .join('');
  const code = letters.replace(/[^A-Z0-9]/g, '').slice(0, 12);
  return code.length >= 2 ? code : codeFromName(name, new Set()).slice(0, 12);
}

const NUMBER_PATTERNS = [
  /\b(?:hospital|center|facility|hospital|clinic|branch|site)\s*(?:no\.?|number|code|id)\s*[:.#-]?\s*([A-Z0-9][A-Z0-9/-]{1,19})\b/i,
  /\b(?:no\.?|number|code|id)\s*[:.#-]\s*([A-Z0-9][A-Z0-9/-]{1,19})\b/i,
];

/** Looks for a hospital number printed in the report's heading block (never in the table). */
export function findPrintedNumber(lines: string[]): string | null {
  for (const line of lines) {
    for (const pattern of NUMBER_PATTERNS) {
      const match = pattern.exec(line);
      if (match) return match[1].toUpperCase();
    }
  }
  return null;
}

/** Title shown by the report minus trailing branding such as "DAILY COLLECTION REPORT". */
function suggestName(title: string | null, fileName: string): string {
  const raw = title
    ? tidySpaces(title)
    : tidySpaces(fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' '));
  const lettersOnly = raw.replace(/[^A-Za-z]/g, '');
  // A report title is usually printed in capitals; show it in readable capitalisation.
  const isShouting = lettersOnly.length > 0 && lettersOnly === lettersOnly.toUpperCase();
  return (isShouting ? titleCase(raw) : raw).slice(0, 120);
}

/**
 * Reads what a revenue report says about the hospital it belongs to: its name, number, period,
 * when it was printed, and the departments and payment channels it lists. Nothing is saved here.
 */
export function profileReport(input: {
  fileName: string;
  kind: 'PDF' | 'CSV' | 'XLSX';
  rows: unknown[][];
  pdf: PdfReportData | null;
}): ReportProfile {
  const { rows: rawRows, pdf } = input;
  const rows = rawRows.filter((row) => row.some((cell) => cellText(cell) !== ''));
  const notes: string[] = [];
  const header = (rows[0] ?? []).map((cell) => cellText(cell));
  const columns = header.map(normalize);
  const departmentIndex = columns.findIndex((c) => DEPARTMENT_HEADERS.has(c));

  const channelColumns: Array<{ index: number; heading: string }> = [];
  let totalSeen = false;
  columns.forEach((column, index) => {
    if (index === departmentIndex || column === '' || IGNORED_HEADERS.has(column)) return;
    if (TOTAL_HEADERS.has(column) && !totalSeen) {
      totalSeen = true;
      return;
    }
    channelColumns.push({ index, heading: tidySpaces(header[index]) });
  });

  const takenDepartments = new Set<string>();
  const takenChannels = new Set<string>();
  const seenNames = new Set<string>();
  const departments: ProfiledDepartment[] = [];
  const channelTotals = channelColumns.map(() => new Decimal(0));
  const totalIndex = columns.findIndex((c) => TOTAL_HEADERS.has(c));
  let grand = new Decimal(0);
  let footerGrand: Decimal | null = null;

  if (departmentIndex !== -1) {
    for (let r = 1; r < rows.length; r += 1) {
      const row = rows[r];
      const printedName = tidySpaces(cellText(row[departmentIndex]));
      if (!printedName) continue;
      const key = normalize(printedName);
      const amount = (index: number) => {
        const value = cellText(row[index]).replace(/[,\s₦]/g, '');
        try {
          return value === '' ? new Decimal(0) : new Decimal(value);
        } catch {
          return new Decimal(0);
        }
      };
      if (FOOTER_LABELS.has(key)) {
        if (totalIndex !== -1) footerGrand = amount(totalIndex);
        continue;
      }
      if (seenNames.has(key)) {
        notes.push(
          `"${printedName}" appears more than once in the report; only the first is listed.`,
        );
        continue;
      }
      seenNames.add(key);
      channelColumns.forEach((column, i) => {
        channelTotals[i] = channelTotals[i].plus(amount(column.index));
      });
      const rowTotal =
        totalIndex !== -1
          ? amount(totalIndex)
          : channelColumns.reduce((sum, column) => sum.plus(amount(column.index)), new Decimal(0));
      grand = grand.plus(rowTotal);
      const name = printedName;
      departments.push({
        rowNumber: r + 1,
        printedName,
        name,
        code: codeFromName(name, takenDepartments),
        total: moneyString(rowTotal),
      });
    }
  }

  const channels: ProfiledChannel[] = channelColumns.map((column, i) => ({
    printedHeading: column.heading,
    name: column.heading,
    code: codeFromName(column.heading, takenChannels),
    total: moneyString(channelTotals[i]),
    hasActivity: !channelTotals[i].isZero(),
  }));

  // Reuse the importer's own tally rules by checking the file against what it itself lists.
  const tally = { ok: true, problems: [] as Array<{ row?: number; message: string }> };
  if (departmentIndex === -1) {
    tally.ok = false;
    tally.problems.push({
      message:
        'No "Revenue Department" column was found, so departments cannot be read from this file.',
    });
  } else {
    const check = new RevenueParserService().parseRows(
      rawRows,
      departments.map((d) => ({
        id: d.code,
        code: d.code,
        name: d.printedName,
        aliases: [],
      })) as never,
      channels.map((c) => ({
        id: c.code,
        code: c.code,
        name: c.printedHeading,
        aliases: [],
      })) as never,
    );
    for (const issue of check.errors) {
      tally.problems.push({ row: issue.row, message: issue.message });
    }
    tally.ok = check.errors.length === 0;
  }
  if (
    footerGrand !== null &&
    !footerGrand.minus(grand).abs().lte(0.01) &&
    tally.problems.length === 0
  ) {
    tally.ok = false;
    tally.problems.push({
      message: `The printed grand total ${moneyString(footerGrand)} differs from the sum of the departments ${moneyString(grand)}.`,
    });
  }
  if (departments.length === 0 && departmentIndex !== -1) {
    notes.push('The table has a department column but no department rows.');
  }

  const title = pdf?.title ?? null;
  const headingLines = [title ?? '', ...(pdf?.ignoredLines ?? [])].filter(Boolean);
  const suggestedName = suggestName(title, input.fileName);
  const printedNumber = findPrintedNumber(headingLines);

  return {
    source: {
      fileName: input.fileName,
      kind: input.kind,
      title,
      printedAt: pdf?.printedAt ?? null,
      printDate: pdf?.printDate ?? null,
      period: pdf?.period ?? null,
      pages: pdf?.pages ?? null,
      setAsideLines: pdf?.ignoredLines ?? [],
    },
    hospital: {
      suggestedName,
      suggestedCode: printedNumber ?? codeFromHospitalName(suggestedName),
      printedNumber,
    },
    departments,
    channels,
    grandTotal: moneyString(footerGrand ?? grand),
    tally,
    notes,
  };
}
