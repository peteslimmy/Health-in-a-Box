import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSessionUser, renderWithProviders } from '../test/utils';
import { ImportDetailPage } from './ImportDetailPage';

const hoisted = vi.hoisted(() => ({ api: vi.fn(), permissions: [] as string[], userId: 'reviewer' }));
vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  api: hoisted.api,
}));
vi.mock('../auth/AuthContext', () => ({
  useUser: () => makeSessionUser({ id: hoisted.userId, permissions: hoisted.permissions }),
  useAuth: () => ({ status: 'signedIn' }),
}));

const tally = [
  { code: 'ROW_TOTAL_MISMATCH', row: 2, message: 'PHARMACY: reported total 1000.00 differs from the channel sum 900.00 by 100.00' },
  { code: 'GRAND_TOTAL_MISMATCH', row: 3, message: 'Printed grand total 1000.00 differs from the department totals 900.00' },
];
const detail = (overrides: Record<string, unknown> = {}, errors = tally) => ({
  id: 'imp-1',
  status: 'NEEDS_REVIEW',
  fileName: 'uath.pdf',
  periodStart: '2026-09-25T00:00:00.000Z',
  periodEnd: '2026-10-25T00:00:00.000Z',
  rowCount: 1,
  validRowCount: 0,
  totalAmount: '1000.00',
  createdAt: '2026-10-28T07:00:00Z',
  createdById: 'uploader',
  committedReportId: null,
  committedReport: null,
  hospital: { id: 'c1', code: 'UATH', name: 'UATH' },
  createdBy: { id: 'uploader', fullName: 'Una Uploader', email: 'u@x' },
  errorCount: errors.length,
  validationJson: { errors, warnings: [], flags: [], grandTotal: '1000.00', channelTotal: '900.00' },
  normalizedJson: {
    lines: [{ rowNumber: 2, rawDepartment: 'PHARMACY', departmentCode: 'PHARMACY', reportedTotal: '1000.00', channelTotal: '900.00', variance: '100.00', amounts: { CASH: '900.00' } }],
  },
  ...overrides,
});

function open(data: unknown, permissions: string[], userId = 'reviewer') {
  hoisted.permissions = permissions;
  hoisted.userId = userId;
  hoisted.api.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (path === '/imports/imp-1' && !options?.method) return data;
    if (path === '/imports/imp-1/commit-with-variance') return { reportId: 'r1', withVariance: true };
    throw new Error(`unexpected ${path}`);
  });
  renderWithProviders(<ImportDetailPage />, { path: '/imports/:id', route: '/imports/imp-1' });
}

describe('approving report differences', () => {
  beforeEach(() => {
    hoisted.api.mockReset();
  });

  it('shows the printed total, the channel total and the difference to a reviewer who may approve', async () => {
    open(detail(), ['imports.read', 'imports.approve_variance']);
    expect(await screen.findByText('Approve the differences and commit')).toBeInTheDocument();
    expect(screen.getByText('Difference')).toBeInTheDocument();
    expect(screen.getAllByText('₦100.00').length).toBeGreaterThan(0);
    expect(screen.getByText(/2 findings in all/)).toBeInTheDocument();
  });

  it('keeps the button disabled until a written reason of 20 characters and the confirmation are given', async () => {
    open(detail(), ['imports.read', 'imports.approve_variance']);
    const button = await screen.findByRole('button', { name: 'Commit with approved differences' });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Why are these differences acceptable?'), 'too short');
    await userEvent.click(screen.getByRole('checkbox', { name: /I have reviewed the differences/ }));
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Why are these differences acceptable?'), ' and now it is long enough to count');
    expect(button).toBeEnabled();
  });

  it('sends the reason to the approval route, not the ordinary commit', async () => {
    open(detail(), ['imports.read', 'imports.approve_variance']);
    await userEvent.type(await screen.findByLabelText('Why are these differences acceptable?'), 'Hospital confirmed the late cheque by phone');
    await userEvent.click(screen.getByRole('checkbox', { name: /I have reviewed the differences/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Commit with approved differences' }));
    await waitFor(() =>
      expect(hoisted.api).toHaveBeenCalledWith('/imports/imp-1/commit-with-variance', {
        method: 'POST',
        body: { reason: 'Hospital confirmed the late cheque by phone' },
      }),
    );
    expect(hoisted.api.mock.calls.some((c) => c[0] === '/imports/imp-1/commit')).toBe(false);
    expect(await screen.findByText('Committed with the differences approved')).toBeInTheDocument();
  });

  it('offers nothing to someone without the permission', async () => {
    open(detail(), ['imports.read', 'imports.commit']);
    await screen.findByText(/problems must be fixed|problem must be fixed/);
    expect(screen.queryByText('Approve the differences and commit')).toBeNull();
    expect(screen.getByText(/someone with permission to approve differences/)).toBeInTheDocument();
  });

  it('tells the uploader that someone else must approve, and offers no button', async () => {
    open(detail(), ['imports.read', 'imports.approve_variance'], 'uploader');
    expect(await screen.findByText('A different person must approve the differences')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Commit with approved differences' })).toBeNull();
  });

  it('does not offer approval when something other than a total difference is wrong', async () => {
    const mixed = [...tally, { code: 'UNKNOWN_DEPARTMENT', row: 5, message: 'Department "X" is not configured for this hospital' }];
    open(detail({}, mixed), ['imports.read', 'imports.approve_variance']);
    await screen.findByText(/must be fixed before this can be committed/);
    expect(screen.queryByText('Approve the differences and commit')).toBeNull();
    expect(screen.getByText(/Other problems here cannot be approved/)).toBeInTheDocument();
  });

  it('shows who accepted the differences, when, and why, once the report is committed', async () => {
    open(
      detail({
        status: 'COMMITTED',
        committedReportId: 'r1',
        committedReport: {
          id: 'r1',
          varianceApprovedAt: '2026-10-28T10:00:00Z',
          varianceReason: 'Hospital confirmed the late cheque by phone',
          varianceApprovedBy: { id: 'a', fullName: 'Ada Approver' },
          varianceJson: { printedGrandTotal: '1000.00', evidencedTotal: '900.00', difference: '100.00', linesWithDifference: [], findings: 2, findingsByCode: {}, accepted: [] },
        },
      }),
      ['imports.read'],
    );
    expect(await screen.findByText('Committed with approved differences')).toBeInTheDocument();
    expect(screen.getByText(/Ada Approver accepted the differences/)).toBeInTheDocument();
    expect(screen.getByText(/Hospital confirmed the late cheque by phone/)).toBeInTheDocument();
    expect(screen.queryByText('Approve the differences and commit')).toBeNull();
  });
});
