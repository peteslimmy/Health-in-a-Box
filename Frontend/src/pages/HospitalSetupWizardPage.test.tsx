import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSessionUser, renderWithProviders } from '../test/utils';
import { HospitalSetupWizardPage } from './HospitalSetupWizardPage';

const hoisted = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  api: hoisted.api,
}));
vi.mock('../auth/AuthContext', () => ({
  useUser: () => makeSessionUser({ permissions: ['hospitals.onboard'] }),
  useAuth: () => ({ status: 'signedIn' }),
}));

const analysis = {
  draftId: 'draft-1',
  existingMatches: [],
  profile: {
    source: {
      fileName: 'uath.pdf',
      kind: 'PDF',
      title: 'UNIVERSITY OF ABUJA TEACHING HOSPITAL, GWAGWALADA',
      printedAt: '2026-10-26T18:14',
      printDate: '2026-10-26',
      period: { start: '2026-09-25', end: '2026-10-25' },
      pages: 2,
      setAsideLines: ['Director of Finance & Accounts'],
    },
    hospital: { suggestedName: 'University of Abuja Teaching Hospital, Gwagwalada', suggestedCode: 'UATH', printedNumber: null },
    departments: [
      { rowNumber: 2, printedName: 'ACCIDENT AND EMERGENCY UNIT', name: 'ACCIDENT AND EMERGENCY UNIT', code: 'ACCIDENT_AND_EMERGENCY_UNI', total: '464000.00' },
      { rowNumber: 3, printedName: 'PHARMACY', name: 'PHARMACY', code: 'PHARMACY', total: '1000.00' },
    ],
    channels: [
      { printedHeading: 'Cash', name: 'Cash', code: 'CASH', total: '0.00', hasActivity: false },
      { printedHeading: 'Mobile Money', name: 'Mobile Money', code: 'MOBILE_MONEY', total: '465000.00', hasActivity: true },
    ],
    grandTotal: '465000.00',
    tally: { ok: false, problems: [{ row: 4, message: 'Printed grand total differs by 500.00' }] },
    notes: [],
  },
};

function start() {
  hoisted.api.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
    if (path === '/hospital-setup' && !options?.method) return [{ id: 'draft-1', fileName: 'uath.pdf', createdAt: '2026-10-27T10:00:00Z', suggestedName: 'University of Abuja Teaching Hospital, Gwagwalada', departments: 2, channels: 2 }];
    if (path === '/hospital-setup/draft-1') return analysis;
    if (path === '/hospital-setup/draft-1/commit')
      return { hospital: { id: 'c1', code: 'UATH', name: 'University', status: 'ACTIVE' }, counts: { departments: 2, channels: 2 }, termsCreated: true, import: { id: 'imp-1', status: 'NEEDS_REVIEW' }, importError: null };
    throw new Error(`unexpected ${path}`);
  });
  renderWithProviders(<HospitalSetupWizardPage />, { path: '/', route: '/' });
}

async function resumeDraft() {
  await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));
  await screen.findByText('Hospital named on the report');
}
const next = () => userEvent.click(screen.getByRole('button', { name: 'Next' }));

