/**
 * Display formatting only. Amounts arrive from the API as decimal strings and are formatted by
 * string manipulation, never converted to floating-point numbers, so no precision is lost.
 * All authoritative arithmetic is done by the backend.
 */
export function formatMoney(value: string | number | null | undefined, currency = 'NGN'): string {
  if (value === null || value === undefined || value === '') return '—';
  const text = String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return text;
  const [, sign, whole, fraction = ''] = match;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const cents = (fraction + '00').slice(0, 2);
  const symbol = currency === 'NGN' ? '₦' : `${currency} `;
  return `${sign}${symbol}${grouped}.${cents}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-09-30" or "2026-09-30T00:00:00.000Z" -> "30 Sep 2026" (no time-zone shifting). */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  return `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Today's calendar date in the Lagos business time zone, as YYYY-MM-DD. */
export function todayIso(timeZone = 'Africa/Lagos'): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function firstOfMonthIso(timeZone = 'Africa/Lagos'): string {
  return `${todayIso(timeZone).slice(0, 7)}-01`;
}

/** A hospital as people say it: the name first, then its code, e.g. "University of Abuja Teaching Hospital (UATH)". */
export function hospitalLabel(hospital: { name: string; code: string }): string {
  return `${hospital.name} (${hospital.code})`;
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** True for a positive amount with at most two decimals, e.g. "1250.50". */
export function isValidAmount(value: string): boolean {
  return /^\d{1,16}(\.\d{1,2})?$/.test(value.trim()) && Number(value) > 0;
}

/** Adds two non-negative decimal strings in integer minor units (no floating point). */
export function addMoney(a: string, b: string): string {
  return minorToString(toMinor(a) + toMinor(b));
}

export function subtractMoney(a: string, b: string): string {
  return minorToString(toMinor(a) - toMinor(b));
}

export function compareMoney(a: string, b: string): number {
  const x = toMinor(a);
  const y = toMinor(b);
  return x === y ? 0 : x < y ? -1 : 1;
}

function toMinor(value: string): bigint {
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(value.trim());
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) return 0n;
  const minor = BigInt(`${match[2] || '0'}${((match[3] ?? '') + '00').slice(0, 2)}`);
  return match[1] === '-' ? -minor : minor;
}

function minorToString(minor: bigint): string {
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
