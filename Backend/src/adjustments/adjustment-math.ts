import { Decimal } from 'decimal.js';

export const ADJUSTMENT_REASONS = [
  'BILLING_ERROR',
  'REVENUE_CORRECTION',
  'AGREED_DISCOUNT',
  'WRITE_OFF',
  'LATE_CHARGE',
  'DISPUTE_UPHELD',
  'OTHER',
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

type Amounts = {
  originalAmount: Decimal.Value;
  adjustmentTotal: Decimal.Value;
  amountPaid: Decimal.Value;
};

/** What the hospital owes for the item before any payment: the charge plus net adjustments. */
export function totalDue(receivable: Pick<Amounts, 'originalAmount' | 'adjustmentTotal'>): Decimal {
  return new Decimal(receivable.originalAmount).plus(receivable.adjustmentTotal);
}

export type AdjustmentOutcome =
  | { ok: true; adjustmentTotal: Decimal; balance: Decimal }
  | { ok: false; code: 'ADJUSTMENT_EXCEEDS_BALANCE'; balance: Decimal };

/**
 * The receivable after a credit (reduces what is owed) or debit (increases it). A credit can never
 * take the amount owed below what has already been paid: a refund is a different event.
 */
export function applyAdjustment(
  receivable: Amounts,
  type: 'CREDIT' | 'DEBIT',
  amount: Decimal.Value,
): AdjustmentOutcome {
  const current = totalDue(receivable).minus(receivable.amountPaid);
  const value = new Decimal(amount);
  if (type === 'CREDIT' && value.gt(current)) {
    return { ok: false, code: 'ADJUSTMENT_EXCEEDS_BALANCE', balance: current };
  }
  const delta = type === 'CREDIT' ? value.negated() : value;
  return {
    ok: true,
    adjustmentTotal: new Decimal(receivable.adjustmentTotal).plus(delta),
    balance: current.plus(delta),
  };
}
