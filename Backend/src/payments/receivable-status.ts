import { ReceivableStatus } from '@prisma/client';
import { Decimal } from 'decimal.js';

/**
 * Settlement status of a receivable from its amounts. A receivable is PAID only when its balance
 * is zero (never because a receipt was merely recorded). A dispute flag is kept until the item
 * is fully settled.
 */
export function receivableStatusFor(
  originalAmount: Decimal.Value,
  amountPaid: Decimal.Value,
  current: ReceivableStatus,
): ReceivableStatus {
  const balance = new Decimal(originalAmount).minus(amountPaid);
  if (balance.lte(0)) return 'PAID';
  if (current === 'DISPUTED') return 'DISPUTED';
  return new Decimal(amountPaid).gt(0) ? 'PARTIALLY_PAID' : 'OPEN';
}
