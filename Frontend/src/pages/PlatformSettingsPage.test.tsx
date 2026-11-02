import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSessionUser, renderWithProviders } from '../test/utils';
import { PlatformSettingsPage } from './PlatformSettingsPage';

const hoisted = vi.hoisted(() => ({ api: vi.fn(), settings: null as unknown }));
vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/api')>()),
  api: hoisted.api,
}));
vi.mock('../auth/AuthContext', () => ({
  useUser: () => makeSessionUser({ email: 'owner@gmail.com', permissions: ['platform.manage'] }),
  useAuth: () => ({ status: 'signedIn' }),
}));

const presets = [
  { id: 'sendgrid', label: 'SendGrid', host: 'smtp.sendgrid.net', port: 587, secure: false, userHint: 'apikey', keyHint: 'A SendGrid API key' },
  { id: 'gmail', label: 'Gmail / Google Workspace', host: 'smtp.gmail.com', port: 465, secure: true, userHint: 'Your full address', keyHint: 'An app password' },
];
const settings = (smtp: Record<string, unknown> = {}) => ({
  profile: { appName: 'HNB Receivables', tagline: null, supportEmail: null },
  smtp: { configured: false, host: null, port: null, secure: true, user: null, hasPassword: false, fromName: null, fromEmail: null, replyTo: null, updatedAt: null, lastTest: null, ...smtp },
  presets,
  branding: { logo: null, favicon: null },
});
const domains = {
  domains: [{ id: 'd1', domain: '4coretech.com', note: 'Our staff', isActive: true, createdAt: '2026-10-28T00:00:00Z', accounts: 2 }],
  blockedAccounts: [{ id: 'u9', email: 'rando@gmail.com', fullName: 'Rando', reason: 'Gmail addresses are blocked. Only registered super admins may use Gmail' }],
  rule: '',
};
const admins = { superAdmins: [{ id: 'u1', email: 'owner@gmail.com', fullName: 'Owner', isActive: true, mfaEnabled: false, lastLoginAt: null }], rule: '' };

function open(tab = 'email', current = settings()) {
  hoisted.api.mockImplementation(async (path: string) => {
    if (path === '/platform/settings') return current;
    if (path === '/platform/domains') return domains;
    if (path === '/platform/super-admins') return admins;
    return {};
  });
  renderWithProviders(<PlatformSettingsPage />, { path: '/admin/platform', route: `/admin/platform?tab=${tab}` });
}

