import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/utils';
import type { WorkQueue } from '../lib/types';
import { WorkQueuePage } from './WorkQueuePage';

const hoisted = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  api: hoisted.api,
}));

const queue: WorkQueue = {
  asAt: '2026-10-27',
  total: 3,
  urgent: 1,
  counts: { 'Late report': 1, 'Credit adjustment': 2 },
  items: [
    {
      key: 'late-1',
      kind: 'Late report',
      action: 'Chase the hospital',
      title: 'Last report ended 20 days ago',
      hospital: 'C1 · One',
      ageDays: 20,
      severity: 'urgent',
      link: '/imports?hospitalId=c1',
    },
    {
      key: 'adj-1',
      kind: 'Credit adjustment',
      action: 'Approve or reject',
      title: 'RCV-1 · ₦100.00',
      hospital: 'C1 · One',
      ageDays: 5,
      severity: 'attention',
      link: '/adjustments',
    },
    {
      key: 'adj-2',
      kind: 'Credit adjustment',
      action: 'Approve or reject',
      title: 'RCV-2 · ₦50.00',
      hospital: 'C2 · Two',
      ageDays: 0,
      severity: 'info',
      link: '/adjustments',
    },
  ],
};

describe('my work', () => {
  beforeEach(() => {
    hoisted.api.mockReset();
  });

  it('lists the most urgent first, with what to do, where, and how long it has waited', async () => {
    hoisted.api.mockResolvedValue(queue);
    renderWithProviders(<WorkQueuePage />, { path: '/work', route: '/work' });
    expect(await screen.findByText('3 items · 1 urgent')).toBeInTheDocument();
    const links = screen.getAllByRole('link');
    expect(links[0]).toHaveAttribute('href', '/imports?hospitalId=c1');
    expect(links[0]).toHaveTextContent('Urgent');
    expect(links[0]).toHaveTextContent('20 days');
    expect(links[2]).toHaveTextContent('today');
  });

  it('narrows the list by kind', async () => {
    hoisted.api.mockResolvedValue(queue);
    renderWithProviders(<WorkQueuePage />, { path: '/work', route: '/work' });
    await userEvent.selectOptions(await screen.findByLabelText('Filter by kind'), 'Credit adjustment');
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.queryByText(/Last report ended/)).toBeNull();
  });

  it('says plainly when nothing is waiting', async () => {
    hoisted.api.mockResolvedValue({ asAt: '2026-10-27', total: 0, urgent: 0, counts: {}, items: [] });
    renderWithProviders(<WorkQueuePage />, { path: '/work', route: '/work' });
    expect(await screen.findByText('Nothing is waiting for you')).toBeInTheDocument();
  });
});
