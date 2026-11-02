import { addDays, dateInTimeZone, parseDate } from './dates';

describe('dates', () => {
  describe('dateInTimeZone (D-016)', () => {
    it('returns the Lagos calendar day, one hour ahead of UTC', () => {
      expect(dateInTimeZone(new Date('2026-10-27T23:30:00Z'), 'Africa/Lagos')).toBe('2026-10-28');
      expect(dateInTimeZone(new Date('2026-10-27T22:59:59Z'), 'Africa/Lagos')).toBe('2026-10-27');
      expect(dateInTimeZone(new Date('2026-10-27T23:00:00Z'), 'Africa/Lagos')).toBe('2026-10-28');
    });

    it('matches UTC for the UTC zone and handles zones behind UTC', () => {
      expect(dateInTimeZone(new Date('2026-10-27T23:30:00Z'), 'UTC')).toBe('2026-10-27');
      expect(dateInTimeZone(new Date('2026-10-27T03:00:00Z'), 'America/New_York')).toBe(
        '2026-10-26',
      );
    });

    it('rejects an invalid time zone instead of guessing', () => {
      expect(() => dateInTimeZone(new Date(), 'Not/AZone')).toThrow();
    });
  });

  describe('parseDate / addDays', () => {
    it('only accepts real ISO calendar dates', () => {
      expect(parseDate('2026-02-28').toISOString()).toBe('2026-02-28T00:00:00.000Z');
      expect(() => parseDate('28/02/2026')).toThrow();
      expect(() => parseDate('2026-13-45')).toThrow();
    });

    it('adds calendar days across month boundaries', () => {
      expect(addDays(parseDate('2026-10-28'), 30).toISOString().slice(0, 10)).toBe('2026-11-27');
      expect(addDays(parseDate('2026-12-31'), 1).toISOString().slice(0, 10)).toBe('2027-01-01');
    });
  });
});
