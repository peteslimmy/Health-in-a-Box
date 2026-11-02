import { BadRequestException } from '@nestjs/common';

export function parseDate(value: string, field = 'date'): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException({
      code: 'INVALID_DATE',
      message: `${field} must be an ISO date (YYYY-MM-DD)`,
      details: [{ field, code: 'INVALID_DATE', message: 'Expected YYYY-MM-DD' }],
    });
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException({
      code: 'INVALID_DATE',
      message: `${field} is not a valid date`,
      details: [{ field, code: 'INVALID_DATE', message: 'Invalid calendar date' }],
    });
  }
  return date;
}

export function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function startOfUtcDay(value = new Date()): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function monthKey(value: Date): string {
  return value.toISOString().slice(0, 7);
}

/**
 * The calendar date (YYYY-MM-DD) that an instant falls on in the given IANA time zone.
 * Financial dates follow the centre's business day (D-016, default Africa/Lagos), not UTC.
 */
export function dateInTimeZone(instant: Date, timeZone: string): string {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    throw new BadRequestException({
      code: 'INVALID_TIMEZONE',
      message: `"${timeZone}" is not a valid time zone`,
    });
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
