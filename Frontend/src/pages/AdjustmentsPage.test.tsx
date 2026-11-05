import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSessionUser, renderWithProviders } from '../test/utils';
import type { AdjustmentItem } from '../lib/types';
import { AdjustmentsPage } from './AdjustmentsPage';

const hoisted = vi.hoisted(() => ({ api: vi.fn(), permissions: [] as string[] }));
vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  api: hoisted.api,
}));
vi.mock('../auth/AuthContext', () => ({
  useUser: () => makeSessionUser({ id: 'me', permissions: hoisted.permissions }),
  useAuth: () => ({ status: 'signedIn' }),
}));

const item = (overrides: Partial<AdjustmentItem> = {}): AdjustmentItem => ({
  id: 'a1',
  type: 'CREDIT',
  amount: '250.00',
  reasonCode: 'BILLING_ERROR',
  reason: 'Billed on the wrong base',
  status: 'PENDING',
  createdAt: '2026-10-20T10:00:00.000Z',
  decidedAt: null,
  decisionNote: null,
  hospital: { id: 'c1', code: 'C1', name: 'One' },
  receivable: { id: 'r1', reference: 'RCV-1', balance: '1000.00' },
  createdBy: { id: 'someone-else', fullName: 'Pat Officer' },
  decidedBy: null,
  ...overrides,
});

function open(permissions: string[], items: AdjustmentItem[]) {
  hoisted.permissions = permissions;
  hoisted.api.mockImplementation(async () => ({ items, meta: { page: 1, pageSize: 20, total: items.length, totalPages: 1 } }));
  renderWithProviders(<AdjustmentsPage />, { path: '/adjustments', route: '/adjustments' });
}

describe('adjustments screen', () => {
  beforeEach(() => {
    hoisted.api.mockReset();
  });

  it('offers approve and reject only on someone else’s pending proposal', async () => {
    open(['adjustments.read', 'adjustments.approve'], [item()]);
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });

  it('tells the proposer they must wait, and gives them no approve button', async () => {
    open(['adjustments.read', 'adjustments.approve'], [item({ createdBy: { id: 'me', fullName: 'Me' } })]);
    expect(await screen.findByText('Waiting for another approver')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('gives a user without approval permission no decision buttons', async () => {
    open(['adjustments.read'], [item()]);
    await screen.findByText('RCV-1');
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Propose adjustment' })).toBeNull();
  });

  it('requires a written reason before a rejection can be sent', async () => {
    open(['adjustments.read', 'adjustments.approve'], [item()]);
    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('button', { name: 'Reject' })).toBeDisabled();
    await userEvent.type(dialog.getByLabelText(/Why is it rejected/), 'Amount does not match the report');
    expect(dialog.getByRole('button', { name: 'Reject' })).toBeEnabled();
  });

  it('shows credits and debits distinctly, with the reason category in words', async () => {
    open(['adjustments.read'], [item(), item({ id: 'a2', type: 'DEBIT', reasonCode: 'LATE_CHARGE' })]);
    expect(await screen.findByText('Billing error')).toBeInTheDocument();
    expect(screen.getByText('Late charge')).toBeInTheDocument();
    expect(screen.getByText('Credit')).toBeInTheDocument();
    expect(screen.getByText('Debit')).toBeInTheDocument();
  });
});