describe('platform settings', () => {
  beforeEach(() => {
    hoisted.api.mockReset();
  });

  it('has four windows, opens the one in the address, and says who can see it', async () => {
    open('domains');
    expect(await screen.findByText('Approved email domains', { selector: 'caption' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Email (SMTP)', 'Profile and branding', 'Approved domains', 'Super admins']);
    expect(screen.getByRole('tab', { name: 'Approved domains' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/Only a super admin can see this page/)).toBeInTheDocument();
  });

  it('fills in the server and port for a chosen provider', async () => {
    open('email');
    await userEvent.selectOptions(await screen.findByLabelText('Provider (optional)'), 'sendgrid');
    expect(screen.getByLabelText('SMTP server')).toHaveValue('smtp.sendgrid.net');
    expect(screen.getByLabelText('Port')).toHaveValue('587');
    expect(screen.getByText(/For SendGrid: apikey/)).toBeInTheDocument();
  });

  it('sends the settings, including the key, to the server and clears the key from the form', async () => {
    open('email');
    await userEvent.selectOptions(await screen.findByLabelText('Provider (optional)'), 'sendgrid');
    await userEvent.type(screen.getByLabelText('SMTP user name'), 'apikey');
    await userEvent.type(screen.getByLabelText('SMTP password or API key'), 'SG.my-key');
    await userEvent.type(screen.getByLabelText('From email address'), 'no-reply@4coretech.com');
    await userEvent.click(screen.getByRole('button', { name: 'Save email settings' }));
    await waitFor(() =>
      expect(hoisted.api).toHaveBeenCalledWith('/platform/smtp', {
        method: 'PUT',
        body: expect.objectContaining({ host: 'smtp.sendgrid.net', port: 587, secure: false, user: 'apikey', password: 'SG.my-key', fromEmail: 'no-reply@4coretech.com' }),
      }),
    );
    await waitFor(() => expect(screen.getByLabelText('SMTP password or API key')).toHaveValue(''));
  });

  it('keeps a saved key: nothing is sent for the password unless a new one is typed, and it is never shown', async () => {
    open('email', settings({ configured: true, host: 'smtp.sendgrid.net', port: 587, secure: false, user: 'apikey', hasPassword: true, fromName: 'HNB', fromEmail: 'no-reply@4coretech.com' }));
    expect(await screen.findByText(/A password is saved/)).toBeInTheDocument();
    expect(screen.getByLabelText('SMTP password or API key')).toHaveValue('');
    await userEvent.click(screen.getByRole('button', { name: 'Save email settings' }));
    await waitFor(() => expect(hoisted.api.mock.calls.some((c) => c[0] === '/platform/smtp')).toBe(true));
    const body = hoisted.api.mock.calls.find((c) => c[0] === '/platform/smtp')![1].body;
    expect(body).not.toHaveProperty('password');
  });

  it('sends a test email to the signed-in person by default and shows the last result', async () => {
    open('email', settings({ configured: true, host: 'smtp.sendgrid.net', port: 587, secure: false, fromEmail: 'a@b.co', lastTest: { at: '2026-10-28T10:00:00Z', ok: false, note: 'Invalid login: 535' } }));
    expect(await screen.findByText('The last test failed')).toBeInTheDocument();
    expect(screen.getByText(/Invalid login: 535/)).toBeInTheDocument();
    expect(screen.getByLabelText('Send a test message to')).toHaveValue('owner@gmail.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send test email' }));
    await waitFor(() => expect(hoisted.api).toHaveBeenCalledWith('/platform/smtp/test', { method: 'POST', body: { to: 'owner@gmail.com' } }));
  });

  it('asks to save before testing when email is not set up', async () => {
    open('email');
    expect(await screen.findByText('Save the settings above first.')).toBeInTheDocument();
  });

  it('lists approved domains with their accounts, and the accounts the rules block', async () => {
    open('domains');
    const table = await screen.findByRole('table', { name: 'Approved email domains' });
    expect(within(table).getByText('4coretech.com')).toBeInTheDocument();
    expect(within(table).getByText('2')).toBeInTheDocument();
    expect(screen.getByText('rando@gmail.com')).toBeInTheDocument();
    expect(screen.getByText(/Gmail is blocked for everyone except registered super admins/)).toBeInTheDocument();
  });

  it('adds a domain, and shows the server\'s reason when Gmail is refused', async () => {
    open('domains');
    await userEvent.type(await screen.findByLabelText('Domain'), 'uath.gov.ng');
    await userEvent.click(screen.getByRole('button', { name: 'Approve domain' }));
    await waitFor(() => expect(hoisted.api).toHaveBeenCalledWith('/platform/domains', { method: 'POST', body: { domain: 'uath.gov.ng' } }));
  });

  it('warns how many people lose access before a domain is removed', async () => {
    open('domains');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(screen.getByText(/2 active accounts at this domain will be blocked immediately/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove domain' }));
    await waitFor(() => expect(hoisted.api).toHaveBeenCalledWith('/platform/domains/d1', { method: 'DELETE' }));
  });

  it('registers a super admin with a Gmail address', async () => {
    open('admins');
    await userEvent.type(await screen.findByLabelText('Gmail address'), 'second@gmail.com');
    await userEvent.type(screen.getByLabelText('Full name'), 'Second Owner');
    await userEvent.type(screen.getByLabelText('Password'), 'Str0ngPassw0rd');
    await userEvent.click(screen.getByRole('button', { name: 'Register super admin' }));
    await waitFor(() =>
      expect(hoisted.api).toHaveBeenCalledWith('/platform/super-admins', { method: 'POST', body: { email: 'second@gmail.com', fullName: 'Second Owner', password: 'Str0ngPassw0rd' } }),
    );
  });

  it('shows the logo and favicon slots with what is accepted', async () => {
    open('branding');
    expect(await screen.findByText(/PNG, JPEG or WebP, up to 1 MB/)).toBeInTheDocument();
    expect(screen.getByText(/square PNG/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Upload' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Upload' })[0]).toBeDisabled();
  });
});
