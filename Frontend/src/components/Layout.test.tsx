import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeSessionUser, renderWithProviders } from '../test/utils';
import { Layout } from './Layout';

const hoisted = vi.hoisted(() => ({ user: null as unknown }));
vi.mock('../auth/AuthContext', () => ({
  useUser: () => hoisted.user,
  useAuth: () => ({ user: hoisted.user, signOut: vi.fn() }),
}));

// Only the sidebar's links (the skip-to-content link is not navigation).
const links = () => within(screen.getByRole('navigation')).getAllByRole('link').map((link) => link.textContent);

describe('navigation', () => {
  it('shows only the areas the user may open', () => {
    hoisted.user = makeSessionUser({ permissions: ['dashboard.read', 'payments.read', 'receivables.read'] });
    renderWithProviders(<Layout />);
    // "My work" and "My sign-in security" are open to everyone.
    expect(links()).toEqual(['Dashboard', 'My work', 'Receivables', 'Payments', 'My sign-in security']);
  });

  it('shows administration only to people who can read users and roles', () => {
    hoisted.user = makeSessionUser({ permissions: ['users.read', 'roles.read', 'audit.read'] });
    renderWithProviders(<Layout />);
    expect(links()).toEqual(expect.arrayContaining(['Audit trail', 'Users', 'Roles']));
    expect(links()).not.toContain('Payments');
  });

  it('shows who is signed in and their centre scope', () => {
    hoisted.user = makeSessionUser({ fullName: 'Ada Manager', roleCodes: ['FINANCE_MANAGER'], allCentres: false, centreIds: ['a', 'b'], permissions: ['dashboard.read'] });
    renderWithProviders(<Layout />);
    expect(screen.getByText('Ada Manager')).toBeInTheDocument();
    expect(screen.getByText('2 assigned centres')).toBeInTheDocument();
  });
});
