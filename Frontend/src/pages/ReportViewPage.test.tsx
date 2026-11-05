import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSessionUser, renderWithProviders } from '../test/utils';
import type { ReportResult, ReportSummary } from '../lib/types';
import { ReportViewPage } from './ReportViewPage';

const hoisted = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  api: hoisted.api,
}));
vi.mock('../auth/AuthContext', () => ({
  useUser: () => makeSessionUser({ permissions: ['reports.read', 'reports.export'] }),
  useAuth: () => ({ status: 'signedIn' }),
}));

const summary = (overrides: Partial<ReportSummary> = {}): ReportSummary => ({
  id: 'payment-register',
  title: 'Payment receipt register',
  description: 'Receipts',
  category: 'Payments',
  dateBasis: 'Receipt date',
  filters: ['hospitalId', 'from', 'to', 'status'],
  statuses: ['POSTED', 'ALL'],
  canExport: true,
  ...overrides,
});

const result: ReportResult = {
  report: { id: 'payment-register', title: 'Payment receipt register', dateBasis: 'Receipt date' },
  filters: {},
  columns: [
    { key: 'ref', label: 'Reference', type: 'text' },
    { key: 'amount', label: 'Amount', type: 'money' },
  ],
  notes: ['Showing posted receipts only.'],
  totals: { ref: 'Total', amount: '1500.50' },
  generatedAt: '2026-10-27T10:00:00.000Z',
  items: [
    { ref: 'R1', amount: '1000.00' },
    { ref: 'R2', amount: '500.50' },
  ],
  meta: { page: 1, pageSize: 50, total: 2, totalPages: 1 },
} as ReportResult;

function open(reportSummary: ReportSummary) {
  hoisted.api.mockImplementation(async (path: string) => (path === '/reports' ? [reportSummary] : result));
  renderWithProviders(<ReportViewPage />, { path: '/reports/:id', route: '/reports/payment-register' });
}

describe('report viewer', () => {
  beforeEach(() => {
    hoisted.api.mockReset();
  });

  it('shows rows, a totals row, the basis note and only the filters the report declares', async () => {
    open(summary());
    expect(await screen.findByText('R1')).toBeInTheDocument();
    expect(screen.getByText('Showing posted receipts only.')).toBeInTheDocument();
    expect(screen.getByText('₦1,500.50')).toBeInTheDocument();
    expect(screen.getByLabelText(/From \(receipt date\)/)).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
  });

  it('hides export buttons when the report cannot be exported by this user', async () => {
    open(summary({ canExport: false, filters: ['hospitalId'] }));
    await screen.findByText('R1');
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull();
    expect(screen.queryByLabelText('Status')).toBeNull();
  });

  it('asks the server for the chosen filters and returns to page one', async () => {
    open(summary());
    await screen.findByText('R1');
    await userEvent.type(screen.getByLabelText(/From/), '2026-10-01');
    await waitFor(() => {
      const call = hoisted.api.mock.calls.find(([path, options]) => path === '/reports/payment-register' && options?.query?.from === '2026-10-01');
      expect(call?.[1].query.page).toBe(1);
    });
  });

  it('opens already filtered when reached from a dashboard figure', async () => {
    hoisted.api.mockImplementation(async (path: string) => (path === '/reports' ? [summary()] : result));
    renderWithProviders(<ReportViewPage />, { path: '/reports/:id', route: '/reports/payment-register?from=2026-10-01&to=2026-10-27&status=ALL' });
    await screen.findByText('R1');
    expect(screen.getByLabelText(/From/)).toHaveValue('2026-10-01');
    const call = hoisted.api.mock.calls.find(([path]) => path === '/reports/payment-register');
    expect(call?.[1].query).toMatchObject({ from: '2026-10-01', to: '2026-10-27', status: 'ALL' });
  });

  it('says so when no records match', async () => {
    hoisted.api.mockImplementation(async (path: string) =>
      path === '/reports' ? [summary()] : { ...result, items: [], totals: null, meta: { page: 1, pageSize: 50, total: 0, totalPages: 1 } },
    );
    renderWithProviders(<ReportViewPage />, { path: '/reports/:id', route: '/reports/payment-register' });
    expect(await screen.findByText('No records match these filters')).toBeInTheDocument();
  });

  it('tells the user when the report does not exist or is not available to them', async () => {
    hoisted.api.mockImplementation(async () => []);
    renderWithProviders(<ReportViewPage />, { path: '/reports/:id', route: '/reports/payment-register' });
    expect(await screen.findByText('Report not found')).toBeInTheDocument();
  });
});
