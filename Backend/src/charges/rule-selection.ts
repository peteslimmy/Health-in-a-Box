/**
 * Pure rule-selection helpers for the service-charge engine.
 *
 * Decisions implemented (D-002 / D-003 / FR-REV-004):
 *  - precedence: department+channel > department > channel > centre default;
 *  - a rule is only usable for a report when it is effective for the report's WHOLE period.
 *    A report that straddles a rate change must be split by period rather than silently
 *    charged at one of the two rates, and the caller cannot pick a rate with an "as-of" date.
 */
export type SelectableRule = {
  id: string;
  departmentId: string | null;
  paymentChannelId: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  priority: number;
};

export type RuleLookup<R extends SelectableRule> = Map<string, R[]>;

const day = (value: Date) => value.getTime();

/** Both boundaries inclusive: effectiveFrom <= start and (open-ended or effectiveTo >= end). */
export function ruleCoversPeriod(rule: SelectableRule, start: Date, end: Date): boolean {
  return (
    day(rule.effectiveFrom) <= day(start) &&
    (rule.effectiveTo === null || day(rule.effectiveTo) >= day(end))
  );
}

export function ruleOverlapsPeriod(rule: SelectableRule, start: Date, end: Date): boolean {
  return (
    day(rule.effectiveFrom) <= day(end) &&
    (rule.effectiveTo === null || day(rule.effectiveTo) >= day(start))
  );
}

export function partitionRulesForPeriod<R extends SelectableRule>(
  rules: R[],
  start: Date,
  end: Date,
): { covering: R[]; straddling: R[] } {
  const covering: R[] = [];
  const straddling: R[] = [];
  for (const rule of rules) {
    if (ruleCoversPeriod(rule, start, end)) covering.push(rule);
    else if (ruleOverlapsPeriod(rule, start, end)) straddling.push(rule);
  }
  return { covering, straddling };
}

export function buildRuleLookup<R extends SelectableRule>(rules: R[]): RuleLookup<R> {
  const lookup: RuleLookup<R> = new Map();
  const ordered = [...rules].sort(
    (a, b) => b.priority - a.priority || day(b.effectiveFrom) - day(a.effectiveFrom),
  );
  for (const rule of ordered) {
    const key = `${rule.departmentId ?? '*'}|${rule.paymentChannelId ?? '*'}`;
    const existing = lookup.get(key) ?? [];
    existing.push(rule);
    lookup.set(key, existing);
  }
  return lookup;
}

export function hasChannelRule<R extends SelectableRule>(
  lookup: RuleLookup<R>,
  departmentId: string,
  channelId?: string | null,
): boolean {
  if (!channelId) return false;
  return (
    (lookup.get(`${departmentId}|${channelId}`)?.length ?? 0) > 0 ||
    (lookup.get(`*|${channelId}`)?.length ?? 0) > 0
  );
}

export function pickRule<R extends SelectableRule>(
  lookup: RuleLookup<R>,
  departmentId: string,
  channelId: string | null,
): R | undefined {
  const keys = channelId
    ? [`${departmentId}|${channelId}`, `${departmentId}|*`, `*|${channelId}`, '*|*']
    : [`${departmentId}|*`, '*|*'];
  for (const key of keys) {
    const rule = lookup.get(key)?.[0];
    if (rule) return rule;
  }
  return undefined;
}

/** True when a straddling rule would have applied to this department/channel. */
export function hasStraddlingRule<R extends SelectableRule>(
  straddling: R[],
  departmentId: string,
  channelId: string | null,
): boolean {
  return straddling.some(
    (rule) =>
      (rule.departmentId === null || rule.departmentId === departmentId) &&
      (rule.paymentChannelId === null || rule.paymentChannelId === channelId),
  );
}
