// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (
  data: Buffer,
  options?: Record<string, unknown>,
) => Promise<{ numpages: number }>;

/** One piece of text with its position on the page (origin bottom-left, as PDFs define it). */
export type TextItem = { str: string; x: number; y: number; width?: number };

export type PdfReportData = {
  /** Header row, one entry per printed column, followed by the data rows and the grand-total row. */
  rows: string[][];
  title: string | null;
  printDate: string | null;
  period: { start: string; end: string } | null;
  /** When the report was produced at the source, local time, as `YYYY-MM-DDTHH:mm` (null when no time is printed). */
  printedAt: string | null;
  pages: number;
  /** Text that was read but is not financial data (titles, page furniture, signature lines). */
  ignoredLines: string[];
};

export const MAX_PDF_PAGES = 50;
const PARSE_TIMEOUT_MS = 20_000;
/** Heading words separated by less than this belong to the same column ("Mobile Money"). */
const HEADING_JOIN_GAP = 6;
/** How far a value may start to the left of its column heading and still belong to it. */
const COLUMN_TOLERANCE = 8;
const LINE_TOLERANCE = 3;

const AMOUNT = /^\(?-?[\d,]+(\.\d+)?\)?$/;

function dmyToIso(day: string, month: string, year: string): string | null {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

type Line = { y: number; items: TextItem[] };

function toLines(items: TextItem[]): Line[] {
  const sorted = items.filter((item) => item.str.trim() !== '').sort((a, b) => b.y - a.y);
  const lines: Line[] = [];
  for (const item of sorted) {
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= LINE_TOLERANCE);
    if (line) line.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => b.y - a.y);
}

const lineText = (line: Line) =>
  line.items
    .map((item) => item.str.trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

type Column = { x: number; heading: string };

/** Groups the heading words into columns by their horizontal gaps. */
function columnsFromHeading(line: Line): Column[] {
  const columns: Column[] = [];
  let previous: TextItem | null = null;
  for (const item of line.items) {
    const text = item.str.trim();
    if (
      previous &&
      item.x - (previous.x + (previous.width ?? previous.str.length * 6)) < HEADING_JOIN_GAP
    ) {
      const last = columns[columns.length - 1];
      last.heading += /[/-]$/.test(last.heading) ? text : ` ${text}`;
    } else {
      columns.push({ x: item.x, heading: text });
    }
    previous = item;
  }
  return columns;
}

const isHeading = (line: Line) =>
  /revenue\s+department|^s\/?\s*n\b.*department/i.test(lineText(line));

function columnIndex(columns: Column[], x: number): number {
  let index = 0;
  columns.forEach((column, i) => {
    if (x + COLUMN_TOLERANCE >= column.x) index = i;
  });
  return index;
}

/**
 * Turns positioned PDF text into the table the importer understands. Only the table is kept:
 * the title block, repeated page headings, page furniture and signature lines are set aside and
 * reported, never treated as financial data. Reading stops at the Grand Total row.
 */
export function layoutToTable(pages: TextItem[][]): PdfReportData {
  const ignored: string[] = [];
  let title: string | null = null;
  let printDate: string | null = null;
  let printedAt: string | null = null;
  let period: PdfReportData['period'] = null;
  let columns: Column[] | null = null;
  const body: string[][] = [];
  let finished = false;

  for (const pageItems of pages) {
    for (const line of toLines(pageItems)) {
      const text = lineText(line);
      if (finished) {
        ignored.push(text);
        continue;
      }
      if (!columns) {
        if (isHeading(line)) {
          columns = columnsFromHeading(line);
          continue;
        }
        const between =
          /between\s*:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*and\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(
            text,
          );
        if (between) {
          const start = dmyToIso(between[1], between[2], between[3]);
          const end = dmyToIso(between[4], between[5], between[6]);
          if (start && end) period = { start, end };
        }
        const print = /print\s*date\s*:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(text);
        if (print) {
          printDate = dmyToIso(print[1], print[2], print[3]);
          const time =
            /print\s*date\s*:?\s*\d{1,2}\/\d{1,2}\/\d{4}\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]m)?/i.exec(
              text,
            );
          if (printDate && time) {
            let hour = Number(time[1]);
            const meridiem = time[3]?.toLowerCase();
            if (meridiem === 'pm' && hour < 12) hour += 12;
            if (meridiem === 'am' && hour === 12) hour = 0;
            if (hour <= 23 && Number(time[2]) <= 59) {
              printedAt = `${printDate}T${String(hour).padStart(2, '0')}:${time[2]}`;
            }
          }
        }
        // The first line above the table that is not a date line is the report's own title.
        if (!between && !print && title === null && !/^daily collection report$/i.test(text))
          title = text;
        else ignored.push(text);
        continue;
      }
      if (isHeading(line)) continue; // the heading repeats on every page

      const cells: string[] = columns.map(() => '');
      for (const item of line.items) {
        const index = columnIndex(columns, item.x);
        cells[index] = `${cells[index]} ${item.str.trim()}`.trim();
      }
      const first = cells[0];
      const isRow = /^\d+$/.test(first);
      const name = cells[1] ?? '';
      const hasAmounts = cells.slice(2).some((cell) => AMOUNT.test(cell));

      if (/^(grand\s+)?total\b/i.test(`${first} ${name}`.trim()) && hasAmounts) {
        body.push(['', 'Grand Total', ...cells.slice(2)]);
        finished = true;
      } else if (isRow) {
        body.push(cells);
      } else if (!hasAmounts && first === '' && name !== '' && body.length > 0) {
        // A department name that wrapped onto a second line.
        const last = body[body.length - 1];
        last[1] = `${last[1]} ${name}`.trim();
      } else {
        ignored.push(text);
      }
    }
  }

  const header = columns ? columns.map((column) => column.heading) : [];
  return {
    rows: columns ? [header, ...body] : [],
    title,
    printDate,
    period,
    printedAt,
    pages: pages.length,
    ignoredLines: ignored.slice(0, 50),
  };
}

/** Reads a PDF report into table rows. Throws a plain Error with a user-safe message on failure. */
export async function readPdfReport(buffer: Buffer): Promise<PdfReportData> {
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('The file is not a valid PDF document');
  }
  const pages: TextItem[][] = [];
  const work = pdfParse(buffer, {
    max: MAX_PDF_PAGES + 1,
    pagerender: async (page: {
      getTextContent: () => Promise<{
        items: Array<{ str: string; transform: number[]; width?: number }>;
      }>;
    }) => {
      const content = await page.getTextContent();
      pages.push(
        content.items.map((i) => ({
          str: i.str,
          x: i.transform[4],
          y: i.transform[5],
          width: i.width,
        })),
      );
      return '';
    },
  });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('The PDF took too long to read')), PARSE_TIMEOUT_MS);
  });
  try {
    const info = await Promise.race([work, timeout]);
    if (info.numpages > MAX_PDF_PAGES) {
      throw new Error(`The PDF has more than ${MAX_PDF_PAGES} pages`);
    }
  } catch (error) {
    const message = (error as Error).message ?? '';
    if (/password|encrypt/i.test(message))
      throw new Error('Password-protected PDFs are not accepted');
    if (/^The PDF/.test(message)) throw error;
    throw new Error('The PDF could not be read; export it again from the source system');
  } finally {
    if (timer) clearTimeout(timer);
  }
  const data = layoutToTable(pages);
  if (data.rows.length === 0) {
    throw new Error(
      'No revenue table was found in the PDF (a "Revenue Department" heading row is required); scanned images are not supported',
    );
  }
  return data;
}
