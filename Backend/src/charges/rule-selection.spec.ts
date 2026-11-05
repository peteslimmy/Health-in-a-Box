import { D } from '../testing/fixtures';
import {
  SelectableRule,
  buildRuleLookup,
  hasChannelRule,
  hasStraddlingRule,
  partitionRulesForPeriod,
  pickRule,
  ruleCoversPeriod,
} from './rule-selection';

const rule = (
  id: string,
  from: string,
  to: string | null,
  departmentId: string | null = null,
  paymentChannelId: string | null = null,
  priority = 0,
): SelectableRule => ({
  id,
  departmentId,
  paymentChannelId,
  effectiveFrom: D(from),
  effectiveTo: to ? D(to) : null,
  priority,
});

describe('rule selection', () => {
  describe('INV-012: effective-date boundaries (both ends inclusive)', () => {
    const r = rule('r', '2026-02-01', '2026-02-28');

    it('is not usable the day before it starts, and is usable on its first day', () => {
      expect(ruleCoversPeriod(r, D('2026-01-31'), D('2026-01-31'))).toBe(false);
      expect(ruleCoversPeriod(r, D('2026-02-01'), D('2026-02-01'))).toBe(true);
    });

    it('is usable on its last day and not the day after', () => {
      expect(ruleCoversPeriod(r, D('2026-02-28'), D('2026-02-28'))).toBe(true);
      expect(ruleCoversPeriod(r, D('2026-03-01'), D('2026-03-01'))).toBe(false);
    });

    it('treats an open-ended rule as covering any later period', () => {
      expect(
        ruleCoversPeriod(rule('o', '2026-01-01', null), D('2030-01-01'), D('2030-12-31')),
      ).toBe(true);
    });
  });

  describe('INV-005: a rate change inside a report period is never silently resolved', () => {
    const before = rule('old', '2026-01-01', '2026-01-31');
    const after = rule('new', '2026-02-01', null);

    it('classifies each rule as covering or straddling the period', () => {
      const wholeJan = partitionRulesForPeriod([before, after], D('2026-01-01'), D('2026-01-31'));
      expect(wholeJan.covering.map((x) => x.id)).toEqual(['old']);
      expect(wholeJan.straddling).toHaveLength(0);

      const across = partitionRulesForPeriod([before, after], D('2026-01-15'), D('2026-02-15'));
      expect(across.covering).toHaveLength(0);
      expect(across.straddling.map((x) => x.id).sort()).toEqual(['new', 'old']);
    });

    it('reports when a straddling rule would have applied to the department', () => {
      expect(hasStraddlingRule([before], 'dept-1', null)).toBe(true);
      expect(
        hasStraddlingRule([rule('x', '2026-01-01', '2026-01-31', 'other')], 'dept-1', null),
      ).toBe(false);
    });
  });

  describe('precedence: dept+channel > dept > channel > hospital default (D-002)', () => {
    const def = rule('default', '2026-01-01', null);
    const channel = rule('channel', '2026-01-01', null, null, 'ch1');
    const dept = rule('dept', '2026-01-01', null, 'd1');
    const both = rule('both', '2026-01-01', null, 'd1', 'ch1');

    it('prefers the most specific rule', () => {
      const lookup = buildRuleLookup([def, channel, dept, both]);
      expect(pickRule(lookup, 'd1', 'ch1')?.id).toBe('both');
      expect(pickRule(lookup, 'd1', 'ch2')?.id).toBe('dept');
      expect(pickRule(lookup, 'd2', 'ch1')?.id).toBe('channel');
      expect(pickRule(lookup, 'd2', 'ch2')?.id).toBe('default');
      expect(pickRule(lookup, 'd1', null)?.id).toBe('dept');
    });

    it('returns nothing (never zero) when no rule applies', () => {
      expect(pickRule(buildRuleLookup([dept]), 'd2', null)).toBeUndefined();
    });

    it('detects a channel-specific rule', () => {
      const lookup = buildRuleLookup([channel]);
      expect(hasChannelRule(lookup, 'd1', 'ch1')).toBe(true);
      expect(hasChannelRule(lookup, 'd1', 'ch2')).toBe(false);
      expect(hasChannelRule(lookup, 'd1', null)).toBe(false);
    });

    it('breaks ties at equal specificity by priority, then latest start', () => {
      const lowPriority = rule('low', '2026-01-01', null, 'd1', null, 1);
      const highPriority = rule('high', '2026-01-01', null, 'd1', null, 5);
      expect(pickRule(buildRuleLookup([lowPriority, highPriority]), 'd1', null)?.id).toBe('high');
    });
  });
});
