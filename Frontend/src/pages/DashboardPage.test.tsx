import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSessionUser, renderWithProviders } from '../test/utils';
import { DashboardPage } from './DashboardPage';

const hoisted = vi.hoisted(() => ({ api: vi.fn(), permissions: [] as string[] }));
vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  api: hoisted.api,
}));
vi.mock('../auth/AuthContext', () => ({
  useUser: () => makeSessionUser({ permissions: hoisted.permissions }),
  useAuth: () => ({ status: 'signedIn' }),
}));

const measure = (label: string, amount: string) => ({ label, basis: 'basis', amount, count: 1 });
const summary = {
  currency: 'NGN',
  period: { from: '2026-10-01', to: '2026-10-27' },
  asAt: '2026-10-27',
  measures: {
    reportedRevenue: measure('Reported revenue', '1000.00'),
    expectedServiceCharge: measure('Expected service charge', '50.00'),
    owedForPeriod: { label: 'Still owing', basis: 'basis', amount: '30.00', percentPaid: '40.0' },
    chargesPosted: measure('Charges posted', '50.00'),
    paymentsReceived: measure('Payments received', '20.00'),
    paymentsAllocated: measure('Payments allocated', '20.00'),
    outstandingReceivables: measure('Outstanding receivables', '30.00'),
    overdueReceivables: measure('Overdue receivables', '10.00'),
    unallocatedReceipts: measure('Unallocated receipts', '0.00'),
  },
  awaitingAction: {},
};
const month = (m: string, due: string) => ({
  month: m,
  reportedRevenue: '100.00',
  chargesPosted: '10.00',
  paymentsReceived: '5.00',
  outstanding: '30.00',
  collectionRate: '50.0',
  due,
});
const trends = { currency: 'NGN', asAt: '2026-10-27', currentMonth: '2026-10', series: [month('2026-09', '1'), month('2026-10', '1')] };
const collection = {
  windowDays: 30,
  asAt: '2026-10-27',
  series: [
    { month: '2026-09', due: '100.00', settledWithinWindow: '10.00', settledToDate: '40.00', mature: false, rateWithinWindow: null, rateToDate: '40.0' },
    { month: '2026-10', due: '100.00', settledWithinWindow: '0.00', settledToDate: '0.00', mature: false, rateWithinWindow: null, rateToDate: '0.0' },
  ],
};
const reporting = {
  asAt: '2026-10-27',
  lateAfterDays: 7,
  lateCount: 1,
  hospitals: [
    { hospitalId: 'c1', code: 'LATE-1', name: 'Late Hospital', lastReportEnd: '2026-10-01', daysSince: 26, late: true },
    { hospitalId: 'c2', code: 'OK-2', name: 'Fine Hospital', lastReportEnd: '2026-10-26', daysSince: 1, late: false },
  ],
};
const insights = {
  asAt: '2026-10-27',
  comparedMonths: { previous: '2026-08', latest: '2026-09' },
  count: 1,
  items: [
    {
      id: 'late-reporting',
      area: 'Reporting',
      severity: 'urgent',
      title: '2 hospitals have not reported in over 7 days',
      detail: 'LATE-1 (26 days)',
      evidence: [],
      hospitalId: null,
      link: '/reports/reporting-status',
    },
  ],
};
const reports = [
  {
    id: 'payment-register',
    title: 'Payment receipt register',
    description: '',
    category: 'Payments',
    dateBasis: null,
    filters: [],
    statuses: null,
    canExport: false,
  },
];

function open(permissions: string[], route = '/') {
  hoisted.permissions = permissions;
  hoisted.api.mockImplementation(async (path: string) => {
    if (path === '/dashboard/summary') return summary;
    if (path === '/dashboard/trends') return trends;
    if (path === '/dashboard/collection') return collection;
    if (path === '/dashboard/reporting-status') return reporting;
    if (path === '/reports') return reports;
    if (path === '/dashboard/insights') return insights;
    if (path === '/receivables/ageing') return { asAt: '2026-10-27', total: {}, hospitals: [] };
    throw new Error(`unexpected ${path}`);
  });
  renderWithProviders(<DashboardPage />, { path: '/', route });
}

