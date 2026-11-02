import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSessionUser, renderWithProviders } from '../test/utils';
import type { PaymentDetail } from '../lib/types';
import { PaymentDetailPage } from './PaymentDetailPage';

const hoisted = vi.hoisted(() => ({ user: null as unknown, api: vi.fn() }));

vi.mock('../auth/AuthContext', () => ({ useUser: () => hoisted.user, useAuth: () => ({ user: hoisted.user }) }));
vi.mock('../lib/api', async (original) => ({ ...(await original<typeof import('../lib/api')>()), api: hoisted.api }));

const payment = (overrides: Partial<PaymentDetail> = {}): PaymentDetail => ({
  id: 'pay-1',
  status: 'SUBMITTED',
  receiptDate: '2026-10-01T00:00:00.000Z',
  amount: '1000.00',
  unallocatedAmount: '1000.00',
  method: 'BANK_TRANSFER',
  reference: 'REF-1',
  payerName: null,
  notes: null,
  rejectionReason: null,
  reversalReason: null,
  createdById: 'maker',
  centre: { id: 'centre-1', code: 'HNB-1', name: 'Test Centre' },
  createdBy: { id: 'maker', fullName: 'Maker' },
  allocations: [],
  ...overrides,
});

const open = (p: PaymentDetail, permissions: string[], userId = 'checker') => {
  hoisted.user = makeSessionUser({ id: userId, permissions });
  hoisted.api.mockImplementation(async (path: string) => {
    if (path === '/payments/pay-1') return p;
    if (path === '/payments/pay-1/allocation-preview') {
      return {
        payment: { id: 'pay-1', amount: '1000.00', unallocatedAmount: p.unallocatedAmount },
        receivables: [
          { id: 'r1', reference: 'RCV-OLD', description: '', dueDate: '2026-08-31T00:00:00.000Z', balance: '600.00', status: 'OPEN' },
          { id: 'r2', reference: 'RCV-NEW', description: '', dueDate: '2026-09-30T00:00:00.000Z', balance: '900.00', status: 'OPEN' },
        ],
        suggestion: [{ receivableId: 'r1', amount: '600.00' }, { receivableId: 'r2', amount: '400.00' }],
      };
    }
    return {};
  });
  return renderWithProviders(<PaymentDetailPage />, { path: '/payments/:id', route: '/payments/pay-1' });
};

describe('payment detail: who can do what', () => {
  beforeEach(() => hoisted.api.mockReset());

  it('lets a different approver approve or reject a submitted receipt', async () => {
    open(payment(), ['payments.read', 'payments.approve']);
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });

  it('never offers approval to the person who recorded the receipt, and says why', async () => {
    open(payment(), ['payments.read', 'payments.approve', 'payments.create'], 'maker');
    expect(await screen.findByText('You recorded this receipt')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('hides approval from users without the permission', async () => {
    open(payment(), ['payments.read']);
    await screen.findByText(/Receipt REF-1/);
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('offers submit only to the recorder of a draft', async () => {
    open(payment({ status: 'DRAFT' }), ['payments.read', 'payments.create'], 'maker');
    expect(await screen.findByRole('button', { name: 'Submit for approval' })).toBeInTheDocument();
  });

  it('offers posting only to someone other than the recorder', async () => {
    open(payment({ status: 'APPROVED' }), ['payments.read', 'payments.post']);
    expect(await screen.findByRole('button', { name: 'Post as received' })).toBeInTheDocument();
  });

  it('offers allocation only for posted receipts with cash left', async () => {
    open(payment({ status: 'POSTED' }), ['payments.read', 'payments.allocate']);
    expect(await screen.findByRole('button', { name: 'Allocate to receivables' })).toBeInTheDocument();
  });

  it('does not offer allocation when everything is already allocated', async () => {
    open(payment({ status: 'POSTED', unallocatedAmount: '0.00' }), ['payments.read', 'payments.allocate']);
    await screen.findByText(/Receipt REF-1/);
    expect(screen.queryByRole('button', { name: 'Allocate to receivables' })).not.toBeInTheDocument();
  });

  it('only allows reversing an allocation made by somebody else', async () => {
    const allocation = (id: string, by: string) => ({ id, amount: '100.00', allocatedAt: '2026-10-02T00:00:00.000Z', allocatedById: by, reversedAt: null, reversalReason: null, receivable: { id: 'r1', reference: `RCV-${id}`, dueDate: '2026-09-30T00:00:00.000Z', balance: '0.00' } });
    open(payment({ status: 'POSTED', unallocatedAmount: '800.00', allocations: [allocation('mine', 'checker'), allocation('theirs', 'other')] }), ['payments.read', 'payments.reverse']);
    await screen.findByText('RCV-mine');
    const rows = screen.getAllByRole('row');
    const mine = rows.find((row) => within(row).queryByText('RCV-mine'))!;
    const theirs = rows.find((row) => within(row).queryByText('RCV-theirs'))!;
    expect(within(mine).queryByRole('button', { name: 'Reverse' })).not.toBeInTheDocument();
    expect(within(theirs).getByRole('button', { name: 'Reverse' })).toBeInTheDocument();
  });
});

describe('allocation dialog', () => {
  beforeEach(() => hoisted.api.mockReset());

  async function openDialog() {
    open(payment({ status: 'POSTED' }), ['payments.read', 'payments.allocate']);
    await userEvent.click(await screen.findByRole('button', { name: 'Allocate to receivables' }));
    await screen.findByLabelText('Amount to allocate to RCV-OLD');
  }

  it('pre-fills the oldest-first suggestion and shows what remains', async () => {
    await openDialog();
    expect(screen.getByLabelText('Amount to allocate to RCV-OLD')).toHaveValue('600.00');
    expect(screen.getByLabelText('Amount to allocate to RCV-NEW')).toHaveValue('400.00');
    expect(screen.getByText(/Left unallocated: ₦0\.00/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm allocation' })).toBeEnabled();
  });

  it('blocks allocating more than the cash available', async () => {
    await openDialog();
    const field = screen.getByLabelText('Amount to allocate to RCV-NEW');
    await userEvent.clear(field);
    await userEvent.type(field, '500.00');
    expect(screen.getByText(/Over by ₦100\.00/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm allocation' })).toBeDisabled();
  });

  it('blocks allocating more than a receivable\'s balance', async () => {
    await openDialog();
    const field = screen.getByLabelText('Amount to allocate to RCV-OLD');
    await userEvent.clear(field);
    await userEvent.type(field, '700.00');
    expect(await screen.findByText(/More than the balance/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm allocation' })).toBeDisabled();
  });

  it('submits only the filled amounts, with an Idempotency-Key', async () => {
    await openDialog();
    const second = screen.getByLabelText('Amount to allocate to RCV-NEW');
    await userEvent.clear(second);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm allocation' }));
    await waitFor(() => {
      const call = hoisted.api.mock.calls.find(([path]) => path === '/payments/pay-1/allocations');
      expect(call).toBeDefined();
      expect(call![1].body).toEqual({ allocations: [{ receivableId: 'r1', amount: '600.00' }] });
      expect(call![1].headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });
});
