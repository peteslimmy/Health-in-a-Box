import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { makeSessionUser } from './test/utils';

const hoisted = vi.hoisted(() => ({ auth: {} as Record<string, unknown> }));
vi.mock('./auth/AuthContext', () => ({ useAuth: () => hoisted.auth }));
vi.mock('./components/Layout', () => ({ Layout: () => <Outlet /> }));
vi.mock('./components/Branding', () => ({ BrandingEffects: () => null }));
vi.mock('./pages/UsersPage', () => ({ UsersPage: () => <p>users page</p> }));
vi.mock('./pages/PaymentNewPage', () => ({ PaymentNewPage: () => <p>new payment page</p> }));

function open(path: string, permissions: string[]) {
  hoisted.auth = { status: 'signedIn', user: makeSessionUser({ permissions }) };
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe('route permissions', () => {
  beforeEach(() => {
    hoisted.auth = {};
  });

  it('shows a not-allowed message instead of the page when the permission is missing', () => {
    open('/admin/users', ['payments.read']);
    expect(screen.getByRole('alert')).toHaveTextContent('You do not have access to this page');
    expect(screen.queryByText('users page')).toBeNull();
  });

  it('renders the page when the permission is held', () => {
    open('/admin/users', ['users.read']);
    expect(screen.getByText('users page')).toBeInTheDocument();
  });

  it('guards create screens with the create permission, not just read', () => {
    open('/payments/new', ['payments.read']);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