describe('dashboard', () => {
  beforeEach(() => {
    hoisted.api.mockReset();
  });

  it('no longer calls cash received over charges a collection rate, and shows the on-time rate separately', async () => {
    open(['dashboard.read', 'receivables.read', 'reports.read']);
    expect(await screen.findByText('Cash received vs charges posted')).toBeInTheDocument();
    expect(screen.getByText('Collection rate: settled on time')).toBeInTheDocument();
    expect(screen.getByText(/not a collection\s+rate/)).toBeInTheDocument();
    expect(screen.getByText(/A month\s+is final only once 30 days have passed/)).toBeInTheDocument();
  });

  it('shows the four-step money flow in order: made, due, paid, still owing', async () => {
    open(['dashboard.read', 'receivables.read']);
    const flow = (await screen.findByRole('region', { name: 'Money flow' })) as HTMLElement;
    const tiles = within(flow).getAllByText(/^(What the hospitals made|What is due to you|What the hospitals have paid you|What they still owe you)/);
    expect(tiles.map((t) => t.textContent)).toEqual([
      'What the hospitals made',
      'What is due to you (service charge)',
      'What the hospitals have paid you',
      'What they still owe you (due − paid)',
    ]);
    expect(within(flow).getByText('₦1,000.00')).toBeInTheDocument();
    expect(within(flow).getByText('₦50.00')).toBeInTheDocument();
    expect(within(flow).getByText('₦20.00')).toBeInTheDocument();
    expect(within(flow).getByText('₦30.00')).toBeInTheDocument();
    expect(within(flow).getByRole('img', { name: '40.0% of the expected charge has been paid' })).toBeInTheDocument();
  });

  it('says "Paid ahead" instead of a negative balance when more was paid than charged', async () => {
    summary.measures.owedForPeriod = { label: 'Still owing', basis: 'basis', amount: '-15.00', percentPaid: '130.0' } as never;
    try {
      open(['dashboard.read', 'receivables.read']);
      const flow = (await screen.findByRole('region', { name: 'Money flow' })) as HTMLElement;
      expect(within(flow).getByText('Paid ahead')).toBeInTheDocument();
      expect(within(flow).queryByText('Still owing')).toBeNull();
    } finally {
      summary.measures.owedForPeriod = { label: 'Still owing', basis: 'basis', amount: '30.00', percentPaid: '40.0' } as never;
    }
  });

  it('offers quick periods and puts the chosen one in the address', async () => {
    open(['dashboard.read', 'receivables.read']);
    const group = await screen.findByRole('group', { name: 'Quick periods' });
    await userEvent.click(within(group).getByRole('button', { name: 'All time' }));
    expect(within(group).getByRole('button', { name: 'All time' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(group).getByRole('button', { name: 'This month' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('lists hospitals that are late and says how long since they reported', async () => {
    open(['dashboard.read', 'receivables.read']);
    expect(await screen.findByText(/1 hospital is late/)).toBeInTheDocument();
    const card = screen.getByText('Report submission').closest('section') as HTMLElement;
    expect(within(card).getByText('Late Hospital (LATE-1)')).toBeInTheDocument();
    expect(within(card).getByText('26 days')).toBeInTheDocument();
    expect(within(card).queryByText(/Fine Hospital/)).toBeNull();
  });

  it('turns a figure into a link to its records only when the user may open that report', async () => {
    open(['dashboard.read', 'receivables.read', 'reports.read']);
    const link = await screen.findByRole('link', { name: 'Payments received: open the records' });
    expect(link).toHaveAttribute('href', expect.stringContaining('/reports/payment-register?'));
    expect(link.getAttribute('href')).toContain('from=');
    expect(screen.queryByRole('link', { name: 'Reported revenue: open the records' })).toBeNull();
  });

  it('shows no figure links to a user without report access', async () => {
    open(['dashboard.read', 'receivables.read']);
    await screen.findByText('Open ledger balance');
    expect(screen.queryByRole('link', { name: /open the records/ })).toBeNull();
  });

  it('shows rule-based insights with their sentence and a link to the records', async () => {
    open(['dashboard.read', 'receivables.read']);
    const link = await screen.findByRole('link', { name: '2 hospitals have not reported in over 7 days' });
    expect(link).toHaveAttribute('href', '/reports/reporting-status');
    expect(screen.getByText('LATE-1 (26 days)')).toBeInTheDocument();
  });

  it('keeps the filters in the address and offers to clear them', async () => {
    open(['dashboard.read', 'receivables.read'], '/?from=2026-09-01&to=2026-09-30');
    expect(await screen.findByText('Showing:')).toBeInTheDocument();
    const call = hoisted.api.mock.calls.find(([path]) => path === '/dashboard/summary');
    expect(call?.[1].query).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.queryByText('Showing:')).toBeNull();
  });
});