describe('hospital set-up wizard', () => {
  beforeEach(() => {
    hoisted.api.mockReset();
  });

  it('offers to continue an unfinished set-up', async () => {
    start();
    expect(await screen.findByText('Unfinished set-ups')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read the report' })).toBeDisabled();
  });

  it('shows what was found in the report: hospital, period, when it was printed, counts and a tally warning', async () => {
    start();
    await resumeDraft();
    expect(screen.getByText('UNIVERSITY OF ABUJA TEACHING HOSPITAL, GWAGWALADA')).toBeInTheDocument();
    expect(screen.getByText('None printed')).toBeInTheDocument();
    expect(screen.getByText(/25 Sept?\.? 2026 – 25 Oct 2026|25 Sep 2026 – 25 Oct 2026/)).toBeInTheDocument();
    expect(screen.getByText('26 Oct 2026, 6:14 pm')).toBeInTheDocument();
    expect(screen.getByText('2 (1 with amounts)')).toBeInTheDocument();
    expect(screen.getByText('The totals in this report do not add up')).toBeInTheDocument();
  });

  it('carries the proposed hospital into the form and blocks an invalid code', async () => {
    start();
    await resumeDraft();
    await next();
    expect(screen.getByLabelText('Hospital code')).toHaveValue('UATH');
    expect(screen.getByLabelText('Hospital name')).toHaveValue('University of Abuja Teaching Hospital, Gwagwalada');
    await userEvent.clear(screen.getByLabelText('Hospital code'));
    await userEvent.type(screen.getByLabelText('Hospital code'), 'U');
    expect(screen.getByRole('alert')).toHaveTextContent('2 to 20 letters');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('lets departments be renamed, tidied and excluded, and blocks repeated codes', async () => {
    start();
    await resumeDraft();
    await next();
    await next();
    await userEvent.click(screen.getByRole('button', { name: 'Tidy capitalisation' }));
    expect(screen.getByLabelText('Name of ACCIDENT AND EMERGENCY UNIT')).toHaveValue('Accident and Emergency Unit');
    // only capitalisation changed, and matching ignores case, so no extra name is remembered
    expect(screen.queryByText(/Reports will also match/)).toBeNull();
    // same code twice
    const code = screen.getByLabelText('Code of PHARMACY');
    await userEvent.clear(code);
    await userEvent.type(code, 'accident_and_emergency_uni');
    expect(screen.getByRole('alert')).toHaveTextContent('used 2 times');
    // excluding the clashing department clears the problem
    await userEvent.click(screen.getByLabelText('Include PHARMACY'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('1 of 2 included')).toBeInTheDocument();
  });

  it('marks channels with no amounts in the report', async () => {
    start();
    await resumeDraft();
    await next();
    await next();
    await next();
    expect(screen.getByText('No amounts in this report')).toBeInTheDocument();
  });

  it('creates the hospital with the edited lists and the terms, then links to it and to the import', async () => {
    start();
    await resumeDraft();
    for (let i = 0; i < 4; i += 1) await next();
    await userEvent.click(screen.getByRole('checkbox', { name: /Set the service charge now/ }));
    await userEvent.type(screen.getByLabelText(/Service charge \(%/), '7.5');
    await next();
    expect(screen.getByText('7.5%')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create the hospital' }));

    await waitFor(() => expect(screen.getByText(/University \(UATH\) is set up/)).toBeInTheDocument());
    const commitCall = hoisted.api.mock.calls.find((c) => c[0] === '/hospital-setup/draft-1/commit')!;
    const body = commitCall[1].body;
    expect(body.hospital).toMatchObject({ code: 'UATH', timezone: 'Africa/Lagos', paymentTermsDays: 30 });
    expect(body.departments).toEqual([
      { printedName: 'ACCIDENT AND EMERGENCY UNIT', name: 'ACCIDENT AND EMERGENCY UNIT', code: 'ACCIDENT_AND_EMERGENCY_UNI' },
      { printedName: 'PHARMACY', name: 'PHARMACY', code: 'PHARMACY' },
    ]);
    expect(body.terms).toMatchObject({ ratePercent: 7.5, effectiveFrom: '2026-09-25' });
    expect(body).toMatchObject({ activate: true, importNow: true });
    expect(screen.getByRole('link', { name: 'Open the import' })).toHaveAttribute('href', '/imports/imp-1');
  });

  it('keeps the hospital in draft and imports nothing when no terms are set', async () => {
    start();
    await resumeDraft();
    for (let i = 0; i < 5; i += 1) await next();
    expect(screen.getByText('Without service-charge terms the hospital is created in draft. Add its agreement on the hospital page, then activate it.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create the hospital' }));
    await waitFor(() => expect(hoisted.api.mock.calls.some((c) => c[0] === '/hospital-setup/draft-1/commit')).toBe(true));
    const body = hoisted.api.mock.calls.find((c) => c[0] === '/hospital-setup/draft-1/commit')![1].body;
    expect(body.terms).toBeUndefined();
    expect(body).toMatchObject({ activate: false, importNow: false });
  });
});
